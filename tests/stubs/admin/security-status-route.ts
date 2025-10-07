import { NextResponse } from 'next/server'

export async function GET() {
  return NextResponse.json({
    auth_health: 'healthy',
    rate_limiting: {
      blocked_requests_count: 0,
      top_blocked_ips: [],
      rate_limit_rules: []
    },
    failed_attempts: 0,
    suspicious_activity: [],
    timestamp: new Date().toISOString()
  })
}
