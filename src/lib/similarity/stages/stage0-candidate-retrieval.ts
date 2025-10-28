/**
 * Stage 0: Document-Level Centroid Candidate Retrieval
 * Fast filtering using pre-computed document centroids
 * Reduces 2000+ documents → ~600 candidates in ~5 seconds
 *
 * Purpose: Cast wide net for high recall (don't miss true matches)
 */

import { createServiceClient } from '@/lib/supabase/server'
import { getPineconeIndex } from '@/lib/pinecone'
import { logger } from '@/lib/logger'
import { Stage0Result } from '../types'

const PINECONE_OPERATOR_IN = '$in'
const PINECONE_OPERATOR_EQ = '$eq'
const PINECONE_OPERATOR_NE = '$ne'

function sanitizeDocumentIdFilter(
  existingFilter: unknown,
  sourceDocId: string
): Record<string, unknown> {
  if (existingFilter === undefined) {
    return { [PINECONE_OPERATOR_NE]: sourceDocId }
  }

  if (typeof existingFilter === 'string') {
    if (existingFilter === sourceDocId) {
      return { [PINECONE_OPERATOR_IN]: [] }
    }
    return { [PINECONE_OPERATOR_IN]: [existingFilter] }
  }

  if (existingFilter && typeof existingFilter === 'object' && !Array.isArray(existingFilter)) {
    const filter = { ...(existingFilter as Record<string, unknown>) }

    const rawIn = filter[PINECONE_OPERATOR_IN]
    if (Array.isArray(rawIn)) {
      const allowed = rawIn.filter(
        (value): value is string => typeof value === 'string' && value !== sourceDocId
      )
      filter[PINECONE_OPERATOR_IN] = allowed
      if (allowed.length === 0) {
        return { [PINECONE_OPERATOR_IN]: [] }
      }
    }

    const rawEq = filter[PINECONE_OPERATOR_EQ]
    if (typeof rawEq === 'string') {
      if (rawEq === sourceDocId) {
        return { [PINECONE_OPERATOR_IN]: [] }
      }
    }

    if (
      filter[PINECONE_OPERATOR_IN] === undefined &&
      filter[PINECONE_OPERATOR_EQ] === undefined &&
      filter[PINECONE_OPERATOR_NE] === undefined
    ) {
      filter[PINECONE_OPERATOR_NE] = sourceDocId
    } else if (filter[PINECONE_OPERATOR_IN] === undefined && filter[PINECONE_OPERATOR_EQ] === undefined) {
      // Ensure source document is excluded even when other constraints exist
      filter[PINECONE_OPERATOR_NE] = sourceDocId
    }

    return filter
  }

  return { [PINECONE_OPERATOR_NE]: sourceDocId }
}

/**
 * Retrieve top candidates using document-level centroid similarity
 * CRITICAL: Uses pre-computed and cached centroids for speed
 *
 * @param sourceDocId - ID of source document
 * @param options - Configuration options
 * @returns Top K candidate document IDs with scores
 */
export async function stage0CandidateRetrieval(
  sourceDocId: string,
  options: {
    topK?: number
    filters?: Record<string, unknown>
    overrideSourceVector?: number[]
    sourcePageRange?: {
      start_page: number
      end_page: number
    }
  } = {}
): Promise<Stage0Result> {

  const startTime = Date.now()
  const {
    topK = 600,
    filters = {},
    overrideSourceVector,
    sourcePageRange
  } = options

  try {
    // 1. Get source document centroid (pre-computed and cached)
    const supabase = await createServiceClient()
    const { data: sourceDoc, error: fetchError } = await supabase
      .from('documents')
      .select('id, centroid_embedding, effective_chunk_count')
      .eq('id', sourceDocId)
      .single()

    if (fetchError || !sourceDoc) {
      throw new Error(`Source document not found: ${sourceDocId}`)
    }

    if (!overrideSourceVector && !sourceDoc.centroid_embedding) {
      throw new Error(
        `Source document ${sourceDocId} missing centroid_embedding. ` +
        `Please reprocess or run backfill script.`
      )
    }

    if (!sourceDoc.effective_chunk_count) {
      throw new Error(
        `Source document ${sourceDocId} missing effective_chunk_count. ` +
        `Please reprocess or run backfill script.`
      )
    }

    // 2. Query Pinecone with source centroid
    // Use document-level index for centroids (or query chunk index with filter)
    // For now, we'll use a dummy approach - in production, create separate centroid index
    logger.info('Stage 0: querying Pinecone with centroid', {
      sourceDocId,
      desiredTopK: topK
    })

    // Build Pinecone filter
    const existingDocumentIdFilter = Object.prototype.hasOwnProperty.call(filters, 'document_id')
      ? (filters as Record<string, unknown>)[ 'document_id' ]
      : undefined

    const pineconeFilter: Record<string, unknown> = {
      ...filters,
      document_id: sanitizeDocumentIdFilter(existingDocumentIdFilter, sourceDocId)
    }

    // Parse centroid if stored as string in Supabase
    let centroidVector: unknown = overrideSourceVector ?? sourceDoc.centroid_embedding

    if (!overrideSourceVector) {
      if (typeof centroidVector === 'string') {
        try {
          centroidVector = JSON.parse(centroidVector)
        } catch (parseError) {
          throw new Error(`Failed to parse centroid embedding for document ${sourceDocId}: ${parseError}`)
        }
      }
    }

    if (!Array.isArray(centroidVector) || centroidVector.length === 0) {
      throw new Error(`Invalid centroid embedding format for document ${sourceDocId}`)
    }

    // Query using centroid
    logger.debug('Stage 0: Pinecone query params', {
      vectorLength: centroidVector.length,
      topK: topK * 2,
      filter: pineconeFilter,
      ...(sourcePageRange
        ? {
            pageRange: {
              start_page: sourcePageRange.start_page,
              end_page: sourcePageRange.end_page
            }
          }
        : {})
    })

    const queryResponse = await getPineconeIndex().query({
      vector: centroidVector,
      topK: topK * 2,  // Get extra to account for deduplication
      filter: pineconeFilter,
      includeMetadata: true,
      includeValues: false
    })

    logger.debug('Stage 0: Pinecone response sample', {
      matchesCount: queryResponse.matches?.length ?? 0,
      sample: queryResponse.matches?.slice(0, 3).map(m => ({
        id: m.id,
        score: m.score,
        documentId: (m.metadata as { document_id?: string } | undefined)?.document_id
      }))
    })

    // 3. Extract and deduplicate document IDs
    const candidateMap = new Map<string, number>()  // doc_id -> best_score

    for (const match of queryResponse.matches ?? []) {
      const metadata = match.metadata as { document_id?: string } | undefined
      if (!metadata?.document_id) continue

      const docId = metadata.document_id
      const score = match.score || 0

      // Keep highest score if document appears multiple times
      if (!candidateMap.has(docId) || candidateMap.get(docId)! < score) {
        candidateMap.set(docId, score)
      }
    }

    // 4. Sort and take top K
    const candidates = Array.from(candidateMap.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, topK)

    const candidateIds = candidates.map(c => c[0])
    const scores = candidates.map(c => c[1])

    if (candidateIds.length === 0 && 'user_id' in pineconeFilter) {
      const { user_id: _userFilter, ...fallbackFilter } = pineconeFilter

      try {
        const fallbackResponse = await getPineconeIndex().query({
          vector: centroidVector,
          topK: topK * 2,
          filter: fallbackFilter as Record<string, unknown>,
          includeMetadata: true,
          includeValues: false
        })

        const fallbackMatches = (fallbackResponse.matches ?? []).length
        if (fallbackMatches > 0) {
          logger.warn('Stage 0: user_id filter eliminated all candidates', {
            sourceDocId,
            fallbackMatches
          })
        }
      } catch (fallbackError) {
        logger.warn('Stage 0: fallback query without user filter failed', {
          sourceDocId,
          error: fallbackError instanceof Error ? fallbackError.message : String(fallbackError)
        })
      }
    }

    const timeMs = Date.now() - startTime

    logger.info('Stage 0: completed centroid retrieval', {
      sourceDocId,
      candidateCount: candidateIds.length,
      durationMs: timeMs,
      averageScore: scores.length > 0
        ? Number((scores.reduce((sum, score) => sum + score, 0) / scores.length).toFixed(3))
        : null
    })

    return { candidateIds, scores, timeMs }

  } catch (error) {
    const timeMs = Date.now() - startTime
    logger.error(
      'Stage 0 failed',
      error instanceof Error ? error : new Error(String(error)),
      { sourceDocId, durationMs: timeMs }
    )
    throw error
  }
}

/**
 * Alternative: Query using BM25 + RRF (future enhancement)
 * Combines dense (centroid) and sparse (keyword) retrieval
 */
export async function stage0HybridRetrieval(
  sourceDocId: string,
  options: {
    topK?: number
    filters?: Record<string, unknown>
    alpha?: number  // Weight for dense vs sparse (default: 0.7 dense, 0.3 sparse)
  } = {}
): Promise<Stage0Result> {

  const startTime = Date.now()
  const { topK = 150 } = options

  // TODO: Implement BM25 retrieval
  // 1. Get dense results (centroid)
  const denseResults = await stage0CandidateRetrieval(sourceDocId, { topK: topK * 2 })

  // 2. Get sparse results (BM25) - requires BM25 index
  // const sparseResults = await bm25Query(sourceDocId, { topK: topK * 2 })

  // 3. Reciprocal Rank Fusion (RRF)
  // const fusedResults = reciprocalRankFusion(denseResults, sparseResults, k=60)
  void reciprocalRankFusion

  // For now, just return dense results
  logger.warn('Stage 0 hybrid retrieval fallback to dense results', {
    sourceDocId,
    reason: 'BM25 not implemented'
  })

  return {
    candidateIds: denseResults.candidateIds.slice(0, topK),
    scores: denseResults.scores.slice(0, topK),
    timeMs: Date.now() - startTime
  }
}

/**
 * Reciprocal Rank Fusion (RRF)
 * Combines multiple ranked lists using reciprocal rank scores
 * Formula: score = sum(1 / (k + rank)) for each list
 */
function reciprocalRankFusion(
  list1: { ids: string[]; scores: number[] },
  list2: { ids: string[]; scores: number[] },
  k: number = 60
): { ids: string[]; scores: number[] } {
  const rrfScores = new Map<string, number>()

  // Add scores from list 1
  list1.ids.forEach((id, rank) => {
    const score = 1 / (k + rank + 1)
    rrfScores.set(id, score)
  })

  // Add scores from list 2
  list2.ids.forEach((id, rank) => {
    const score = 1 / (k + rank + 1)
    rrfScores.set(id, (rrfScores.get(id) || 0) + score)
  })

  // Sort by RRF score
  const sorted = Array.from(rrfScores.entries())
    .sort((a, b) => b[1] - a[1])

  return {
    ids: sorted.map(s => s[0]),
    scores: sorted.map(s => s[1])
  }
}
