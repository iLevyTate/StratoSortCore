const BACKUP_DIR = require('path').join('fake-user-data', 'settings-backups');
const SETTINGS_FILE = require('path').join(BACKUP_DIR, 'settings.json');

jest.mock('electron', () => ({
  app: {
    getPath: jest.fn(() => require('path').join('fake-user-data')),
    getVersion: jest.fn(() => '2.0.0')
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

jest.mock('../src/shared/performanceConstants', () => ({
  LIMITS: { MAX_SETTINGS_BACKUPS: 2 }
}));

jest.mock('../src/shared/atomicFileOperations', () => ({
  atomicFileOps: {
    safeWriteFile: jest.fn().mockResolvedValue()
  }
}));

jest.mock('../src/shared/settingsValidation', () => ({
  validateSettings: jest.fn(() => ({ valid: true, errors: [], warnings: [] })),
  sanitizeSettings: jest.fn((settings) => settings)
}));

const mockFs = {
  mkdir: jest.fn().mockResolvedValue(),
  readdir: jest.fn(),
  readFile: jest.fn(),
  writeFile: jest.fn().mockResolvedValue(),
  stat: jest.fn(),
  unlink: jest.fn().mockResolvedValue()
};

jest.mock('fs', () => ({
  promises: mockFs
}));

const { validateSettings } = require('../src/shared/settingsValidation');
const { SettingsBackupService } = require('../src/main/services/SettingsBackupService');

const stableStringify = (value) =>
  JSON.stringify(
    value,
    (key, val) => {
      if (val && typeof val === 'object' && !Array.isArray(val)) {
        return Object.keys(val)
          .sort()
          .reduce((acc, k) => {
            acc[k] = val[k];
            return acc;
          }, {});
      }
      return val;
    },
    2
  );

describe('SettingsBackupService', () => {
  beforeEach(() => {
    mockFs.readdir.mockReset();
    mockFs.readFile.mockReset();
    mockFs.stat.mockReset();
    mockFs.unlink.mockReset();
  });

  test('createBackup writes backup and returns metadata', async () => {
    const service = new SettingsBackupService({
      backupDir: BACKUP_DIR,
      defaults: { theme: 'light' },
      loadSettings: jest.fn().mockResolvedValue({ theme: 'dark' })
    });

    const result = await service.createBackup();
    expect(result.success).toBe(true);
    expect(result.path).toContain('settings-');
  });

  test('listBackups skips invalid files', async () => {
    mockFs.readdir.mockResolvedValue(['settings-a.json']);
    mockFs.readFile.mockRejectedValueOnce(new Error('bad json'));
    const service = new SettingsBackupService({
      backupDir: BACKUP_DIR,
      defaults: {},
      loadSettings: jest.fn()
    });

    const result = await service.listBackups();
    expect(result).toEqual([]);
  });

  test('restoreFromBackup validates and saves settings', async () => {
    const service = new SettingsBackupService({
      backupDir: BACKUP_DIR,
      defaults: { theme: 'light' },
      loadSettings: jest.fn()
    });

    const backup = {
      timestamp: new Date().toISOString(),
      appVersion: '2.0.0',
      settings: { theme: 'dark' }
    };
    const crypto = require('crypto');
    const hash = crypto.createHash('sha256').update(stableStringify(backup), 'utf8').digest('hex');
    mockFs.readFile.mockResolvedValueOnce(JSON.stringify({ ...backup, hash }));

    const saveSettings = jest.fn().mockResolvedValue();
    const result = await service.restoreFromBackup(SETTINGS_FILE, saveSettings);

    expect(result.success).toBe(true);
    expect(saveSettings).toHaveBeenCalledWith(expect.objectContaining({ theme: 'dark' }));
  });

  test('restoreFromBackup reports validation errors', async () => {
    validateSettings.mockReturnValueOnce({ valid: false, errors: ['bad'], warnings: [] });
    const service = new SettingsBackupService({
      backupDir: BACKUP_DIR,
      defaults: {},
      loadSettings: jest.fn()
    });
    const backup = {
      timestamp: new Date().toISOString(),
      appVersion: '2.0.0',
      settings: { theme: 'dark' }
    };
    const crypto = require('crypto');
    const hash = crypto.createHash('sha256').update(stableStringify(backup), 'utf8').digest('hex');
    mockFs.readFile.mockResolvedValueOnce(JSON.stringify({ ...backup, hash }));

    const result = await service.restoreFromBackup(SETTINGS_FILE, jest.fn());

    expect(result.success).toBe(false);
    expect(result.validationErrors).toEqual(['bad']);
  });
});
