import type { SupabaseClient } from '@supabase/supabase-js'
import { connectionPool } from './pool'
import type { GenericSupabaseSchema } from '@/types/supabase'

/**
 * Create an authenticated Supabase client with session context
 * Uses connection pooling for better resource management
 */
export const createClient = async (): Promise<SupabaseClient<GenericSupabaseSchema>> => {
  // For authenticated clients, we still need fresh cookie context per request
  // So we use the pool's authenticated client method
  return await connectionPool.getAuthenticatedClient() as SupabaseClient<GenericSupabaseSchema>
}

/**
 * Create a service role Supabase client from the connection pool
 * Reuses connections for better performance under load
 */
export const createServiceClient = async (): Promise<SupabaseClient<GenericSupabaseSchema>> => {
  return await connectionPool.getServiceClient() as SupabaseClient<GenericSupabaseSchema>
}

/**
 * Release a service client back to the pool (optional optimization)
 * Call this when you're done with long-running operations
 */
export const releaseServiceClient = (client: SupabaseClient<GenericSupabaseSchema>) => {
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
