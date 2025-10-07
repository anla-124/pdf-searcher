/**
 * Enterprise-grade structured logging system
 * Supports both Winston and Pino loggers with request correlation
 */

import winston from 'winston'
import pino from 'pino'
import { AsyncLocalStorage } from 'async_hooks'
import { loggingConfig, debugLoggingConfig } from './logger-config'

// Request context storage for correlation IDs
const asyncLocalStorage = new AsyncLocalStorage<RequestContext>()

interface RequestContext {
  correlationId: string
  userId?: string
  sessionId?: string
  requestId: string
  startTime: number
  path?: string
  method?: string
}

interface LogMetadata {
  correlationId?: string
  userId?: string
  sessionId?: string
  requestId?: string
  duration?: number
  path?: string
  method?: string
  statusCode?: number
  component?: string
  operation?: string
  documentId?: string
  processingStage?: string
  errorCode?: string
  [key: string]: unknown
}

interface PerformanceMetrics {
  operation: string
  duration: number
  success: boolean
  component: string
  metadata?: Record<string, unknown>
}

// Logger configuration based on environment
const isDevelopment = process.env['NODE_ENV'] === 'development'
const isProduction = process.env['NODE_ENV'] === 'production'
const isTest = process.env['NODE_ENV'] === 'test'

// Winston Logger Configuration
const createWinstonLogger = () => {
  const transports: winston.transport[] = []

  // Console transport for development
  if (isDevelopment || isTest) {
    transports.push(
      new winston.transports.Console({
        format: winston.format.combine(
          winston.format.colorize(),
          winston.format.timestamp(),
          winston.format.errors({ stack: true }),
          winston.format.printf(({ timestamp, level, message, ...meta }) => {
            const context = asyncLocalStorage.getStore()
            const correlationId = context?.correlationId || meta['correlationId'] || 'no-correlation'
            const metaStr = Object.keys(meta).length > 0 ? JSON.stringify(meta, null, 2) : ''
            return `${timestamp} [${level}] [${correlationId}] ${message} ${metaStr}`
          })
        )
      })
    )
  }

  // File transports for production
  if (isProduction) {
    transports.push(
      new winston.transports.File({
        filename: 'logs/error.log',
        level: 'error',
        format: winston.format.combine(
          winston.format.timestamp(),
          winston.format.errors({ stack: true }),
          winston.format.json()
        )
      }),
      new winston.transports.File({
        filename: 'logs/combined.log',
        format: winston.format.combine(
          winston.format.timestamp(),
          winston.format.errors({ stack: true }),
          winston.format.json()
        )
      })
    )
  }

  return winston.createLogger({
    level: loggingConfig.logLevel,
    defaultMeta: {
      service: 'pdf-searcher',
      version: process.env['APP_VERSION'] || '1.0.0',
      environment: process.env['NODE_ENV'] || 'development'
    },
    transports,
    exitOnError: false
  })
}

// Pino Logger Configuration (faster, better for high-throughput)
const createPinoLogger = () => {
  const pinoConfig: pino.LoggerOptions = {
    level: loggingConfig.logLevel,
    base: {
      service: 'pdf-searcher',
      version: process.env['APP_VERSION'] || '1.0.0',
      environment: process.env['NODE_ENV'] || 'development'
    },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      level(label) {
        return { level: label }
      }
    }
  }

  // Pretty printing for development (no worker threads to avoid Next.js issues)
  if (isDevelopment && !isTest) {
    try {
      return pino({
        ...pinoConfig,
        transport: {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'yyyy-mm-dd HH:MM:ss',
            ignore: 'pid,hostname'
          }
        }
      })
    } catch (_error) {
      // Fallback to basic pino if pretty printing fails
      console.warn('Failed to initialize pino-pretty, falling back to basic logger:', _error)
      return pino(pinoConfig)
    }
  }

  return pino(pinoConfig)
}

// Choose logger based on preference (Winston for development, Pino for production)
const useWinston = process.env['USE_WINSTON'] === 'true' || isDevelopment
const winstonLogger = useWinston ? createWinstonLogger() : null
const pinoLogger = !useWinston ? createPinoLogger() : null

// Unified Logger Interface
class Logger {
  private winston?: winston.Logger
  private pino?: pino.Logger

  constructor() {
    if (winstonLogger) {
      this.winston = winstonLogger
    }
    if (pinoLogger) {
      this.pino = pinoLogger
    }
  }

  private enrichMetadata(meta: LogMetadata = {}): LogMetadata {
    try {
      const context = asyncLocalStorage.getStore()
      if (context) {
        return {
          correlationId: context.correlationId,
          ...(context.userId && { userId: context.userId }),
          requestId: context.requestId,
          ...meta
        }
      }
    } catch (_error) {
      // Silently handle async context errors
    }
    return meta
  }

  debug(message: string, meta: LogMetadata = {}): void {
    const enrichedMeta = this.enrichMetadata(meta)
    if (this.winston) {
      this.winston.debug(message, enrichedMeta)
    }
    if (this.pino) {
      try {
        this.pino.debug(enrichedMeta, message)
      } catch (_error) {
        // Fallback to console in case of pino issues
        console.debug('[DEBUG]', message, enrichedMeta)
      }
    }
  }

  info(message: string, meta: LogMetadata = {}): void {
    const enrichedMeta = this.enrichMetadata(meta)
    if (this.winston) {
      this.winston.info(message, enrichedMeta)
    }
    if (this.pino) {
      try {
        this.pino.info(enrichedMeta, message)
      } catch (_error) {
        // Fallback to console in case of pino issues
        console.info('[INFO]', message, enrichedMeta)
      }
    }
  }

  warn(message: string, meta: LogMetadata = {}): void {
    const enrichedMeta = this.enrichMetadata(meta)
    if (this.winston) {
      this.winston.warn(message, enrichedMeta)
    }
    if (this.pino) {
      try {
        this.pino.warn(enrichedMeta, message)
      } catch (_error) {
        // Fallback to console in case of pino issues
        console.warn('[WARN]', message, enrichedMeta)
      }
    }
  }

  error(message: string, error?: Error, meta: LogMetadata = {}): void {
    const enrichedMeta = this.enrichMetadata({
      ...meta,
      error: error ? {
        message: error.message,
        stack: error.stack,
        name: error.name
      } : undefined
    })
    
    if (this.winston) {
      this.winston.error(message, enrichedMeta)
    }
    if (this.pino) {
      try {
        this.pino.error(enrichedMeta, message)
      } catch (_error) {
        // Fallback to console in case of pino issues
        console.error('[ERROR]', message, enrichedMeta)
      }
    }
  }

  // Performance logging
  logPerformance(metrics: PerformanceMetrics): void {
    this.info('Performance metric recorded', {
      component: 'performance',
      operation: metrics.operation,
      duration: metrics.duration,
      success: metrics.success,
      performanceComponent: metrics.component,
      ...metrics.metadata
    })
  }

  // Document processing specific logging
  logDocumentProcessing(
    stage: string,
    documentId: string,
    status: 'started' | 'progress' | 'completed' | 'failed',
    meta: LogMetadata = {}
  ): void {
    const logMessage = `Document processing ${status}: ${stage}`
    const logMeta = {
      ...meta,
      component: 'document-processing',
      processingStage: stage,
      documentId,
      status
    }

    if (status === 'failed') {
      this.error(logMessage, undefined, logMeta)
    } else {
      this.info(logMessage, logMeta)
    }
  }

  // API request logging
  logApiRequest(
    method: string,
    path: string,
    statusCode: number,
    duration: number,
    meta: LogMetadata = {}
  ): void {
    this.info('API request completed', {
      ...meta,
      component: 'api',
      method,
      path,
      statusCode,
      duration,
      success: statusCode < 400
    })
  }

  // Database operation logging
  logDatabaseOperation(
    operation: string,
    table: string,
    duration: number,
    success: boolean,
    meta: LogMetadata = {}
  ): void {
    const message = `Database ${operation} on ${table}`
    this.info(message, {
      ...meta,
      component: 'database',
      operation,
      table,
      duration,
      success
    })
  }
}

// Singleton logger instance
export const logger = new Logger()

// Request context management
export const withRequestContext = <T>(
  context: Partial<RequestContext>,
  fn: () => T
): T => {
  const fullContext: RequestContext = {
    correlationId: context.correlationId || generateCorrelationId(),
    requestId: context.requestId || generateRequestId(),
    startTime: context.startTime || Date.now(),
    ...context
  }
  
  return asyncLocalStorage.run(fullContext, fn)
}

export const getRequestContext = (): RequestContext | undefined => {
  return asyncLocalStorage.getStore()
}

// Utility functions
export const generateCorrelationId = (): string => {
  return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
}

export const generateRequestId = (): string => {
  return `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
}

// Performance measurement utility
export const measurePerformance = async <T>(
  operation: string,
  component: string,
  fn: () => Promise<T>,
  metadata?: Record<string, unknown>
): Promise<T> => {
  const startTime = Date.now()
  let success = false
  
  try {
    const result = await fn()
    success = true
    return result
  } catch (error) {
    logger.error(`Operation failed: ${operation}`, error as Error, {
      component,
      operation,
      ...metadata
    })
    throw error
  } finally {
    const duration = Date.now() - startTime
    logger.logPerformance({
      operation,
      component,
      duration,
      success,
      ...(metadata && { metadata })
    })
  }
}

// Express middleware for request correlation
export const requestCorrelationMiddleware = (req: any, res: any, next: any) => {
  const correlationId = req.headers['x-correlation-id'] as string || generateCorrelationId()
  const requestId = generateRequestId()
  
  // Set response header
  res.setHeader('x-correlation-id', correlationId)
  res.setHeader('x-request-id', requestId)
  
  const context: RequestContext = {
    correlationId,
    requestId,
    startTime: Date.now(),
    path: req.path,
    method: req.method,
    userId: req.user?.id,
    sessionId: req.session?.id
  }
  
  asyncLocalStorage.run(context, () => {
    logger.info('API request started', {
      method: req.method,
      path: req.path,
      userAgent: req.headers['user-agent'],
      ip: req.ip
    })
    
    // Log response when finished
    const originalEnd = res.end
    res.end = function(chunk: any, encoding: any) {
      const duration = Date.now() - context.startTime
      logger.logApiRequest(
        context.method!,
        context.path!,
        res.statusCode,
        duration,
        {
          requestSize: req.headers['content-length'],
          responseSize: res.get('content-length')
        }
      )
      originalEnd.call(this, chunk, encoding)
    }
    
    next()
  })
}

export default logger

// Debug logging configuration on startup
debugLoggingConfig()