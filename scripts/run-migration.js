#!/usr/bin/env node

/**
 * Run the chunk count mismatch migration
 */

require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')
const fs = require('fs')
const path = require('path')

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Missing Supabase credentials')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseServiceKey)

async function runMigration() {
  console.log('🚀 Starting chunk count mismatch migration...\n')

  try {
    // Step 1: Get pre-cleanup stats
    console.log('📊 STEP 1: Gathering pre-cleanup statistics...\n')

    const { data: preStats, error: preError } = await supabase.rpc('run_sql', {
      query: `
        SELECT
          d.title,
          d.effective_chunk_count as stored_count,
          COUNT(*) as total_rows,
          COUNT(DISTINCT de.chunk_index) as unique_chunks,
          COUNT(*) - COUNT(DISTINCT de.chunk_index) as duplicates
        FROM documents d
        LEFT JOIN document_embeddings de ON d.id = de.document_id
        WHERE d.title LIKE 'Test Doc%'
        GROUP BY d.id, d.title, d.effective_chunk_count
        ORDER BY d.title
      `
    })

    // Fallback: Run query directly if rpc doesn't work
    const { data: docs, error: docsError } = await supabase
      .from('documents')
      .select('id, title, effective_chunk_count')
      .ilike('title', 'Test Doc%')

    if (docs) {
      console.log('PRE-CLEANUP STATISTICS:')
      console.log('─'.repeat(80))

      for (const doc of docs) {
        const { count: totalRows } = await supabase
          .from('document_embeddings')
          .select('*', { count: 'exact', head: true })
          .eq('document_id', doc.id)

        const { data: chunks } = await supabase
          .from('document_embeddings')
          .select('chunk_index')
          .eq('document_id', doc.id)

        const uniqueChunks = new Set(chunks?.map(c => c.chunk_index) || []).size
        const duplicates = totalRows - uniqueChunks

        console.log(`${doc.title}:`)
        console.log(`  Stored Count: ${doc.effective_chunk_count}`)
        console.log(`  DB Rows: ${totalRows}`)
        console.log(`  Unique Chunks: ${uniqueChunks}`)
        console.log(`  Duplicates: ${duplicates}`)
        console.log()
      }
    }

    // Step 2: Remove duplicates
    console.log('🧹 STEP 2: Removing duplicate chunks...\n')

    // Get all chunks with duplicates
    const { data: allChunks } = await supabase
      .from('document_embeddings')
      .select('id, document_id, chunk_index')
      .order('document_id')
      .order('chunk_index')
      .order('id')

    if (!allChunks) {
      console.log('No chunks found')
      return
    }

    // Group by (document_id, chunk_index) and keep only first ID
    const seen = new Map()
    const idsToDelete = []

    for (const chunk of allChunks) {
      const key = `${chunk.document_id}_${chunk.chunk_index}`
      if (seen.has(key)) {
        // This is a duplicate - mark for deletion
        idsToDelete.push(chunk.id)
      } else {
        // First occurrence - keep it
        seen.set(key, chunk.id)
      }
    }

    if (idsToDelete.length > 0) {
      console.log(`Found ${idsToDelete.length} duplicate chunks to delete`)

      // Delete in batches of 1000
      const batchSize = 1000
      for (let i = 0; i < idsToDelete.length; i += batchSize) {
        const batch = idsToDelete.slice(i, i + batchSize)
        const { error: deleteError } = await supabase
          .from('document_embeddings')
          .delete()
          .in('id', batch)

        if (deleteError) {
          console.error(`Error deleting batch: ${deleteError.message}`)
        } else {
          console.log(`  Deleted batch ${Math.floor(i / batchSize) + 1} (${batch.length} rows)`)
        }
      }

      console.log(`✅ Deleted ${idsToDelete.length} duplicate chunks\n`)
    } else {
      console.log('✅ No duplicates found\n')
    }

    // Step 3: Update effective_chunk_count
    console.log('🔄 STEP 3: Updating effective_chunk_count...\n')

    const { data: docsToUpdate } = await supabase
      .from('documents')
      .select('id, title')

    let updatedCount = 0

    if (docsToUpdate) {
      for (const doc of docsToUpdate) {
        const { data: chunks } = await supabase
          .from('document_embeddings')
          .select('chunk_index')
          .eq('document_id', doc.id)

        const actualCount = new Set(chunks?.map(c => c.chunk_index) || []).size

        const { error: updateError } = await supabase
          .from('documents')
          .update({ effective_chunk_count: actualCount })
          .eq('id', doc.id)

        if (!updateError) {
          updatedCount++
          console.log(`  Updated ${doc.title}: ${actualCount} chunks`)
        }
      }
    }

    console.log(`\n✅ Updated effective_chunk_count for ${updatedCount} documents\n`)

    // Step 4: Verify results
    console.log('✅ STEP 4: Post-cleanup verification...\n')
    console.log('POST-CLEANUP STATISTICS:')
    console.log('─'.repeat(80))

    const { data: postDocs } = await supabase
      .from('documents')
      .select('id, title, effective_chunk_count')
      .ilike('title', 'Test Doc%')

    if (postDocs) {
      for (const doc of postDocs) {
        const { count: totalRows } = await supabase
          .from('document_embeddings')
          .select('*', { count: 'exact', head: true })
          .eq('document_id', doc.id)

        const { data: chunks } = await supabase
          .from('document_embeddings')
          .select('chunk_index')
          .eq('document_id', doc.id)

        const uniqueChunks = new Set(chunks?.map(c => c.chunk_index) || []).size
        const match = doc.effective_chunk_count === uniqueChunks

        console.log(`${doc.title}:`)
        console.log(`  Stored Count: ${doc.effective_chunk_count}`)
        console.log(`  DB Rows: ${totalRows}`)
        console.log(`  Unique Chunks: ${uniqueChunks}`)
        console.log(`  Status: ${match ? '✅ MATCH' : '❌ MISMATCH'}`)
        console.log()
      }
    }

    console.log('═'.repeat(80))
    console.log('✅ MIGRATION COMPLETED SUCCESSFULLY!')
    console.log('═'.repeat(80))
    console.log()
    console.log('Next steps:')
    console.log('1. Run: node scripts/check-chunk-counts.js')
    console.log('2. Test similarity search (should show ~50%)')
    console.log()

  } catch (error) {
    console.error('❌ Migration failed:', error)
    process.exit(1)
  }
}

runMigration()
