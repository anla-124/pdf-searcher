import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { connectionPool } from './pool'
import type { GenericSupabaseSchema } from '@/types/supabase'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Create an authenticated Supabase client for Server Components, Server Actions, and Route Handlers.
 * This client is created on a per-request basis and uses cookies for authentication.
 */
export const createClient = async () => {
  const cookieStore = await cookies()

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value
        },
        set(name: string, value: string, options: CookieOptions) {
          try {
            cookieStore.set({ name, value, ...options })
          } catch (error) {
            // The `set` method was called from a Server Component.
            // This can be ignored if you have middleware refreshing
            // user sessions.
          }
        },
        remove(name: string, options: CookieOptions) {
          try {
            cookieStore.set({ name, value: '', ...options })
          } catch (error) {
            // The `delete` method was called from a Server Component.
            // This can be ignored if you have middleware refreshing
            // user sessions.
          }
        },
      },
    }
  )
}

/**
 * Create a service role Supabase client from the connection pool.
 * This client has admin privileges and should be used for background tasks.
 */
export const createServiceClient = async (): Promise<SupabaseClient<GenericSupabaseSchema>> => {
  return await connectionPool.getServiceClient() as SupabaseClient<GenericSupabaseSchema>
}

/**
 * Release a service client back to the pool.
 */
export const releaseServiceClient = (client: SupabaseClient<GenericSupabaseSchema>) => {
  connectionPool.releaseServiceClient(client)
}

/**
 * Get connection pool health metrics for monitoring.
 */
export const getPoolMetrics = () => {
  return connectionPool.getMetrics()
}

/**
 * Health check for the connection pool.
 */
export const poolHealthCheck = async () => {
  return await connectionPool.healthCheck()
}