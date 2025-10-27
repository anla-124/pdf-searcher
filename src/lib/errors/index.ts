/**
 * Standardized error handling system for PDF Searcher
 * Custom error classes and global error boundaries
 */

import { logger } from '@/lib/logger'
import { NextResponse } from 'next/server'

// Base error class with correlation tracking
export abstract class BaseError extends Error {
  abstract readonly code: string
  abstract readonly statusCode: number
  public readonly correlationId?: string
  public readonly timestamp: Date
  public readonly context?: Record<string, unknown>

  constructor(
    message: string, 
    correlationId?: string, 
    context?: Record<string, unknown>
  ) {
    super(message)
    this.name = this.constructor.name
    if (correlationId !== undefined) {
      this.correlationId = correlationId
    }
    this.timestamp = new Date()
    if (context !== undefined) {
      this.context = context
    }
    
    // Ensure stack trace points to the actual error location
    Error.captureStackTrace(this, this.constructor)
  }

  toJSON() {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      statusCode: this.statusCode,
      correlationId: this.correlationId,
      timestamp: this.timestamp.toISOString(),
      context: this.context,
      stack: this.stack
    }
  }
}

// Validation Errors
export class ValidationError extends BaseError {
  readonly code = 'VALIDATION_ERROR'
  readonly statusCode = 400
  readonly field?: string
  readonly invalidValue?: unknown

  constructor(
    message: string,
    field?: string,
    invalidValue?: unknown,
    correlationId?: string,
    context?: Record<string, unknown>
  ) {
    super(message, correlationId, context)
    if (field !== undefined) {
      this.field = field
    }
    if (invalidValue !== undefined) {
      this.invalidValue = invalidValue
    }
  }

  toJSON() {
    return {
      ...super.toJSON(),
      field: this.field,
      invalidValue: this.invalidValue
    }
  }
}

// Authentication Errors
export class AuthenticationError extends BaseError {
  readonly code = 'AUTHENTICATION_ERROR'
  readonly statusCode = 401
  readonly reason?: string

  constructor(
    message: string = 'Authentication required',
    reason?: string,
    correlationId?: string,
    context?: Record<string, unknown>
  ) {
    super(message, correlationId, context)
    if (reason !== undefined) {
      this.reason = reason
    }
  }

  toJSON() {
    return {
      ...super.toJSON(),
      reason: this.reason
    }
  }
}

// Authorization Errors
export class AuthorizationError extends BaseError {
  readonly code = 'AUTHORIZATION_ERROR'
  readonly statusCode = 403
  readonly requiredPermission?: string
  readonly userPermissions?: string[]

  constructor(
    message: string = 'Insufficient permissions',
    requiredPermission?: string,
    userPermissions?: string[],
    correlationId?: string,
    context?: Record<string, unknown>
  ) {
    super(message, correlationId, context)
    if (requiredPermission !== undefined) {
      this.requiredPermission = requiredPermission
    }
    if (userPermissions !== undefined) {
      this.userPermissions = userPermissions
    }
  }

  toJSON() {
    return {
      ...super.toJSON(),
      requiredPermission: this.requiredPermission,
      userPermissions: this.userPermissions
    }
  }
}

// Resource Not Found Errors
export class NotFoundError extends BaseError {
  readonly code = 'NOT_FOUND_ERROR'
  readonly statusCode = 404
  readonly resourceType?: string
  readonly resourceId?: string

  constructor(
    message: string,
    resourceType?: string,
    resourceId?: string,
    correlationId?: string,
    context?: Record<string, unknown>
  ) {
    super(message, correlationId, context)
    if (resourceType !== undefined) {
      this.resourceType = resourceType
    }
    if (resourceId !== undefined) {
      this.resourceId = resourceId
    }
  }

  toJSON() {
    return {
      ...super.toJSON(),
      resourceType: this.resourceType,
      resourceId: this.resourceId
    }
  }
}

// Rate Limiting Errors
export class RateLimitError extends BaseError {
  readonly code = 'RATE_LIMIT_ERROR'
  readonly statusCode = 429
  readonly resetTime?: Date
  readonly limit?: number
  readonly remaining?: number

  constructor(
    message: string = 'Rate limit exceeded',
    resetTime?: Date,
    limit?: number,
    remaining?: number,
    correlationId?: string,
    context?: Record<string, unknown>
  ) {
    super(message, correlationId, context)
    if (resetTime !== undefined) {
      this.resetTime = resetTime
    }
    if (limit !== undefined) {
      this.limit = limit
    }
    if (remaining !== undefined) {
      this.remaining = remaining
    }
  }

  toJSON() {
    return {
      ...super.toJSON(),
      resetTime: this.resetTime?.toISOString(),
      limit: this.limit,
      remaining: this.remaining
    }
  }
}

// Database Errors
export class DatabaseError extends BaseError {
  readonly code = 'DATABASE_ERROR'
  readonly statusCode = 500
  readonly operation?: string
  readonly table?: string
  readonly query?: string

  constructor(
    message: string,
    operation?: string,
    table?: string,
    query?: string,
    correlationId?: string,
    context?: Record<string, unknown>
  ) {
    super(message, correlationId, context)
    if (operation !== undefined) {
      this.operation = operation
    }
    if (table !== undefined) {
      this.table = table
    }
    if (query !== undefined) {
      this.query = query
    }
  }

  toJSON() {
    return {
      ...super.toJSON(),
      operation: this.operation,
      table: this.table,
      query: this.query
    }
  }
}

// External Service Errors
export class ExternalServiceError extends BaseError {
  readonly code = 'EXTERNAL_SERVICE_ERROR'
  readonly statusCode = 502
  readonly service?: string
  readonly serviceStatusCode?: number
  readonly serviceResponse?: unknown

  constructor(
    message: string,
    service?: string,
    serviceStatusCode?: number,
    serviceResponse?: unknown,
    correlationId?: string,
    context?: Record<string, unknown>
  ) {
    super(message, correlationId, context)
    if (service !== undefined) {
      this.service = service
    }
    if (serviceStatusCode !== undefined) {
      this.serviceStatusCode = serviceStatusCode
    }
    if (serviceResponse !== undefined) {
      this.serviceResponse = serviceResponse
    }
  }

  toJSON() {
    return {
      ...super.toJSON(),
      service: this.service,
      serviceStatusCode: this.serviceStatusCode,
      serviceResponse: this.serviceResponse
    }
  }
}

// Document Processing Errors
export class DocumentProcessingError extends BaseError {
  readonly code = 'DOCUMENT_PROCESSING_ERROR'
  readonly statusCode = 422
  readonly documentId?: string
  readonly stage?: string
  readonly processingDetails?: Record<string, unknown>

  constructor(
    message: string,
    documentId?: string,
    stage?: string,
    processingDetails?: Record<string, unknown>,
    correlationId?: string,
    context?: Record<string, unknown>
  ) {
    super(message, correlationId, context)
    if (documentId !== undefined) {
      this.documentId = documentId
    }
    if (stage !== undefined) {
      this.stage = stage
    }
    if (processingDetails !== undefined) {
      this.processingDetails = processingDetails
    }
  }

  toJSON() {
    return {
      ...super.toJSON(),
      documentId: this.documentId,
      stage: this.stage,
      processingDetails: this.processingDetails
    }
  }
}

// Configuration Errors
export class ConfigurationError extends BaseError {
  readonly code = 'CONFIGURATION_ERROR'
  readonly statusCode = 500
  readonly configKey?: string
  readonly expectedType?: string
  readonly actualValue?: unknown

  constructor(
    message: string,
    configKey?: string,
    expectedType?: string,
    actualValue?: unknown,
    correlationId?: string,
    context?: Record<string, unknown>
  ) {
    super(message, correlationId, context)
    if (configKey !== undefined) {
      this.configKey = configKey
    }
    if (expectedType !== undefined) {
      this.expectedType = expectedType
    }
    if (actualValue !== undefined) {
      this.actualValue = actualValue
    }
  }

  toJSON() {
    return {
      ...super.toJSON(),
      configKey: this.configKey,
      expectedType: this.expectedType,
      actualValue: this.actualValue
    }
  }
}

// Business Logic Errors
export class BusinessLogicError extends BaseError {
  readonly code = 'BUSINESS_LOGIC_ERROR'
  readonly statusCode = 422
  readonly businessRule?: string
  readonly currentState?: Record<string, unknown>

  constructor(
    message: string,
    businessRule?: string,
    currentState?: Record<string, unknown>,
    correlationId?: string,
    context?: Record<string, unknown>
  ) {
    super(message, correlationId, context)
    if (businessRule !== undefined) {
      this.businessRule = businessRule
    }
    if (currentState !== undefined) {
      this.currentState = currentState
    }
  }

  toJSON() {
    return {
      ...super.toJSON(),
      businessRule: this.businessRule,
      currentState: this.currentState
    }
  }
}

// Global Error Handler
export class ErrorHandler {
  /**
   * Handle and format errors for API responses
   */
  static handleApiError(error: unknown, correlationId?: string): NextResponse {
    // If it's already one of our custom errors, use it directly
    if (error instanceof BaseError) {
      const logMetadata: Record<string, unknown> = {
        code: error.code,
        statusCode: error.statusCode
      }
      
      if (error.correlationId || correlationId) {
        logMetadata.correlationId = error.correlationId || correlationId
      }
      
      if (error.context) {
        logMetadata.context = error.context
      }
      
      logger.error(`${error.constructor.name}: ${error.message}`, error, logMetadata)

      return NextResponse.json(
        {
          error: {
            code: error.code,
            message: error.message,
            correlationId: error.correlationId || correlationId,
            timestamp: error.timestamp.toISOString(),
            ...(process.env.NODE_ENV === 'development' && {
              stack: error.stack,
              context: error.context
            })
          }
        },
        { 
          status: error.statusCode,
          headers: {
            'x-correlation-id': error.correlationId || correlationId || '',
            'x-error-code': error.code
          }
        }
      )
    }

    // Handle standard JavaScript errors
    if (error instanceof Error) {
      const errorMetadata: Record<string, unknown> = {
        errorType: 'unhandled'
      }
      
      if (correlationId) {
        errorMetadata.correlationId = correlationId
      }
      
      logger.error('Unhandled error', error, errorMetadata)

      return NextResponse.json(
        {
          error: {
            code: 'INTERNAL_SERVER_ERROR',
            message: process.env.NODE_ENV === 'development' 
              ? error.message 
              : 'An internal server error occurred',
            correlationId,
            timestamp: new Date().toISOString(),
            ...(process.env.NODE_ENV === 'development' && {
              stack: error.stack
            })
          }
        },
        { 
          status: 500,
          headers: {
            'x-correlation-id': correlationId || '',
            'x-error-code': 'INTERNAL_SERVER_ERROR'
          }
        }
      )
    }

    // Handle unknown errors
    const unknownErrorMetadata: Record<string, unknown> = {
      errorValue: error,
      errorType: typeof error
    }
    
    if (correlationId) {
      unknownErrorMetadata.correlationId = correlationId
    }
    
    logger.error('Unknown error type', undefined, unknownErrorMetadata)

    return NextResponse.json(
      {
        error: {
          code: 'UNKNOWN_ERROR',
          message: 'An unknown error occurred',
          correlationId,
          timestamp: new Date().toISOString()
        }
      },
      { 
        status: 500,
        headers: {
          'x-correlation-id': correlationId || '',
          'x-error-code': 'UNKNOWN_ERROR'
        }
      }
    )
  }

  /**
   * Convert common errors to custom error classes
   */
  static normalizeError(error: unknown, correlationId?: string): BaseError {
    if (error instanceof BaseError) {
      return error
    }

    if (error instanceof Error) {
      // Check for specific error patterns and convert to appropriate custom errors
      const message = error.message.toLowerCase()

      // Database errors
      if (message.includes('duplicate key') || message.includes('unique constraint')) {
        return new ValidationError(
          'Resource already exists',
          undefined,
          undefined,
          correlationId,
          { originalError: error.message }
        )
      }

      if (message.includes('foreign key') || message.includes('references')) {
        return new ValidationError(
          'Referenced resource does not exist',
          undefined,
          undefined,
          correlationId,
          { originalError: error.message }
        )
      }

      if (message.includes('not found') || message.includes('does not exist')) {
        return new NotFoundError(
          error.message,
          undefined,
          undefined,
          correlationId,
          { originalError: error.message }
        )
      }

      // Network/timeout errors
      if (message.includes('timeout') || message.includes('network')) {
        return new ExternalServiceError(
          error.message,
          'unknown',
          undefined,
          undefined,
          correlationId,
          { originalError: error.message }
        )
      }

      // Return as generic validation error (as fallback)
      return new ValidationError(
        error.message,
        undefined,
        undefined,
        correlationId,
        { originalError: error.message, stack: error.stack }
      )
    }

    // For non-Error objects, create a generic error
    return new ValidationError(
      'Unknown error occurred',
      undefined,
      undefined,
      correlationId,
      { originalError: String(error) }
    )
  }
}

// Error boundary for async operations
export function withErrorBoundary<T extends unknown[], R>(
  fn: (...args: T) => Promise<R>,
  correlationId?: string
): (...args: T) => Promise<R> {
  return async (...args: T): Promise<R> => {
    try {
      return await fn(...args)
    } catch (error) {
      const normalizedError = ErrorHandler.normalizeError(error, correlationId)
      throw normalizedError
    }
  }
}

// Utility functions
export const createError = {
  validation: (message: string, field?: string, value?: unknown, correlationId?: string) =>
    new ValidationError(message, field, value, correlationId),
  
  auth: (message?: string, reason?: string, correlationId?: string) =>
    new AuthenticationError(message, reason, correlationId),
  
  authz: (message?: string, permission?: string, userPerms?: string[], correlationId?: string) =>
    new AuthorizationError(message, permission, userPerms, correlationId),
  
  notFound: (message: string, type?: string, id?: string, correlationId?: string) =>
    new NotFoundError(message, type, id, correlationId),
  
  rateLimit: (message?: string, resetTime?: Date, limit?: number, remaining?: number, correlationId?: string) =>
    new RateLimitError(message, resetTime, limit, remaining, correlationId),
  
  database: (message: string, operation?: string, table?: string, correlationId?: string) =>
    new DatabaseError(message, operation, table, undefined, correlationId),
  
  external: (message: string, service?: string, statusCode?: number, response?: unknown, correlationId?: string) =>
    new ExternalServiceError(message, service, statusCode, response, correlationId),
  
  processing: (message: string, documentId?: string, stage?: string, correlationId?: string) =>
    new DocumentProcessingError(message, documentId, stage, undefined, correlationId),
  
  config: (message: string, key?: string, expectedType?: string, value?: unknown, correlationId?: string) =>
    new ConfigurationError(message, key, expectedType, value, correlationId),
  
  business: (message: string, rule?: string, state?: Record<string, unknown>, correlationId?: string) =>
    new BusinessLogicError(message, rule, state, correlationId)
}

export default ErrorHandler
