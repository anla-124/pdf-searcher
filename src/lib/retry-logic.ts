interface RetryOptions {
  maxAttempts: number
  baseDelay: number
  maxDelay: number
  backoffFactor: number
  retryableErrors: (error: any) => boolean
  onRetry?: (attempt: number, error: any) => void
}

interface RetryResult<T> {
  success: boolean
  result?: T
  error?: Error
  attempts: number
  totalTime: number
}

export class SmartRetry {
  private static defaultOptions: RetryOptions = {
    maxAttempts: 3,
    baseDelay: 1000, // 1 second
    maxDelay: 30000, // 30 seconds
    backoffFactor: 2,
    retryableErrors: (error: any) => {
      // Enhanced retryable conditions for enterprise scale
      if (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT') return true
      if (error.code === 'ENOTFOUND' || error.code === 'EAI_AGAIN') return true
      if (error.message?.includes('timeout')) return true
      if (error.message?.includes('network')) return true
      if (error.message?.includes('connection')) return true
      if (error.message?.includes('quota')) return true
      if (error.message?.includes('rate limit')) return true
      if (error.status >= 500 && error.status < 600) return true // Server errors
      if (error.status === 429) return true // Rate limiting
      if (error.status === 503) return true // Service unavailable
      if (error.status === 502) return true // Bad gateway
      if (error.status === 504) return true // Gateway timeout
      return false
    }
  }

  // Enterprise-scale configurations for different services
  private static enterpriseConfigs = {
    vertexAI: {
      maxAttempts: 5,
      baseDelay: 2000,
      maxDelay: 60000,
      backoffFactor: 2.5,
      retryableErrors: (error: any) => {
        return error.status === 429 || error.status >= 500 || 
               error.message?.includes('quota') || 
               error.message?.includes('rate')
      }
    },
    pinecone: {
      maxAttempts: 4,
      baseDelay: 1500,
      maxDelay: 45000,
      backoffFactor: 2,
      retryableErrors: (error: any) => {
        return error.status === 429 || error.status >= 500 ||
               error.message?.includes('timeout')
      }
    },
    documentAI: {
      maxAttempts: 3,
      baseDelay: 3000,
      maxDelay: 90000,
      backoffFactor: 3,
      retryableErrors: (error: any) => {
        return error.status === 429 || error.status >= 500 ||
               error.message?.includes('quota') ||
               error.message?.includes('limit')
      }
    }
  }

  // Helper methods for enterprise service configurations
  static async executeWithVertexAI<T>(operation: () => Promise<T>): Promise<RetryResult<T>> {
    console.warn('🤖 Using enterprise Vertex AI retry configuration')
    return this.execute(operation, this.enterpriseConfigs.vertexAI)
  }

  static async executeWithPinecone<T>(operation: () => Promise<T>): Promise<RetryResult<T>> {
    console.warn('📌 Using enterprise Pinecone retry configuration')
    return this.execute(operation, this.enterpriseConfigs.pinecone)
  }

  static async executeWithDocumentAI<T>(operation: () => Promise<T>): Promise<RetryResult<T>> {
    console.warn('📄 Using enterprise Document AI retry configuration')
    return this.execute(operation, this.enterpriseConfigs.documentAI)
  }

  static async execute<T>(
    operation: () => Promise<T>,
    options: Partial<RetryOptions> = {}
  ): Promise<RetryResult<T>> {
    const config = { ...this.defaultOptions, ...options }
    const startTime = Date.now()
    
    let lastError: Error | null = null
    
    for (let attempt = 1; attempt <= config.maxAttempts; attempt++) {
      try {
        const result = await operation()
        return {
          success: true,
          result,
          attempts: attempt,
          totalTime: Date.now() - startTime
        }
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error))
        
        // Check if this error is retryable
        if (!config.retryableErrors(error)) {
          console.error(`❌ Non-retryable error on attempt ${attempt}:`, lastError.message)
          break
        }
        
        // Don't retry on last attempt
        if (attempt === config.maxAttempts) {
          console.error(`❌ Max attempts (${config.maxAttempts}) reached`)
          break
        }
        
        // Calculate delay with exponential backoff
        const delay = Math.min(
          config.baseDelay * Math.pow(config.backoffFactor, attempt - 1),
          config.maxDelay
        )
        
        console.warn(`🔄 Retry attempt ${attempt}/${config.maxAttempts} in ${delay}ms. Error:`, lastError.message)
        
        // Call retry callback if provided
        config.onRetry?.(attempt, error)
        
        // Wait before retry
        await new Promise(resolve => setTimeout(resolve, delay))
      }
    }
    
    return {
      success: false,
      error: lastError || new Error('Unknown error'),
      attempts: config.maxAttempts,
      totalTime: Date.now() - startTime
    }
  }
}

// Specialized retry configurations for different operations
export const RetryConfigs = {
  // Document AI processing - handle API rate limits and temporary failures
  documentAI: {
    maxAttempts: 5,
    baseDelay: 2000,
    maxDelay: 60000,
    backoffFactor: 2.5,
    retryableErrors: (error: any) => {
      if (error.code === 3 && error.details?.includes('rate limit')) return true
      if (error.code === 14) return true // Unavailable
      if (error.code === 4) return true // Deadline exceeded
      if (error.message?.includes('timeout')) return true
      if (error.message?.includes('UNAVAILABLE')) return true
      return false
    },
    onRetry: (attempt: number, error: any) => {
      console.warn(`🔄 Document AI retry ${attempt}: ${error.message}`)
    }
  },

  // Vertex AI embeddings - handle quota and API limits
  vertexEmbeddings: {
    maxAttempts: 4,
    baseDelay: 3000,
    maxDelay: 45000,
    backoffFactor: 2,
    retryableErrors: (error: any) => {
      if (error.status === 429) return true // Rate limit
      if (error.status === 503) return true // Service unavailable
      if (error.status === 502) return true // Bad gateway
      if (error.message?.includes('quota')) return true
      if (error.message?.includes('RATE_LIMIT_EXCEEDED')) return true
      return false
    },
    onRetry: (attempt: number, error: any) => {
      console.warn(`🔄 Vertex AI embeddings retry ${attempt}: ${error.message}`)
    }
  },

  // Pinecone indexing - handle vector database issues
  pineconeIndexing: {
    maxAttempts: 3,
    baseDelay: 1500,
    maxDelay: 20000,
    backoffFactor: 2,
    retryableErrors: (error: any) => {
      if (error.status >= 500) return true
      if (error.message?.includes('timeout')) return true
      if (error.message?.includes('connection')) return true
      if (error.message?.includes('temporary')) return true
      return false
    },
    onRetry: (attempt: number, error: any) => {
      console.warn(`🔄 Pinecone indexing retry ${attempt}: ${error.message}`)
    }
  },

  // Supabase operations - handle database connectivity issues
  supabaseOperations: {
    maxAttempts: 3,
    baseDelay: 1000,
    maxDelay: 15000,
    backoffFactor: 2,
    retryableErrors: (error: any) => {
      if (error.code === 'PGRST301') return true // Connection error
      if (error.message?.includes('timeout')) return true
      if (error.message?.includes('connection')) return true
      if (error.status >= 500) return true
      return false
    },
    onRetry: (attempt: number, error: any) => {
      console.warn(`🔄 Supabase operation retry ${attempt}: ${error.message}`)
    }
  },

  // File upload operations - handle network and storage issues
  fileUpload: {
    maxAttempts: 3,
    baseDelay: 2000,
    maxDelay: 30000,
    backoffFactor: 2,
    retryableErrors: (error: any) => {
      if (error.status >= 500) return true
      if (error.message?.includes('network')) return true
      if (error.message?.includes('timeout')) return true
      if (error.message?.includes('connection')) return true
      return false
    },
    onRetry: (attempt: number, error: any) => {
      console.warn(`🔄 File upload retry ${attempt}: ${error.message}`)
    }
  }
}

// Circuit breaker for protecting against cascading failures
export class CircuitBreaker {
  private failures = 0
  private lastFailTime = 0
  private state: 'closed' | 'open' | 'half-open' = 'closed'
  
  constructor(
    private maxFailures: number = 5,
    private timeoutMs: number = 60000 // 1 minute
  ) {}
  
  async execute<T>(operation: () => Promise<T>): Promise<T> {
    if (this.state === 'open') {
      if (Date.now() - this.lastFailTime > this.timeoutMs) {
        this.state = 'half-open'
        console.warn('🔄 Circuit breaker half-open, testing...')
      } else {
        throw new Error('Circuit breaker is open - operation blocked')
      }
    }
    
    try {
      const result = await operation()
      
      if (this.state === 'half-open') {
        this.state = 'closed'
        this.failures = 0
        console.warn('✅ Circuit breaker closed - service recovered')
      }
      
      return result
    } catch (error) {
      this.failures++
      this.lastFailTime = Date.now()
      
      if (this.failures >= this.maxFailures) {
        this.state = 'open'
        console.warn(`🚨 Circuit breaker opened after ${this.failures} failures`)
      }
      
      throw error
    }
  }
  
  getState() {
    return {
      state: this.state,
      failures: this.failures,
      lastFailTime: this.lastFailTime
    }
  }
  
  reset() {
    this.state = 'closed'
    this.failures = 0
    this.lastFailTime = 0
    console.warn('🔄 Circuit breaker manually reset')
  }
}

// Global circuit breakers for different services
export const circuitBreakers = {
  documentAI: new CircuitBreaker(3, 120000), // 2 minutes
  vertexAI: new CircuitBreaker(5, 60000), // 1 minute
  pinecone: new CircuitBreaker(3, 90000), // 1.5 minutes
}