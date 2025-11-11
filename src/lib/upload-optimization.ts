import { analyzeDocumentSize, estimateProcessingTime, type DocumentSizeAnalysis } from '@/lib/document-size-strategies'
import { createServiceClient } from '@/lib/supabase/server'
import { processDocument } from '@/lib/document-processing'
import { logger } from '@/lib/logger'

export interface SimpleUploadTask {
  documentId: string
  userId: string
  filename: string
  fileSize: number
  filePath: string
  contentType?: string
  metadata?: Record<string, unknown>
  jobId?: string
  sizeAnalysis?: DocumentSizeAnalysis
}

interface JobUpdatePayload {
  status: 'queued' | 'processing' | 'completed' | 'error'
  attempts?: number
  started_at?: string
  completed_at?: string
  processing_time_ms?: number
  processing_method?: 'sync' | 'batch'
  processing_config?: Record<string, unknown>
  result_summary?: Record<string, unknown>
  error_details?: Record<string, unknown>
}

interface JobMetricsSummary extends Record<string, unknown> {
  switchedToBatch?: boolean
}

/**
 * Record a processing-status snapshot for the UI timeline.
 */
async function recordProcessingStatus(
  documentId: string,
  status: 'queued' | 'processing' | 'completed' | 'error',
  progress: number,
  message: string
): Promise<void> {
  const supabase = await createServiceClient()
  await supabase
    .from('processing_status')
    .insert({
      document_id: documentId,
      status,
      progress,
      message
    })
}

async function updateDocumentStatus(
  documentId: string,
  status: string,
  additionalFields?: Record<string, unknown>
): Promise<void> {
  const supabase = await createServiceClient()
  await supabase
    .from('documents')
    .update({
      status,
      updated_at: new Date().toISOString(),
      ...additionalFields
    })
    .eq('id', documentId)
}

function calculateJobPriority(fileSize: number): number {
  if (fileSize <= 2 * 1024 * 1024) return 7 // smaller docs first to keep queue responsive
  if (fileSize <= 10 * 1024 * 1024) return 5
  if (fileSize <= 25 * 1024 * 1024) return 4
  return 3
}

async function updateJob(jobId: string, payload: JobUpdatePayload): Promise<void> {
  const supabase = await createServiceClient()
  await supabase
    .from('document_jobs')
    .update({
      ...payload,
      updated_at: new Date().toISOString()
    })
    .eq('id', jobId)
}

async function markJobProcessing(jobId: string): Promise<number> {
  const supabase = await createServiceClient()
  const { data, error } = await supabase
    .from('document_jobs')
    .select('attempts')
    .eq('id', jobId)
    .single()

  if (error) {
    throw new Error(`Failed to read job attempts for ${jobId}: ${error.message}`)
  }

  const attemptsValue = data && typeof data.attempts === 'number' ? data.attempts : 0
  const attempts = attemptsValue + 1
  await updateJob(jobId, {
    status: 'processing',
    attempts,
    started_at: new Date().toISOString(),
    processing_method: 'sync'
  })

  return attempts
}

async function markJobCompleted(
  jobId: string,
  durationMs: number,
  summary: JobMetricsSummary
): Promise<void> {
  const supabase = await createServiceClient()
  const { data } = await supabase
    .from('document_jobs')
    .select('result_summary')
    .eq('id', jobId)
    .single()

  const existingSummary = (data?.result_summary as Record<string, unknown> | null) || {}
  await updateJob(jobId, {
    status: 'completed',
    completed_at: new Date().toISOString(),
    processing_time_ms: durationMs,
    processing_method: (summary.switchedToBatch ? 'batch' : 'sync') as 'sync' | 'batch',
    result_summary: {
      ...existingSummary,
      ...summary,
      processing_time_ms: durationMs,
      completed_at: new Date().toISOString()
    }
  })
}

async function markJobFailed(
  jobId: string,
  error: unknown,
  durationMs?: number
): Promise<void> {
  const message = error instanceof Error ? error.message : 'Unknown processing error'
  await updateJob(jobId, {
    status: 'error',
    completed_at: new Date().toISOString(),
    processing_time_ms: durationMs,
    error_details: {
      message,
      stack: error instanceof Error ? error.stack : undefined
    }
  })
}

export async function queueDocumentProcessingJob(task: SimpleUploadTask): Promise<{
  jobId?: string
  sizeAnalysis: DocumentSizeAnalysis
}> {
  const sizeAnalysis = task.sizeAnalysis ?? analyzeDocumentSize(
    task.fileSize,
    task.filename,
    task.contentType
  )
  const estimated = estimateProcessingTime(sizeAnalysis)

  const supabase = await createServiceClient()
  const baseJobPayload = {
    user_id: task.userId,
    document_id: task.documentId,
    status: 'queued',
    priority: calculateJobPriority(task.fileSize),
    processing_method: 'sync',
    processing_config: {
      tier: sizeAnalysis.tier,
      ...sizeAnalysis.processingConfig
    },
    result_summary: {
      filename: task.filename,
      file_size: task.fileSize,
      estimated_minutes: estimated.estimatedMinutes,
      estimated_seconds: estimated.estimatedMinutes * 60,
      tier: sizeAnalysis.tier
    }
  }

  // Insert job into queue
  const { data, error: insertError } = await supabase
    .from('document_jobs')
    .insert(baseJobPayload)
    .select('id')
    .single()

  if (insertError) {
    logger.error('Failed to queue document processing job', insertError, {
      documentId: task.documentId,
      userId: task.userId,
      errorMessage: insertError.message
    })
    throw new Error(`Failed to queue document job: ${insertError.message}`)
  }

  const jobId = data && typeof data.id === 'string' ? data.id : undefined

  await updateDocumentStatus(task.documentId, 'queued')
  await recordProcessingStatus(task.documentId, 'queued', 10, 'Document queued for processing')

  return { jobId, sizeAnalysis }
}

export async function processUploadedDocument(task: SimpleUploadTask): Promise<void> {
  logger.info('Processing document', { documentId: task.documentId, jobId: task.jobId })

  const jobId = task.jobId
  const sizeAnalysis = task.sizeAnalysis ?? analyzeDocumentSize(
    task.fileSize,
    task.filename,
    task.contentType
  )

  const processingStart = Date.now()

  try {
    if (task.fileSize > 50 * 1024 * 1024) {
      throw new Error('File size exceeds 50MB limit')
    }

    if (!task.filename.toLowerCase().endsWith('.pdf')) {
      throw new Error('Only PDF files are supported')
    }

    if (jobId) {
      try {
        await markJobProcessing(jobId)
      } catch (jobError) {
        logger.error('Failed to mark job as processing', jobError as Error, { jobId })
      }
    }

    await updateDocumentStatus(task.documentId, 'processing')

    const result = await processDocument(task.documentId)

    await updateDocumentStatus(task.documentId, 'completed')

    if (jobId) {
      const duration = Date.now() - processingStart
      try {
        const metricsPayload = result.metrics ? { ...result.metrics } : {}
        await markJobCompleted(jobId, duration, {
          ...metricsPayload,
          switchedToBatch: !!result.switchedToBatch,
          tier: sizeAnalysis.tier
        })
      } catch (jobError) {
        logger.error('Failed to mark job as completed', jobError as Error, { jobId })
      }
    }

    logger.info('Document processed successfully', { documentId: task.documentId })
  } catch (error) {
    logger.error('Document processing failed', error as Error, { documentId: task.documentId })

    await updateDocumentStatus(task.documentId, 'error', {
      processing_error: error instanceof Error ? error.message : 'Unknown error'
    }).catch((err) => logger.error('Failed to update document status after error', err as Error, { documentId: task.documentId }))

    if (jobId) {
      try {
        const duration = Math.max(Date.now() - processingStart, 0)
        await markJobFailed(jobId, error, duration)
      } catch (jobError) {
        logger.error('Failed to mark job as failed', jobError as Error, { jobId })
      }
    }

    throw error
  }
}
