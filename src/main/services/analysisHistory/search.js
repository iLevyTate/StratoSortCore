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

// Simple cosine similarity helper
function cosineSimilarity(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
    return 0;
  }
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    dot += x * y;
    normA += x * x;
    normB += y * y;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

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
function searchAnalysis(analysisHistory, cache, searchCacheTTL, query, options = {}) {
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
  let semanticAvailable = false;

  if (embeddingService) {
    try {
      const result = embeddingService.embedText?.(query);
      if (result && typeof result.then === 'function') {
        // If async, skip semantic for sync search path
        semanticAvailable = false;
      } else {
        const { vector } = result || {};
        queryEmbedding = vector;
        semanticAvailable = Array.isArray(queryEmbedding);
      }
    } catch (err) {
      semanticAvailable = false;
    }
  }

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    let score = 0;
    let sim = 0;

    if (semanticAvailable) {
      // Compute or reuse entry embedding
      const cachedEmbedding = cacheStore.entryEmbeddings.get(entry.id);
      let entryVector = cachedEmbedding?.vector;
      if (!entryVector) {
        const text = buildEntryText(entry);
        const embedResult = embeddingService.embedText?.(text);
        if (embedResult && typeof embedResult.then === 'function') {
          entryVector = null;
        } else {
          const { vector } = embedResult || {};
          entryVector = vector;
          if (entryVector) {
            cacheStore.entryEmbeddings.set(entry.id, { vector });
          }
        }
      }
      if (entryVector) {
        sim = cosineSimilarity(queryEmbedding, entryVector);
        // Normalize similarity to a score range similar to previous weights
        score = sim * 100;
      }
    }

    // Fallback keyword scoring (also boosts semantic matches)
    const fileNameLower = entry.fileName.toLowerCase();
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

    if (score > 0 || semanticAvailable) {
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
