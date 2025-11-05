/**
 * Bidirectional Chunk Matching with Non-Max Suppression (NMS) and Tie-Breaking
 * CRITICAL: Implements proper NMS to ensure clean 1:1 chunk alignment
 */

import { logger } from '@/lib/logger'
import { ChunkMatch, Chunk } from '../types'
import { cosineSimilarity } from '../utils/vector-operations'
import { hasSufficientEvidence } from './adaptive-scoring'

interface FallbackConfig {
  enabled: boolean
  threshold: number
  topK: number
  proximityScore: number
  maxPageDistance: number
  maxIndexDistance: number
  maxLengthDifferenceRatio: number
}

interface MatchingOptions {
  primaryThreshold?: number
  fallback?: Partial<FallbackConfig>
}

/**
 * Find bidirectional matches between two documents with NMS
 * Returns null if insufficient evidence (dynamic minimum threshold)
 *
 * @param chunksA - Source document chunks (pre-normalized embeddings)
 * @param chunksB - Target document chunks (pre-normalized embeddings)
 * @param threshold - Similarity threshold (default: 0.85)
 * @returns Array of matched pairs, or null if insufficient evidence
 */
export async function findBidirectionalMatches(
  chunksA: Chunk[],
  chunksB: Chunk[],
  thresholdOrOptions: number | MatchingOptions = 0.85
): Promise<ChunkMatch[] | null> {

  const primaryThreshold = typeof thresholdOrOptions === 'number'
    ? thresholdOrOptions
    : thresholdOrOptions.primaryThreshold ?? 0.85

  const fallbackConfig: FallbackConfig = {
    enabled: typeof thresholdOrOptions === 'number'
      ? true
      : thresholdOrOptions.fallback?.enabled ?? true,
    threshold: typeof thresholdOrOptions === 'number'
      ? Math.max(primaryThreshold - 0.15, 0.65)
      : thresholdOrOptions.fallback?.threshold ?? Math.max(primaryThreshold - 0.15, 0.65),
    topK: typeof thresholdOrOptions === 'number'
      ? 5
      : thresholdOrOptions.fallback?.topK ?? 5,
    proximityScore: typeof thresholdOrOptions === 'number'
      ? 0.82
      : thresholdOrOptions.fallback?.proximityScore ?? 0.82,
    maxPageDistance: typeof thresholdOrOptions === 'number'
      ? -1
      : thresholdOrOptions.fallback?.maxPageDistance ?? -1,
    maxIndexDistance: typeof thresholdOrOptions === 'number'
      ? -1
      : thresholdOrOptions.fallback?.maxIndexDistance ?? -1,
    maxLengthDifferenceRatio: typeof thresholdOrOptions === 'number'
      ? 0.4
      : thresholdOrOptions.fallback?.maxLengthDifferenceRatio ?? 0.4
  }

  // Ensure fallback threshold never exceeds primary threshold
  fallbackConfig.threshold = Math.min(fallbackConfig.threshold, primaryThreshold - 0.01)
  if (fallbackConfig.threshold < 0.5) {
    fallbackConfig.threshold = 0.5
  }

  // Direction A→B: For each chunk in A, find best match in B
  const matchesAtoB = findBestMatches(chunksA, chunksB, primaryThreshold)

  // Direction B→A: For each chunk in B, find best match in A
  const matchesBtoA = findBestMatches(chunksB, chunksA, primaryThreshold)

  // Merge bidirectional matches (deduplicate pairs)
  let allMatches = mergeBidirectionalMatches(matchesAtoB, matchesBtoA)

  if (fallbackConfig.enabled) {
    const primaryMatchIdsA = new Set(allMatches.map(match => match.chunkA.id))
    const primaryMatchIdsB = new Set(allMatches.map(match => match.chunkB.id))

    const unmatchedAIds = new Set<string>(
      chunksA.filter(chunk => !primaryMatchIdsA.has(chunk.id)).map(chunk => chunk.id)
    )
    const unmatchedBIds = new Set<string>(
      chunksB.filter(chunk => !primaryMatchIdsB.has(chunk.id)).map(chunk => chunk.id)
    )

    if (unmatchedAIds.size > 0 || unmatchedBIds.size > 0) {
      const fallbackPairs = computeFallbackMatches(
        chunksA,
        chunksB,
        unmatchedAIds,
        unmatchedBIds,
        allMatches,
        fallbackConfig
      )

      if (fallbackPairs.length > 0) {
        logger.info('Fallback matching recovered additional pairs', {
          additionalPairs: fallbackPairs.length,
          unmatchedA: unmatchedAIds.size,
          unmatchedB: unmatchedBIds.size,
          threshold: Number(fallbackConfig.threshold.toFixed(2))
        })
        allMatches = greedySelectPairs([...allMatches, ...fallbackPairs])
      } else {
        logger.info('Fallback matching found no additional pairs', {
          unmatchedA: unmatchedAIds.size,
          unmatchedB: unmatchedBIds.size,
          threshold: Number(fallbackConfig.threshold.toFixed(2))
        })
      }
    }
  }

  // Dynamic minimum evidence filter (CRITICAL)
  // Prevents false positives from coincidental matches
  // Calculate total characters for both documents
  const totalCharactersA = chunksA.reduce((sum, chunk) => sum + chunk.characterCount, 0)
  const totalCharactersB = chunksB.reduce((sum, chunk) => sum + chunk.characterCount, 0)

  // Calculate matched characters (use smaller of A or B for conservative check)
  const matchedCharactersA = allMatches.reduce((sum, match) => sum + match.chunkA.characterCount, 0)
  const matchedCharactersB = allMatches.reduce((sum, match) => sum + match.chunkB.characterCount, 0)
  const matchedCharacters = Math.min(matchedCharactersA, matchedCharactersB)

  const sufficientEvidence = hasSufficientEvidence(
    matchedCharacters,
    totalCharactersA,
    totalCharactersB
  )

  if (!sufficientEvidence) {
    const minRequired = Math.max(1600, Math.ceil(0.05 * Math.min(totalCharactersA, totalCharactersB)))
    logger.warn('Insufficient evidence for similarity match', {
      matchCount: allMatches.length,
      matchedCharacters,
      totalCharactersA,
      totalCharactersB,
      requiredCharacters: minRequired
    })
    return null
  }

  return allMatches
}

/**
 * Find best matches from source to target with NMS and tie-breaking
 * Each source chunk matches AT MOST one target chunk (NMS)
 *
 * Tie-breaking order:
 * 1. Higher cosine similarity
 * 2. Closer page number (spatial proximity)
 */
function findBestMatches(
  sourceChunks: Chunk[],
  targetChunks: Chunk[],
  threshold: number
): Map<string, ChunkMatch> {

  const matches = new Map<string, ChunkMatch>()

  // Early exit optimization: If first 40 chunks yield 0 matches, bail
  let earlyMatchCount = 0
  const earlyExitThreshold = Math.min(40, sourceChunks.length)

  for (let i = 0; i < sourceChunks.length; i++) {
    const chunkA = sourceChunks[i]!

    // Find all candidates above threshold
    const candidates: Array<{ chunkB: Chunk; score: number }> = []

    for (const chunkB of targetChunks) {
      const score = cosineSimilarity(chunkA.embedding, chunkB.embedding)
      if (score >= threshold) {
        candidates.push({ chunkB, score })
      }
    }

    if (candidates.length === 0) {
      // Early exit check: If first 40 chunks have no matches, skip rest
      if (i < earlyExitThreshold) {
        if (earlyMatchCount === 0 && i === earlyExitThreshold - 1) {
          logger.warn('Early exit: no matches found in initial chunk sample', {
            inspectedChunks: earlyExitThreshold
          })
          break
        }
      }
      continue
    }

    earlyMatchCount++

    // Tie-breaking: 1. Highest score, 2. Closer page number
    const bestMatch = candidates.reduce((best, curr) => {
      const scoreDiff = Math.abs(curr.score - best.score)

      if (scoreDiff < 0.001) {
        // Scores essentially equal - break tie by page proximity
        const distBest = Math.abs(chunkA.pageNumber - best.chunkB.pageNumber)
        const distCurr = Math.abs(chunkA.pageNumber - curr.chunkB.pageNumber)
        return distCurr < distBest ? curr : best
      }

      // Clear score difference - choose higher score
      return curr.score > best.score ? curr : best
    })

    // NMS: Each source chunk matches at most once
    matches.set(chunkA.id, {
      chunkA: {
        id: chunkA.id,
        index: chunkA.index,
        pageNumber: chunkA.pageNumber,
        characterCount: chunkA.characterCount
      },
      chunkB: {
        id: bestMatch.chunkB.id,
        index: bestMatch.chunkB.index,
        pageNumber: bestMatch.chunkB.pageNumber,
        characterCount: bestMatch.chunkB.characterCount
      },
      score: bestMatch.score
    })
  }

  return matches
}

/**
 * Merge bidirectional matches, deduplicating pairs
 *
 * Algorithm:
 * 1. Collect all candidate pairs from both directions
 * 2. Sort by score (highest first)
 * 3. Remove exact duplicate pairs (same source → same target)
 *
 * Note: This allows multiple-to-one relationships:
 * - Multiple source chunks can match the same target chunk
 * - Multiple target chunks can match the same source chunk
 * Character-based scoring handles deduplication via Sets
 */
function mergeBidirectionalMatches(
  matchesAtoB: Map<string, ChunkMatch>,
  matchesBtoA: Map<string, ChunkMatch>
): ChunkMatch[] {

  // Collect all candidate pairs
  const allPairs: ChunkMatch[] = []

  // Add matches from A→B
  for (const match of matchesAtoB.values()) {
    allPairs.push(match)
  }

  // Add matches from B→A (swapped to ensure chunkA is from doc A)
  for (const match of matchesBtoA.values()) {
    // In B→A matches, chunkA is from B and chunkB is from A
    const swapped: ChunkMatch = {
      chunkA: match.chunkB,  // Swap: make chunkA from original doc A
      chunkB: match.chunkA,  // Swap: make chunkB from original doc B
      score: match.score
    }
    allPairs.push(swapped)
  }

  return greedySelectPairs(allPairs)
}

/**
 * Remove exact duplicate pairs from candidate list
 *
 * Only removes pairs where the same source chunk maps to the same target chunk.
 * Does NOT enforce 1-to-1 constraint - allows multiple-to-one relationships.
 *
 * @param pairs - Candidate chunk pairs (may contain duplicate pairs)
 * @returns Filtered pairs with exact duplicates removed
 */
function greedySelectPairs(pairs: ChunkMatch[]): ChunkMatch[] {
  const sorted = [...pairs].sort((a, b) => b.score - a.score)
  const seenPairs = new Set<string>()
  const result: ChunkMatch[] = []

  for (const pair of sorted) {
    const key = `${pair.chunkA.id}->${pair.chunkB.id}`
    if (seenPairs.has(key)) {
      continue
    }
    result.push(pair)
    seenPairs.add(key)
  }

  return result
}

function mapChunksById(chunks: Chunk[]): Map<string, Chunk> {
  const map = new Map<string, Chunk>()
  for (const chunk of chunks) {
    map.set(chunk.id, chunk)
  }
  return map
}

function getChunkLength(chunk: Chunk): number {
  if (typeof chunk.text === 'string') {
    return chunk.text.length
  }
  return 0
}

function computeFallbackCandidates(
  sourceChunks: Chunk[],
  targetChunks: Chunk[],
  unmatchedIds: Set<string>,
  threshold: number,
  topK: number
): Map<string, Array<{ chunk: Chunk; score: number }>> {
  const candidates = new Map<string, Array<{ chunk: Chunk; score: number }>>()

  for (const chunkA of sourceChunks) {
    if (!unmatchedIds.has(chunkA.id)) {
      continue
    }

    const potential: Array<{ chunk: Chunk; score: number }> = []

    for (const chunkB of targetChunks) {
      const score = cosineSimilarity(chunkA.embedding, chunkB.embedding)
      if (score >= threshold) {
        potential.push({ chunk: chunkB, score })
      }
    }

    if (potential.length === 0) {
      continue
    }

    potential.sort((a, b) => b.score - a.score)
    candidates.set(chunkA.id, potential.slice(0, topK))
  }

  return candidates
}

function passesFallbackHeuristics(
  chunkA: Chunk,
  chunkB: Chunk,
  scoreAtoB: number,
  scoreBtoA: number,
  config: FallbackConfig
): boolean {
  const minScore = Math.min(scoreAtoB, scoreBtoA)
  if (minScore < config.threshold) {
    return false
  }

  const indexDistance = Math.abs((chunkA.index ?? 0) - (chunkB.index ?? 0))
  const pageDistance = Math.abs((chunkA.pageNumber ?? 0) - (chunkB.pageNumber ?? 0))

  if (minScore < config.proximityScore) {
    const indexFar = config.maxIndexDistance >= 0 && indexDistance > config.maxIndexDistance
    const pageFar = config.maxPageDistance >= 0 && pageDistance > config.maxPageDistance
    if (config.maxIndexDistance >= 0 && config.maxPageDistance >= 0) {
      if (indexFar && pageFar) {
        return false
      }
    } else if (config.maxIndexDistance >= 0 && indexFar) {
      return false
    } else if (config.maxPageDistance >= 0 && pageFar) {
      return false
    }
  }

  const lengthA = getChunkLength(chunkA)
  const lengthB = getChunkLength(chunkB)
  if (lengthA > 0 && lengthB > 0) {
    const maxLength = Math.max(lengthA, lengthB)
    const lengthDiffRatio = Math.abs(lengthA - lengthB) / maxLength
    if (lengthDiffRatio > config.maxLengthDifferenceRatio) {
      return false
    }
  }

  return true
}

function computeFallbackMatches(
  chunksA: Chunk[],
  chunksB: Chunk[],
  unmatchedAIds: Set<string>,
  unmatchedBIds: Set<string>,
  existingMatches: ChunkMatch[],
  config: FallbackConfig
): ChunkMatch[] {
  if (!config.enabled) {
    return []
  }

  const chunkAMap = mapChunksById(chunksA)
  const chunkBMap = mapChunksById(chunksB)

  const fallbackAtoB = computeFallbackCandidates(
    chunksA,
    chunksB,
    unmatchedAIds,
    config.threshold,
    config.topK
  )

  const fallbackBtoA = computeFallbackCandidates(
    chunksB,
    chunksA,
    unmatchedBIds,
    config.threshold,
    config.topK
  )

  const alreadyMatchedA = new Set(existingMatches.map(match => match.chunkA.id))
  const alreadyMatchedB = new Set(existingMatches.map(match => match.chunkB.id))

  const fallbackPairs: ChunkMatch[] = []

  for (const [chunkAId, candidates] of fallbackAtoB.entries()) {
    if (alreadyMatchedA.has(chunkAId)) {
      continue
    }

    for (const candidate of candidates) {
      const chunkBId = candidate.chunk.id

      if (alreadyMatchedB.has(chunkBId)) {
        continue
      }

      const reciprocalList = fallbackBtoA.get(chunkBId)
      if (!reciprocalList) {
        continue
      }

      const reciprocal = reciprocalList.find(entry => entry.chunk.id === chunkAId)
      if (!reciprocal) {
        continue
      }

      const chunkA = chunkAMap.get(chunkAId)
      const chunkB = chunkBMap.get(chunkBId)
      if (!chunkA || !chunkB) {
        continue
      }

      if (!passesFallbackHeuristics(chunkA, chunkB, candidate.score, reciprocal.score, config)) {
        continue
      }

      const pairScore = (candidate.score + reciprocal.score) / 2

      fallbackPairs.push({
        chunkA: {
          id: chunkA.id,
          index: chunkA.index,
          pageNumber: chunkA.pageNumber,
          characterCount: chunkA.characterCount
        },
        chunkB: {
          id: chunkB.id,
          index: chunkB.index,
          pageNumber: chunkB.pageNumber,
          characterCount: chunkB.characterCount
        },
        score: pairScore
      })

      alreadyMatchedA.add(chunkAId)
      alreadyMatchedB.add(chunkBId)
      break
    }
  }

  return fallbackPairs
}

/**
 * Batch version for parallel processing
 * Process multiple source documents against multiple targets
 */
export async function batchFindMatches(
  sourceDocs: Array<{ id: string; chunks: Chunk[] }>,
  targetDocs: Array<{ id: string; chunks: Chunk[] }>,
  threshold: number = 0.85
): Promise<Map<string, Map<string, ChunkMatch[]>>> {

  const results = new Map<string, Map<string, ChunkMatch[]>>()

  // Process in parallel (each source vs each target)
  const promises: Promise<void>[] = []

  for (const sourceDoc of sourceDocs) {
    for (const targetDoc of targetDocs) {
      promises.push(
        (async () => {
          const matches = await findBidirectionalMatches(
            sourceDoc.chunks,
            targetDoc.chunks,
            threshold
          )

          if (matches) {
            if (!results.has(sourceDoc.id)) {
              results.set(sourceDoc.id, new Map())
            }
            results.get(sourceDoc.id)!.set(targetDoc.id, matches)
          }
        })()
      )
    }
  }

  await Promise.all(promises)
  return results
}
