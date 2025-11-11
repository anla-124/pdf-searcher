import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { processUploadedDocument, queueDocumentProcessingJob } from '@/lib/upload-optimization'
import { throttling } from '@/lib/concurrency-limiter'
import { validateFileFromFormData } from '@/lib/utils/validation-helpers'
import { unauthorizedError, validationError, databaseError, handleApiError } from '@/lib/utils/api-response'
import { logger } from '@/lib/logger'

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()

    // Check authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return unauthorizedError()
    }

    return throttling.upload.run(user.id, async () => {
      const formData = await request.formData()

      // Validate file using shared validation utility
      const fileOrError = await validateFileFromFormData(formData, 'file')
      if (fileOrError instanceof NextResponse) {
        return fileOrError
      }
      const file = fileOrError

      const metadataString = formData.get('metadata') as string

      // Parse metadata if provided
      let metadata: Record<string, unknown> = {}
      if (metadataString) {
        try {
          const parsed = JSON.parse(metadataString)
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            metadata = parsed as Record<string, unknown>
          } else {
            throw new Error('Metadata must be an object')
          }
        } catch (error) {
          logger.error('Invalid metadata format', error as Error)
          return validationError('Invalid metadata format', error instanceof Error ? error.message : undefined)
        }
      }

      // Generate unique filename
      const fileExt = file.name.split('.').pop()
      const fileName = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}.${fileExt}`
      const filePath = `${user.id}/${fileName}`

      logger.info('Uploading file', { filename: file.name, userEmail: user.email, fileSize: file.size })

      // Upload to Supabase Storage
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('documents')
        .upload(filePath, file, {
          cacheControl: '3600',
          upsert: false,
          contentType: 'application/pdf',
        })

      if (uploadError) {
        logger.error('Storage upload error', uploadError as Error, { filePath })
        return databaseError('Failed to upload file', uploadError.message)
      }

      // Create document record
      const { data: document, error: dbError } = await supabase
        .from('documents')
        .insert({
          user_id: user.id,
          title: file.name.replace(/\.[^/.]+$/, ''), // Remove file extension
          filename: file.name,
          file_path: uploadData.path,
          file_size: file.size,
          content_type: 'application/pdf',
          status: 'uploading',
          metadata: metadata,
        })
        .select()
        .single()

      if (dbError) {
        logger.error('Database error creating document record', dbError as Error, { filePath: uploadData.path })
        // Clean up uploaded file
        await supabase.storage.from('documents').remove([uploadData.path])
        return databaseError('Failed to create document record', dbError.message)
      }

      if (!document || typeof document.id !== 'string') {
        logger.error('Invalid document record returned from insert', new Error('Invalid document'), { document })
        await supabase.storage.from('documents').remove([uploadData.path])
        return databaseError('Failed to create document record')
      }

      logger.info('Document record created', { documentId: document.id, filename: file.name })

      const documentId = document.id
      const documentFilename = typeof document.filename === 'string' ? document.filename : file.name
      const documentFilePath = typeof document.file_path === 'string' ? document.file_path : uploadData.path
      const documentFileSize = typeof document.file_size === 'number' ? document.file_size : file.size
      const documentContentType = typeof document.content_type === 'string' ? document.content_type : (file.type || 'application/pdf')

      // Queue processing job and start background execution
      const { jobId, sizeAnalysis } = await queueDocumentProcessingJob({
        documentId,
        userId: user.id,
        filename: documentFilename,
        fileSize: documentFileSize,
        filePath: documentFilePath,
        contentType: documentContentType,
        metadata
      })

      if (!jobId) {
        processUploadedDocument({
          documentId,
          userId: user.id,
          filename: documentFilename,
          fileSize: documentFileSize,
          filePath: documentFilePath,
          contentType: documentContentType,
          metadata,
          sizeAnalysis
        }).catch(error => {
          logger.error('Background processing failed', error as Error, { documentId })
        })
      }

      const isQueued = Boolean(jobId)

      if (isQueued) {
        queueMicrotask(() => triggerCronProcessing(request))
      }

      return NextResponse.json({ 
        id: documentId,
        jobId,
        message: isQueued
          ? 'Document uploaded successfully and queued for processing'
          : 'Document uploaded successfully; processing started immediately',
        status: isQueued ? 'queued' : 'processing'
      })
    })

  } catch (error) {
    logger.error('Upload error', error as Error)
    return handleApiError(error, 'Failed to upload document')
  }
}

function triggerCronProcessing(request: NextRequest) {
  const cronSecret = process.env['CRON_SECRET']
  if (!cronSecret) {
    logger.warn('CRON_SECRET not set; skipping auto-trigger of cron job')
    return
  }

  try {
    const cronUrl = new URL('/api/cron/process-jobs', request.url)
    fetch(cronUrl.toString(), {
      method: 'GET',
      headers: {
        authorization: `Bearer ${cronSecret}`,
        'user-agent': 'DocumentUploadAutoTrigger'
      }
    }).then(response => {
      if (!response.ok) {
        logger.warn('Auto-triggered cron job returned non-OK response', {
          status: response.status,
          statusText: response.statusText
        })
      }
    }).catch(error => {
      logger.warn('Auto-triggered cron job failed', { error: error instanceof Error ? error.message : String(error) })
    })
  } catch (error) {
    logger.warn('Failed to construct cron trigger URL', { error: error instanceof Error ? error.message : String(error) })
  }
}
