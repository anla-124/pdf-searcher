#!/usr/bin/env node
/**
 * Cleanup script to remove Pinecone vectors that no longer have
 * corresponding embeddings in Supabase.
 *
 * Run outside the sandbox or ensure outbound network access is allowed.
 */

const path = require('path')
const fs = require('fs')
const { config } = require('dotenv')
const fetch = global.fetch || require('node-fetch')
const { Pinecone } = require('@pinecone-database/pinecone')

const envPath = path.resolve(process.cwd(), '.env.local')
if (fs.existsSync(envPath)) {
  config({ path: envPath })
}

const SUPABASE_URL = process.env['NEXT_PUBLIC_SUPABASE_URL']
const SUPABASE_SERVICE_ROLE_KEY = process.env['SUPABASE_SERVICE_ROLE_KEY']
const PINECONE_API_KEY = process.env['PINECONE_API_KEY']
const PINECONE_INDEX_NAME = process.env['PINECONE_INDEX_NAME']

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !PINECONE_API_KEY || !PINECONE_INDEX_NAME) {
  console.error('Missing required environment variables. Ensure Supabase and Pinecone credentials are set.')
  process.exit(1)
}

async function fetchValidDocumentIds() {
  const url = new URL('/rest/v1/document_embeddings', SUPABASE_URL)
  url.searchParams.set('select', 'document_id')

  const response = await fetch(url.toString(), {
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json'
    }
  })

  if (!response.ok) {
    throw new Error(`Supabase request failed: ${response.status} ${response.statusText}`)
  }

  const data = await response.json()
  return new Set(data.map(row => row.document_id))
}

async function listAllVectorIds(index) {
  const vectorIds = []
  let paginationToken = undefined
  const PAGE_SIZE = 100

  do {
    const response = await index.listPaginated({ limit: PAGE_SIZE, paginationToken })
    const ids = response?.vectors?.map(v => v.id) ?? []
    vectorIds.push(...ids)
    paginationToken = response?.pagination?.next ?? null
  } while (paginationToken)

  return vectorIds
}

async function deleteStaleVectors(index, staleVectorIds) {
  const BATCH_SIZE = 1000
  let deleted = 0

  for (let i = 0; i < staleVectorIds.length; i += BATCH_SIZE) {
    const batch = staleVectorIds.slice(i, i + BATCH_SIZE)
    await index.deleteMany(batch)
    deleted += batch.length
  }

  return deleted
}

async function main() {
  console.log('Fetching current Supabase embedding document IDs...')
  const validDocumentIds = await fetchValidDocumentIds()
  console.log(`Found ${validDocumentIds.size} document IDs with embeddings`)

  const pinecone = new Pinecone({ apiKey: PINECONE_API_KEY })
  const index = pinecone.Index(PINECONE_INDEX_NAME)

  console.log('Listing vector IDs from Pinecone...')
  const vectorIds = await listAllVectorIds(index)
  console.log(`Pinecone currently holds ${vectorIds.length} vectors`)

  const staleVectors = []
  const staleDocIds = new Set()

  for (const vectorId of vectorIds) {
    const match = vectorId.match(/^(.+)_chunk_/) || vectorId.match(/^(.+)_page_/)
    if (!match) continue

    const docId = match[1]
    if (!validDocumentIds.has(docId)) {
      staleDocIds.add(docId)
      staleVectors.push(vectorId)
    }
  }

  if (staleVectors.length === 0) {
    console.log('No stale vectors found. Pinecone is already in sync.')
    process.exit(0)
  }

  console.log(`Identified ${staleDocIds.size} stale document IDs and ${staleVectors.length} vectors to delete.`)
  const deletedCount = await deleteStaleVectors(index, staleVectors)
  console.log(`Deleted ${deletedCount} stale vectors from Pinecone.`)
}

main().catch(error => {
  console.error('Cleanup failed:', error)
  console.error('\nIf you are running inside the sandbox, rerun this script outside the sandbox (e.g. open a new terminal) so it has network access to Supabase.')
  process.exit(1)
})
