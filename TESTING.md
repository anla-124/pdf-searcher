# 🧪 PDF AI Assistant - Comprehensive Testing Guide

This document provides a complete guide to the testing ecosystem for the PDF AI Assistant application, designed to ensure enterprise-grade quality, security, and performance.

## 📋 Table of Contents

1. [Testing Overview](#testing-overview)
2. [Test Types](#test-types)
3. [Quick Start](#quick-start)
4. [Test Configuration](#test-configuration)
5. [Running Tests](#running-tests)
6. [CI/CD Pipeline](#cicd-pipeline)
7. [Test Reports](#test-reports)
8. [Contributing](#contributing)
9. [Troubleshooting](#troubleshooting)

## 🎯 Testing Overview

Our testing strategy follows industry best practices with multiple layers of validation:

```
┌─────────────────────────────────────────────────────────────┐
│                    Testing Pyramid                         │
├─────────────────────────────────────────────────────────────┤
│  🔒 Security Tests (OWASP ZAP)                            │
├─────────────────────────────────────────────────────────────┤
│  ⚡ Load Tests (K6)                                       │
├─────────────────────────────────────────────────────────────┤
│  🌐 End-to-End Tests (Playwright)                        │
├─────────────────────────────────────────────────────────────┤
│  🔌 API Tests (Supertest)                                │
├─────────────────────────────────────────────────────────────┤
│  🔧 Integration Tests (Vitest + MSW)                     │
├─────────────────────────────────────────────────────────────┤
│  ⚡ Unit Tests (Vitest)                                  │
└─────────────────────────────────────────────────────────────┘
```

### Test Coverage Goals

- **Unit Tests**: >80% code coverage
- **Integration Tests**: All external service integrations
- **API Tests**: All API endpoints with comprehensive scenarios
- **E2E Tests**: Complete user workflows across browsers
- **Load Tests**: Performance under realistic concurrent usage
- **Security Tests**: OWASP Top 10 vulnerabilities

## 🧪 Test Types

### 1. Unit Tests (`tests/unit/`)

**Purpose**: Test individual functions and components in isolation

**Technology**: Vitest with Happy DOM

**Coverage**: 
- Business logic functions
- Utility functions
- Component rendering
- Data transformations

**Example**:
```typescript
// tests/unit/document-processing.test.ts
describe('Document Processing', () => {
  it('should extract metadata from PDF', async () => {
    const result = await extractPDFMetadata(mockPDFBuffer)
    expect(result).toHaveProperty('title')
    expect(result).toHaveProperty('pageCount')
  })
})
```

### 2. Integration Tests (`tests/integration/`)

**Purpose**: Test interactions between components and external services

**Technology**: Vitest with MSW (Mock Service Worker)

**Coverage**:
- Database operations
- External API integrations (Supabase, Google Cloud, Pinecone)
- Queue system operations
- Cache interactions

**Example**:
```typescript
// tests/integration/external-services.test.ts
describe('Supabase Integration', () => {
  it('should successfully save document to database', async () => {
    const document = await saveDocument(mockDocumentData)
    expect(document.id).toBeDefined()
    expect(document.status).toBe('processing')
  })
})
```

### 3. API Tests (`tests/api/`)

**Purpose**: Test all REST API endpoints with various scenarios

**Technology**: Supertest with Next.js test server

**Coverage**:
- Authentication endpoints
- Document CRUD operations  
- Search functionality
- Admin dashboard APIs
- Error handling
- Rate limiting

**Example**:
```typescript
// tests/api/documents.test.ts
describe('POST /api/documents/upload', () => {
  it('should upload PDF successfully', async () => {
    const response = await request(app)
      .post('/api/documents/upload')
      .attach('file', 'tests/fixtures/sample.pdf')
      .field('law_firm', 'STB')
      .expect(200)
      
    expect(response.body).toHaveProperty('document_id')
  })
})
```

### 4. End-to-End Tests (`tests/e2e/`)

**Purpose**: Test complete user workflows from browser perspective

**Technology**: Playwright (Chromium, Firefox, WebKit)

**Coverage**:
- User authentication flow
- Document upload and processing
- Search functionality
- Admin dashboard
- Mobile responsiveness
- Cross-browser compatibility

**Example**:
```typescript
// tests/e2e/document-workflow.spec.ts
test('complete document workflow', async ({ page }) => {
  await page.goto('/')
  await page.click('[data-testid="login-button"]')
  // ... authentication steps
  await page.setInputFiles('[data-testid="file-input"]', 'sample.pdf')
  await page.click('[data-testid="upload-submit"]')
  await expect(page.locator('[data-testid="upload-success"]')).toBeVisible()
})
```

### 5. Load Tests (`tests/load/`)

**Purpose**: Test application performance under concurrent load

**Technology**: K6

**Coverage**:
- Search performance under load
- Concurrent document uploads
- Database connection pooling
- Queue system throughput
- API response times

**Example**:
```javascript
// tests/load/k6-search-performance.js
export default function () {
  const response = http.post(`${BASE_URL}/api/search`, {
    query: 'subscription agreement',
    type: 'hybrid'
  })
  
  check(response, {
    'search completed in <3s': (r) => r.timings.duration < 3000,
    'search returned results': (r) => JSON.parse(r.body).results.length > 0
  })
}
```

### 6. Security Tests (`tests/security/`)

**Purpose**: Identify and prevent security vulnerabilities

**Technology**: OWASP ZAP with custom configuration

**Coverage**:
- Injection attacks (SQL, XSS, Command)
- Authentication bypass
- Authorization flaws
- File upload security
- Rate limiting bypass
- Sensitive data exposure

**Configuration**: `tests/security/owasp-zap-config.yaml`

## 🚀 Quick Start

### Prerequisites

```bash
# Required tools
node >= 20.0.0
npm >= 9.0.0

# Optional (for load and security tests)
k6
docker
```

### Installation

```bash
# Install dependencies
npm install

# Install Playwright browsers
npx playwright install

# Install K6 (macOS)
brew install k6

# Install K6 (Ubuntu/Debian)
sudo apt-key adv --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
echo "deb https://dl.k6.io/deb stable main" | sudo tee /etc/apt/sources.list.d/k6.list
sudo apt-get update && sudo apt-get install k6
```

### Environment Setup

```bash
# Copy environment template
cp .env.local.template .env.local

# Edit with your actual API keys
nano .env.local
```

## ⚙️ Test Configuration

### Vitest Configuration (`vitest.config.ts`)

- **Environment**: Happy DOM for component testing
- **Coverage**: V8 provider with 80% thresholds
- **Timeouts**: 30s for individual tests
- **Parallel**: 4 threads maximum

### Playwright Configuration (`playwright.config.ts`)

- **Browsers**: Chromium, Firefox, WebKit, Mobile Chrome/Safari
- **Base URL**: `http://localhost:3000`
- **Retries**: 2 retries on CI
- **Screenshots**: On failure only
- **Video**: Retain on failure

### K6 Configuration

- **Ramp-up**: Gradual load increase
- **Thresholds**: p95 < 5s, success rate > 95%
- **Stages**: Light → Medium → Heavy load

## 🏃‍♂️ Running Tests

### Individual Test Suites

```bash
# Unit tests only
npm run test:unit

# Integration tests only  
npm run test:integration

# E2E tests (all browsers)
npm run test:e2e

# E2E tests (specific browser)
npx playwright test --project=chromium

# API tests
npm run test -- tests/api/

# Load tests
k6 run tests/load/k6-search-performance.js

# Security tests
docker run --rm -v $(pwd):/zap/wrk ghcr.io/zaproxy/zaproxy:stable zap-automation.py -configfile /zap/wrk/tests/security/owasp-zap-config.yaml
```

### Complete Test Suite

```bash
# Run all tests (recommended)
./tests/run-all-tests.sh

# Run all tests skipping load and security
SKIP_LOAD=true SKIP_SECURITY=true ./tests/run-all-tests.sh

# Run tests against different environment
BASE_URL=https://staging.example.com ./tests/run-all-tests.sh
```

### Coverage Reports

```bash
# Generate coverage report
npm run test:coverage

# View coverage report
open coverage/index.html
```

## 🤖 CI/CD Pipeline

Our GitHub Actions pipeline (`.github/workflows/comprehensive-testing.yml`) runs:

### On Pull Requests:
- ✅ Unit tests
- ✅ Integration tests  
- ✅ API tests
- ✅ E2E tests
- ✅ Docker build validation

### On Main Branch:
- ✅ All PR tests
- ✅ Load tests
- ✅ Security tests
- ✅ Performance analysis

### Nightly Builds:
- ✅ Complete test suite
- ✅ Security scans
- ✅ Performance regression testing

### Pipeline Features:
- **Parallel execution**: Tests run concurrently for speed
- **Artifact upload**: Test reports and coverage data preserved
- **PR comments**: Automatic test result summaries
- **Failure notifications**: Slack/email alerts on failures

## 📊 Test Reports

### Generated Reports

```
test-results/
├── unit/                   # Unit test results
├── integration/           # Integration test results  
├── api/                   # API test results
├── e2e/
│   └── index.html        # Playwright HTML report
├── load/
│   ├── search-performance.json
│   └── document-upload.json
├── security/
│   └── zap-security-report.html
└── coverage/
    └── index.html        # Coverage report
```

### Viewing Reports

```bash
# E2E test report
npx playwright show-report

# Coverage report  
open test-results/coverage/index.html

# Security report
open test-results/security/zap-security-report.html
```

### Continuous Monitoring

- **Coverage trends**: Track coverage over time
- **Performance regression**: Compare load test results
- **Security alerts**: Monitor for new vulnerabilities
- **Flaky test detection**: Identify unstable tests

## 🤝 Contributing

### Writing New Tests

1. **Follow naming conventions**:
   - Unit: `*.test.ts`
   - Integration: `*.integration.test.ts`
   - E2E: `*.spec.ts`

2. **Use descriptive test names**:
   ```typescript
   // ✅ Good
   test('should reject PDF upload when file exceeds 50MB limit')
   
   // ❌ Bad  
   test('file upload test')
   ```

3. **Add data-testid attributes** for E2E tests:
   ```jsx
   <button data-testid="upload-submit-button">Upload</button>
   ```

4. **Mock external services** in integration tests:
   ```typescript
   // Use MSW to mock external APIs
   server.use(
     rest.post('https://api.external.com/endpoint', (req, res, ctx) => {
       return res(ctx.json({ success: true }))
     })
   )
   ```

### Test Development Guidelines

- **Arrange-Act-Assert** pattern for clarity
- **Independent tests** - no shared state
- **Deterministic** - same result every time
- **Fast execution** - optimize for speed
- **Clear error messages** - helpful failure output

### Code Review Checklist

- [ ] Tests cover happy path and edge cases
- [ ] Error scenarios are tested
- [ ] Performance impact considered
- [ ] Security implications evaluated
- [ ] Documentation updated

## 🐛 Troubleshooting

### Common Issues

#### 1. Playwright Browser Issues
```bash
# Reinstall browsers
npx playwright install --force

# Install system dependencies
npx playwright install-deps
```

#### 2. Test Timeout Issues
```bash
# Increase timeout in playwright.config.ts
timeout: 60000, // 1 minute

# Or in individual tests
test('slow test', async ({ page }) => {
  test.setTimeout(120000) // 2 minutes
  // ... test code
})
```

#### 3. Database Connection Issues
```bash
# Check database status
docker-compose ps

# Restart services
docker-compose restart postgres redis
```

#### 4. API Authentication Issues
```bash
# Verify environment variables
cat .env.local | grep -E "(SUPABASE|JWT)"

# Check API health
curl http://localhost:3000/api/health
```

#### 5. Load Test Failures
```bash
# Check server resources
htop

# Increase server timeout
# In next.config.js
module.exports = {
  serverRuntimeConfig: {
    timeout: 30000
  }
}
```

### Debug Mode

```bash
# Run tests in debug mode
npm run test:debug

# Playwright debug mode
npx playwright test --debug

# K6 verbose output
k6 run --verbose tests/load/k6-search-performance.js
```

### Performance Tips

1. **Parallel execution**: Use `--workers` flag for Playwright
2. **Test isolation**: Avoid shared state between tests
3. **Resource cleanup**: Properly dispose of resources
4. **Selective testing**: Use test tags for focused runs

## 📚 Additional Resources

- [Vitest Documentation](https://vitest.dev/)
- [Playwright Documentation](https://playwright.dev/)
- [K6 Documentation](https://k6.io/docs/)
- [OWASP ZAP Documentation](https://www.zaproxy.org/docs/)
- [MSW Documentation](https://mswjs.io/)

## 📝 Test Maintenance

### Regular Tasks

- **Weekly**: Review flaky tests and fix
- **Monthly**: Update test dependencies
- **Quarterly**: Review test coverage and add missing tests
- **Release**: Run full test suite before deployment

### Metrics to Monitor

- **Test execution time**: Keep under 30 minutes total
- **Coverage percentage**: Maintain >80% coverage
- **Flaky test rate**: Keep under 5%
- **Security scan results**: Zero high-severity issues

---

**Happy Testing! 🎉**

*This testing framework ensures our PDF AI Assistant meets enterprise standards for reliability, security, and performance.*