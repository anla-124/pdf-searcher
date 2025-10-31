/**
 * Type definitions for production-ready similarity search system
 * Implements adaptive scoring with 3-stage pipeline
 */

export interface ChunkMatch {
  chunkA: {
    id: string
    index: number
    pageNumber: number
    characterCount: number
  }
  chunkB: {
    id: string
    index: number
    pageNumber: number
    characterCount: number
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
  sourceScore: number                  // Portion of source document matched (directional coverage)
  targetScore: number                  // Portion of target document matched (directional coverage)
  matchedSourceCharacters: number      // Absolute matched character count from source
  matchedTargetCharacters: number      // Absolute matched character count from target
  explanation: string                  // User-facing explanation
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
  pageNumber: number         // Keep for backward compatibility
  startPageNumber?: number   // First page in chunk (for chunks spanning multiple pages)
  endPageNumber?: number     // Last page in chunk (for chunks spanning multiple pages)
  embedding: number[]        // Pre-normalized (L2 normalized at write time)
  text?: string
  characterCount: number     // Required for character-based similarity scoring
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
