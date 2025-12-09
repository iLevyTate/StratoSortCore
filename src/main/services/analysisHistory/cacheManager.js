/**
 * Cache Manager
 *
 * Multi-level caching system for analysis history.
 * Handles cache invalidation, LRU maintenance, and cache warming.
 *
 * @module analysisHistory/cacheManager
 */

const { get: getConfig } = require('../../../shared/config/index');
const { CACHE } = require('../../../shared/performanceConstants');
const { logger } = require('../../../shared/logger');

logger.setContext('AnalysisHistory-Cache');

/**
 * Create a new cache store with default structure
 * @returns {Object} Cache store object
 */
function createCacheStore() {
  return {
    // Sorted entries cache for getRecentAnalysis - avoids O(n log n) sort
    sortedEntries: null,
    sortedEntriesTime: 0,
    sortedEntriesValid: false,

    // Statistics cache - avoids full iteration for computed stats
    statistics: null,
    statisticsTime: 0,

    // Search results cache - keyed by query hash
    searchResults: new Map(),
    searchResultsMaxSize: CACHE.MAX_LRU_CACHE / 2, // LRU cache size limit

    // Embedding cache for semantic search (entryId -> { vector, model })
    entryEmbeddings: new Map(),

    // Category/tag query caches with pagination support
    categoryResults: new Map(),
    tagResults: new Map(),

    // Incremental statistics - updated on each record/delete
    // These avoid recalculating totals from scratch
    incrementalStats: {
      totalConfidence: 0,
      totalProcessingTime: 0,
      entryCount: 0,
      initialized: false,
    },
  };
}

/**
 * Get cache TTL values from config
 * @returns {Object} Cache TTL values
 */
function getCacheTTLs() {
  return {
    CACHE_TTL_MS: getConfig('PERFORMANCE.cacheTtlShort', 5000), // 5 second cache
    STATS_CACHE_TTL_MS: getConfig('PERFORMANCE.cacheTtlMedium', 30000), // 30 second cache
    SEARCH_CACHE_TTL_MS: CACHE.SEARCH_CACHE_TTL_MS,
  };
}

/**
 * Invalidate all caches - called when data structure changes significantly
 * @param {Object} cache - Cache store object
 * @param {Object} state - State object with _statsNeedFullRecalc flag
 */
function invalidateCaches(cache, state) {
  cache.sortedEntries = null;
  cache.sortedEntriesValid = false;
  cache.statistics = null;
  cache.searchResults.clear();
  cache.categoryResults.clear();
  cache.tagResults.clear();
  state._statsNeedFullRecalc = true;
}

/**
 * Invalidate only caches affected by adding a new entry
 * More surgical than full invalidation - preserves search caches
 * @param {Object} cache - Cache store object
 */
function invalidateCachesOnAdd(cache) {
  cache.sortedEntriesValid = false;
  cache.statistics = null;
  // Don't clear search caches - new entry won't affect existing searches much
  // Category/tag caches need refresh since new entry may belong to them
  cache.categoryResults.clear();
  cache.tagResults.clear();
}

/**
 * Invalidate only caches affected by removing entries
 * @param {Object} cache - Cache store object
 * @param {Object} state - State object with _statsNeedFullRecalc flag
 */
function invalidateCachesOnRemove(cache, state) {
  invalidateCaches(cache, state); // Full invalidation needed on removal
}

/**
 * LRU cache helper - evict oldest entries when size exceeded
 * @param {Map} cacheMap - Map to maintain
 * @param {number} maxSize - Maximum cache size
 */
function maintainCacheSize(cacheMap, maxSize) {
  if (cacheMap.size > maxSize) {
    // Remove oldest entries (first inserted)
    const keysToRemove = Array.from(cacheMap.keys()).slice(
      0,
      cacheMap.size - maxSize,
    );
    keysToRemove.forEach((key) => cacheMap.delete(key));
  }
}

/**
 * Generate cache key for search queries
 * @param {string} query - Search query
 * @param {Object} options - Search options
 * @returns {string} Cache key
 */
function getSearchCacheKey(query, options) {
  return `${query}:${options.limit || 100}:${options.offset || 0}`;
}

/**
 * Update incremental stats when a new entry is added
 * @param {Object} cache - Cache store object
 * @param {Object} entry - Analysis entry
 */
function updateIncrementalStatsOnAdd(cache, entry) {
  if (!cache.incrementalStats.initialized) {
    return; // Will be calculated on next getStatistics call
  }

  cache.incrementalStats.totalConfidence += entry.analysis.confidence || 0;
  cache.incrementalStats.totalProcessingTime +=
    entry.processing.processingTimeMs || 0;
  cache.incrementalStats.entryCount++;
}

/**
 * Update incremental stats when an entry is removed
 * @param {Object} cache - Cache store object
 * @param {Object} entry - Analysis entry
 */
function updateIncrementalStatsOnRemove(cache, entry) {
  if (!cache.incrementalStats.initialized) {
    return;
  }

  cache.incrementalStats.totalConfidence -= entry.analysis.confidence || 0;
  cache.incrementalStats.totalProcessingTime -=
    entry.processing.processingTimeMs || 0;
  cache.incrementalStats.entryCount--;

  // Ensure we don't go negative due to floating point errors
  if (cache.incrementalStats.entryCount < 0) {
    cache.incrementalStats.entryCount = 0;
  }
}

/**
 * Recalculate incremental stats from scratch
 * Called on initialization or when data is loaded from disk
 * @param {Object} cache - Cache store object
 * @param {Object} analysisHistory - Analysis history data
 * @param {Object} state - State object with _statsNeedFullRecalc flag
 */
function recalculateIncrementalStats(cache, analysisHistory, state) {
  const entries = Object.values(analysisHistory.entries);

  let totalConfidence = 0;
  let totalProcessingTime = 0;

  for (const entry of entries) {
    totalConfidence += entry.analysis.confidence || 0;
    totalProcessingTime += entry.processing.processingTimeMs || 0;
  }

  cache.incrementalStats = {
    totalConfidence,
    totalProcessingTime,
    entryCount: entries.length,
    initialized: true,
  };

  state._statsNeedFullRecalc = false;
}

/**
 * Clear all caches - useful for debugging or forcing fresh data
 * @param {Object} cache - Cache store object
 * @param {Object} state - State object with _statsNeedFullRecalc flag
 */
function clearCaches(cache, state) {
  invalidateCaches(cache, state);
  logger.debug('[AnalysisHistoryService] Caches cleared');
}

/**
 * Prefetch/warm cache for expected queries
 * @param {Object} cache - Cache store object
 * @param {Function} getRecentAnalysis - Function to get recent analysis
 * @param {Object} analysisHistory - Analysis history data
 * @param {Object} state - State object
 */
async function warmCache(cache, getRecentAnalysis, analysisHistory, state) {
  // Warm the sorted entries cache
  await getRecentAnalysis(50);

  // Warm incremental stats
  if (!cache.incrementalStats.initialized) {
    recalculateIncrementalStats(cache, analysisHistory, state);
  }

  logger.debug('[AnalysisHistoryService] Cache warmed');
}

module.exports = {
  createCacheStore,
  getCacheTTLs,
  invalidateCaches,
  invalidateCachesOnAdd,
  invalidateCachesOnRemove,
  maintainCacheSize,
  getSearchCacheKey,
  updateIncrementalStatsOnAdd,
  updateIncrementalStatsOnRemove,
  recalculateIncrementalStats,
  clearCaches,
  warmCache,
};
