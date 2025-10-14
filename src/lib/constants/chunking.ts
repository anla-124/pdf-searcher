export const DEFAULT_CHUNK_SIZE = parseInt(process.env['CHUNK_SIZE'] ?? '500', 10)
export const DEFAULT_CHUNK_OVERLAP = parseInt(process.env['CHUNK_OVERLAP'] ?? '100', 10)

export const DEFAULT_CHUNK_STRIDE = DEFAULT_CHUNK_SIZE - DEFAULT_CHUNK_OVERLAP

if (DEFAULT_CHUNK_OVERLAP >= DEFAULT_CHUNK_SIZE) {
  throw new Error(
    `Invalid chunk configuration: overlap (${DEFAULT_CHUNK_OVERLAP}) must be less than chunk size (${DEFAULT_CHUNK_SIZE}). ` +
    `Check CHUNK_SIZE / CHUNK_OVERLAP environment variables.`
  )
}
