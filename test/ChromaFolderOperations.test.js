/**
 * Tests for ChromaDB Folder Operations
 * Tests folder embedding operations for ChromaDB
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
  prepareFolderMetadata: jest.fn((folder) => ({
    name: folder?.name || '',
    description: folder?.description || '',
    path: folder?.path || '',
    model: folder?.model || '',
    updatedAt: folder?.updatedAt || new Date().toISOString()
  }))
}));

describe('ChromaDB Folder Operations', () => {
  let directUpsertFolder;
  let directBatchUpsertFolders;
  let queryFoldersByEmbedding;
  let executeQueryFolders;
  let batchQueryFolders;
  let getAllFolders;
  let resetFolders;

  let mockFileCollection;
  let mockFolderCollection;
  let mockQueryCache;
  let mockClient;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();

    mockFileCollection = {
      get: jest.fn().mockResolvedValue({
        ids: ['file-1'],
        embeddings: [[0.1, 0.2, 0.3]],
        metadatas: [{}]
      })
    };

    mockFolderCollection = {
      upsert: jest.fn().mockResolvedValue(undefined),
      query: jest.fn().mockResolvedValue({
        ids: [['folder-1']],
        distances: [[0.2]],
        metadatas: [[{ name: 'Folder 1' }]]
      }),
      get: jest.fn().mockResolvedValue({
        ids: ['folder-1'],
        embeddings: [[0.1]],
        metadatas: [{ name: 'Folder 1' }]
      })
    };

    mockQueryCache = {
      invalidateForFolder: jest.fn(),
      set: jest.fn()
    };

    mockClient = {
      deleteCollection: jest.fn().mockResolvedValue(undefined),
      createCollection: jest.fn().mockResolvedValue(mockFolderCollection)
    };

    const module = require('../src/main/services/chromadb/folderEmbeddings');
    directUpsertFolder = module.directUpsertFolder;
    directBatchUpsertFolders = module.directBatchUpsertFolders;
    queryFoldersByEmbedding = module.queryFoldersByEmbedding;
    executeQueryFolders = module.executeQueryFolders;
    batchQueryFolders = module.batchQueryFolders;
    getAllFolders = module.getAllFolders;
    resetFolders = module.resetFolders;
  });

  describe('directUpsertFolder', () => {
    test('upserts folder with correct format', async () => {
      const folder = {
        id: 'folder-123',
        name: 'Documents',
        vector: [0.1, 0.2, 0.3],
        description: 'My documents folder',
        path: '/home/user/Documents',
        model: 'mxbai-embed-large'
      };

      await directUpsertFolder({
        folder,
        folderCollection: mockFolderCollection,
        queryCache: mockQueryCache
      });

      expect(mockFolderCollection.upsert).toHaveBeenCalledWith({
        ids: ['folder-123'],
        embeddings: [[0.1, 0.2, 0.3]],
        metadatas: [expect.objectContaining({ name: 'Documents' })],
        documents: ['Documents']
      });
    });

    test('invalidates query cache after upsert', async () => {
      const folder = {
        id: 'folder-123',
        name: 'Docs',
        vector: [0.1]
      };

      await directUpsertFolder({
        folder,
        folderCollection: mockFolderCollection,
        queryCache: mockQueryCache
      });

      expect(mockQueryCache.invalidateForFolder).toHaveBeenCalled();
    });

    test('handles missing optional fields', async () => {
      const folder = {
        id: 'folder-123',
        vector: [0.1]
      };

      await directUpsertFolder({
        folder,
        folderCollection: mockFolderCollection,
        queryCache: mockQueryCache
      });

      expect(mockFolderCollection.upsert).toHaveBeenCalled();
    });

    test('throws on upsert failure', async () => {
      mockFolderCollection.upsert.mockRejectedValueOnce(new Error('DB error'));

      const folder = {
        id: 'folder-123',
        vector: [0.1]
      };

      await expect(
        directUpsertFolder({
          folder,
          folderCollection: mockFolderCollection,
          queryCache: mockQueryCache
        })
      ).rejects.toThrow('DB error');
    });

    test('works without query cache', async () => {
      const folder = {
        id: 'folder-123',
        vector: [0.1]
      };

      await directUpsertFolder({
        folder,
        folderCollection: mockFolderCollection,
        queryCache: null
      });

      expect(mockFolderCollection.upsert).toHaveBeenCalled();
    });
  });

  describe('directBatchUpsertFolders', () => {
    test('upserts multiple folders', async () => {
      const folders = [
        { id: 'folder-1', name: 'Docs', vector: [0.1] },
        { id: 'folder-2', name: 'Photos', vector: [0.2] }
      ];

      const result = await directBatchUpsertFolders({
        folders,
        folderCollection: mockFolderCollection,
        queryCache: mockQueryCache
      });

      expect(result.count).toBe(2);
      expect(result.skipped).toHaveLength(0);
      expect(mockFolderCollection.upsert).toHaveBeenCalledWith({
        ids: ['folder-1', 'folder-2'],
        embeddings: [[0.1], [0.2]],
        metadatas: expect.any(Array),
        documents: ['Docs', 'Photos']
      });
    });

    test('skips invalid folders and reports them', async () => {
      const folders = [
        { id: 'folder-1', vector: [0.1] },
        { id: null, vector: [0.2] }, // Missing ID
        { id: 'folder-3', vector: null }, // Missing vector
        { id: 'folder-4', vector: 'not array' } // Invalid vector
      ];

      const result = await directBatchUpsertFolders({
        folders,
        folderCollection: mockFolderCollection,
        queryCache: mockQueryCache
      });

      expect(result.count).toBe(1);
      expect(result.skipped).toHaveLength(3);
      expect(result.skipped[0].reason).toBe('missing_id');
      expect(result.skipped[1].reason).toBe('missing_vector');
      expect(result.skipped[2].reason).toBe('invalid_vector_type');
    });

    test('invalidates cache after batch upsert', async () => {
      const folders = [
        { id: 'folder-1', vector: [0.1] },
        { id: 'folder-2', vector: [0.2] }
      ];

      await directBatchUpsertFolders({
        folders,
        folderCollection: mockFolderCollection,
        queryCache: mockQueryCache
      });

      expect(mockQueryCache.invalidateForFolder).toHaveBeenCalled();
    });

    test('returns 0 count for all invalid folders', async () => {
      const folders = [
        { id: null, vector: [0.1] },
        { id: 'folder-2', vector: null }
      ];

      const result = await directBatchUpsertFolders({
        folders,
        folderCollection: mockFolderCollection,
        queryCache: mockQueryCache
      });

      expect(result.count).toBe(0);
      expect(result.skipped).toHaveLength(2);
      expect(mockFolderCollection.upsert).not.toHaveBeenCalled();
    });

    test('throws on upsert failure', async () => {
      mockFolderCollection.upsert.mockRejectedValueOnce(new Error('Batch failed'));

      const folders = [{ id: 'folder-1', vector: [0.1] }];

      await expect(
        directBatchUpsertFolders({
          folders,
          folderCollection: mockFolderCollection,
          queryCache: mockQueryCache
        })
      ).rejects.toThrow('Batch failed');
    });
  });

  describe('queryFoldersByEmbedding', () => {
    test('returns matching folders with scores', async () => {
      mockFolderCollection.query.mockResolvedValueOnce({
        ids: [['folder-1', 'folder-2']],
        distances: [[0.2, 0.4]],
        metadatas: [[{ name: 'Docs' }, { name: 'Photos' }]]
      });

      const result = await queryFoldersByEmbedding({
        embedding: [0.1, 0.2],
        topK: 5,
        folderCollection: mockFolderCollection
      });

      expect(result).toHaveLength(2);
      expect(result[0].folderId).toBe('folder-1');
      expect(result[0].name).toBe('Docs');
      expect(result[0].score).toBeGreaterThan(result[1].score);
    });

    test('returns empty array for invalid embedding', async () => {
      const result = await queryFoldersByEmbedding({
        embedding: null,
        topK: 5,
        folderCollection: mockFolderCollection
      });

      expect(result).toEqual([]);
    });

    test('returns empty array for empty embedding', async () => {
      const result = await queryFoldersByEmbedding({
        embedding: [],
        topK: 5,
        folderCollection: mockFolderCollection
      });

      expect(result).toEqual([]);
    });

    test('returns empty array for no results', async () => {
      mockFolderCollection.query.mockResolvedValueOnce({
        ids: [[]],
        distances: [[]],
        metadatas: [[]]
      });

      const result = await queryFoldersByEmbedding({
        embedding: [0.1],
        topK: 5,
        folderCollection: mockFolderCollection
      });

      expect(result).toEqual([]);
    });

    test('returns empty array on error', async () => {
      mockFolderCollection.query.mockRejectedValueOnce(new Error('Query failed'));

      const result = await queryFoldersByEmbedding({
        embedding: [0.1],
        topK: 5,
        folderCollection: mockFolderCollection
      });

      expect(result).toEqual([]);
    });

    test('skips entries with missing folderId or distance', async () => {
      mockFolderCollection.query.mockResolvedValueOnce({
        ids: [[null, 'folder-2']],
        distances: [[0.2, undefined]],
        metadatas: [[{}, {}]]
      });

      const result = await queryFoldersByEmbedding({
        embedding: [0.1],
        topK: 5,
        folderCollection: mockFolderCollection
      });

      expect(result).toEqual([]);
    });
  });

  describe('executeQueryFolders', () => {
    test('queries folders for a file', async () => {
      const result = await executeQueryFolders({
        fileId: 'file-1',
        topK: 5,
        fileCollection: mockFileCollection,
        folderCollection: mockFolderCollection
      });

      expect(result).toHaveLength(1);
      expect(result[0].folderId).toBe('folder-1');
      expect(mockFileCollection.get).toHaveBeenCalledWith({
        ids: ['file-1'],
        include: ['embeddings', 'metadatas', 'documents']
      });
    });

    test('returns empty array if file collection not initialized', async () => {
      const result = await executeQueryFolders({
        fileId: 'file-1',
        topK: 5,
        fileCollection: null,
        folderCollection: mockFolderCollection
      });

      expect(result).toEqual([]);
    });

    test('returns empty array if folder collection not initialized', async () => {
      const result = await executeQueryFolders({
        fileId: 'file-1',
        topK: 5,
        fileCollection: mockFileCollection,
        folderCollection: null
      });

      expect(result).toEqual([]);
    });

    test('returns empty array if file not found after retries', async () => {
      mockFileCollection.get.mockResolvedValue({
        ids: [],
        embeddings: [],
        metadatas: []
      });

      const result = await executeQueryFolders({
        fileId: 'not-found',
        topK: 5,
        fileCollection: mockFileCollection,
        folderCollection: mockFolderCollection
      });

      expect(result).toEqual([]);
    }, 10000);

    test('returns empty array for invalid file embedding', async () => {
      mockFileCollection.get.mockResolvedValueOnce({
        ids: ['file-1'],
        embeddings: [null],
        metadatas: [{}]
      });

      const result = await executeQueryFolders({
        fileId: 'file-1',
        topK: 5,
        fileCollection: mockFileCollection,
        folderCollection: mockFolderCollection
      });

      expect(result).toEqual([]);
    });

    test('returns empty array when no matching folders', async () => {
      mockFolderCollection.query.mockResolvedValueOnce({
        ids: [[]],
        distances: [[]],
        metadatas: [[]]
      });

      const result = await executeQueryFolders({
        fileId: 'file-1',
        topK: 5,
        fileCollection: mockFileCollection,
        folderCollection: mockFolderCollection
      });

      expect(result).toEqual([]);
    });

    test('returns empty array on error', async () => {
      mockFileCollection.get.mockRejectedValue(new Error('Get failed'));

      const result = await executeQueryFolders({
        fileId: 'file-1',
        topK: 5,
        fileCollection: mockFileCollection,
        folderCollection: mockFolderCollection
      });

      expect(result).toEqual([]);
    }, 10000);
  });

  describe('batchQueryFolders', () => {
    test('queries folders for multiple files', async () => {
      mockFileCollection.get.mockResolvedValueOnce({
        ids: ['file-1', 'file-2'],
        embeddings: [[0.1], [0.2]]
      });

      mockFolderCollection.query.mockResolvedValueOnce({
        ids: [['folder-1'], ['folder-2']],
        distances: [[0.2], [0.3]],
        metadatas: [[{ name: 'Docs' }], [{ name: 'Photos' }]]
      });

      const result = await batchQueryFolders({
        fileIds: ['file-1', 'file-2'],
        topK: 5,
        fileCollection: mockFileCollection,
        folderCollection: mockFolderCollection,
        queryCache: mockQueryCache
      });

      expect(Object.keys(result)).toHaveLength(2);
      expect(result['file-1']).toHaveLength(1);
      expect(result['file-2']).toHaveLength(1);
    });

    test('returns empty object for empty fileIds', async () => {
      const result = await batchQueryFolders({
        fileIds: [],
        topK: 5,
        fileCollection: mockFileCollection,
        folderCollection: mockFolderCollection,
        queryCache: mockQueryCache
      });

      expect(result).toEqual({});
    });

    test('returns empty object for null fileIds', async () => {
      const result = await batchQueryFolders({
        fileIds: null,
        topK: 5,
        fileCollection: mockFileCollection,
        folderCollection: mockFolderCollection,
        queryCache: mockQueryCache
      });

      expect(result).toEqual({});
    });

    test('caches individual results', async () => {
      mockFileCollection.get.mockResolvedValueOnce({
        ids: ['file-1'],
        embeddings: [[0.1]]
      });

      mockFolderCollection.query.mockResolvedValueOnce({
        ids: [['folder-1']],
        distances: [[0.2]],
        metadatas: [[{ name: 'Docs' }]]
      });

      await batchQueryFolders({
        fileIds: ['file-1'],
        topK: 5,
        fileCollection: mockFileCollection,
        folderCollection: mockFolderCollection,
        queryCache: mockQueryCache
      });

      expect(mockQueryCache.set).toHaveBeenCalledWith('query:folders:file-1:5', expect.any(Array));
    });

    test('returns empty object on error', async () => {
      mockFileCollection.get.mockRejectedValue(new Error('Get failed'));

      const result = await batchQueryFolders({
        fileIds: ['file-1'],
        topK: 5,
        fileCollection: mockFileCollection,
        folderCollection: mockFolderCollection,
        queryCache: mockQueryCache
      });

      expect(result).toEqual({});
    }, 10000);

    test('handles files without embeddings', async () => {
      mockFileCollection.get.mockResolvedValueOnce({
        ids: ['file-1', 'file-2'],
        embeddings: [[0.1], null]
      });

      mockFolderCollection.query.mockResolvedValueOnce({
        ids: [['folder-1']],
        distances: [[0.2]],
        metadatas: [[{ name: 'Docs' }]]
      });

      const result = await batchQueryFolders({
        fileIds: ['file-1', 'file-2'],
        topK: 5,
        fileCollection: mockFileCollection,
        folderCollection: mockFolderCollection,
        queryCache: mockQueryCache
      });

      expect(Object.keys(result)).toHaveLength(1);
      expect(result['file-1']).toBeDefined();
    });
  });

  describe('getAllFolders', () => {
    test('returns all folders', async () => {
      mockFolderCollection.get.mockResolvedValueOnce({
        ids: ['folder-1', 'folder-2'],
        embeddings: [[0.1], [0.2]],
        metadatas: [{ name: 'Docs' }, { name: 'Photos' }]
      });

      const result = await getAllFolders({
        folderCollection: mockFolderCollection
      });

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('folder-1');
      expect(result[0].name).toBe('Docs');
      expect(result[0].vector).toEqual([0.1]);
    });

    test('returns empty array when no folders', async () => {
      mockFolderCollection.get.mockResolvedValueOnce({
        ids: [],
        embeddings: [],
        metadatas: []
      });

      const result = await getAllFolders({
        folderCollection: mockFolderCollection
      });

      expect(result).toEqual([]);
    });

    test('returns empty array on error', async () => {
      mockFolderCollection.get.mockRejectedValueOnce(new Error('Get failed'));

      const result = await getAllFolders({
        folderCollection: mockFolderCollection
      });

      expect(result).toEqual([]);
    });

    test('handles missing embeddings and metadatas', async () => {
      mockFolderCollection.get.mockResolvedValueOnce({
        ids: ['folder-1'],
        embeddings: undefined,
        metadatas: undefined
      });

      const result = await getAllFolders({
        folderCollection: mockFolderCollection
      });

      expect(result).toHaveLength(1);
      expect(result[0].vector).toBeNull();
      expect(result[0].name).toBe('folder-1'); // Falls back to ID
    });
  });

  describe('resetFolders', () => {
    const mockEmbeddingFunction = { generate: jest.fn() };

    test('deletes and recreates collection', async () => {
      const result = await resetFolders({
        client: mockClient,
        embeddingFunction: mockEmbeddingFunction
      });

      expect(mockClient.deleteCollection).toHaveBeenCalledWith({
        name: 'folder_embeddings'
      });
      expect(mockClient.createCollection).toHaveBeenCalledWith({
        name: 'folder_embeddings',
        embeddingFunction: mockEmbeddingFunction,
        metadata: expect.objectContaining({
          'hnsw:space': 'cosine'
        })
      });
      expect(result).toBe(mockFolderCollection);
    });

    test('throws on failure', async () => {
      mockClient.deleteCollection.mockRejectedValueOnce(new Error('Reset failed'));

      await expect(
        resetFolders({ client: mockClient, embeddingFunction: mockEmbeddingFunction })
      ).rejects.toThrow('Reset failed');
    });
  });
});
