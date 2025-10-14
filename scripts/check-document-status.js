#!/usr/bin/env node

/**
 * Check document processing status and chunk counts
 */

require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

const supabase = createClient(supabaseUrl, supabaseServiceKey)

async function checkStatus() {
  try {
    console.log('🔍 Checking Test Doc processing status...\n')

    // Get documents
    const { data: docs, error } = await supabase
      .from('documents')
      .select('*')
      .ilike('title', 'Test Doc%')
      .order('title')

    if (error) {
      throw error
    }

    for (const doc of docs) {
      console.log(`\n📄 ${doc.title}`)
      console.log(`   ID: ${doc.id}`)
      console.log(`   Status: ${doc.status}`)
      console.log(`   Pages: ${doc.page_count}`)
      console.log(`   Processing strategy: ${doc.chunking_strategy || 'N/A'}`)
      console.log(`   Created: ${new Date(doc.created_at).toLocaleString()}`)
      console.log(`   Error log: ${doc.error_log || 'None'}`)

      // Count actual chunks in DB
      const { count } = await supabase
        .from('document_embeddings')
        .select('*', { count: 'exact', head: true })
        .eq('document_id', doc.id)

      console.log(`   Chunks in DB: ${count}`)

      // Check if any chunks failed
      const { data: chunks, error: chunkError } = await supabase
        .from('document_embeddings')
        .select('chunk_index, page_number')
        .eq('document_id', doc.id)
        .order('chunk_index')

      if (!chunkError && chunks) {
        const indices = chunks.map(c => c.chunk_index)
        const missing = []

        // Check for gaps in chunk indices
        for (let i = 0; i < Math.max(...indices); i++) {
          if (!indices.includes(i)) {
            missing.push(i)
          }
        }

        if (missing.length > 0) {
          console.log(`   ⚠️  Missing chunk indices: ${missing.slice(0, 10).join(', ')}${missing.length > 10 ? '...' : ''}`)
        }

        console.log(`   Chunk index range: ${Math.min(...indices)} - ${Math.max(...indices)}`)
      }
    }

  } catch (error) {
    console.error('Error:', error)
  }
}

checkStatus()
