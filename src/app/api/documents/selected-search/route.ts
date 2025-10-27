/**
 * Selected Documents Similarity Search API
 * Compares a source document against multiple selected target documents
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { executeSimilaritySearch, validateDocumentForSimilarity } from '@/lib/similarity/orchestrator'
import { logger } from '@/lib/logger'

interface SimilarityResult {
  document: {
    id: string
    title: string
    filename: string
    file_size: number
    file_path: string
    content_type: string
    user_id: string
    status: string
    page_count?: number
    created_at: string
    updated_at: string
    metadata?: Record<string, unknown>
  }
  score: number
  matching_chunks: Array<{ text: string; score: number }>
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()

    // Check authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Parse request body
    const body = await request.json()
    const { sourceDocumentId, targetDocumentIds } = body as {
      sourceDocumentId?: string
      targetDocumentIds?: string[]
    }

    if (!sourceDocumentId || !targetDocumentIds || targetDocumentIds.length === 0) {
      return NextResponse.json({
        error: 'Missing required fields: sourceDocumentId and targetDocumentIds'
      }, { status: 400 })
    }

    logger.info('Selected search requested', {
      sourceDocumentId,
      targetCount: targetDocumentIds.length,
      userId: user.id
    })

    // Verify source document exists and belongs to user
    const { data: sourceDocument, error: sourceError } = await supabase
      .from('documents')
      .select('id, title, status, centroid_embedding, effective_chunk_count')
      .eq('id', sourceDocumentId)
      .eq('user_id', user.id)
      .single()

    if (sourceError || !sourceDocument) {
      return NextResponse.json({
        error: 'Source document not found'
      }, { status: 404 })
    }

    if (sourceDocument.status !== 'completed') {
      return NextResponse.json({
        error: 'Source document is not ready for similarity search',
        status: sourceDocument.status
      }, { status: 400 })
    }

    // Validate source document has required fields for similarity search
    const validation = await validateDocumentForSimilarity(sourceDocumentId)
    if (!validation.valid) {
      return NextResponse.json({
        error: 'Source document is not ready for similarity search',
        details: validation.errors,
        warnings: validation.warnings
      }, { status: 400 })
    }

    // Verify all target documents exist and belong to user
    const { data: targetDocuments, error: targetError } = await supabase
      .from('documents')
      .select('id, title, filename, file_size, file_path, content_type, status, page_count, created_at, updated_at, metadata')
      .in('id', targetDocumentIds)
      .eq('user_id', user.id)

    if (targetError) {
      return NextResponse.json({
        error: 'Failed to fetch target documents',
        details: targetError.message
      }, { status: 500 })
    }

    if (!targetDocuments || targetDocuments.length === 0) {
      return NextResponse.json({
        error: 'No target documents found'
      }, { status: 404 })
    }

    // Execute similarity search with filter for only target documents
    const searchResult = await executeSimilaritySearch(sourceDocumentId, {
      stage0_topK: 600,
      stage0_filters: {
        // Filter to only search within target documents
        document_id: { $in: targetDocumentIds }
      },
      stage1_topK: 250,
      stage1_enabled: true,
      stage2_fallbackThreshold: 0.8
    })

    logger.info('Selected search completed', {
      sourceDocumentId,
      targetCount: targetDocumentIds.length,
      resultsFound: searchResult.results.length,
      timing: searchResult.timing
    })

    // Format results to match expected interface
    const formattedResults: SimilarityResult[] = searchResult.results.map(result => {
      const targetDoc = targetDocuments.find(doc => doc.id === result.document.id)

      return {
        document: {
          id: result.document.id,
          title: result.document.title,
          filename: result.document.filename,
          file_size: (targetDoc?.file_size as number) || 0,
          file_path: (targetDoc?.file_path as string) || '',
          content_type: (targetDoc?.content_type as string) || 'application/pdf',
          user_id: user.id,
          status: (targetDoc?.status as string) || 'completed',
          page_count: result.document.page_count,
          created_at: (targetDoc?.created_at as string) || new Date().toISOString(),
          updated_at: (targetDoc?.updated_at as string) || new Date().toISOString(),
          metadata: targetDoc?.metadata as Record<string, unknown> | undefined
        },
        score: result.scores.sourceScore,
        matching_chunks: result.sections.map(section => ({
          text: `Pages ${section.docB_pageRange} (${section.chunkCount} chunks, avg score: ${(section.avgScore * 100).toFixed(1)}%)`,
          score: section.avgScore
        })).slice(0, 5) // Limit to top 5 sections
      }
    })

    // Add any target documents with no results (below threshold)
    const resultsDocIds = new Set(formattedResults.map(r => r.document.id))
    const missingDocs = targetDocuments.filter(doc => !resultsDocIds.has(doc.id as string))

    for (const doc of missingDocs) {
      formattedResults.push({
        document: {
          id: doc.id as string,
          title: doc.title as string,
          filename: doc.filename as string,
          file_size: doc.file_size as number,
          file_path: doc.file_path as string,
          content_type: doc.content_type as string,
          user_id: user.id,
          status: doc.status as string,
          page_count: doc.page_count as number | undefined,
          created_at: doc.created_at as string,
          updated_at: doc.updated_at as string,
          metadata: doc.metadata as Record<string, unknown> | undefined
        },
        score: 0,
        matching_chunks: []
      })
    }

    // Sort by score descending
    formattedResults.sort((a, b) => b.score - a.score)

    return NextResponse.json(formattedResults)

  } catch (error) {
    logger.error(
      'Selected search request failed',
      error instanceof Error ? error : new Error(String(error))
    )
    return NextResponse.json(
      {
        error: 'Selected search failed',
        details: error instanceof Error ? error.message : 'Unknown error',
        stack: process.env.NODE_ENV === 'development' && error instanceof Error ? error.stack : undefined
      },
      { status: 500 }
    )
  }
}
