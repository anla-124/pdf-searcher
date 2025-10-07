/**
 * API Tests for Search Functionality
 * Tests similarity search, hybrid search, and filtering capabilities
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import { createServer } from 'http'
import { parse } from 'url'
import next from 'next'

const dev = process.env.NODE_ENV !== 'production'
const hostname = 'localhost'
const port = 3003

let app: any
let server: any
let handle: any
let authToken: string

describe('Search API Endpoints', () => {
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
        console.log(`Search test server listening on port ${port}`)
        resolve()
      })
    })

    authToken = 'test_token'
  })

  afterAll(async () => {
    if (server) server.close()
    if (app) await app.close()
  })

  describe('POST /api/search', () => {
    it('should perform basic text search', async () => {
      const response = await request(`http://localhost:${port}`)
        .post('/api/search')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          query: 'subscription agreement',
          type: 'text'
        })
        .expect(200)

      expect(response.body).toHaveProperty('results')
      expect(Array.isArray(response.body.results)).toBe(true)
      expect(response.body).toHaveProperty('total_count')
      expect(response.body).toHaveProperty('search_type', 'text')
    })

    it('should perform semantic similarity search', async () => {
      const response = await request(`http://localhost:${port}`)
        .post('/api/search')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          query: 'investment terms and conditions',
          type: 'semantic'
        })
        .expect(200)

      expect(response.body).toHaveProperty('results')
      expect(response.body).toHaveProperty('search_type', 'semantic')
      expect(response.body.results).toSatisfy((results: any[]) => 
        results.every(result => 
          result.hasOwnProperty('similarity_score') && 
          typeof result.similarity_score === 'number' &&
          result.similarity_score >= 0 && 
          result.similarity_score <= 1
        )
      )
    })

    it('should perform hybrid search (text + semantic)', async () => {
      const response = await request(`http://localhost:${port}`)
        .post('/api/search')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          query: 'private equity fund documents',
          type: 'hybrid',
          text_weight: 0.3,
          semantic_weight: 0.7
        })
        .expect(200)

      expect(response.body).toHaveProperty('results')
      expect(response.body).toHaveProperty('search_type', 'hybrid')
      expect(response.body).toHaveProperty('text_weight', 0.3)
      expect(response.body).toHaveProperty('semantic_weight', 0.7)
    })

    it('should support pagination in search results', async () => {
      const response = await request(`http://localhost:${port}`)
        .post('/api/search')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          query: 'fund documents',
          type: 'text',
          page: 1,
          limit: 5
        })
        .expect(200)

      expect(response.body).toHaveProperty('results')
      expect(response.body.results.length).toBeLessThanOrEqual(5)
      expect(response.body).toHaveProperty('pagination')
      expect(response.body.pagination).toHaveProperty('page', 1)
      expect(response.body.pagination).toHaveProperty('limit', 5)
    })

    it('should filter by metadata fields', async () => {
      const response = await request(`http://localhost:${port}`)
        .post('/api/search')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          query: 'investment agreement',
          type: 'text',
          filters: {
            law_firm: 'STB',
            fund_manager: 'Blackstone',
            jurisdiction: 'Delaware'
          }
        })
        .expect(200)

      expect(response.body).toHaveProperty('results')
      expect(response.body).toHaveProperty('applied_filters')
      
      // Verify all results match the filters
      response.body.results.forEach((result: any) => {
        expect(result.metadata.law_firm).toBe('STB')
        expect(result.metadata.fund_manager).toBe('Blackstone')
        expect(result.metadata.jurisdiction).toBe('Delaware')
      })
    })

    it('should filter by date range', async () => {
      const response = await request(`http://localhost:${port}`)
        .post('/api/search')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          query: 'fund documents',
          type: 'text',
          filters: {
            date_from: '2024-01-01',
            date_to: '2024-12-31'
          }
        })
        .expect(200)

      expect(response.body).toHaveProperty('results')
      
      // Verify all results are within date range
      response.body.results.forEach((result: any) => {
        const resultDate = new Date(result.created_at)
        expect(resultDate >= new Date('2024-01-01')).toBe(true)
        expect(resultDate <= new Date('2024-12-31')).toBe(true)
      })
    })

    it('should handle empty search queries', async () => {
      const response = await request(`http://localhost:${port}`)
        .post('/api/search')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          query: '',
          type: 'text'
        })
        .expect(400)

      expect(response.body).toHaveProperty('error')
      expect(response.body.error).toContain('query')
    })

    it('should validate search type', async () => {
      await request(`http://localhost:${port}`)
        .post('/api/search')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          query: 'test query',
          type: 'invalid_type'
        })
        .expect(400)
    })

    it('should enforce minimum query length', async () => {
      await request(`http://localhost:${port}`)
        .post('/api/search')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          query: 'a', // Too short
          type: 'text'
        })
        .expect(400)
    })

    it('should handle special characters in queries', async () => {
      const response = await request(`http://localhost:${port}`)
        .post('/api/search')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          query: 'fund "subscription agreement" AND (Delaware OR Cayman)',
          type: 'text'
        })
        .expect(200)

      expect(response.body).toHaveProperty('results')
    })

    it('should return highlighted text snippets', async () => {
      const response = await request(`http://localhost:${port}`)
        .post('/api/search')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          query: 'subscription agreement',
          type: 'text',
          include_highlights: true
        })
        .expect(200)

      expect(response.body).toHaveProperty('results')
      response.body.results.forEach((result: any) => {
        expect(result).toHaveProperty('highlights')
        expect(Array.isArray(result.highlights)).toBe(true)
      })
    })

    it('should require authentication', async () => {
      await request(`http://localhost:${port}`)
        .post('/api/search')
        .send({
          query: 'test query',
          type: 'text'
        })
        .expect(401)
    })
  })

  describe('GET /api/documents/selected-search', () => {
    it('should search within selected documents', async () => {
      const response = await request(`http://localhost:${port}`)
        .get('/api/documents/selected-search')
        .query({
          query: 'investment terms',
          document_ids: 'doc1,doc2,doc3'
        })
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200)

      expect(response.body).toHaveProperty('results')
      expect(response.body).toHaveProperty('searched_documents')
      expect(response.body.searched_documents).toEqual(['doc1', 'doc2', 'doc3'])
    })

    it('should validate document IDs format', async () => {
      await request(`http://localhost:${port}`)
        .get('/api/documents/selected-search')
        .query({
          query: 'test query',
          document_ids: '' // Empty document IDs
        })
        .set('Authorization', `Bearer ${authToken}`)
        .expect(400)
    })
  })

  describe('Search Performance Tests', () => {
    it('should handle concurrent search requests', async () => {
      const searches = Array.from({ length: 10 }, (_, i) => 
        request(`http://localhost:${port}`)
          .post('/api/search')
          .set('Authorization', `Bearer ${authToken}`)
          .send({
            query: `test query ${i}`,
            type: 'text'
          })
      )

      const responses = await Promise.all(searches)
      
      responses.forEach(response => {
        expect(response.status).toBe(200)
        expect(response.body).toHaveProperty('results')
      })
    })

    it('should respond within acceptable time limits', async () => {
      const startTime = Date.now()
      
      await request(`http://localhost:${port}`)
        .post('/api/search')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          query: 'complex query with multiple terms and filters',
          type: 'hybrid',
          filters: {
            law_firm: 'STB',
            fund_manager: 'Blackstone'
          }
        })
        .expect(200)

      const responseTime = Date.now() - startTime
      expect(responseTime).toBeLessThan(5000) // Should respond within 5 seconds
    })
  })

  describe('Search Analytics', () => {
    it('should track search queries for analytics', async () => {
      const response = await request(`http://localhost:${port}`)
        .post('/api/search')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          query: 'subscription agreement',
          type: 'text',
          track_analytics: true
        })
        .expect(200)

      expect(response.body).toHaveProperty('search_id')
      expect(response.body).toHaveProperty('results')
    })
  })
})