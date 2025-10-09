import { DocumentProcessorServiceClient } from '@google-cloud/documentai'
import { PDFDocument } from 'pdf-lib'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createServiceClient, releaseServiceClient } from '@/lib/supabase/server'
import { generateEmbeddings } from '@/lib/embeddings-vertex'
import { indexDocumentInPinecone } from '@/lib/pinecone'
import { detectOptimalProcessor, getProcessorId, getProcessorName } from '@/lib/document-ai-config'
import { batchProcessor } from '@/lib/document-ai-batch'
import { getGoogleClientOptions } from '@/lib/google-credentials'
import { SmartRetry, RetryConfigs, circuitBreakers } from '@/lib/retry-logic'
import { logger, measurePerformance, withRequestContext } from '@/lib/logger'
import { analyzeDocumentSize, estimateProcessingTime, requiresSpecialHandling, type DocumentSizeAnalysis } from '@/lib/document-size-strategies'
import { DatabaseDocumentWithContent } from '@/types/external-apis'

// Processing pipeline fingerprint - increment when major changes are made
const PROCESSING_PIPELINE_VERSION = '2.1.0' // Updated for page numbering fix and similarity improvements
const PROCESSING_FEATURES = {
  pageNumbering: 'sequential-fallback', // Uses pageIndex+1 as fallback
  chunkingStrategy: 'paged-chunks-v2',  // Page-aware chunking with overlap
  embeddingRetry: 'unlimited-v1',       // Unlimited retry logic
  structuredLogging: 'winston-pino-v1'  // Structured logging system
}

type CircuitBreakerLike = {
  execute<T>(operation: () => Promise<T>): Promise<T>
} | undefined

async function executeWithCircuitBreaker<T>(
  breaker: CircuitBreakerLike,
  operation: () => Promise<T>
): Promise<T> {
  if (!breaker || typeof breaker.execute !== 'function') {
    return operation()
  }
  return breaker.execute(operation)
}
import type {
  DocumentAIDocument,
  DocumentAITextAnchor,
  DocumentAIBoundingBox,
  BusinessMetadata,
  ExtractedField,
  SimplifiedEntity,
  SimplifiedTable,
  DatabaseDocument
} from '@/types/external-apis'

interface EmbeddingGenerationStats {
  chunkCount: number
  attempts: number
  retryCount: number
}

export interface DocumentProcessingMetrics {
  sizeAnalysis: DocumentSizeAnalysis
  pageCount: number
  chunkCount: number
  embeddingsAttempts: number
  embeddingsRetries: number
  structuredFieldCount: number
  textLength: number
  processor: {
    id: string
    name: string
    type: string
  }
  estimatedProcessingSeconds: number
  excludedSections?: {
    type: string
    startPage: number
    endPage: number
    pageCount: number
    confidence?: number
  }[]
}

export interface ProcessDocumentResult {
  switchedToBatch?: boolean
  metrics?: DocumentProcessingMetrics
}

interface ProcessedDocumentData {
  extractedText: string
  structuredData: ReturnType<typeof extractStructuredFields>
  pageCount: number
  pagesText: { text: string; pageNumber: number }[]
}

interface SaveProcessedDocumentResult {
  embeddingStats: EmbeddingGenerationStats
  excludedSection: {
    type: 'subscription_agreement'
    startPage: number
    endPage: number
    pageCount: number
  } | null
}

export async function processDocument(documentId: string): Promise<ProcessDocumentResult> {
  return withRequestContext({ 
    correlationId: `doc_${documentId}`
  }, async () => {
    return measurePerformance('processDocument', 'document-processing', async () => {
      logger.logDocumentProcessing('initialization', documentId, 'started', {
        operation: 'processDocument',
        component: 'document-processing'
      })

      const supabase = await createServiceClient()
      
      try {
        // Update processing status
        await updateProcessingStatus(documentId, 'processing', 10, 'Starting document processing...')
        logger.logDocumentProcessing('status-update', documentId, 'progress', { progress: 10 })

        // Get document from database
            const { data, error } = await supabase
              .from('documents')
              .select(`
                id,
                user_id,
                title,
                filename,
                file_path,
                file_size,
                content_type,
                status,
                processing_error,
                extracted_fields,
                metadata,
                page_count,
                created_at,
                updated_at,
                document_content(extracted_text)
              `)
              .eq('id', documentId)
              .single()
              .returns<DatabaseDocumentWithContent>();
        
            const document: DatabaseDocumentWithContent | null = data;
            const fetchError: any = error;
        if (fetchError || !document) {
          logger.error('Document not found in database', fetchError || new Error('Document not found'), { documentId })
          throw new Error('Document not found')
        }

        // Flatten extracted_text from document_content
        if (document.document_content && document.document_content.length > 0) {
          document.extracted_text = document.document_content[0]?.extracted_text ?? '';
          delete document.document_content;
        } else {
          document.extracted_text = ''; // Ensure it's always a string
        }

        logger.info('Document retrieved from database', { 
          documentId, 
          filename: document.filename,
          fileSize: document.file_size,
          mimeType: document.mime_type 
        })

        // ENTERPRISE PHASE 1.3: Analyze document size and determine optimal processing strategy
        const sizeAnalysis = analyzeDocumentSize(
          document.file_size, 
          document.filename, 
          document.mime_type
        )
        
        const timeEstimate = estimateProcessingTime(sizeAnalysis)
        const specialHandling = requiresSpecialHandling(sizeAnalysis)
        
        logger.info('Document size analysis completed', {
          documentId,
          tier: sizeAnalysis.tier,
          strategy: sizeAnalysis.strategy,
          estimatedProcessingMinutes: timeEstimate.estimatedMinutes,
          requiresSpecialHandling: specialHandling.requiresSpecialHandling,
          component: 'document-processing'
        })

        // Update status with intelligent time estimate
        const statusMessage = specialHandling.requiresSpecialHandling 
          ? `Preparing ${sizeAnalysis.tier.toLowerCase()} document processing (~${timeEstimate.estimatedMinutes} min estimated)...`
          : 'Downloading document...'
        
        await updateProcessingStatus(documentId, 'processing', 20, statusMessage)
        logger.logDocumentProcessing('download', documentId, 'started', { progress: 20 })

        // Download file from Supabase Storage
        const { data: fileData, error: downloadError } = await supabase.storage
          .from('documents')
          .download(document.file_path)

        if (downloadError || !fileData) {
          logger.error('Failed to download document from storage', downloadError, { 
            documentId, 
            filePath: document.file_path 
          })
          throw new Error('Failed to download document from storage')
        }

        logger.info('Document downloaded from storage', { 
          documentId, 
          filePath: document.file_path,
          fileSize: document.file_size 
        })

        // Convert to base64
        const arrayBuffer = await fileData.arrayBuffer()
        const base64Content = Buffer.from(arrayBuffer).toString('base64')
        logger.debug('Document converted to base64', { documentId, base64Length: base64Content.length })

        // Update processing status
        await updateProcessingStatus(documentId, 'processing', 40, 'Processing with Document AI...')
        logger.logDocumentProcessing('document-ai-processing', documentId, 'started', { progress: 40 })

        // Always try sync processing first - let Document AI tell us if it's too large
        const client = new DocumentProcessorServiceClient(getGoogleClientOptions())
        const fileSizeMB = document.file_size / (1024 * 1024)
        logger.info('Starting Document AI processing', { 
          documentId, 
          fileSizeMB: parseFloat(fileSizeMB.toFixed(1)),
          strategy: 'sync-first' 
        })

        // Process with Google Document AI using intelligent size-based strategy
        // Auto-detect optimal processor based on document characteristics and size analysis
        logger.info('Selecting optimal processor', {
          documentId,
          tier: sizeAnalysis.tier,
          strategy: sizeAnalysis.strategy,
          estimatedPages: sizeAnalysis.estimatedPages,
          component: 'document-processing'
        })
        
        const optimalProcessor = detectOptimalProcessor(document.filename, document.file_size)
        const processorId = getProcessorId(optimalProcessor)
        const name = getProcessorName(processorId)
        
        logger.info('Document AI processor selected', { 
          documentId, 
          processor: optimalProcessor,
          processorId 
        })
        
        const request = {
          name,
          rawDocument: {
            content: base64Content,
            mimeType: 'application/pdf',
          },
        }

        let result;
        try {
          // Use smart retry with circuit breaker for Document AI processing
          const retryResult = await circuitBreakers.documentAI.execute(async () => {
            return await SmartRetry.execute(
              async () => {
                logger.debug('Attempting Document AI processing', { 
                  documentId,
                  processor: optimalProcessor 
                })
                const response = await client.processDocument(request)
                return Array.isArray(response) ? response[0] : response
              },
              RetryConfigs.documentAI
            )
          })

          if (!retryResult.success) {
            throw retryResult.error
          }

          result = retryResult.result!
          logger.info('Document AI processing completed successfully', { 
            documentId,
            attempts: retryResult.attempts,
            totalTime: retryResult.totalTime,
            processor: optimalProcessor
          })

        } catch (error: unknown) {
          // Handle page limit errors by processing document in manageable chunks before falling back to batch
          if ((error as any)?.code === 3 && (error as any)?.details?.includes('exceed the limit')) {
            logger.warn('Page limit exceeded, attempting chunked processing fallback', {
              documentId,
              errorCode: (error as any).code,
              errorDetails: (error as any).details
            })

            try {
              const chunkedData = await processDocumentInChunks(
                arrayBuffer,
                processorId,
                name,
                optimalProcessor,
                documentId,
                client
              )

              await updateProcessingStatus(documentId, 'processing', 60, 'Extracting structured data from chunks...')
              await updateProcessingStatus(documentId, 'processing', 80, 'Generating embeddings from chunks...')
              logger.logDocumentProcessing('embedding-generation', documentId, 'started', { progress: 80 })

              const { embeddingStats, excludedSection } = await saveProcessedDocumentData(
                supabase,
                documentId,
                chunkedData,
                document,
                sizeAnalysis
              )

              await updateProcessingStatus(documentId, 'completed', 100, 'Document processing completed successfully')
              logger.logDocumentProcessing('embedding-generation', documentId, 'completed', { progress: 100 })

              await supabase
                .from('documents')
                .update({
                  status: 'completed',
                  processing_error: null,
                  updated_at: new Date().toISOString()
                })
                .eq('id', documentId)

              logger.logDocumentProcessing('completion', documentId, 'completed')
              await invalidateDocumentCaches(documentId, document.user_id)

              const metrics: DocumentProcessingMetrics = {
                sizeAnalysis,
                pageCount: chunkedData.pageCount,
                chunkCount: embeddingStats.chunkCount,
                embeddingsAttempts: embeddingStats.attempts,
                embeddingsRetries: embeddingStats.retryCount,
                structuredFieldCount: chunkedData.structuredData.fields?.length || 0,
                textLength: chunkedData.extractedText.length,
                processor: {
                  id: processorId,
                  name,
                  type: `${optimalProcessor}-chunked`
                },
                estimatedProcessingSeconds: timeEstimate.estimatedMinutes * 60
              }

              if (excludedSection) {
                metrics.excludedSections = [{
                  type: excludedSection.type,
                  startPage: excludedSection.startPage,
                  endPage: excludedSection.endPage,
                  pageCount: excludedSection.pageCount
                }]
              }

              logger.info('Chunked processing completed successfully', {
                documentId,
                chunksProcessed: metrics.chunkCount,
                totalPages: metrics.pageCount
              })

              return { switchedToBatch: false, metrics }
            } catch (chunkError) {
              logger.error('Chunked processing fallback failed', chunkError as Error, { documentId })
              try {
                await processBatchDocument(documentId)
                logger.info('Successfully switched to batch processing', { documentId })
                const fallbackMetrics: DocumentProcessingMetrics = {
                  sizeAnalysis,
                  pageCount: 0,
                  chunkCount: 0,
                  embeddingsAttempts: 0,
                  embeddingsRetries: 0,
                  structuredFieldCount: 0,
                  textLength: 0,
                  processor: {
                    id: processorId,
                    name,
                    type: optimalProcessor
                  },
                  estimatedProcessingSeconds: timeEstimate.estimatedMinutes * 60
                }
                return { switchedToBatch: true, metrics: fallbackMetrics }
              } catch (batchError) {
                logger.error('Failed to switch to batch processing', batchError as Error, { documentId })
                throw batchError
              }
            }
          }
          // Re-throw other errors
          logger.error('Document AI processing failed', error as Error, { documentId })
          throw error
        }
    
        if (!result.document) {
          logger.error('No document returned from Document AI', undefined, { documentId })
          throw new Error('No document returned from Document AI')
        }

        // Update processing status
        await updateProcessingStatus(documentId, 'processing', 60, 'Extracting structured data...')
        logger.logDocumentProcessing('data-extraction', documentId, 'started', { progress: 60 })

        const processedData = buildProcessedDocumentData(result.document as unknown as DocumentAIDocument)

        logger.info('Document data extracted successfully', {
          documentId,
          textLength: processedData.extractedText.length,
          pageCount: processedData.pageCount,
          fieldsCount: processedData.structuredData.fields?.length || 0
        })

        await updateProcessingStatus(documentId, 'processing', 80, 'Generating embeddings...')
        logger.logDocumentProcessing('embedding-generation', documentId, 'started', { progress: 80 })

        const { embeddingStats, excludedSection } = await saveProcessedDocumentData(
          supabase,
          documentId,
          processedData,
          document,
          sizeAnalysis
        )

        await updateProcessingStatus(documentId, 'completed', 100, 'Document processing completed successfully')
        logger.logDocumentProcessing('embedding-generation', documentId, 'completed', { progress: 100 })

        await supabase
          .from('documents')
          .update({
            status: 'completed',
            processing_error: null,
            updated_at: new Date().toISOString()
          })
          .eq('id', documentId)

        logger.logDocumentProcessing('completion', documentId, 'completed')
        await invalidateDocumentCaches(documentId, document.user_id)

        const metrics: DocumentProcessingMetrics = {
          sizeAnalysis,
          pageCount: processedData.pageCount,
          chunkCount: embeddingStats.chunkCount,
          embeddingsAttempts: embeddingStats.attempts,
          embeddingsRetries: embeddingStats.retryCount,
          structuredFieldCount: processedData.structuredData.fields?.length || 0,
          textLength: processedData.extractedText.length,
          processor: {
            id: processorId,
            name,
            type: optimalProcessor
          },
          estimatedProcessingSeconds: timeEstimate.estimatedMinutes * 60
        }

        if (excludedSection) {
          metrics.excludedSections = [{
            type: excludedSection.type,
            startPage: excludedSection.startPage,
            endPage: excludedSection.endPage,
            pageCount: excludedSection.pageCount
          }]
        }

        return { switchedToBatch: false, metrics } // Successful sync processing

      } catch (error) {
        logger.error('Document processing failed', error as Error, { 
          documentId,
          component: 'document-processing',
          operation: 'processDocument'
        })
        
        // Update document and processing status with error
        await supabase
          .from('documents')
          .update({
            status: 'error',
            processing_error: error instanceof Error ? error.message : 'Unknown processing error'
          })
          .eq('id', documentId)

        await updateProcessingStatus(
          documentId, 
          'error', 
          0, 
          'Processing failed',
          error instanceof Error ? error.message : 'Unknown error'
        )
        
        logger.logDocumentProcessing('processing', documentId, 'failed', { 
          error: error instanceof Error ? error.message : 'Unknown error' 
        })
        
        // Re-throw the error so job processor can handle it
        throw error
      } finally {
        releaseServiceClient(supabase)
      }
    })
  })
}

async function updateProcessingStatus(
  documentId: string,
  status: 'queued' | 'processing' | 'completed' | 'error',
  progress: number,
  message?: string,
  error?: string
) {
  const supabase = await createServiceClient()
  
  try {
    await supabase.from('processing_status').insert({
      document_id: documentId,
      status,
      progress,
      message,
      error,
    })
  } finally {
    releaseServiceClient(supabase)
  }
}

function extractStructuredFields(document: DocumentAIDocument, pageOffset: number = 0) {
  const fields: ExtractedField[] = []
  const entities: SimplifiedEntity[] = []
  const tables: SimplifiedTable[] = []

  const fullText = document.text || ''

  if (document.entities) {
    for (const entity of document.entities) {
      if (entity.type && entity.mentionText) {
        const pageNumber = getPageNumber(entity.pageAnchor)
        const adjustedPageNumber = pageNumber !== null ? pageNumber + pageOffset : undefined
        const boundingBox = getBoundingBox(entity.pageAnchor)

        fields.push({
          name: entity.type,
          value: entity.mentionText,
          type: getFieldType(entity.type),
          confidence: entity.confidence || 0,
          pageNumber: adjustedPageNumber,
          boundingBox: boundingBox ?? undefined,
        })

        entities.push({
          type: entity.type,
          value: entity.mentionText,
          confidence: entity.confidence,
          pageNumber: adjustedPageNumber,
        })
      }
    }
  }

  if (document.pages) {
    for (const page of document.pages) {
      const pageNumber = page.pageNumber || 1
      const adjustedPageNumber = pageNumber + pageOffset

      if (page.formFields) {
        for (const field of page.formFields) {
          const fieldName = getTextFromTextAnchor(fullText, field.fieldName?.textAnchor)
          const fieldValue = getTextFromTextAnchor(fullText, field.fieldValue?.textAnchor)

          if (fieldName && fieldValue) {
            fields.push({
              name: fieldName.trim(),
              value: fieldValue.trim(),
              type: 'text',
              confidence: field.fieldName?.confidence || 0,
              pageNumber: adjustedPageNumber,
            })
          }
        }
      }

      if ((page as any).keyValuePairs) {
        for (const kvp of (page as any).keyValuePairs) {
          const keyText = getTextFromTextAnchor(fullText, kvp.key?.textAnchor)
          const valueText = getTextFromTextAnchor(fullText, kvp.value?.textAnchor)

          if (keyText && valueText) {
            fields.push({
              name: keyText.trim(),
              value: valueText.trim(),
              type: 'text',
              confidence: kvp.key?.confidence || 0,
              pageNumber: adjustedPageNumber,
            })
          }
        }
      }

      if (page.tables) {
        for (const table of page.tables) {
          const headerRows = (table.headerRows || [])
            .map(row => (row.cells || [])
              .map(cell => getTextFromTextAnchor(fullText, cell.layout?.textAnchor))
              .filter((cellText): cellText is string => !!cellText && cellText.trim().length > 0)
              .map(cellText => cellText.trim()))
            .filter(row => row.length > 0)

          const bodyRows = (table.bodyRows || [])
            .map(row => (row.cells || [])
              .map(cell => getTextFromTextAnchor(fullText, cell.layout?.textAnchor))
              .filter((cellText): cellText is string => !!cellText && cellText.trim().length > 0)
              .map(cellText => cellText.trim()))
            .filter(row => row.length > 0)

          if (bodyRows.length > 0) {
            tables.push({
              pageNumber: adjustedPageNumber,
              headerRows: headerRows.length > 0 ? headerRows : undefined,
              bodyRows,
            })
          }
        }
      }
    }
  }

  return {
    fields,
    entities,
    tables,
  }
}

function getFieldType(entityType: string): 'text' | 'number' | 'date' | 'currency' | 'address' | 'phone' | 'email' | 'url' | 'boolean' {
  const type = entityType.toLowerCase()
  if (type.includes('date') || type.includes('time')) return 'date'
  if (type.includes('number') || type.includes('amount') || type.includes('price')) return 'number'
  if (type.includes('currency') || type.includes('money') || type.includes('dollar')) return 'currency'
  if (type.includes('address')) return 'address'
  if (type.includes('phone') || type.includes('tel')) return 'phone'
  if (type.includes('email') || type.includes('mail')) return 'email'
  if (type.includes('url') || type.includes('link') || type.includes('website')) return 'url'
  if (type.includes('checkbox') || type.includes('bool')) return 'boolean'
  return 'text'
}

function getPageNumber(pageAnchor: { pageRefs?: Array<{ page?: string | number }> } | undefined): number | null {
  const pageValue = pageAnchor?.pageRefs?.[0]?.page
  if (pageValue !== undefined && pageValue !== null) {
    return parseInt(pageValue as any) + 1 // Convert to 1-based
  }
  return null
}

function getBoundingBox(pageAnchor: { pageRefs?: Array<{ boundingPoly?: DocumentAIBoundingBox }> } | undefined): DocumentAIBoundingBox | null {
  if (pageAnchor?.pageRefs?.[0]?.boundingPoly) {
    return pageAnchor.pageRefs[0].boundingPoly
  }
  return null
}

function getTextFromTextAnchor(documentText: string, textAnchor: DocumentAITextAnchor | undefined): string | null {
  if (!textAnchor?.textSegments?.[0]) return null
  
  const segment = textAnchor.textSegments[0]
  const startIndex = parseInt(segment.startIndex || '0')
  const endIndex = parseInt(segment.endIndex || documentText.length.toString())
  
  return documentText.substring(startIndex, endIndex)
}

// Generate embeddings with page tracking (enterprise-scale version)
export async function generateAndIndexPagedEmbeddings(
  documentId: string, 
  document: DocumentAIDocument, 
  sizeAnalysis?: DocumentSizeAnalysis
): Promise<{ chunkCount: number }> {
  const supabase = await createServiceClient()

  try {
    const { data: docRecord, error: docError } = await supabase
      .from('documents')
      .select('metadata, filename')
      .eq('id', documentId)
      .single()

    if (docError) {
      logger.warn('Could not fetch document metadata', { documentId, error: docError?.message, component: 'document-processing' })
    }

    const businessMetadata = docRecord?.metadata || {}
    const filename = docRecord?.filename || ''
    const pagesText = extractTextByPages(document)

    return await generateEmbeddingsFromPages(documentId, pagesText, businessMetadata, filename, sizeAnalysis)
  } finally {
    releaseServiceClient(supabase)
  }
}

// Extract chunk processing into separate function for better error handling
async function processChunkWithRetry(documentId: string, pagedChunk: PagedChunk, businessMetadata: BusinessMetadata, filename: string): Promise<void> { // Add filename
  try {
    // Generate embedding with Vertex AI using smart retry
    const embeddingResult = await executeWithCircuitBreaker(circuitBreakers.vertexAI, async () => {
      return await SmartRetry.execute(
        async () => {
          logger.debug('Generating embeddings for chunk', { chunkIndex: pagedChunk.chunkIndex, component: 'document-processing' })
          return await generateEmbeddings(pagedChunk.text)
        },
        RetryConfigs.vertexEmbeddings
      )
    })

    if (!embeddingResult.success) {
      logger.error('Failed to generate embeddings for chunk', embeddingResult.error, { chunkIndex: pagedChunk.chunkIndex, component: 'document-processing' })
      throw embeddingResult.error
    }

    const embedding = embeddingResult.result!
    logger.debug('Embeddings generated successfully', { chunkIndex: pagedChunk.chunkIndex, attempts: embeddingResult.attempts, component: 'document-processing' })
    
    // Create unique vector ID
    const vectorId = `${documentId}_chunk_${pagedChunk.chunkIndex}`
    
    // Store embedding in Supabase with retry logic
    const supabaseResult = await SmartRetry.execute(
      async () => {
        const supabase = await createServiceClient()

        try {
          const { error } = await supabase.from('document_embeddings').insert({
            document_id: documentId,
            vector_id: vectorId,
            embedding,
            chunk_text: pagedChunk.text,
            chunk_index: pagedChunk.chunkIndex,
            page_number: pagedChunk.pageNumber,
          })
          
          logger.debug('Stored embedding in database', { 
            chunkIndex: pagedChunk.chunkIndex, 
            pageNumber: pagedChunk.pageNumber, 
            textLength: pagedChunk.text.length,
            vectorId,
            component: 'document-processing'
          })
          
          if (error) throw error
          return true
        } finally {
          releaseServiceClient(supabase)
        }
      },
      RetryConfigs.supabaseOperations
    )
    
    if (!supabaseResult.success) {
      logger.error('Failed to store embedding in Supabase', supabaseResult.error, { vectorId, component: 'document-processing' })
      throw new Error(`Supabase storage failed: ${supabaseResult.error?.message}`)
    }

    // Index in Pinecone with retry logic and circuit breaker
    const pineconeResult = await executeWithCircuitBreaker(circuitBreakers.pinecone, async () => {
      return await SmartRetry.execute(
        async () => {
          logger.debug('Indexing vector in Pinecone', { vectorId, component: 'document-processing' })
          await indexDocumentInPinecone(vectorId, embedding, {
            document_id: documentId,
            chunk_index: pagedChunk.chunkIndex,
            page_number: pagedChunk.pageNumber,
            text: pagedChunk.text,
            filename: filename, // Add filename
            // Include business metadata for filtering
            ...businessMetadata
          })
          return true
        },
        RetryConfigs.pineconeIndexing
      )
    })

    if (!pineconeResult.success) {
      logger.error('Failed to index vector in Pinecone', pineconeResult.error, { vectorId, component: 'document-processing' })
      throw new Error(`Pinecone indexing failed: ${pineconeResult.error?.message}`)
    }

    logger.debug('Vector indexed successfully in Pinecone', { vectorId, component: 'document-processing' })
  } catch (error) {
    logger.error('Chunk processing failed', error as Error, { chunkIndex: pagedChunk.chunkIndex, component: 'document-processing' })
    throw error
  }
}

function getManualSubscriptionRange(metadata: Record<string, any> | null | undefined): { startPage: number; endPage: number } | null {
  if (!metadata) return null

  if (metadata.subscription_agreement_skipped === true) {
    return null
  }

  const start = Number(metadata.subscription_agreement_start_page)
  const end = Number(metadata.subscription_agreement_end_page)

  if (!Number.isFinite(start) || !Number.isFinite(end)) return null

  const startPage = Math.floor(start)
  const endPage = Math.floor(end)

  if (startPage < 1 || endPage < 1 || endPage < startPage) {
    return null
  }

  return { startPage, endPage }
}

function applyManualExclusions(
  pagesText: { text: string; pageNumber: number }[],
  range: { startPage: number; endPage: number } | null
): {
  filteredPages: { text: string; pageNumber: number }[]
  exclusion: {
    type: 'subscription_agreement'
    startPage: number
    endPage: number
    pageCount: number
    pageNumbers: number[]
  } | null
} {
  if (!range) {
    return { filteredPages: pagesText, exclusion: null }
  }

  const excludedPageNumbers = pagesText
    .filter(page => page.pageNumber >= range.startPage && page.pageNumber <= range.endPage)
    .map(page => page.pageNumber)

  if (excludedPageNumbers.length === 0) {
    return { filteredPages: pagesText, exclusion: null }
  }

  const filteredPages = pagesText.filter(
    page => page.pageNumber < range.startPage || page.pageNumber > range.endPage
  )

  if (filteredPages.length === 0) {
    logger.warn('Manual subscription agreement range excludes all pages; ignoring exclusion', {
      range,
      totalPages: pagesText.length
    })
    return { filteredPages: pagesText, exclusion: null }
  }

  return {
    filteredPages,
    exclusion: {
      type: 'subscription_agreement',
      startPage: range.startPage,
      endPage: range.endPage,
      pageCount: excludedPageNumbers.length,
      pageNumbers: excludedPageNumbers
    }
  }
}

async function saveProcessedDocumentData(
  supabase: SupabaseClient,
  documentId: string,
  processedData: ProcessedDocumentData,
  documentRecord: DatabaseDocumentWithContent,
  sizeAnalysis?: DocumentSizeAnalysis
): Promise<SaveProcessedDocumentResult> {
  const existingMetadata = (documentRecord.metadata || {}) as Record<string, any>
  const manualRange = getManualSubscriptionRange(existingMetadata)
  const { filteredPages, exclusion } = applyManualExclusions(processedData.pagesText, manualRange)
  const pagesForEmbedding = filteredPages.length > 0 ? filteredPages : processedData.pagesText

  if (exclusion) {
    logger.info('Applying manual subscription agreement exclusion', {
      documentId,
      startPage: exclusion.startPage,
      endPage: exclusion.endPage,
      pageCount: exclusion.pageCount
    })
  } else if (manualRange) {
    logger.warn('Manual subscription agreement range provided but no pages were excluded', {
      documentId,
      range: manualRange
    })
  }

  let metadataUpdate: Record<string, any> | undefined

  if (exclusion) {
    const currentSections = Array.isArray(existingMetadata.excluded_sections)
      ? existingMetadata.excluded_sections.filter((section: any) => section?.type !== 'subscription_agreement')
      : []

    const subscriptionSection = {
      type: 'subscription_agreement',
      start_page: exclusion.startPage,
      end_page: exclusion.endPage,
      page_count: exclusion.pageCount,
      excluded_page_numbers: exclusion.pageNumbers,
      supplied_via: 'user-input',
      updated_at: new Date().toISOString()
    }

    metadataUpdate = {
      ...existingMetadata,
      excluded_sections: [...currentSections, subscriptionSection],
      subscription_agreement: {
        excluded: true,
        start_page: exclusion.startPage,
        end_page: exclusion.endPage,
        excluded_pages_count: exclusion.pageCount,
        supplied_via: 'user-input'
      }
    }

    ;(documentRecord as any).metadata = metadataUpdate
  }

  const processingMetadata = {
    fields: processedData.structuredData.fields,
    entities: processedData.structuredData.entities,
    tables: processedData.structuredData.tables,
    processing_pipeline: {
      version: PROCESSING_PIPELINE_VERSION,
      features: PROCESSING_FEATURES,
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV || 'development'
    },
    excluded_sections: metadataUpdate?.excluded_sections
  }

  const documentUpdate: Record<string, any> = {
    extracted_fields: processingMetadata,
    page_count: processedData.pageCount,
    status: 'processing'
  }

  if (metadataUpdate) {
    documentUpdate.metadata = metadataUpdate
  }

  const { error: updateError } = await supabase
    .from('documents')
    .update(documentUpdate)
    .eq('id', documentId)

  if (updateError) {
    logger.error('Failed to update document with extracted data', updateError, { documentId })
    throw new Error('Failed to update document with extracted data')
  }

  const { error: contentError } = await supabase
    .from('document_content')
    .upsert({
      document_id: documentId,
      extracted_text: processedData.extractedText
    }, { onConflict: 'document_id' })

  if (contentError) {
    logger.error('Failed to store extracted text in document_content', contentError, { documentId })
    throw new Error('Failed to store extracted text in document_content')
  }

  // Replace existing extracted fields to avoid duplicates on reprocessing
  await supabase
    .from('extracted_fields')
    .delete()
    .eq('document_id', documentId)

  if (processedData.structuredData.fields && processedData.structuredData.fields.length > 0) {
    const fieldsToInsert = processedData.structuredData.fields.map((field: ExtractedField) => ({
      document_id: documentId,
      field_name: field.name || 'Unknown',
      field_value: field.value || '',
      field_type: field.type || 'text',
      confidence: field.confidence || 0,
      page_number: field.pageNumber || null,
      bounding_box: field.boundingBox || null
    }))

    if (fieldsToInsert.length > 0) {
      await supabase.from('extracted_fields').insert(fieldsToInsert)
      logger.debug('Extracted fields stored in database', {
        documentId,
        fieldsCount: fieldsToInsert.length
      })
    }
  }

  const embeddingStats = await generateEmbeddingsWithUnlimitedRetries(
    documentId,
    null,
    documentRecord as unknown as DatabaseDocument,
    sizeAnalysis,
    pagesForEmbedding
  )

  return {
    embeddingStats,
    excludedSection: exclusion
  }
}

async function processDocumentInChunks(
  pdfArrayBuffer: ArrayBuffer,
  processorId: string,
  processorName: string,
  processorType: string,
  documentId: string,
  client: DocumentProcessorServiceClient
): Promise<ProcessedDocumentData> {
  const pdfDoc = await PDFDocument.load(pdfArrayBuffer)
  const totalPages = pdfDoc.getPageCount()

  const configuredLimit = parseInt(process.env['DOCUMENT_AI_SYNC_PAGE_LIMIT'] || '15', 10)
  // Google Document AI OCR processors cap synchronous requests at 15 pages; keep chunks within that hard limit
  const maxPagesPerChunk = Number.isFinite(configuredLimit) && configuredLimit > 0 ? Math.min(configuredLimit, 15) : 15

  logger.info('Processing document with chunked strategy', {
    documentId,
    totalPages,
    maxPagesPerChunk
  })

  const aggregatedTextParts: string[] = []
  const aggregatedFields: ExtractedField[] = []
  const aggregatedEntities: SimplifiedEntity[] = []
  const aggregatedTables: SimplifiedTable[] = []
  const aggregatedPagesText: { text: string; pageNumber: number }[] = []
  let totalPageCount = 0

  for (let start = 0; start < totalPages; start += maxPagesPerChunk) {
    const end = Math.min(totalPages, start + maxPagesPerChunk)
    const pageIndices = Array.from({ length: end - start }, (_, index) => start + index)

    logger.debug('Creating chunk for Document AI processing', {
      documentId,
      chunkStartPage: start + 1,
      chunkEndPage: end
    })

    const chunkDoc = await PDFDocument.create()
    const copiedPages = await chunkDoc.copyPages(pdfDoc, pageIndices)
    copiedPages.forEach(page => chunkDoc.addPage(page))

    const chunkBytes = await chunkDoc.save()
    const chunkBase64 = Buffer.from(chunkBytes).toString('base64')

    const chunkRequest = {
      name: processorName,
      rawDocument: {
        content: chunkBase64,
        mimeType: 'application/pdf'
      }
    }

    const chunkResult = await circuitBreakers.documentAI.execute(async () => {
      return await SmartRetry.execute(
        async () => {
          logger.debug('Attempting Document AI chunk processing', {
            documentId,
            processor: processorType,
            processorId,
            chunkStartPage: start + 1,
            chunkEndPage: end
          })
          const response = await client.processDocument(chunkRequest)
          return Array.isArray(response) ? response[0] : response
        },
        RetryConfigs.documentAI
      )
    })

    if (!chunkResult.success) {
      throw chunkResult.error
    }

    const chunkDocument = chunkResult.result!.document

    if (!chunkDocument) {
      throw new Error('No document returned from Document AI chunk')
    }

    const chunkData = buildProcessedDocumentData(chunkDocument as unknown as DocumentAIDocument, start)

    if (chunkData.extractedText) {
      aggregatedTextParts.push(chunkData.extractedText)
    }

    aggregatedFields.push(...(chunkData.structuredData.fields || []))
    aggregatedEntities.push(...(chunkData.structuredData.entities || []))
    aggregatedTables.push(...(chunkData.structuredData.tables || []))
    aggregatedPagesText.push(...chunkData.pagesText)
    totalPageCount += chunkData.pageCount
  }

  return {
    extractedText: aggregatedTextParts.join('\n'),
    structuredData: {
      fields: aggregatedFields,
      entities: aggregatedEntities,
      tables: aggregatedTables
    },
    pageCount: totalPageCount,
    pagesText: aggregatedPagesText
  }
}

// Legacy function for backward compatibility - FIXED: Connection pool memory leak
export async function generateAndIndexEmbeddings(documentId: string, text: string): Promise<void> {
  // FIXED: Reuse single connection throughout the function
  const supabase = await createServiceClient()
  
  try {
    // Get document metadata for Pinecone indexing
    const { data: docRecord, error: docError } = await supabase
      .from('documents')
      .select('metadata')
      .eq('id', documentId)
      .single()

    if (docError) {
      logger.warn('Could not fetch document metadata (legacy)', { documentId, error: docError?.message, component: 'document-processing' })
    }

    const businessMetadata = docRecord?.metadata || {}

    // Split text into chunks for embedding
    const chunks = splitTextIntoChunks(text, 1000) // 1000 character chunks with overlap
    
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i]
      if (!chunk) continue
      
      // Generate embedding with Vertex AI
      const embedding = await generateEmbeddings(chunk)
      
      // Create unique vector ID
      const vectorId = `${documentId}_chunk_${i}`
      
      // FIXED: Reuse existing connection instead of creating new one in loop
      const { error: supabaseError } = await supabase.from('document_embeddings').insert({
        document_id: documentId,
        vector_id: vectorId,
        embedding,
        chunk_text: chunk,
        chunk_index: i,
        page_number: null, // Legacy documents don't have page tracking
      })
      
      if (supabaseError) {
        logger.error('Failed to store embedding in Supabase', supabaseError, { vectorId, component: 'document-processing' })
        throw new Error(`Supabase storage failed: ${supabaseError.message}`)
      }
      
      // Index in Pinecone with business metadata
      await indexDocumentInPinecone(vectorId, embedding, {
        document_id: documentId,
        chunk_index: i,
        text: chunk,
        // Include business metadata for filtering
        ...businessMetadata
      })
    }
  } finally {
    // FIXED: Ensure connection is properly released back to pool
    releaseServiceClient(supabase)
  }
}

// Interface for text chunks with page information
interface PagedChunk {
  text: string
  chunkIndex: number
  pageNumber: number
}

// Extract text page by page from Document AI result
function extractTextByPages(document: DocumentAIDocument, pageOffset: number = 0): { text: string; pageNumber: number }[] {
  const pagesText: { text: string; pageNumber: number }[] = []
  
  if (document.pages) {
    for (let pageIndex = 0; pageIndex < document.pages.length; pageIndex++) {
      const page = document.pages[pageIndex]
      if (!page) continue
      // Use 1-based page numbering: either the explicit pageNumber or the array index + 1
      const pageNumber = page.pageNumber || (pageIndex + 1)
      const adjustedPageNumber = pageNumber + pageOffset
      
      logger.debug('Processing document page', { 
        pageIndex: pageIndex + 1, 
        documentAIPageNumber: page.pageNumber, 
        assignedPageNumber: adjustedPageNumber,
        component: 'document-processing'
      })
      
      // Extract text for this specific page using text anchors
      let pageText = ''
      
      if (page.paragraphs) {
        for (const paragraph of page.paragraphs) {
          if (paragraph.layout?.textAnchor) {
            const paragraphText = getTextFromTextAnchor(document.text || '', paragraph.layout.textAnchor)
            if (paragraphText) {
              pageText += paragraphText + '\n'
            }
          }
        }
      }
      
      // Fallback: if no paragraphs, try to extract from lines
      if (!pageText && page.lines) {
        for (const line of page.lines) {
          if (line.layout?.textAnchor) {
            const lineText = getTextFromTextAnchor(document.text || '', line.layout.textAnchor)
            if (lineText) {
              pageText += lineText + '\n'
            }
          }
        }
      }
      
      if (pageText.trim()) {
        pagesText.push({
          text: pageText.trim(),
          pageNumber: adjustedPageNumber
        })
      }
    }
  }
  
  // Fallback: if no pages structure, treat entire text as page 1
  if (pagesText.length === 0 && document.text) {
    pagesText.push({
      text: document.text,
      pageNumber: pageOffset + 1
    })
  }
  
  return pagesText
}

function buildProcessedDocumentData(document: DocumentAIDocument, pageOffset: number = 0): ProcessedDocumentData {
  const structuredData = extractStructuredFields(document, pageOffset)
  const pagesText = extractTextByPages(document, pageOffset)

  return {
    extractedText: document.text || '',
    structuredData,
    pageCount: document.pages ? document.pages.length : 0,
    pagesText
  }
}

// Split text into chunks while preserving page information
function splitTextIntoPagedChunks(pagesText: { text: string; pageNumber: number }[], chunkSize: number, overlap: number = 200): PagedChunk[] {
  const pagedChunks: PagedChunk[] = []
  let globalChunkIndex = 0
  
  for (const pageInfo of pagesText) {
    const pageChunks = splitTextIntoChunks(pageInfo.text, chunkSize, overlap)
    
    for (const chunkText of pageChunks) {
      pagedChunks.push({
        text: chunkText,
        chunkIndex: globalChunkIndex,
        pageNumber: pageInfo.pageNumber
      })
      globalChunkIndex++
    }
  }
  
  return pagedChunks
}

// UNLIMITED ROBUST EMBEDDING GENERATION - NO TIMEOUTS, UNLIMITED RETRIES
async function generateEmbeddingsWithUnlimitedRetries(
  documentId: string,
  document: DocumentAIDocument | null,
  docRecord: DatabaseDocument,
  sizeAnalysis?: DocumentSizeAnalysis,
  pagesTextOverride?: { text: string; pageNumber: number }[]
): Promise<EmbeddingGenerationStats> {
  const timeoutConfig = sizeAnalysis?.timeoutConfig
  const maxRetryAttempts = timeoutConfig?.maxRetryAttempts || 1000000
  let attempt = 0

  const businessMetadata = (docRecord as any)?.metadata || {}
  const filename = (docRecord as any)?.filename || ''

  logger.info('Starting embedding generation with intelligent sizing', {
    documentId,
    maxRetryAttempts: timeoutConfig?.maxRetryAttempts || 'unlimited',
    chunkTimeoutSeconds: timeoutConfig?.chunkTimeoutSeconds || 'default',
    tier: sizeAnalysis?.tier || 'unknown',
    component: 'document-processing'
  })

  while (attempt < maxRetryAttempts) {
    try {
      logger.debug('Embedding generation attempt', { attempt: attempt + 1, documentId, component: 'document-processing' })

      const pagesText = pagesTextOverride ?? (document ? extractTextByPages(document) : undefined)

      if (!pagesText || pagesText.length === 0) {
        throw new Error('No page text available for embedding generation')
      }

      const chunkStats = await generateEmbeddingsFromPages(
        documentId,
        pagesText,
        businessMetadata,
        filename,
        sizeAnalysis
      )

      logger.info('Embedding generation completed successfully', { attempt: attempt + 1, documentId, component: 'document-processing' })
      return {
        chunkCount: chunkStats.chunkCount,
        attempts: attempt + 1,
        retryCount: attempt
      }

    } catch (error) {
      attempt += 1
      logger.warn('Embedding attempt failed', { attempt, documentId, error: (error as Error)?.message, component: 'document-processing' })

      if (attempt >= maxRetryAttempts) {
        logger.error('All embedding attempts failed', undefined, { maxRetryAttempts, documentId, component: 'document-processing' })
        const supabaseClient = await createServiceClient()
        try {
          await supabaseClient
            .from('documents')
            .update({
              metadata: {
                ...businessMetadata,
                embeddings_skipped: true,
                embeddings_error: error instanceof Error ? error.message : 'Unknown error'
              }
            })
            .eq('id', documentId)
        } finally {
          releaseServiceClient(supabaseClient)
        }

        return {
          chunkCount: 0,
          attempts: attempt,
          retryCount: attempt
        }
      }

      const baseDelay = Math.min(1000 * Math.pow(2, Math.min(attempt, 6)), 60000)
      const jitter = Math.random() * 1000
      const delay = baseDelay + jitter
      logger.debug('Waiting before retry attempt', { delaySeconds: Math.round(delay / 1000), nextAttempt: attempt + 1, documentId, component: 'document-processing' })
      await new Promise(resolve => setTimeout(resolve, delay))
    }
  }

  return {
    chunkCount: 0,
    attempts: attempt,
    retryCount: attempt
  }
}

async function generateEmbeddingsFromPages(
  documentId: string,
  pagesText: { text: string; pageNumber: number }[],
  businessMetadata: BusinessMetadata,
  filename: string,
  sizeAnalysis?: DocumentSizeAnalysis
): Promise<{ chunkCount: number }> {
  const pagedChunks = splitTextIntoPagedChunks(pagesText, 1000)

  logger.info('Starting chunk processing for document', {
    documentId,
    totalChunks: pagedChunks.length,
    component: 'document-processing'
  })

  const maxConcurrentChunks = parseInt(process.env['MAX_CONCURRENT_CHUNKS_PER_DOC'] || '50')
  const processingConfig = sizeAnalysis?.processingConfig || {
    batchSize: 20,
    maxConcurrency: 5,
    delayBetweenBatches: 100,
    chunkingStrategy: 'standard',
    enablePrefetching: true,
    useAsyncProcessing: true,
    priorityLevel: 'normal' as const
  }
  const batchSize = Math.min(maxConcurrentChunks, processingConfig.batchSize)

  for (let i = 0; i < pagedChunks.length; i += batchSize) {
    const batch = pagedChunks.slice(i, i + batchSize);
    logger.debug('Processing chunk batch', {
      batchNumber: Math.floor(i / batchSize) + 1,
      totalBatches: Math.ceil(pagedChunks.length / batchSize),
      batchSize: batch.length,
      component: 'document-processing'
    });

    let attempts = 0;
    let failedChunks = batch;
    const MAX_CHUNK_RETRIES = 3; // Retries for individual chunks within a batch

    while (failedChunks.length > 0 && attempts < MAX_CHUNK_RETRIES) {
      if (attempts > 0) {
        const delay = Math.pow(2, attempts) * 1000; // Exponential backoff
        logger.warn(`Retrying ${failedChunks.length} failed chunks in batch`, { attempt: attempts, documentId });
        await new Promise(resolve => setTimeout(resolve, delay));
      }

      const results = await Promise.allSettled(
        failedChunks.map(pagedChunk => processChunkWithRetry(documentId, pagedChunk, businessMetadata, filename))
      );

      const newFailedChunks: typeof failedChunks = [];
      results.forEach((result, index) => {
        if (result.status === 'rejected') {
          const failedChunk = failedChunks[index];
          if (failedChunk) {
            newFailedChunks.push(failedChunk);
          }
          logger.warn('Chunk processing failed, will retry.', {
            chunkIndex: failedChunk?.chunkIndex,
            error: result.reason?.message,
            documentId,
            attempt: attempts + 1
          });
        }
      });

      failedChunks = newFailedChunks;
      attempts++;
    }

    if (failedChunks.length > 0) {
      const failedChunkIndexes = failedChunks.map(c => c.chunkIndex);
      logger.error(`Failed to process ${failedChunks.length} chunks after ${MAX_CHUNK_RETRIES} attempts. Aborting document processing.`, {
        documentId: documentId,
        failedChunkIndexes: failedChunkIndexes
      } as any);
      const error = new Error(`Failed to process ${failedChunks.length} chunks after multiple retries.`) as Error & { documentId?: string };
      error.documentId = documentId;
      throw error;
    }

    if (i + batchSize < pagedChunks.length) {
      await new Promise(resolve => setTimeout(resolve, processingConfig.delayBetweenBatches))

      if (sizeAnalysis?.memoryRequirements.garbageCollectionHints && typeof (globalThis as any).gc === 'function') {
        (globalThis as any).gc()
      }
    }
  }

  logger.info('All chunks processed successfully', {
    documentId,
    totalChunks: pagedChunks.length,
    component: 'document-processing'
  })

  return { chunkCount: pagedChunks.length }
}

export function splitTextIntoChunks(text: string, chunkSize: number, overlap: number = 200): string[] {
  const chunks: string[] = []
  let start = 0
  
  while (start < text.length) {
    let end = start + chunkSize
    
    // Try to break at a sentence or word boundary
    if (end < text.length) {
      const lastSentence = text.lastIndexOf('.', end)
      const lastWord = text.lastIndexOf(' ', end)
      
      if (lastSentence > start + chunkSize * 0.5) {
        end = lastSentence + 1
      } else if (lastWord > start + chunkSize * 0.5) {
        end = lastWord
      }
    }
    
    chunks.push(text.substring(start, end))
    start = Math.max(start + chunkSize - overlap, end)
  }
  
  return chunks.filter(chunk => chunk.trim().length > 0)
}

/**
 * Process large documents using Google Cloud Document AI batch processing
 */
async function processBatchDocument(documentId: string): Promise<void> {
  const supabase = await createServiceClient()
  
  try {
    logger.info('Starting batch processing for document', { documentId, component: 'batch-processing' })
    
    // Update processing status
    await updateProcessingStatus(documentId, 'processing', 50, 'Uploading to Google Cloud Storage for batch processing...')
    
    // Start batch processing operation
    const operationId = await batchProcessor.startBatchProcessing(documentId)
    
    // Update processing status
    await updateProcessingStatus(documentId, 'processing', 60, 'Document sent for batch processing. This may take several minutes...')
    
    // Update document status to indicate batch processing
    await supabase
      .from('documents')
      .update({ 
        status: 'processing',
        processing_notes: `Batch processing started. Operation ID: ${operationId.substring(0, 20)}...`
      })
      .eq('id', documentId)
    
  } catch (error) {
    logger.error('Batch processing initiation failed', error as Error, { documentId, component: 'batch-processing' })
    
    // Update document and processing status with error
    await supabase
      .from('documents')
      .update({
        status: 'error',
        processing_error: error instanceof Error ? error.message : 'Batch processing initiation failed'
      })
      .eq('id', documentId)

    await updateProcessingStatus(
      documentId, 
      'error', 
      0, 
      'Batch processing failed to start',
      error instanceof Error ? error.message : 'Unknown error'
    )
    
    throw error
  } finally {
    releaseServiceClient(supabase)
  }
}

/**
 * No cache invalidation needed in simplified architecture
 */
async function invalidateDocumentCaches(documentId: string, userId: string): Promise<void> {
  // No-op in simplified architecture
  logger.debug('Skipping cache invalidation in simplified architecture', { documentId })
}
