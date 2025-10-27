/* eslint-disable no-console */
/* eslint-disable unused-imports/no-unused-vars */
/**
 * Backfill Token Counts Script
 *
 * This script populates token_count for all document_embeddings
 * and total_tokens for all documents that are missing these values.
 *
 * Run with: npx tsx scripts/backfill-token-counts.ts
 *
 * Note: Ensure environment variables are set in .env.local before running
 */

import { readFileSync } from 'fs'
import { resolve } from 'path'

// Manually load .env.local file
try {
  const envFile = readFileSync(resolve(process.cwd(), '.env.local'), 'utf-8')
  const envVars = envFile.split('\n')
  for (const line of envVars) {
    const trimmed = line.trim()
    if (trimmed && !trimmed.startsWith('#')) {
      const [key, ...values] = trimmed.split('=')
      if (key && values.length > 0) {
        const value = values.join('=').replace(/^["']|["']$/g, '')
        process.env[key.trim()] = value.trim()
      }
    }
  }
} catch (error) {
  console.error('⚠️  Warning: Could not load .env.local file')
}

import { createServiceClient } from '../src/lib/supabase/server'
import { countTokens } from '../src/lib/chunking/paragraph-chunker'

interface DocumentRecord {
  id: string
  title: string | null
  total_tokens: number | null
}

interface EmbeddingRecord {
  document_id: string
  chunk_index: number
  chunk_text: string | null
  token_count: number | null
}

async function backfillTokenCounts() {
  console.log('🚀 Starting token count backfill...\n')

  const supabase = await createServiceClient()

  // 1. Find all documents missing total_tokens
  console.log('📊 Fetching documents missing total_tokens...')
  const { data: documents, error: docsError } = await supabase
    .from('documents')
    .select('id, title, total_tokens')
    .or('total_tokens.is.null')
    .returns<DocumentRecord[]>()

  if (docsError) {
    console.error('❌ Failed to fetch documents:', docsError)
    process.exit(1)
  }

  if (!documents || documents.length === 0) {
    console.log('✅ All documents already have total_tokens. Nothing to backfill.')
    return
  }

  console.log(`📝 Found ${documents.length} documents missing total_tokens\n`)

  let successCount = 0
  let errorCount = 0

  // 2. Process each document
  for (let i = 0; i < documents.length; i++) {
    const doc = documents[i]!
    console.log(`\n[${i + 1}/${documents.length}] Processing document: ${doc.title || doc.id}`)

    try {
      // Fetch all embeddings for this document
      const { data: embeddings, error: embeddingsError } = await supabase
        .from('document_embeddings')
        .select('document_id, chunk_index, chunk_text, token_count')
        .eq('document_id', doc.id)
        .order('chunk_index', { ascending: true })
        .returns<EmbeddingRecord[]>()

      if (embeddingsError || !embeddings || embeddings.length === 0) {
        console.log(`  ⚠️  No embeddings found, skipping...`)
        errorCount++
        continue
      }

      console.log(`  📄 Found ${embeddings.length} chunks`)

      // Calculate token counts for embeddings missing them
      let totalTokens = 0
      const updates: Array<{ document_id: string; chunk_index: number; token_count: number }> = []

      for (const embedding of embeddings) {
        let tokenCount: number

        // Use existing token_count if available
        if (typeof embedding.token_count === 'number' && embedding.token_count > 0) {
          tokenCount = embedding.token_count
        } else if (embedding.chunk_text) {
          // Calculate token_count from chunk_text
          tokenCount = countTokens(embedding.chunk_text)
          updates.push({
            document_id: embedding.document_id,
            chunk_index: embedding.chunk_index,
            token_count: tokenCount
          })
        } else {
          // No text available, use minimum
          console.log(`    ⚠️  Chunk ${embedding.chunk_index} has no text, using token_count=1`)
          tokenCount = 1
          updates.push({
            document_id: embedding.document_id,
            chunk_index: embedding.chunk_index,
            token_count: tokenCount
          })
        }

        totalTokens += tokenCount
      }

      // Update embeddings with token_count if needed
      if (updates.length > 0) {
        console.log(`  🔄 Updating ${updates.length} chunks with token_count...`)

        // Update in batches of 100
        const batchSize = 100
        for (let j = 0; j < updates.length; j += batchSize) {
          const batch = updates.slice(j, j + batchSize)

          for (const update of batch) {
            const { error: updateError } = await supabase
              .from('document_embeddings')
              .update({ token_count: update.token_count })
              .eq('document_id', update.document_id)
              .eq('chunk_index', update.chunk_index)

            if (updateError) {
              console.error(`    ❌ Failed to update chunk ${update.chunk_index}:`, updateError)
            }
          }
        }
        console.log(`  ✅ Updated ${updates.length} chunks`)
      } else {
        console.log(`  ℹ️  All chunks already have token_count`)
      }

      // Update document with total_tokens
      console.log(`  🔄 Updating document with total_tokens=${totalTokens.toLocaleString()}...`)
      const { error: docUpdateError } = await supabase
        .from('documents')
        .update({ total_tokens: totalTokens })
        .eq('id', doc.id)

      if (docUpdateError) {
        console.error(`  ❌ Failed to update document:`, docUpdateError)
        errorCount++
        continue
      }

      console.log(`  ✅ Document updated successfully`)
      successCount++

    } catch (error) {
      console.error(`  ❌ Error processing document:`, error)
      errorCount++
    }
  }

  // Summary
  console.log('\n' + '='.repeat(60))
  console.log('📊 Backfill Summary:')
  console.log(`  ✅ Successful: ${successCount}`)
  console.log(`  ❌ Failed: ${errorCount}`)
  console.log(`  📝 Total: ${documents.length}`)
  console.log('='.repeat(60))

  if (successCount === documents.length) {
    console.log('\n🎉 All documents backfilled successfully!')
  } else if (successCount > 0) {
    console.log('\n⚠️  Some documents failed to backfill. Please review errors above.')
  } else {
    console.log('\n❌ Backfill failed. Please review errors above.')
  }
}

// Run the backfill
backfillTokenCounts()
  .then(() => {
    console.log('\n✨ Backfill script completed')
    process.exit(0)
  })
  .catch((error) => {
    console.error('\n💥 Backfill script failed:', error)
    process.exit(1)
  })
