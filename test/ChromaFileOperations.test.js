/**
 * Tests for ChromaDB File Operations
 * Tests file embedding operations for ChromaDB
 */

// Mock logger
jest.mock('../src/shared/logger', () => ({
  logger: {
    setContext: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  }
}));

// Mock errorHandlingUtils
jest.mock('../src/shared/errorHandlingUtils', () => ({
  withRetry: jest.fn((fn) => fn)
}));

// Mock pathSanitization
jest.mock('../src/shared/pathSanitization', () => ({
  sanitizeMetadata: jest.fn((meta) => meta),
  prepareFileMetadata: jest.fn((file) => ({
    path: file?.meta?.path || '',
    name: file?.meta?.name || '',
    model: file?.model || '',
    updatedAt: file?.updatedAt || new Date().toISOString(),
    ...(file?.meta || {})
  }))
}));

// Mock OfflineQueue
jest.mock('../src/main/utils/OfflineQueue', () => ({
  OperationType: {
    UPSERT_FILE: 'upsert_file',
    DELETE_FILE: 'delete_file'
  }
}));

describe('ChromaDB File Operations', () => {
  let directUpsertFile;
  let directBatchUpsertFiles;
  let deleteFileEmbedding;
  let batchDeleteFileEmbeddings;
  let updateFilePaths;
  let querySimilarFiles;
  let resetFiles;

  let mockFileCollection;
  let mockQueryCache;
  let mockClient;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();

    mockFileCollection = {
      upsert: jest.fn().mockResolvedValue(undefined),
      delete: jest.fn().mockResolvedValue(undefined),
      get: jest.fn().mockResolvedValue({ ids: [], embeddings: [], metadatas: [] }),
      query: jest.fn().mockResolvedValue({ ids: [[]], distances: [[]], metadatas: [[]] }),
      count: jest.fn().mockResolvedValue(10)
    };

    mockQueryCache = {
      invalidateForFile: jest.fn()
    };

    mockClient = {
      deleteCollection: jest.fn().mockResolvedValue(undefined),
      createCollection: jest.fn().mockResolvedValue(mockFileCollection)
    };

    const module = require('../src/main/services/chromadb/fileOperations');
    directUpsertFile = module.directUpsertFile;
    directBatchUpsertFiles = module.directBatchUpsertFiles;
    deleteFileEmbedding = module.deleteFileEmbedding;
    batchDeleteFileEmbeddings = module.batchDeleteFileEmbeddings;
    updateFilePaths = module.updateFilePaths;
    querySimilarFiles = module.querySimilarFiles;
    resetFiles = module.resetFiles;
  });

  describe('directUpsertFile', () => {
    test('upserts file with correct format', async () => {
      const file = {
        id: 'file-123',
        vector: [0.1, 0.2, 0.3],
        meta: { path: '/test/file.txt', name: 'file.txt' },
        model: 'mxbai-embed-large',
        updatedAt: '2024-01-01T00:00:00Z'
      };

      await directUpsertFile({
        file,
        fileCollection: mockFileCollection,
        queryCache: mockQueryCache
      });

      expect(mockFileCollection.upsert).toHaveBeenCalledWith({
        ids: ['file-123'],
        embeddings: [[0.1, 0.2, 0.3]],
        metadatas: [expect.objectContaining({ path: '/test/file.txt' })],
        documents: ['/test/file.txt']
      });
    });

    test('invalidates query cache after upsert', async () => {
      const file = {
        id: 'file-123',
        vector: [0.1, 0.2, 0.3],
        meta: { path: '/test/file.txt' }
      };

      await directUpsertFile({
        file,
        fileCollection: mockFileCollection,
        queryCache: mockQueryCache
      });

      expect(mockQueryCache.invalidateForFile).toHaveBeenCalledWith('file-123');
    });

    test('handles missing meta gracefully', async () => {
      const file = {
        id: 'file-123',
        vector: [0.1, 0.2, 0.3]
      };

      await directUpsertFile({
        file,
        fileCollection: mockFileCollection,
        queryCache: mockQueryCache
      });

      expect(mockFileCollection.upsert).toHaveBeenCalled();
    });

    test('throws on upsert failure', async () => {
      mockFileCollection.upsert.mockRejectedValueOnce(new Error('DB error'));

      const file = {
        id: 'file-123',
        vector: [0.1, 0.2, 0.3]
      };

      await expect(
        directUpsertFile({
          file,
          fileCollection: mockFileCollection,
          queryCache: mockQueryCache
        })
      ).rejects.toThrow('DB error');
    });

    test('works without query cache', async () => {
      const file = {
        id: 'file-123',
        vector: [0.1, 0.2, 0.3]
      };

      await directUpsertFile({
        file,
        fileCollection: mockFileCollection,
        queryCache: null
      });

      expect(mockFileCollection.upsert).toHaveBeenCalled();
    });
  });

  describe('directBatchUpsertFiles', () => {
    test('upserts multiple files', async () => {
      const files = [
        { id: 'file-1', vector: [0.1], meta: { path: '/a.txt' } },
        { id: 'file-2', vector: [0.2], meta: { path: '/b.txt' } }
      ];

      const result = await directBatchUpsertFiles({
        files,
        fileCollection: mockFileCollection,
        queryCache: mockQueryCache
      });

      expect(result).toBe(2);
      expect(mockFileCollection.upsert).toHaveBeenCalledWith({
        ids: ['file-1', 'file-2'],
        embeddings: [[0.1], [0.2]],
        metadatas: expect.any(Array),
        documents: expect.any(Array)
      });
    });

    test('skips invalid files', async () => {
      const files = [
        { id: 'file-1', vector: [0.1] },
        { id: null, vector: [0.2] }, // Missing ID
        { id: 'file-3', vector: null }, // Missing vector
        { id: 'file-4', vector: 'not array' } // Invalid vector
      ];

      const result = await directBatchUpsertFiles({
        files,
        fileCollection: mockFileCollection,
        queryCache: mockQueryCache
      });

      expect(result).toBe(1);
    });

    test('invalidates cache for all files', async () => {
      const files = [
        { id: 'file-1', vector: [0.1] },
        { id: 'file-2', vector: [0.2] }
      ];

      await directBatchUpsertFiles({
        files,
        fileCollection: mockFileCollection,
        queryCache: mockQueryCache
      });

      expect(mockQueryCache.invalidateForFile).toHaveBeenCalledWith('file-1');
      expect(mockQueryCache.invalidateForFile).toHaveBeenCalledWith('file-2');
    });

    test('returns 0 for empty array', async () => {
      const result = await directBatchUpsertFiles({
        files: [],
        fileCollection: mockFileCollection,
        queryCache: mockQueryCache
      });

      expect(result).toBe(0);
      expect(mockFileCollection.upsert).not.toHaveBeenCalled();
    });

    test('throws on upsert failure', async () => {
      mockFileCollection.upsert.mockRejectedValueOnce(new Error('Batch failed'));

      const files = [{ id: 'file-1', vector: [0.1] }];

      await expect(
        directBatchUpsertFiles({
          files,
          fileCollection: mockFileCollection,
          queryCache: mockQueryCache
        })
      ).rejects.toThrow('Batch failed');
    });
  });

  describe('deleteFileEmbedding', () => {
    test('deletes file and invalidates cache', async () => {
      const result = await deleteFileEmbedding({
        fileId: 'file-123',
        fileCollection: mockFileCollection,
        queryCache: mockQueryCache
      });

      expect(result).toBe(true);
      expect(mockFileCollection.delete).toHaveBeenCalledWith({ ids: ['file-123'] });
      expect(mockQueryCache.invalidateForFile).toHaveBeenCalledWith('file-123');
    });

    test('returns false on error', async () => {
      mockFileCollection.delete.mockRejectedValueOnce(new Error('Delete failed'));

      const result = await deleteFileEmbedding({
        fileId: 'file-123',
        fileCollection: mockFileCollection,
        queryCache: mockQueryCache
      });

      expect(result).toBe(false);
    });

    test('works without query cache', async () => {
      const result = await deleteFileEmbedding({
        fileId: 'file-123',
        fileCollection: mockFileCollection,
        queryCache: null
      });

      expect(result).toBe(true);
    });
  });

  describe('batchDeleteFileEmbeddings', () => {
    test('deletes multiple files', async () => {
      const result = await batchDeleteFileEmbeddings({
        fileIds: ['file-1', 'file-2', 'file-3'],
        fileCollection: mockFileCollection,
        queryCache: mockQueryCache
      });

      expect(result).toBe(3);
      expect(mockFileCollection.delete).toHaveBeenCalledWith({
        ids: ['file-1', 'file-2', 'file-3']
      });
    });

    test('returns 0 for empty array', async () => {
      const result = await batchDeleteFileEmbeddings({
        fileIds: [],
        fileCollection: mockFileCollection,
        queryCache: mockQueryCache
      });

      expect(result).toBe(0);
      expect(mockFileCollection.delete).not.toHaveBeenCalled();
    });

    test('returns 0 for null input', async () => {
      const result = await batchDeleteFileEmbeddings({
        fileIds: null,
        fileCollection: mockFileCollection,
        queryCache: mockQueryCache
      });

      expect(result).toBe(0);
    });

    test('invalidates cache for all files', async () => {
      await batchDeleteFileEmbeddings({
        fileIds: ['file-1', 'file-2'],
        fileCollection: mockFileCollection,
        queryCache: mockQueryCache
      });

      expect(mockQueryCache.invalidateForFile).toHaveBeenCalledWith('file-1');
      expect(mockQueryCache.invalidateForFile).toHaveBeenCalledWith('file-2');
    });

    test('throws on delete failure', async () => {
      mockFileCollection.delete.mockRejectedValueOnce(new Error('Batch delete failed'));

      await expect(
        batchDeleteFileEmbeddings({
          fileIds: ['file-1'],
          fileCollection: mockFileCollection,
          queryCache: mockQueryCache
        })
      ).rejects.toThrow('Batch delete failed');
    });
  });

  describe('updateFilePaths', () => {
    test('updates file paths in batches', async () => {
      mockFileCollection.get.mockResolvedValueOnce({
        ids: ['old-id'],
        embeddings: [[0.1, 0.2]],
        metadatas: [{ path: '/old/path.txt' }]
      });

      const pathUpdates = [
        {
          oldId: 'old-id',
          newId: 'new-id',
          newMeta: { path: '/new/path.txt', name: 'path.txt' }
        }
      ];

      const result = await updateFilePaths({
        pathUpdates,
        fileCollection: mockFileCollection,
        queryCache: mockQueryCache
      });

      expect(result).toBe(1);
      expect(mockFileCollection.upsert).toHaveBeenCalled();
    });

    test('returns 0 for empty array', async () => {
      const result = await updateFilePaths({
        pathUpdates: [],
        fileCollection: mockFileCollection,
        queryCache: mockQueryCache
      });

      expect(result).toBe(0);
    });

    test('returns 0 for null input', async () => {
      const result = await updateFilePaths({
        pathUpdates: null,
        fileCollection: mockFileCollection,
        queryCache: mockQueryCache
      });

      expect(result).toBe(0);
    });

    test('skips invalid path updates', async () => {
      const pathUpdates = [
        { oldId: null, newId: 'new-id' }, // Missing oldId
        { oldId: 'old-id', newId: null } // Missing newId
      ];

      const result = await updateFilePaths({
        pathUpdates,
        fileCollection: mockFileCollection,
        queryCache: mockQueryCache
      });

      expect(result).toBe(0);
    });

    test('skips files not found in collection', async () => {
      mockFileCollection.get.mockResolvedValueOnce({
        ids: [],
        embeddings: [],
        metadatas: []
      });

      const pathUpdates = [{ oldId: 'not-found', newId: 'new-id', newMeta: {} }];

      const result = await updateFilePaths({
        pathUpdates,
        fileCollection: mockFileCollection,
        queryCache: mockQueryCache
      });

      expect(result).toBe(0);
    });

    test('deletes old entry when ID changes', async () => {
      mockFileCollection.get.mockResolvedValueOnce({
        ids: ['old-id'],
        embeddings: [[0.1]],
        metadatas: [{}]
      });

      const pathUpdates = [{ oldId: 'old-id', newId: 'new-id', newMeta: { path: '/new.txt' } }];

      await updateFilePaths({
        pathUpdates,
        fileCollection: mockFileCollection,
        queryCache: mockQueryCache
      });

      expect(mockFileCollection.delete).toHaveBeenCalledWith({ ids: ['old-id'] });
    });

    test('handles delete error gracefully', async () => {
      mockFileCollection.get.mockResolvedValueOnce({
        ids: ['old-id'],
        embeddings: [[0.1]],
        metadatas: [{}]
      });
      mockFileCollection.delete.mockRejectedValueOnce(new Error('Delete failed'));

      const pathUpdates = [{ oldId: 'old-id', newId: 'new-id', newMeta: { path: '/new.txt' } }];

      // Should not throw
      const result = await updateFilePaths({
        pathUpdates,
        fileCollection: mockFileCollection,
        queryCache: mockQueryCache
      });

      expect(result).toBe(1);
    });
  });

  describe('querySimilarFiles', () => {
    test('returns similar files with scores', async () => {
      mockFileCollection.query.mockResolvedValueOnce({
        ids: [['file-1', 'file-2']],
        distances: [[0.2, 0.4]],
        metadatas: [[{ path: '/a.txt' }, { path: '/b.txt' }]],
        documents: [['/a.txt', '/b.txt']]
      });

      const result = await querySimilarFiles({
        queryEmbedding: [0.1, 0.2],
        topK: 5,
        fileCollection: mockFileCollection
      });

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('file-1');
      expect(result[0].score).toBeGreaterThan(result[1].score);
    });

    test('returns empty array for no results', async () => {
      mockFileCollection.query.mockResolvedValueOnce({
        ids: [[]],
        distances: [[]],
        metadatas: [[]]
      });

      const result = await querySimilarFiles({
        queryEmbedding: [0.1],
        topK: 5,
        fileCollection: mockFileCollection
      });

      expect(result).toEqual([]);
    });

    test('returns empty array on error', async () => {
      mockFileCollection.query.mockRejectedValueOnce(new Error('Query failed'));

      const result = await querySimilarFiles({
        queryEmbedding: [0.1],
        topK: 5,
        fileCollection: mockFileCollection
      });

      expect(result).toEqual([]);
    });

    test('handles missing result arrays gracefully', async () => {
      mockFileCollection.query.mockResolvedValueOnce({
        ids: [['file-1']],
        distances: undefined,
        metadatas: undefined
      });

      const result = await querySimilarFiles({
        queryEmbedding: [0.1],
        topK: 5,
        fileCollection: mockFileCollection
      });

      expect(result).toHaveLength(1);
    });

    test('converts distance to similarity score correctly', async () => {
      mockFileCollection.query.mockResolvedValueOnce({
        ids: [['file-1']],
        distances: [[0]], // Distance 0 = perfect match
        metadatas: [[]],
        documents: [[]]
      });

      const result = await querySimilarFiles({
        queryEmbedding: [0.1],
        topK: 5,
        fileCollection: mockFileCollection
      });

      expect(result[0].score).toBe(1); // Perfect score
    });
  });

  describe('resetFiles', () => {
    const mockEmbeddingFunction = { generate: jest.fn() };

    test('deletes and recreates collection', async () => {
      const result = await resetFiles({
        client: mockClient,
        embeddingFunction: mockEmbeddingFunction
      });

      expect(mockClient.deleteCollection).toHaveBeenCalledWith({
        name: 'file_embeddings'
      });
      expect(mockClient.createCollection).toHaveBeenCalledWith({
        name: 'file_embeddings',
        embeddingFunction: mockEmbeddingFunction,
        metadata: expect.objectContaining({
          'hnsw:space': 'cosine'
        })
      });
      expect(result).toBe(mockFileCollection);
    });

    test('throws on failure', async () => {
      mockClient.deleteCollection.mockRejectedValueOnce(new Error('Reset failed'));

      await expect(
        resetFiles({ client: mockClient, embeddingFunction: mockEmbeddingFunction })
      ).rejects.toThrow('Reset failed');
    });
  });
});
