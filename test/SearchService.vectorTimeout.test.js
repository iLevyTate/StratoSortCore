/**
 * Tests for SearchService vector search timeout error logging fix.
 * Verifies that post-timeout rejections are logged, not silently swallowed.
 */

let mockLogger;

jest.mock('../src/shared/logger', () => {
  mockLogger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
  };
  return { createLogger: () => mockLogger };
});

const { SearchService } = require('../src/main/services/SearchService');

const createService = () => {
  const vectorDbService = {
    initialize: jest.fn().mockResolvedValue(true),
    getStats: jest.fn().mockResolvedValue({ files: 0, fileChunks: 0, folders: 0 }),
    getChunksForFile: jest.fn().mockResolvedValue([]),
    peekFiles: jest.fn().mockResolvedValue({ ids: [], embeddings: [], metadatas: [] }),
    getFile: jest.fn().mockResolvedValue(null)
  };
  const analysisHistoryService = {
    analysisHistory: { metadata: { totalEntries: 0 }, entries: {} }
  };

  const service = new SearchService({
    vectorDbService,
    analysisHistoryService,
    parallelEmbeddingService: {}
  });

  service._getQueryProcessor = jest.fn(() => null);
  service._getReRanker = jest.fn(() => null);
  service._enrichResults = jest.fn();
  service.isIndexStale = jest.fn(() => false);
  service.buildBM25Index = jest.fn().mockResolvedValue({ success: true, indexed: 0 });

  return service;
};

describe('SearchService – _vectorSearchWithTimeout error logging', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('logs rejection when timeout wins the race', async () => {
    const service = createService();
    const searchError = new Error('embedding model unavailable');

    // Make vectorSearch return a promise that rejects after a delay
    service.vectorSearch = jest.fn(
      () => new Promise((_, reject) => setTimeout(() => reject(searchError), 5000))
    );

    // Start the search with a 100ms timeout
    const resultPromise = service._vectorSearchWithTimeout('test query', 10, 100);

    // Advance past the timeout
    jest.advanceTimersByTime(150);
    const result = await resultPromise;

    expect(result.timedOut).toBe(true);
    expect(result.results).toEqual([]);

    // Now advance past the vectorSearch rejection
    jest.advanceTimersByTime(5000);

    // Flush microtask queue so the .catch handler runs
    await Promise.resolve();
    await Promise.resolve();

    expect(mockLogger.debug).toHaveBeenCalledWith(
      expect.stringContaining('Vector search rejected after timeout'),
      expect.objectContaining({ error: expect.stringContaining('embedding model unavailable') })
    );
  });

  test('does not log when search completes before timeout', async () => {
    const service = createService();
    service.vectorSearch = jest.fn().mockResolvedValue([{ id: 'doc1', score: 0.9 }]);

    const resultPromise = service._vectorSearchWithTimeout('test query', 10, 5000);
    jest.advanceTimersByTime(10);
    const result = await resultPromise;

    expect(result.timedOut).toBe(false);
    expect(result.results).toHaveLength(1);
    // No error should have been logged
    expect(mockLogger.debug).not.toHaveBeenCalledWith(
      expect.stringContaining('Vector search rejected after timeout'),
      expect.any(Object)
    );
  });
});
