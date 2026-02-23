/**
 * Analysis History Persistence SQLite Tests
 *
 * Tests SQLite backend paths, corruption recovery, migration from
 * legacy JSON, transient error handling, and compression.
 *
 * Coverage target: main/services/analysisHistory/persistence.js (was 37%)
 */

jest.mock('fs', () => ({
  promises: {
    readFile: jest.fn(),
    writeFile: jest.fn(),
    rename: jest.fn(),
    copyFile: jest.fn(),
    unlink: jest.fn(),
    mkdir: jest.fn()
  }
}));

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
  replaceFileWithRetry: jest.fn().mockResolvedValue()
}));

describe('AnalysisHistory Persistence - SQLite paths', () => {
  let persistence;
  let mockStore;
  let fs;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();

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

    jest.doMock('../src/shared/lz4Codec', () => ({
      compressSync: jest.fn((buf) => buf),
      uncompressSync: jest.fn((buf) => buf)
    }));

    fs = require('fs').promises;
    persistence = require('../src/main/services/analysisHistory/persistence');
  });

  describe('loadConfig - SQLite path', () => {
    test('loads existing config from SQLite', async () => {
      mockStore.get.mockReturnValue({ setting: 'value' });

      const config = await persistence.loadConfig('/data/config.json', jest.fn(), jest.fn());

      expect(config).toEqual({ setting: 'value' });
      expect(mockStore.get).toHaveBeenCalledWith('config');
    });

    test('migrates legacy JSON to SQLite when no SQLite data', async () => {
      mockStore.get.mockReturnValue(undefined);
      fs.readFile.mockResolvedValue(JSON.stringify({ migrated: true }));
      fs.rename.mockResolvedValue();

      const config = await persistence.loadConfig(
        '/data/config.json',
        jest.fn(() => ({ default: true })),
        jest.fn()
      );

      expect(config).toEqual({ migrated: true });
      expect(mockStore.set).toHaveBeenCalledWith('config', { migrated: true });
    });

    test('creates default config when no SQLite data and no legacy file', async () => {
      mockStore.get.mockReturnValue(undefined);
      const enoent = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      fs.readFile.mockRejectedValue(enoent);

      const getDefault = jest.fn(() => ({ default: true }));
      const config = await persistence.loadConfig('/data/config.json', getDefault, jest.fn());

      expect(config).toEqual({ default: true });
      expect(mockStore.set).toHaveBeenCalledWith('config', { default: true });
    });

    test('handles SQLite corruption with backup and JSON fallback', async () => {
      const corruptErr = Object.assign(new Error('corrupt'), { code: 'SQLITE_CORRUPT' });
      mockStore.get.mockImplementation(() => {
        throw corruptErr;
      });
      fs.copyFile.mockResolvedValue();
      fs.unlink.mockResolvedValue();
      // JSON fallback
      fs.readFile.mockResolvedValue(JSON.stringify({ fallback: true }));

      const config = await persistence.loadConfig('/data/config.json', jest.fn(), jest.fn());

      expect(config).toEqual({ fallback: true });
    });

    test('rethrows transient SQLite errors', async () => {
      const sqliteStore = require('../src/main/utils/sqliteStore');
      sqliteStore.isSqliteTransientError.mockReturnValue(true);

      const transientErr = Object.assign(new Error('busy'), { code: 'SQLITE_BUSY' });
      mockStore.get.mockImplementation(() => {
        throw transientErr;
      });

      await expect(
        persistence.loadConfig('/data/config.json', jest.fn(), jest.fn())
      ).rejects.toThrow('busy');
    });
  });

  describe('saveConfig - SQLite path', () => {
    test('saves config to SQLite store', async () => {
      await persistence.saveConfig('/data/config.json', { setting: 'value' });

      expect(mockStore.set).toHaveBeenCalledWith(
        'config',
        expect.objectContaining({ setting: 'value', updatedAt: expect.any(String) }),
        expect.any(String)
      );
    });
  });

  describe('loadHistory - SQLite path', () => {
    test('loads existing history from SQLite', async () => {
      mockStore.get.mockReturnValue({ schemaVersion: '2.0', entries: {} });

      const history = await persistence.loadHistory(
        '/data/history.json',
        '2.0',
        jest.fn(),
        jest.fn(),
        jest.fn()
      );

      expect(history.schemaVersion).toBe('2.0');
    });

    test('migrates history with version mismatch', async () => {
      mockStore.get.mockReturnValue({ schemaVersion: '1.0', entries: {} });
      const migrated = { schemaVersion: '2.0', entries: { migrated: true } };
      const migrateHistory = jest.fn().mockResolvedValue(migrated);

      const history = await persistence.loadHistory(
        '/data/history.json',
        '2.0',
        jest.fn(),
        jest.fn(),
        migrateHistory
      );

      expect(migrateHistory).toHaveBeenCalled();
      expect(history.schemaVersion).toBe('2.0');
      expect(mockStore.set).toHaveBeenCalledWith('history', migrated);
    });

    test('creates empty history when nothing in SQLite or JSON', async () => {
      mockStore.get.mockReturnValue(undefined);
      const enoent = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      fs.readFile.mockRejectedValue(enoent);

      const createEmpty = jest.fn(() => ({ schemaVersion: '2.0', entries: {} }));

      const history = await persistence.loadHistory(
        '/data/history.json',
        '2.0',
        createEmpty,
        jest.fn(),
        jest.fn()
      );

      expect(createEmpty).toHaveBeenCalled();
      expect(history.schemaVersion).toBe('2.0');
    });

    test('handles SQLite corruption with JSON fallback', async () => {
      const corruptErr = Object.assign(new Error('not a database'), {
        message: 'file is not a database'
      });
      mockStore.get.mockImplementation(() => {
        throw corruptErr;
      });
      fs.copyFile.mockResolvedValue();
      fs.unlink.mockResolvedValue();
      // JSON fallback
      fs.readFile.mockResolvedValue(
        JSON.stringify({ schemaVersion: '2.0', entries: { recovered: true } })
      );

      const history = await persistence.loadHistory(
        '/data/history.json',
        '2.0',
        jest.fn(),
        jest.fn(),
        jest.fn()
      );

      expect(history.entries.recovered).toBe(true);
    });
  });

  describe('saveHistory - SQLite path', () => {
    test('saves history to SQLite store', async () => {
      await persistence.saveHistory('/data/history.json', { entries: {} });

      expect(mockStore.set).toHaveBeenCalledWith(
        'history',
        expect.objectContaining({ entries: {}, updatedAt: expect.any(String) }),
        expect.any(String)
      );
    });
  });

  describe('loadIndex - SQLite path', () => {
    test('loads existing index from SQLite', async () => {
      mockStore.get.mockReturnValue({ tagIndex: { finance: ['f1'] } });

      const index = await persistence.loadIndex('/data/index.json', jest.fn(), jest.fn());

      expect(index.tagIndex.finance).toEqual(['f1']);
    });

    test('creates empty index when nothing found', async () => {
      mockStore.get.mockReturnValue(undefined);
      const enoent = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      fs.readFile.mockRejectedValue(enoent);

      const createEmpty = jest.fn(() => ({ tagIndex: {} }));

      const index = await persistence.loadIndex('/data/index.json', createEmpty, jest.fn());

      expect(createEmpty).toHaveBeenCalled();
      expect(index.tagIndex).toEqual({});
    });
  });

  describe('saveIndex - SQLite path', () => {
    test('saves index to SQLite store', async () => {
      await persistence.saveIndex('/data/index.json', { tagIndex: {} });

      expect(mockStore.set).toHaveBeenCalledWith(
        'index',
        expect.objectContaining({ tagIndex: {}, updatedAt: expect.any(String) }),
        expect.any(String)
      );
    });
  });

  describe('createDefaultStructures - SQLite path', () => {
    test('creates all default structures in SQLite', async () => {
      const result = await persistence.createDefaultStructures(
        {
          configPath: '/data/config.json',
          historyPath: '/data/history.json',
          indexPath: '/data/index.json'
        },
        () => ({ default: true }),
        () => ({ schemaVersion: '2.0', entries: {} }),
        () => ({ tagIndex: {} })
      );

      expect(result.config.default).toBe(true);
      expect(result.history.schemaVersion).toBe('2.0');
      expect(result.index.tagIndex).toEqual({});
      expect(mockStore.set).toHaveBeenCalledTimes(3);
    });
  });

  describe('closeSqliteStore', () => {
    test('closes store for specific path after loading', async () => {
      mockStore.get.mockReturnValue({ test: true });

      // Force store creation by loading config first
      await persistence.loadConfig(
        '/data/config.json',
        jest.fn(() => ({ default: true })),
        jest.fn()
      );

      persistence.closeSqliteStore('/data/config.json');
      expect(mockStore.close).toHaveBeenCalled();
    });

    test('closes all stores when no path given', async () => {
      mockStore.get.mockReturnValue({ test: true });

      // Force store creation
      await persistence.loadConfig(
        '/data/config.json',
        jest.fn(() => ({ default: true })),
        jest.fn()
      );

      persistence.closeSqliteStore();
      expect(mockStore.close).toHaveBeenCalled();
    });
  });
});

describe('AnalysisHistory Persistence - JSON error paths', () => {
  let persistence;
  let fs;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();

    jest.doMock('../src/main/utils/sqliteStore', () => ({
      createKeyValueStore: jest.fn(),
      shouldUseSqliteBackend: jest.fn(() => false),
      isSqliteTransientError: jest.fn(() => false)
    }));

    jest.doMock('../src/shared/lz4Codec', () => ({
      compressSync: jest.fn((buf) => buf),
      uncompressSync: jest.fn((buf) => buf)
    }));

    fs = require('fs').promises;
    persistence = require('../src/main/services/analysisHistory/persistence');
  });

  describe('loadConfig - JSON error paths', () => {
    test('handles corrupt JSON by backing up and creating default', async () => {
      fs.readFile.mockResolvedValue('not valid json{{{');
      fs.copyFile.mockResolvedValue();
      fs.mkdir.mockResolvedValue();
      fs.writeFile.mockResolvedValue();
      fs.rename.mockResolvedValue();

      const getDefault = jest.fn(() => ({ recovered: true }));
      const saveConfig = jest.fn().mockResolvedValue();

      const config = await persistence.loadConfig('/data/config.json', getDefault, saveConfig);

      expect(config.recovered).toBe(true);
      expect(fs.copyFile).toHaveBeenCalled(); // backup
    });

    test('rethrows transient errors with flag', async () => {
      const busy = Object.assign(new Error('EBUSY'), { code: 'EBUSY' });
      fs.readFile.mockRejectedValue(busy);

      await expect(
        persistence.loadConfig('/data/config.json', jest.fn(), jest.fn())
      ).rejects.toMatchObject({ transient: true });
    });

    test('rethrows unknown errors with preserveOnError flag', async () => {
      const unknown = new Error('Unexpected error');
      fs.readFile.mockRejectedValue(unknown);

      await expect(
        persistence.loadConfig('/data/config.json', jest.fn(), jest.fn())
      ).rejects.toMatchObject({ preserveOnError: true });
    });
  });

  describe('loadHistory - JSON error paths', () => {
    test('handles corrupt history JSON', async () => {
      fs.readFile.mockResolvedValue('corrupted!!!');
      fs.copyFile.mockResolvedValue();
      fs.mkdir.mockResolvedValue();
      fs.writeFile.mockResolvedValue();
      fs.rename.mockResolvedValue();

      const createEmpty = jest.fn(() => ({ entries: {} }));
      const saveHistory = jest.fn().mockResolvedValue();

      const history = await persistence.loadHistory(
        '/data/history.json',
        '2.0',
        createEmpty,
        saveHistory,
        jest.fn()
      );

      expect(createEmpty).toHaveBeenCalled();
      expect(history.entries).toEqual({});
    });

    test('rethrows transient errors', async () => {
      const busy = Object.assign(new Error('EACCES'), { code: 'EACCES' });
      fs.readFile.mockRejectedValue(busy);

      await expect(
        persistence.loadHistory('/data/history.json', '2.0', jest.fn(), jest.fn(), jest.fn())
      ).rejects.toMatchObject({ transient: true });
    });
  });

  describe('loadIndex - JSON error paths', () => {
    test('handles corrupt index JSON', async () => {
      fs.readFile.mockResolvedValue('bad json');
      fs.copyFile.mockResolvedValue();
      fs.mkdir.mockResolvedValue();
      fs.writeFile.mockResolvedValue();
      fs.rename.mockResolvedValue();

      const createEmpty = jest.fn(() => ({ tagIndex: {} }));
      const saveIndex = jest.fn().mockResolvedValue();

      const index = await persistence.loadIndex('/data/index.json', createEmpty, saveIndex);

      expect(createEmpty).toHaveBeenCalled();
      expect(index.tagIndex).toEqual({});
    });

    test('rethrows transient errors', async () => {
      const eperm = Object.assign(new Error('EPERM'), { code: 'EPERM' });
      fs.readFile.mockRejectedValue(eperm);

      await expect(
        persistence.loadIndex('/data/index.json', jest.fn(), jest.fn())
      ).rejects.toMatchObject({ transient: true });
    });

    test('rethrows unknown errors with preserveOnError', async () => {
      const unknown = new Error('Some weird error');
      fs.readFile.mockRejectedValue(unknown);

      await expect(
        persistence.loadIndex('/data/index.json', jest.fn(), jest.fn())
      ).rejects.toMatchObject({ preserveOnError: true });
    });
  });
});
