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
      const batchOperationId = typeof job.batch_operation_id === 'string' ? job.batch_operation_id : null
      if (batchOperationId) {
        try {
          const batchStatus = await batchProcessor.getOperationStatus(batchOperationId)
          const documentTitle = Array.isArray(job.documents)
            ? job.documents[0]?.title ?? null
            : (typeof job.documents === 'object' && job.documents !== null && 'title' in job.documents)
              ? (job.documents as { title?: string }).title ?? null
              : null
          const createdAt = typeof job.created_at === 'string' ? job.created_at : null
          const processingDuration = createdAt
            ? Math.round((Date.now() - new Date(createdAt).getTime()) / 1000 / 60)
            : null

          batchStatuses.push({
            jobId: job.id,
            documentId: job.document_id,
            documentTitle,
            batchOperationId,
            googleCloudStatus: batchStatus,
            processingDuration
          })
        } catch (error) {
          const documentTitle = Array.isArray(job.documents)
            ? job.documents[0]?.title ?? null
            : (typeof job.documents === 'object' && job.documents !== null && 'title' in job.documents)
              ? (job.documents as { title?: string }).title ?? null
              : null
          const createdAt = typeof job.created_at === 'string' ? job.created_at : null
          const processingDuration = createdAt
            ? Math.round((Date.now() - new Date(createdAt).getTime()) / 1000 / 60)
            : null
          batchStatuses.push({
            jobId: job.id,
            documentId: job.document_id,
            documentTitle,
            batchOperationId,
            error: error instanceof Error ? error.message : 'Unknown error',
            processingDuration
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
