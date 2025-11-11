import { NextRequest } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { GenericSupabaseSchema } from '@/types/supabase'
import { logger } from '@/lib/logger'

export interface PaginationParams {
  page: number
  limit: number
  offset: number
  sortBy?: string
  sortOrder?: 'asc' | 'desc'
}

export interface PaginationMetadata {
  page: number
  limit: number
  total: number
  totalPages: number
  hasNext: boolean
  hasPrev: boolean
  nextPage?: number
  prevPage?: number
}

export interface PaginatedResponse<T> {
  data: T[]
  pagination: PaginationMetadata
  links: {
    self: string
    first: string
    last: string
    next?: string
    prev?: string
  }
}

/**
 * Enterprise-grade pagination utilities
 * Provides consistent pagination across all API endpoints
 */
export class PaginationUtils {
  
  /**
   * Parse pagination parameters from request
   */
  static parseParams(request: NextRequest): PaginationParams {
    const { searchParams } = new URL(request.url)
    
    // Parse page (1-based, default: 1)
    const page = Math.max(1, parseInt(searchParams.get('page') || '1'))
    
    // Parse limit (default: 20, max: 100)
    const limit = Math.max(1, parseInt(searchParams.get('limit') || '1000'))
    
    // Calculate offset (0-based)
    const offset = (page - 1) * limit
    
    // Parse sorting
    const sortBy = searchParams.get('sort_by') || searchParams.get('sortBy') || 'created_at'
    const sortOrder = (searchParams.get('sort_order') || searchParams.get('sortOrder') || 'desc').toLowerCase() as 'asc' | 'desc'
    
    return {
      page,
      limit,
      offset,
      sortBy,
      sortOrder
    }
  }
  
  /**
   * Create pagination metadata
   */
  static createMetadata(
    page: number,
    limit: number,
    total: number
  ): PaginationMetadata {
    const totalPages = Math.ceil(total / limit)
    const hasNext = page < totalPages
    const hasPrev = page > 1
    
    return {
      page,
      limit,
      total,
      totalPages,
      hasNext,
      hasPrev,
      ...(hasNext && { nextPage: page + 1 }),
      ...(hasPrev && { prevPage: page - 1 })
    }
  }
  
  /**
   * Create pagination links for HATEOAS-style API
   */
  static createLinks(
    baseUrl: string,
    pagination: PaginationMetadata,
    additionalParams: Record<string, string> = {}
  ): PaginatedResponse<unknown>['links'] {
    const createUrl = (page: number) => {
      const url = new URL(baseUrl)
      url.searchParams.set('page', page.toString())
      url.searchParams.set('limit', pagination.limit.toString())
      
      // Add additional parameters
      Object.entries(additionalParams).forEach(([key, value]) => {
        if (value) url.searchParams.set(key, value)
      })
      
      return url.toString()
    }
    
    const links: PaginatedResponse<unknown>['links'] = {
      self: createUrl(pagination.page),
      first: createUrl(1),
      last: createUrl(pagination.totalPages)
    }
    
    if (pagination.hasNext) {
      links.next = createUrl(pagination.nextPage!)
    }
    
    if (pagination.hasPrev) {
      links.prev = createUrl(pagination.prevPage!)
    }
    
    return links
  }
  
  /**
   * Create complete paginated response
   */
  static createPaginatedResponse<T>(
    data: T[],
    total: number,
    params: PaginationParams,
    baseUrl: string,
    additionalParams: Record<string, string> = {}
  ): PaginatedResponse<T> {
    const pagination = this.createMetadata(params.page, params.limit, total)
    const links = this.createLinks(baseUrl, pagination, additionalParams)
    
    return {
      data,
      pagination,
      links
    }
  }
  
  /**
   * Validate pagination parameters
   */
  static validateParams(params: PaginationParams): { valid: boolean; errors: string[] } {
    const errors: string[] = []
    
    if (params.page < 1) {
      errors.push('Page must be greater than 0')
    }
    
    if (params.limit < 1) {
      errors.push('Limit must be greater than 0')
    }
    

    if (params.sortOrder && !['asc', 'desc'].includes(params.sortOrder)) {
      errors.push('Sort order must be "asc" or "desc"')
    }
    
    return {
      valid: errors.length === 0,
      errors
    }
  }
}

/**
 * Database pagination helper for Supabase
 */
export class DatabasePagination {
  
  /**
   * Apply pagination to Supabase query
   */
  static applyPagination<TQuery extends {
    order: (column: string, options: { ascending: boolean }) => TQuery
    range: (from: number, to: number) => TQuery
  }>(
    query: TQuery,
    params: PaginationParams
  ) {
    return query
      .order(params.sortBy || 'created_at', { ascending: params.sortOrder === 'asc' })
      .range(params.offset, params.offset + params.limit - 1)
  }
  
  /**
   * Get total count for pagination
   */
  static async getTotalCount(
    supabase: SupabaseClient<GenericSupabaseSchema>,
    tableName: string,
    filters?: Record<string, unknown>
  ): Promise<number> {
    let query = supabase
      .from(tableName)
      .select('*', { count: 'exact', head: true })
    
    // Apply filters if provided
    if (filters) {
      Object.entries(filters).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          query = query.eq(key, value)
        }
      })
    }
    
    const { count, error } = await query

    if (error) {
      logger.error('Total count query error', error, { tableName, filters })
      return 0
    }

    return count || 0
  }
}

/**
 * Cursor-based pagination for large datasets
 * More efficient for large collections
 */
export class CursorPagination {
  
  /**
   * Parse cursor pagination parameters
   */
  static parseParams(request: NextRequest) {
    const { searchParams } = new URL(request.url)
    
    return {
      cursor: searchParams.get('cursor'),
      limit: Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '20'))),
      sortBy: searchParams.get('sort_by') || 'created_at',
      sortOrder: (searchParams.get('sort_order') || 'desc').toLowerCase() as 'asc' | 'desc'
    }
  }
  
  /**
   * Apply cursor pagination to Supabase query
   */
  static applyCursorPagination<TQuery extends {
    order: (column: string, options: { ascending: boolean }) => TQuery
    gt?: (column: string, value: unknown) => TQuery
    lt?: (column: string, value: unknown) => TQuery
    limit: (count: number) => TQuery
  }>(
    query: TQuery,
    cursor: string | null,
    limit: number,
    sortBy: string = 'created_at',
    sortOrder: 'asc' | 'desc' = 'desc'
  ) {
    let paginatedQuery = query.order(sortBy, { ascending: sortOrder === 'asc' })
    
    if (cursor) {
      // Apply cursor filtering
      const operator = sortOrder === 'asc' ? 'gt' : 'lt'
      if (operator === 'gt' && typeof paginatedQuery.gt === 'function') {
        paginatedQuery = paginatedQuery.gt(sortBy, cursor)
      } else if (operator === 'lt' && typeof paginatedQuery.lt === 'function') {
        paginatedQuery = paginatedQuery.lt(sortBy, cursor)
      }
    }
    
    return paginatedQuery.limit(limit + 1) // +1 to check if there are more results
  }
  
  /**
   * Create cursor pagination response
   */
  static createCursorResponse<T extends Record<string, unknown>>(
    data: T[],
    limit: number,
    sortBy: string = 'created_at'
  ) {
    const hasMore = data.length > limit
    const results = hasMore ? data.slice(0, limit) : data
    
    let nextCursor: string | null = null
    if (hasMore && results.length > 0) {
      const lastItem = results[results.length - 1]
      const cursorCandidate = lastItem?.[sortBy]
      nextCursor = typeof cursorCandidate === 'string' ? cursorCandidate : null
    }
    
    return {
      data: results,
      hasMore,
      nextCursor,
      count: results.length
    }
  }
}

export default PaginationUtils
