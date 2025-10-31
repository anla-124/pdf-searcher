#!/usr/bin/env tsx
/**
 * Data Migration Script: Backfill Page Range Data
 *
 * This script backfills start_page_number and end_page_number for existing chunks
 * that were created before the page range feature was added.
 *
 * For existing data, we assume chunks are single-page (best effort migration).
 * New documents will have accurate multi-page range tracking.
 *
 * Usage:
 *   npm run migrate:page-ranges
 *   or
 *   npx tsx scripts/migrate-page-ranges.ts
 */

/* eslint-disable no-console */

import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import { resolve } from 'path'

// Load environment variables from .env.local (preferred) or .env
const envPath = resolve(process.cwd(), '.env.local')
const fallbackPath = resolve(process.cwd(), '.env')

try {
  config({ path: envPath })
  console.log('📄 Loaded environment from .env.local')
} catch {
  try {
    config({ path: fallbackPath })
    console.log('📄 Loaded environment from .env')
  } catch {
    console.log('📄 Using existing environment variables')
  }
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('\n❌ Error: Missing environment variables')
  console.error('   Required: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY')
  console.error('\n💡 Make sure you have one of these files:')
  console.error('   - .env.local')
  console.error('   - .env')
  console.error('\n   Or set environment variables manually:')
  console.error('   export NEXT_PUBLIC_SUPABASE_URL="your-url"')
  console.error('   export SUPABASE_SERVICE_ROLE_KEY="your-key"')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseServiceKey)

async function migratePageRanges() {
  console.log('🚀 Starting page range migration...\n')

  try {
    // Step 1: Count chunks needing migration
    console.log('📊 Checking for chunks needing migration...')
    const { count: totalChunks, error: countError } = await supabase
      .from('document_embeddings')
      .select('*', { count: 'exact', head: true })

    if (countError) {
      throw new Error(`Failed to count chunks: ${countError.message}`)
    }

    const { count: chunksNeedingMigration, error: needsMigrationError } = await supabase
      .from('document_embeddings')
      .select('*', { count: 'exact', head: true })
      .or('start_page_number.is.null,end_page_number.is.null')

    if (needsMigrationError) {
      throw new Error(`Failed to count chunks needing migration: ${needsMigrationError.message}`)
    }

    console.log(`   Total chunks: ${totalChunks}`)
    console.log(`   Chunks needing migration: ${chunksNeedingMigration}\n`)

    if (chunksNeedingMigration === 0) {
      console.log('✅ No chunks need migration. All done!')
      return
    }

    // Step 2: Run the migration
    console.log('🔧 Running migration...')
    console.log('   Setting start_page_number = page_number')
    console.log('   Setting end_page_number = page_number')
    console.log('   (Assumes existing chunks are single-page)\n')

    const { error: updateError } = await supabase
      .from('document_embeddings')
      .update({
        start_page_number: supabase.rpc('page_number'),
        end_page_number: supabase.rpc('page_number')
      })
      .or('start_page_number.is.null,end_page_number.is.null')

    if (updateError) {
      // Try alternative approach using raw SQL if RPC fails
      console.log('   Trying alternative migration approach...')

      // Fetch all chunks needing migration in batches
      let processed = 0
      const batchSize = 1000

      while (true) {
        const { data: chunks, error: fetchError } = await supabase
          .from('document_embeddings')
          .select('id, page_number')
          .or('start_page_number.is.null,end_page_number.is.null')
          .limit(batchSize)

        if (fetchError) {
          throw new Error(`Failed to fetch chunks: ${fetchError.message}`)
        }

        if (!chunks || chunks.length === 0) {
          break
        }

        // Update each chunk
        for (const chunk of chunks) {
          const { error: chunkUpdateError } = await supabase
            .from('document_embeddings')
            .update({
              start_page_number: chunk.page_number || 1,
              end_page_number: chunk.page_number || 1
            })
            .eq('id', chunk.id)

          if (chunkUpdateError) {
            console.error(`   ⚠️  Failed to update chunk ${chunk.id}: ${chunkUpdateError.message}`)
          }
        }

        processed += chunks.length
        console.log(`   Processed ${processed} chunks...`)

        if (chunks.length < batchSize) {
          break
        }
      }

      console.log(`\n✅ Migration completed! Updated ${processed} chunks.\n`)
    } else {
      console.log(`\n✅ Migration completed successfully!\n`)
    }

    // Step 3: Verify migration
    console.log('🔍 Verifying migration...')
    const { count: remainingCount, error: verifyError } = await supabase
      .from('document_embeddings')
      .select('*', { count: 'exact', head: true })
      .or('start_page_number.is.null,end_page_number.is.null')

    if (verifyError) {
      throw new Error(`Failed to verify migration: ${verifyError.message}`)
    }

    if (remainingCount === 0) {
      console.log('   ✅ All chunks have page range data!\n')
    } else {
      console.log(`   ⚠️  ${remainingCount} chunks still missing page range data\n`)
    }

    // Step 4: Show statistics
    console.log('📈 Migration Statistics:')
    const { data: stats, error: statsError } = await supabase
      .from('document_embeddings')
      .select('start_page_number, end_page_number')
      .not('start_page_number', 'is', null)
      .not('end_page_number', 'is', null)

    if (statsError) {
      console.log('   ⚠️  Could not fetch statistics')
    } else if (stats) {
      const multiPageChunks = stats.filter(
        s => s.end_page_number > s.start_page_number
      ).length

      console.log(`   Total chunks with page range: ${stats.length}`)
      console.log(`   Single-page chunks: ${stats.length - multiPageChunks}`)
      console.log(`   Multi-page chunks: ${multiPageChunks}`)

      if (multiPageChunks > 0) {
        const maxSpan = Math.max(
          ...stats.map(s => s.end_page_number - s.start_page_number + 1)
        )
        console.log(`   Max page span: ${maxSpan} pages`)
      }
    }

    console.log('\n✨ Migration complete!')

  } catch (error) {
    console.error('\n❌ Migration failed:', error)
    process.exit(1)
  }
}

// Run migration
migratePageRanges()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Fatal error:', error)
    process.exit(1)
  })
