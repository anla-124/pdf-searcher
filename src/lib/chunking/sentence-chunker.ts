/**
 * Sentence-based chunking utility for semantic search optimization
 *
 * This module provides intelligent text chunking that:
 * - Splits on sentence boundaries (never mid-sentence)
 * - Strips prefixes (A., 1., 2.1, (i), etc.) for better similarity matching
 * - Removes footnotes (users don't care about them)
 * - Merges form options (Yes/No/N/A) with parent questions
 * - Groups 3-5 sentences per chunk with overlap
 */

/**
 * Remove footnote text from the document
 * Footnotes typically start with superscript numbers or regular numbers
 * followed by common legal footnote phrases
 */
export function removeFootnotes(text: string): string {
  // Split into paragraphs
  const paragraphs = text.split(/\n\n+/)

  // Filter out paragraphs that look like footnotes
  const filtered = paragraphs.filter(para => {
    const trimmed = para.trim()

    // Check if starts with superscript number + common footnote phrases
    if (/^[⁰¹²³⁴⁵⁶⁷⁸⁹]+\s+(For purposes|The SEC currently|This)/.test(trimmed)) {
      return false
    }

    // Check if starts with regular number + common footnote phrases
    if (/^[0-9]+\s+(For purposes|The SEC currently|This)/.test(trimmed)) {
      return false
    }

    return true
  })

  return filtered.join('\n\n')
}

/**
 * Strip structural prefixes from sentences
 * Removes: A., 1., 2.1, (i), (ii), etc.
 * Preserves: Statute refs like "Section 2510.3-101", "12 U.S.C. § 1813"
 */
export function stripPrefixes(sentence: string): string {
  let cleaned = sentence.trim()

  // Strip standalone numbers/letters on their own (like "1." or "2." or "A.")
  // This handles cases where OCR puts these on separate lines
  if (/^[A-H]\.\s*$/.test(cleaned)) return ''
  if (/^\d+\.\s*$/.test(cleaned)) return ''
  if (/^\d+\s*$/.test(cleaned)) return ''

  // Strip letter sections at start or after newlines: "A. STATUS MATTERS" → "STATUS MATTERS"
  cleaned = cleaned.replace(/^[A-H]\.\s*/gm, '')
  cleaned = cleaned.replace(/\n[A-H]\.\s*/g, '\n')

  // Strip numbers at start or after newlines: "2. Is the Investor" → "Is the Investor"
  cleaned = cleaned.replace(/^\d+\.\s*/gm, '')
  cleaned = cleaned.replace(/\n\d+\.\s*/g, '\n')

  // Strip sub-numbers: "2.1 Insurance Company" → "Insurance Company"
  cleaned = cleaned.replace(/^\d+\.\d+\.?\s*/gm, '')
  cleaned = cleaned.replace(/\n\d+\.\d+\.?\s*/g, '\n')

  // Strip roman numerals: "(ii) any company" → "any company"
  cleaned = cleaned.replace(/^\([ivxIVX]+\)\s*/gm, '')
  cleaned = cleaned.replace(/\n\([ivxIVX]+\)\s*/g, '\n')

  // Strip standalone page numbers at end
  cleaned = cleaned.replace(/\n\d+\s*$/g, '')

  // Strip orphaned numbers/letters in middle of text
  cleaned = cleaned.replace(/\n\d+\n/g, '\n')
  cleaned = cleaned.replace(/\n[A-H]\n/g, '\n')

  return cleaned.trim()
}

/**
 * Split text into sentences
 * Handles: periods, question marks, exclamation marks, semicolons in lists
 * Preserves: abbreviations, statute refs, section numbers
 */
export function splitIntoSentences(text: string): string[] {
  // First, protect common abbreviations by temporarily replacing periods
  let protectedText = text
    .replace(/U\.S\./g, 'U<DOT>S<DOT>')
    .replace(/U\.K\./g, 'U<DOT>K<DOT>')
    .replace(/vs\./g, 'vs<DOT>')
    .replace(/e\.g\./g, 'e<DOT>g<DOT>')
    .replace(/i\.e\./g, 'i<DOT>e<DOT>')
    .replace(/etc\./g, 'etc<DOT>')

  // Protect statute and section references
  // Pattern: "Section 2510.3-101" or "12 U.S.C. § 1813"
  protectedText = protectedText.replace(/(\d+)\s+U<DOT>S<DOT>C\.\s+§\s+(\d+)/g, '$1 U<DOT>S<DOT>C<DOT> § $2')
  protectedText = protectedText.replace(/Section\s+(\d+)\.(\d+)-(\d+)/g, 'Section $1<DOT>$2-$3')
  protectedText = protectedText.replace(/Section\s+(\d+)\.(\d+)\(([a-z])\)/g, 'Section $1<DOT>$2($3)')

  // Split on sentence boundaries:
  // 1. Period followed by space + capital letter or newline
  // 2. Question mark followed by space + capital letter or newline
  // 3. Exclamation mark followed by space + capital letter or newline
  // 4. Semicolon followed by newline or space + list marker like (i), (ii), and, or
  const sentences: string[] = []
  let current = ''

  for (let i = 0; i < protectedText.length; i++) {
    const char = protectedText[i]
    const next = protectedText[i + 1]
    const nextTwo = protectedText.substring(i + 1, i + 3)
    const nextFour = protectedText.substring(i + 1, i + 5)

    current += char

    // Check for sentence boundaries
    if (char === '.' || char === '?' || char === '!') {
      // Look ahead for space + capital letter or newline
      if (next === ' ' && nextTwo && nextTwo.length > 1 && /[A-Z(]/.test(nextTwo.charAt(1))) {
        sentences.push(current.trim())
        current = ''
        i++ // Skip the space
      } else if (next === '\n' || !next) {
        sentences.push(current.trim())
        current = ''
      }
    } else if (char === ';') {
      // Semicolon can end a sentence in legal lists like "(i) text; (ii) text;"
      // Check if followed by newline or space + list marker
      if (next === '\n' || (next === ' ' && nextFour && /^\s*(\(|and |or )/.test(nextFour))) {
        sentences.push(current.trim())
        current = ''
        if (next === ' ') i++ // Skip the space
      }
    }
  }

  // Add any remaining text
  if (current.trim()) {
    sentences.push(current.trim())
  }

  // Restore protected periods
  return sentences.map(s => s
    .replace(/<DOT>/g, '.')
  ).filter(s => s.length > 0)
}

/**
 * Detect if a sentence is a standalone form option line
 * Examples: "Yes No", "N/A", "____%"
 */
function isFormOption(sentence: string): boolean {
  const trimmed = sentence.trim()

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

  // Check for standalone number fields
  if (/^\s*\[\s*\]\s*$/.test(trimmed)) {
    return true
  }

  return false
}

/**
 * Merge form option sentences with their parent question
 * Example: ["Is the Investor X?", "Yes No"] → ["Is the Investor X? Yes No"]
 */
export function mergeFormOptions(sentences: string[]): string[] {
  const merged: string[] = []

  for (let i = 0; i < sentences.length; i++) {
    const sentence = sentences[i]
    if (!sentence) continue // Skip undefined entries

    if (isFormOption(sentence) && merged.length > 0) {
      // Merge with previous sentence
      merged[merged.length - 1] += ' ' + sentence
    } else {
      merged.push(sentence)
    }
  }

  return merged
}

/**
 * Count characters in text
 * Returns the actual character count for accurate content volume measurement
 */
export function countCharacters(text: string): number {
  return text.trim().length
}

/**
 * Main chunking function: groups sentences into chunks
 *
 * @param text - Full text to chunk
 * @param targetSentences - Target number of sentences per chunk (default: 4)
 * @param overlapSentences - Number of sentences to overlap (default: 1)
 * @param minCharacters - Minimum characters per chunk (default: 400)
 * @param maxCharacters - Maximum characters per chunk (default: 2000)
 * @returns Array of text chunks
 */
export function chunkBySentences(
  text: string,
  targetSentences: number = 4,
  overlapSentences: number = 1,
  minCharacters: number = 400,
  maxCharacters: number = 2000
): string[] {
  // Step 1: Remove footnotes
  const withoutFootnotes = removeFootnotes(text)

  // Step 2: Split into sentences
  let sentences = splitIntoSentences(withoutFootnotes)

  // Step 3: Strip prefixes from each sentence
  sentences = sentences.map(s => stripPrefixes(s))

  // Step 3.5: Filter out empty sentences (standalone prefixes that were stripped)
  sentences = sentences.filter(s => s.trim().length > 0)

  // Step 4: Merge form options with parent sentences
  sentences = mergeFormOptions(sentences)

  // Step 5: Group into chunks
  const chunks: string[] = []
  let i = 0

  while (i < sentences.length) {
    const chunkSentences: string[] = []
    let chunkChars = 0
    let sentenceCount = 0

    // Accumulate sentences for this chunk
    while (i + sentenceCount < sentences.length && sentenceCount < targetSentences) {
      const sentence = sentences[i + sentenceCount]
      if (!sentence) break // Stop if we hit undefined

      const sentenceChars = countCharacters(sentence)

      // Check if adding this sentence would exceed max characters
      if (chunkChars + sentenceChars > maxCharacters && chunkSentences.length >= 2) {
        // Already have at least 2 sentences, stop here
        break
      }

      chunkSentences.push(sentence)
      chunkChars += sentenceChars
      sentenceCount++

      // If we've hit min characters and target sentences, we can stop
      if (chunkChars >= minCharacters && sentenceCount >= targetSentences) {
        break
      }
    }

    // If chunk is below min characters and we have more sentences, try to add one more
    while (chunkChars < minCharacters && i + sentenceCount < sentences.length) {
      const sentence = sentences[i + sentenceCount]
      if (!sentence) break // Stop if we hit undefined

      const sentenceChars = countCharacters(sentence)

      // Don't exceed max characters
      if (chunkChars + sentenceChars > maxCharacters) {
        break
      }

      chunkSentences.push(sentence)
      chunkChars += sentenceChars
      sentenceCount++
    }

    // Create the chunk
    if (chunkSentences.length > 0) {
      chunks.push(chunkSentences.join(' '))
    }

    // Move forward, accounting for overlap
    // If we have overlap, start next chunk from (current_position + sentences - overlap)
    i += Math.max(1, sentenceCount - overlapSentences)
  }

  return chunks.filter(chunk => chunk.trim().length > 0)
}
