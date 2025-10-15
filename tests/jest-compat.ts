/**
 * Jest Compatibility Layer for Vitest
 * Provides Jest-style mocking functions for existing tests
 */

import { vi } from 'vitest'

type JestCompat = {
  mock: typeof vi.mock
  doMock: typeof vi.doMock
  unmock: typeof vi.unmock
  doUnmock: typeof vi.doUnmock
  clearAllMocks: typeof vi.clearAllMocks
  resetAllMocks: typeof vi.resetAllMocks
  restoreAllMocks: typeof vi.restoreAllMocks
  spyOn: typeof vi.spyOn
  fn: typeof vi.fn
  mocked: typeof vi.mocked
  isMockFunction: typeof vi.isMockFunction
  MockedFunction: typeof vi.fn
}

const jestCompat: JestCompat = {
  mock: vi.mock,
  doMock: vi.doMock,
  unmock: vi.unmock,
  doUnmock: vi.doUnmock,
  clearAllMocks: vi.clearAllMocks,
  resetAllMocks: vi.resetAllMocks,
  restoreAllMocks: vi.restoreAllMocks,
  spyOn: vi.spyOn,
  fn: vi.fn,
  mocked: vi.mocked,
  isMockFunction: vi.isMockFunction,
  MockedFunction: vi.fn
}

;(globalThis as typeof globalThis & { jest?: JestCompat }).jest = jestCompat

// Add missing vi functions that some tests expect
// @ts-ignore
vi.restoreMocks = vi.restoreAllMocks

// Export for explicit imports
export { vi as jest }
