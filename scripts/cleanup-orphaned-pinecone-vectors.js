/**
 * Cleanup Script: Remove orphaned vectors from Pinecone
 *
 * This script finds and deletes vectors in Pinecone that no longer have
 * corresponding documents in the Supabase database.
 *
 * Orphaned vectors occur when:
 * - Document deletion fails partway through
 * - Batch deletion limits (>1000 chunks) were exceeded (fixed now)
 * - Database CASCADE delete worked but Pinecone deletion failed
 *
 * Usage:
 *   node scripts/cleanup-orphaned-pinecone-vectors.js [--dry-run]
 *
 * Options:
 *   --dry-run    Show what would be deleted without actually deleting
 */

const { createClient } = require('@supabase/supabase-js')
const { Pinecone } = require('@pinecone-database/pinecone')
require('dotenv').config({ path: '.env.local' })

// Initialize Pinecone
const pinecone = new Pinecone({ apiKey: process.env.PINECONE_API_KEY })
const index = pinecone.index(process.env.PINECONE_INDEX_NAME || 'pdf-ai-assistant')

// Initialize Supabase
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function cleanupOrphanedVectors(dryRun = false) {
  console.log('\n🧹 Cleanup: Orphaned Pinecone Vectors')
  console.log('='.repeat(60))
  console.log(`Mode: ${dryRun ? 'DRY RUN (no deletions)' : 'LIVE (will delete)'}`)
  console.log('='.repeat(60))

  try {
    // Step 1: Get all valid document IDs from Supabase
    console.log('\n📊 Step 1: Fetching valid document IDs from Supabase...')
    const { data: documents, error: dbError } = await supabase
      .from('documents')
      .select('id')

    if (dbError) {
      throw new Error(`Failed to fetch documents from Supabase: ${dbError.message}`)
    }

    const validDocumentIds = new Set((documents || []).map(d => d.id))
    console.log(`✅ Found ${validDocumentIds.size} valid documents in Supabase`)

    // Step 2: List all vectors from Pinecone
    console.log('\n📊 Step 2: Scanning Pinecone for all vectors...')
    console.log('⏳ This may take a while for large indexes...')

    const allVectorIds = []
    let paginationToken = undefined
    let pageCount = 0

    do {
      const listResponse = await index.listPaginated({
        limit: 100, // Pinecone max limit is 100
        paginationToken
      })

      if (listResponse.vectors) {
        const vectorIds = listResponse.vectors.map(v => v.id)
        allVectorIds.push(...vectorIds)
        pageCount++

        console.log(`  Page ${pageCount}: Found ${vectorIds.length} vectors (total: ${allVectorIds.length})`)
      }

      paginationToken = listResponse.pagination?.next
    } while (paginationToken)

    console.log(`✅ Total vectors in Pinecone: ${allVectorIds.length}`)

    // Step 3: Find orphaned vectors
    console.log('\n📊 Step 3: Identifying orphaned vectors...')
    const orphanedVectors = []

    for (const vectorId of allVectorIds) {
      // Vector ID format: {documentId}_chunk_{chunkIndex}
      const match = vectorId.match(/^(.+?)_chunk_(\d+)$/)

      if (!match) {
        console.warn(`⚠️  Skipping invalid vector ID format: ${vectorId}`)
        continue
      }

      const documentId = match[1]
      const chunkIndex = parseInt(match[2], 10)

      // Check if document exists in Supabase
      if (!validDocumentIds.has(documentId)) {
        orphanedVectors.push({ id: vectorId, documentId, chunkIndex })
      }
    }

    console.log(`✅ Found ${orphanedVectors.length} orphaned vectors`)

    // Step 4: Group orphaned vectors by document
    const orphanedByDocument = new Map()
    for (const vector of orphanedVectors) {
      if (!orphanedByDocument.has(vector.documentId)) {
        orphanedByDocument.set(vector.documentId, [])
      }
      orphanedByDocument.get(vector.documentId).push(vector)
    }

    console.log(`📑 Orphaned vectors span ${orphanedByDocument.size} deleted documents`)

    // Display summary by document
    if (orphanedByDocument.size > 0) {
      console.log('\n📋 Orphaned Vectors by Document:')
      console.log('-'.repeat(60))

      const sortedDocs = Array.from(orphanedByDocument.entries())
        .sort((a, b) => b[1].length - a[1].length)

      sortedDocs.forEach(([docId, vectors], idx) => {
        if (idx < 10 || vectors.length > 100) {
          console.log(`  ${docId}: ${vectors.length} vectors`)
        }
      })

      if (sortedDocs.length > 10) {
        console.log(`  ... and ${sortedDocs.length - 10} more documents`)
      }
    }

    // Step 5: Delete orphaned vectors (or show what would be deleted)
    if (orphanedVectors.length === 0) {
      console.log('\n✅ No orphaned vectors found! Pinecone is clean.')
      return
    }

    if (dryRun) {
      console.log('\n🔍 DRY RUN: Would delete the following:')
      console.log(`   Total vectors: ${orphanedVectors.length}`)
      console.log(`   Documents affected: ${orphanedByDocument.size}`)
      console.log('\nRun without --dry-run to actually delete these vectors.')
      return
    }

    // Confirm deletion
    console.log('\n⚠️  WARNING: About to delete orphaned vectors!')
    console.log(`   Total vectors to delete: ${orphanedVectors.length}`)
    console.log(`   Documents affected: ${orphanedByDocument.size}`)
    console.log('\n⏳ Starting deletion in batches of 1000...')

    const vectorIdsToDelete = orphanedVectors.map(v => v.id)
    const BATCH_SIZE = 1000
    let totalDeleted = 0

    for (let i = 0; i < vectorIdsToDelete.length; i += BATCH_SIZE) {
      const batch = vectorIdsToDelete.slice(i, i + BATCH_SIZE)
      const batchNum = Math.floor(i / BATCH_SIZE) + 1
      const totalBatches = Math.ceil(vectorIdsToDelete.length / BATCH_SIZE)

      console.log(`  Deleting batch ${batchNum}/${totalBatches}: ${batch.length} vectors...`)

      await index.deleteMany(batch)
      totalDeleted += batch.length

      console.log(`  ✅ Batch ${batchNum} deleted (total: ${totalDeleted}/${vectorIdsToDelete.length})`)
    }

    console.log('\n' + '='.repeat(60))
    console.log(`✅ SUCCESS: Deleted ${totalDeleted} orphaned vectors from Pinecone`)
    console.log('='.repeat(60))

  } catch (error) {
    console.error('\n❌ Cleanup failed with error:', error)
    process.exit(1)
  }
}

// Main execution
const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')

if (args.includes('--help') || args.includes('-h')) {
  console.log(`
Usage: node scripts/cleanup-orphaned-pinecone-vectors.js [--dry-run]

Options:
  --dry-run    Show what would be deleted without actually deleting
  --help, -h   Show this help message

Examples:
  # Dry run (safe - no deletions)
  node scripts/cleanup-orphaned-pinecone-vectors.js --dry-run

  # Live run (actually delete orphaned vectors)
  node scripts/cleanup-orphaned-pinecone-vectors.js
`)
  process.exit(0)
}

cleanupOrphanedVectors(dryRun)
