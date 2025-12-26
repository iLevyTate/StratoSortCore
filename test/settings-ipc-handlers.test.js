/**
 * Tests for Settings IPC Handlers
 * Tests export/import/backup operations exposed via IPC
 */

// Mock electron
const mockShowSaveDialog = jest.fn();
const mockShowOpenDialog = jest.fn();

jest.mock('electron', () => ({
  app: {
    getPath: jest.fn().mockReturnValue('/tmp/test-app'),
    getVersion: jest.fn().mockReturnValue('1.0.0'),
    setLoginItemSettings: jest.fn()
  },
  ipcMain: {
    handle: jest.fn()
  },
  dialog: {
    showSaveDialog: (...args) => mockShowSaveDialog(...args),
    showOpenDialog: (...args) => mockShowOpenDialog(...args)
  },
  BrowserWindow: {
    getAllWindows: jest.fn().mockReturnValue([])
  }
}));

// Mock fs promises
const mockFs = {
  readFile: jest.fn(),
  writeFile: jest.fn().mockResolvedValue(undefined),
  mkdir: jest.fn().mockResolvedValue(undefined),
  stat: jest.fn(),
  unlink: jest.fn().mockResolvedValue(undefined),
  rename: jest.fn().mockResolvedValue(undefined)
};

jest.mock('fs', () => ({
  promises: mockFs,
  existsSync: jest.fn().mockReturnValue(true),
  mkdirSync: jest.fn(),
  watch: jest.fn().mockReturnValue({
    on: jest.fn().mockReturnThis(),
    close: jest.fn()
  }),
  constants: { R_OK: 4, W_OK: 2 }
}));

// Mock logger
jest.mock('../src/shared/logger', () => ({
  logger: {
    setContext: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  }
}));

// Mock atomic file operations
jest.mock('../src/shared/atomicFileOperations', () => ({
  backupAndReplace: jest.fn().mockResolvedValue({ success: true }),
  atomicFileOps: {
    safeWriteFile: jest.fn().mockResolvedValue(undefined)
  }
}));

// Mock settings validation
jest.mock('../src/shared/settingsValidation', () => ({
  validateSettings: jest.fn().mockReturnValue({ valid: true, errors: [], warnings: [] }),
  sanitizeSettings: jest.fn((s) => s),
  getConfigurableLimits: jest.fn().mockReturnValue({ maxBatchSize: 1000 })
}));

// Mock security config
jest.mock('../src/shared/securityConfig', () => ({
  SETTINGS_VALIDATION: {
    allowedKeys: new Set([
      'theme',
      'ollamaHost',
      'textModel',
      'visionModel',
      'embeddingModel',
      'launchOnStartup',
      'autoOrganize',
      'backgroundMode',
      'autoUpdateCheck',
      'telemetryEnabled',
      'language',
      'loggingLevel',
      'cacheSize',
      'maxBatchSize'
    ]),
    patterns: {
      url: /^https?:\/\/[a-zA-Z0-9][-a-zA-Z0-9._:]*(?:\/[^\s]*)?$/,
      modelName: /^[a-zA-Z0-9][a-zA-Z0-9\-_.@:/]*$/
    }
  },
  PROTOTYPE_POLLUTION_KEYS: ['__proto__', 'constructor', 'prototype']
}));

// Mock validation constants
jest.mock('../src/shared/validationConstants', () => ({
  THEME_VALUES: ['light', 'dark', 'system'],
  LOGGING_LEVELS: ['error', 'warn', 'info', 'debug'],
  NUMERIC_LIMITS: {
    cacheSize: { min: 0, max: 100000 },
    maxBatchSize: { min: 1, max: 1000 }
  },
  isValidTheme: (v) => ['light', 'dark', 'system'].includes(v),
  isValidLoggingLevel: (v) => ['error', 'warn', 'info', 'debug'].includes(v),
  isValidNumericSetting: (key, value) => {
    const limits = {
      cacheSize: { min: 0, max: 100000 },
      maxBatchSize: { min: 1, max: 1000 }
    };
    const limit = limits[key];
    if (!limit) return true;
    return Number.isInteger(value) && value >= limit.min && value <= limit.max;
  }
}));

// Mock IPC wrappers
jest.mock('../src/main/ipc/ipcWrappers', () => ({
  withErrorLogging: (logger, handler) => handler,
  withValidation: (logger, schema, handler) => handler
}));

// Mock zod - return null to use the fallback path without validation
jest.mock('zod', () => null);

const { ipcMain } = require('electron');
const { logger } = require('../src/shared/logger');
const registerSettingsIpc = require('../src/main/ipc/settings');

describe('Settings IPC Handlers', () => {
  let handlers;
  let mockSettingsService;
  let mockSetOllamaHost;
  let mockSetOllamaModel;
  let mockSetOllamaVisionModel;
  let mockSetOllamaEmbeddingModel;
  let mockOnSettingsChanged;

  const IPC_CHANNELS = {
    SETTINGS: {
      GET: 'get-settings',
      SAVE: 'save-settings',
      GET_CONFIGURABLE_LIMITS: 'get-configurable-limits',
      EXPORT: 'export-settings',
      IMPORT: 'import-settings',
      CREATE_BACKUP: 'settings-create-backup',
      LIST_BACKUPS: 'settings-list-backups',
      RESTORE_BACKUP: 'settings-restore-backup',
      DELETE_BACKUP: 'settings-delete-backup'
    }
  };

  beforeEach(() => {
    jest.clearAllMocks();
    handlers = {};

    // Capture registered handlers
    ipcMain.handle.mockImplementation((channel, handler) => {
      handlers[channel] = handler;
    });

    // Mock settings service
    mockSettingsService = {
      load: jest.fn().mockResolvedValue({ theme: 'dark', ollamaHost: 'http://localhost:11434' }),
      save: jest.fn().mockResolvedValue({
        settings: { theme: 'dark', ollamaHost: 'http://localhost:11434' },
        validationWarnings: []
      }),
      createBackup: jest.fn().mockResolvedValue({
        success: true,
        path: '/tmp/test-app/settings-backups/settings-2024-01-01.json',
        timestamp: '2024-01-01T00:00:00Z'
      }),
      listBackups: jest.fn().mockResolvedValue([
        {
          filename: 'settings-2024-01-01.json',
          path: '/tmp/test-app/settings-backups/settings-2024-01-01.json',
          timestamp: '2024-01-01T00:00:00Z',
          appVersion: '1.0.0',
          size: 1024
        }
      ]),
      restoreFromBackup: jest.fn().mockResolvedValue({
        success: true,
        settings: { theme: 'light' }
      }),
      deleteBackup: jest.fn().mockResolvedValue({ success: true })
    };

    mockSetOllamaHost = jest.fn().mockResolvedValue(undefined);
    mockSetOllamaModel = jest.fn().mockResolvedValue(undefined);
    mockSetOllamaVisionModel = jest.fn().mockResolvedValue(undefined);
    mockSetOllamaEmbeddingModel = jest.fn().mockResolvedValue(undefined);
    mockOnSettingsChanged = jest.fn().mockResolvedValue(undefined);

    // Register handlers
    registerSettingsIpc({
      ipcMain,
      IPC_CHANNELS,
      logger,
      settingsService: mockSettingsService,
      setOllamaHost: mockSetOllamaHost,
      setOllamaModel: mockSetOllamaModel,
      setOllamaVisionModel: mockSetOllamaVisionModel,
      setOllamaEmbeddingModel: mockSetOllamaEmbeddingModel,
      onSettingsChanged: mockOnSettingsChanged
    });
  });

  describe('EXPORT handler', () => {
    test('exports settings to file when path provided', async () => {
      const exportPath = '/tmp/export-settings.json';
      mockFs.writeFile.mockResolvedValueOnce(undefined);

      const handler = handlers[IPC_CHANNELS.SETTINGS.EXPORT];
      const result = await handler({}, exportPath);

      expect(result.success).toBe(true);
      expect(result.path).toBe(exportPath);
      expect(mockFs.writeFile).toHaveBeenCalled();
    });

    test('shows save dialog when no path provided', async () => {
      mockShowSaveDialog.mockResolvedValueOnce({
        canceled: false,
        filePath: '/tmp/chosen-settings.json'
      });
      mockFs.writeFile.mockResolvedValueOnce(undefined);

      const handler = handlers[IPC_CHANNELS.SETTINGS.EXPORT];
      const result = await handler({});

      expect(mockShowSaveDialog).toHaveBeenCalled();
      expect(result.success).toBe(true);
    });

    test('returns canceled when dialog is canceled', async () => {
      mockShowSaveDialog.mockResolvedValueOnce({
        canceled: true
      });

      const handler = handlers[IPC_CHANNELS.SETTINGS.EXPORT];
      const result = await handler({});

      expect(result.success).toBe(false);
      expect(result.canceled).toBe(true);
    });

    test('includes version and timestamp in exported data', async () => {
      const exportPath = '/tmp/export-settings.json';
      let writtenContent;
      mockFs.writeFile.mockImplementationOnce((path, content) => {
        writtenContent = content;
        return Promise.resolve();
      });

      const handler = handlers[IPC_CHANNELS.SETTINGS.EXPORT];
      await handler({}, exportPath);

      const parsed = JSON.parse(writtenContent);
      expect(parsed.version).toBe('1.0.0');
      expect(parsed.appVersion).toBe('1.0.0');
      expect(parsed.exportDate).toBeDefined();
      expect(parsed.settings).toBeDefined();
    });
  });

  describe('IMPORT handler', () => {
    test('imports settings from provided path', async () => {
      const importPath = '/tmp/import-settings.json';
      const importData = {
        version: '1.0.0',
        settings: { theme: 'light', ollamaHost: 'http://localhost:11434' }
      };
      mockFs.stat.mockResolvedValueOnce({ size: 500 });
      mockFs.readFile.mockResolvedValueOnce(JSON.stringify(importData));

      const handler = handlers[IPC_CHANNELS.SETTINGS.IMPORT];
      const result = await handler({}, importPath);

      expect(result.success).toBe(true);
      expect(mockSettingsService.save).toHaveBeenCalled();
    });

    test('shows open dialog when no path provided', async () => {
      mockShowOpenDialog.mockResolvedValueOnce({
        canceled: false,
        filePaths: ['/tmp/chosen-import.json']
      });
      mockFs.stat.mockResolvedValueOnce({ size: 500 });
      mockFs.readFile.mockResolvedValueOnce(
        JSON.stringify({
          version: '1.0.0',
          settings: { theme: 'dark' }
        })
      );

      const handler = handlers[IPC_CHANNELS.SETTINGS.IMPORT];
      const result = await handler({});

      expect(mockShowOpenDialog).toHaveBeenCalled();
      expect(result.success).toBe(true);
    });

    test('returns canceled when dialog is canceled', async () => {
      mockShowOpenDialog.mockResolvedValueOnce({
        canceled: true
      });

      const handler = handlers[IPC_CHANNELS.SETTINGS.IMPORT];
      const result = await handler({});

      expect(result.success).toBe(false);
      expect(result.canceled).toBe(true);
    });

    test('rejects files larger than 1MB', async () => {
      const importPath = '/tmp/large-settings.json';
      mockFs.stat.mockResolvedValueOnce({ size: 2 * 1024 * 1024 }); // 2MB

      const handler = handlers[IPC_CHANNELS.SETTINGS.IMPORT];
      const result = await handler({}, importPath);

      expect(result.success).toBe(false);
      expect(result.error).toContain('too large');
    });

    test('rejects invalid JSON', async () => {
      const importPath = '/tmp/invalid-settings.json';
      mockFs.stat.mockResolvedValueOnce({ size: 500 });
      mockFs.readFile.mockResolvedValueOnce('not valid json');

      const handler = handlers[IPC_CHANNELS.SETTINGS.IMPORT];
      const result = await handler({}, importPath);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid JSON');
    });

    test('rejects file without settings object', async () => {
      const importPath = '/tmp/no-settings.json';
      mockFs.stat.mockResolvedValueOnce({ size: 500 });
      mockFs.readFile.mockResolvedValueOnce(JSON.stringify({ version: '1.0.0' }));

      const handler = handlers[IPC_CHANNELS.SETTINGS.IMPORT];
      const result = await handler({}, importPath);

      expect(result.success).toBe(false);
      expect(result.error).toContain('missing');
    });

    test('applies imported settings to services', async () => {
      const importPath = '/tmp/import-settings.json';
      const importData = {
        version: '1.0.0',
        settings: {
          theme: 'light',
          ollamaHost: 'http://custom:11434',
          textModel: 'llama3',
          visionModel: 'llava'
        }
      };
      mockFs.stat.mockResolvedValueOnce({ size: 500 });
      mockFs.readFile.mockResolvedValueOnce(JSON.stringify(importData));
      mockSettingsService.save.mockResolvedValueOnce({
        settings: importData.settings,
        validationWarnings: []
      });

      const handler = handlers[IPC_CHANNELS.SETTINGS.IMPORT];
      await handler({}, importPath);

      expect(mockSetOllamaHost).toHaveBeenCalledWith('http://custom:11434');
      expect(mockSetOllamaModel).toHaveBeenCalledWith('llama3');
      expect(mockSetOllamaVisionModel).toHaveBeenCalledWith('llava');
    });
  });

  describe('CREATE_BACKUP handler', () => {
    test('creates backup successfully', async () => {
      const handler = handlers[IPC_CHANNELS.SETTINGS.CREATE_BACKUP];
      const result = await handler({});

      expect(result.success).toBe(true);
      expect(result.path).toBeDefined();
      expect(result.timestamp).toBeDefined();
      expect(mockSettingsService.createBackup).toHaveBeenCalled();
    });

    test('returns error on backup failure', async () => {
      mockSettingsService.createBackup.mockResolvedValueOnce({
        success: false,
        error: 'Disk full'
      });

      const handler = handlers[IPC_CHANNELS.SETTINGS.CREATE_BACKUP];
      const result = await handler({});

      expect(result.success).toBe(false);
      expect(result.error).toBe('Disk full');
    });
  });

  describe('LIST_BACKUPS handler', () => {
    test('lists backups successfully', async () => {
      const handler = handlers[IPC_CHANNELS.SETTINGS.LIST_BACKUPS];
      const result = await handler({});

      expect(result.success).toBe(true);
      expect(result.backups).toHaveLength(1);
      expect(result.backups[0].filename).toBe('settings-2024-01-01.json');
      expect(mockSettingsService.listBackups).toHaveBeenCalled();
    });

    test('returns empty array on error', async () => {
      mockSettingsService.listBackups.mockRejectedValueOnce(new Error('Read error'));

      const handler = handlers[IPC_CHANNELS.SETTINGS.LIST_BACKUPS];
      const result = await handler({});

      expect(result.success).toBe(false);
      expect(result.backups).toEqual([]);
    });
  });

  describe('RESTORE_BACKUP handler', () => {
    test('restores backup successfully', async () => {
      const backupPath = '/tmp/test-app/settings-backups/settings-2024-01-01.json';

      const handler = handlers[IPC_CHANNELS.SETTINGS.RESTORE_BACKUP];
      const result = await handler({}, backupPath);

      expect(result.success).toBe(true);
      expect(mockSettingsService.restoreFromBackup).toHaveBeenCalledWith(backupPath);
    });

    test('applies restored settings to services', async () => {
      const backupPath = '/tmp/test-app/settings-backups/settings-2024-01-01.json';
      mockSettingsService.restoreFromBackup.mockResolvedValueOnce({
        success: true,
        settings: {
          theme: 'light',
          ollamaHost: 'http://restored:11434',
          textModel: 'restored-model'
        }
      });

      const handler = handlers[IPC_CHANNELS.SETTINGS.RESTORE_BACKUP];
      await handler({}, backupPath);

      expect(mockSetOllamaHost).toHaveBeenCalledWith('http://restored:11434');
      expect(mockSetOllamaModel).toHaveBeenCalledWith('restored-model');
    });

    test('notifies settings changed on restore', async () => {
      const backupPath = '/tmp/test-app/settings-backups/settings-2024-01-01.json';

      const handler = handlers[IPC_CHANNELS.SETTINGS.RESTORE_BACKUP];
      await handler({}, backupPath);

      expect(mockOnSettingsChanged).toHaveBeenCalled();
    });

    test('returns error on restore failure', async () => {
      const backupPath = '/tmp/test-app/settings-backups/settings-2024-01-01.json';
      mockSettingsService.restoreFromBackup.mockResolvedValueOnce({
        success: false,
        error: 'Corrupted backup'
      });

      const handler = handlers[IPC_CHANNELS.SETTINGS.RESTORE_BACKUP];
      const result = await handler({}, backupPath);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Corrupted backup');
    });
  });

  describe('DELETE_BACKUP handler', () => {
    test('deletes backup successfully', async () => {
      const backupPath = '/tmp/test-app/settings-backups/settings-2024-01-01.json';

      const handler = handlers[IPC_CHANNELS.SETTINGS.DELETE_BACKUP];
      const result = await handler({}, backupPath);

      expect(result.success).toBe(true);
      expect(mockSettingsService.deleteBackup).toHaveBeenCalledWith(backupPath);
    });

    test('returns error on delete failure', async () => {
      const backupPath = '/tmp/test-app/settings-backups/settings-2024-01-01.json';
      mockSettingsService.deleteBackup.mockResolvedValueOnce({
        success: false,
        error: 'Permission denied'
      });

      const handler = handlers[IPC_CHANNELS.SETTINGS.DELETE_BACKUP];
      const result = await handler({}, backupPath);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Permission denied');
    });
  });

  describe('Security validations', () => {
    test('rejects imported settings with prototype pollution attempts', async () => {
      const importPath = '/tmp/malicious-settings.json';
      // Use raw JSON string because JS object literal __proto__ sets prototype, not own property
      const maliciousJson =
        '{"version":"1.0.0","settings":{"__proto__":{"isAdmin":true},"theme":"dark"}}';
      mockFs.stat.mockResolvedValueOnce({ size: 500 });
      mockFs.readFile.mockResolvedValueOnce(maliciousJson);

      const handler = handlers[IPC_CHANNELS.SETTINGS.IMPORT];
      const result = await handler({}, importPath);

      // Should reject prototype pollution attempts entirely
      expect(result.success).toBe(false);
      expect(result.error).toContain('Prototype pollution');
      expect(mockSettingsService.save).not.toHaveBeenCalled();
    });

    test('rejects unsafe URL patterns in ollamaHost', async () => {
      const importPath = '/tmp/unsafe-settings.json';
      const importData = {
        version: '1.0.0',
        settings: {
          ollamaHost: 'http://0.0.0.0:11434'
        }
      };
      mockFs.stat.mockResolvedValueOnce({ size: 500 });
      mockFs.readFile.mockResolvedValueOnce(JSON.stringify(importData));

      const handler = handlers[IPC_CHANNELS.SETTINGS.IMPORT];
      const result = await handler({}, importPath);

      expect(result.success).toBe(false);
      expect(result.error).toContain('unsafe');
    });
  });
});
