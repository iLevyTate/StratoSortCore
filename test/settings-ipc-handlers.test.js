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

// Mock atomic file operations
jest.mock('../src/shared/atomicFileOperations', () => ({
  backupAndReplace: jest.fn().mockResolvedValue({ success: true }),
  atomicFileOps: {
    safeWriteFile: jest.fn().mockResolvedValue(undefined)
  }
}));

// Mock LlamaService - settings.js now routes all model changes through LlamaService.updateConfig()
const mockLlamaServiceUpdateConfig = jest
  .fn()
  .mockResolvedValue({ success: true, modelDowngraded: false });
jest.mock('../src/main/services/LlamaService', () => ({
  getInstance: () => ({
    updateConfig: mockLlamaServiceUpdateConfig,
    initialize: jest.fn().mockResolvedValue(undefined)
  })
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
      'maxBatchSize',
      // Added keys for comprehensive validation testing
      'notificationMode',
      'notifications',
      'notifyOnAutoAnalysis',
      'notifyOnLowConfidence',
      'namingConvention',
      'caseConvention',
      'separator',
      'dateFormat',
      'confidenceThreshold',
      'maxConcurrentAnalysis',
      'defaultSmartFolderLocation',
      'lastBrowsedPath',
      'graphExpansionEnabled',
      'graphExpansionWeight',
      'graphExpansionMaxNeighbors',
      'chunkContextEnabled',
      'chunkContextMaxNeighbors'
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
  LENIENT_URL_PATTERN:
    /^(?:https?:\/\/)?(?:\[[0-9a-f:]+\]|[\w.-]+|\d{1,3}(?:\.\d{1,3}){3})(?::\d+)?(?:\/.*)?$/i,
  MODEL_NAME_PATTERN: /^(?!.*\.\.)[a-zA-Z0-9][a-zA-Z0-9\-_.@:/]*$/,
  MAX_MODEL_NAME_LENGTH: 100,
  NOTIFICATION_MODES: ['both', 'ui', 'tray', 'none'],
  NAMING_CONVENTIONS: [
    'subject-date',
    'date-subject',
    'project-subject-date',
    'category-subject',
    'keep-original'
  ],
  CASE_CONVENTIONS: [
    'kebab-case',
    'snake_case',
    'camelCase',
    'PascalCase',
    'lowercase',
    'UPPERCASE'
  ],
  SMART_FOLDER_ROUTING_MODES: ['auto', 'llm', 'embedding', 'hybrid'],
  SEPARATOR_PATTERN: /^[^/\\:*?"<>|]+$/,
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
  createHandler: jest.fn(({ handler }) => handler),
  withErrorLogging: (logger, handler) => handler,
  withValidation: (logger, schema, handler) => async (event, data) => {
    // simulate validation behavior if schema is present
    if (schema && schema.safeParse) {
      const result = schema.safeParse(data);
      if (!result.success) {
        return {
          success: false,
          error: 'Validation failed',
          validationErrors: result.error.errors.map((e) => e.message)
        };
      }
      return handler(event, result.data);
    }
    return handler(event, data);
  },
  successResponse: (data = {}, warnings = []) => {
    const response = { success: true, ...data };
    if (warnings && warnings.length > 0) {
      response.warnings = warnings;
    }
    return response;
  },
  errorResponse: (error, extras = {}) => ({ success: false, error, ...extras }),
  canceledResponse: () => ({ success: false, canceled: true }),
  safeHandle: (ipcMain, channel, handler) => {
    ipcMain.handle(channel, handler);
  },
  z: null
}));

const { ipcMain } = require('electron');
const { logger } = require('../src/shared/logger');
const registerSettingsIpc = require('../src/main/ipc/settings');

describe('Settings IPC Handlers', () => {
  let handlers;
  let mockSettingsService;
  let mockOnSettingsChanged;

  const IPC_CHANNELS = {
    SETTINGS: {
      GET: 'settings:get',
      SAVE: 'settings:save',
      GET_CONFIGURABLE_LIMITS: 'settings:get-limits',
      EXPORT: 'settings:export',
      IMPORT: 'settings:import',
      CREATE_BACKUP: 'settings:create-backup',
      LIST_BACKUPS: 'settings:list-backups',
      RESTORE_BACKUP: 'settings:restore-backup',
      DELETE_BACKUP: 'settings:delete-backup'
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
      load: jest.fn().mockResolvedValue({ language: 'en' }),
      save: jest.fn().mockResolvedValue({
        settings: { language: 'en' },
        validationWarnings: []
      }),
      // SECURITY: backupDir is needed for IPC-layer path traversal validation
      backupDir: '/tmp/test-app/settings-backups',
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
        settings: { language: 'en' }
      }),
      deleteBackup: jest.fn().mockResolvedValue({ success: true })
    };

    mockOnSettingsChanged = jest.fn().mockResolvedValue(undefined);

    // Register handlers
    registerSettingsIpc({
      ipcMain,
      IPC_CHANNELS,
      logger,
      settingsService: mockSettingsService,
      onSettingsChanged: mockOnSettingsChanged
    });
  });

  describe('EXPORT handler', () => {
    test('always shows save dialog for security (ignores provided path)', async () => {
      // SECURITY: exportPath parameter is now ignored to prevent path traversal attacks
      const exportPath = '/tmp/export-settings.json';
      mockShowSaveDialog.mockResolvedValueOnce({
        canceled: false,
        filePath: '/tmp/chosen-settings.json'
      });
      mockFs.writeFile.mockResolvedValueOnce(undefined);

      const handler = handlers[IPC_CHANNELS.SETTINGS.EXPORT];
      const result = await handler({}, exportPath);

      // Dialog is always shown, even when path is provided
      expect(mockShowSaveDialog).toHaveBeenCalled();
      expect(result.success).toBe(true);
      expect(result.path).toBe('/tmp/chosen-settings.json');
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
      let writtenContent;
      mockShowSaveDialog.mockResolvedValueOnce({
        canceled: false,
        filePath: '/tmp/export-settings.json'
      });
      mockFs.writeFile.mockImplementationOnce((path, content) => {
        writtenContent = content;
        return Promise.resolve();
      });

      const handler = handlers[IPC_CHANNELS.SETTINGS.EXPORT];
      await handler({});

      const parsed = JSON.parse(writtenContent);
      expect(parsed.version).toBe('1.0.0');
      expect(parsed.appVersion).toBe('1.0.0');
      expect(parsed.exportDate).toBeDefined();
      expect(parsed.settings).toBeDefined();
    });
  });

  describe('IMPORT handler', () => {
    test('always shows open dialog for security (ignores provided path)', async () => {
      // SECURITY: importPath parameter is now ignored to prevent path traversal attacks
      const importPath = '/tmp/import-settings.json';
      const importData = {
        version: '1.0.0',
        settings: { language: 'en' }
      };
      mockShowOpenDialog.mockResolvedValueOnce({
        canceled: false,
        filePaths: ['/tmp/chosen-import.json']
      });
      mockFs.stat.mockResolvedValueOnce({ size: 500 });
      mockFs.readFile.mockResolvedValueOnce(JSON.stringify(importData));

      const handler = handlers[IPC_CHANNELS.SETTINGS.IMPORT];
      const result = await handler({}, importPath);

      // Dialog is always shown, even when path is provided
      expect(mockShowOpenDialog).toHaveBeenCalled();
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
          settings: { language: 'en' }
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
      mockShowOpenDialog.mockResolvedValueOnce({
        canceled: false,
        filePaths: ['/tmp/large-settings.json']
      });
      mockFs.stat.mockResolvedValueOnce({ size: 2 * 1024 * 1024 }); // 2MB

      const handler = handlers[IPC_CHANNELS.SETTINGS.IMPORT];
      const result = await handler({});

      expect(result.success).toBe(false);
      expect(result.error).toContain('too large');
    });

    test('rejects invalid JSON', async () => {
      mockShowOpenDialog.mockResolvedValueOnce({
        canceled: false,
        filePaths: ['/tmp/invalid-settings.json']
      });
      mockFs.stat.mockResolvedValueOnce({ size: 500 });
      mockFs.readFile.mockResolvedValueOnce('not valid json');

      const handler = handlers[IPC_CHANNELS.SETTINGS.IMPORT];
      const result = await handler({});

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid JSON');
    });

    test('rejects file without settings object', async () => {
      mockShowOpenDialog.mockResolvedValueOnce({
        canceled: false,
        filePaths: ['/tmp/no-settings.json']
      });
      mockFs.stat.mockResolvedValueOnce({ size: 500 });
      mockFs.readFile.mockResolvedValueOnce(JSON.stringify({ version: '1.0.0' }));

      const handler = handlers[IPC_CHANNELS.SETTINGS.IMPORT];
      const result = await handler({});

      expect(result.success).toBe(false);
      expect(result.error).toContain('missing');
    });

    test('applies imported settings to services', async () => {
      const importData = {
        version: '1.0.0',
        settings: {
          textModel: 'llama3',
          visionModel: 'llava'
        }
      };
      mockShowOpenDialog.mockResolvedValueOnce({
        canceled: false,
        filePaths: ['/tmp/import-settings.json']
      });
      mockFs.stat.mockResolvedValueOnce({ size: 500 });
      mockFs.readFile.mockResolvedValueOnce(JSON.stringify(importData));
      mockSettingsService.save.mockResolvedValueOnce({
        settings: importData.settings,
        validationWarnings: []
      });

      const handler = handlers[IPC_CHANNELS.SETTINGS.IMPORT];
      await handler({});

      // Settings are now applied via LlamaService.updateConfig() to ensure proper model change notifications
      expect(mockLlamaServiceUpdateConfig).toHaveBeenCalledWith({
        textModel: 'llama3',
        visionModel: 'llava'
      });
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
          textModel: 'restored-model'
        }
      });

      const handler = handlers[IPC_CHANNELS.SETTINGS.RESTORE_BACKUP];
      await handler({}, backupPath);

      // Settings are now applied via LlamaService.updateConfig() to ensure proper model change notifications
      expect(mockLlamaServiceUpdateConfig).toHaveBeenCalledWith({
        textModel: 'restored-model'
      });
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
    // Helper: mock the open dialog so import tests work with the security fix
    // (import handler now always shows dialog, ignoring renderer-supplied paths)
    function mockImportDialog(filePath) {
      mockShowOpenDialog.mockResolvedValueOnce({
        canceled: false,
        filePaths: [filePath || '/tmp/test-import.json']
      });
    }

    test('rejects imported settings with prototype pollution attempts', async () => {
      mockImportDialog('/tmp/malicious-settings.json');
      // Use raw JSON string because JS object literal __proto__ sets prototype, not own property
      const maliciousJson =
        '{"version":"1.0.0","settings":{"__proto__":{"isAdmin":true},"language":"en"}}';
      mockFs.stat.mockResolvedValueOnce({ size: 500 });
      mockFs.readFile.mockResolvedValueOnce(maliciousJson);

      const handler = handlers[IPC_CHANNELS.SETTINGS.IMPORT];
      const result = await handler({});

      // Should reject prototype pollution attempts entirely
      expect(result.success).toBe(false);
      expect(result.error).toContain('Prototype pollution');
      expect(mockSettingsService.save).not.toHaveBeenCalled();
    });

    test('rejects invalid model names', async () => {
      mockImportDialog('/tmp/bad-model-settings.json');
      const importData = {
        version: '1.0.0',
        settings: {
          textModel: 'model with spaces!'
        }
      };
      mockFs.stat.mockResolvedValueOnce({ size: 500 });
      mockFs.readFile.mockResolvedValueOnce(JSON.stringify(importData));

      const handler = handlers[IPC_CHANNELS.SETTINGS.IMPORT];
      const result = await handler({});

      expect(result.success).toBe(false);
      expect(result.error).toContain('textModel');
    });

    test('rejects model names that are too long', async () => {
      mockImportDialog('/tmp/long-model-settings.json');
      const importData = {
        version: '1.0.0',
        settings: {
          visionModel: 'a'.repeat(101)
        }
      };
      mockFs.stat.mockResolvedValueOnce({ size: 500 });
      mockFs.readFile.mockResolvedValueOnce(JSON.stringify(importData));

      const handler = handlers[IPC_CHANNELS.SETTINGS.IMPORT];
      const result = await handler({});

      expect(result.success).toBe(false);
      expect(result.error).toContain('visionModel');
    });

    test('rejects non-boolean for boolean settings', async () => {
      mockImportDialog('/tmp/bad-bool-settings.json');
      const importData = {
        version: '1.0.0',
        settings: {
          launchOnStartup: 'yes'
        }
      };
      mockFs.stat.mockResolvedValueOnce({ size: 500 });
      mockFs.readFile.mockResolvedValueOnce(JSON.stringify(importData));

      const handler = handlers[IPC_CHANNELS.SETTINGS.IMPORT];
      const result = await handler({});

      expect(result.success).toBe(false);
      expect(result.error).toContain('launchOnStartup');
    });

    test('rejects invalid language codes', async () => {
      mockImportDialog('/tmp/bad-lang-settings.json');
      const importData = {
        version: '1.0.0',
        settings: {
          language: 'this-is-way-too-long-for-a-language-code'
        }
      };
      mockFs.stat.mockResolvedValueOnce({ size: 500 });
      mockFs.readFile.mockResolvedValueOnce(JSON.stringify(importData));

      const handler = handlers[IPC_CHANNELS.SETTINGS.IMPORT];
      const result = await handler({});

      expect(result.success).toBe(false);
      expect(result.error).toContain('language');
    });

    test('rejects invalid logging levels', async () => {
      mockImportDialog('/tmp/bad-log-settings.json');
      const importData = {
        version: '1.0.0',
        settings: {
          loggingLevel: 'verbose'
        }
      };
      mockFs.stat.mockResolvedValueOnce({ size: 500 });
      mockFs.readFile.mockResolvedValueOnce(JSON.stringify(importData));

      const handler = handlers[IPC_CHANNELS.SETTINGS.IMPORT];
      const result = await handler({});

      expect(result.success).toBe(false);
      expect(result.error).toContain('loggingLevel');
    });

    test('rejects invalid cacheSize values', async () => {
      mockImportDialog('/tmp/bad-cache-settings.json');
      const importData = {
        version: '1.0.0',
        settings: {
          cacheSize: -100
        }
      };
      mockFs.stat.mockResolvedValueOnce({ size: 500 });
      mockFs.readFile.mockResolvedValueOnce(JSON.stringify(importData));

      const handler = handlers[IPC_CHANNELS.SETTINGS.IMPORT];
      const result = await handler({});

      expect(result.success).toBe(false);
      expect(result.error).toContain('cacheSize');
    });

    test('rejects invalid maxBatchSize values', async () => {
      mockImportDialog('/tmp/bad-batch-settings.json');
      const importData = {
        version: '1.0.0',
        settings: {
          maxBatchSize: 0
        }
      };
      mockFs.stat.mockResolvedValueOnce({ size: 500 });
      mockFs.readFile.mockResolvedValueOnce(JSON.stringify(importData));

      const handler = handlers[IPC_CHANNELS.SETTINGS.IMPORT];
      const result = await handler({});

      expect(result.success).toBe(false);
      expect(result.error).toContain('maxBatchSize');
    });

    test('rejects invalid notificationMode', async () => {
      mockImportDialog('/tmp/bad-notif-settings.json');
      const importData = {
        version: '1.0.0',
        settings: { notificationMode: 'invalid' }
      };
      mockFs.stat.mockResolvedValueOnce({ size: 500 });
      mockFs.readFile.mockResolvedValueOnce(JSON.stringify(importData));

      const handler = handlers[IPC_CHANNELS.SETTINGS.IMPORT];
      const result = await handler({});

      expect(result.success).toBe(false);
      expect(result.error).toContain('notificationMode');
    });

    test('rejects invalid namingConvention', async () => {
      mockImportDialog('/tmp/bad-naming-settings.json');
      const importData = {
        version: '1.0.0',
        settings: { namingConvention: 'invalid' }
      };
      mockFs.stat.mockResolvedValueOnce({ size: 500 });
      mockFs.readFile.mockResolvedValueOnce(JSON.stringify(importData));

      const handler = handlers[IPC_CHANNELS.SETTINGS.IMPORT];
      const result = await handler({});

      expect(result.success).toBe(false);
      expect(result.error).toContain('namingConvention');
    });

    test('rejects invalid caseConvention', async () => {
      mockImportDialog('/tmp/bad-case-settings.json');
      const importData = {
        version: '1.0.0',
        settings: { caseConvention: 'invalid' }
      };
      mockFs.stat.mockResolvedValueOnce({ size: 500 });
      mockFs.readFile.mockResolvedValueOnce(JSON.stringify(importData));

      const handler = handlers[IPC_CHANNELS.SETTINGS.IMPORT];
      const result = await handler({});

      expect(result.success).toBe(false);
      expect(result.error).toContain('caseConvention');
    });

    test('rejects invalid separator', async () => {
      mockImportDialog('/tmp/bad-sep-settings.json');
      const importData = {
        version: '1.0.0',
        settings: { separator: '/' } // Unsafe char
      };
      mockFs.stat.mockResolvedValueOnce({ size: 500 });
      mockFs.readFile.mockResolvedValueOnce(JSON.stringify(importData));

      const handler = handlers[IPC_CHANNELS.SETTINGS.IMPORT];
      const result = await handler({});

      expect(result.success).toBe(false);
      expect(result.error).toContain('separator');
    });

    test('rejects invalid confidenceThreshold', async () => {
      mockImportDialog('/tmp/bad-conf-settings.json');
      const importData = {
        version: '1.0.0',
        settings: { confidenceThreshold: 1.5 }
      };
      mockFs.stat.mockResolvedValueOnce({ size: 500 });
      mockFs.readFile.mockResolvedValueOnce(JSON.stringify(importData));

      const handler = handlers[IPC_CHANNELS.SETTINGS.IMPORT];
      const result = await handler({});

      expect(result.success).toBe(false);
      expect(result.error).toContain('confidenceThreshold');
    });

    test('rejects invalid maxConcurrentAnalysis', async () => {
      mockImportDialog('/tmp/bad-concurrent-settings.json');
      const importData = {
        version: '1.0.0',
        settings: { maxConcurrentAnalysis: 100 }
      };
      mockFs.stat.mockResolvedValueOnce({ size: 500 });
      mockFs.readFile.mockResolvedValueOnce(JSON.stringify(importData));

      const handler = handlers[IPC_CHANNELS.SETTINGS.IMPORT];
      const result = await handler({});

      expect(result.success).toBe(false);
      expect(result.error).toContain('maxConcurrentAnalysis');
    });

    test('rejects invalid path settings', async () => {
      mockImportDialog('/tmp/bad-path-settings.json');
      const importData = {
        version: '1.0.0',
        settings: { defaultSmartFolderLocation: 'a'.repeat(1001) }
      };
      mockFs.stat.mockResolvedValueOnce({ size: 500 });
      mockFs.readFile.mockResolvedValueOnce(JSON.stringify(importData));

      const handler = handlers[IPC_CHANNELS.SETTINGS.IMPORT];
      const result = await handler({});

      expect(result.success).toBe(false);
      expect(result.error).toContain('defaultSmartFolderLocation');
    });

    test('ignores unknown setting keys', async () => {
      mockImportDialog('/tmp/unknown-settings.json');
      const importData = {
        version: '1.0.0',
        settings: {
          // Theme is no longer supported; it is treated like any unknown key.
          theme: 'dark',
          unknownKey: 'some value',
          anotherUnknown: 123
        }
      };
      mockFs.stat.mockResolvedValueOnce({ size: 500 });
      mockFs.readFile.mockResolvedValueOnce(JSON.stringify(importData));

      const handler = handlers[IPC_CHANNELS.SETTINGS.IMPORT];
      const result = await handler({});

      // Should succeed but ignore unknown keys
      expect(result.success).toBe(true);
    });

    test('rejects non-object settings', async () => {
      mockImportDialog('/tmp/non-object-settings.json');
      const importData = {
        version: '1.0.0',
        settings: 'not an object'
      };
      mockFs.stat.mockResolvedValueOnce({ size: 500 });
      mockFs.readFile.mockResolvedValueOnce(JSON.stringify(importData));

      const handler = handlers[IPC_CHANNELS.SETTINGS.IMPORT];
      const result = await handler({});

      expect(result.success).toBe(false);
      expect(result.error).toContain('invalid settings object');
    });
  });

  describe('GET handler', () => {
    test('returns settings from service', async () => {
      const handler = handlers[IPC_CHANNELS.SETTINGS.GET];
      const result = await handler({});

      expect(result).toEqual({ language: 'en' });
      expect(mockSettingsService.load).toHaveBeenCalled();
    });

    test('returns empty object on error', async () => {
      mockSettingsService.load.mockRejectedValueOnce(new Error('Load failed'));

      const handler = handlers[IPC_CHANNELS.SETTINGS.GET];
      const result = await handler({});

      expect(result).toEqual({
        success: false,
        error: 'Load failed',
        settings: {}
      });
    });
  });

  describe('GET_CONFIGURABLE_LIMITS handler', () => {
    test('returns configurable limits', async () => {
      const handler = handlers[IPC_CHANNELS.SETTINGS.GET_CONFIGURABLE_LIMITS];
      const result = await handler({});

      expect(result).toEqual({ maxBatchSize: 1000 });
    });

    test('returns default limits on error', async () => {
      mockSettingsService.load.mockRejectedValueOnce(new Error('Load failed'));

      const handler = handlers[IPC_CHANNELS.SETTINGS.GET_CONFIGURABLE_LIMITS];
      const result = await handler({});

      expect(result).toEqual({ maxBatchSize: 1000 });
    });
  });

  describe('SAVE handler', () => {
    test('saves settings successfully', async () => {
      const handler = handlers[IPC_CHANNELS.SETTINGS.SAVE];
      const result = await handler({}, { language: 'en' });

      expect(result.success).toBe(true);
      expect(mockSettingsService.save).toHaveBeenCalled();
    });

    test('applies settings to services', async () => {
      mockSettingsService.save.mockResolvedValueOnce({
        settings: {
          textModel: 'newmodel',
          visionModel: 'newvision',
          embeddingModel: 'newembedding'
        },
        validationWarnings: []
      });

      const handler = handlers[IPC_CHANNELS.SETTINGS.SAVE];
      await handler(
        {},
        {
          textModel: 'newmodel',
          visionModel: 'newvision',
          embeddingModel: 'newembedding'
        }
      );

      // Settings are now applied via LlamaService.updateConfig() to ensure proper model change notifications
      // This is critical for embedding model changes - FolderMatchingService needs to be notified
      // to clear its cache and reset the vector DB when the embedding model changes
      expect(mockLlamaServiceUpdateConfig).toHaveBeenCalledWith({
        textModel: 'newmodel',
        visionModel: 'newvision',
        embeddingModel: 'newembedding'
      });
    });

    test('notifies settings changed', async () => {
      const handler = handlers[IPC_CHANNELS.SETTINGS.SAVE];
      await handler({}, { language: 'en' });

      expect(mockOnSettingsChanged).toHaveBeenCalled();
    });

    test('preserves new settings fields through validation', async () => {
      const handler = handlers[IPC_CHANNELS.SETTINGS.SAVE];
      const newSettings = {
        notifications: true,
        namingConvention: 'date-subject',
        notificationMode: 'tray',
        maxFileSize: 1024 * 1024 * 50
      };

      const result = await handler({}, newSettings);

      expect(result.success).toBe(true);
      expect(mockSettingsService.save).toHaveBeenCalledWith(expect.objectContaining(newSettings));
    });

    test('handles save failure', async () => {
      const error = new Error('Save failed');
      error.validationErrors = ['error1'];
      error.validationWarnings = ['warning1'];
      mockSettingsService.save.mockRejectedValueOnce(error);

      const handler = handlers[IPC_CHANNELS.SETTINGS.SAVE];
      const result = await handler({}, { language: 'invalid' });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Save failed');
      expect(result.validationErrors).toEqual(['error1']);
      expect(result.validationWarnings).toEqual(['warning1']);
    });

    test('handles null settings input', async () => {
      const handler = handlers[IPC_CHANNELS.SETTINGS.SAVE];
      const result = await handler({}, null);

      expect(result.success).toBe(true);
      expect(mockSettingsService.save).toHaveBeenCalled();
    });

    test('handles non-function onSettingsChanged', async () => {
      // Re-register with non-function onSettingsChanged
      handlers = {};
      ipcMain.handle.mockImplementation((channel, handler) => {
        handlers[channel] = handler;
      });

      registerSettingsIpc({
        ipcMain,
        IPC_CHANNELS,
        logger,
        settingsService: mockSettingsService,
        onSettingsChanged: 'not a function'
      });

      const handler = handlers[IPC_CHANNELS.SETTINGS.SAVE];
      const result = await handler({}, { language: 'en' });

      expect(result.success).toBe(true);
      // Should warn about non-function but not fail
    });

    test('handles onSettingsChanged error', async () => {
      // Re-register with failing onSettingsChanged
      handlers = {};
      ipcMain.handle.mockImplementation((channel, handler) => {
        handlers[channel] = handler;
      });

      registerSettingsIpc({
        ipcMain,
        IPC_CHANNELS,
        logger,
        settingsService: mockSettingsService,
        onSettingsChanged: jest.fn().mockRejectedValue(new Error('Notification failed'))
      });

      const handler = handlers[IPC_CHANNELS.SETTINGS.SAVE];
      const result = await handler({}, { language: 'en' });

      expect(result.success).toBe(true);
      expect(result.propagationSuccess).toBe(false);
    });

    test('handles login item settings error gracefully', async () => {
      // Re-register with mock app throwing error
      handlers = {};
      ipcMain.handle.mockImplementation((channel, handler) => {
        handlers[channel] = handler;
      });

      require('electron').app.setLoginItemSettings.mockImplementationOnce(() => {
        throw new Error('Login item error');
      });

      registerSettingsIpc({
        ipcMain,
        IPC_CHANNELS,
        logger,
        settingsService: {
          ...mockSettingsService,
          // Ensure save returns the setting we are testing
          save: jest.fn().mockResolvedValue({
            settings: { launchOnStartup: true },
            validationWarnings: []
          })
        },
        onSettingsChanged: mockOnSettingsChanged
      });

      const handler = handlers[IPC_CHANNELS.SETTINGS.SAVE];
      // Passing launchOnStartup: true triggers app.setLoginItemSettings
      const result = await handler({}, { launchOnStartup: true });

      expect(result.success).toBe(true);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Failed to set login item settings'),
        expect.any(String)
      );
    });
  });

  describe('Export error handling', () => {
    test('handles write failure during export', async () => {
      mockShowSaveDialog.mockResolvedValueOnce({
        canceled: false,
        filePath: '/tmp/export.json'
      });
      mockFs.writeFile.mockRejectedValueOnce(new Error('Disk full'));

      const handler = handlers[IPC_CHANNELS.SETTINGS.EXPORT];
      const result = await handler({});

      expect(result.success).toBe(false);
      expect(result.error).toContain('Disk full');
    });
  });

  describe('Backup exception handling', () => {
    test('handles createBackup exception', async () => {
      mockSettingsService.createBackup.mockRejectedValueOnce(new Error('IO Error'));

      const handler = handlers[IPC_CHANNELS.SETTINGS.CREATE_BACKUP];
      const result = await handler({});

      expect(result.success).toBe(false);
      expect(result.error).toBe('IO Error');
    });

    test('handles restoreFromBackup exception', async () => {
      mockSettingsService.restoreFromBackup.mockRejectedValueOnce(new Error('Restore IO Error'));

      const handler = handlers[IPC_CHANNELS.SETTINGS.RESTORE_BACKUP];
      // Use a path within the backup directory so IPC-layer validation passes
      const result = await handler({}, '/tmp/test-app/settings-backups/settings-test.json');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Restore IO Error');
    });

    test('handles deleteBackup exception', async () => {
      mockSettingsService.deleteBackup.mockRejectedValueOnce(new Error('Delete IO Error'));

      const handler = handlers[IPC_CHANNELS.SETTINGS.DELETE_BACKUP];
      // Use a path within the backup directory so IPC-layer validation passes
      const result = await handler({}, '/tmp/test-app/settings-backups/settings-test.json');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Delete IO Error');
    });

    test('rejects backup restore with path traversal attempt', async () => {
      const handler = handlers[IPC_CHANNELS.SETTINGS.RESTORE_BACKUP];
      const result = await handler({}, '/etc/passwd');

      expect(result.success).toBe(false);
      expect(result.error).toContain('outside the backup directory');
      expect(mockSettingsService.restoreFromBackup).not.toHaveBeenCalled();
    });

    test('rejects backup delete with path traversal attempt', async () => {
      const handler = handlers[IPC_CHANNELS.SETTINGS.DELETE_BACKUP];
      const result = await handler({}, '/tmp/test-app/settings-backups/../../etc/passwd');

      expect(result.success).toBe(false);
      expect(result.error).toContain('outside the backup directory');
      expect(mockSettingsService.deleteBackup).not.toHaveBeenCalled();
    });
  });
});
