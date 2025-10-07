#!/usr/bin/env node

/**
 * Performance Stress Test for PDF Searcher
 * Tests publicly accessible endpoints under high load
 * 
 * Usage: node scripts/performance-stress-test.js [baseUrl] [concurrency] [duration]
 */

const DEFAULT_BASE_URL = 'http://localhost:3003'
const DEFAULT_CONCURRENCY = 50
const DEFAULT_DURATION_SECONDS = 30

// Command line arguments
const baseUrl = process.argv[2] || DEFAULT_BASE_URL
const concurrency = parseInt(process.argv[3]) || DEFAULT_CONCURRENCY
const durationSeconds = parseInt(process.argv[4]) || DEFAULT_DURATION_SECONDS

console.log('🚀 PDF Searcher Performance Stress Test')
console.log('=====================================')
console.log(`🌐 Base URL: ${baseUrl}`)
console.log(`⚡ Concurrency: ${concurrency} requests`)
console.log(`⏱️  Duration: ${durationSeconds} seconds`)
console.log('')

// Test endpoints that don't require authentication
const endpoints = [
  { path: '/api/health', name: 'Health Check', weight: 0.4 },
  { path: '/api/test/process-jobs', name: 'Job Processing', weight: 0.3 },
  { path: '/api/admin/batch-status', name: 'Batch Status', weight: 0.2 },
  { path: '/api/documents', name: 'Documents List (Auth Test)', weight: 0.1 }
]

// Metrics tracking
let totalRequests = 0
let successfulRequests = 0
let failedRequests = 0
let responseTimes = []
let endpointStats = {}

// Initialize endpoint stats
endpoints.forEach(endpoint => {
  endpointStats[endpoint.name] = {
    requests: 0,
    successes: 0,
    failures: 0,
    totalTime: 0,
    minTime: Infinity,
    maxTime: 0
  }
})

async function makeRequest(endpoint) {
  const startTime = Date.now()
  
  try {
    const response = await fetch(`${baseUrl}${endpoint.path}`, {
      method: 'GET',
      headers: {
        'User-Agent': 'StressTest/1.0'
      }
    })
    
    const endTime = Date.now()
    const duration = endTime - startTime
    
    // Track metrics
    totalRequests++
    responseTimes.push(duration)
    
    const stats = endpointStats[endpoint.name]
    stats.requests++
    stats.totalTime += duration
    stats.minTime = Math.min(stats.minTime, duration)
    stats.maxTime = Math.max(stats.maxTime, duration)
    
    if (response.ok || response.status === 401) { // 401 is expected for auth-required endpoints
      successfulRequests++
      stats.successes++
    } else {
      failedRequests++
      stats.failures++
      console.warn(`❌ ${endpoint.name}: ${response.status} ${response.statusText}`)
    }
    
    return { success: response.ok || response.status === 401, duration, status: response.status }
  } catch (error) {
    const endTime = Date.now()
    const duration = endTime - startTime
    
    totalRequests++
    failedRequests++
    responseTimes.push(duration)
    
    const stats = endpointStats[endpoint.name]
    stats.requests++
    stats.failures++
    stats.totalTime += duration
    
    console.warn(`❌ ${endpoint.name}: ${error.message}`)
    return { success: false, duration, error: error.message }
  }
}

function selectRandomEndpoint() {
  const random = Math.random()
  let cumulativeWeight = 0
  
  for (const endpoint of endpoints) {
    cumulativeWeight += endpoint.weight
    if (random <= cumulativeWeight) {
      return endpoint
    }
  }
  
  return endpoints[0] // fallback
}

async function worker(workerId) {
  const startTime = Date.now()
  const endTime = startTime + (durationSeconds * 1000)
  
  while (Date.now() < endTime) {
    const endpoint = selectRandomEndpoint()
    await makeRequest(endpoint)
    
    // Small random delay to simulate realistic load
    await new Promise(resolve => setTimeout(resolve, Math.random() * 100))
  }
}

async function runStressTest() {
  console.log('🏗️  Starting stress test...')
  
  const testStartTime = Date.now()
  
  // Create worker promises
  const workers = []
  for (let i = 0; i < concurrency; i++) {
    workers.push(worker(i))
  }
  
  // Wait for all workers to complete
  await Promise.allSettled(workers)
  
  const testEndTime = Date.now()
  const actualDuration = testEndTime - testStartTime
  
  // Calculate statistics
  const avgResponseTime = responseTimes.reduce((sum, time) => sum + time, 0) / responseTimes.length
  const sortedTimes = responseTimes.sort((a, b) => a - b)
  const p50 = sortedTimes[Math.floor(sortedTimes.length * 0.5)]
  const p90 = sortedTimes[Math.floor(sortedTimes.length * 0.9)]
  const p95 = sortedTimes[Math.floor(sortedTimes.length * 0.95)]
  const p99 = sortedTimes[Math.floor(sortedTimes.length * 0.99)]
  const minTime = Math.min(...responseTimes)
  const maxTime = Math.max(...responseTimes)
  
  const requestsPerSecond = totalRequests / (actualDuration / 1000)
  const successRate = (successfulRequests / totalRequests) * 100
  
  console.log('')
  console.log('📊 STRESS TEST RESULTS')
  console.log('=======================')
  console.log(`⏱️  Actual duration: ${(actualDuration / 1000).toFixed(1)}s`)
  console.log(`📈 Total requests: ${totalRequests}`)
  console.log(`✅ Successful: ${successfulRequests} (${successRate.toFixed(1)}%)`)
  console.log(`❌ Failed: ${failedRequests} (${((failedRequests / totalRequests) * 100).toFixed(1)}%)`)
  console.log(`⚡ Requests/second: ${requestsPerSecond.toFixed(2)}`)
  console.log('')
  console.log('📊 Response Time Statistics:')
  console.log(`   - Average: ${avgResponseTime.toFixed(0)}ms`)
  console.log(`   - Min: ${minTime}ms`)
  console.log(`   - Max: ${maxTime}ms`)
  console.log(`   - P50 (median): ${p50}ms`)
  console.log(`   - P90: ${p90}ms`)
  console.log(`   - P95: ${p95}ms`)
  console.log(`   - P99: ${p99}ms`)
  console.log('')
  console.log('📈 Endpoint Performance:')
  
  endpoints.forEach(endpoint => {
    const stats = endpointStats[endpoint.name]
    if (stats.requests > 0) {
      const avgTime = stats.totalTime / stats.requests
      const successRate = (stats.successes / stats.requests) * 100
      console.log(`   - ${endpoint.name}:`)
      console.log(`     * Requests: ${stats.requests}`)
      console.log(`     * Success Rate: ${successRate.toFixed(1)}%`)
      console.log(`     * Avg Response: ${avgTime.toFixed(0)}ms`)
      console.log(`     * Range: ${stats.minTime}ms - ${stats.maxTime}ms`)
    }
  })
  
  // Performance assessment
  console.log('')
  console.log('🎯 Performance Assessment:')
  if (requestsPerSecond > 100) {
    console.log('🟢 Excellent throughput (>100 req/s)')
  } else if (requestsPerSecond > 50) {
    console.log('🟡 Good throughput (50-100 req/s)')
  } else {
    console.log('🔴 Low throughput (<50 req/s)')
  }
  
  if (p95 < 500) {
    console.log('🟢 Excellent response times (P95 < 500ms)')
  } else if (p95 < 1000) {
    console.log('🟡 Good response times (P95 < 1s)')
  } else {
    console.log('🔴 Slow response times (P95 > 1s)')
  }
  
  if (successRate > 99) {
    console.log('🟢 Excellent reliability (>99% success)')
  } else if (successRate > 95) {
    console.log('🟡 Good reliability (95-99% success)')
  } else {
    console.log('🔴 Poor reliability (<95% success)')
  }
  
  console.log('')
  console.log('✅ Stress test completed!')
  
  return {
    totalRequests,
    successfulRequests,
    failedRequests,
    successRate,
    requestsPerSecond,
    avgResponseTime,
    p50, p90, p95, p99,
    minTime, maxTime,
    actualDurationMs: actualDuration,
    endpointStats
  }
}

// Run the stress test
if (require.main === module) {
  runStressTest()
    .then(results => {
      // Exit with success if performance is good
      const performanceGood = results.successRate > 95 && results.p95 < 1000 && results.requestsPerSecond > 50
      process.exit(performanceGood ? 0 : 1)
    })
    .catch(error => {
      console.error('❌ Stress test failed:', error)
      process.exit(1)
    })
}

module.exports = { runStressTest }