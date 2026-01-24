/**
 * Tests for Settings IPC Handlers
 * Tests settings import validation including UNC paths
 */

// Mock electron app
jest.mock('electron', () => ({
  app: {
    getPath: jest.fn(() => '/mock/user/data'),
    getVersion: jest.fn(() => '1.0.0'),
    setLoginItemSettings: jest.fn()
  },
  dialog: {
    showOpenDialog: jest.fn(),
    showSaveDialog: jest.fn()
  },
  shell: {
    openPath: jest.fn()
  }
}));

// Mock fs promises
jest.mock('fs', () => ({
  promises: {
    stat: jest.fn(),
    readFile: jest.fn(),
    writeFile: jest.fn(),
    rename: jest.fn(),
    unlink: jest.fn(),
    mkdir: jest.fn()
  }
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

// Mock ipcWrappers
jest.mock('../src/main/ipc/ipcWrappers', () => ({
  withErrorLogging: jest.fn((logger, handler) => handler),
  safeHandle: (ipcMain, channel, handler) => {
    ipcMain.handle(channel, handler);
  },
  successResponse: (data) => ({ success: true, ...data }),
  errorResponse: (error) => ({ success: false, error }),
  canceledResponse: () => ({ canceled: true })
}));

// Mock pathSanitization
// We want to test the actual validation logic in settings.js which calls validateFileOperationPathSync
// So we should NOT mock validateFileOperationPathSync if we want to test its integration,
// OR we mock it to return what we expect for UNC paths if we trust pathSanitization tests.
// Since we modified settings.js to pass disallowUNC: false, we should verify that call.
// Let's mock pathSanitization to verify the options passed to it.
jest.mock('../src/shared/pathSanitization', () => ({
  validateFileOperationPathSync: jest.fn((path, allowed, options) => {
    // Return valid if disallowUNC is false and path looks like UNC
    if (path.startsWith('\\\\') || path.startsWith('//')) {
      if (options.disallowUNC) {
        return { valid: false, error: 'UNC not allowed' };
      }
      return { valid: true, normalizedPath: path };
    }
    return { valid: true, normalizedPath: path };
  }),
  // Other exports needed
  sanitizePath: (p) => p
}));

describe('Settings IPC Handlers', () => {
  let registerSettingsIpc;
  let mockIpcMain;
  let handlers;
  let mockSettingsService;
  let fs;

  const IPC_CHANNELS = {
    SETTINGS: {
      GET: 'settings:get',
      SAVE: 'settings:save',
      IMPORT: 'settings:import',
      EXPORT: 'settings:export'
    }
  };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();

    handlers = {};
    mockIpcMain = {
      handle: jest.fn((channel, handler) => {
        handlers[channel] = handler;
      })
    };

    mockSettingsService = {
      load: jest.fn().mockResolvedValue({}),
      save: jest.fn().mockResolvedValue({ settings: {} })
    };

    fs = require('fs').promises;
    registerSettingsIpc = require('../src/main/ipc/settings');
  });

  describe('SETTINGS.IMPORT handler', () => {
    test('accepts UNC paths in defaultSmartFolderLocation', async () => {
      // Setup dependencies
      const deps = {
        ipcMain: mockIpcMain,
        IPC_CHANNELS,
        logger: require('../src/shared/logger').logger,
        settingsService: mockSettingsService,
        onSettingsChanged: jest.fn(),
        setOllamaHost: jest.fn(),
        setOllamaModel: jest.fn(),
        setOllamaVisionModel: jest.fn(),
        setOllamaEmbeddingModel: jest.fn()
      };

      // Mock IpcServiceContext structure
      const container = {
        core: deps,
        settings: deps,
        ollama: deps
      };

      // We need to mock createFromLegacyParams if we pass object
      // But registerSettingsIpc handles IpcServiceContext.
      // Let's just mock the module to export a function that uses our mocks
      // Actually, registerSettingsIpc expects servicesOrParams.

      // Let's use the legacy params style which is easier to mock if we don't have IpcServiceContext class
      // But registerSettingsIpc imports IpcServiceContext.
      // We can just pass a mock object that looks like IpcServiceContext instance
      // or rely on createFromLegacyParams.

      // Let's try to pass the container directly if we mock instanceof check?
      // Or just pass the legacy params object.

      registerSettingsIpc({
        ipcMain: mockIpcMain,
        IPC_CHANNELS,
        logger: require('../src/shared/logger').logger,
        settingsService: mockSettingsService,
        onSettingsChanged: jest.fn(),
        setOllamaHost: jest.fn(),
        setOllamaModel: jest.fn(),
        setOllamaVisionModel: jest.fn(),
        setOllamaEmbeddingModel: jest.fn()
      });

      const handler = handlers[IPC_CHANNELS.SETTINGS.IMPORT];

      // Mock fs.stat and readFile
      fs.stat.mockResolvedValue({ size: 100 });

      const importSettings = {
        defaultSmartFolderLocation: '\\\\server\\share\\SmartFolders',
        lastBrowsedPath: '\\\\server\\share\\Docs'
      };

      fs.readFile.mockResolvedValue(
        JSON.stringify({
          settings: importSettings
        })
      );

      const result = await handler({}, '/path/to/settings.json');

      expect(result.success).toBe(true);
      expect(mockSettingsService.save).toHaveBeenCalledWith(
        expect.objectContaining({
          defaultSmartFolderLocation: '\\\\server\\share\\SmartFolders',
          lastBrowsedPath: '\\\\server\\share\\Docs'
        })
      );

      // Verify validateFileOperationPathSync was called with disallowUNC: false
      const { validateFileOperationPathSync } = require('../src/shared/pathSanitization');
      expect(validateFileOperationPathSync).toHaveBeenCalledWith(
        expect.stringContaining('server'),
        null,
        expect.objectContaining({ disallowUNC: false })
      );
    });
  });
});
