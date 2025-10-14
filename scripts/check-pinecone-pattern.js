#!/usr/bin/env node

/**
 * Check which chunk indices are in Pinecone
 */

require('dotenv').config({ path: '.env.local' })
const { Pinecone } = require('@pinecone-database/pinecone')
const { createClient } = require('@supabase/supabase-js')

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const pineconeApiKey = process.env.PINECONE_API_KEY
const pineconeIndexName = process.env.PINECONE_INDEX_NAME

const supabase = createClient(supabaseUrl, supabaseServiceKey)
const pinecone = new Pinecone({ apiKey: pineconeApiKey })
const index = pinecone.Index(pineconeIndexName)

async function checkPattern() {
  try {
    // Get 30pg document
    const { data: docs, error } = await supabase
      .from('documents')
      .select('id, title')
      .ilike('title', 'Test Doc (30pg)%')
      .single()

    if (error || !docs) {
      console.error('Document not found')
      return
    }

    console.log(`📄 ${docs.title} (${docs.id})\n`)

    // Get first 30 chunks from Pinecone
    const queryResult = await index.query({
      vector: new Array(768).fill(0),
      topK: 100,
      filter: { document_id: { $eq: docs.id } },
      includeMetadata: true,
      includeValues: false
    })

    const chunkIndices = queryResult.matches
      .map(m => {
        const id = m.id
        const match = id.match(/_chunk_(\d+)$/)
        return match ? parseInt(match[1]) : null
      })
      .filter(idx => idx !== null)
      .sort((a, b) => a - b)

    console.log(`First 30 chunk indices in Pinecone:`)
    console.log(chunkIndices.slice(0, 30).join(', '))
    console.log()

    // Check pattern
    const differences = []
    for (let i = 1; i < Math.min(30, chunkIndices.length); i++) {
      differences.push(chunkIndices[i] - chunkIndices[i - 1])
    }

    console.log(`Differences between consecutive indices:`)
    console.log(differences.slice(0, 29).join(', '))
    console.log()

    const avgDiff = differences.reduce((a, b) => a + b, 0) / differences.length
    console.log(`Average difference: ${avgDiff.toFixed(1)}`)

    if (differences.every(d => d === 3)) {
      console.log(`✓ Pattern confirmed: Every 3rd chunk is indexed (indices 0, 3, 6, 9, ...)`)
    }

  } catch (error) {
    console.error('Error:', error)
  }
}

checkPattern()
