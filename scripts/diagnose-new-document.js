#!/usr/bin/env node

/**
 * Diagnose the newly uploaded document with mismatch
 */

require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')
const { Pinecone } = require('@pinecone-database/pinecone')

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const pineconeApiKey = process.env.PINECONE_API_KEY
const pineconeIndexName = process.env.PINECONE_INDEX_NAME

const supabase = createClient(supabaseUrl, supabaseServiceKey)
const pinecone = new Pinecone({ apiKey: pineconeApiKey })
const index = pinecone.Index(pineconeIndexName)

async function diagnoseNewDocument() {
  try {
    console.log('🔍 DIAGNOSING NEWLY UPLOADED DOCUMENT\n')
    console.log('=' .repeat(80))

    // Get the most recently created document
    const { data: docs, error } = await supabase
      .from('documents')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(3)

    if (error || !docs) {
      console.error('Error fetching documents:', error)
      return
    }

    console.log('\nMost recent documents:\n')
    docs.forEach((doc, idx) => {
      console.log(`${idx + 1}. ${doc.title}`)
      console.log(`   Created: ${new Date(doc.created_at).toLocaleString()}`)
      console.log(`   effective_chunk_count: ${doc.effective_chunk_count}`)
      console.log()
    })

    // Focus on the newest document
    const newDoc = docs[0]
    console.log('─'.repeat(80))
    console.log(`\n📄 DETAILED ANALYSIS: ${newDoc.title}`)
    console.log(`   Document ID: ${newDoc.id}`)
    console.log(`   Created: ${new Date(newDoc.created_at).toLocaleString()}`)
    console.log(`   Status: ${newDoc.status}`)
    console.log(`   Pages: ${newDoc.page_count}`)
    console.log(`   Chunking Strategy: ${newDoc.chunking_strategy || 'N/A'}`)
    console.log()

    // Check database chunks
    console.log('─'.repeat(80))
    console.log('DATABASE (document_embeddings):')
    console.log('─'.repeat(80))

    const { count: totalRows } = await supabase
      .from('document_embeddings')
      .select('*', { count: 'exact', head: true })
      .eq('document_id', newDoc.id)

    const { data: chunks } = await supabase
      .from('document_embeddings')
      .select('chunk_index, page_number, vector_id')
      .eq('document_id', newDoc.id)
      .order('chunk_index')

    if (!chunks || chunks.length === 0) {
      console.log('❌ NO CHUNKS FOUND IN DATABASE')
      console.log('   This suggests chunks were not stored in Supabase')
      console.log()
    } else {
      const uniqueIndices = new Set(chunks.map(c => c.chunk_index))
      const minIndex = Math.min(...Array.from(uniqueIndices))
      const maxIndex = Math.max(...Array.from(uniqueIndices))

      console.log(`Total rows: ${totalRows}`)
      console.log(`Unique chunk_index values: ${uniqueIndices.size}`)
      console.log(`Chunk index range: ${minIndex} - ${maxIndex}`)

      // Check for duplicates
      const indexCounts = {}
      chunks.forEach(c => {
        indexCounts[c.chunk_index] = (indexCounts[c.chunk_index] || 0) + 1
      })

      const duplicates = Object.entries(indexCounts).filter(([_, count]) => count > 1)
      if (duplicates.length > 0) {
        console.log(`⚠️  DUPLICATES: ${duplicates.length} indices have duplicates`)
        console.log(`   Pattern: ${duplicates[0][1]}x copies per chunk`)
      } else {
        console.log(`✓ No duplicates found`)
      }
      console.log()
    }

    // Check Pinecone vectors
    console.log('─'.repeat(80))
    console.log('PINECONE INDEX:')
    console.log('─'.repeat(80))

    const pineconeResult = await index.query({
      vector: new Array(768).fill(0),
      topK: 10000,
      filter: { document_id: { $eq: newDoc.id } },
      includeMetadata: true,
      includeValues: false
    })

    const pineconeCount = pineconeResult.matches?.length || 0
    console.log(`Total vectors: ${pineconeCount}`)

    if (pineconeCount > 0) {
      const pineconeIndices = pineconeResult.matches
        .map(m => {
          const match = m.id.match(/_chunk_(\d+)$/)
          return match ? parseInt(match[1]) : null
        })
        .filter(idx => idx !== null)
        .sort((a, b) => a - b)

      console.log(`Chunk index range: ${Math.min(...pineconeIndices)} - ${Math.max(...pineconeIndices)}`)
      console.log()
    } else {
      console.log('❌ NO VECTORS FOUND IN PINECONE')
      console.log()
    }

    // Comparison
    console.log('─'.repeat(80))
    console.log('COMPARISON:')
    console.log('─'.repeat(80))
    console.log()

    const dbChunks = chunks ? new Set(chunks.map(c => c.chunk_index)).size : 0
    const pineconeVectors = pineconeCount

    console.log(`effective_chunk_count (stored):  ${newDoc.effective_chunk_count}`)
    console.log(`Database unique chunks:           ${dbChunks}`)
    console.log(`Pinecone vectors:                 ${pineconeVectors}`)
    console.log()

    // Identify the issue
    console.log('─'.repeat(80))
    console.log('DIAGNOSIS:')
    console.log('─'.repeat(80))
    console.log()

    if (newDoc.effective_chunk_count === 487 && pineconeVectors === 180) {
      console.log('❌ ISSUE IDENTIFIED: effective_chunk_count does not match Pinecone')
      console.log()
      console.log('Possible causes:')

      if (dbChunks === 0) {
        console.log('1. ❌ Chunks NOT stored in database')
        console.log('   → Code may be using old/batch processing path')
        console.log('   → Check if batch processing bypasses database storage')
      } else if (dbChunks === pineconeVectors) {
        console.log('1. ✓ Database matches Pinecone')
        console.log('2. ❌ effective_chunk_count calculated incorrectly')
        console.log('   → effective_chunk_count = 487 (theoretical?)')
        console.log('   → Should be = ' + dbChunks + ' (actual)')
        console.log('   → Check computeAndStoreCentroid function')
      } else if (dbChunks > pineconeVectors) {
        console.log('1. ⚠️  More chunks in DB than Pinecone')
        console.log(`   → Database has ${dbChunks} chunks`)
        console.log(`   → Pinecone has ${pineconeVectors} vectors`)
        console.log('   → Some chunks failed to index in Pinecone')
      } else {
        console.log('1. ⚠️  More vectors in Pinecone than DB')
        console.log('   → Unusual - investigate further')
      }
      console.log()
    } else if (newDoc.effective_chunk_count === dbChunks && dbChunks === pineconeVectors) {
      console.log('✅ NO ISSUES: All counts match perfectly!')
    } else {
      console.log('⚠️  MISMATCH DETECTED')
      console.log(`   effective_chunk_count: ${newDoc.effective_chunk_count}`)
      console.log(`   Database chunks: ${dbChunks}`)
      console.log(`   Pinecone vectors: ${pineconeVectors}`)
      console.log()
      console.log('   Please investigate processing logs')
    }

    // Check processing method
    console.log('─'.repeat(80))
    console.log('PROCESSING METHOD CHECK:')
    console.log('─'.repeat(80))
    console.log()

    const processingMethod = newDoc.processing_method || 'unknown'
    console.log(`Processing method: ${processingMethod}`)
    console.log(`Chunking strategy: ${newDoc.chunking_strategy || 'N/A'}`)
    console.log()

    if (processingMethod === 'batch') {
      console.log('⚠️  BATCH PROCESSING DETECTED')
      console.log('   Batch processing may use different code path')
      console.log('   This might bypass the fix we implemented')
      console.log()
      console.log('   Action: Check batch processing code in:')
      console.log('   - scripts/process-batch-results.js')
      console.log('   - src/lib/document-ai-batch.ts')
    } else {
      console.log('Processing uses standard path')
    }

  } catch (error) {
    console.error('Error:', error)
  }
}

diagnoseNewDocument()
