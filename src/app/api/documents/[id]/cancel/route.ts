import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { logger } from '@/lib/logger'

/**
 * Cancel document processing
 * POST /api/documents/[id]/cancel
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: documentId } = await params

  try {
    logger.info('Cancel processing requested', { documentId })

    const supabase = await createServiceClient()

    // 1. Get the document to verify it exists and check current status
    const { data: document, error: docError } = await supabase
      .from('documents')
      .select('id, title, status, user_id')
      .eq('id', documentId)
      .single()

    if (docError || !document) {
      logger.error('Document not found', docError, { documentId })
      return NextResponse.json(
        { error: 'Document not found' },
        { status: 404 }
      )
    }

    // 2. Check if document can be cancelled
    const cancellableStatuses = ['uploading', 'queued', 'processing']
    if (!cancellableStatuses.includes(document.status)) {
      logger.warn('Document cannot be cancelled', {
        documentId,
        currentStatus: document.status
      })
      return NextResponse.json(
        {
          error: `Cannot cancel document with status: ${document.status}`,
          currentStatus: document.status
        },
        { status: 400 }
      )
    }

    // 3. Update document status to cancelled
    const { error: updateDocError } = await supabase
      .from('documents')
      .update({
        status: 'cancelled',
        processing_error: 'Processing cancelled by user',
        updated_at: new Date().toISOString()
      })
      .eq('id', documentId)

    if (updateDocError) {
      logger.error('Failed to update document status', updateDocError, { documentId })
      throw updateDocError
    }

    logger.info('Document status updated to cancelled', { documentId })

    // 4. Cancel any associated processing jobs
    const { data: jobs, error: jobsError } = await supabase
      .from('document_jobs')
      .select('id, status, batch_operation_id')
      .eq('document_id', documentId)
      .in('status', ['queued', 'processing'])

    if (jobsError) {
      logger.error('Failed to fetch jobs', jobsError, { documentId })
      // Don't throw - document is already cancelled
    } else if (jobs && jobs.length > 0) {
      // Cancel all active jobs for this document
      const { error: cancelJobsError } = await supabase
        .from('document_jobs')
        .update({
          status: 'cancelled',
          completed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          error_details: {
            reason: 'Cancelled by user',
            timestamp: new Date().toISOString()
          }
        })
        .eq('document_id', documentId)
        .in('status', ['queued', 'processing'])

      if (cancelJobsError) {
        logger.error('Failed to cancel jobs', cancelJobsError, { documentId })
        // Don't throw - document is already cancelled
      } else {
        logger.info('Cancelled processing jobs', {
          documentId,
          jobsCancelled: jobs.length
        })
      }

      // 5. Handle batch operations if any
      const batchOperationIds = jobs
        .filter(job => job.batch_operation_id)
        .map(job => job.batch_operation_id)

      if (batchOperationIds.length > 0) {
        // Cancel batch operations
        const { error: cancelBatchError } = await supabase
          .from('batch_operations')
          .update({
            status: 'cancelled',
            updated_at: new Date().toISOString()
          })
          .in('id', batchOperationIds)
          .in('status', ['queued', 'processing'])

        if (cancelBatchError) {
          logger.error('Failed to cancel batch operations', cancelBatchError, {
            documentId,
            batchOperationIds
          })
          // Don't throw - document and jobs are already cancelled
        } else {
          logger.info('Cancelled batch operations', {
            documentId,
            batchOperationIds
          })
        }
      }
    }

    // 6. Update processing_status table
    const { error: statusError } = await supabase
      .from('processing_status')
      .update({
        status: 'cancelled',
        progress: 0,
        message: 'Processing cancelled by user',
        updated_at: new Date().toISOString()
      })
      .eq('document_id', documentId)

    if (statusError) {
      logger.error('Failed to update processing status', statusError, { documentId })
      // Don't throw - main cancellation is done
    }

    logger.info('Document processing cancelled successfully', {
      documentId,
      title: document.title
    })

    return NextResponse.json({
      success: true,
      message: 'Processing cancelled successfully',
      documentId,
      status: 'cancelled'
    })

  } catch (error) {
    logger.error('Failed to cancel document processing', error as Error, {
      documentId
    })

    return NextResponse.json(
      {
        error: 'Failed to cancel processing',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    )
  }
}
