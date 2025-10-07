import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { deleteDocumentFromPinecone, updateDocumentMetadataInPinecone } from '@/lib/pinecone'
import { activityLogger } from '@/lib/activity-logger'
import { DatabaseDocumentWithContent } from '@/types/external-apis'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const supabase = await createClient()
    
    // Check authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: document, error: dbError } = await supabase
      .from('documents')
      .select(
        'id, user_id, title, filename, file_path, file_size, content_type, status, processing_error, extracted_fields, metadata, page_count, created_at, updated_at, document_content(extracted_text)'
      )
      .eq('id', id)
      .eq('user_id', user.id)
      .maybeSingle<DatabaseDocumentWithContent>()

    if (dbError) {
      if (dbError.code === 'PGRST116') {
        return NextResponse.json({ error: 'Document not found' }, { status: 404 })
      }
      console.error('Database error:', dbError)
      return NextResponse.json({ error: 'Failed to fetch document' }, { status: 500 })
    }

    if (!document) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 })
    }

    if (document.document_content && document.document_content.length > 0) {
      document.extracted_text = document.document_content[0].extracted_text
      delete document.document_content
    }

    return NextResponse.json(document)

  } catch (error) {
    console.error('Document fetch error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const supabase = await createClient()
    
    // Check authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get document to check ownership and get file path FIRST
    const { data: document, error: fetchError } = await supabase
      .from('documents')
      .select('file_path, filename')
      .eq('id', id)
      .eq('user_id', user.id)
      .single()

    if (fetchError) {
      if (fetchError.code === 'PGRST116') {
        return NextResponse.json({ error: 'Document not found' }, { status: 404 })
      }
      return NextResponse.json({ error: 'Failed to fetch document' }, { status: 500 })
    }

    // Delete from storage
    const { error: storageError } = await supabase.storage
      .from('documents')
      .remove([document.file_path])

    if (storageError) {
      console.error('Storage deletion error:', storageError)
    }

    // Delete from Pinecone first (before database, in case we need to rollback)
    try {
      await deleteDocumentFromPinecone(id)
      console.warn(`Deleted vectors for document ${id} from Pinecone`)
    } catch (pineconeError) {
      console.error('Pinecone deletion error:', pineconeError)
      // Continue with deletion even if Pinecone fails - we'll clean up stale vectors later
    }

    // Delete from database (CASCADE will handle related records)
    const { error: deleteError } = await supabase
      .from('documents')
      .delete()
      .eq('id', id)
      .eq('user_id', user.id)

    if (deleteError) {
      console.error('Database deletion error:', deleteError)
      return NextResponse.json({ error: 'Failed to delete document' }, { status: 500 })
    }

    // Log activity
    await activityLogger.logActivity({
      userId: user.id,
      userEmail: user.email || '',
      action: 'delete',
      resourceType: 'document',
      resourceId: id,
      resourceName: document.filename || 'Unknown',
      endpoint: `/api/documents/${id}`,
      method: 'DELETE',
      statusCode: 200
    }, request)

    console.warn(`✅ Document ${id} deleted successfully`)
    return NextResponse.json({ message: 'Document deleted successfully' })

  } catch (error) {
    console.error('Document deletion error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const supabase = await createClient()
    
    // Check authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { metadata, title } = body

    if (!metadata && !title) {
      return NextResponse.json({ error: 'Metadata or title is required' }, { status: 400 })
    }

    // Verify the document exists and belongs to the user
    const { data: existingDocument, error: fetchError } = await supabase
      .from('documents')
      .select('id, user_id, title, filename, file_path, file_size, content_type, status, processing_error, extracted_fields, metadata, page_count, created_at, updated_at, document_content(extracted_text)')
      .eq('id', id)
      .eq('user_id', user.id)
      .maybeSingle<DatabaseDocumentWithContent>()

    if (fetchError) {
      if (fetchError.code === 'PGRST116') {
        return NextResponse.json({ error: 'Document not found' }, { status: 404 })
      }
      return NextResponse.json({ error: 'Failed to fetch document' }, { status: 500 })
    }

    if (!existingDocument) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 })
    }

    // Flatten extracted_text from document_content
    if (existingDocument.document_content && existingDocument.document_content.length > 0) {
      existingDocument.extracted_text = existingDocument.document_content[0].extracted_text;
      delete existingDocument.document_content;
    } else {
      existingDocument.extracted_text = ''; // Ensure it's always a string
    }

    // Prepare for a full rename operation: storage, database, and metadata
    const updateData: any = {
      updated_at: new Date().toISOString()
    }

    if (title) {
      // 1. Construct new filename and file path
      const newFilename = `${title}.pdf`
      const oldFilepath = existingDocument.file_path
      const newFilepath = oldFilepath.substring(0, oldFilepath.lastIndexOf('/') + 1) + newFilename
      
      // 2. Move the file in Supabase Storage
      const { error: moveError } = await supabase.storage
        .from('documents')
        .move(existingDocument.file_path, newFilepath)

      if (moveError) {
        console.error('Storage file move error:', moveError)
        return NextResponse.json({ error: 'Failed to rename document in storage.' }, { status: 500 })
      }

      // 3. Prepare database update object
      updateData.title = title
      updateData.filename = newFilename
      updateData.file_path = newFilepath
    }
    
    if (metadata) {
      updateData.metadata = metadata
    }

    // Update the document
    const { data: updatedDocument, error: updateError } = await supabase
      .from('documents')
      .update(updateData)
      .eq('id', id)
      .eq('user_id', user.id)
      .select('id, user_id, title, filename, file_path, file_size, content_type, status, processing_error, extracted_fields, metadata, page_count, created_at, updated_at, document_content(extracted_text)')
      .maybeSingle<DatabaseDocumentWithContent>()

    if (updateError) {
      console.error('Database update error:', updateError)
      return NextResponse.json({ error: 'Failed to update document' }, { status: 500 })
    }

    if (!updatedDocument) {
      return NextResponse.json({ error: 'Failed to update document' }, { status: 500 })
    }

    // Update Pinecone vector metadata if title or metadata changed
    if (title || metadata) {
      try {
        const pineconeMetadata: any = {}
        
        if (title) {
          // The new filename is derived from the new title
          const newFilename = `${title}.pdf`
          pineconeMetadata.filename = newFilename
          pineconeMetadata.original_filename = newFilename
          console.warn(`Preparing to update Pinecone metadata with new filename: ${newFilename}`)
        }
        
        // If business metadata changed, include those updates too
        if (metadata) {
          if (metadata.law_firm) pineconeMetadata.law_firm = metadata.law_firm
          if (metadata.fund_manager) pineconeMetadata.fund_manager = metadata.fund_manager
          if (metadata.fund_admin) pineconeMetadata.fund_admin = metadata.fund_admin
          if (metadata.jurisdiction) pineconeMetadata.jurisdiction = metadata.jurisdiction
          console.warn(`Updating Pinecone metadata for document ${id} with business metadata`)
        }
        
        await updateDocumentMetadataInPinecone(id, pineconeMetadata)
        console.warn(`✅ Successfully updated Pinecone metadata for document ${id}`)
      } catch (pineconeError) {
        console.error('Pinecone metadata update error (non-fatal):', pineconeError)
        // Don't fail the entire request if Pinecone update fails
        // The database update was successful, which is the primary concern
      }
    }

    // Log the successful update activity
    await activityLogger.logActivity({
      userId: user.id,
      userEmail: user.email || '',
      action: 'update',
      resourceType: 'document',
      resourceId: id,
      resourceName: title || existingDocument.title || 'Unknown',
      details: title ? { action: 'rename', newTitle: title } : { action: 'update_metadata' },
      endpoint: `/api/documents/${id}`,
      method: 'PATCH',
      statusCode: 200
    }, request)

    console.warn(`✅ Document ${id} updated successfully`)
    return NextResponse.json(updatedDocument)

  } catch (error) {
    console.error('Document update error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
