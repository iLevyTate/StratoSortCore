/**
 * SettingsService recovery tests
 * Focus: _attemptAutoRecovery end-to-end behavior (backup selection + restore callback save).
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

jest.mock('../src/shared/atomicFileOperations', () => ({
  backupAndReplace: jest.fn().mockResolvedValue({ success: true })
}));

jest.mock('../src/main/services/SettingsBackupService', () => ({
  SettingsBackupService: jest.fn().mockImplementation(() => ({
    backupDir: 'C:\\user-data\\settings-backups',
    listBackups: jest.fn().mockResolvedValue([]),
    restoreFromBackup: jest.fn()
  }))
}));

jest.mock('../src/main/ipc/ipcWrappers', () => ({
  safeSend: jest.fn()
}));

describe('SettingsService (auto-recovery)', () => {
  function loadService() {
    jest.resetModules();
    const SettingsService = require('../src/main/services/SettingsService');
    jest.spyOn(SettingsService.prototype, '_startFileWatcher').mockImplementation(() => {});
    return SettingsService;
  }

  test('_loadRaw restores from first valid backup and updates cache', async () => {
    const SettingsService = loadService();
    const service = new SettingsService();
    const fs = require('fs').promises;

    // first read is corrupted -> triggers auto recovery; second read returns restored JSON
    fs.readFile
      .mockResolvedValueOnce('{"invalidJson": ')
      .mockResolvedValueOnce('{"confidenceThreshold":0.9}');

    service._backupService.listBackups.mockResolvedValue([
      { filename: 'b1.json', path: 'C:\\user-data\\settings-backups\\b1.json' }
    ]);
    service._backupService.restoreFromBackup.mockImplementation(async (_backupPath, apply) => {
      await apply({ confidenceThreshold: 0.9 });
      return { success: true };
    });

    const settings = await service._loadRaw();
    expect(settings).toEqual(expect.objectContaining({ confidenceThreshold: 0.9 }));
    expect(service._backupService.restoreFromBackup).toHaveBeenCalledTimes(1);
    expect(service._cache).toEqual(expect.objectContaining({ confidenceThreshold: 0.9 }));
  });

  test('_attemptAutoRecovery tries next backup when first restore fails', async () => {
    const SettingsService = loadService();
    const service = new SettingsService();
    const fs = require('fs').promises;

    fs.readFile
      .mockResolvedValueOnce('{"invalidJson": ')
      .mockResolvedValueOnce('{"confidenceThreshold":0.9}');

    service._backupService.listBackups.mockResolvedValue([
      { filename: 'b1.json', path: 'C:\\user-data\\settings-backups\\b1.json' },
      { filename: 'b2.json', path: 'C:\\user-data\\settings-backups\\b2.json' }
    ]);

    service._backupService.restoreFromBackup.mockImplementation(async (backupPath, apply) => {
      if (String(backupPath).includes('b1.json')) {
        throw new Error('first backup corrupted');
      }
      await apply({ confidenceThreshold: 0.9 });
      return { success: true };
    });

    const settings = await service._loadRaw();
    expect(settings).toEqual(expect.objectContaining({ confidenceThreshold: 0.9 }));
    expect(service._backupService.restoreFromBackup).toHaveBeenCalledTimes(2);
  });

  test('_attemptAutoRecovery limits to 5 most recent backups', async () => {
    const SettingsService = loadService();
    const service = new SettingsService();
    const fs = require('fs').promises;

    // corrupted settings; we won't successfully restore, just verify call count
    fs.readFile.mockResolvedValue('{"invalidJson": ');

    const backups = Array.from({ length: 12 }).map((_, i) => ({
      filename: `b${i + 1}.json`,
      path: `C:\\user-data\\settings-backups\\b${i + 1}.json`
    }));
    service._backupService.listBackups.mockResolvedValue(backups);
    service._backupService.restoreFromBackup.mockRejectedValue(new Error('nope'));

    await service._loadRaw();
    expect(service._backupService.restoreFromBackup).toHaveBeenCalledTimes(5);
  });
});
