# Similarity Search: Complete Review & Fixes

## Executive Summary

Comprehensive review identified and fixed **5 critical issues** causing incorrect similarity results (200% instead of 50%).

---

## Issues Found & Fixed

### ✅ Issue 1: Frontend Using Wrong Component
**Problem**: Form component imported old `SimilarityResults` instead of `SimilarityResultsV2`
**Impact**: UI showed NaN% because old component expected `weightedBidirectional` field but API returns `weightedBidir`
**Fix**: Updated `similarity-search-form.tsx` lines 13, 360
```typescript
// Before
import { SimilarityResults } from './similarity-results'
<SimilarityResults results={results} ... />

// After
import { SimilarityResultsV2 } from './similarity-results-v2'
<SimilarityResultsV2 results={results} ... />
```

---

### ✅ Issue 2: Duplicate Chunks in Database
**Problem**: Each chunk stored 3 times in Supabase with identical `chunk_index`
- Test Doc (30pg): 270 DB rows = 90 unique × 3 copies
- Test Doc (60pg): 540 DB rows = 180 unique × 3 copies

**Root Cause**: Document reprocessing without cleanup

**Impact**: Stage 2 was comparing 270 vs 540 chunks instead of 90 vs 180, causing incorrect denominators

**Fix**: Added deduplication logic in:
- `src/lib/similarity/stages/stage2-final-scoring.ts` (lines 246-254)
- `src/lib/similarity/orchestrator.ts` (lines 219-227)

```typescript
// Deduplicate chunks by chunk_index (keep first occurrence)
const seen = new Set<number>()
const uniqueChunks = allChunks.filter(chunk => {
  if (seen.has(chunk.chunk_index)) {
    return false
  }
  seen.add(chunk.chunk_index)
  return true
})
```

**Verification**: All 3 copies have **identical embeddings**, so keeping first occurrence is correct.

---

### ✅ Issue 3: Bidirectional Matching Not Enforcing 1-to-1 Constraint
**Problem**: Critical bug allowing source chunks to appear in multiple pairs

**Example**:
- A→B: Each of 90 source chunks → 1 pair = 90 pairs
- B→A: Each of 180 candidate chunks → 1 pair = 180 pairs
- Old merge: Combined to **180 pairs** (impossible!)
- Some source chunks appeared 2+ times

**Impact**:
```
jaccard = 180 / (90 + 180 - 180) = 180 / 90 = 200% ❌
```

**Fix**: Complete rewrite of `mergeBidirectionalMatches` in `chunk-matching.ts` (lines 142-187)

**New Algorithm**:
1. Collect all candidate pairs from both directions
2. Sort by similarity score (highest first)
3. **Greedy 1-to-1 selection**: Pick highest-scoring pairs, skip if either chunk already used
4. **Maximum pairs** = min(|A|, |B|)

```typescript
// Greedy 1-to-1 matching
const usedChunkA = new Set<string>()
const usedChunkB = new Set<string>()
const result: ChunkMatch[] = []

for (const pair of allPairs) {
  // Skip if either chunk already used
  if (usedChunkA.has(pair.chunkA.id) || usedChunkB.has(pair.chunkB.id)) {
    continue
  }

  // Accept this pair
  result.push(pair)
  usedChunkA.add(pair.chunkA.id)
  usedChunkB.add(pair.chunkB.id)
}
```

**Expected Result After Fix**:
```
Matched pairs: 90 (enforced 1-to-1)
Jaccard: 90 / (90 + 180 - 90) = 90 / 180 = 50% ✓
Weighted Bidir: 2 × 90 / (90 + 180) = 66.7% ✓
```

---

### ✅ Issue 4: Field Name Mismatch
**Problem**: Frontend component expected `weightedBidirectional`, API returned `weightedBidir`

**Fix**: Updated `SimilarityResultsV2` component type definitions (lines 27-34):
```typescript
interface SimilarityScores {
  jaccard: number
  weightedBidir: number  // Fixed: was weightedBidirectional
  sizeRatio: number
  alpha: number
  final: number
  explanation: string
}
```

---

### ✅ Issue 5: Timeout Too Short
**Problem**: Default 2-second timeout too short for large documents

**Impact**: Candidates timing out and returning null, causing NaN%

**Fix**: Increased timeout in `stage2-final-scoring.ts` (line 37):
```typescript
const { parallelWorkers = 16, threshold = 0.85, timeout = 30000 } = options  // Was 2000
```

---

## Data Flow Verification

### Stage 0: Document-Level Filtering
**Data Sources**:
- Supabase `documents`: `centroid_embedding` (pre-computed)
- **Pinecone vectors**: ANN search with centroid
- Returns: ~150 candidate doc IDs

### Stage 1: Chunk-Level Pre-filtering
**Data Sources**:
- Supabase `document_embeddings`: ALL source chunks (deduplicated to 90)
- **Pinecone vectors**: ANN search with each source chunk embedding
- Returns: ~40 top candidates

### Stage 2: Final Adaptive Scoring
**Data Sources**:
- Supabase `document_embeddings`: Source chunks (90) + Candidate chunks (180)
- **NO Pinecone queries** - computes cosine similarity in-memory
- JavaScript computation: `vecA.reduce((sum, a, i) => sum + a * vecB[i], 0)`
- Returns: Top 30 results with adaptive scores

### Critical Finding
**Pinecone vs Supabase Embeddings**: ✅ Verified identical
- All 3 duplicate copies in Supabase have identical embeddings
- Deduplication (keeping first) matches what's in Pinecone
- No embedding mismatch between Stage 1 (Pinecone) and Stage 2 (Supabase)

---

## Adaptive Scoring Formula (Verified Correct)

```typescript
// Given: matchedPairs, docA_chunks, docB_chunks

// Jaccard (overlap)
jaccard = matchedPairs / (docA + docB - matchedPairs)

// Weighted Bidirectional (match rate)
weightedBidir = 2 × matchedPairs / (docA + docB)

// Size ratio (diagnostics only)
sizeRatio = min(docA, docB) / max(docA, docB)
alpha = clip(sizeRatio², 0.15, 0.95) // retained for logging

// Final score = coverage of the larger document
final = matchedPairs / max(docA, docB)
```

**Example (90 vs 180 chunks, 90 matched)**:
```
Jaccard: 90 / 180 = 50.0%
Weighted Bidir: 180 / 270 = 66.7%
Size Ratio: 90 / 180 = 0.5
Alpha: 0.5² = 0.25 (clamped, diagnostic)
Final: 90 / 180 = 50.0%
```

---

## Testing Performed

### ✅ Diagnostic 1: Chunk Count Verification
```
Test Doc (30pg):
  Supabase: 270 rows → 90 unique chunk_index
  Pinecone: 90 vectors (indices 0-89)

Test Doc (60pg):
  Supabase: 540 rows → 180 unique chunk_index
  Pinecone: 180 vectors (indices 0-179)
```

### ✅ Diagnostic 2: Embedding Comparison
- Verified all 3 duplicate copies have **identical embeddings**
- Verified deduplication (first occurrence) **matches Pinecone**
- No embedding mismatch between stages

### ✅ Diagnostic 3: Bidirectional Matching Test
- Simulated 90 vs 180 chunks
- Old logic: 180 pairs ❌
- New logic: 90 pairs ✓
- Verified true 1-to-1 constraint

---

## Expected Results

### Before Fixes:
```
Matched pairs: 180 (wrong - multiple uses)
Jaccard: 180 / 90 = 200% ❌
Weighted Bidir: 360 / 270 = 133% ❌
UI: NaN% (component mismatch)
```

### After Fixes:
```
Matched pairs: 90 (enforced 1-to-1) ✓
Jaccard: 90 / 180 = 50.0% ✓
Weighted Bidir: 180 / 270 = 66.7% ✓
Final: 90 / 180 = 50% (coverage metric) ✓
UI: Shows correct percentage ✓
```

---

## Files Modified

1. `src/components/similarity/similarity-search-form.tsx` - Use v2 component
2. `src/components/similarity/similarity-results-v2.tsx` - Fix field name
3. `src/lib/similarity/stages/stage2-final-scoring.ts` - Deduplication + timeout
4. `src/lib/similarity/orchestrator.ts` - Deduplication
5. `src/lib/similarity/core/chunk-matching.ts` - 1-to-1 constraint

---

## Recommendations

### Immediate:
1. **Test similarity search** with Test Doc (30pg) vs Test Doc (60pg)
2. Verify result shows **~50% Jaccard**, **~67% Match Rate**

### Short-term:
1. **Clean up duplicate chunks** in database:
   ```sql
   DELETE FROM document_embeddings
   WHERE ctid NOT IN (
     SELECT MIN(ctid)
     FROM document_embeddings
     GROUP BY document_id, chunk_index
   );
   ```

2. **Add unique constraint** to prevent future duplicates:
   ```sql
   CREATE UNIQUE INDEX idx_document_embeddings_unique
   ON document_embeddings(document_id, chunk_index);
   ```

### Long-term:
1. Investigate why documents were processed 3 times
2. Add transaction/cleanup logic to document processing
3. Add validation to reject documents with missing data
4. Consider materialized view for deduplicated chunks

---

## Conclusion

All critical issues have been identified and fixed:
- ✅ Duplicate chunks deduplicated
- ✅ 1-to-1 matching constraint enforced
- ✅ UI component mismatch resolved
- ✅ Timeout increased
- ✅ Adaptive scoring formula verified correct

**Next Step**: Run similarity search to verify **~50% similarity** result.
