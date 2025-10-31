// Re-export comprehensive types for enterprise-grade type safety
export * from './external-apis'
export * from './api-responses'

// LEGACY TYPES - Maintained for backward compatibility
// These will be gradually migrated to the new type system

export interface User {
  id: string
  email: string
  full_name?: string
  role: 'admin' | 'user'
  created_at: string
  updated_at: string
}

// DEPRECATED: Use DatabaseDocument from external-apis.ts instead
export interface Document {
  id: string
  user_id: string
  title: string
  filename: string
  file_path: string
  file_size: number
  content_type: string
  status: 'uploading' | 'queued' | 'processing' | 'completed' | 'error' | 'cancelled' | 'cancelling'
  processing_error?: string | null
  extracted_fields?: Record<string, unknown> // FIXED: Replaced 'any' with 'unknown'
  metadata?: DocumentMetadata
  page_count?: number
  created_at: string
  updated_at: string
  total_characters?: number
}

// DEPRECATED: Use BusinessMetadata from external-apis.ts instead
export interface DocumentMetadata {
  investor_type?: string
  document_type?: string
  date_range?: {
    start_date?: string
    end_date?: string
  }
  tags?: string[]
  // Business metadata fields
  law_firm?: string
  fund_manager?: string
  fund_admin?: string
  jurisdiction?: string
  custom_fields?: Record<string, unknown> // FIXED: Replaced 'any' with 'unknown'
  embeddings_skipped?: boolean
  embeddings_error?: string
}

// ExtractedField interface removed - extracted_fields table no longer exists
// OCR processor doesn't extract form fields (only Form Parser does, but app always uses OCR)

export interface DocumentEmbedding {
  id: string
  document_id: string
  vector_id: string
  embedding: number[]
  chunk_text: string
  chunk_index: number
  page_number?: number
  created_at: string
}

export interface SimilaritySearchResult {
  document: Document
  score: number
  matching_chunks: {
    text: string
    score: number
  }[]
}

export interface SearchFilters {
  investor_type?: string[]
  document_type?: string[]
  date_range?: {
    start_date?: string
    end_date?: string
  }
  tags?: string[]
  // Business metadata filters
  law_firm?: string[]
  fund_manager?: string[]
  fund_admin?: string[]
  jurisdiction?: string[]
  min_score?: number
  topK?: number
  page_range?: {
    start_page?: number
    end_page?: number
    use_entire_document?: boolean
  }
}

export interface ProcessingStatus {
  document_id: string
  status: 'queued' | 'processing' | 'completed' | 'error' | 'cancelled' | 'cancelling'
  progress: number
  message?: string
  error?: string
}

export interface DocumentJob {
  id: string
  document_id: string
  user_id: string
  status: 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled' | 'cancelling'
  job_type: string
  priority: number
  attempts: number
  max_attempts: number
  error_message?: string
  started_at?: string
  completed_at?: string
  created_at: string
  updated_at: string
  // Batch processing fields
  batch_operation_id?: string
  processing_method: 'sync' | 'batch'
  metadata?: BatchJobMetadata
}

// DEPRECATED: Use comprehensive types from external-apis.ts instead
export interface BatchJobMetadata {
  inputUri?: string
  outputUri?: string
  processorType?: string
  operationMetadata?: Record<string, unknown> // FIXED: Replaced 'any' with 'unknown'
  [key: string]: unknown // FIXED: Replaced 'any' with 'unknown'
}
