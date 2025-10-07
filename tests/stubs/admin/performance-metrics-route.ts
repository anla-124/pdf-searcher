import { NextResponse } from 'next/server'

export async function GET() {
  return NextResponse.json({
    processing: {
      total_documents: 0,
      completed_documents: 0,
      processing_documents: 0,
      error_documents: 0,
      avg_processing_time: 0,
      sync_success_rate: 1,
      batch_success_rate: 1
    },
    cache: {
      hit_rate: 1,
      total_requests: 0,
      cache_hits: 0,
      cache_misses: 0,
      status: 'healthy'
    },
    database: {
      avg_query_time: 0,
      total_queries: 0,
      slow_queries: 0,
      connection_pool_usage: 0,
      active_connections: 0
    },
    system: {
      uptime: '0s',
      memory_usage: 0,
      cpu_usage: 0,
      response_time: 0
    },
    user: {
      active_users: 0,
      total_users: 0,
      new_users: 0
    },
    timestamp: new Date().toISOString()
  })
}
