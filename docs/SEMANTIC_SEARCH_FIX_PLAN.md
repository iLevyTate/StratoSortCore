# Semantic Search Fix Plan

**Analysis Date:** 2026-01-12 **Status:** Ready for Implementation **Risk Level:** MEDIUM - System
works in happy paths, edge cases need improvement

---

## Executive Summary

The semantic search system is architecturally sound with sophisticated error handling, circuit
breakers, and hybrid search (BM25 + Vector + Chunk). However, several issues were identified that
impact user experience during edge cases.

**Issues Found:**

- 4 Critical issues
- 5 High priority issues
- 12 Medium priority issues (not detailed here)

---

## Critical Issues

### C-1: Silent Query Vector Dimension Mismatch

**Location:** `src/main/services/SearchService.js:414-446`

**Problem:** When users change embedding models (e.g., from `mxbai-embed-large` [1024d] to
`embeddinggemma` [768d]), vector search silently returns 0 results. The error is caught and logged
but swallowed, so the UI shows "no results" instead of explaining the issue.

**Current Code (line 444):**

```javascript
} catch (e) {
  logger.warn('[SearchService] Failed to validate query vector dimension:', e.message);
  return null; // Error swallowed - search proceeds with BM25 only
}
```

**Fix:** Re-throw dimension mismatch errors so UI can display them:

```javascript
} catch (e) {
  if (e.message.includes('Embedding model changed')) {
    throw e; // Propagate to UI
  }
  logger.warn('[SearchService] Failed to validate query vector dimension:', e.message);
  return null;
}
```

**Additional Fix:** Add proactive dimension check on app startup comparing active model vs stored
index dimensions.

---

### C-2: Race Condition in BM25 Index Rebuild

**Location:** `src/main/services/SearchService.js:205-216`

**Problem:** The check-and-set for `_indexBuildPromise` is not atomic. Two concurrent calls could
both see `null` before either sets it, causing duplicate rebuilds.

**Current Code:**

```javascript
async buildBM25Index() {
  if (this._indexBuildPromise) {
    return this._indexBuildPromise; // Check
  }
  this._indexBuildPromise = this._doBuildBM25Index(); // Set - NOT ATOMIC!
  // ...
}
```

**Fix:** Use atomic promise creation pattern:

```javascript
async buildBM25Index() {
  if (this._indexBuildPromise) return this._indexBuildPromise;

  // Atomic: create promise IMMEDIATELY before any async work
  let resolve, reject;
  this._indexBuildPromise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });

  try {
    const result = await this._doBuildBM25Index();
    resolve(result);
    return result;
  } catch (e) {
    reject(e);
    throw e;
  } finally {
    this._indexBuildPromise = null;
  }
}
```

---

### C-3: Ollama Offline - No User Notification

**Location:** `src/main/ipc/semantic.js:1586-1607`

**Problem:** When Ollama is offline, search silently degrades to BM25-only keyword search. Users see
results but don't know semantic matching is disabled.

**Current Code:**

```javascript
if (!modelCheck.available) {
  if (mode === 'vector') {
    return { success: false, error: modelCheck.error };
  }
  effectiveMode = 'bm25'; // Silent fallback
}
```

**Fix:** Return fallback metadata so UI can show a banner:

```javascript
if (!modelCheck.available) {
  if (mode === 'vector') {
    return { success: false, error: modelCheck.error, errorCode: 'MODEL_NOT_AVAILABLE' };
  }
  effectiveMode = 'bm25';
  fallbackInfo = {
    fallback: true,
    fallbackReason: 'Ollama offline - using keyword search only',
    originalMode: mode
  };
}
// Include in response meta
```

---

### C-4: BM25 Index Stale After File Moves

**Location:** `src/main/services/SearchService.js:269-276`

**Problem:** The BM25 index uses file paths, but there's no automatic invalidation when files are
moved/renamed during organization. Search results may point to old paths.

**Fix:** Add index invalidation hook in file operation handlers:

```javascript
// In file move/rename handlers:
const searchService = getSearchServiceInstance();
if (searchService) {
  searchService.invalidateIndex();
}
```

---

## High Priority Issues

### H-1: Search Input Not Debounced

**Location:** `src/renderer/components/search/UnifiedSearchModal.jsx:486-500`

**Problem:** User typing "invoice" triggers 7 searches (i, in, inv, invo, invoi, invoic, invoice),
hammering the search service.

**Fix:** Add debouncing:

```javascript
useEffect(() => {
  const timer = setTimeout(() => {
    setDebouncedQuery(query);
  }, 300); // 300ms debounce
  return () => clearTimeout(timer);
}, [query]);

// Trigger search on debouncedQuery, not query
```

---

### H-2: Circuit Breaker Reset Timeout Too Long

**Location:** `src/main/services/chromadb/ChromaDBServiceCore.js:162-167`

**Problem:** When ChromaDB fails, the circuit breaker opens for 60 seconds. This is too long for
search UX - users wait a full minute before semantic search can recover.

**Current Config:**

```javascript
const circuitBreakerConfig = {
  resetTimeout: 60000 // 60s before attempting recovery
};
```

**Fix:** Reduce to 15-30 seconds:

```javascript
const circuitBreakerConfig = {
  resetTimeout: 20000 // 20s - balance between not hammering and UX
};
```

---

### H-3: BM25 Unicode Handling

**Location:** `src/main/services/SearchService.js:528-533`

**Problem:** Queries with accents, emoji, or CJK characters may not match properly due to missing
Unicode normalization.

**Fix:** Add normalization:

```javascript
_escapeLunrQuery(query) {
  if (!query || typeof query !== 'string') return '';
  const normalized = query.normalize('NFC'); // Unicode normalization
  return normalized.replace(/[+\-&|!(){}[\]^"~*?:\\/]/g, ' ').trim();
}
```

---

### H-4: Large Result Set Memory Spike

**Location:** `src/main/services/SearchService.js:1197-1202`

**Problem:** Fusion sorts ALL results (potentially 2000+) before slicing to top-K (20). Wasteful for
CPU and memory.

**Fix:** Use min-heap or stream top-K during fusion instead of sorting everything.

---

### H-5: Query Cache Invalidation Incomplete

**Location:** `src/main/services/chromadb/fileOperations.js:78-80`

**Problem:** Cache invalidates when specific files change, but not when:

- File metadata changes (tags, category)
- New files added (collection-wide queries stale)

**Fix:** Add cache invalidation for metadata updates and batch operations.

---

## Verified Working (No Issues)

| Feature                      | Status | Notes                                        |
| ---------------------------- | ------ | -------------------------------------------- |
| Empty ChromaDB handling      | ✅     | Shows EmptyEmbeddingsBanner                  |
| Zero results handling        | ✅     | Shows EmptySearchState + auto-diagnostics    |
| Long query validation        | ✅     | Rejects queries >2000 chars                  |
| BM25 index caching           | ✅     | Serialized, 50MB limit                       |
| Embedding caching            | ✅     | TTL + size limits + model-aware invalidation |
| Query deduplication          | ✅     | In-flight dedup, 100 concurrent limit        |
| Multi-hop expansion          | ✅     | Capped at 10 seeds, has decay scoring        |
| ChromaDB distance conversion | ✅     | Correctly converts [0,2] → [1,0] score       |

---

## Architecture Overview

```
Query Input (UI)
       ↓
Query Preprocessing (spell check, synonyms)
       ↓
Hybrid Search Orchestration - SearchService.hybridSearch()
  ├── BM25 Search (keyword) ─── Lunr.js
  ├── Vector Search (semantic) ─ ChromaDB files collection
  └── Chunk Search (deep text) ─ ChromaDB chunks collection
       ↓
Reciprocal Rank Fusion (combines scores)
       ↓
LLM Re-ranking (optional)
       ↓
Score Filtering (minScore threshold)
       ↓
Results to UI
```

---

## Implementation Priority

| Priority | Issue                                     | Effort | Impact           |
| -------- | ----------------------------------------- | ------ | ---------------- |
| 1        | H-1: Add search debouncing                | Low    | High UX          |
| 2        | C-1: Propagate dimension errors to UI     | Low    | High UX          |
| 3        | C-3: Add Ollama offline banner            | Medium | High UX          |
| 4        | H-2: Reduce circuit breaker timeout       | Low    | Medium UX        |
| 5        | C-2: Fix BM25 rebuild race condition      | Medium | Medium stability |
| 6        | H-3: Add Unicode normalization            | Low    | Low (i18n)       |
| 7        | C-4: Add index invalidation on file moves | Medium | Medium accuracy  |
| 8        | H-4: Optimize large result fusion         | High   | Low (perf)       |

---

## Testing Checklist

### Unit Tests Needed

- [ ] SearchService dimension mismatch error propagation
- [ ] BM25 concurrent rebuild protection
- [ ] Query debounce behavior
- [ ] Circuit breaker state transitions

### Integration Tests Needed

- [ ] Search during Ollama offline → recovery
- [ ] Model change → rebuild workflow
- [ ] File move → search index update

### E2E Tests Needed

- [ ] User types query → debounced results (not spam)
- [ ] User switches model → clear error + rebuild prompt
- [ ] Network flap → graceful degradation with banner

---

## Files to Modify

| File                                                    | Changes            |
| ------------------------------------------------------- | ------------------ |
| `src/main/services/SearchService.js`                    | C-1, C-2, H-3, H-4 |
| `src/main/ipc/semantic.js`                              | C-3                |
| `src/main/services/chromadb/ChromaDBServiceCore.js`     | H-2                |
| `src/renderer/components/search/UnifiedSearchModal.jsx` | H-1, C-3 (banner)  |
| File operation handlers                                 | C-4                |

---

## Conclusion

The semantic search system demonstrates senior-level engineering with extensive logging,
diagnostics, and defensive programming. The identified issues are primarily **UX improvements** for
edge cases rather than fundamental bugs. The system works correctly in normal operation.

**Recommended approach:** Fix H-1 (debouncing) and C-1 (dimension error UI) first as they have the
highest user impact with lowest effort.
