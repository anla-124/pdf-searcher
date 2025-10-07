import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest'
import { POST } from '../route'
import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { batchSearchSimilarDocuments } from '@/lib/pinecone'

// Mock dependencies  
vi.mock('@/lib/supabase/server')
vi.mock('@/lib/pinecone')
vi.mock('@/lib/cache', () => ({
  default: {
    getSimilarDocuments: vi.fn().mockResolvedValue(null),
    setSimilarDocuments: vi.fn().mockResolvedValue(undefined)
  },
  createCacheHash: vi.fn().mockReturnValue('test-cache-key')
}))
vi.mock('@/lib/hybrid-search')
vi.mock('@/lib/middleware/compression', () => ({
  withCompression: vi.fn().mockImplementation(async (request, handler) => {
    return await handler()
  })
}))
vi.mock('@/lib/logger-config', () => ({
  shouldLog: {
    similaritySearch: vi.fn().mockReturnValue(false)
  }
}))
vi.mock('@/lib/activity-logger', () => ({
  activityLogger: {
    logActivity: vi.fn().mockResolvedValue(undefined)
  }
}))

const mockCreateClient = vi.mocked(createClient)
const mockBatchSearchSimilarDocuments = vi.mocked(batchSearchSimilarDocuments)

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

describe.skip('/api/documents/[id]/similar API Route', () => {
  let mockSupabase: any

  beforeEach(async () => {
    // Reset mocks
    vi.clearAllMocks()

    // Setup default Supabase mock with comprehensive query chain
    const mockSelectQuery = {
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: {
          id: 'doc-123',
          status: 'completed',
          extracted_text: 'Sample text',
          user_id: 'user-123',
          metadata: {}
        },
        error: null
      }),
      order: vi.fn().mockResolvedValue({
        data: [
          {
            id: 'embedding-1',
            document_id: 'doc-123',
            embedding: '[0.1, 0.2, 0.3]',
            text: 'Sample chunk',
            chunk_index: 0,
            page_number: 1
          }
        ],
        error: null
      }),
      in: vi.fn().mockReturnThis()
    }

    const mockSelectWithCount = {
      eq: vi.fn().mockReturnThis(),
      count: 50
    }

    mockSupabase = {
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: 'user-123' } },
          error: null
        })
      },
      from: vi.fn().mockImplementation((tableName) => {
        if (tableName === 'documents') {
          return {
            select: vi.fn().mockImplementation((columns, options) => {
              if (options && options.count) {
                return mockSelectWithCount
              }
              return {
                ...mockSelectQuery,
                in: vi.fn().mockReturnValue({
                  eq: vi.fn().mockResolvedValue({
                    data: [
                      {
                        id: 'doc-456',
                        title: 'Similar Document',
                        user_id: 'user-123',
                        status: 'completed',
                        metadata: {
                          law_firm: 'STB',
                          fund_manager: 'Blackstone'
                        }
                      }
                    ],
                    error: null
                  })
                })
              }
            })
          }
        } else if (tableName === 'document_embeddings') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                order: vi.fn().mockResolvedValue({
                  data: [
                    {
                      id: 'embedding-1',
                      document_id: 'doc-123',
                      embedding: '[0.1, 0.2, 0.3]',
                      text: 'Sample chunk',
                      chunk_index: 0,
                      page_number: 1
                    }
                  ],
                  error: null
                })
              }),
              in: vi.fn().mockReturnValue({
                order: vi.fn().mockResolvedValue({
                  data: [
                    {
                      document_id: 'doc-456',
                      chunk_index: 5
                    }
                  ],
                  error: null
                })
              })
            })
          }
        }
        return {
          select: vi.fn().mockReturnValue(mockSelectQuery),
          insert: vi.fn(),
          update: vi.fn(),
          delete: vi.fn()
        }
      })
    }
    
    mockCreateClient.mockResolvedValue(mockSupabase)
    mockBatchSearchSimilarDocuments.mockResolvedValue([])
  })

  const createMockRequest = (body: any, params: { id: string }) => {
    const request = new NextRequest('http://localhost:3000/api/documents/doc-123/similar', {
      method: 'POST',
      body: JSON.stringify(body),
      headers: {
        'content-type': 'application/json'
      }
    })
    
    return { request, params: Promise.resolve(params) }
  }

  it('should return 401 for unauthenticated users', async () => {
    // Mock authentication failure
    mockSupabase.auth.getUser.mockResolvedValue({
      data: { user: null },
      error: new Error('Unauthorized')
    })

    const { request, params } = createMockRequest({}, { id: 'doc-123' })
    
    try {
      const response = await POST(request, { params })
      console.log('Response received:', response)
      
      expect(response).toBeDefined()
      expect(response.status).toBe(401)
      const data = await response.json()
      expect(data.error).toBe('Unauthorized')
    } catch (error) {
      console.error('Error in test:', error)
      throw error
    }
  })

  it('should return 404 for non-existent document', async () => {
    // Mock document not found
    mockSupabase.from().select().eq().single.mockResolvedValue({
      data: null,
      error: { code: 'PGRST116' }
    })

    const { request, params } = createMockRequest({}, { id: 'non-existent' })
    const response = await POST(request, { params })
    
    expect(response.status).toBe(404)
    const data = await response.json()
    expect(data.error).toBe('Document not found')
  })

  it('should apply business metadata filters correctly', async () => {
    const { request, params } = createMockRequest({
      filters: {
        law_firm: ['STB'],
        fund_manager: ['Blackstone'],
        min_score: 0.7,
        page_range: {
          use_entire_document: true
        }
      },
      topK: 20
    }, { id: 'doc-123' })

    mockBatchSearchSimilarDocuments.mockResolvedValue([
      {
        id: 'vector-1',
        score: 0.8,
        metadata: {
          document_id: 'doc-456',
          text: 'Similar content'
        }
      }
    ])

    const response = await POST(request, { params })
    
    expect(response.status).toBe(200)
    
    // Verify that batchSearchSimilarDocuments was called with proper filters
    expect(mockBatchSearchSimilarDocuments).toHaveBeenCalledWith(
      expect.any(Array), // embedding array
      expect.any(Number), // searchLimit
      expect.objectContaining({
        document_id: { $ne: 'doc-123' },
        law_firm: { $in: ['STB'] },
        fund_manager: { $in: ['Blackstone'] }
      }),
      expect.any(Object) // options object
    )
  })

  it('should not include empty filter arrays in Pinecone query', async () => {
    const { request, params } = createMockRequest({
      filters: {
        law_firm: [],
        fund_manager: ['Blackstone'],
        fund_admin: [],
        jurisdiction: [],
        min_score: 0.7,
        page_range: {
          use_entire_document: true
        }
      },
      topK: 20
    }, { id: 'doc-123' })

    mockBatchSearchSimilarDocuments.mockResolvedValue([])

    await POST(request, { params })
    
    // Verify only non-empty filters are included
    expect(mockBatchSearchSimilarDocuments).toHaveBeenCalledWith(
      expect.any(Array),
      expect.any(Number),
      expect.objectContaining({
        document_id: { $ne: 'doc-123' },
        fund_manager: { $in: ['Blackstone'] }
        // Should NOT include law_firm, fund_admin, or jurisdiction
      }),
      expect.any(Object)
    )
    
    const pineconeFilter = mockBatchSearchSimilarDocuments.mock.calls[0][2]
    expect(pineconeFilter).not.toHaveProperty('law_firm')
    expect(pineconeFilter).not.toHaveProperty('fund_admin')
    expect(pineconeFilter).not.toHaveProperty('jurisdiction')
  })

  it('should handle multiple business filters simultaneously', async () => {
    const { request, params } = createMockRequest({
      filters: {
        law_firm: ['STB'],
        fund_manager: ['Blackstone'],
        fund_admin: ['Standish'],
        jurisdiction: ['Delaware'],
        min_score: 0.7,
        page_range: {
          use_entire_document: true
        }
      },
      topK: 20
    }, { id: 'doc-123' })

    mockBatchSearchSimilarDocuments.mockResolvedValue([])

    await POST(request, { params })
    
    // Verify all filters are applied
    expect(mockBatchSearchSimilarDocuments).toHaveBeenCalledWith(
      expect.any(Array),
      expect.any(Number),
      expect.objectContaining({
        document_id: { $ne: 'doc-123' },
        law_firm: { $in: ['STB'] },
        fund_manager: { $in: ['Blackstone'] },
        fund_admin: { $in: ['Standish'] },
        jurisdiction: { $in: ['Delaware'] }
      }),
      expect.any(Object)
    )
  })

  it('should maintain backward compatibility with legacy filters', async () => {
    const { request, params } = createMockRequest({
      filters: {
        law_firm: ['STB'],
        investor_type: ['PE'],
        document_type: ['Contract'],
        min_score: 0.7,
        page_range: {
          use_entire_document: true
        }
      },
      topK: 20
    }, { id: 'doc-123' })

    mockBatchSearchSimilarDocuments.mockResolvedValue([])

    await POST(request, { params })
    
    // Verify both new and legacy filters are applied
    expect(mockBatchSearchSimilarDocuments).toHaveBeenCalledWith(
      expect.any(Array),
      expect.any(Number),
      expect.objectContaining({
        document_id: { $ne: 'doc-123' },
        law_firm: { $in: ['STB'] },
        investor_type: { $in: ['PE'] },
        document_type: { $in: ['Contract'] }
      }),
      expect.any(Object)
    )
  })

  it('should return empty array when no similar documents found', async () => {
    mockBatchSearchSimilarDocuments.mockResolvedValue([])

    const { request, params } = createMockRequest({
      filters: {
        law_firm: ['NonExistentFirm'],
        min_score: 0.7,
        page_range: {
          use_entire_document: true
        }
      },
      topK: 20
    }, { id: 'doc-123' })

    const response = await POST(request, { params })
    
    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data).toEqual([])
  })

  it('should return 500 for internal server errors', async () => {
    // Mock Pinecone error
    mockBatchSearchSimilarDocuments.mockRejectedValue(new Error('Pinecone error'))

    const { request, params } = createMockRequest({
      filters: { min_score: 0.7 },
      topK: 20
    }, { id: 'doc-123' })

    const response = await POST(request, { params })
    
    expect(response.status).toBe(500)
    const data = await response.json()
    expect(data.error).toBe('Internal server error')
  })

  it('should validate minimum score filter', async () => {
    mockBatchSearchSimilarDocuments.mockResolvedValue([
      {
        id: 'vector-1',
        score: 0.6, // Below minimum
        metadata: {
          document_id: 'doc-456',
          text: 'Low similarity content'
        }
      },
      {
        id: 'vector-2', 
        score: 0.8, // Above minimum
        metadata: {
          document_id: 'doc-789',
          text: 'High similarity content'
        }
      }
    ])

    // Mock document fetch
    mockSupabase.from().select().in().eq.mockResolvedValue({
      data: [{
        id: 'doc-789',
        title: 'High Similarity Document',
        user_id: 'user-123',
        status: 'completed',
        metadata: {}
      }],
      error: null
    })

    const { request, params } = createMockRequest({
      filters: {
        min_score: 0.7 // Should filter out 0.6 score
      },
      topK: 20
    }, { id: 'doc-123' })

    const response = await POST(request, { params })
    
    expect(response.status).toBe(200)
    const data = await response.json()
    
    // Should only return the document with score >= 0.7
    expect(data).toHaveLength(1)
    expect(data[0].document.id).toBe('doc-789')
    expect(data[0].score).toBeGreaterThanOrEqual(0.7)
  })
})
