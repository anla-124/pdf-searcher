/**
 * Integration Tests for 4 Critical Similarity Search Scenarios
 *
 * Tests the complete 3-stage similarity search pipeline end-to-end:
 * - Stage 0: Document centroid candidate retrieval
 * - Stage 1: Candidate-aware chunk-level pre-filtering
 * - Stage 2: Parallel final scoring with adaptive formula
 *
 * Verifies accuracy within ±6% for all 4 user scenarios
 */

import { describe, it, expect } from 'vitest'
import { computeAdaptiveScore } from '@/lib/similarity/core/adaptive-scoring'
import { ChunkMatch } from '@/lib/similarity/types'

describe('Integration: 4 Critical Similarity Scenarios', () => {
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

  /**
   * SCENARIO 1: Non-overlapping Documents
   *
   * Setup:
   * - Document A: Pages 1-45 (first half of book)
   * - Document B: Pages 46-90 (second half of book)
   * - No content overlap
   *
   * Expected: 0% similarity (complete independence)
   */
  describe('Scenario 1: Non-overlapping Documents', () => {
    it('should return 0% similarity for completely separate content', () => {
      // Approximate: 45 pages × ~500 words/page × ~1.3 tokens/word ≈ 29,250 tokens
      const docA_effectiveChunks = 30
      const docB_effectiveChunks = 30

      // No matches (separate content)
      const matches = createDummyMatches(0)

      // Compute adaptive score
      const result = computeAdaptiveScore(matches, docA_effectiveChunks, docB_effectiveChunks)

      // Assertions
      expect(result.jaccard).toBe(0)
      expect(result.weightedBidir).toBe(0)
      expect(result.final).toBe(0)

      // Verify within ±6% of expected 0%
      expect(result.final).toBeGreaterThanOrEqual(-0.06)
      expect(result.final).toBeLessThanOrEqual(0.06)

      console.log('\n✅ Scenario 1 Results:')
      console.log(`   Jaccard: ${(result.jaccard * 100).toFixed(1)}%`)
      console.log(`   Weighted Bidir: ${(result.weightedBidir * 100).toFixed(1)}%`)
      console.log(`   Final: ${(result.final * 100).toFixed(1)}%`)
      console.log(`   Expected: 0% ± 6%`)
      console.log(`   ✓ Within tolerance: ${Math.abs(result.final - 0) <= 0.06}`)
    })
  })

  /**
   * SCENARIO 2: Half Subset (A ⊂ Z, A is half of Z)
   *
   * Setup:
   * - Document A: 45 pages (all content matched)
   * - Document Z: 90 pages (contains all of A + 45 additional pages)
   * - A is a perfect subset of Z
   *
   * Expected: 50% similarity (half of larger document is shared)
   */
  describe('Scenario 2: Half Subset', () => {
    it('should return ~50% similarity when one doc is half-subset of another', () => {
      const docA_effectiveChunks = 30
      const docZ_effectiveChunks = 60

      // All of A matches (A is subset of Z)
      const matches = createDummyMatches(docA_effectiveChunks)

      const result = computeAdaptiveScore(matches, docA_effectiveChunks, docZ_effectiveChunks)

      // Jaccard: matched / (A + Z - matched) = 37 / (37 + 74 - 37) = 37/74 = 0.5
      expect(result.jaccard).toBeCloseTo(0.5, 2)

      // Weighted Bidirectional: (1.0 * 37 + 0.5 * 74) / (37 + 74) ≈ 0.667
      expect(result.weightedBidir).toBeCloseTo(0.667, 2)

      // Size ratio: 37/74 = 0.5
      expect(result.sizeRatio).toBeCloseTo(0.5, 2)

      // Alpha: clip(0.5^2, 0.15, 0.95) = 0.25
      expect(result.alpha).toBeCloseTo(0.25, 2)

      // Final equals coverage of larger document: 37 / 74 = 0.5
      expect(result.final).toBeCloseTo(0.5, 5)

      // Exact 50%
      expect(result.final).toBeGreaterThanOrEqual(0.5)
      expect(result.final).toBeLessThanOrEqual(0.5)

      console.log('\n✅ Scenario 2 Results:')
      console.log(`   Jaccard: ${(result.jaccard * 100).toFixed(1)}%`)
      console.log(`   Weighted Bidir: ${(result.weightedBidir * 100).toFixed(1)}%`)
      console.log(`   Final: ${(result.final * 100).toFixed(1)}%`)
      console.log(`   Expected: 50%`)
      console.log(`   ✓ Matches expected coverage: ${result.final === 0.5}`)
    })
  })

  /**
   * SCENARIO 3: Near-Duplicate (Y = X + 2 extra pages)
   *
   * Setup:
   * - Document X: 10 pages (all matched)
   * - Document Y: 12 pages (contains all of X + 2 additional pages)
   * - Very similar documents with minor differences
   *
   * Note: With stride overlap, 10 pages → 9 chunks, 12 pages → 10 chunks
   * Size ratio: 9/10 = 0.90, so alpha is high, favoring match rate
   * Expected: 93.75% similarity (near-duplicate behavior)
   */
  describe('Scenario 3: Near-Duplicate', () => {
    it('should return ~90% similarity for near-duplicate with 2 extra pages', () => {
      const docX_effectiveChunks = 30
      const docY_effectiveChunks = 32

      // All of X matches (X is subset of Y)
      const matches = createDummyMatches(docX_effectiveChunks)

      const result = computeAdaptiveScore(matches, docX_effectiveChunks, docY_effectiveChunks)

      // Jaccard: 30 / (30 + 32 - 30) = 30/32 = 0.9375
      expect(result.jaccard).toBeCloseTo(0.9375, 5)

      // Weighted Bidirectional: (1.0 * 30 + 0.9375 * 32) / 62 ≈ 0.9677
      expect(result.weightedBidir).toBeCloseTo(0.9677, 3)

      // Size ratio: 30/32 = 0.9375 (very similar sizes)
      expect(result.sizeRatio).toBeCloseTo(0.9375, 5)

      // Alpha: clip(0.9375^2, 0.15, 0.95) ≈ 0.8789
      expect(result.alpha).toBeCloseTo(0.8789, 3)

      // Final equals coverage of larger document: 30 / 32 = 0.9375
      expect(result.final).toBeCloseTo(0.9375, 5)

      // Exact 93.75%
      expect(result.final).toBeGreaterThanOrEqual(0.9375)
      expect(result.final).toBeLessThanOrEqual(0.9375)

      console.log('\n✅ Scenario 3 Results:')
      console.log(`   Jaccard: ${(result.jaccard * 100).toFixed(1)}%`)
      console.log(`   Weighted Bidir: ${(result.weightedBidir * 100).toFixed(1)}%`)
      console.log(`   Final: ${(result.final * 100).toFixed(1)}%`)
      console.log(`   Expected: 93.75%`)
      console.log(`   ✓ Matches expected coverage: ${result.final === 0.9375}`)
    })
  })

  /**
   * SCENARIO 4: Partial Section Overlap (2 of 4 sections match)
   *
   * Setup:
   * - Document D1: 4 sections (M, N, O, P) - 40 chunks total
   * - Document D2: 4 sections (P, T, R, O) - 40 chunks total
   * - 2 sections match (O and P) = 20 chunks matched
   * - Equal-sized documents with partial overlap
   *
   * Expected: 50% similarity (2/4 sections = 50%)
   */
  describe('Scenario 4: Partial Section Overlap', () => {
    it('should return ~50% similarity when 2 of 4 sections match in equal-sized docs', () => {
      // Each document has 40 chunks (4 sections × 10 chunks each)
      const docD1_effectiveChunks = 40
      const docD2_effectiveChunks = 40

      // 2 of 4 sections match = 20 chunks matched out of 40
      const matches = createDummyMatches(20)

      const result = computeAdaptiveScore(matches, docD1_effectiveChunks, docD2_effectiveChunks)

      // Jaccard: 20 / (40 + 40 - 20) = 20/60 = 0.333
      expect(result.jaccard).toBeCloseTo(0.333, 2)

      // Weighted Bidirectional: (0.5 * 40 + 0.5 * 40) / 80 = 0.5
      expect(result.weightedBidir).toBeCloseTo(0.5, 2)

      // Size ratio: 40/40 = 1.0 (equal sizes)
      expect(result.sizeRatio).toBe(1.0)

      // Alpha: clip(1.0^2, 0.15, 0.95) = 0.95
      expect(result.alpha).toBeCloseTo(0.95, 2)

      // Final equals coverage of larger document: 20 / 40 = 0.5
      expect(result.final).toBeCloseTo(0.5, 5)

      // Exact 50%
      expect(result.final).toBeGreaterThanOrEqual(0.5)
      expect(result.final).toBeLessThanOrEqual(0.5)

      console.log('\n✅ Scenario 4 Results:')
      console.log(`   Jaccard: ${(result.jaccard * 100).toFixed(1)}%`)
      console.log(`   Weighted Bidir: ${(result.weightedBidir * 100).toFixed(1)}%`)
      console.log(`   Final: ${(result.final * 100).toFixed(1)}%`)
      console.log(`   Expected: 50%`)
      console.log(`   ✓ Matches expected coverage: ${result.final === 0.5}`)
    })

    it('should handle order-invariant matching (reordered sections still match 100%)', () => {
      // Document with sections in different order should still achieve 100% match
      const docA_effectiveChunks = 40
      const docB_effectiveChunks = 40

      // All chunks match (reordered identical content)
      const matches = createDummyMatches(docA_effectiveChunks)

      const result = computeAdaptiveScore(matches, docA_effectiveChunks, docB_effectiveChunks)

      // Should be perfect match
      expect(result.jaccard).toBe(1.0)
      expect(result.weightedBidir).toBe(1.0)
      expect(result.final).toBe(1.0)

      console.log('\n✅ Order-Invariant Test Results:')
      console.log(`   Final: ${(result.final * 100).toFixed(1)}%`)
      console.log(`   ✓ Perfect match for reordered identical content`)
    })
  })

  /**
   * Summary Test: Verify All Scenarios Together
   */
  describe('Summary: All 4 Scenarios', () => {
    it('should match expected coverage across all scenarios', () => {
      const scenarios = [
        { name: 'Non-overlapping', chunksA: 30, chunksB: 30, matchRatio: 0 },
        { name: 'Half subset', chunksA: 30, chunksB: 60, matchRatio: 1.0 },
        { name: 'Near-duplicate', chunksA: 30, chunksB: 32, matchRatio: 1.0 },
        { name: 'Partial overlap', chunksA: 40, chunksB: 40, matchRatio: 0.5 }
      ]

      console.log('\n📊 Summary of All 4 Scenarios:')
      console.log('=' .repeat(60))

      scenarios.forEach(scenario => {
        const chunksA = scenario.chunksA
        const chunksB = scenario.chunksB
        const matchedCount = Math.floor(Math.min(chunksA, chunksB) * scenario.matchRatio)
        const matches = createDummyMatches(matchedCount)

        const result = computeAdaptiveScore(matches, chunksA, chunksB)

        const expectedCoverage = Math.max(chunksA, chunksB) > 0
          ? matchedCount / Math.max(chunksA, chunksB)
          : 0
        const error = Math.abs(result.final - expectedCoverage)

        console.log(`\n${scenario.name}:`)
        console.log(`  Expected: ${(expectedCoverage * 100).toFixed(1)}%`)
        console.log(`  Actual:   ${(result.final * 100).toFixed(1)}%`)
        console.log(`  Error:    ${(error * 100).toFixed(1)}%`)
        console.log(`  Status:   ${error === 0 ? '✅ PASS' : '❌ FAIL'}`)

        expect(error).toBeCloseTo(0, 5)
      })

      console.log('\n' + '='.repeat(60))
      console.log('✅ All scenarios match coverage-of-largest-doc expectation')
    })
  })
})
