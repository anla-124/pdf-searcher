import { NextRequest, NextResponse } from 'next/server'
import { poolHealthCheck, getPoolMetrics } from '@/lib/supabase/server'

export async function GET(_request: NextRequest) {
  try {
    const healthCheck = await poolHealthCheck()
    const metrics = getPoolMetrics()
    
    return NextResponse.json({
      status: healthCheck.healthy ? 'healthy' : 'degraded',
      timestamp: new Date().toISOString(),
      connectionPool: {
        health: healthCheck,
        metrics: {
          ...metrics,
          utilizationRate: `${((metrics.activeConnections / 20) * 100).toFixed(1)}%`,
          efficiency: metrics.connectionsCreated > 0 
            ? `${(((metrics.connectionsCreated - metrics.connectionsDestroyed) / metrics.connectionsCreated) * 100).toFixed(1)}%`
            : '100%'
        }
      }
    }, {
      status: healthCheck.healthy ? 200 : 503,
      headers: {
        'Cache-Control': 'no-cache, must-revalidate',
        'Content-Type': 'application/json'
      }
    })
  } catch (error) {
    console.error('Pool health check failed:', error)
    return NextResponse.json({
      status: 'error',
      timestamp: new Date().toISOString(),
      error: error instanceof Error ? error.message : 'Unknown error',
      connectionPool: {
        health: { healthy: false, details: 'Health check failed' },
        metrics: null
      }
    }, { status: 500 })
  }
}