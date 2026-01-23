/**
 * Search
 *
 * Full-text search functionality for analysis history.
 * Includes caching, scoring, and pagination.
 *
 * @module analysisHistory/search
 */

const { getSearchCacheKey, maintainCacheSize } = require('./cacheManager');
const { getInstance: getParallelEmbedding } = require('../ParallelEmbeddingService');
const { cosineSimilarity } = require('../../../shared/vectorMath');
const { logger } = require('../../../shared/logger');

// Build the text representation used for semantic embedding
function buildEntryText(entry) {
  const parts = [];
  if (entry.fileName) parts.push(entry.fileName);
  if (entry.analysis?.subject) parts.push(entry.analysis.subject);
  if (entry.analysis?.category) parts.push(`Category: ${entry.analysis.category}`);
  if (entry.analysis?.summary) parts.push(entry.analysis.summary);
  if (Array.isArray(entry.analysis?.tags) && entry.analysis.tags.length > 0) {
    parts.push(`Tags: ${entry.analysis.tags.join(', ')}`);
  }
  if (entry.analysis?.extractedText) {
    // Cap extracted text to avoid enormous prompts
    const text = entry.analysis.extractedText;
    const MAX_TEXT = 2000;
    parts.push(text.length > MAX_TEXT ? text.slice(0, MAX_TEXT) : text);
  }
  return parts.join('\n');
}

/**
 * Search analysis entries with caching and pagination
 * Performance optimizations:
 * - LRU cache for repeated queries
 * - Early exit when max results reached (for simple queries)
 * - Optimized scoring with pre-computed lowercase fields
 *
 * @param {Object} analysisHistory - Analysis history data
 * @param {Object} cache - Cache store
 * @param {number} searchCacheTTL - Search cache TTL in ms
 * @param {string} query - Search query
 * @param {Object} options - Search options
 * @param {number} options.limit - Maximum results to return (default: 100)
 * @param {number} options.offset - Offset for pagination (default: 0)
 * @param {boolean} options.skipCache - Force bypass cache (default: false)
 * @returns {{results: Array, total: number, hasMore: boolean, fromCache: boolean}}
 */
async function searchAnalysis(analysisHistory, cache, searchCacheTTL, query, options = {}) {
  const cacheStore = cache || {};
  cacheStore.entryEmbeddings =
    cacheStore.entryEmbeddings instanceof Map ? cacheStore.entryEmbeddings : new Map();
  cacheStore.searchResults =
    cacheStore.searchResults instanceof Map ? cacheStore.searchResults : new Map();
  cacheStore.searchResultsMaxSize =
    cacheStore.searchResultsMaxSize || cache?.searchResultsMaxSize || 100;

  const { limit = 100, offset = 0, skipCache = false, semantic = true } = options;
  const cacheKey = getSearchCacheKey(query, { limit: 1000, offset: 0 }); // Cache full results
  const now = Date.now();

  // Check cache for this query (cache stores full results, we paginate from cache)
  if (!skipCache && cacheStore.searchResults.has(cacheKey)) {
    const cached = cacheStore.searchResults.get(cacheKey);
    if (now - cached.time < searchCacheTTL) {
      const paginatedResults = cached.results.slice(offset, offset + limit);
      return {
        results: paginatedResults,
        total: cached.results.length,
        hasMore: offset + limit < cached.results.length,
        fromCache: true
      };
    }
    // Cache expired, remove it
    cacheStore.searchResults.delete(cacheKey);
  }

  const queryLower = query.toLowerCase();
  const allResults = [];
  const entries = Object.values(analysisHistory.entries);

  // Decide search mode: semantic with fallback to keyword if embeddings fail
  const embeddingService = semantic ? getParallelEmbedding() : null;
  let queryEmbedding = null;
  let queryModel = null;
  let semanticAvailable = false;

  if (embeddingService) {
    try {
      const result = await embeddingService.embedText(query);
      queryEmbedding = result?.vector;
      queryModel = result?.model || null;
      semanticAvailable = Array.isArray(queryEmbedding) && queryEmbedding.length > 0;
    } catch {
      semanticAvailable = false;
    }
  }

  // Prevent unbounded growth of in-memory embedding cache
  // FIX: Use LRU eviction instead of clearing all entries to avoid recomputation storm
  const MAX_ENTRY_EMBEDDINGS = 2000;
  const EVICTION_TARGET = 1600; // Remove ~20% of oldest entries

  if (cacheStore.entryEmbeddings.size > MAX_ENTRY_EMBEDDINGS) {
    // Sort by timestamp (access time), remove oldest entries
    const entries = Array.from(cacheStore.entryEmbeddings.entries());
    entries.sort((a, b) => (a[1].timestamp || 0) - (b[1].timestamp || 0));

    const toRemove = cacheStore.entryEmbeddings.size - EVICTION_TARGET;
    for (let i = 0; i < toRemove; i++) {
      cacheStore.entryEmbeddings.delete(entries[i][0]);
    }

    logger.debug('[Search] Evicted old embeddings from cache', {
      removed: toRemove,
      remaining: cacheStore.entryEmbeddings.size
    });
  }

  // Avoid unbounded embedding work on large histories:
  // - Always include keyword matches (cheap)
  // - Include up to N additional entries for semantic-only matches (by recency)
  const MAX_SEMANTIC_ENTRIES = 300;
  let semanticCandidateIds = null;
  if (semanticAvailable) {
    if (entries.length <= MAX_SEMANTIC_ENTRIES) {
      semanticCandidateIds = null; // All entries are candidates
    } else {
      const byRecency = entries
        .slice()
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
        .slice(0, MAX_SEMANTIC_ENTRIES);
      semanticCandidateIds = new Set(byRecency.map((e) => e.id));
    }
  }

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    let score = 0;
    let sim = 0;

    const isSemanticCandidate =
      semanticAvailable && (!semanticCandidateIds || semanticCandidateIds.has(entry.id));

    if (isSemanticCandidate) {
      // Compute or reuse entry embedding
      const cacheKey = queryModel ? `${entry.id}:${queryModel}` : String(entry.id);
      const cachedEmbedding = cacheStore.entryEmbeddings.get(cacheKey);
      let entryVector = cachedEmbedding?.vector;
      if (!entryVector) {
        const text = buildEntryText(entry);
        try {
          const { vector, model } = await embeddingService.embedText(text);
          entryVector = vector;
          if (Array.isArray(entryVector) && entryVector.length > 0) {
            const entryCacheKey = model ? `${entry.id}:${model}` : String(entry.id);
            cacheStore.entryEmbeddings.set(entryCacheKey, { vector: entryVector, model });
          }
        } catch {
          entryVector = null;
        }
      }
      if (entryVector) {
        sim = cosineSimilarity(queryEmbedding, entryVector);
        // Normalize similarity to a score range similar to previous weights
        score = sim * 100;
      }
    }

    // Fallback keyword scoring (also boosts semantic matches)
    const fileNameLower = String(entry.fileName || '').toLowerCase();
    if (fileNameLower.includes(queryLower)) {
      score += 10;
      if (fileNameLower === queryLower) {
        score += 5;
      }
    }

    if (entry.analysis.subject) {
      const subjectLower = entry.analysis.subject.toLowerCase();
      if (subjectLower.includes(queryLower)) {
        score += 8;
      }
    }

    if (entry.analysis.summary) {
      const summaryLower = entry.analysis.summary.toLowerCase();
      if (summaryLower.includes(queryLower)) {
        score += 6;
      }
    }

    if (entry.analysis.tags && entry.analysis.tags.length > 0) {
      for (const tag of entry.analysis.tags) {
        if (tag.toLowerCase().includes(queryLower)) {
          score += 4;
          break;
        }
      }
    }

    if (entry.analysis.category && entry.analysis.category.toLowerCase().includes(queryLower)) {
      score += 5;
    }

    if (
      score === 0 &&
      entry.analysis.extractedText &&
      entry.analysis.extractedText.toLowerCase().includes(queryLower)
    ) {
      score += 3;
    }

    // FIX: Include keyword match for tags (keywords) even if they're stored in the 'keywords' field
    if (entry.analysis.keywords && Array.isArray(entry.analysis.keywords)) {
      for (const keyword of entry.analysis.keywords) {
        if (keyword.toLowerCase().includes(queryLower)) {
          score += 4;
          break;
        }
      }
    }

    if (score > 0 || isSemanticCandidate) {
      allResults.push({
        ...entry,
        searchScore: score,
        semanticScore: sim || 0
      });
    }
  }

  // Sort by (semantic-aware) score, then recency
  allResults.sort((a, b) => {
    if (b.searchScore !== a.searchScore) {
      return b.searchScore - a.searchScore;
    }
    return new Date(b.timestamp) - new Date(a.timestamp);
  });

  // Cache the full results for future pagination requests
  cacheStore.searchResults.set(cacheKey, {
    results: allResults,
    time: now
  });
  maintainCacheSize(cacheStore.searchResults, cacheStore.searchResultsMaxSize);

  // Return paginated results
  const paginatedResults = allResults.slice(offset, offset + limit);
  return {
    results: paginatedResults,
    total: allResults.length,
    hasMore: offset + limit < allResults.length,
    fromCache: false
  };
}

module.exports = {
  searchAnalysis
};
