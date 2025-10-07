/**
 * K6 Load Testing Script for Search Performance
 * Tests search endpoints under various load conditions
 */

import http from 'k6/http'
import { check, sleep } from 'k6'
import { Rate, Trend } from 'k6/metrics'

// Custom metrics
const searchSuccessRate = new Rate('search_success_rate')
const searchDuration = new Trend('search_duration', true)

// Test configuration
export const options = {
  stages: [
    { duration: '2m', target: 10 },   // Ramp up to 10 users over 2 minutes
    { duration: '5m', target: 10 },   // Stay at 10 users for 5 minutes
    { duration: '2m', target: 20 },   // Ramp up to 20 users over 2 minutes
    { duration: '5m', target: 20 },   // Stay at 20 users for 5 minutes
    { duration: '2m', target: 50 },   // Ramp up to 50 users over 2 minutes
    { duration: '5m', target: 50 },   // Stay at 50 users for 5 minutes
    { duration: '3m', target: 0 },    // Ramp down to 0 users over 3 minutes
  ],
  thresholds: {
    http_req_duration: ['p(95)<5000'], // 95% of requests should be below 5s
    search_success_rate: ['rate>0.95'], // 95% success rate
    search_duration: ['p(90)<3000'],   // 90% of searches under 3s
  },
}

// Base URL - adjust based on your environment
const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000'

// Authentication token - in real tests, this would be obtained dynamically
const AUTH_TOKEN = __ENV.AUTH_TOKEN || 'test_token'

// Search queries for testing
const searchQueries = [
  'subscription agreement',
  'private equity fund',
  'investment terms',
  'limited partnership',
  'fund formation documents',
  'Delaware corporation',
  'capital commitment',
  'management fees',
  'carried interest',
  'portfolio companies',
  'due diligence',
  'closing conditions',
  'regulatory compliance',
  'financial statements',
  'audit requirements'
]

const searchTypes = ['text', 'semantic', 'hybrid']

const filters = [
  {},
  { law_firm: 'STB' },
  { fund_manager: 'Blackstone' },
  { jurisdiction: 'Delaware' },
  { law_firm: 'STB', fund_manager: 'Blackstone' },
  { 
    law_firm: 'STB', 
    fund_manager: 'Blackstone',
    jurisdiction: 'Delaware',
    date_from: '2024-01-01',
    date_to: '2024-12-31'
  }
]

export default function () {
  // Select random search parameters
  const query = searchQueries[Math.floor(Math.random() * searchQueries.length)]
  const searchType = searchTypes[Math.floor(Math.random() * searchTypes.length)]
  const filter = filters[Math.floor(Math.random() * filters.length)]
  
  const payload = JSON.stringify({
    query: query,
    type: searchType,
    filters: filter,
    page: 1,
    limit: 10,
    include_highlights: true
  })

  const params = {
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${AUTH_TOKEN}`,
    },
  }

  // Perform search request
  const response = http.post(`${BASE_URL}/api/search`, payload, params)

  // Check response
  const searchSuccess = check(response, {
    'search status is 200': (r) => r.status === 200,
    'search has results': (r) => {
      const body = JSON.parse(r.body)
      return body.results !== undefined && Array.isArray(body.results)
    },
    'search response time is acceptable': (r) => r.timings.duration < 5000,
    'search includes search type': (r) => {
      const body = JSON.parse(r.body)
      return body.search_type === searchType
    },
    'search results have required fields': (r) => {
      const body = JSON.parse(r.body)
      if (body.results && body.results.length > 0) {
        const firstResult = body.results[0]
        return (
          firstResult.hasOwnProperty('id') &&
          firstResult.hasOwnProperty('title') &&
          firstResult.hasOwnProperty('metadata')
        )
      }
      return true // OK if no results
    }
  })

  // Record custom metrics
  searchSuccessRate.add(searchSuccess)
  searchDuration.add(response.timings.duration)

  // Test similarity search for semantic and hybrid searches
  if (searchType === 'semantic' || searchType === 'hybrid') {
    check(response, {
      'semantic search has similarity scores': (r) => {
        const body = JSON.parse(r.body)
        if (body.results && body.results.length > 0) {
          return body.results.every(result => 
            result.hasOwnProperty('similarity_score') &&
            typeof result.similarity_score === 'number' &&
            result.similarity_score >= 0 &&
            result.similarity_score <= 1
          )
        }
        return true
      }
    })
  }

  // Test pagination
  if (Math.random() < 0.3) { // 30% chance to test pagination
    const page2Payload = JSON.stringify({
      ...JSON.parse(payload),
      page: 2
    })

    const page2Response = http.post(`${BASE_URL}/api/search`, page2Payload, params)
    
    check(page2Response, {
      'pagination works': (r) => r.status === 200,
      'page 2 has correct pagination info': (r) => {
        const body = JSON.parse(r.body)
        return body.pagination && body.pagination.page === 2
      }
    })
  }

  // Test selected document search occasionally
  if (Math.random() < 0.2) { // 20% chance
    const selectedSearchResponse = http.get(
      `${BASE_URL}/api/documents/selected-search?query=${encodeURIComponent(query)}&document_ids=doc1,doc2,doc3`,
      { headers: { 'Authorization': `Bearer ${AUTH_TOKEN}` } }
    )

    check(selectedSearchResponse, {
      'selected search works': (r) => r.status === 200 || r.status === 404, // 404 is OK if documents don't exist
    })
  }

  // Random sleep between 1-3 seconds to simulate user behavior
  sleep(Math.random() * 2 + 1)
}

// Setup function - runs once before the test
export function setup() {
  console.log('Starting search performance load test...')
  console.log(`Base URL: ${BASE_URL}`)
  console.log(`Target stages: ${JSON.stringify(options.stages)}`)
  
  // Verify API is accessible
  const healthCheck = http.get(`${BASE_URL}/api/health`)
  if (healthCheck.status !== 200) {
    console.error('API health check failed. Make sure the server is running.')
  }
  
  return { timestamp: new Date().toISOString() }
}

// Teardown function - runs once after the test
export function teardown(data) {
  console.log('Search performance load test completed.')
  console.log(`Test started at: ${data.timestamp}`)
  console.log(`Test ended at: ${new Date().toISOString()}`)
}