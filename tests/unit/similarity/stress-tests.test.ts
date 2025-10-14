/**
 * Stress Tests for Similarity Search System
 *
 * Tests the adaptive scoring formula and chunk matching under challenging conditions:
 * - Documents with varying stride overlap (25-33%)
 * - Documents with OCR noise (5-10% imperfect matches)
 * - Extreme size ratios (s ≈ 0.2 and s ≈ 0.9)
 * - Edge cases (zero chunks, single chunk, very large documents)
 * - Degeneracy tests (invalid inputs, boundary conditions)
 */

import { describe, it, expect } from 'vitest'
import { computeAdaptiveScore } from '@/lib/similarity/core/adaptive-scoring'
import { computeEffectiveChunkCount } from '@/lib/similarity/utils/effective-length'
import { ChunkMatch } from '@/lib/similarity/types'

describe('Stress Tests: Similarity Search System', () => {
  /**
   * Helper: Create chunk matches with configurable scores
   */
  const createMatches = (count: number, avgScore: number = 0.95): ChunkMatch[] => {
    return Array.from({ length: count }, (_, i) => ({
      chunkA_id: `a_${i}`,
      chunkB_id: `b_${i}`,
      chunkA_index: i,
      chunkB_index: i,
      score: avgScore,
      pageA: i + 1,
      pageB: i + 1
    }))
  }

  /**
   * Helper: Create matches with noise (varying scores)
   */
  const createNoisyMatches = (
    count: number,
    perfectRatio: number = 0.9
  ): ChunkMatch[] => {
    const perfectCount = Math.floor(count * perfectRatio)
    const noisyCount = count - perfectCount

    const perfect = createMatches(perfectCount, 0.98)
    const noisy = createMatches(noisyCount, 0.85)

    // Interleave to simulate realistic noise distribution
    const matches: ChunkMatch[] = []
    for (let i = 0; i < count; i++) {
      if (i < perfectCount) {
        matches.push(perfect[i])
      } else {
        matches.push({
          ...noisy[i - perfectCount],
          chunkA_id: `a_${i}`,
          chunkB_id: `b_${i}`,
          chunkA_index: i,
          chunkB_index: i,
          pageA: i + 1,
          pageB: i + 1
        })
      }
    }

    return matches
  }

  /**
   * STRESS TEST 1: Varying Stride Overlap (25-33%)
   *
   * Test how the system handles different stride overlap ratios
   * Standard is 20% (200/1000), but test up to 33% (333/1000)
   */
  describe('Stress Test 1: Varying Stride Overlap', () => {
    it('should handle 25% stride overlap (250 char overlap in 1000 char chunks)', () => {
      const docA_tokens = 30000
      const docB_tokens = 30000

      // 25% overlap: effectiveChunkSize = 1000 - 250 = 750
      const docA_chunks = computeEffectiveChunkCount(docA_tokens, 1000, 250)
      const docB_chunks = computeEffectiveChunkCount(docB_tokens, 1000, 250)

      // 50% of chunks match
      const matchCount = Math.floor(docA_chunks / 2)
      const matches = createMatches(matchCount)

      const result = computeAdaptiveScore(matches, docA_chunks, docB_chunks)

      // Should still produce reasonable scores
      expect(result.jaccard).toBeGreaterThan(0.3)
      expect(result.jaccard).toBeLessThan(0.4)
      expect(result.final).toBeGreaterThan(0.45)
      expect(result.final).toBeLessThan(0.55)
    })

    it('should handle 33% stride overlap (333 char overlap in 1000 char chunks)', () => {
      const docA_tokens = 30000
      const docB_tokens = 30000

      // 33% overlap: effectiveChunkSize = 1000 - 333 = 667
      const docA_chunks = computeEffectiveChunkCount(docA_tokens, 1000, 333)
      const docB_chunks = computeEffectiveChunkCount(docB_tokens, 1000, 333)

      // 50% of chunks match
      const matchCount = Math.floor(docA_chunks / 2)
      const matches = createMatches(matchCount)

      const result = computeAdaptiveScore(matches, docA_chunks, docB_chunks)

      // Should still produce reasonable scores
      expect(result.jaccard).toBeGreaterThan(0.3)
      expect(result.jaccard).toBeLessThan(0.4)
      expect(result.final).toBeGreaterThan(0.45)
      expect(result.final).toBeLessThan(0.55)
    })

    it('should handle no overlap (0% stride overlap)', () => {
      const docA_tokens = 30000
      const docB_tokens = 30000

      // 0% overlap: effectiveChunkSize = 1000 - 0 = 1000
      const docA_chunks = computeEffectiveChunkCount(docA_tokens, 1000, 0)
      const docB_chunks = computeEffectiveChunkCount(docB_tokens, 1000, 0)

      // 50% of chunks match
      const matchCount = Math.floor(docA_chunks / 2)
      const matches = createMatches(matchCount)

      const result = computeAdaptiveScore(matches, docA_chunks, docB_chunks)

      // Should still produce reasonable scores
      expect(result.jaccard).toBeGreaterThan(0.3)
      expect(result.jaccard).toBeLessThan(0.4)
      expect(result.final).toBeGreaterThan(0.45)
      expect(result.final).toBeLessThan(0.55)
    })
  })

  /**
   * STRESS TEST 2: OCR Noise (5-10% imperfect matches)
   *
   * Test system behavior when some matches have lower similarity scores
   * (simulating OCR errors, formatting differences, etc.)
   */
  describe('Stress Test 2: OCR Noise', () => {
    it('should handle 5% noisy matches (95% perfect, 5% degraded)', () => {
      const docA_tokens = 30000
      const docB_tokens = 30000

      const docA_chunks = computeEffectiveChunkCount(docA_tokens, 1000, 200)
      const docB_chunks = computeEffectiveChunkCount(docB_tokens, 1000, 200)

      // All chunks match, but 5% have lower scores
      const matches = createNoisyMatches(docA_chunks, 0.95)

      const result = computeAdaptiveScore(matches, docA_chunks, docB_chunks)

      // Should still recognize as near-duplicate (>95% similarity)
      expect(result.jaccard).toBeGreaterThan(0.95)
      expect(result.weightedBidir).toBeGreaterThan(0.95)
      expect(result.final).toBeGreaterThan(0.95)
    })

    it('should handle 10% noisy matches (90% perfect, 10% degraded)', () => {
      const docA_tokens = 30000
      const docB_tokens = 30000

      const docA_chunks = computeEffectiveChunkCount(docA_tokens, 1000, 200)
      const docB_chunks = computeEffectiveChunkCount(docB_tokens, 1000, 200)

      // All chunks match, but 10% have lower scores
      const matches = createNoisyMatches(docA_chunks, 0.90)

      const result = computeAdaptiveScore(matches, docA_chunks, docB_chunks)

      // Should still recognize as near-duplicate (>90% similarity)
      expect(result.jaccard).toBeGreaterThan(0.9)
      expect(result.weightedBidir).toBeGreaterThan(0.9)
      expect(result.final).toBeGreaterThan(0.9)
    })

    it('should degrade gracefully with 20% noisy matches', () => {
      const docA_tokens = 30000
      const docB_tokens = 30000

      const docA_chunks = computeEffectiveChunkCount(docA_tokens, 1000, 200)
      const docB_chunks = computeEffectiveChunkCount(docB_tokens, 1000, 200)

      // All chunks match, but 20% have lower scores
      const matches = createNoisyMatches(docA_chunks, 0.80)

      const result = computeAdaptiveScore(matches, docA_chunks, docB_chunks)

      // Should still recognize as highly similar (>85% similarity)
      expect(result.jaccard).toBeGreaterThan(0.85)
      expect(result.weightedBidir).toBeGreaterThan(0.85)
      expect(result.final).toBeGreaterThan(0.85)
    })
  })

  /**
   * STRESS TEST 3: Extreme Size Ratios
   *
   * Test alpha behavior at extreme size ratios:
   * - s ≈ 0.2 (very different sizes, alpha → 0.15)
   * - s ≈ 0.9 (very similar sizes, alpha → 0.81)
   */
  describe('Stress Test 3: Extreme Size Ratios', () => {
    it('should handle extreme size ratio s ≈ 0.2 (small subset of large doc)', () => {
      // Document A: 10 chunks (small)
      // Document B: 50 chunks (large)
      // Size ratio: 10/50 = 0.2
      const docA_chunks = 10
      const docB_chunks = 50

      // All of A matches (A is subset of B)
      const matches = createMatches(docA_chunks)

      const result = computeAdaptiveScore(matches, docA_chunks, docB_chunks)

      // Size ratio: 0.2
      expect(result.sizeRatio).toBeCloseTo(0.2, 2)

      // Alpha: clip(0.2^2, 0.15, 0.95) = clip(0.04, 0.15, 0.95) = 0.15 (minimum)
      expect(result.alpha).toBeCloseTo(0.15, 2)

      // Jaccard: 10 / (10 + 50 - 10) = 10/50 = 0.2
      expect(result.jaccard).toBeCloseTo(0.2, 2)

      // Weighted Bidir: (1.0 * 10 + 0.2 * 50) / 60 = 20/60 ≈ 0.333
      expect(result.weightedBidir).toBeCloseTo(0.333, 2)

      // Final equals coverage of larger document: 10 / 50 = 0.2
      expect(result.final).toBeCloseTo(0.2, 5)
    })

    it('should handle extreme size ratio s ≈ 0.1 (tiny subset of huge doc)', () => {
      // Document A: 10 chunks (tiny)
      // Document B: 100 chunks (huge)
      // Size ratio: 10/100 = 0.1
      const docA_chunks = 10
      const docB_chunks = 100

      // All of A matches (A is subset of B)
      const matches = createMatches(docA_chunks)

      const result = computeAdaptiveScore(matches, docA_chunks, docB_chunks)

      // Size ratio: 0.1
      expect(result.sizeRatio).toBeCloseTo(0.1, 2)

      // Alpha: clip(0.1^2, 0.15, 0.95) = clip(0.01, 0.15, 0.95) = 0.15 (minimum)
      expect(result.alpha).toBeCloseTo(0.15, 2)

      // Jaccard: 10 / (10 + 100 - 10) = 10/100 = 0.1
      expect(result.jaccard).toBeCloseTo(0.1, 2)

      // Final equals coverage: 10 / 100 = 0.1
      expect(result.final).toBeCloseTo(0.1, 5)
    })

    it('should handle extreme size ratio s ≈ 0.95 (nearly identical sizes)', () => {
      // Document A: 95 chunks
      // Document B: 100 chunks
      // Size ratio: 95/100 = 0.95
      const docA_chunks = 95
      const docB_chunks = 100

      // All of A matches (A is subset of B)
      const matches = createMatches(docA_chunks)

      const result = computeAdaptiveScore(matches, docA_chunks, docB_chunks)

      // Size ratio: 0.95
      expect(result.sizeRatio).toBeCloseTo(0.95, 2)

      // Alpha: clip(0.95^2, 0.15, 0.95) = clip(0.9025, 0.15, 0.95) = 0.9025
      expect(result.alpha).toBeCloseTo(0.9025, 2)

      // Jaccard: 95 / (95 + 100 - 95) = 95/100 = 0.95
      expect(result.jaccard).toBeCloseTo(0.95, 2)

      // Weighted Bidir: (1.0 * 95 + 0.95 * 100) / 195 ≈ 0.974
      expect(result.weightedBidir).toBeGreaterThan(0.97)

      // Final equals coverage: 95 / 100 = 0.95
      expect(result.final).toBeCloseTo(0.95, 5)
    })

    it('should handle extreme size ratio s = 1.0 (perfectly equal sizes)', () => {
      // Document A: 100 chunks
      // Document B: 100 chunks
      // Size ratio: 1.0
      const docA_chunks = 100
      const docB_chunks = 100

      // 50% of chunks match
      const matchCount = 50
      const matches = createMatches(matchCount)

      const result = computeAdaptiveScore(matches, docA_chunks, docB_chunks)

      // Size ratio: 1.0
      expect(result.sizeRatio).toBe(1.0)

      // Alpha: clip(1.0^2, 0.15, 0.95) = 0.95 (maximum)
      expect(result.alpha).toBeCloseTo(0.95, 2)

      // Jaccard: 50 / (100 + 100 - 50) = 50/150 = 0.333
      expect(result.jaccard).toBeCloseTo(0.333, 2)

      // Weighted Bidir: (0.5 * 100 + 0.5 * 100) / 200 = 0.5
      expect(result.weightedBidir).toBeCloseTo(0.5, 2)

      // Final equals coverage: 50 / 100 = 0.5
      expect(result.final).toBeCloseTo(0.5, 5)
    })
  })

  /**
   * STRESS TEST 4: Edge Cases (Zero Chunks, Single Chunk, Very Large)
   */
  describe('Stress Test 4: Edge Cases', () => {
    it('should reject zero chunks in both documents', () => {
      // Invalid input - should throw error
      expect(() => computeAdaptiveScore([], 0, 0)).toThrow('Invalid effective chunk counts')
    })

    it('should reject zero chunks in one document', () => {
      // Invalid input - should throw error
      expect(() => computeAdaptiveScore([], 10, 0)).toThrow('Invalid effective chunk counts')
    })

    it('should handle single chunk in both documents (perfect match)', () => {
      const matches = createMatches(1)

      const result = computeAdaptiveScore(matches, 1, 1)

      // Should be perfect match
      expect(result.jaccard).toBe(1.0)
      expect(result.weightedBidir).toBe(1.0)
      expect(result.final).toBe(1.0)
      expect(result.sizeRatio).toBe(1.0)
    })

    it('should handle single chunk in both documents (no match)', () => {
      const result = computeAdaptiveScore([], 1, 1)

      // Should be zero similarity
      expect(result.jaccard).toBe(0)
      expect(result.weightedBidir).toBe(0)
      expect(result.final).toBe(0)
      expect(result.sizeRatio).toBe(1.0)
    })

    it('should handle very large documents (1000+ chunks each)', () => {
      const docA_chunks = 1250 // ~1M tokens
      const docB_chunks = 1250

      // 50% of chunks match
      const matchCount = 625
      const matches = createMatches(matchCount)

      const result = computeAdaptiveScore(matches, docA_chunks, docB_chunks)

      // Should handle large numbers without overflow
      expect(result.jaccard).toBeCloseTo(0.333, 2)
      expect(result.weightedBidir).toBeCloseTo(0.5, 2)
      expect(result.final).toBeGreaterThan(0.45)
      expect(result.final).toBeLessThan(0.55)
    })

    it('should handle very large documents with extreme size ratio', () => {
      const docA_chunks = 100   // Small
      const docB_chunks = 10000 // Very large (100x bigger)

      // All of A matches
      const matches = createMatches(docA_chunks)

      const result = computeAdaptiveScore(matches, docA_chunks, docB_chunks)

      // Size ratio: 0.01 (extremely small)
      expect(result.sizeRatio).toBeCloseTo(0.01, 2)

      // Alpha should be minimum (0.15)
      expect(result.alpha).toBeCloseTo(0.15, 2)

      // Jaccard should be very small (100/10000 = 0.01)
      expect(result.jaccard).toBeCloseTo(0.01, 2)

      // Final equals coverage: 100 / 10000 = 0.01
      expect(result.final).toBeCloseTo(0.01, 5)
    })
  })

  /**
   * STRESS TEST 5: Degeneracy Tests (Invalid Inputs)
   */
  describe('Stress Test 5: Degeneracy Tests', () => {
    it('should reject negative chunk counts', () => {
      // Invalid input - should throw error
      expect(() => computeAdaptiveScore([], -10, 10)).toThrow('Invalid effective chunk counts')
    })

    it('should handle NaN chunk counts without crashing', () => {
      // In JavaScript, NaN <= 0 is false, so NaN passes validation
      // Math with NaN propagates to produce NaN results
      const result = computeAdaptiveScore([], NaN, 10)

      // Jaccard: uniqueChunks = NaN + 10 - 0 = NaN, NaN > 0 is false, so jaccard = 0
      expect(result.jaccard).toBe(0)

      // Weighted bidir: (0 * NaN + 0 * 10) / (NaN + 10) = NaN / NaN = NaN
      expect(result.weightedBidir).toBeNaN()

      // Size ratio: Math.min(NaN, 10) / Math.max(NaN, 10) = NaN / NaN = NaN
      expect(result.sizeRatio).toBeNaN()

      // Alpha: NaN^2 = NaN, Math.max(0.15, Math.min(0.95, NaN)) = NaN
      expect(result.alpha).toBeNaN()

      // Final falls back to 0 when largest document length is invalid
      expect(result.final).toBe(0)
    })

    it('should handle Infinity chunk counts and produce NaN results', () => {
      // Infinity is > 0, so it passes validation
      // But Infinity / Infinity produces NaN
      const matches = createMatches(10)
      const result = computeAdaptiveScore(matches, Infinity, 10)

      // Coverage against an infinite document is 0
      expect(result.final).toBe(0)
    })

    it('should handle very large match counts gracefully', () => {
      // Test with more matches than makes sense (but not impossible in buggy code)
      const docA_chunks = 10
      const docB_chunks = 10

      // 15 matches (more than either document has chunks individually)
      const matches = createMatches(15)

      const result = computeAdaptiveScore(matches, docA_chunks, docB_chunks)

      // Jaccard can go negative: 15 / (10 + 10 - 15) = 15/5 = 3.0
      // This reveals a potential edge case, but we'll test current behavior
      expect(result.jaccard).toBeGreaterThan(1.0) // Currently allows >1.0

      // WeightedBidir can also exceed 1.0
      expect(result.weightedBidir).toBeGreaterThan(1.0)

      // Final score will also exceed 1.0
      expect(result.final).toBeGreaterThan(1.0)
    })
  })

  /**
   * STRESS TEST 6: Boundary Conditions for Alpha
   */
  describe('Stress Test 6: Alpha Boundary Conditions', () => {
    it('should clamp alpha to minimum 0.15 when s < sqrt(0.15)', () => {
      // sqrt(0.15) ≈ 0.387
      // If s = 0.3, then s^2 = 0.09 < 0.15, so alpha = 0.15

      const docA_chunks = 30
      const docB_chunks = 100 // s = 0.3

      const matches = createMatches(docA_chunks)

      const result = computeAdaptiveScore(matches, docA_chunks, docB_chunks)

      expect(result.sizeRatio).toBeCloseTo(0.3, 2)
      expect(result.alpha).toBeCloseTo(0.15, 2) // Clamped to minimum
    })

    it('should clamp alpha to maximum 0.95 when s > sqrt(0.95)', () => {
      // sqrt(0.95) ≈ 0.975
      // If s = 0.99, then s^2 = 0.9801 > 0.95, so alpha = 0.95

      const docA_chunks = 99
      const docB_chunks = 100 // s = 0.99

      const matches = createMatches(docA_chunks)

      const result = computeAdaptiveScore(matches, docA_chunks, docB_chunks)

      expect(result.sizeRatio).toBeCloseTo(0.99, 2)
      expect(result.alpha).toBeCloseTo(0.95, 2) // Clamped to maximum
    })

    it('should use unclamped alpha when 0.387 < s < 0.975', () => {
      // For s = 0.7, s^2 = 0.49, which is in [0.15, 0.95]

      const docA_chunks = 70
      const docB_chunks = 100 // s = 0.7

      const matches = createMatches(docA_chunks)

      const result = computeAdaptiveScore(matches, docA_chunks, docB_chunks)

      expect(result.sizeRatio).toBeCloseTo(0.7, 2)
      expect(result.alpha).toBeCloseTo(0.49, 2) // Unclamped: 0.7^2 = 0.49
    })
  })

  /**
   * STRESS TEST 7: Consistency Tests
   */
  describe('Stress Test 7: Consistency Tests', () => {
    it('should maintain bidirectional symmetry under all conditions', () => {
      const testCases = [
        { chunksA: 10, chunksB: 50, matches: 10 },   // Extreme ratio
        { chunksA: 95, chunksB: 100, matches: 95 },  // Near-equal
        { chunksA: 1, chunksB: 1, matches: 1 },      // Single chunk
        { chunksA: 1000, chunksB: 1000, matches: 500 }, // Large docs
      ]

      testCases.forEach(({ chunksA, chunksB, matches: matchCount }) => {
        const matches = createMatches(matchCount)

        const resultAB = computeAdaptiveScore(matches, chunksA, chunksB)
        const resultBA = computeAdaptiveScore(matches, chunksB, chunksA)

        // Jaccard should be identical (symmetric)
        expect(resultAB.jaccard).toBeCloseTo(resultBA.jaccard, 10)

        // Final score should be identical (symmetric)
        expect(resultAB.final).toBeCloseTo(resultBA.final, 10)

        // Size ratio should be identical (symmetric)
        expect(resultAB.sizeRatio).toBeCloseTo(resultBA.sizeRatio, 10)

        // Alpha should be identical (symmetric)
        expect(resultAB.alpha).toBeCloseTo(resultBA.alpha, 10)
      })
    })

    it('should always satisfy: 0 ≤ final ≤ 1 (for valid inputs)', () => {
      const testCases = [
        // Skip zero chunks (invalid input)
        { chunksA: 1, chunksB: 1, matches: 0 },
        { chunksA: 1, chunksB: 1, matches: 1 },
        { chunksA: 10, chunksB: 100, matches: 10 },
        { chunksA: 100, chunksB: 100, matches: 50 },
        { chunksA: 1000, chunksB: 1000, matches: 1000 },
      ]

      testCases.forEach(({ chunksA, chunksB, matches: matchCount }) => {
        const matches = createMatches(matchCount)
        const result = computeAdaptiveScore(matches, chunksA, chunksB)

        expect(result.final).toBeGreaterThanOrEqual(0)
        expect(result.final).toBeLessThanOrEqual(1.0)
      })
    })

    it('should always satisfy: 0.15 ≤ alpha ≤ 0.95', () => {
      const testCases = [
        { chunksA: 1, chunksB: 100 },   // s = 0.01
        { chunksA: 10, chunksB: 100 },  // s = 0.1
        { chunksA: 50, chunksB: 100 },  // s = 0.5
        { chunksA: 90, chunksB: 100 },  // s = 0.9
        { chunksA: 99, chunksB: 100 },  // s = 0.99
        { chunksA: 100, chunksB: 100 }, // s = 1.0
      ]

      testCases.forEach(({ chunksA, chunksB }) => {
        const matches = createMatches(Math.min(chunksA, chunksB))
        const result = computeAdaptiveScore(matches, chunksA, chunksB)

        expect(result.alpha).toBeGreaterThanOrEqual(0.15)
        expect(result.alpha).toBeLessThanOrEqual(0.95)
      })
    })

    it('should always satisfy: min(J, W) ≤ final ≤ max(J, W)', () => {
      const testCases = [
        { chunksA: 10, chunksB: 50, matches: 10 },
        { chunksA: 50, chunksB: 100, matches: 50 },
        { chunksA: 100, chunksB: 100, matches: 50 },
        { chunksA: 100, chunksB: 100, matches: 100 },
      ]

      testCases.forEach(({ chunksA, chunksB, matches: matchCount }) => {
        const matches = createMatches(matchCount)
        const result = computeAdaptiveScore(matches, chunksA, chunksB)

        const minScore = Math.min(result.jaccard, result.weightedBidir)
        const maxScore = Math.max(result.jaccard, result.weightedBidir)

        // Final should be between Jaccard and Weighted Bidir
        expect(result.final).toBeGreaterThanOrEqual(minScore - 0.001) // Small tolerance for floating point
        expect(result.final).toBeLessThanOrEqual(maxScore + 0.001)
      })
    })
  })

  /**
   * STRESS TEST 8: Performance Under Load
   */
  describe('Stress Test 8: Performance Under Load', () => {
    it('should handle 10,000 matches in reasonable time', () => {
      const docA_chunks = 10000
      const docB_chunks = 10000
      const matches = createMatches(5000) // 50% match

      const startTime = performance.now()
      const result = computeAdaptiveScore(matches, docA_chunks, docB_chunks)
      const endTime = performance.now()

      const timeMs = endTime - startTime

      // Should complete in < 100ms
      expect(timeMs).toBeLessThan(100)

      // Should still produce correct results
      expect(result.final).toBeGreaterThan(0.45)
      expect(result.final).toBeLessThan(0.55)
    })

    it('should handle 100 computations in batch', () => {
      const startTime = performance.now()

      for (let i = 0; i < 100; i++) {
        const docA_chunks = Math.floor(Math.random() * 100) + 10
        const docB_chunks = Math.floor(Math.random() * 100) + 10
        const matchCount = Math.floor(Math.random() * Math.min(docA_chunks, docB_chunks))
        const matches = createMatches(matchCount)

        computeAdaptiveScore(matches, docA_chunks, docB_chunks)
      }

      const endTime = performance.now()
      const timeMs = endTime - startTime

      // 100 computations should complete in < 500ms
      expect(timeMs).toBeLessThan(500)
    })
  })
})
