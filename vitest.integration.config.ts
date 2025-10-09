import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  test: {
    // Integration testing environment
    environment: 'node',
    
    // Global test setup for integration tests
    setupFiles: ['./tests/integration/setup.ts'],
    
    // Integration test patterns
    include: [
      'tests/integration/external-services.test.ts' // Only external-services tests with MSW mocks
      // 'tests/integration/unlimited-processing.test.ts' // Requires real Supabase - skip in CI
    ],
    exclude: [
      'node_modules',
      'dist',
      '.next',
      'tests/unit/**/*',
      'tests/e2e/**/*'
    ],
    
    // Longer timeouts for integration tests
    testTimeout: 120000, // 2 minutes for document processing tests
    hookTimeout: 30000,
    
    // Sequential execution for integration tests (avoid conflicts)
    pool: 'threads',
    poolOptions: {
      threads: {
        singleThread: true,
        maxThreads: 1,
        minThreads: 1
      }
    },
    
    // Integration test specific settings
    mockReset: false, // Keep mocks between tests for integration
    clearMocks: false,
    
    // Reporter configuration
    reporters: ['verbose'],
    
    // Retry failed tests (network issues, etc.)
    retry: 2
  },
  
  // Path resolution
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
      '@/tests': resolve(__dirname, './tests')
    }
  },
  
  // Environment variables for integration testing
  define: {
    'process.env.NODE_ENV': '"integration"'
  }
})