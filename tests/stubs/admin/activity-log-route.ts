import { NextResponse } from 'next/server'

export async function GET() {
  return NextResponse.json({
    activities: [],
    summary: {
      total: 0,
      today: 0,
      topActions: []
    },
    timestamp: new Date().toISOString()
  })
}
