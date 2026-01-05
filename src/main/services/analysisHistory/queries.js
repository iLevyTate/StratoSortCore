/**
 * Queries
 *
 * Query methods for analysis history.
 * Includes pagination, sorting, and caching support.
 *
 * @module analysisHistory/queries
 */

const path = require('path');
const { maintainCacheSize } = require('./cacheManager');

// Normalize a file path for lookups (normalize separators, lower-case on Windows)
function normalizePathForLookup(filePath) {
  if (!filePath) return filePath;
  const normalized = path.normalize(filePath);
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

/**
 * Sort entries by various fields
 * @param {Array} entries - Entries to sort
 * @param {string} sortBy - Sort field: 'timestamp', 'fileName', 'confidence', 'fileSize'
 * @param {string} sortOrder - Sort order: 'asc' or 'desc'
 * @returns {Array} Sorted entries
 */
function sortEntries(entries, sortBy, sortOrder) {
  const multiplier = sortOrder === 'desc' ? -1 : 1;

  return entries.sort((a, b) => {
    let comparison = 0;
    switch (sortBy) {
      case 'timestamp':
        comparison = new Date(a.timestamp) - new Date(b.timestamp);
        break;
      case 'fileName':
        comparison = a.fileName.localeCompare(b.fileName);
        break;
      case 'confidence':
        comparison = (a.analysis.confidence || 0) - (b.analysis.confidence || 0);
        break;
      case 'fileSize':
        comparison = (a.fileSize || 0) - (b.fileSize || 0);
        break;
      default:
        comparison = new Date(a.timestamp) - new Date(b.timestamp);
    }
    return comparison * multiplier;
  });
}

/**
 * Get analysis by file path
 * @param {Object} analysisHistory - Analysis history data
 * @param {Object} analysisIndex - Analysis index
 * @param {string} filePath - File path to look up
 * @returns {Object|null} Analysis entry or null
 */
function getAnalysisByPath(analysisHistory, analysisIndex, filePath) {
  if (!filePath) return null;

  const normalized = normalizePathForLookup(filePath);

  // Fast paths: exact key, then normalized key (for new indexes)
  let entryId =
    analysisIndex.pathLookup[filePath] ??
    (normalized ? analysisIndex.pathLookup[normalized] : undefined);

  // Backfill for legacy indexes that only stored the original-cased path on Windows
  if (!entryId && normalized && process.platform === 'win32') {
    for (const [storedPath, id] of Object.entries(analysisIndex.pathLookup)) {
      if (normalizePathForLookup(storedPath) === normalized) {
        entryId = id;
        // Cache the normalized key to avoid future scans
        analysisIndex.pathLookup[normalized] = id;
        break;
      }
    }
  }

  return entryId ? analysisHistory.entries[entryId] || null : null;
}

/**
 * Get analysis by file hash (size + mtime + path), used as a fallback when paths change
 * @param {Object} analysisHistory - Analysis history data
 * @param {Object} analysisIndex - Analysis index
 * @param {string} fileHash - Hash key
 * @returns {Object|null} Analysis entry or null
 */
function getAnalysisByHash(analysisHistory, analysisIndex, fileHash) {
  if (!fileHash) return null;
  const entryId = analysisIndex.fileHashes[fileHash];
  return entryId ? analysisHistory.entries[entryId] || null : null;
}

/**
 * Get analysis entries by category with pagination and caching
 * @param {Object} analysisHistory - Analysis history data
 * @param {Object} analysisIndex - Analysis index
 * @param {Object} cache - Cache store
 * @param {number} cacheTTL - Cache TTL in ms
 * @param {string} category - Category to filter by
 * @param {Object} options - Query options
 * @returns {{results: Array, total: number, hasMore: boolean}}
 */
function getAnalysisByCategory(
  analysisHistory,
  analysisIndex,
  cache,
  cacheTTL,
  category,
  options = {}
) {
  const { limit = 100, offset = 0, sortBy = 'timestamp', sortOrder = 'desc' } = options;
  const cacheKey = `${category}:${sortBy}:${sortOrder}`;
  const now = Date.now();

  // Check cache
  if (cache.categoryResults.has(cacheKey)) {
    const cached = cache.categoryResults.get(cacheKey);
    if (now - cached.time < cacheTTL) {
      const paginatedResults = cached.results.slice(offset, offset + limit);
      return {
        results: paginatedResults,
        total: cached.results.length,
        hasMore: offset + limit < cached.results.length
      };
    }
    cache.categoryResults.delete(cacheKey);
  }

  const entryIds = analysisIndex.categoryIndex[category] || [];
  let entries = entryIds.map((id) => analysisHistory.entries[id]).filter(Boolean);

  // Sort entries
  entries = sortEntries(entries, sortBy, sortOrder);

  // Cache sorted results
  cache.categoryResults.set(cacheKey, {
    results: entries,
    time: now
  });
  maintainCacheSize(cache.categoryResults, 20);

  // Return paginated results
  const paginatedResults = entries.slice(offset, offset + limit);
  return {
    results: paginatedResults,
    total: entries.length,
    hasMore: offset + limit < entries.length
  };
}

/**
 * Get analysis entries by tag with pagination and caching
 * @param {Object} analysisHistory - Analysis history data
 * @param {Object} analysisIndex - Analysis index
 * @param {Object} cache - Cache store
 * @param {number} cacheTTL - Cache TTL in ms
 * @param {string} tag - Tag to filter by
 * @param {Object} options - Query options
 * @returns {{results: Array, total: number, hasMore: boolean}}
 */
function getAnalysisByTag(analysisHistory, analysisIndex, cache, cacheTTL, tag, options = {}) {
  const { limit = 100, offset = 0, sortBy = 'timestamp', sortOrder = 'desc' } = options;
  const cacheKey = `${tag}:${sortBy}:${sortOrder}`;
  const now = Date.now();

  // Check cache
  if (cache.tagResults.has(cacheKey)) {
    const cached = cache.tagResults.get(cacheKey);
    if (now - cached.time < cacheTTL) {
      const paginatedResults = cached.results.slice(offset, offset + limit);
      return {
        results: paginatedResults,
        total: cached.results.length,
        hasMore: offset + limit < cached.results.length
      };
    }
    cache.tagResults.delete(cacheKey);
  }

  const entryIds = analysisIndex.tagIndex[tag] || [];
  let entries = entryIds.map((id) => analysisHistory.entries[id]).filter(Boolean);

  // Sort entries
  entries = sortEntries(entries, sortBy, sortOrder);

  // Cache sorted results
  cache.tagResults.set(cacheKey, {
    results: entries,
    time: now
  });
  maintainCacheSize(cache.tagResults, 20);

  // Return paginated results
  const paginatedResults = entries.slice(offset, offset + limit);
  return {
    results: paginatedResults,
    total: entries.length,
    hasMore: offset + limit < entries.length
  };
}

/**
 * Get recent analysis entries with caching and pagination
 * Performance: Uses cached sorted array to avoid O(n log n) on every call
 * @param {Object} analysisHistory - Analysis history data
 * @param {Object} cache - Cache store
 * @param {number} cacheTTL - Cache TTL in ms
 * @param {number} limit - Maximum entries to return (default: 50)
 * @param {number} offset - Offset for pagination (default: 0)
 * @returns {{results: Array, total: number, hasMore: boolean}}
 */
function getRecentAnalysis(analysisHistory, cache, cacheTTL, limit = 50, offset = 0) {
  const now = Date.now();

  // Check if sorted cache is valid
  if (cache.sortedEntriesValid && cache.sortedEntries && now - cache.sortedEntriesTime < cacheTTL) {
    const results = cache.sortedEntries.slice(offset, offset + limit);
    return {
      results,
      total: cache.sortedEntries.length,
      hasMore: offset + limit < cache.sortedEntries.length
    };
  }

  // Rebuild sorted cache
  const entries = Object.values(analysisHistory.entries);

  // Sort by timestamp descending (most recent first)
  cache.sortedEntries = entries.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  cache.sortedEntriesValid = true;
  cache.sortedEntriesTime = now;

  const results = cache.sortedEntries.slice(offset, offset + limit);
  return {
    results,
    total: cache.sortedEntries.length,
    hasMore: offset + limit < cache.sortedEntries.length
  };
}

/**
 * Get analysis entries by date range using the date index
 * Performance: Uses date index for O(1) month lookups instead of full scan
 * @param {Object} analysisHistory - Analysis history data
 * @param {Object} analysisIndex - Analysis index
 * @param {Date|string} startDate - Start of date range
 * @param {Date|string} endDate - End of date range
 * @param {Object} options - Query options (limit, offset, sortBy, sortOrder)
 * @returns {{results: Array, total: number, hasMore: boolean}}
 */
function getAnalysisByDateRange(analysisHistory, analysisIndex, startDate, endDate, options = {}) {
  const { limit = 100, offset = 0, sortBy = 'timestamp', sortOrder = 'desc' } = options;
  const start = new Date(startDate);
  const end = new Date(endDate);

  // Get all month keys in range
  const monthKeys = [];
  const current = new Date(start);
  current.setDate(1); // Start of month

  while (current <= end) {
    const key = current.toISOString().substring(0, 7); // YYYY-MM
    if (analysisIndex.dateIndex[key]) {
      monthKeys.push(key);
    }
    current.setMonth(current.getMonth() + 1);
  }

  // Collect entry IDs from relevant months
  const entryIds = new Set();
  for (const key of monthKeys) {
    for (const id of analysisIndex.dateIndex[key]) {
      entryIds.add(id);
    }
  }

  // Filter to exact date range and resolve entries
  let entries = [];
  for (const id of entryIds) {
    const entry = analysisHistory.entries[id];
    if (entry) {
      const entryDate = new Date(entry.timestamp);
      if (entryDate >= start && entryDate <= end) {
        entries.push(entry);
      }
    }
  }

  // Sort entries
  entries = sortEntries(entries, sortBy, sortOrder);

  // Return paginated results
  const paginatedResults = entries.slice(offset, offset + limit);
  return {
    results: paginatedResults,
    total: entries.length,
    hasMore: offset + limit < entries.length
  };
}

/**
 * Get all available categories with counts
 * Performance: Uses index directly, no iteration over entries
 * @param {Object} analysisIndex - Analysis index
 * @returns {Array} Categories with counts
 */
function getCategories(analysisIndex) {
  return Object.entries(analysisIndex.categoryIndex)
    .map(([name, ids]) => ({ name, count: ids.length }))
    .sort((a, b) => b.count - a.count);
}

/**
 * Get all available tags with counts
 * Performance: Uses index directly, no iteration over entries
 * @param {Object} analysisIndex - Analysis index
 * @returns {Array} Tags with counts
 */
function getTags(analysisIndex) {
  return Object.entries(analysisIndex.tagIndex)
    .map(([name, ids]) => ({ name, count: ids.length }))
    .sort((a, b) => b.count - a.count);
}

module.exports = {
  sortEntries,
  getAnalysisByPath,
  getAnalysisByHash,
  getAnalysisByCategory,
  getAnalysisByTag,
  getRecentAnalysis,
  getAnalysisByDateRange,
  getCategories,
  getTags
};
