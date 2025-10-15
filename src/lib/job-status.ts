/**
 * Job Status Management Module
 * Handles job status updates and tracking
 */

import { createServiceClient } from '@/lib/supabase/server'
import { logger } from '@/lib/logger'

export type JobStatus = 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled'

export interface JobStatusUpdate {
  status: JobStatus
  progress?: number
  message?: string
  error?: string
  updated_at?: string
  attempts?: number
}

/**
 * Update job status in the database
 */
export async function updateJobStatus(
  jobId: string, 
  status: JobStatus,
  additionalData?: Partial<JobStatusUpdate>
): Promise<void> {
  try {
    const supabase = await createServiceClient()
    
    const updateData: Record<string, unknown> = {
      status,
      updated_at: new Date().toISOString()
    }

    if (additionalData) {
      if (typeof additionalData.progress === 'number') {
        updateData.progress = additionalData.progress
      }
      if (typeof additionalData.message === 'string') {
        updateData.message = additionalData.message
      }
      if (typeof additionalData.error === 'string') {
        updateData.error = additionalData.error
      }
      if (typeof additionalData.attempts === 'number') {
        updateData.attempts = additionalData.attempts
      }
    }

    const { error } = await supabase
      .from('document_processing_queue')
      .update(updateData)
      .eq('id', jobId)

    if (error) {
      throw new Error(`Failed to update job status: ${error.message}`)
    }

    logger.info('Job status updated successfully', {
      jobId,
      status,
      ...additionalData
    })

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    logger.error('Failed to update job status', error instanceof Error ? error : new Error(errorMessage), {
      jobId,
      status
    })
    throw error
  }
}

/**
 * Get current job status
 */
export async function getJobStatus(jobId: string): Promise<JobStatusUpdate | null> {
  try {
    const supabase = await createServiceClient()
    
    const { data, error } = await supabase
      .from('document_processing_queue')
      .select('status, progress, message, error, updated_at, attempts')
      .eq('id', jobId)
      .single()

    if (error) {
      if (error.code === 'PGRST116') {
        return null // Job not found
      }
      throw new Error(`Failed to get job status: ${error.message}`)
    }

    return {
      status: typeof data.status === 'string' ? data.status as JobStatus : 'queued',
      progress: typeof data.progress === 'number' ? data.progress : undefined,
      message: typeof data.message === 'string' ? data.message : undefined,
      error: typeof data.error === 'string' ? data.error : undefined,
      updated_at: typeof data.updated_at === 'string' ? data.updated_at : new Date().toISOString(),
      attempts: typeof data.attempts === 'number' ? data.attempts : undefined
    }

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    logger.error('Failed to get job status', error instanceof Error ? error : new Error(errorMessage), {
      jobId
    })
    throw error
  }
}

/**
 * Mark job as completed with optional result data
 */
export async function markJobCompleted(
  jobId: string, 
  message?: string
): Promise<void> {
  await updateJobStatus(jobId, 'completed', {
    progress: 100,
    message: message || 'Job completed successfully'
  })
}

/**
 * Mark job as failed with error information
 */
export async function markJobFailed(
  jobId: string, 
  error: string,
  attempts?: number
): Promise<void> {
  await updateJobStatus(jobId, 'failed', {
    error,
    message: `Job failed after ${attempts || 1} attempts`,
    ...(typeof attempts === 'number' ? { attempts } : {})
  })
}

/**
 * Update job progress
 */
export async function updateJobProgress(
  jobId: string,
  progress: number,
  message?: string
): Promise<void> {
  const updateData: Partial<JobStatusUpdate> & { progress: number } = {
    progress: Math.max(0, Math.min(100, progress)) // Clamp between 0-100
  }
  if (message) updateData.message = message
  await updateJobStatus(jobId, 'processing', updateData)
}
