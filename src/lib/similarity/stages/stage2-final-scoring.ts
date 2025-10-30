/**
 * Stage 2: Final Adaptive Scoring with Parallel Processing
 * Computes accurate similarity scores for ~250 candidates in 90-240 seconds
 *
 * Purpose: Provide accurate, proportional similarity scores with section details
 */

import { createServiceClient } from '@/lib/supabase/server'
import { logger } from '@/lib/logger'
import { SimilarityResult, Chunk } from '../types'
import { findBidirectionalMatches } from '../core/chunk-matching'
import { computeAdaptiveScore } from '../core/adaptive-scoring'
import { groupMatchesIntoSections } from '../core/section-detection'

/**
 * Compute final adaptive scores for all candidates in parallel
 *
 * @param sourceDoc - Source document metadata
 * @param candidateIds - Candidate IDs from Stage 1
 * @param options - Configuration options
 * @returns Similarity results sorted by final score
 */
type Stage2DocumentRecord = {
  id: string
  title?: string | null
  filename?: string | null
  page_count?: number | null
  effective_chunk_count: number | null
  total_tokens: number | null
  [key: string]: unknown
}

export async function stage2FinalScoring(
  sourceDoc: Stage2DocumentRecord,
  candidateIds: string[],
  options: {
    parallelWorkers?: number
    threshold?: number
    fallbackThreshold?: number
    fallbackEnabled?: boolean
    timeout?: number
    sourceChunksOverride?: Chunk[]
    sourcePageRange?: {
      start_page: number
      end_page: number
    }
  } = {}
): Promise<SimilarityResult[]> {

  const startTime = Date.now()
  const {
    parallelWorkers = 28,
    threshold = 0.85,
    fallbackThreshold = 0.8,
    fallbackEnabled = true,
    timeout = 180000
  } = options

  try {
    logger.info('Stage 2: starting final scoring', {
      candidateCount: candidateIds.length,
      parallelWorkers,
      threshold
    })

    // 1. Validate source document has total_tokens
    if (sourceDoc.total_tokens == null || sourceDoc.total_tokens <= 0) {
      logger.warn('Stage 2: source document missing total_tokens; deriving from chunk data', {
        sourceDocId: sourceDoc.id
      })
    }

    // 2. Fetch source chunks once (reuse for all candidates)
    const sourceChunks = Array.isArray(options.sourceChunksOverride) && options.sourceChunksOverride.length > 0
      ? options.sourceChunksOverride
      : await fetchDocumentChunks(
        sourceDoc.id,
        options.sourcePageRange ? { pageRange: options.sourcePageRange } : undefined
      )

    if (sourceChunks.length === 0) {
      throw new Error(`No chunks found for source document ${sourceDoc.id}`)
    }

    const sourceTotalTokens = sourceChunks.reduce((sum, chunk) => sum + chunk.tokenCount, 0)

    if (sourceTotalTokens <= 0) {
      throw new Error(
        `Source document ${sourceDoc.id} has no tokenized content in the selected scope`
      )
    }

    const effectiveChunkCount = sourceChunks.length

    logger.info('Stage 2: loaded source chunks', {
      candidateCount: candidateIds.length,
      sourceChunkCount: sourceChunks.length,
      sourceTotalTokens,
      effectiveChunkCount
    })

    // 2. Process candidates in parallel batches
    const batchSize = Math.ceil(candidateIds.length / parallelWorkers)
    const batches: string[][] = []

    for (let i = 0; i < candidateIds.length; i += batchSize) {
      batches.push(candidateIds.slice(i, i + batchSize))
    }

    const matchOptions = {
      threshold,
      fallbackThreshold,
      fallbackEnabled
    }

    const batchPromises = batches.map(batch =>
      processBatch(batch, sourceDoc, sourceChunks, matchOptions, timeout, sourceTotalTokens)
    )

    const batchResults = await Promise.all(batchPromises)

    // 3. Flatten and filter null results
    const allResults = batchResults.flat().filter(r => r !== null) as SimilarityResult[]

    // 4. Multi-criteria sorting (tie-breaking)
    allResults.sort((a, b) => {
      // 1. Sort by source score (portion of source covered by candidate)
      if (Math.abs(a.scores.sourceScore - b.scores.sourceScore) > 0.01) {
        return b.scores.sourceScore - a.scores.sourceScore
      }
      // 2. Tie-break by target score (portion of target covered by source)
      if (Math.abs(a.scores.targetScore - b.scores.targetScore) > 0.01) {
        return b.scores.targetScore - a.scores.targetScore
      }
      // 3. Tie-break by matched target tokens (higher reuse)
      if (a.scores.matchedTargetTokens !== b.scores.matchedTargetTokens) {
        return b.scores.matchedTargetTokens - a.scores.matchedTargetTokens
      }
      // 4. Final tie-break: More matched chunks
      return b.matchedChunks - a.matchedChunks
    })

    const timeMs = Date.now() - startTime

    logger.info('Stage 2: scoring complete', {
      results: allResults.length,
      durationMs: timeMs,
      perCandidateMs: candidateIds.length > 0 ? timeMs / candidateIds.length : 0
    })

    // Return top 30
    return allResults.slice(0, 30)

  } catch (error) {
    const timeMs = Date.now() - startTime
    logger.error('Stage 2 failed', error instanceof Error ? error : new Error(String(error)), {
      durationMs: timeMs
    })
    throw error
  }
}

/**
 * Process a batch of candidates
 * Each worker processes multiple candidates sequentially
 */
async function processBatch(
  candidateIds: string[],
  sourceDoc: Stage2DocumentRecord,
  sourceChunks: Chunk[],
  matchOptions: {
    threshold: number
    fallbackThreshold?: number
    fallbackEnabled: boolean
  },
  timeout: number,
  sourceTotalTokens: number
): Promise<(SimilarityResult | null)[]> {

  const results: (SimilarityResult | null)[] = []

  for (const candidateId of candidateIds) {
    try {
      // Set timeout for each candidate
      let timeoutId: NodeJS.Timeout | null = null

      const result = await Promise.race([
        processCandidate(candidateId, sourceDoc, sourceChunks, matchOptions, sourceTotalTokens).then(result => {
          // Clear timeout if processing completes successfully
          if (timeoutId) clearTimeout(timeoutId)
          return result
        }),
        new Promise<null>((resolve) => {
          timeoutId = setTimeout(() => {
            logger.warn('Stage 2: candidate processing timeout', {
              candidateId,
              timeoutMs: timeout
            })
            resolve(null)
          }, timeout)
        })
      ])

      results.push(result)

    } catch (error) {
      logger.error(
        'Stage 2: candidate processing error',
        error instanceof Error ? error : new Error(String(error)),
        { candidateId }
      )
      results.push(null)  // Continue with other candidates
    }
  }

  return results
}

/**
 * Process a single candidate: match, score, detect sections
 */
async function processCandidate(
  candidateId: string,
  sourceDoc: Stage2DocumentRecord,
  sourceChunks: Chunk[],
  matchOptions: {
    threshold: number
    fallbackThreshold?: number
    fallbackEnabled: boolean
  },
  sourceTotalTokens: number
): Promise<SimilarityResult | null> {

  // 1. Fetch candidate chunks and metadata
  const [candidateChunks, candidateMetadata] = await Promise.all([
    fetchDocumentChunks(candidateId),
    fetchDocumentMetadata(candidateId)
  ])

  if (candidateChunks.length === 0) {
    logger.warn('Stage 2: candidate has no chunks', { candidateId })
    return null
  }

  const candidateTotalTokens = candidateMetadata.total_tokens
  const effectiveChunkCount = candidateMetadata.effective_chunk_count

  if (candidateTotalTokens == null || candidateTotalTokens <= 0) {
    logger.warn('Stage 2: candidate missing total_tokens (required for token-based similarity)', { candidateId })
    return null
  }

  logger.info('Stage 2: candidate chunk summary', {
    candidateId,
    chunkCount: candidateChunks.length,
    totalTokens: candidateTotalTokens,
    effectiveChunkCount
  })

  // 2. Bidirectional matching with NMS and minimum evidence filter
  const fallbackOptions = matchOptions.fallbackThreshold !== undefined
    ? { enabled: matchOptions.fallbackEnabled, threshold: matchOptions.fallbackThreshold }
    : { enabled: matchOptions.fallbackEnabled }

  const matches = await findBidirectionalMatches(
    sourceChunks,
    candidateChunks,
    {
      primaryThreshold: matchOptions.threshold,
      fallback: fallbackOptions
    }
  )

  // Returns null if insufficient evidence
  if (!matches) {
    return null
  }

  // 3. Adaptive scoring (CRITICAL: Use total_tokens for accurate content-based similarity!)
  // Token-based metrics eliminate chunking artifacts and provide accurate similarity percentages
  logger.debug('Stage 2: computing token-based score for candidate', {
    candidateId,
    sourceTotalTokens,
    candidateTotalTokens,
    matchedPairs: matches.length
  })

  const scores = computeAdaptiveScore(
    matches,
    sourceTotalTokens,
    candidateTotalTokens
  )

  // 4. Section detection
  const sections = groupMatchesIntoSections(matches)

  // 5. Build result
  const normalizedDocument: SimilarityResult['document'] = {
    ...candidateMetadata,
    id: candidateMetadata.id,
    title: typeof candidateMetadata.title === 'string' && candidateMetadata.title.trim().length > 0
      ? candidateMetadata.title
      : typeof candidateMetadata.filename === 'string' && candidateMetadata.filename.trim().length > 0
        ? candidateMetadata.filename
        : candidateMetadata.id,
    filename: typeof candidateMetadata.filename === 'string' && candidateMetadata.filename.trim().length > 0
      ? candidateMetadata.filename
      : `${candidateId}.pdf`,
    page_count: typeof candidateMetadata.page_count === 'number'
      ? candidateMetadata.page_count
      : undefined,
    effective_chunk_count: candidateTotalTokens  // Use total_tokens as the definitive measure
  }

  const result = {
    document: normalizedDocument,
    scores,
    matchedChunks: matches.length,
    sections
  }

  logger.info('Stage 2: candidate scoring complete', {
    candidateId,
    sourceScore: scores.sourceScore,
    targetScore: scores.targetScore,
    matchedSourceTokens: scores.matchedSourceTokens,
    matchedTargetTokens: scores.matchedTargetTokens,
    matchedChunks: matches.length
  })

  return result
}

/**
 * Fetch all chunks for a document from Supabase
 * Returns chunks with pre-normalized embeddings
 */
async function fetchDocumentChunks(
  documentId: string,
  options: { pageRange?: { start_page: number; end_page: number } } = {}
): Promise<Chunk[]> {
  const supabase = await createServiceClient()

  const defaultPageSize = 100
  let currentPageSize = defaultPageSize
  let start = 0
  const allChunks: {
    chunk_index: number
    page_number: number | null
    embedding: number[] | string
    chunk_text: string | null
    token_count: number | null
  }[] = []

  while (true) {
    const pageSizeUsed = currentPageSize
    const end = start + pageSizeUsed - 1

    let query = supabase
      .from('document_embeddings')
      .select('chunk_index, page_number, embedding, chunk_text, token_count')
      .eq('document_id', documentId)

    if (options.pageRange) {
      query = query
        .gte('page_number', options.pageRange.start_page)
        .lte('page_number', options.pageRange.end_page)
    }

    const { data, error } = await query
      .order('chunk_index', { ascending: true })
      .range(start, end)
      .returns<Array<{
        chunk_index: number | null
        page_number: number | null
        embedding: number[] | string
        chunk_text: string | null
        token_count: number | null
      }>>()

    if (error) {
      if ((error as { code?: string }).code === '57014' && currentPageSize > 25) {
        currentPageSize = Math.max(25, Math.floor(currentPageSize / 2))
        logger.warn('Stage 2: chunk fetch timeout, reducing page size', {
          documentId,
          nextPageSize: currentPageSize
        })
        continue
      }
      logger.error(
        'Stage 2: failed to fetch chunks',
        error instanceof Error ? error : new Error(String(error)),
        { documentId }
      )
      return []
    }

    if (!data || data.length === 0) {
      break
    }

    const sanitized = data
      .filter(record => typeof record.chunk_index === 'number')
      .map(record => ({
        chunk_index: record.chunk_index as number,
        page_number: typeof record.page_number === 'number' ? record.page_number : null,
        embedding: record.embedding,
        chunk_text: record.chunk_text,
        token_count: typeof record.token_count === 'number' ? record.token_count : null
      }))

    allChunks.push(...sanitized)
    start += data.length
    currentPageSize = defaultPageSize

    if (data.length < pageSizeUsed) {
      break
    }
  }

  if (allChunks.length === 0) {
    return []
  }

  // CRITICAL: Deduplicate chunks by chunk_index (some documents have duplicates)
  const seen = new Set<number>()
  const uniqueChunks = allChunks.reduce<Array<{
    chunk_index: number
    page_number: number | null
    embedding: number[] | string
    chunk_text: string | null
    token_count: number | null
  }>>((acc, chunk) => {
    if (typeof chunk.chunk_index !== 'number') {
      return acc
    }
    if (seen.has(chunk.chunk_index)) {
      return acc
    }
    seen.add(chunk.chunk_index)
    acc.push({
      chunk_index: chunk.chunk_index,
      page_number: typeof chunk.page_number === 'number' ? chunk.page_number : null,
      embedding: chunk.embedding,
      chunk_text: typeof chunk.chunk_text === 'string' ? chunk.chunk_text : null,
      token_count: typeof chunk.token_count === 'number' ? chunk.token_count : null
    })
    return acc
  }, [])

  logger.info('Stage 2: fetched candidate chunks', {
    documentId,
    totalChunks: allChunks.length,
    uniqueChunks: uniqueChunks.length
  })

  const normalizedChunks: Chunk[] = []

  for (const chunk of uniqueChunks) {
    let embeddingValue: unknown = chunk.embedding

    if (typeof embeddingValue === 'string') {
      try {
        embeddingValue = JSON.parse(embeddingValue)
      } catch (parseError) {
        logger.error(
          'Stage 2: failed to parse chunk embedding',
          parseError instanceof Error ? parseError : new Error(String(parseError)),
          { documentId, chunkIndex: chunk.chunk_index }
        )
        continue
      }
    }

    if (!Array.isArray(embeddingValue) || !embeddingValue.every(value => typeof value === 'number')) {
      logger.error(
        'Stage 2: chunk embedding is not a numeric array',
        undefined,
        { documentId, chunkIndex: chunk.chunk_index }
      )
      continue
    }

    // Calculate token count (use stored value or estimate from text)
    let tokenCount: number
    if (typeof chunk.token_count === 'number' && chunk.token_count > 0) {
      tokenCount = chunk.token_count
    } else if (chunk.chunk_text) {
      // Fallback: estimate tokens as text.length / 4
      tokenCount = Math.ceil(chunk.chunk_text.length / 4)
    } else {
      // Last resort: assume minimum token count
      tokenCount = 1
    }

    normalizedChunks.push({
      id: `${documentId}_chunk_${chunk.chunk_index}`,
      index: chunk.chunk_index,
      pageNumber: chunk.page_number || 1,
      embedding: embeddingValue as number[],
      text: chunk.chunk_text ?? undefined,
      tokenCount
    })
  }

  if (normalizedChunks.length === 0) {
    logger.warn('Stage 2: no valid chunk embeddings after parsing', { documentId })
    return []
  }

  return normalizedChunks
}

/**
 * Fetch document metadata from Supabase
 */
async function fetchDocumentMetadata(documentId: string): Promise<Stage2DocumentRecord> {
  const supabase = await createServiceClient()

  const { data: doc, error } = await supabase
    .from('documents')
    .select('*')
    .eq('id', documentId)
    .single()

  if (error || !doc) {
    throw new Error(`Document not found: ${documentId}`)
  }

  return doc as Stage2DocumentRecord
}
