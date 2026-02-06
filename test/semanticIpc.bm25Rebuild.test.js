/**
 * @jest-environment node
 */
const { ipcMain } = require('./mocks/electron');

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

// Make vector DB init fast and deterministic
jest.mock('../src/main/services/OramaVectorService', () => ({
  getInstance: jest.fn(() => ({
    initialize: jest.fn().mockResolvedValue(undefined)
  }))
}));

jest.mock('../src/main/services/FolderMatchingService', () => ({
  getInstance: jest.fn(() => ({
    initialize: jest.fn().mockResolvedValue(undefined)
  }))
}));

jest.mock('../src/main/services/ParallelEmbeddingService', () => ({
  getInstance: jest.fn(() => ({}))
}));

jest.mock('../src/main/services/SearchService', () => {
  const mockSearchService = {
    warmUp: jest.fn().mockResolvedValue(undefined),
    rebuildIndex: jest.fn().mockResolvedValue({ success: true }),
    getIndexStatus: jest.fn(() => ({ state: 'ready' }))
  };
  return {
    SearchService: jest.fn(() => mockSearchService),
    __mockSearchService: mockSearchService
  };
});

jest.mock('../src/main/services/QueryProcessor', () => ({
  getInstance: jest.fn(() => ({
    extendVocabulary: jest.fn().mockResolvedValue(undefined)
  }))
}));

describe('Embeddings IPC (semantic.js) - BM25 rebuild', () => {
  beforeEach(() => {
    ipcMain._handlers.clear();
    ipcMain.handle.mockClear();
    jest.clearAllMocks();
  });

  test('REBUILD_BM25_INDEX initializes, rebuilds index, and returns success', async () => {
    const registerEmbeddingsIpc = require('../src/main/ipc/semantic');
    const { IPC_CHANNELS } = require('../src/shared/constants');

    registerEmbeddingsIpc({
      ipcMain,
      IPC_CHANNELS,
      logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
      getCustomFolders: jest.fn(() => []),
      setCustomFolders: jest.fn(),
      saveCustomFolders: jest.fn(),
      scanDirectory: jest.fn(),
      getServiceIntegration: jest.fn(() => ({
        analysisHistory: {}, // required for SearchService init
        llamaService: null,
        relationshipIndex: null
      }))
    });

    const handler = ipcMain._handlers.get(IPC_CHANNELS.EMBEDDINGS.REBUILD_BM25_INDEX);
    expect(typeof handler).toBe('function');

    const result = await handler();
    expect(result).toEqual(expect.objectContaining({ success: true }));
    const searchSvcModule = require('../src/main/services/SearchService');
    expect(searchSvcModule.__mockSearchService.rebuildIndex).toHaveBeenCalledTimes(1);
  });
});
