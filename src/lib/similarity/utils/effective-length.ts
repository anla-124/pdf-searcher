/**
 * Effective length computation for size ratio calculation
 * CRITICAL: Use de-overlapped chunk count for size ratio, NOT raw chunk count or page count
 *
 * Why: Chunking with overlap (e.g., 500 chars with 100 overlap) inflates chunk count
 * Different documents with different overlap strategies would have incorrect size ratios
 */
import { DEFAULT_CHUNK_SIZE, DEFAULT_CHUNK_OVERLAP } from '@/lib/constants/chunking'

/**
 * Compute effective (de-overlapped) chunk count from total tokens
 * This is the PRIMARY method for computing effective length
 *
 * @param totalTokens - Total tokens/characters in document
 * @param chunkSize - Size of each chunk (default: 700 chars)
 * @param overlapSize - Overlap between consecutive chunks (default: 140 chars)
 * @returns Effective chunk count (de-overlapped)
 */
export function computeEffectiveChunkCount(
  totalTokens: number,
  chunkSize: number = DEFAULT_CHUNK_SIZE,
  overlapSize: number = DEFAULT_CHUNK_OVERLAP
): number {
  if (totalTokens <= 0) {
    return 0
  }

  if (overlapSize >= chunkSize) {
    throw new Error(`Overlap size (${overlapSize}) must be less than chunk size (${chunkSize})`)
  }

  // Effective chunk size = chunk size - overlap
  // This is the "stride" or amount of NEW content per chunk
  const effectiveChunkSize = chunkSize - overlapSize

  return Math.ceil(totalTokens / effectiveChunkSize)
}

/**
 * Estimate effective chunk count from page count
 * Use this as fallback if token count is unavailable
 *
 * @param pageCount - Number of pages in document
 * @param avgTokensPerPage - Average tokens per page (default: 500)
 * @param chunkSize - Size of each chunk (default: 700 chars)
 * @param overlapSize - Overlap between chunks (default: 140 chars)
 * @returns Estimated effective chunk count
 */
export function effectiveChunkCountFromPages(
  pageCount: number,
  avgTokensPerPage: number = 500,
  chunkSize: number = DEFAULT_CHUNK_SIZE,
  overlapSize: number = DEFAULT_CHUNK_OVERLAP
): number {
  const totalTokens = pageCount * avgTokensPerPage
  return computeEffectiveChunkCount(totalTokens, chunkSize, overlapSize)
}

/**
 * Compute effective chunk count from actual chunks
 * Use this if you have the chunk array with token counts
 *
 * @param chunks - Array of chunks with token counts
 * @param overlapSize - Overlap between chunks
 * @returns Effective chunk count
 */
export function effectiveChunkCountFromChunks(
  chunks: Array<{ tokenCount?: number; text?: string }>,
  overlapSize: number = DEFAULT_CHUNK_OVERLAP
): number {
  if (chunks.length === 0) {
    return 0
  }

  // Sum total tokens from all chunks
  let totalTokens = 0
  for (const chunk of chunks) {
    if (chunk.tokenCount) {
      totalTokens += chunk.tokenCount
    } else if (chunk.text) {
      // Fallback: estimate from text length
      totalTokens += chunk.text.length
    } else {
      // If no token info, assume default chunk size
      totalTokens += DEFAULT_CHUNK_SIZE
    }
  }

  // Subtract overlap (chunks.length - 1) times
  // Total overlapped content = (number of overlaps) × (overlap size)
  const totalOverlap = (chunks.length - 1) * overlapSize
  const effectiveTokens = Math.max(totalTokens - totalOverlap, totalTokens / chunks.length)

  // Effective chunk count = effective tokens / avg chunk size
  const avgChunkSize = totalTokens / chunks.length
  return Math.ceil(effectiveTokens / avgChunkSize)
}

/**
 * Validate effective chunk count against expected range
 * Use for debugging/testing
 */
export function validateEffectiveChunkCount(
  effectiveCount: number,
  rawChunkCount: number,
  pageCount: number
): { valid: boolean; warnings: string[] } {
  const warnings: string[] = []

  // Effective should be less than or equal to raw
  if (effectiveCount > rawChunkCount) {
    warnings.push(`Effective count (${effectiveCount}) > raw count (${rawChunkCount})`)
  }

  // Effective should be reasonably close to page count
  const ratio = effectiveCount / pageCount
  if (ratio < 0.5 || ratio > 10) {
    warnings.push(`Unusual effective/page ratio: ${ratio.toFixed(2)}`)
  }

  return {
    valid: warnings.length === 0,
    warnings
  }
}
