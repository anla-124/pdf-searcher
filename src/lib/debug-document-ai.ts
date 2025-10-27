/**
 * Debug utility for capturing and analyzing raw Document AI responses
 * Use this to understand the full structure of what Document AI returns
 */

import fs from 'fs/promises'
import path from 'path'
import { DocumentAIDocument } from '@/types/external-apis'
import { logger } from '@/lib/logger'

const DEBUG_OUTPUT_DIR = path.join(process.cwd(), 'document-ai-debug')

/**
 * Save raw Document AI response to a JSON file for inspection
 * Files are saved to /document-ai-debug/<documentId>-<timestamp>.json
 */
export async function saveDocumentAIResponse(
  documentId: string,
  documentAIResult: DocumentAIDocument,
  metadata?: {
    filename?: string
    fileSize?: number
    pageCount?: number
    processor?: string
  }
): Promise<string> {
  try {
    // Ensure debug directory exists
    await fs.mkdir(DEBUG_OUTPUT_DIR, { recursive: true })

    // Create filename with timestamp
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const outputFilename = `${documentId}-${timestamp}.json`
    const outputPath = path.join(DEBUG_OUTPUT_DIR, outputFilename)

    // Calculate stats
    const stats = {
      totalPages: documentAIResult.pages?.length || 0,
      totalText: documentAIResult.text?.length || 0,
      hasEntities: (documentAIResult.entities?.length || 0) > 0,
      entityCount: documentAIResult.entities?.length || 0,
      hasTables: documentAIResult.pages?.some(p => p.tables && p.tables.length > 0) || false,
      tableCount: documentAIResult.pages?.reduce((sum, p) => sum + (p.tables?.length || 0), 0) || 0,
      hasBlocks: documentAIResult.pages?.some(p => p.blocks && p.blocks.length > 0) || false,
      blockCount: documentAIResult.pages?.reduce((sum, p) => sum + (p.blocks?.length || 0), 0) || 0,
      hasParagraphs: documentAIResult.pages?.some(p => p.paragraphs && p.paragraphs.length > 0) || false,
      paragraphCount: documentAIResult.pages?.reduce((sum, p) => sum + (p.paragraphs?.length || 0), 0) || 0,
      hasFormFields: documentAIResult.pages?.some(p => p.formFields && p.formFields.length > 0) || false,
      formFieldCount: documentAIResult.pages?.reduce((sum, p) => sum + (p.formFields?.length || 0), 0) || 0,
      hasDocumentLayout: !!documentAIResult.documentLayout,
      documentLayoutBlockCount: documentAIResult.documentLayout?.blocks?.length || 0,
    }

    // Prepare output data with metadata and full Document AI response
    const debugData = {
      metadata: {
        documentId,
        capturedAt: new Date().toISOString(),
        filename: metadata?.filename,
        fileSize: metadata?.fileSize,
        pageCount: metadata?.pageCount,
        processor: metadata?.processor,
      },
      stats,
      documentAIResponse: documentAIResult,

      // Sample data for quick inspection (first page only)
      samples: {
        firstPageBlocks: documentAIResult.pages?.[0]?.blocks?.slice(0, 3) || [],
        firstPageParagraphs: documentAIResult.pages?.[0]?.paragraphs?.slice(0, 3) || [],
        firstPageLines: documentAIResult.pages?.[0]?.lines?.slice(0, 5) || [],
        firstPageTokens: documentAIResult.pages?.[0]?.tokens?.slice(0, 10) || [],
        entities: documentAIResult.entities?.slice(0, 10) || [],
        tables: documentAIResult.pages?.[0]?.tables?.[0] || null,
      }
    }

    // Write to file with pretty formatting
    await fs.writeFile(outputPath, JSON.stringify(debugData, null, 2), 'utf-8')

    // Log to console
    logger.info('Document AI raw output saved for analysis', {
      documentId,
      outputPath,
      stats,
      component: 'debug-document-ai'
    })

    /* eslint-disable no-console */
    console.log(`\n${'='.repeat(80)}`)
    console.log(`📝 Document AI Response Saved for Analysis`)
    console.log(`${'='.repeat(80)}`)
    console.log(`File: ${outputPath}`)
    console.log(`\nQuick Stats:`)
    console.log(`  - Pages: ${stats.totalPages}`)
    console.log(`  - Text Length: ${stats.totalText} characters`)
    console.log(`  - Entities: ${stats.entityCount}`)
    console.log(`  - Tables: ${stats.tableCount}`)
    console.log(`  - Blocks: ${stats.blockCount}`)
    console.log(`  - Paragraphs: ${stats.paragraphCount}`)
    console.log(`  - Form Fields: ${stats.formFieldCount}`)
    console.log(`  - Document Layout Blocks: ${stats.documentLayoutBlockCount}`)
    console.log(`${'='.repeat(80)}\n`)
    /* eslint-enable no-console */

    return outputPath
  } catch (error) {
    logger.error('Failed to save Document AI response', error as Error, {
      documentId,
      component: 'debug-document-ai'
    })
    // Don't throw - we don't want to fail document processing if debug saving fails
    return ''
  }
}

/**
 * Generate a human-readable analysis report from Document AI response
 */
export function analyzeDocumentAIStructure(doc: DocumentAIDocument): string {
  const lines: string[] = []

  lines.push('='.repeat(80))
  lines.push('DOCUMENT AI STRUCTURE ANALYSIS')
  lines.push('='.repeat(80))
  lines.push('')

  // Overall document info
  lines.push('📄 DOCUMENT LEVEL:')
  lines.push(`  - MIME Type: ${doc.mimeType || 'N/A'}`)
  lines.push(`  - Total Text Length: ${doc.text?.length || 0} characters`)
  lines.push(`  - Pages: ${doc.pages?.length || 0}`)
  lines.push(`  - Entities: ${doc.entities?.length || 0}`)
  lines.push(`  - Entity Relations: ${doc.entityRelations?.length || 0}`)
  lines.push(`  - Has Document Layout: ${!!doc.documentLayout}`)
  lines.push('')

  // Document Layout (hierarchical structure)
  if (doc.documentLayout?.blocks) {
    lines.push('📐 DOCUMENT LAYOUT (Hierarchical Structure):')
    lines.push(`  - Total Layout Blocks: ${doc.documentLayout.blocks.length}`)
    let textBlocks = 0, tableBlocks = 0, listBlocks = 0
    doc.documentLayout.blocks.forEach(block => {
      if (block.textBlock) textBlocks++
      if (block.tableBlock) tableBlocks++
      if (block.listBlock) listBlocks++
    })
    lines.push(`    • Text Blocks: ${textBlocks}`)
    lines.push(`    • Table Blocks: ${tableBlocks}`)
    lines.push(`    • List Blocks: ${listBlocks}`)
    lines.push('')
  }

  // Per-page analysis
  if (doc.pages && doc.pages.length > 0) {
    lines.push('📑 PAGE-LEVEL STRUCTURE:')
    doc.pages.forEach((page, idx) => {
      lines.push(`\n  Page ${idx + 1}:`)
      lines.push(`    - Blocks: ${page.blocks?.length || 0}`)
      lines.push(`    - Paragraphs: ${page.paragraphs?.length || 0}`)
      lines.push(`    - Lines: ${page.lines?.length || 0}`)
      lines.push(`    - Tokens: ${page.tokens?.length || 0}`)
      lines.push(`    - Tables: ${page.tables?.length || 0}`)
      lines.push(`    - Form Fields: ${page.formFields?.length || 0}`)
      lines.push(`    - Visual Elements: ${page.visualElements?.length || 0}`)
      lines.push(`    - Barcodes: ${page.detectedBarcodes?.length || 0}`)

      // Show dimensions if available
      if (page.dimension) {
        lines.push(`    - Dimensions: ${page.dimension.width} x ${page.dimension.height} ${page.dimension.unit || ''}`)
      }

      // Show confidence for detected languages
      if (page.detectedLanguages && page.detectedLanguages.length > 0) {
        const langs = page.detectedLanguages.map(l => `${l.languageCode} (${((l.confidence || 0) * 100).toFixed(1)}%)`).join(', ')
        lines.push(`    - Languages: ${langs}`)
      }
    })
    lines.push('')
  }

  // Entity analysis
  if (doc.entities && doc.entities.length > 0) {
    lines.push('🏷️  ENTITIES EXTRACTED:')
    const entityTypes = new Map<string, number>()
    doc.entities.forEach(entity => {
      const type = entity.type || 'unknown'
      entityTypes.set(type, (entityTypes.get(type) || 0) + 1)
    })
    entityTypes.forEach((count, type) => {
      lines.push(`    - ${type}: ${count}`)
    })
    lines.push('')

    // Show first 5 entities as examples
    lines.push('  Examples (first 5):')
    doc.entities.slice(0, 5).forEach(entity => {
      lines.push(`    • Type: ${entity.type}`)
      lines.push(`      Value: ${entity.mentionText}`)
      lines.push(`      Confidence: ${entity.confidence ? (entity.confidence * 100).toFixed(1) : 'N/A'}%`)
      if (entity.normalizedValue) {
        lines.push(`      Normalized: ${JSON.stringify(entity.normalizedValue).substring(0, 100)}`)
      }
    })
    lines.push('')
  }

  // Table analysis
  const totalTables = doc.pages?.reduce((sum, p) => sum + (p.tables?.length || 0), 0) || 0
  if (totalTables > 0) {
    lines.push('📊 TABLES:')
    lines.push(`  - Total Tables: ${totalTables}`)
    doc.pages?.forEach((page, pageIdx) => {
      page.tables?.forEach((table, tableIdx) => {
        lines.push(`\n  Page ${pageIdx + 1}, Table ${tableIdx + 1}:`)
        lines.push(`    - Header Rows: ${table.headerRows?.length || 0}`)
        lines.push(`    - Body Rows: ${table.bodyRows?.length || 0}`)
        if (table.headerRows && table.headerRows.length > 0) {
          const cols = table.headerRows[0]?.cells?.length || 0
          lines.push(`    - Columns: ${cols}`)
        }
      })
    })
    lines.push('')
  }

  lines.push('='.repeat(80))

  return lines.join('\n')
}
