// Legacy character-based chunking constants (kept for backward compatibility)
export const DEFAULT_CHUNK_SIZE = parseInt(process.env['CHUNK_SIZE'] ?? '500', 10)
export const DEFAULT_CHUNK_OVERLAP = parseInt(process.env['CHUNK_OVERLAP'] ?? '100', 10)

export const DEFAULT_CHUNK_STRIDE = DEFAULT_CHUNK_SIZE - DEFAULT_CHUNK_OVERLAP

if (DEFAULT_CHUNK_OVERLAP >= DEFAULT_CHUNK_SIZE) {
  throw new Error(
    `Invalid chunk configuration: overlap (${DEFAULT_CHUNK_OVERLAP}) must be less than chunk size (${DEFAULT_CHUNK_SIZE}). ` +
    `Check CHUNK_SIZE / CHUNK_OVERLAP environment variables.`
  )
}

// Sentence-based chunking constants (legacy - kept for reference)
export const SENTENCES_PER_CHUNK = parseInt(process.env['SENTENCES_PER_CHUNK'] ?? '4', 10)
export const SENTENCE_OVERLAP = parseInt(process.env['SENTENCE_OVERLAP'] ?? '1', 10)

// Paragraph-based chunking constants (current approach)
// v4.5.0: Greedy algorithm uses only MAX_CHUNK_TOKENS for strict token enforcement
export const MIN_CHUNK_TOKENS = parseInt(process.env['MIN_CHUNK_TOKENS'] ?? '80', 10)
export const MAX_CHUNK_TOKENS = parseInt(process.env['MAX_CHUNK_TOKENS'] ?? '250', 10)
