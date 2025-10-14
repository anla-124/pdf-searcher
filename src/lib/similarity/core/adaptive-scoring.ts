/**
 * Adaptive Scoring Formula
 * Final score = matched coverage of the larger document.
 * Jaccard, weighted bidirectional, size ratio, and α are still returned for diagnostics.
 */

import { ChunkMatch, SimilarityScores } from '../types'

export function computeAdaptiveScore(
  matchedPairs: ChunkMatch[],
  docA_effectiveChunks: number,  // CRITICAL: Use effective, not raw chunk count!
  docB_effectiveChunks: number   // CRITICAL: Use effective, not raw chunk count!
): SimilarityScores {

  // Validate inputs
  if (docA_effectiveChunks <= 0 || docB_effectiveChunks <= 0) {
    throw new Error(
      `Invalid effective chunk counts: A=${docA_effectiveChunks}, B=${docB_effectiveChunks}`
    )
  }

  const matchedCount = matchedPairs.length

  // 1. Jaccard Similarity (pair-based, NOT chunk-set-based)
  // Total unique chunks involved = chunks_A + chunks_B - matched_pairs
  // (Subtract matched because they're counted in both A and B)
  const uniqueChunks = docA_effectiveChunks + docB_effectiveChunks - matchedCount
  const jaccard = uniqueChunks > 0 ? matchedCount / uniqueChunks : 0

  // 2. Weighted Bidirectional Similarity
  // Match rate from each perspective, weighted by document size
  const rateAtoB = docA_effectiveChunks > 0 ? matchedCount / docA_effectiveChunks : 0
  const rateBtoA = docB_effectiveChunks > 0 ? matchedCount / docB_effectiveChunks : 0
  const weightedBidir =
    (rateAtoB * docA_effectiveChunks + rateBtoA * docB_effectiveChunks) /
    (docA_effectiveChunks + docB_effectiveChunks)

  // 3. Size Ratio (using effective chunks)
  const sizeRatio =
    Math.min(docA_effectiveChunks, docB_effectiveChunks) /
    Math.max(docA_effectiveChunks, docB_effectiveChunks)

  // 4. Coverage of larger document (primary final score)
  const largestDocChunks = Math.max(docA_effectiveChunks, docB_effectiveChunks)
  const final = largestDocChunks > 0 ? matchedCount / largestDocChunks : 0

  // 5. Adaptive Alpha retained for diagnostics (same computation as before)
  const alphaRaw = sizeRatio * sizeRatio
  const alpha = Math.max(0.15, Math.min(0.95, alphaRaw))

  // 6. User-Facing Explanation
  const coveragePercent = largestDocChunks > 0 ? final * 100 : 0
  const explanation =
    `Matched ${coveragePercent.toFixed(1)}% of the larger document ` +
    `(${matchedCount}/${largestDocChunks || 0} chunks). ` +
    `Jaccard ${(jaccard * 100).toFixed(1)}%, match rate ${(weightedBidir * 100).toFixed(1)}%, ` +
    `size ratio ${sizeRatio.toFixed(2)} (α=${alpha.toFixed(2)} for diagnostics)`

  return {
    jaccard,
    weightedBidir,
    final,
    sizeRatio,
    alpha,
    explanation
  }
}

/**
 * Compute dynamic minimum evidence threshold
 * Prevents false positives from coincidental matches
 *
 * min_matches = max(8, ceil(5% of smaller document))
 *
 * @param docA_effectiveChunks - Effective chunk count for doc A
 * @param docB_effectiveChunks - Effective chunk count for doc B
 * @returns Minimum number of matches required to show result
 */
export function computeMinimumEvidence(
  docA_effectiveChunks: number,
  docB_effectiveChunks: number
): number {
  const minChunks = Math.min(docA_effectiveChunks, docB_effectiveChunks)
  const dynamicThreshold = Math.ceil(0.05 * minChunks)  // 5% of smaller doc
  return Math.max(8, dynamicThreshold)
}

/**
 * Check if match count meets minimum evidence requirement
 * Use this in Stage 2 to filter out low-evidence results
 *
 * @returns true if sufficient evidence, false otherwise
 */
export function hasSufficientEvidence(
  matchCount: number,
  docA_effectiveChunks: number,
  docB_effectiveChunks: number
): boolean {
  const minRequired = computeMinimumEvidence(docA_effectiveChunks, docB_effectiveChunks)
  return matchCount >= minRequired
}
