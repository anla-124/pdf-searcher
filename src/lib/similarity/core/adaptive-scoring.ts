/**
 * Character-Based Adaptive Scoring Formula
 * Uses actual content volume (characters) for accurate similarity measurement
 * Final score = matched coverage of the larger document (in characters)
 */

import { ChunkMatch, SimilarityScores } from '../types'

export function computeAdaptiveScore(
  matchedPairs: ChunkMatch[],
  docA_totalCharacters: number,  // CRITICAL: Total characters in document A
  docB_totalCharacters: number   // CRITICAL: Total characters in document B
): SimilarityScores {

  // Validate inputs
  if (docA_totalCharacters <= 0 || docB_totalCharacters <= 0) {
    throw new Error(
      `Invalid total characters: A=${docA_totalCharacters}, B=${docB_totalCharacters}`
    )
  }

  // Calculate matched characters from both perspectives
  // Each match contributes characters from both chunks
  let matchedCharactersA = 0  // Characters from doc A in matched pairs
  let matchedCharactersB = 0  // Characters from doc B in matched pairs

  const uniqueSourceChunks = new Set<string>()
  const uniqueTargetChunks = new Set<string>()

  for (const match of matchedPairs) {
    if (!uniqueSourceChunks.has(match.chunkA.id)) {
      matchedCharactersA += match.chunkA.characterCount
      uniqueSourceChunks.add(match.chunkA.id)
    }

    if (!uniqueTargetChunks.has(match.chunkB.id)) {
      matchedCharactersB += match.chunkB.characterCount
      uniqueTargetChunks.add(match.chunkB.id)
    }
  }

  // Coverage from each perspective (directional scores)
  const sourceScore = docA_totalCharacters > 0 ? matchedCharactersA / docA_totalCharacters : 0
  const targetScore = docB_totalCharacters > 0 ? matchedCharactersB / docB_totalCharacters : 0

  // User-Facing Explanation
  const matchedPairs_count = matchedPairs.length
  const explanation =
    `Source reuse ${(sourceScore * 100).toFixed(1)}% (${matchedCharactersA.toLocaleString()}/${docA_totalCharacters.toLocaleString()} characters), ` +
    `target reuse ${(targetScore * 100).toFixed(1)}% (${matchedCharactersB.toLocaleString()}/${docB_totalCharacters.toLocaleString()} characters) ` +
    `across ${matchedPairs_count} chunk pairs.`

  return {
    sourceScore,
    targetScore,
    matchedSourceCharacters: matchedCharactersA,
    matchedTargetCharacters: matchedCharactersB,
    explanation
  }
}

/**
 * Compute dynamic minimum evidence threshold (character-based)
 * Prevents false positives from coincidental matches
 *
 * min_characters = max(1600, ceil(5% of smaller document's characters))
 * Approximately equivalent to 8 chunks at ~200 characters/chunk
 *
 * @param docA_totalCharacters - Total characters in doc A
 * @param docB_totalCharacters - Total characters in doc B
 * @returns Minimum number of matched characters required to show result
 */
export function computeMinimumEvidence(
  docA_totalCharacters: number,
  docB_totalCharacters: number
): number {
  const minCharacters = Math.min(docA_totalCharacters, docB_totalCharacters)
  const dynamicThreshold = Math.ceil(0.05 * minCharacters)  // 5% of smaller doc
  return Math.max(1600, dynamicThreshold)  // ~8 chunks worth of characters (400 * 4)
}

/**
 * Check if matched characters meet minimum evidence requirement
 * Use this in Stage 2 to filter out low-evidence results
 *
 * @param matchedCharacters - Total matched characters (use smaller of A or B for conservative check)
 * @param docA_totalCharacters - Total characters in doc A
 * @param docB_totalCharacters - Total characters in doc B
 * @returns true if sufficient evidence, false otherwise
 */
export function hasSufficientEvidence(
  matchedCharacters: number,
  docA_totalCharacters: number,
  docB_totalCharacters: number
): boolean {
  const minRequired = computeMinimumEvidence(docA_totalCharacters, docB_totalCharacters)
  return matchedCharacters >= minRequired
}
