import { NextRequest, NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createServiceClient, releaseServiceClient } from '@/lib/supabase/server'
import { processDocument } from '@/lib/document-processing'
import { logger, withRequestContext, generateCorrelationId } from '@/lib/logger'
import type { GenericSupabaseSchema } from '@/types/supabase'

type JobStatus = 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled'

type ProcessingMethod = 'sync' | 'batch'

interface DocumentJobJoin {
  id: string
  title: string | null
  filename: string | null
  file_path: string
  file_size: number
  user_id: string
}

interface DocumentJobRecord {
  id: string
  document_id: string
  user_id: string
  status: JobStatus
  attempts: number
  max_attempts: number
  processing_method?: ProcessingMethod | null
  batch_operation_id?: string | null
  documents?: DocumentJobJoin[] | DocumentJobJoin | null
  started_at?: string | null
  completed_at?: string | null
  result_summary?: Record<string, unknown> | null
}

type ServiceSupabase = SupabaseClient<GenericSupabaseSchema>

interface QueueStatRecord {
  status: JobStatus
  created_at: string
}

const DEFAULT_RETRY_DELAY_MS = 1000

function scheduleCronRetry(requestUrl: string, reason: string, delayMs: number = DEFAULT_RETRY_DELAY_MS) {
  const secret = process.env['CRON_SECRET']
  if (!secret) {
    logger.warn('Skipping cron auto-retry because CRON_SECRET is not set', { reason })
    return
  }

  try {
    const url = new URL(requestUrl)
    setTimeout(() => {
      fetch(url.toString(), {
        method: 'GET',
        headers: {
          authorization: `Bearer ${secret}`,
          'x-cron-auto-retry': reason,
        },
      }).catch(error => {
        logger.warn('Auto-triggered cron retry failed', {
          reason,
          error: error instanceof Error ? error.message : String(error),
        })
      })
    }, delayMs)
  } catch (error) {
    logger.warn('Failed to schedule cron retry', {
      reason,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

// Always try sync processing first - no estimation needed
function needsBatchProcessing(fileSize: number, filename: string): boolean {
  // Always try sync first - let Document AI tell us if it's too large
  const fileSizeMB = parseFloat((fileSize / (1024 * 1024)).toFixed(1))
  logger.info('Evaluating processing strategy', { 
    filename,
    fileSize,
    fileSizeMB,
    strategy: 'sync-first',
    component: 'batch-processing'
  })
  
  return false // Always start with sync
}

// Extract job processing logic into a separate function
async function processJob(
  supabase: ServiceSupabase,
  job: DocumentJobRecord
) {
  logger.info('Processing job', { 
    jobId: job.id, 
    documentId: job.document_id, 
    status: job.status,
    component: 'cron-job'
  })

  try {
    // Only update to processing if job is queued (not already processing)
    if (job.status === 'queued') {
      // Mark job as processing
      const { error: updateJobError } = await supabase
        .from('document_jobs')
        .update({ 
          status: 'processing', 
          started_at: new Date().toISOString(),
          attempts: job.attempts + 1
        })
        .eq('id', job.id)

      if (updateJobError) {
        logger.error('Error updating job status', updateJobError, { jobId: job.id })
        throw new Error('Failed to update job status')
      }

      // Mark document as processing
      const { error: updateDocError } = await supabase
        .from('documents')
        .update({ status: 'processing' })
        .eq('id', job.document_id)

      if (updateDocError) {
        logger.error('Error updating document status', updateDocError, { 
          jobId: job.id, 
          documentId: job.document_id 
        })
      }
    } else {
      logger.info('Job already in processing status, checking batch operation', { 
        jobId: job.id, 
        status: job.status 
      })
    }

    try {
      // OPTIMIZED: Document should always be available from JOIN, no fallback needed
      const joinedDocument = job.documents
      let document: DocumentJobJoin | null = Array.isArray(joinedDocument)
        ? joinedDocument[0] ?? null
        : joinedDocument ?? null

      /*
       * =======================================================================
       * WORKAROUND: JOIN Query Fallback for Missing Document Data
       * =======================================================================
       *
       * EXPECTED BEHAVIOR:
       * The main query (lines 534-561) uses `documents!inner (...)` to JOIN
       * document_jobs with documents table. This should ALWAYS return the
       * document data since we're using an INNER JOIN.
       *
       * ACTUAL PROBLEM:
       * Occasionally, `job.documents` is null/empty even when:
       * 1. The document exists in the documents table
       * 2. The document_id foreign key is valid
       * 3. We're using service_role client (should bypass RLS)
       *
       * ROOT CAUSE ANALYSIS:
       * This suggests one of the following issues at the database level:
       *
       * 1. RLS POLICIES: Row Level Security policies may be incorrectly configured
       *    on the documents table, causing the JOIN to fail even for service_role.
       *    - Check: Does documents table have RLS enabled?
       *    - Check: Are RLS policies correctly configured for service_role bypass?
       *
       * 2. FOREIGN KEY CONSTRAINTS: The document_id in document_jobs might not
       *    have proper foreign key constraints, allowing orphaned references.
       *
       * 3. USER_ID MISMATCH: The user_id in document_jobs might not match the
       *    user_id in documents, causing JOIN to fail if RLS is user-scoped.
       *
       * WORKAROUND STRATEGY:
       * When JOIN fails to return document:
       * 1. Attempt direct query to documents table (bypassing JOIN)
       * 2. Log comprehensive diagnostics to identify root cause
       * 3. If document exists independently, use it to continue processing
       * 4. If document doesn't exist at all, fail with data integrity error
       *
       * PROPER FIX (TODO):
       * This is a temporary workaround. The proper fix requires database-level changes:
       * - Review and fix RLS policies on documents table
       * - Ensure service_role client properly bypasses RLS for JOINs
       * - Add/verify foreign key constraint: document_jobs.document_id -> documents.id
       * - Consider adding database trigger to prevent user_id mismatches
       *
       * TRACKING:
       * TODO(database): Fix RLS policies to prevent JOIN query failures
       * TODO(database): Add foreign key constraint on document_jobs.document_id
       * TODO(monitoring): Add alert when fallback is triggered (indicates DB issue)
       *
       * =======================================================================
       */
      if (!document) {
        // Debug: Check if document exists independently
        const { data: directDocument, error: directError } = await supabase
          .from('documents')
          .select('id, title, filename, file_path, file_size, user_id')
          .eq('id', job.document_id)
          .single()
        
        // Also check if there's a foreign key constraint issue
        const { data: jobDocCheck, error: jobDocError } = await supabase
          .from('document_jobs')
          .select(`
            id,
            document_id,
            user_id,
            documents (
              id,
              title,
              user_id
            )
          `)
          .eq('id', job.id)
          .single()
        
        logger.error('Document not found in JOIN query - comprehensive debugging', undefined, { 
          jobId: job.id, 
          documentId: job.document_id,
          directDocumentExists: !!directDocument,
          directError: directError?.message,
          jobUserIdFromJob: job.user_id,
          documentUserIdIfExists: directDocument?.user_id,
          joinResult: job.documents,
          jobDocCheck: jobDocCheck?.documents,
          jobDocError: jobDocError?.message,
          supabaseClientType: 'service_role'
        })
        
        if (directDocument) {
          logger.error('Document exists independently but not in JOIN - RLS or foreign key issue', undefined, {
            jobId: job.id,
            documentId: job.document_id,
            documentUserId: directDocument.user_id,
            jobUserId: job.user_id,
            userIdsMatch: directDocument.user_id === job.user_id,
            documentPath: directDocument.file_path,
            documentTitle: directDocument.title
          })
          
          // CRITICAL FIX: Use the direct document if it exists
          logger.warn('Using direct document lookup as workaround for JOIN issue', {
            jobId: job.id,
            documentId: job.document_id
          })
          const workingDocument: DocumentJobJoin = {
            id: typeof directDocument.id === 'string' ? directDocument.id : job.document_id,
            title: typeof directDocument.title === 'string' ? directDocument.title : null,
            filename: typeof directDocument.filename === 'string'
              ? directDocument.filename
              : (typeof directDocument.title === 'string' ? directDocument.title : job.document_id),
            file_path: typeof directDocument.file_path === 'string' ? directDocument.file_path : job.document_id,
            file_size: typeof directDocument.file_size === 'number' ? directDocument.file_size : 0,
            user_id: typeof directDocument.user_id === 'string' ? directDocument.user_id : job.user_id
          }
          
          // Continue processing with the directly fetched document
          logger.info('Continuing with direct document lookup workaround', {
            jobId: job.id,
            documentId: typeof directDocument.id === 'string' ? directDocument.id : job.document_id,
            component: 'cron-job'
          })
          
          // Replace the missing document in the job object
          job.documents = [workingDocument]
          document = workingDocument
        } else {
          throw new Error(`Document ${job.document_id} not found - possible data integrity issue`)
        }
      }

      if (!document) {
        throw new Error(`Document metadata unavailable for job ${job.id}`)
      }

      // Determine processing method if not already set
      let processingMethod = job.processing_method ?? null
      if (!processingMethod || processingMethod === 'sync') {
        // For already processing jobs, check if they have batch_operation_id to determine method
        if (job.status === 'processing' && job.batch_operation_id) {
          processingMethod = 'batch'
        } else {
          const shouldUseBatch = needsBatchProcessing(
            document.file_size,
            document.filename ?? document.title ?? 'document.pdf'
          )
          processingMethod = shouldUseBatch ? 'batch' : 'sync'
        }
        
        // Update job with determined processing method
        await supabase
          .from('document_jobs')
          .update({ processing_method: processingMethod })
          .eq('id', job.id)
      }

      logger.info('Processing method determined', {
        jobId: job.id,
        method: processingMethod,
        batchOperationId: job.batch_operation_id
      })

      // Handle synchronous processing (batch processing not implemented)
      logger.info('Starting synchronous processing', {
        jobId: job.id,
        documentId: job.document_id
      })

      // Check if document was cancelled before processing
      const { data: docCheck, error: docCheckError } = await supabase
        .from('documents')
        .select('status')
        .eq('id', job.document_id)
        .single()

      if (docCheckError) {
        logger.error('Failed to verify document status before processing', docCheckError, {
          jobId: job.id,
          documentId: job.document_id
        })
      }

      if (docCheck?.status === 'cancelled') {
        logger.info('Document cancelled before processing started', {
          jobId: job.id,
          documentId: job.document_id
        })

        // Mark job as cancelled
        await supabase
          .from('document_jobs')
          .update({
            status: 'cancelled',
            completed_at: new Date().toISOString()
          })
          .eq('id', job.id)

        return {
          message: 'Job cancelled before processing',
          jobId: job.id,
          documentId: job.document_id
        }
      }

      const processingStartedAt = Date.now()
      const result = await processDocument(job.document_id)

      // CRITICAL: Double-check document wasn't cancelled during processing
      const { data: finalCheck } = await supabase
        .from('documents')
        .select('status')
        .eq('id', job.document_id)
        .single()

      if (finalCheck?.status === 'cancelled') {
        logger.info('Document was cancelled during processing - not marking as completed', {
          jobId: job.id,
          documentId: job.document_id
        })

        // Mark job as cancelled
        await supabase
          .from('document_jobs')
          .update({
            status: 'cancelled',
            completed_at: new Date().toISOString()
          })
          .eq('id', job.id)

        return {
          message: 'Job cancelled during processing',
          jobId: job.id,
          documentId: job.document_id
        }
      }

      const processingTimeMs = Date.now() - processingStartedAt
      const summaryPayload = {
        ...(result.metrics || {}),
        processing_time_ms: processingTimeMs,
        completed_at: new Date().toISOString()
      }
      // Mark job as completed
      await supabase
        .from('document_jobs')
        .update({
          status: 'completed',
          completed_at: new Date().toISOString(),
          processing_time_ms: processingTimeMs,
          processing_method: 'sync',
          result_summary: summaryPayload
        })
        .eq('id', job.id)

      // CRITICAL FIX: Also update document status to completed
      await supabase
        .from('documents')
        .update({
          status: 'completed',
          updated_at: new Date().toISOString()
        })
        .eq('id', job.document_id)

      logger.info('Synchronous processing completed', {
        jobId: job.id,
        documentId: job.document_id
      })

      return {
        message: 'Synchronous processing completed',
        jobId: job.id,
        documentId: job.document_id
      }

    } catch (processingError) {
      logger.error('Processing error occurred', processingError as Error, { 
        jobId: job.id, 
        documentId: job.document_id 
      })
      
      // Check if we should retry or fail permanently
      const errorMessage = processingError instanceof Error ? processingError.message : 'Unknown error'
      const shouldRetry = job.attempts < job.max_attempts
      
      if (shouldRetry) {
        // Mark for retry
        await supabase
          .from('document_jobs')
          .update({ status: 'queued' })
          .eq('id', job.id)
        
        logger.warn('Job marked for retry', { 
          jobId: job.id, 
          documentId: job.document_id,
          attempt: job.attempts + 1,
          maxAttempts: job.max_attempts
        })
        
        return {
          message: 'Job failed, marked for retry',
          jobId: job.id,
          documentId: job.document_id,
          attempt: job.attempts + 1,
          maxAttempts: job.max_attempts
        }
      } else {
        // Mark as permanently failed
        await supabase
          .from('document_jobs')
          .update({ 
            status: 'failed',
            completed_at: new Date().toISOString(),
            error_message: errorMessage
          })
          .eq('id', job.id)
        
        logger.error('Job failed permanently', undefined, { 
          jobId: job.id, 
          documentId: job.document_id,
          attempts: job.attempts + 1
        })
        
        throw new Error(`Job failed permanently: ${errorMessage}`)
      }
    }

  } catch (error) {
    logger.error('Job processing error', error as Error, { 
      jobId: job.id, 
      documentId: job.document_id 
    })
    throw error
  }
}

export async function GET(request: NextRequest) {
  return withRequestContext({ 
    correlationId: generateCorrelationId(),
    path: '/api/cron/process-jobs',
    method: 'GET'
  }, async () => {
    let supabase: ServiceSupabase | null = null
    
    try {
      logger.info('Cron job started', { 
        component: 'cron-job',
        operation: 'process-jobs',
        path: '/api/cron/process-jobs'
      })

      // Verify this is called by Vercel Cron
      const authHeader = request.headers.get('authorization')
      if (authHeader !== `Bearer ${process.env['CRON_SECRET']}`) {
        logger.warn('Unauthorized cron job access attempt', { 
          hasAuthHeader: !!authHeader,
          component: 'cron-job' 
        })
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }

      // Create pooled service role client to bypass RLS
      supabase = await createServiceClient()

      // UNLIMITED PROCESSING - No concurrency limits for enterprise robustness
      const maxConcurrentDocs = process.env['UNLIMITED_PROCESSING'] === 'true' 
        ? Number.MAX_SAFE_INTEGER 
        : parseInt(process.env['MAX_CONCURRENT_DOCUMENTS'] || '1000')
      const largeDocThresholdMB = parseFloat(process.env['LARGE_DOCUMENT_THRESHOLD_MB'] || '5')
      
      const unlimitedMode = process.env['UNLIMITED_PROCESSING'] === 'true'
      logger.info('Checking for queued jobs', { 
        unlimitedMode,
        maxConcurrentDocs: unlimitedMode ? 'unlimited' : maxConcurrentDocs,
        largeDocThresholdMB,
        component: 'cron-job'
      })
      
      // Get currently processing jobs for monitoring (no limits in unlimited mode)
      const { data: processingJobs, error: processingError } = await supabase
        .from('document_jobs')
        .select('id, documents(file_size)')
        .eq('status', 'processing')
      
      if (processingError) {
        logger.error('Error checking processing jobs', processingError, { component: 'cron-job' })
      }
      
      const currentProcessing = processingJobs?.length || 0
      const availableSlots = unlimitedMode ? Number.MAX_SAFE_INTEGER : Math.max(0, maxConcurrentDocs - currentProcessing)
      
      logger.info('Current processing status', { 
        currentProcessing,
        maxConcurrent: unlimitedMode ? 'unlimited' : maxConcurrentDocs,
        availableSlots: unlimitedMode ? 'unlimited' : availableSlots,
        unlimitedMode,
        component: 'cron-job'
      })
    
    // UNLIMITED MODE: Never block processing
    if (!unlimitedMode && availableSlots === 0) {
      try {
        const { data: queuedPeek, error: queuedPeekError } = await supabase
          .from('document_jobs')
          .select('id')
          .eq('status', 'queued')
          .limit(1)

        if (queuedPeekError) {
          logger.warn('Failed to peek queued jobs before scheduling retry', {
            component: 'cron-job',
            error: queuedPeekError.message ?? queuedPeekError,
          })
        } else if (queuedPeek && queuedPeek.length > 0) {
          scheduleCronRetry(request.url, 'capacity-full')
        }
      } catch (peekError) {
        logger.warn('Unexpected error while checking queued jobs before scheduling retry', {
          component: 'cron-job',
          error: peekError instanceof Error ? peekError.message : String(peekError),
        })
      }

      logger.warn('All processing slots occupied, waiting for completion', {
        currentProcessing,
        maxConcurrent: maxConcurrentDocs,
        component: 'cron-job'
      })
      return NextResponse.json({ 
        message: 'All processing slots occupied',
        currentProcessing,
        maxConcurrent: maxConcurrentDocs,
        systemStatus: 'at-capacity'
      }, { status: 200 })
    }
    
    // Get jobs that need processing (queued) OR jobs that are processing with batch operations (to check completion)
    // CRITICAL FIX: Use inner join to ensure document exists
    // Paid tiers: raise MAX_CONCURRENT_DOCUMENTS (and matching pool limits) so availableSlots grows.
    const fetchLimit = unlimitedMode ? 1000 : Math.max(availableSlots, 1)
    const { data: jobs, error: jobsError } = await supabase
      .from('document_jobs')
      .select(`
        id,
        document_id,
        user_id,
        status,
        attempts,
        max_attempts,
        batch_operation_id,
        processing_method,
        started_at,
        result_summary,
        metadata,
        documents!inner (
          id,
          title,
          filename,
          file_path,
          file_size,
          user_id
        )
      `)
      .in('status', ['queued', 'processing'])
      .order('priority', { ascending: false })
      .order('created_at', { ascending: true })
      .limit(fetchLimit) // Limit fetches to the number of available slots (or 1000 in unlimited mode)
      .returns<DocumentJobRecord[]>()

    if (jobsError) {
      logger.error('Error fetching jobs with JOIN', jobsError, { component: 'cron-job' })
      
      // Fallback: Try to get jobs without JOIN to debug RLS issue
      const { data: fallbackJobs, error: fallbackError } = await supabase
        .from('document_jobs')
        .select('id, document_id, user_id, status')
        .in('status', ['queued', 'processing'])
        .limit(5)
      
      logger.warn('Fallback document job query results', {
        fallbackJobs: fallbackJobs?.length || 0,
        fallbackError: fallbackError?.message,
        sampleJob: fallbackJobs?.[0]
      })
      
      return NextResponse.json({ error: 'Failed to fetch jobs' }, { status: 500 })
    }

    if (!jobs || jobs.length === 0) {
      logger.info('No queued or processing jobs found', { component: 'cron-job' })
      
      // Enhanced queue monitoring for enterprise scale
      const { data: queueStats } = await supabase
        .from('document_jobs')
        .select('status, created_at')
        .order('created_at', { ascending: false })
        .limit(50)
        .returns<QueueStatRecord[]>()
      
      const stats = {
        total: queueStats?.length || 0,
        queued: queueStats?.filter((j: QueueStatRecord) => j.status === 'queued').length || 0,
        processing: queueStats?.filter((j: QueueStatRecord) => j.status === 'processing').length || 0,
        completed: queueStats?.filter((j: QueueStatRecord) => j.status === 'completed').length || 0,
        failed: queueStats?.filter((j: QueueStatRecord) => j.status === 'failed').length || 0,
        cancelled: queueStats?.filter((j: QueueStatRecord) => j.status === 'cancelled').length || 0
      }
      
      logger.info('Queue status snapshot', {
        stats,
        maxConcurrency: unlimitedMode ? 'unlimited' : maxConcurrentDocs,
        component: 'cron-job'
      })
      
      return NextResponse.json({ 
        message: 'No jobs to process',
        queueStats: stats,
        maxConcurrency: unlimitedMode ? 'unlimited' : maxConcurrentDocs,
        systemStatus: unlimitedMode ? 'unlimited-ready' : 'ready'
      }, { status: 200 })
    }

    logger.info('Jobs ready for processing', {
      jobCount: jobs.length,
      availableSlots: unlimitedMode ? 'unlimited' : availableSlots,
      unlimitedMode,
      component: 'cron-job'
    })
    if (!unlimitedMode) {
      logger.info('System capacity utilization', {
        processedPlusQueue: currentProcessing + jobs.length,
        maxConcurrent: maxConcurrentDocs,
        utilization: Math.round((currentProcessing + jobs.length) / maxConcurrentDocs * 100),
        component: 'cron-job'
      })
    } else {
      logger.info('Unlimited mode processing summary', {
        concurrentJobs: currentProcessing + jobs.length,
        component: 'cron-job'
      })
    }
    
    const processingStartTime = Date.now()
    
    if (!supabase) {
      throw new Error('Supabase client not initialized')
    }
    const client: ServiceSupabase = supabase

    // Increase MAX_CONCURRENT_DOCUMENTS when premium resources are available to process more jobs in parallel.
    const slotsToUse = unlimitedMode ? jobs.length : Math.min(jobs.length, Math.max(availableSlots, 1))
    const jobsToProcess = jobs.slice(0, slotsToUse)

    const results: Array<{ job: DocumentJobRecord; status: 'fulfilled' | 'rejected'; error?: unknown }> = []

    for (const job of jobsToProcess) {
      try {
        await processJob(client, job)
        results.push({ job, status: 'fulfilled' })
      } catch (error) {
        results.push({ job, status: 'rejected', error })
      }
    }
    
    const successful = results.filter(result => result.status === 'fulfilled').length
    const failed = results.length - successful
    const processingTime = Date.now() - processingStartTime
    const throughput = results.length === 0 || processingTime === 0
      ? 0
      : results.length / (processingTime / 1000)
    
    logger.info('Job processing batch complete', {
      totalJobs: results.length,
      successful,
      failed,
      processingTimeMs: processingTime,
      throughputJobsPerSec: parseFloat(throughput.toFixed(2)),
      component: 'cron-job'
    })
    if (!unlimitedMode) {
      logger.info('Capacity utilization after processing', {
        processedJobs: results.length,
        maxConcurrent: maxConcurrentDocs,
        utilization: Math.round(results.length / maxConcurrentDocs * 100),
        component: 'cron-job'
      })
    } else {
      logger.info('Unlimited mode batch throughput', {
        processedJobs: results.length,
        component: 'cron-job'
      })
    }

    try {
      const { data: remainingQueued, error: remainingError } = await supabase
        .from('document_jobs')
        .select('id')
        .eq('status', 'queued')
        .limit(1)

      if (remainingError) {
        logger.warn('Failed to check remaining queued jobs after processing batch', {
          component: 'cron-job',
          error: remainingError.message ?? remainingError,
        })
      } else if (remainingQueued && remainingQueued.length > 0) {
        scheduleCronRetry(request.url, 'jobs-remaining')
      }
    } catch (remainingCheckError) {
      logger.warn('Unexpected error while checking for remaining queued jobs', {
        component: 'cron-job',
        error: remainingCheckError instanceof Error ? remainingCheckError.message : String(remainingCheckError),
      })
    }
    
    return NextResponse.json({
      message: `Processed ${results.length} jobs`,
      summary: {
        total: results.length,
        successful,
        failed,
        processingTimeMs: processingTime,
        throughputJobsPerSec: parseFloat(throughput.toFixed(2)),
        capacityUtilization: unlimitedMode ? 'unlimited' : `${results.length}/${maxConcurrentDocs} (${Math.round(results.length/maxConcurrentDocs*100)}%)`,
        systemStatus: unlimitedMode ? 'unlimited-processing' : 'enterprise-ready',
        details: results.map((result) => {
          return {
            jobId: result.job.id,
            documentId: result.job.document_id,
            status: result.status,
            error: result.status === 'rejected'
              ? (result.error instanceof Error ? result.error.message : result.error)
              : null
          }
        })
      }
    })

  } catch (error) {
    logger.error('Cron job processing failed', error as Error, { component: 'cron-job' })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  } finally {
    // Always release the service client back to pool
    if (supabase) {
      releaseServiceClient(supabase)
    }
  }
  })
}


// Also support POST for manual triggering (optional)
export async function POST(request: NextRequest) {
  return GET(request)
}
