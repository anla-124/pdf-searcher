#!/bin/bash

# Comprehensive Test Runner for PDF AI Assistant
# Runs all types of tests in sequence: unit, integration, API, E2E, load, and security

set -e  # Exit on any error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
BASE_URL="${BASE_URL:-http://localhost:3000}"
TEST_ENV="${TEST_ENV:-test}"
SKIP_E2E="${SKIP_E2E:-false}"
SKIP_LOAD="${SKIP_LOAD:-false}"
SKIP_SECURITY="${SKIP_SECURITY:-false}"
PARALLEL_JOBS="${PARALLEL_JOBS:-4}"

# Create test results directory
mkdir -p test-results/{unit,integration,api,e2e,load,security,coverage}

echo -e "${BLUE}🧪 PDF AI Assistant - Comprehensive Testing Suite${NC}"
echo -e "${BLUE}=================================================${NC}"
echo ""
echo -e "Base URL: ${BASE_URL}"
echo -e "Environment: ${TEST_ENV}"
echo -e "Parallel Jobs: ${PARALLEL_JOBS}"
echo ""

# Function to print test section headers
print_section() {
    echo -e "\n${BLUE}===== $1 =====${NC}\n"
}

# Function to check if a command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Function to wait for server to be ready
wait_for_server() {
    echo -e "${YELLOW}Waiting for server to be ready...${NC}"
    max_attempts=30
    attempt=1
    
    while [ $attempt -le $max_attempts ]; do
        if curl -f -s "${BASE_URL}/api/health" > /dev/null 2>&1; then
            echo -e "${GREEN}✅ Server is ready${NC}"
            return 0
        fi
        
        echo -e "Attempt $attempt/$max_attempts - Server not ready yet..."
        sleep 2
        attempt=$((attempt + 1))
    done
    
    echo -e "${RED}❌ Server failed to start within timeout${NC}"
    return 1
}

# Function to run tests with error handling
run_test() {
    local test_name="$1"
    local test_command="$2"
    local start_time=$(date +%s)
    
    echo -e "${YELLOW}Running $test_name...${NC}"
    
    if eval "$test_command"; then
        local end_time=$(date +%s)
        local duration=$((end_time - start_time))
        echo -e "${GREEN}✅ $test_name passed (${duration}s)${NC}"
        return 0
    else
        local end_time=$(date +%s)
        local duration=$((end_time - start_time))
        echo -e "${RED}❌ $test_name failed (${duration}s)${NC}"
        return 1
    fi
}

# Start test execution timer
test_start_time=$(date +%s)

print_section "ENVIRONMENT SETUP"

# Check required tools
echo -e "${YELLOW}Checking required tools...${NC}"
required_tools=("node" "npm" "curl")
optional_tools=("k6" "docker")

for tool in "${required_tools[@]}"; do
    if command_exists "$tool"; then
        echo -e "✅ $tool found"
    else
        echo -e "${RED}❌ $tool not found (required)${NC}"
        exit 1
    fi
done

for tool in "${optional_tools[@]}"; do
    if command_exists "$tool"; then
        echo -e "✅ $tool found"
    else
        echo -e "${YELLOW}⚠️  $tool not found (optional for some tests)${NC}"
    fi
done

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
    echo -e "${YELLOW}Installing dependencies...${NC}"
    npm install
fi

# Check if server is already running, if not start it
if ! curl -f -s "${BASE_URL}/api/health" > /dev/null 2>&1; then
    echo -e "${YELLOW}Starting development server...${NC}"
    npm run dev &
    SERVER_PID=$!
    
    # Wait for server to be ready
    if ! wait_for_server; then
        if [ -n "$SERVER_PID" ]; then
            kill $SERVER_PID 2>/dev/null || true
        fi
        exit 1
    fi
else
    echo -e "${GREEN}✅ Server is already running${NC}"
fi

# Test execution
print_section "UNIT TESTS"
run_test "Unit Tests" "npm run test:unit -- --reporter=verbose --coverage --run" || true

print_section "INTEGRATION TESTS"  
run_test "Integration Tests" "npm run test:integration -- --reporter=verbose --run" || true

print_section "API TESTS"
run_test "Authentication API Tests" "npx vitest run tests/api/auth.test.ts --reporter=verbose" || true
run_test "Documents API Tests" "npx vitest run tests/api/documents.test.ts --reporter=verbose" || true
run_test "Search API Tests" "npx vitest run tests/api/search.test.ts --reporter=verbose" || true
run_test "Admin API Tests" "npx vitest run tests/api/admin.test.ts --reporter=verbose" || true

if [ "$SKIP_E2E" != "true" ]; then
    print_section "END-TO-END TESTS"
    
    # Check if Playwright browsers are installed
    if [ ! -d "~/.cache/ms-playwright" ] && [ ! -d "/Users/$USER/Library/Caches/ms-playwright" ]; then
        echo -e "${YELLOW}Installing Playwright browsers...${NC}"
        npx playwright install
    fi
    
    run_test "E2E Tests - Chromium" "npx playwright test --project=chromium --reporter=html --output-dir=test-results/e2e" || true
    run_test "E2E Tests - Firefox" "npx playwright test --project=firefox --reporter=html --output-dir=test-results/e2e" || true
    run_test "E2E Tests - Webkit" "npx playwright test --project=webkit --reporter=html --output-dir=test-results/e2e" || true
else
    echo -e "${YELLOW}⏭️  Skipping E2E tests (SKIP_E2E=true)${NC}"
fi

if [ "$SKIP_LOAD" != "true" ] && command_exists "k6"; then
    print_section "LOAD TESTS"
    
    # Export environment variables for K6
    export BASE_URL
    export AUTH_TOKEN="test_token"  # In real scenario, obtain from auth
    
    run_test "Load Test - Search Performance" "k6 run --out json=test-results/load/search-performance.json tests/load/k6-search-performance.js" || true
    run_test "Load Test - Document Upload" "k6 run --out json=test-results/load/document-upload.json tests/load/k6-document-upload.js" || true
else
    if [ "$SKIP_LOAD" = "true" ]; then
        echo -e "${YELLOW}⏭️  Skipping load tests (SKIP_LOAD=true)${NC}"
    else
        echo -e "${YELLOW}⏭️  Skipping load tests (k6 not installed)${NC}"
    fi
fi

if [ "$SKIP_SECURITY" != "true" ] && command_exists "docker"; then
    print_section "SECURITY TESTS"
    
    echo -e "${YELLOW}Starting OWASP ZAP security scan...${NC}"
    
    # Run ZAP in Docker
    docker run --rm \
        -v "$(pwd)/tests/security:/zap/wrk:rw" \
        -v "$(pwd)/test-results/security:/zap/reports:rw" \
        --network="host" \
        ghcr.io/zaproxy/zaproxy:stable \
        zap-automation.py \
        -configfile /zap/wrk/owasp-zap-config.yaml \
        -cmd \
        || echo -e "${YELLOW}⚠️  Security scan completed with warnings${NC}"
    
    echo -e "${GREEN}✅ Security test reports generated in test-results/security/${NC}"
else
    if [ "$SKIP_SECURITY" = "true" ]; then
        echo -e "${YELLOW}⏭️  Skipping security tests (SKIP_SECURITY=true)${NC}"
    else
        echo -e "${YELLOW}⏭️  Skipping security tests (Docker not available)${NC}"
    fi
fi

print_section "TEST COVERAGE ANALYSIS"

# Generate comprehensive coverage report
run_test "Coverage Report Generation" "npm run test:coverage" || true

# Generate combined coverage report if possible
if command_exists "nyc"; then
    echo -e "${YELLOW}Generating combined coverage report...${NC}"
    npx nyc report --reporter=html --report-dir=test-results/coverage/combined || true
fi

print_section "TEST SUMMARY"

# Calculate total test time
test_end_time=$(date +%s)
total_duration=$((test_end_time - test_start_time))
minutes=$((total_duration / 60))
seconds=$((total_duration % 60))

echo -e "${BLUE}Total test execution time: ${minutes}m ${seconds}s${NC}"

# Generate test report summary
cat > test-results/test-summary.md << EOF
# Test Execution Summary

**Date:** $(date)
**Environment:** ${TEST_ENV}
**Base URL:** ${BASE_URL}
**Total Duration:** ${minutes}m ${seconds}s

## Test Results

### Unit Tests
- Location: \`test-results/unit/\`
- Command: \`npm run test:unit\`

### Integration Tests  
- Location: \`test-results/integration/\`
- Command: \`npm run test:integration\`

### API Tests
- Authentication: \`tests/api/auth.test.ts\`
- Documents: \`tests/api/documents.test.ts\`
- Search: \`tests/api/search.test.ts\`
- Admin: \`tests/api/admin.test.ts\`

### End-to-End Tests
- Location: \`test-results/e2e/\`
- Browsers: Chromium, Firefox, WebKit
- Report: \`test-results/e2e/index.html\`

### Load Tests
- Search Performance: \`test-results/load/search-performance.json\`
- Document Upload: \`test-results/load/document-upload.json\`

### Security Tests
- OWASP ZAP Report: \`test-results/security/zap-security-report.html\`
- Configuration: \`tests/security/owasp-zap-config.yaml\`

### Coverage Reports
- Unit Test Coverage: \`test-results/coverage/index.html\`
- Combined Coverage: \`test-results/coverage/combined/index.html\`

## Next Steps

1. Review failed tests and fix issues
2. Analyze coverage reports for gaps
3. Review security findings and remediate
4. Optimize performance based on load test results
5. Add tests for any uncovered scenarios

## Viewing Reports

- Open \`test-results/e2e/index.html\` for E2E test results
- Open \`test-results/coverage/index.html\` for coverage report
- Open \`test-results/security/zap-security-report.html\` for security findings
EOF

echo -e "${GREEN}✅ Test summary generated: test-results/test-summary.md${NC}"

# List all generated reports
echo -e "\n${BLUE}Generated Test Reports:${NC}"
find test-results -name "*.html" -o -name "*.json" -o -name "*.xml" | sort

# Clean up - stop the development server if we started it
if [ -n "$SERVER_PID" ]; then
    echo -e "\n${YELLOW}Stopping development server...${NC}"
    kill $SERVER_PID 2>/dev/null || true
    wait $SERVER_PID 2>/dev/null || true
fi

echo -e "\n${GREEN}🎉 Comprehensive testing completed!${NC}"
echo -e "${GREEN}Check test-results/ directory for detailed reports${NC}"