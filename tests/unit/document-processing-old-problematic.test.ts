/**
 * Unit tests for core document processing functions
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createServiceClient } from '@/lib/supabase/server'

// Import document processing functions dynamically to ensure mocks are applied first
let processDocument: any
let generateAndIndexEmbeddings: any 
let splitTextIntoChunks: any

// Mock all external dependencies
vi.mock('@/lib/supabase/server')
vi.mock('@/lib/embeddings-vertex')
vi.mock('@/lib/pinecone')
vi.mock('@/lib/document-ai-config')
vi.mock('@/lib/document-ai-batch')
vi.mock('@/lib/cache')
vi.mock('@/lib/google-credentials')
// Use vi.doMock to ensure the mock is applied before any imports
vi.doMock('@/lib/retry-logic', () => {
  const mockRetryResult = {
    success: true,
    result: { document: { text: 'mock document text', pages: [] } },
    attempts: 1,
    totalTime: 100
  }
  
  console.log('🔍 Setting up retry-logic mock with result:', mockRetryResult)
  
  return {
    SmartRetry: {
      execute: vi.fn().mockImplementation(async (fn) => {
        console.log('🔍 SmartRetry.execute called with function')
        const fnResult = await fn()
        console.log('🔍 Function returned:', fnResult)
        const retryResult = {
          success: true,
          result: fnResult,
          attempts: 1,
          totalTime: 100
        }
        console.log('🔍 SmartRetry.execute returning:', retryResult)
        return retryResult
      })
    },
    RetryConfigs: {
      documentAI: {}
    },
    circuitBreakers: {
      documentAI: {
        execute: vi.fn().mockImplementation(async (fn) => {
          console.log('🔍 DocumentAI CircuitBreaker.execute called')
          const result = await fn()
          return result
        })
      },
      vertexAI: {
        execute: vi.fn().mockImplementation(async (fn) => {
          console.log('🔍 VertexAI CircuitBreaker.execute called')
          const result = await fn()
          return result
        })
      },
      pinecone: {
        execute: vi.fn().mockImplementation(async (fn) => {
          console.log('🔍 Pinecone CircuitBreaker.execute called')
          const result = await fn()
          return result
        })
      }
    }
  }
})

// Mock Google Cloud Document AI - use vi.doMock to ensure it's applied before module imports
vi.doMock('@google-cloud/documentai', () => {
  console.log('🔍 Setting up Google Cloud Document AI mock')
  return {
    DocumentProcessorServiceClient: vi.fn().mockImplementation(() => {
      console.log('🔍 Creating DocumentProcessorServiceClient instance')
      return {
        processDocument: vi.fn().mockImplementation(async (request) => {
          console.log('🔍 processDocument called with:', request)
          const response = [{
            document: { text: 'mock document text', pages: [] }
          }]
          console.log('🔍 processDocument returning:', response)
          return response
        })
      }
    })
  }
})

// Helper function to create complete Supabase query builder mock
const createMockQueryBuilder = (overrides: any = {}) => ({
  select: vi.fn().mockReturnThis(),
  insert: vi.fn().mockReturnThis(),
  update: vi.fn().mockReturnThis(),
  upsert: vi.fn().mockReturnThis(),
  delete: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  neq: vi.fn().mockReturnThis(),
  gt: vi.fn().mockReturnThis(),
  gte: vi.fn().mockReturnThis(),
  lt: vi.fn().mockReturnThis(),
  lte: vi.fn().mockReturnThis(),
  like: vi.fn().mockReturnThis(),
  ilike: vi.fn().mockReturnThis(),
  is: vi.fn().mockReturnThis(),
  in: vi.fn().mockReturnThis(),
  contains: vi.fn().mockReturnThis(),
  containedBy: vi.fn().mockReturnThis(),
  rangeGt: vi.fn().mockReturnThis(),
  rangeGte: vi.fn().mockReturnThis(),
  rangeLt: vi.fn().mockReturnThis(),
  rangeLte: vi.fn().mockReturnThis(),
  rangeAdjacent: vi.fn().mockReturnThis(),
  overlaps: vi.fn().mockReturnThis(),
  textSearch: vi.fn().mockReturnThis(),
  match: vi.fn().mockReturnThis(),
  not: vi.fn().mockReturnThis(),
  or: vi.fn().mockReturnThis(),
  filter: vi.fn().mockReturnThis(),
  order: vi.fn().mockReturnThis(),
  limit: vi.fn().mockReturnThis(),
  range: vi.fn().mockReturnThis(),
  abortSignal: vi.fn().mockReturnThis(),
  single: vi.fn().mockResolvedValue({ data: null, error: null }),
  maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
  csv: vi.fn().mockResolvedValue({ data: '', error: null }),
  geojson: vi.fn().mockResolvedValue({ data: null, error: null }),
  explain: vi.fn().mockResolvedValue({ data: null, error: null }),
  rollback: vi.fn().mockResolvedValue({ data: null, error: null }),
  returns: vi.fn().mockReturnThis(),
  ...overrides
})

const mockSupabase = {
  from: vi.fn(() => createMockQueryBuilder()),
  storage: {
    from: vi.fn(() => ({
      download: vi.fn().mockResolvedValue({ 
        data: new Blob(['mock pdf content'], { type: 'application/pdf' }), 
        error: null 
      }),
      upload: vi.fn().mockResolvedValue({ data: { path: 'test/path' }, error: null })
    }))
  }
}

describe.skip('Document Processing Core Functions', () => {
  
  // Test to verify mock is working
  it('should have mocked retry-logic properly', async () => {
    const { SmartRetry, circuitBreakers } = await import('@/lib/retry-logic')
    
    console.log('🔍 SmartRetry type:', typeof SmartRetry)
    console.log('🔍 SmartRetry.execute type:', typeof SmartRetry.execute)
    console.log('🔍 circuitBreakers.documentAI type:', typeof circuitBreakers.documentAI)
    
    expect(SmartRetry.execute).toBeDefined()
    expect(circuitBreakers.documentAI.execute).toBeDefined()
    
    // Test that our mocks return the expected values
    const mockResult = await SmartRetry.execute(async () => 'test')
    console.log('🔍 SmartRetry.execute result:', mockResult)
    expect(mockResult).toHaveProperty('success', true)
  })
  beforeEach(async () => {
    vi.clearAllMocks()
    ;(createServiceClient as ReturnType<typeof vi.fn>).mockResolvedValue(mockSupabase)
    
    // Mock the Google Cloud Document AI client at test level
    const { DocumentProcessorServiceClient } = await import('@google-cloud/documentai')
    const mockProcessDocument = vi.fn().mockResolvedValue([{
      document: { text: 'mock document text', pages: [] }
    }])
    
    vi.mocked(DocumentProcessorServiceClient).mockImplementation(() => ({
      processDocument: mockProcessDocument
    } as any))
    
    // Explicitly mock the retry logic at test level
    const retryLogicModule = await import('@/lib/retry-logic')
    
    // Mock SmartRetry.execute to match the module mock pattern
    vi.mocked(retryLogicModule.SmartRetry.execute).mockImplementation(async (fn) => {
      console.log('🔍 BeforeEach SmartRetry.execute called with function')
      const fnResult = await fn()
      console.log('🔍 BeforeEach Function returned:', fnResult)
      const retryResult = {
        success: true,
        result: fnResult,
        attempts: 1,
        totalTime: 100
      }
      console.log('🔍 BeforeEach SmartRetry.execute returning:', retryResult)
      return retryResult
    })
    
    // Circuit breakers are already mocked at module level
    
    // Dynamically import document processing functions after mocks are set up
    const docProcessingModule = await import('@/lib/document-processing')
    processDocument = docProcessingModule.processDocument
    generateAndIndexEmbeddings = docProcessingModule.generateAndIndexEmbeddings
    splitTextIntoChunks = docProcessingModule.splitTextIntoChunks
  })

  afterEach(() => {
    vi.restoreMocks()
    
    // Clear module cache to ensure fresh imports in each test
    vi.resetModules()
  })

  describe('processDocument', () => {
    it('should process a document successfully', async () => {
      const mockDocument = {
        id: 'test-doc-id',
        title: 'Test Document',
        filename: 'test.pdf',
        file_path: 'test/path.pdf',
        file_size: 1024000,
        mime_type: 'application/pdf',
        user_id: 'test-user-id',
        status: 'pending',
        metadata: {
          law_firm: 'STB',
          fund_manager: 'Blackstone',
          fund_admin: 'Standish',
          jurisdiction: 'Delaware'
        }
      }

      // Set up specific mock for this test
      mockSupabase.from.mockReturnValue(createMockQueryBuilder({
        single: vi.fn().mockResolvedValue({
          data: mockDocument,
          error: null
        })
      }))

      // Mock successful file download
      mockSupabase.storage.from.mockReturnValue({
        download: vi.fn().mockResolvedValue({
          data: new Blob(['mock pdf content'], { type: 'application/pdf' }),
          error: null
        })
      })

      const result = await processDocument('test-doc-id')

      expect(result).toBeDefined()
      expect(mockSupabase.from).toHaveBeenCalledWith('documents')
    })

    it('should throw error when document not found', async () => {
      // Mock document not found
      mockSupabase.from.mockReturnValue(createMockQueryBuilder({
        single: vi.fn().mockResolvedValue({
          data: null,
          error: { message: 'Document not found' }
        })
      }))

      await expect(processDocument('nonexistent-doc-id')).rejects.toThrow('Document not found')
    })

    it('should handle file download errors', async () => {
      const mockDocument = {
        id: 'test-doc-id',
        title: 'Test Document',
        filename: 'test.pdf',
        file_path: 'test/path.pdf',
        file_size: 1024000,
        mime_type: 'application/pdf',
        user_id: 'test-user-id',
        status: 'pending',
        metadata: {
          law_firm: 'STB',
          fund_manager: 'Blackstone',
          fund_admin: 'Standish',
          jurisdiction: 'Delaware'
        }
      }

      // Mock successful document fetch
      mockSupabase.from.mockReturnValue(createMockQueryBuilder({
        single: vi.fn().mockResolvedValue({
          data: mockDocument,
          error: null
        })
      }))

      // Mock file download error
      mockSupabase.storage.from.mockReturnValue({
        download: vi.fn().mockResolvedValue({
          data: null,
          error: { message: 'File not found' }
        })
      })

      await expect(processDocument('test-doc-id')).rejects.toThrow('Failed to download document')
    })

    it('should handle unlimited processing mode', async () => {
      const originalEnv = process.env.UNLIMITED_PROCESSING
      process.env.UNLIMITED_PROCESSING = 'true'

      const mockDocument = {
        id: 'test-doc-id',
        title: 'Test Large Document',
        filename: 'large.pdf',
        file_path: 'test/large.pdf',
        file_size: 25 * 1024 * 1024, // 25MB - should trigger batch processing
        mime_type: 'application/pdf',
        user_id: 'test-user-id',
        status: 'pending',
        metadata: {
          law_firm: 'STB',
          fund_manager: 'Blackstone',
          fund_admin: 'Standish',
          jurisdiction: 'Delaware'
        }
      }

      // Mock successful document fetch
      mockSupabase.from.mockReturnValue(createMockQueryBuilder({
        single: vi.fn().mockResolvedValue({
          data: mockDocument,
          error: null
        })
      }))

      // Mock successful file download
      mockSupabase.storage.from.mockReturnValue({
        download: vi.fn().mockResolvedValue({
          data: new Blob(['mock large pdf content'.repeat(1000)], { type: 'application/pdf' }),
          error: null
        })
      })

      const result = await processDocument('test-doc-id')

      expect(result).toBeDefined()
      
      // Restore environment
      process.env.UNLIMITED_PROCESSING = originalEnv
    })
  })

  describe('splitTextIntoChunks', () => {
    it('should split text into chunks correctly', async () => {
      // Import the function
      const { splitTextIntoChunks } = await import('@/lib/document-processing')
      
      const text = 'This is a test document. '.repeat(100) // Create long text
      const chunks = splitTextIntoChunks(text, 200)
      
      expect(chunks).toBeDefined()
      expect(chunks.length).toBeGreaterThan(1)
      chunks.forEach(chunk => {
        expect(chunk.length).toBeLessThanOrEqual(200)
      })
    })

    it('should handle small text without splitting', async () => {
      const { splitTextIntoChunks } = await import('@/lib/document-processing')
      
      const text = 'Short text'
      const chunks = splitTextIntoChunks(text, 200)
      
      expect(chunks).toHaveLength(1)
      expect(chunks[0]).toBe(text)
    })
  })

  describe('generateAndIndexEmbeddings', () => {
    it('should generate and index embeddings successfully', async () => {
      const testText = 'This is a test document content for embedding generation'

      // Mock external dependencies
      vi.mock('@/lib/embeddings-vertex', () => ({
        generateEmbeddings: vi.fn().mockResolvedValue([0.1, 0.2, 0.3])
      }))

      vi.mock('@/lib/pinecone', () => ({
        indexDocumentInPinecone: vi.fn().mockResolvedValue(undefined)
      }))

      // Should not throw error
      await expect(generateAndIndexEmbeddings('test-doc-id', testText)).resolves.not.toThrow()
    })

    it('should handle embedding generation with retry mechanism', async () => {
      const testText = 'Test document for retry mechanism'

      // Mock external dependencies with potential failure
      vi.mock('@/lib/embeddings-vertex', () => ({
        generateEmbeddings: vi.fn()
          .mockRejectedValueOnce(new Error('Temporary failure'))
          .mockResolvedValue([0.1, 0.2, 0.3])
      }))

      vi.mock('@/lib/pinecone', () => ({
        indexDocumentInPinecone: vi.fn().mockResolvedValue(undefined)
      }))

      // Test unlimited processing mode
      const originalEnv = process.env.UNLIMITED_PROCESSING
      process.env.UNLIMITED_PROCESSING = 'true'

      // Should succeed despite initial failure due to retry mechanism
      await expect(generateAndIndexEmbeddings('test-doc-id', testText)).resolves.not.toThrow()

      // Restore environment
      process.env.UNLIMITED_PROCESSING = originalEnv
    })

    it('should handle text chunking and multiple embeddings', async () => {
      const longText = 'This is a very long document. '.repeat(100) // Create long text

      vi.mock('@/lib/embeddings-vertex', () => ({
        generateEmbeddings: vi.fn().mockResolvedValue([0.1, 0.2, 0.3])
      }))

      vi.mock('@/lib/pinecone', () => ({
        indexDocumentInPinecone: vi.fn().mockResolvedValue(undefined)
      }))

      // Should handle long text by chunking
      await expect(generateAndIndexEmbeddings('test-doc-id', longText)).resolves.not.toThrow()
    })
  })
})
