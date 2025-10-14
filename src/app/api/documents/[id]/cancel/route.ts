import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { logger } from '@/lib/logger'
import { cleanupCancelledDocument } from '@/lib/document-processing'

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

    // 3. Update document status to cancelled (this will trigger cancellation checks in processing)
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
      // Continue with cleanup anyway
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
        } else {
          logger.info('Cancelled batch operations', {
            documentId,
            batchOperationIds
          })
        }
      }
    }

    // 6. Clean up all partial data (embeddings, vectors, files, etc.)
    logger.info('Starting cleanup of partial data for cancelled document', { documentId })

    try {
      // Wait a moment to let processing detect the cancellation
      // This gives the processing loop a chance to clean up gracefully
      await new Promise(resolve => setTimeout(resolve, 2000))

      // Trigger full cleanup - removes ALL partial data from everywhere
      await cleanupCancelledDocument(documentId)

      logger.info('Successfully cleaned up all partial data', {
        documentId,
        title: document.title
      })

      return NextResponse.json({
        success: true,
        message: 'Processing cancelled and all data cleaned up successfully',
        documentId,
        status: 'deleted', // Document is fully deleted
        cleanedUp: true
      })

    } catch (cleanupError) {
      logger.error('Failed to cleanup partial data', cleanupError as Error, { documentId })

      // Even if cleanup fails, the document is marked as cancelled
      return NextResponse.json({
        success: true,
        message: 'Processing cancelled, but cleanup may be incomplete',
        documentId,
        status: 'cancelled',
        cleanedUp: false,
        cleanupError: cleanupError instanceof Error ? cleanupError.message : 'Unknown error'
      })
    }

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
