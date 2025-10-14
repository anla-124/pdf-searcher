#!/usr/bin/env node

/**
 * Fix ALL documents with duplicate chunks
 */

require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

const supabase = createClient(supabaseUrl, supabaseServiceKey)

async function fixAllDocuments() {
  try {
    console.log('🔧 FIXING ALL DOCUMENTS WITH DUPLICATES\n')
    console.log('=' .repeat(80))

    // Get all documents
    const { data: docs, error } = await supabase
      .from('documents')
      .select('id, title, effective_chunk_count')
      .order('title')

    if (error || !docs || docs.length === 0) {
      console.error('Error fetching documents:', error)
      return
    }

    console.log(`Found ${docs.length} documents to check\n`)

    let totalDuplicatesDeleted = 0
    let documentsFixed = 0

    for (const doc of docs) {
      console.log('─'.repeat(80))
      console.log(`\n📄 ${doc.title}`)
      console.log(`   ID: ${doc.id}`)
      console.log(`   Current effective_chunk_count: ${doc.effective_chunk_count}`)

      // Get all chunks for this document
      const { data: allChunks, error: chunksError } = await supabase
        .from('document_embeddings')
        .select('id, chunk_index')
        .eq('document_id', doc.id)
        .order('chunk_index')
        .order('id')

      if (chunksError || !allChunks || allChunks.length === 0) {
        console.log('   ⚠️  No chunks found\n')
        continue
      }

      // Find duplicates
      const seen = new Set()
      const idsToDelete = []

      for (const chunk of allChunks) {
        if (seen.has(chunk.chunk_index)) {
          idsToDelete.push(chunk.id)
        } else {
          seen.add(chunk.chunk_index)
        }
      }

      const uniqueCount = seen.size

      console.log(`   Total rows: ${allChunks.length}`)
      console.log(`   Unique chunks: ${uniqueCount}`)
      console.log(`   Duplicates: ${idsToDelete.length}`)

      if (idsToDelete.length > 0) {
        // Delete duplicates
        console.log(`   🧹 Deleting ${idsToDelete.length} duplicates...`)

        const batchSize = 1000
        for (let i = 0; i < idsToDelete.length; i += batchSize) {
          const batch = idsToDelete.slice(i, i + batchSize)
          await supabase
            .from('document_embeddings')
            .delete()
            .in('id', batch)
        }

        totalDuplicatesDeleted += idsToDelete.length
        documentsFixed++
        console.log(`   ✅ Deleted`)
      }

      // Update effective_chunk_count if needed
      if (doc.effective_chunk_count !== uniqueCount) {
        console.log(`   🔄 Updating effective_chunk_count: ${doc.effective_chunk_count} → ${uniqueCount}`)

        const { error: updateError } = await supabase
          .from('documents')
          .update({ effective_chunk_count: uniqueCount })
          .eq('id', doc.id)

        if (updateError) {
          console.log(`   ❌ Update failed: ${updateError.message}`)
        } else {
          console.log(`   ✅ Updated`)
        }
      }

      // Verify
      const { count: finalCount } = await supabase
        .from('document_embeddings')
        .select('*', { count: 'exact', head: true })
        .eq('document_id', doc.id)

      const { data: updatedDoc } = await supabase
        .from('documents')
        .select('effective_chunk_count')
        .eq('id', doc.id)
        .single()

      const status = finalCount === updatedDoc?.effective_chunk_count ? '✅ MATCH' : '❌ MISMATCH'
      console.log(`   Status: ${status} (DB: ${finalCount}, Stored: ${updatedDoc?.effective_chunk_count})`)
      console.log()
    }

    console.log('=' .repeat(80))
    console.log('SUMMARY')
    console.log('=' .repeat(80))
    console.log(`Total documents processed: ${docs.length}`)
    console.log(`Documents with duplicates fixed: ${documentsFixed}`)
    console.log(`Total duplicate chunks deleted: ${totalDuplicatesDeleted}`)
    console.log()
    console.log('✅ ALL DOCUMENTS FIXED!')
    console.log()

  } catch (error) {
    console.error('Error:', error)
  }
}

fixAllDocuments()
