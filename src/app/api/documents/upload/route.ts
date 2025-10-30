import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { processUploadedDocument, queueDocumentProcessingJob } from '@/lib/upload-optimization'
import { throttling } from '@/lib/concurrency-limiter'

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()

    // Check authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    return throttling.upload.run(user.id, async () => {
      const formData = await request.formData()
      const file = formData.get('file') as File
      const metadataString = formData.get('metadata') as string
      
      if (!file) {
        return NextResponse.json(
          { error: 'No file provided' }, 
          { status: 400 }
        )
      }

      // Basic validation
      if (!file.name.toLowerCase().endsWith('.pdf')) {
        return NextResponse.json(
          { error: 'Only PDF files are supported' },
          { status: 400 }
        )
      }

      if (file.size > 50 * 1024 * 1024) { // 50MB limit
        return NextResponse.json(
          { error: 'File size exceeds 50MB limit' },
          { status: 400 }
        )
      }

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
          console.error('Invalid metadata format:', error)
          return NextResponse.json(
            { error: 'Invalid metadata format' }, 
            { status: 400 }
          )
        }
      }

      // Generate unique filename
      const fileExt = file.name.split('.').pop()
      const fileName = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}.${fileExt}`
      const filePath = `${user.id}/${fileName}`

      console.warn(`📤 Uploading file ${file.name} for user ${user.email}`)

      // Upload to Supabase Storage
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('documents')
        .upload(filePath, file, {
          cacheControl: '3600',
          upsert: false,
          contentType: 'application/pdf',
        })

      if (uploadError) {
        console.error('Storage upload error:', uploadError)
        return NextResponse.json(
          { error: 'Failed to upload file' }, 
          { status: 500 }
        )
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
        console.error('Database error:', dbError)
        // Clean up uploaded file
        await supabase.storage.from('documents').remove([uploadData.path])
        return NextResponse.json(
          { error: 'Failed to create document record' }, 
          { status: 500 }
        )
      }

      if (!document || typeof document.id !== 'string') {
        console.error('Invalid document record returned from insert', { document })
        await supabase.storage.from('documents').remove([uploadData.path])
        return NextResponse.json({ error: 'Failed to create document record' }, { status: 500 })
      }

      console.warn(`✅ Document record created: ${document.id}`)

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
          console.error(`Background processing failed for ${documentId}:`, error)
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
    console.error('Upload error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

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
        'user-agent': 'DocumentUploadAutoTrigger'
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
