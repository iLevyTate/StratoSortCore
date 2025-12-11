/**
 * Tests for Analysis History Persistence
 * Tests file I/O operations, atomic writes, and loading
 */

// Mock dependencies
jest.mock('fs', () => ({
  promises: {
    readFile: jest.fn(),
    writeFile: jest.fn(),
    rename: jest.fn(),
    unlink: jest.fn(),
    mkdir: jest.fn()
  }
}));

jest.mock('../src/shared/logger', () => ({
  logger: {
    setContext: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  }
}));

describe('persistence', () => {
  let persistence;
  let fs;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();

    fs = require('fs').promises;
    persistence = require('../src/main/services/analysisHistory/persistence');
  });

  describe('ensureParentDirectory', () => {
    test('creates parent directory recursively', async () => {
      fs.mkdir.mockResolvedValue();

      await persistence.ensureParentDirectory('/path/to/file.json');

      expect(fs.mkdir).toHaveBeenCalledWith('/path/to', { recursive: true });
    });
  });

  describe('atomicWriteFile', () => {
    test('writes to temp file then renames', async () => {
      fs.writeFile.mockResolvedValue();
      fs.rename.mockResolvedValue();

      await persistence.atomicWriteFile('/path/to/file.json', '{}');

      expect(fs.writeFile).toHaveBeenCalledWith(expect.stringMatching(/\.tmp\.\d+$/), '{}');
      expect(fs.rename).toHaveBeenCalled();
    });

    test('cleans up temp file on write error', async () => {
      fs.writeFile.mockResolvedValue();
      fs.rename.mockRejectedValue(new Error('Rename failed'));
      fs.unlink.mockResolvedValue();

      await expect(persistence.atomicWriteFile('/path/to/file.json', '{}')).rejects.toThrow(
        'Rename failed'
      );

      expect(fs.unlink).toHaveBeenCalled();
    });

    test('ignores cleanup error on failure', async () => {
      fs.writeFile.mockResolvedValue();
      fs.rename.mockRejectedValue(new Error('Rename failed'));
      fs.unlink.mockRejectedValue(new Error('Cleanup failed'));

      await expect(persistence.atomicWriteFile('/path/to/file.json', '{}')).rejects.toThrow(
        'Rename failed'
      );
    });
  });

  describe('loadConfig', () => {
    test('loads and parses config from file', async () => {
      fs.readFile.mockResolvedValue(JSON.stringify({ setting: 'value' }));

      const config = await persistence.loadConfig('/path/config.json', jest.fn(), jest.fn());

      expect(config).toEqual({ setting: 'value' });
    });

    test('creates default config on error', async () => {
      fs.readFile.mockRejectedValue(new Error('File not found'));
      const getDefaultConfig = jest.fn().mockReturnValue({ default: true });
      const saveConfig = jest.fn().mockResolvedValue();

      const config = await persistence.loadConfig(
        '/path/config.json',
        getDefaultConfig,
        saveConfig
      );

      expect(getDefaultConfig).toHaveBeenCalled();
      expect(saveConfig).toHaveBeenCalledWith({ default: true });
      expect(config).toEqual({ default: true });
    });
  });

  describe('saveConfig', () => {
    test('saves config with updated timestamp', async () => {
      fs.mkdir.mockResolvedValue();
      fs.writeFile.mockResolvedValue();
      fs.rename.mockResolvedValue();

      await persistence.saveConfig('/path/config.json', { setting: 'value' });

      expect(fs.writeFile).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringContaining('"setting"')
      );
    });
  });

  describe('loadHistory', () => {
    test('loads and returns history', async () => {
      fs.readFile.mockResolvedValue(
        JSON.stringify({
          schemaVersion: '2.0',
          entries: {}
        })
      );

      const history = await persistence.loadHistory(
        '/path/history.json',
        '2.0',
        jest.fn(),
        jest.fn(),
        jest.fn()
      );

      expect(history.schemaVersion).toBe('2.0');
    });

    test('migrates history on version mismatch', async () => {
      fs.readFile.mockResolvedValue(
        JSON.stringify({
          schemaVersion: '1.0',
          entries: {}
        })
      );
      const migrateHistory = jest.fn().mockResolvedValue();

      await persistence.loadHistory(
        '/path/history.json',
        '2.0',
        jest.fn(),
        jest.fn(),
        migrateHistory
      );

      expect(migrateHistory).toHaveBeenCalled();
    });

    test('creates empty history on error', async () => {
      fs.readFile.mockRejectedValue(new Error('File not found'));
      const createEmptyHistory = jest.fn().mockReturnValue({ entries: {} });
      const saveHistory = jest.fn().mockResolvedValue();

      const history = await persistence.loadHistory(
        '/path/history.json',
        '2.0',
        createEmptyHistory,
        saveHistory,
        jest.fn()
      );

      expect(createEmptyHistory).toHaveBeenCalled();
      expect(saveHistory).toHaveBeenCalled();
      expect(history).toEqual({ entries: {} });
    });
  });

  describe('saveHistory', () => {
    test('saves history with updated timestamp', async () => {
      fs.mkdir.mockResolvedValue();
      fs.writeFile.mockResolvedValue();
      fs.rename.mockResolvedValue();

      await persistence.saveHistory('/path/history.json', { entries: {} });

      expect(fs.writeFile).toHaveBeenCalled();
    });
  });

  describe('loadIndex', () => {
    test('loads and returns index', async () => {
      fs.readFile.mockResolvedValue(
        JSON.stringify({
          categoryIndex: {},
          tagIndex: {}
        })
      );

      const index = await persistence.loadIndex('/path/index.json', jest.fn(), jest.fn());

      expect(index.categoryIndex).toEqual({});
    });

    test('creates empty index on error', async () => {
      fs.readFile.mockRejectedValue(new Error('File not found'));
      const createEmptyIndex = jest.fn().mockReturnValue({ tagIndex: {} });
      const saveIndex = jest.fn().mockResolvedValue();

      const index = await persistence.loadIndex('/path/index.json', createEmptyIndex, saveIndex);

      expect(createEmptyIndex).toHaveBeenCalled();
      expect(saveIndex).toHaveBeenCalled();
      expect(index).toEqual({ tagIndex: {} });
    });
  });

  describe('saveIndex', () => {
    test('saves index with updated timestamp', async () => {
      fs.mkdir.mockResolvedValue();
      fs.writeFile.mockResolvedValue();
      fs.rename.mockResolvedValue();

      await persistence.saveIndex('/path/index.json', { tagIndex: {} });

      expect(fs.writeFile).toHaveBeenCalled();
    });
  });

  describe('createDefaultStructures', () => {
    test('creates and saves all default structures', async () => {
      fs.mkdir.mockResolvedValue();
      fs.writeFile.mockResolvedValue();
      fs.rename.mockResolvedValue();

      const getDefaultConfig = jest.fn().mockReturnValue({ default: true });
      const createEmptyHistory = jest.fn().mockReturnValue({ entries: {} });
      const createEmptyIndex = jest.fn().mockReturnValue({ tagIndex: {} });

      const result = await persistence.createDefaultStructures(
        {
          configPath: '/path/config.json',
          historyPath: '/path/history.json',
          indexPath: '/path/index.json'
        },
        getDefaultConfig,
        createEmptyHistory,
        createEmptyIndex
      );

      expect(result.config.default).toBe(true);
      expect(result.history.entries).toEqual({});
      expect(result.index.tagIndex).toEqual({});
    });
  });
});
