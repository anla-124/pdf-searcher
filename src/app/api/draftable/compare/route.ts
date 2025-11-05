/**
 * Draftable Comparison API Route
 * Creates document comparisons and returns viewer URLs
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { draftableClient } from '@/lib/draftable'
import { logger } from '@/lib/logger'

export async function POST(request: NextRequest) {
  try {
    // Authenticate user
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      logger.warn('Unauthorized Draftable comparison attempt', { error: authError?.message })
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Parse request body
    const body = await request.json()
    const { sourceDocId, targetDocId } = body

    if (!sourceDocId || !targetDocId) {
      return NextResponse.json({
        error: 'Missing required parameters: sourceDocId and targetDocId'
      }, { status: 400 })
    }

    logger.info('Creating Draftable comparison', {
      userId: user.id,
      sourceDocId,
      targetDocId
    })

    // Fetch source document metadata
    const { data: sourceDoc, error: sourceError } = await supabase
      .from('documents')
      .select('file_path, title, content_type')
      .eq('id', sourceDocId)
      .eq('user_id', user.id)
      .single()

    if (sourceError || !sourceDoc) {
      logger.error('Source document not found', sourceError as Error, {
        sourceDocId,
        userId: user.id
      })
      return NextResponse.json({ error: 'Source document not found' }, { status: 404 })
    }

    // Fetch target document metadata
    const { data: targetDoc, error: targetError } = await supabase
      .from('documents')
      .select('file_path, title, content_type')
      .eq('id', targetDocId)
      .eq('user_id', user.id)
      .single()

    if (targetError || !targetDoc) {
      logger.error('Target document not found', targetError as Error, {
        targetDocId,
        userId: user.id
      })
      return NextResponse.json({ error: 'Target document not found' }, { status: 404 })
    }

    // Generate signed URLs for both documents (1 hour expiry)
    const { data: sourceUrl, error: sourceUrlError } = await supabase.storage
      .from('documents')
      .createSignedUrl(sourceDoc.file_path, 3600)

    if (sourceUrlError || !sourceUrl?.signedUrl) {
      logger.error('Failed to generate source document URL', sourceUrlError as Error, {
        sourceDocId
      })
      return NextResponse.json({
        error: 'Failed to generate source document URL'
      }, { status: 500 })
    }

    const { data: targetUrl, error: targetUrlError } = await supabase.storage
      .from('documents')
      .createSignedUrl(targetDoc.file_path, 3600)

    if (targetUrlError || !targetUrl?.signedUrl) {
      logger.error('Failed to generate target document URL', targetUrlError as Error, {
        targetDocId
      })
      return NextResponse.json({
        error: 'Failed to generate target document URL'
      }, { status: 500 })
    }

    // Determine file type from content_type
    type DraftableFileType = 'pdf' | 'docx' | 'docm' | 'doc' | 'rtf' | 'pptx' | 'pptm' | 'ppt' | 'txt'
    const getFileType = (contentType: string): DraftableFileType => {
      if (contentType.includes('pdf')) return 'pdf'
      if (contentType.includes('docx')) return 'docx'
      if (contentType.includes('doc')) return 'doc'
      if (contentType.includes('rtf')) return 'rtf'
      if (contentType.includes('pptx')) return 'pptx'
      if (contentType.includes('ppt')) return 'ppt'
      if (contentType.includes('txt')) return 'txt'
      return 'pdf' // Default fallback
    }

    // Create comparison via Draftable API
    logger.debug('Creating Draftable comparison', {
      sourceTitle: sourceDoc.title,
      targetTitle: targetDoc.title,
      sourceFileType: getFileType(sourceDoc.content_type),
      targetFileType: getFileType(targetDoc.content_type)
    })

    const comparison = await draftableClient.comparisons.create({
      left: {
        source: sourceUrl.signedUrl,
        fileType: getFileType(sourceDoc.content_type),
        displayName: sourceDoc.title
      },
      right: {
        source: targetUrl.signedUrl,
        fileType: getFileType(targetDoc.content_type),
        displayName: targetDoc.title
      },
      // Set comparison to expire in 2 hours
      expires: new Date(Date.now() + 1000 * 60 * 120)
    })

    logger.info('Draftable comparison created successfully', {
      identifier: comparison.identifier,
      sourceDocId,
      targetDocId,
      userId: user.id
    })

    // Generate signed viewer URL (valid for 1 hour)
    const viewerUrl = draftableClient.comparisons.signedViewerURL(
      comparison.identifier,
      new Date(Date.now() + 1000 * 60 * 60), // 1 hour validity
      false // wait=false (don't wait for comparison to be ready)
    )

    return NextResponse.json({
      success: true,
      viewerUrl,
      identifier: comparison.identifier,
      ready: comparison.ready
    })

  } catch (error) {
    logger.error('Draftable comparison error', error as Error)
    return NextResponse.json({
      error: 'Failed to create comparison',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 })
  }
}
