import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  try {
    // Only allow in development environment for security
    if (process.env.NODE_ENV === 'production') {
      return NextResponse.json({ 
        error: 'Test endpoint not available in production' 
      }, { status: 403 })
    }

    console.warn('🧪 Manual job processing triggered via test endpoint')

    // Create the URL for the cron endpoint
    const baseUrl = new URL(request.url).origin
    const cronUrl = `${baseUrl}/api/cron/process-jobs`

    // Call the cron endpoint with proper authorization
    const response = await fetch(cronUrl, {
      method: 'GET',
      headers: {
        'authorization': `Bearer ${process.env['CRON_SECRET'] || 'test-secret-for-local-dev'}`,
        'user-agent': 'Manual-Test-Trigger',
        'content-type': 'application/json'
      }
    })

    const result = await response.json()
    
    // Return the result with additional test info
    return NextResponse.json({
      testTrigger: true,
      timestamp: new Date().toISOString(),
      cronResponse: {
        status: response.status,
        statusText: response.statusText,
        data: result
      },
      message: response.ok 
        ? 'Job processing completed successfully' 
        : 'Job processing failed - check logs'
    }, { 
      status: response.status 
    })

  } catch (error) {
    console.error('❌ Test endpoint error:', error)
    return NextResponse.json({ 
      testTrigger: true,
      error: 'Failed to trigger job processing',
      details: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString()
    }, { status: 500 })
  }
}

// Support POST as well for convenience
export async function POST(request: NextRequest) {
  return GET(request)
}