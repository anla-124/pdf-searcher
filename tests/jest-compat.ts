/**
 * Jest Compatibility Layer for Vitest
 * Provides Jest-style mocking functions for existing tests
 */

import { vi } from 'vitest'

// Create global jest object to support existing jest.mock() calls
(global as any).jest = {
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
  // Add jest.MockedFunction type compatibility
  MockedFunction: vi.fn as any,
}

// Add missing vi functions that some tests expect
// @ts-ignore
vi.restoreMocks = vi.restoreAllMocks

// Export for explicit imports
export { vi as jest }