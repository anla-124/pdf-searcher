import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { PaginationUtils, DatabasePagination } from '@/lib/utils/pagination'
import { DatabaseDocumentWithContent } from '@/types/external-apis'
import { logger } from '@/lib/logger'
import type { PostgrestResponse } from '@supabase/supabase-js'

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()

    // Check authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Parse pagination and filter parameters
    const paginationParams = PaginationUtils.parseParams(request)
    const { searchParams } = new URL(request.url)
    const status = searchParams.get('status')
    const search = searchParams.get('search')
    const includeJobs = searchParams.get('include_jobs') === 'true'
    
    // Validate pagination parameters
    const validation = PaginationUtils.validateParams(paginationParams)
    if (!validation.valid) {
      return NextResponse.json({
        error: 'Invalid pagination parameters',
        details: validation.errors
      }, { status: 400 })
    }

    logger.info('Documents API: fetching documents for user', { userId: user.id, statusParam: status, searchParam: search, includeJobsParam: includeJobs })

    // Get total count for pagination (with same filters)
    let countQuery = supabase
      .from('documents')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', user.id)
    
    if (status) {
      countQuery = countQuery.eq('status', status)
    }
    
    if (search) {
      countQuery = countQuery.or(`title.ilike.%${search}%,filename.ilike.%${search}%`)
    }
    
    // Enhanced query with JOIN to avoid N+1 issues when job info is needed
    const baseSelect = `
      id,
      user_id,
      title,
      filename,
      file_path,
      file_size,
      content_type,
      status,
      processing_error,
      extracted_fields,
      metadata,
      page_count,
      created_at,
      updated_at,
      document_content(extracted_text)
    `.trim()

    const selectClause = includeJobs ? `
      ${baseSelect},
      document_jobs(
        id,
        status,
        processing_method,
        attempts,
        error_message,
        created_at,
        updated_at
      )
    `.trim() : baseSelect

    let query = supabase
      .from('documents')
      .select(selectClause)
      .eq('user_id', user.id)

    // Apply filters
    if (status) {
      query = query.eq('status', status)
    }

    if (search) {
      query = query.or(`title.ilike.%${search}%,filename.ilike.%${search}%`)
    }

    // Apply pagination with proper sorting
    query = DatabasePagination.applyPagination(query, paginationParams)

    const startTime = Date.now()

    // Execute both queries concurrently for better performance
    const [documentsResult, countResult] = await Promise.all([
      query,
      countQuery
    ])

    const { data: documents, error: dbError } = documentsResult as PostgrestResponse<DatabaseDocumentWithContent>
    const { count } = countResult

    if (dbError) {
      logger.error('Documents API: database error', dbError)
      return NextResponse.json({ 
        error: 'Failed to fetch documents',
        code: 'DATABASE_ERROR',
        details: dbError.message
      }, { status: 500 })
    }

    const queryTime = Date.now() - startTime
    
    // Flatten extracted_text from document_content for each document
    const flattenedDocuments = documents?.map((doc: DatabaseDocumentWithContent) => {
      if (doc.document_content && doc.document_content.length > 0) {
        return {
          ...doc,
          extracted_text: doc.document_content[0]?.extracted_text ?? '',
          document_content: undefined // Remove the nested object
        }
      }
      return doc
    }) || []

    logger.info('Documents API: returned documents', { userId: user.id, count: flattenedDocuments.length, documentIds: flattenedDocuments.map(doc => doc.id) })

    // Create paginated response
    const responseData = PaginationUtils.createPaginatedResponse(
      flattenedDocuments,
      count || 0,
      paginationParams,
      (request.url || '').split('?')[0] || '/api/documents',
      { status: status || '', search: search || '', include_jobs: includeJobs.toString() }
    )

    // Add query metadata and backwards compatibility
    const enhancedResponse = {
      ...responseData,
      documents: responseData.data, // Backwards compatibility for frontend
      query_metadata: {
        query_time_ms: queryTime,
        cached: false,
        fresh: true,
        filters: { status, search, include_jobs: includeJobs },
        sort: {
          by: paginationParams.sortBy,
          order: paginationParams.sortOrder
        }
      }
    }

    return NextResponse.json(enhancedResponse)

  } catch (error) {
    logger.error('Documents API error', error instanceof Error ? error : new Error(String(error)))
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
