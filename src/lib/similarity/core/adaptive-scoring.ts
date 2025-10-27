/**
 * Token-Based Adaptive Scoring Formula
 * Uses actual content volume (tokens) instead of chunk counts for accurate similarity
 * Final score = matched coverage of the larger document (in tokens)
 */

import { ChunkMatch, SimilarityScores } from '../types'

export function computeAdaptiveScore(
  matchedPairs: ChunkMatch[],
  docA_totalTokens: number,  // CRITICAL: Total tokens in document A
  docB_totalTokens: number   // CRITICAL: Total tokens in document B
): SimilarityScores {

  // Validate inputs
  if (docA_totalTokens <= 0 || docB_totalTokens <= 0) {
    throw new Error(
      `Invalid total tokens: A=${docA_totalTokens}, B=${docB_totalTokens}`
    )
  }

  // Calculate matched tokens from both perspectives
  // Each match contributes tokens from both chunks
  let matchedTokensA = 0  // Tokens from doc A in matched pairs
  let matchedTokensB = 0  // Tokens from doc B in matched pairs

  for (const match of matchedPairs) {
    matchedTokensA += match.chunkA.tokenCount
    matchedTokensB += match.chunkB.tokenCount
  }

  // 1. Jaccard Similarity (token-weighted, pair-based)
  // Total unique tokens involved = tokensA + tokensB - matched_pair_tokens
  // We use the average of matched tokens from both sides for the overlap
  const matchedPairTokens = (matchedTokensA + matchedTokensB) / 2
  const uniqueTokens = docA_totalTokens + docB_totalTokens - matchedPairTokens
  const jaccard = uniqueTokens > 0 ? matchedPairTokens / uniqueTokens : 0

  // 2. Coverage from each perspective
  const coverageA = docA_totalTokens > 0 ? matchedTokensA / docA_totalTokens : 0
  const coverageB = docB_totalTokens > 0 ? matchedTokensB / docB_totalTokens : 0

  // 3. Weighted Bidirectional Similarity (token-weighted average)
  const weightedBidir =
    (coverageA * docA_totalTokens + coverageB * docB_totalTokens) /
    (docA_totalTokens + docB_totalTokens)

  // 4. Size Ratio (using total tokens)
  const sizeRatio =
    Math.min(docA_totalTokens, docB_totalTokens) /
    Math.max(docA_totalTokens, docB_totalTokens)

  // 5. Coverage of larger document (primary final score)
  const largestDocTokens = Math.max(docA_totalTokens, docB_totalTokens)
  const matchedTokensLarger = docA_totalTokens >= docB_totalTokens ? matchedTokensA : matchedTokensB
  const final = largestDocTokens > 0 ? matchedTokensLarger / largestDocTokens : 0

  // 6. Adaptive Alpha retained for diagnostics
  const alphaRaw = sizeRatio * sizeRatio
  const alpha = Math.max(0.15, Math.min(0.95, alphaRaw))

  // 7. User-Facing Explanation
  const coveragePercent = final * 100
  const matchedPairs_count = matchedPairs.length
  const explanation =
    `Matched ${coveragePercent.toFixed(1)}% of the larger document ` +
    `(${matchedTokensLarger.toLocaleString()}/${largestDocTokens.toLocaleString()} tokens across ${matchedPairs_count} chunk pairs). ` +
    `Coverage A→B: ${(coverageA * 100).toFixed(1)}%, B→A: ${(coverageB * 100).toFixed(1)}%. ` +
    `Jaccard ${(jaccard * 100).toFixed(1)}%, match rate ${(weightedBidir * 100).toFixed(1)}%, ` +
    `size ratio ${sizeRatio.toFixed(2)} (α=${alpha.toFixed(2)})`

  return {
    jaccard,
    weightedBidir,
    final,
    sizeRatio,
    alpha,
    coverageA,
    coverageB,
    explanation
  }
}

/**
 * Compute dynamic minimum evidence threshold (token-based)
 * Prevents false positives from coincidental matches
 *
 * min_tokens = max(400, ceil(5% of smaller document's tokens))
 * Approximately equivalent to 8 chunks at ~50 tokens/chunk
 *
 * @param docA_totalTokens - Total tokens in doc A
 * @param docB_totalTokens - Total tokens in doc B
 * @returns Minimum number of matched tokens required to show result
 */
export function computeMinimumEvidence(
  docA_totalTokens: number,
  docB_totalTokens: number
): number {
  const minTokens = Math.min(docA_totalTokens, docB_totalTokens)
  const dynamicThreshold = Math.ceil(0.05 * minTokens)  // 5% of smaller doc
  return Math.max(400, dynamicThreshold)  // ~8 chunks worth of tokens
}

/**
 * Check if matched tokens meet minimum evidence requirement
 * Use this in Stage 2 to filter out low-evidence results
 *
 * @param matchedTokens - Total matched tokens (use smaller of A or B for conservative check)
 * @param docA_totalTokens - Total tokens in doc A
 * @param docB_totalTokens - Total tokens in doc B
 * @returns true if sufficient evidence, false otherwise
 */
export function hasSufficientEvidence(
  matchedTokens: number,
  docA_totalTokens: number,
  docB_totalTokens: number
): boolean {
  const minRequired = computeMinimumEvidence(docA_totalTokens, docB_totalTokens)
  return matchedTokens >= minRequired
}
