import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

export async function GET(_request: NextRequest) {
  try {
    // Check if we're in test/CI environment without database credentials
    const hasSupabaseCredentials = process.env.NEXT_PUBLIC_SUPABASE_URL &&
                                   process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

    if (!hasSupabaseCredentials) {
      // In test/CI without credentials, just confirm app is running
      return NextResponse.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        database: 'not-configured',
        uptime: process.uptime(),
      }, { status: 200 })
    }

    // Basic health check with database
    const supabase = await createServiceClient()

    // Test database connection
    const { error } = await supabase
      .from('documents')
      .select('count')
      .limit(1)
      .single()

    const health = {
      status: error ? 'unhealthy' : 'healthy',
      timestamp: new Date().toISOString(),
      database: error ? 'disconnected' : 'connected',
      uptime: process.uptime(),
    }

    return NextResponse.json(health, {
      status: error ? 503 : 200
    })

  } catch (error) {
    return NextResponse.json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 503 })
  }
}