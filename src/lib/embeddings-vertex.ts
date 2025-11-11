// Google Vertex AI Embeddings - Free alternative to OpenAI
import { GoogleAuth } from 'google-auth-library'
import { getGoogleClientOptions } from '@/lib/google-credentials'
import type { VertexAIEmbeddingResponse } from '@/types/external-apis'
import { logger } from '@/lib/logger'

const clientOptions = getGoogleClientOptions()
const auth = new GoogleAuth({
  ...clientOptions,
  scopes: ['https://www.googleapis.com/auth/cloud-platform'],
})

export async function generateVertexEmbeddings(text: string): Promise<number[]> {
  try {
    const cleanedText = text.replace(/\n/g, ' ').trim()
    const truncatedText = cleanedText.substring(0, 3072) // Vertex AI limit
    
    if (!truncatedText) {
      throw new Error('Text is empty after cleaning')
    }

    logger.info('Generating Vertex AI embeddings', { textLength: truncatedText.length })

    const client = await auth.getClient()
    const projectId = process.env['GOOGLE_CLOUD_PROJECT_ID']!
    
    // Try the newer text-embedding model first
    let url = `https://us-central1-aiplatform.googleapis.com/v1/projects/${projectId}/locations/us-central1/publishers/google/models/text-embedding-004:predict`
    
    let requestData = {
      instances: [
        {
          content: truncatedText,
          task_type: 'RETRIEVAL_DOCUMENT'
        }
      ]
    }

    try {
      const response = await client.request({
        url,
        method: 'POST',
        data: requestData
      })

      const embeddings = (response.data as VertexAIEmbeddingResponse)?.predictions?.[0]?.embeddings?.values
      
      if (embeddings && Array.isArray(embeddings)) {
        return embeddings
      }
    } catch (modelError: unknown) {
      const status = modelError instanceof Error && 'status' in modelError ? (modelError as { status: number }).status : 'unknown'
      logger.warn('text-embedding-004 failed, trying gecko model', { status })

      // Fallback to gecko model with different structure
      url = `https://us-central1-aiplatform.googleapis.com/v1/projects/${projectId}/locations/us-central1/publishers/google/models/textembedding-gecko@001:predict`
      
      requestData = {
        instances: [
          {
            content: truncatedText,
            task_type: "RETRIEVAL_DOCUMENT"
          }
        ]
      }
    }

    const response = await client.request({
      url,
      method: 'POST',
      data: requestData
    })

    const embeddings = (response.data as VertexAIEmbeddingResponse)?.predictions?.[0]?.embeddings?.values
    
    if (!embeddings || !Array.isArray(embeddings)) {
      throw new Error('No embeddings returned from Vertex AI')
    }

    return embeddings
  } catch (error: unknown) {
    const statusCode = error instanceof Error && 'status' in error ? (error as { status: number }).status : undefined
    logger.error('Error generating Vertex AI embeddings', error as Error, { statusCode })

    
    if (statusCode === 403) {
      throw new Error('Vertex AI API not enabled. Enable it at: https://console.cloud.google.com/apis/library/aiplatform.googleapis.com')
    } else if (statusCode === 401) {
      throw new Error('Invalid Google Cloud credentials. Check your service account.')
    } else if (statusCode === 404) {
      throw new Error('Vertex AI model not found. The model may not be available in your region or project.')
    } else if (statusCode === 429) {
      throw new Error('Vertex AI rate limit exceeded. Please try again in a few minutes.')
    }
    
    throw new Error(`Failed to generate Vertex embeddings: ${error instanceof Error ? error.message : 'Unknown error'}`)
  }
}

// Main embedding function using Vertex AI
export async function generateEmbeddings(text: string): Promise<number[]> {
  return await generateVertexEmbeddings(text)
}

// Keep the old function name for compatibility
export const generateEmbeddingsWithFallback = generateEmbeddings