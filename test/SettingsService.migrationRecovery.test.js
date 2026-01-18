/**
 * Focused tests for SettingsService migration + auto-recovery paths
 */

jest.mock('electron', () => ({
  app: {
    getPath: jest.fn().mockReturnValue('/tmp/test-app'),
    getVersion: jest.fn().mockReturnValue('1.0.0')
  },
  BrowserWindow: {
    getAllWindows: jest.fn().mockReturnValue([])
  }
}));

const mockFs = {
  readFile: jest.fn(),
  writeFile: jest.fn().mockResolvedValue(undefined),
  mkdir: jest.fn().mockResolvedValue(undefined),
  readdir: jest.fn().mockResolvedValue([]),
  stat: jest.fn(),
  access: jest.fn().mockResolvedValue(undefined),
  unlink: jest.fn().mockResolvedValue(undefined),
  rename: jest.fn().mockResolvedValue(undefined)
};

const mockFsSync = {
  existsSync: jest.fn().mockReturnValue(true),
  mkdirSync: jest.fn(),
  watch: jest.fn().mockReturnValue({
    on: jest.fn().mockReturnThis(),
    close: jest.fn()
  })
};

jest.mock('fs', () => ({
  promises: mockFs,
  existsSync: (...args) => mockFsSync.existsSync(...args),
  mkdirSync: (...args) => mockFsSync.mkdirSync(...args),
  watch: (...args) => mockFsSync.watch(...args),
  constants: { R_OK: 4, W_OK: 2 }
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

jest.mock('../src/shared/settingsValidation', () => ({
  validateSettings: jest.fn().mockReturnValue({ valid: true, errors: [], warnings: [] }),
  sanitizeSettings: jest.fn((s) => s),
  getConfigurableLimits: jest.fn(() => ({}))
}));

jest.mock('../src/shared/defaultSettings', () => ({
  DEFAULT_SETTINGS: {
    confidenceThreshold: 0.7
  }
}));

jest.mock('../src/shared/atomicFileOperations', () => ({
  backupAndReplace: jest.fn().mockResolvedValue({ success: true })
}));

// Mock SettingsBackupService used internally by SettingsService
const mockBackupService = {
  listBackups: jest.fn(),
  restoreBackup: jest.fn(),
  restoreFromBackup: jest.fn(),
  createBackup: jest.fn().mockResolvedValue({ success: true, path: '/tmp/backup.json' }),
  cleanupOldBackups: jest.fn(),
  deleteBackup: jest.fn()
};
jest.mock('../src/main/services/SettingsBackupService', () => ({
  SettingsBackupService: jest.fn().mockImplementation(() => mockBackupService)
}));

describe('SettingsService migration + recovery', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
    mockBackupService.listBackups.mockReset();
    mockBackupService.restoreBackup.mockReset();

    // Default: settings.json missing
    mockFs.readFile.mockRejectedValue({ code: 'ENOENT' });

    // Default: legacy configs missing
    mockFs.access.mockImplementation((p) => {
      if (String(p).includes('ollama-config.json') || String(p).includes('model-config.json')) {
        return Promise.reject({ code: 'ENOENT' });
      }
      return Promise.resolve();
    });
  });

  test('load attempts auto-recovery from latest backup when settings.json is corrupted', async () => {
    const SettingsService = require('../src/main/services/SettingsService');
    const svc = new SettingsService();

    // Corrupted settings file
    mockFs.readFile
      .mockResolvedValueOnce('not valid json')
      // after restoreBackup, SettingsService re-reads settingsPath
      .mockResolvedValueOnce(JSON.stringify({ language: 'en' }));

    mockBackupService.listBackups.mockResolvedValueOnce([
      { filename: 'settings-2026-01-01.json', path: '/tmp/settings-2026-01-01.json' }
    ]);
    // Ensure restoreFromBackup invokes the callback to simulate save
    mockBackupService.restoreFromBackup.mockImplementation(async (path, callback) => {
      if (callback) await callback({ language: 'en' });
      return { success: true };
    });

    const settings = await svc.load();
    expect(settings.language).toBe('en');
    expect(mockBackupService.restoreFromBackup).toHaveBeenCalled();
  });

  test('migrateLegacyConfig imports legacy configs, saves settings, and archives legacy files', async () => {
    const { backupAndReplace } = require('../src/shared/atomicFileOperations');
    const SettingsService = require('../src/main/services/SettingsService');
    const svc = new SettingsService();

    // Mark legacy files as existing
    mockFs.access.mockResolvedValue(undefined);
    mockFs.access.mockImplementation((p) => Promise.resolve());

    // Legacy file contents
    mockFs.readFile.mockImplementation((p) => {
      const s = String(p);
      if (s.includes('ollama-config.json')) {
        return Promise.resolve(
          JSON.stringify({
            host: 'http://localhost:11434',
            selectedTextModel: 'llama3',
            selectedVisionModel: 'llava',
            selectedEmbeddingModel: 'mxbai-embed-large'
          })
        );
      }
      if (s.includes('model-config.json')) {
        return Promise.resolve(JSON.stringify({ selectedModel: 'llama3' }));
      }
      // settings.json doesn't exist yet
      if (String(p).includes('settings.json')) {
        return Promise.reject({ code: 'ENOENT' });
      }
      return Promise.reject({ code: 'ENOENT', path: p });
    });

    await svc.migrateLegacyConfig();

    expect(backupAndReplace).toHaveBeenCalledWith(
      expect.stringContaining('settings.json'),
      expect.stringContaining('"ollamaHost"')
    );
    expect(mockFs.rename).toHaveBeenCalledWith(
      expect.stringContaining('ollama-config.json'),
      expect.stringContaining('.migrated.bak')
    );
    expect(mockFs.rename).toHaveBeenCalledWith(
      expect.stringContaining('model-config.json'),
      expect.stringContaining('.migrated.bak')
    );
  });
});
