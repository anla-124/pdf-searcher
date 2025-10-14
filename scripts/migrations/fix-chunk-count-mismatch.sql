-- ============================================================================
-- MIGRATION: Fix Chunk Count Mismatch & Duplicate Chunks
-- ============================================================================
-- Problem:
--   1. Duplicate chunks in document_embeddings (each chunk appears 3x)
--   2. effective_chunk_count is theoretical (71) vs actual Pinecone (90)
--   3. No constraint preventing duplicates
--
-- Solution:
--   1. Remove duplicate chunks (keep first occurrence)
--   2. Update effective_chunk_count to match actual chunks
--   3. Add unique constraint to prevent future duplicates
--   4. Add trigger to auto-sync effective_chunk_count
-- ============================================================================

BEGIN;

-- ============================================================================
-- STEP 1: Backup information before cleanup
-- ============================================================================

CREATE TEMP TABLE pre_cleanup_stats AS
SELECT
  d.id,
  d.title,
  d.effective_chunk_count as old_effective_count,
  COUNT(*) as total_rows,
  COUNT(DISTINCT de.chunk_index) as unique_chunks
FROM documents d
LEFT JOIN document_embeddings de ON d.id = de.document_id
GROUP BY d.id, d.title, d.effective_chunk_count;

\echo ''
\echo '========================================';
\echo 'PRE-CLEANUP STATISTICS';
\echo '========================================';

SELECT
  title,
  old_effective_count as "Stored Count",
  total_rows as "DB Rows",
  unique_chunks as "Unique Chunks",
  total_rows - unique_chunks as "Duplicates"
FROM pre_cleanup_stats
WHERE title LIKE 'Test Doc%'
ORDER BY title;

-- ============================================================================
-- STEP 2: Clean up duplicate chunks (keep first occurrence by ctid)
-- ============================================================================

\echo '';
\echo 'Removing duplicate chunks...';

-- Create temp table with rows to keep (first occurrence of each chunk_index)
CREATE TEMP TABLE chunks_to_keep AS
SELECT DISTINCT ON (document_id, chunk_index)
  ctid
FROM document_embeddings
ORDER BY document_id, chunk_index, ctid ASC;  -- Keep first occurrence

-- Delete all rows NOT in the keep list
DELETE FROM document_embeddings
WHERE ctid NOT IN (SELECT ctid FROM chunks_to_keep);

-- Report how many were deleted
DO $$
DECLARE
  deleted_count INTEGER;
BEGIN
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RAISE NOTICE 'Deleted % duplicate chunk rows', deleted_count;
END $$;

-- ============================================================================
-- STEP 3: Add unique constraint to prevent future duplicates
-- ============================================================================

\echo '';
\echo 'Adding unique constraint...';

-- Drop existing constraint if exists
DROP INDEX IF EXISTS idx_document_embeddings_unique CASCADE;

-- Create unique index on (document_id, chunk_index)
CREATE UNIQUE INDEX idx_document_embeddings_unique
ON document_embeddings(document_id, chunk_index);

\echo 'Added unique constraint: idx_document_embeddings_unique';

-- ============================================================================
-- STEP 4: Update effective_chunk_count to match actual chunks in DB
-- ============================================================================

\echo '';
\echo 'Updating effective_chunk_count for all documents...';

UPDATE documents d
SET effective_chunk_count = subquery.actual_count
FROM (
  SELECT
    de.document_id,
    COUNT(DISTINCT de.chunk_index) as actual_count
  FROM document_embeddings de
  GROUP BY de.document_id
) subquery
WHERE d.id = subquery.document_id
  AND (d.effective_chunk_count IS NULL OR d.effective_chunk_count != subquery.actual_count);

-- Report updates
DO $$
DECLARE
  updated_count INTEGER;
BEGIN
  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RAISE NOTICE 'Updated effective_chunk_count for % documents', updated_count;
END $$;

-- ============================================================================
-- STEP 5: Create trigger to auto-sync effective_chunk_count
-- ============================================================================

\echo '';
\echo 'Creating trigger to auto-sync effective_chunk_count...';

-- Function to update effective_chunk_count when chunks change
CREATE OR REPLACE FUNCTION sync_effective_chunk_count()
RETURNS TRIGGER AS $$
DECLARE
  target_doc_id UUID;
  new_count INTEGER;
BEGIN
  -- Determine which document to update
  target_doc_id := CASE
    WHEN TG_OP = 'DELETE' THEN OLD.document_id
    ELSE NEW.document_id
  END;

  -- Count actual unique chunks
  SELECT COUNT(DISTINCT chunk_index) INTO new_count
  FROM document_embeddings
  WHERE document_id = target_doc_id;

  -- Update the document
  UPDATE documents
  SET effective_chunk_count = new_count
  WHERE id = target_doc_id;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- Drop existing trigger if exists
DROP TRIGGER IF EXISTS trg_sync_effective_chunk_count ON document_embeddings;

-- Create trigger (fires AFTER INSERT/UPDATE/DELETE)
CREATE TRIGGER trg_sync_effective_chunk_count
AFTER INSERT OR UPDATE OR DELETE ON document_embeddings
FOR EACH ROW
EXECUTE FUNCTION sync_effective_chunk_count();

\echo 'Created trigger: trg_sync_effective_chunk_count';

-- ============================================================================
-- STEP 6: Create validation view for monitoring
-- ============================================================================

\echo '';
\echo 'Creating validation view...';

CREATE OR REPLACE VIEW v_chunk_count_validation AS
SELECT
  d.id,
  d.title,
  d.page_count,
  d.effective_chunk_count as stored_effective_count,
  COUNT(de.chunk_index) as db_chunk_rows,
  COUNT(DISTINCT de.chunk_index) as unique_chunk_indices,
  CASE
    WHEN d.effective_chunk_count = COUNT(DISTINCT de.chunk_index) THEN '✓ OK'
    WHEN d.effective_chunk_count IS NULL THEN '⚠ MISSING'
    WHEN d.effective_chunk_count != COUNT(DISTINCT de.chunk_index) THEN '✗ MISMATCH'
    ELSE '? UNKNOWN'
  END as status,
  d.effective_chunk_count - COUNT(DISTINCT de.chunk_index) as difference
FROM documents d
LEFT JOIN document_embeddings de ON d.id = de.document_id
GROUP BY d.id, d.title, d.page_count, d.effective_chunk_count
ORDER BY
  CASE status
    WHEN '✗ MISMATCH' THEN 1
    WHEN '⚠ MISSING' THEN 2
    WHEN '✓ OK' THEN 3
    ELSE 4
  END,
  ABS(d.effective_chunk_count - COUNT(DISTINCT de.chunk_index)) DESC;

\echo 'Created view: v_chunk_count_validation';

-- ============================================================================
-- STEP 7: Post-cleanup verification
-- ============================================================================

\echo '';
\echo '========================================';
\echo 'POST-CLEANUP VERIFICATION';
\echo '========================================';

-- Show updated counts for Test Doc files
SELECT
  title,
  effective_chunk_count as "Stored Count",
  COUNT(*) as "DB Rows",
  COUNT(DISTINCT de.chunk_index) as "Unique Chunks",
  CASE
    WHEN effective_chunk_count = COUNT(DISTINCT de.chunk_index) THEN '✓ MATCH'
    ELSE '✗ MISMATCH'
  END as "Status"
FROM documents d
LEFT JOIN document_embeddings de ON d.id = de.document_id
WHERE title LIKE 'Test Doc%'
GROUP BY d.id, title, effective_chunk_count
ORDER BY title;

-- ============================================================================
-- STEP 8: Final summary
-- ============================================================================

DO $$
DECLARE
  total_docs INTEGER;
  docs_ok INTEGER;
  docs_mismatch INTEGER;
  total_chunks INTEGER;
BEGIN
  -- Count documents
  SELECT COUNT(*) INTO total_docs FROM documents;

  -- Count valid documents
  SELECT COUNT(*) INTO docs_ok
  FROM v_chunk_count_validation
  WHERE status = '✓ OK';

  -- Count mismatched documents
  SELECT COUNT(*) INTO docs_mismatch
  FROM v_chunk_count_validation
  WHERE status = '✗ MISMATCH';

  -- Count total chunks
  SELECT COUNT(*) INTO total_chunks FROM document_embeddings;

  RAISE NOTICE '';
  RAISE NOTICE '========================================';
  RAISE NOTICE 'MIGRATION COMPLETE';
  RAISE NOTICE '========================================';
  RAISE NOTICE 'Total documents: %', total_docs;
  RAISE NOTICE 'Documents with correct counts: %', docs_ok;
  RAISE NOTICE 'Documents with mismatches: %', docs_mismatch;
  RAISE NOTICE 'Total unique chunks: %', total_chunks;
  RAISE NOTICE '';
  RAISE NOTICE 'To verify results, run:';
  RAISE NOTICE 'SELECT * FROM v_chunk_count_validation;';
  RAISE NOTICE '';
  RAISE NOTICE 'To check Test Doc files specifically:';
  RAISE NOTICE 'SELECT * FROM v_chunk_count_validation WHERE title LIKE ''Test Doc%%'';';
END $$;

COMMIT;

\echo '';
\echo '✓ Migration completed successfully!';
\echo '';
