/**
 * Main Orchestrator: 3-Stage Similarity Search Pipeline
 * Coordinates Stage 0 → Stage 1 → Stage 2 for production-ready similarity search
 *
 * Pipeline Flow:
 * 1. Stage 0: Document centroid filtering (2000 → ~600 candidates, ~5s)
 * 2. Stage 1: Candidate-aware chunk-level ANN (auto-skipped for ≤250 candidates)
 * 3. Stage 2: Parallel adaptive scoring with sections (250 → 30 results, ≤300s)
 *
 * Total: ~20-55 seconds for complete similarity search
 */

import { logger } from '@/lib/logger'
import { createServiceClient, releaseServiceClient } from '@/lib/supabase/server'
import { stage0CandidateRetrieval } from './stages/stage0-candidate-retrieval'
import { stage1ChunkPrefilter } from './stages/stage1-chunk-prefilter'
import { stage2FinalScoring } from './stages/stage2-final-scoring'
import { SimilarityResult, Chunk, Stage1Result } from './types'
import { countCharacters } from '@/lib/chunking/paragraph-chunker'

interface SupabaseDocumentRecord {
  id: string
  effective_chunk_count: number | null
  total_characters: number | null
  [key: string]: unknown
}

export interface SimilaritySearchOptions {
  // Stage 0 options
  stage0_topK?: number              // Default: 600
  stage0_filters?: Record<string, unknown>

  // Stage 1 options
  stage1_topK?: number              // Default: 250
  stage1_neighborsPerChunk?: number // Optional override; defaults scale 36-60 based on candidate load
  stage1_batchSize?: number         // Default: 150
  stage1_enabled?: boolean          // Default: true (auto-bypassed when candidate count ≤ topK)

  // Stage 2 options
  stage2_parallelWorkers?: number   // Default: 28
  stage2_threshold?: number         // Default: 0.85
  stage2_fallbackThreshold?: number // Default: 0.8 (auto-clamped if > threshold)
  stage2_fallbackEnabled?: boolean  // Default: true
  stage2_timeout?: number           // Default: 180000ms

  // Source scope options
  sourcePageRange?: {
    start_page: number
    end_page: number
  }
}

export interface SimilaritySearchResult {
  results: SimilarityResult[]
  timing: {
    stage0_ms: number
    stage1_ms: number
    stage2_ms: number
    total_ms: number
  }
  stages: {
    stage0_candidates: number
    stage1_candidates: number
    final_results: number
  }
}

/**
 * Execute complete 3-stage similarity search
 *
 * @param sourceDocId - ID of source document to find similar documents for
 * @param options - Configuration options for all stages
 * @returns Similarity results with timing breakdown
 */
export async function executeSimilaritySearch(
  sourceDocId: string,
  options: SimilaritySearchOptions = {}
): Promise<SimilaritySearchResult> {

  const totalStartTime = Date.now()

  try {
    logger.info('Starting similarity search pipeline', { sourceDocId })

    const sourcePageRange = options.sourcePageRange
    let preloadedSourceChunks: Chunk[] | undefined
    let sourceVectorOverride: number[] | undefined

    if (sourcePageRange) {
      logger.info('Applying source page range constraint', {
        sourceDocId,
        startPage: sourcePageRange.start_page,
        endPage: sourcePageRange.end_page
      })

      preloadedSourceChunks = await fetchDocumentChunks(sourceDocId, { pageRange: sourcePageRange })

      if (preloadedSourceChunks.length === 0) {
        throw new Error(
          `Source document ${sourceDocId} has no embeddings within pages ` +
          `${sourcePageRange.start_page}-${sourcePageRange.end_page}`
        )
      }

      sourceVectorOverride = computeCentroidFromChunks(preloadedSourceChunks)
    }

    // ============================================================
    // STAGE 0: Document-Level Centroid Candidate Retrieval
    // ============================================================
    logger.info('Stage 0: document centroid filtering started', { sourceDocId })

    const stage0Result = await stage0CandidateRetrieval(sourceDocId, {
      topK: options.stage0_topK ?? 600,
      filters: options.stage0_filters ?? {},
      overrideSourceVector: sourceVectorOverride,
      sourcePageRange
    })

    if (stage0Result.candidateIds.length === 0) {
      logger.warn('Stage 0 found no candidates; returning empty results', { sourceDocId })
      return {
        results: [],
        timing: {
          stage0_ms: stage0Result.timeMs,
          stage1_ms: 0,
          stage2_ms: 0,
          total_ms: Date.now() - totalStartTime
        },
        stages: {
          stage0_candidates: 0,
          stage1_candidates: 0,
          final_results: 0
        }
      }
    }

    // ============================================================
    // STAGE 1: Candidate-Aware Chunk-Level Pre-Filter
    // ============================================================
    let sourceChunks = preloadedSourceChunks

    if (!sourceChunks) {
      sourceChunks = await fetchDocumentChunks(sourceDocId)
    }

    if (sourceChunks.length === 0) {
      throw new Error(`Source document ${sourceDocId} has no chunks`)
    }

    const stage1TopK = options.stage1_topK ?? 250
    const stage1Enabled = options.stage1_enabled ?? true
    const shouldRunStage1 = stage1Enabled && stage0Result.candidateIds.length > stage1TopK

    let stage1Result: Stage1Result

    if (shouldRunStage1) {
      logger.info('Stage 1: chunk-level pre-filtering started', { sourceDocId })

      stage1Result = await stage1ChunkPrefilter(
        sourceChunks,
        stage0Result.candidateIds,  // CRITICAL: Only candidates from Stage 0!
        {
          topK: stage1TopK,
          neighborsPerChunk: determineStage1NeighborsPerChunk(
            stage0Result.candidateIds.length,
            options.stage1_neighborsPerChunk
          ),
          batchSize: options.stage1_batchSize ?? 150
        }
      )

      if (stage1Result.candidateIds.length === 0) {
        logger.warn('Stage 1 filtering produced no candidates; returning empty results', { sourceDocId })
        return {
          results: [],
          timing: {
            stage0_ms: stage0Result.timeMs,
            stage1_ms: stage1Result.timeMs,
            stage2_ms: 0,
            total_ms: Date.now() - totalStartTime
          },
          stages: {
            stage0_candidates: stage0Result.candidateIds.length,
            stage1_candidates: 0,
            final_results: 0
          }
        }
      }
    } else {
      logger.info('Stage 1 skipped: candidate count within stage 2 capacity', {
        sourceDocId,
        candidateCount: stage0Result.candidateIds.length
      })

      stage1Result = {
        candidateIds: stage0Result.candidateIds,
        matchCounts: stage0Result.candidateIds.map(() => 0),
        timeMs: 0
      }
    }

    // ============================================================
    // STAGE 2: Parallel Final Scoring with Section Detection
    // ============================================================
    logger.info('Stage 2: final adaptive scoring started', { sourceDocId })

    // Fetch source document metadata (needed for Stage 2)
    const sourceDoc = await fetchDocumentMetadata(sourceDocId)

    if (!sourceDoc.effective_chunk_count) {
      logger.warn(
        'Source document missing effective_chunk_count; using chunk count from current scope',
        { sourceDocId }
      )
    }

    if (!sourceDoc.total_characters || sourceDoc.total_characters <= 0) {
      logger.warn(
        'Source document missing total_characters; using chunk-derived character total',
        { sourceDocId }
      )
    }

    const sourceTotalCharacters = sourceChunks.reduce((sum, chunk) => sum + chunk.characterCount, 0)

    if (sourceTotalCharacters <= 0) {
      throw new Error(
        `Source document ${sourceDocId} has no character content within the selected scope`
      )
    }

    const stage2Workers = determineStage2Workers(
      stage1Result.candidateIds.length,
      options.stage2_parallelWorkers
    )

    if (options.stage2_parallelWorkers !== undefined) {
      logger.info('Stage 2 worker override applied', {
        sourceDocId,
        workers: stage2Workers,
        mode: 'user-specified'
      })
    } else {
      logger.info('Stage 2 workers auto-selected', {
        sourceDocId,
        workers: stage2Workers,
        candidateCount: stage1Result.candidateIds.length
      })
    }

    const stage2Results = await stage2FinalScoring(
      {
        ...sourceDoc,
        effective_chunk_count: sourceChunks.length,
        total_characters: sourceTotalCharacters
      },
      stage1Result.candidateIds,  // Only candidates from Stage 1!
      {
        parallelWorkers: stage2Workers,
        threshold: options.stage2_threshold ?? 0.85,
        fallbackThreshold: options.stage2_fallbackThreshold ?? 0.8,
        fallbackEnabled: options.stage2_fallbackEnabled ?? true,
        timeout: options.stage2_timeout ?? 180000,
        sourceChunksOverride: sourceChunks,
        sourcePageRange
      }
    )

    // ============================================================
    // COMPLETE: Return Results with Timing
    // ============================================================
    const totalTimeMs = Date.now() - totalStartTime

    logger.info('Similarity search pipeline completed', {
      sourceDocId,
      totalTimeMs: totalTimeMs,
      stage0: {
        durationMs: stage0Result.timeMs,
        candidateCount: stage0Result.candidateIds.length
      },
      stage1: {
        durationMs: stage1Result.timeMs,
        candidateCount: stage1Result.candidateIds.length
      },
      stage2: {
        durationMs: totalTimeMs - stage0Result.timeMs - stage1Result.timeMs,
        resultCount: stage2Results.length
      }
    })

    return {
      results: stage2Results,
      timing: {
        stage0_ms: stage0Result.timeMs,
        stage1_ms: stage1Result.timeMs,
        stage2_ms: totalTimeMs - stage0Result.timeMs - stage1Result.timeMs,
        total_ms: totalTimeMs
      },
      stages: {
        stage0_candidates: stage0Result.candidateIds.length,
        stage1_candidates: stage1Result.candidateIds.length,
        final_results: stage2Results.length
      }
    }

  } catch (error) {
    const totalTimeMs = Date.now() - totalStartTime
    logger.error('Similarity search pipeline failed', error instanceof Error ? error : new Error(String(error)), {
      sourceDocId,
      durationMs: totalTimeMs
    })
    throw error
  }
}

function computeCentroidFromChunks(chunks: Chunk[]): number[] {
  if (!Array.isArray(chunks) || chunks.length === 0) {
    throw new Error('Cannot compute centroid from empty chunk collection')
  }

  const dimension = chunks[0]?.embedding.length ?? 0
  if (dimension === 0) {
    throw new Error('Chunk embeddings missing dimensions; cannot compute centroid')
  }

  const centroid = new Array(dimension).fill(0)

  for (const chunk of chunks) {
    if (!Array.isArray(chunk.embedding) || chunk.embedding.length !== dimension) {
      throw new Error('Inconsistent embedding dimension encountered while computing centroid')
    }
    for (let i = 0; i < dimension; i++) {
      centroid[i] += chunk.embedding[i]
    }
  }

  for (let i = 0; i < dimension; i++) {
    centroid[i] /= chunks.length
  }

  return centroid
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
  try {
    const defaultPageSize = 100
    let currentPageSize = defaultPageSize
    let start = 0
    const allChunks: {
      chunk_index: number
      page_number: number | null
      embedding: number[] | string
      chunk_text: string | null
      character_count: number | null
    }[] = []

    while (true) {
      const pageSizeUsed = currentPageSize
      const end = start + pageSizeUsed - 1

      let query = supabase
        .from('document_embeddings')
        .select('chunk_index, page_number, embedding, chunk_text, character_count')
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
          character_count: number | null
        }>>()

      if (error) {
        if ((error as { code?: string }).code === '57014' && currentPageSize > 25) {
          currentPageSize = Math.max(25, Math.floor(currentPageSize / 2))
          logger.warn('Supabase timeout fetching chunks; reducing page size', {
            documentId,
            nextPageSize: currentPageSize
          })
          continue
        }
        logger.error(
          'Failed to fetch chunks for document embeddings',
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
          character_count: typeof record.character_count === 'number' ? record.character_count : null
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
    const uniqueChunks = allChunks.filter(chunk => {
      if (seen.has(chunk.chunk_index)) {
        return false
      }
      seen.add(chunk.chunk_index)
      return true
    })

    if (allChunks.length !== uniqueChunks.length) {
      logger.warn('Found duplicate chunks when fetching document embeddings', {
        documentId,
        totalChunks: allChunks.length,
        uniqueChunks: uniqueChunks.length
      })
    }

    const normalizedChunks: Chunk[] = []

    for (const chunk of uniqueChunks) {
      let embeddingValue: unknown = chunk.embedding

      if (typeof embeddingValue === 'string') {
        try {
          embeddingValue = JSON.parse(embeddingValue)
        } catch (parseError) {
          logger.error(
            'Failed to parse chunk embedding',
            parseError instanceof Error ? parseError : new Error(String(parseError)),
            { documentId, chunkIndex: chunk.chunk_index }
          )
          continue
        }
      }

      if (!Array.isArray(embeddingValue) || !embeddingValue.every(value => typeof value === 'number')) {
        logger.error('Chunk embedding is not a numeric array', undefined, {
          documentId,
          chunkIndex: chunk.chunk_index,
          type: typeof embeddingValue
        })
        continue
      }

      const numericEmbedding = embeddingValue as number[]

      // Calculate character count (use stored value or calculate from text)
      let characterCount: number
      if (typeof chunk.character_count === 'number' && chunk.character_count > 0) {
        characterCount = chunk.character_count
      } else if (chunk.chunk_text) {
        // Fallback: calculate character count excluding spaces
        characterCount = countCharacters(chunk.chunk_text)
      } else {
        // Last resort: assume minimum character count
        characterCount = 1
      }

      normalizedChunks.push({
        id: `${documentId}_chunk_${chunk.chunk_index}`,
        index: chunk.chunk_index,
        pageNumber: chunk.page_number || 1,
        embedding: numericEmbedding,
        text: chunk.chunk_text ?? undefined,
        characterCount
      })
    }

    if (normalizedChunks.length === 0) {
      logger.warn('Fetched chunk data but none had valid embeddings', { documentId })
      return []
    }

    return normalizedChunks
  } finally {
    releaseServiceClient(supabase)
  }
}

/**
 * Fetch document metadata from Supabase
 */
async function fetchDocumentMetadata(documentId: string): Promise<SupabaseDocumentRecord> {
  const supabase = await createServiceClient()
  try {
    const { data: doc, error } = await supabase
      .from('documents')
      .select('*')
      .eq('id', documentId)
      .single()

    if (error || !doc) {
      throw new Error(`Document not found: ${documentId}`)
    }

    return doc as SupabaseDocumentRecord
  } finally {
    releaseServiceClient(supabase)
  }
}

/**
 * Quick validation: Check if document is ready for similarity search
 * Useful for pre-flight checks before executing full pipeline
 */
export async function validateDocumentForSimilarity(
  documentId: string
): Promise<{
  valid: boolean
  errors: string[]
  warnings: string[]
}> {

  const errors: string[] = []
  const warnings: string[] = []

  let supabase: Awaited<ReturnType<typeof createServiceClient>> | null = null
  try {
    supabase = await createServiceClient()

    // Check document exists and has required fields
    const { data: doc, error: docError } = await supabase
      .from('documents')
      .select('id, centroid_embedding, effective_chunk_count, embedding_model')
      .eq('id', documentId)
      .single()

    if (docError || !doc) {
      errors.push(`Document not found: ${documentId}`)
      return { valid: false, errors, warnings }
    }

    if (!doc.centroid_embedding) {
      errors.push('Missing centroid_embedding (run backfill or reprocess)')
    }

    if (!doc.effective_chunk_count) {
      errors.push('Missing effective_chunk_count (run backfill or reprocess)')
    }

    // Check chunks exist
    const { data: chunks, error: chunksError } = await supabase
      .from('document_embeddings')
      .select('chunk_index')
      .eq('document_id', documentId)
      .limit(1)

    if (chunksError || !chunks || chunks.length === 0) {
      errors.push('No embeddings found for document')
    }

    // Warnings (non-blocking)
    if (doc.embedding_model !== 'text-embedding-004') {
      warnings.push(`Unexpected embedding model: ${doc.embedding_model}`)
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings
    }

  } catch (error) {
    errors.push(`Validation error: ${error}`)
    return { valid: false, errors, warnings }
  } finally {
    if (supabase) {
      releaseServiceClient(supabase)
    }
  }
}

function determineStage1NeighborsPerChunk(
  candidateCount: number,
  override?: number
): number {
  if (override !== undefined) {
    return override
  }

  if (candidateCount <= 400) {
    return 36
  }
  if (candidateCount <= 600) {
    return 45
  }
  if (candidateCount <= 800) {
    return 54
  }
  return 60
}

function determineStage2Workers(
  candidateCount: number,
  override?: number
): number {
  if (override !== undefined) {
    return override
  }

  const autoscaled = Math.max(4, Math.ceil(candidateCount / 8))
  return Math.min(28, autoscaled)
}
