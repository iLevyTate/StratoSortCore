/**
 * @jest-environment node
 */
const { ipcMain } = require('./mocks/electron');
const path = require('path');

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

jest.mock('../src/main/services/QueryProcessor', () => ({
  getInstance: jest.fn(() => ({
    extendVocabulary: jest.fn().mockResolvedValue(undefined)
  }))
}));

jest.mock('../src/main/services/SearchService', () => {
  const svc = {
    warmUp: jest.fn().mockResolvedValue(undefined),
    rebuildIndex: jest.fn().mockResolvedValue({ success: true }),
    hybridSearch: jest.fn()
  };
  return {
    SearchService: jest.fn(() => svc),
    __svc: svc
  };
});

describe('Embeddings IPC (semantic.js) - SEARCH', () => {
  beforeEach(() => {
    ipcMain._handlers.clear();
    ipcMain.handle.mockClear();
    jest.resetModules();
  });

  function register() {
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
        relationshipIndex: null,
        settingsService: {
          load: jest.fn(async () => ({
            graphExpansionEnabled: true,
            graphExpansionWeight: 0.2,
            graphExpansionMaxNeighbors: 120,
            chunkContextEnabled: true,
            chunkContextMaxNeighbors: 1
          }))
        }
      }))
    });

    return { IPC_CHANNELS };
  }

  test('rejects missing/short query and invalid topK', async () => {
    const { IPC_CHANNELS } = register();
    const handler = ipcMain._handlers.get(IPC_CHANNELS.EMBEDDINGS.SEARCH);

    await expect(handler(null, { query: '' })).resolves.toEqual(
      expect.objectContaining({ success: false, error: 'Query is required' })
    );
    await expect(handler(null, { query: 'a' })).resolves.toEqual(
      expect.objectContaining({ success: false })
    );
    await expect(handler(null, { query: 'ok', topK: 0 })).resolves.toEqual(
      expect.objectContaining({ success: false, error: expect.stringContaining('topK') })
    );
  });

  test('calls SearchService.hybridSearch with normalized query + options', async () => {
    const { IPC_CHANNELS } = register();
    const svcModule = require('../src/main/services/SearchService');

    svcModule.__svc.hybridSearch.mockResolvedValue({
      success: true,
      results: [{ id: 'file:x', score: 0.9 }],
      mode: 'hybrid',
      meta: { bm25Built: true }
    });

    const handler = ipcMain._handlers.get(IPC_CHANNELS.EMBEDDINGS.SEARCH);

    // Pull text from a real test fixture (filename only; we just use a few keywords)
    const query = 'Stratosort AI Integration milestones';
    const res = await handler(null, { query, topK: 5, mode: 'hybrid', rerank: false });

    expect(res).toEqual(
      expect.objectContaining({
        success: true,
        mode: 'hybrid',
        results: expect.any(Array)
      })
    );
    expect(svcModule.__svc.hybridSearch).toHaveBeenCalledWith(
      query,
      expect.objectContaining({
        topK: 5,
        mode: 'hybrid',
        rerank: false,
        expandSynonyms: true
      })
    );
  });

  test('falls back to BM25 when hybridSearch fails in non-bm25 modes', async () => {
    const { IPC_CHANNELS } = register();
    const svcModule = require('../src/main/services/SearchService');

    svcModule.__svc.hybridSearch
      .mockResolvedValueOnce({ success: false, error: 'vector failed' })
      .mockResolvedValueOnce({ success: true, results: [{ id: 'file:y', score: 1 }], meta: {} });

    const handler = ipcMain._handlers.get(IPC_CHANNELS.EMBEDDINGS.SEARCH);
    const res = await handler(null, { query: 'project report', topK: 3, mode: 'hybrid' });

    expect(res).toEqual(
      expect.objectContaining({
        success: true,
        mode: 'bm25',
        meta: expect.objectContaining({ fallback: true, originalMode: 'hybrid' })
      })
    );
    expect(svcModule.__svc.hybridSearch).toHaveBeenNthCalledWith(
      2,
      'project report',
      expect.objectContaining({ mode: 'bm25' })
    );
  });
});
