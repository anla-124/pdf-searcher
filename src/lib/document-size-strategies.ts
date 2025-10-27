/**
 * ENTERPRISE PHASE 1.3: Intelligent Document Size-Based Processing Strategies
 * 
 * This module implements optimized processing strategies based on document characteristics:
 * - Size-aware batching and concurrency control
 * - Memory optimization for different document sizes
 * - Processing timeout strategies
 * - Resource allocation optimization
 * - Chunking strategy selection
 */

import { logger } from '@/lib/logger'

// Document size classifications with processing characteristics
export const DOCUMENT_SIZE_TIERS = {
  MICRO: {
    name: 'Micro',
    maxSizeBytes: 1024 * 1024 * 2, // 2MB
    maxPages: 5,
    strategy: 'fast-track',
    description: 'Small documents for instant processing'
  },
  SMALL: {
    name: 'Small', 
    maxSizeBytes: 1024 * 1024 * 10, // 10MB
    maxPages: 15,
    strategy: 'standard',
    description: 'Standard documents with normal processing'
  },
  MEDIUM: {
    name: 'Medium',
    maxSizeBytes: 1024 * 1024 * 25, // 25MB
    maxPages: 50,
    strategy: 'optimized',
    description: 'Medium documents with optimized processing'
  },
  LARGE: {
    name: 'Large',
    maxSizeBytes: 1024 * 1024 * 50, // 50MB
    maxPages: 100,
    strategy: 'batch-optimized',
    description: 'Large documents requiring batch processing'
  },
  ENTERPRISE: {
    name: 'Enterprise',
    maxSizeBytes: 1024 * 1024 * 100, // 100MB
    maxPages: 200,
    strategy: 'enterprise-batch',
    description: 'Enterprise documents with specialized handling'
  },
  MASSIVE: {
    name: 'Massive',
    maxSizeBytes: Infinity, // No upper limit
    maxPages: Infinity,
    strategy: 'streaming-batch',
    description: 'Massive documents with streaming optimization'
  }
} as const

export type DocumentSizeTier = keyof typeof DOCUMENT_SIZE_TIERS
export type ProcessingStrategy = 'fast-track' | 'standard' | 'optimized' | 'batch-optimized' | 'enterprise-batch' | 'streaming-batch'

export interface DocumentSizeAnalysis {
  tier: DocumentSizeTier
  sizeBytes: number
  sizeMB: number
  estimatedPages: number
  strategy: ProcessingStrategy
  processingConfig: ProcessingConfiguration
  memoryRequirements: MemoryRequirements
  timeoutConfig: TimeoutConfiguration
}

export interface ProcessingConfiguration {
  batchSize: number
  maxConcurrency: number
  delayBetweenBatches: number
  chunkingStrategy: 'standard' | 'memory-optimized' | 'streaming'
  enablePrefetching: boolean
  useAsyncProcessing: boolean
  priorityLevel: 'low' | 'normal' | 'high' | 'critical'
}

export interface MemoryRequirements {
  estimatedMemoryMB: number
  enableMemoryOptimization: boolean
  useStreamingChunks: boolean
  garbageCollectionHints: boolean
  memoryBuffer: number // Additional memory buffer percentage
}

export interface TimeoutConfiguration {
  processingTimeoutMinutes: number
  chunkTimeoutSeconds: number
  retryTimeoutSeconds: number
  maxRetryAttempts: number
  enableCircuitBreaker: boolean
}

/**
 * Analyze document characteristics and determine optimal processing strategy
 */
export function analyzeDocumentSize(
  sizeBytes: number, 
  filename: string, 
  mimeType?: string,
  estimatedPageCount?: number
): DocumentSizeAnalysis {
  const sizeMB = sizeBytes / (1024 * 1024)
  
  // Estimate page count if not provided
  const estimatedPages = estimatedPageCount || estimatePageCount(sizeBytes, mimeType)
  
  // Determine size tier based on both file size and estimated pages
  const tier = determineDocumentTier(sizeBytes, estimatedPages)
  const tierConfig = DOCUMENT_SIZE_TIERS[tier]
  
  // Generate optimized processing configuration
  const processingConfig = generateProcessingConfig(tier, sizeBytes, estimatedPages)
  const memoryRequirements = calculateMemoryRequirements(tier, sizeBytes, estimatedPages)
  const timeoutConfig = generateTimeoutConfig(tier, sizeBytes, estimatedPages)
  
  logger.info('Document size analysis completed', {
    filename,
    tier: tierConfig.name,
    sizeBytes,
    sizeMB: Math.round(sizeMB * 100) / 100,
    estimatedPages,
    strategy: tierConfig.strategy,
    batchSize: processingConfig.batchSize,
    maxConcurrency: processingConfig.maxConcurrency,
    component: 'document-size-strategies'
  })
  
  return {
    tier,
    sizeBytes,
    sizeMB,
    estimatedPages,
    strategy: tierConfig.strategy,
    processingConfig,
    memoryRequirements,
    timeoutConfig
  }
}

/**
 * Determine document tier based on size and page count
 */
function determineDocumentTier(sizeBytes: number, estimatedPages: number): DocumentSizeTier {
  // Check each tier from smallest to largest
  for (const [tierName, config] of Object.entries(DOCUMENT_SIZE_TIERS)) {
    if (sizeBytes <= config.maxSizeBytes && estimatedPages <= config.maxPages) {
      return tierName as DocumentSizeTier
    }
  }
  
  // Fallback to MASSIVE for very large documents
  return 'MASSIVE'
}

/**
 * Estimate page count based on file size and type
 */
function estimatePageCount(sizeBytes: number, mimeType?: string): number {
  const sizeMB = sizeBytes / (1024 * 1024)
  
  // Page estimation based on document type and size
  if (mimeType?.includes('pdf')) {
    // PDFs: ~100-500KB per page depending on content
    return Math.ceil(sizeMB / 0.3) // Conservative estimate: 300KB per page
  } else if (mimeType?.includes('image')) {
    // Images: Usually single page
    return 1
  } else if (mimeType?.includes('word') || mimeType?.includes('doc')) {
    // Word documents: ~50-200KB per page
    return Math.ceil(sizeMB / 0.1) // Conservative estimate: 100KB per page
  } else {
    // Generic estimation: ~200KB per page
    return Math.ceil(sizeMB / 0.2)
  }
}

/**
 * Generate optimized processing configuration based on document tier
 */
function generateProcessingConfig(
  tier: DocumentSizeTier, 
  sizeBytes: number, 
  estimatedPages: number
): ProcessingConfiguration {
  const tierConfig = DOCUMENT_SIZE_TIERS[tier]
  
  switch (tierConfig.strategy) {
    case 'fast-track':
      return {
        batchSize: Math.min(estimatedPages, 10), // Process all at once for small docs
        maxConcurrency: 10,
        delayBetweenBatches: 0, // No delay for small documents
        chunkingStrategy: 'standard',
        enablePrefetching: true,
        useAsyncProcessing: false, // Sync for speed
        priorityLevel: 'critical'
      }
      
    case 'standard':
      return {
        batchSize: Math.min(estimatedPages, 25),
        maxConcurrency: 8,
        delayBetweenBatches: 50,
        chunkingStrategy: 'standard',
        enablePrefetching: true,
        useAsyncProcessing: false,
        priorityLevel: 'high'
      }
      
    case 'optimized':
      return {
        batchSize: Math.min(30, Math.max(10, Math.floor(estimatedPages / 3))),
        maxConcurrency: 6,
        delayBetweenBatches: 100,
        chunkingStrategy: 'memory-optimized',
        enablePrefetching: true,
        useAsyncProcessing: true,
        priorityLevel: 'normal'
      }
      
    case 'batch-optimized':
      return {
        batchSize: Math.min(20, Math.max(5, Math.floor(estimatedPages / 5))),
        maxConcurrency: 4,
        delayBetweenBatches: 200,
        chunkingStrategy: 'memory-optimized',
        enablePrefetching: false,
        useAsyncProcessing: true,
        priorityLevel: 'normal'
      }
      
    case 'enterprise-batch':
      return {
        batchSize: Math.min(15, Math.max(3, Math.floor(estimatedPages / 8))),
        maxConcurrency: 3,
        delayBetweenBatches: 300,
        chunkingStrategy: 'streaming',
        enablePrefetching: false,
        useAsyncProcessing: true,
        priorityLevel: 'low'
      }
      
    case 'streaming-batch':
      return {
        batchSize: Math.min(10, Math.max(2, Math.floor(estimatedPages / 12))),
        maxConcurrency: 2,
        delayBetweenBatches: 500,
        chunkingStrategy: 'streaming',
        enablePrefetching: false,
        useAsyncProcessing: true,
        priorityLevel: 'low'
      }
      
    default:
      return {
        batchSize: 20,
        maxConcurrency: 5,
        delayBetweenBatches: 100,
        chunkingStrategy: 'standard',
        enablePrefetching: true,
        useAsyncProcessing: true,
        priorityLevel: 'normal'
      }
  }
}

/**
 * Calculate memory requirements based on document characteristics
 */
function calculateMemoryRequirements(
  tier: DocumentSizeTier,
  sizeBytes: number,
  estimatedPages: number
): MemoryRequirements {
  const _sizeMB = sizeBytes / (1024 * 1024)
  const tierConfig = DOCUMENT_SIZE_TIERS[tier]
  
  // Base memory estimation: ~5-10MB per page for processing
  const baseMemoryPerPage = 8 // MB
  const estimatedMemoryMB = Math.ceil(estimatedPages * baseMemoryPerPage * 1.5) // 50% buffer
  
  switch (tierConfig.strategy) {
    case 'fast-track':
    case 'standard':
      return {
        estimatedMemoryMB: Math.min(estimatedMemoryMB, 500), // Cap at 500MB
        enableMemoryOptimization: false,
        useStreamingChunks: false,
        garbageCollectionHints: false,
        memoryBuffer: 20 // 20% buffer
      }
      
    case 'optimized':
      return {
        estimatedMemoryMB: Math.min(estimatedMemoryMB, 1000), // Cap at 1GB
        enableMemoryOptimization: true,
        useStreamingChunks: false,
        garbageCollectionHints: true,
        memoryBuffer: 30 // 30% buffer
      }
      
    case 'batch-optimized':
    case 'enterprise-batch':
      return {
        estimatedMemoryMB: Math.min(estimatedMemoryMB, 1500), // Cap at 1.5GB
        enableMemoryOptimization: true,
        useStreamingChunks: true,
        garbageCollectionHints: true,
        memoryBuffer: 40 // 40% buffer
      }
      
    case 'streaming-batch':
      return {
        estimatedMemoryMB: Math.min(estimatedMemoryMB, 2000), // Cap at 2GB
        enableMemoryOptimization: true,
        useStreamingChunks: true,
        garbageCollectionHints: true,
        memoryBuffer: 50 // 50% buffer for very large documents
      }
      
    default:
      return {
        estimatedMemoryMB: estimatedMemoryMB,
        enableMemoryOptimization: true,
        useStreamingChunks: false,
        garbageCollectionHints: true,
        memoryBuffer: 25
      }
  }
}

/**
 * Generate timeout configuration based on document complexity
 */
function generateTimeoutConfig(
  tier: DocumentSizeTier,
  sizeBytes: number,
  estimatedPages: number
): TimeoutConfiguration {
  const tierConfig = DOCUMENT_SIZE_TIERS[tier]
  
  // Base timeout calculation: ~30 seconds per page + overhead
  const baseTimeoutPerPage = 30 // seconds
  const baseTimeout = Math.max(120, estimatedPages * baseTimeoutPerPage) // Minimum 2 minutes
  
  switch (tierConfig.strategy) {
    case 'fast-track':
      return {
        processingTimeoutMinutes: Math.min(5, Math.ceil(baseTimeout / 60)),
        chunkTimeoutSeconds: 30,
        retryTimeoutSeconds: 10,
        maxRetryAttempts: 3,
        enableCircuitBreaker: false
      }
      
    case 'standard':
      return {
        processingTimeoutMinutes: Math.min(10, Math.ceil(baseTimeout / 60)),
        chunkTimeoutSeconds: 60,
        retryTimeoutSeconds: 15,
        maxRetryAttempts: 3,
        enableCircuitBreaker: false
      }
      
    case 'optimized':
      return {
        processingTimeoutMinutes: Math.min(20, Math.ceil(baseTimeout / 60)),
        chunkTimeoutSeconds: 90,
        retryTimeoutSeconds: 20,
        maxRetryAttempts: 5,
        enableCircuitBreaker: true
      }
      
    case 'batch-optimized':
      return {
        processingTimeoutMinutes: Math.min(30, Math.ceil(baseTimeout / 60)),
        chunkTimeoutSeconds: 120,
        retryTimeoutSeconds: 30,
        maxRetryAttempts: 25,
        enableCircuitBreaker: true
      }
      
    case 'enterprise-batch':
      return {
        processingTimeoutMinutes: Math.min(45, Math.ceil(baseTimeout / 60)),
        chunkTimeoutSeconds: 180,
        retryTimeoutSeconds: 45,
        maxRetryAttempts: 35,
        enableCircuitBreaker: true
      }
      
    case 'streaming-batch':
      return {
        processingTimeoutMinutes: Math.min(60, Math.ceil(baseTimeout / 60)),
        chunkTimeoutSeconds: 300,
        retryTimeoutSeconds: 60,
        maxRetryAttempts: 10,
        enableCircuitBreaker: true
      }
      
    default:
      return {
        processingTimeoutMinutes: Math.ceil(baseTimeout / 60),
        chunkTimeoutSeconds: 120,
        retryTimeoutSeconds: 30,
        maxRetryAttempts: 5,
        enableCircuitBreaker: true
      }
  }
}

/**
 * Get processing priority for queue management
 */
export function getProcessingPriority(analysis: DocumentSizeAnalysis): number {
  const priorityMap = {
    'critical': 1,
    'high': 2,
    'normal': 3,
    'low': 4
  }
  
  return priorityMap[analysis.processingConfig.priorityLevel]
}

/**
 * Estimate processing time for user feedback
 */
export function estimateProcessingTime(analysis: DocumentSizeAnalysis): {
  estimatedMinutes: number
  description: string
} {
  const { estimatedPages, strategy } = analysis
  
  // Base processing time estimation
  let estimatedMinutes: number
  let description: string
  
  switch (strategy) {
    case 'fast-track':
      estimatedMinutes = Math.max(0.5, estimatedPages * 0.1)
      description = 'Processing should complete in under a minute'
      break
      
    case 'standard':
      estimatedMinutes = Math.max(1, estimatedPages * 0.2)
      description = 'Standard processing time expected'
      break
      
    case 'optimized':
      estimatedMinutes = Math.max(2, estimatedPages * 0.3)
      description = 'Optimized processing for medium-sized document'
      break
      
    case 'batch-optimized':
      estimatedMinutes = Math.max(5, estimatedPages * 0.5)
      description = 'Batch processing for large document - please be patient'
      break
      
    case 'enterprise-batch':
      estimatedMinutes = Math.max(10, estimatedPages * 0.7)
      description = 'Enterprise processing for very large document - this may take a while'
      break
      
    case 'streaming-batch':
      estimatedMinutes = Math.max(15, estimatedPages * 1.0)
      description = 'Streaming processing for massive document - this will take significant time'
      break
      
    default:
      estimatedMinutes = Math.max(2, estimatedPages * 0.3)
      description = 'Processing time will vary based on document complexity'
  }
  
  return {
    estimatedMinutes: Math.ceil(estimatedMinutes),
    description
  }
}

/**
 * Check if document requires special handling
 */
export function requiresSpecialHandling(analysis: DocumentSizeAnalysis): {
  requiresSpecialHandling: boolean
  reasons: string[]
  recommendations: string[]
} {
  const reasons: string[] = []
  const recommendations: string[] = []
  
  // Check for memory concerns
  if (analysis.memoryRequirements.estimatedMemoryMB > 1000) {
    reasons.push('High memory requirements')
    recommendations.push('Consider processing during off-peak hours')
  }
  
  // Check for long processing times
  if (analysis.timeoutConfig.processingTimeoutMinutes > 30) {
    reasons.push('Extended processing time expected')
    recommendations.push('Enable email notifications for completion status')
  }
  
  // Check for very large documents
  if (analysis.tier === 'ENTERPRISE' || analysis.tier === 'MASSIVE') {
    reasons.push('Enterprise-scale document')
    recommendations.push('Ensure stable internet connection for the duration')
  }
  
  // Check for resource intensive processing
  if (analysis.processingConfig.maxConcurrency <= 3) {
    reasons.push('Resource-intensive processing required')
    recommendations.push('Avoid uploading multiple large documents simultaneously')
  }
  
  return {
    requiresSpecialHandling: reasons.length > 0,
    reasons,
    recommendations
  }
}

const documentSizeStrategies = {
  analyzeDocumentSize,
  getProcessingPriority,
  estimateProcessingTime,
  requiresSpecialHandling,
  DOCUMENT_SIZE_TIERS
}

export default documentSizeStrategies
