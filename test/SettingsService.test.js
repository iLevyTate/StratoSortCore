/**
 * Tests for SettingsService
 * Tests settings loading, saving, validation, and backup management
 */

// Mock electron
jest.mock('electron', () => ({
  app: {
    getPath: jest.fn().mockReturnValue('/tmp/test-app'),
    getVersion: jest.fn().mockReturnValue('1.0.0'),
  },
  ipcMain: {
    emit: jest.fn(),
  },
  BrowserWindow: {
    getAllWindows: jest.fn().mockReturnValue([]),
  },
}));

// Mock fs promises
const mockFs = {
  readFile: jest.fn(),
  writeFile: jest.fn().mockResolvedValue(undefined),
  mkdir: jest.fn().mockResolvedValue(undefined),
  readdir: jest.fn().mockResolvedValue([]),
  stat: jest.fn(),
  access: jest.fn().mockResolvedValue(undefined),
  unlink: jest.fn().mockResolvedValue(undefined),
};

// Mock fs sync
const mockFsSync = {
  existsSync: jest.fn().mockReturnValue(true),
  mkdirSync: jest.fn(),
  watch: jest.fn().mockReturnValue({
    on: jest.fn().mockReturnThis(),
    close: jest.fn(),
  }),
};

jest.mock('fs', () => ({
  promises: mockFs,
  existsSync: (...args) => mockFsSync.existsSync(...args),
  mkdirSync: (...args) => mockFsSync.mkdirSync(...args),
  watch: (...args) => mockFsSync.watch(...args),
  constants: { R_OK: 4, W_OK: 2 },
}));

// Mock logger
jest.mock('../src/shared/logger', () => ({
  logger: {
    setContext: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

// Mock settings validation
jest.mock('../src/shared/settingsValidation', () => ({
  validateSettings: jest
    .fn()
    .mockReturnValue({ valid: true, errors: [], warnings: [] }),
  sanitizeSettings: jest.fn((s) => s),
}));

// Mock default settings
jest.mock('../src/shared/defaultSettings', () => ({
  DEFAULT_SETTINGS: {
    theme: 'system',
    autoOrganize: false,
    downloadConfidenceThreshold: 0.9,
  },
}));

// Mock atomic file operations
jest.mock('../src/shared/atomicFileOperations', () => ({
  backupAndReplace: jest.fn().mockResolvedValue({ success: true }),
}));

describe('SettingsService', () => {
  let SettingsService;
  let service;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();

    mockFs.readFile.mockRejectedValue({ code: 'ENOENT' });
    mockFs.readdir.mockResolvedValue([]);

    SettingsService = require('../src/main/services/SettingsService');
    service = new SettingsService();
  });

  afterEach(() => {
    if (service) {
      service.shutdown();
    }
  });

  describe('constructor', () => {
    test('initializes with settings path', () => {
      expect(service.settingsPath).toContain('settings.json');
    });

    test('initializes with backup directory', () => {
      expect(service.backupDir).toContain('settings-backups');
    });

    test('starts file watcher', () => {
      expect(mockFsSync.watch).toHaveBeenCalled();
    });
  });

  describe('load', () => {
    test('returns default settings when file does not exist', async () => {
      mockFs.readFile.mockRejectedValueOnce({ code: 'ENOENT' });

      const settings = await service.load();

      expect(settings.theme).toBe('system');
      expect(settings.autoOrganize).toBe(false);
    });

    test('returns merged settings from file', async () => {
      mockFs.readFile.mockResolvedValueOnce(
        JSON.stringify({ theme: 'dark', customSetting: true }),
      );

      const settings = await service.load();

      expect(settings.theme).toBe('dark');
      expect(settings.customSetting).toBe(true);
      expect(settings.autoOrganize).toBe(false); // Default
    });

    test('uses cache for rapid calls', async () => {
      mockFs.readFile.mockResolvedValue(JSON.stringify({ theme: 'dark' }));

      await service.load();
      await service.load();
      await service.load();

      expect(mockFs.readFile).toHaveBeenCalledTimes(1);
    });

    test('handles invalid JSON gracefully', async () => {
      mockFs.readFile.mockResolvedValueOnce('not valid json');

      const settings = await service.load();

      expect(settings.theme).toBe('system'); // Falls back to defaults
    });
  });

  describe('save', () => {
    test('validates settings before saving', async () => {
      const { validateSettings } = require('../src/shared/settingsValidation');

      await service.save({ theme: 'dark' });

      expect(validateSettings).toHaveBeenCalled();
    });

    test('throws on invalid settings', async () => {
      const { validateSettings } = require('../src/shared/settingsValidation');
      validateSettings.mockReturnValueOnce({
        valid: false,
        errors: ['Invalid theme'],
        warnings: [],
      });

      await expect(service.save({ theme: 'invalid' })).rejects.toThrow(
        'Invalid settings',
      );
    });

    test('creates backup before saving', async () => {
      await service.save({ theme: 'dark' });

      // Should have called mkdir for backup directory
      expect(mockFs.mkdir).toHaveBeenCalled();
    });

    test('merges with existing settings', async () => {
      mockFs.readFile.mockResolvedValueOnce(
        JSON.stringify({ theme: 'light', existingSetting: true }),
      );

      const {
        backupAndReplace,
      } = require('../src/shared/atomicFileOperations');

      await service.save({ theme: 'dark' });

      const savedContent = JSON.parse(backupAndReplace.mock.calls[0][1]);
      expect(savedContent.theme).toBe('dark');
      expect(savedContent.existingSetting).toBe(true);
    });

    test('returns saved settings and metadata', async () => {
      const result = await service.save({ theme: 'dark' });

      expect(result.settings).toBeDefined();
      expect(result.settings.theme).toBe('dark');
      expect(result.backupCreated).toBe(true);
    });
  });

  describe('invalidateCache', () => {
    test('clears cached settings', async () => {
      mockFs.readFile.mockResolvedValue(JSON.stringify({ theme: 'dark' }));

      await service.load();
      service.invalidateCache();
      await service.load();

      expect(mockFs.readFile).toHaveBeenCalledTimes(2);
    });
  });

  describe('reload', () => {
    test('invalidates cache and reloads', async () => {
      mockFs.readFile.mockResolvedValue(JSON.stringify({ theme: 'dark' }));

      await service.load();
      const invalidateSpy = jest.spyOn(service, 'invalidateCache');

      await service.reload();

      expect(invalidateSpy).toHaveBeenCalled();
    });
  });

  describe('createBackup', () => {
    test('creates backup with timestamp', async () => {
      mockFs.readFile.mockResolvedValueOnce(JSON.stringify({ theme: 'dark' }));

      const result = await service.createBackup();

      expect(result.success).toBe(true);
      expect(result.path).toContain('settings-');
      expect(mockFs.writeFile).toHaveBeenCalled();
    });

    test('includes SHA256 hash', async () => {
      mockFs.readFile.mockResolvedValueOnce(JSON.stringify({ theme: 'dark' }));

      await service.createBackup();

      const writtenContent = JSON.parse(mockFs.writeFile.mock.calls[0][1]);
      expect(writtenContent.hash).toBeDefined();
      expect(writtenContent.hash).toHaveLength(64); // SHA256 hex length
    });

    test('handles errors gracefully', async () => {
      mockFs.mkdir.mockRejectedValueOnce(new Error('Permission denied'));

      const result = await service.createBackup();

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('listBackups', () => {
    test('returns list of backup files', async () => {
      mockFs.readdir.mockResolvedValueOnce([
        'settings-2024-01-01T00-00-00.json',
        'settings-2024-01-02T00-00-00.json',
      ]);
      mockFs.readFile
        .mockResolvedValueOnce(
          JSON.stringify({
            timestamp: '2024-01-01T00:00:00Z',
            appVersion: '1.0.0',
          }),
        )
        .mockResolvedValueOnce(
          JSON.stringify({
            timestamp: '2024-01-02T00:00:00Z',
            appVersion: '1.0.0',
          }),
        );
      mockFs.stat
        .mockResolvedValueOnce({ size: 100, mtime: new Date('2024-01-01') })
        .mockResolvedValueOnce({ size: 150, mtime: new Date('2024-01-02') });

      const backups = await service.listBackups();

      expect(backups).toHaveLength(2);
      expect(backups[0].filename).toContain('settings-');
    });

    test('sorts backups by timestamp (newest first)', async () => {
      mockFs.readdir.mockResolvedValueOnce([
        'settings-2024-01-01T00-00-00.json',
        'settings-2024-01-02T00-00-00.json',
      ]);
      mockFs.readFile
        .mockResolvedValueOnce(
          JSON.stringify({ timestamp: '2024-01-01T00:00:00Z' }),
        )
        .mockResolvedValueOnce(
          JSON.stringify({ timestamp: '2024-01-02T00:00:00Z' }),
        );
      mockFs.stat
        .mockResolvedValueOnce({ size: 100, mtime: new Date('2024-01-01') })
        .mockResolvedValueOnce({ size: 150, mtime: new Date('2024-01-02') });

      const backups = await service.listBackups();

      // Newest should be first
      expect(new Date(backups[0].timestamp).getTime()).toBeGreaterThan(
        new Date(backups[1].timestamp).getTime(),
      );
    });

    test('ignores non-settings files', async () => {
      mockFs.readdir.mockResolvedValueOnce([
        'settings-2024-01-01T00-00-00.json',
        'other-file.json',
        'random.txt',
      ]);
      mockFs.readFile.mockResolvedValueOnce(
        JSON.stringify({ timestamp: '2024-01-01T00:00:00Z' }),
      );
      mockFs.stat.mockResolvedValueOnce({ size: 100, mtime: new Date() });

      const backups = await service.listBackups();

      expect(backups).toHaveLength(1);
    });
  });

  describe('restoreFromBackup', () => {
    test('restores settings from backup', async () => {
      mockFs.readFile.mockResolvedValueOnce(
        JSON.stringify({
          timestamp: '2024-01-01T00:00:00Z',
          settings: { theme: 'dark', autoOrganize: true },
        }),
      );

      const result = await service.restoreFromBackup('/path/to/backup.json');

      expect(result.success).toBe(true);
      expect(result.settings.theme).toBe('dark');
    });

    test('verifies SHA256 hash', async () => {
      // This is a simplified test - in reality the hash would need to match
      const settings = { theme: 'dark' };
      const backupData = {
        timestamp: '2024-01-01T00:00:00Z',
        appVersion: '1.0.0',
        settings,
        hash: 'invalid-hash',
      };

      mockFs.readFile.mockResolvedValueOnce(JSON.stringify(backupData));

      const result = await service.restoreFromBackup('/path/to/backup.json');

      // Should fail hash verification
      expect(result.success).toBe(false);
      expect(result.error).toContain('hash mismatch');
    });

    test('handles missing settings in backup', async () => {
      mockFs.readFile.mockResolvedValueOnce(
        JSON.stringify({ timestamp: '2024-01-01T00:00:00Z' }),
      );

      const result = await service.restoreFromBackup('/path/to/backup.json');

      expect(result.success).toBe(false);
      expect(result.error).toContain('missing settings');
    });
  });

  describe('deleteBackup', () => {
    test('deletes backup file', async () => {
      const result = await service.deleteBackup('/path/to/backup.json');

      expect(result.success).toBe(true);
      expect(mockFs.unlink).toHaveBeenCalledWith('/path/to/backup.json');
    });

    test('handles errors', async () => {
      mockFs.unlink.mockRejectedValueOnce(new Error('File not found'));

      const result = await service.deleteBackup('/path/to/backup.json');

      expect(result.success).toBe(false);
    });
  });

  describe('cleanupOldBackups', () => {
    test('keeps only maxBackups most recent', async () => {
      const backups = Array.from({ length: 15 }, (_, i) => ({
        filename: `settings-2024-01-${String(i + 1).padStart(2, '0')}T00-00-00.json`,
        path: `/path/settings-${i}.json`,
        timestamp: new Date(2024, 0, i + 1).toISOString(),
        _parsedTime: new Date(2024, 0, i + 1).getTime(),
      }));

      jest.spyOn(service, 'listBackups').mockResolvedValueOnce(backups);

      await service.cleanupOldBackups();

      // Should delete backups over maxBackups (10)
      expect(mockFs.unlink).toHaveBeenCalledTimes(5);
    });
  });

  describe('shutdown', () => {
    test('stops file watcher', () => {
      const mockClose = jest.fn();
      service._fileWatcher = { close: mockClose };

      service.shutdown();

      expect(mockClose).toHaveBeenCalled();
    });

    test('clears debounce timer', () => {
      service._debounceTimer = setTimeout(() => {}, 10000);

      service.shutdown();

      expect(service._debounceTimer).toBeNull();
    });
  });

  describe('getService singleton', () => {
    test('returns singleton instance', () => {
      const { getService } = require('../src/main/services/SettingsService');

      const instance1 = getService();
      const instance2 = getService();

      expect(instance1).toBe(instance2);
    });
  });
});
