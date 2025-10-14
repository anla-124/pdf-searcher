/**
 * Vector operations for similarity search
 * CRITICAL: All embeddings should be L2 normalized ONCE at write time
 * Never normalize on reads - cosine similarity = dot product for normalized vectors
 */

/**
 * L2 normalization - CALL ONCE AT WRITE TIME
 * Converts vector to unit length for cosine similarity via dot product
 */
export function l2Normalize(vector: number[]): number[] {
  const magnitude = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0))

  if (magnitude === 0) {
    console.warn('Warning: Attempting to normalize zero vector')
    return vector
  }

  return vector.map(v => v / magnitude)
}

/**
 * Cosine similarity via dot product
 * Assumes vectors are pre-normalized (L2 norm = 1)
 * For normalized vectors: cosine_similarity = dot_product
 */
export function cosineSimilarity(vecA: number[], vecB: number[]): number {
  if (vecA.length !== vecB.length) {
    throw new Error(`Vector dimension mismatch: ${vecA.length} vs ${vecB.length}`)
  }

  return vecA.reduce((sum, a, i) => sum + a * vecB[i], 0)
}

/**
 * Compute centroid (arithmetic mean) of multiple vectors
 * Used for document-level centroids in Stage 0
 */
export function computeCentroid(embeddings: number[][]): number[] {
  if (embeddings.length === 0) {
    throw new Error('Cannot compute centroid of empty embedding array')
  }

  const dimension = embeddings[0].length
  const centroid = new Array(dimension).fill(0)

  // Sum all vectors
  for (const embedding of embeddings) {
    if (embedding.length !== dimension) {
      throw new Error(`Inconsistent embedding dimensions in centroid computation`)
    }
    for (let i = 0; i < dimension; i++) {
      centroid[i] += embedding[i]
    }
  }

  // Average
  for (let i = 0; i < dimension; i++) {
    centroid[i] /= embeddings.length
  }

  return centroid
}

/**
 * Check if vector is normalized (for debugging)
 */
export function isNormalized(vector: number[], tolerance: number = 0.01): boolean {
  const magnitude = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0))
  return Math.abs(magnitude - 1.0) < tolerance
}
