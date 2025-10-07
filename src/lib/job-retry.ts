/**
 * Job Retry Management Module
 * Handles retry logic for failed jobs with exponential backoff
 */

import { createServiceClient } from '@/lib/supabase/server'
import { logger } from '@/lib/logger'
import { updateJobStatus, getJobStatus } from '@/lib/job-status'

export interface RetryConfig {
  maxAttempts: number
  initialDelayMs: number
  maxDelayMs: number
  backoffMultiplier: number
}

export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxAttempts: 3,
  initialDelayMs: 1000, // 1 second
  maxDelayMs: 30000,    // 30 seconds
  backoffMultiplier: 2
}

/**
 * Retry a failed job with exponential backoff
 */
export async function retryFailedJob(
  jobId: string,
  config: RetryConfig = DEFAULT_RETRY_CONFIG
): Promise<void> {
  try {
    logger.info('Starting job retry', { jobId, config })

    // Get current job status
    const currentStatus = await getJobStatus(jobId)
    if (!currentStatus) {
      throw new Error(`Job ${jobId} not found`)
    }

    if (currentStatus.status !== 'failed') {
      throw new Error(`Job ${jobId} is not in failed state (current: ${currentStatus.status})`)
    }

    // Check if we've exceeded max attempts
    const currentAttempts = (currentStatus as any).attempts || 1
    if (currentAttempts >= config.maxAttempts) {
      logger.warn('Job has exceeded max retry attempts', {
        jobId,
        currentAttempts,
        maxAttempts: config.maxAttempts
      })
      throw new Error(`Job ${jobId} has exceeded maximum retry attempts (${config.maxAttempts})`)
    }

    // Calculate delay with exponential backoff
    const delay = Math.min(
      config.initialDelayMs * Math.pow(config.backoffMultiplier, currentAttempts - 1),
      config.maxDelayMs
    )

    logger.info('Applying retry delay', { jobId, delay, attempt: currentAttempts + 1 })
    
    // Wait for the calculated delay
    await new Promise(resolve => setTimeout(resolve, delay))

    // Reset job to queued status for retry
    await updateJobStatus(jobId, 'queued', {
      message: `Retry attempt ${currentAttempts + 1}/${config.maxAttempts}`
    })

    logger.info('Job queued for retry', {
      jobId,
      attempt: currentAttempts + 1,
      maxAttempts: config.maxAttempts
    })

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    logger.error('Failed to retry job', error instanceof Error ? error : new Error(errorMessage), {
      jobId
    })
    throw error
  }
}

/**
 * Retry multiple failed jobs in batch
 */
export async function retryFailedJobs(
  jobIds: string[],
  config: RetryConfig = DEFAULT_RETRY_CONFIG
): Promise<{ successful: string[]; failed: { jobId: string; error: string }[] }> {
  const successful: string[] = []
  const failed: { jobId: string; error: string }[] = []

  logger.info('Starting batch job retry', { jobCount: jobIds.length, config })

  for (const jobId of jobIds) {
    try {
      await retryFailedJob(jobId, config)
      successful.push(jobId)
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      failed.push({ jobId, error: errorMessage })
    }
  }

  logger.info('Batch job retry completed', {
    total: jobIds.length,
    successful: successful.length,
    failed: failed.length
  })

  return { successful, failed }
}

/**
 * Get all failed jobs that are eligible for retry
 */
export async function getRetryableFailedJobs(
  maxAttempts: number = DEFAULT_RETRY_CONFIG.maxAttempts
): Promise<Array<{ id: string; attempts: number; error: string }>> {
  try {
    const supabase = await createServiceClient()
    
    const { data, error } = await supabase
      .from('document_processing_queue')
      .select('id, attempts, error')
      .eq('status', 'failed')
      .lt('attempts', maxAttempts)
      .order('updated_at', { ascending: true })

    if (error) {
      throw new Error(`Failed to get retryable jobs: ${error.message}`)
    }

    return data || []

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    logger.error('Failed to get retryable failed jobs', error instanceof Error ? error : new Error(errorMessage))
    throw error
  }
}

/**
 * Auto-retry failed jobs based on configuration
 */
export async function autoRetryFailedJobs(
  config: RetryConfig = DEFAULT_RETRY_CONFIG
): Promise<{ processed: number; successful: number; failed: number }> {
  try {
    logger.info('Starting auto-retry of failed jobs')

    const retryableJobs = await getRetryableFailedJobs(config.maxAttempts)
    
    if (retryableJobs.length === 0) {
      logger.info('No failed jobs found for retry')
      return { processed: 0, successful: 0, failed: 0 }
    }

    const jobIds = retryableJobs.map(job => job.id)
    const result = await retryFailedJobs(jobIds, config)

    return {
      processed: retryableJobs.length,
      successful: result.successful.length,
      failed: result.failed.length
    }

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    logger.error('Auto-retry failed jobs error', error instanceof Error ? error : new Error(errorMessage))
    throw error
  }
}