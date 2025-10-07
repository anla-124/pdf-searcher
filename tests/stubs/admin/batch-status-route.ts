import { NextResponse } from 'next/server'

export async function GET() {
  return NextResponse.json({
    queued: [],
    processing: [],
    completed: [],
    failed: [],
    capacity: {
      maxConcurrent: 0,
      currentProcessing: 0
    },
    timestamp: new Date().toISOString()
  })
}
