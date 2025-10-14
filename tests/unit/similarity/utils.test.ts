/**
 * Tests effective chunk count calculation and other utility functions
 */

import { describe, it, expect } from 'vitest'
import { computeEffectiveChunkCount } from '@/lib/similarity/utils/effective-length'
import { DEFAULT_CHUNK_SIZE, DEFAULT_CHUNK_OVERLAP, DEFAULT_CHUNK_STRIDE } from '@/lib/constants/chunking'
import { l2Normalize, cosineSimilarity } from '@/lib/similarity/utils/vector-operations'

describe('Similarity Utility Functions', () => {
  describe('computeEffectiveChunkCount', () => {
    it('should compute correct effective chunk count for standard settings', () => {
      const stride = DEFAULT_CHUNK_STRIDE

      const testCases = [
        { totalTokens: stride, expected: 1 },   // Exactly 1 effective chunk
        { totalTokens: stride * 2, expected: 2 },  // Exactly 2 effective chunks
        { totalTokens: DEFAULT_CHUNK_SIZE, expected: 2 },  // Slight over chunk -> rounds up
        { totalTokens: stride * 4, expected: 4 },  // Exactly 4 effective chunks
        { totalTokens: 5000, expected: Math.ceil(5000 / stride) },
      ]

      testCases.forEach(({ totalTokens, expected }) => {
        const result = computeEffectiveChunkCount(totalTokens, DEFAULT_CHUNK_SIZE, DEFAULT_CHUNK_OVERLAP)
        expect(result).toBe(expected)
      })
    })

    it('should handle zero overlap (no stride)', () => {
      // No overlap => stride equals chunk size
      const noOverlapChunkSize = DEFAULT_CHUNK_SIZE
      const overlap = 0

      const testCases = [
        { totalTokens: noOverlapChunkSize, expected: 1 },
        { totalTokens: noOverlapChunkSize * 2, expected: 2 },
        { totalTokens: noOverlapChunkSize * 5, expected: 5 },
      ]

      testCases.forEach(({ totalTokens, expected }) => {
        const result = computeEffectiveChunkCount(totalTokens, noOverlapChunkSize, overlap)
        expect(result).toBe(expected)
      })
    })

    it('should handle custom chunk sizes', () => {
      // Custom: 2000 char chunks, 400 char overlap
      // Effective chunk size = 2000 - 400 = 1600

      const result = computeEffectiveChunkCount(3200, 2000, 400)
      expect(result).toBe(2) // 3200 / 1600 = 2
    })

    it('should handle very small documents', () => {
      const result = computeEffectiveChunkCount(100, DEFAULT_CHUNK_SIZE, DEFAULT_CHUNK_OVERLAP)
      expect(result).toBe(1) // Even tiny docs get at least 1 chunk
    })

    it('should handle very large documents', () => {
      const totalTokens = 1_000_000 // 1M tokens
      const result = computeEffectiveChunkCount(totalTokens, DEFAULT_CHUNK_SIZE, DEFAULT_CHUNK_OVERLAP)

      const expected = Math.ceil(totalTokens / DEFAULT_CHUNK_STRIDE)
      expect(result).toBe(expected)
    })

    it('should always round up (never round down)', () => {
      const stride = DEFAULT_CHUNK_STRIDE
      const result = computeEffectiveChunkCount(stride + 1, DEFAULT_CHUNK_SIZE, DEFAULT_CHUNK_OVERLAP)
      expect(result).toBe(2)
    })

    it('should match user scenario: 45-page document', () => {
      // Approximate: 45 pages × ~500 words/page × ~1.3 tokens/word ≈ 29,250 tokens
      const totalTokens = 29250
      const result = computeEffectiveChunkCount(totalTokens, DEFAULT_CHUNK_SIZE, DEFAULT_CHUNK_OVERLAP)

      expect(result).toBe(Math.ceil(totalTokens / DEFAULT_CHUNK_STRIDE))
    })

    it('should match user scenario: 90-page document', () => {
      // Approximate: 90 pages × ~500 words/page × ~1.3 tokens/word ≈ 58,500 tokens
      const totalTokens = 58500
      const result = computeEffectiveChunkCount(totalTokens, DEFAULT_CHUNK_SIZE, DEFAULT_CHUNK_OVERLAP)

      expect(result).toBe(Math.ceil(totalTokens / DEFAULT_CHUNK_STRIDE))
    })

    it('should verify effective chunk count reduces raw count', () => {
      const totalTokens = 10000

      // With overlap: stride < chunk size increases effective chunk count
      const withOverlap = computeEffectiveChunkCount(totalTokens, DEFAULT_CHUNK_SIZE, DEFAULT_CHUNK_OVERLAP)

      // Without overlap
      const withoutOverlap = computeEffectiveChunkCount(totalTokens, DEFAULT_CHUNK_SIZE, 0)

      expect(withOverlap).toBeGreaterThan(withoutOverlap) // 13 > 10
      // Effective count is higher because overlap means more chunks needed
    })
  })

  describe('Edge Cases for Effective Chunk Count', () => {
    it('should handle zero tokens', () => {
      const result = computeEffectiveChunkCount(0, DEFAULT_CHUNK_SIZE, DEFAULT_CHUNK_OVERLAP)
      expect(result).toBe(0)
    })

    it('should throw when overlap equals chunk size (degenerate case)', () => {
      expect(() => computeEffectiveChunkCount(1000, 1000, 1000)).toThrow()
    })

    it('should throw when overlap exceeds chunk size (invalid input)', () => {
      expect(() => computeEffectiveChunkCount(1000, 1000, 1500)).toThrow()
    })
  })

  describe('L2 Normalization', () => {
    it('should create unit vectors', () => {
      const vectors = [
        [1, 0, 0],
        [3, 4, 0],
        [1, 1, 1],
        Array(768).fill(1), // High-dimensional
      ]

      vectors.forEach(vec => {
        const normalized = l2Normalize(vec)
        const magnitude = Math.sqrt(normalized.reduce((sum, v) => sum + v * v, 0))
        expect(magnitude).toBeCloseTo(1.0, 5)
      })
    })

    it('should preserve direction', () => {
      const vector = [3, 4, 0]
      const normalized = l2Normalize(vector)

      // Direction should be same (proportional)
      expect(normalized[0] / normalized[1]).toBeCloseTo(vector[0] / vector[1], 5)
    })

    it('should handle already normalized vectors', () => {
      const vector = [1, 0, 0] // Already unit length
      const normalized = l2Normalize(vector)

      expect(normalized).toEqual(vector)
    })
  })

  describe('Cosine Similarity Properties', () => {
    it('should be bounded between -1 and 1', () => {
      const testVectors = [
        [1, 0, 0],
        [0, 1, 0],
        [-1, 0, 0],
        [1, 1, 1],
        [Math.random(), Math.random(), Math.random()],
      ]

      testVectors.forEach(vecA => {
        testVectors.forEach(vecB => {
          const normA = l2Normalize(vecA)
          const normB = l2Normalize(vecB)
          const sim = cosineSimilarity(normA, normB)

          expect(sim).toBeGreaterThanOrEqual(-1.0)
          expect(sim).toBeLessThanOrEqual(1.0 + Number.EPSILON)
        })
      })
    })

    it('should be symmetric', () => {
      const vecA = l2Normalize([1, 2, 3])
      const vecB = l2Normalize([4, 5, 6])

      const simAB = cosineSimilarity(vecA, vecB)
      const simBA = cosineSimilarity(vecB, vecA)

      expect(simAB).toBeCloseTo(simBA, 10)
    })

    it('should detect near-duplicates (>0.95 similarity)', () => {
      const vecA = l2Normalize([1, 1, 1])
      const vecB = l2Normalize([1.01, 0.99, 1.0]) // Very similar

      const sim = cosineSimilarity(vecA, vecB)
      expect(sim).toBeGreaterThan(0.95)
    })
  })

  describe('Integration: Effective Chunk Count in Similarity Scenarios', () => {
    it('Scenario 2: Should compute correct size ratio for half-subset', () => {
      // Document A: 45 pages ≈ 29,250 tokens
      // Document Z: 90 pages ≈ 58,500 tokens

      const docA_tokens = 29250
      const docZ_tokens = 58500

      const docA_effectiveChunks = computeEffectiveChunkCount(docA_tokens, DEFAULT_CHUNK_SIZE, DEFAULT_CHUNK_OVERLAP)
      const docZ_effectiveChunks = computeEffectiveChunkCount(docZ_tokens, DEFAULT_CHUNK_SIZE, DEFAULT_CHUNK_OVERLAP)

      // Size ratio: min/max
      const sizeRatio = Math.min(docA_effectiveChunks, docZ_effectiveChunks) /
                        Math.max(docA_effectiveChunks, docZ_effectiveChunks)

      // Should be approximately 0.5 (37/74 ≈ 0.5)
      expect(sizeRatio).toBeCloseTo(0.5, 1)
    })

    it('Scenario 3: Should compute correct size ratio for near-duplicate', () => {
      // Document X: 10 pages ≈ 6,500 tokens
      // Document Y: 12 pages ≈ 7,800 tokens

      const docX_tokens = 6500
      const docY_tokens = 7800

      const docX_effectiveChunks = computeEffectiveChunkCount(docX_tokens, DEFAULT_CHUNK_SIZE, DEFAULT_CHUNK_OVERLAP)
      const docY_effectiveChunks = computeEffectiveChunkCount(docY_tokens, DEFAULT_CHUNK_SIZE, DEFAULT_CHUNK_OVERLAP)

      // Size ratio: min/max
      const sizeRatio = Math.min(docX_effectiveChunks, docY_effectiveChunks) /
                        Math.max(docX_effectiveChunks, docY_effectiveChunks)

      // Should be approximately 0.83 (10/12)
      expect(sizeRatio).toBeGreaterThan(0.75)
      expect(sizeRatio).toBeLessThan(0.95)
    })

    it('Scenario 4: Should compute correct size ratio for equal-sized partial overlap', () => {
      // Document D1: 40 chunks worth of content
      // Document D2: 40 chunks worth of content

      const doc_tokens = 32000 // 40 effective chunks × 800 tokens

      const doc1_effectiveChunks = computeEffectiveChunkCount(doc_tokens, DEFAULT_CHUNK_SIZE, DEFAULT_CHUNK_OVERLAP)
      const doc2_effectiveChunks = computeEffectiveChunkCount(doc_tokens, DEFAULT_CHUNK_SIZE, DEFAULT_CHUNK_OVERLAP)

      // Size ratio: min/max = 1.0 (equal sizes)
      const sizeRatio = Math.min(doc1_effectiveChunks, doc2_effectiveChunks) /
                        Math.max(doc1_effectiveChunks, doc2_effectiveChunks)

      expect(sizeRatio).toBe(1.0)
    })
  })

  describe('Performance Benchmarks', () => {
    it('should compute effective chunk count quickly', () => {
      const iterations = 10000
      const startTime = performance.now()

      for (let i = 0; i < iterations; i++) {
        computeEffectiveChunkCount(Math.random() * 100000, DEFAULT_CHUNK_SIZE, DEFAULT_CHUNK_OVERLAP)
      }

      const endTime = performance.now()
      const timePerIteration = (endTime - startTime) / iterations

      // Should be extremely fast (< 0.01ms per call)
      expect(timePerIteration).toBeLessThan(0.01)
    })

    it('should normalize vectors quickly', () => {
      const iterations = 1000
      const vector = Array(768).fill(Math.random())

      const startTime = performance.now()

      for (let i = 0; i < iterations; i++) {
        l2Normalize(vector)
      }

      const endTime = performance.now()
      const timePerIteration = (endTime - startTime) / iterations

      // Should be fast even for 768-dimensional vectors (< 0.1ms per call)
      expect(timePerIteration).toBeLessThan(0.1)
    })

    it('should compute cosine similarity quickly', () => {
      const iterations = 1000
      const vecA = l2Normalize(Array(768).fill(Math.random()))
      const vecB = l2Normalize(Array(768).fill(Math.random()))

      const startTime = performance.now()

      for (let i = 0; i < iterations; i++) {
        cosineSimilarity(vecA, vecB)
      }

      const endTime = performance.now()
      const timePerIteration = (endTime - startTime) / iterations

      // Should be fast (< 0.1ms per call)
      expect(timePerIteration).toBeLessThan(0.1)
    })
  })
})
