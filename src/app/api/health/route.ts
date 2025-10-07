import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

export async function GET(_request: NextRequest) {
  try {
    // Basic health check
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