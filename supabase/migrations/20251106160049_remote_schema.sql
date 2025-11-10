


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "btree_gin" WITH SCHEMA "public";






CREATE EXTENSION IF NOT EXISTS "pg_graphql" WITH SCHEMA "graphql";






CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "vector" WITH SCHEMA "extensions";






CREATE TYPE "public"."document_type_enum" AS ENUM (
    'subscription_agreement',
    'amendment',
    'supplement',
    'prospectus',
    'kyc_questionnaire',
    'risk_disclosure',
    'fee_schedule',
    'other'
);


ALTER TYPE "public"."document_type_enum" OWNER TO "postgres";


CREATE TYPE "public"."field_type_enum" AS ENUM (
    'text',
    'checkbox',
    'radio',
    'dropdown',
    'signature',
    'date',
    'number',
    'currency',
    'percentage'
);


ALTER TYPE "public"."field_type_enum" OWNER TO "postgres";


CREATE TYPE "public"."investor_type_enum" AS ENUM (
    'individual',
    'institutional',
    'accredited_individual',
    'qualified_institutional_buyer',
    'foreign_person',
    'entity'
);


ALTER TYPE "public"."investor_type_enum" OWNER TO "postgres";


CREATE TYPE "public"."processing_status_enum" AS ENUM (
    'pending',
    'processing',
    'completed',
    'failed',
    'cancelled'
);


ALTER TYPE "public"."processing_status_enum" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."analyze_document_structure"("doc_id" "uuid") RETURNS json
    LANGUAGE "plpgsql"
    AS $$
DECLARE
    result JSON;
    user_owns_doc BOOLEAN;
BEGIN
    -- Security check
    SELECT EXISTS(
        SELECT 1 FROM documents 
        WHERE id = doc_id AND user_id = auth.uid()
    ) INTO user_owns_doc;
    
    IF NOT user_owns_doc THEN
        RAISE EXCEPTION 'Document not found or access denied';
    END IF;
    
    SELECT json_build_object(
        'document_id', doc_id,
        'total_chunks', (
            SELECT COUNT(*) FROM document_chunks WHERE document_id = doc_id
        ),
        'total_sections', (
            SELECT COUNT(*) FROM document_sections WHERE document_id = doc_id
        ),
        'sections_with_embeddings', (
            SELECT COUNT(*) FROM document_sections 
            WHERE document_id = doc_id AND content_embedding IS NOT NULL
        ),
        'form_fields_by_type', (
            SELECT json_object_agg(field_type, field_count)
            FROM (
                SELECT field_type, COUNT(*) as field_count
                FROM document_form_fields 
                WHERE document_id = doc_id
                GROUP BY field_type
            ) t
        ),
        'entities_by_type', (
            SELECT json_object_agg(entity_type, entity_count)
            FROM (
                SELECT entity_type, COUNT(*) as entity_count
                FROM document_entities 
                WHERE document_id = doc_id
                GROUP BY entity_type
            ) t
        ),
        'processing_jobs_status', (
            SELECT json_object_agg(job_type, status)
            FROM document_processing_jobs 
            WHERE document_id = doc_id
        )
    ) INTO result;
    
    RETURN result;
END;
$$;


ALTER FUNCTION "public"."analyze_document_structure"("doc_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."calculate_document_similarity"("target_document_id" "uuid", "compare_document_id" "uuid") RETURNS numeric
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  target_fp RECORD;
  compare_fp RECORD;
  content_similarity NUMERIC;
  structural_similarity NUMERIC;
  overall_similarity NUMERIC;
BEGIN
  -- Get fingerprints for both documents
  SELECT * INTO target_fp FROM document_fingerprints WHERE document_id = target_document_id;
  SELECT * INTO compare_fp FROM document_fingerprints WHERE document_id = compare_document_id;
  
  -- Return 0 if either fingerprint doesn't exist
  IF target_fp IS NULL OR compare_fp IS NULL THEN
    RETURN 0;
  END IF;
  
  -- Calculate content similarity using cosine similarity
  content_similarity := 1 - (target_fp.content_embedding <=> compare_fp.content_embedding);
  
  -- Calculate structural similarity (simplified version)
  -- This compares section counts, form field counts, etc.
  structural_similarity := CASE 
    WHEN (target_fp.structural_features->>'sectionCount')::INT = 0 
         AND (compare_fp.structural_features->>'sectionCount')::INT = 0 THEN 1.0
    WHEN (target_fp.structural_features->>'sectionCount')::INT = 0 
         OR (compare_fp.structural_features->>'sectionCount')::INT = 0 THEN 0.0
    ELSE 1.0 - ABS(
      (target_fp.structural_features->>'sectionCount')::INT - 
      (compare_fp.structural_features->>'sectionCount')::INT
    ) / GREATEST(
      (target_fp.structural_features->>'sectionCount')::INT,
      (compare_fp.structural_features->>'sectionCount')::INT
    )::NUMERIC
  END;
  
  -- Weighted overall similarity (content 70%, structure 30%)
  overall_similarity := (content_similarity * 0.7) + (structural_similarity * 0.3);
  
  RETURN overall_similarity;
END;
$$;


ALTER FUNCTION "public"."calculate_document_similarity"("target_document_id" "uuid", "compare_document_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."cleanup_analysis_cache"() RETURNS integer
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  deleted_count INT;
BEGIN
  -- Delete cache entries older than 7 days
  DELETE FROM document_analysis_cache 
  WHERE created_at < NOW() - INTERVAL '7 days';
  
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  
  RETURN deleted_count;
END;
$$;


ALTER FUNCTION "public"."cleanup_analysis_cache"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."cleanup_old_activity_logs"() RETURNS integer
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM user_activity_logs 
  WHERE logged_at < NOW() - INTERVAL '90 days';
  
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  
  -- Log the cleanup action
  INSERT INTO user_activity_logs (
    action_type, 
    resource_type, 
    metadata,
    api_endpoint
  ) VALUES (
    'cleanup',
    'activity_log',
    jsonb_build_object('deleted_count', deleted_count),
    'system_maintenance'
  );
  
  RETURN deleted_count;
END;
$$;


ALTER FUNCTION "public"."cleanup_old_activity_logs"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."cleanup_old_processing_status"() RETURNS integer
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM processing_status 
  WHERE id NOT IN (
    SELECT id FROM (
      SELECT id, 
             ROW_NUMBER() OVER (PARTITION BY document_id ORDER BY created_at DESC) as rn
      FROM processing_status
    ) ranked
    WHERE rn <= 10
  );
  
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;


ALTER FUNCTION "public"."cleanup_old_processing_status"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."cleanup_user_data"() RETURNS json
    LANGUAGE "plpgsql"
    AS $$
DECLARE
    cleanup_result JSON;
    deleted_chunks INTEGER;
    deleted_sessions INTEGER;
    deleted_messages INTEGER;
BEGIN
    -- Clean up orphaned document chunks
    DELETE FROM document_chunks 
    WHERE document_id NOT IN (SELECT id FROM documents);
    GET DIAGNOSTICS deleted_chunks = ROW_COUNT;
    
    -- Clean up orphaned chat sessions
    DELETE FROM chat_sessions 
    WHERE document_id NOT IN (SELECT id FROM documents);
    GET DIAGNOSTICS deleted_sessions = ROW_COUNT;
    
    -- Clean up orphaned chat messages
    DELETE FROM chat_messages 
    WHERE session_id NOT IN (SELECT id FROM chat_sessions);
    GET DIAGNOSTICS deleted_messages = ROW_COUNT;
    
    SELECT json_build_object(
        'deleted_chunks', deleted_chunks,
        'deleted_sessions', deleted_sessions,
        'deleted_messages', deleted_messages,
        'cleanup_timestamp', NOW()
    ) INTO cleanup_result;
    
    RETURN cleanup_result;
END;
$$;


ALTER FUNCTION "public"."cleanup_user_data"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."enhanced_similarity_search"("p_user_id" "uuid", "p_document_id" "uuid", "p_limit" integer DEFAULT 10, "p_min_similarity" numeric DEFAULT 0.3) RETURNS TABLE("document_id" "uuid", "original_filename" "text", "overall_similarity" numeric, "structural_similarity" numeric, "legal_content_similarity" numeric, "semantic_similarity" numeric, "form_data_similarity" numeric, "business_logic_similarity" numeric, "confidence" "text", "document_type" "text", "matching_elements" "jsonb")
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  -- This is a placeholder function for the enhanced similarity search
  -- The actual implementation will be done in the application layer
  -- due to the complexity of the multi-layered similarity calculation
  
  RETURN QUERY
  SELECT 
    d.id as document_id,
    d.original_filename,
    0.0::NUMERIC as overall_similarity,
    0.0::NUMERIC as structural_similarity,
    0.0::NUMERIC as legal_content_similarity,
    0.0::NUMERIC as semantic_similarity,
    0.0::NUMERIC as form_data_similarity,
    0.0::NUMERIC as business_logic_similarity,
    'low'::TEXT as confidence,
    'subscription_agreement'::TEXT as document_type,
    '{}'::JSONB as matching_elements
  FROM documents d
  WHERE d.user_id = p_user_id
    AND d.id != p_document_id
    AND d.extraction_status = 'completed'
  LIMIT 0; -- Return empty for now, actual logic in application
END;
$$;


ALTER FUNCTION "public"."enhanced_similarity_search"("p_user_id" "uuid", "p_document_id" "uuid", "p_limit" integer, "p_min_similarity" numeric) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."find_similar_documents_fast"("target_document_id" "uuid", "similarity_threshold" numeric DEFAULT 0.3, "result_limit" integer DEFAULT 10) RETURNS TABLE("document_id" "uuid", "filename" "text", "similarity_score" numeric, "form_field_similarity" numeric, "legal_clause_similarity" numeric, "semantic_similarity" numeric)
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  target_features RECORD;
  target_embedding vector(1536);
BEGIN
  -- Get target document features from cache
  SELECT * INTO target_features FROM get_cached_similarity_features(target_document_id);
  
  IF target_features IS NULL THEN
    -- No cached features available
    RETURN;
  END IF;
  
  target_embedding := target_features.content_embedding_summary;
  
  RETURN QUERY
  SELECT 
    d.id as document_id,
    d.original_filename as filename,
    GREATEST(
      -- Weighted similarity calculation
      (COALESCE(
        1 - (cache.content_embedding_summary <=> target_embedding),
        0.5
      ) * 0.5) + -- Semantic similarity (50%)
      (LEAST(
        CAST(cache.total_legal_clauses AS DECIMAL) / GREATEST(target_features.total_legal_clauses, 1),
        CAST(target_features.total_legal_clauses AS DECIMAL) / GREATEST(cache.total_legal_clauses, 1)
      ) * 0.35) + -- Legal clause similarity (35%)
      (LEAST(
        cache.document_complexity_score / GREATEST(target_features.document_complexity_score, 0.1),
        target_features.document_complexity_score / GREATEST(cache.document_complexity_score, 0.1)
      ) * 0.15), -- Business logic similarity (15%)
      0.0
    ) as similarity_score,
    
    -- Individual component scores for UI
    LEAST(
      CAST(cache.total_form_fields AS DECIMAL) / GREATEST(target_features.total_form_fields, 1),
      CAST(target_features.total_form_fields AS DECIMAL) / GREATEST(cache.total_form_fields, 1)
    ) as form_field_similarity,
    
    LEAST(
      CAST(cache.total_legal_clauses AS DECIMAL) / GREATEST(target_features.total_legal_clauses, 1),
      CAST(target_features.total_legal_clauses AS DECIMAL) / GREATEST(cache.total_legal_clauses, 1)
    ) as legal_clause_similarity,
    
    COALESCE(
      1 - (cache.content_embedding_summary <=> target_embedding),
      0.5
    ) as semantic_similarity
    
  FROM document_similarity_cache cache
  JOIN documents d ON cache.document_id = d.id
  WHERE cache.user_id = auth.uid()
    AND cache.document_id != target_document_id
    AND cache.content_embedding_summary IS NOT NULL
    AND target_embedding IS NOT NULL
    -- Pre-filter using vector similarity for performance
    AND (1 - (cache.content_embedding_summary <=> target_embedding)) > (similarity_threshold * 0.8)
  ORDER BY 
    cache.content_embedding_summary <=> target_embedding
  LIMIT result_limit * 2 -- Get more candidates for post-filtering
  ;
END;
$$;


ALTER FUNCTION "public"."find_similar_documents_fast"("target_document_id" "uuid", "similarity_threshold" numeric, "result_limit" integer) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."find_similar_documents_fast"("target_document_id" "uuid", "similarity_threshold" numeric, "result_limit" integer) IS 'Fast similarity search using cached features and vector operations';



CREATE OR REPLACE FUNCTION "public"."find_similar_documents_global"("query_embedding" "extensions"."vector", "match_threshold" double precision DEFAULT 0.8, "match_count" integer DEFAULT 5) RETURNS TABLE("document_id" "uuid", "filename" "text", "user_id" "uuid", "similarity" double precision, "document_type" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
    -- This function should only be accessible to service role
    IF auth.role() != 'service_role' THEN
        RAISE EXCEPTION 'Access denied: admin function';
    END IF;
    
    RETURN QUERY
    SELECT 
        d.id as document_id,
        d.original_filename as filename,
        d.user_id,
        1 - (dc.content_embedding <=> query_embedding) as similarity,
        d.document_type::text
    FROM document_chunks dc
    JOIN documents d ON d.id = dc.document_id
    WHERE 
        dc.content_embedding IS NOT NULL
        AND 1 - (dc.content_embedding <=> query_embedding) > match_threshold
    ORDER BY dc.content_embedding <=> query_embedding
    LIMIT match_count;
END;
$$;


ALTER FUNCTION "public"."find_similar_documents_global"("query_embedding" "extensions"."vector", "match_threshold" double precision, "match_count" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."find_similar_documents_with_fingerprints"("p_user_id" "uuid", "p_document_id" "uuid", "p_limit" integer DEFAULT 5, "p_min_similarity" numeric DEFAULT 0.1) RETURNS TABLE("document_id" "uuid", "original_filename" "text", "similarity_score" numeric, "content_similarity" numeric, "structural_features" "jsonb", "semantic_features" "jsonb")
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  RETURN QUERY
  SELECT 
    d.id,
    d.original_filename,
    calculate_document_similarity(p_document_id, d.id) as similarity_score,
    1 - (tf.content_embedding <=> cf.content_embedding) as content_similarity,
    cf.structural_features,
    cf.semantic_features
  FROM documents d
  INNER JOIN document_fingerprints cf ON d.id = cf.document_id
  CROSS JOIN document_fingerprints tf
  WHERE d.user_id = p_user_id
    AND d.id != p_document_id
    AND tf.document_id = p_document_id
    AND d.extraction_status = 'completed'
    AND calculate_document_similarity(p_document_id, d.id) >= p_min_similarity
  ORDER BY similarity_score DESC
  LIMIT p_limit;
END;
$$;


ALTER FUNCTION "public"."find_similar_documents_with_fingerprints"("p_user_id" "uuid", "p_document_id" "uuid", "p_limit" integer, "p_min_similarity" numeric) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."find_similar_sections_with_embeddings"("p_user_id" "uuid", "p_query_embedding" "text", "p_section_type" "text" DEFAULT NULL::"text", "p_limit" integer DEFAULT 10) RETURNS TABLE("section_id" "uuid", "document_id" "uuid", "title" "text", "content" "text", "section_type" "text", "page_number" integer, "original_filename" "text", "similarity_score" double precision)
    LANGUAGE "plpgsql"
    AS $$
DECLARE
    query_vector vector(1536);
BEGIN
    -- Parse the JSON string to vector
    query_vector := p_query_embedding::vector(1536);
    
    RETURN QUERY
    SELECT 
        ds.id as section_id,
        ds.document_id,
        ds.title,
        ds.content,
        ds.section_type,
        ds.page_number,
        d.original_filename,
        1 - (ds.content_embedding <=> query_vector) as similarity_score
    FROM document_sections ds
    JOIN documents d ON d.id = ds.document_id
    WHERE 
        d.user_id = p_user_id
        AND ds.content_embedding IS NOT NULL
        AND (p_section_type IS NULL OR ds.section_type = p_section_type)
        AND 1 - (ds.content_embedding <=> query_vector) > 0.3
    ORDER BY ds.content_embedding <=> query_vector
    LIMIT p_limit;
END;
$$;


ALTER FUNCTION "public"."find_similar_sections_with_embeddings"("p_user_id" "uuid", "p_query_embedding" "text", "p_section_type" "text", "p_limit" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_cached_similarity_features"("target_document_id" "uuid") RETURNS TABLE("document_id" "uuid", "form_fields_vector" "jsonb", "legal_clauses_vector" "jsonb", "document_metadata" "jsonb", "total_form_fields" integer, "total_legal_clauses" integer, "document_complexity_score" numeric, "content_embedding_summary" "extensions"."vector", "cached_at" timestamp with time zone)
    LANGUAGE "sql" STABLE
    AS $$
  SELECT 
    dsc.document_id,
    dsc.form_fields_vector,
    dsc.legal_clauses_vector,
    dsc.document_metadata,
    dsc.total_form_fields,
    dsc.total_legal_clauses,
    dsc.document_complexity_score,
    dsc.content_embedding_summary,
    dsc.cached_at
  FROM document_similarity_cache dsc
  WHERE dsc.document_id = target_document_id
    AND dsc.user_id = auth.uid();
$$;


ALTER FUNCTION "public"."get_cached_similarity_features"("target_document_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_document_chunks"("target_document_id" "uuid", "limit_count" integer DEFAULT 50) RETURNS TABLE("chunk_id" "uuid", "chunk_index" integer, "content" "text", "similarity_threshold" numeric, "created_at" timestamp with time zone)
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
    -- Verify user owns the document
    IF NOT EXISTS (
        SELECT 1 FROM documents 
        WHERE id = target_document_id AND user_id = auth.uid()
    ) THEN
        RAISE EXCEPTION 'Document not found or access denied';
    END IF;

    RETURN QUERY
    SELECT
        dc.id as chunk_id,
        dc.chunk_index,
        dc.content,
        dc.metadata->>'similarity_threshold' as similarity_threshold,
        dc.created_at
    FROM document_chunks dc
    WHERE dc.document_id = target_document_id
    ORDER BY dc.chunk_index
    LIMIT limit_count;
END;
$$;


ALTER FUNCTION "public"."get_document_chunks"("target_document_id" "uuid", "limit_count" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_document_summary"("doc_id" "uuid") RETURNS json
    LANGUAGE "plpgsql"
    AS $$
DECLARE
    result JSON;
BEGIN
    SELECT json_build_object(
        'document_id', d.id,
        'filename', d.original_filename,
        'document_type', d.document_type,
        'form_fields_count', (
            SELECT COUNT(*) FROM document_form_fields 
            WHERE document_id = doc_id
        ),
        'tables_count', (
            SELECT COUNT(*) FROM document_tables 
            WHERE document_id = doc_id
        ),
        'sections_count', (
            SELECT COUNT(*) FROM document_sections 
            WHERE document_id = doc_id
        ),
        'entities_count', (
            SELECT COUNT(*) FROM document_entities 
            WHERE document_id = doc_id
        ),
        'processing_status', d.extraction_status,
        'ai_confidence', d.document_ai_confidence
    ) INTO result
    FROM documents d
    WHERE d.id = doc_id;
    
    RETURN result;
END;
$$;


ALTER FUNCTION "public"."get_document_summary"("doc_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_system_health"() RETURNS "jsonb"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  result JSONB;
BEGIN
  SELECT jsonb_build_object(
    'timestamp', NOW(),
    'documents', jsonb_build_object(
      'total', (SELECT COUNT(*) FROM documents),
      'completed', (SELECT COUNT(*) FROM documents WHERE status = 'completed'),
      'processing', (SELECT COUNT(*) FROM documents WHERE status = 'processing'),
      'errors', (SELECT COUNT(*) FROM documents WHERE status = 'error')
    ),
    'jobs', jsonb_build_object(
      'total', (SELECT COUNT(*) FROM document_jobs),
      'queued', (SELECT COUNT(*) FROM document_jobs WHERE status = 'queued'),
      'processing', (SELECT COUNT(*) FROM document_jobs WHERE status = 'processing'),
      'completed', (SELECT COUNT(*) FROM document_jobs WHERE status = 'completed'),
      'errors', (SELECT COUNT(*) FROM document_jobs WHERE status = 'error')
    ),
    'activity', jsonb_build_object(
      'last_24h', (SELECT COUNT(*) FROM user_activity_logs WHERE logged_at >= NOW() - INTERVAL '24 hours'),
      'total_logs', (SELECT COUNT(*) FROM user_activity_logs)
    )
  ) INTO result;
  
  RETURN result;
END;
$$;


ALTER FUNCTION "public"."get_system_health"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_user_document_stats"() RETURNS json
    LANGUAGE "plpgsql"
    AS $$
DECLARE
    result JSON;
BEGIN
    SELECT json_build_object(
        'total_documents', (
            SELECT COUNT(*) FROM documents WHERE user_id = auth.uid()
        ),
        'documents_by_status', (
            SELECT json_object_agg(extraction_status, doc_count)
            FROM (
                SELECT extraction_status, COUNT(*) as doc_count
                FROM documents 
                WHERE user_id = auth.uid()
                GROUP BY extraction_status
            ) t
        ),
        'documents_by_type', (
            SELECT json_object_agg(document_type, doc_count)
            FROM (
                SELECT COALESCE(document_type::text, 'unknown') as document_type, COUNT(*) as doc_count
                FROM documents 
                WHERE user_id = auth.uid()
                GROUP BY document_type
            ) t
        ),
        'total_form_fields', (
            SELECT COUNT(*) FROM document_form_fields dff
            JOIN documents d ON d.id = dff.document_id
            WHERE d.user_id = auth.uid()
        ),
        'total_sections', (
            SELECT COUNT(*) FROM document_sections ds
            JOIN documents d ON d.id = ds.document_id
            WHERE d.user_id = auth.uid()
        ),
        'total_chat_sessions', (
            SELECT COUNT(*) FROM chat_sessions WHERE user_id = auth.uid()
        ),
        'storage_usage_mb', (
            SELECT ROUND(SUM(file_size::numeric) / (1024 * 1024), 2)
            FROM documents 
            WHERE user_id = auth.uid()
        )
    ) INTO result;
    
    RETURN result;
END;
$$;


ALTER FUNCTION "public"."get_user_document_stats"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_vector_index_stats"() RETURNS json
    LANGUAGE "plpgsql"
    AS $$
DECLARE
    result JSON;
BEGIN
    SELECT json_build_object(
        'document_chunks_with_embeddings', (
            SELECT COUNT(*) FROM document_chunks 
            WHERE content_embedding IS NOT NULL OR embeddings IS NOT NULL
        ),
        'sections_with_embeddings', (
            SELECT COUNT(*) FROM document_sections 
            WHERE content_embedding IS NOT NULL
        ),
        'form_fields_with_embeddings', (
            SELECT COUNT(*) FROM document_form_fields 
            WHERE field_embedding IS NOT NULL
        ),
        'index_stats', (
            SELECT json_agg(
                json_build_object(
                    'table', schemaname || '.' || tablename,
                    'index', indexname,
                    'size', pg_size_pretty(pg_relation_size(indexname::regclass))
                )
            )
            FROM pg_indexes 
            WHERE indexname LIKE '%embedding%' OR indexname LIKE '%vector%'
        )
    ) INTO result;
    
    RETURN result;
END;
$$;


ALTER FUNCTION "public"."get_vector_index_stats"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  INSERT INTO public.users (id, email, full_name, role)
  VALUES (NEW.id, NEW.email, NEW.raw_user_meta_data->>'full_name', 'user')
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."handle_new_user"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."handle_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."invalidate_similarity_cache"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  -- Remove cached features when document content changes
  DELETE FROM document_similarity_cache 
  WHERE document_id = NEW.id;
  
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."invalidate_similarity_cache"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."match_document_chunks"("query_embedding" "extensions"."vector", "match_threshold" double precision DEFAULT 0.78, "match_count" integer DEFAULT 10, "target_document_id" "uuid" DEFAULT NULL::"uuid") RETURNS TABLE("chunk_id" "uuid", "document_id" "uuid", "content" "text", "similarity" double precision)
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  RETURN QUERY
  SELECT
    dc.id as chunk_id,
    dc.document_id,
    dc.content,
    1 - (COALESCE(dc.content_embedding, dc.embeddings) <=> query_embedding) AS similarity
  FROM document_chunks dc
  WHERE 
    (target_document_id IS NULL OR dc.document_id = target_document_id)
    AND COALESCE(dc.content_embedding, dc.embeddings) IS NOT NULL
    AND 1 - (COALESCE(dc.content_embedding, dc.embeddings) <=> query_embedding) > match_threshold
  ORDER BY COALESCE(dc.content_embedding, dc.embeddings) <=> query_embedding
  LIMIT match_count;
END;
$$;


ALTER FUNCTION "public"."match_document_chunks"("query_embedding" "extensions"."vector", "match_threshold" double precision, "match_count" integer, "target_document_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."refresh_document_embeddings"("doc_id" "uuid") RETURNS boolean
    LANGUAGE "plpgsql"
    AS $$
DECLARE
    user_owns_doc BOOLEAN;
BEGIN
    -- Security check
    SELECT EXISTS(
        SELECT 1 FROM documents 
        WHERE id = doc_id AND user_id = auth.uid()
    ) INTO user_owns_doc;
    
    IF NOT user_owns_doc THEN
        RAISE EXCEPTION 'Document not found or access denied';
    END IF;
    
    -- Clear existing embeddings (will be regenerated by the application)
    UPDATE document_sections 
    SET content_embedding = NULL 
    WHERE document_id = doc_id;
    
    UPDATE document_form_fields 
    SET field_embedding = NULL 
    WHERE document_id = doc_id;
    
    UPDATE document_chunks 
    SET content_embedding = NULL, embeddings = NULL 
    WHERE document_id = doc_id;
    
    -- Mark document for reprocessing
    UPDATE documents 
    SET extraction_status = 'pending',
        processing_metadata = processing_metadata || '{"embedding_refresh": true}'::jsonb
    WHERE id = doc_id;
    
    RETURN TRUE;
END;
$$;


ALTER FUNCTION "public"."refresh_document_embeddings"("doc_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."search_all_documents"("query_embedding" "extensions"."vector", "match_threshold" double precision DEFAULT 0.78, "match_count" integer DEFAULT 10) RETURNS TABLE("chunk_id" "uuid", "document_id" "uuid", "document_title" "text", "filename" "text", "content" "text", "similarity" double precision)
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  RETURN QUERY
  SELECT
    dc.id as chunk_id,
    dc.document_id,
    d.original_filename as document_title,
    d.original_filename as filename,
    dc.content,
    1 - (COALESCE(dc.content_embedding, dc.embeddings) <=> query_embedding) AS similarity
  FROM document_chunks dc
  JOIN documents d ON dc.document_id = d.id
  WHERE 
    COALESCE(dc.content_embedding, dc.embeddings) IS NOT NULL
    AND 1 - (COALESCE(dc.content_embedding, dc.embeddings) <=> query_embedding) > match_threshold
    AND d.user_id = auth.uid()
  ORDER BY COALESCE(dc.content_embedding, dc.embeddings) <=> query_embedding
  LIMIT match_count;
END;
$$;


ALTER FUNCTION "public"."search_all_documents"("query_embedding" "extensions"."vector", "match_threshold" double precision, "match_count" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."search_documents"("query_embedding" "extensions"."vector", "match_threshold" double precision DEFAULT 0.7, "match_count" integer DEFAULT 10, "filter_user_id" "uuid" DEFAULT NULL::"uuid") RETURNS TABLE("id" "uuid", "document_id" "uuid", "content" "text", "similarity" double precision)
    LANGUAGE "sql" STABLE
    AS $$
  SELECT
    document_content.id,
    document_content.document_id,
    document_content.content,
    1 - (document_content.content_embedding <=> query_embedding) as similarity
  FROM document_content
  INNER JOIN documents ON documents.id = document_content.document_id
  WHERE 
    (filter_user_id IS NULL OR documents.user_id = filter_user_id)
    AND document_content.content_embedding IS NOT NULL
    AND 1 - (document_content.content_embedding <=> query_embedding) > match_threshold
  ORDER BY document_content.content_embedding <=> query_embedding
  LIMIT match_count;
$$;


ALTER FUNCTION "public"."search_documents"("query_embedding" "extensions"."vector", "match_threshold" double precision, "match_count" integer, "filter_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."search_form_fields"("search_query" "text", "user_id_param" "uuid" DEFAULT NULL::"uuid") RETURNS TABLE("document_id" "uuid", "filename" "text", "field_name" "text", "field_value" "text", "field_type" "public"."field_type_enum", "page_number" integer, "confidence_score" numeric)
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    RETURN QUERY
    SELECT 
        d.id,
        d.original_filename,
        ff.field_name,
        ff.field_value,
        ff.field_type,
        ff.page_number,
        ff.confidence_score
    FROM document_form_fields ff
    JOIN documents d ON d.id = ff.document_id
    WHERE 
        (user_id_param IS NULL OR d.user_id = user_id_param OR d.user_id = auth.uid())
        AND (
            ff.field_name ILIKE '%' || search_query || '%' OR
            ff.field_value ILIKE '%' || search_query || '%' OR
            ff.field_label ILIKE '%' || search_query || '%'
        )
    ORDER BY ff.confidence_score DESC NULLS LAST, d.created_at DESC;
END;
$$;


ALTER FUNCTION "public"."search_form_fields"("search_query" "text", "user_id_param" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."test_security_policies"() RETURNS TABLE("table_name" "text", "rls_enabled" boolean, "policy_count" bigint)
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  RETURN QUERY
  SELECT 
    t.tablename::TEXT,
    t.rowsecurity as rls_enabled,
    COALESCE(p.policy_count, 0) as policy_count
  FROM pg_tables t
  LEFT JOIN (
    SELECT 
      tablename,
      COUNT(*) as policy_count
    FROM pg_policies 
    WHERE schemaname = 'public'
    GROUP BY tablename
  ) p ON t.tablename = p.tablename
  WHERE t.schemaname = 'public' 
    AND t.tablename IN ('users', 'documents', 'document_jobs', 'document_embeddings', 'processing_status', 'extracted_fields')
  ORDER BY t.tablename;
END;
$$;


ALTER FUNCTION "public"."test_security_policies"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_document_analysis_cache_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_document_analysis_cache_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_document_fingerprints_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_document_fingerprints_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_updated_at_column"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_updated_at_column"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."document_content" (
    "document_id" "uuid" NOT NULL,
    "extracted_text" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL
);


ALTER TABLE "public"."document_content" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."document_embeddings" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "document_id" "uuid" NOT NULL,
    "vector_id" "text" NOT NULL,
    "chunk_text" "text" NOT NULL,
    "chunk_index" integer NOT NULL,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "embedding" "extensions"."vector"(768),
    "page_number" integer,
    "character_count" integer,
    "start_page_number" integer,
    "end_page_number" integer
);


ALTER TABLE "public"."document_embeddings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."document_jobs" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "document_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "status" "text" DEFAULT 'queued'::"text" NOT NULL,
    "priority" integer DEFAULT 0,
    "attempts" integer DEFAULT 0,
    "max_attempts" integer DEFAULT 3,
    "error_message" "text",
    "started_at" timestamp with time zone,
    "completed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "batch_operation_id" "text",
    "processing_method" "text" DEFAULT 'sync'::"text",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "processing_time_ms" integer,
    "processing_config" "jsonb",
    "error_details" "jsonb",
    "result_summary" "jsonb",
    "operation_type" "text" DEFAULT 'document_ai_processing'::"text" NOT NULL,
    CONSTRAINT "document_jobs_processing_method_check" CHECK (("processing_method" = ANY (ARRAY['sync'::"text", 'batch'::"text"]))),
    CONSTRAINT "document_jobs_status_check" CHECK (("status" = ANY (ARRAY['queued'::"text", 'processing'::"text", 'completed'::"text", 'failed'::"text", 'cancelled'::"text"])))
);


ALTER TABLE "public"."document_jobs" OWNER TO "postgres";


COMMENT ON COLUMN "public"."document_jobs"."batch_operation_id" IS 'Google Cloud Document AI batch operation ID';



COMMENT ON COLUMN "public"."document_jobs"."processing_method" IS 'Processing method: sync for ≤30 pages, batch for >30 pages';



COMMENT ON COLUMN "public"."document_jobs"."metadata" IS 'Batch processing metadata (GCS URIs, processor info, etc.)';



CREATE TABLE IF NOT EXISTS "public"."documents" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "title" "text" NOT NULL,
    "filename" "text" NOT NULL,
    "file_path" "text" NOT NULL,
    "file_size" integer NOT NULL,
    "content_type" "text" NOT NULL,
    "status" "text" DEFAULT 'uploading'::"text" NOT NULL,
    "processing_error" "text",
    "extracted_fields" "jsonb",
    "metadata" "jsonb",
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "page_count" integer,
    "centroid_embedding" "extensions"."vector"(768),
    "effective_chunk_count" integer,
    "embedding_model" "text",
    "total_characters" integer,
    CONSTRAINT "documents_status_check" CHECK (("status" = ANY (ARRAY['uploading'::"text", 'queued'::"text", 'processing'::"text", 'completed'::"text", 'error'::"text", 'cancelled'::"text"])))
);


ALTER TABLE "public"."documents" OWNER TO "postgres";


COMMENT ON COLUMN "public"."documents"."page_count" IS 'Total number of pages in the PDF document, extracted during processing';



CREATE OR REPLACE VIEW "public"."document_processing_analytics" AS
 SELECT "user_id",
    "count"(*) AS "total_documents",
    "count"(
        CASE
            WHEN ("status" = 'completed'::"text") THEN 1
            ELSE NULL::integer
        END) AS "completed_documents",
    "count"(
        CASE
            WHEN ("status" = 'processing'::"text") THEN 1
            ELSE NULL::integer
        END) AS "processing_documents",
    "count"(
        CASE
            WHEN ("status" = 'error'::"text") THEN 1
            ELSE NULL::integer
        END) AS "error_documents",
    "sum"("file_size") AS "total_file_size",
    "avg"("file_size") AS "avg_file_size",
    "sum"("page_count") AS "total_pages",
    "avg"("page_count") AS "avg_pages_per_document",
    "min"("created_at") AS "first_upload",
    "max"("created_at") AS "last_upload"
   FROM "public"."documents" "d"
  GROUP BY "user_id";


ALTER VIEW "public"."document_processing_analytics" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."job_performance_monitoring" AS
 SELECT "processing_method",
    "status",
    "count"(*) AS "job_count",
    "avg"("processing_time_ms") AS "avg_processing_time_ms",
    "min"("processing_time_ms") AS "min_processing_time_ms",
    "max"("processing_time_ms") AS "max_processing_time_ms",
    "avg"("attempts") AS "avg_attempts",
    "count"(
        CASE
            WHEN ("status" = 'error'::"text") THEN 1
            ELSE NULL::integer
        END) AS "error_count",
    "date"("created_at") AS "processing_date"
   FROM "public"."document_jobs"
  WHERE ("created_at" >= ("now"() - '30 days'::interval))
  GROUP BY "processing_method", "status", ("date"("created_at"))
  ORDER BY ("date"("created_at")) DESC, "processing_method";


ALTER VIEW "public"."job_performance_monitoring" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."processing_status" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "document_id" "uuid" NOT NULL,
    "status" "text" NOT NULL,
    "progress" integer DEFAULT 0,
    "message" "text",
    "error" "text",
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    CONSTRAINT "processing_status_progress_check" CHECK ((("progress" >= 0) AND ("progress" <= 100))),
    CONSTRAINT "processing_status_status_check" CHECK (("status" = ANY (ARRAY['queued'::"text", 'processing'::"text", 'completed'::"text", 'error'::"text", 'cancelled'::"text"])))
);


ALTER TABLE "public"."processing_status" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."system_health_dashboard" AS
 SELECT 'documents'::"text" AS "component",
    "count"(*) AS "total_count",
    "count"(
        CASE
            WHEN ("documents"."status" = 'completed'::"text") THEN 1
            ELSE NULL::integer
        END) AS "healthy_count",
    "count"(
        CASE
            WHEN ("documents"."status" = 'error'::"text") THEN 1
            ELSE NULL::integer
        END) AS "error_count",
    "round"(((("count"(
        CASE
            WHEN ("documents"."status" = 'completed'::"text") THEN 1
            ELSE NULL::integer
        END))::numeric * 100.0) / ("count"(*))::numeric), 2) AS "health_percentage"
   FROM "public"."documents"
  WHERE ("documents"."created_at" >= ("now"() - '24:00:00'::interval))
UNION ALL
 SELECT 'jobs'::"text" AS "component",
    "count"(*) AS "total_count",
    "count"(
        CASE
            WHEN ("document_jobs"."status" = 'completed'::"text") THEN 1
            ELSE NULL::integer
        END) AS "healthy_count",
    "count"(
        CASE
            WHEN ("document_jobs"."status" = 'error'::"text") THEN 1
            ELSE NULL::integer
        END) AS "error_count",
    "round"(((("count"(
        CASE
            WHEN ("document_jobs"."status" = 'completed'::"text") THEN 1
            ELSE NULL::integer
        END))::numeric * 100.0) / ("count"(*))::numeric), 2) AS "health_percentage"
   FROM "public"."document_jobs"
  WHERE ("document_jobs"."created_at" >= ("now"() - '24:00:00'::interval));


ALTER VIEW "public"."system_health_dashboard" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_activity_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_uuid" "uuid",
    "email" "text",
    "ip_address" "inet",
    "user_agent" "text",
    "action_type" "text" NOT NULL,
    "resource_type" "text",
    "resource_uuid" "uuid",
    "resource_name" "text",
    "metadata" "jsonb",
    "api_endpoint" "text",
    "http_method" "text",
    "response_status" integer,
    "logged_at" timestamp with time zone DEFAULT "now"(),
    "duration_ms" integer
);


ALTER TABLE "public"."user_activity_logs" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."user_activity_recent" AS
 SELECT "id",
    "user_uuid",
    "email",
    "ip_address",
    "action_type",
    "resource_type",
    "resource_uuid",
    "resource_name",
    "metadata",
    "api_endpoint",
    "http_method",
    "response_status",
    "logged_at",
    "duration_ms",
        CASE
            WHEN ("action_type" = 'upload'::"text") THEN 'Uploaded document'::"text"
            WHEN ("action_type" = 'delete'::"text") THEN 'Deleted document'::"text"
            WHEN ("action_type" = 'search'::"text") THEN 'Searched documents'::"text"
            WHEN ("action_type" = 'similarity'::"text") THEN 'Found similar documents'::"text"
            ELSE "action_type"
        END AS "description"
   FROM "public"."user_activity_logs"
  WHERE ("logged_at" >= ("now"() - '7 days'::interval))
  ORDER BY "logged_at" DESC;


ALTER VIEW "public"."user_activity_recent" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."users" (
    "id" "uuid" NOT NULL,
    "email" "text" NOT NULL,
    "full_name" "text",
    "role" "text" DEFAULT 'user'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    CONSTRAINT "company_email_only" CHECK (("email" ~~ '%@anduintransact.com'::"text")),
    CONSTRAINT "users_role_check" CHECK (("role" = ANY (ARRAY['admin'::"text", 'user'::"text"])))
);


ALTER TABLE "public"."users" OWNER TO "postgres";


ALTER TABLE ONLY "public"."document_content"
    ADD CONSTRAINT "document_content_pkey" PRIMARY KEY ("document_id");



ALTER TABLE ONLY "public"."document_embeddings"
    ADD CONSTRAINT "document_embeddings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."document_jobs"
    ADD CONSTRAINT "document_jobs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."documents"
    ADD CONSTRAINT "documents_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."processing_status"
    ADD CONSTRAINT "processing_status_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_activity_logs"
    ADD CONSTRAINT "user_activity_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_pkey" PRIMARY KEY ("id");



CREATE INDEX "document_embeddings_embedding_idx" ON "public"."document_embeddings" USING "ivfflat" ("embedding" "extensions"."vector_cosine_ops") WITH ("lists"='100');



CREATE INDEX "idx_document_embeddings_character_count" ON "public"."document_embeddings" USING "btree" ("character_count") WHERE ("character_count" IS NOT NULL);



CREATE INDEX "idx_document_embeddings_chunk" ON "public"."document_embeddings" USING "btree" ("document_id", "chunk_index");



CREATE INDEX "idx_document_embeddings_chunk_index" ON "public"."document_embeddings" USING "btree" ("chunk_index");



CREATE INDEX "idx_document_embeddings_doc_page" ON "public"."document_embeddings" USING "btree" ("document_id", "page_number");



CREATE INDEX "idx_document_embeddings_document" ON "public"."document_embeddings" USING "btree" ("document_id");



CREATE INDEX "idx_document_embeddings_document_id" ON "public"."document_embeddings" USING "btree" ("document_id");



CREATE INDEX "idx_document_embeddings_end_page" ON "public"."document_embeddings" USING "btree" ("document_id", "end_page_number") WHERE ("end_page_number" IS NOT NULL);



CREATE INDEX "idx_document_embeddings_page" ON "public"."document_embeddings" USING "btree" ("document_id", "page_number");



CREATE INDEX "idx_document_embeddings_page_number" ON "public"."document_embeddings" USING "btree" ("page_number");



CREATE INDEX "idx_document_embeddings_page_range" ON "public"."document_embeddings" USING "btree" ("document_id", "start_page_number", "end_page_number");



CREATE INDEX "idx_document_embeddings_page_search" ON "public"."document_embeddings" USING "btree" ("document_id", "page_number", "chunk_index") WHERE ("page_number" IS NOT NULL);



CREATE INDEX "idx_document_embeddings_search" ON "public"."document_embeddings" USING "btree" ("document_id", "chunk_index");



CREATE INDEX "idx_document_embeddings_start_page" ON "public"."document_embeddings" USING "btree" ("document_id", "start_page_number") WHERE ("start_page_number" IS NOT NULL);



CREATE UNIQUE INDEX "idx_document_embeddings_unique" ON "public"."document_embeddings" USING "btree" ("document_id", "chunk_index");



CREATE INDEX "idx_document_embeddings_vector_id" ON "public"."document_embeddings" USING "btree" ("vector_id");



CREATE INDEX "idx_document_jobs_attempts" ON "public"."document_jobs" USING "btree" ("attempts", "max_attempts", "status", "updated_at") WHERE ("status" = 'failed'::"text");



CREATE INDEX "idx_document_jobs_batch_operation_id" ON "public"."document_jobs" USING "btree" ("batch_operation_id");



CREATE INDEX "idx_document_jobs_batch_ops" ON "public"."document_jobs" USING "btree" ("batch_operation_id", "processing_method", "status") WHERE ("batch_operation_id" IS NOT NULL);



CREATE INDEX "idx_document_jobs_completion" ON "public"."document_jobs" USING "btree" ("document_id", "status", "updated_at" DESC);



CREATE INDEX "idx_document_jobs_created_at" ON "public"."document_jobs" USING "btree" ("created_at");



CREATE INDEX "idx_document_jobs_document" ON "public"."document_jobs" USING "btree" ("document_id");



CREATE INDEX "idx_document_jobs_document_id" ON "public"."document_jobs" USING "btree" ("document_id");



CREATE INDEX "idx_document_jobs_failed_auth" ON "public"."document_jobs" USING "btree" ("user_id", "status", "created_at" DESC) WHERE ("status" = 'failed'::"text");



CREATE INDEX "idx_document_jobs_orphaned" ON "public"."document_jobs" USING "btree" ("document_id", "created_at");



CREATE INDEX "idx_document_jobs_performance" ON "public"."document_jobs" USING "btree" ("processing_method", "created_at", "updated_at", "status") WHERE ("status" = 'completed'::"text");



CREATE INDEX "idx_document_jobs_processing" ON "public"."document_jobs" USING "btree" ("processing_method", "status");



CREATE INDEX "idx_document_jobs_processing_method" ON "public"."document_jobs" USING "btree" ("processing_method");



CREATE INDEX "idx_document_jobs_processing_monitoring" ON "public"."document_jobs" USING "btree" ("status", "processing_method", "started_at", "processing_time_ms") WHERE ("status" = ANY (ARRAY['processing'::"text", 'completed'::"text"]));



CREATE INDEX "idx_document_jobs_queue_optimized" ON "public"."document_jobs" USING "btree" ("status", "priority" DESC, "created_at", "attempts", "max_attempts") WHERE ("status" = ANY (ARRAY['queued'::"text", 'processing'::"text"]));



CREATE INDEX "idx_document_jobs_queue_processing" ON "public"."document_jobs" USING "btree" ("status", "priority" DESC, "created_at") WHERE ("status" = ANY (ARRAY['queued'::"text", 'processing'::"text"]));



CREATE INDEX "idx_document_jobs_status" ON "public"."document_jobs" USING "btree" ("status");



COMMENT ON INDEX "public"."idx_document_jobs_status" IS 'Optimizes job queue processing with enterprise-scale 20x concurrency support';



CREATE INDEX "idx_document_jobs_status_priority" ON "public"."document_jobs" USING "btree" ("status", "priority" DESC, "created_at");



CREATE INDEX "idx_document_jobs_user_id" ON "public"."document_jobs" USING "btree" ("user_id");



CREATE INDEX "idx_document_jobs_user_status" ON "public"."document_jobs" USING "btree" ("user_id", "status", "created_at" DESC);



CREATE INDEX "idx_document_jobs_with_documents" ON "public"."document_jobs" USING "btree" ("document_id", "status", "processing_method", "created_at");



CREATE INDEX "idx_documents_cache_keys" ON "public"."documents" USING "btree" ("user_id", "status", "updated_at" DESC) WHERE ("status" = ANY (ARRAY['completed'::"text", 'processing'::"text", 'error'::"text"]));



CREATE INDEX "idx_documents_centroid_ivfflat" ON "public"."documents" USING "ivfflat" ("centroid_embedding" "extensions"."vector_cosine_ops") WITH ("lists"='100');



CREATE INDEX "idx_documents_content_type" ON "public"."documents" USING "btree" ("content_type", "created_at" DESC);



CREATE INDEX "idx_documents_created_at" ON "public"."documents" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_documents_dashboard" ON "public"."documents" USING "btree" ("user_id", "status", "created_at" DESC);



COMMENT ON INDEX "public"."idx_documents_dashboard" IS 'Composite index providing 62x performance improvement for dashboard queries';



CREATE INDEX "idx_documents_dashboard_cache" ON "public"."documents" USING "btree" ("user_id", "updated_at" DESC);



CREATE INDEX "idx_documents_effective_chunk_count" ON "public"."documents" USING "btree" ("effective_chunk_count") WHERE ("effective_chunk_count" IS NOT NULL);



CREATE INDEX "idx_documents_extracted_fields_gin" ON "public"."documents" USING "gin" ("extracted_fields");



CREATE INDEX "idx_documents_file_size" ON "public"."documents" USING "btree" ("file_size") WHERE ("status" = 'completed'::"text");



CREATE INDEX "idx_documents_filename_gin" ON "public"."documents" USING "gin" ("to_tsvector"('"english"'::"regconfig", "filename"));



CREATE INDEX "idx_documents_fulltext_search" ON "public"."documents" USING "gin" ("to_tsvector"('"english"'::"regconfig", (("title" || ' '::"text") || "filename"))) WHERE ("status" = 'completed'::"text");



CREATE INDEX "idx_documents_fund_manager" ON "public"."documents" USING "btree" ((("metadata" ->> 'fund_manager'::"text"))) WHERE (("metadata" ->> 'fund_manager'::"text") IS NOT NULL);



CREATE INDEX "idx_documents_fund_manager_filter" ON "public"."documents" USING "btree" ((("metadata" ->> 'fund_manager'::"text")), "created_at" DESC) WHERE (("metadata" ->> 'fund_manager'::"text") IS NOT NULL);



CREATE INDEX "idx_documents_jurisdiction" ON "public"."documents" USING "btree" ((("metadata" ->> 'jurisdiction'::"text"))) WHERE (("metadata" ->> 'jurisdiction'::"text") IS NOT NULL);



CREATE INDEX "idx_documents_jurisdiction_filter" ON "public"."documents" USING "btree" ((("metadata" ->> 'jurisdiction'::"text")), "created_at" DESC) WHERE (("metadata" ->> 'jurisdiction'::"text") IS NOT NULL);



CREATE INDEX "idx_documents_law_firm" ON "public"."documents" USING "btree" ((("metadata" ->> 'law_firm'::"text"))) WHERE (("metadata" ->> 'law_firm'::"text") IS NOT NULL);



CREATE INDEX "idx_documents_law_firm_filter" ON "public"."documents" USING "btree" ((("metadata" ->> 'law_firm'::"text")), "created_at" DESC) WHERE (("metadata" ->> 'law_firm'::"text") IS NOT NULL);



CREATE INDEX "idx_documents_metadata_fund_admin" ON "public"."documents" USING "gin" ((("metadata" ->> 'fund_admin'::"text"))) WHERE (("metadata" ->> 'fund_admin'::"text") IS NOT NULL);



CREATE INDEX "idx_documents_metadata_fund_manager" ON "public"."documents" USING "gin" ((("metadata" ->> 'fund_manager'::"text"))) WHERE (("metadata" ->> 'fund_manager'::"text") IS NOT NULL);



CREATE INDEX "idx_documents_metadata_gin" ON "public"."documents" USING "gin" ("metadata");



CREATE INDEX "idx_documents_metadata_jurisdiction" ON "public"."documents" USING "gin" ((("metadata" ->> 'jurisdiction'::"text"))) WHERE (("metadata" ->> 'jurisdiction'::"text") IS NOT NULL);



CREATE INDEX "idx_documents_metadata_law_firm" ON "public"."documents" USING "gin" ((("metadata" ->> 'law_firm'::"text"))) WHERE (("metadata" ->> 'law_firm'::"text") IS NOT NULL);



CREATE INDEX "idx_documents_metadata_search" ON "public"."documents" USING "gin" ("metadata") WHERE ("metadata" IS NOT NULL);



CREATE INDEX "idx_documents_pagination_search" ON "public"."documents" USING "btree" ("user_id", "status", "created_at" DESC, "title", "filename") WHERE ("status" = ANY (ARRAY['completed'::"text", 'processing'::"text", 'error'::"text"]));



CREATE INDEX "idx_documents_processing" ON "public"."documents" USING "btree" ("user_id", "updated_at" DESC) WHERE ("status" = ANY (ARRAY['processing'::"text", 'queued'::"text"]));



CREATE INDEX "idx_documents_processing_status" ON "public"."documents" USING "btree" ("status", "updated_at") WHERE ("status" = ANY (ARRAY['processing'::"text", 'queued'::"text", 'uploading'::"text", 'cancelling'::"text"]));



CREATE INDEX "idx_documents_search_filename" ON "public"."documents" USING "gin" ("to_tsvector"('"english"'::"regconfig", "filename"));



CREATE INDEX "idx_documents_search_title" ON "public"."documents" USING "gin" ("to_tsvector"('"english"'::"regconfig", "title"));



CREATE INDEX "idx_documents_searchable" ON "public"."documents" USING "btree" ("user_id", "created_at" DESC) WHERE (("status" = 'completed'::"text") AND ((("metadata" ->> 'embeddings_skipped'::"text"))::boolean IS NOT TRUE));



CREATE INDEX "idx_documents_security_risk" ON "public"."documents" USING "btree" (((("metadata" -> 'upload_security'::"text") ->> 'risk_level'::"text")), "created_at" DESC) WHERE (("metadata" -> 'upload_security'::"text") IS NOT NULL);



CREATE INDEX "idx_documents_status" ON "public"."documents" USING "btree" ("status");



CREATE INDEX "idx_documents_status_updated" ON "public"."documents" USING "btree" ("status", "updated_at" DESC);



CREATE INDEX "idx_documents_status_user_id" ON "public"."documents" USING "btree" ("status", "user_id");



CREATE INDEX "idx_documents_storage_cleanup" ON "public"."documents" USING "btree" ("file_path", "status", "updated_at") WHERE ("status" = 'error'::"text");



CREATE INDEX "idx_documents_storage_usage" ON "public"."documents" USING "btree" ("user_id", "file_size", "status") WHERE ("status" = 'completed'::"text");



CREATE INDEX "idx_documents_title_gin" ON "public"."documents" USING "gin" ("to_tsvector"('"english"'::"regconfig", "title"));



CREATE INDEX "idx_documents_title_search" ON "public"."documents" USING "gin" ("to_tsvector"('"english"'::"regconfig", (("title" || ' '::"text") || COALESCE("filename", ''::"text")))) WHERE ("title" IS NOT NULL);



CREATE INDEX "idx_documents_total_characters" ON "public"."documents" USING "btree" ("total_characters") WHERE ("total_characters" IS NOT NULL);



CREATE INDEX "idx_documents_user_activity" ON "public"."documents" USING "btree" ("user_id", "created_at" DESC, "status");



CREATE INDEX "idx_documents_user_created" ON "public"."documents" USING "btree" ("user_id", "created_at" DESC);



CREATE INDEX "idx_documents_user_file_size" ON "public"."documents" USING "btree" ("user_id", "file_size") WHERE (("user_id" IS NOT NULL) AND ("file_size" IS NOT NULL));



CREATE INDEX "idx_documents_user_id" ON "public"."documents" USING "btree" ("user_id");



CREATE INDEX "idx_documents_user_status" ON "public"."documents" USING "btree" ("user_id", "status");



COMMENT ON INDEX "public"."idx_documents_user_status" IS 'Optimizes dashboard queries by user and status';



CREATE INDEX "idx_documents_user_status_created" ON "public"."documents" USING "btree" ("user_id", "status", "created_at" DESC);



CREATE INDEX "idx_documents_with_jobs" ON "public"."documents" USING "btree" ("user_id", "created_at" DESC, "id") WHERE ("status" = ANY (ARRAY['completed'::"text", 'processing'::"text", 'queued'::"text"]));



CREATE INDEX "idx_jobs_active" ON "public"."document_jobs" USING "btree" ("created_at") WHERE ("status" = ANY (ARRAY['queued'::"text", 'processing'::"text"]));



CREATE INDEX "idx_processing_status_cleanup" ON "public"."processing_status" USING "btree" ("document_id", "created_at");



CREATE INDEX "idx_processing_status_document_id" ON "public"."processing_status" USING "btree" ("document_id");



CREATE INDEX "idx_processing_status_document_time" ON "public"."processing_status" USING "btree" ("document_id", "created_at" DESC);



CREATE INDEX "idx_processing_status_latest" ON "public"."processing_status" USING "btree" ("document_id", "created_at" DESC, "status");



CREATE INDEX "idx_processing_status_progress" ON "public"."processing_status" USING "btree" ("document_id", "progress", "updated_at" DESC) WHERE ("status" = ANY (ARRAY['processing'::"text", 'queued'::"text"]));



CREATE INDEX "idx_processing_status_status" ON "public"."processing_status" USING "btree" ("status");



CREATE INDEX "idx_processing_status_updated_at" ON "public"."processing_status" USING "btree" ("updated_at" DESC);



CREATE INDEX "idx_user_activity_logs_action_type" ON "public"."user_activity_logs" USING "btree" ("action_type");



CREATE INDEX "idx_user_activity_logs_logged_at" ON "public"."user_activity_logs" USING "btree" ("logged_at" DESC);



CREATE INDEX "idx_user_activity_logs_resource_type" ON "public"."user_activity_logs" USING "btree" ("resource_type");



CREATE INDEX "idx_user_activity_logs_user_uuid" ON "public"."user_activity_logs" USING "btree" ("user_uuid");



CREATE OR REPLACE TRIGGER "handle_document_jobs_updated_at" BEFORE UPDATE ON "public"."document_jobs" FOR EACH ROW EXECUTE FUNCTION "public"."handle_updated_at"();



CREATE OR REPLACE TRIGGER "handle_documents_updated_at" BEFORE UPDATE ON "public"."documents" FOR EACH ROW EXECUTE FUNCTION "public"."handle_updated_at"();



CREATE OR REPLACE TRIGGER "handle_processing_status_updated_at" BEFORE UPDATE ON "public"."processing_status" FOR EACH ROW EXECUTE FUNCTION "public"."handle_updated_at"();



CREATE OR REPLACE TRIGGER "handle_users_updated_at" BEFORE UPDATE ON "public"."users" FOR EACH ROW EXECUTE FUNCTION "public"."handle_updated_at"();



ALTER TABLE ONLY "public"."document_content"
    ADD CONSTRAINT "document_content_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."document_embeddings"
    ADD CONSTRAINT "document_embeddings_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."document_jobs"
    ADD CONSTRAINT "document_jobs_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."document_jobs"
    ADD CONSTRAINT "document_jobs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."documents"
    ADD CONSTRAINT "documents_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."processing_status"
    ADD CONSTRAINT "processing_status_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id");



CREATE POLICY "Company users can insert document jobs" ON "public"."document_jobs" FOR INSERT WITH CHECK ((("auth"."uid"() = "user_id") AND (EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."email" ~~ '%@anduintransact.com'::"text"))))));



CREATE POLICY "Company users can insert documents" ON "public"."documents" FOR INSERT WITH CHECK ((("auth"."uid"() = "user_id") AND (EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."email" ~~ '%@anduintransact.com'::"text"))))));



CREATE POLICY "Company users can insert own profile" ON "public"."users" FOR INSERT WITH CHECK ((("auth"."uid"() = "id") AND ("email" ~~ '%@anduintransact.com'::"text")));



CREATE POLICY "Company users can update own profile" ON "public"."users" FOR UPDATE USING ((("auth"."uid"() = "id") AND ("email" ~~ '%@anduintransact.com'::"text")));



CREATE POLICY "Company users can view all document jobs" ON "public"."document_jobs" FOR SELECT USING ((("auth"."uid"() IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."email" ~~ '%@anduintransact.com'::"text"))))));



CREATE POLICY "Company users can view all documents" ON "public"."documents" FOR SELECT USING ((("auth"."uid"() IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."email" ~~ '%@anduintransact.com'::"text"))))));



CREATE POLICY "Company users can view all embeddings" ON "public"."document_embeddings" FOR SELECT USING ((("auth"."uid"() IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."email" ~~ '%@anduintransact.com'::"text"))))));



CREATE POLICY "Company users can view all processing status" ON "public"."processing_status" FOR SELECT USING ((("auth"."uid"() IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."email" ~~ '%@anduintransact.com'::"text"))))));



CREATE POLICY "Company users can view own profile" ON "public"."users" FOR SELECT USING ((("auth"."uid"() = "id") AND ("email" ~~ '%@anduintransact.com'::"text")));



CREATE POLICY "System can delete embeddings" ON "public"."document_embeddings" FOR DELETE USING ((EXISTS ( SELECT 1
   FROM "public"."documents"
  WHERE ("documents"."id" = "document_embeddings"."document_id"))));



CREATE POLICY "System can insert embeddings" ON "public"."document_embeddings" FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."documents"
  WHERE ("documents"."id" = "document_embeddings"."document_id"))));



CREATE POLICY "System can manage activity logs" ON "public"."user_activity_logs" USING (true);



CREATE POLICY "System can manage all document jobs" ON "public"."document_jobs" USING (((("current_setting"('request.jwt.claims'::"text", true))::json ->> 'role'::"text") = 'service_role'::"text"));



CREATE POLICY "System can manage jobs" ON "public"."document_jobs" USING (true);



CREATE POLICY "System can manage processing status" ON "public"."processing_status" USING (true);



CREATE POLICY "Users can delete own documents" ON "public"."documents" FOR DELETE USING (true);



CREATE POLICY "Users can insert own documents" ON "public"."documents" FOR INSERT WITH CHECK (true);



CREATE POLICY "Users can insert own embeddings" ON "public"."document_embeddings" FOR INSERT WITH CHECK (true);



CREATE POLICY "Users can only delete own documents" ON "public"."documents" FOR DELETE USING ((("auth"."uid"() = "user_id") AND (EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."email" ~~ '%@anduintransact.com'::"text"))))));



CREATE POLICY "Users can only modify own documents" ON "public"."documents" FOR UPDATE USING ((("auth"."uid"() = "user_id") AND (EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."email" ~~ '%@anduintransact.com'::"text"))))));



CREATE POLICY "Users can update own document content" ON "public"."document_content" FOR UPDATE USING (true) WITH CHECK (true);



CREATE POLICY "Users can update own document jobs" ON "public"."document_jobs" FOR UPDATE USING ((("auth"."uid"() = "user_id") AND (EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."email" ~~ '%@anduintransact.com'::"text"))))));



CREATE POLICY "Users can update own documents" ON "public"."documents" FOR UPDATE USING (true) WITH CHECK (true);



CREATE POLICY "Users can update own profile" ON "public"."users" FOR UPDATE USING (true) WITH CHECK (true);



CREATE POLICY "Users can upsert own document content" ON "public"."document_content" FOR INSERT WITH CHECK (true);



CREATE POLICY "Users can view own document content" ON "public"."document_content" FOR SELECT USING (true);



CREATE POLICY "Users can view own documents" ON "public"."documents" FOR SELECT USING (true);



CREATE POLICY "Users can view own embeddings" ON "public"."document_embeddings" FOR SELECT USING (true);



CREATE POLICY "Users can view own jobs" ON "public"."document_jobs" FOR SELECT USING (true);



CREATE POLICY "Users can view own processing status" ON "public"."processing_status" FOR SELECT USING (true);



CREATE POLICY "Users can view own profile" ON "public"."users" FOR SELECT USING (true);



ALTER TABLE "public"."document_content" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."document_embeddings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."document_jobs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."documents" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."processing_status" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_activity_logs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."users" ENABLE ROW LEVEL SECURITY;




ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";






ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."documents";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."processing_status";



GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";















































































































































































































































































































































































































































































































GRANT ALL ON FUNCTION "public"."analyze_document_structure"("doc_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."analyze_document_structure"("doc_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."analyze_document_structure"("doc_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."calculate_document_similarity"("target_document_id" "uuid", "compare_document_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."calculate_document_similarity"("target_document_id" "uuid", "compare_document_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."calculate_document_similarity"("target_document_id" "uuid", "compare_document_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."cleanup_analysis_cache"() TO "anon";
GRANT ALL ON FUNCTION "public"."cleanup_analysis_cache"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."cleanup_analysis_cache"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."cleanup_old_activity_logs"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."cleanup_old_activity_logs"() TO "anon";
GRANT ALL ON FUNCTION "public"."cleanup_old_activity_logs"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."cleanup_old_activity_logs"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."cleanup_old_processing_status"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."cleanup_old_processing_status"() TO "anon";
GRANT ALL ON FUNCTION "public"."cleanup_old_processing_status"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."cleanup_old_processing_status"() TO "service_role";



GRANT ALL ON FUNCTION "public"."cleanup_user_data"() TO "anon";
GRANT ALL ON FUNCTION "public"."cleanup_user_data"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."cleanup_user_data"() TO "service_role";



GRANT ALL ON FUNCTION "public"."enhanced_similarity_search"("p_user_id" "uuid", "p_document_id" "uuid", "p_limit" integer, "p_min_similarity" numeric) TO "anon";
GRANT ALL ON FUNCTION "public"."enhanced_similarity_search"("p_user_id" "uuid", "p_document_id" "uuid", "p_limit" integer, "p_min_similarity" numeric) TO "authenticated";
GRANT ALL ON FUNCTION "public"."enhanced_similarity_search"("p_user_id" "uuid", "p_document_id" "uuid", "p_limit" integer, "p_min_similarity" numeric) TO "service_role";



GRANT ALL ON FUNCTION "public"."find_similar_documents_fast"("target_document_id" "uuid", "similarity_threshold" numeric, "result_limit" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."find_similar_documents_fast"("target_document_id" "uuid", "similarity_threshold" numeric, "result_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."find_similar_documents_fast"("target_document_id" "uuid", "similarity_threshold" numeric, "result_limit" integer) TO "service_role";






GRANT ALL ON FUNCTION "public"."find_similar_documents_with_fingerprints"("p_user_id" "uuid", "p_document_id" "uuid", "p_limit" integer, "p_min_similarity" numeric) TO "anon";
GRANT ALL ON FUNCTION "public"."find_similar_documents_with_fingerprints"("p_user_id" "uuid", "p_document_id" "uuid", "p_limit" integer, "p_min_similarity" numeric) TO "authenticated";
GRANT ALL ON FUNCTION "public"."find_similar_documents_with_fingerprints"("p_user_id" "uuid", "p_document_id" "uuid", "p_limit" integer, "p_min_similarity" numeric) TO "service_role";



GRANT ALL ON FUNCTION "public"."find_similar_sections_with_embeddings"("p_user_id" "uuid", "p_query_embedding" "text", "p_section_type" "text", "p_limit" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."find_similar_sections_with_embeddings"("p_user_id" "uuid", "p_query_embedding" "text", "p_section_type" "text", "p_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."find_similar_sections_with_embeddings"("p_user_id" "uuid", "p_query_embedding" "text", "p_section_type" "text", "p_limit" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."get_cached_similarity_features"("target_document_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_cached_similarity_features"("target_document_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_cached_similarity_features"("target_document_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_document_chunks"("target_document_id" "uuid", "limit_count" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."get_document_chunks"("target_document_id" "uuid", "limit_count" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_document_chunks"("target_document_id" "uuid", "limit_count" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."get_document_summary"("doc_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_document_summary"("doc_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_document_summary"("doc_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_system_health"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_system_health"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_system_health"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_system_health"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_user_document_stats"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_user_document_stats"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_user_document_stats"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_vector_index_stats"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_vector_index_stats"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_vector_index_stats"() TO "service_role";



GRANT ALL ON FUNCTION "public"."gin_btree_consistent"("internal", smallint, "anyelement", integer, "internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gin_btree_consistent"("internal", smallint, "anyelement", integer, "internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gin_btree_consistent"("internal", smallint, "anyelement", integer, "internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gin_btree_consistent"("internal", smallint, "anyelement", integer, "internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gin_compare_prefix_anyenum"("anyenum", "anyenum", smallint, "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gin_compare_prefix_anyenum"("anyenum", "anyenum", smallint, "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gin_compare_prefix_anyenum"("anyenum", "anyenum", smallint, "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gin_compare_prefix_anyenum"("anyenum", "anyenum", smallint, "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gin_compare_prefix_bit"(bit, bit, smallint, "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gin_compare_prefix_bit"(bit, bit, smallint, "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gin_compare_prefix_bit"(bit, bit, smallint, "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gin_compare_prefix_bit"(bit, bit, smallint, "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gin_compare_prefix_bool"(boolean, boolean, smallint, "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gin_compare_prefix_bool"(boolean, boolean, smallint, "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gin_compare_prefix_bool"(boolean, boolean, smallint, "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gin_compare_prefix_bool"(boolean, boolean, smallint, "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gin_compare_prefix_bpchar"(character, character, smallint, "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gin_compare_prefix_bpchar"(character, character, smallint, "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gin_compare_prefix_bpchar"(character, character, smallint, "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gin_compare_prefix_bpchar"(character, character, smallint, "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gin_compare_prefix_bytea"("bytea", "bytea", smallint, "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gin_compare_prefix_bytea"("bytea", "bytea", smallint, "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gin_compare_prefix_bytea"("bytea", "bytea", smallint, "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gin_compare_prefix_bytea"("bytea", "bytea", smallint, "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gin_compare_prefix_char"("char", "char", smallint, "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gin_compare_prefix_char"("char", "char", smallint, "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gin_compare_prefix_char"("char", "char", smallint, "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gin_compare_prefix_char"("char", "char", smallint, "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gin_compare_prefix_cidr"("cidr", "cidr", smallint, "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gin_compare_prefix_cidr"("cidr", "cidr", smallint, "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gin_compare_prefix_cidr"("cidr", "cidr", smallint, "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gin_compare_prefix_cidr"("cidr", "cidr", smallint, "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gin_compare_prefix_date"("date", "date", smallint, "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gin_compare_prefix_date"("date", "date", smallint, "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gin_compare_prefix_date"("date", "date", smallint, "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gin_compare_prefix_date"("date", "date", smallint, "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gin_compare_prefix_float4"(real, real, smallint, "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gin_compare_prefix_float4"(real, real, smallint, "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gin_compare_prefix_float4"(real, real, smallint, "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gin_compare_prefix_float4"(real, real, smallint, "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gin_compare_prefix_float8"(double precision, double precision, smallint, "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gin_compare_prefix_float8"(double precision, double precision, smallint, "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gin_compare_prefix_float8"(double precision, double precision, smallint, "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gin_compare_prefix_float8"(double precision, double precision, smallint, "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gin_compare_prefix_inet"("inet", "inet", smallint, "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gin_compare_prefix_inet"("inet", "inet", smallint, "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gin_compare_prefix_inet"("inet", "inet", smallint, "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gin_compare_prefix_inet"("inet", "inet", smallint, "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gin_compare_prefix_int2"(smallint, smallint, smallint, "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gin_compare_prefix_int2"(smallint, smallint, smallint, "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gin_compare_prefix_int2"(smallint, smallint, smallint, "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gin_compare_prefix_int2"(smallint, smallint, smallint, "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gin_compare_prefix_int4"(integer, integer, smallint, "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gin_compare_prefix_int4"(integer, integer, smallint, "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gin_compare_prefix_int4"(integer, integer, smallint, "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gin_compare_prefix_int4"(integer, integer, smallint, "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gin_compare_prefix_int8"(bigint, bigint, smallint, "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gin_compare_prefix_int8"(bigint, bigint, smallint, "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gin_compare_prefix_int8"(bigint, bigint, smallint, "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gin_compare_prefix_int8"(bigint, bigint, smallint, "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gin_compare_prefix_interval"(interval, interval, smallint, "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gin_compare_prefix_interval"(interval, interval, smallint, "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gin_compare_prefix_interval"(interval, interval, smallint, "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gin_compare_prefix_interval"(interval, interval, smallint, "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gin_compare_prefix_macaddr"("macaddr", "macaddr", smallint, "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gin_compare_prefix_macaddr"("macaddr", "macaddr", smallint, "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gin_compare_prefix_macaddr"("macaddr", "macaddr", smallint, "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gin_compare_prefix_macaddr"("macaddr", "macaddr", smallint, "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gin_compare_prefix_macaddr8"("macaddr8", "macaddr8", smallint, "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gin_compare_prefix_macaddr8"("macaddr8", "macaddr8", smallint, "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gin_compare_prefix_macaddr8"("macaddr8", "macaddr8", smallint, "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gin_compare_prefix_macaddr8"("macaddr8", "macaddr8", smallint, "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gin_compare_prefix_money"("money", "money", smallint, "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gin_compare_prefix_money"("money", "money", smallint, "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gin_compare_prefix_money"("money", "money", smallint, "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gin_compare_prefix_money"("money", "money", smallint, "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gin_compare_prefix_name"("name", "name", smallint, "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gin_compare_prefix_name"("name", "name", smallint, "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gin_compare_prefix_name"("name", "name", smallint, "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gin_compare_prefix_name"("name", "name", smallint, "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gin_compare_prefix_numeric"(numeric, numeric, smallint, "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gin_compare_prefix_numeric"(numeric, numeric, smallint, "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gin_compare_prefix_numeric"(numeric, numeric, smallint, "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gin_compare_prefix_numeric"(numeric, numeric, smallint, "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gin_compare_prefix_oid"("oid", "oid", smallint, "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gin_compare_prefix_oid"("oid", "oid", smallint, "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gin_compare_prefix_oid"("oid", "oid", smallint, "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gin_compare_prefix_oid"("oid", "oid", smallint, "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gin_compare_prefix_text"("text", "text", smallint, "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gin_compare_prefix_text"("text", "text", smallint, "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gin_compare_prefix_text"("text", "text", smallint, "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gin_compare_prefix_text"("text", "text", smallint, "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gin_compare_prefix_time"(time without time zone, time without time zone, smallint, "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gin_compare_prefix_time"(time without time zone, time without time zone, smallint, "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gin_compare_prefix_time"(time without time zone, time without time zone, smallint, "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gin_compare_prefix_time"(time without time zone, time without time zone, smallint, "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gin_compare_prefix_timestamp"(timestamp without time zone, timestamp without time zone, smallint, "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gin_compare_prefix_timestamp"(timestamp without time zone, timestamp without time zone, smallint, "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gin_compare_prefix_timestamp"(timestamp without time zone, timestamp without time zone, smallint, "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gin_compare_prefix_timestamp"(timestamp without time zone, timestamp without time zone, smallint, "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gin_compare_prefix_timestamptz"(timestamp with time zone, timestamp with time zone, smallint, "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gin_compare_prefix_timestamptz"(timestamp with time zone, timestamp with time zone, smallint, "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gin_compare_prefix_timestamptz"(timestamp with time zone, timestamp with time zone, smallint, "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gin_compare_prefix_timestamptz"(timestamp with time zone, timestamp with time zone, smallint, "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gin_compare_prefix_timetz"(time with time zone, time with time zone, smallint, "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gin_compare_prefix_timetz"(time with time zone, time with time zone, smallint, "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gin_compare_prefix_timetz"(time with time zone, time with time zone, smallint, "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gin_compare_prefix_timetz"(time with time zone, time with time zone, smallint, "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gin_compare_prefix_uuid"("uuid", "uuid", smallint, "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gin_compare_prefix_uuid"("uuid", "uuid", smallint, "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gin_compare_prefix_uuid"("uuid", "uuid", smallint, "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gin_compare_prefix_uuid"("uuid", "uuid", smallint, "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gin_compare_prefix_varbit"(bit varying, bit varying, smallint, "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gin_compare_prefix_varbit"(bit varying, bit varying, smallint, "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gin_compare_prefix_varbit"(bit varying, bit varying, smallint, "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gin_compare_prefix_varbit"(bit varying, bit varying, smallint, "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gin_enum_cmp"("anyenum", "anyenum") TO "postgres";
GRANT ALL ON FUNCTION "public"."gin_enum_cmp"("anyenum", "anyenum") TO "anon";
GRANT ALL ON FUNCTION "public"."gin_enum_cmp"("anyenum", "anyenum") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gin_enum_cmp"("anyenum", "anyenum") TO "service_role";



GRANT ALL ON FUNCTION "public"."gin_extract_query_anyenum"("anyenum", "internal", smallint, "internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gin_extract_query_anyenum"("anyenum", "internal", smallint, "internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gin_extract_query_anyenum"("anyenum", "internal", smallint, "internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gin_extract_query_anyenum"("anyenum", "internal", smallint, "internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gin_extract_query_bit"(bit, "internal", smallint, "internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gin_extract_query_bit"(bit, "internal", smallint, "internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gin_extract_query_bit"(bit, "internal", smallint, "internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gin_extract_query_bit"(bit, "internal", smallint, "internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gin_extract_query_bool"(boolean, "internal", smallint, "internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gin_extract_query_bool"(boolean, "internal", smallint, "internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gin_extract_query_bool"(boolean, "internal", smallint, "internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gin_extract_query_bool"(boolean, "internal", smallint, "internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gin_extract_query_bpchar"(character, "internal", smallint, "internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gin_extract_query_bpchar"(character, "internal", smallint, "internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gin_extract_query_bpchar"(character, "internal", smallint, "internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gin_extract_query_bpchar"(character, "internal", smallint, "internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gin_extract_query_bytea"("bytea", "internal", smallint, "internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gin_extract_query_bytea"("bytea", "internal", smallint, "internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gin_extract_query_bytea"("bytea", "internal", smallint, "internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gin_extract_query_bytea"("bytea", "internal", smallint, "internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gin_extract_query_char"("char", "internal", smallint, "internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gin_extract_query_char"("char", "internal", smallint, "internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gin_extract_query_char"("char", "internal", smallint, "internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gin_extract_query_char"("char", "internal", smallint, "internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gin_extract_query_cidr"("cidr", "internal", smallint, "internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gin_extract_query_cidr"("cidr", "internal", smallint, "internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gin_extract_query_cidr"("cidr", "internal", smallint, "internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gin_extract_query_cidr"("cidr", "internal", smallint, "internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gin_extract_query_date"("date", "internal", smallint, "internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gin_extract_query_date"("date", "internal", smallint, "internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gin_extract_query_date"("date", "internal", smallint, "internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gin_extract_query_date"("date", "internal", smallint, "internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gin_extract_query_float4"(real, "internal", smallint, "internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gin_extract_query_float4"(real, "internal", smallint, "internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gin_extract_query_float4"(real, "internal", smallint, "internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gin_extract_query_float4"(real, "internal", smallint, "internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gin_extract_query_float8"(double precision, "internal", smallint, "internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gin_extract_query_float8"(double precision, "internal", smallint, "internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gin_extract_query_float8"(double precision, "internal", smallint, "internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gin_extract_query_float8"(double precision, "internal", smallint, "internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gin_extract_query_inet"("inet", "internal", smallint, "internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gin_extract_query_inet"("inet", "internal", smallint, "internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gin_extract_query_inet"("inet", "internal", smallint, "internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gin_extract_query_inet"("inet", "internal", smallint, "internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gin_extract_query_int2"(smallint, "internal", smallint, "internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gin_extract_query_int2"(smallint, "internal", smallint, "internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gin_extract_query_int2"(smallint, "internal", smallint, "internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gin_extract_query_int2"(smallint, "internal", smallint, "internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gin_extract_query_int4"(integer, "internal", smallint, "internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gin_extract_query_int4"(integer, "internal", smallint, "internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gin_extract_query_int4"(integer, "internal", smallint, "internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gin_extract_query_int4"(integer, "internal", smallint, "internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gin_extract_query_int8"(bigint, "internal", smallint, "internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gin_extract_query_int8"(bigint, "internal", smallint, "internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gin_extract_query_int8"(bigint, "internal", smallint, "internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gin_extract_query_int8"(bigint, "internal", smallint, "internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gin_extract_query_interval"(interval, "internal", smallint, "internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gin_extract_query_interval"(interval, "internal", smallint, "internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gin_extract_query_interval"(interval, "internal", smallint, "internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gin_extract_query_interval"(interval, "internal", smallint, "internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gin_extract_query_macaddr"("macaddr", "internal", smallint, "internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gin_extract_query_macaddr"("macaddr", "internal", smallint, "internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gin_extract_query_macaddr"("macaddr", "internal", smallint, "internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gin_extract_query_macaddr"("macaddr", "internal", smallint, "internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gin_extract_query_macaddr8"("macaddr8", "internal", smallint, "internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gin_extract_query_macaddr8"("macaddr8", "internal", smallint, "internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gin_extract_query_macaddr8"("macaddr8", "internal", smallint, "internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gin_extract_query_macaddr8"("macaddr8", "internal", smallint, "internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gin_extract_query_money"("money", "internal", smallint, "internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gin_extract_query_money"("money", "internal", smallint, "internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gin_extract_query_money"("money", "internal", smallint, "internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gin_extract_query_money"("money", "internal", smallint, "internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gin_extract_query_name"("name", "internal", smallint, "internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gin_extract_query_name"("name", "internal", smallint, "internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gin_extract_query_name"("name", "internal", smallint, "internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gin_extract_query_name"("name", "internal", smallint, "internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gin_extract_query_numeric"(numeric, "internal", smallint, "internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gin_extract_query_numeric"(numeric, "internal", smallint, "internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gin_extract_query_numeric"(numeric, "internal", smallint, "internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gin_extract_query_numeric"(numeric, "internal", smallint, "internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gin_extract_query_oid"("oid", "internal", smallint, "internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gin_extract_query_oid"("oid", "internal", smallint, "internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gin_extract_query_oid"("oid", "internal", smallint, "internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gin_extract_query_oid"("oid", "internal", smallint, "internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gin_extract_query_text"("text", "internal", smallint, "internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gin_extract_query_text"("text", "internal", smallint, "internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gin_extract_query_text"("text", "internal", smallint, "internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gin_extract_query_text"("text", "internal", smallint, "internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gin_extract_query_time"(time without time zone, "internal", smallint, "internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gin_extract_query_time"(time without time zone, "internal", smallint, "internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gin_extract_query_time"(time without time zone, "internal", smallint, "internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gin_extract_query_time"(time without time zone, "internal", smallint, "internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gin_extract_query_timestamp"(timestamp without time zone, "internal", smallint, "internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gin_extract_query_timestamp"(timestamp without time zone, "internal", smallint, "internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gin_extract_query_timestamp"(timestamp without time zone, "internal", smallint, "internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gin_extract_query_timestamp"(timestamp without time zone, "internal", smallint, "internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gin_extract_query_timestamptz"(timestamp with time zone, "internal", smallint, "internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gin_extract_query_timestamptz"(timestamp with time zone, "internal", smallint, "internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gin_extract_query_timestamptz"(timestamp with time zone, "internal", smallint, "internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gin_extract_query_timestamptz"(timestamp with time zone, "internal", smallint, "internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gin_extract_query_timetz"(time with time zone, "internal", smallint, "internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gin_extract_query_timetz"(time with time zone, "internal", smallint, "internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gin_extract_query_timetz"(time with time zone, "internal", smallint, "internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gin_extract_query_timetz"(time with time zone, "internal", smallint, "internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gin_extract_query_uuid"("uuid", "internal", smallint, "internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gin_extract_query_uuid"("uuid", "internal", smallint, "internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gin_extract_query_uuid"("uuid", "internal", smallint, "internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gin_extract_query_uuid"("uuid", "internal", smallint, "internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gin_extract_query_varbit"(bit varying, "internal", smallint, "internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gin_extract_query_varbit"(bit varying, "internal", smallint, "internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gin_extract_query_varbit"(bit varying, "internal", smallint, "internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gin_extract_query_varbit"(bit varying, "internal", smallint, "internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gin_extract_value_anyenum"("anyenum", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gin_extract_value_anyenum"("anyenum", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gin_extract_value_anyenum"("anyenum", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gin_extract_value_anyenum"("anyenum", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gin_extract_value_bit"(bit, "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gin_extract_value_bit"(bit, "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gin_extract_value_bit"(bit, "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gin_extract_value_bit"(bit, "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gin_extract_value_bool"(boolean, "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gin_extract_value_bool"(boolean, "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gin_extract_value_bool"(boolean, "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gin_extract_value_bool"(boolean, "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gin_extract_value_bpchar"(character, "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gin_extract_value_bpchar"(character, "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gin_extract_value_bpchar"(character, "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gin_extract_value_bpchar"(character, "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gin_extract_value_bytea"("bytea", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gin_extract_value_bytea"("bytea", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gin_extract_value_bytea"("bytea", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gin_extract_value_bytea"("bytea", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gin_extract_value_char"("char", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gin_extract_value_char"("char", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gin_extract_value_char"("char", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gin_extract_value_char"("char", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gin_extract_value_cidr"("cidr", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gin_extract_value_cidr"("cidr", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gin_extract_value_cidr"("cidr", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gin_extract_value_cidr"("cidr", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gin_extract_value_date"("date", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gin_extract_value_date"("date", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gin_extract_value_date"("date", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gin_extract_value_date"("date", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gin_extract_value_float4"(real, "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gin_extract_value_float4"(real, "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gin_extract_value_float4"(real, "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gin_extract_value_float4"(real, "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gin_extract_value_float8"(double precision, "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gin_extract_value_float8"(double precision, "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gin_extract_value_float8"(double precision, "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gin_extract_value_float8"(double precision, "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gin_extract_value_inet"("inet", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gin_extract_value_inet"("inet", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gin_extract_value_inet"("inet", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gin_extract_value_inet"("inet", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gin_extract_value_int2"(smallint, "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gin_extract_value_int2"(smallint, "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gin_extract_value_int2"(smallint, "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gin_extract_value_int2"(smallint, "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gin_extract_value_int4"(integer, "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gin_extract_value_int4"(integer, "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gin_extract_value_int4"(integer, "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gin_extract_value_int4"(integer, "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gin_extract_value_int8"(bigint, "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gin_extract_value_int8"(bigint, "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gin_extract_value_int8"(bigint, "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gin_extract_value_int8"(bigint, "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gin_extract_value_interval"(interval, "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gin_extract_value_interval"(interval, "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gin_extract_value_interval"(interval, "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gin_extract_value_interval"(interval, "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gin_extract_value_macaddr"("macaddr", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gin_extract_value_macaddr"("macaddr", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gin_extract_value_macaddr"("macaddr", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gin_extract_value_macaddr"("macaddr", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gin_extract_value_macaddr8"("macaddr8", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gin_extract_value_macaddr8"("macaddr8", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gin_extract_value_macaddr8"("macaddr8", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gin_extract_value_macaddr8"("macaddr8", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gin_extract_value_money"("money", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gin_extract_value_money"("money", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gin_extract_value_money"("money", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gin_extract_value_money"("money", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gin_extract_value_name"("name", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gin_extract_value_name"("name", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gin_extract_value_name"("name", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gin_extract_value_name"("name", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gin_extract_value_numeric"(numeric, "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gin_extract_value_numeric"(numeric, "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gin_extract_value_numeric"(numeric, "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gin_extract_value_numeric"(numeric, "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gin_extract_value_oid"("oid", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gin_extract_value_oid"("oid", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gin_extract_value_oid"("oid", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gin_extract_value_oid"("oid", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gin_extract_value_text"("text", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gin_extract_value_text"("text", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gin_extract_value_text"("text", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gin_extract_value_text"("text", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gin_extract_value_time"(time without time zone, "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gin_extract_value_time"(time without time zone, "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gin_extract_value_time"(time without time zone, "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gin_extract_value_time"(time without time zone, "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gin_extract_value_timestamp"(timestamp without time zone, "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gin_extract_value_timestamp"(timestamp without time zone, "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gin_extract_value_timestamp"(timestamp without time zone, "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gin_extract_value_timestamp"(timestamp without time zone, "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gin_extract_value_timestamptz"(timestamp with time zone, "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gin_extract_value_timestamptz"(timestamp with time zone, "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gin_extract_value_timestamptz"(timestamp with time zone, "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gin_extract_value_timestamptz"(timestamp with time zone, "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gin_extract_value_timetz"(time with time zone, "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gin_extract_value_timetz"(time with time zone, "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gin_extract_value_timetz"(time with time zone, "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gin_extract_value_timetz"(time with time zone, "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gin_extract_value_uuid"("uuid", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gin_extract_value_uuid"("uuid", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gin_extract_value_uuid"("uuid", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gin_extract_value_uuid"("uuid", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gin_extract_value_varbit"(bit varying, "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gin_extract_value_varbit"(bit varying, "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gin_extract_value_varbit"(bit varying, "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gin_extract_value_varbit"(bit varying, "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gin_numeric_cmp"(numeric, numeric) TO "postgres";
GRANT ALL ON FUNCTION "public"."gin_numeric_cmp"(numeric, numeric) TO "anon";
GRANT ALL ON FUNCTION "public"."gin_numeric_cmp"(numeric, numeric) TO "authenticated";
GRANT ALL ON FUNCTION "public"."gin_numeric_cmp"(numeric, numeric) TO "service_role";



REVOKE ALL ON FUNCTION "public"."handle_new_user"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."handle_updated_at"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."handle_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."invalidate_similarity_cache"() TO "anon";
GRANT ALL ON FUNCTION "public"."invalidate_similarity_cache"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."invalidate_similarity_cache"() TO "service_role";






GRANT ALL ON FUNCTION "public"."refresh_document_embeddings"("doc_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."refresh_document_embeddings"("doc_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."refresh_document_embeddings"("doc_id" "uuid") TO "service_role";









GRANT ALL ON FUNCTION "public"."search_form_fields"("search_query" "text", "user_id_param" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."search_form_fields"("search_query" "text", "user_id_param" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."search_form_fields"("search_query" "text", "user_id_param" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."test_security_policies"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."test_security_policies"() TO "anon";
GRANT ALL ON FUNCTION "public"."test_security_policies"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."test_security_policies"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_document_analysis_cache_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_document_analysis_cache_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_document_analysis_cache_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_document_fingerprints_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_document_fingerprints_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_document_fingerprints_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "service_role";






























GRANT ALL ON TABLE "public"."document_content" TO "anon";
GRANT ALL ON TABLE "public"."document_content" TO "authenticated";
GRANT ALL ON TABLE "public"."document_content" TO "service_role";



GRANT ALL ON TABLE "public"."document_embeddings" TO "anon";
GRANT ALL ON TABLE "public"."document_embeddings" TO "authenticated";
GRANT ALL ON TABLE "public"."document_embeddings" TO "service_role";



GRANT ALL ON TABLE "public"."document_jobs" TO "anon";
GRANT ALL ON TABLE "public"."document_jobs" TO "authenticated";
GRANT ALL ON TABLE "public"."document_jobs" TO "service_role";



GRANT ALL ON TABLE "public"."documents" TO "anon";
GRANT ALL ON TABLE "public"."documents" TO "authenticated";
GRANT ALL ON TABLE "public"."documents" TO "service_role";



GRANT ALL ON TABLE "public"."document_processing_analytics" TO "anon";
GRANT ALL ON TABLE "public"."document_processing_analytics" TO "authenticated";
GRANT ALL ON TABLE "public"."document_processing_analytics" TO "service_role";



GRANT ALL ON TABLE "public"."job_performance_monitoring" TO "anon";
GRANT ALL ON TABLE "public"."job_performance_monitoring" TO "authenticated";
GRANT ALL ON TABLE "public"."job_performance_monitoring" TO "service_role";



GRANT ALL ON TABLE "public"."processing_status" TO "anon";
GRANT ALL ON TABLE "public"."processing_status" TO "authenticated";
GRANT ALL ON TABLE "public"."processing_status" TO "service_role";



GRANT ALL ON TABLE "public"."system_health_dashboard" TO "anon";
GRANT ALL ON TABLE "public"."system_health_dashboard" TO "authenticated";
GRANT ALL ON TABLE "public"."system_health_dashboard" TO "service_role";



GRANT ALL ON TABLE "public"."user_activity_logs" TO "anon";
GRANT ALL ON TABLE "public"."user_activity_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."user_activity_logs" TO "service_role";



GRANT ALL ON TABLE "public"."user_activity_recent" TO "anon";
GRANT ALL ON TABLE "public"."user_activity_recent" TO "authenticated";
GRANT ALL ON TABLE "public"."user_activity_recent" TO "service_role";



GRANT ALL ON TABLE "public"."users" TO "anon";
GRANT ALL ON TABLE "public"."users" TO "authenticated";
GRANT ALL ON TABLE "public"."users" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" REVOKE ALL ON FUNCTIONS FROM PUBLIC;




























