/**
 * API Response Utilities
 * Standardized response formatters for consistent API responses
 */

import { NextResponse } from 'next/server'
import { ERROR_CODES, HTTP_STATUS, type ErrorCode } from '@/lib/constants'

// =============================================================================
// TYPES
// =============================================================================

export interface ApiErrorResponse {
  error: string
  code: ErrorCode
  details?: string
  timestamp: string
}

export interface ApiSuccessResponse<T = unknown> {
  success: true
  data: T
  timestamp?: string
}

// =============================================================================
// ERROR RESPONSE HELPERS
// =============================================================================

/**
 * Create a standardized error response
 *
 * @param message - Human-readable error message
 * @param code - Error code from ERROR_CODES constant
 * @param status - HTTP status code
 * @param details - Additional error details (only included in development)
 * @returns NextResponse with standardized error format
 *
 * @example
 * return apiError('Document not found', ERROR_CODES.DOCUMENT_NOT_FOUND, HTTP_STATUS.NOT_FOUND)
 */
export function apiError(
  message: string,
  code: ErrorCode,
  status: number = HTTP_STATUS.INTERNAL_SERVER_ERROR,
  details?: string
): NextResponse<ApiErrorResponse> {
  const response: ApiErrorResponse = {
    error: message,
    code,
    timestamp: new Date().toISOString(),
  }

  // Only include details in development mode
  if (process.env.NODE_ENV === 'development' && details) {
    response.details = details
  }

  return NextResponse.json(response, { status })
}

/**
 * Create an unauthorized error response (401)
 */
export function unauthorizedError(message: string = 'Unauthorized', details?: string) {
  return apiError(message, ERROR_CODES.UNAUTHORIZED, HTTP_STATUS.UNAUTHORIZED, details)
}

/**
 * Create a forbidden error response (403)
 */
export function forbiddenError(message: string = 'Forbidden', details?: string) {
  return apiError(message, ERROR_CODES.FORBIDDEN, HTTP_STATUS.FORBIDDEN, details)
}

/**
 * Create a not found error response (404)
 */
export function notFoundError(message: string = 'Resource not found', details?: string) {
  return apiError(message, ERROR_CODES.NOT_FOUND, HTTP_STATUS.NOT_FOUND, details)
}

/**
 * Create a validation error response (400)
 */
export function validationError(message: string, details?: string) {
  return apiError(message, ERROR_CODES.VALIDATION_ERROR, HTTP_STATUS.BAD_REQUEST, details)
}

/**
 * Create a rate limit error response (429)
 */
export function rateLimitError(message: string = 'Too many requests', details?: string) {
  return apiError(message, ERROR_CODES.RATE_LIMIT_EXCEEDED, HTTP_STATUS.TOO_MANY_REQUESTS, details)
}

/**
 * Create a database error response (500)
 */
export function databaseError(message: string = 'Database operation failed', details?: string) {
  return apiError(message, ERROR_CODES.DATABASE_ERROR, HTTP_STATUS.INTERNAL_SERVER_ERROR, details)
}

/**
 * Create a timeout error response (504)
 */
export function timeoutError(message: string = 'Request timed out', details?: string) {
  return apiError(message, ERROR_CODES.TIMEOUT, HTTP_STATUS.GATEWAY_TIMEOUT, details)
}

/**
 * Create an external service error response (502)
 */
export function externalServiceError(message: string = 'External service error', details?: string) {
  return apiError(message, ERROR_CODES.EXTERNAL_SERVICE_ERROR, HTTP_STATUS.BAD_GATEWAY, details)
}

// =============================================================================
// SUCCESS RESPONSE HELPERS
// =============================================================================

/**
 * Create a standardized success response
 *
 * @param data - Response data
 * @param status - HTTP status code (default 200)
 * @param includeTimestamp - Whether to include timestamp (default false)
 * @returns NextResponse with standardized success format
 *
 * @example
 * return apiSuccess({ document: doc }, HTTP_STATUS.CREATED)
 */
export function apiSuccess<T>(
  data: T,
  status: number = HTTP_STATUS.OK,
  includeTimestamp: boolean = false
): NextResponse<ApiSuccessResponse<T>> {
  const response: ApiSuccessResponse<T> = {
    success: true,
    data,
  }

  if (includeTimestamp) {
    response.timestamp = new Date().toISOString()
  }

  return NextResponse.json(response, { status })
}

/**
 * Create a created response (201)
 */
export function createdResponse<T>(data: T) {
  return apiSuccess(data, HTTP_STATUS.CREATED, true)
}

/**
 * Create a no content response (204)
 */
export function noContentResponse() {
  return new NextResponse(null, { status: HTTP_STATUS.NO_CONTENT })
}

// =============================================================================
// ERROR CONVERSION HELPERS
// =============================================================================

/**
 * Convert a caught error to a standardized API error response
 *
 * @param error - The caught error
 * @param fallbackMessage - Fallback message if error is not an Error instance
 * @param fallbackCode - Fallback error code
 * @returns NextResponse with standardized error format
 *
 * @example
 * try {
 *   // ... code
 * } catch (error) {
 *   return handleApiError(error, 'Failed to process document')
 * }
 */
export function handleApiError(
  error: unknown,
  fallbackMessage: string = 'An unexpected error occurred',
  fallbackCode: ErrorCode = ERROR_CODES.INTERNAL_ERROR
): NextResponse<ApiErrorResponse> {
  // Extract error message
  const message = error instanceof Error ? error.message : String(error)
  const details = error instanceof Error ? error.stack : undefined

  // Try to infer error code from message
  let errorCode = fallbackCode

  if (message.includes('not found')) {
    errorCode = ERROR_CODES.NOT_FOUND
  } else if (message.includes('unauthorized') || message.includes('authentication')) {
    errorCode = ERROR_CODES.UNAUTHORIZED
  } else if (message.includes('forbidden') || message.includes('permission')) {
    errorCode = ERROR_CODES.FORBIDDEN
  } else if (message.includes('validation') || message.includes('invalid')) {
    errorCode = ERROR_CODES.VALIDATION_ERROR
  } else if (message.includes('timeout') || message.includes('timed out')) {
    errorCode = ERROR_CODES.TIMEOUT
  } else if (message.includes('rate limit')) {
    errorCode = ERROR_CODES.RATE_LIMIT_EXCEEDED
  }

  return apiError(
    fallbackMessage,
    errorCode,
    HTTP_STATUS.INTERNAL_SERVER_ERROR,
    details
  )
}
