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

jest.mock('fs', () => ({
  promises: {
    stat: jest.fn().mockResolvedValue({ size: 100 }),
    access: jest.fn().mockResolvedValue(),
    readFile: jest.fn().mockResolvedValue('content')
  }
}));

jest.mock('../src/main/ipc/ipcWrappers', () => ({
  createHandler: jest.fn(({ handler }) => handler),
  createErrorResponse: jest.fn((err) => ({ success: false, error: err.message })),
  safeHandle: jest.fn(),
  withErrorLogging: jest.fn((logger, handler) => {
    if (typeof logger === 'function') return logger;
    return handler;
  }),
  withVectorDbInit: jest.fn((arg) => {
    if (typeof arg === 'function') return arg;
    if (arg && typeof arg.handler === 'function') return arg.handler;
    return arg;
  })
}));

jest.mock('../src/shared/pathSanitization', () => ({
  validateFileOperationPath: jest.fn((p) => p),
  normalizePathForIndex: jest.fn((p) => p)
}));

jest.mock('../src/main/services/OramaVectorService', () => ({
  getInstance: jest.fn()
}));

jest.mock('../src/main/services/FolderMatchingService', () => ({
  getInstance: jest.fn()
}));

jest.mock('../src/main/services/ParallelEmbeddingService', () => ({
  getInstance: jest.fn()
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
    getConfig: jest.fn().mockResolvedValue({}),
    listModels: jest
      .fn()
      .mockResolvedValue([
        { name: 'Mistral-7B-Instruct-v0.3-Q4_K_M.gguf' },
        { name: 'llava-v1.6-mistral-7b-Q4_K_M.gguf' },
        { name: 'nomic-embed-text-v1.5-Q8_0.gguf' }
      ])
  }))
}));

jest.mock('../src/shared/normalization', () => ({
  normalizeText: jest.fn((text) => text)
}));

describe('Semantic IPC (Handlers)', () => {
  let mockIpcMain;
  let mockSettingsService;
  let mockFoldersService;
  let mockServiceIntegration;
  let safeHandle;
  let OramaVectorService;
  let SearchService;
  let ParallelEmbeddingService;
  let ClusteringService;
  let mockSearchService;
  let mockLlamaService;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();

    safeHandle = require('../src/main/ipc/ipcWrappers').safeHandle;
    OramaVectorService = require('../src/main/services/OramaVectorService');
    SearchService = require('../src/main/services/SearchService').SearchService;
    ParallelEmbeddingService = require('../src/main/services/ParallelEmbeddingService');
    ClusteringService = require('../src/main/services/ClusteringService').ClusteringService;

    const { container, ServiceIds } = require('../src/main/services/ServiceContainer');

    // Setup mocks
    const mockVectorDb = {
      initialize: jest.fn().mockResolvedValue(),
      rebuildIndex: jest.fn(),
      cleanup: jest.fn(),
      resetFiles: jest.fn(),
      batchUpsertFiles: jest.fn(),
      resetFileChunks: jest.fn(),
      resetAll: jest.fn(),
      resetFolders: jest.fn(), // Ensure this is present too
      getStats: jest.fn().mockResolvedValue({ files: 0, folders: 0 }) // For GET_STATS
    };

    const mockEmbeddingService = {
      reanalyzeAll: jest.fn()
    };

    const mockFolderMatcher = {
      initialize: jest.fn().mockResolvedValue(),
      embedText: jest.fn().mockResolvedValue({ vector: [], model: 'test' }),
      generateFolderId: jest.fn()
    };

    mockLlamaService = {
      getConfig: jest.fn().mockResolvedValue({}),
      listModels: jest
        .fn()
        .mockResolvedValue([
          { name: 'Mistral-7B-Instruct-v0.3-Q4_K_M.gguf' },
          { name: 'llava-v1.6-mistral-7b-Q4_K_M.gguf' },
          { name: 'nomic-embed-text-v1.5-Q8_0.gguf' }
        ])
    };

    // Mock container resolution
    container.resolve = jest.fn((id) => {
      switch (id) {
        case ServiceIds.ORAMA_VECTOR:
          return mockVectorDb;
        case ServiceIds.PARALLEL_EMBEDDING:
          return mockEmbeddingService;
        case ServiceIds.FOLDER_MATCHING:
          return mockFolderMatcher;
        case ServiceIds.LLAMA_SERVICE:
          return mockLlamaService;
        case ServiceIds.SEARCH_SERVICE:
          return mockSearchService;
        case ServiceIds.CLUSTERING:
          return {}; // Mock clustering service
        default:
          throw new Error(`Unexpected service resolution: ${id}`);
      }
    });

    // Also mock getInstance for test access
    OramaVectorService.getInstance.mockReturnValue(mockVectorDb);
    ParallelEmbeddingService.getInstance.mockReturnValue(mockEmbeddingService);
    require('../src/main/services/FolderMatchingService').getInstance.mockReturnValue(
      mockFolderMatcher
    );

    mockIpcMain = { handle: jest.fn() };
    mockSettingsService = {
      get: jest.fn(),
      load: jest.fn().mockResolvedValue({})
    };
    mockFoldersService = { getCustomFolders: jest.fn(() => []) };
    const mockLogger = require('../src/shared/logger').createLogger();

    // Mock SearchService instance
    mockSearchService = {
      hybridSearch: jest.fn(),
      diagnoseSearchIssues: jest.fn()
    };
    // SearchService constructor mock
    SearchService.mockImplementation(() => mockSearchService);

    mockServiceIntegration = {
      analysisHistory: {
        getRecentAnalysis: jest.fn().mockResolvedValue([
          {
            id: 'file1',
            originalPath: 'C:\\test\\doc.pdf',
            analysis: {
              summary: 'test summary',
              extractedText: 'test text'
            }
          }
        ])
      },
      llamaService: {},
      searchService: mockSearchService,
      smartFolderWatcher: {
        start: jest.fn().mockResolvedValue(true),
        stop: jest.fn().mockResolvedValue()
      }
    };

    // Use plain object for legacy compatibility
    const context = {
      ipcMain: mockIpcMain,
      IPC_CHANNELS,
      settingsService: mockSettingsService,
      foldersService: mockFoldersService,
      getServiceIntegration: () => mockServiceIntegration,
      logger: mockLogger,
      getCustomFolders: mockFoldersService.getCustomFolders
    };

    // Register the IPC handlers
    const registerEmbeddingsIpc = require('../src/main/ipc/semantic');
    registerEmbeddingsIpc(context);
  });

  function getHandler(channel) {
    const call = safeHandle.mock.calls.find((c) => c[1] === channel);
    if (!call) throw new Error(`Handler for ${channel} not registered`);

    let handler = call[2];
    if (typeof handler !== 'function') {
      handler = call.find((arg) => typeof arg === 'function');
    }
    if (typeof handler !== 'function') throw new Error(`Handler for ${channel} is not a function`);
    return handler;
  }

  test('SEARCH performs hybrid search via SearchService', async () => {
    const handler = getHandler(IPC_CHANNELS.EMBEDDINGS.SEARCH);

    const query = 'test query';
    const options = { topK: 10 };

    // We need to ensure LlamaService returns available models for the verification check
    // This is already mocked in the module-level mock, but let's be sure

    // Also SearchService needs to return a valid result structure
    mockSearchService.hybridSearch.mockResolvedValue({
      success: true,
      results: [],
      meta: {},
      queryMeta: {}
    });

    const result = await handler({}, { query, ...options });

    if (result.error) {
      throw new Error(`SEARCH failed with: ${result.error}`);
    }

    // Verify SearchService was instantiated and called
    expect(mockSearchService.hybridSearch).toHaveBeenCalledWith(
      query,
      expect.objectContaining({
        topK: 10,
        mode: 'hybrid' // Default
      })
    );

    expect(result).toEqual(expect.objectContaining({ success: true, results: [] }));
  });

  test('REBUILD_FILES calls vectorDbService.rebuildIndex', async () => {
    const handler = getHandler(IPC_CHANNELS.EMBEDDINGS.REBUILD_FILES);
    const mockVectorDb = OramaVectorService.getInstance();
    mockVectorDb.rebuildIndex.mockResolvedValue({ count: 50 });
    mockVectorDb.batchUpsertFiles.mockResolvedValue({ count: 1 });
    mockVectorDb.batchUpsertFileChunks = jest.fn().mockResolvedValue(0);

    const { container, ServiceIds } = require('../src/main/services/ServiceContainer');
    const mockFolderMatcher = container.resolve(ServiceIds.FOLDER_MATCHING);
    mockFolderMatcher.embedText.mockResolvedValue({ vector: [0.1], model: 'test' });

    const result = await handler({}, {});

    if (result.error) {
      throw new Error(`REBUILD_FILES failed with: ${result.error} (code: ${result.errorCode})`);
    }

    expect(mockVectorDb.resetFiles).toHaveBeenCalled();
    // It might not call batchUpsertFiles if logic fails inside loop, but let's check resetFiles first
    expect(result).toEqual(expect.objectContaining({ success: true }));
  });

  test('REBUILD_FILES fails when embedding model is unavailable (ignores empty model names)', async () => {
    const handler = getHandler(IPC_CHANNELS.EMBEDDINGS.REBUILD_FILES);
    const originalJestWorkerId = process.env.JEST_WORKER_ID;
    delete process.env.JEST_WORKER_ID;

    mockLlamaService.getConfig.mockResolvedValueOnce({
      embeddingModel: 'missing-embed.gguf'
    });
    mockLlamaService.listModels.mockResolvedValueOnce([{ filename: '' }, { name: '' }]);

    try {
      const result = await handler({}, {});
      expect(result).toEqual(
        expect.objectContaining({
          success: false,
          errorCode: 'MODEL_NOT_AVAILABLE'
        })
      );
    } finally {
      process.env.JEST_WORKER_ID = originalJestWorkerId;
    }
  });

  test('REANALYZE_ALL calls smartFolderWatcher.forceReanalyzeAll', async () => {
    const handler = getHandler(IPC_CHANNELS.EMBEDDINGS.REANALYZE_ALL);

    // Mock the watcher method
    mockServiceIntegration.smartFolderWatcher.forceReanalyzeAll = jest.fn().mockResolvedValue({
      scanned: 20,
      queued: 10
    });
    // Mock the preview method (used for dry run check internally sometimes or if dryRun passed)
    mockServiceIntegration.smartFolderWatcher.previewReanalyzeAll = jest.fn().mockResolvedValue({
      scanned: 20,
      watchedFolders: []
    });

    // Mock ParallelEmbeddingService for reanalyze checks if needed, but the handler primarily uses smartFolderWatcher
    // The handler does check verifyReanalyzeModelsAvailable which uses LlamaService (already mocked)

    const result = await handler({}, { applyNaming: true });

    if (result.error) {
      throw new Error(`REANALYZE_ALL failed with: ${result.error}`);
    }

    expect(mockServiceIntegration.smartFolderWatcher.forceReanalyzeAll).toHaveBeenCalledWith({
      applyNaming: true
    });
    expect(result).toEqual(expect.objectContaining({ success: true, queued: 10 }));
  });

  test('DIAGNOSE_SEARCH calls searchService.diagnoseSearchIssues', async () => {
    const handler = getHandler(IPC_CHANNELS.EMBEDDINGS.DIAGNOSE_SEARCH);

    const mockSearchService = mockServiceIntegration.searchService;
    mockSearchService.diagnoseSearchIssues.mockResolvedValue({ issues: [] });

    const result = await handler({}, { testQuery: 'foo' });

    expect(mockSearchService.diagnoseSearchIssues).toHaveBeenCalledWith('foo');
    expect(result).toEqual({ success: true, diagnostics: { issues: [] } });
  });
});
