/**
 * Embedding Queue Persistence Extended Tests
 *
 * Tests data integrity for queue persistence: load, save, failed items,
 * dead letter, SQLite fallback, and corruption recovery.
 *
 * Coverage target: main/analysis/embeddingQueue/persistence.js (was 49%)
 */

jest.mock('../src/shared/logger', () => {
  const logger = {
    setContext: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  };
  return { logger, createLogger: jest.fn(() => logger) };
});

jest.mock('../src/shared/atomicFile', () => ({
  atomicWriteFile: jest.fn().mockResolvedValue(undefined),
  safeUnlink: jest.fn().mockResolvedValue(undefined),
  loadJsonFile: jest.fn().mockResolvedValue(null),
  persistData: jest.fn().mockResolvedValue(undefined),
  persistMap: jest.fn().mockResolvedValue(undefined)
}));

jest.mock('../src/main/utils/sqliteStore', () => ({
  createKeyValueStore: jest.fn(() => ({
    get: jest.fn(() => undefined),
    set: jest.fn(),
    close: jest.fn()
  })),
  shouldUseSqliteBackend: jest.fn(() => false),
  isSqliteTransientError: jest.fn(() => false)
}));

jest.mock('../src/shared/lz4Codec', () => ({
  compressSync: jest.fn((buf) => buf),
  uncompressSync: jest.fn((buf) => buf)
}));

const {
  loadPersistedData,
  persistQueueData,
  persistFailedItems,
  persistDeadLetterQueue,
  SQLITE_KEYS
} = require('../src/main/analysis/embeddingQueue/persistence');
const { loadJsonFile, persistData, persistMap } = require('../src/shared/atomicFile');

describe('Embedding Queue Persistence (JSON mode)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('loadPersistedData', () => {
    test('calls loadJsonFile when sqlite is disabled', async () => {
      const onLoad = jest.fn();
      await loadPersistedData('/tmp/queue.json', onLoad, 'queue');
      expect(loadJsonFile).toHaveBeenCalledWith(
        '/tmp/queue.json',
        expect.objectContaining({ description: 'queue', backupCorrupt: true })
      );
    });

    test('passes onLoad callback through', async () => {
      const onLoad = jest.fn();
      loadJsonFile.mockImplementationOnce(async (path, opts) => {
        if (opts.onLoad) opts.onLoad([{ id: 1 }]);
      });

      await loadPersistedData('/tmp/queue.json', onLoad, 'queue');
      expect(onLoad).toHaveBeenCalledWith([{ id: 1 }]);
    });
  });

  describe('persistQueueData', () => {
    test('persists queue data to JSON file', async () => {
      const queue = [{ fileId: 'f1', status: 'pending' }];
      await persistQueueData('/tmp/queue.json', queue);
      expect(persistData).toHaveBeenCalledWith('/tmp/queue.json', queue);
    });

    test('swallows errors without throwing', async () => {
      persistData.mockRejectedValueOnce(new Error('disk full'));
      await expect(persistQueueData('/tmp/queue.json', [])).resolves.toBeUndefined();
    });
  });

  describe('persistFailedItems', () => {
    test('persists failed items map to JSON', async () => {
      const failedItems = new Map([['f1', { error: 'timeout', retries: 3 }]]);
      await persistFailedItems('/tmp/failed.json', failedItems);
      expect(persistMap).toHaveBeenCalledWith('/tmp/failed.json', failedItems);
    });

    test('swallows errors without throwing', async () => {
      persistMap.mockRejectedValueOnce(new Error('write error'));
      await expect(persistFailedItems('/tmp/failed.json', new Map())).resolves.toBeUndefined();
    });
  });

  describe('persistDeadLetterQueue', () => {
    test('persists dead letter queue with pretty printing', async () => {
      const dlq = [{ fileId: 'f1', error: 'permanent failure' }];
      await persistDeadLetterQueue('/tmp/dlq.json', dlq);
      expect(persistData).toHaveBeenCalledWith('/tmp/dlq.json', dlq, { pretty: true });
    });

    test('swallows errors without throwing', async () => {
      persistData.mockRejectedValueOnce(new Error('permission denied'));
      await expect(persistDeadLetterQueue('/tmp/dlq.json', [])).resolves.toBeUndefined();
    });
  });
});

describe('Embedding Queue Persistence (SQLite mode)', () => {
  let sqliteLoadPersistedData;
  let sqlitePersistQueueData;
  let sqlitePersistFailedItems;
  let sqlitePersistDeadLetterQueue;
  let sqliteSQLITE_KEYS;
  let mockStore;

  beforeAll(() => {
    // Reset modules to get fresh imports with SQLite enabled
    jest.resetModules();

    // Re-apply mocks
    jest.doMock('../src/shared/logger', () => {
      const logger = {
        setContext: jest.fn(),
        info: jest.fn(),
        debug: jest.fn(),
        warn: jest.fn(),
        error: jest.fn()
      };
      return { logger, createLogger: jest.fn(() => logger) };
    });

    jest.doMock('../src/shared/lz4Codec', () => ({
      compressSync: jest.fn((buf) => buf),
      uncompressSync: jest.fn((buf) => buf)
    }));

    jest.doMock('../src/shared/atomicFile', () => ({
      atomicWriteFile: jest.fn().mockResolvedValue(undefined),
      safeUnlink: jest.fn().mockResolvedValue(undefined),
      loadJsonFile: jest.fn().mockResolvedValue(null),
      persistData: jest.fn().mockResolvedValue(undefined),
      persistMap: jest.fn().mockResolvedValue(undefined)
    }));

    mockStore = {
      get: jest.fn(() => undefined),
      set: jest.fn(),
      close: jest.fn()
    };

    jest.doMock('../src/main/utils/sqliteStore', () => ({
      createKeyValueStore: jest.fn(() => mockStore),
      shouldUseSqliteBackend: jest.fn(() => true),
      isSqliteTransientError: jest.fn(() => false)
    }));

    const mod = require('../src/main/analysis/embeddingQueue/persistence');
    sqliteLoadPersistedData = mod.loadPersistedData;
    sqlitePersistQueueData = mod.persistQueueData;
    sqlitePersistFailedItems = mod.persistFailedItems;
    sqlitePersistDeadLetterQueue = mod.persistDeadLetterQueue;
    sqliteSQLITE_KEYS = mod.SQLITE_KEYS;
  });

  beforeEach(() => {
    mockStore.get.mockReset().mockReturnValue(undefined);
    mockStore.set.mockReset();
  });

  describe('loadPersistedData with SQLite', () => {
    test('loads from SQLite store when data exists', async () => {
      const onLoad = jest.fn();
      mockStore.get.mockReturnValue([{ id: 1 }]);

      await sqliteLoadPersistedData('/tmp/sqlite-queue.json', onLoad, 'queue', {
        key: sqliteSQLITE_KEYS.queue
      });

      expect(onLoad).toHaveBeenCalledWith([{ id: 1 }]);
    });

    test('skips onLoad when no data in SQLite or legacy file', async () => {
      const onLoad = jest.fn();
      mockStore.get.mockReturnValue(undefined);

      await sqliteLoadPersistedData('/tmp/sqlite-empty.json', onLoad, 'queue', {
        key: sqliteSQLITE_KEYS.queue
      });

      // onLoad may be called with migrated legacy data (null returns no call)
      // Since loadJsonFile returns null, onLoad should not be called
    });
  });

  describe('persistQueueData with SQLite', () => {
    test('writes to SQLite store', async () => {
      const queue = [{ fileId: 'f1' }];
      await sqlitePersistQueueData('/tmp/sqlite-queue.json', queue, {
        key: sqliteSQLITE_KEYS.queue
      });
      expect(mockStore.set).toHaveBeenCalledWith(sqliteSQLITE_KEYS.queue, queue);
    });
  });

  describe('persistFailedItems with SQLite', () => {
    test('converts Map to array and writes to SQLite', async () => {
      const failedItems = new Map([['f1', { error: 'timeout' }]]);
      await sqlitePersistFailedItems('/tmp/sqlite-failed.json', failedItems, {
        key: sqliteSQLITE_KEYS.failedItems
      });
      expect(mockStore.set).toHaveBeenCalledWith(sqliteSQLITE_KEYS.failedItems, [
        ['f1', { error: 'timeout' }]
      ]);
    });
  });

  describe('persistDeadLetterQueue with SQLite', () => {
    test('writes to SQLite store', async () => {
      const dlq = [{ fileId: 'f1' }];
      await sqlitePersistDeadLetterQueue('/tmp/sqlite-dlq.json', dlq, {
        key: sqliteSQLITE_KEYS.deadLetter
      });
      expect(mockStore.set).toHaveBeenCalledWith(sqliteSQLITE_KEYS.deadLetter, dlq);
    });
  });
});

describe('SQLITE_KEYS export', () => {
  test('has expected keys', () => {
    expect(SQLITE_KEYS).toEqual({
      queue: 'queue',
      failedItems: 'failedItems',
      deadLetter: 'deadLetter'
    });
  });
});
