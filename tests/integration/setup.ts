/**
 * Integration test setup for testing with real external services
 * Uses test databases and sandbox environments
 */

import { beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import type { SupabaseClient } from '@supabase/supabase-js'

// Test environment variables - use production URL with MSW mocks
process.env['NODE_ENV'] = 'integration'
process.env['NEXT_PUBLIC_SUPABASE_URL'] = process.env['TEST_SUPABASE_URL'] || 'https://bsthehpinjtiiznikbyw.supabase.co'
process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY'] = process.env['TEST_SUPABASE_ANON_KEY'] || 'test-anon-key'
process.env['SUPABASE_SERVICE_ROLE_KEY'] = process.env['TEST_SUPABASE_SERVICE_KEY'] || 'test-service-key'
process.env['UNLIMITED_PROCESSING'] = 'true'
process.env['DB_POOL_MAX_CONNECTIONS'] = '100'
process.env['DB_POOL_CONNECTION_TIMEOUT'] = '0'

let testSupabase: SupabaseClient

// Global setup for integration tests
beforeAll(async () => {
  // Create test database connection
  testSupabase = createClient(
    process.env['NEXT_PUBLIC_SUPABASE_URL']!,
    process.env['SUPABASE_SERVICE_ROLE_KEY']!
  )
  
  // Verify test database connection
  const { error } = await testSupabase.from('documents').select('count').limit(1)
  if (error && !error.message.includes('relation "documents" does not exist')) {
    console.warn('Test database connection issue:', error.message)
  }

  console.warn('Integration test environment initialized')
})

// Cleanup after all tests
afterAll(async () => {
  console.warn('Integration test cleanup completed')
})

// Setup before each integration test
beforeEach(async () => {
  // Clean up test data before each test
  if (testSupabase) {
    try {
      // Clean test documents (only if using test database)
      if (process.env['NEXT_PUBLIC_SUPABASE_URL']?.includes('localhost') || 
          process.env['NEXT_PUBLIC_SUPABASE_URL']?.includes('test')) {
        await testSupabase.from('documents').delete().like('title', 'TEST_%')
        await testSupabase.from('processing_jobs').delete().like('document_id', 'test-%')
      }
    } catch {
      // Ignore cleanup errors in integration tests
    }
  }
})

// Cleanup after each integration test
afterEach(async () => {
  // Minimal cleanup - let tests manage their own state
})

// Helper functions for integration tests
export const createTestUser = async () => {
  const testUser = {
    id: `test-user-${Date.now()}`,
    email: `test-${Date.now()}@example.com`
  }
  
  return testUser
}

export const createIntegrationTestDocument = async (userId: string) => {
  const testDoc = {
    id: `test-doc-${Date.now()}`,
    title: `TEST_Integration_Document_${Date.now()}`,
    filename: 'test-integration.pdf',
    file_path: 'test/integration.pdf',
    file_size: 2048000,
    mime_type: 'application/pdf',
    user_id: userId,
    status: 'pending' as const,
    metadata: {
      law_firm: 'STB',
      fund_manager: 'Integration Test',
      fund_admin: 'Test Admin',
      jurisdiction: 'Test Jurisdiction'
    },
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  }

  if (testSupabase) {
    const { data, error } = await testSupabase
      .from('documents')
      .insert(testDoc)
      .select()
      .single()
    
    if (error) throw error
    return data
  }
  
  return testDoc
}

export const cleanupIntegrationTestData = async () => {
  if (testSupabase) {
    try {
      // Only cleanup if using test database
      if (process.env['NEXT_PUBLIC_SUPABASE_URL']?.includes('localhost') || 
          process.env['NEXT_PUBLIC_SUPABASE_URL']?.includes('test')) {
        await testSupabase.from('documents').delete().like('title', 'TEST_%')
        await testSupabase.from('processing_jobs').delete().like('document_id', 'test-%')
      }
    } catch (error) {
      console.warn('Integration test cleanup warning:', error)
    }
  }
}

// Export test supabase client
export { testSupabase }
