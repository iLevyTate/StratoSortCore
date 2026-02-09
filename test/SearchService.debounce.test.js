/**
 * Tests for SearchService invalidateAndRebuild debounce behavior.
 *
 * Verifies that:
 * - Rapid invalidation requests are coalesced into a single rebuild
 * - All callers receive the result of the coalesced rebuild
 * - Cleanup properly resolves pending debounce promises
 * - Graph expansion handles edge weight edge cases
 */

jest.mock('../src/shared/logger', () => ({
  createLogger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
  })
}));

const { SearchService } = require('../src/main/services/SearchService');

function createService(overrides = {}) {
  const vectorDbService = {
    initialize: jest.fn().mockResolvedValue(true),
    getStats: jest.fn().mockResolvedValue({ files: 0, fileChunks: 0, folders: 0 }),
    getChunksForFile: jest.fn().mockResolvedValue([]),
    peekFiles: jest.fn().mockResolvedValue({ ids: [], embeddings: [], metadatas: [] }),
    getFile: jest.fn().mockResolvedValue(null),
    ...overrides.vectorDbService
  };
  const analysisHistoryService = {
    initialize: jest.fn().mockResolvedValue(undefined),
    analysisHistory: { metadata: { totalEntries: 0 }, entries: {} },
    ...overrides.analysisHistoryService
  };
  const parallelEmbeddingService = {
    ...overrides.parallelEmbeddingService
  };

  const service = new SearchService({
    vectorDbService,
    analysisHistoryService,
    parallelEmbeddingService,
    ...overrides
  });

  // Prevent singleton lookups in tests
  service._getQueryProcessor = jest.fn(() => null);
  service._getReRanker = jest.fn(() => null);
  service._enrichResults = jest.fn();

  return service;
}

describe('SearchService debounce', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('coalesces rapid invalidateAndRebuild calls into a single build', async () => {
    const service = createService();
    const buildSpy = jest
      .spyOn(service, 'buildBM25Index')
      .mockResolvedValue({ success: true, indexed: 10 });

    // Fire 5 rapid invalidateAndRebuild calls
    const promises = [];
    for (let i = 0; i < 5; i++) {
      promises.push(service.invalidateAndRebuild({ reason: `batch-${i}` }));
    }

    // Advance timers past the debounce window (500ms)
    jest.advanceTimersByTime(600);

    const results = await Promise.all(promises);

    // All callers should get the same result
    for (const result of results) {
      expect(result.success).toBe(true);
      expect(result.rebuilt).toBe(true);
      expect(result.indexed).toBe(10);
    }

    // buildBM25Index should have been called exactly once
    expect(buildSpy).toHaveBeenCalledTimes(1);

    buildSpy.mockRestore();
  });

  test('debounce resets timer on each new call', async () => {
    const service = createService();
    const buildSpy = jest
      .spyOn(service, 'buildBM25Index')
      .mockResolvedValue({ success: true, indexed: 5 });

    // First call
    const p1 = service.invalidateAndRebuild({ reason: 'first' });

    // Advance 300ms (less than 500ms debounce)
    jest.advanceTimersByTime(300);

    // Second call resets the timer
    const p2 = service.invalidateAndRebuild({ reason: 'second' });

    // Advance 300ms more (600ms total, but only 300ms since last call)
    jest.advanceTimersByTime(300);

    // Should not have fired yet (only 300ms since last call)
    expect(buildSpy).not.toHaveBeenCalled();

    // Advance past the debounce window
    jest.advanceTimersByTime(300);

    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1.success).toBe(true);
    expect(r2.success).toBe(true);
    expect(buildSpy).toHaveBeenCalledTimes(1);

    buildSpy.mockRestore();
  });

  test('cleanup resolves pending debounce promises with error', async () => {
    const service = createService();
    jest.spyOn(service, 'buildBM25Index').mockResolvedValue({ success: true, indexed: 0 });

    // Queue some rebuilds
    const p1 = service.invalidateAndRebuild({ reason: 'pending' });
    const p2 = service.invalidateAndRebuild({ reason: 'pending2' });

    // Call cleanup before debounce fires
    await service.cleanup();

    const [r1, r2] = await Promise.all([p1, p2]);

    // Should resolve with failure (service shutting down)
    expect(r1.success).toBe(false);
    expect(r1.error).toMatch(/shutting down/i);
    expect(r2.success).toBe(false);
  });

  test('build failure propagates to all debounced callers', async () => {
    const service = createService();
    const buildSpy = jest.spyOn(service, 'buildBM25Index').mockRejectedValue(new Error('OOM'));

    const promises = [
      service.invalidateAndRebuild({ reason: 'a' }),
      service.invalidateAndRebuild({ reason: 'b' })
    ];

    jest.advanceTimersByTime(600);

    const results = await Promise.all(promises);
    for (const result of results) {
      expect(result.success).toBe(false);
      expect(result.error).toBe('OOM');
    }

    buildSpy.mockRestore();
  });
});

describe('SearchService graph expansion edge cases', () => {
  test('handles all-zero edge weights without NaN scores', async () => {
    const service = createService({
      relationshipIndexService: {
        getNeighborEdges: jest.fn().mockResolvedValue({
          edges: [
            { source: 'seed-1', target: 'neighbor-1', weight: 0 },
            { source: 'seed-1', target: 'neighbor-2', weight: 0 }
          ]
        })
      }
    });

    const results = [
      { id: 'seed-1', score: 0.8, metadata: {} },
      { id: 'seed-2', score: 0.6, metadata: {} }
    ];

    const { results: expanded, meta } = await service._applyGraphExpansion(results, {
      graphExpansion: true,
      graphExpansionWeight: 0.3,
      graphExpansionMaxSeeds: 5,
      graphExpansionMaxEdges: 10,
      graphExpansionMaxNeighbors: 5,
      graphExpansionMinWeight: 0,
      graphExpansionDecay: 0.8
    });

    // No scores should be NaN
    for (const r of expanded) {
      expect(Number.isNaN(r.score)).toBe(false);
    }

    expect(meta.enabled).toBe(true);
  });

  test('returns original results when graph expansion is disabled', async () => {
    const service = createService();
    const original = [{ id: 'a', score: 1.0, metadata: {} }];

    const { results, meta } = await service._applyGraphExpansion(original, {
      graphExpansion: false
    });

    expect(results).toBe(original);
    expect(meta.enabled).toBe(false);
    expect(meta.reason).toBe('disabled');
  });
});
