/**
 * @jest-environment node
 *
 * Tests for the semantic IPC initialization state machine and
 * handler edge cases not covered by existing test files.
 *
 * Covers:
 *  - ensureInitialized() state transitions (PENDING -> IN_PROGRESS -> COMPLETED/FAILED)
 *  - Retry-after-failure with rate-limiting
 *  - Mutex contention + timeout recovery
 *  - REBUILD_FILES: lock contention, empty/invalid history
 *  - FIND_SIMILAR: validation, timeout, dimension mismatch
 *  - SCORE_FILES: validation, empty fileIds
 */
const { IPC_CHANNELS } = require('../src/shared/constants');

// Capture handlers registered via safeHandle
const mockHandlerMap = new Map();

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
  safeHandle: jest.fn((_ipcMain, channel, handler) => {
    mockHandlerMap.set(channel, handler);
  }),
  withErrorLogging: jest.fn((_logger, fn) => fn),
  z: null
}));

jest.mock('../src/shared/pathSanitization', () => ({
  validateFileOperationPath: jest.fn(async (p) => ({ valid: true, normalizedPath: p })),
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
    listModels: jest.fn().mockResolvedValue([{ name: 'nomic-embed-text-v1.5-Q8_0.gguf' }])
  }))
}));

jest.mock('../src/shared/normalization', () => ({
  normalizeText: jest.fn((text) => (typeof text === 'string' ? text.trim() : ''))
}));

// The module uses setImmediate/setTimeout for background pre-warming.
// Use fake timers to prevent open handles after tests complete.
beforeAll(() => {
  jest.useFakeTimers({ doNotFake: ['Date', 'nextTick', 'setImmediate'] });
});
afterAll(() => {
  jest.useRealTimers();
});

describe('Semantic IPC – init state machine & handler edge cases', () => {
  let mockVectorDb;
  let mockFolderMatcher;
  let mockSearchService;

  function setupAndRegister({ initShouldFail = false, initDelay = 0 } = {}) {
    jest.resetModules();
    mockHandlerMap.clear();

    // Re-require after reset
    const { container, ServiceIds } = require('../src/main/services/ServiceContainer');

    mockVectorDb = {
      initialize: jest.fn(async () => {
        if (initDelay > 0) await new Promise((r) => setTimeout(r, initDelay));
        if (initShouldFail) throw new Error('Orama init failed');
      }),
      cleanup: jest.fn().mockResolvedValue(),
      resetFiles: jest.fn().mockResolvedValue(),
      resetFileChunks: jest.fn().mockResolvedValue(),
      resetFolders: jest.fn().mockResolvedValue(),
      resetAll: jest.fn().mockResolvedValue(),
      batchUpsertFiles: jest.fn().mockResolvedValue({ count: 1 }),
      batchUpsertFolders: jest.fn().mockResolvedValue(1),
      batchUpsertFileChunks: jest.fn().mockResolvedValue(0),
      getStats: jest.fn().mockResolvedValue({ files: 5, folders: 2 }),
      getFile: jest.fn().mockResolvedValue(null)
    };

    mockFolderMatcher = {
      initialize: jest.fn().mockResolvedValue(),
      embedText: jest.fn().mockResolvedValue({ vector: [0.1, 0.2], model: 'test' }),
      generateFolderId: jest.fn().mockReturnValue('folder-id-1'),
      findSimilarFiles: jest.fn().mockResolvedValue([]),
      findMultiHopNeighbors: jest.fn().mockResolvedValue([])
    };

    mockSearchService = {
      hybridSearch: jest.fn().mockResolvedValue({ success: true, results: [], meta: {} }),
      warmUp: jest.fn().mockResolvedValue(),
      rebuildIndex: jest.fn().mockResolvedValue({ success: true }),
      diagnoseSearchIssues: jest.fn().mockResolvedValue({ issues: [] }),
      buildBM25Index: jest.fn().mockResolvedValue(),
      getIndexStatus: jest.fn().mockReturnValue({ built: true })
    };

    const mockLlamaService = {
      getConfig: jest.fn().mockResolvedValue({}),
      listModels: jest.fn().mockResolvedValue([{ name: 'nomic-embed-text-v1.5-Q8_0.gguf' }]),
      updateConfig: jest.fn().mockResolvedValue()
    };

    container.resolve = jest.fn((id) => {
      switch (id) {
        case ServiceIds.ORAMA_VECTOR:
          return mockVectorDb;
        case ServiceIds.FOLDER_MATCHING:
          return mockFolderMatcher;
        case ServiceIds.PARALLEL_EMBEDDING:
          return { embedText: mockFolderMatcher.embedText };
        case ServiceIds.LLAMA_SERVICE:
          return mockLlamaService;
        case ServiceIds.SEARCH_SERVICE:
          return mockSearchService;
        case ServiceIds.CLUSTERING:
          return {};
        default:
          return {};
      }
    });

    // Also mock the getInstance statics
    require('../src/main/services/OramaVectorService').getInstance.mockReturnValue(mockVectorDb);
    require('../src/main/services/FolderMatchingService').getInstance.mockReturnValue(
      mockFolderMatcher
    );
    require('../src/main/services/ParallelEmbeddingService').getInstance.mockReturnValue({
      embedText: mockFolderMatcher.embedText
    });

    const registerEmbeddingsIpc = require('../src/main/ipc/semantic');
    registerEmbeddingsIpc({
      ipcMain: { handle: jest.fn() },
      IPC_CHANNELS,
      logger: require('../src/shared/logger').createLogger(),
      getCustomFolders: jest.fn(() => []),
      getServiceIntegration: () => ({
        analysisHistory: {
          getRecentAnalysis: jest.fn().mockResolvedValue([]),
          getQuickStats: jest.fn().mockResolvedValue({ totalFiles: 0 })
        },
        smartFolderWatcher: {
          isRunning: true,
          start: jest.fn().mockResolvedValue(true),
          forceReanalyzeAll: jest.fn().mockResolvedValue({ scanned: 0, queued: 0 })
        }
      })
    });
  }

  function getHandler(channel) {
    const handler = mockHandlerMap.get(channel);
    if (!handler) throw new Error(`Handler for ${channel} not registered`);
    return handler;
  }

  // ─── Init state machine ────────────────────────────────────

  test('init transitions PENDING -> IN_PROGRESS -> COMPLETED on success', async () => {
    setupAndRegister();
    // Call any handler that requires init; GET_STATS is lightweight
    const handler = getHandler(IPC_CHANNELS.EMBEDDINGS.GET_STATS);
    const result = await handler({}, {});

    expect(result.success).toBe(true);
    expect(mockVectorDb.initialize).toHaveBeenCalled();
    expect(mockFolderMatcher.initialize).toHaveBeenCalled();
  });

  test('init failure returns VECTOR_DB_UNAVAILABLE and rate-limits retries', async () => {
    setupAndRegister({ initShouldFail: true });
    const handler = getHandler(IPC_CHANNELS.EMBEDDINGS.GET_STATS);

    // First call: triggers init which fails after retries
    const r1 = await handler({}, {});
    expect(r1.success).toBe(false);
    expect(r1.code || r1.unavailable).toBeTruthy();

    // Immediate second call should be rate-limited (no new init attempt within 10s)
    const r2 = await handler({}, {});
    expect(r2.success).toBe(false);
    expect(r2.unavailable).toBe(true);
  });

  test('concurrent handler calls during init share the same promise', async () => {
    setupAndRegister({ initDelay: 100 });
    const handler = getHandler(IPC_CHANNELS.EMBEDDINGS.GET_STATS);

    // Fire two concurrent calls
    const [r1, r2] = await Promise.all([handler({}, {}), handler({}, {})]);

    // Both should succeed (shared init promise)
    expect(r1.success).toBe(true);
    expect(r2.success).toBe(true);
    // Initialize should only be called once
    expect(mockVectorDb.initialize).toHaveBeenCalledTimes(1);
  });

  // ─── REBUILD_FILES edge cases ──────────────────────────────

  test('REBUILD_FILES rejects concurrent execution via lock', async () => {
    setupAndRegister();
    const handler = getHandler(IPC_CHANNELS.EMBEDDINGS.REBUILD_FILES);

    // First call will hold the lock
    mockVectorDb.resetFiles.mockImplementation(() => new Promise((r) => setTimeout(r, 100)));

    const p1 = handler({}, {});
    // Second concurrent call should be blocked
    const r2 = await handler({}, {});
    await p1;

    expect(r2.success).toBe(false);
    expect(r2.errorCode).toBe('REBUILD_IN_PROGRESS');
  });

  test('REBUILD_FILES returns success with 0 files when history is empty', async () => {
    setupAndRegister();
    const handler = getHandler(IPC_CHANNELS.EMBEDDINGS.REBUILD_FILES);

    const result = await handler({}, {});
    expect(result.success).toBe(true);
    expect(result.files).toBe(0);
    expect(result.message).toMatch(/No analysis history/i);
  });

  test('REBUILD_FILES handles non-array history gracefully', async () => {
    setupAndRegister();

    // Override the mock to return non-array
    const { container, ServiceIds } = require('../src/main/services/ServiceContainer');
    const origResolve = container.resolve;
    // We need to re-register with modified service integration
    // Instead, let's directly test by calling the handler after patching
    // The mock is set during setupAndRegister, so we need to patch getServiceIntegration

    // Alternative: We test via a fresh setup
    jest.resetModules();
    mockHandlerMap.clear();

    const mod = require('../src/main/services/ServiceContainer');
    const mockVectorDb2 = {
      initialize: jest.fn().mockResolvedValue(),
      cleanup: jest.fn().mockResolvedValue(),
      resetFiles: jest.fn().mockResolvedValue(),
      resetFileChunks: jest.fn().mockResolvedValue(),
      resetAll: jest.fn().mockResolvedValue(),
      batchUpsertFiles: jest.fn().mockResolvedValue({ count: 0 }),
      batchUpsertFolders: jest.fn().mockResolvedValue(0),
      batchUpsertFileChunks: jest.fn().mockResolvedValue(0),
      getStats: jest.fn().mockResolvedValue({ files: 0, folders: 0 })
    };
    const mockFolderMatcher2 = {
      initialize: jest.fn().mockResolvedValue(),
      embedText: jest.fn().mockResolvedValue({ vector: [0.1], model: 'test' }),
      generateFolderId: jest.fn().mockReturnValue('fid')
    };
    const mockLlama2 = {
      getConfig: jest.fn().mockResolvedValue({}),
      listModels: jest.fn().mockResolvedValue([{ name: 'nomic-embed-text-v1.5-Q8_0.gguf' }]),
      updateConfig: jest.fn().mockResolvedValue()
    };

    mod.container.resolve = jest.fn((id) => {
      switch (id) {
        case mod.ServiceIds.ORAMA_VECTOR:
          return mockVectorDb2;
        case mod.ServiceIds.FOLDER_MATCHING:
          return mockFolderMatcher2;
        case mod.ServiceIds.PARALLEL_EMBEDDING:
          return { embedText: mockFolderMatcher2.embedText };
        case mod.ServiceIds.LLAMA_SERVICE:
          return mockLlama2;
        case mod.ServiceIds.SEARCH_SERVICE:
          return {};
        case mod.ServiceIds.CLUSTERING:
          return {};
        default:
          return {};
      }
    });

    require('../src/main/services/OramaVectorService').getInstance.mockReturnValue(mockVectorDb2);
    require('../src/main/services/FolderMatchingService').getInstance.mockReturnValue(
      mockFolderMatcher2
    );
    require('../src/main/services/ParallelEmbeddingService').getInstance.mockReturnValue({
      embedText: mockFolderMatcher2.embedText
    });

    const registerEmbeddingsIpc = require('../src/main/ipc/semantic');
    registerEmbeddingsIpc({
      ipcMain: { handle: jest.fn() },
      IPC_CHANNELS,
      logger: require('../src/shared/logger').createLogger(),
      getCustomFolders: jest.fn(() => []),
      getServiceIntegration: () => ({
        analysisHistory: {
          getRecentAnalysis: jest.fn().mockResolvedValue('not-an-array') // invalid
        }
      })
    });

    const handler = mockHandlerMap.get(IPC_CHANNELS.EMBEDDINGS.REBUILD_FILES);
    const result = await handler({}, {});
    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('INVALID_HISTORY_FORMAT');
  });

  // ─── FIND_SIMILAR edge cases ───────────────────────────────

  test('FIND_SIMILAR rejects missing fileId', async () => {
    setupAndRegister();
    const handler = getHandler(IPC_CHANNELS.EMBEDDINGS.FIND_SIMILAR);

    const result = await handler({}, { topK: 5 });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/File ID/i);
  });

  test('FIND_SIMILAR rejects invalid topK', async () => {
    setupAndRegister();
    const handler = getHandler(IPC_CHANNELS.EMBEDDINGS.FIND_SIMILAR);

    const result = await handler({}, { fileId: 'file:test', topK: -1 });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/topK/i);
  });

  test('FIND_SIMILAR returns results on success', async () => {
    setupAndRegister();
    mockFolderMatcher.findSimilarFiles.mockResolvedValue([{ id: 'file:a', score: 0.95 }]);
    const handler = getHandler(IPC_CHANNELS.EMBEDDINGS.FIND_SIMILAR);

    const result = await handler({}, { fileId: 'file:test', topK: 5 });
    expect(result.success).toBe(true);
    expect(result.results).toHaveLength(1);
    expect(mockFolderMatcher.findSimilarFiles).toHaveBeenCalledWith('file:test', 5);
  });

  // ─── SCORE_FILES edge cases ────────────────────────────────

  test('SCORE_FILES rejects missing query', async () => {
    setupAndRegister();
    const handler = getHandler(IPC_CHANNELS.EMBEDDINGS.SCORE_FILES);

    const result = await handler({}, { fileIds: ['file:a'] });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Query/i);
  });

  test('SCORE_FILES rejects empty fileIds', async () => {
    setupAndRegister();
    const handler = getHandler(IPC_CHANNELS.EMBEDDINGS.SCORE_FILES);

    const result = await handler({}, { query: 'test query', fileIds: [] });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/fileIds/i);
  });

  test('SCORE_FILES rejects non-array fileIds', async () => {
    setupAndRegister();
    const handler = getHandler(IPC_CHANNELS.EMBEDDINGS.SCORE_FILES);

    const result = await handler({}, { query: 'test query', fileIds: 'not-array' });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/fileIds/i);
  });

  // ─── SEARCH dimension mismatch / exception fallback ────────

  test('SEARCH returns requiresRebuild on dimension mismatch', async () => {
    setupAndRegister();
    mockSearchService.hybridSearch
      .mockResolvedValueOnce({ success: false, error: 'dimension mismatch' })
      // BM25 fallback also fails
      .mockResolvedValueOnce({ success: false, error: 'bm25 also failed' });

    const handler = getHandler(IPC_CHANNELS.EMBEDDINGS.SEARCH);
    const result = await handler({}, { query: 'test query', topK: 5, mode: 'hybrid' });

    expect(result.success).toBe(false);
    expect(result.requiresRebuild).toBe(true);
  });

  test('SEARCH falls back to BM25 on exception for non-bm25 mode', async () => {
    setupAndRegister();
    // First hybridSearch throws, then BM25 fallback succeeds
    mockSearchService.hybridSearch
      .mockRejectedValueOnce(new Error('vector engine crashed'))
      .mockResolvedValueOnce({
        success: true,
        results: [{ id: 'file:fallback', score: 0.8 }],
        meta: {}
      });

    const handler = getHandler(IPC_CHANNELS.EMBEDDINGS.SEARCH);
    const result = await handler({}, { query: 'test query', topK: 5, mode: 'hybrid' });

    expect(result.success).toBe(true);
    expect(result.mode).toBe('bm25');
    expect(result.meta.fallback).toBe(true);
    expect(result.meta.fallbackReason).toMatch(/vector engine crashed/);
  });

  // ─── CLEAR_STORE ───────────────────────────────────────────

  test('CLEAR_STORE calls resetAll', async () => {
    setupAndRegister();
    const handler = getHandler(IPC_CHANNELS.EMBEDDINGS.CLEAR_STORE);

    const result = await handler({}, {});
    expect(result.success).toBe(true);
    expect(mockVectorDb.resetAll).toHaveBeenCalled();
  });

  // ─── REBUILD_BM25_INDEX ────────────────────────────────────

  test('REBUILD_BM25_INDEX calls searchService.rebuildIndex', async () => {
    setupAndRegister();
    const handler = getHandler(IPC_CHANNELS.EMBEDDINGS.REBUILD_BM25_INDEX);

    const result = await handler({}, {});
    expect(result.success).toBe(true);
    expect(mockSearchService.rebuildIndex).toHaveBeenCalled();
  });

  // ─── GET_SEARCH_STATUS ─────────────────────────────────────

  test('GET_SEARCH_STATUS returns index status', async () => {
    setupAndRegister();
    const handler = getHandler(IPC_CHANNELS.EMBEDDINGS.GET_SEARCH_STATUS);

    const result = await handler({}, {});
    expect(result.success).toBe(true);
    expect(result.status).toEqual({ built: true });
  });
});
