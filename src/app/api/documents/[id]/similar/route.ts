import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { searchSimilarDocuments } from '@/lib/pinecone'
import { Document, SearchFilters } from '@/types'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    console.warn(`🔍 Starting similarity search for document ${id}`)

    const supabase = await createClient()
    
    // Check authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { 
      topK = 10, 
      filters = {}, 
      threshold = 0.7 
    }: { 
      topK?: number
      filters?: SearchFilters
      threshold?: number 
    } = body

    // Verify document exists and belongs to user
    const { data: document, error: docError } = await supabase
      .from('documents')
      .select('id, title, status')
      .eq('id', id)
      .eq('user_id', user.id)
      .single()

    if (docError || !document) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 })
    }

    if (document.status !== 'completed') {
      return NextResponse.json({ 
        error: 'Document is not ready for similarity search',
        status: document.status 
      }, { status: 400 })
    }

    console.warn(`🔍 Searching for similar documents to "${document.title}"`)

    // Convert filters to Pinecone format
    const pineconeFilters: Record<string, any> = {}
    if (filters.law_firm && filters.law_firm.length > 0) {
      pineconeFilters['law_firm'] = { $in: filters.law_firm }
    }
    if (filters.fund_manager && filters.fund_manager.length > 0) {
      pineconeFilters['fund_manager'] = { $in: filters.fund_manager }
    }
    if (filters.fund_admin && filters.fund_admin.length > 0) {
      pineconeFilters['fund_admin'] = { $in: filters.fund_admin }
    }
    if (filters.jurisdiction && filters.jurisdiction.length > 0) {
      pineconeFilters['jurisdiction'] = { $in: filters.jurisdiction }
    }

    // Direct similarity search without caching
    let results = await searchSimilarDocuments(id, {
      topK,
      filter: pineconeFilters,
      threshold,
      userId: user.id
    })

    console.warn(`✅ Similarity search completed: found ${results.length} raw similar documents`)

    // Deduplicate results by document_id, keeping the highest score for each document
    const dedupedResultsMap = new Map<string, typeof results[0]>()
    results.forEach(result => {
      const existing = dedupedResultsMap.get(result.document_id)
      if (!existing || result.score > existing.score) {
        dedupedResultsMap.set(result.document_id, result)
      }
    })
    const dedupedResults = Array.from(dedupedResultsMap.values())

    console.warn(`✅ Deduplicated to ${dedupedResults.length} unique similar documents`)

    // Extract unique document IDs from search results
    const uniqueResultDocumentIds = [...new Set(dedupedResults.map(r => r.document_id))]

    // Fetch full document details for all unique result documents
    const { data: fullDocuments, error: fullDocsError } = await supabase
      .from('documents')
      .select('*')
      .in('id', uniqueResultDocumentIds)

    if (fullDocsError) {
      console.error('Error fetching full document details for search results:', fullDocsError)
      // Continue with partial data or throw, depending on desired error handling
      // For now, we'll proceed with results that might lack full document info
    }

    const documentMap = new Map<string, Document>()
    fullDocuments?.forEach(doc => documentMap.set(doc.id, doc))

    // Enrich search results with full document details
    const enrichedResults = dedupedResults.map(result => ({
      ...result,
      document: documentMap.get(result.document_id) // Attach the full document object
    })).filter(result => result.document !== undefined) // Filter out any results where document couldn't be fetched

    const response = {
      results: enrichedResults, // Use enriched results
      document_id: id,
      document_title: document.title,
      total_results: enrichedResults.length, // Update total results count
      search_params: { topK, threshold, filters },
      cached: false,
      timestamp: new Date().toISOString()
    }

    return NextResponse.json(response)

  } catch (error) {
    console.error('Similarity search error:', error)
    return NextResponse.json(
      { 
        error: 'Similarity search failed', 
        details: error instanceof Error ? error.message : 'Unknown error' 
      },
      { status: 500 }
    )
  }
}