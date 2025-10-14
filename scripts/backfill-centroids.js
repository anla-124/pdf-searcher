/**
 * Backfill Script: Compute Centroids and Effective Chunk Counts
 *
 * This script computes and stores centroid embeddings and effective chunk counts
 * for existing documents that were processed before the similarity search upgrade.
 *
 * Usage:
 *   npm run backfill:centroids
 *   npm run backfill:centroids -- --dry-run
 *   npm run backfill:centroids -- --limit=10
 *   npm run backfill:centroids -- --document-id=<uuid>
 */

require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

// L2 normalization function (from similarity utils)
function l2Normalize(vector) {
  const magnitude = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0))
  if (magnitude === 0) return vector
  return vector.map(v => v / magnitude)
}

// Compute effective chunk count (from similarity utils)
function computeEffectiveChunkCount(totalTokens, chunkSize = 1000, overlapSize = 200) {
  const effectiveChunkSize = chunkSize - overlapSize
  return Math.ceil(totalTokens / effectiveChunkSize)
}

// Parse command line arguments
const args = process.argv.slice(2)
const isDryRun = args.includes('--dry-run')
const limitArg = args.find(arg => arg.startsWith('--limit='))
const limit = limitArg ? parseInt(limitArg.split('=')[1]) : null
const documentIdArg = args.find(arg => arg.startsWith('--document-id='))
const specificDocumentId = documentIdArg ? documentIdArg.split('=')[1] : null

// Initialize Supabase client
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseServiceRoleKey) {
  console.error('❌ Missing required environment variables:')
  console.error('   - NEXT_PUBLIC_SUPABASE_URL')
  console.error('   - SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
})

async function backfillCentroidsForDocument(documentId, stats) {
  try {
    console.log(`\n📄 Processing document: ${documentId}`)

    // 1. Fetch all embeddings for this document
    const { data: embeddings, error: fetchError } = await supabase
      .from('document_embeddings')
      .select('embedding, chunk_text')
      .eq('document_id', documentId)
      .order('chunk_index', { ascending: true })

    if (fetchError) {
      throw new Error(`Failed to fetch embeddings: ${fetchError.message}`)
    }

    if (!embeddings || embeddings.length === 0) {
      console.log(`   ⚠️  No embeddings found, skipping...`)
      stats.skipCount++
      return
    }

    console.log(`   ✓ Found ${embeddings.length} embeddings`)

    // 2. Compute centroid (mean of all embeddings)
    // Parse and validate embeddings
    const embeddingVectors = embeddings
      .map((e, idx) => {
        // Handle different embedding formats
        let embedding = e.embedding

        // If it's a string, parse it
        if (typeof embedding === 'string') {
          try {
            embedding = JSON.parse(embedding)
          } catch (err) {
            console.warn(`   ⚠️  Failed to parse embedding ${idx}, skipping...`)
            return null
          }
        }

        // Validate it's an array
        if (!Array.isArray(embedding)) {
          console.warn(`   ⚠️  Embedding ${idx} is not an array (type: ${typeof embedding}), skipping...`)
          return null
        }

        // Validate it's not empty
        if (embedding.length === 0) {
          console.warn(`   ⚠️  Embedding ${idx} is empty, skipping...`)
          return null
        }

        // Validate it has the right dimension (768 for text-embedding-004)
        if (embedding.length !== 768) {
          console.warn(`   ⚠️  Embedding ${idx} has wrong dimension (${embedding.length}, expected 768), skipping...`)
          return null
        }

        // Validate all values are numbers (not null/undefined)
        const hasInvalidValues = embedding.some(v => typeof v !== 'number' || isNaN(v) || v === null || v === undefined)
        if (hasInvalidValues) {
          console.warn(`   ⚠️  Embedding ${idx} contains invalid values, skipping...`)
          return null
        }

        return embedding
      })
      .filter(e => e !== null)  // Remove invalid embeddings

    if (embeddingVectors.length === 0) {
      console.log(`   ⚠️  No valid embeddings found after filtering, skipping...`)
      stats.skipCount++
      return
    }

    console.log(`   ✓ Valid embeddings: ${embeddingVectors.length}/${embeddings.length}`)

    const dimensions = 768  // text-embedding-004 dimension

    const centroid = new Array(dimensions).fill(0)
    for (const embedding of embeddingVectors) {
      for (let i = 0; i < dimensions; i++) {
        centroid[i] += embedding[i] / embeddingVectors.length
      }
    }

    // 3. Normalize the centroid
    const normalizedCentroid = l2Normalize(centroid)

    // 4. Compute effective chunk count
    const totalTokens = embeddings.reduce((sum, e) => {
      const estimatedTokens = (e.chunk_text?.length || 0) / 4
      return sum + estimatedTokens
    }, 0)

    const effectiveChunkCount = computeEffectiveChunkCount(
      Math.round(totalTokens),
      1000,  // chunkSize
      200    // overlapSize
    )

    console.log(`   ✓ Centroid computed (${dimensions} dimensions)`)
    console.log(`   ✓ Effective chunk count: ${effectiveChunkCount}`)

    // 5. Update documents table (unless dry run)
    if (!isDryRun) {
      const { error: updateError } = await supabase
        .from('documents')
        .update({
          centroid_embedding: normalizedCentroid,
          effective_chunk_count: effectiveChunkCount,
          embedding_model: 'text-embedding-004'
        })
        .eq('id', documentId)

      if (updateError) {
        throw new Error(`Failed to update document: ${updateError.message}`)
      }

      console.log(`   ✅ Document updated successfully`)
    } else {
      console.log(`   🔍 [DRY RUN] Would update with centroid and effective_chunk_count=${effectiveChunkCount}`)
    }

    stats.successCount++

  } catch (error) {
    console.error(`   ❌ Error: ${error.message || 'Unknown error'}`)
    stats.errorCount++
    stats.errors.push({
      documentId,
      error: error.message || 'Unknown error'
    })
  }
}

async function backfillCentroids() {
  console.log('🚀 Starting Centroid Backfill Script\n')
  console.log('Configuration:')
  console.log(`   Dry Run: ${isDryRun ? 'YES' : 'NO'}`)
  console.log(`   Limit: ${limit ?? 'None (all documents)'}`)
  console.log(`   Specific Document: ${specificDocumentId ?? 'None'}`)
  console.log('')

  const stats = {
    totalDocuments: 0,
    successCount: 0,
    skipCount: 0,
    errorCount: 0,
    errors: []
  }

  try {
    // Find documents that need centroid computation
    let query = supabase
      .from('documents')
      .select('id, title, status')
      .eq('status', 'completed')

    // If specific document ID provided, only process that one
    if (specificDocumentId) {
      query = query.eq('id', specificDocumentId)
    } else {
      // Otherwise, find documents missing centroids
      query = query.is('centroid_embedding', null)
    }

    if (limit) {
      query = query.limit(limit)
    }

    const { data: documents, error: queryError } = await query

    if (queryError) {
      throw new Error(`Failed to query documents: ${queryError.message}`)
    }

    if (!documents || documents.length === 0) {
      console.log('✅ No documents found that need centroid computation')
      return
    }

    stats.totalDocuments = documents.length

    console.log(`📊 Found ${documents.length} document(s) to process\n`)
    console.log('═'.repeat(60))

    // Process each document
    for (let i = 0; i < documents.length; i++) {
      const doc = documents[i]
      console.log(`\n[${i + 1}/${documents.length}] ${doc.title || 'Untitled'}`)

      await backfillCentroidsForDocument(doc.id, stats)

      // Add small delay between documents to avoid rate limiting
      if (i < documents.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 100))
      }
    }

    // Print summary
    console.log('\n' + '═'.repeat(60))
    console.log('\n📈 Backfill Summary:')
    console.log(`   Total documents: ${stats.totalDocuments}`)
    console.log(`   ✅ Successfully processed: ${stats.successCount}`)
    console.log(`   ⚠️  Skipped (no embeddings): ${stats.skipCount}`)
    console.log(`   ❌ Errors: ${stats.errorCount}`)

    if (stats.errors.length > 0) {
      console.log('\n❌ Error Details:')
      for (const error of stats.errors) {
        console.log(`   ${error.documentId}: ${error.error}`)
      }
    }

    if (isDryRun) {
      console.log('\n🔍 This was a DRY RUN - no changes were made')
      console.log('   Run without --dry-run to apply changes')
    }

    console.log('')

  } catch (error) {
    console.error('\n💥 Fatal Error:', error.message || 'Unknown error')
    process.exit(1)
  }
}

// Run the backfill
backfillCentroids()
  .then(() => {
    console.log('✅ Backfill script completed')
    process.exit(0)
  })
  .catch((error) => {
    console.error('💥 Backfill script failed:', error)
    process.exit(1)
  })
