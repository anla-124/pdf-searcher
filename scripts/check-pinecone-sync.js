#!/usr/bin/env node
/**
 * Compares Supabase document effective chunk counts with the actual vectors stored in Pinecone.
 *
 * Usage:
 *   node scripts/check-pinecone-sync.js            # scan every document
 *   node scripts/check-pinecone-sync.js <docId>    # scan a specific document id
 *
 * Requires the usual env vars (Supabase + Pinecone) to be available. By default we load `.env.local`.
 */

import path from 'path'
import { config } from 'dotenv'
import { createClient } from '@supabase/supabase-js'
import { Pinecone } from '@pinecone-database/pinecone'

config({ path: path.resolve(process.cwd(), '.env.local') })

const REQUIRED_ENV = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'PINECONE_API_KEY',
  'PINECONE_INDEX_NAME',
]

const missingEnv = REQUIRED_ENV.filter((key) => !process.env[key])
if (missingEnv.length > 0) {
  console.error(`Missing required environment variables: ${missingEnv.join(', ')}`)
  process.exit(1)
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  }
)

const pinecone = new Pinecone({ apiKey: process.env.PINECONE_API_KEY })
const pineconeIndex = pinecone.Index(process.env.PINECONE_INDEX_NAME)

const args = process.argv.slice(2)

async function fetchDocuments() {
  const { data, error } = await supabase
    .from('documents')
    .select('id, title, effective_chunk_count')

  if (error) {
    throw new Error(`Failed to fetch documents: ${error.message}`)
  }

  if (args.length > 0) {
    const include = new Set(args)
    return data.filter((doc) => include.has(doc.id))
  }

  return data
}

async function getPineconeVectorCount(documentId) {
  const prefix = `${documentId}_chunk_`
  let paginationToken = undefined
  let total = 0

  do {
    const response = await pineconeIndex.listPaginated({
      prefix,
      limit: 99, // Pinecone requires limit < 100
      paginationToken,
    })

    const vectors = response?.vectors ?? []
    total += vectors.length
    paginationToken = response?.pagination?.next ?? null
  } while (paginationToken)

  return total
}

async function main() {
  const documents = await fetchDocuments()
  if (!documents || documents.length === 0) {
    console.log('No documents found with the provided criteria.')
    return
  }

  console.log(`Analyzing ${documents.length} document(s)...\n`)

  const results = []
  let pineconeTotal = 0
  let supabaseTotal = 0

  for (const doc of documents) {
    const supabaseCount = typeof doc.effective_chunk_count === 'number' ? doc.effective_chunk_count : 0
    const pineconeCount = await getPineconeVectorCount(doc.id)

    supabaseTotal += supabaseCount
    pineconeTotal += pineconeCount

    results.push({
      id: doc.id,
      title: doc.title ?? '(untitled document)',
      supabase: supabaseCount,
      pinecone: pineconeCount,
      delta: supabaseCount - pineconeCount,
    })
  }

  const table = results
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .map((row) => ({
      Document: row.id,
      Title: row.title,
      'Supabase chunks': row.supabase,
      'Pinecone vectors': row.pinecone,
      Delta: row.delta,
    }))

  console.table(table)
  console.log(`Supabase total: ${supabaseTotal}`)
  console.log(`Pinecone total: ${pineconeTotal}`)
  console.log(`Overall delta: ${supabaseTotal - pineconeTotal}`)
}

main().catch((error) => {
  console.error('Failed to compare Supabase vs Pinecone:', error)
  process.exit(1)
})
