/**
 * Centralized logging configuration
 * Controls all logging verbosity from a single environment variable
 */

export interface LoggingConfig {
  // Main toggle
  verboseLogs: boolean

  // Derived settings
  logLevel: 'error' | 'warn' | 'info' | 'debug'
  logRequestStart: boolean
  logRequestSuccess: boolean
  logHeaders: boolean
  logDatabaseQueries: boolean
  logCacheOperations: boolean
  logDocumentProcessing: boolean
  logSimilaritySearch: boolean
  logPerformanceMetrics: boolean
}

/**
 * Parse environment variables and create logging configuration
 */
function createLoggingConfig(): LoggingConfig {
  const isProduction = process.env['NODE_ENV'] === 'production'

  // Check multiple possible environment variables
  const verboseLogsRaw = process.env['VERBOSE_LOGS'] ||
                        process.env['ENABLE_VERBOSE_LOGS'] ||
                        process.env['DEBUG'] ||
                        ''

  const verboseLogs = verboseLogsRaw.toLowerCase() === 'true' ||
                     verboseLogsRaw === '1'

  return {
    verboseLogs,
    logLevel: verboseLogs ? 'debug' : (isProduction ? 'warn' : 'info'),
    logRequestStart: verboseLogs,
    logRequestSuccess: verboseLogs,
    logHeaders: verboseLogs && !isProduction,
    logDatabaseQueries: verboseLogs,
    logCacheOperations: verboseLogs,
    logDocumentProcessing: true, // Always log document processing
    logSimilaritySearch: verboseLogs,
    logPerformanceMetrics: verboseLogs
  }
}

/**
 * Debug logging configuration (includes everything)
 */
export const debugLoggingConfig: LoggingConfig = {
  verboseLogs: true,
  logLevel: 'debug',
  logRequestStart: true,
  logRequestSuccess: true,
  logHeaders: true,
  logDatabaseQueries: true,
  logCacheOperations: true,
  logDocumentProcessing: true,
  logSimilaritySearch: true,
  logPerformanceMetrics: true
}

/**
 * Default logging configuration
 */
export const loggingConfig: LoggingConfig = createLoggingConfig()
