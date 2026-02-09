jest.mock('electron', () => ({
  app: {
    getPath: jest.fn(() => 'C:\\fake-user-data')
  },
  BrowserWindow: {
    getAllWindows: jest.fn(() => [])
  }
}));

jest.mock('../src/shared/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    setContext: jest.fn()
  },
  createLogger: jest.fn(() => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    setContext: jest.fn()
  }))
}));

jest.mock('../src/shared/errorClassifier', () => ({
  isNotFoundError: jest.fn()
}));

jest.mock('../src/shared/settingsValidation', () => ({
  validateSettings: jest.fn(),
  sanitizeSettings: jest.fn((settings) => settings)
}));

jest.mock('../src/shared/defaultSettings', () => ({
  DEFAULT_SETTINGS: {
    confidenceThreshold: 0.5,
    theme: 'light'
  },
  mergeWithDefaults: jest.fn((settings) => ({
    confidenceThreshold: 0.5,
    theme: 'light',
    ...settings
  }))
}));

jest.mock('../src/shared/atomicFileOperations', () => ({
  backupAndReplace: jest.fn()
}));

jest.mock('../src/shared/singletonFactory', () => ({
  createSingletonHelpers: jest.fn(() => ({
    getInstance: jest.fn(),
    createInstance: jest.fn(),
    registerWithContainer: jest.fn(),
    resetInstance: jest.fn()
  }))
}));

jest.mock('../src/shared/performanceConstants', () => ({
  LIMITS: {
    MAX_SETTINGS_BACKUPS: 3,
    MAX_WATCHER_RESTARTS: 2,
    WATCHER_RESTART_WINDOW: 10_000
  },
  DEBOUNCE: {
    SETTINGS_SAVE: 5
  },
  TIMEOUTS: {
    SERVICE_STARTUP: 250
  },
  RETRY: {
    MAX_ATTEMPTS_MEDIUM: 3,
    MAX_ATTEMPTS_HIGH: 5
  }
}));

jest.mock('../src/main/services/SettingsBackupService', () => ({
  SettingsBackupService: jest.fn().mockImplementation(() => ({
    createBackup: jest.fn(),
    listBackups: jest.fn(),
    restoreFromBackup: jest.fn(),
    cleanupOldBackups: jest.fn(),
    deleteBackup: jest.fn(),
    backupDir: 'C:\\fake-user-data\\settings-backups'
  }))
}));

jest.mock('../src/main/ipc/ipcWrappers', () => ({
  safeSend: jest.fn()
}));

const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const { isNotFoundError } = require('../src/shared/errorClassifier');
const { validateSettings } = require('../src/shared/settingsValidation');
const { backupAndReplace } = require('../src/shared/atomicFileOperations');
const { SettingsBackupService } = require('../src/main/services/SettingsBackupService');

jest.spyOn(fsSync, 'watch').mockImplementation(() => ({
  on: jest.fn(),
  close: jest.fn()
}));

jest.spyOn(fs, 'mkdir').mockResolvedValue();
jest.spyOn(fs, 'access').mockResolvedValue();
jest.spyOn(fs, 'writeFile').mockResolvedValue();
jest.spyOn(fs, 'readFile').mockResolvedValue('{"confidenceThreshold":0.4,"theme":"dark"}');

const SettingsService = require('../src/main/services/SettingsService');

describe('SettingsService', () => {
  let service;

  beforeEach(() => {
    jest.useFakeTimers();
    isNotFoundError.mockReset();
    validateSettings.mockReset();
    backupAndReplace.mockReset();
    SettingsBackupService.mockClear();
    service = new SettingsService();
  });

  afterEach(async () => {
    if (service) {
      await service.shutdown();
    }
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  test('load returns defaults when settings file missing', async () => {
    fs.readFile.mockRejectedValueOnce(Object.assign(new Error('missing'), { code: 'ENOENT' }));
    isNotFoundError.mockReturnValue(true);

    const settings = await service.load();
    expect(settings).toEqual({ confidenceThreshold: 0.5, theme: 'light' });
  });

  test('load uses cache within TTL', async () => {
    const nowSpy = jest.spyOn(Date, 'now');
    nowSpy.mockReturnValueOnce(1000).mockReturnValueOnce(1500);
    service._migrationChecked = true;
    const first = await service.load();
    const second = await service.load();
    expect(first).toEqual(second);
    expect(fs.readFile).toHaveBeenCalledTimes(1);
    nowSpy.mockRestore();
  });

  test('save rejects invalid settings', async () => {
    validateSettings.mockReturnValue({
      valid: false,
      errors: ['invalid'],
      warnings: []
    });

    await expect(service.save({ theme: 'light' })).rejects.toThrow('Invalid settings provided');
    expect(backupAndReplace).not.toHaveBeenCalled();
  });

  test('save persists merged settings and returns backup info', async () => {
    validateSettings.mockReturnValue({ valid: true, errors: [], warnings: [] });
    const backupServiceInstance = SettingsBackupService.mock.results[0].value;
    backupServiceInstance.createBackup.mockResolvedValue({
      success: true,
      path: 'C:\\fake-user-data\\settings-backups\\backup.json'
    });
    backupAndReplace.mockResolvedValue({ success: true });

    const result = await service.save({ confidenceThreshold: 0.9 });
    expect(result.settings.confidenceThreshold).toBe(0.9);
    expect(result.backupCreated).toBe(true);
    expect(result.backupPath).toContain('settings-backups');
  });

  test('restoreFromBackup rejects invalid path input', async () => {
    const result = await service.restoreFromBackup(null);
    expect(result).toEqual({ success: false, error: 'Invalid backup path provided' });
  });

  test('restoreFromBackup rejects path traversal outside backup dir', async () => {
    await expect(
      service.restoreFromBackup(path.join('C:\\', 'outside', 'backup.json'))
    ).rejects.toThrow('outside backup directory');
  });

  test('handleExternalFileChange handles missing file', async () => {
    service._notifySettingsChanged = jest.fn();
    fs.access.mockRejectedValueOnce(Object.assign(new Error('missing'), { code: 'ENOENT' }));
    isNotFoundError.mockReturnValue(true);

    await service._handleExternalFileChange('change', 'settings.json');
    expect(service._notifySettingsChanged).toHaveBeenCalled();
  });
});
