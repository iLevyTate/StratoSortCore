/**
 * @jest-environment node
 */
const path = require('path');
const { IpcServiceContext } = require('../src/main/ipc/IpcServiceContext');
const { IPC_CHANNELS } = require('../src/shared/constants');

// Mock dependencies
jest.mock('fs', () => ({
  promises: {
    stat: jest.fn(),
    mkdir: jest.fn(),
    writeFile: jest.fn(),
    unlink: jest.fn(),
    rm: jest.fn(),
    rename: jest.fn(),
    readdir: jest.fn()
  }
}));

jest.mock('electron', () => ({
  app: {
    getPath: jest.fn((name) => {
      if (name === 'documents') return 'C:\\Users\\Test\\Documents';
      if (name === 'downloads') return 'C:\\Users\\Test\\Downloads';
      return '';
    })
  }
}));

jest.mock('../src/shared/logger', () => {
  const logger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    setContext: jest.fn()
  };
  return { createLogger: jest.fn(() => logger) };
});

jest.mock('../src/main/ipc/ipcWrappers', () => ({
  createHandler: jest.fn(({ handler }) => handler),
  safeHandle: jest.fn(),
  withErrorLogging: jest.fn((logger, handler) => {
    // If handler is passed as second arg, return it (wrapped)
    // If called with just logger, return a wrapper function
    if (typeof handler === 'function') {
      return async (...args) => {
        try {
          return await handler(...args);
        } catch (e) {
          // If logger.error is mocked, we can verify it's called
          logger.error(e);
          throw e; // Re-throw to let test see it or safeHandle catch it
        }
      };
    }
    return (fn) => fn;
  })
}));

jest.mock('../src/main/services/FolderMatchingService', () => ({
  getInstance: jest.fn()
}));

jest.mock('../src/main/services/LlamaService', () => ({
  getInstance: jest.fn()
}));

jest.mock('../src/main/services/SmartFoldersLLMService', () => ({
  enhanceSmartFolderWithLLM: jest.fn()
}));

jest.mock('../src/main/utils/jsonRepair', () => ({
  extractAndParseJSON: jest.fn((json) => JSON.parse(json))
}));

jest.mock('../src/shared/pathSanitization', () => ({
  validateFileOperationPathSync: jest.fn((p) => ({ valid: true, normalizedPath: p }))
}));

jest.mock('../src/shared/crossPlatformUtils', () => ({
  isUNCPath: jest.fn(() => false)
}));

jest.mock('../src/main/analysis/semanticExtensionMap', () => ({
  enrichFolderTextForEmbedding: jest.fn((name, desc) => `${name} ${desc || ''}`),
  enrichFileTextForEmbedding: jest.fn((text) => text)
}));

describe('Smart Folders IPC', () => {
  let mockIpcMain;
  let mockFoldersService;
  let mockServiceIntegration;
  let mockFolderMatcher;
  let mockLlamaService;
  let mockSmartFolderWatcher;
  let safeHandle;
  let registerSmartFoldersIpc;
  let fs;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();

    fs = require('fs').promises;
    safeHandle = require('../src/main/ipc/ipcWrappers').safeHandle;
    const FolderMatchingService = require('../src/main/services/FolderMatchingService');
    const LlamaService = require('../src/main/services/LlamaService');

    // Mock folder matcher
    mockFolderMatcher = {
      initialize: jest.fn().mockResolvedValue(),
      embedText: jest.fn().mockResolvedValue({ vector: [0.1, 0.2, 0.3], model: 'test-model' }),
      generateFolderId: jest.fn(() => 'test-id')
    };
    FolderMatchingService.getInstance.mockReturnValue(mockFolderMatcher);

    // Mock Llama Service
    mockLlamaService = {
      initialize: jest.fn().mockResolvedValue(),
      generateText: jest.fn().mockResolvedValue({ response: '{"index": 1, "reason": "match"}' }),
      getConfig: jest.fn().mockResolvedValue({})
    };
    LlamaService.getInstance.mockReturnValue(mockLlamaService);

    // Mock folders service
    mockFoldersService = {
      getCustomFolders: jest.fn(() => [
        {
          id: '1',
          name: 'Work',
          path: 'C:\\Users\\Test\\Documents\\Work',
          description: 'Work stuff'
        },
        {
          id: 'default-uncategorized',
          name: 'Uncategorized',
          isDefault: true,
          path: 'C:\\Users\\Test\\Documents\\Uncategorized'
        }
      ]),
      setCustomFolders: jest.fn(),
      saveCustomFolders: jest.fn().mockResolvedValue(),
      scanDirectory: jest.fn().mockResolvedValue([])
    };

    // Mock smart folder watcher
    mockSmartFolderWatcher = {
      start: jest.fn().mockResolvedValue(true),
      stop: jest.fn(),
      getStatus: jest.fn().mockReturnValue({ isRunning: true, watchedCount: 5 }),
      isRunning: true,
      scanForUnanalyzedFiles: jest.fn().mockResolvedValue({ scanned: 10, queued: 5 })
    };

    mockServiceIntegration = {
      smartFolderWatcher: mockSmartFolderWatcher
    };

    mockIpcMain = { handle: jest.fn() };
    const mockLogger = require('../src/shared/logger').createLogger();

    const context = {
      ipcMain: mockIpcMain,
      IPC_CHANNELS,
      // Spread folders service methods for createFromLegacyParams
      ...mockFoldersService,
      foldersService: mockFoldersService,
      getServiceIntegration: () => mockServiceIntegration,
      logger: mockLogger,
      // Include direct references expected by createFromLegacyParams if passed as object
      core: { ipcMain: mockIpcMain, IPC_CHANNELS, logger: mockLogger },
      folders: mockFoldersService
    };

    registerSmartFoldersIpc = require('../src/main/ipc/smartFolders');
    registerSmartFoldersIpc(context);
  });

  function getHandler(channel) {
    const call = safeHandle.mock.calls.find((c) => c[1] === channel);
    if (!call) throw new Error(`Handler for ${channel} not registered`);
    return call[2]; // The wrapped handler
  }

  describe('SMART_FOLDERS.MATCH', () => {
    test('matches using embeddings successfully', async () => {
      const handler = getHandler(IPC_CHANNELS.SMART_FOLDERS.MATCH);
      const smartFolders = [
        { name: 'Finance', description: 'Invoices' },
        { name: 'Personal', description: 'Photos' }
      ];

      // Mock embedding similarity
      mockFolderMatcher.embedText
        .mockResolvedValueOnce({ vector: [1, 0, 0] }) // Query
        .mockResolvedValueOnce({ vector: [0.9, 0, 0] }) // Finance (high match)
        .mockResolvedValueOnce({ vector: [0.1, 0, 0] }); // Personal (low match)

      const result = await handler({}, { text: 'invoice.pdf', smartFolders });

      expect(result.success).toBe(true);
      expect(result.folder.name).toBe('Finance');
      expect(result.method).toBe('embeddings');
    });

    test('falls back to LLM when embedding fails', async () => {
      const handler = getHandler(IPC_CHANNELS.SMART_FOLDERS.MATCH);
      const smartFolders = [{ name: 'Finance', description: 'Invoices' }];

      // Force embedding failure
      mockFolderMatcher.embedText.mockRejectedValue(new Error('Embedding failed'));

      const result = await handler({}, { text: 'invoice.pdf', smartFolders });

      expect(result.success).toBe(true);
      expect(result.method).toBe('llm');
      expect(mockLlamaService.generateText).toHaveBeenCalled();
    });
  });

  describe('SMART_FOLDERS.ADD', () => {
    test('adds a new folder successfully', async () => {
      const handler = getHandler(IPC_CHANNELS.SMART_FOLDERS.ADD);
      const { enhanceSmartFolderWithLLM } = require('../src/main/services/SmartFoldersLLMService');
      const newFolder = { name: 'Projects', path: 'C:\\Users\\Test\\Documents\\Projects' };
      enhanceSmartFolderWithLLM.mockResolvedValueOnce({
        improvedDescription: 'Project files and planning docs',
        suggestedKeywords: ['project', 'planning'],
        suggestedCategory: 'work',
        confidence: 92,
        relatedFolders: ['Work', 'MadeUpFolder']
      });

      // Mock path check sequence:
      // 1. Parent dir check (succeeds)
      // 2. Target dir check (fails - ENOENT, triggering creation)
      // 3. Target dir verification (succeeds after creation)
      fs.stat
        .mockResolvedValueOnce({ isDirectory: () => true })
        .mockRejectedValueOnce({ code: 'ENOENT' })
        .mockResolvedValueOnce({ isDirectory: () => true });

      fs.mkdir.mockResolvedValue();
      fs.writeFile.mockResolvedValue(); // Test write
      fs.unlink.mockResolvedValue(); // Cleanup test write

      const result = await handler({}, newFolder);

      if (!result.success) {
        console.error('ADD error:', result);
        throw new Error(`ADD failed: ${result.error} - ${result.details || ''}`);
      }

      expect(result.success).toBe(true);
      expect(result.directoryCreated).toBe(true);
      expect(mockFoldersService.setCustomFolders).toHaveBeenCalled();
      expect(mockFoldersService.saveCustomFolders).toHaveBeenCalled();

      // Initial save uses fallback description; LLM enhancement runs in background
      const savedFolders = mockFoldersService.setCustomFolders.mock.calls[0][0];
      expect(savedFolders).toHaveLength(3); // 2 existing + 1 new
      expect(savedFolders[2].name).toBe('Projects');
      expect(savedFolders[2].description).toBe('Smart folder for Projects');
      expect(savedFolders[2].confidenceScore).toBeCloseTo(0.8, 2);
      expect(savedFolders[2].relatedFolders).toEqual([]);
    });

    test('validates folder name characters', async () => {
      const handler = getHandler(IPC_CHANNELS.SMART_FOLDERS.ADD);
      const invalidFolder = { name: 'Bad:Name', path: 'C:\\Test' };

      const result = await handler({}, invalidFolder);

      expect(result.success).toBe(false);
      expect(result.errorCode).toBeDefined(); // CHECK: Should use proper error code check if exported
    });
  });

  describe('SMART_FOLDERS.SCAN_STRUCTURE', () => {
    test('scans directory structure', async () => {
      const handler = getHandler(IPC_CHANNELS.SMART_FOLDERS.SCAN_STRUCTURE);

      mockFoldersService.scanDirectory.mockResolvedValue([
        { type: 'file', name: 'doc.pdf', path: '/path/doc.pdf', size: 100 },
        { type: 'directory', name: 'sub', children: [] }
      ]);

      const result = await handler({}, 'C:\\Users\\Test\\Documents');

      if (!result.success) {
        console.error('SCAN error:', result);
      }

      expect(result.success).toBe(true);
      expect(result.files).toHaveLength(1);
      expect(result.files[0].name).toBe('doc.pdf');
    });
  });

  describe('SMART_FOLDERS.WATCHER_START', () => {
    test('starts the watcher', async () => {
      const handler = getHandler(IPC_CHANNELS.SMART_FOLDERS.WATCHER_START);

      const result = await handler({}, {});

      expect(mockSmartFolderWatcher.start).toHaveBeenCalled();
      expect(result.success).toBe(true);
    });

    test('returns error if watcher not available', async () => {
      const handler = getHandler(IPC_CHANNELS.SMART_FOLDERS.WATCHER_START);

      // Temporarily remove watcher
      const originalWatcher = mockServiceIntegration.smartFolderWatcher;
      mockServiceIntegration.smartFolderWatcher = null;

      const result = await handler({}, {});

      expect(result.success).toBe(false);
      expect(result.error).toContain('not available');

      // Restore
      mockServiceIntegration.smartFolderWatcher = originalWatcher;
    });
  });
});
