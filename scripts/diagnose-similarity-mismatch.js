#!/usr/bin/env node

/**
 * Comprehensive diagnostic to find mismatches between Pinecone and Supabase
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

async function diagnose() {
  try {
    console.log('🔍 COMPREHENSIVE SIMILARITY SEARCH DIAGNOSTIC\n')
    console.log('=' .repeat(80))

    // Get 30pg document
    const { data: doc, error } = await supabase
      .from('documents')
      .select('*')
      .ilike('title', 'Test Doc (30pg)%')
      .single()

    if (error || !doc) {
      console.error('Document not found')
      return
    }

    console.log(`\n📄 Document: ${doc.title}`)
    console.log(`   ID: ${doc.id}`)
    console.log(`   Pages: ${doc.page_count}`)
    console.log(`   Effective chunk count: ${doc.effective_chunk_count}`)
    console.log(`   Has centroid: ${!!doc.centroid_embedding}`)

    // 1. Check Supabase chunks
    console.log('\n' + '─'.repeat(80))
    console.log('1️⃣  SUPABASE document_embeddings TABLE')
    console.log('─'.repeat(80))

    const { data: allChunks, error: chunkError } = await supabase
      .from('document_embeddings')
      .select('chunk_index, page_number, embedding')
      .eq('document_id', doc.id)
      .order('chunk_index')

    if (chunkError || !allChunks) {
      console.error('Error fetching chunks:', chunkError)
      return
    }

    console.log(`Total rows: ${allChunks.length}`)

    // Group by chunk_index
    const byIndex = {}
    allChunks.forEach(c => {
      if (!byIndex[c.chunk_index]) {
        byIndex[c.chunk_index] = []
      }
      byIndex[c.chunk_index].push(c)
    })

    const uniqueIndices = Object.keys(byIndex).length
    console.log(`Unique chunk_index values: ${uniqueIndices}`)

    // Check for duplicates
    const duplicates = Object.entries(byIndex).filter(([_, chunks]) => chunks.length > 1)
    console.log(`Chunk indices with duplicates: ${duplicates.length}`)

    if (duplicates.length > 0) {
      console.log(`\n⚠️  DUPLICATE DETECTION:`)
      console.log(`   Pattern: ${duplicates[0][1].length}x copies per chunk`)

      // Check if duplicates have IDENTICAL or DIFFERENT embeddings
      const firstDup = duplicates[0]
      const chunks = firstDup[1]

      console.log(`\n   Checking chunk_index ${firstDup[0]} (${chunks.length} copies):`)

      // Parse embeddings
      const embeddings = chunks.map(c => {
        let emb = c.embedding
        if (typeof emb === 'string') {
          emb = JSON.parse(emb)
        }
        return emb
      })

      // Compare embeddings
      let allIdentical = true
      for (let i = 1; i < embeddings.length; i++) {
        const diff = embeddings[0].reduce((sum, val, idx) =>
          sum + Math.abs(val - embeddings[i][idx]), 0
        )
        if (diff > 0.0001) {
          allIdentical = false
          console.log(`   ❌ Copy ${i + 1} differs from copy 1 (L1 distance: ${diff.toFixed(6)})`)
        }
      }

      if (allIdentical) {
        console.log(`   ✓ All ${chunks.length} copies have IDENTICAL embeddings`)
      } else {
        console.log(`   ❌ CRITICAL: Copies have DIFFERENT embeddings!`)
      }
    }

    // 2. Check Pinecone vectors
    console.log('\n' + '─'.repeat(80))
    console.log('2️⃣  PINECONE INDEX')
    console.log('─'.repeat(80))

    const pineconeVectors = await index.query({
      vector: new Array(768).fill(0),
      topK: 10000,
      filter: { document_id: { $eq: doc.id } },
      includeMetadata: true,
      includeValues: true
    })

    const pineconeCount = pineconeVectors.matches?.length || 0
    console.log(`Total vectors: ${pineconeCount}`)

    const pineconeIndices = pineconeVectors.matches
      .map(m => {
        const match = m.id.match(/_chunk_(\d+)$/)
        return match ? parseInt(match[1]) : null
      })
      .filter(idx => idx !== null)
      .sort((a, b) => a - b)

    console.log(`Chunk index range: ${Math.min(...pineconeIndices)} - ${Math.max(...pineconeIndices)}`)

    // 3. Compare Supabase vs Pinecone embeddings
    console.log('\n' + '─'.repeat(80))
    console.log('3️⃣  EMBEDDING COMPARISON: Supabase vs Pinecone')
    console.log('─'.repeat(80))

    // Sample first 5 chunks
    const samplesToCheck = 5
    console.log(`\nChecking first ${samplesToCheck} chunks:\n`)

    for (let i = 0; i < samplesToCheck; i++) {
      const supabaseChunksForIndex = allChunks.filter(c => c.chunk_index === i)
      const pineconeMatch = pineconeVectors.matches.find(m =>
        m.id === `${doc.id}_chunk_${i}`
      )

      console.log(`Chunk ${i}:`)
      console.log(`   Supabase: ${supabaseChunksForIndex.length} row(s)`)
      console.log(`   Pinecone: ${pineconeMatch ? 'Found' : 'Missing'}`)

      if (pineconeMatch && supabaseChunksForIndex.length > 0) {
        // Parse Supabase embeddings
        const supabaseEmbeddings = supabaseChunksForIndex.map(c => {
          let emb = c.embedding
          if (typeof emb === 'string') {
            emb = JSON.parse(emb)
          }
          return emb
        })

        const pineconeEmbedding = pineconeMatch.values

        // Compare each Supabase copy with Pinecone
        supabaseEmbeddings.forEach((supaEmb, copyIdx) => {
          const diff = supaEmb.reduce((sum, val, idx) =>
            sum + Math.abs(val - pineconeEmbedding[idx]), 0
          )

          if (diff < 0.0001) {
            console.log(`   ✓ Supabase copy ${copyIdx + 1} MATCHES Pinecone`)
          } else {
            console.log(`   ❌ Supabase copy ${copyIdx + 1} DIFFERS from Pinecone (L1: ${diff.toFixed(6)})`)
          }
        })
      }
    }

    // 4. Check deduplication logic
    console.log('\n' + '─'.repeat(80))
    console.log('4️⃣  DEDUPLICATION LOGIC CHECK')
    console.log('─'.repeat(80))

    // Simulate our deduplication logic
    const seen = new Set()
    const deduplicatedChunks = allChunks.filter(chunk => {
      if (seen.has(chunk.chunk_index)) {
        return false
      }
      seen.add(chunk.chunk_index)
      return true
    })

    console.log(`\nOur deduplication keeps: ${deduplicatedChunks.length} chunks`)
    console.log(`Deduplication strategy: Keep FIRST occurrence`)

    // Check if first occurrence matches Pinecone
    console.log(`\nVerifying if FIRST occurrence matches Pinecone:\n`)

    let matchCount = 0
    let mismatchCount = 0

    for (let i = 0; i < Math.min(5, deduplicatedChunks.length); i++) {
      const supaChunk = deduplicatedChunks[i]
      const pineconeMatch = pineconeVectors.matches.find(m =>
        m.id === `${doc.id}_chunk_${supaChunk.chunk_index}`
      )

      if (pineconeMatch) {
        let supaEmb = supaChunk.embedding
        if (typeof supaEmb === 'string') {
          supaEmb = JSON.parse(supaEmb)
        }

        const diff = supaEmb.reduce((sum, val, idx) =>
          sum + Math.abs(val - pineconeMatch.values[idx]), 0
        )

        if (diff < 0.0001) {
          matchCount++
          console.log(`Chunk ${supaChunk.chunk_index}: ✓ Match`)
        } else {
          mismatchCount++
          console.log(`Chunk ${supaChunk.chunk_index}: ❌ Mismatch (L1: ${diff.toFixed(6)})`)
        }
      }
    }

    console.log(`\nResult: ${matchCount} matches, ${mismatchCount} mismatches`)

    if (mismatchCount > 0) {
      console.log('\n🚨 CRITICAL ISSUE: Deduplication picks wrong embedding!')
      console.log('   Stage 2 uses different embeddings than Pinecone has.')
      console.log('   This causes incorrect similarity calculations.')
    }

    // 5. Summary
    console.log('\n' + '='.repeat(80))
    console.log('📊 DIAGNOSTIC SUMMARY')
    console.log('='.repeat(80))
    console.log(`\n✓ Supabase rows: ${allChunks.length}`)
    console.log(`✓ Unique indices: ${uniqueIndices}`)
    console.log(`✓ Pinecone vectors: ${pineconeCount}`)
    console.log(`✓ Deduplication result: ${deduplicatedChunks.length}`)

    if (mismatchCount > 0) {
      console.log(`\n❌ MISMATCH DETECTED: Supabase deduplication ≠ Pinecone embeddings`)
      console.log(`   Recommendation: Change deduplication to pick LAST occurrence`)
    } else {
      console.log(`\n✓ No embedding mismatches detected`)
    }

  } catch (error) {
    console.error('Error:', error)
  }
}

diagnose()
