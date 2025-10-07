#!/usr/bin/env node

/**
 * Load Testing Script for PDF Searcher
 * Simulates 20 employees × 5+ documents = 100+ concurrent uploads
 * 
 * Usage: node scripts/load-test-concurrent-uploads.js [baseUrl] [concurrency]
 * Example: node scripts/load-test-concurrent-uploads.js http://localhost:3000 100
 */

const fs = require('fs')
const path = require('path')

// Configuration
const DEFAULT_BASE_URL = 'http://localhost:3000'
const DEFAULT_CONCURRENCY = 100
const DEFAULT_EMPLOYEES = 20
const DOCS_PER_EMPLOYEE = 5

// Command line arguments
const baseUrl = process.argv[2] || DEFAULT_BASE_URL
const totalConcurrency = parseInt(process.argv[3]) || DEFAULT_CONCURRENCY

console.log('🚀 PDF Searcher Load Testing')
console.log('============================')
console.log(`📊 Target: ${DEFAULT_EMPLOYEES} employees × ${DOCS_PER_EMPLOYEE} documents = ${totalConcurrency} concurrent uploads`)
console.log(`🌐 Base URL: ${baseUrl}`)
console.log(`⚡ Concurrency: ${totalConcurrency}`)
console.log('')

// Create a dummy PDF content for testing (minimal valid PDF)
const createTestPDF = (name) => {
  return Buffer.from(`%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R>>endobj
4 0 obj<</Length 44>>stream
BT /F1 24 Tf 100 700 Td (Test Document ${name}) Tj ET
endstream endobj
xref
0 5
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
0000000206 00000 n 
trailer<</Size 5/Root 1 0 R>>
startxref
295
%%EOF`)
}

// Simulate a document upload
async function uploadDocument(documentName, employeeId) {
  const startTime = Date.now()
  
  try {
    // Create test PDF
    const pdfContent = createTestPDF(documentName)
    
    // Create form data
    const formData = new FormData()
    const file = new Blob([pdfContent], { type: 'application/pdf' })
    formData.append('file', file, `${documentName}.pdf`)
    formData.append('metadata', JSON.stringify({
      law_firm: 'test-firm',
      fund_manager: 'test-manager', 
      fund_admin: 'test-admin',
      jurisdiction: 'test-jurisdiction'
    }))

    // Upload request
    const response = await fetch(`${baseUrl}/api/documents/upload`, {
      method: 'POST',
      body: formData,
      headers: {
        // Note: In real scenario, you'd need authentication headers
        'User-Agent': `LoadTest-Employee-${employeeId}`
      }
    })

    const duration = Date.now() - startTime
    const success = response.ok
    const result = success ? await response.json() : await response.text()

    return {
      documentName,
      employeeId,
      success,
      duration,
      status: response.status,
      result: success ? result.document?.id : result
    }
  } catch (error) {
    const duration = Date.now() - startTime
    return {
      documentName,
      employeeId,
      success: false,
      duration,
      status: 0,
      result: error.message
    }
  }
}

// Check job processing status
async function checkJobProcessingStatus() {
  try {
    const response = await fetch(`${baseUrl}/api/test/process-jobs`)
    if (response.ok) {
      const data = await response.json()
      return data
    }
    return null
  } catch (error) {
    console.warn('Could not check job processing status:', error.message)
    return null
  }
}

// Main load testing function
async function runLoadTest() {
  console.log('🏗️  Preparing load test...')
  
  // Generate upload tasks
  const uploadTasks = []
  for (let employee = 1; employee <= DEFAULT_EMPLOYEES; employee++) {
    for (let doc = 1; doc <= DOCS_PER_EMPLOYEE; doc++) {
      const documentName = `employee-${employee}-doc-${doc}`
      uploadTasks.push(() => uploadDocument(documentName, employee))
    }
  }

  console.log(`📋 Generated ${uploadTasks.length} upload tasks`)
  console.log('🚀 Starting concurrent uploads...')
  console.log('')

  const testStartTime = Date.now()
  
  // Execute all uploads concurrently
  const uploadPromises = uploadTasks.map(task => task())
  const results = await Promise.allSettled(uploadPromises)
  
  const testDuration = Date.now() - testStartTime
  
  // Analyze results
  const successful = results.filter(r => r.status === 'fulfilled' && r.value.success)
  const failed = results.filter(r => r.status === 'rejected' || (r.status === 'fulfilled' && !r.value.success))
  
  const successfulUploads = successful.map(r => r.value)
  const failedUploads = failed.map(r => r.status === 'fulfilled' ? r.value : { error: r.reason })
  
  // Performance metrics
  const avgDuration = successfulUploads.reduce((sum, r) => sum + r.duration, 0) / successfulUploads.length
  const maxDuration = Math.max(...successfulUploads.map(r => r.duration))
  const minDuration = Math.min(...successfulUploads.map(r => r.duration))
  
  // Print results
  console.log('📊 LOAD TEST RESULTS')
  console.log('====================')
  console.log(`✅ Successful uploads: ${successful.length}/${uploadTasks.length} (${(successful.length/uploadTasks.length*100).toFixed(1)}%)`)
  console.log(`❌ Failed uploads: ${failed.length}/${uploadTasks.length} (${(failed.length/uploadTasks.length*100).toFixed(1)}%)`)
  console.log(`⏱️  Total test duration: ${testDuration}ms`)
  console.log(`📈 Upload performance:`)
  console.log(`   - Average: ${avgDuration.toFixed(0)}ms`)
  console.log(`   - Min: ${minDuration}ms`)
  console.log(`   - Max: ${maxDuration}ms`)
  console.log(`⚡ Throughput: ${(uploadTasks.length / (testDuration / 1000)).toFixed(2)} uploads/sec`)
  console.log('')

  // Show sample failures
  if (failedUploads.length > 0) {
    console.log('❌ Sample failures:')
    failedUploads.slice(0, 5).forEach(failure => {
      console.log(`   - ${failure.documentName || 'Unknown'}: ${failure.result || failure.error}`)
    })
    console.log('')
  }

  // Check job processing capacity
  console.log('🔍 Checking job processing status...')
  const jobStatus = await checkJobProcessingStatus()
  if (jobStatus) {
    console.log('📊 Job Processing Status:')
    console.log(`   - Max Concurrency: ${jobStatus.cronResponse?.data?.maxConcurrency || 'Unknown'}`)
    console.log(`   - System Status: ${jobStatus.cronResponse?.data?.systemStatus || 'Unknown'}`)
    if (jobStatus.cronResponse?.data?.queueStats) {
      const stats = jobStatus.cronResponse.data.queueStats
      console.log(`   - Queue: ${stats.queued} queued, ${stats.processing} processing`)
    }
  }

  console.log('')
  console.log('✅ Load test completed!')
  
  // Return results for programmatic use
  return {
    totalUploads: uploadTasks.length,
    successful: successful.length,
    failed: failed.length,
    successRate: successful.length / uploadTasks.length,
    testDurationMs: testDuration,
    avgUploadDurationMs: avgDuration,
    throughputPerSec: uploadTasks.length / (testDuration / 1000),
    jobStatus
  }
}

// Run the load test
if (require.main === module) {
  runLoadTest()
    .then(results => {
      process.exit(results.successRate > 0.8 ? 0 : 1) // Exit with error if < 80% success rate
    })
    .catch(error => {
      console.error('❌ Load test failed:', error)
      process.exit(1)
    })
}

module.exports = { runLoadTest, uploadDocument, checkJobProcessingStatus }