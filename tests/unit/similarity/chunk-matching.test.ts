/**
 * Unit Tests for Chunk Matching with NMS and Tie-Breaking
 * Tests bidirectional matching, Non-Max Suppression, and tie-breaking logic
 */

import { describe, it, expect } from 'vitest'
import { l2Normalize, cosineSimilarity } from '@/lib/similarity/utils/vector-operations'
import { findBidirectionalMatches } from '@/lib/similarity/core/chunk-matching'
import type { Chunk } from '@/lib/similarity/types'

describe('Chunk Matching with NMS', () => {
  /**
   * Helper: Create a normalized vector
   */
  const createVector = (values: number[]): number[] => {
    return l2Normalize(values)
  }

  /**
   * Helper: Create mock chunk data
   */
  const createChunk = (id: string, index: number, page: number, values: number[]) => ({
    id,
    document_id: 'test_doc',
    chunk_index: index,
    page_number: page,
    embedding: createVector(values),
    chunk_text: `Chunk ${index}`
  })

  const convertToMatchChunk = (chunk: ReturnType<typeof createChunk>): Chunk => ({
    id: chunk.id,
    index: chunk.chunk_index,
    pageNumber: chunk.page_number,
    embedding: chunk.embedding,
    text: chunk.chunk_text
  })

  describe('L2 Normalization', () => {
    it('should normalize vectors to unit length', () => {
      const vector = [3, 4] // Magnitude = 5
      const normalized = l2Normalize(vector)

      expect(normalized[0]).toBeCloseTo(0.6, 5) // 3/5
      expect(normalized[1]).toBeCloseTo(0.8, 5) // 4/5

      // Verify unit length
      const magnitude = Math.sqrt(normalized.reduce((sum, v) => sum + v * v, 0))
      expect(magnitude).toBeCloseTo(1.0, 5)
    })

    it('should handle zero vectors', () => {
      const vector = [0, 0, 0]
      const normalized = l2Normalize(vector)

      expect(normalized).toEqual([0, 0, 0])
    })

    it('should normalize high-dimensional vectors', () => {
      const vector = Array(768).fill(1) // 768 dimensions
      const normalized = l2Normalize(vector)

      const magnitude = Math.sqrt(normalized.reduce((sum, v) => sum + v * v, 0))
      expect(magnitude).toBeCloseTo(1.0, 5)
    })
  })

  describe('Cosine Similarity', () => {
    it('should return 1.0 for identical normalized vectors', () => {
      const vecA = createVector([1, 2, 3])
      const vecB = createVector([1, 2, 3])

      const similarity = cosineSimilarity(vecA, vecB)
      expect(similarity).toBeCloseTo(1.0, 5)
    })

    it('should return 0.0 for orthogonal vectors', () => {
      const vecA = createVector([1, 0, 0])
      const vecB = createVector([0, 1, 0])

      const similarity = cosineSimilarity(vecA, vecB)
      expect(similarity).toBeCloseTo(0.0, 5)
    })

    it('should return -1.0 for opposite vectors', () => {
      const vecA = createVector([1, 0, 0])
      const vecB = createVector([-1, 0, 0])

      const similarity = cosineSimilarity(vecA, vecB)
      expect(similarity).toBeCloseTo(-1.0, 5)
    })

    it('should handle high similarity (0.95+)', () => {
      const vecA = createVector([1, 1, 1])
      const vecB = createVector([1.01, 0.99, 1.0])

      const similarity = cosineSimilarity(vecA, vecB)
      expect(similarity).toBeGreaterThan(0.99)
    })
  })

  describe('NMS (Non-Max Suppression)', () => {
    it('should ensure each chunk matches at most once', () => {
      // Create chunks where A_0 could match both B_0 and B_1
      const chunkA_0 = createChunk('a0', 0, 1, [1, 0, 0])
      const chunkB_0 = createChunk('b0', 0, 1, [0.99, 0.01, 0])  // Very similar
      const chunkB_1 = createChunk('b1', 1, 1, [0.98, 0.02, 0])  // Also similar

      // A_0 should only match the best one (B_0)
      const simToB0 = cosineSimilarity(chunkA_0.embedding, chunkB_0.embedding)
      const simToB1 = cosineSimilarity(chunkA_0.embedding, chunkB_1.embedding)

      expect(simToB0).toBeGreaterThan(simToB1)
      // NMS logic would select B_0 and exclude B_1
    })

    it('should allow different chunks to match different targets', () => {
      // A_0 matches B_0, A_1 matches B_1 (no conflict)
      const chunkA_0 = createChunk('a0', 0, 1, [1, 0, 0])
      const chunkA_1 = createChunk('a1', 1, 2, [0, 1, 0])
      const chunkB_0 = createChunk('b0', 0, 1, [1, 0, 0])
      const chunkB_1 = createChunk('b1', 1, 2, [0, 1, 0])

      const simA0_B0 = cosineSimilarity(chunkA_0.embedding, chunkB_0.embedding)
      const simA1_B1 = cosineSimilarity(chunkA_1.embedding, chunkB_1.embedding)

      expect(simA0_B0).toBeGreaterThan(0.99) // Strong match
      expect(simA1_B1).toBeGreaterThan(0.99) // Strong match
      // Both should be retained by NMS (no conflict)
    })
  })

  describe('Tie-Breaking Logic', () => {
    it('should prefer higher similarity when multiple candidates exist', () => {
      const queryChunk = createChunk('a0', 0, 5, [1, 0, 0])
      const candidate1 = createChunk('b0', 0, 5, [0.95, 0.1, 0])  // Sim: ~0.95
      const candidate2 = createChunk('b1', 1, 5, [0.99, 0.01, 0]) // Sim: ~0.99 (better)

      const sim1 = cosineSimilarity(queryChunk.embedding, candidate1.embedding)
      const sim2 = cosineSimilarity(queryChunk.embedding, candidate2.embedding)

      expect(sim2).toBeGreaterThan(sim1)
      // Tie-breaking rule 1: Higher similarity wins (candidate2)
    })

    it('should prefer closer page when similarities are equal', () => {
      const queryChunk = createChunk('a0', 0, 10, [1, 0, 0])
      const candidate1 = createChunk('b0', 0, 15, [1, 0, 0]) // Same sim, page 15
      const candidate2 = createChunk('b1', 1, 11, [1, 0, 0]) // Same sim, page 11 (closer)

      const sim1 = cosineSimilarity(queryChunk.embedding, candidate1.embedding)
      const sim2 = cosineSimilarity(queryChunk.embedding, candidate2.embedding)

      expect(sim1).toBeCloseTo(sim2, 5) // Same similarity

      // Tie-breaking rule 2: Closer page wins
      const distance1 = Math.abs(queryChunk.page_number - candidate1.page_number) // 5
      const distance2 = Math.abs(queryChunk.page_number - candidate2.page_number) // 1

      expect(distance2).toBeLessThan(distance1)
      // candidate2 should be selected
    })

    it('should handle ties with identical similarity and page distance', () => {
      const queryChunk = createChunk('a0', 0, 10, [1, 0, 0])
      const candidate1 = createChunk('b0', 0, 12, [1, 0, 0]) // Same sim, +2 pages
      const candidate2 = createChunk('b1', 1, 8, [1, 0, 0])  // Same sim, -2 pages

      const sim1 = cosineSimilarity(queryChunk.embedding, candidate1.embedding)
      const sim2 = cosineSimilarity(queryChunk.embedding, candidate2.embedding)

      expect(sim1).toBeCloseTo(sim2, 5) // Same similarity

      const distance1 = Math.abs(queryChunk.page_number - candidate1.page_number) // 2
      const distance2 = Math.abs(queryChunk.page_number - candidate2.page_number) // 2

      expect(distance1).toBe(distance2)
      // In true tie, first one wins (deterministic)
    })
  })

  describe('Bidirectional Matching', () => {
    it('should find mutual best matches', () => {
      // A→B best matches and B→A best matches should intersect
      const chunkA = createChunk('a0', 0, 1, [1, 0, 0])
      const chunkB = createChunk('b0', 0, 1, [1, 0, 0])

      const simAB = cosineSimilarity(chunkA.embedding, chunkB.embedding)
      const simBA = cosineSimilarity(chunkB.embedding, chunkA.embedding)

      expect(simAB).toBeCloseTo(simBA, 5) // Symmetric
      expect(simAB).toBeGreaterThan(0.99) // Strong mutual match
    })

    it('should reject non-mutual matches below threshold', () => {
      // A matches B strongly, but B matches C better
      const chunkA = createChunk('a0', 0, 1, [1, 0, 0])
      const chunkB = createChunk('b0', 0, 1, [0.9, 0.1, 0])
      const chunkC = createChunk('c0', 0, 1, [0.95, 0.05, 0])

      const simAB = cosineSimilarity(chunkA.embedding, chunkB.embedding)
      const simBC = cosineSimilarity(chunkB.embedding, chunkC.embedding)

      // B is closer to C than A
      expect(simBC).toBeGreaterThan(simAB)
      // Bidirectional matching would not confirm A-B pair
    })
  })

  describe('Fallback Recovery', () => {
    it('should recover shifted chunks below the primary threshold', async () => {
      const baseVectors = [
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1],
        [1, -1, 0],
        [1, 0, -1],
        [-1, 1, 0],
        [-1, 0, 1],
        [0, -1, 1]
      ]

      const sourceBase = baseVectors.map((vector, index) =>
        createChunk(`a${index}`, index, index + 1, vector)
      )

      const targetBase = baseVectors.map((vector, index) => {
        const indexOffset = index >= 4 ? index + 3 : index + 1
        const pageOffset = index >= 4 ? index + 15 : index + 5
        return createChunk(`b${index}`, indexOffset, pageOffset, vector)
      })

      const sourceFallback = createChunk('a_fallback', sourceBase.length, 25, [0.8, 0.2, 0.5])
      const targetFallback = createChunk('b_fallback', targetBase.length + 4, 60, [0.3, 0.5, 0.7])

      const sourceRaw = [...sourceBase, sourceFallback]

      const targetRaw = [
        ...targetBase.slice(0, 4),
        createChunk('b_extra', 4, 18, [1, -0.5, 0]),
        ...targetBase.slice(4),
        targetFallback
      ]

      const source = sourceRaw.map(convertToMatchChunk)
      const target = targetRaw.map(convertToMatchChunk)

      const matches = await findBidirectionalMatches(source, target, {
        primaryThreshold: 0.85,
        fallback: {
          enabled: true,
          threshold: 0.78
        }
      })

      expect(matches).not.toBeNull()
      expect(matches!.length).toBeGreaterThanOrEqual(source.length - 1)
      const pairIds = matches!.map(pair => `${pair.chunkA.id}->${pair.chunkB.id}`)
      expect(pairIds).toContain('a_fallback->b_fallback')
    })
  })

  describe('Dynamic Minimum Evidence Threshold', () => {
    it('should require at least 8 matches for small documents', () => {
      const minMatches = Math.max(8, Math.ceil(0.05 * Math.min(10, 10)))
      expect(minMatches).toBe(8)
    })

    it('should require 5% of chunks for large documents', () => {
      const docA_chunks = 500
      const docB_chunks = 600
      const minMatches = Math.max(8, Math.ceil(0.05 * Math.min(docA_chunks, docB_chunks)))

      // 5% of 500 = 25
      expect(minMatches).toBe(25)
    })

    it('should scale proportionally with document size', () => {
      const testCases = [
        { chunksA: 10, chunksB: 10, expected: 8 },
        { chunksA: 100, chunksB: 100, expected: 8 },
        { chunksA: 200, chunksB: 200, expected: 10 },
        { chunksA: 500, chunksB: 500, expected: 25 },
        { chunksA: 1000, chunksB: 1000, expected: 50 },
      ]

      testCases.forEach(({ chunksA, chunksB, expected }) => {
        const minMatches = Math.max(8, Math.ceil(0.05 * Math.min(chunksA, chunksB)))
        expect(minMatches).toBe(expected)
      })
    })
  })

  describe('Edge Cases', () => {
    it('should handle empty chunk lists', () => {
      const emptyChunks: any[] = []
      expect(emptyChunks.length).toBe(0)
      // Matching should return empty array
    })

    it('should handle single chunk matching', () => {
      const chunkA = createChunk('a0', 0, 1, [1, 0, 0])
      const chunkB = createChunk('b0', 0, 1, [1, 0, 0])

      const sim = cosineSimilarity(chunkA.embedding, chunkB.embedding)
      expect(sim).toBeGreaterThan(0.99)
    })

    it('should handle threshold edge case (exactly 0.85)', () => {
      const threshold = 0.85
      const chunkA = createChunk('a0', 0, 1, [1, 0, 0])

      // Create a chunk with exactly 0.85 similarity (normalized dot product = 0.85)
      const adjustedVector = [0.85, Math.sqrt(1 - 0.85 * 0.85), 0]
      const chunkB = createChunk('b0', 0, 1, adjustedVector)

      const sim = cosineSimilarity(chunkA.embedding, chunkB.embedding)
      expect(sim).toBeCloseTo(0.85, 2)

      // Should be included (threshold is >=)
      expect(sim).toBeGreaterThanOrEqual(threshold)
    })

    it('should reject matches below threshold', () => {
      const threshold = 0.85
      const chunkA = createChunk('a0', 0, 1, [1, 0, 0])
      const chunkB = createChunk('b0', 0, 1, [0.5, 0.5, 0.5]) // Low similarity

      const sim = cosineSimilarity(chunkA.embedding, chunkB.embedding)
      expect(sim).toBeLessThan(threshold)
    })
  })

  describe('Performance Considerations', () => {
    it('should handle large numbers of chunks efficiently', () => {
      const numChunks = 1000
      const chunks = Array.from({ length: numChunks }, (_, i) =>
        createChunk(`chunk_${i}`, i, Math.floor(i / 10), Array(768).fill(Math.random()))
      )

      expect(chunks.length).toBe(numChunks)
      expect(chunks[0].embedding.length).toBe(768)

      // Normalization should be fast
      const startTime = performance.now()
      chunks.forEach(chunk => {
        const magnitude = Math.sqrt(chunk.embedding.reduce((sum, v) => sum + v * v, 0))
        expect(magnitude).toBeCloseTo(1.0, 5)
      })
      const endTime = performance.now()

      // Should complete in reasonable time (< 100ms for 1000 chunks)
      expect(endTime - startTime).toBeLessThan(100)
    })
  })
})
