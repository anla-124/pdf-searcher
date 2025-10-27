import { logger } from '@/lib/logger'

/**
 * Histogram utilities for similarity distribution analysis
 * Used for threshold calibration (future enhancement)
 */

export interface HistogramBin {
  min: number
  max: number
  count: number
  percentage: number
}

export interface HistogramStats {
  mean: number
  median: number
  stdDev: number
  min: number
  max: number
  q25: number  // 25th percentile
  q75: number  // 75th percentile
}

/**
 * Compute histogram of similarity scores
 * Used to analyze similarity distributions for threshold calibration
 *
 * @param scores - Array of similarity scores (0.0 to 1.0)
 * @param binCount - Number of bins (default: 20)
 * @returns Array of histogram bins
 */
export function computeHistogram(
  scores: number[],
  binCount: number = 20
): HistogramBin[] {
  if (scores.length === 0) {
    return []
  }

  const min = 0.0
  const max = 1.0
  const binWidth = (max - min) / binCount

  // Initialize bins
  const bins: HistogramBin[] = Array.from({ length: binCount }, (_, i) => ({
    min: min + i * binWidth,
    max: min + (i + 1) * binWidth,
    count: 0,
    percentage: 0
  }))

  // Populate bins
  for (const score of scores) {
    const binIndex = Math.min(Math.floor((score - min) / binWidth), binCount - 1)
    if (binIndex >= 0 && binIndex < binCount) {
      const bin = bins[binIndex]
      if (bin) {
        bin.count++
      }
    }
  }

  // Compute percentages
  const total = scores.length
  for (const bin of bins) {
    bin.percentage = (bin.count / total) * 100
  }

  return bins
}

/**
 * Compute statistical metrics for similarity scores
 * Use for impostor distribution analysis (calibrating threshold)
 */
export function computeStats(scores: number[]): HistogramStats {
  if (scores.length === 0) {
    throw new Error('Cannot compute stats for empty array')
  }

  const sorted = [...scores].sort((a, b) => a - b)
  const n = sorted.length

  // Mean
  const mean = sorted.reduce((sum, val) => sum + val, 0) / n

  // Median
  let median: number
  if (n % 2 === 0) {
    const upperIndex = n / 2
    const lowerValue = sorted[upperIndex - 1]
    const upperValue = sorted[upperIndex]
    if (lowerValue === undefined || upperValue === undefined) {
      throw new Error('Cannot compute median: missing sorted values')
    }
    median = (lowerValue + upperValue) / 2
  } else {
    const midIndex = Math.floor(n / 2)
    const midValue = sorted[midIndex]
    if (midValue === undefined) {
      throw new Error('Cannot compute median: missing sorted value')
    }
    median = midValue
  }

  // Standard deviation
  const variance = sorted.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / n
  const stdDev = Math.sqrt(variance)

  // Min/max
  const minValue = sorted[0]
  const maxValue = sorted[n - 1]
  if (minValue === undefined || maxValue === undefined) {
    throw new Error('Cannot compute min/max: missing sorted values')
  }

  // Quartiles
  const q25Index = Math.floor(n * 0.25)
  const q75Index = Math.floor(n * 0.75)
  const q25Value = sorted[q25Index]
  const q75Value = sorted[q75Index]
  if (q25Value === undefined || q75Value === undefined) {
    throw new Error('Cannot compute quartiles: missing sorted values')
  }

  return {
    mean,
    median,
    stdDev,
    min: minValue,
    max: maxValue,
    q25: q25Value,
    q75: q75Value
  }
}

/**
 * Suggest threshold based on impostor distribution
 * Impostor pairs = documents that should NOT match
 * Recommended: τ = μ + 3σ (captures 99.7% of impostors)
 *
 * @param impostorScores - Similarity scores from known non-matching pairs
 * @param sigmaMultiplier - Number of standard deviations above mean (default: 3)
 * @returns Suggested threshold
 */
export function suggestThreshold(
  impostorScores: number[],
  sigmaMultiplier: number = 3
): {
  threshold: number
  stats: HistogramStats
  explanation: string
} {
  const stats = computeStats(impostorScores)
  const threshold = Math.min(stats.mean + sigmaMultiplier * stats.stdDev, 0.95)

  const explanation =
    `Based on ${impostorScores.length} impostor pairs:\n` +
    `Mean: ${stats.mean.toFixed(3)}, StdDev: ${stats.stdDev.toFixed(3)}\n` +
    `Suggested threshold: ${threshold.toFixed(3)} (μ + ${sigmaMultiplier}σ)\n` +
    `This captures ${(100 * (1 - 1 / (2 * Math.pow(sigmaMultiplier, 2)))).toFixed(1)}% of impostors`

  return { threshold, stats, explanation }
}

/**
 * Log histogram to console for debugging
 */
export function logHistogram(bins: HistogramBin[], title: string = 'Similarity Distribution'): void {
  logger.info(`Histogram: ${title}`, {
    buckets: bins.map(bin => ({
      min: bin.min,
      max: bin.max,
      count: bin.count,
      percentage: bin.percentage
    }))
  })
  for (const bin of bins) {
    const bar = '█'.repeat(Math.round(bin.percentage / 2))  // Scale to fit console
    logger.info('Histogram bucket', {
      range: `${bin.min.toFixed(2)}-${bin.max.toFixed(2)}`,
      bar,
      count: bin.count,
      percentage: Number(bin.percentage.toFixed(1))
    })
  }
}

/**
 * Log statistics to console
 */
export function logStats(stats: HistogramStats, title: string = 'Statistics'): void {
  logger.info(`Histogram stats: ${title}`, {
    mean: Number(stats.mean.toFixed(3)),
    median: Number(stats.median.toFixed(3)),
    stdDev: Number(stats.stdDev.toFixed(3)),
    min: Number(stats.min.toFixed(3)),
    max: Number(stats.max.toFixed(3)),
    q25: Number(stats.q25.toFixed(3)),
    q75: Number(stats.q75.toFixed(3))
  })
}
