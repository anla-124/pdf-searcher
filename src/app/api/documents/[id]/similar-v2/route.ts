/**
 * Production-Ready Similarity Search API v2
 * Uses 3-stage adaptive similarity search with section detection
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { executeSimilaritySearch, validateDocumentForSimilarity } from '@/lib/similarity/orchestrator'
import { logger } from '@/lib/logger'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    logger.info('Similarity search v2 requested', { documentId: id })

    const supabase = await createClient()

    // Check authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Parse request body for optional configuration
    const body = await request.json().catch(() => ({}))
    const {
      stage0_topK = 600,
      stage1_topK = 250,
      stage1_enabled = true,
      stage1_neighborsPerChunk,
      stage2_parallelWorkers,
      stage2_fallbackThreshold = 0.8,
      filters: rawFilters = {}
    }: {
      stage0_topK?: number
      stage1_topK?: number
      stage1_enabled?: boolean
      stage1_neighborsPerChunk?: number
      stage2_parallelWorkers?: number
      stage2_fallbackThreshold?: number
      filters?: Record<string, unknown>
    } = body

    // Extract non-metadata fields from filters (not stored in Pinecone)
    const { page_range: _pageRange, min_score: _minScore, threshold: _threshold, topK: _topK, ...filters } = rawFilters

    // Verify document exists and belongs to user
    const { data: document, error: docError } = await supabase
      .from('documents')
      .select('id, title, status, centroid_embedding, effective_chunk_count')
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

    // Validate document has required fields for similarity search
    const validation = await validateDocumentForSimilarity(id)
    if (!validation.valid) {
      return NextResponse.json({
        error: 'Document is not ready for similarity search v2',
        details: validation.errors,
        warnings: validation.warnings,
        instructions: [
          'This document needs to be reprocessed with the new pipeline.',
          'Option 1: Reupload the document',
          'Option 2: Run the backfill script: npm run backfill:centroids',
          'Option 3: Use the legacy /api/documents/[id]/similar endpoint'
        ]
      }, { status: 400 })
    }

    if (validation.warnings.length > 0) {
      logger.warn('Similarity search validation warnings', {
        documentId: id,
        warnings: validation.warnings
      })
    }

    logger.info('Similarity search execution starting', {
      documentId: id,
      documentTitle: document.title,
      stage0_topK,
      stage1_topK
    })

    // Execute 3-stage similarity search
    const searchResult = await executeSimilaritySearch(id, {
      stage0_topK,
      stage0_filters: filters,
      stage1_topK,
      stage1_enabled,
      stage1_neighborsPerChunk,
      stage2_parallelWorkers,
      stage2_fallbackThreshold
    })

    logger.info('Similarity search completed', {
      documentId: id,
      stage0Candidates: searchResult.stages.stage0_candidates,
      stage1Candidates: searchResult.stages.stage1_candidates,
      finalResults: searchResult.stages.final_results,
      timing: searchResult.timing
    })

    // Format response
    const response = {
      document_id: id,
      document_title: document.title,
      results: searchResult.results,
      total_results: searchResult.results.length,
      timing: {
        stage0_ms: searchResult.timing.stage0_ms,
        stage1_ms: searchResult.timing.stage1_ms,
        stage2_ms: searchResult.timing.stage2_ms,
        total_ms: searchResult.timing.total_ms
      },
      stages: {
        stage0_candidates: searchResult.stages.stage0_candidates,
        stage1_candidates: searchResult.stages.stage1_candidates,
        final_results: searchResult.stages.final_results
      },
      config: {
        stage0_topK,
        stage1_topK,
        stage1_enabled,
        stage1_neighborsPerChunk,
        stage2_parallelWorkers,
        stage2_fallbackThreshold,
        filters
      },
      version: '2.0.0',
      features: {
        adaptive_scoring: true,
        bidirectional_matching: true,
        section_detection: true,
        effective_chunk_count: true
      },
      timestamp: new Date().toISOString()
    }

    return NextResponse.json(response)

  } catch (error) {
    logger.error(
      'Similarity search v2 request failed',
      error instanceof Error ? error : new Error(String(error))
    )
    return NextResponse.json(
      {
        error: 'Similarity search failed',
        details: error instanceof Error ? error.message : 'Unknown error',
        stack: process.env.NODE_ENV === 'development' && error instanceof Error ? error.stack : undefined
      },
      { status: 500 }
    )
  }
}

/**
 * GET endpoint to check if document is ready for similarity search v2
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const supabase = await createClient()

    // Check authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Verify document belongs to user
    const { data: document, error: docError } = await supabase
      .from('documents')
      .select('id, title, status')
      .eq('id', id)
      .eq('user_id', user.id)
      .single()

    if (docError || !document) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 })
    }

    // Validate document readiness
    const validation = await validateDocumentForSimilarity(id)

    return NextResponse.json({
      document_id: id,
      document_title: document.title,
      ready: validation.valid,
      errors: validation.errors,
      warnings: validation.warnings,
      status: document.status
    })

  } catch (error) {
    logger.error(
      'Similarity search readiness check failed',
      error instanceof Error ? error : new Error(String(error))
    )
    return NextResponse.json(
      {
        error: 'Readiness check failed',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    )
  }
}
