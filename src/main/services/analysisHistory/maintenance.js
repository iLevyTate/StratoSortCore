/**
 * Maintenance
 *
 * Maintenance operations for analysis history.
 * Handles cleanup, expired entries, and migration.
 *
 * FIX: Now includes cascade marking for orphaned embeddings when entries are pruned
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
 * @param {Object} [options] - Optional parameters
 * @param {Function} [options.onEntriesRemoved] - Callback when entries are removed, receives array of {id, fileHash, originalPath, actualPath?}
 */
async function performMaintenanceIfNeeded(
  analysisHistory,
  analysisIndex,
  cache,
  state,
  config,
  saveHistory,
  saveIndex,
  options = {}
) {
  const { onEntriesRemoved } = options;
  const allRemovedEntries = [];

  // Cleanup old entries if we exceed the limit
  const entryCount = Object.keys(analysisHistory.entries).length;
  if (entryCount > config.maxHistoryEntries) {
    const removed = await cleanupOldEntries(
      analysisHistory,
      analysisIndex,
      cache,
      state,
      config,
      saveHistory,
      saveIndex
    );
    if (removed && removed.length > 0) {
      allRemovedEntries.push(...removed);
    }
  }

  // Remove entries older than retention period
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - config.retentionDays);
  const expired = await removeExpiredEntries(
    analysisHistory,
    analysisIndex,
    cache,
    state,
    cutoffDate,
    saveHistory,
    saveIndex
  );
  if (expired && expired.length > 0) {
    allRemovedEntries.push(...expired);
  }

  // FIX: Notify caller about removed entries so embeddings can be marked orphaned
  if (onEntriesRemoved && allRemovedEntries.length > 0) {
    try {
      await onEntriesRemoved(allRemovedEntries);
    } catch (error) {
      logger.warn('[AnalysisHistory-Maintenance] onEntriesRemoved callback failed', {
        error: error.message,
        count: allRemovedEntries.length
      });
    }
  }

  return allRemovedEntries;
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
 * @returns {Promise<Array<{id: string, fileHash: string, originalPath: string}>>} Removed entries
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
  const removedEntries = [];

  for (const [id, entry] of toRemove) {
    // FIX: Capture entry info before deletion for cascade orphan marking
    removedEntries.push({
      id,
      fileHash: entry.fileHash,
      originalPath: entry.originalPath,
      actualPath: entry.organization?.actual || null
    });

    delete analysisHistory.entries[id];
    // Update incremental stats before removing from indexes
    updateIncrementalStatsOnRemove(cache, entry);
    removeFromIndexes(analysisIndex, entry);
  }

  // Invalidate caches after bulk removal
  if (toRemove.length > 0) {
    invalidateCachesOnRemove(cache, state);
    logger.info('[AnalysisHistory-Maintenance] Cleaned up old entries', {
      removedCount: toRemove.length
    });
  }

  analysisHistory.metadata.lastCleanup = new Date().toISOString();
  await saveHistory();
  await saveIndex();

  return removedEntries;
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
 * @returns {Promise<Array<{id: string, fileHash: string, originalPath: string}>>} Removed entries
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
  const removedEntries = [];

  for (const [id, entry] of entries) {
    if (new Date(entry.timestamp) < cutoffDate) {
      // FIX: Capture entry info before deletion for cascade orphan marking
      removedEntries.push({
        id,
        fileHash: entry.fileHash,
        originalPath: entry.originalPath,
        actualPath: entry.organization?.actual || null
      });

      delete analysisHistory.entries[id];
      // Update incremental stats before removing from indexes
      updateIncrementalStatsOnRemove(cache, entry);
      removeFromIndexes(analysisIndex, entry);
    }
  }

  if (removedEntries.length > 0) {
    // Invalidate caches after bulk removal
    invalidateCachesOnRemove(cache, state);
    logger.info(
      `[AnalysisHistoryService] Removed ${removedEntries.length} expired analysis entries`
    );
    await saveHistory();
    await saveIndex();
  }

  return removedEntries;
}

/**
 * Current schema version - increment when making breaking changes
 */
const CURRENT_SCHEMA_VERSION = '1.0.0';

/**
 * Migration functions for each schema version upgrade
 * Key: target version, Value: function to migrate from previous version
 */
const MIGRATIONS = {
  // Example migration for future use:
  // '1.1.0': (history) => {
  //   // Add new field to all entries
  //   for (const entry of Object.values(history.entries || {})) {
  //     entry.newField = entry.newField ?? 'default';
  //   }
  //   return history;
  // }
};

/**
 * Compare semver versions
 * @param {string} v1 - First version
 * @param {string} v2 - Second version
 * @returns {number} -1 if v1 < v2, 0 if equal, 1 if v1 > v2
 */
function compareVersions(v1, v2) {
  const parts1 = v1.split('.').map(Number);
  const parts2 = v2.split('.').map(Number);

  for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
    const p1 = parts1[i] || 0;
    const p2 = parts2[i] || 0;
    if (p1 < p2) return -1;
    if (p1 > p2) return 1;
  }
  return 0;
}

/**
 * Migrate history to current schema version
 * Applies migrations sequentially from the history's version to the current version
 * @param {Object} history - History object to migrate
 * @returns {Object} Migrated history object
 */
async function migrateHistory(history) {
  const historyVersion = history.schemaVersion || '1.0.0';

  if (compareVersions(historyVersion, CURRENT_SCHEMA_VERSION) >= 0) {
    logger.debug('[AnalysisHistoryService] History already at current schema version');
    return history;
  }

  logger.info(
    `[AnalysisHistoryService] Migrating history from v${historyVersion} to v${CURRENT_SCHEMA_VERSION}`
  );

  // Get ordered list of versions to migrate through
  const migrationVersions = Object.keys(MIGRATIONS)
    .filter((v) => compareVersions(v, historyVersion) > 0)
    .filter((v) => compareVersions(v, CURRENT_SCHEMA_VERSION) <= 0)
    .sort(compareVersions);

  let migratedHistory = { ...history };

  for (const targetVersion of migrationVersions) {
    try {
      logger.debug(`[AnalysisHistoryService] Applying migration to v${targetVersion}`);
      migratedHistory = await MIGRATIONS[targetVersion](migratedHistory);
      migratedHistory.schemaVersion = targetVersion;
    } catch (error) {
      logger.error(`[AnalysisHistoryService] Migration to v${targetVersion} failed:`, error);
      throw new Error(`Schema migration failed at version ${targetVersion}: ${error.message}`);
    }
  }

  // Update to current version even if no migrations were needed
  migratedHistory.schemaVersion = CURRENT_SCHEMA_VERSION;
  migratedHistory.metadata = migratedHistory.metadata || {};
  migratedHistory.metadata.lastMigration = new Date().toISOString();
  migratedHistory.metadata.migratedFrom = historyVersion;

  logger.info('[AnalysisHistoryService] Schema migration completed successfully');
  return migratedHistory;
}

module.exports = {
  performMaintenanceIfNeeded,
  cleanupOldEntries,
  removeExpiredEntries,
  migrateHistory,
  // Export for testing and external use
  CURRENT_SCHEMA_VERSION,
  compareVersions
};
