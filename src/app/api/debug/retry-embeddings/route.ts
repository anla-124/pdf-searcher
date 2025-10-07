import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { generateAndIndexEmbeddings } from '@/lib/document-processing'

export async function POST(_request: NextRequest) {
  try {
    const supabase = await createServiceClient()
    
    // Find completed documents that have no embeddings (skipped due to timeout)
    const { data: documentsWithoutEmbeddings, error } = await supabase
      .from('documents')
      .select('id, title, extracted_text, metadata')
      .eq('status', 'completed')
      .not('extracted_text', 'is', null)
    
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // Filter documents that have embeddings_skipped = true or no embeddings
    const documentsToFix = documentsWithoutEmbeddings?.filter(doc => {
      const metadata = doc.metadata || {}
      return metadata.embeddings_skipped === true || metadata.embeddings_error
    }) || []

    if (documentsToFix.length === 0) {
      return NextResponse.json({
        message: 'No documents found that need embedding retry',
        totalDocuments: documentsWithoutEmbeddings?.length || 0
      })
    }

    console.warn(`🔄 Retrying embeddings for ${documentsToFix.length} documents`)

    const results = []
    
    for (const doc of documentsToFix) {
      try {
        console.warn(`🔄 Generating embeddings for document: ${doc.title}`)
        
        // Generate embeddings using the legacy function (simpler, no page tracking needed)
        await generateAndIndexEmbeddings(doc.id, doc.extracted_text)
        
        // Update document metadata to remove embeddings_skipped flag
        const updatedMetadata = { ...doc.metadata }
        delete updatedMetadata.embeddings_skipped
        delete updatedMetadata.embeddings_error
        updatedMetadata.embeddings_retry_success = true
        updatedMetadata.embeddings_retry_timestamp = new Date().toISOString()
        
        await supabase
          .from('documents')
          .update({ metadata: updatedMetadata })
          .eq('id', doc.id)
        
        results.push({
          documentId: doc.id,
          title: doc.title,
          status: 'success'
        })
        
        console.warn(`✅ Successfully generated embeddings for: ${doc.title}`)
        
      } catch (error) {
        console.error(`❌ Failed to generate embeddings for ${doc.title}:`, error)
        results.push({
          documentId: doc.id,
          title: doc.title,
          status: 'failed',
          error: error instanceof Error ? error.message : 'Unknown error'
        })
      }
    }
    
    const successful = results.filter(r => r.status === 'success').length
    const failed = results.filter(r => r.status === 'failed').length
    
    return NextResponse.json({
      message: `Embedding retry completed: ${successful} successful, ${failed} failed`,
      totalProcessed: documentsToFix.length,
      successful,
      failed,
      results
    })
    
  } catch (error) {
    console.error('Embedding retry error:', error)
    return NextResponse.json({ 
      error: 'Failed to retry embeddings',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 })
  }
}