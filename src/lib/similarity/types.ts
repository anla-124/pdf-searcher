/**
 * Type definitions for production-ready similarity search system
 * Implements adaptive scoring with 3-stage pipeline
 */

export interface ChunkMatch {
  chunkA: {
    id: string
    index: number
    pageNumber: number
    tokenCount: number
  }
  chunkB: {
    id: string
    index: number
    pageNumber: number
    tokenCount: number
  }
  score: number
}

export interface SectionMatch {
  docA_pageRange: string  // e.g., "12-20"
  docB_pageRange: string  // e.g., "34-42"
  avgScore: number
  chunkCount: number
  reusable: boolean  // true if avgScore > 0.85
}

export interface SimilarityScores {
  jaccard: number           // Primary: "Reusable Content %" (pair-based, token-weighted)
  weightedBidir: number     // Context: "Match Rate" (token-weighted average)
  final: number             // Ranking: Coverage of larger document (in tokens)
  sizeRatio: number         // s = min/max (using total_tokens)
  alpha: number             // Adaptive weight (clamped to [0.15, 0.95], for diagnostics)
  coverageA: number         // Coverage: % of doc A matched (matched_tokens_A / total_tokens_A)
  coverageB: number         // Coverage: % of doc B matched (matched_tokens_B / total_tokens_B)
  explanation: string       // User-facing explanation
}

export interface SimilarityDocument {
  id: string
  title: string
  filename: string
  page_count?: number
  effective_chunk_count: number
  [key: string]: unknown
}

export interface SimilarityResult {
  document: SimilarityDocument
  scores: SimilarityScores
  matchedChunks: number
  sections: SectionMatch[]
  timings?: {
    stage0?: number
    stage1?: number
    stage2?: number
    total?: number
  }
}

export interface Chunk {
  id: string
  index: number
  pageNumber: number
  embedding: number[]  // Pre-normalized (L2 normalized at write time)
  text?: string
  tokenCount: number   // Required for token-based similarity scoring
}

export interface Stage0Result {
  candidateIds: string[]
  scores: number[]
  timeMs: number
}

export interface Stage1Result {
  candidateIds: string[]
  matchCounts: number[]
  timeMs: number
}

export interface SearchOptions {
  topK?: number
  threshold?: number
  filters?: Record<string, unknown>
  parallelWorkers?: number
}
