/**
 * @jest-environment node
 */

const mockStoresByDbPath = new Map();

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

jest.mock('../src/main/utils/sqliteStore', () => ({
  shouldUseSqliteBackend: jest.fn(() => true),
  isSqliteTransientError: jest.fn(() => false),
  createKeyValueStore: jest.fn(({ dbPath }) => {
    if (!mockStoresByDbPath.has(dbPath)) {
      mockStoresByDbPath.set(dbPath, new Map());
    }
    const scopedStore = mockStoresByDbPath.get(dbPath);
    return {
      get: jest.fn((k) => scopedStore.get(k)),
      set: jest.fn((k, v) => {
        scopedStore.set(k, v);
      }),
      close: jest.fn()
    };
  })
}));

describe('analysisHistory persistence SQLite isolation', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    mockStoresByDbPath.clear();
  });

  test('uses independent SQLite stores for different directories', async () => {
    const persistence = require('../src/main/services/analysisHistory/persistence');
    const { createKeyValueStore } = require('../src/main/utils/sqliteStore');

    await persistence.saveConfig('/tmp/a/config.json', { source: 'A' });
    await persistence.saveConfig('/tmp/b/config.json', { source: 'B' });

    const configA = await persistence.loadConfig(
      '/tmp/a/config.json',
      () => ({ source: 'default' }),
      jest.fn()
    );
    const configB = await persistence.loadConfig(
      '/tmp/b/config.json',
      () => ({ source: 'default' }),
      jest.fn()
    );

    expect(configA.source).toBe('A');
    expect(configB.source).toBe('B');
    expect(createKeyValueStore).toHaveBeenCalledTimes(2);

    persistence.closeSqliteStore();
  });
});
