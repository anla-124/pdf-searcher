#!/usr/bin/env node

/**
 * Check chunk counts in database vs Pinecone
 */

require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')
const { Pinecone } = require('@pinecone-database/pinecone')

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const pineconeApiKey = process.env.PINECONE_API_KEY
const pineconeIndexName = process.env.PINECONE_INDEX_NAME

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing Supabase credentials')
  process.exit(1)
}

if (!pineconeApiKey || !pineconeIndexName) {
  console.error('Missing Pinecone credentials')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseServiceKey)
const pinecone = new Pinecone({ apiKey: pineconeApiKey })
const index = pinecone.Index(pineconeIndexName)

async function checkChunkCounts() {
  try {
    console.log('🔍 Checking chunk counts for Test Doc documents...\n')

    // Get Test Doc documents
    const { data: docs, error } = await supabase
      .from('documents')
      .select('id, title, page_count, effective_chunk_count')
      .ilike('title', 'Test Doc%')
      .order('title')

    if (error) {
      throw error
    }

    if (!docs || docs.length === 0) {
      console.log('No Test Doc documents found')
      return
    }

    for (const doc of docs) {
      console.log(`\n📄 ${doc.title}`)
      console.log(`   Pages: ${doc.page_count}`)
      console.log(`   Effective chunk count (theoretical): ${doc.effective_chunk_count}`)

      // Count chunks in database
      const { count: dbCount, error: countError } = await supabase
        .from('document_embeddings')
        .select('*', { count: 'exact', head: true })
        .eq('document_id', doc.id)

      if (countError) {
        console.error(`   Error counting DB chunks: ${countError.message}`)
      } else {
        console.log(`   Chunks in database: ${dbCount}`)
      }

      // Count vectors in Pinecone
      try {
        // Query with document_id filter to count
        const queryResult = await index.query({
          vector: new Array(768).fill(0),
          topK: 10000,
          filter: { document_id: { $eq: doc.id } },
          includeMetadata: false,
          includeValues: false
        })

        const pineconeCount = queryResult.matches?.length || 0
        console.log(`   Vectors in Pinecone: ${pineconeCount}`)

        // Check for mismatch
        if (dbCount !== pineconeCount) {
          console.log(`   ⚠️  MISMATCH: DB has ${dbCount} but Pinecone has ${pineconeCount}`)
        }

        if (doc.effective_chunk_count !== dbCount) {
          console.log(`   ⚠️  THEORETICAL MISMATCH: effective_chunk_count=${doc.effective_chunk_count} but actual=${dbCount}`)
        }
      } catch (pineconeError) {
        console.error(`   Error counting Pinecone vectors: ${pineconeError.message}`)
      }
    }

  } catch (error) {
    console.error('Error:', error)
    process.exit(1)
  }
}

checkChunkCounts()
