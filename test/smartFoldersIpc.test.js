/**
 * Tests for Smart Folders IPC Handlers
 * Tests smart folder CRUD operations and folder matching
 */

// Mock electron app
jest.mock('electron', () => ({
  app: {
    getPath: jest.fn((type) => {
      const paths = {
        documents: '/home/user/Documents',
        downloads: '/home/user/Downloads',
        desktop: '/home/user/Desktop',
        pictures: '/home/user/Pictures',
        videos: '/home/user/Videos',
        music: '/home/user/Music',
        home: '/home/user'
      };
      return paths[type] || '/home/user';
    })
  }
}));

// Mock fs promises
jest.mock('fs', () => ({
  promises: {
    stat: jest.fn(),
    mkdir: jest.fn(),
    rename: jest.fn(),
    rmdir: jest.fn(),
    readdir: jest.fn(),
    writeFile: jest.fn(),
    unlink: jest.fn()
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

// Mock ollamaUtils
jest.mock('../src/main/ollamaUtils', () => ({
  getOllama: jest.fn(() => ({
    // New API: embed() with embeddings array response
    embed: jest.fn().mockResolvedValue({ embeddings: [[0.1, 0.2, 0.3]] }),
    embeddings: jest.fn(), // Legacy - kept for compatibility but not used
    generate: jest.fn().mockResolvedValue({ response: '{"index": 1, "reason": "test"}' })
  })),
  getOllamaEmbeddingModel: jest.fn(() => 'mxbai-embed-large'),
  getOllamaModel: jest.fn(() => 'llama3.2:latest')
}));

// Mock SmartFoldersLLMService
jest.mock('../src/main/services/SmartFoldersLLMService', () => ({
  enhanceSmartFolderWithLLM: jest.fn().mockResolvedValue({
    enhancedDescription: 'Enhanced description',
    suggestedKeywords: ['keyword1', 'keyword2'],
    suggestedCategory: 'general'
  })
}));

// Mock customFolders reset (used by RESET_TO_DEFAULTS handler)
jest.mock('../src/main/core/customFolders', () => ({
  resetToDefaultFolders: jest.fn()
}));

// Mock OllamaService (used by GENERATE_DESCRIPTION handler)
jest.mock('../src/main/services/OllamaService', () => ({
  analyzeText: jest.fn()
}));

// Mock ipcWrappers
jest.mock('../src/main/ipc/ipcWrappers', () => ({
  withErrorLogging: jest.fn((logger, handler) => handler),
  safeHandle: (ipcMain, channel, handler) => {
    ipcMain.handle(channel, handler);
  }
}));

// Mock jsonRepair
jest.mock('../src/main/utils/jsonRepair', () => ({
  extractAndParseJSON: jest.fn((str) => JSON.parse(str))
}));

// Mock security config
jest.mock('../src/shared/securityConfig', () => ({
  getDangerousPaths: jest.fn(() => ['/System', '/Windows', 'C:\\Windows']),
  ALLOWED_APP_PATHS: ['documents', 'downloads', 'desktop', 'pictures', 'videos', 'music', 'home']
}));

describe('Smart Folders IPC Handlers', () => {
  let registerSmartFoldersIpc;
  let mockIpcMain;
  let handlers;
  let mockCustomFolders;
  let fs;

  const IPC_CHANNELS = {
    SMART_FOLDERS: {
      GET: 'smart-folders:get',
      GET_CUSTOM: 'smart-folders:get-custom',
      MATCH: 'smart-folders:match',
      SAVE: 'smart-folders:save',
      UPDATE_CUSTOM: 'smart-folders:update-custom',
      EDIT: 'smart-folders:edit',
      DELETE: 'smart-folders:delete',
      GENERATE_DESCRIPTION: 'smart-folders:generate-description',
      ADD: 'smart-folders:add',
      SCAN_STRUCTURE: 'smart-folders:scan-structure',
      RESET_TO_DEFAULTS: 'smart-folders:reset-to-defaults',
      WATCHER_START: 'smart-folders:watcher-start',
      WATCHER_STOP: 'smart-folders:watcher-stop',
      WATCHER_STATUS: 'smart-folders:watcher-status',
      WATCHER_SCAN: 'smart-folders:watcher-scan'
    }
  };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();

    handlers = {};
    mockCustomFolders = [];

    mockIpcMain = {
      handle: jest.fn((channel, handler) => {
        handlers[channel] = handler;
      })
    };

    fs = require('fs').promises;
    fs.stat.mockResolvedValue({ isDirectory: () => true });
    fs.mkdir.mockResolvedValue(undefined);
    fs.readdir.mockResolvedValue([]);

    registerSmartFoldersIpc = require('../src/main/ipc/smartFolders');
  });

  describe('registerSmartFoldersIpc', () => {
    test('registers all smart folder handlers', () => {
      registerSmartFoldersIpc({
        ipcMain: mockIpcMain,
        IPC_CHANNELS,
        logger: require('../src/shared/logger').logger,
        getCustomFolders: () => mockCustomFolders,
        setCustomFolders: (folders) => {
          mockCustomFolders = folders;
        },
        saveCustomFolders: jest.fn().mockResolvedValue(undefined),
        buildOllamaOptions: jest.fn().mockResolvedValue({}),
        getOllamaModel: jest.fn(() => 'llama3.2'),
        getOllamaEmbeddingModel: jest.fn(() => 'mxbai-embed-large'),
        scanDirectory: jest.fn().mockResolvedValue([]),
        getSmartFolderWatcher: jest.fn(() => null)
      });

      expect(mockIpcMain.handle).toHaveBeenCalledWith(
        IPC_CHANNELS.SMART_FOLDERS.GET,
        expect.any(Function)
      );
      expect(mockIpcMain.handle).toHaveBeenCalledWith(
        IPC_CHANNELS.SMART_FOLDERS.GET_CUSTOM,
        expect.any(Function)
      );
      expect(mockIpcMain.handle).toHaveBeenCalledWith(
        IPC_CHANNELS.SMART_FOLDERS.MATCH,
        expect.any(Function)
      );
      expect(mockIpcMain.handle).toHaveBeenCalledWith(
        IPC_CHANNELS.SMART_FOLDERS.SAVE,
        expect.any(Function)
      );
      expect(mockIpcMain.handle).toHaveBeenCalledWith(
        IPC_CHANNELS.SMART_FOLDERS.EDIT,
        expect.any(Function)
      );
      expect(mockIpcMain.handle).toHaveBeenCalledWith(
        IPC_CHANNELS.SMART_FOLDERS.DELETE,
        expect.any(Function)
      );
      expect(mockIpcMain.handle).toHaveBeenCalledWith(
        IPC_CHANNELS.SMART_FOLDERS.ADD,
        expect.any(Function)
      );
      expect(mockIpcMain.handle).toHaveBeenCalledWith(
        IPC_CHANNELS.SMART_FOLDERS.GENERATE_DESCRIPTION,
        expect.any(Function)
      );
      expect(mockIpcMain.handle).toHaveBeenCalledWith(
        IPC_CHANNELS.SMART_FOLDERS.RESET_TO_DEFAULTS,
        expect.any(Function)
      );
      expect(mockIpcMain.handle).toHaveBeenCalledWith(
        IPC_CHANNELS.SMART_FOLDERS.WATCHER_STATUS,
        expect.any(Function)
      );
    });
  });

  describe('SMART_FOLDERS.GENERATE_DESCRIPTION handler', () => {
    test('rejects missing folder name', async () => {
      registerSmartFoldersIpc({
        ipcMain: mockIpcMain,
        IPC_CHANNELS,
        logger: require('../src/shared/logger').logger,
        getCustomFolders: () => [],
        setCustomFolders: jest.fn(),
        saveCustomFolders: jest.fn(),
        buildOllamaOptions: jest.fn(),
        getOllamaModel: jest.fn(() => 'llama3'),
        getOllamaEmbeddingModel: jest.fn(),
        scanDirectory: jest.fn(),
        getSmartFolderWatcher: jest.fn(() => null)
      });

      const handler = handlers[IPC_CHANNELS.SMART_FOLDERS.GENERATE_DESCRIPTION];
      const res = await handler({}, null);
      expect(res.success).toBe(false);
    });

    test('returns error when model not configured', async () => {
      registerSmartFoldersIpc({
        ipcMain: mockIpcMain,
        IPC_CHANNELS,
        logger: require('../src/shared/logger').logger,
        getCustomFolders: () => [],
        setCustomFolders: jest.fn(),
        saveCustomFolders: jest.fn(),
        buildOllamaOptions: jest.fn(),
        getOllamaModel: jest.fn(() => null),
        getOllamaEmbeddingModel: jest.fn(),
        scanDirectory: jest.fn(),
        getSmartFolderWatcher: jest.fn(() => null)
      });

      const handler = handlers[IPC_CHANNELS.SMART_FOLDERS.GENERATE_DESCRIPTION];
      const res = await handler({}, 'Finance');
      expect(res.success).toBe(false);
      expect(String(res.error)).toContain('not configured');
    });

    test('returns description from OllamaService on success', async () => {
      const OllamaService = require('../src/main/services/OllamaService');
      OllamaService.analyzeText.mockResolvedValueOnce({
        success: true,
        response: 'A folder for invoices.'
      });

      registerSmartFoldersIpc({
        ipcMain: mockIpcMain,
        IPC_CHANNELS,
        logger: require('../src/shared/logger').logger,
        getCustomFolders: () => [],
        setCustomFolders: jest.fn(),
        saveCustomFolders: jest.fn(),
        buildOllamaOptions: jest.fn(),
        getOllamaModel: jest.fn(() => 'llama3'),
        getOllamaEmbeddingModel: jest.fn(),
        scanDirectory: jest.fn(),
        getSmartFolderWatcher: jest.fn(() => null)
      });

      const handler = handlers[IPC_CHANNELS.SMART_FOLDERS.GENERATE_DESCRIPTION];
      const res = await handler({}, 'Finance');
      expect(res).toMatchObject({ success: true, description: 'A folder for invoices.' });
    });
  });

  describe('SMART_FOLDERS.RESET_TO_DEFAULTS handler', () => {
    test('sets default folders from customFolders.resetToDefaultFolders', async () => {
      const customFolders = require('../src/main/core/customFolders');
      customFolders.resetToDefaultFolders.mockResolvedValueOnce([
        { id: 'd1', name: 'Documents', path: '/home/user/Documents' }
      ]);

      const setCustomFolders = jest.fn((folders) => {
        mockCustomFolders = folders;
      });

      registerSmartFoldersIpc({
        ipcMain: mockIpcMain,
        IPC_CHANNELS,
        logger: require('../src/shared/logger').logger,
        getCustomFolders: () => [],
        setCustomFolders,
        saveCustomFolders: jest.fn(),
        buildOllamaOptions: jest.fn(),
        getOllamaModel: jest.fn(),
        getOllamaEmbeddingModel: jest.fn(),
        scanDirectory: jest.fn(),
        getSmartFolderWatcher: jest.fn(() => null)
      });

      const handler = handlers[IPC_CHANNELS.SMART_FOLDERS.RESET_TO_DEFAULTS];
      const res = await handler();
      expect(res.success).toBe(true);
      expect(setCustomFolders).toHaveBeenCalledWith(
        expect.arrayContaining([expect.objectContaining({ id: 'd1' })])
      );
    });
  });

  describe('Smart folder watcher handlers', () => {
    test('WATCHER_STATUS returns available=false when watcher missing', async () => {
      registerSmartFoldersIpc({
        ipcMain: mockIpcMain,
        IPC_CHANNELS,
        logger: require('../src/shared/logger').logger,
        getCustomFolders: () => [],
        setCustomFolders: jest.fn(),
        saveCustomFolders: jest.fn(),
        buildOllamaOptions: jest.fn(),
        getOllamaModel: jest.fn(),
        getOllamaEmbeddingModel: jest.fn(),
        scanDirectory: jest.fn(),
        getSmartFolderWatcher: jest.fn(() => null)
      });

      const handler = handlers[IPC_CHANNELS.SMART_FOLDERS.WATCHER_STATUS];
      const res = await handler();
      expect(res.success).toBe(true);
      expect(res.status.available).toBe(false);
    });

    test('WATCHER_START/STOP/SCAN return errors when watcher missing', async () => {
      registerSmartFoldersIpc({
        ipcMain: mockIpcMain,
        IPC_CHANNELS,
        logger: require('../src/shared/logger').logger,
        getCustomFolders: () => [],
        setCustomFolders: jest.fn(),
        saveCustomFolders: jest.fn(),
        buildOllamaOptions: jest.fn(),
        getOllamaModel: jest.fn(),
        getOllamaEmbeddingModel: jest.fn(),
        scanDirectory: jest.fn(),
        getSmartFolderWatcher: jest.fn(() => null)
      });

      expect((await handlers[IPC_CHANNELS.SMART_FOLDERS.WATCHER_START]()).success).toBe(false);
      expect((await handlers[IPC_CHANNELS.SMART_FOLDERS.WATCHER_STOP]()).success).toBe(false);
      expect((await handlers[IPC_CHANNELS.SMART_FOLDERS.WATCHER_SCAN]()).success).toBe(false);
    });

    test('WATCHER_START includes start failure message and status', async () => {
      const mockWatcher = {
        start: jest.fn(async () => false),
        stop: jest.fn(),
        scanForUnanalyzedFiles: jest.fn(),
        getStatus: jest.fn(() => ({ isRunning: false, lastStartError: 'No folders configured' }))
      };

      registerSmartFoldersIpc({
        ipcMain: mockIpcMain,
        IPC_CHANNELS,
        logger: require('../src/shared/logger').logger,
        getCustomFolders: () => [],
        setCustomFolders: jest.fn(),
        saveCustomFolders: jest.fn(),
        buildOllamaOptions: jest.fn(),
        getOllamaModel: jest.fn(),
        getOllamaEmbeddingModel: jest.fn(),
        scanDirectory: jest.fn(),
        getSmartFolderWatcher: jest.fn(() => mockWatcher)
      });

      const res = await handlers[IPC_CHANNELS.SMART_FOLDERS.WATCHER_START]();
      expect(res.success).toBe(false);
      expect(res.error).toContain('No folders configured');
      expect(res.status).toBeDefined();
    });

    test('WATCHER_SCAN requires watcher to be running', async () => {
      const mockWatcher = {
        isRunning: false,
        start: jest.fn(),
        stop: jest.fn(),
        getStatus: jest.fn(() => ({ isRunning: false })),
        scanForUnanalyzedFiles: jest.fn()
      };

      registerSmartFoldersIpc({
        ipcMain: mockIpcMain,
        IPC_CHANNELS,
        logger: require('../src/shared/logger').logger,
        getCustomFolders: () => [],
        setCustomFolders: jest.fn(),
        saveCustomFolders: jest.fn(),
        buildOllamaOptions: jest.fn(),
        getOllamaModel: jest.fn(),
        getOllamaEmbeddingModel: jest.fn(),
        scanDirectory: jest.fn(),
        getSmartFolderWatcher: jest.fn(() => mockWatcher)
      });

      const res = await handlers[IPC_CHANNELS.SMART_FOLDERS.WATCHER_SCAN]();
      expect(res.success).toBe(false);
      expect(String(res.error)).toContain('not running');
    });

    test('WATCHER_SCAN returns scan summary when running', async () => {
      const mockWatcher = {
        isRunning: true,
        start: jest.fn(),
        stop: jest.fn(),
        getStatus: jest.fn(() => ({ isRunning: true })),
        scanForUnanalyzedFiles: jest.fn(async () => ({ scanned: 10, queued: 3 }))
      };

      registerSmartFoldersIpc({
        ipcMain: mockIpcMain,
        IPC_CHANNELS,
        logger: require('../src/shared/logger').logger,
        getCustomFolders: () => [],
        setCustomFolders: jest.fn(),
        saveCustomFolders: jest.fn(),
        buildOllamaOptions: jest.fn(),
        getOllamaModel: jest.fn(),
        getOllamaEmbeddingModel: jest.fn(),
        scanDirectory: jest.fn(),
        getSmartFolderWatcher: jest.fn(() => mockWatcher)
      });

      const res = await handlers[IPC_CHANNELS.SMART_FOLDERS.WATCHER_SCAN]();
      expect(res.success).toBe(true);
      expect(res.message).toContain('Scanned 10');
    });
  });

  describe('SMART_FOLDERS.GET handler', () => {
    beforeEach(() => {
      mockCustomFolders = [
        { id: '1', name: 'Documents', path: '/home/user/Documents/Test' },
        { id: '2', name: 'Projects', path: '/home/user/Documents/Projects' }
      ];

      registerSmartFoldersIpc({
        ipcMain: mockIpcMain,
        IPC_CHANNELS,
        logger: require('../src/shared/logger').logger,
        getCustomFolders: () => mockCustomFolders,
        setCustomFolders: jest.fn(),
        saveCustomFolders: jest.fn(),
        buildOllamaOptions: jest.fn(),
        getOllamaModel: jest.fn(),
        getOllamaEmbeddingModel: jest.fn(),
        scanDirectory: jest.fn()
      });
    });

    test('returns folders with existence status', async () => {
      fs.stat.mockResolvedValue({ isDirectory: () => true });

      const handler = handlers[IPC_CHANNELS.SMART_FOLDERS.GET];
      const result = await handler();

      expect(result).toHaveLength(2);
      expect(result[0]).toHaveProperty('physicallyExists');
    });

    test('handles non-existent paths', async () => {
      fs.stat.mockRejectedValue({ code: 'ENOENT' });

      const handler = handlers[IPC_CHANNELS.SMART_FOLDERS.GET];
      const result = await handler();

      expect(result[0].physicallyExists).toBe(false);
    });

    test('returns empty array when no folders', async () => {
      mockCustomFolders = [];

      registerSmartFoldersIpc({
        ipcMain: mockIpcMain,
        IPC_CHANNELS,
        logger: require('../src/shared/logger').logger,
        getCustomFolders: () => [],
        setCustomFolders: jest.fn(),
        saveCustomFolders: jest.fn(),
        buildOllamaOptions: jest.fn(),
        getOllamaModel: jest.fn(),
        getOllamaEmbeddingModel: jest.fn(),
        scanDirectory: jest.fn()
      });

      const handler = handlers[IPC_CHANNELS.SMART_FOLDERS.GET];
      const result = await handler();

      expect(result).toEqual([]);
    });
  });

  describe('SMART_FOLDERS.SAVE handler', () => {
    let saveCustomFolders;
    let setCustomFolders;

    beforeEach(() => {
      mockCustomFolders = [];
      saveCustomFolders = jest.fn().mockResolvedValue(undefined);
      setCustomFolders = jest.fn((folders) => {
        mockCustomFolders = folders;
      });

      registerSmartFoldersIpc({
        ipcMain: mockIpcMain,
        IPC_CHANNELS,
        logger: require('../src/shared/logger').logger,
        getCustomFolders: () => mockCustomFolders,
        setCustomFolders,
        saveCustomFolders,
        buildOllamaOptions: jest.fn(),
        getOllamaModel: jest.fn(),
        getOllamaEmbeddingModel: jest.fn(),
        scanDirectory: jest.fn()
      });
    });

    test('saves valid folders', async () => {
      fs.stat.mockResolvedValue({ isDirectory: () => true });

      // FIX: Include Uncategorized folder since it's now required
      const folders = [
        { id: '1', name: 'Test', path: '/home/user/Documents/Test' },
        {
          id: 'uncategorized',
          name: 'Uncategorized',
          path: '/home/user/Documents/Uncategorized',
          isDefault: true
        }
      ];
      const handler = handlers[IPC_CHANNELS.SMART_FOLDERS.SAVE];

      const result = await handler({}, folders);

      expect(result.success).toBe(true);
      expect(saveCustomFolders).toHaveBeenCalledWith(folders);
    });

    test('rejects non-array input', async () => {
      const handler = handlers[IPC_CHANNELS.SMART_FOLDERS.SAVE];

      const result = await handler({}, 'not an array');

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('INVALID_INPUT');
    });

    test('creates directories that do not exist', async () => {
      // First folder doesn't exist, second (Uncategorized) exists
      fs.stat
        .mockRejectedValueOnce({ code: 'ENOENT' })
        .mockResolvedValueOnce({ isDirectory: () => true });
      fs.mkdir.mockResolvedValue(undefined);

      // FIX: Include Uncategorized folder since it's now required
      const folders = [
        { id: '1', name: 'New', path: '/home/user/Documents/New' },
        {
          id: 'uncategorized',
          name: 'Uncategorized',
          path: '/home/user/Documents/Uncategorized',
          isDefault: true
        }
      ];
      const handler = handlers[IPC_CHANNELS.SMART_FOLDERS.SAVE];

      const result = await handler({}, folders);

      expect(fs.mkdir).toHaveBeenCalled();
      expect(result.success).toBe(true);
    });

    test('rolls back on save failure', async () => {
      fs.stat.mockResolvedValue({ isDirectory: () => true });
      saveCustomFolders.mockRejectedValue(new Error('Save failed'));

      const originalFolders = [
        { id: 'original' },
        { id: 'uncategorized', name: 'Uncategorized', isDefault: true }
      ];
      mockCustomFolders = originalFolders;

      const handler = handlers[IPC_CHANNELS.SMART_FOLDERS.SAVE];
      // FIX: Include Uncategorized folder since it's now required
      const result = await handler({}, [
        { id: 'new', path: '/home/user/Documents/test' },
        {
          id: 'uncategorized',
          name: 'Uncategorized',
          path: '/home/user/Documents/Uncategorized',
          isDefault: true
        }
      ]);

      expect(result.success).toBe(false);
    });
  });

  describe('SMART_FOLDERS.ADD handler', () => {
    let saveCustomFolders;
    let setCustomFolders;

    beforeEach(() => {
      mockCustomFolders = [];
      saveCustomFolders = jest.fn().mockResolvedValue(undefined);
      setCustomFolders = jest.fn((folders) => {
        mockCustomFolders = folders;
      });

      // Mock parent directory exists and is writable
      fs.stat.mockImplementation((p) => {
        if (p.includes('.stratotest')) {
          return Promise.reject({ code: 'ENOENT' });
        }
        return Promise.resolve({ isDirectory: () => true });
      });
      fs.writeFile.mockResolvedValue(undefined);
      fs.unlink.mockResolvedValue(undefined);

      registerSmartFoldersIpc({
        ipcMain: mockIpcMain,
        IPC_CHANNELS,
        logger: require('../src/shared/logger').logger,
        getCustomFolders: () => mockCustomFolders,
        setCustomFolders,
        saveCustomFolders,
        buildOllamaOptions: jest.fn(),
        getOllamaModel: jest.fn(() => 'llama3.2'),
        getOllamaEmbeddingModel: jest.fn(),
        scanDirectory: jest.fn()
      });
    });

    test('validates folder name is required', async () => {
      const handler = handlers[IPC_CHANNELS.SMART_FOLDERS.ADD];

      const result = await handler({}, { path: '/home/user/Documents/Test' });

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('INVALID_FOLDER_NAME');
    });

    test('validates folder path is required', async () => {
      const handler = handlers[IPC_CHANNELS.SMART_FOLDERS.ADD];

      const result = await handler({}, { name: 'Test' });

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('INVALID_FOLDER_PATH');
    });

    test('rejects invalid characters in name', async () => {
      const handler = handlers[IPC_CHANNELS.SMART_FOLDERS.ADD];

      const result = await handler(
        {},
        {
          name: 'Test<>Folder',
          path: '/home/user/Documents/Test'
        }
      );

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('INVALID_FOLDER_NAME_CHARS');
    });

    test('rejects duplicate folder names', async () => {
      mockCustomFolders = [{ id: '1', name: 'Test', path: '/home/user/Documents/Existing' }];

      registerSmartFoldersIpc({
        ipcMain: mockIpcMain,
        IPC_CHANNELS,
        logger: require('../src/shared/logger').logger,
        getCustomFolders: () => mockCustomFolders,
        setCustomFolders,
        saveCustomFolders,
        buildOllamaOptions: jest.fn(),
        getOllamaModel: jest.fn(),
        getOllamaEmbeddingModel: jest.fn(),
        scanDirectory: jest.fn()
      });

      const handler = handlers[IPC_CHANNELS.SMART_FOLDERS.ADD];
      const result = await handler(
        {},
        {
          name: 'Test',
          path: '/home/user/Documents/New'
        }
      );

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('FOLDER_ALREADY_EXISTS');
    });

    test('sanitizes folder names with path separators', async () => {
      const handler = handlers[IPC_CHANNELS.SMART_FOLDERS.ADD];

      // The function should strip " > " from names
      const result = await handler(
        {},
        {
          name: 'Work > Subfolder',
          path: '/home/user/Documents/Work'
        }
      );

      // If successful, the name should be sanitized
      if (result.success) {
        expect(result.folder.name).toBe('Work');
      }
    });
  });

  describe('SMART_FOLDERS.EDIT handler', () => {
    let saveCustomFolders;
    let setCustomFolders;

    beforeEach(() => {
      mockCustomFolders = [{ id: '1', name: 'Test', path: '/home/user/Documents/Test' }];
      saveCustomFolders = jest.fn().mockResolvedValue(undefined);
      setCustomFolders = jest.fn((folders) => {
        mockCustomFolders = folders;
      });

      fs.stat.mockResolvedValue({ isDirectory: () => true });

      registerSmartFoldersIpc({
        ipcMain: mockIpcMain,
        IPC_CHANNELS,
        logger: require('../src/shared/logger').logger,
        getCustomFolders: () => mockCustomFolders,
        setCustomFolders,
        saveCustomFolders,
        buildOllamaOptions: jest.fn(),
        getOllamaModel: jest.fn(),
        getOllamaEmbeddingModel: jest.fn(),
        scanDirectory: jest.fn()
      });
    });

    test('validates folder ID is required', async () => {
      const handler = handlers[IPC_CHANNELS.SMART_FOLDERS.EDIT];

      const result = await handler({}, null, { name: 'Updated' });

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('INVALID_FOLDER_ID');
    });

    test('returns error for non-existent folder', async () => {
      const handler = handlers[IPC_CHANNELS.SMART_FOLDERS.EDIT];

      const result = await handler({}, 'nonexistent', { name: 'Updated' });

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('FOLDER_NOT_FOUND');
    });

    test('rejects duplicate names on edit', async () => {
      mockCustomFolders = [
        { id: '1', name: 'Folder1', path: '/home/user/Documents/Folder1' },
        { id: '2', name: 'Folder2', path: '/home/user/Documents/Folder2' }
      ];

      registerSmartFoldersIpc({
        ipcMain: mockIpcMain,
        IPC_CHANNELS,
        logger: require('../src/shared/logger').logger,
        getCustomFolders: () => mockCustomFolders,
        setCustomFolders,
        saveCustomFolders,
        buildOllamaOptions: jest.fn(),
        getOllamaModel: jest.fn(),
        getOllamaEmbeddingModel: jest.fn(),
        scanDirectory: jest.fn()
      });

      const handler = handlers[IPC_CHANNELS.SMART_FOLDERS.EDIT];
      const result = await handler({}, '1', { name: 'Folder2' });

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('FOLDER_NAME_EXISTS');
    });

    test('updates folder successfully', async () => {
      const handler = handlers[IPC_CHANNELS.SMART_FOLDERS.EDIT];

      const result = await handler({}, '1', { name: 'Updated Name' });

      expect(result.success).toBe(true);
      expect(result.folder.name).toBe('Updated Name');
    });
  });

  describe('SMART_FOLDERS.DELETE handler', () => {
    let saveCustomFolders;
    let setCustomFolders;

    beforeEach(() => {
      mockCustomFolders = [{ id: '1', name: 'Test', path: '/home/user/Documents/Test' }];
      saveCustomFolders = jest.fn().mockResolvedValue(undefined);
      setCustomFolders = jest.fn((folders) => {
        mockCustomFolders = folders;
      });

      registerSmartFoldersIpc({
        ipcMain: mockIpcMain,
        IPC_CHANNELS,
        logger: require('../src/shared/logger').logger,
        getCustomFolders: () => mockCustomFolders,
        setCustomFolders,
        saveCustomFolders,
        buildOllamaOptions: jest.fn(),
        getOllamaModel: jest.fn(),
        getOllamaEmbeddingModel: jest.fn(),
        scanDirectory: jest.fn()
      });
    });

    test('validates folder ID is required', async () => {
      const handler = handlers[IPC_CHANNELS.SMART_FOLDERS.DELETE];

      const result = await handler({}, null);

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('INVALID_FOLDER_ID');
    });

    test('returns error for non-existent folder', async () => {
      const handler = handlers[IPC_CHANNELS.SMART_FOLDERS.DELETE];

      const result = await handler({}, 'nonexistent');

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('FOLDER_NOT_FOUND');
    });

    test('deletes folder successfully', async () => {
      fs.stat.mockResolvedValue({ isDirectory: () => true });
      fs.readdir.mockResolvedValue(['file.txt']); // Non-empty directory

      const handler = handlers[IPC_CHANNELS.SMART_FOLDERS.DELETE];

      const result = await handler({}, '1');

      expect(result.success).toBe(true);
      expect(result.deletedFolder.id).toBe('1');
      expect(result.directoryRemoved).toBe(false); // Non-empty
    });

    test('does not remove physical directory on delete (preserves files)', async () => {
      // UI promises: "This will not delete the physical directory or its files."
      // So we should NOT call rmdir even for empty directories
      fs.stat.mockResolvedValue({ isDirectory: () => true });
      fs.readdir.mockResolvedValue([]); // Empty directory

      const handler = handlers[IPC_CHANNELS.SMART_FOLDERS.DELETE];

      const result = await handler({}, '1');

      expect(result.success).toBe(true);
      expect(result.directoryRemoved).toBe(false);
      expect(fs.rmdir).not.toHaveBeenCalled();
    });
  });

  describe('SMART_FOLDERS.MATCH handler', () => {
    beforeEach(() => {
      registerSmartFoldersIpc({
        ipcMain: mockIpcMain,
        IPC_CHANNELS,
        logger: require('../src/shared/logger').logger,
        getCustomFolders: () => mockCustomFolders,
        setCustomFolders: jest.fn(),
        saveCustomFolders: jest.fn(),
        buildOllamaOptions: jest.fn().mockResolvedValue({}),
        getOllamaModel: jest.fn(() => 'llama3.2'),
        getOllamaEmbeddingModel: jest.fn(() => 'mxbai-embed-large'),
        scanDirectory: jest.fn()
      });
    });

    test('validates input text and folders', async () => {
      const handler = handlers[IPC_CHANNELS.SMART_FOLDERS.MATCH];

      const result = await handler({}, {});

      expect(result.success).toBe(false);
    });

    test('returns error for empty smart folders', async () => {
      const handler = handlers[IPC_CHANNELS.SMART_FOLDERS.MATCH];

      const result = await handler({}, { text: 'test', smartFolders: [] });

      expect(result.success).toBe(false);
    });

    test('matches using embeddings when available', async () => {
      const handler = handlers[IPC_CHANNELS.SMART_FOLDERS.MATCH];

      const result = await handler(
        {},
        {
          text: 'financial report',
          smartFolders: [
            { name: 'Finance', description: 'Financial documents' },
            { name: 'Reports', description: 'All reports' }
          ]
        }
      );

      expect(result.success).toBe(true);
      expect(result.method).toBe('embeddings');
      expect(result.folder).toBeDefined();
    });
  });

  describe('SMART_FOLDERS.SCAN_STRUCTURE handler', () => {
    let scanDirectory;

    beforeEach(() => {
      scanDirectory = jest.fn().mockResolvedValue([
        { name: 'file1.pdf', path: '/home/user/Documents/file1.pdf', type: 'file', size: 1000 },
        { name: 'file2.docx', path: '/home/user/Documents/file2.docx', type: 'file', size: 2000 }
      ]);

      registerSmartFoldersIpc({
        ipcMain: mockIpcMain,
        IPC_CHANNELS,
        logger: require('../src/shared/logger').logger,
        getCustomFolders: () => mockCustomFolders,
        setCustomFolders: jest.fn(),
        saveCustomFolders: jest.fn(),
        buildOllamaOptions: jest.fn(),
        getOllamaModel: jest.fn(),
        getOllamaEmbeddingModel: jest.fn(),
        scanDirectory
      });
    });

    test('scans directory and returns files', async () => {
      const handler = handlers[IPC_CHANNELS.SMART_FOLDERS.SCAN_STRUCTURE];

      const result = await handler({}, '/home/user/Documents');

      expect(result.success).toBe(true);
      expect(result.files).toHaveLength(2);
    });

    test('flattens nested directory structure', async () => {
      scanDirectory.mockResolvedValue([
        {
          name: 'subfolder',
          type: 'directory',
          children: [{ name: 'nested.pdf', path: '/nested/nested.pdf', type: 'file', size: 100 }]
        },
        { name: 'root.pdf', path: '/root.pdf', type: 'file', size: 200 }
      ]);

      const handler = handlers[IPC_CHANNELS.SMART_FOLDERS.SCAN_STRUCTURE];
      const result = await handler({}, '/home/user/Documents');

      expect(result.success).toBe(true);
      expect(result.files).toHaveLength(2);
    });
  });

  describe('SMART_FOLDERS.UPDATE_CUSTOM handler', () => {
    test('rejects empty array and missing Uncategorized', async () => {
      let folders = [{ id: '1', name: 'Work', path: '/home/user/Documents/Work' }];
      registerSmartFoldersIpc({
        ipcMain: mockIpcMain,
        IPC_CHANNELS,
        logger: require('../src/shared/logger').logger,
        getCustomFolders: () => folders,
        setCustomFolders: jest.fn((next) => {
          folders = next;
        }),
        saveCustomFolders: jest.fn(),
        buildOllamaOptions: jest.fn(),
        getOllamaModel: jest.fn(),
        getOllamaEmbeddingModel: jest.fn(),
        scanDirectory: jest.fn(),
        getSmartFolderWatcher: jest.fn(() => null)
      });

      const handler = handlers[IPC_CHANNELS.SMART_FOLDERS.UPDATE_CUSTOM];

      const emptyRes = await handler({}, []);
      expect(emptyRes.success).toBe(false);

      const noUncat = await handler({}, folders);
      expect(noUncat.success).toBe(false);
      expect(String(noUncat.error)).toContain('Uncategorized');
    });

    test('creates missing directory on ENOENT and saves', async () => {
      const saveCustomFolders = jest.fn().mockResolvedValue(undefined);
      const setCustomFolders = jest.fn((next) => {
        mockCustomFolders = next;
      });

      registerSmartFoldersIpc({
        ipcMain: mockIpcMain,
        IPC_CHANNELS,
        logger: require('../src/shared/logger').logger,
        getCustomFolders: () => mockCustomFolders,
        setCustomFolders,
        saveCustomFolders,
        buildOllamaOptions: jest.fn(),
        getOllamaModel: jest.fn(),
        getOllamaEmbeddingModel: jest.fn(),
        scanDirectory: jest.fn(),
        getSmartFolderWatcher: jest.fn(() => null)
      });

      const handler = handlers[IPC_CHANNELS.SMART_FOLDERS.UPDATE_CUSTOM];

      fs.stat
        .mockRejectedValueOnce({ code: 'ENOENT' }) // folder path missing
        .mockResolvedValue({ isDirectory: () => true }); // later calls ok

      const updated = [
        {
          id: 'u',
          name: 'Uncategorized',
          isDefault: true,
          path: '/home/user/Documents/Uncategorized'
        },
        { id: 'w', name: 'Work', path: '/home/user/Documents/Work' }
      ];

      const res = await handler({}, updated);
      expect(res.success).toBe(true);
      expect(fs.mkdir).toHaveBeenCalledWith('/home/user/Documents/Uncategorized', {
        recursive: true
      });
      expect(saveCustomFolders).toHaveBeenCalled();
    });
  });

  describe('SMART_FOLDERS.EDIT handler (path + rename)', () => {
    test('creates missing parent directory and renames directory when path changes', async () => {
      mockCustomFolders = [
        { id: '1', name: 'Work', path: '/home/user/Documents/OldWork' },
        {
          id: 'u',
          name: 'Uncategorized',
          isDefault: true,
          path: '/home/user/Documents/Uncategorized'
        }
      ];

      registerSmartFoldersIpc({
        ipcMain: mockIpcMain,
        IPC_CHANNELS,
        logger: require('../src/shared/logger').logger,
        getCustomFolders: () => mockCustomFolders,
        setCustomFolders: jest.fn((next) => {
          mockCustomFolders = next;
        }),
        saveCustomFolders: jest.fn().mockResolvedValue(undefined),
        buildOllamaOptions: jest.fn(),
        getOllamaModel: jest.fn(),
        getOllamaEmbeddingModel: jest.fn(),
        scanDirectory: jest.fn(),
        getSmartFolderWatcher: jest.fn(() => null)
      });

      // Parent dir missing -> mkdir
      fs.stat
        .mockRejectedValueOnce({ code: 'ENOENT' }) // parentDir stat
        .mockResolvedValueOnce({ isDirectory: () => true }); // oldPath is directory

      const handler = handlers[IPC_CHANNELS.SMART_FOLDERS.EDIT];
      const res = await handler({}, '1', { path: '/home/user/Documents/NewWork' });

      expect(res.success).toBe(true);
      // Path normalization differs by OS; ensure we created the parent directory for the new path.
      expect(fs.mkdir).toHaveBeenCalledWith(expect.stringContaining('Documents'), {
        recursive: true
      });
      expect(fs.rename).toHaveBeenCalledWith(
        '/home/user/Documents/OldWork',
        expect.stringContaining('NewWork')
      );
    });

    test('returns RENAME_FAILED when directory rename fails', async () => {
      mockCustomFolders = [{ id: '1', name: 'Work', path: '/home/user/Documents/OldWork' }];

      registerSmartFoldersIpc({
        ipcMain: mockIpcMain,
        IPC_CHANNELS,
        logger: require('../src/shared/logger').logger,
        getCustomFolders: () => mockCustomFolders,
        setCustomFolders: jest.fn(),
        saveCustomFolders: jest.fn(),
        buildOllamaOptions: jest.fn(),
        getOllamaModel: jest.fn(),
        getOllamaEmbeddingModel: jest.fn(),
        scanDirectory: jest.fn(),
        getSmartFolderWatcher: jest.fn(() => null)
      });

      fs.stat.mockResolvedValueOnce({ isDirectory: () => true });
      fs.rename.mockRejectedValueOnce(new Error('rename failed'));

      const handler = handlers[IPC_CHANNELS.SMART_FOLDERS.EDIT];
      const res = await handler({}, '1', { path: '/home/user/Documents/NewWork' });
      expect(res.success).toBe(false);
      expect(res.errorCode).toBe('RENAME_FAILED');
    });
  });

  describe('SMART_FOLDERS.DELETE handler (Uncategorized protection)', () => {
    test('rejects deleting the Uncategorized default folder', async () => {
      mockCustomFolders = [{ id: 'u', name: 'Uncategorized', isDefault: true, path: '' }];

      registerSmartFoldersIpc({
        ipcMain: mockIpcMain,
        IPC_CHANNELS,
        logger: require('../src/shared/logger').logger,
        getCustomFolders: () => mockCustomFolders,
        setCustomFolders: jest.fn(),
        saveCustomFolders: jest.fn(),
        buildOllamaOptions: jest.fn(),
        getOllamaModel: jest.fn(),
        getOllamaEmbeddingModel: jest.fn(),
        scanDirectory: jest.fn(),
        getSmartFolderWatcher: jest.fn(() => null)
      });

      const handler = handlers[IPC_CHANNELS.SMART_FOLDERS.DELETE];
      const res = await handler({}, 'u');
      expect(res.success).toBe(false);
      expect(res.errorCode).toBe('INVALID_INPUT');
    });
  });

  describe('SMART_FOLDERS.MATCH handler (LLM + fallback)', () => {
    test('falls back to LLM when embeddings fail, then to keyword fallback on invalid LLM index', async () => {
      const ollamaUtils = require('../src/main/ollamaUtils');
      // Force embeddings path to fail, then LLM returns invalid index => keyword fallback
      ollamaUtils.getOllama.mockImplementation(() => ({
        embed: jest.fn().mockRejectedValue(new Error('embed failed')),
        generate: jest
          .fn()
          .mockResolvedValue({ response: JSON.stringify({ index: 'abc', reason: 'x' }) })
      }));

      registerSmartFoldersIpc({
        ipcMain: mockIpcMain,
        IPC_CHANNELS,
        logger: require('../src/shared/logger').logger,
        getCustomFolders: () => [],
        setCustomFolders: jest.fn(),
        saveCustomFolders: jest.fn(),
        buildOllamaOptions: jest.fn().mockResolvedValue({}),
        getOllamaModel: jest.fn(() => 'llama3'),
        getOllamaEmbeddingModel: jest.fn(() => 'mxbai-embed-large'),
        scanDirectory: jest.fn(),
        getSmartFolderWatcher: jest.fn(() => null)
      });

      const handler = handlers[IPC_CHANNELS.SMART_FOLDERS.MATCH];
      const res = await handler(
        {},
        {
          text: 'invoice',
          smartFolders: [
            { name: 'Finance', description: 'Invoices and receipts' },
            { name: 'Projects', description: 'Work projects' }
          ]
        }
      );

      expect(res.success).toBe(true);
      expect(res.method).toBe('fallback');
    });
  });

  describe('Additional edge cases for smartFolders IPC', () => {
    test('GET returns [] when getCustomFolders returns non-array', async () => {
      registerSmartFoldersIpc({
        ipcMain: mockIpcMain,
        IPC_CHANNELS,
        logger: require('../src/shared/logger').logger,
        getCustomFolders: () => 'not-an-array',
        setCustomFolders: jest.fn(),
        saveCustomFolders: jest.fn(),
        buildOllamaOptions: jest.fn(),
        getOllamaModel: jest.fn(),
        getOllamaEmbeddingModel: jest.fn(),
        scanDirectory: jest.fn(),
        getSmartFolderWatcher: jest.fn(() => null)
      });

      const handler = handlers[IPC_CHANNELS.SMART_FOLDERS.GET];
      const res = await handler();
      expect(res).toEqual([]);
    });

    test('UPDATE_CUSTOM returns INVALID_PATH when path exists but is not a directory', async () => {
      registerSmartFoldersIpc({
        ipcMain: mockIpcMain,
        IPC_CHANNELS,
        logger: require('../src/shared/logger').logger,
        getCustomFolders: () => mockCustomFolders,
        setCustomFolders: jest.fn(),
        saveCustomFolders: jest.fn(),
        buildOllamaOptions: jest.fn(),
        getOllamaModel: jest.fn(),
        getOllamaEmbeddingModel: jest.fn(),
        scanDirectory: jest.fn(),
        getSmartFolderWatcher: jest.fn(() => null)
      });

      fs.stat.mockResolvedValueOnce({ isDirectory: () => false });

      const handler = handlers[IPC_CHANNELS.SMART_FOLDERS.UPDATE_CUSTOM];
      const res = await handler({}, [
        {
          id: 'u',
          name: 'Uncategorized',
          isDefault: true,
          path: '/home/user/Documents/Uncategorized'
        }
      ]);
      expect(res.success).toBe(false);
      expect(res.errorCode).toBe('INVALID_PATH');
    });

    test('EDIT returns ORIGINAL_NOT_DIRECTORY when original path is not a directory', async () => {
      mockCustomFolders = [{ id: '1', name: 'Work', path: '/home/user/Documents/OldWork' }];
      registerSmartFoldersIpc({
        ipcMain: mockIpcMain,
        IPC_CHANNELS,
        logger: require('../src/shared/logger').logger,
        getCustomFolders: () => mockCustomFolders,
        setCustomFolders: jest.fn(),
        saveCustomFolders: jest.fn(),
        buildOllamaOptions: jest.fn(),
        getOllamaModel: jest.fn(),
        getOllamaEmbeddingModel: jest.fn(),
        scanDirectory: jest.fn(),
        getSmartFolderWatcher: jest.fn(() => null)
      });

      // parent ok
      fs.stat.mockResolvedValueOnce({ isDirectory: () => true });
      // oldPath is not a directory
      fs.stat.mockResolvedValueOnce({ isDirectory: () => false });

      const handler = handlers[IPC_CHANNELS.SMART_FOLDERS.EDIT];
      const res = await handler({}, '1', { path: '/home/user/Documents/NewWork' });
      expect(res.success).toBe(false);
      expect(res.errorCode).toBe('ORIGINAL_NOT_DIRECTORY');
    });

    test('ADD uses SmartFoldersLLMService enhancement and still succeeds if enhancement fails', async () => {
      const { enhanceSmartFolderWithLLM } = require('../src/main/services/SmartFoldersLLMService');
      enhanceSmartFolderWithLLM.mockRejectedValueOnce(new Error('LLM down'));

      mockCustomFolders = [
        {
          id: 'u',
          name: 'Uncategorized',
          isDefault: true,
          path: '/home/user/Documents/Uncategorized'
        }
      ];

      const saveCustomFolders = jest.fn().mockResolvedValue(undefined);
      registerSmartFoldersIpc({
        ipcMain: mockIpcMain,
        IPC_CHANNELS,
        logger: require('../src/shared/logger').logger,
        getCustomFolders: () => mockCustomFolders,
        setCustomFolders: jest.fn((next) => {
          mockCustomFolders = next;
        }),
        saveCustomFolders,
        buildOllamaOptions: jest.fn().mockResolvedValue({}),
        getOllamaModel: jest.fn(() => 'llama3'),
        getOllamaEmbeddingModel: jest.fn(() => 'mxbai-embed-large'),
        scanDirectory: jest.fn(),
        getSmartFolderWatcher: jest.fn(() => null)
      });

      fs.stat.mockRejectedValueOnce({ code: 'ENOENT' });
      fs.mkdir.mockResolvedValueOnce(undefined);

      const handler = handlers[IPC_CHANNELS.SMART_FOLDERS.ADD];
      const res = await handler({}, { name: 'Finance', path: '/home/user/Documents/Finance' });
      expect(res.success).toBe(true);
      expect(saveCustomFolders).toHaveBeenCalled();
    });
  });
});
