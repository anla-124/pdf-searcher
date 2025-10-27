import { Pinecone } from '@pinecone-database/pinecone'
import { createServiceClient } from '@/lib/supabase/server'
import type { 
  BusinessMetadata 
} from '@/types/external-apis'

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
    
    console.warn(`✅ Indexed document chunk ${id}`)
  } catch (error) {
    console.error(`❌ Failed to index document chunk ${id}:`, error)
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

    console.warn(`🔍 Found ${results.length} similar documents for ${documentId}`)
    return results

  } catch (error) {
    console.error(`❌ Similarity search failed for ${documentId}:`, error)
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

    console.warn(`🔍 Vector search returned ${results.length} results`)
    return results

  } catch (error) {
    console.error(`❌ Vector search failed:`, error)
    throw error
  }
}

/**
 * Delete document vectors from Pinecone
 */
export async function deleteDocumentFromPinecone(documentId: string): Promise<void> {
  try {
    // 1. Get all vector IDs from the database for this document
    // CRITICAL: Override Supabase's default 1000 row limit to get ALL chunks
    const supabase = await createServiceClient()
    const { data: chunks, error: dbError } = await supabase
      .from('document_embeddings')
      .select('chunk_index')
      .eq('document_id', documentId)
      .range(0, 999999) // Override default 1000 row limit

    if (dbError) {
      throw new Error(`Failed to fetch chunk info for deletion from database: ${dbError.message}`)
    }

    if (!chunks || chunks.length === 0) {
      console.warn(`No chunks found in database for document ${documentId}, no vectors to delete from Pinecone.`)
      return // Nothing to delete
    }

    const vectorIds = chunks.map(chunk => `${documentId}_chunk_${chunk.chunk_index}`)

    if (vectorIds.length === 0) {
      console.warn(`No vector IDs computed for document ${documentId}, skipping Pinecone deletion.`)
      return
    }

    // 2. Delete vectors from Pinecone by ID in batches (Pinecone limit: 1000 per call)
    const BATCH_SIZE = 1000
    let totalAttempted = 0

    for (let i = 0; i < vectorIds.length; i += BATCH_SIZE) {
      const batch = vectorIds.slice(i, i + BATCH_SIZE)
      await getPineconeIndex().deleteMany(batch)
      totalAttempted += batch.length

      if (vectorIds.length > BATCH_SIZE) {
        console.warn(`  Deleted batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(vectorIds.length / BATCH_SIZE)}: ${batch.length} vector IDs`)
      }
    }

    console.warn(`✅ Attempted to delete ${totalAttempted} vectors for document ${documentId} from Pinecone (based on ${chunks.length} database records)`)
  } catch (error) {
    console.error(`❌ Failed to delete vectors for document ${documentId}:`, error)
    throw error
  }
}

/**
 * Update document metadata in Pinecone
 */
export async function updateDocumentMetadataInPinecone(
  documentId: string,
  newMetadata: Record<string, unknown>
): Promise<void> {
  try {
    console.warn(`📝 Starting Pinecone metadata update for document ${documentId}`)
    
    // 1. Get all vector IDs from the database
    // CRITICAL: Override Supabase's default 1000 row limit to get ALL chunks
    const supabase = await createServiceClient()
    const { data: chunks, error: dbError } = await supabase
      .from('document_embeddings')
      .select('chunk_index')
      .eq('document_id', documentId)
      .range(0, 999999) // Override default 1000 row limit

    if (dbError) {
      throw new Error(`Failed to fetch chunk info from database: ${dbError.message}`)
    }

    if (!chunks || chunks.length === 0) {
      console.warn(`No chunks found for document ${documentId}, skipping Pinecone update.`)
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
      console.warn(`No vectors found in Pinecone for document ${documentId}, skipping update.`)
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

    console.warn(`✅ Successfully updated metadata for ${updatedVectors.length} vectors in Pinecone for document ${documentId}`)
    
  } catch (error) {
    console.error(`❌ Failed to update metadata for document ${documentId}:`, error)
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
      console.warn(`🔍 Fetching vectors for document ${documentId}, pages ${pageRange.start_page}-${pageRange.end_page}`)
    }

    const queryResponse = await getPineconeIndex().query({
      vector: dummyVector,
      topK: pageRange ? 10000 : 1, // Get all vectors if page range specified, otherwise just first
      filter,
      includeValues: true,
      includeMetadata: pageRange ? true : false
    })

    if (!queryResponse.matches || queryResponse.matches.length === 0) {
      console.warn(`⚠️ No vectors found for document ${documentId}${pageRange ? ` in page range ${pageRange.start_page}-${pageRange.end_page}` : ''}`)
      return null
    }

    // If page range specified, compute centroid of all matching vectors
    if (pageRange && queryResponse.matches.length > 1) {
      const vectors = queryResponse.matches
        .filter(m => m.values && m.values.length > 0)
        .map(m => m.values as number[])

      if (vectors.length === 0) return null

      console.warn(`📊 Computing centroid from ${vectors.length} vectors in page range ${pageRange.start_page}-${pageRange.end_page}`)

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
    console.error(`❌ Failed to get vector for document ${documentId}:`, error)
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
    console.error('❌ Failed to get Pinecone stats:', error)
    return null
  }
}
