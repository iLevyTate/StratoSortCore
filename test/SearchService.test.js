/**
 * Tests for SearchService
 * Focus: RRF fusion and search mode routing.
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
  const parallelEmbeddingService = {
    embedText: jest.fn().mockResolvedValue({ vector: [0.1, 0.2, 0.3], model: 'test-embed' })
  };

  const service = new SearchService({
    vectorDbService,
    analysisHistoryService,
    parallelEmbeddingService
  });

  // Avoid singleton lookups in tests
  service._getQueryProcessor = jest.fn(() => null);
  service._getReRanker = jest.fn(() => null);
  service._enrichResults = jest.fn();
  service.isIndexStale = jest.fn(() => false);
  service.buildBM25Index = jest.fn().mockResolvedValue({ success: true, indexed: 0 });

  return service;
};

describe('SearchService', () => {
  describe('_normalizeScores', () => {
    test('normalizes scores and preserves original', () => {
      const service = createService();
      const results = [
        { id: 'a', score: 0.25 },
        { id: 'b', score: 0.75 }
      ];

      const normalized = service._normalizeScores(results);
      const scoreMap = Object.fromEntries(normalized.map((r) => [r.id, r]));

      expect(scoreMap.a.score).toBe(0);
      expect(scoreMap.b.score).toBe(1);
      expect(scoreMap.a.originalScore).toBe(0.25);
      expect(scoreMap.b.originalScore).toBe(0.75);
    });

    test('preserves actual score when range is zero (no inflation)', () => {
      const service = createService();
      const results = [
        { id: 'a', score: 0.5 },
        { id: 'b', score: 0.5 }
      ];

      const normalized = service._normalizeScores(results);
      normalized.forEach((r) => {
        // When all scores are identical, the normalized score should equal
        // the clamped original — NOT blindly 1.0.
        expect(r.score).toBe(0.5);
        expect(r.originalScore).toBe(0.5);
      });
    });

    test('clamps equal-score results to 1.0 when raw scores exceed 1', () => {
      const service = createService();
      // BM25 scores can be > 1; clamping should cap at 1.0
      const results = [
        { id: 'a', score: 3.5 },
        { id: 'b', score: 3.5 }
      ];

      const normalized = service._normalizeScores(results);
      normalized.forEach((r) => {
        expect(r.score).toBe(1.0);
        expect(r.originalScore).toBe(3.5);
      });
    });
  });

  describe('reciprocalRankFusion', () => {
    test('merges sources and preserves metadata', () => {
      const service = createService();
      const resultSets = [
        [{ id: 'doc-a', score: 0.9, source: 'bm25', matchDetails: { bm25: true } }],
        [
          { id: 'doc-a', score: 0.2, source: 'vector', matchDetails: { vector: true } },
          { id: 'doc-b', score: 0.8, source: 'vector' }
        ]
      ];

      const fused = service.reciprocalRankFusion(resultSets, 60, {
        normalizeScores: true,
        useScoreBlending: true
      });

      const byId = Object.fromEntries(fused.map((r) => [r.id, r]));

      expect(byId['doc-a']).toBeDefined();
      expect(byId['doc-a'].sources).toEqual(expect.arrayContaining(['bm25', 'vector']));
      expect(byId['doc-a'].matchDetails).toEqual(
        expect.objectContaining({ bm25: true, vector: true })
      );
    });

    test('skips results with missing id', () => {
      const service = createService();
      const fused = service.reciprocalRankFusion([[{ score: 0.1 }]], 60);
      expect(fused).toHaveLength(0);
    });
  });

  describe('hybridSearch routing', () => {
    test('returns error on short query', async () => {
      const service = createService();
      const result = await service.hybridSearch('a');
      expect(result.success).toBe(false);
      expect(result.error).toBe('Query too short');
    });

    test('bm25 mode uses bm25Search', async () => {
      const service = createService();
      service.bm25Search = jest.fn().mockResolvedValue([{ id: 'doc', score: 0.9 }]);

      const result = await service.hybridSearch('test query', { mode: 'bm25', topK: 5 });

      expect(service.bm25Search).toHaveBeenCalledWith('test query', 5);
      expect(result.mode).toBe('bm25');
      expect(result.success).toBe(true);
    });

    test('vector mode uses normalized query', async () => {
      const service = createService();
      service.vectorSearch = jest.fn().mockResolvedValue([{ id: 'doc', score: 0.9 }]);

      await service.hybridSearch('  test   query  ', { mode: 'vector', topK: 5 });

      expect(service.vectorSearch).toHaveBeenCalledWith('test query', 5);
    });

    test('vector mode uses corrected query when spell correction applies', async () => {
      const service = createService();
      service.vectorSearch = jest.fn().mockResolvedValue([{ id: 'doc', score: 0.9 }]);
      service._getQueryProcessor = jest.fn(() => ({
        extractFilters: jest.fn(() => ({})),
        processQuery: jest.fn(async () => ({
          original: 'vacaton',
          corrected: 'vacation',
          expanded: 'vacation',
          corrections: [{ original: 'vacaton', corrected: 'vacation' }],
          synonymsAdded: []
        }))
      }));

      await service.hybridSearch('vacaton', {
        mode: 'vector',
        topK: 5,
        correctSpelling: true,
        expandSynonyms: false
      });

      expect(service.vectorSearch).toHaveBeenCalledWith('vacation', 5);
    });

    test('hybrid mode falls back on vector timeout', async () => {
      const service = createService();
      service.bm25Search = jest.fn().mockResolvedValue([{ id: 'doc', score: 0.9 }]);
      service._vectorSearchWithTimeout = jest
        .fn()
        .mockResolvedValue({ results: [], timedOut: true });

      const result = await service.hybridSearch('test query', { mode: 'hybrid', topK: 5 });

      expect(result.mode).toBe('bm25-fallback');
      expect(result.meta?.fallback).toBe(true);
      expect(result.meta?.vectorTimedOut).toBe(true);
    });

    test('hybrid mode falls back when query embedding precompute times out', async () => {
      const service = createService();
      service.bm25Search = jest.fn().mockResolvedValue([{ id: 'doc', score: 0.9 }]);
      service._vectorSearchWithTimeout = jest
        .fn()
        .mockResolvedValue({ results: [{ id: 'vec', score: 0.8 }], timedOut: false });
      service._buildQueryEmbeddingWithTimeout = jest.fn().mockResolvedValue({
        embedding: null,
        timedOut: true,
        error: 'query embedding timeout'
      });

      const result = await service.hybridSearch('test query', { mode: 'hybrid', topK: 5 });

      expect(service._vectorSearchWithTimeout).not.toHaveBeenCalled();
      expect(result.mode).toBe('bm25-fallback');
      expect(result.meta?.fallback).toBe(true);
      expect(result.meta?.fallbackReason).toBe('query embedding timeout');
      expect(Array.isArray(result.meta?.warnings)).toBe(true);
      expect(result.meta?.warnings[0]?.type).toBe('QUERY_EMBEDDING_UNAVAILABLE');
    });

    test('hybrid mode skips chunk search when chunkWeight is 0', async () => {
      const service = createService();
      service.bm25Search = jest.fn().mockResolvedValue([{ id: 'bm', score: 0.9 }]);
      service._vectorSearchWithTimeout = jest
        .fn()
        .mockResolvedValue({ results: [{ id: 'vec', score: 0.8 }], timedOut: false });
      service.chunkSearch = jest.fn().mockResolvedValue([]);

      const result = await service.hybridSearch('test query', {
        mode: 'hybrid',
        topK: 5,
        chunkWeight: 0
      });

      expect(service.chunkSearch).not.toHaveBeenCalled();
      expect(result.success).toBe(true);
    });

    test('hybrid mode routes corrected query to vector and chunk search', async () => {
      const service = createService();
      service.bm25Search = jest.fn().mockResolvedValue([{ id: 'bm', score: 0.9 }]);
      service._vectorSearchWithTimeout = jest
        .fn()
        .mockResolvedValue({ results: [], timedOut: false });
      service.chunkSearch = jest.fn().mockResolvedValue([]);
      service._getQueryProcessor = jest.fn(() => ({
        extractFilters: jest.fn(() => ({})),
        processQuery: jest.fn(async () => ({
          original: 'vacaton',
          corrected: 'vacation',
          expanded: 'vacation',
          corrections: [{ original: 'vacaton', corrected: 'vacation' }],
          synonymsAdded: []
        }))
      }));

      await service.hybridSearch('vacaton', {
        mode: 'hybrid',
        topK: 5,
        correctSpelling: true,
        expandSynonyms: false,
        chunkWeight: 0.5
      });

      expect(service._vectorSearchWithTimeout).toHaveBeenCalledWith(
        'vacation',
        10,
        undefined,
        expect.any(Object)
      );
      expect(service.chunkSearch).toHaveBeenCalledWith(
        'vacation',
        10,
        expect.any(Number),
        expect.any(Object)
      );
    });
  });

  describe('diagnoseSearchIssues', () => {
    test('reports embedding dimension mismatch', async () => {
      const service = createService();

      service.vectorDb.getStats = jest
        .fn()
        .mockResolvedValue({ files: 5, fileChunks: 0, folders: 0 });
      service.vectorDb.getCollectionDimension = jest.fn().mockResolvedValue(768);
      service.getIndexStatus = jest.fn(() => ({
        hasIndex: true,
        documentCount: 5,
        isStale: false
      }));
      service.embedding.embedText = jest.fn().mockResolvedValue({
        vector: new Array(1024).fill(0),
        model: 'mxbai-embed-large-v1-f16.gguf'
      });
      service.history.initialize = jest.fn().mockResolvedValue();
      service.history.analysisHistory = { entries: { a: {}, b: {} } };

      const diagnostics = await service.diagnoseSearchIssues('test');

      expect(diagnostics.issues).toEqual(
        expect.arrayContaining([expect.objectContaining({ type: 'DIMENSION_MISMATCH' })])
      );
    });
  });
});
