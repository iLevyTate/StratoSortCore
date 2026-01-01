/**
 * Tests for Analysis History Maintenance
 * Tests cleanup, expired entries, and migration
 */

// Mock dependencies
jest.mock('../src/shared/logger', () => ({
  logger: {
    setContext: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  }
}));

jest.mock('../src/main/services/analysisHistory/cacheManager', () => ({
  updateIncrementalStatsOnRemove: jest.fn(),
  invalidateCachesOnRemove: jest.fn()
}));

jest.mock('../src/main/services/analysisHistory/indexManager', () => ({
  removeFromIndexes: jest.fn()
}));

describe('maintenance', () => {
  let maintenance;
  let cacheManager;
  let indexManager;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();

    cacheManager = require('../src/main/services/analysisHistory/cacheManager');
    indexManager = require('../src/main/services/analysisHistory/indexManager');
    maintenance = require('../src/main/services/analysisHistory/maintenance');
  });

  describe('performMaintenanceIfNeeded', () => {
    test('calls cleanup when entry count exceeds limit', async () => {
      const history = {
        entries: {
          1: { id: '1', timestamp: '2024-01-10' },
          2: { id: '2', timestamp: '2024-01-15' },
          3: { id: '3', timestamp: '2024-01-20' }
        },
        metadata: {}
      };
      const index = {};
      const cache = {};
      const state = {};
      const config = {
        maxHistoryEntries: 2,
        retentionDays: 365
      };
      const saveHistory = jest.fn().mockResolvedValue();
      const saveIndex = jest.fn().mockResolvedValue();

      await maintenance.performMaintenanceIfNeeded(
        history,
        index,
        cache,
        state,
        config,
        saveHistory,
        saveIndex
      );

      // Cleanup was called
      expect(saveHistory).toHaveBeenCalled();
    });

    test('does not call cleanup when under limit', async () => {
      const recentDate = new Date().toISOString();
      const history = {
        entries: {
          1: { timestamp: recentDate },
          2: { timestamp: recentDate }
        },
        metadata: {}
      };
      const config = {
        maxHistoryEntries: 100,
        retentionDays: 365
      };
      const saveHistory = jest.fn();
      const saveIndex = jest.fn();

      await maintenance.performMaintenanceIfNeeded(
        history,
        {},
        {},
        {},
        config,
        saveHistory,
        saveIndex
      );

      // No cleanup needed for recent entries under limit
      expect(Object.keys(history.entries).length).toBe(2);
    });
  });

  describe('cleanupOldEntries', () => {
    test('removes oldest entries to meet limit', async () => {
      const history = {
        entries: {
          1: { id: '1', timestamp: '2024-01-10' },
          2: { id: '2', timestamp: '2024-01-15' },
          3: { id: '3', timestamp: '2024-01-20' },
          4: { id: '4', timestamp: '2024-01-25' }
        },
        metadata: {}
      };
      const index = {};
      const cache = {};
      const state = {};
      const config = { maxHistoryEntries: 2 };
      const saveHistory = jest.fn().mockResolvedValue();
      const saveIndex = jest.fn().mockResolvedValue();

      await maintenance.cleanupOldEntries(
        history,
        index,
        cache,
        state,
        config,
        saveHistory,
        saveIndex
      );

      expect(Object.keys(history.entries).length).toBe(2);
      expect(history.entries['1']).toBeUndefined();
      expect(history.entries['2']).toBeUndefined();
      expect(history.entries['3']).toBeDefined();
      expect(history.entries['4']).toBeDefined();
    });

    test('updates incremental stats for removed entries', async () => {
      const history = {
        entries: {
          1: { id: '1', timestamp: '2024-01-10' },
          2: { id: '2', timestamp: '2024-01-20' }
        },
        metadata: {}
      };
      const cache = {};
      const config = { maxHistoryEntries: 1 };

      await maintenance.cleanupOldEntries(history, {}, cache, {}, config, jest.fn(), jest.fn());

      expect(cacheManager.updateIncrementalStatsOnRemove).toHaveBeenCalled();
    });

    test('removes from indexes', async () => {
      const history = {
        entries: {
          1: { id: '1', timestamp: '2024-01-10' },
          2: { id: '2', timestamp: '2024-01-20' }
        },
        metadata: {}
      };
      const index = {};
      const config = { maxHistoryEntries: 1 };

      await maintenance.cleanupOldEntries(history, index, {}, {}, config, jest.fn(), jest.fn());

      expect(indexManager.removeFromIndexes).toHaveBeenCalled();
    });

    test('invalidates caches after removal', async () => {
      const history = {
        entries: {
          1: { id: '1', timestamp: '2024-01-10' },
          2: { id: '2', timestamp: '2024-01-20' }
        },
        metadata: {}
      };
      const cache = {};
      const state = {};
      const config = { maxHistoryEntries: 1 };

      await maintenance.cleanupOldEntries(history, {}, cache, state, config, jest.fn(), jest.fn());

      expect(cacheManager.invalidateCachesOnRemove).toHaveBeenCalledWith(cache, state);
    });

    test('updates last cleanup timestamp', async () => {
      const history = {
        entries: {
          1: { id: '1', timestamp: '2024-01-10' },
          2: { id: '2', timestamp: '2024-01-20' }
        },
        metadata: {}
      };
      const config = { maxHistoryEntries: 1 };

      await maintenance.cleanupOldEntries(history, {}, {}, {}, config, jest.fn(), jest.fn());

      expect(history.metadata.lastCleanup).toBeDefined();
    });

    test('saves history and index after cleanup', async () => {
      const history = {
        entries: {
          1: { id: '1', timestamp: '2024-01-10' },
          2: { id: '2', timestamp: '2024-01-20' }
        },
        metadata: {}
      };
      const saveHistory = jest.fn().mockResolvedValue();
      const saveIndex = jest.fn().mockResolvedValue();
      const config = { maxHistoryEntries: 1 };

      await maintenance.cleanupOldEntries(history, {}, {}, {}, config, saveHistory, saveIndex);

      expect(saveHistory).toHaveBeenCalled();
      expect(saveIndex).toHaveBeenCalled();
    });
  });

  describe('removeExpiredEntries', () => {
    test('removes entries older than cutoff date', async () => {
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 100);

      const history = {
        entries: {
          1: { id: '1', timestamp: oldDate.toISOString() },
          2: { id: '2', timestamp: new Date().toISOString() }
        }
      };
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - 30);

      const saveHistory = jest.fn().mockResolvedValue();
      const saveIndex = jest.fn().mockResolvedValue();

      await maintenance.removeExpiredEntries(
        history,
        {},
        {},
        {},
        cutoffDate,
        saveHistory,
        saveIndex
      );

      expect(Object.keys(history.entries).length).toBe(1);
      expect(history.entries['1']).toBeUndefined();
      expect(history.entries['2']).toBeDefined();
    });

    test('does nothing if no expired entries', async () => {
      const history = {
        entries: {
          1: { id: '1', timestamp: new Date().toISOString() },
          2: { id: '2', timestamp: new Date().toISOString() }
        }
      };
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - 30);

      const saveHistory = jest.fn();
      const saveIndex = jest.fn();

      await maintenance.removeExpiredEntries(
        history,
        {},
        {},
        {},
        cutoffDate,
        saveHistory,
        saveIndex
      );

      expect(saveHistory).not.toHaveBeenCalled();
      expect(saveIndex).not.toHaveBeenCalled();
    });

    test('updates incremental stats for removed entries', async () => {
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 100);

      const history = {
        entries: {
          1: { id: '1', timestamp: oldDate.toISOString() }
        }
      };
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - 30);

      await maintenance.removeExpiredEntries(history, {}, {}, {}, cutoffDate, jest.fn(), jest.fn());

      expect(cacheManager.updateIncrementalStatsOnRemove).toHaveBeenCalled();
    });

    test('invalidates caches after removal', async () => {
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 100);

      const history = {
        entries: {
          1: { id: '1', timestamp: oldDate.toISOString() }
        }
      };
      const cache = {};
      const state = {};
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - 30);

      await maintenance.removeExpiredEntries(
        history,
        {},
        cache,
        state,
        cutoffDate,
        jest.fn(),
        jest.fn()
      );

      expect(cacheManager.invalidateCachesOnRemove).toHaveBeenCalledWith(cache, state);
    });

    test('logs removal count', async () => {
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 100);

      const history = {
        entries: {
          1: { id: '1', timestamp: oldDate.toISOString() },
          2: { id: '2', timestamp: oldDate.toISOString() }
        }
      };
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - 30);

      const { logger } = require('../src/shared/logger');

      await maintenance.removeExpiredEntries(history, {}, {}, {}, cutoffDate, jest.fn(), jest.fn());

      expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('Removed 2 expired'));
    });
  });

  describe('migrateHistory', () => {
    test('logs debug message when history is at current schema version', async () => {
      const { logger } = require('../src/shared/logger');

      // History at current version should log "already at current schema version"
      await maintenance.migrateHistory({ schemaVersion: maintenance.CURRENT_SCHEMA_VERSION });

      expect(logger.debug).toHaveBeenCalledWith(
        expect.stringContaining('already at current schema version')
      );
    });
  });
});
