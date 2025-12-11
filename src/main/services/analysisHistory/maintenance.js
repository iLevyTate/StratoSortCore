/**
 * Maintenance
 *
 * Maintenance operations for analysis history.
 * Handles cleanup, expired entries, and migration.
 *
 * @module analysisHistory/maintenance
 */

const { logger } = require('../../../shared/logger');
const { updateIncrementalStatsOnRemove, invalidateCachesOnRemove } = require('./cacheManager');
const { removeFromIndexes } = require('./indexManager');

logger.setContext('AnalysisHistory-Maintenance');

/**
 * Perform maintenance if needed
 * @param {Object} analysisHistory - Analysis history data
 * @param {Object} analysisIndex - Analysis index
 * @param {Object} cache - Cache store
 * @param {Object} state - State object
 * @param {Object} config - Config object
 * @param {Function} saveHistory - Function to save history
 * @param {Function} saveIndex - Function to save index
 */
async function performMaintenanceIfNeeded(
  analysisHistory,
  analysisIndex,
  cache,
  state,
  config,
  saveHistory,
  saveIndex
) {
  // Cleanup old entries if we exceed the limit
  const entryCount = Object.keys(analysisHistory.entries).length;
  if (entryCount > config.maxHistoryEntries) {
    await cleanupOldEntries(
      analysisHistory,
      analysisIndex,
      cache,
      state,
      config,
      saveHistory,
      saveIndex
    );
  }

  // Remove entries older than retention period
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - config.retentionDays);
  await removeExpiredEntries(
    analysisHistory,
    analysisIndex,
    cache,
    state,
    cutoffDate,
    saveHistory,
    saveIndex
  );
}

/**
 * Cleanup old entries beyond max limit
 * @param {Object} analysisHistory - Analysis history data
 * @param {Object} analysisIndex - Analysis index
 * @param {Object} cache - Cache store
 * @param {Object} state - State object
 * @param {Object} config - Config object
 * @param {Function} saveHistory - Function to save history
 * @param {Function} saveIndex - Function to save index
 */
async function cleanupOldEntries(
  analysisHistory,
  analysisIndex,
  cache,
  state,
  config,
  saveHistory,
  saveIndex
) {
  const entries = Object.entries(analysisHistory.entries);
  const sortedEntries = entries.sort((a, b) => new Date(a[1].timestamp) - new Date(b[1].timestamp));

  const toRemove = sortedEntries.slice(0, entries.length - config.maxHistoryEntries);

  for (const [id, entry] of toRemove) {
    delete analysisHistory.entries[id];
    // Update incremental stats before removing from indexes
    updateIncrementalStatsOnRemove(cache, entry);
    removeFromIndexes(analysisIndex, entry);
  }

  // Invalidate caches after bulk removal
  if (toRemove.length > 0) {
    invalidateCachesOnRemove(cache, state);
  }

  analysisHistory.metadata.lastCleanup = new Date().toISOString();
  await saveHistory();
  await saveIndex();
}

/**
 * Remove entries older than cutoff date
 * @param {Object} analysisHistory - Analysis history data
 * @param {Object} analysisIndex - Analysis index
 * @param {Object} cache - Cache store
 * @param {Object} state - State object
 * @param {Date} cutoffDate - Cutoff date
 * @param {Function} saveHistory - Function to save history
 * @param {Function} saveIndex - Function to save index
 */
async function removeExpiredEntries(
  analysisHistory,
  analysisIndex,
  cache,
  state,
  cutoffDate,
  saveHistory,
  saveIndex
) {
  const entries = Object.entries(analysisHistory.entries);
  let removedCount = 0;

  for (const [id, entry] of entries) {
    if (new Date(entry.timestamp) < cutoffDate) {
      delete analysisHistory.entries[id];
      // Update incremental stats before removing from indexes
      updateIncrementalStatsOnRemove(cache, entry);
      removeFromIndexes(analysisIndex, entry);
      removedCount++;
    }
  }

  if (removedCount > 0) {
    // Invalidate caches after bulk removal
    invalidateCachesOnRemove(cache, state);
    logger.info(`[AnalysisHistoryService] Removed ${removedCount} expired analysis entries`);
    await saveHistory();
    await saveIndex();
  }
}

/**
 * Migrate history to new schema version (placeholder for future)
 * @param {Object} history - History object
 */
// eslint-disable-next-line no-unused-vars
async function migrateHistory(history) {
  // Future migration logic for schema changes
  logger.debug('[AnalysisHistoryService] Schema migration not yet implemented');
}

module.exports = {
  performMaintenanceIfNeeded,
  cleanupOldEntries,
  removeExpiredEntries,
  migrateHistory
};
