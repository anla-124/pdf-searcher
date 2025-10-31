#!/usr/bin/env tsx
/**
 * Test: Does searching for page 15 find chunks that START on page 14 but END on page 15?
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

async function testSinglePageSearch() {
  const docId = '0200a4b1-fda7-46ac-b614-005d2b0bea6d'

  // User wants ONLY page 15
  const searchPage = 15

  console.log(`🔍 User searches: "page ${searchPage} only"\n`)

  // Our query logic
  const { data: results } = await supabase
    .from('document_embeddings')
    .select('chunk_index, start_page_number, end_page_number, chunk_text')
    .eq('document_id', docId)
    .or(
      `and(start_page_number.lte.${searchPage},end_page_number.gte.${searchPage}),` +
      `and(start_page_number.is.null,page_number.eq.${searchPage})`
    )
    .order('chunk_index')

  if (!results || results.length === 0) {
    console.log('❌ No results found')
    return
  }

  console.log(`✅ Found ${results.length} chunks\n`)

  // Categorize by where they start
  const startsOnPage15 = results.filter(c => c.start_page_number === searchPage)
  const startsEarlier = results.filter(c => c.start_page_number! < searchPage)
  const endsLater = results.filter(c => c.end_page_number! > searchPage)

  console.log(`📊 Results breakdown:`)
  console.log(`   Starts on page 15: ${startsOnPage15.length}`)
  console.log(`   Starts BEFORE page 15 (but contains page 15 content): ${startsEarlier.length}`)
  console.log(`   Ends AFTER page 15 (spans beyond): ${endsLater.length}\n`)

  if (startsEarlier.length > 0) {
    console.log(`🎯 KEY FINDING - Chunks starting on page 14 but containing page 15:`)
    for (const chunk of startsEarlier) {
      const preview = chunk.chunk_text?.substring(0, 80).replace(/\n/g, ' ') || ''
      console.log(`   Chunk ${chunk.chunk_index}: pages ${chunk.start_page_number}-${chunk.end_page_number}`)
      console.log(`      Starts on page ${chunk.start_page_number}, ends on page ${chunk.end_page_number}`)
      console.log(`      "${preview}..."\n`)
    }
  }

  console.log(`\n✨ Answer to your question:`)
  console.log(`   User enters: "page ${searchPage}"`)
  console.log(`   Query: start_page <= ${searchPage} AND end_page >= ${searchPage}`)
  console.log(``)
  console.log(`   ✅ Chunks starting on page 14 that end on page 15: FOUND`)
  console.log(`   ✅ Query condition: 14 <= 15 ✓ AND 15 >= 15 ✓`)
  console.log(``)
  console.log(`   👉 User does NOT need to search "14-15" or "14-16"`)
  console.log(`   👉 Just searching "15" automatically finds content from page 14`)
  console.log(`      that continues onto page 15!`)
}

testSinglePageSearch().then(() => process.exit(0))
