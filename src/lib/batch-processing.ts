/**
 * Batch Processing Module
 * Handles batch document processing and queue management
 */

import { createServiceClient } from '@/lib/supabase/server'
import { logger } from '@/lib/logger'

export interface BatchProcessingOptions {
  maxConcurrent?: number
  timeoutMs?: number
  retryAttempts?: number
}

export interface QueuedJob {
  id: string
  document_id: string
  status: 'queued' | 'processing' | 'completed' | 'failed'
  created_at: string
  attempts?: number
  error?: string
}

export interface BatchProcessingResult {
  processedCount: number
  failedCount: number
  totalCount: number
  duration: number
  errors: string[]
}

/**
 * Process queued documents in batch
 */
export async function processQueuedDocuments(
  options: BatchProcessingOptions = {}
): Promise<BatchProcessingResult> {
  const startTime = Date.now()
  const {
    maxConcurrent = process.env['UNLIMITED_PROCESSING'] === 'true' 
      ? Number.MAX_SAFE_INTEGER 
      : parseInt(process.env['MAX_CONCURRENT_DOCUMENTS'] || '5'),
    timeoutMs = 300000, // 5 minutes
    retryAttempts = 3
  } = options

  logger.info('Starting batch document processing', {
    maxConcurrent,
    timeoutMs,
    retryAttempts
  })

  const supabase = await createServiceClient()
  const errors: string[] = []
  let processedCount = 0
  let failedCount = 0

  try {
    // Get queued documents
    const { data: queuedJobs, error } = await supabase
      .from('document_processing_queue')
      .select('*')
      .eq('status', 'queued')
      .order('created_at', { ascending: true })

    if (error) {
      throw new Error(`Failed to fetch queued documents: ${error.message}`)
    }

    if (!queuedJobs || queuedJobs.length === 0) {
      logger.info('No queued documents found')
      return {
        processedCount: 0,
        failedCount: 0,
        totalCount: 0,
        duration: Date.now() - startTime,
        errors: []
      }
    }

    logger.info(`Found ${queuedJobs.length} queued documents`)

    // Process in batches
    const batches = []
    for (let i = 0; i < queuedJobs.length; i += maxConcurrent) {
      batches.push(queuedJobs.slice(i, i + maxConcurrent))
    }

    for (const batch of batches) {
      const batchPromises = batch.map(async (job: QueuedJob) => {
        try {
          await processDocumentJob(job, timeoutMs, retryAttempts)
          processedCount++
        } catch (error) {
          failedCount++
          const errorMessage = error instanceof Error ? error.message : String(error)
          errors.push(`Job ${job.id}: ${errorMessage}`)
          logger.error('Job processing failed', error instanceof Error ? error : new Error(errorMessage), { 
            jobId: job.id, 
            documentId: job.document_id
          })
        }
      })

      await Promise.allSettled(batchPromises)
    }

    const duration = Date.now() - startTime
    logger.info('Batch processing completed', {
      processedCount,
      failedCount,
      totalCount: queuedJobs.length,
      duration,
      errorCount: errors.length
    })

    return {
      processedCount,
      failedCount,
      totalCount: queuedJobs.length,
      duration,
      errors
    }

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    logger.error('Batch processing failed', error instanceof Error ? error : new Error(errorMessage))
    throw error
  }
}

/**
 * Process a single document job
 */
async function processDocumentJob(
  job: QueuedJob, 
  timeoutMs: number, 
  retryAttempts: number
): Promise<void> {
  const supabase = await createServiceClient()

  // Mark job as processing
  await supabase
    .from('document_processing_queue')
    .update({ status: 'processing', updated_at: new Date().toISOString() })
    .eq('id', job.id)

  let lastError: Error | null = null

  for (let attempt = 1; attempt <= retryAttempts; attempt++) {
    try {
      // Import processDocument dynamically to avoid circular dependencies
      const { processDocument } = await import('@/lib/document-processing')
      
      // Process the document with timeout
      await Promise.race([
        processDocument(job.document_id),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Processing timeout')), timeoutMs)
        )
      ])

      // Mark job as completed
      await supabase
        .from('document_processing_queue')
        .update({ 
          status: 'completed', 
          updated_at: new Date().toISOString() 
        })
        .eq('id', job.id)

      logger.info('Document job completed successfully', {
        jobId: job.id,
        documentId: job.document_id,
        attempt
      })

      return // Success, exit retry loop

    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))
      logger.warn('Document job attempt failed', {
        jobId: job.id,
        documentId: job.document_id,
        attempt,
        error: lastError.message
      })

      if (attempt < retryAttempts) {
        // Wait before retry (exponential backoff)
        await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000))
      }
    }
  }

  // All attempts failed
  await supabase
    .from('document_processing_queue')
    .update({ 
      status: 'failed', 
      error: lastError?.message,
      attempts: retryAttempts,
      updated_at: new Date().toISOString() 
    })
    .eq('id', job.id)

  throw lastError || new Error('Document processing failed after all retry attempts')
}

/**
 * Add document to processing queue
 */
export async function queueDocumentForProcessing(
  documentId: string,
  priority: number = 0
): Promise<QueuedJob> {
  const supabase = await createServiceClient()

  const jobData = {
    document_id: documentId,
    status: 'queued' as const,
    priority,
    created_at: new Date().toISOString(),
    attempts: 0
  }

  const { data, error } = await supabase
    .from('document_processing_queue')
    .insert(jobData)
    .select()
    .single()

  if (error) {
    throw new Error(`Failed to queue document: ${error.message}`)
  }

  logger.info('Document queued for processing', { 
    documentId, 
    jobId: data.id,
    priority 
  })

  return data
}

/**
 * Get batch processing statistics
 */
export async function getBatchProcessingStats(): Promise<{
  queuedCount: number
  processingCount: number
  completedCount: number
  failedCount: number
  totalCount: number
}> {
  const supabase = await createServiceClient()

  const { data, error } = await supabase
    .from('document_processing_queue')
    .select('status')

  if (error) {
    throw new Error(`Failed to get batch stats: ${error.message}`)
  }

  const stats = {
    queuedCount: 0,
    processingCount: 0,
    completedCount: 0,
    failedCount: 0,
    totalCount: data?.length || 0
  }

  data?.forEach(job => {
    switch (job.status) {
      case 'queued':
        stats.queuedCount++
        break
      case 'processing':
        stats.processingCount++
        break
      case 'completed':
        stats.completedCount++
        break
      case 'failed':
        stats.failedCount++
        break
    }
  })

  return stats
}

/**
 * Clean up old completed/failed jobs
 */
export async function cleanupOldJobs(olderThanDays: number = 7): Promise<number> {
  const supabase = await createServiceClient()
  const cutoffDate = new Date()
  cutoffDate.setDate(cutoffDate.getDate() - olderThanDays)

  const { data, error } = await supabase
    .from('document_processing_queue')
    .delete()
    .in('status', ['completed', 'failed'])
    .lt('updated_at', cutoffDate.toISOString())
    .select('id')

  if (error) {
    throw new Error(`Failed to cleanup old jobs: ${error.message}`)
  }

  const cleanedCount = data?.length || 0
  logger.info('Cleaned up old batch processing jobs', { 
    cleanedCount, 
    olderThanDays 
  })

  return cleanedCount
}