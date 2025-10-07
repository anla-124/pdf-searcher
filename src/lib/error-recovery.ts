/**
 * Error recovery and resilience utilities for batch processing
 */

interface RecoveryOptions {
  maxRetries?: number
  backoffMs?: number
  recoveryStrategies?: string[]
}

interface RecoveryResult<T> {
  success: boolean
  result?: T
  error?: Error
  recoveryApplied?: string
  attempts: number
}

export async function processWithRecovery<T>(
  operation: () => Promise<T>,
  options: RecoveryOptions = {}
): Promise<RecoveryResult<T>> {
  const { maxRetries = 3, backoffMs = 1000 } = options
  let lastError: Error | null = null
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const result = await operation()
      return {
        success: true,
        result,
        attempts: attempt
      }
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))
      
      if (attempt < maxRetries) {
        // Apply recovery strategies
        await new Promise(resolve => setTimeout(resolve, backoffMs * attempt))
      }
    }
  }

  return {
    success: false,
    error: lastError || new Error('Unknown error during recovery'),
    attempts: maxRetries
  }
}

export async function recoverFromError(
  error: Error,
  context: any = {}
): Promise<{ recovered: boolean; strategy?: string }> {
  // Basic error recovery strategies
  if (error.message.includes('timeout')) {
    return { recovered: true, strategy: 'timeout-retry' }
  }
  
  if (error.message.includes('network')) {
    return { recovered: true, strategy: 'network-retry' }
  }
  
  return { recovered: false }
}

export const ErrorRecoveryStrategies = {
  RETRY: 'retry',
  FALLBACK: 'fallback',
  CIRCUIT_BREAK: 'circuit-break',
  GRACEFUL_DEGRADATION: 'graceful-degradation'
} as const