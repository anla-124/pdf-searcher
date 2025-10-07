import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest'
import { GET } from '../route'
import { NextRequest } from 'next/server'
import { createServiceClient, releaseServiceClient } from '@/lib/supabase/server'
import { processDocument } from '@/lib/document-processing'
import { batchProcessor } from '@/lib/document-ai-batch'

// Mock dependencies
vi.mock('@/lib/supabase/server')
vi.mock('@/lib/document-processing')
vi.mock('@/lib/document-ai-batch')

const mockCreateServiceClient = vi.mocked(createServiceClient)
const mockReleaseServiceClient = vi.mocked(releaseServiceClient)
const mockProcessDocument = vi.mocked(processDocument)
const mockBatchProcessor = vi.mocked(batchProcessor)

// Mock console methods
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

describe('/api/cron/process-jobs API Route', () => {
  let mockSupabase: any

  beforeEach(() => {
    vi.clearAllMocks()

    // Mock environment variables
    process.env.CRON_SECRET = 'test-secret'
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co'
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key'

    // Comprehensive Supabase mock setup
    const singleMock = vi.fn().mockResolvedValue({ data: {}, error: null })
    const eqMock = vi.fn().mockReturnThis()
    const inMock = vi.fn().mockReturnThis()
    const orderMock = vi.fn().mockReturnThis()
    const limitMock = vi.fn().mockResolvedValue({ data: [], error: null })
    const updateMock = vi.fn(() => ({
      eq: vi.fn().mockResolvedValue({ error: null }),
    }))

    const selectMock = vi.fn(() => ({
      eq: eqMock,
      in: inMock,
      order: orderMock,
      limit: limitMock,
      single: singleMock,
    }))

    const fromMock = vi.fn(() => ({
      select: selectMock,
      update: updateMock,
    }))

    mockSupabase = {
      from: fromMock,
      _mocks: {
        select: selectMock,
        update: updateMock,
        eq: eqMock,
        in: inMock,
        order: orderMock,
        limit: limitMock,
        single: singleMock,
      },
    }

    mockCreateServiceClient.mockResolvedValue(mockSupabase)
    mockReleaseServiceClient.mockReturnValue(undefined)
    mockProcessDocument.mockResolvedValue({})

    // Setup batch processor mock methods
    mockBatchProcessor.startBatchProcessing = vi.fn().mockResolvedValue('batch-op-123')
    mockBatchProcessor.getOperationStatus = vi.fn().mockResolvedValue({
      status: 'RUNNING',
      progress: 50,
    })
    mockBatchProcessor.processBatchResults = vi.fn().mockResolvedValue(undefined)
    mockBatchProcessor.cleanupBatchOperation = vi.fn().mockResolvedValue(undefined)
  })

  const createMockRequest = (authHeader?: string) => {
    return new NextRequest('http://localhost:3000/api/cron/process-jobs', {
      method: 'GET',
      headers: authHeader ? { authorization: authHeader } : {},
    })
  }

  const setupJobMock = (jobs: any[]) => {
    mockSupabase._mocks.limit.mockResolvedValue({
      data: jobs,
      error: null,
    })
  }

  describe('Authentication', () => {
    it('should reject requests without authorization header', async () => {
      const request = createMockRequest()
      const response = await GET(request)

      expect(response.status).toBe(401)
      const data = await response.json()
      expect(data.error).toBe('Unauthorized')
    })

    it('should reject requests with invalid authorization', async () => {
      const request = createMockRequest('Bearer wrong-secret')
      const response = await GET(request)

      expect(response.status).toBe(401)
      const data = await response.json()
      expect(data.error).toBe('Unauthorized')
    })

    it('should accept requests with valid authorization', async () => {
      const request = createMockRequest('Bearer test-secret')
      const response = await GET(request)

      expect(response.status).toBe(200)
    })
  })

  describe('Job Processing', () => {
    it('should return message when no jobs are queued', async () => {
      // Mock no jobs found
      mockSupabase._mocks.limit.mockResolvedValue({ data: [], error: null })

      const request = createMockRequest('Bearer test-secret')
      const response = await GET(request)

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.message).toBe('No jobs to process')
    })

    it('should process a queued sync job successfully', async () => {
      const mockJob = {
        id: 'job-123',
        document_id: 'doc-123',
        status: 'queued',
        attempts: 0,
        max_attempts: 3,
        processing_method: null,
        documents: [{
          id: 'doc-123',
          title: 'Test Document',
          filename: 'test.pdf',
          file_size: 1024 * 1024,
          user_id: 'user-123'
        }]
      }

      setupJobMock([mockJob])

      const request = createMockRequest('Bearer test-secret')
      const response = await GET(request)

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.message).toBe('Processed 1 jobs')
      expect(data.summary.successful).toBe(1)

      // Verify document was processed
      expect(mockProcessDocument).toHaveBeenCalledWith('doc-123')
    })

    it('should handle sync-to-batch processing switch', async () => {
      const mockJob = {
        id: 'job-123',
        document_id: 'doc-123',
        status: 'queued',
        attempts: 0,
        max_attempts: 3,
        processing_method: 'sync',
        documents: [{
          id: 'doc-123',
          title: 'Large Document',
          filename: 'large.pdf',
          file_size: 20 * 1024 * 1024, // 20MB
          user_id: 'user-123'
        }]
      }

      setupJobMock([mockJob])

      // Mock document processor switching to batch
      mockProcessDocument.mockResolvedValue({ switchedToBatch: true })

      const request = createMockRequest('Bearer test-secret')
      const response = await GET(request)

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.message).toBe('Processed 1 jobs')
      expect(data.summary.successful).toBe(1)
    })

    it('should handle batch processing initiation', async () => {
      const mockJob = {
        id: 'job-123',
        document_id: 'doc-123',
        status: 'queued',
        attempts: 0,
        max_attempts: 3,
        processing_method: 'batch',
        batch_operation_id: null,
        documents: [{
          id: 'doc-123',
          title: 'Large Document',
          filename: 'large.pdf',
          file_size: 50 * 1024 * 1024, // 50MB
          user_id: 'user-123'
        }]
      }

      setupJobMock([mockJob])

      mockBatchProcessor.startBatchProcessing.mockResolvedValue('batch-op-456')

      const request = createMockRequest('Bearer test-secret')
      const response = await GET(request)

      expect(response.status).toBe(200)
      const data = await response.json()
      
      // The route returns a summary, not individual job responses
      expect(data.message).toBe('Processed 1 jobs')
      expect(data.summary.successful).toBe(1)
      expect(data.summary.total).toBe(1)
      
      // The batch processor should still be called correctly
      expect(mockBatchProcessor.startBatchProcessing).toHaveBeenCalledWith('doc-123')
    })

    it('should check existing batch operation status', async () => {
      const mockJob = {
        id: 'job-123',
        document_id: 'doc-123',
        status: 'processing',
        attempts: 1,
        max_attempts: 3,
        processing_method: 'batch',
        batch_operation_id: 'batch-op-456',
        documents: [{
          id: 'doc-123',
          title: 'Large Document',
          filename: 'large.pdf',
          file_size: 50 * 1024 * 1024,
          user_id: 'user-123'
        }]
      }

      setupJobMock([mockJob])

      // Mock batch operation still running
      mockBatchProcessor.getOperationStatus.mockResolvedValue({
        status: 'RUNNING',
        progress: 50
      })

      const request = createMockRequest('Bearer test-secret')
      const response = await GET(request)

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.message).toBe('Processed 1 jobs')
      expect(data.summary.successful).toBe(1)
    })

    it('should complete successful batch operation', async () => {
      const mockJob = {
        id: 'job-123',
        document_id: 'doc-123',
        status: 'processing',
        attempts: 1,
        max_attempts: 3,
        processing_method: 'batch',
        batch_operation_id: 'batch-op-456',
        documents: [{
          id: 'doc-123',
          title: 'Large Document',
          filename: 'large.pdf',
          file_size: 50 * 1024 * 1024,
          user_id: 'user-123'
        }]
      }

      setupJobMock([mockJob])

      // Mock batch operation completed
      mockBatchProcessor.getOperationStatus.mockResolvedValue({
        status: 'SUCCEEDED'
      })

      // Mock successful batch result processing
      mockBatchProcessor.processBatchResults.mockResolvedValue(undefined)
      mockBatchProcessor.cleanupBatchOperation.mockResolvedValue(undefined)

      // Mock document with extracted text for embeddings
      mockSupabase._mocks.single.mockResolvedValue({
        data: {
          extracted_text: 'Extracted text from batch processing'
        },
        error: null
      })

      const request = createMockRequest('Bearer test-secret')
      const response = await GET(request)

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.message).toBe('Processed 1 jobs')
      expect(data.summary.successful).toBe(1)

      // Verify job was marked as completed
      expect(mockSupabase._mocks.update).toHaveBeenCalledWith(expect.objectContaining({
        status: 'completed',
        completed_at: expect.any(String)
      }))
    })
  })

  describe('Error Handling', () => {
    it('should handle job processing failures with retry', async () => {
      const mockJob = {
        id: 'job-123',
        document_id: 'doc-123',
        status: 'queued',
        attempts: 1,
        max_attempts: 3,
        processing_method: 'sync',
        documents: [{
          id: 'doc-123',
          title: 'Test Document',
          filename: 'test.pdf',
          file_size: 1024 * 1024,
          user_id: 'user-123'
        }]
      }

      setupJobMock([mockJob])

      // Mock processing failure
      mockProcessDocument.mockRejectedValue(new Error('Temporary network error'))

      const request = createMockRequest('Bearer test-secret')
      const response = await GET(request)

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.message).toBe('Processed 1 jobs')
      expect(data.summary.successful).toBe(1)

      // Verify job was queued for retry
      expect(mockSupabase._mocks.update).toHaveBeenCalledWith({ status: 'queued' })
    })

    it('should handle permanent job failure after max attempts', async () => {
      const mockJob = {
        id: 'job-123',
        document_id: 'doc-123',
        status: 'queued',
        attempts: 3,
        max_attempts: 3,
        processing_method: 'sync',
        documents: [{
          id: 'doc-123',
          title: 'Test Document',
          filename: 'test.pdf',
          file_size: 1024 * 1024,
          user_id: 'user-123'
        }]
      }

      setupJobMock([mockJob])

      // Mock persistent failure
      mockProcessDocument.mockRejectedValue(new Error('Permanent processing error'))

      const request = createMockRequest('Bearer test-secret')
      const response = await GET(request)

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.message).toBe('Processed 1 jobs')
      expect(data.summary.failed).toBe(1)

      // Verify job was marked as failed
      expect(mockSupabase._mocks.update).toHaveBeenCalledWith(expect.objectContaining({
        status: 'failed',
        error_message: 'Permanent processing error',
        completed_at: expect.any(String)
      }))
    })

    it('should handle batch operation failures', async () => {
      const mockJob = {
        id: 'job-123',
        document_id: 'doc-123',
        status: 'processing',
        processing_method: 'batch',
        batch_operation_id: 'batch-op-456',
        attempts: 1,
        max_attempts: 3,
        documents: [{ id: 'doc-123' }]
      }

      setupJobMock([mockJob])

      // Mock batch operation failed
      mockBatchProcessor.getOperationStatus.mockResolvedValue({
        status: 'FAILED',
        error: 'Document AI processing failed'
      })

      const request = createMockRequest('Bearer test-secret')
      
      const response = await GET(request)
      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.summary.successful).toBe(1)
      expect(data.summary.details[0]?.status).toBe('fulfilled')

      // Verify job was marked as failed
      expect(mockSupabase._mocks.update).toHaveBeenCalledWith(expect.objectContaining({
        status: 'failed'
      }))
    })

    it('should handle database errors', async () => {
      mockSupabase._mocks.limit.mockResolvedValue({
        data: null,
        error: { message: 'Database connection failed' }
      })

      const request = createMockRequest('Bearer test-secret')
      const response = await GET(request)

      expect(response.status).toBe(500)
      const data = await response.json()
      expect(data.error).toBe('Failed to fetch jobs')
    })
  })

  describe('Sync-First Approach', () => {
    it('should always try sync processing first regardless of file size', async () => {
      const largeJob = {
        id: 'job-123',
        document_id: 'doc-123',
        status: 'queued',
        attempts: 0,
        max_attempts: 3,
        processing_method: null, // No processing method set
        documents: [{
          id: 'doc-123',
          title: 'Large Document',
          filename: 'large.pdf',
          file_size: 50 * 1024 * 1024, // 50MB - would traditionally be batch
          user_id: 'user-123'
        }]
      }

      setupJobMock([largeJob])

      const request = createMockRequest('Bearer test-secret')
      await GET(request)

      // Should attempt sync processing first
      expect(mockProcessDocument).toHaveBeenCalledWith('doc-123')

      // Should set processing method to sync
      expect(mockSupabase._mocks.update).toHaveBeenCalledWith(expect.objectContaining({
        processing_method: 'sync'
      }))
    })
  })
})
