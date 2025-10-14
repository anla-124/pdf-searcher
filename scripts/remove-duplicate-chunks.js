#!/usr/bin/env node

/**
 * Remove duplicate rows from document_embeddings so we can enforce uniqueness.
 *
 * Usage:
 *   node scripts/remove-duplicate-chunks.js
 */

const { createServiceClient, releaseServiceClient } = require('@/lib/supabase/server')

async function main() {
  const supabase = await createServiceClient()

  try {
    console.warn('🧹 Removing duplicate chunk rows (keeping earliest row per document_id + chunk_index)…')

    const { data, error } = await supabase.rpc('remove_duplicate_document_chunks')

    if (error) {
      console.error('Failed to remove duplicates:', error)
      process.exit(1)
    }

    console.log('✅ Duplicate cleanup complete:', data)
  } finally {
    releaseServiceClient(supabase)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
