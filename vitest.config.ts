import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  test: {
    // Testing environment
    environment: 'happy-dom',
    
    // Enable global test functions (expect, describe, it, etc.)
    globals: true,
    
    // Global test setup - Jest compatibility
    setupFiles: ['./tests/setup.ts', './tests/jest-compat.ts'],
    
    // Test patterns - now includes both src/ and tests/ directories
    include: [
      'src/**/*.{test,spec}.{js,ts,tsx}',
      'tests/unit/**/*.{test,spec}.{js,ts}',
      'tests/api/**/*.{test,spec}.{js,ts}'
    ],
    exclude: [
      'node_modules',
      'dist',
      '.next',
      'tests/e2e/**/*',
      'tests/integration/**/*', // Integration tests use separate config
      '**/*.backup.*' // Exclude backup files
    ],
    
    // Coverage configuration
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'tests/',
        '.next/',
        'src/types/',
        '**/*.d.ts',
        '**/*.config.*',
        '**/coverage/**'
      ],
      thresholds: {
        global: {
          branches: 70,
          functions: 70,
          lines: 80,
          statements: 80
        }
      }
    },
    
    // Timeouts for enterprise testing
    testTimeout: 30000,
    hookTimeout: 10000,
    
    // Parallel execution
    pool: 'threads',
    poolOptions: {
      threads: {
        singleThread: false,
        maxThreads: 4,
        minThreads: 1
      }
    },
    
    // Mock configuration
    mockReset: true,
    clearMocks: true,
    restoreMocks: true,
    
    // Reporter configuration
    reporters: process.env['CI'] ? ['verbose', 'junit'] : ['default'],
    outputFile: {
      junit: './test-results/junit.xml'
    }
  },
  
  // Path resolution
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
      '@/tests': resolve(__dirname, './tests'),
      '@/app/api/admin/performance-metrics/route': resolve(__dirname, './tests/stubs/admin/performance-metrics-route.ts'),
      '@/app/api/admin/batch-status/route': resolve(__dirname, './tests/stubs/admin/batch-status-route.ts'),
      '@/app/api/admin/activity-log/route': resolve(__dirname, './tests/stubs/admin/activity-log-route.ts'),
      '@/app/api/admin/security-status/route': resolve(__dirname, './tests/stubs/admin/security-status-route.ts'),
      '@/lib/error-handling': resolve(__dirname, './tests/stubs/error-handling.ts')
    }
  },
  
  // Define global variables for testing
  define: {
    'process.env.NODE_ENV': '"test"'
  }
})
