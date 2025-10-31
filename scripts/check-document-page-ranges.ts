#!/usr/bin/env tsx
/**
 * Check Page Ranges for a Specific Document
 *
 * Usage:
 *   npx tsx scripts/check-document-page-ranges.ts <document-id>
 *   or
 *   npx tsx scripts/check-document-page-ranges.ts  (will show latest document)
 */

/* eslint-disable no-console */

import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import { resolve } from 'path'

// Load environment variables
const envPath = resolve(process.cwd(), '.env.local')
try {
  config({ path: envPath })
} catch {
  config({ path: resolve(process.cwd(), '.env') })
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Missing environment variables')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseServiceKey)

async function checkDocumentPageRanges(documentId?: string) {
  try {
    let docId = documentId

    // If no document ID provided, get the most recent one
    if (!docId) {
      console.log('📄 No document ID provided, fetching most recent document...\n')

      const { data: latestDoc } = await supabase
        .from('documents')
        .select('id, title, filename, page_count, created_at')
        .eq('status', 'completed')
        .order('created_at', { ascending: false })
        .limit(1)
        .single()

      if (!latestDoc) {
        console.error('❌ No completed documents found')
        process.exit(1)
      }

      docId = latestDoc.id
      console.log(`📄 Most recent document:`)
      console.log(`   ID: ${latestDoc.id}`)
      console.log(`   Title: ${latestDoc.title}`)
      console.log(`   Filename: ${latestDoc.filename}`)
      console.log(`   Pages: ${latestDoc.page_count}`)
      console.log(`   Uploaded: ${new Date(latestDoc.created_at).toLocaleString()}\n`)
    } else {
      // Fetch document info
      const { data: doc } = await supabase
        .from('documents')
        .select('id, title, filename, page_count, status, created_at')
        .eq('id', docId)
        .single()

      if (!doc) {
        console.error(`❌ Document not found: ${docId}`)
        process.exit(1)
      }

      console.log(`📄 Document:`)
      console.log(`   ID: ${doc.id}`)
      console.log(`   Title: ${doc.title}`)
      console.log(`   Filename: ${doc.filename}`)
      console.log(`   Pages: ${doc.page_count}`)
      console.log(`   Status: ${doc.status}`)
      console.log(`   Uploaded: ${new Date(doc.created_at).toLocaleString()}\n`)
    }

    // Fetch all chunks for this document
    console.log('🔍 Analyzing chunks...\n')

    const { data: chunks, error } = await supabase
      .from('document_embeddings')
      .select('chunk_index, page_number, start_page_number, end_page_number, chunk_text')
      .eq('document_id', docId)
      .order('chunk_index', { ascending: true })

    if (error) {
      console.error('❌ Error fetching chunks:', error)
      process.exit(1)
    }

    if (!chunks || chunks.length === 0) {
      console.log('⚠️  No chunks found for this document')
      process.exit(0)
    }

    console.log(`✓ Total chunks: ${chunks.length}\n`)

    // Analyze page range data
    let hasPageRange = 0
    let missingPageRange = 0
    let multiPageChunks = 0
    const pageSpanCounts: Record<number, number> = {}
    let maxSpan = 1

    for (const chunk of chunks) {
      if (chunk.start_page_number !== null && chunk.end_page_number !== null) {
        hasPageRange++
        const span = chunk.end_page_number - chunk.start_page_number + 1
        pageSpanCounts[span] = (pageSpanCounts[span] || 0) + 1
        maxSpan = Math.max(maxSpan, span)

        if (span > 1) {
          multiPageChunks++
        }
      } else {
        missingPageRange++
      }
    }

    // Display summary
    console.log('📊 Summary:')
    console.log(`   Chunks with page range: ${hasPageRange} / ${chunks.length} (${Math.round((hasPageRange / chunks.length) * 100)}%)`)
    console.log(`   Chunks missing page range: ${missingPageRange}`)
    console.log(`   Multi-page chunks: ${multiPageChunks}`)
    console.log(`   Max page span: ${maxSpan} page${maxSpan > 1 ? 's' : ''}\n`)

    if (missingPageRange > 0) {
      console.log('⚠️  Some chunks are missing page range data!')
      console.log('   This may be an older document. Try uploading a new one.\n')
    }

    // Display page span distribution
    if (hasPageRange > 0) {
      console.log('📈 Page Span Distribution:')
      for (let span = 1; span <= Math.min(maxSpan, 10); span++) {
        const count = pageSpanCounts[span] || 0
        if (count > 0) {
          const pct = ((count / hasPageRange) * 100).toFixed(1)
          const bar = '█'.repeat(Math.min(50, Math.round((count / hasPageRange) * 50)))
          console.log(`   ${span} page${span > 1 ? 's' : ' '}: ${count.toString().padStart(4)} chunks (${pct.padStart(5)}%) ${bar}`)
        }
      }
      if (maxSpan > 10) {
        const largeCount = Object.entries(pageSpanCounts)
          .filter(([span]) => parseInt(span) > 10)
          .reduce((sum, [, count]) => sum + count, 0)
        if (largeCount > 0) {
          const pct = ((largeCount / hasPageRange) * 100).toFixed(1)
          console.log(`   11+ pages: ${largeCount.toString().padStart(4)} chunks (${pct.padStart(5)}%)`)
        }
      }
      console.log()
    }

    // Show examples of multi-page chunks
    if (multiPageChunks > 0) {
      console.log('✨ Multi-page Chunks (showing first 5):')
      const multiPage = chunks
        .filter(c => c.start_page_number && c.end_page_number && c.end_page_number > c.start_page_number)
        .slice(0, 5)

      for (const chunk of multiPage) {
        const span = chunk.end_page_number! - chunk.start_page_number! + 1
        const preview = chunk.chunk_text?.substring(0, 80).replace(/\n/g, ' ') || 'N/A'
        console.log(`   Chunk ${chunk.chunk_index}: Pages ${chunk.start_page_number}-${chunk.end_page_number} (${span} pages)`)
        console.log(`      "${preview}..."\n`)
      }
    } else if (hasPageRange > 0) {
      console.log('ℹ️  No multi-page chunks found.')
      console.log('   This is normal for documents with:')
      console.log('   - Short paragraphs that fit on one page')
      console.log('   - Clean page breaks between sections')
      console.log('   - Structured content (tables, lists)\n')
    }

    // Show chunk distribution by page
    console.log('📖 Chunks per Page:')
    const chunksPerPage: Record<number, number> = {}
    for (const chunk of chunks) {
      if (chunk.start_page_number && chunk.end_page_number) {
        // Count this chunk for all pages it spans
        for (let p = chunk.start_page_number; p <= chunk.end_page_number; p++) {
          chunksPerPage[p] = (chunksPerPage[p] || 0) + 1
        }
      } else if (chunk.page_number) {
        // Fallback to page_number
        chunksPerPage[chunk.page_number] = (chunksPerPage[chunk.page_number] || 0) + 1
      }
    }

    const pages = Object.keys(chunksPerPage).map(Number).sort((a, b) => a - b)
    if (pages.length > 0) {
      const maxPage = Math.max(...pages)
      const displayPages = Math.min(maxPage, 10)

      for (let p = 1; p <= displayPages; p++) {
        const count = chunksPerPage[p] || 0
        const bar = '▓'.repeat(Math.min(30, count * 2))
        console.log(`   Page ${p.toString().padStart(2)}: ${count.toString().padStart(2)} chunks ${bar}`)
      }

      if (maxPage > 10) {
        console.log(`   ... (${maxPage - 10} more pages)`)
      }
    }

    console.log('\n✅ Analysis complete!')

  } catch (error) {
    console.error('\n❌ Error:', error)
    process.exit(1)
  }
}

// Get document ID from command line args
const documentId = process.argv[2]

checkDocumentPageRanges(documentId)
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Fatal error:', error)
    process.exit(1)
  })
