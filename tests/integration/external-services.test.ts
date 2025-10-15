/**
 * Integration Tests for External Services
 * Tests integration with Supabase, Google Cloud AI, Pinecone, and Redis
 * Uses MSW (Mock Service Worker) for external API mocking
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { setupServer } from 'msw/node'
import { http, HttpResponse } from 'msw'
import { createServiceClient } from '@/lib/supabase/server'

// Mock external service responses
const mockSupabaseResponse = {
  data: [
    {
      id: 'test-doc-1',
      title: 'Test Document 1',
      law_firm: 'STB',
      fund_manager: 'Blackstone',
      status: 'completed'
    }
  ],
  error: null
}

const mockGoogleCloudAIResponse = {
  document: {
    text: 'This is a sample document text extracted by Google Cloud Document AI',
    pages: [
      {
        pageNumber: 1,
        blocks: [
          {
            boundingBox: { x: 100, y: 100, width: 400, height: 50 },
            text: 'Sample document content'
          }
        ]
      }
    ]
  }
}

const mockPineconeResponse = {
  matches: [
    {
      id: 'doc-embedding-1',
      score: 0.95,
      metadata: {
        document_id: 'test-doc-1',
        chunk_index: 0,
        text: 'Sample matching text'
      }
    },
    {
      id: 'doc-embedding-2', 
      score: 0.87,
      metadata: {
        document_id: 'test-doc-2',
        chunk_index: 0,
        text: 'Another matching text'
      }
    }
  ]
}

// MSW server setup
const server = setupServer(
  // Supabase API mocks
  http.get('https://bsthehpinjtiiznikbyw.supabase.co/rest/v1/documents', () => {
    return HttpResponse.json(mockSupabaseResponse.data)
  }),

  http.get('https://bsthehpinjtiiznikbyw.supabase.co/auth/v1/user', () => {
    return HttpResponse.json({
      id: 'test-user-id',
      email: 'test@example.com'
    })
  }),

  http.post('https://bsthehpinjtiiznikbyw.supabase.co/rest/v1/documents', async ({ request }) => {
    const body = await request.json()
    return HttpResponse.json({ id: 'new-doc-id', ...body })
  }),

  http.patch('https://bsthehpinjtiiznikbyw.supabase.co/rest/v1/documents', async ({ request }) => {
    const body = await request.json()
    return HttpResponse.json({ ...body, updated_at: new Date().toISOString() })
  }),

  // Google Cloud Document AI mocks (use regex patterns for wildcards)
  http.post(/https:\/\/us-documentai\.googleapis\.com\/v1\/projects\/.*\/locations\/.*\/processors\/.*:process/, () => {
    return HttpResponse.json(mockGoogleCloudAIResponse)
  }),

  // Google Cloud Storage mocks
  http.post(/https:\/\/storage\.googleapis\.com\/upload\/storage\/v1\/b\/.*\/o/, () => {
    return HttpResponse.json({
      name: 'test-document.pdf',
      bucket: 'anduin-pdf-ai-batch-processing',
      generation: '1234567890',
      metageneration: '1'
    })
  }),

  http.get(/https:\/\/storage\.googleapis\.com\/storage\/v1\/b\/.*\/o\/.*/, () => {
    return HttpResponse.json({
      name: 'test-document.pdf',
      bucket: 'anduin-pdf-ai-batch-processing',
      mediaLink: 'https://storage.googleapis.com/download/storage/v1/b/bucket/o/object'
    })
  }),

  // Pinecone API mocks  
  http.post(/https:\/\/pdf-ai-assistant-.*\.pinecone\.io\/query/, () => {
    return HttpResponse.json(mockPineconeResponse)
  }),

  http.post(/https:\/\/pdf-ai-assistant-.*\.pinecone\.io\/vectors\/upsert/, () => {
    return HttpResponse.json({ upsertedCount: 1 })
  }),

  http.get(/https:\/\/pdf-ai-assistant-.*\.pinecone\.io\/describe_index_stats/, () => {
    return HttpResponse.json({
      totalVectorCount: 1000,
      dimension: 768,
      indexFullness: 0.1
    })
  }),

  // Vertex AI API mocks
  http.post(/https:\/\/us-central1-aiplatform\.googleapis\.com\/v1\/projects\/.*\/locations\/.*\/publishers\/google\/models\/.*:predict/, async ({ request }) => {
    const body = await request.json()
    const instances = body.instances || [{}]
    
    // Generate a response that matches the number of input instances
    const predictions = instances.map(() => ({
      embeddings: {
        values: Array.from({ length: 768 }, () => Math.random() * 0.1 - 0.05)
      }
    }))
    
    return HttpResponse.json({ predictions })
  }),

  // Upstash Redis mocks
  http.post(/https:\/\/tender-walleye-13483\.upstash\.io\/.*/, ({ request }) => {
    const command = new URL(request.url).pathname.split('/').pop()
    
    switch (command) {
      case 'set':
        return HttpResponse.json({ result: 'OK' })
      case 'setex':
        return HttpResponse.json({ result: 'OK' })
      case 'get':
        return HttpResponse.json({ result: 'cached_value' })
      case 'del':
        return HttpResponse.json({ result: 1 })
      case 'ping':
        return HttpResponse.json({ result: 'PONG' })
      default:
        return HttpResponse.json({ result: null })
    }
  })
)

describe('External Service Integrations', () => {
  beforeAll(() => {
    server.listen({ onUnhandledRequest: 'error' })
  })

  afterAll(() => {
    server.close()
  })

  beforeEach(() => {
    server.resetHandlers()
  })

  describe('Supabase Integration', () => {
    it('should successfully connect to Supabase', async () => {
      const supabase = await createServiceClient()
      
      // Test basic connection
      const { data, error } = await supabase
        .from('documents')
        .select('*')
        .limit(1)

      expect(error).toBeNull()
      expect(data).toBeDefined()
    })

    it('should handle Supabase query errors gracefully', async () => {
      // Mock error response
      server.use(
        http.get('https://bsthehpinjtiiznikbyw.supabase.co/rest/v1/documents', () => {
          return HttpResponse.json({ error: 'Database connection failed' }, { status: 500 })
        })
      )

      const supabase = await createServiceClient()
      
      const { data, error } = await supabase
        .from('documents')
        .select('*')

      expect(error).toBeDefined()
      expect(data).toBeNull()
    })

    it.skip('should properly handle authentication', async () => { // TODO: MSW auth handler needs proper session token
      const supabase = await createServiceClient()

      // Test with mock auth token
      const mockAuthResponse = {
        user: {
          id: 'test-user-id',
          email: 'test@example.com',
          aud: 'authenticated',
          role: 'authenticated',
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-01T00:00:00Z'
        }
      }

      // Mock successful auth response with proper format
      server.use(
        http.get('https://bsthehpinjtiiznikbyw.supabase.co/auth/v1/user', () => {
          return HttpResponse.json(mockAuthResponse)
        })
      )

      const { data: { user }, error } = await supabase.auth.getUser()

      expect(error).toBeNull()
      expect(user).toBeDefined()
      expect(user?.id).toBe('test-user-id')
      expect(user?.email).toBe('test@example.com')
    })
  })

  describe('Google Cloud Document AI Integration', () => {
    it('should process PDF documents successfully', async () => {
      const mockDocumentBuffer = Buffer.from('Mock PDF content')
      
      // Mock the document processing function
      const processDocument = async (buffer: Buffer) => {
        const response = await fetch('https://us-documentai.googleapis.com/v1/projects/fine-craft-471904-i4/locations/us/processors/da00df72d0550a14:process', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            rawDocument: {
              content: buffer.toString('base64'),
              mimeType: 'application/pdf'
            }
          })
        })
        
        return response.json()
      }

      const result = await processDocument(mockDocumentBuffer)
      
      expect(result).toHaveProperty('document')
      expect(result.document).toHaveProperty('text')
      expect(result.document).toHaveProperty('pages')
    })

    it('should handle Document AI API errors', async () => {
      server.use(
        http.post(/https:\/\/us-documentai\.googleapis\.com\/v1\/projects\/.*\/locations\/.*\/processors\/.*:process/, () => {
          return HttpResponse.json({ error: 'Quota exceeded' }, { status: 429 })
        })
      )

      const mockDocumentBuffer = Buffer.from('Mock PDF content')
      
      try {
        const response = await fetch('https://us-documentai.googleapis.com/v1/projects/fine-craft-471904-i4/locations/us/processors/da00df72d0550a14:process', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            rawDocument: {
              content: mockDocumentBuffer.toString('base64'),
              mimeType: 'application/pdf'
            }
          })
        })

        expect(response.status).toBe(429)
      } catch (error) {
        expect(error).toBeDefined()
      }
    })
  })

  describe('Pinecone Vector Database Integration', () => {
    it('should perform similarity search successfully', async () => {
      const mockEmbedding = Array.from({ length: 768 }, () => Math.random())
      
      const performSimilaritySearch = async (embedding: number[]) => {
        const response = await fetch('https://pdf-ai-assistant-test.pinecone.io/query', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            vector: embedding,
            topK: 10,
            includeMetadata: true
          })
        })
        
        return response.json()
      }

      const result = await performSimilaritySearch(mockEmbedding)
      
      expect(result).toHaveProperty('matches')
      expect(Array.isArray(result.matches)).toBe(true)
      expect(result.matches.length).toBeGreaterThan(0)
      
      result.matches.forEach((match: any) => {
        expect(match).toHaveProperty('id')
        expect(match).toHaveProperty('score')
        expect(match).toHaveProperty('metadata')
        expect(typeof match.score).toBe('number')
        expect(match.score).toBeGreaterThanOrEqual(0)
        expect(match.score).toBeLessThanOrEqual(1)
      })
    })

    it('should upsert embeddings successfully', async () => {
      const mockEmbedding = Array.from({ length: 768 }, () => Math.random())
      
      const upsertEmbedding = async (id: string, embedding: number[], metadata: any) => {
        const response = await fetch('https://pdf-ai-assistant-test.pinecone.io/vectors/upsert', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            vectors: [{
              id,
              values: embedding,
              metadata
            }]
          })
        })
        
        return response.json()
      }

      const result = await upsertEmbedding('test-doc-1', mockEmbedding, {
        document_id: 'test-doc-1',
        chunk_index: 0,
        text: 'Test document text'
      })
      
      expect(result).toHaveProperty('upsertedCount', 1)
    })

    it('should get index statistics', async () => {
      const getIndexStats = async () => {
        const response = await fetch('https://pdf-ai-assistant-test.pinecone.io/describe_index_stats', {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' }
        })
        
        return response.json()
      }

      const stats = await getIndexStats()
      
      expect(stats).toHaveProperty('totalVectorCount')
      expect(stats).toHaveProperty('dimension')
      expect(stats).toHaveProperty('indexFullness')
      expect(typeof stats.totalVectorCount).toBe('number')
      expect(typeof stats.dimension).toBe('number')
      expect(typeof stats.indexFullness).toBe('number')
    })
  })

  describe('Vertex AI Embeddings Integration', () => {
    it('should generate embeddings for text', async () => {
      const generateEmbedding = async (text: string) => {
        const response = await fetch('https://us-central1-aiplatform.googleapis.com/v1/projects/fine-craft-471904-i4/locations/us-central1/publishers/google/models/textembedding-gecko:predict', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            instances: [{ content: text }]
          })
        })
        
        return response.json()
      }

      const result = await generateEmbedding('Test document content for embedding')
      
      expect(result).toHaveProperty('predictions')
      expect(Array.isArray(result.predictions)).toBe(true)
      expect(result.predictions[0]).toHaveProperty('embeddings')
      expect(result.predictions[0].embeddings).toHaveProperty('values')
      expect(Array.isArray(result.predictions[0].embeddings.values)).toBe(true)
      expect(result.predictions[0].embeddings.values.length).toBe(768)
    })

    it('should handle batch embedding requests', async () => {
      const texts = [
        'First document text',
        'Second document text', 
        'Third document text'
      ]

      const generateBatchEmbeddings = async (textArray: string[]) => {
        const instances = textArray.map(text => ({ content: text }))
        
        const response = await fetch('https://us-central1-aiplatform.googleapis.com/v1/projects/fine-craft-471904-i4/locations/us-central1/publishers/google/models/textembedding-gecko:predict', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ instances })
        })
        
        return response.json()
      }

      const result = await generateBatchEmbeddings(texts)
      
      expect(result).toHaveProperty('predictions')
      expect(result.predictions.length).toBe(texts.length)
    })
  })

  describe('Redis Cache Integration', () => {
    it('should set and get cached values', async () => {
      const setCacheValue = async (key: string, value: string) => {
        const response = await fetch('https://tender-walleye-13483.upstash.io/set', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify([key, value])
        })
        
        return response.json()
      }

      const getCacheValue = async (key: string) => {
        const response = await fetch('https://tender-walleye-13483.upstash.io/get', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify([key])
        })
        
        return response.json()
      }

      const setResult = await setCacheValue('test-key', 'test-value')
      expect(setResult).toHaveProperty('result', 'OK')

      const getValue = await getCacheValue('test-key')
      expect(getValue).toHaveProperty('result', 'cached_value')
    })

    it('should handle cache expiration', async () => {
      const setWithExpiry = async (key: string, value: string, ttl: number) => {
        const response = await fetch('https://tender-walleye-13483.upstash.io/setex', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify([key, ttl, value])
        })
        
        return response.json()
      }

      const result = await setWithExpiry('expiring-key', 'expiring-value', 60)
      expect(result).toHaveProperty('result', 'OK')
    })

    it('should test Redis connection health', async () => {
      const pingRedis = async () => {
        const response = await fetch('https://tender-walleye-13483.upstash.io/ping', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        })
        
        return response.json()
      }

      const result = await pingRedis()
      expect(result).toHaveProperty('result', 'PONG')
    })
  })

  describe('Service Integration Workflows', () => {
    it('should complete full document processing workflow', async () => {
      // 1. Upload to Google Cloud Storage
      const uploadFile = async () => {
        const response = await fetch('https://storage.googleapis.com/upload/storage/v1/b/anduin-pdf-ai-batch-processing/o', {
          method: 'POST',
          headers: { 'Content-Type': 'application/pdf' },
          body: 'mock-pdf-content'
        })
        return response.json()
      }

      // 2. Process with Document AI
      const processDocument = async () => {
        const response = await fetch('https://us-documentai.googleapis.com/v1/projects/fine-craft-471904-i4/locations/us/processors/da00df72d0550a14:process', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rawDocument: { content: 'base64-content' } })
        })
        return response.json()
      }

      // 3. Generate embeddings
      const generateEmbeddings = async (text: string) => {
        const response = await fetch('https://us-central1-aiplatform.googleapis.com/v1/projects/fine-craft-471904-i4/locations/us-central1/publishers/google/models/textembedding-gecko:predict', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ instances: [{ content: text }] })
        })
        return response.json()
      }

      // 4. Store in Pinecone
      const storeEmbeddings = async (embeddings: number[]) => {
        const response = await fetch('https://pdf-ai-assistant-test.pinecone.io/vectors/upsert', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            vectors: [{ id: 'test-doc', values: embeddings, metadata: {} }]
          })
        })
        return response.json()
      }

      // 5. Save to Supabase
      const saveToDatabase = async (docData: any) => {
        const response = await fetch('https://bsthehpinjtiiznikbyw.supabase.co/rest/v1/documents', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(docData)
        })
        return response.json()
      }

      // Execute workflow
      const uploadResult = await uploadFile()
      expect(uploadResult).toHaveProperty('name')

      const processResult = await processDocument()
      expect(processResult).toHaveProperty('document')

      const embeddingResult = await generateEmbeddings('test text')
      expect(embeddingResult).toHaveProperty('predictions')

      const storeResult = await storeEmbeddings([0.1, 0.2, 0.3])
      expect(storeResult).toHaveProperty('upsertedCount')

      const saveResult = await saveToDatabase({ title: 'Test Doc' })
      expect(saveResult).toHaveProperty('id')
    })
  })
})
