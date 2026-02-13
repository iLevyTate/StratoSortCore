/**
 * Extended SearchService tests
 * Focus: BM25 index build semantics, debounced rebuild, chunk context, graph expansion.
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

describe('SearchService (extended)', () => {
  function createService({
    historyEntries = {},
    vectorDbOverrides = {},
    embeddingOverrides = {},
    relationshipIndex = null
  } = {}) {
    const vectorDb = {
      initialize: jest.fn().mockResolvedValue(true),
      getStats: jest.fn().mockResolvedValue({ files: 0, fileChunks: 0, folders: 0 }),
      getCollectionDimension: jest.fn().mockResolvedValue(3),
      querySimilarFileChunks: jest.fn().mockResolvedValue([]),
      getChunksForFile: jest.fn().mockResolvedValue([]),
      peekFiles: jest.fn().mockResolvedValue({ ids: [], embeddings: [], metadatas: [] }),
      getFile: jest.fn().mockResolvedValue(null),
      ...vectorDbOverrides
    };

    const history = {
      initialize: jest.fn().mockResolvedValue(undefined),
      analysisHistory: {
        metadata: { totalEntries: Object.keys(historyEntries).length },
        entries: historyEntries
      }
    };

    const embedding = {
      embedText: jest.fn().mockResolvedValue({ vector: [0.1, 0.2, 0.3] }),
      ...embeddingOverrides
    };

    const service = new SearchService({
      vectorDbService: vectorDb,
      analysisHistoryService: history,
      parallelEmbeddingService: embedding,
      relationshipIndexService: relationshipIndex
    });

    // Avoid incidental enrichment dependencies in these tests
    service._enrichResults = jest.fn();
    return { service, vectorDb, history, embedding };
  }

  describe('buildBM25Index', () => {
    test('dedupes by canonical file id and prefers most recent analysis; uses post-organization path/name', async () => {
      const entries = {
        newest: {
          id: 'newest',
          timestamp: '2026-01-02T00:00:00.000Z',
          originalPath: 'C:\\Docs\\Report.pdf',
          fileName: 'Report.pdf',
          mimeType: 'application/pdf',
          analysis: {
            subject: 'Annual report',
            tags: '["finance", "2026"]',
            keyEntities: 'Alice,Bob',
            extractedText: 'x'.repeat(6000),
            category: 'Financial',
            confidence: 0.88
          },
          organization: {
            actual: 'C:\\Sorted\\Financial\\Annual-Report.pdf',
            newName: 'Annual-Report.pdf'
          }
        },
        olderDuplicate: {
          id: 'olderDuplicate',
          timestamp: '2025-01-02T00:00:00.000Z',
          originalPath: 'C:\\Docs\\Report.pdf',
          fileName: 'Report.pdf',
          analysis: {
            subject: 'Old subject',
            tags: 'a,b'
          },
          organization: {}
        },
        other: {
          id: 'other',
          timestamp: '2026-01-01T00:00:00.000Z',
          originalPath: 'C:\\Docs\\Other.pdf',
          fileName: 'Other.pdf',
          analysis: {
            subject: 'Other',
            tags: ['x'],
            keyEntities: ['E1']
          },
          organization: {}
        }
      };

      const { service } = createService({ historyEntries: entries });
      const result = await service.buildBM25Index();

      expect(result.success).toBe(true);
      // Paths differ after organization, so the service indexes both canonical IDs.
      expect(result.indexed).toBe(3);
      expect(service.documentMap.size).toBe(3);

      const docs = Array.from(service.documentMap.values());
      const reportMeta = docs.find((d) => d.name === 'Annual-Report.pdf');
      expect(reportMeta).toBeDefined();
      expect(reportMeta.path).toBe('C:\\Sorted\\Financial\\Annual-Report.pdf');
      expect(reportMeta.tags).toEqual(['finance', '2026']);
      expect(reportMeta.keyEntities).toEqual(['Alice', 'Bob']);

      // Ensure the original (pre-move) canonical ID is still present as a separate entry
      const oldMeta = docs.find((d) => d.path === 'C:\\Docs\\Report.pdf');
      expect(oldMeta).toBeDefined();
    });

    test('returns indexed=0 and sets indexBuiltAt when there are no documents', async () => {
      const { service } = createService({ historyEntries: {} });
      const result = await service.buildBM25Index();
      expect(result).toEqual({ success: true, indexed: 0 });
      expect(service.indexBuiltAt).toEqual(expect.any(Number));
    });
  });

  describe('invalidateAndRebuild', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    test('debounces rapid rebuild requests and resolves all callers', async () => {
      const { service } = createService({ historyEntries: {} });
      service.buildBM25Index = jest.fn().mockResolvedValue({ success: true, indexed: 7 });
      service.indexBuiltAt = Date.now();

      const p1 = service.invalidateAndRebuild({ immediate: true, reason: 'file-move' });
      const p2 = service.invalidateAndRebuild({ immediate: true, reason: 'file-move' });

      jest.advanceTimersByTime(service._REBUILD_DEBOUNCE_MS);

      await expect(p1).resolves.toEqual(
        expect.objectContaining({ success: true, rebuilt: true, indexed: 7 })
      );
      await expect(p2).resolves.toEqual(
        expect.objectContaining({ success: true, rebuilt: true, indexed: 7 })
      );
      expect(service.buildBM25Index).toHaveBeenCalledTimes(1);
    });

    test('when immediate=false it only invalidates and does not rebuild', async () => {
      const { service } = createService({ historyEntries: {} });
      service.buildBM25Index = jest.fn();
      service.indexBuiltAt = Date.now();

      const result = await service.invalidateAndRebuild({ immediate: false, reason: 'manual' });

      expect(result).toEqual({ success: true, rebuilt: false });
      expect(service.buildBM25Index).not.toHaveBeenCalled();
    });
  });

  describe('chunkSearch + context attachment', () => {
    test('attaches context snippet when chunk context is supported', async () => {
      const getChunksForFile = jest.fn().mockResolvedValue([
        { chunkIndex: 4, text: 'alpha', snippet: 'alpha' },
        { chunkIndex: 5, text: 'bravo', snippet: 'bravo' },
        { chunkIndex: 6, text: 'charlie', snippet: 'charlie' }
      ]);

      const { service, vectorDb } = createService({
        vectorDbOverrides: {
          getStats: jest.fn().mockResolvedValue({ files: 3, fileChunks: 3, folders: 0 }),
          getChunksForFile,
          getCollectionDimension: jest.fn().mockResolvedValue(3),
          querySimilarFileChunks: jest.fn().mockResolvedValue([
            {
              score: 0.77,
              metadata: {
                fileId: 'file:one',
                path: 'C:\\one.txt',
                name: 'one.txt',
                type: 'document',
                chunkIndex: 5,
                snippet: 'bravo'
              }
            }
          ])
        }
      });

      // Keep vector validation permissive by matching dimensions
      vectorDb.getCollectionDimension.mockResolvedValue(3);

      const results = await service.chunkSearch('hello world', 5, 10, {
        chunkContext: true,
        chunkContextMaxNeighbors: 1,
        chunkContextMaxFiles: 5,
        chunkContextMaxChars: 1000
      });

      expect(results).toHaveLength(1);
      expect(getChunksForFile).toHaveBeenCalled();
      expect(results[0].matchDetails.contextSnippet).toContain('alpha');
      expect(results[0].matchDetails.contextSnippet).toContain('bravo');
      expect(results[0].matchDetails.contextSnippet).toContain('charlie');
    });
  });

  describe('_applyGraphExpansion', () => {
    test('adds neighbor results with graph contribution', async () => {
      const relationshipIndex = {
        getNeighborEdges: jest.fn().mockResolvedValue({
          edges: [{ source: 'file:a', target: 'file:b', weight: 1, concepts: ['x'] }]
        })
      };

      const { service } = createService({
        historyEntries: {},
        relationshipIndex
      });

      service.relationshipIndex = relationshipIndex;
      service.documentMap.set('file:b', { path: 'C:\\b.txt', name: 'b.txt' });

      const seed = [{ id: 'file:a', score: 1, sources: ['vector'], matchDetails: { sources: [] } }];
      const { results, meta } = await service._applyGraphExpansion(seed, {
        graphExpansion: true,
        graphExpansionWeight: 0.5,
        graphExpansionDecay: 1,
        graphExpansionMaxNeighbors: 10,
        graphExpansionMaxSeeds: 5,
        graphExpansionMaxEdges: 50,
        graphExpansionMinWeight: 0
      });

      expect(meta.enabled).toBe(true);
      expect(meta.expanded).toBe(true);
      expect(meta.addedCount).toBe(1);

      const byId = Object.fromEntries(results.map((r) => [r.id, r]));
      expect(byId['file:b']).toBeDefined();
      expect(byId['file:b'].sources).toContain('graph');
      expect(byId['file:b'].matchDetails.graph).toEqual(
        expect.objectContaining({ score: expect.any(Number), connections: expect.any(Array) })
      );
    });

    test('returns disabled meta when relationship index missing', async () => {
      const { service } = createService({ relationshipIndex: null });
      const { meta } = await service._applyGraphExpansion([{ id: 'x', score: 1 }], {
        graphExpansion: true
      });
      expect(meta.enabled).toBe(false);
      expect(meta.expanded).toBe(false);
    });
  });
});
