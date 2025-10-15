/**
 * Global test setup for unit tests
 * Sets up testing environment, mocks, and utilities
 */

import { vi, beforeAll, afterAll } from 'vitest'
import '@testing-library/jest-dom'

// Mock environment variables for testing
process.env['NODE_ENV'] = 'test'
process.env['NEXT_PUBLIC_SUPABASE_URL'] = 'http://localhost:54321'
process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY'] = 'test-anon-key'
process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'test-service-role-key'
process.env['PINECONE_API_KEY'] = 'test-pinecone-key'
process.env['PINECONE_INDEX_NAME'] = 'test-index'
process.env['GOOGLE_CLOUD_PROJECT_ID'] = 'test-project'
process.env['UPSTASH_REDIS_REST_URL'] = 'http://localhost:6379'
process.env['UPSTASH_REDIS_REST_TOKEN'] = 'test-redis-token'
process.env['UNLIMITED_PROCESSING'] = 'true'

// Global mocks for external services
vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
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
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      range: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: null }),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    })),
    storage: {
      from: vi.fn(() => ({
        upload: vi.fn().mockResolvedValue({ data: { path: 'test/path' }, error: null }),
        download: vi.fn().mockResolvedValue({ data: Buffer.from('test'), error: null }),
        remove: vi.fn().mockResolvedValue({ data: null, error: null }),
      }))
    },
    auth: {
      getUser: vi.fn().mockResolvedValue({ 
        data: { user: { id: 'test-user-id', email: 'test@example.com' } }, 
        error: null 
      }),
      signInWithPassword: vi.fn().mockResolvedValue({ 
        data: { user: { id: 'test-user-id' } }, 
        error: null 
      }),
      signOut: vi.fn().mockResolvedValue({ error: null })
    }
  }))
}))

// Mock Pinecone
vi.mock('@pinecone-database/pinecone', () => ({
  Pinecone: vi.fn(() => ({
    Index: vi.fn(() => ({
      upsert: vi.fn().mockResolvedValue({ upsertedCount: 1 }),
      query: vi.fn().mockResolvedValue({ 
        matches: [
          { id: 'test-vector-1', score: 0.95, metadata: { document_id: 'test-doc-1' } }
        ] 
      }),
      deleteMany: vi.fn().mockResolvedValue({}),
      listPaginated: vi.fn().mockResolvedValue({ vectors: [] }),
      describeIndexStats: vi.fn().mockResolvedValue({ 
        dimension: 768,
        indexFullness: 0.1,
        totalVectorCount: 100 
      })
    }))
  }))
}))

// Mock Google Cloud Document AI
vi.mock('@google-cloud/documentai', () => ({
  DocumentProcessorServiceClient: vi.fn(() => ({
    processDocument: vi.fn().mockResolvedValue([{
      document: {
        text: 'Mock document text for testing',
        pages: [
          {
            pageNumber: 1,
            paragraphs: [
              {
                layout: {
                  textAnchor: {
                    textSegments: [{ startIndex: '0', endIndex: '28' }]
                  }
                }
              }
            ]
          }
        ]
      }
    }])
  }))
}))

// Mock Google Cloud Storage
vi.mock('@google-cloud/storage', () => ({
  Storage: vi.fn(() => ({
    bucket: vi.fn(() => ({
      file: vi.fn(() => ({
        save: vi.fn().mockResolvedValue(undefined),
        download: vi.fn().mockResolvedValue([Buffer.from('mock file content')]),
        exists: vi.fn().mockResolvedValue([true])
      })),
      getFiles: vi.fn().mockResolvedValue([
        [
          { name: 'test-file.json', download: vi.fn().mockResolvedValue([Buffer.from('{"test": true}')]) }
        ]
      ])
    }))
  }))
}))

// Mock Next.js modules
vi.mock('next/navigation', () => ({
  useRouter: vi.fn(() => ({
    push: vi.fn(),
    replace: vi.fn(),
    refresh: vi.fn(),
    back: vi.fn(),
    forward: vi.fn()
  })),
  usePathname: vi.fn(() => '/dashboard'),
  useSearchParams: vi.fn(() => new URLSearchParams()),
  redirect: vi.fn()
}))

vi.mock('next/headers', () => ({
  cookies: vi.fn(() => ({
    get: vi.fn(),
    set: vi.fn(),
    delete: vi.fn()
  }))
}))

// Mock fetch for API testing
global.fetch = vi.fn()

// Setup fetch mock helper
export const mockFetch = (response: unknown, ok = true, status = 200) => {
  const mockedFetch = global.fetch as ReturnType<typeof vi.fn>
  mockedFetch.mockResolvedValueOnce({
    ok,
    status,
    json: vi.fn().mockResolvedValue(response),
    text: vi.fn().mockResolvedValue(typeof response === 'string' ? response : JSON.stringify(response))
  })
}

// Cleanup function
export const cleanup = () => {
  vi.clearAllMocks()
}

// Helper for creating test documents
type TestDocumentOverrides = Record<string, unknown>

export const createTestDocument = (overrides: TestDocumentOverrides = {}) => ({
  id: 'test-doc-id',
  title: 'Test Document',
  filename: 'test.pdf',
  file_path: 'test/path.pdf',
  file_size: 1024000,
  mime_type: 'application/pdf',
  user_id: 'test-user-id',
  status: 'completed' as const,
  extracted_text: 'Test document content',
  page_count: 5,
  metadata: {
    law_firm: 'STB',
    fund_manager: 'Blackstone',
    fund_admin: 'Standish',
    jurisdiction: 'Delaware'
  },
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
  ...overrides
})

// Helper for creating test embeddings
export const createTestEmbedding = () => 
  Array.from({ length: 768 }, () => Math.random())

// Console suppression for cleaner test output
const originalConsoleError = console.error
const originalConsoleWarn = console.warn

beforeAll(() => {
  console.error = vi.fn()
  console.warn = vi.fn()
})

afterAll(() => {
  console.error = originalConsoleError
  console.warn = originalConsoleWarn
})

// Global test utilities
type TestUtils = {
  mockFetch: typeof mockFetch
  cleanup: typeof cleanup
  createTestDocument: typeof createTestDocument
  createTestEmbedding: typeof createTestEmbedding
}

;(globalThis as typeof globalThis & { testUtils?: TestUtils }).testUtils = {
  mockFetch,
  cleanup,
  createTestDocument,
  createTestEmbedding
}
