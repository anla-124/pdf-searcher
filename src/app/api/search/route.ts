import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { HybridSearchEngine } from '@/lib/hybrid-search'
import { SearchFilters } from '@/types'

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()

    // Check authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { 
      query,
      filters = {}, 
      topK = 20,
      enableSemanticSearch = true,
      enableKeywordSearch = true,
      enableHybridRanking = true,
      semanticWeight = 0.7,
      keywordWeight = 0.3
    }: { 
      query: string
      filters?: SearchFilters
      topK?: number
      enableSemanticSearch?: boolean
      enableKeywordSearch?: boolean
      enableHybridRanking?: boolean
      semanticWeight?: number
      keywordWeight?: number
    } = body

    if (!query || query.trim().length === 0) {
      return NextResponse.json({ error: 'Query is required' }, { status: 400 })
    }

    console.warn(`🔍 Hybrid search request: "${query}"`)

    // Convert filters to Pinecone format
    const pineconeFilters: Record<string, any> = {}

    // Business metadata filters
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

    // Perform hybrid search - no caching, direct execution
    const searchResults = await HybridSearchEngine.search({
      query,
      topK,
      filters: pineconeFilters,
      userId: user.id,
      enableSemanticSearch,
      enableKeywordSearch,
      enableHybridRanking,
      semanticWeight,
      keywordWeight
    })

    console.warn(`✅ Hybrid search completed: ${searchResults.results.length} results`)

    return NextResponse.json({
      ...searchResults,
      cached: false,
      query,
      timestamp: new Date().toISOString()
    })

  } catch (error) {
    console.error('Search error:', error)
    return NextResponse.json(
      { error: 'Search failed', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}