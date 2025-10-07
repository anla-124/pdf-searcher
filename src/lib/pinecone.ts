import { Pinecone } from '@pinecone-database/pinecone'
import { createServiceClient } from '@/lib/supabase/server'
import type { 
  BusinessMetadata 
} from '@/types/external-apis'

// Simple Pinecone client without complex pooling
const pinecone = new Pinecone({
  apiKey: process.env['PINECONE_API_KEY']!,
})

const index = pinecone.Index(process.env['PINECONE_INDEX_NAME']!)

export interface SimilaritySearchResult {
  id: string
  score: number
  document_id: string
  text: string
  metadata?: BusinessMetadata
}

/**
 * Index a document chunk in Pinecone
 */
export async function indexDocumentInPinecone(
  id: string,
  vector: number[],
  metadata: Record<string, any>
): Promise<void> {
  try {
    const sanitizedMetadata: Record<string, string | number | boolean | string[]> = {}

    for (const [key, value] of Object.entries(metadata)) {
      if (value === null || value === undefined) continue

      if (Array.isArray(value)) {
        const filtered = value
          .filter(item => item !== null && item !== undefined)
          .map(item => (typeof item === 'string' ? item : String(item)))

        if (filtered.length > 0) {
          sanitizedMetadata[key] = filtered
        }
        continue
      }

      if (typeof value === 'object') {
        sanitizedMetadata[key] = JSON.stringify(value)
        continue
      }

      sanitizedMetadata[key] = value as string | number | boolean
    }

    await index.upsert([{
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
    filter?: Record<string, any>
    threshold?: number
    userId?: string
  } = {}
): Promise<SimilaritySearchResult[]> {
  try {
    const { topK = 10, filter = {}, threshold = 0.7 } = options

    // Get the vector for the source document
    const sourceVector = await getDocumentVector(documentId)
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

    const queryResponse = await index.query(queryRequest)
    
    // Filter results by threshold and format
    const results = queryResponse.matches
      ?.filter(match => match.score !== undefined && match.score >= threshold)
      ?.slice(0, topK)
      ?.map(match => ({
        id: match.id,
        score: match.score!,
        document_id: (match.metadata as any)?.document_id as string,
        text: (match.metadata as any)?.text as string,
        metadata: match.metadata as BusinessMetadata
      })) || []

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
    filter?: Record<string, any>
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

    const queryResponse = await index.query(queryRequest)
    
    // Filter and format results
    const results = queryResponse.matches
      ?.filter(match => match.score !== undefined && match.score >= threshold)
      ?.map(match => ({
        id: match.id,
        score: match.score!,
        document_id: (match.metadata as any)?.document_id as string,
        text: (match.metadata as any)?.text as string,
        metadata: match.metadata as BusinessMetadata
      })) || []

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
    const supabase = await createServiceClient()
    const { data: chunks, error: dbError } = await supabase
      .from('document_embeddings')
      .select('chunk_index')
      .eq('document_id', documentId)

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

    // 2. Delete vectors from Pinecone by ID using the v6 SDK
    await index.deleteMany(vectorIds)
    
    console.warn(`✅ Deleted ${vectorIds.length} vectors for document ${documentId} from Pinecone`)
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
  newMetadata: Record<string, any>
): Promise<void> {
  try {
    console.warn(`📝 Starting Pinecone metadata update for document ${documentId}`)
    
    // 1. Get all vector IDs from the database
    const supabase = await createServiceClient()
    const { data: chunks, error: dbError } = await supabase
      .from('document_embeddings')
      .select('chunk_index')
      .eq('document_id', documentId)

    if (dbError) {
      throw new Error(`Failed to fetch chunk info from database: ${dbError.message}`)
    }

    if (!chunks || chunks.length === 0) {
      console.warn(`No chunks found for document ${documentId}, skipping Pinecone update.`)
      return
    }

    const vectorIds = chunks.map(chunk => `${documentId}_chunk_${chunk.chunk_index}`)
    
    // 2. Fetch the full vectors from Pinecone
    const fetchResponse = await index.fetch(vectorIds)
    const vectors = Object.values(fetchResponse.records)

    if (vectors.length === 0) {
      console.warn(`No vectors found in Pinecone for document ${documentId}, skipping update.`)
      return
    }

    // 3. Prepare updated vectors for upsert
    const updatedVectors = vectors.map(vector => {
      const existingMetadata = vector.metadata || {}
      return {
        id: vector.id,
        values: vector.values,
        metadata: {
          ...existingMetadata,
          ...newMetadata
        }
      }
    })

    // 4. Upsert the vectors back into Pinecone
    await index.upsert(updatedVectors)

    console.warn(`✅ Successfully updated metadata for ${updatedVectors.length} vectors in Pinecone for document ${documentId}`)
    
  } catch (error) {
    console.error(`❌ Failed to update metadata for document ${documentId}:`, error)
    // In a production scenario, you might want to queue this for a retry
    throw error
  }
}

/**
 * Get document vector by ID
 */
async function getDocumentVector(documentId: string): Promise<number[] | null> {
  try {
    // Use a dummy vector to query for this document's vectors
    // Create a zero vector of dimension 1536 (OpenAI embedding dimension)
    const dummyVector = new Array(768).fill(0)
    
    const queryResponse = await index.query({
      vector: dummyVector,
      topK: 1,
      filter: {
        document_id: { $eq: documentId }
      },
      includeValues: true,
      includeMetadata: false
    })

    if (queryResponse.matches && queryResponse.matches.length > 0 && queryResponse.matches[0] && queryResponse.matches[0].values) {
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
    const stats = await index.describeIndexStats()
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
