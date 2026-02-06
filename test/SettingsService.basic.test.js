/**
 * SettingsService basic tests
 * Focus: load caching + corruption recovery behavior (no watcher side effects).
 */

jest.mock('electron', () => ({
  app: {
    getPath: jest.fn(() => 'C:\\user-data')
  }
}));

jest.mock('fs', () => {
  const promises = {
    readFile: jest.fn(),
    writeFile: jest.fn(),
    mkdir: jest.fn(),
    readdir: jest.fn(),
    stat: jest.fn(),
    unlink: jest.fn(),
    rename: jest.fn()
  };
  return {
    promises,
    watch: jest.fn(),
    existsSync: jest.fn(() => true)
  };
});

jest.mock('../src/shared/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    setContext: jest.fn()
  },
  createLogger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    setContext: jest.fn()
  })
}));

jest.mock('../src/main/services/SettingsBackupService', () => ({
  SettingsBackupService: jest.fn().mockImplementation(() => ({
    listBackups: jest.fn().mockResolvedValue([]),
    restoreFromBackup: jest.fn()
  }))
}));

jest.mock('../src/main/ipc/ipcWrappers', () => ({
  safeSend: jest.fn()
}));

describe('SettingsService (basic)', () => {
  function loadService() {
    jest.resetModules();
    const SettingsService = require('../src/main/services/SettingsService');
    jest.spyOn(SettingsService.prototype, '_startFileWatcher').mockImplementation(() => {});
    return SettingsService;
  }

  test('_loadRaw returns cached settings within TTL without reading disk', async () => {
    const SettingsService = loadService();
    const service = new SettingsService();
    const fs = require('fs').promises;

    service._cache = { theme: 'dark' };
    service._cacheTimestamp = Date.now();
    service._cacheTtlMs = 5000;

    fs.readFile.mockRejectedValue(new Error('should not be called'));

    await expect(service._loadRaw()).resolves.toEqual({ theme: 'dark' });
    expect(fs.readFile).not.toHaveBeenCalled();
  });

  test('_loadRaw attempts recovery when JSON is corrupted and uses recovered settings', async () => {
    const SettingsService = loadService();
    const service = new SettingsService();
    const fs = require('fs').promises;

    fs.readFile.mockResolvedValue('{"invalidJson": ');
    service._attemptAutoRecovery = jest.fn().mockResolvedValue({ recovered: true });

    await expect(service._loadRaw()).resolves.toEqual({ recovered: true });
    expect(service._attemptAutoRecovery).toHaveBeenCalled();
  });

  test('_loadRaw falls back to defaults when settings file is missing', async () => {
    const SettingsService = loadService();
    const service = new SettingsService();
    const fs = require('fs').promises;

    fs.readFile.mockRejectedValue(Object.assign(new Error('not found'), { code: 'ENOENT' }));

    const settings = await service._loadRaw();
    expect(settings).toEqual(expect.objectContaining(service.defaults));
    expect(service._cache).toBeDefined();
  });
});
