import { connectionPool } from './pool'

/**
 * Create an authenticated Supabase client with session context
 * Uses connection pooling for better resource management
 */
export const createClient = async () => {
  // For authenticated clients, we still need fresh cookie context per request
  // So we use the pool's authenticated client method
  return await connectionPool.getAuthenticatedClient()
}

/**
 * Create a service role Supabase client from the connection pool
 * Reuses connections for better performance under load
 */
export const createServiceClient = async () => {
  return await connectionPool.getServiceClient()
}

/**
 * Release a service client back to the pool (optional optimization)
 * Call this when you're done with long-running operations
 */
export const releaseServiceClient = (client: any) => {
  connectionPool.releaseServiceClient(client)
}

/**
 * Get connection pool health metrics for monitoring
 */
export const getPoolMetrics = () => {
  return connectionPool.getMetrics()
}

/**
 * Health check for the connection pool
 */
export const poolHealthCheck = async () => {
  return await connectionPool.healthCheck()
}