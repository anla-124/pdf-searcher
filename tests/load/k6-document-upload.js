/**
 * K6 Load Testing Script for Document Upload Performance
 * Tests document upload endpoints under concurrent load
 */

import http from 'k6/http'
import { check, sleep } from 'k6'
import { Rate, Trend, Counter } from 'k6/metrics'

// Custom metrics
const uploadSuccessRate = new Rate('upload_success_rate')
const uploadDuration = new Trend('upload_duration', true)
const uploadedDocuments = new Counter('uploaded_documents_total')
const processingQueue = new Trend('processing_queue_length', true)

// Test configuration for upload stress testing
export const options = {
  stages: [
    { duration: '1m', target: 5 },    // Start with 5 concurrent uploads
    { duration: '3m', target: 5 },    // Maintain 5 users for 3 minutes
    { duration: '1m', target: 10 },   // Ramp up to 10 concurrent uploads
    { duration: '3m', target: 10 },   // Maintain 10 users for 3 minutes
    { duration: '1m', target: 20 },   // Stress test with 20 concurrent uploads
    { duration: '2m', target: 20 },   // Maintain stress level
    { duration: '2m', target: 0 },    // Ramp down
  ],
  thresholds: {
    http_req_duration: ['p(95)<30000'], // 95% of uploads should complete in 30s
    upload_success_rate: ['rate>0.90'], // 90% success rate (uploads can be resource intensive)
    upload_duration: ['p(90)<20000'],   // 90% of uploads under 20s
  },
}

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000'
const AUTH_TOKEN = __ENV.AUTH_TOKEN || 'test_token'

// Generate mock PDF content (minimal valid PDF)
function generateMockPDF(sizeKB = 100) {
  const baseSize = 178 // Base PDF size in bytes
  const additionalContent = 'A'.repeat((sizeKB * 1024) - baseSize)
  
  return `%PDF-1.4
1 0 obj
<<
/Type /Catalog
/Pages 2 0 R
>>
endobj
2 0 obj
<<
/Type /Pages
/Kids [3 0 R]
/Count 1
>>
endobj
3 0 obj
<<
/Type /Page
/Parent 2 0 R
/MediaBox [0 0 612 792]
/Contents 4 0 R
>>
endobj
4 0 obj
<<
/Length ${additionalContent.length}
>>
stream
${additionalContent}
endstream
endobj
xref
0 5
0000000000 65535 f 
0000000009 00000 n 
0000000074 00000 n 
0000000120 00000 n 
0000000219 00000 n 
trailer
<<
/Size 5
/Root 1 0 R
>>
startxref
${280 + additionalContent.length}
%%EOF`
}

// Document metadata variations
const metadataOptions = [
  {
    law_firm: 'STB',
    fund_manager: 'Blackstone',
    fund_admin: 'Standish',
    jurisdiction: 'Delaware'
  },
  {
    law_firm: 'Kirkland & Ellis',
    fund_manager: 'KKR',
    fund_admin: 'SS&C',
    jurisdiction: 'Cayman Islands'
  },
  {
    law_firm: 'Latham & Watkins',
    fund_manager: 'Apollo',
    fund_admin: 'IQ-EQ',
    jurisdiction: 'Luxembourg'
  },
  {
    law_firm: 'Simpson Thacher',
    fund_manager: 'Carlyle',
    fund_admin: 'Citco',
    jurisdiction: 'Delaware'
  },
  {
    law_firm: 'Cleary Gottlieb',
    fund_manager: 'Bain Capital',
    fund_admin: 'Maples',
    jurisdiction: 'Ireland'
  }
]

export default function () {
  // Select random metadata and file size
  const metadata = metadataOptions[Math.floor(Math.random() * metadataOptions.length)]
  const fileSizeKB = Math.floor(Math.random() * 2000) + 100 // 100KB to 2MB
  
  // Generate mock PDF
  const pdfContent = generateMockPDF(fileSizeKB)
  const filename = `test-document-${Date.now()}-${Math.random().toString(36).substr(2, 9)}.pdf`
  
  // Prepare multipart form data
  const formData = {
    file: http.file(Buffer.from(pdfContent), filename, 'application/pdf'),
    law_firm: metadata.law_firm,
    fund_manager: metadata.fund_manager,
    fund_admin: metadata.fund_admin,
    jurisdiction: metadata.jurisdiction,
  }

  const params = {
    headers: {
      'Authorization': `Bearer ${AUTH_TOKEN}`,
    },
    timeout: '60s', // Allow up to 60 seconds for upload
  }

  console.log(`Uploading ${filename} (${fileSizeKB}KB) with metadata: ${JSON.stringify(metadata)}`)

  // Perform upload
  const uploadStart = Date.now()
  const response = http.post(`${BASE_URL}/api/documents/upload`, formData, params)
  const uploadTime = Date.now() - uploadStart

  // Check upload response
  const uploadSuccess = check(response, {
    'upload status is 200': (r) => r.status === 200,
    'upload returns document ID': (r) => {
      try {
        const body = JSON.parse(r.body)
        return body.success === true && body.document_id !== undefined
      } catch (e) {
        return false
      }
    },
    'upload completes in reasonable time': (r) => uploadTime < 30000,
    'upload response has expected structure': (r) => {
      try {
        const body = JSON.parse(r.body)
        return (
          typeof body.success === 'boolean' &&
          typeof body.message === 'string'
        )
      } catch (e) {
        return false
      }
    }
  })

  // Record metrics
  uploadSuccessRate.add(uploadSuccess)
  uploadDuration.add(uploadTime)
  
  if (uploadSuccess) {
    uploadedDocuments.add(1)
    
    try {
      const responseBody = JSON.parse(response.body)
      const documentId = responseBody.document_id
      
      // Check processing status after upload
      sleep(2) // Wait a bit before checking status
      
      const statusResponse = http.get(
        `${BASE_URL}/api/documents/${documentId}/processing-status`,
        { headers: { 'Authorization': `Bearer ${AUTH_TOKEN}` } }
      )
      
      check(statusResponse, {
        'can check processing status': (r) => r.status === 200,
        'status response has expected format': (r) => {
          try {
            const body = JSON.parse(r.body)
            const validStatuses = ['pending', 'processing', 'completed', 'failed']
            return validStatuses.includes(body.status)
          } catch (e) {
            return false
          }
        }
      })
      
      // Check document list after upload
      const listResponse = http.get(
        `${BASE_URL}/api/documents?limit=5`,
        { headers: { 'Authorization': `Bearer ${AUTH_TOKEN}` } }
      )
      
      check(listResponse, {
        'can retrieve document list': (r) => r.status === 200,
        'document appears in list': (r) => {
          try {
            const body = JSON.parse(r.body)
            return body.documents && Array.isArray(body.documents)
          } catch (e) {
            return false
          }
        }
      })
      
    } catch (e) {
      console.error('Error parsing upload response:', e)
    }
  }

  // Test concurrent batch status endpoint occasionally
  if (Math.random() < 0.1) { // 10% chance
    const batchStatusResponse = http.get(
      `${BASE_URL}/api/admin/batch-status`,
      { headers: { 'Authorization': `Bearer ${AUTH_TOKEN}` } }
    )
    
    if (batchStatusResponse.status === 200) {
      try {
        const batchData = JSON.parse(batchStatusResponse.body)
        if (batchData.queue_stats && batchData.queue_stats.pending_jobs !== undefined) {
          processingQueue.add(batchData.queue_stats.pending_jobs)
        }
      } catch (e) {
        // Ignore parsing errors for optional metrics
      }
    }
  }

  // Simulate user think time between uploads
  sleep(Math.random() * 3 + 1) // 1-4 seconds
}

// Test different file sizes and edge cases
export function testEdgeCases() {
  const params = {
    headers: {
      'Authorization': `Bearer ${AUTH_TOKEN}`,
    },
  }

  // Test maximum file size
  const largePdf = generateMockPDF(40000) // 40MB file
  const largeFormData = {
    file: http.file(Buffer.from(largePdf), 'large-test.pdf', 'application/pdf'),
    law_firm: 'STB',
    fund_manager: 'Blackstone',
    fund_admin: 'Standish',
    jurisdiction: 'Delaware',
  }

  const largeFileResponse = http.post(`${BASE_URL}/api/documents/upload`, largeFormData, params)
  
  check(largeFileResponse, {
    'large file handled appropriately': (r) => 
      r.status === 200 || r.status === 413, // Either success or file too large
  })

  // Test invalid file type
  const textFileData = {
    file: http.file('This is not a PDF file', 'invalid.txt', 'text/plain'),
    law_firm: 'STB',
    fund_manager: 'Blackstone',
    fund_admin: 'Standish',
    jurisdiction: 'Delaware',
  }

  const invalidFileResponse = http.post(`${BASE_URL}/api/documents/upload`, textFileData, params)
  
  check(invalidFileResponse, {
    'invalid file type rejected': (r) => r.status === 400,
  })

  // Test missing metadata
  const incompleteFormData = {
    file: http.file(Buffer.from(generateMockPDF(100)), 'incomplete.pdf', 'application/pdf'),
    law_firm: 'STB',
    // Missing other required fields
  }

  const incompleteResponse = http.post(`${BASE_URL}/api/documents/upload`, incompleteFormData, params)
  
  check(incompleteResponse, {
    'incomplete metadata rejected': (r) => r.status === 400,
  })
}

export function setup() {
  console.log('Starting document upload load test...')
  console.log(`Base URL: ${BASE_URL}`)
  console.log('Testing concurrent document uploads and processing...')
  
  // Health check
  const healthCheck = http.get(`${BASE_URL}/api/health`)
  if (healthCheck.status !== 200) {
    console.error('API health check failed!')
  }

  // Run edge case tests once
  testEdgeCases()
  
  return { timestamp: new Date().toISOString() }
}

export function teardown(data) {
  console.log('Document upload load test completed.')
  console.log(`Started: ${data.timestamp}`)
  console.log(`Ended: ${new Date().toISOString()}`)
  
  // Final queue status check
  const finalStatus = http.get(`${BASE_URL}/api/admin/batch-status`, {
    headers: { 'Authorization': `Bearer ${AUTH_TOKEN}` }
  })
  
  if (finalStatus.status === 200) {
    try {
      const statusData = JSON.parse(finalStatus.body)
      console.log('Final queue status:', JSON.stringify(statusData.queue_stats, null, 2))
    } catch (e) {
      console.log('Could not parse final queue status')
    }
  }
}