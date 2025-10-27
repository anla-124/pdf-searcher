import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient, releaseServiceClient } from '@/lib/supabase/server'
import { queueDocumentProcessingJob, processUploadedDocument } from '@/lib/upload-optimization'

function triggerCronProcessing(request: NextRequest) {
  const cronSecret = process.env['CRON_SECRET']
  if (!cronSecret) {
    console.warn('⚠️ CRON_SECRET not set; skipping auto-trigger of cron job')
    return
  }

  try {
    const cronUrl = new URL('/api/cron/process-jobs', request.url)
    fetch(cronUrl.toString(), {
      method: 'GET',
      headers: {
        authorization: `Bearer ${cronSecret}`,
        'user-agent': 'DocumentRetryAutoTrigger'
      }
    }).then(response => {
      if (!response.ok) {
        console.warn('Auto-triggered cron job returned non-OK response', {
          status: response.status,
          statusText: response.statusText
        })
      }
    }).catch(error => {
      console.warn('Auto-triggered cron job failed', error)
    })
  } catch (error) {
    console.warn('Failed to construct cron trigger URL', error)
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: document, error: documentError } = await supabase
      .from('documents')
      .select('id, user_id, title, filename, file_path, file_size, content_type, status, processing_error, metadata, page_count, created_at, updated_at')
      .eq('id', id)
      .eq('user_id', user.id)
      .single()

    if (documentError) {
      if (documentError.code === 'PGRST116') {
        return NextResponse.json({ error: 'Document not found' }, { status: 404 })
      }
      console.error('Failed to fetch document for retry:', documentError)
      return NextResponse.json({ error: 'Failed to fetch document' }, { status: 500 })
    }

    // Allow retry for:
    // 1. Documents with status 'error'
    // 2. Documents with status 'completed' but embeddings_skipped: true
    const hasEmbeddingsSkipped = document.metadata &&
                                 typeof document.metadata === 'object' &&
                                 'embeddings_skipped' in document.metadata &&
                                 document.metadata.embeddings_skipped === true

    if (document.status !== 'error' && !hasEmbeddingsSkipped) {
      return NextResponse.json({
        error: 'Document must be in error state or have failed embeddings to retry'
      }, { status: 400 })
    }

    const cleanedMetadata: Record<string, unknown> | null =
      document.metadata && typeof document.metadata === 'object'
        ? { ...document.metadata }
        : null
    if (cleanedMetadata) {
      delete cleanedMetadata['embeddings_skipped']
      delete cleanedMetadata['embeddings_error']
    }

    let queuedUpdatedAt = ''
    const serviceClient = await createServiceClient()
    try {
      const updatedAt = new Date().toISOString()
      queuedUpdatedAt = updatedAt

      const { data: activeJobs, error: activeJobsError } = await serviceClient
        .from('document_jobs')
        .select('id')
        .eq('document_id', id)
        .in('status', ['queued', 'processing'])

      if (activeJobsError) {
        console.error('Failed to inspect existing jobs for retry:', activeJobsError)
        return NextResponse.json({ error: 'Failed to prepare document retry' }, { status: 500 })
      }

      if (activeJobs && activeJobs.length > 0) {
        return NextResponse.json({ error: 'Document is already queued for processing' }, { status: 409 })
      }

      const updatePayload: Record<string, unknown> = {
        status: 'queued',
        processing_error: null,
        updated_at: updatedAt
      }

      if (cleanedMetadata !== null) {
        updatePayload['metadata'] = cleanedMetadata
      }

      const { error: updateError } = await serviceClient
        .from('documents')
        .update(updatePayload)
        .eq('id', id)

      if (updateError) {
        console.error('Failed to update document before retry:', updateError)
        return NextResponse.json({ error: 'Failed to prepare document for retry' }, { status: 500 })
      }

      const { error: statusInsertError } = await serviceClient
        .from('processing_status')
        .insert({
          document_id: id,
          status: 'queued',
          progress: 10,
          message: 'Retry requested. Document re-queued for processing.'
        })

      if (statusInsertError) {
        console.warn('Failed to log processing status for retry:', statusInsertError)
      }
    } finally {
      releaseServiceClient(serviceClient)
    }

    const filename = typeof document.filename === 'string' ? document.filename : `${id}.pdf`
    const fileSize = typeof document.file_size === 'number' ? document.file_size : 0
    const filePath = typeof document.file_path === 'string' ? document.file_path : null
    const contentType = typeof document.content_type === 'string'
      ? document.content_type
      : 'application/pdf'

    if (!filePath) {
      return NextResponse.json({ error: 'Document file path is missing' }, { status: 500 })
    }

    const { jobId, sizeAnalysis } = await queueDocumentProcessingJob({
      documentId: id,
      userId: user.id,
      filename,
      fileSize,
      filePath,
      contentType,
      metadata: cleanedMetadata || {}
    })

    if (jobId) {
      triggerCronProcessing(request)
    } else {
      processUploadedDocument({
        documentId: id,
        userId: user.id,
        filename,
        fileSize,
        filePath,
        contentType,
        metadata: cleanedMetadata || {},
        sizeAnalysis
      }).catch(error => {
        console.error(`Background retry processing failed for ${id}:`, error)
      })
    }

    const responseDocument = {
      ...document,
      status: jobId ? 'queued' : 'processing',
      processing_error: undefined,
      metadata: cleanedMetadata ?? undefined,
      updated_at: queuedUpdatedAt || new Date().toISOString()
    }

    return NextResponse.json({
      message: 'Document retry queued successfully',
      jobId,
      document: responseDocument
    })

  } catch (error) {
    console.error('Document retry error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
