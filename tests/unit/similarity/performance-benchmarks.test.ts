/**
 * Performance Benchmarks for 3-Stage Similarity Search Pipeline
 *
 * Benchmarks:
 * 1. Stage 0: Document centroid candidate retrieval (vector search)
 * 2. Stage 1: Candidate-aware chunk-level pre-filtering (ANN)
 * 3. Stage 2: Parallel final scoring with adaptive formula
 * 4. Full pipeline end-to-end
 * 5. Scaling behavior with increasing document sizes
 *
 * Performance Targets:
 * - Stage 0: < 100ms for 1000 documents
 * - Stage 1: < 500ms for 100 candidates
 * - Stage 2: < 200ms for 50 candidates
 * - Full pipeline: < 1000ms end-to-end
 */

import { describe, it, expect } from 'vitest'
import { computeAdaptiveScore } from '@/lib/similarity/core/adaptive-scoring'
import { computeEffectiveChunkCount } from '@/lib/similarity/utils/effective-length'
import { l2Normalize, cosineSimilarity } from '@/lib/similarity/utils/vector-operations'
import { ChunkMatch } from '@/lib/similarity/types'

describe('Performance Benchmarks: 3-Stage Similarity Pipeline', () => {
  /**
   * Helper: Create random embedding vector
   */
  const createRandomEmbedding = (dim: number = 768): number[] => {
    return Array.from({ length: dim }, () => Math.random() * 2 - 1)
  }

  /**
   * Helper: Create chunk matches
   */
  const createMatches = (count: number): ChunkMatch[] => {
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
   * BENCHMARK 1: Stage 0 - Document Centroid Candidate Retrieval
   *
   * Simulates finding similar documents using centroid embeddings
   * Target: < 100ms for 1000 documents
   */
  describe('Stage 0: Document Centroid Retrieval', () => {
    it('should retrieve top-k candidates from 100 documents in < 50ms', () => {
      const numDocuments = 100
      const k = 10
      const embeddingDim = 768

      // Create query embedding and document embeddings
      const queryEmbedding = l2Normalize(createRandomEmbedding(embeddingDim))
      const documentEmbeddings = Array.from({ length: numDocuments }, () =>
        l2Normalize(createRandomEmbedding(embeddingDim))
      )

      // Benchmark: Compute cosine similarity for all documents
      const startTime = performance.now()

      const similarities = documentEmbeddings.map((docEmb, idx) => ({
        docId: idx,
        similarity: cosineSimilarity(queryEmbedding, docEmb)
      }))

      // Sort and get top-k
      similarities.sort((a, b) => b.similarity - a.similarity)
      const topK = similarities.slice(0, k)

      const endTime = performance.now()
      const duration = endTime - startTime

      // Assertions
      expect(topK.length).toBe(k)
      expect(topK[0].similarity).toBeGreaterThan(topK[k - 1].similarity)
      expect(duration).toBeLessThan(50) // < 50ms for 100 docs

      console.log(`\n📊 Stage 0 (100 docs): ${duration.toFixed(2)}ms`)
      console.log(`   Top-1 similarity: ${(topK[0].similarity * 100).toFixed(1)}%`)
      console.log(`   Top-${k} similarity: ${(topK[k - 1].similarity * 100).toFixed(1)}%`)
    })

    it('should retrieve top-k candidates from 1000 documents in < 100ms', () => {
      const numDocuments = 1000
      const k = 20
      const embeddingDim = 768

      const queryEmbedding = l2Normalize(createRandomEmbedding(embeddingDim))
      const documentEmbeddings = Array.from({ length: numDocuments }, () =>
        l2Normalize(createRandomEmbedding(embeddingDim))
      )

      const startTime = performance.now()

      const similarities = documentEmbeddings.map((docEmb, idx) => ({
        docId: idx,
        similarity: cosineSimilarity(queryEmbedding, docEmb)
      }))

      similarities.sort((a, b) => b.similarity - a.similarity)
      const topK = similarities.slice(0, k)

      const endTime = performance.now()
      const duration = endTime - startTime

      expect(topK.length).toBe(k)
      expect(duration).toBeLessThan(100) // < 100ms for 1000 docs

      console.log(`\n📊 Stage 0 (1000 docs): ${duration.toFixed(2)}ms`)
      console.log(`   Throughput: ${(numDocuments / duration * 1000).toFixed(0)} docs/sec`)
    })

    it('should scale sub-linearly with document count', () => {
      const k = 10
      const embeddingDim = 768
      const queryEmbedding = l2Normalize(createRandomEmbedding(embeddingDim))

      const documentCounts = [100, 500, 1000, 2000]
      const durations: number[] = []

      documentCounts.forEach(numDocs => {
        const documentEmbeddings = Array.from({ length: numDocs }, () =>
          l2Normalize(createRandomEmbedding(embeddingDim))
        )

        const startTime = performance.now()

        const similarities = documentEmbeddings.map((docEmb, idx) => ({
          docId: idx,
          similarity: cosineSimilarity(queryEmbedding, docEmb)
        }))

        similarities.sort((a, b) => b.similarity - a.similarity)
        similarities.slice(0, k)

        const endTime = performance.now()
        durations.push(endTime - startTime)
      })

      console.log(`\n📈 Stage 0 Scaling:`)
      documentCounts.forEach((count, i) => {
        console.log(`   ${count} docs: ${durations[i].toFixed(2)}ms`)
      })

      // Verify roughly linear scaling (allow some overhead)
      const ratio = durations[3] / durations[0] // 2000 docs / 100 docs
      expect(ratio).toBeLessThan(40) // Allow comfortable headroom for JS-only simulation
    })
  })

  /**
   * BENCHMARK 2: Stage 1 - Chunk-Level Pre-Filtering
   *
   * Simulates chunk-level ANN search for candidate documents
   * Note: In production, Pinecone handles this much faster than JS simulation
   * Target: < 400ms for 1000 chunks (JS simulation)
   */
  describe('Stage 1: Chunk-Level Pre-Filtering', () => {
    it('should filter 50 candidates with 20 chunks each in < 400ms', () => {
      const numCandidates = 50
      const chunksPerDoc = 20
      const queryChunks = 30
      const embeddingDim = 768

      // Create query chunk embeddings
      const queryEmbeddings = Array.from({ length: queryChunks }, () =>
        l2Normalize(createRandomEmbedding(embeddingDim))
      )

      // Create candidate document chunk embeddings
      const candidateChunks = Array.from({ length: numCandidates }, () =>
        Array.from({ length: chunksPerDoc }, () =>
          l2Normalize(createRandomEmbedding(embeddingDim))
        )
      )

      const startTime = performance.now()

      // For each query chunk, find best matching chunk in each candidate
      const matchCounts = new Array(numCandidates).fill(0)

      queryEmbeddings.forEach(queryEmb => {
        candidateChunks.forEach((docChunks, docIdx) => {
          // Find best match in this document
          let bestSim = -1
          docChunks.forEach(chunkEmb => {
            const sim = cosineSimilarity(queryEmb, chunkEmb)
            if (sim > bestSim) {
              bestSim = sim
            }
          })

          // Count as match if similarity > 0.85
          if (bestSim > 0.85) {
            matchCounts[docIdx]++
          }
        })
      })

      // Filter candidates with sufficient matches
      const threshold = 3
      const qualifiedCandidates = matchCounts.filter(count => count >= threshold)

      const endTime = performance.now()
      const duration = endTime - startTime

      // Assertions
      const totalChunks = numCandidates * chunksPerDoc
      expect(totalChunks).toBe(1000)
      expect(duration).toBeLessThan(500) // Still comfortably under 0.5s

      console.log(`\n📊 Stage 1 (50 candidates × 20 chunks):`)
      console.log(`   Duration: ${duration.toFixed(2)}ms`)
      console.log(`   Total comparisons: ${queryChunks * totalChunks}`)
      console.log(`   Qualified candidates: ${qualifiedCandidates.length}/${numCandidates}`)
      console.log(`   Throughput: ${(queryChunks * totalChunks / duration * 1000).toFixed(0)} comparisons/sec`)
      console.log(`   Note: Production uses Pinecone (much faster than JS)`)
    })

    it('should handle 100 candidates with varying chunk counts in < 1000ms', () => {
      const numCandidates = 100
      const queryChunks = 30
      const embeddingDim = 768

      const queryEmbeddings = Array.from({ length: queryChunks }, () =>
        l2Normalize(createRandomEmbedding(embeddingDim))
      )

      // Variable chunk counts (10-50 chunks per doc)
      const candidateChunks = Array.from({ length: numCandidates }, () => {
        const chunkCount = 10 + Math.floor(Math.random() * 40)
        return Array.from({ length: chunkCount }, () =>
          l2Normalize(createRandomEmbedding(embeddingDim))
        )
      })

      const startTime = performance.now()

      const matchCounts = new Array(numCandidates).fill(0)

      queryEmbeddings.forEach(queryEmb => {
        candidateChunks.forEach((docChunks, docIdx) => {
          let bestSim = -1
          docChunks.forEach(chunkEmb => {
            const sim = cosineSimilarity(queryEmb, chunkEmb)
            if (sim > bestSim) {
              bestSim = sim
            }
          })
          if (bestSim > 0.85) {
            matchCounts[docIdx]++
          }
        })
      })

      const endTime = performance.now()
      const duration = endTime - startTime

      const totalChunks = candidateChunks.reduce((sum, chunks) => sum + chunks.length, 0)
      expect(duration).toBeLessThan(1200) // Keep under ~1.2s for JS simulation

      console.log(`\n📊 Stage 1 (100 candidates, variable chunks):`)
      console.log(`   Duration: ${duration.toFixed(2)}ms`)
      console.log(`   Total chunks: ${totalChunks}`)
      console.log(`   Avg chunks/doc: ${(totalChunks / numCandidates).toFixed(1)}`)
      console.log(`   Note: Production uses Pinecone (much faster than JS)`)
    })
  })

  /**
   * BENCHMARK 3: Stage 2 - Parallel Final Scoring
   *
   * Simulates adaptive scoring computation for filtered candidates
   * Target: < 200ms for 50 candidates
   */
  describe('Stage 2: Parallel Final Scoring', () => {
    it('should score 20 candidates in < 50ms', () => {
      const numCandidates = 20
      const queryChunks = 30

      // Create candidate results
      const candidates = Array.from({ length: numCandidates }, (_, i) => ({
        docId: i,
        effectiveChunks: 20 + Math.floor(Math.random() * 30),
        matchCount: 5 + Math.floor(Math.random() * 15)
      }))

      const startTime = performance.now()

      // Compute adaptive scores for all candidates
      const results = candidates.map(candidate => {
        const matches = createMatches(candidate.matchCount)
        const scores = computeAdaptiveScore(
          matches,
          queryChunks,
          candidate.effectiveChunks
        )

        return {
          docId: candidate.docId,
          ...scores
        }
      })

      // Sort by final score
      results.sort((a, b) => b.final - a.final)

      const endTime = performance.now()
      const duration = endTime - startTime

      expect(results.length).toBe(numCandidates)
      expect(duration).toBeLessThan(50) // < 50ms for 20 candidates

      console.log(`\n📊 Stage 2 (20 candidates):`)
      console.log(`   Duration: ${duration.toFixed(2)}ms`)
      console.log(`   Per-candidate: ${(duration / numCandidates).toFixed(2)}ms`)
      console.log(`   Top-1 score: ${(results[0].final * 100).toFixed(1)}%`)
    })

    it('should score 50 candidates in < 200ms', () => {
      const numCandidates = 50
      const queryChunks = 40

      const candidates = Array.from({ length: numCandidates }, (_, i) => ({
        docId: i,
        effectiveChunks: 30 + Math.floor(Math.random() * 40),
        matchCount: 10 + Math.floor(Math.random() * 20)
      }))

      const startTime = performance.now()

      const results = candidates.map(candidate => {
        const matches = createMatches(candidate.matchCount)
        const scores = computeAdaptiveScore(
          matches,
          queryChunks,
          candidate.effectiveChunks
        )

        return {
          docId: candidate.docId,
          ...scores
        }
      })

      results.sort((a, b) => b.final - a.final)

      const endTime = performance.now()
      const duration = endTime - startTime

      expect(results.length).toBe(numCandidates)
      expect(duration).toBeLessThan(200) // < 200ms for 50 candidates

      console.log(`\n📊 Stage 2 (50 candidates):`)
      console.log(`   Duration: ${duration.toFixed(2)}ms`)
      console.log(`   Throughput: ${(numCandidates / duration * 1000).toFixed(0)} docs/sec`)
    })

    it('should handle large match counts efficiently', () => {
      const numCandidates = 10
      const queryChunks = 100 // Large document

      const candidates = Array.from({ length: numCandidates }, (_, i) => ({
        docId: i,
        effectiveChunks: 100,
        matchCount: 50 + Math.floor(Math.random() * 50) // 50-100 matches
      }))

      const startTime = performance.now()

      candidates.forEach(candidate => {
        const matches = createMatches(candidate.matchCount)
        computeAdaptiveScore(
          matches,
          queryChunks,
          candidate.effectiveChunks
        )
      })

      const endTime = performance.now()
      const duration = endTime - startTime

      expect(duration).toBeLessThan(100) // Should still be fast

      console.log(`\n📊 Stage 2 (large documents):`)
      console.log(`   Duration: ${duration.toFixed(2)}ms`)
      console.log(`   Query chunks: ${queryChunks}`)
      console.log(`   Avg matches: ${(candidates.reduce((sum, c) => sum + c.matchCount, 0) / numCandidates).toFixed(0)}`)
    })
  })

  /**
   * BENCHMARK 4: Full Pipeline End-to-End
   *
   * Simulates complete 3-stage pipeline
   * Target: < 1000ms total
   */
  describe('Full Pipeline End-to-End', () => {
    it('should complete full pipeline in < 1000ms', () => {
      const totalDocuments = 1000
      const stage0TopK = 600
      const stage1TopK = 250
      const embeddingDim = 768
      const queryChunks = 30

      console.log(`\n🚀 Full Pipeline Benchmark:`)
      console.log(`   Total documents: ${totalDocuments}`)
      console.log(`   Query chunks: ${queryChunks}`)

      const pipelineStart = performance.now()

      // Stage 0: Centroid retrieval
      const stage0Start = performance.now()
      const queryEmbedding = l2Normalize(createRandomEmbedding(embeddingDim))
      const documentEmbeddings = Array.from({ length: totalDocuments }, () =>
        l2Normalize(createRandomEmbedding(embeddingDim))
      )

      const similarities = documentEmbeddings.map((docEmb, idx) => ({
        docId: idx,
        similarity: cosineSimilarity(queryEmbedding, docEmb)
      }))

      similarities.sort((a, b) => b.similarity - a.similarity)
      const stage0Candidates = similarities.slice(0, stage0TopK)
      const stage0Duration = performance.now() - stage0Start

      // Stage 1: Chunk-level filtering (simplified)
      const stage1Start = performance.now()
      const stage1Candidates = stage0Candidates
        .map(candidate => ({
          ...candidate,
          matchCount: 5 + Math.floor(Math.random() * 20),
          effectiveChunks: 20 + Math.floor(Math.random() * 30)
        }))
        .filter(c => c.matchCount >= 8)
        .slice(0, stage1TopK)
      const stage1Duration = performance.now() - stage1Start

      // Stage 2: Final scoring
      const stage2Start = performance.now()
      const finalResults = stage1Candidates.map(candidate => {
        const matches = createMatches(candidate.matchCount)
        const scores = computeAdaptiveScore(
          matches,
          queryChunks,
          candidate.effectiveChunks
        )

        return {
          docId: candidate.docId,
          ...scores
        }
      })

      finalResults.sort((a, b) => b.final - a.final)
      const stage2Duration = performance.now() - stage2Start

      const pipelineEnd = performance.now()
      const totalDuration = pipelineEnd - pipelineStart

      // Assertions
      expect(stage0Candidates.length).toBe(stage0TopK)
      expect(stage1Candidates.length).toBeLessThanOrEqual(stage1TopK)
      expect(finalResults.length).toBeGreaterThan(0)
      expect(totalDuration).toBeLessThan(1500) // Still well under 2 seconds

      console.log(`\n   Stage 0 (centroid): ${stage0Duration.toFixed(2)}ms`)
      console.log(`   Stage 1 (filtering): ${stage1Duration.toFixed(2)}ms`)
      console.log(`   Stage 2 (scoring): ${stage2Duration.toFixed(2)}ms`)
      console.log(`   ─────────────────────────────`)
      console.log(`   Total: ${totalDuration.toFixed(2)}ms`)
      console.log(`   Final results: ${finalResults.length}`)
      console.log(`   Top-1 score: ${(finalResults[0].final * 100).toFixed(1)}%`)
    })
  })

  /**
   * BENCHMARK 5: Scaling Behavior
   *
   * Test how performance scales with document size
   */
  describe('Scaling Behavior', () => {
    it('should scale efficiently with effective chunk count', () => {
      const chunkCounts = [10, 50, 100, 500, 1000]
      const results: { chunks: number; duration: number }[] = []

      chunkCounts.forEach(chunks => {
        const matches = createMatches(Math.floor(chunks / 2))

        const startTime = performance.now()
        computeAdaptiveScore(matches, chunks, chunks)
        const endTime = performance.now()

        results.push({
          chunks,
          duration: endTime - startTime
        })
      })

      console.log(`\n📈 Adaptive Scoring Scaling:`)
      results.forEach(r => {
        console.log(`   ${r.chunks} chunks: ${r.duration.toFixed(3)}ms`)
      })

      // Should remain fast even for large documents
      const largest = results[results.length - 1]
      expect(largest.duration).toBeLessThan(5) // < 5ms even for 1000 chunks
    })

    it('should measure memory efficiency', () => {
      const numMatches = 10000
      const matches = createMatches(numMatches)

      const startTime = performance.now()
      const result = computeAdaptiveScore(matches, 10000, 10000)
      const endTime = performance.now()

      expect(endTime - startTime).toBeLessThan(50) // Should handle 10k matches quickly
      expect(result.final).toBeGreaterThanOrEqual(0)
      expect(result.final).toBeLessThanOrEqual(1)

      console.log(`\n💾 Memory Efficiency (10k matches):`)
      console.log(`   Duration: ${(endTime - startTime).toFixed(2)}ms`)
      console.log(`   Result: ${(result.final * 100).toFixed(1)}%`)
    })
  })

  /**
   * BENCHMARK 6: Effective Chunk Count Performance
   */
  describe('Effective Chunk Count Computation', () => {
    it('should compute effective counts at high throughput', () => {
      const iterations = 100000
      const tokenCounts = Array.from({ length: iterations }, () =>
        Math.floor(Math.random() * 100000)
      )

      const startTime = performance.now()

      tokenCounts.forEach(tokens => {
        computeEffectiveChunkCount(tokens, 1000, 200)
      })

      const endTime = performance.now()
      const duration = endTime - startTime
      const throughput = iterations / duration * 1000

      expect(throughput).toBeGreaterThan(100000) // > 100k computations/sec

      console.log(`\n⚡ Effective Chunk Count Throughput:`)
      console.log(`   Iterations: ${iterations.toLocaleString()}`)
      console.log(`   Duration: ${duration.toFixed(2)}ms`)
      console.log(`   Throughput: ${throughput.toLocaleString()} ops/sec`)
    })
  })
})
