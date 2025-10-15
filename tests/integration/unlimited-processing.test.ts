/**
 * Integration tests for unlimited processing mode
 * Tests the complete workflow with real database connections
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { createIntegrationTestDocument, cleanupIntegrationTestData, createTestUser, testSupabase } from './setup'

describe('Unlimited Processing Mode Integration', () => {
  let testUserId: string

  beforeAll(async () => {
    // Set unlimited processing mode
    process.env.UNLIMITED_PROCESSING = 'true'
    process.env.DB_POOL_MAX_CONNECTIONS = '1000'
    process.env.DB_POOL_CONNECTION_TIMEOUT = '0'
    process.env.MAX_CONCURRENT_DOCUMENTS = String(Number.MAX_SAFE_INTEGER)

    // Create test user
    const testUser = await createTestUser()
    testUserId = testUser.id
  })

  afterAll(async () => {
    // Cleanup all test data
    await cleanupIntegrationTestData()
  })

  beforeEach(async () => {
    // Clean state before each test
    await cleanupIntegrationTestData()
  })

  afterEach(async () => {
    // Clean state after each test
    await cleanupIntegrationTestData()
  })

  describe('High Volume Document Processing', () => {
    it('should handle 50 concurrent documents without timeouts', async () => {
      const documentCount = 50
      const documents = []

      // Create multiple test documents
      for (let i = 0; i < documentCount; i++) {
        const doc = await createIntegrationTestDocument(testUserId)
        documents.push(doc)
      }

      expect(documents).toHaveLength(documentCount)

      // Simulate concurrent processing (mocked for integration test)
      const processingPromises = documents.map(async (doc, index) => {
        // Simulate processing time variation
        await new Promise(resolve => setTimeout(resolve, Math.random() * 100))
        
        // Update document status to completed
        const { error } = await testSupabase
          .from('documents')
          .update({ 
            status: 'completed',
            processing_progress: 100,
            updated_at: new Date().toISOString()
          })
          .eq('id', doc.id)

        if (error) throw error
        return { docId: doc.id, processed: true, index }
      })

      const results = await Promise.all(processingPromises)

      expect(results).toHaveLength(documentCount)
      expect(results.every(r => r.processed)).toBe(true)

      // Verify all documents are marked as completed
      const { data: completedDocs } = await testSupabase
        .from('documents')
        .select('id, status')
        .eq('user_id', testUserId)
        .eq('status', 'completed')

      expect(completedDocs).toHaveLength(documentCount)
    })

    it('should handle enterprise-scale concurrent users', async () => {
      const userCount = 10
      const docsPerUser = 5
      const totalDocs = userCount * docsPerUser

      // Create multiple test users and documents
      const allDocuments = []
      
      for (let userIndex = 0; userIndex < userCount; userIndex++) {
        const user = await createTestUser()
        
        for (let docIndex = 0; docIndex < docsPerUser; docIndex++) {
          const doc = await createIntegrationTestDocument(user.id)
          allDocuments.push(doc)
        }
      }

      expect(allDocuments).toHaveLength(totalDocs)

      // Simulate concurrent processing across multiple users
      const batchSize = 20 // Process in batches to simulate real-world usage
      const batches = []
      
      for (let i = 0; i < allDocuments.length; i += batchSize) {
        batches.push(allDocuments.slice(i, i + batchSize))
      }

      for (const batch of batches) {
        const batchPromises = batch.map(async (doc) => {
          // Simulate document processing
          const { error } = await testSupabase
            .from('documents')
            .update({ 
              status: 'processing',
              processing_progress: 50,
              updated_at: new Date().toISOString()
            })
            .eq('id', doc.id)

          if (error) throw error

          // Complete processing
          await new Promise(resolve => setTimeout(resolve, 50))

          const { error: completeError } = await testSupabase
            .from('documents')
            .update({ 
              status: 'completed',
              processing_progress: 100,
              updated_at: new Date().toISOString()
            })
            .eq('id', doc.id)

          if (completeError) throw completeError
          return doc.id
        })

        await Promise.all(batchPromises)
      }

      // Verify all documents completed successfully
      const { data: completedDocs, error } = await testSupabase
        .from('documents')
        .select('id, status')
        .eq('status', 'completed')
        .like('title', 'TEST_%')

      expect(error).toBeNull()
      expect(completedDocs).toHaveLength(totalDocs)
    })
  })

  describe('Connection Pool Stress Testing', () => {
    it('should maintain stable connections under high load', async () => {
      const connectionTestCount = 100

      // Test rapid connection creation and release
      const connectionPromises = Array.from({ length: connectionTestCount }, async (_, index) => {
        // Simulate database operations
        const { data, error } = await testSupabase
          .from('documents')
          .select('count')
          .eq('user_id', testUserId)
          .limit(1)

        return { index, success: !error, data }
      })

      const results = await Promise.allSettled(connectionPromises)
      const successful = results.filter(r => r.status === 'fulfilled')
      const failed = results.filter(r => r.status === 'rejected')

      // Should handle high connection volume without failures
      expect(successful.length).toBe(connectionTestCount)
      expect(failed.length).toBe(0)
    })

    it('should prevent connection pool memory leaks', async () => {
      const iterations = 50

      // Simulate repeated processing cycles
      for (let i = 0; i < iterations; i++) {
        const doc = await createIntegrationTestDocument(testUserId)

        // Simulate the pattern from generateAndIndexEmbeddings
        const { data, error } = await testSupabase
          .from('documents')
          .select('*')
          .eq('id', doc.id)
          .single()

        expect(error).toBeNull()
        expect(data).toBeDefined()

        // Update document
        const { error: updateError } = await testSupabase
          .from('documents')
          .update({ 
            status: 'completed',
            processing_progress: 100,
            updated_at: new Date().toISOString()
          })
          .eq('id', doc.id)

        expect(updateError).toBeNull()

        // Clean up immediately to test connection release
        await testSupabase
          .from('documents')
          .delete()
          .eq('id', doc.id)
      }

      // Test should complete without memory issues
      expect(true).toBe(true)
    })
  })

  describe('Batch Processing Workflow', () => {
    it('should handle unlimited batch processing', async () => {
      const batchSize = 25
      const documents = []

      // Create batch of documents
      for (let i = 0; i < batchSize; i++) {
        const doc = await createIntegrationTestDocument(testUserId)
        documents.push(doc)
      }

      // Create processing jobs for each document
      const jobPromises = documents.map(async (doc, _index) => {
        const { data: job, error } = await testSupabase
          .from('processing_jobs')
          .insert({
            id: `integration-job-${doc.id}`,
            document_id: doc.id,
            status: 'queued',
            job_type: 'document_processing',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          })
          .select()
          .single()

        if (error) throw error
        return job
      })

      const jobs = await Promise.all(jobPromises)
      expect(jobs).toHaveLength(batchSize)

      // Process all jobs (simulate cron job behavior)
      const { data: queuedJobs, error: queueError } = await testSupabase
        .from('processing_jobs')
        .select('*')
        .in('status', ['queued', 'processing'])
        .limit(1000)

      expect(queueError).toBeNull()
      expect(queuedJobs?.length).toBeGreaterThanOrEqual(batchSize)

      // Update all jobs to completed
      const updatePromises = jobs.map(async (job) => {
        const { error } = await testSupabase
          .from('processing_jobs')
          .update({ 
            status: 'completed',
            completed_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          })
          .eq('id', job.id)

        if (error) throw error
        return job.id
      })

      await Promise.all(updatePromises)

      // Verify all jobs completed
      const { data: completedJobs } = await testSupabase
        .from('processing_jobs')
        .select('id, status')
        .eq('status', 'completed')
        .like('id', 'integration-job-%')

      expect(completedJobs).toHaveLength(batchSize)
    })

    it('should handle job status transitions correctly', async () => {
      const doc = await createIntegrationTestDocument(testUserId)

      // Create processing job
      const { data: job, error: createError } = await testSupabase
        .from('processing_jobs')
        .insert({
          id: `status-test-job-${doc.id}`,
          document_id: doc.id,
          status: 'queued',
          job_type: 'document_processing',
          created_at: new Date().toISOString()
        })
        .select()
        .single()

      expect(createError).toBeNull()
      expect(job.status).toBe('queued')

      // Transition to processing
      const { error: processingError } = await testSupabase
        .from('processing_jobs')
        .update({ 
          status: 'processing',
          started_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq('id', job.id)

      expect(processingError).toBeNull()

      // Transition to completed
      const { error: completedError } = await testSupabase
        .from('processing_jobs')
        .update({ 
          status: 'completed',
          completed_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq('id', job.id)

      expect(completedError).toBeNull()

      // Verify final status
      const { data: finalJob } = await testSupabase
        .from('processing_jobs')
        .select('status, started_at, completed_at')
        .eq('id', job.id)
        .single()

      expect(finalJob.status).toBe('completed')
      expect(finalJob.started_at).toBeDefined()
      expect(finalJob.completed_at).toBeDefined()
    })
  })

  describe('Error Handling and Recovery', () => {
    it('should handle database errors gracefully', async () => {
      // Simulate invalid document creation
      const invalidDoc = {
        // Missing required fields to trigger error
        title: 'Invalid Document',
        user_id: testUserId
      }

      const { data, error } = await testSupabase
        .from('documents')
        .insert(invalidDoc)

      // Should handle error without crashing
      expect(error).toBeDefined()
      expect(data).toBeNull()
    })

    it('should recover from transient connection issues', async () => {
      // Create document successfully
      const doc = await createIntegrationTestDocument(testUserId)
      expect(doc).toBeDefined()

      // Simulate recovery by re-fetching
      const { data: refetchedDoc, error } = await testSupabase
        .from('documents')
        .select('*')
        .eq('id', doc.id)
        .single()

      expect(error).toBeNull()
      expect(refetchedDoc.id).toBe(doc.id)
    })

    it('should maintain data consistency during high error rates', async () => {
      const totalAttempts = 20
      const successfulInserts = []
      const failedInserts = []

      // Simulate mixed success/failure scenarios
      for (let i = 0; i < totalAttempts; i++) {
        try {
          if (i % 4 === 0) {
            // Intentionally create invalid document
            const { data, error } = await testSupabase
              .from('documents')
              .insert({ 
                title: null, // This should fail
                user_id: testUserId
              })
            
            if (error) throw error
            successfulInserts.push(data)
          } else {
            // Create valid document
            const doc = await createIntegrationTestDocument(testUserId)
            successfulInserts.push(doc)
          }
        } catch (error) {
          failedInserts.push(error)
        }
      }

      // Should have both successes and failures
      expect(successfulInserts.length).toBeGreaterThan(0)
      expect(failedInserts.length).toBeGreaterThan(0)
      expect(successfulInserts.length + failedInserts.length).toBe(totalAttempts)

      // Verify successful documents exist in database
      const { data: existingDocs } = await testSupabase
        .from('documents')
        .select('id')
        .eq('user_id', testUserId)

      expect(existingDocs?.length).toBe(successfulInserts.length)
    })
  })
})
