#!/usr/bin/env node

/**
 * Check for duplicate chunk indices
 */

require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

const supabase = createClient(supabaseUrl, supabaseServiceKey)

async function checkDuplicates() {
  try {
    const { data: docs, error } = await supabase
      .from('documents')
      .select('id, title')
      .ilike('title', 'Test Doc (30pg)%')
      .single()

    if (error || !docs) {
      console.error('Document not found')
      return
    }

    console.log(`📄 ${docs.title}\n`)

    // Get all chunks with their indices
    const { data: chunks, error: chunkError } = await supabase
      .from('document_embeddings')
      .select('chunk_index, page_number, chunk_text')
      .eq('document_id', docs.id)
      .order('chunk_index')

    if (chunkError || !chunks) {
      console.error('Error fetching chunks:', chunkError)
      return
    }

    console.log(`Total chunks in DB: ${chunks.length}`)

    // Count occurrences of each chunk_index
    const indexCounts = {}
    chunks.forEach(c => {
      indexCounts[c.chunk_index] = (indexCounts[c.chunk_index] || 0) + 1
    })

    const uniqueIndices = Object.keys(indexCounts).length
    console.log(`Unique chunk indices: ${uniqueIndices}`)
    console.log(`Index range: ${Math.min(...Object.keys(indexCounts).map(Number))} - ${Math.max(...Object.keys(indexCounts).map(Number))}`)

    // Find duplicates
    const duplicates = Object.entries(indexCounts)
      .filter(([idx, count]) => count > 1)
      .sort((a, b) => b[1] - a[1])

    if (duplicates.length > 0) {
      console.log(`\n⚠️  Found ${duplicates.length} indices with duplicates!`)
      console.log(`\nTop 10 most duplicated:`)
      duplicates.slice(0, 10).forEach(([idx, count]) => {
        console.log(`   Index ${idx}: ${count} copies`)
      })

      // Check if all indices have same number of copies
      const counts = duplicates.map(([_, count]) => count)
      const allSame = counts.every(c => c === counts[0])

      if (allSame) {
        console.log(`\n✓ All duplicate indices have ${counts[0]} copies each`)
        console.log(`  Pattern: Each chunk appears ${counts[0]}x`)
      }

      // Sample first duplicate
      const firstDupIdx = parseInt(duplicates[0][0])
      const dupChunks = chunks.filter(c => c.chunk_index === firstDupIdx)

      console.log(`\n📝 Example: Chunk index ${firstDupIdx} (${dupChunks.length} copies):`)
      dupChunks.forEach((c, i) => {
        const preview = c.chunk_text.substring(0, 60).replace(/\n/g, ' ')
        console.log(`   Copy ${i + 1}: Page ${c.page_number}, "${preview}..."`)
      })
    } else {
      console.log('\n✓ No duplicate indices found')
    }

  } catch (error) {
    console.error('Error:', error)
  }
}

checkDuplicates()
