#!/usr/bin/env tsx
/**
 * Test page range query logic
 * Simulates what happens when user searches specific page range
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

async function testPageRangeQuery() {
  const docId = '0200a4b1-fda7-46ac-b614-005d2b0bea6d'

  // User wants pages 15-16
  const searchStart = 15
  const searchEnd = 16

  console.log(`🔍 User searches: "pages ${searchStart}-${searchEnd}"\n`)

  // Our query logic (same as orchestrator.ts)
  const { data: results } = await supabase
    .from('document_embeddings')
    .select('chunk_index, start_page_number, end_page_number, chunk_text')
    .eq('document_id', docId)
    .or(
      `and(start_page_number.lte.${searchEnd},end_page_number.gte.${searchStart}),` +
      `and(start_page_number.is.null,page_number.gte.${searchStart},page_number.lte.${searchEnd})`
    )
    .order('chunk_index')

  if (!results || results.length === 0) {
    console.log('❌ No results found')
    return
  }

  console.log(`✅ Found ${results.length} chunks\n`)

  // Categorize results
  const exactMatch: typeof results = []
  const startsEarlier: typeof results = []
  const endsLater: typeof results = []

  for (const chunk of results) {
    const start = chunk.start_page_number!
    const end = chunk.end_page_number!

    if (start >= searchStart && end <= searchEnd) {
      exactMatch.push(chunk)
    } else if (start < searchStart && end >= searchStart) {
      startsEarlier.push(chunk)
    } else if (start <= searchEnd && end > searchEnd) {
      endsLater.push(chunk)
    }
  }

  console.log(`📊 Results breakdown:`)
  console.log(`   Entirely within 15-16: ${exactMatch.length}`)
  console.log(`   Starts before 15 (spans into range): ${startsEarlier.length}`)
  console.log(`   Ends after 16 (spans out of range): ${endsLater.length}\n`)

  if (startsEarlier.length > 0) {
    console.log(`🎯 Chunks starting earlier (captured automatically):`)
    for (const chunk of startsEarlier.slice(0, 3)) {
      const preview = chunk.chunk_text?.substring(0, 60).replace(/\n/g, ' ') || ''
      console.log(`   Chunk ${chunk.chunk_index}: pages ${chunk.start_page_number}-${chunk.end_page_number}`)
      console.log(`      "${preview}..."\n`)
    }
  }

  if (endsLater.length > 0) {
    console.log(`🎯 Chunks ending later (captured automatically):`)
    for (const chunk of endsLater.slice(0, 3)) {
      const preview = chunk.chunk_text?.substring(0, 60).replace(/\n/g, ' ') || ''
      console.log(`   Chunk ${chunk.chunk_index}: pages ${chunk.start_page_number}-${chunk.end_page_number}`)
      console.log(`      "${preview}..."\n`)
    }
  }

  console.log(`✨ Conclusion:`)
  console.log(`   User enters: "${searchStart}-${searchEnd}"`)
  console.log(`   System automatically finds: ${results.length} chunks`)
  console.log(`   Including content that spans outside the range`)
  console.log(`   ✅ No need for user to expand search range!`)
}

testPageRangeQuery().then(() => process.exit(0))
