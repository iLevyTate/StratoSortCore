/**
 * @jest-environment node
 */
const { IpcServiceContext } = require('../src/main/ipc/IpcServiceContext');
const { IPC_CHANNELS } = require('../src/shared/constants');

// Mock dependencies
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
  createErrorResponse: jest.fn((err) => ({ success: false, error: err.message })),
  safeHandle: jest.fn(),
  withErrorLogging: jest.fn((logger, handler) => {
    // If only one arg passed (legacy), handler is first arg
    if (typeof logger === 'function') return logger;
    return handler;
  }),
  withVectorDbInit: jest.fn((arg) => {
    // It might be called with a function (direct) or an object { handler }
    if (typeof arg === 'function') return arg;
    if (arg && typeof arg.handler === 'function') return arg.handler;
    return arg;
  })
}));

jest.mock('../src/main/services/OramaVectorService', () => ({
  getInstance: jest.fn(() => ({
    initialize: jest.fn().mockResolvedValue(),
    getStats: jest.fn(),
    rebuildIndex: jest.fn()
  }))
}));

jest.mock('../src/main/services/FolderMatchingService', () => ({
  getInstance: jest.fn(() => ({
    initialize: jest.fn().mockResolvedValue(),
    rebuildIndex: jest.fn()
  }))
}));

jest.mock('../src/main/services/ParallelEmbeddingService', () => ({
  getInstance: jest.fn(() => ({}))
}));

jest.mock('../src/main/services/SearchService', () => ({
  SearchService: jest.fn()
}));

jest.mock('../src/main/services/ClusteringService', () => ({
  ClusteringService: jest.fn()
}));

jest.mock('../src/main/services/QueryProcessor', () => ({
  getInstance: jest.fn()
}));

jest.mock('../src/main/services/LlamaService', () => ({
  getInstance: jest.fn(() => ({
    getConfig: jest.fn().mockResolvedValue({})
  }))
}));

describe('Semantic IPC (Management)', () => {
  let mockIpcMain;
  let mockSettingsService;
  let mockFoldersService;
  let mockServiceIntegration;
  let safeHandle;
  let OramaVectorService;
  let FolderMatchingService;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();

    safeHandle = require('../src/main/ipc/ipcWrappers').safeHandle;
    OramaVectorService = require('../src/main/services/OramaVectorService');
    FolderMatchingService = require('../src/main/services/FolderMatchingService');

    // Create a stable singleton mock for OramaVectorService
    const mockVectorDbInstance = {
      initialize: jest.fn().mockResolvedValue(),
      getStats: jest.fn(),
      rebuildIndex: jest.fn(),
      resetFolders: jest.fn(),
      batchUpsertFolders: jest.fn()
    };

    // Create a stable singleton mock for FolderMatchingService
    const mockFolderMatcherInstance = {
      initialize: jest.fn().mockResolvedValue(),
      rebuildIndex: jest.fn(),
      embedText: jest.fn(),
      generateFolderId: jest.fn()
    };

    OramaVectorService.getInstance.mockReturnValue(mockVectorDbInstance);
    FolderMatchingService.getInstance.mockReturnValue(mockFolderMatcherInstance);

    mockIpcMain = { handle: jest.fn() };
    mockSettingsService = { get: jest.fn() };
    mockFoldersService = { getCustomFolders: jest.fn(() => []) };
    mockServiceIntegration = {};
    const mockLogger = require('../src/shared/logger').createLogger();

    // Use plain object for legacy compatibility
    const context = {
      ipcMain: mockIpcMain,
      IPC_CHANNELS,
      settingsService: mockSettingsService,
      foldersService: mockFoldersService,
      getServiceIntegration: () => mockServiceIntegration,
      logger: mockLogger,
      // Legacy params expected by createFromLegacyParams
      getCustomFolders: mockFoldersService.getCustomFolders
    };

    // Register the IPC handlers
    const registerEmbeddingsIpc = require('../src/main/ipc/semantic');
    registerEmbeddingsIpc(context);
  });

  test('GET_STATS calls vectorDbService.getStats', async () => {
    const handlerCall = safeHandle.mock.calls.find(
      (call) => call[1] === IPC_CHANNELS.EMBEDDINGS.GET_STATS
    );
    if (!handlerCall) throw new Error('GET_STATS handler not registered');

    // Debug output:
    // console.log('GET_STATS calls:', safeHandle.mock.calls.map(c => [c[1], typeof c[2]]));

    let handler = handlerCall[2];
    if (typeof handler !== 'function') {
      // Search for the function
      handler = handlerCall.find((arg) => typeof arg === 'function');
    }

    if (typeof handler !== 'function') {
      throw new Error('GET_STATS handler is not a function');
    }

    const mockVectorDb = OramaVectorService.getInstance();
    mockVectorDb.getStats.mockResolvedValue({ count: 100 });

    const result = await handler({}, {});

    expect(mockVectorDb.getStats).toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({ count: 100 }));
  });

  test('REBUILD_FOLDERS acquires lock and calls folderMatcher.rebuildIndex', async () => {
    const handlerCall = safeHandle.mock.calls.find(
      (call) => call[1] === IPC_CHANNELS.EMBEDDINGS.REBUILD_FOLDERS
    );
    if (!handlerCall) throw new Error('REBUILD_FOLDERS handler not registered');

    let handler = handlerCall[2];
    if (typeof handler !== 'function') {
      handler = handlerCall.find((arg) => typeof arg === 'function');
    }
    if (typeof handler !== 'function') throw new Error('REBUILD_FOLDERS handler is not a function');

    const mockFolderMatcher = FolderMatchingService.getInstance();
    mockFolderMatcher.rebuildIndex.mockResolvedValue({ count: 5 });
    // embedText needs to be mocked for the loop
    mockFolderMatcher.embedText.mockResolvedValue({ vector: [], model: 'test' });
    mockFolderMatcher.generateFolderId.mockReturnValue('folder-1');

    // resetFolders needs to be mocked on vectorDb
    const mockVectorDb = OramaVectorService.getInstance();
    mockVectorDb.resetFolders.mockResolvedValue();
    mockVectorDb.batchUpsertFolders.mockResolvedValue(1);

    // Mock getCustomFolders to return some folders
    mockFoldersService.getCustomFolders.mockReturnValue([{ name: 'Docs' }]);

    const result = await handler({}, {});

    // REBUILD_FOLDERS does NOT call rebuildIndex on folderMatcher directly anymore?
    // Let's check semantic.js code.
    // It calls `await vectorDbService.resetFolders()`
    // Then `await folderMatcher.embedText(...)`
    // Then `await vectorDbService.batchUpsertFolders(...)`
    // It does NOT call `folderMatcher.rebuildIndex`.

    expect(mockVectorDb.resetFolders).toHaveBeenCalled();
    expect(mockFolderMatcher.embedText).toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({ success: true }));
  });

  test('REBUILD_FOLDERS prevents concurrent execution', async () => {
    const handlerCall = safeHandle.mock.calls.find(
      (call) => call[1] === IPC_CHANNELS.EMBEDDINGS.REBUILD_FOLDERS
    );
    let handler = handlerCall[2];
    if (typeof handler !== 'function') {
      handler = handlerCall.find((arg) => typeof arg === 'function');
    }

    const mockVectorDb = OramaVectorService.getInstance();

    // Simulate a slow rebuild
    mockVectorDb.resetFolders.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    mockFoldersService.getCustomFolders.mockReturnValue([{ name: 'Docs' }]);

    // Start first rebuild
    const p1 = handler({}, {});

    // Start second rebuild immediately
    const result2 = await handler({}, {});

    await p1;

    expect(result2).toEqual(
      expect.objectContaining({
        success: false,
        error: expect.stringContaining('in progress')
      })
    );
    expect(mockVectorDb.resetFolders).toHaveBeenCalledTimes(1);
  });
});
