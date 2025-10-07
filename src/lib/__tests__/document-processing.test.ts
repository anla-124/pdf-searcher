import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest'
import { processDocument } from '../document-processing'
import { createServiceClient } from '@/lib/supabase/server'
import { DocumentProcessorServiceClient } from '@google-cloud/documentai'
import { generateEmbeddings } from '@/lib/embeddings-vertex'
import { indexDocumentInPinecone } from '@/lib/pinecone'
import { batchProcessor } from '@/lib/document-ai-batch'

// Mock all dependencies
vi.mock('@/lib/supabase/server')
vi.mock('@google-cloud/documentai')
vi.mock('@/lib/embeddings-vertex')
vi.mock('@/lib/pinecone')
vi.mock('@/lib/document-ai-batch')
vi.mock('@/lib/document-ai-config', () => ({
  detectOptimalProcessor: vi.fn(() => 'general'),
  getProcessorId: vi.fn(() => 'processor-123'),
  getProcessorName: vi.fn(() => 'projects/test/locations/us/processors/processor-123')
}))

// Mock retry logic and circuit breakers
vi.mock('@/lib/retry-logic', () => ({
  SmartRetry: {
    execute: vi.fn(async (fn) => {
      try {
        const res = await fn()
        console.log('SmartRetry result:', res)
        return {
          success: true,
          result: res,
          attempts: 1,
          totalTime: 100
        }
      } catch (error) {
        return {
          success: false,
          error: error,
          attempts: 1,
          totalTime: 100
        }
      }
    })
  },
  circuitBreakers: {
    documentAI: {
      execute: vi.fn(async (fn) => {
        const res = await fn()
        console.log('Circuit breaker result:', res)
        return res
      })
    }
  },
  RetryConfigs: {
    documentAI: { maxRetries: 3 }
  }
}))

const mockCreateServiceClient = vi.mocked(createServiceClient)
const mockGenerateEmbeddings = vi.mocked(generateEmbeddings)
const mockIndexDocumentInPinecone = vi.mocked(indexDocumentInPinecone)
const mockBatchProcessor = vi.mocked(batchProcessor)

// Mock console methods to reduce test noise
const originalConsoleLog = console.log
const originalConsoleError = console.error
beforeAll(() => {
  console.log = vi.fn()
  console.error = vi.fn()
})
afterAll(() => {
  console.log = originalConsoleLog
  console.error = originalConsoleError
})

describe('Document Processing', () => {
  let mockSupabase: any
  let mockDocumentAI: any

  beforeEach(() => {
    vi.clearAllMocks()

    // Mock Supabase client
    const singleMock = vi.fn().mockResolvedValue({
      data: {
        id: 'doc-123',
        filename: 'test.pdf',
        file_path: 'documents/test.pdf',
        file_size: 1024 * 1024, // 1MB
        metadata: { law_firm: 'Test Firm', subscription_agreement_start_page: 1, subscription_agreement_end_page: 10 }
      },
      error: null
    })

    const eqMock = vi.fn().mockReturnValue({ single: singleMock })
    const returnsMock = vi.fn().mockReturnValue({ eq: eqMock })

    const selectMock = vi.fn().mockReturnValue({
      returns: returnsMock,
      eq: eqMock
    })

    const updateMock = vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ error: null })
    })

    const insertMock = vi.fn().mockResolvedValue({ error: null })
    const upsertMock = vi.fn().mockResolvedValue({ error: null })

    const deleteMock = vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ error: null })
    })

    mockSupabase = {
      from: vi.fn().mockImplementation((_table: string) => ({
        select: selectMock,
        insert: insertMock,
        update: updateMock,
        delete: deleteMock,
        upsert: upsertMock
      })),
      storage: {
        from: vi.fn().mockReturnValue({
          download: vi.fn().mockResolvedValue({
            data: new Blob(['fake pdf content']),
            error: null
          })
        })
      }
    }

    // Mock Document AI client
    mockDocumentAI = {
      processDocument: vi.fn().mockResolvedValue({
        document: {
          text: 'Extracted text from document',
          pages: [
            {
              pageNumber: 1,
              paragraphs: [
                {
                  layout: {
                    textAnchor: {
                      textSegments: [{ startIndex: 0, endIndex: 26 }]
                    }
                  }
                }
              ]
            }
          ],
          entities: [
            {
              type: 'company',
              mentionText: 'Test Company',
              confidence: 0.9,
              pageAnchor: {
                pageRefs: [{ page: 0 }]
              }
            }
          ]
        }
      })
    }

    // Setup mocks
    mockCreateServiceClient.mockReturnValue(mockSupabase)
    ;(DocumentProcessorServiceClient as vi.Mock).mockImplementation(() => mockDocumentAI)
    mockGenerateEmbeddings.mockResolvedValue([0.1, 0.2, 0.3])
    mockIndexDocumentInPinecone.mockResolvedValue(undefined)
  })

  describe('Sync Processing', () => {
    it('should successfully process a small document with sync processing', async () => {
      // Debug: Check what our mock actually returns
      console.log('Mock returns:', await mockDocumentAI.processDocument({}))
      
      const result = await processDocument('doc-123')

      expect(result.switchedToBatch).toBeFalsy()
      expect(result.metrics).toBeDefined()
      expect(mockDocumentAI.processDocument).toHaveBeenCalledWith({
        name: 'projects/test/locations/us/processors/processor-123',
        rawDocument: {
          content: expect.any(String),
          mimeType: 'application/pdf'
        }
      })

      // Verify document was updated with extracted data
      expect(mockSupabase.from().update).toHaveBeenCalledWith({
        extracted_fields: expect.objectContaining({
          fields: expect.arrayContaining([
            expect.objectContaining({
              name: 'company',
              value: 'Test Company',
              confidence: 0.9
            })
          ]),
          entities: expect.arrayContaining([
            expect.objectContaining({
              type: 'company',
              value: 'Test Company'
            })
          ]),
          tables: expect.any(Array),
          processing_pipeline: expect.objectContaining({
            version: expect.any(String)
          })
        }),
        page_count: 1,
        status: 'processing'
      })
    })

    it('should extract structured fields correctly', async () => {
      await processDocument('doc-123')

      const updateCall = mockSupabase.from().update.mock.calls[0][0]
      expect(updateCall.extracted_fields.fields).toEqual([
        {
          name: 'company',
          value: 'Test Company',
          type: 'text',
          confidence: 0.9,
          pageNumber: 1,
          boundingBox: undefined
        }
      ])
    })

    it('should generate and index embeddings', async () => {
      await processDocument('doc-123')

      expect(mockGenerateEmbeddings).toHaveBeenCalled()
      expect(mockIndexDocumentInPinecone).toHaveBeenCalled()
    })

    it('should handle embedding generation failures gracefully', async () => {
      mockGenerateEmbeddings.mockRejectedValue(new Error('API quota exceeded'))

      await processDocument('doc-123')

      // Should complete the document processing even if embeddings fail
      expect(mockSupabase.from().update).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({
            embeddings_skipped: true,
            embeddings_error: 'API quota exceeded'
          })
        })
      )
    })
  })

  describe('Batch Processing Switch', () => {
    it('should switch to batch processing when page limit is exceeded', async () => {
      // Mock page limit error
      const pageError = new Error('Document pages in non-imageless mode exceed the limit')
      pageError.code = 3
      pageError.details = 'Document pages in non-imageless mode exceed the limit'
      mockDocumentAI.processDocument.mockRejectedValue(pageError)

      // Mock batch processor
      mockBatchProcessor.startBatchProcessing.mockResolvedValue('batch-op-123')

      const result = await processDocument('doc-123')

      expect(result.switchedToBatch).toBe(true)
      expect(result.metrics).toBeDefined()
      expect(mockBatchProcessor.startBatchProcessing).toHaveBeenCalledWith('doc-123')
    })

    it('should re-throw non-page-limit errors', async () => {
      const networkError = new Error('Network timeout')
      networkError.code = 4
      mockDocumentAI.processDocument.mockRejectedValue(networkError)

      await expect(processDocument('doc-123')).rejects.toThrow('Network timeout')
      expect(mockBatchProcessor.startBatchProcessing).not.toHaveBeenCalled()
    })

    it('should handle batch processing initiation failures', async () => {
      // Mock page limit error
      const pageError = new Error('Document pages exceed the limit')
      pageError.code = 3
      pageError.details = 'Document pages exceed the limit'
      mockDocumentAI.processDocument.mockRejectedValue(pageError)

      // Mock batch processor failure
      mockBatchProcessor.startBatchProcessing.mockRejectedValue(new Error('Batch init failed'))

      await expect(processDocument('doc-123')).rejects.toThrow('Batch init failed')
    })
  })

  describe('Error Handling', () => {
    it('should handle document not found', async () => {
      mockSupabase.from().select().eq().single.mockResolvedValue({
        data: null,
        error: { message: 'Document not found' }
      })

      await expect(processDocument('non-existent')).rejects.toThrow('Document not found')
    })

    it('should handle storage download failures', async () => {
      mockSupabase.storage.from().download.mockResolvedValue({
        data: null,
        error: { message: 'File not found in storage' }
      })

      await expect(processDocument('doc-123')).rejects.toThrow('Failed to download document from storage')
    })

    it('should handle Document AI processing failures', async () => {
      mockDocumentAI.processDocument.mockRejectedValue(new Error('Document AI service unavailable'))

      await expect(processDocument('doc-123')).rejects.toThrow('Document AI service unavailable')
      
      // Should update document status to error
      expect(mockSupabase.from().update).toHaveBeenCalledWith({
        status: 'error',
        processing_error: 'Document AI service unavailable'
      })
    })

    it('should handle database update failures', async () => {
      mockSupabase.from().update().eq.mockResolvedValue({
        error: { message: 'Database connection failed' }
      })

      await expect(processDocument('doc-123')).rejects.toThrow('Failed to update document with extracted data')
    })
  })

  describe('Page Count Detection', () => {
    it('should correctly extract page count from Document AI response', async () => {
      mockDocumentAI.processDocument.mockResolvedValue([{
        document: {
          text: 'Multi-page document',
          pages: [
            { pageNumber: 1 },
            { pageNumber: 2 },
            { pageNumber: 3 }
          ]
        }
      }])

      await processDocument('doc-123')

      expect(mockSupabase.from().update).toHaveBeenCalledWith(
        expect.objectContaining({
          page_count: 3
        })
      )
    })

    it('should handle documents with no pages', async () => {
      mockDocumentAI.processDocument.mockResolvedValue([{
        document: {
          text: 'Document without pages structure'
          // No pages property
        }
      }])

      await processDocument('doc-123')

      expect(mockSupabase.from().update).toHaveBeenCalledWith(
        expect.objectContaining({
          page_count: 0
        })
      )
    })
  })

  describe('Metadata Preservation', () => {
    it('should preserve business metadata through processing', async () => {
      await processDocument('doc-123')

      // Check that embeddings are called with business metadata
      expect(mockIndexDocumentInPinecone).toHaveBeenCalledWith(
        expect.any(String), // vector_id
        expect.any(Array),   // embedding
        expect.objectContaining({
          law_firm: 'Test Firm'
        })
      )
    })

    it('should handle documents without metadata', async () => {
      mockSupabase.from().select().eq().single.mockResolvedValue({
        data: {
          id: 'doc-123',
          filename: 'test.pdf',
          file_path: 'documents/test.pdf',
          file_size: 1024 * 1024,
          metadata: null
        },
        error: null
      })

      await processDocument('doc-123')

      // Should not fail and should use empty metadata
      expect(mockIndexDocumentInPinecone).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Array),
        expect.objectContaining({
          document_id: 'doc-123'
        })
      )
    })
  })
})
