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

  // 2. Coverage from each perspective (directional scores)
  const sourceScore = docA_totalTokens > 0 ? matchedTokensA / docA_totalTokens : 0
  const targetScore = docB_totalTokens > 0 ? matchedTokensB / docB_totalTokens : 0

  // 3. Overlap store for convenience (already computed above as jaccard)
  const overlapScore = jaccard

  // 4. User-Facing Explanation
  const matchedPairs_count = matchedPairs.length
  const explanation =
    `Source reuse ${(sourceScore * 100).toFixed(1)}% (${matchedTokensA.toLocaleString()}/${docA_totalTokens.toLocaleString()} tokens), ` +
    `target reuse ${(targetScore * 100).toFixed(1)}% (${matchedTokensB.toLocaleString()}/${docB_totalTokens.toLocaleString()} tokens) ` +
    `across ${matchedPairs_count} chunk pairs. Overlap ${(overlapScore * 100).toFixed(1)}%.`

  return {
    sourceScore,
    targetScore,
    overlapScore,
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
