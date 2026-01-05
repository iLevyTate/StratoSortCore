const FolderMatchingService = require('../src/main/services/FolderMatchingService');

// Mock dependencies
const mockChromaDbService = {
  initialize: jest.fn().mockResolvedValue(),
  upsertFolder: jest.fn().mockResolvedValue({ success: true }),
  upsertFile: jest.fn().mockResolvedValue({ success: true }),
  batchUpsertFolders: jest.fn().mockResolvedValue(0),
  queryFolders: jest.fn().mockResolvedValue([]),
  queryFoldersByEmbedding: jest.fn().mockResolvedValue([]),
  querySimilarFiles: jest.fn().mockResolvedValue([]),
  batchQueryFolders: jest.fn().mockResolvedValue({}),
  fileCollection: {
    get: jest.fn().mockResolvedValue({ embeddings: [[0.1, 0.2]] })
  },
  resetAll: jest.fn().mockResolvedValue()
};

const mockOllama = {
  embed: jest.fn().mockResolvedValue({ embeddings: [[0.1, 0.2]] }),
  onModelChange: jest.fn().mockReturnValue(() => {}) // Return unsubscribe fn
};

const mockEmbeddingCache = {
  get: jest.fn(),
  set: jest.fn(),
  invalidateOnModelChange: jest.fn().mockReturnValue(true),
  getStats: jest.fn().mockReturnValue({ size: 0, hits: 0, misses: 0 }),
  initialize: jest.fn(),
  shutdown: jest.fn(),
  initialized: true
};

const mockParallelEmbeddingService = {
  batchEmbedFolders: jest.fn().mockResolvedValue({ results: [], errors: [], stats: {} }),
  batchEmbedFileSummaries: jest.fn().mockResolvedValue({ results: [], errors: [], stats: {} })
};

// Mock modules
jest.mock('../src/main/ollamaUtils', () => ({
  getOllama: jest.fn(() => mockOllama),
  getOllamaEmbeddingModel: jest.fn().mockReturnValue('mxbai-embed-large')
}));

jest.mock('../src/shared/logger', () => ({
  logger: {
    setContext: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
  }
}));

jest.mock('../src/main/services/PerformanceService', () => ({
  buildOllamaOptions: jest.fn().mockResolvedValue({})
}));

jest.mock('../src/main/services/OllamaService', () => ({
  getInstance: jest.fn(() => mockOllama)
}));

jest.mock('../src/main/analysis/semanticExtensionMap', () => ({
  enrichFolderTextForEmbedding: jest.fn((name, desc) => `${name} ${desc}`)
}));

jest.mock('../src/shared/config/index', () => ({
  get: jest.fn((key, def) => def)
}));

describe('FolderMatchingService Extended Tests', () => {
  let service;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new FolderMatchingService(mockChromaDbService, {
      embeddingCache: mockEmbeddingCache,
      parallelEmbeddingService: mockParallelEmbeddingService
    });
  });

  describe('Model Change Handling', () => {
    test('subscribes to model changes on init', () => {
      // Logic runs in constructor
      expect(mockOllama.onModelChange).toHaveBeenCalled();
    });

    test('invalidates cache and resets chroma on embedding model change', async () => {
      // Trigger the callback registered in constructor
      const callback = mockOllama.onModelChange.mock.calls[0][0];

      await callback({
        type: 'embedding',
        previousModel: 'old-model',
        newModel: 'new-model'
      });

      expect(mockEmbeddingCache.invalidateOnModelChange).toHaveBeenCalledWith(
        'new-model',
        'old-model'
      );
      expect(mockChromaDbService.resetAll).toHaveBeenCalled();
    });

    test('ignores non-embedding model changes', async () => {
      const callback = mockOllama.onModelChange.mock.calls[0][0];

      await callback({
        type: 'chat',
        previousModel: 'old',
        newModel: 'new'
      });

      expect(mockEmbeddingCache.invalidateOnModelChange).not.toHaveBeenCalled();
      expect(mockChromaDbService.resetAll).not.toHaveBeenCalled();
    });
  });

  describe('Embedding Dimensions', () => {
    test('pads vector if shorter than expected', async () => {
      // Expect default 768 (or configured default)
      // Mock embed returning short vector
      mockOllama.embed.mockResolvedValueOnce({ embeddings: [[0.1]] });

      const result = await service.embedText('test');
      // Default dimension is 768 or 1024 depending on mock/config.
      // Test mock says 'mxbai-embed-large' which is 1024 in constants.
      expect(result.vector.length).toBe(1024);
      expect(result.vector[0]).toBe(0.1);
      expect(result.vector[1]).toBe(0); // Padded with 0
    });

    test('truncates vector if longer than expected', async () => {
      // Mock huge vector
      const hugeVector = new Array(2048).fill(0.5);
      mockOllama.embed.mockResolvedValueOnce({ embeddings: [hugeVector] });

      const result = await service.embedText('test');
      expect(result.vector.length).toBe(1024);
      expect(result.vector[0]).toBe(0.5);
    });
  });

  describe('Batch Operations', () => {
    test('batchUpsertFolders uses parallel service', async () => {
      const folders = [{ name: 'F1' }, { name: 'F2' }];
      mockParallelEmbeddingService.batchEmbedFolders.mockResolvedValue({
        results: [
          { id: 'folder:F1', vector: [1], model: 'test', success: true },
          { id: 'folder:F2', vector: [2], model: 'test', success: true }
        ],
        errors: [],
        stats: {}
      });

      // Mock map logic relies on IDs. The service generates IDs if missing.
      // We need to ensure the mocked results match the generated IDs.
      // Since we can't easily predict generated IDs in mock return without spy,
      // let's provide IDs.
      const foldersWithIds = [
        { id: 'f1', name: 'F1' },
        { id: 'f2', name: 'F2' }
      ];

      mockParallelEmbeddingService.batchEmbedFolders.mockResolvedValue({
        results: [
          { id: 'f1', vector: [1], model: 'test', success: true },
          { id: 'f2', vector: [2], model: 'test', success: true }
        ],
        errors: [],
        stats: {}
      });

      await service.batchUpsertFolders(foldersWithIds);

      expect(mockParallelEmbeddingService.batchEmbedFolders).toHaveBeenCalled();
      expect(mockChromaDbService.batchUpsertFolders).toHaveBeenCalled();
    });

    test('batchUpsertFolders handles partial cache hits', async () => {
      // The implementation calls batchEmbedFolders for uncached items.
      // The mocked batchEmbedFolders returns results.
      // The implementation then combines cached results + embed results and upserts to Chroma.
      // BUT: The mocked batchEmbedFolders returns EMPTY results by default in this test block unless overridden.
      // We need to mock the return value for the "Uncached" folder so it gets added to the payload.

      // Mock result for Uncached folder
      // We need to know the generated ID. The service uses generateFolderId.
      // Let's provide an ID to make it deterministic.
      const foldersWithIds = [
        { id: 'cached', name: 'Cached' },
        { id: 'uncached', name: 'Uncached' }
      ];

      mockEmbeddingCache.get.mockImplementation((text) => {
        if (text.includes('Cached')) return { vector: [1], model: 'test' };
        return null;
      });

      mockParallelEmbeddingService.batchEmbedFolders.mockResolvedValue({
        results: [{ id: 'uncached', vector: [2], model: 'test', success: true }],
        errors: [],
        stats: {}
      });

      await service.batchUpsertFolders(foldersWithIds);

      // Only 'Uncached' should be sent to parallel service
      expect(mockParallelEmbeddingService.batchEmbedFolders).toHaveBeenCalledWith(
        expect.arrayContaining([expect.objectContaining({ name: 'Uncached' })]),
        expect.anything()
      );

      // Both should be upserted to Chroma (one from cache, one generated)
      expect(mockChromaDbService.batchUpsertFolders).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ name: 'Cached' }),
          expect.objectContaining({ name: 'Uncached' })
        ])
      );
    });

    test('batchGenerateFileEmbeddings uses parallel service', async () => {
      const items = [{ fileId: 'f1', summary: 's1' }];
      await service.batchGenerateFileEmbeddings(items);
      expect(mockParallelEmbeddingService.batchEmbedFileSummaries).toHaveBeenCalled();
    });
  });

  describe('Multi-hop Search', () => {
    test('findMultiHopNeighbors explores graph', async () => {
      // Mock findSimilarFiles to return neighbors
      jest
        .spyOn(service, 'findSimilarFiles')
        .mockResolvedValueOnce([{ id: 'n1', score: 0.9 }]) // Hop 1
        .mockResolvedValueOnce([{ id: 'n2', score: 0.8 }]); // Hop 2

      const results = await service.findMultiHopNeighbors(['seed'], { maxHops: 2 });

      expect(results.length).toBeGreaterThan(0);
      expect(results.find((r) => r.id === 'n1')).toBeDefined();
      expect(results.find((r) => r.id === 'n2')).toBeDefined();
    });

    test('findMultiHopNeighbors handles cycles/visited', async () => {
      jest.spyOn(service, 'findSimilarFiles').mockResolvedValueOnce([{ id: 'seed', score: 1.0 }]); // Hop 1 points back to seed

      const results = await service.findMultiHopNeighbors(['seed']);
      expect(results).toEqual([]); // No NEW nodes found
    });
  });

  describe('Edge Cases & Error Handling', () => {
    test('batchMatchFilesToFolders handles missing chroma', async () => {
      service.chromaDbService = null;
      const res = await service.batchMatchFilesToFolders(['f1']);
      expect(res).toEqual({});
    });

    test('matchVectorToFolders handles missing chroma', async () => {
      service.chromaDbService = null;
      const res = await service.matchVectorToFolders([1]);
      expect(res).toEqual([]);
    });

    test('findSimilarFiles handles missing chroma', async () => {
      service.chromaDbService = null;
      const res = await service.findSimilarFiles('f1');
      expect(res).toEqual([]);
    });

    test('upsertFolderEmbedding handles missing chroma', async () => {
      service.chromaDbService = null;
      await expect(service.upsertFolderEmbedding({ name: 'f' })).rejects.toThrow();
    });

    test('batchUpsertFolders defers on startup error', async () => {
      const err = new Error('ChromaNotFoundError');
      err.name = 'ChromaNotFoundError';
      mockChromaDbService.initialize.mockRejectedValueOnce(err);

      const res = await service.batchUpsertFolders([{ name: 'f' }]);
      expect(res.stats.deferred).toBe(true);
      expect(res.skipped[0].error).toBe('chromadb_not_ready');
    });
  });

  describe('Static Helper', () => {
    test('matchCategoryToFolder matches exact', () => {
      const folders = [{ name: 'Docs' }];
      expect(FolderMatchingService.matchCategoryToFolder('docs', folders)).toBe('Docs');
    });

    test('matchCategoryToFolder falls back to Uncategorized', () => {
      const folders = [{ name: 'Work' }, { name: 'Uncategorized' }];
      expect(FolderMatchingService.matchCategoryToFolder('RandomStuff', folders)).toBe(
        'Uncategorized'
      );
    });

    test('matchCategoryToFolder fuzzy matches', () => {
      const folders = [{ name: 'Financial Documents' }];
      expect(FolderMatchingService.matchCategoryToFolder('finance', folders)).toBe(
        'Financial Documents'
      );
    });
  });
});
