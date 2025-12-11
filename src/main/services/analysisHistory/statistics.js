/**
 * Statistics
 *
 * Statistics calculation for analysis history.
 * Includes incremental updates and caching.
 *
 * @module analysisHistory/statistics
 */

const { recalculateIncrementalStats } = require('./cacheManager');

/**
 * Get oldest timestamp efficiently
 * @param {Object} cache - Cache store
 * @param {Array} entries - Analysis entries
 * @returns {string|null} Oldest timestamp or null
 */
function getOldestTimestamp(cache, entries) {
  // If sorted cache exists, use it (last item is oldest)
  if (cache.sortedEntriesValid && cache.sortedEntries?.length) {
    return cache.sortedEntries[cache.sortedEntries.length - 1].timestamp;
  }

  // Otherwise find it
  if (!entries || entries.length === 0) {
    return null;
  }
  let oldest = entries[0];
  for (let i = 1; i < entries.length; i++) {
    if (new Date(entries[i].timestamp) < new Date(oldest.timestamp)) {
      oldest = entries[i];
    }
  }
  return oldest.timestamp;
}

/**
 * Get newest timestamp efficiently
 * @param {Object} cache - Cache store
 * @param {Array} entries - Analysis entries
 * @returns {string|null} Newest timestamp or null
 */
function getNewestTimestamp(cache, entries) {
  // If sorted cache exists, use it (first item is newest)
  if (cache.sortedEntriesValid && cache.sortedEntries?.length) {
    return cache.sortedEntries[0].timestamp;
  }

  // Otherwise find it
  if (!entries || entries.length === 0) {
    return null;
  }
  let newest = entries[0];
  for (let i = 1; i < entries.length; i++) {
    if (new Date(entries[i].timestamp) > new Date(newest.timestamp)) {
      newest = entries[i];
    }
  }
  return newest.timestamp;
}

/**
 * Get top N items from an index by count
 * @param {Object} index - Index object with arrays as values
 * @param {number} limit - Maximum items to return
 * @returns {Array} Top items with name and count
 */
function getTopItems(index, limit) {
  return Object.entries(index)
    .map(([name, ids]) => ({ name, count: ids.length }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

/**
 * Get size distribution from index
 * @param {Object} sizeIndex - Size index
 * @returns {Object} Size distribution
 */
function getSizeDistribution(sizeIndex) {
  const distribution = {};
  for (const [range, ids] of Object.entries(sizeIndex)) {
    distribution[range] = ids.length;
  }
  return distribution;
}

/**
 * Get statistics with incremental updates and caching
 * Performance optimizations:
 * - Uses pre-computed incremental stats when available
 * - Longer cache TTL since stats don't need real-time accuracy
 * - Avoids full iteration when possible
 *
 * @param {Object} analysisHistory - Analysis history data
 * @param {Object} analysisIndex - Analysis index
 * @param {Object} cache - Cache store
 * @param {Object} state - State object with _statsNeedFullRecalc flag
 * @param {number} statsCacheTTL - Stats cache TTL in ms
 * @returns {Object} Statistics object
 */
function getStatistics(analysisHistory, analysisIndex, cache, state, statsCacheTTL) {
  const now = Date.now();

  // Check if cache is valid (use longer TTL for stats)
  if (cache.statistics && now - cache.statisticsTime < statsCacheTTL) {
    return cache.statistics;
  }

  // Initialize incremental stats if needed
  if (!cache.incrementalStats.initialized || state._statsNeedFullRecalc) {
    recalculateIncrementalStats(cache, analysisHistory, state);
  }

  const entries = Object.values(analysisHistory.entries);
  const categories = Object.keys(analysisIndex.categoryIndex);
  const tags = Object.keys(analysisIndex.tagIndex);

  const entryCount = cache.incrementalStats.entryCount;
  const hasEntries = entryCount > 0;

  // Use incremental stats for averages
  const statistics = {
    totalFiles: entryCount,
    totalSize: analysisHistory.totalSize,
    categoriesCount: categories.length,
    tagsCount: tags.length,
    // Use pre-computed totals for averages
    averageConfidence: hasEntries ? cache.incrementalStats.totalConfidence / entryCount : 0,
    averageProcessingTime: hasEntries ? cache.incrementalStats.totalProcessingTime / entryCount : 0,
    // For min/max timestamps, use sorted cache if available
    oldestAnalysis: hasEntries ? getOldestTimestamp(cache, entries) : null,
    newestAnalysis: hasEntries ? getNewestTimestamp(cache, entries) : null,
    // Category and tag distribution (top 10)
    topCategories: getTopItems(analysisIndex.categoryIndex, 10),
    topTags: getTopItems(analysisIndex.tagIndex, 10),
    // Size distribution
    sizeDistribution: getSizeDistribution(analysisIndex.sizeIndex),
    // Additional metadata
    isEmpty: !hasEntries,
    lastUpdated: analysisHistory.updatedAt
  };

  // Cache the result
  cache.statistics = statistics;
  cache.statisticsTime = now;

  return statistics;
}

/**
 * Get quick summary stats without full calculation
 * Useful for UI that just needs counts
 * @param {Object} analysisHistory - Analysis history data
 * @param {Object} analysisIndex - Analysis index
 * @returns {Object} Quick stats
 */
function getQuickStats(analysisHistory, analysisIndex) {
  return {
    totalFiles: Object.keys(analysisHistory.entries).length,
    totalSize: analysisHistory.totalSize,
    categoriesCount: Object.keys(analysisIndex.categoryIndex).length,
    tagsCount: Object.keys(analysisIndex.tagIndex).length,
    lastUpdated: analysisHistory.updatedAt
  };
}

module.exports = {
  getOldestTimestamp,
  getNewestTimestamp,
  getTopItems,
  getSizeDistribution,
  getStatistics,
  getQuickStats
};
