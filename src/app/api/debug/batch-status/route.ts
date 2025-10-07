import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { batchProcessor } from '@/lib/document-ai-batch'

export async function GET(_request: NextRequest) {
  try {
    const supabase = await createServiceClient()
    
    // Get all processing jobs with batch operation IDs
    const { data: processingJobs, error } = await supabase
      .from('document_jobs')
      .select(`
        id,
        document_id,
        status,
        batch_operation_id,
        created_at,
        documents (
          title,
          filename,
          file_size
        )
      `)
      .eq('status', 'processing')
    
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const batchStatuses = []
    
    for (const job of processingJobs || []) {
      if (job.batch_operation_id) {
        try {
          const batchStatus = await batchProcessor.getOperationStatus(job.batch_operation_id)
          batchStatuses.push({
            jobId: job.id,
            documentId: job.document_id,
            documentTitle: job.documents?.[0]?.title,
            batchOperationId: job.batch_operation_id,
            googleCloudStatus: batchStatus,
            processingDuration: Math.round((Date.now() - new Date(job.created_at).getTime()) / 1000 / 60) // minutes
          })
        } catch (error) {
          batchStatuses.push({
            jobId: job.id,
            documentId: job.document_id,
            documentTitle: job.documents?.[0]?.title,
            batchOperationId: job.batch_operation_id,
            error: error instanceof Error ? error.message : 'Unknown error',
            processingDuration: Math.round((Date.now() - new Date(job.created_at).getTime()) / 1000 / 60) // minutes
          })
        }
      }
    }
    
    return NextResponse.json({
      message: 'Batch status check completed',
      totalProcessingJobs: processingJobs?.length || 0,
      batchStatuses,
      timestamp: new Date().toISOString()
    })
    
  } catch (error) {
    console.error('Batch status check error:', error)
    return NextResponse.json({ 
      error: 'Failed to check batch status',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 })
  }
}