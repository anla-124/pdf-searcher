#!/usr/bin/env tsx
/**
 * Diagnose potential page assignment issues
 * Checks if chunks have suspicious page number patterns
 */

/* eslint-disable no-console */

import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import { resolve } from 'path'

config({ path: resolve(process.cwd(), '.env.local') })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function diagnose() {
  const docId = process.argv[2] || '0200a4b1-fda7-46ac-b614-005d2b0bea6d'

  const { data: chunks } = await supabase
    .from('document_embeddings')
    .select('chunk_index, start_page_number, end_page_number')
    .eq('document_id', docId)
    .order('chunk_index')

  if (!chunks) {
    console.error('No chunks found')
    return
  }

  console.log(`Analyzing ${chunks.length} chunks...\n`)

  // Check for suspicious patterns
  let allPageOne = 0
  let sequentialIssues = 0

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i]!
    const prevChunk = i > 0 ? chunks[i - 1] : null

    if (chunk.start_page_number === 1 && chunk.end_page_number === 1 && i > 10) {
      allPageOne++
    }

    // Check if chunks progress logically
    if (prevChunk && chunk.start_page_number && prevChunk.end_page_number) {
      if (chunk.start_page_number < prevChunk.end_page_number - 1) {
        sequentialIssues++
        if (sequentialIssues <= 5) {
          console.log(`⚠️  Chunk ${i}: pages ${chunk.start_page_number}-${chunk.end_page_number} comes after chunk ${i-1}: pages ${prevChunk.start_page_number}-${prevChunk.end_page_number}`)
        }
      }
    }
  }

  console.log(`\nSuspicious patterns:`)
  console.log(`  Chunks stuck on page 1 (after chunk 10): ${allPageOne}`)
  console.log(`  Sequential order issues: ${sequentialIssues}`)

  // Show first 10 and last 10
  console.log(`\nFirst 10 chunks:`)
  for (let i = 0; i < Math.min(10, chunks.length); i++) {
    const c = chunks[i]!
    console.log(`  Chunk ${i}: pages ${c.start_page_number}-${c.end_page_number}`)
  }

  console.log(`\nLast 10 chunks:`)
  for (let i = Math.max(0, chunks.length - 10); i < chunks.length; i++) {
    const c = chunks[i]!
    console.log(`  Chunk ${i}: pages ${c.start_page_number}-${c.end_page_number}`)
  }
}

diagnose().then(() => process.exit(0))
