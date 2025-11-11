import { Pinecone } from '@pinecone-database/pinecone'
import { createServiceClient, releaseServiceClient } from '@/lib/supabase/server'
import type {
  BusinessMetadata
} from '@/types/external-apis'
import { logger } from '@/lib/logger'

// Lazy initialization to avoid errors during build
let pinecone: Pinecone | null = null
let index: ReturnType<Pinecone['Index']> | null = null

function getPineconeClient() {
  if (!pinecone) {
    pinecone = new Pinecone({
      apiKey: process.env['PINECONE_API_KEY']!,
    })
  }
  return pinecone
}

export function getPineconeIndex() {
  if (!index) {
    index = getPineconeClient().Index(process.env['PINECONE_INDEX_NAME']!)
  }
  return index
}

export interface SimilaritySearchResult {
  id: string
  score: number
  document_id: string
  text: string
  metadata?: BusinessMetadata
}

type PineconeMetadata = Record<string, unknown>

type PineconeVectorRecord = {
  id: string
  values: number[]
  metadata?: PineconeMetadata
}

type SanitizedMetadata = Record<string, string | number | boolean | string[]>

const sanitizeMetadata = (metadata: Record<string, unknown>): SanitizedMetadata => {
  const sanitized: SanitizedMetadata = {}

  for (const [key, value] of Object.entries(metadata)) {
    if (value === null || value === undefined) continue

    if (Array.isArray(value)) {
      const filtered = value
        .filter(item => item !== null && item !== undefined)
        .map(item => (typeof item === 'string' ? item : String(item)))

      if (filtered.length > 0) {
        sanitized[key] = filtered
      }
      continue
    }

    if (typeof value === 'object') {
      sanitized[key] = JSON.stringify(value)
      continue
    }

    sanitized[key] = value as string | number | boolean
  }

  return sanitized
}

/**
 * Index a document chunk in Pinecone
 */
export async function indexDocumentInPinecone(
  id: string,
  vector: number[],
  metadata: Record<string, unknown>
): Promise<void> {
  try {
    const sanitizedMetadata = sanitizeMetadata(metadata)

    await getPineconeIndex().upsert([{
      id,
      values: vector,
      metadata: sanitizedMetadata
    }])

    logger.info('Indexed document chunk in Pinecone', { chunkId: id })
  } catch (error) {
    logger.error('Failed to index document chunk in Pinecone', error as Error, { chunkId: id })
    throw error
  }
}

/**
 * Search for similar documents
 */
export async function searchSimilarDocuments(
  documentId: string,
  options: {
    topK?: number
    filter?: Record<string, unknown>
    threshold?: number
    userId?: string
    pageRange?: {
      start_page: number
      end_page: number
    }
  } = {}
): Promise<SimilaritySearchResult[]> {
  try {
    const { topK = 10, filter = {}, threshold = 0.7, pageRange } = options

    // Get the vector for the source document (with optional page range)
    const sourceVector = await getDocumentVector(documentId, pageRange)
    if (!sourceVector) {
      throw new Error(`No vector found for document ${documentId}`)
    }

    // Search for similar vectors
    const queryRequest = {
      vector: sourceVector,
      topK: topK + 10, // Get extra results to filter out self-matches
      filter: {
        ...filter,
        document_id: { $ne: documentId } // Exclude the source document
      },
      includeMetadata: true,
      includeValues: false
    }

    const queryResponse = await getPineconeIndex().query(queryRequest)
    
    // Filter results by threshold and format
    const filteredMatches = queryResponse.matches
      ?.filter(match => match.score !== undefined && match.score >= threshold)
      ?.slice(0, topK) ?? []

    const results: SimilaritySearchResult[] = []

    for (const match of filteredMatches) {
      const metadata = match.metadata as Record<string, unknown> | undefined
      const metadataDocumentId = metadata?.document_id
      if (typeof metadataDocumentId !== 'string') {
        continue
      }

      const metadataRecord = (metadata ?? {}) as Record<string, unknown>
      const metadataText = metadataRecord.text

      results.push({
        id: match.id,
        score: match.score!,
        document_id: metadataDocumentId,
        text: typeof metadataText === 'string' ? metadataText : '',
        metadata: metadataRecord as BusinessMetadata
      })
    }

    logger.info('Similarity search completed', { sourceDocumentId: documentId, resultsCount: results.length })
    return results

  } catch (error) {
    logger.error('Similarity search failed', error as Error, { documentId })
    throw error
  }
}

/**
 * Vector search with query text
 */
export async function vectorSearch(
  queryVector: number[],
  options: {
    topK?: number
    filter?: Record<string, unknown>
    threshold?: number
  } = {}
): Promise<SimilaritySearchResult[]> {
  try {
    const { topK = 20, filter = {}, threshold = 0.7 } = options

    const queryRequest = {
      vector: queryVector,
      topK,
      filter,
      includeMetadata: true,
      includeValues: false
    }

    const queryResponse = await getPineconeIndex().query(queryRequest)
    
    // Filter and format results
    const filteredMatches = queryResponse.matches
      ?.filter(match => match.score !== undefined && match.score >= threshold) ?? []

    const results: SimilaritySearchResult[] = []

    for (const match of filteredMatches) {
      const metadata = match.metadata as Record<string, unknown> | undefined
      const metadataDocumentId = metadata?.document_id
      if (typeof metadataDocumentId !== 'string') {
        continue
      }

      const metadataRecord = (metadata ?? {}) as Record<string, unknown>
      const metadataText = metadataRecord.text

      results.push({
        id: match.id,
        score: match.score!,
        document_id: metadataDocumentId,
        text: typeof metadataText === 'string' ? metadataText : '',
        metadata: metadataRecord as BusinessMetadata
      })
    }

    logger.info('Vector search completed', { resultsCount: results.length })
    return results

  } catch (error) {
    logger.error('Vector search failed', error as Error)
    throw error
  }
}

/**
 * Delete document vectors from Pinecone
 */
export async function deleteDocumentFromPinecone(documentId: string, presetVectorIds?: string[]): Promise<void> {
  try {
    const vectorIds = Array.isArray(presetVectorIds) && presetVectorIds.length > 0
      ? [...presetVectorIds]
      : await fetchVectorIdsFromSupabase(documentId)

    if (!vectorIds || vectorIds.length === 0) {
      logger.warn('No vector IDs available for document deletion', { documentId })
      return
    }

    const BATCH_SIZE = 1000
    let totalAttempted = 0

    for (let i = 0; i < vectorIds.length; i += BATCH_SIZE) {
      const batch = vectorIds.slice(i, i + BATCH_SIZE)
      await getPineconeIndex().deleteMany(batch)
      totalAttempted += batch.length

      if (vectorIds.length > BATCH_SIZE) {
        logger.info('Deleted vector batch', {
          documentId,
          batchNumber: Math.floor(i / BATCH_SIZE) + 1,
          totalBatches: Math.ceil(vectorIds.length / BATCH_SIZE),
          batchSize: batch.length
        })
      }
    }

    logger.info('Successfully deleted all vectors from Pinecone', { documentId, vectorsDeleted: totalAttempted })
  } catch (error) {
    logger.error('Failed to delete vectors from Pinecone', error as Error, { documentId })
    throw error
  }
}

async function fetchVectorIdsFromSupabase(documentId: string): Promise<string[] | null> {
  const supabase = await createServiceClient()
  try {
    const { data: chunks, error: dbError } = await supabase
      .from('document_embeddings')
      .select('chunk_index')
      .eq('document_id', documentId)
      .range(0, 999999)

    if (dbError) {
      throw new Error(`Failed to fetch chunk info for deletion from database: ${dbError.message}`)
    }

    if (!chunks || chunks.length === 0) {
      return null
    }

    return chunks.map(chunk => `${documentId}_chunk_${chunk.chunk_index}`)
  } finally {
    releaseServiceClient(supabase)
  }
}

export async function getVectorIdsForDocument(documentId: string): Promise<string[]> {
  const ids = await fetchVectorIdsFromSupabase(documentId)
  return Array.isArray(ids) ? ids : []
}

/**
 * Update document metadata in Pinecone
 */
export async function updateDocumentMetadataInPinecone(
  documentId: string,
  newMetadata: Record<string, unknown>
): Promise<void> {
  try {
    logger.info('Starting Pinecone metadata update', { documentId })

    // 1. Get all vector IDs from the database
    // CRITICAL: Override Supabase's default 1000 row limit to get ALL chunks
    const supabase = await createServiceClient()
    try {
      const { data: chunks, error: dbError } = await supabase
        .from('document_embeddings')
        .select('chunk_index')
        .eq('document_id', documentId)
        .range(0, 999999) // Override default 1000 row limit

      if (dbError) {
        throw new Error(`Failed to fetch chunk info from database: ${dbError.message}`)
      }

      if (!chunks || chunks.length === 0) {
        logger.warn('No chunks found for Pinecone metadata update', { documentId })
        return
      }

      const vectorIds = chunks.map(chunk => `${documentId}_chunk_${chunk.chunk_index}`)

    // 2. Fetch the full vectors from Pinecone in batches to avoid URL length limits
    // Pinecone supports up to 1000 vectors per fetch, but we use smaller batches to avoid 414 errors
    const BATCH_SIZE = 50
    const vectors: PineconeVectorRecord[] = []

    for (let i = 0; i < vectorIds.length; i += BATCH_SIZE) {
      const batch = vectorIds.slice(i, i + BATCH_SIZE)
      const fetchResponse = await getPineconeIndex().fetch(batch)
      const fetchedRecords = Object.values(fetchResponse.records ?? {}) as PineconeVectorRecord[]
      vectors.push(...fetchedRecords)
    }

    if (vectors.length === 0) {
      logger.warn('No vectors found in Pinecone for metadata update', { documentId })
      return
    }

    // 3. Prepare updated vectors for upsert
    const updatedVectors = vectors.map(vector => {
      const existingMetadata = vector.metadata ?? {}
      return {
        id: vector.id,
        values: vector.values,
        metadata: sanitizeMetadata({
          ...existingMetadata,
          ...newMetadata
        })
      }
    })

    // 4. Upsert the vectors back into Pinecone
    await getPineconeIndex().upsert(updatedVectors)

      logger.info('Successfully updated metadata in Pinecone', { documentId, vectorsUpdated: updatedVectors.length })

    } finally {
      releaseServiceClient(supabase)
    }
  } catch (error) {
    logger.error('Failed to update Pinecone metadata', error as Error, { documentId })
    // In a production scenario, you might want to queue this for a retry
    throw error
  }
}

/**
 * Get document vector by ID
 * If pageRange is provided, returns the centroid (average) of vectors within that page range
 * Otherwise, returns the first chunk's vector
 */
async function getDocumentVector(
  documentId: string,
  pageRange?: {
    start_page: number
    end_page: number
  }
): Promise<number[] | null> {
  try {
    // Use a dummy vector to query for this document's vectors
    // Create a zero vector of dimension 768 (Vertex AI embedding dimension)
    const dummyVector = new Array(768).fill(0)

    // Build filter with optional page range
    const filter: Record<string, unknown> = {
      document_id: { $eq: documentId }
    }

    if (pageRange) {
      filter['page_number'] = {
        $gte: pageRange.start_page,
        $lte: pageRange.end_page
      }
      logger.info('Fetching vectors with page range', {
        documentId,
        startPage: pageRange.start_page,
        endPage: pageRange.end_page
      })
    }

    const queryResponse = await getPineconeIndex().query({
      vector: dummyVector,
      topK: pageRange ? 10000 : 1, // Get all vectors if page range specified, otherwise just first
      filter,
      includeValues: true,
      includeMetadata: pageRange ? true : false
    })

    if (!queryResponse.matches || queryResponse.matches.length === 0) {
      logger.warn('No vectors found for document', {
        documentId,
        pageRange: pageRange ? `${pageRange.start_page}-${pageRange.end_page}` : undefined
      })
      return null
    }

    // If page range specified, compute centroid of all matching vectors
    if (pageRange && queryResponse.matches.length > 1) {
      const vectors = queryResponse.matches
        .filter(m => m.values && m.values.length > 0)
        .map(m => m.values as number[])

      if (vectors.length === 0) return null

      logger.info('Computing centroid from page range vectors', {
        documentId,
        vectorCount: vectors.length,
        startPage: pageRange.start_page,
        endPage: pageRange.end_page
      })

      const firstVector = vectors[0]
      if (!firstVector) return null

      const dimension = firstVector.length
      const centroid = new Array(dimension).fill(0)

      // Sum all vectors
      for (const vector of vectors) {
        for (let i = 0; i < dimension; i++) {
          centroid[i] += vector[i]
        }
      }

      // Average
      for (let i = 0; i < dimension; i++) {
        centroid[i] /= vectors.length
      }

      // L2 normalization for cosine similarity
      const magnitude = Math.sqrt(centroid.reduce((sum, val) => sum + val * val, 0))
      if (magnitude > 0) {
        for (let i = 0; i < dimension; i++) {
          centroid[i] /= magnitude
        }
      }

      return centroid
    }

    // Otherwise, return first chunk's vector
    if (queryResponse.matches[0] && queryResponse.matches[0].values) {
      return queryResponse.matches[0].values as number[]
    }

    return null
  } catch (error) {
    logger.error('Failed to get vector for document', error as Error, { documentId })
    return null
  }
}

/**
 * Get index statistics
 */
export async function getPineconeStats() {
  try {
    const stats = await getPineconeIndex().describeIndexStats()
    return {
      totalVectorCount: stats.totalRecordCount,
      dimension: stats.dimension,
      indexFullness: stats.indexFullness
    }
  } catch (error) {
    logger.error('Failed to get Pinecone stats', error as Error)
    return null
  }
}
