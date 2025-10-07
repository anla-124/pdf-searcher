/**
 * API Tests for Document Management Endpoints
 * Tests all document-related CRUD operations and processing
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import request from 'supertest'
import { createServer } from 'http'
import { parse } from 'url'
import next from 'next'
import path from 'path'
import fs from 'fs'

const dev = process.env.NODE_ENV !== 'production'
const hostname = 'localhost'
const port = 3002

let app: any
let server: any
let handle: any
let authToken: string

describe('Documents API Endpoints', () => {
  beforeAll(async () => {
    app = next({ dev, hostname, port })
    handle = app.getRequestHandler()
    await app.prepare()

    server = createServer(async (req, res) => {
      const parsedUrl = parse(req.url!, true)
      await handle(req, res, parsedUrl)
    })

    await new Promise<void>((resolve) => {
      server.listen(port, () => {
        console.log(`Document test server listening on port ${port}`)
        resolve()
      })
    })

    // TODO: Set up authentication token for testing
    authToken = 'test_token'
  })

  afterAll(async () => {
    if (server) server.close()
    if (app) await app.close()
  })

  describe('GET /api/documents', () => {
    it('should return list of documents', async () => {
      const response = await request(`http://localhost:${port}`)
        .get('/api/documents')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200)

      expect(response.body).toHaveProperty('documents')
      expect(Array.isArray(response.body.documents)).toBe(true)
    })

    it('should support pagination', async () => {
      const response = await request(`http://localhost:${port}`)
        .get('/api/documents')
        .query({ page: 1, limit: 10 })
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200)

      expect(response.body).toHaveProperty('documents')
      expect(response.body).toHaveProperty('pagination')
      expect(response.body.pagination).toHaveProperty('page', 1)
      expect(response.body.pagination).toHaveProperty('limit', 10)
    })

    it('should support filtering by metadata', async () => {
      const response = await request(`http://localhost:${port}`)
        .get('/api/documents')
        .query({ 
          law_firm: 'STB',
          fund_manager: 'Blackstone'
        })
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200)

      expect(response.body).toHaveProperty('documents')
    })

    it('should require authentication', async () => {
      await request(`http://localhost:${port}`)
        .get('/api/documents')
        .expect(401)
    })
  })

  describe('POST /api/documents/upload', () => {
    const testPdfPath = path.join(__dirname, '../fixtures/sample-document.pdf')

    beforeEach(() => {
      // Ensure test PDF exists
      if (!fs.existsSync(testPdfPath)) {
        // Create minimal PDF for testing
        const minimalPdf = Buffer.from('%PDF-1.4\n1 0 obj\n<<\n/Type /Catalog\n/Pages 2 0 R\n>>\nendobj\n2 0 obj\n<<\n/Type /Pages\n/Kids [3 0 R]\n/Count 1\n>>\nendobj\n3 0 obj\n<<\n/Type /Page\n/Parent 2 0 R\n/MediaBox [0 0 612 792]\n>>\nendobj\nxref\n0 4\n0000000000 65535 f \n0000000009 00000 n \n0000000074 00000 n \n0000000120 00000 n \ntrailer\n<<\n/Size 4\n/Root 1 0 R\n>>\nstartxref\n178\n%%EOF')
        fs.mkdirSync(path.dirname(testPdfPath), { recursive: true })
        fs.writeFileSync(testPdfPath, minimalPdf)
      }
    })

    it('should upload PDF document successfully', async () => {
      const response = await request(`http://localhost:${port}`)
        .post('/api/documents/upload')
        .set('Authorization', `Bearer ${authToken}`)
        .attach('file', testPdfPath)
        .field('law_firm', 'STB')
        .field('fund_manager', 'Blackstone')
        .field('fund_admin', 'Standish')
        .field('jurisdiction', 'Delaware')
        .expect(200)

      expect(response.body).toHaveProperty('success', true)
      expect(response.body).toHaveProperty('document_id')
      expect(response.body).toHaveProperty('message')
    })

    it('should reject non-PDF files', async () => {
      const textFilePath = path.join(__dirname, '../fixtures/invalid-file.txt')
      fs.writeFileSync(textFilePath, 'This is not a PDF')

      await request(`http://localhost:${port}`)
        .post('/api/documents/upload')
        .set('Authorization', `Bearer ${authToken}`)
        .attach('file', textFilePath)
        .field('law_firm', 'STB')
        .field('fund_manager', 'Blackstone')
        .field('fund_admin', 'Standish')
        .field('jurisdiction', 'Delaware')
        .expect(400)

      fs.unlinkSync(textFilePath)
    })

    it('should reject files exceeding size limit', async () => {
      // Create large file (>50MB based on your config)
      const largePdfPath = path.join(__dirname, '../fixtures/large-document.pdf')
      const largeBuffer = Buffer.alloc(60 * 1024 * 1024) // 60MB
      fs.writeFileSync(largePdfPath, largeBuffer)

      await request(`http://localhost:${port}`)
        .post('/api/documents/upload')
        .set('Authorization', `Bearer ${authToken}`)
        .attach('file', largePdfPath)
        .field('law_firm', 'STB')
        .field('fund_manager', 'Blackstone')
        .field('fund_admin', 'Standish')
        .field('jurisdiction', 'Delaware')
        .expect(413)

      fs.unlinkSync(largePdfPath)
    })

    it('should require all metadata fields', async () => {
      await request(`http://localhost:${port}`)
        .post('/api/documents/upload')
        .set('Authorization', `Bearer ${authToken}`)
        .attach('file', testPdfPath)
        .field('law_firm', 'STB')
        // Missing other required fields
        .expect(400)
    })

    it('should require authentication', async () => {
      await request(`http://localhost:${port}`)
        .post('/api/documents/upload')
        .attach('file', testPdfPath)
        .expect(401)
    })
  })

  describe('GET /api/documents/:id', () => {
    it('should return specific document details', async () => {
      const documentId = 'test-document-id'
      
      const response = await request(`http://localhost:${port}`)
        .get(`/api/documents/${documentId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200)

      expect(response.body).toHaveProperty('document')
      expect(response.body.document).toHaveProperty('id', documentId)
    })

    it('should return 404 for non-existent document', async () => {
      await request(`http://localhost:${port}`)
        .get('/api/documents/non-existent-id')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(404)
    })

    it('should require authentication', async () => {
      await request(`http://localhost:${port}`)
        .get('/api/documents/test-id')
        .expect(401)
    })
  })

  describe('PUT /api/documents/:id', () => {
    it('should update document metadata', async () => {
      const documentId = 'test-document-id'
      
      const response = await request(`http://localhost:${port}`)
        .put(`/api/documents/${documentId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          law_firm: 'Updated Law Firm',
          fund_manager: 'Updated Fund Manager'
        })
        .expect(200)

      expect(response.body).toHaveProperty('success', true)
      expect(response.body).toHaveProperty('document')
    })

    it('should validate metadata fields', async () => {
      const documentId = 'test-document-id'
      
      await request(`http://localhost:${port}`)
        .put(`/api/documents/${documentId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          law_firm: '', // Invalid empty value
        })
        .expect(400)
    })
  })

  describe('DELETE /api/documents/:id', () => {
    it('should delete document successfully', async () => {
      const documentId = 'test-document-id'
      
      const response = await request(`http://localhost:${port}`)
        .delete(`/api/documents/${documentId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200)

      expect(response.body).toHaveProperty('success', true)
      expect(response.body).toHaveProperty('message')
    })

    it('should return 404 for non-existent document', async () => {
      await request(`http://localhost:${port}`)
        .delete('/api/documents/non-existent-id')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(404)
    })
  })

  describe('GET /api/documents/:id/processing-status', () => {
    it('should return processing status', async () => {
      const documentId = 'test-document-id'
      
      const response = await request(`http://localhost:${port}`)
        .get(`/api/documents/${documentId}/processing-status`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200)

      expect(response.body).toHaveProperty('status')
      expect(['pending', 'processing', 'completed', 'failed']).toContain(response.body.status)
    })
  })

  describe('GET /api/documents/:id/download', () => {
    it('should download original document', async () => {
      const documentId = 'test-document-id'
      
      const response = await request(`http://localhost:${port}`)
        .get(`/api/documents/${documentId}/download`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200)

      expect(response.headers['content-type']).toBe('application/pdf')
      expect(response.headers['content-disposition']).toContain('attachment')
    })
  })

  describe('GET /api/documents/:id/similar', () => {
    it('should return similar documents', async () => {
      const documentId = 'test-document-id'
      
      const response = await request(`http://localhost:${port}`)
        .get(`/api/documents/${documentId}/similar`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200)

      expect(response.body).toHaveProperty('similar_documents')
      expect(Array.isArray(response.body.similar_documents)).toBe(true)
    })

    it('should support similarity threshold parameter', async () => {
      const documentId = 'test-document-id'
      
      const response = await request(`http://localhost:${port}`)
        .get(`/api/documents/${documentId}/similar`)
        .query({ threshold: 0.8 })
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200)

      expect(response.body).toHaveProperty('similar_documents')
    })
  })
})