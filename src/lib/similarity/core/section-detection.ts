/**
 * Section Detection from Matched Chunks
 * Groups consecutive matched chunks into sections based on page ranges
 * Infers section boundaries from contiguous page matches
 */

import { ChunkMatch, SectionMatch } from '../types'

/**
 * Group matched chunks into sections based on contiguous page ranges
 * Sections are identified by consecutive matches without large gaps
 *
 * @param matches - Array of chunk matches
 * @param maxPageGap - Maximum gap between chunks to be considered same section (default: 1)
 * @returns Array of section matches
 */
export function groupMatchesIntoSections(
  matches: ChunkMatch[],
  maxPageGap: number = 1
): SectionMatch[] {

  if (matches.length === 0) {
    return []
  }

  // Sort by source chunk page number for contiguous grouping
  const sorted = [...matches].sort((a, b) => a.chunkA.pageNumber - b.chunkA.pageNumber)

  const sections: SectionMatch[] = []
  let currentSection: {
    chunksA: number[]
    chunksB: number[]
    pagesA: number[]
    pagesB: number[]
    scores: number[]
  } | null = null

  for (let i = 0; i < sorted.length; i++) {
    const match = sorted[i]!

    let isContiguous = false
    if (currentSection) {
      const lastPageA = currentSection.pagesA[currentSection.pagesA.length - 1]
      if (typeof lastPageA === 'number') {
        isContiguous = match.chunkA.pageNumber - lastPageA <= maxPageGap
      }
    }

    if (!currentSection || !isContiguous) {
      // Save previous section
      if (currentSection) {
        sections.push(summarizeSection(currentSection))
      }

      // Start new section
      currentSection = {
        chunksA: [match.chunkA.index],
        chunksB: [match.chunkB.index],
        pagesA: [match.chunkA.pageNumber],
        pagesB: [match.chunkB.pageNumber],
        scores: [match.score]
      }
    } else {
      // Continue current section
      currentSection.chunksA.push(match.chunkA.index)
      currentSection.chunksB.push(match.chunkB.index)
      currentSection.pagesA.push(match.chunkA.pageNumber)
      currentSection.pagesB.push(match.chunkB.pageNumber)
      currentSection.scores.push(match.score)
    }
  }

  // Save final section
  if (currentSection) {
    sections.push(summarizeSection(currentSection))
  }

  return sections
}

/**
 * Summarize accumulated section data into SectionMatch
 */
function summarizeSection(section: {
  chunksA: number[]
  chunksB: number[]
  pagesA: number[]
  pagesB: number[]
  scores: number[]
}): SectionMatch {

  // Compute average score across all chunks in section
  const avgScore = section.scores.reduce((sum, s) => sum + s, 0) / section.scores.length

  // Get page range for document A
  const minPageA = Math.min(...section.pagesA)
  const maxPageA = Math.max(...section.pagesA)

  // Get page range for document B
  const minPageB = Math.min(...section.pagesB)
  const maxPageB = Math.max(...section.pagesB)

  // Format page ranges
  const docA_pageRange = minPageA === maxPageA
    ? `${minPageA}`
    : `${minPageA}-${maxPageA}`

  const docB_pageRange = minPageB === maxPageB
    ? `${minPageB}`
    : `${minPageB}-${maxPageB}`

  // Determine if section is reusable (high similarity)
  const reusable = avgScore > 0.85

  return {
    docA_pageRange,
    docB_pageRange,
    avgScore,
    chunkCount: section.scores.length,
    reusable
  }
}

/**
 * Classify sections by reusability
 * Returns sections grouped by quality tier
 */
export function classifySections(sections: SectionMatch[]): {
  highlyReusable: SectionMatch[]  // > 85%
  needsReview: SectionMatch[]     // 65-85%
  lowSimilarity: SectionMatch[]   // < 65%
} {

  const highlyReusable: SectionMatch[] = []
  const needsReview: SectionMatch[] = []
  const lowSimilarity: SectionMatch[] = []

  for (const section of sections) {
    if (section.avgScore > 0.85) {
      highlyReusable.push(section)
    } else if (section.avgScore >= 0.65) {
      needsReview.push(section)
    } else {
      lowSimilarity.push(section)
    }
  }

  return { highlyReusable, needsReview, lowSimilarity }
}

/**
 * Get total page coverage from sections
 * Useful for showing "X pages matched out of Y total pages"
 */
export function getSectionCoverage(
  sections: SectionMatch[],
  totalPagesA: number,
  totalPagesB: number
): {
  coveredPagesA: Set<number>
  coveredPagesB: Set<number>
  coveragePercentageA: number
  coveragePercentageB: number
} {

  const coveredPagesA = new Set<number>()
  const coveredPagesB = new Set<number>()

  for (const section of sections) {
    // Parse page ranges
    const rangeA = parsePageRange(section.docA_pageRange)
    const rangeB = parsePageRange(section.docB_pageRange)

    // Add all pages in range
    for (let page = rangeA.min; page <= rangeA.max; page++) {
      coveredPagesA.add(page)
    }
    for (let page = rangeB.min; page <= rangeB.max; page++) {
      coveredPagesB.add(page)
    }
  }

  return {
    coveredPagesA,
    coveredPagesB,
    coveragePercentageA: totalPagesA > 0 ? (coveredPagesA.size / totalPagesA) * 100 : 0,
    coveragePercentageB: totalPagesB > 0 ? (coveredPagesB.size / totalPagesB) * 100 : 0
  }
}

/**
 * Parse page range string like "5" or "12-20" into min/max
 */
function parsePageRange(rangeStr: string): { min: number; max: number } {
  const trimmed = rangeStr.trim()

  if (trimmed.includes('-')) {
    const [minPartRaw, maxPartRaw] = trimmed.split('-', 2)
    const minSource = (minPartRaw ?? trimmed).trim()
    const maxSource = (maxPartRaw ?? minSource).trim()
    const min = Number.parseInt(minSource, 10)
    const max = Number.parseInt(maxSource, 10)

    return {
      min: Number.isNaN(min) ? 0 : min,
      max: Number.isNaN(max) ? (Number.isNaN(min) ? 0 : min) : max
    }
  }

  const page = Number.parseInt(trimmed, 10)
  const normalizedPage = Number.isNaN(page) ? 0 : page
  return { min: normalizedPage, max: normalizedPage }
}

/**
 * Generate human-readable section summary
 * Useful for UI display and explanations
 */
export function generateSectionSummary(sections: SectionMatch[]): string {
  if (sections.length === 0) {
    return 'No matched sections found.'
  }

  const classified = classifySections(sections)

  const summary = []

  if (classified.highlyReusable.length > 0) {
    summary.push(`${classified.highlyReusable.length} highly reusable sections (>85% similarity)`)
  }

  if (classified.needsReview.length > 0) {
    summary.push(`${classified.needsReview.length} sections need review (65-85% similarity)`)
  }

  if (classified.lowSimilarity.length > 0) {
    summary.push(`${classified.lowSimilarity.length} low similarity sections (<65%)`)
  }

  return summary.join(', ')
}
