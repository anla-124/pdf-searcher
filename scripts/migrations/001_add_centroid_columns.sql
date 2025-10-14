-- =====================================================
-- Migration: Add Centroid and Effective Chunk Count Support
-- =====================================================
-- Purpose: Enable production-ready 3-stage similarity search
--
-- This migration adds required columns to the documents table:
-- 1. centroid_embedding: Pre-computed document-level centroid for Stage 0 filtering
-- 2. effective_chunk_count: De-overlapped chunk count for accurate size ratio
-- 3. embedding_model: Track which model was used for embeddings
--
-- Safe to run multiple times (idempotent)
-- =====================================================

-- Ensure vector extension is enabled
CREATE EXTENSION IF NOT EXISTS "vector";

-- =====================================================
-- Add Centroid and Chunk Count Columns
-- =====================================================

DO $$
BEGIN
  -- Add centroid_embedding column if it doesn't exist
  -- This stores the mean of all chunk embeddings for fast Stage 0 filtering
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'documents'
    AND column_name = 'centroid_embedding'
  ) THEN
    ALTER TABLE documents ADD COLUMN centroid_embedding vector(768);

    RAISE NOTICE 'Added centroid_embedding column to documents table';
  ELSE
    RAISE NOTICE 'centroid_embedding column already exists, skipping';
  END IF;

  -- Add effective_chunk_count column if it doesn't exist
  -- CRITICAL: This is the de-overlapped chunk count, not raw chunk count
  -- Used for accurate size ratio calculation in adaptive scoring
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'documents'
    AND column_name = 'effective_chunk_count'
  ) THEN
    ALTER TABLE documents ADD COLUMN effective_chunk_count INTEGER;

    RAISE NOTICE 'Added effective_chunk_count column to documents table';
  ELSE
    RAISE NOTICE 'effective_chunk_count column already exists, skipping';
  END IF;

  -- Add embedding_model column if it doesn't exist
  -- Tracks which embedding model was used (e.g., 'text-embedding-004')
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'documents'
    AND column_name = 'embedding_model'
  ) THEN
    ALTER TABLE documents ADD COLUMN embedding_model TEXT;

    RAISE NOTICE 'Added embedding_model column to documents table';
  ELSE
    RAISE NOTICE 'embedding_model column already exists, skipping';
  END IF;

END $$;

-- =====================================================
-- Create Index for Centroid-Based Similarity Search
-- =====================================================

-- Note: Vector indexes in pgvector should be created AFTER data is populated
-- Create index only if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE indexname = 'idx_documents_centroid_ivfflat'
  ) THEN
    -- IVFFlat index for fast approximate nearest neighbor search
    -- Lists parameter: Use sqrt(total_docs) as rule of thumb
    -- We'll use 100 lists for ~10000 documents
    CREATE INDEX idx_documents_centroid_ivfflat
    ON documents USING ivfflat (centroid_embedding vector_cosine_ops)
    WITH (lists = 100);

    RAISE NOTICE 'Created IVFFlat index on centroid_embedding';
  ELSE
    RAISE NOTICE 'IVFFlat index already exists, skipping';
  END IF;

EXCEPTION
  WHEN OTHERS THEN
    -- Index creation may fail if no data exists yet
    RAISE NOTICE 'Skipping index creation - will be created after data population';
END $$;

-- =====================================================
-- Optional: Create Index for Effective Chunk Count
-- =====================================================

-- Index for filtering/sorting by effective chunk count
CREATE INDEX IF NOT EXISTS idx_documents_effective_chunk_count
ON documents(effective_chunk_count)
WHERE effective_chunk_count IS NOT NULL;

-- =====================================================
-- Verification Query
-- =====================================================

-- Display migration status
SELECT
  'Migration completed successfully!' as status,
  EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'documents' AND column_name = 'centroid_embedding'
  ) as has_centroid_embedding,
  EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'documents' AND column_name = 'effective_chunk_count'
  ) as has_effective_chunk_count,
  EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'documents' AND column_name = 'embedding_model'
  ) as has_embedding_model,
  EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE indexname = 'idx_documents_centroid_ivfflat'
  ) as has_centroid_index;

-- Display documents that need centroid computation
SELECT
  'Documents requiring backfill' as info,
  COUNT(*) as total_documents,
  COUNT(CASE WHEN centroid_embedding IS NULL THEN 1 END) as missing_centroid,
  COUNT(CASE WHEN effective_chunk_count IS NULL THEN 1 END) as missing_effective_count
FROM documents
WHERE status = 'completed';

-- =====================================================
-- SUCCESS! 🎉
-- =====================================================
-- Next steps:
-- 1. Run backfill script to compute centroids for existing documents
-- 2. Update document processing pipeline to compute centroids on new uploads
-- 3. Test similarity search with /api/documents/[id]/similar-v2
-- =====================================================
