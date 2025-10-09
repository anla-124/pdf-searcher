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
                        process.env['DEBUG_LOGS'] ||
                        process.env['LOG_LEVEL']
  
  // Parse the verbose logs setting
  let verboseLogs = false
  if (verboseLogsRaw) {
    verboseLogs = verboseLogsRaw.toLowerCase() === 'true' || 
                  verboseLogsRaw.toLowerCase() === 'debug' ||
                  verboseLogsRaw === '1'
  }
  
  // In production, be more verbose by default
  if (isProduction && verboseLogsRaw === undefined) {
    verboseLogs = true
  }
  
  return {
    verboseLogs,
    
    // Derive all other settings from verboseLogs
    logLevel: verboseLogs ? 'debug' : (isProduction ? 'info' : 'warn'),
    logRequestStart: verboseLogs || isProduction,
    logRequestSuccess: verboseLogs || isProduction,
    logHeaders: verboseLogs || isProduction,
    logDatabaseQueries: verboseLogs,
    logCacheOperations: verboseLogs,
    logDocumentProcessing: verboseLogs || isProduction, // Always log document processing in production
    logSimilaritySearch: verboseLogs,
    logPerformanceMetrics: verboseLogs || isProduction
  }
}

// Create singleton configuration
export const loggingConfig = createLoggingConfig()

/**
 * Helper functions for common logging decisions
 */
export const shouldLog = {
  requestStart: () => loggingConfig.logRequestStart,
  requestSuccess: () => loggingConfig.logRequestSuccess,
  headers: () => loggingConfig.logHeaders,
  databaseQueries: () => loggingConfig.logDatabaseQueries,
  cacheOperations: () => loggingConfig.logCacheOperations,
  documentProcessing: () => loggingConfig.logDocumentProcessing,
  similaritySearch: () => loggingConfig.logSimilaritySearch,
  performanceMetrics: () => loggingConfig.logPerformanceMetrics,
  
  // Convenience methods
  debug: () => loggingConfig.verboseLogs,
  verbose: () => loggingConfig.verboseLogs
}

/**
 * Debug helper to show current logging configuration
 */
export function debugLoggingConfig(): void {
  if (loggingConfig.verboseLogs) {
    console.warn('🔧 Logging Configuration:', {
      verboseLogs: loggingConfig.verboseLogs,
      logLevel: loggingConfig.logLevel,
      environment: process.env['NODE_ENV'],
      environmentVariable: process.env['VERBOSE_LOGS'],
      allSettings: loggingConfig
    })
  }
}