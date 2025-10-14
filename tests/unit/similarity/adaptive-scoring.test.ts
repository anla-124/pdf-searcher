/**
 * Unit Tests for Adaptive Scoring Formula
 * Tests the adaptive scoring formula with all 4 user scenarios
 */

import { describe, it, expect } from 'vitest'
import { computeAdaptiveScore } from '@/lib/similarity/core/adaptive-scoring'
import { ChunkMatch } from '@/lib/similarity/types'

describe('Adaptive Scoring Formula', () => {
  /**
   * Helper: Create dummy chunk matches
   */
  const createDummyMatches = (count: number): ChunkMatch[] => {
    return Array.from({ length: count }, (_, i) => ({
      chunkA_id: `a_${i}`,
      chunkB_id: `b_${i}`,
      chunkA_index: i,
      chunkB_index: i,
      score: 0.95,
      pageA: i + 1,
      pageB: i + 1
    }))
  }

  describe('Scenario 1: Non-overlapping documents', () => {
    it('should return ~0% for completely non-overlapping documents', () => {
      // A = 45 pages (0 matches), B = 45 pages (0 matches)
      const docA_effectiveChunks = 45
      const docB_effectiveChunks = 45
      const matches = createDummyMatches(0) // No matches

      const result = computeAdaptiveScore(matches, docA_effectiveChunks, docB_effectiveChunks)

      expect(result.jaccard).toBe(0)
      expect(result.weightedBidir).toBe(0)
      expect(result.final).toBe(0)
      expect(result.sizeRatio).toBe(1.0) // Same size
      expect(result.alpha).toBeCloseTo(0.95, 2) // s^2 = 1.0^2 = 1.0, clamped to 0.95
    })
  })

  describe('Scenario 2: Half subset (A ⊂ Z, A is half of Z)', () => {
    it('should return ~50% for half-subset documents', () => {
      // A = 45 pages (all matched), Z = 90 pages (45 matched)
      const docA_effectiveChunks = 45
      const docZ_effectiveChunks = 90
      const matches = createDummyMatches(45) // All of A matches

      const result = computeAdaptiveScore(matches, docA_effectiveChunks, docZ_effectiveChunks)

      // Jaccard: 45 / (45 + 90 - 45) = 45 / 90 = 0.5
      expect(result.jaccard).toBeCloseTo(0.5, 2)

      // Weighted Bidirectional:
      // A→Z: 45/45 = 1.0
      // Z→A: 45/90 = 0.5
      // W = (1.0 * 45 + 0.5 * 90) / (45 + 90) = (45 + 45) / 135 = 90/135 = 0.667
      expect(result.weightedBidir).toBeCloseTo(0.667, 2)

      // Size ratio: 45/90 = 0.5
      expect(result.sizeRatio).toBeCloseTo(0.5, 2)

      // Alpha: clip(0.5^2, 0.15, 0.95) = clip(0.25, 0.15, 0.95) = 0.25
      expect(result.alpha).toBeCloseTo(0.25, 2)

      // Final score equals coverage of the larger document: 30 / 60 = 0.5
      expect(result.final).toBeCloseTo(0.5, 5)

      // Exact half overlap
      expect(result.final).toBeGreaterThanOrEqual(0.5)
      expect(result.final).toBeLessThanOrEqual(0.5)
    })
  })

  describe('Scenario 3: Near-duplicate (Y = X + 2 extra pages)', () => {
    it('should return ~83% for near-duplicate documents', () => {
      // X = 30 chunks, Y = 32 chunks (30 matched, 2 extra)
      const docX_effectiveChunks = 30
      const docY_effectiveChunks = 32
      const matches = createDummyMatches(docX_effectiveChunks) // All of X matches

      const result = computeAdaptiveScore(matches, docX_effectiveChunks, docY_effectiveChunks)

      // Jaccard: 30 / (30 + 32 - 30) = 30 / 32 = 0.9375
      expect(result.jaccard).toBeCloseTo(0.9375, 5)

      // Weighted Bidirectional:
      // X→Y: 30/30 = 1.0
      // Y→X: 30/32 = 0.9375
      // W = (1.0 * 30 + 0.9375 * 32) / (30 + 32) = 60 / 62 ≈ 0.9677
      expect(result.weightedBidir).toBeCloseTo(0.9677, 3)

      // Size ratio: 30/32 = 0.9375
      expect(result.sizeRatio).toBeCloseTo(0.9375, 5)

      // Alpha: clip(0.9375^2, 0.15, 0.95) ≈ 0.8789
      expect(result.alpha).toBeCloseTo(0.8789, 3)

      // Final score equals coverage of the larger document: 30 / 32 = 0.9375
      expect(result.final).toBeCloseTo(0.9375, 5)

      // Exact 93.75% overlap
      expect(result.final).toBeGreaterThanOrEqual(0.9375)
      expect(result.final).toBeLessThanOrEqual(0.9375)
    })
  })

  describe('Scenario 4: Partial section overlap (2 of 4 sections match)', () => {
    it('should return ~50% for partial section overlap with equal sizes', () => {
      // D1 = 4 sections (40 chunks), D2 = 4 sections (40 chunks), 2 sections match (20 chunks)
      const docD1_effectiveChunks = 40
      const docD2_effectiveChunks = 40
      const matches = createDummyMatches(20) // 2 sections matched

      const result = computeAdaptiveScore(matches, docD1_effectiveChunks, docD2_effectiveChunks)

      // Jaccard: 20 / (40 + 40 - 20) = 20 / 60 = 0.333
      expect(result.jaccard).toBeCloseTo(0.333, 2)

      // Weighted Bidirectional:
      // D1→D2: 20/40 = 0.5
      // D2→D1: 20/40 = 0.5
      // W = (0.5 * 40 + 0.5 * 40) / (40 + 40) = (20 + 20) / 80 = 40/80 = 0.5
      expect(result.weightedBidir).toBeCloseTo(0.5, 2)

      // Size ratio: 40/40 = 1.0
      expect(result.sizeRatio).toBe(1.0)

      // Alpha: clip(1.0^2, 0.15, 0.95) = clip(1.0, 0.15, 0.95) = 0.95
      expect(result.alpha).toBeCloseTo(0.95, 2)

      // Final score equals coverage of the larger document: 20 / 40 = 0.5
      expect(result.final).toBeCloseTo(0.5, 5)

      // Exact 50% overlap (two of four sections)
      expect(result.final).toBeGreaterThanOrEqual(0.5)
      expect(result.final).toBeLessThanOrEqual(0.5)
    })
  })

  describe('Alpha Clamping', () => {
    it('should clamp alpha to minimum 0.15 for very small size ratios', () => {
      // Extreme size mismatch: 1 chunk vs 100 chunks
      const matches = createDummyMatches(1)
      const result = computeAdaptiveScore(matches, 1, 100)

      // Size ratio: 1/100 = 0.01
      expect(result.sizeRatio).toBeCloseTo(0.01, 2)

      // Alpha: clip(0.01^2, 0.15, 0.95) = clip(0.0001, 0.15, 0.95) = 0.15 (clamped)
      expect(result.alpha).toBe(0.15)
    })

    it('should clamp alpha to maximum 0.95 for very similar sizes', () => {
      // Nearly identical sizes: 100 vs 101
      const matches = createDummyMatches(50)
      const result = computeAdaptiveScore(matches, 100, 101)

      // Size ratio: 100/101 = 0.99
      expect(result.sizeRatio).toBeCloseTo(0.99, 2)

      // Alpha: clip(0.99^2, 0.15, 0.95) = clip(0.98, 0.15, 0.95) = 0.95 (clamped)
      expect(result.alpha).toBe(0.95)
    })

    it('should not clamp alpha for mid-range size ratios', () => {
      // Mid-range: 50 vs 70
      const matches = createDummyMatches(30)
      const result = computeAdaptiveScore(matches, 50, 70)

      // Size ratio: 50/70 = 0.714
      expect(result.sizeRatio).toBeCloseTo(0.714, 2)

      // Alpha: clip(0.714^2, 0.15, 0.95) = clip(0.51, 0.15, 0.95) = 0.51 (no clamping)
      expect(result.alpha).toBeCloseTo(0.51, 2)
      expect(result.alpha).toBeGreaterThan(0.15)
      expect(result.alpha).toBeLessThan(0.95)
    })
  })

  describe('Edge Cases', () => {
    it('should handle zero matches gracefully', () => {
      const matches = createDummyMatches(0)
      const result = computeAdaptiveScore(matches, 50, 50)

      expect(result.jaccard).toBe(0)
      expect(result.weightedBidir).toBe(0)
      expect(result.final).toBe(0)
    })

    it('should handle perfect match (100% overlap)', () => {
      const matches = createDummyMatches(50)
      const result = computeAdaptiveScore(matches, 50, 50)

      // Jaccard: 50 / (50 + 50 - 50) = 50 / 50 = 1.0
      expect(result.jaccard).toBe(1.0)

      // Weighted Bidirectional: (1.0 * 50 + 1.0 * 50) / 100 = 1.0
      expect(result.weightedBidir).toBe(1.0)

      // Final should be 1.0 regardless of alpha
      expect(result.final).toBe(1.0)
    })

    it('should handle single chunk documents', () => {
      const matches = createDummyMatches(1)
      const result = computeAdaptiveScore(matches, 1, 1)

      expect(result.jaccard).toBe(1.0)
      expect(result.weightedBidir).toBe(1.0)
      expect(result.final).toBe(1.0)
    })

    it('should provide meaningful explanation', () => {
      const matches = createDummyMatches(20)
      const result = computeAdaptiveScore(matches, 40, 60)

      expect(result.explanation).toBeDefined()
      expect(result.explanation.length).toBeGreaterThan(0)
      expect(result.explanation).toContain('Matched')
    })
  })

  describe('Bidirectional Symmetry', () => {
    it('should be symmetric (Score(A,B) === Score(B,A))', () => {
      const matches = createDummyMatches(30)

      const scoreAB = computeAdaptiveScore(matches, 40, 60)
      const scoreBA = computeAdaptiveScore(matches, 60, 40)

      // All scores should be identical
      expect(scoreAB.jaccard).toBeCloseTo(scoreBA.jaccard, 5)
      expect(scoreAB.weightedBidir).toBeCloseTo(scoreBA.weightedBidir, 5)
      expect(scoreAB.sizeRatio).toBeCloseTo(scoreBA.sizeRatio, 5)
      expect(scoreAB.alpha).toBeCloseTo(scoreBA.alpha, 5)
      expect(scoreAB.final).toBeCloseTo(scoreBA.final, 5)
    })

    it('should be symmetric even for extreme size differences', () => {
      const matches = createDummyMatches(10)

      const scoreAB = computeAdaptiveScore(matches, 10, 100)
      const scoreBA = computeAdaptiveScore(matches, 100, 10)

      expect(scoreAB.final).toBeCloseTo(scoreBA.final, 5)
    })
  })
})
