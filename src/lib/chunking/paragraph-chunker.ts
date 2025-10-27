/**
 * Paragraph-based chunking utility for semantic search optimization (v4.5.0)
 *
 * This module provides intelligent text chunking that:
 * - Uses Document AI's detected paragraph boundaries
 * - Strips prefixes (A., 1., 2.1, (i), etc.) for better similarity matching
 * - Removes footnote paragraphs
 * - Merges form options (Yes/No/N/A) with parent paragraphs
 * - Merges incomplete paragraphs (mid-sentence cuts at page boundaries)
 * - Groups paragraphs using greedy algorithm with zero overlap
 */

import { splitIntoSentences } from './sentence-chunker'

export interface Paragraph {
  text: string
  pageNumber: number
  index: number
}

export interface Chunk {
  text: string
  pageNumber: number
  chunkIndex: number
  tokenCount: number
}

/**
 * Strip structural prefixes from paragraph text
 * Removes: A., 1., 2.1, 1.a., (i), (ii), (A), (B), etc.
 * Preserves: Statute refs like "Section 2510.3-101", "12 U.S.C. § 1813(A)"
 */
export function stripPrefixes(text: string): string {
  let cleaned = text.trim()

  // Strip standalone numbers/letters on their own (like "1." or "2." or "A.")
  if (/^[A-Z]\.\s*$/.test(cleaned)) return ''
  if (/^\d+\.\s*$/.test(cleaned)) return ''
  if (/^\d+\s*$/.test(cleaned)) return ''

  // IMPORTANT: Apply more specific patterns FIRST, then general patterns
  // Otherwise "2.2 Text" matches "2." and becomes "2 Text" instead of "Text"

  // Strip sub-numbers FIRST: "2.1 Text", "2.2 Text", "3.1 Text" → "Text"
  // Matches: number.number (optional period) space(s)
  cleaned = cleaned.replace(/^\d+\.\d+\.?\s+/gm, '')
  cleaned = cleaned.replace(/\n\d+\.\d+\.?\s+/g, '\n')

  // Strip number.letter patterns: "1.a. Text", "1.b Text", "2.a. Text" → "Text"
  cleaned = cleaned.replace(/^\d+\.[a-z]\.?\s+/gm, '')
  cleaned = cleaned.replace(/\n\d+\.[a-z]\.?\s+/g, '\n')

  // Strip letter sections: "A. STATUS MATTERS" → "STATUS MATTERS"
  cleaned = cleaned.replace(/^[A-Z]\.\s+/gm, '')
  cleaned = cleaned.replace(/\n[A-Z]\.\s+/g, '\n')

  // Strip simple numbers: "2. Is the Investor" → "Is the Investor"
  // Only after sub-numbers have been handled
  cleaned = cleaned.replace(/^\d+\.\s+/gm, '')
  cleaned = cleaned.replace(/\n\d+\.\s+/g, '\n')

  // Strip numbers without period: "2 Text" → "Text"
  // Handle cases where period was already removed
  cleaned = cleaned.replace(/^\d+\s+/gm, '')
  cleaned = cleaned.replace(/\n\d+\s+/g, '\n')

  // Strip numbers followed directly by newline: "2\nText" → "Text"
  // This handles cases where section numbers appear on their own line
  cleaned = cleaned.replace(/^\d+\n/gm, '')
  cleaned = cleaned.replace(/\n\d+\n/g, '\n')

  // Strip letters followed directly by newline: "A\nText" → "Text"
  // This handles cases where section letters appear on their own line
  cleaned = cleaned.replace(/^[A-Z]\n/gm, '')
  cleaned = cleaned.replace(/\n[A-Z]\n/g, '\n')

  // Strip roman numerals: "(ii) any company" → "any company"
  cleaned = cleaned.replace(/^\([ivxIVX]+\)\s*/gm, '')
  cleaned = cleaned.replace(/\n\([ivxIVX]+\)\s*/g, '\n')

  // Strip parenthesized letters: "(A) Text", "(B) Text", "(a) Text" → "Text"
  cleaned = cleaned.replace(/^\([A-Za-z]\)\s*/gm, '')
  cleaned = cleaned.replace(/\n\([A-Za-z]\)\s*/g, '\n')

  // Strip standalone page numbers at end
  cleaned = cleaned.replace(/\n\d+\s*$/g, '')

  return cleaned.trim()
}

/**
 * Detect if a paragraph is noise (standalone numbers, percentages, page numbers)
 * Examples: "1.", "2.1", "%", "Page 3", "A", "Yes\nNo"
 */
export function isNoiseParagraph(text: string): boolean {
  const trimmed = text.trim()

  // Very short text (likely noise) - raise threshold from 3 to 10 chars
  if (trimmed.length < 10) return true

  // Standalone section numbers with period: "1.", "2.", "3."
  if (/^[0-9]+\.\s*$/.test(trimmed)) return true

  // Standalone section numbers without period: "1", "2", "3"
  if (/^[0-9]+\s*$/.test(trimmed)) return true

  // Standalone sub-numbers: "2.1", "2.2", "3.1", "2.1."
  if (/^\d+\.\d+\.?\s*$/.test(trimmed)) return true

  // Standalone number.letter patterns: "1.a", "1.b", "2.a.", "2.b."
  if (/^\d+\.[a-z]\.?\s*$/.test(trimmed)) return true

  // Standalone letters with period: "A.", "B.", "C."
  if (/^[A-Z]\.\s*$/.test(trimmed)) return true

  // Standalone letters without period: "A", "B", "C"
  if (/^[A-Z]\s*$/.test(trimmed)) return true

  // Standalone parenthesized letters: "(A)", "(B)", "(a)", "(b)"
  if (/^\([A-Za-z]\)\s*$/.test(trimmed)) return true

  // Standalone parenthesized roman numerals: "(i)", "(ii)", "(iii)"
  if (/^\([ivxIVX]+\)\s*$/.test(trimmed)) return true

  // Standalone percentage signs
  if (/^%\s*$/.test(trimmed)) return true

  // Page numbers
  if (/^Page\s+\d+\s*$/i.test(trimmed)) return true

  // N/A placeholders
  if (/^N\/A\s*$/i.test(trimmed)) return true

  // Underscores (blank form fields): "____", "____%"
  if (/^_{2,}\s*%?\s*$/.test(trimmed)) return true

  return false
}

/**
 * Detect if a paragraph is a standalone form option
 * Examples: "Yes\nNo", "N/A", "____%"
 */
export function isFormOption(text: string): boolean {
  const trimmed = text.trim()

  // Check for Yes/No/N/A patterns
  if (/^(☐|□|\[\s*\])?\s*(Yes|No|N\/A|Not Applicable)(\s+(☐|□|\[\s*\])?\s*(Yes|No|N\/A|Not Applicable))*\s*$/i.test(trimmed)) {
    return true
  }

  // Check for blank percentage fields
  if (/^_{3,}\s*%?\s*$/.test(trimmed)) {
    return true
  }

  // Check for standalone N/A
  if (/^N\/A\s*$/i.test(trimmed)) {
    return true
  }

  // Check for standalone checkboxes
  if (/^\s*\[\s*\]\s*$/.test(trimmed)) {
    return true
  }

  return false
}

/**
 * Detect if a paragraph looks like a footnote
 * Footnotes typically start with numbers followed by common legal phrases
 */
export function isFootnote(text: string): boolean {
  const trimmed = text.trim()

  // Check if starts with superscript number + common footnote phrases
  if (/^[⁰¹²³⁴⁵⁶⁷⁸⁹]+\s+(For purposes|The SEC currently|This)/.test(trimmed)) {
    return true
  }

  // Check if starts with regular number + common footnote phrases
  if (/^[0-9]+\s+(For purposes|The SEC currently|This)/.test(trimmed)) {
    return true
  }

  return false
}

/**
 * Remove footnote paragraphs from the list
 */
export function removeFootnotes(paragraphs: Paragraph[]): Paragraph[] {
  return paragraphs.filter(para => !isFootnote(para.text))
}

/**
 * Merge form option paragraphs with their parent paragraph
 * Looks ahead and behind to handle noise paragraphs between question and options
 * IMPORTANT: Never creates paragraphs exceeding maxTokens to prevent oversized chunks
 * Example: [{text: "Is X?"}, {text: "2.1"}, {text: "Yes No"}] → [{text: "Is X? Yes No"}, {text: "2.1"}]
 */
export function mergeFormOptions(paragraphs: Paragraph[], maxTokens: number = 500): Paragraph[] {
  const merged: Paragraph[] = []
  const formOptionIndices = new Set<number>()

  // First pass: identify all form option paragraphs
  for (let i = 0; i < paragraphs.length; i++) {
    if (paragraphs[i] && isFormOption(paragraphs[i]!.text)) {
      formOptionIndices.add(i)
    }
  }

  // Second pass: merge form options with their questions
  for (let i = 0; i < paragraphs.length; i++) {
    const para = paragraphs[i]
    if (!para) continue

    // If this is a form option that was already merged, skip it
    if (formOptionIndices.has(i)) {
      // Look backward past noise paragraphs to find the question
      let questionIdx = -1
      for (let j = i - 1; j >= 0; j--) {
        const prevPara = paragraphs[j]
        if (!prevPara) continue

        // Skip noise paragraphs (section numbers, etc.)
        if (isNoiseParagraph(prevPara.text)) continue

        // Skip other form options
        if (formOptionIndices.has(j)) continue

        // Found a substantive paragraph (likely the question)
        questionIdx = j
        break
      }

      if (questionIdx >= 0) {
        // Find the question in merged array and append form option to it
        const questionInMerged = merged.find((m) =>
          m.index === paragraphs[questionIdx]!.index && m.pageNumber === paragraphs[questionIdx]!.pageNumber
        )
        if (questionInMerged) {
          // Check if merging would exceed maxTokens
          const questionTokens = countTokens(questionInMerged.text)
          const optionTokens = countTokens(para.text)
          if (questionTokens + optionTokens < maxTokens) {
            // Safe to merge
            questionInMerged.text += ' ' + para.text
            continue // Skip adding this paragraph separately
          } else {
            // Would exceed maxTokens - add form option as standalone paragraph
            merged.push({ ...para })
            continue
          }
        }
      }

      // Fallback: merge with previous non-empty paragraph in merged array
      if (merged.length > 0) {
        const prev = merged[merged.length - 1]
        if (prev && prev.text.trim().length > 0) {
          // Check if merging would exceed maxTokens
          const prevTokens = countTokens(prev.text)
          const optionTokens = countTokens(para.text)
          if (prevTokens + optionTokens < maxTokens) {
            // Safe to merge
            prev.text += ' ' + para.text
            continue
          } else {
            // Would exceed maxTokens - add as standalone
            merged.push({ ...para })
            continue
          }
        }
      }
    }

    // Regular paragraph (not a form option), add as-is
    merged.push({ ...para })
  }

  return merged
}

/**
 * Count tokens in text using character-based estimation
 * Industry standard: ~4 characters per token for English text
 * This is more accurate for legal text with punctuation, numbers, and special characters
 */
export function countTokens(text: string): number {
  return Math.ceil(text.trim().length / 4)
}

/**
 * Merge tiny paragraphs with adjacent paragraphs to create more substantial semantic units
 * Paragraphs with < minTokens are merged with their neighbors
 * IMPORTANT: Never creates paragraphs exceeding maxTokens to prevent oversized chunks
 */
export function mergeTinyParagraphs(paragraphs: Paragraph[], minTokens: number = 30, maxTokens: number = 500): Paragraph[] {
  if (paragraphs.length === 0) return []

  const merged: Paragraph[] = []
  let accumulated: Paragraph | null = null

  for (let i = 0; i < paragraphs.length; i++) {
    const para = paragraphs[i]
    if (!para) continue

    const tokens = countTokens(para.text)

    // If this paragraph is tiny, try to accumulate it
    if (tokens < minTokens) {
      if (accumulated) {
        // Check if merging with accumulated would exceed maxTokens
        const accumulatedTokens = countTokens(accumulated.text)
        if (accumulatedTokens + tokens < maxTokens) {
          // Safe to merge with accumulated text
          accumulated.text += ' ' + para.text
        } else {
          // Would exceed maxTokens, flush accumulated and start new
          merged.push(accumulated)
          accumulated = { ...para }
        }
      } else if (merged.length > 0) {
        // Check if merging with previous would exceed maxTokens
        const prev = merged[merged.length - 1]
        if (prev) {
          const prevTokens = countTokens(prev.text)
          if (prevTokens + tokens < maxTokens) {
            // Safe to merge with previous paragraph
            prev.text += ' ' + para.text
          } else {
            // Would exceed maxTokens, add as standalone
            merged.push({ ...para })
          }
        }
      } else {
        // First paragraph is tiny, start accumulating
        accumulated = { ...para }
      }
    } else {
      // This paragraph is substantial
      if (accumulated) {
        // Check if merging accumulated with this paragraph would exceed maxTokens
        const accumulatedTokens = countTokens(accumulated.text)
        if (accumulatedTokens + tokens < maxTokens) {
          // Safe to merge accumulated text with this paragraph
          merged.push({
            ...para,
            text: accumulated.text + ' ' + para.text
          })
        } else {
          // Would exceed maxTokens, add both separately
          merged.push(accumulated)
          merged.push({ ...para })
        }
        accumulated = null
      } else {
        // Add as-is
        merged.push({ ...para })
      }
    }
  }

  // Handle any remaining accumulated text
  if (accumulated && merged.length > 0) {
    const last = merged[merged.length - 1]
    if (last) {
      const lastTokens = countTokens(last.text)
      const accumulatedTokens = countTokens(accumulated.text)
      if (lastTokens + accumulatedTokens < maxTokens) {
        // Safe to merge
        last.text += ' ' + accumulated.text
      } else {
        // Would exceed maxTokens, add as standalone
        merged.push(accumulated)
      }
    }
  } else if (accumulated) {
    merged.push(accumulated)
  }

  return merged
}

/**
 * Detect if a paragraph ends mid-sentence (incomplete)
 * Signs of incomplete paragraphs:
 * - Doesn't end with sentence-ending punctuation
 * - Ends with article/preposition words (the, a, an, of, in, for, with, etc.)
 * - Next paragraph starts with lowercase (continuation)
 */
function isParagraphIncomplete(para: Paragraph, nextPara?: Paragraph): boolean {
  const text = para.text.trim()
  if (text.length === 0) return false

  const lastChar = text.slice(-1)

  // If ends with sentence-ending punctuation, it's complete
  if (['.', '!', '?', ';', ':', ')'].includes(lastChar)) {
    return false
  }

  // Check if ends with common incomplete patterns
  const last10Words = text.split(/\s+/).slice(-10).join(' ').toLowerCase()

  // Common words that indicate mid-sentence
  const incompletePatt = /(^|\s)(the|a|an|of|in|on|at|to|for|with|from|by|and|or|but|as|within|under|over|about|into|through|during|before|after|between|among)$/i

  if (incompletePatt.test(last10Words)) {
    return true
  }

  // If next paragraph starts with lowercase, likely a continuation
  if (nextPara && nextPara.text.trim().length > 0) {
    const nextFirstChar = nextPara.text.trim()[0]
    if (nextFirstChar && nextFirstChar === nextFirstChar?.toLowerCase() && /[a-z]/.test(nextFirstChar)) {
      return true
    }
  }

  return false
}

/**
 * Merge paragraphs that end mid-sentence with the following paragraph
 * This fixes Document AI's tendency to split paragraphs at page boundaries
 * IMPORTANT: Never creates paragraphs exceeding maxTokens to prevent oversized chunks
 */
export function mergeIncompleteParagraphs(paragraphs: Paragraph[], maxTokens: number = 500): Paragraph[] {
  if (paragraphs.length === 0) return []

  const merged: Paragraph[] = []

  for (let i = 0; i < paragraphs.length; i++) {
    const para = paragraphs[i]
    if (!para) continue

    const nextPara = paragraphs[i + 1]

    // If this paragraph is incomplete and there's a next one, try to merge them
    if (nextPara && isParagraphIncomplete(para, nextPara)) {
      // Check if merging would exceed maxTokens
      const currentTokens = countTokens(para.text)
      const nextTokens = countTokens(nextPara.text)

      if (currentTokens + nextTokens < maxTokens) {
        // Safe to merge current with next
        merged.push({
          ...para,
          text: para.text + ' ' + nextPara.text
        })
        i++ // Skip the next paragraph since we merged it
      } else {
        // Would exceed maxTokens - keep incomplete (better than oversized chunk)
        merged.push({ ...para })
      }
    } else {
      // Keep as-is
      merged.push({ ...para })
    }
  }

  return merged
}

/**
 * Split oversized paragraphs into smaller ones at sentence boundaries
 * This ensures no paragraph exceeds maxTokens, preventing oversized chunks
 */
export function splitOversizedParagraphs(paragraphs: Paragraph[], maxTokens: number = 500): Paragraph[] {
  const result: Paragraph[] = []

  for (const para of paragraphs) {
    const tokens = countTokens(para.text)

    if (tokens <= maxTokens) {
      // Paragraph is fine, add as-is
      result.push(para)
    } else {
      // Paragraph is too large, split at sentence boundaries
      const sentences = splitIntoSentences(para.text)

      let currentText = ''
      let currentTokens = 0

      for (const sentence of sentences) {
        const sentenceTokens = countTokens(sentence)

        // Check if adding this sentence would exceed maxTokens
        if (currentTokens > 0 && currentTokens + sentenceTokens >= maxTokens) {
          // Save current accumulated text as a paragraph
          if (currentText.trim()) {
            result.push({
              text: currentText.trim(),
              pageNumber: para.pageNumber,
              index: para.index
            })
          }
          // Start new paragraph with this sentence
          currentText = sentence
          currentTokens = sentenceTokens
        } else {
          // Add sentence to current paragraph
          currentText += (currentText ? ' ' : '') + sentence
          currentTokens += sentenceTokens
        }
      }

      // Add any remaining text
      if (currentText.trim()) {
        result.push({
          text: currentText.trim(),
          pageNumber: para.pageNumber,
          index: para.index
        })
      }
    }
  }

  return result
}

/**
 * Main chunking function: groups paragraphs into chunks using greedy algorithm
 *
 * Uses a simple greedy approach: keeps adding paragraphs to current chunk
 * until the next paragraph would exceed maxTokens. This guarantees:
 * - Zero overlap between chunks
 * - All chunks respect maxTokens limit
 * - Natural adaptation to paragraph sizes (1-N paragraphs per chunk)
 *
 * @param paragraphs - Array of paragraphs to chunk
 * @param maxTokens - Maximum tokens per chunk (hard limit)
 * @returns Array of chunks
 */
export function chunkByParagraphs(
  paragraphs: Paragraph[],
  maxTokens: number = 500
): Chunk[] {
  // Step 1: Remove footnotes FIRST
  let filtered = removeFootnotes(paragraphs)

  // Step 2: Merge form options with parent paragraphs BEFORE noise filtering
  // This preserves "Yes/No/N/A" options that would otherwise be filtered as noise
  filtered = mergeFormOptions(filtered, maxTokens)

  // Step 3: NOW filter out noise paragraphs (after form options are safely merged)
  filtered = filtered.filter(para => !isNoiseParagraph(para.text))

  // Step 4: Strip prefixes from each paragraph (A., 1., 2.2, etc.)
  filtered = filtered.map(para => ({
    ...para,
    text: stripPrefixes(para.text)
  }))

  // Step 5: Filter out empty paragraphs (after prefix stripping)
  filtered = filtered.filter(para => para.text.trim().length > 0)

  // Step 6: Merge incomplete paragraphs (mid-sentence cuts at page boundaries)
  filtered = mergeIncompleteParagraphs(filtered, maxTokens)

  // Step 7: Merge tiny paragraphs with neighbors to create substantial semantic units
  // Lower threshold to 20 and pass maxTokens to prevent creating oversized paragraphs
  filtered = mergeTinyParagraphs(filtered, 20, maxTokens)

  // Step 7.5: Split oversized paragraphs at sentence boundaries
  // This guarantees no paragraph ever exceeds maxTokens (final safety net)
  filtered = splitOversizedParagraphs(filtered, maxTokens)

  // Step 8: Group into chunks using simple greedy algorithm
  const chunks: Chunk[] = []
  let i = 0

  while (i < filtered.length) {
    const chunkParagraphs: Paragraph[] = []
    let chunkTokens = 0

    // Greedy: keep adding paragraphs while they fit
    while (i < filtered.length) {
      const para = filtered[i]
      if (!para) break

      const paraTokens = countTokens(para.text)

      // Always start a chunk with at least one paragraph
      if (chunkParagraphs.length === 0) {
        chunkParagraphs.push(para)
        chunkTokens = paraTokens
        i++
      }
      // Add more paragraphs if they fit under maxTokens
      else if (chunkTokens + paraTokens <= maxTokens) {
        chunkParagraphs.push(para)
        chunkTokens += paraTokens
        i++
      }
      // Next paragraph doesn't fit - finish this chunk
      else {
        break
      }
    }

    // Save the chunk
    if (chunkParagraphs.length > 0) {
      const chunkText = chunkParagraphs.map(p => p.text).join(' ')

      chunks.push({
        text: chunkText,
        pageNumber: chunkParagraphs[0]?.pageNumber ?? 1,
        chunkIndex: chunks.length,
        tokenCount: chunkTokens
      })
    }
  }

  return chunks.filter(chunk => chunk.text.trim().length > 0)
}
