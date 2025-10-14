#!/usr/bin/env node

/**
 * Fix the newly uploaded document with mismatch
 */

require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

const supabase = createClient(supabaseUrl, supabaseServiceKey)

async function fixDocument() {
  try {
    console.log('🔧 FIXING NEWLY UPLOADED DOCUMENT\n')

    // Get the document
    const { data: docs } = await supabase
      .from('documents')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(1)

    if (!docs || docs.length === 0) {
      console.log('No documents found')
      return
    }

    const doc = docs[0]
    console.log(`📄 Document: ${doc.title}`)
    console.log(`   ID: ${doc.id}`)
    console.log(`   Current effective_chunk_count: ${doc.effective_chunk_count}`)
    console.log()

    // Step 1: Remove duplicates
    console.log('🧹 Step 1: Removing duplicate chunks...\n')

    const { data: allChunks } = await supabase
      .from('document_embeddings')
      .select('id, chunk_index')
      .eq('document_id', doc.id)
      .order('chunk_index')
      .order('id')

    if (!allChunks) {
      console.log('No chunks found')
      return
    }

    // Keep first occurrence of each chunk_index
    const seen = new Set()
    const idsToDelete = []

    for (const chunk of allChunks) {
      if (seen.has(chunk.chunk_index)) {
        idsToDelete.push(chunk.id)
      } else {
        seen.add(chunk.chunk_index)
      }
    }

    console.log(`Found ${allChunks.length} total chunks`)
    console.log(`Found ${seen.size} unique chunks`)
    console.log(`Deleting ${idsToDelete.length} duplicate chunks...`)

    if (idsToDelete.length > 0) {
      // Delete in batches
      const batchSize = 1000
      for (let i = 0; i < idsToDelete.length; i += batchSize) {
        const batch = idsToDelete.slice(i, i + batchSize)
        await supabase
          .from('document_embeddings')
          .delete()
          .in('id', batch)
      }
      console.log(`✅ Deleted ${idsToDelete.length} duplicates\n`)
    }

    // Step 2: Update effective_chunk_count
    console.log('🔄 Step 2: Updating effective_chunk_count...\n')

    const actualCount = seen.size

    const { error: updateError } = await supabase
      .from('documents')
      .update({ effective_chunk_count: actualCount })
      .eq('id', doc.id)

    if (updateError) {
      console.error('Error updating:', updateError)
    } else {
      console.log(`✅ Updated effective_chunk_count: ${doc.effective_chunk_count} → ${actualCount}\n`)
    }

    // Step 3: Verify
    console.log('✅ Step 3: Verification...\n')

    const { count: finalCount } = await supabase
      .from('document_embeddings')
      .select('*', { count: 'exact', head: true })
      .eq('document_id', doc.id)

    const { data: updatedDoc } = await supabase
      .from('documents')
      .select('effective_chunk_count')
      .eq('id', doc.id)
      .single()

    console.log(`Database chunks: ${finalCount}`)
    console.log(`effective_chunk_count: ${updatedDoc.effective_chunk_count}`)
    console.log(`Status: ${finalCount === updatedDoc.effective_chunk_count ? '✅ MATCH' : '❌ MISMATCH'}`)
    console.log()
    console.log('─'.repeat(80))
    console.log('✅ FIX COMPLETED!')
    console.log('─'.repeat(80))

  } catch (error) {
    console.error('Error:', error)
  }
}

fixDocument()
