/**
 * Resilience-focused tests for SearchService
 * Focus: vector timeout fallback, reranker failure tolerance, and timer safety.
 */

jest.mock('../src/shared/logger', () => ({
  createLogger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
  })
}));

jest.mock('fs', () => ({
  promises: {
    access: jest.fn().mockResolvedValue(undefined)
  }
}));

const { SearchService } = require('../src/main/services/SearchService');

describe('SearchService (resilience)', () => {
  const flushMicrotasks = async () => {
    await Promise.resolve();
    await Promise.resolve();
  };

  const advance = async (ms) => {
    if (typeof jest.advanceTimersByTimeAsync === 'function') {
      await jest.advanceTimersByTimeAsync(ms);
      return;
    }
    jest.advanceTimersByTime(ms);
    await flushMicrotasks();
  };

  function makeService(overrides = {}) {
    const vectorDbService = {
      initialize: jest.fn().mockResolvedValue(true),
      isOnline: true,
      getStats: jest.fn().mockResolvedValue({ files: 0, fileChunks: 0, folders: 0 }),
      getChunksForFile: jest.fn().mockResolvedValue([]),
      peekFiles: jest.fn().mockResolvedValue({ ids: [], embeddings: [], metadatas: [] }),
      getFile: jest.fn().mockResolvedValue(null),
      batchDeleteFileEmbeddings: jest.fn().mockResolvedValue(undefined),
      ...overrides.vectorDbService
    };

    const history = {
      initialize: jest.fn().mockResolvedValue(undefined),
      analysisHistory: { metadata: { totalEntries: 0 }, entries: {} },
      ...overrides.analysisHistoryService
    };

    const embedding = {
      embedText: jest.fn().mockResolvedValue({ vector: [0.1, 0.2, 0.3] }),
      ...overrides.parallelEmbeddingService
    };

    const service = new SearchService({
      vectorDbService,
      analysisHistoryService: history,
      parallelEmbeddingService: embedding,
      reRankerService: overrides.reRankerService || null,
      queryProcessor: null,
      relationshipIndexService: null
    });

    // Avoid side enrichment dependencies in these tests
    service._enrichResults = jest.fn();
    service._applyGraphExpansion = jest.fn(async (results) => ({
      results,
      meta: { enabled: false }
    }));
    service._validateFileExistence = jest.fn(async (results) => ({
      validResults: results,
      ghostCount: 0
    }));
    service.isIndexStale = jest.fn(() => false);
    service.buildBM25Index = jest.fn().mockResolvedValue({ success: true, indexed: 0 });
    service.chunkSearch = jest.fn().mockResolvedValue([]);

    // prevent query processor creation attempts
    service._queryProcessorInitialized = true;
    service.queryProcessor = null;

    return { service, vectorDbService };
  }

  test('_vectorSearchWithTimeout returns timedOut=true when vectorSearch hangs', async () => {
    jest.useFakeTimers();
    const { service } = makeService();
    service.vectorSearch = jest.fn(() => new Promise(() => {}));

    const p = service._vectorSearchWithTimeout('hello', 5, 50);
    const assertion = expect(p).resolves.toEqual({ results: [], timedOut: true });

    await flushMicrotasks();
    await advance(60);
    await assertion;

    jest.useRealTimers();
  });

  test('_vectorSearchWithTimeout returns empty results with error when vectorSearch rejects', async () => {
    const { service } = makeService();
    service.vectorSearch = jest.fn().mockRejectedValue(new Error('db fail'));

    await expect(service._vectorSearchWithTimeout('hello', 5, 50)).resolves.toEqual(
      expect.objectContaining({ results: [], timedOut: false, error: 'db fail' })
    );
  });

  test('hybridSearch falls back to BM25-only when vector search times out', async () => {
    const { service } = makeService();

    service.bm25Search = jest
      .fn()
      .mockResolvedValue([
        { id: 'a', score: 0.9, metadata: { path: 'C:\\a.txt' }, matchDetails: {} }
      ]);
    service._vectorSearchWithTimeout = jest.fn().mockResolvedValue({ results: [], timedOut: true });

    const res = await service.hybridSearch('hello', {
      topK: 5,
      minScore: 0,
      mode: 'hybrid',
      chunkWeight: 0
    });
    expect(res.success).toBe(true);
    expect(res.mode).toBe('bm25-fallback');
    expect(res.meta).toEqual(expect.objectContaining({ vectorTimedOut: true, fallback: true }));
  });

  test('hybridSearch tolerates reranker failure and still returns results', async () => {
    const reRanker = {
      isAvailable: () => true,
      rerank: jest.fn().mockRejectedValue(new Error('rerank broke'))
    };

    const { service } = makeService({
      reRankerService: reRanker
    });

    // Force reranker to be used
    service._getReRanker = jest.fn(() => reRanker);

    service.bm25Search = jest.fn().mockResolvedValue([
      { id: 'a', score: 0.1, metadata: { path: 'C:\\a.txt' }, matchDetails: {} },
      { id: 'b', score: 0.05, metadata: { path: 'C:\\b.txt' }, matchDetails: {} }
    ]);
    service._vectorSearchWithTimeout = jest.fn().mockResolvedValue({
      timedOut: false,
      results: [
        { id: 'a', score: 0.9, metadata: { path: 'C:\\a.txt' }, matchDetails: {} },
        { id: 'b', score: 0.8, metadata: { path: 'C:\\b.txt' }, matchDetails: {} }
      ]
    });

    const res = await service.hybridSearch('hello', {
      topK: 5,
      minScore: 0,
      mode: 'hybrid',
      rerank: true,
      rerankTopN: 5,
      chunkWeight: 0
    });

    expect(res.success).toBe(true);
    // rerank failure means mode stays hybrid (not hybrid-reranked)
    expect(res.mode).toBe('hybrid');
    expect(reRanker.rerank).toHaveBeenCalled();
    expect(res.results.length).toBeGreaterThanOrEqual(2);
  });

  test('_validateFileExistence filters out ghost entries and triggers async cleanup', async () => {
    const fs = require('fs').promises;
    const { service, vectorDbService } = makeService();
    // Restore real implementation (makeService stubs this by default)
    service._validateFileExistence = SearchService.prototype._validateFileExistence.bind(service);

    // Clear default mock to avoid prior state leaking
    fs.access.mockReset();

    // One file exists, one does not
    fs.access.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('ENOENT'));

    vectorDbService.batchDeleteFileEmbeddings = jest.fn().mockResolvedValue(undefined);
    service.vectorDb = vectorDbService;

    const results = [
      { id: 'file:ok', metadata: { path: 'C:\\ok.txt' }, score: 1 },
      { id: 'file:ghost', metadata: { path: 'C:\\ghost.txt' }, score: 0.9 }
    ];

    const { validResults, ghostCount } = await service._validateFileExistence(results, {
      triggerCleanup: true
    });

    expect(ghostCount).toBe(1);
    expect(validResults.map((r) => r.id)).toEqual(['file:ok']);

    // cleanup runs in setImmediate; flush it
    await new Promise((r) => setImmediate(r));
    expect(vectorDbService.batchDeleteFileEmbeddings).toHaveBeenCalledWith(['file:ghost']);
  });

  test('hybridSearch falls back to BM25-only when hybrid throws (hard failure fallback)', async () => {
    const { service } = makeService();

    service.bm25Search = jest
      .fn()
      .mockResolvedValue([
        { id: 'a', score: 0.9, metadata: { path: 'C:\\a.txt' }, matchDetails: {} }
      ]);
    // Force an exception in hybrid path
    service._vectorSearchWithTimeout = jest.fn().mockRejectedValue(new Error('vector exploded'));

    const res = await service.hybridSearch('hello', { topK: 5, minScore: 0, mode: 'hybrid' });
    expect(res.success).toBe(true);
    expect(res.mode).toBe('bm25-fallback');
    expect(res.meta).toEqual(
      expect.objectContaining({ fallback: true, fallbackReason: 'hybrid search error' })
    );
  });
});
