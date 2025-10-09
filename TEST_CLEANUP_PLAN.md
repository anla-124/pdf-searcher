# COMPREHENSIVE TEST SUITE CLEANUP PLAN

## Current Status (Before Cleanup)
- **API Routes:** 14 total, only 2 tested (14% coverage)
- **Test Files:** 15 total, only 4 running (26%)
- **Orphaned Tests:** 11 files not running (74%)
- **Test Results:**
  - Unit tests: 28/29 passing (96.6%)
  - Integration tests: 14/23 passing (60.9%)
  - API tests: Not running (orphaned)

## Problems Identified

### 1. Test Configuration Issues
- `vitest.config.ts` only includes `src/**/*.test.*`
- All tests in `tests/` directory are ignored
- Need unified test configuration

### 2. Duplicate Test Files
- `src/lib/__tests__/document-processing.test.ts` (running)
- `tests/unit/document-processing.test.ts` (not running)
- Need to merge or choose one

### 3. Integration Test Failures (9 failures)
- MSW mocks not properly configured for Supabase
- External service mocks missing (Document AI, Pinecone)
- Need proper mock handlers

### 4. API Tests Architecture Problem
- tests/api/*.test.ts start real Next.js server
- Slow, fragile, port conflicts
- Should use mocked request handlers instead

### 5. Missing Test Coverage
Routes without tests:
- /api/documents (GET, POST)
- /api/documents/[id] (GET, PATCH, DELETE)
- /api/documents/[id]/download
- /api/documents/[id]/processing-status
- /api/documents/[id]/retry
- /api/documents/upload
- /api/search
- /api/health
- /api/health/pool
- /api/debug/batch-status
- /api/debug/retry-embeddings
- /api/test/process-jobs

## PHASE-BY-PHASE CLEANUP PLAN

### PHASE 1: Clean Up Test Structure ✅ COMPLETE
- Audited all test files
- Documented current state
- Identified all issues

### PHASE 2: Fix Configuration & Enable All Tests
**Tasks:**
1. Update vitest.config.ts to include tests/** directory
2. Delete backup file: tests/e2e/document-workflow.spec.ts.backup
3. Verify all test files are discoverable

**Files to modify:**
- vitest.config.ts
- Delete: tests/e2e/document-workflow.spec.ts.backup

### PHASE 3: Resolve Duplicate Tests
**Tasks:**
1. Compare src/lib/__tests__/document-processing.test.ts vs tests/unit/document-processing.test.ts
2. Merge or choose the better one
3. Delete or archive the duplicate
4. Same for other duplicates

### PHASE 4: Fix Unit Test Failures
**Tasks:**
1. Fix the 1 failing test in src/lib/__tests__/document-processing.test.ts
2. Target: 29/29 passing (100%)

### PHASE 5: Fix Integration Test Failures
**Tasks:**
1. Fix MSW handlers in tests/integration/setup.ts
2. Add proper Supabase mock responses
3. Fix Document AI mocks
4. Fix Pinecone mocks
5. Target: 23/23 passing (100%)

**Files to modify:**
- tests/integration/setup.ts
- tests/integration/external-services.test.ts
- tests/integration/unlimited-processing.test.ts

### PHASE 6: Modernize API Tests
**Tasks:**
1. Convert tests/api/*.test.ts from real server to mocked handlers
2. Remove server startup code
3. Use MSW or similar for API route testing
4. Make tests fast and reliable

**Files to modify:**
- tests/api/documents.test.ts
- tests/api/auth.test.ts
- tests/api/search.test.ts
- tests/api/admin.test.ts

### PHASE 7: Add Missing Route Tests
**Tasks:**
1. Create tests for 12 uncovered API routes
2. Follow pattern from existing route tests in src/app/api/.../__tests__/

**New test files to create:**
- src/app/api/documents/__tests__/route.test.ts
- src/app/api/documents/[id]/__tests__/route.test.ts
- src/app/api/documents/[id]/download/__tests__/route.test.ts
- src/app/api/documents/[id]/processing-status/__tests__/route.test.ts
- src/app/api/documents/[id]/retry/__tests__/route.test.ts
- src/app/api/documents/upload/__tests__/route.test.ts
- src/app/api/search/__tests__/route.test.ts
- src/app/api/health/__tests__/route.test.ts

### PHASE 8: Final Verification & Documentation
**Tasks:**
1. Run full test suite: npm run test:unit
2. Run integration tests: npm run test:integration
3. Verify 100% pass rate
4. Update GitHub workflow
5. Create test coverage report
6. Commit all changes

## Success Criteria
- ✅ 100% of unit tests passing
- ✅ 100% of integration tests passing
- ✅ All API routes have tests
- ✅ No orphaned test files
- ✅ Clean test configuration
- ✅ GitHub CI passing all tests

## Estimated Time
- Total: 4-6 hours
- Per phase: 30-45 minutes

## Notes
- Keep test organization consistent (prefer src/app/api/.../__tests__/ pattern)
- Use MSW for all HTTP mocking
- Maintain separation: unit tests, integration tests, e2e tests
- Follow existing test patterns from passing tests
