/**
 * Tests for chunkOperations.js
 * Tests chunk-level embedding operations for semantic search
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
  sanitizeMetadata: jest.fn((meta) => ({ ...meta, sanitized: true }))
}));

const {
  batchUpsertFileChunks,
  querySimilarFileChunks,
  resetFileChunks
} = require('../src/main/services/chromadb/chunkOperations');

const { logger } = require('../src/shared/logger');

describe('chunkOperations', () => {
  let mockCollection;
  let mockClient;
  let mockEmbeddingFunction;

  beforeEach(() => {
    jest.clearAllMocks();

    mockCollection = {
      upsert: jest.fn().mockResolvedValue(undefined),
      query: jest.fn().mockResolvedValue({
        ids: [['chunk-1', 'chunk-2']],
        distances: [[0.1, 0.3]],
        metadatas: [[{ fileId: 'file1' }, { fileId: 'file2' }]],
        documents: [['text 1', 'text 2']]
      })
    };

    mockClient = {
      deleteCollection: jest.fn().mockResolvedValue(undefined),
      createCollection: jest.fn().mockResolvedValue(mockCollection)
    };

    mockEmbeddingFunction = jest.fn();
  });

  describe('batchUpsertFileChunks', () => {
    it('should upsert valid chunks', async () => {
      const chunks = [
        {
          id: 'chunk-1',
          vector: [0.1, 0.2, 0.3],
          meta: { fileId: 'file-1', path: '/test/file.txt' },
          document: 'Test content'
        },
        {
          id: 'chunk-2',
          vector: [0.4, 0.5, 0.6],
          meta: { fileId: 'file-2', path: '/test/file2.txt' },
          document: 'More content'
        }
      ];

      const result = await batchUpsertFileChunks({
        chunks,
        chunkCollection: mockCollection
      });

      expect(result).toBe(2);
      expect(mockCollection.upsert).toHaveBeenCalledWith({
        ids: ['chunk-1', 'chunk-2'],
        embeddings: [
          [0.1, 0.2, 0.3],
          [0.4, 0.5, 0.6]
        ],
        metadatas: expect.arrayContaining([
          expect.objectContaining({ fileId: 'file-1', sanitized: true }),
          expect.objectContaining({ fileId: 'file-2', sanitized: true })
        ]),
        documents: ['Test content', 'More content']
      });
    });

    it('should return 0 for empty chunks array', async () => {
      const result = await batchUpsertFileChunks({
        chunks: [],
        chunkCollection: mockCollection
      });

      expect(result).toBe(0);
      expect(mockCollection.upsert).not.toHaveBeenCalled();
    });

    it('should return 0 for null chunks', async () => {
      const result = await batchUpsertFileChunks({
        chunks: null,
        chunkCollection: mockCollection
      });

      expect(result).toBe(0);
    });

    it('should skip chunks with missing id', async () => {
      const chunks = [
        {
          id: null,
          vector: [0.1, 0.2],
          meta: { fileId: 'file-1' }
        },
        {
          id: 'chunk-1',
          vector: [0.3, 0.4],
          meta: { fileId: 'file-2' }
        }
      ];

      const result = await batchUpsertFileChunks({
        chunks,
        chunkCollection: mockCollection
      });

      expect(result).toBe(1);
    });

    it('should skip chunks with empty vector', async () => {
      const chunks = [
        {
          id: 'chunk-1',
          vector: [],
          meta: { fileId: 'file-1' }
        }
      ];

      const result = await batchUpsertFileChunks({
        chunks,
        chunkCollection: mockCollection
      });

      expect(result).toBe(0);
    });

    it('should skip chunks with invalid vector values (NaN)', async () => {
      const chunks = [
        {
          id: 'chunk-1',
          vector: [0.1, NaN, 0.3],
          meta: { fileId: 'file-1' }
        }
      ];

      const result = await batchUpsertFileChunks({
        chunks,
        chunkCollection: mockCollection
      });

      expect(result).toBe(0);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Invalid vector value'),
        expect.any(Object)
      );
    });

    it('should skip chunks with invalid vector values (Infinity)', async () => {
      const chunks = [
        {
          id: 'chunk-1',
          vector: [0.1, Infinity, 0.3],
          meta: { fileId: 'file-1' }
        }
      ];

      const result = await batchUpsertFileChunks({
        chunks,
        chunkCollection: mockCollection
      });

      expect(result).toBe(0);
    });

    it('should skip duplicate ids', async () => {
      const chunks = [
        {
          id: 'chunk-1',
          vector: [0.1, 0.2],
          meta: { fileId: 'file-1' }
        },
        {
          id: 'chunk-1',
          vector: [0.3, 0.4],
          meta: { fileId: 'file-1' }
        }
      ];

      const result = await batchUpsertFileChunks({
        chunks,
        chunkCollection: mockCollection
      });

      expect(result).toBe(1);
    });

    it('should skip chunks with missing fileId in metadata', async () => {
      const chunks = [
        {
          id: 'chunk-1',
          vector: [0.1, 0.2],
          meta: { path: '/test/file.txt' } // Missing fileId
        }
      ];

      const result = await batchUpsertFileChunks({
        chunks,
        chunkCollection: mockCollection
      });

      expect(result).toBe(0);
    });

    it('should skip chunks with empty fileId', async () => {
      const chunks = [
        {
          id: 'chunk-1',
          vector: [0.1, 0.2],
          meta: { fileId: '   ' } // Empty fileId
        }
      ];

      const result = await batchUpsertFileChunks({
        chunks,
        chunkCollection: mockCollection
      });

      expect(result).toBe(0);
    });

    it('should use default document if not provided', async () => {
      const chunks = [
        {
          id: 'chunk-1',
          vector: [0.1, 0.2],
          meta: { fileId: 'file-1', path: '/test/file.txt' }
          // No document provided
        }
      ];

      await batchUpsertFileChunks({
        chunks,
        chunkCollection: mockCollection
      });

      // Should use path as fallback document
      const upsertCall = mockCollection.upsert.mock.calls[0][0];
      expect(upsertCall.documents[0]).toBe('/test/file.txt');
    });

    it('should add updatedAt timestamp to metadata', async () => {
      const chunks = [
        {
          id: 'chunk-1',
          vector: [0.1, 0.2],
          meta: { fileId: 'file-1' }
        }
      ];

      await batchUpsertFileChunks({
        chunks,
        chunkCollection: mockCollection
      });

      const upsertCall = mockCollection.upsert.mock.calls[0][0];
      expect(upsertCall.metadatas[0].updatedAt).toBeDefined();
    });
  });

  describe('querySimilarFileChunks', () => {
    it('should query and return ranked results', async () => {
      const results = await querySimilarFileChunks({
        queryEmbedding: [0.1, 0.2, 0.3],
        topK: 10,
        chunkCollection: mockCollection
      });

      expect(mockCollection.query).toHaveBeenCalledWith({
        queryEmbeddings: [[0.1, 0.2, 0.3]],
        nResults: 10
      });

      expect(results).toHaveLength(2);
      expect(results[0]).toHaveProperty('id');
      expect(results[0]).toHaveProperty('score');
      expect(results[0]).toHaveProperty('distance');
      expect(results[0]).toHaveProperty('metadata');
      expect(results[0]).toHaveProperty('document');
    });

    it('should use default topK of 20', async () => {
      await querySimilarFileChunks({
        queryEmbedding: [0.1, 0.2],
        chunkCollection: mockCollection
      });

      expect(mockCollection.query).toHaveBeenCalledWith({
        queryEmbeddings: [[0.1, 0.2]],
        nResults: 20
      });
    });

    it('should sort results by score descending', async () => {
      mockCollection.query.mockResolvedValue({
        ids: [['chunk-1', 'chunk-2', 'chunk-3']],
        distances: [[0.5, 0.1, 0.3]], // 0.1 is closest
        metadatas: [[{}, {}, {}]],
        documents: [['a', 'b', 'c']]
      });

      const results = await querySimilarFileChunks({
        queryEmbedding: [0.1],
        chunkCollection: mockCollection
      });

      // Closest distance (0.1) should have highest score
      expect(results[0].distance).toBe(0.1);
      expect(results[0].score).toBeGreaterThan(results[1].score);
      expect(results[1].score).toBeGreaterThan(results[2].score);
    });

    it('should calculate score from distance correctly', async () => {
      mockCollection.query.mockResolvedValue({
        ids: [['chunk-1']],
        distances: [[0.2]],
        metadatas: [[{}]],
        documents: [['test']]
      });

      const results = await querySimilarFileChunks({
        queryEmbedding: [0.1],
        chunkCollection: mockCollection
      });

      // Score = 1 - distance/2 = 1 - 0.2/2 = 0.9
      expect(results[0].score).toBe(0.9);
    });

    it('should return empty array for no results', async () => {
      mockCollection.query.mockResolvedValue({
        ids: [[]],
        distances: [[]],
        metadatas: [[]],
        documents: [[]]
      });

      const results = await querySimilarFileChunks({
        queryEmbedding: [0.1],
        chunkCollection: mockCollection
      });

      expect(results).toEqual([]);
    });

    it('should handle query errors gracefully', async () => {
      mockCollection.query.mockRejectedValue(new Error('Query failed'));

      const results = await querySimilarFileChunks({
        queryEmbedding: [0.1],
        chunkCollection: mockCollection
      });

      expect(results).toEqual([]);
      expect(logger.error).toHaveBeenCalledWith(
        '[ChunkOps] Failed to query similar file chunks:',
        expect.any(Error)
      );
    });

    it('should handle missing distances array', async () => {
      mockCollection.query.mockResolvedValue({
        ids: [['chunk-1']],
        distances: null,
        metadatas: [[{ fileId: 'f1' }]],
        documents: [['test']]
      });

      const results = await querySimilarFileChunks({
        queryEmbedding: [0.1],
        chunkCollection: mockCollection
      });

      expect(results).toHaveLength(1);
      expect(results[0].distance).toBe(1); // Default distance
    });
  });

  describe('resetFileChunks', () => {
    it('should delete and recreate collection', async () => {
      const result = await resetFileChunks({
        client: mockClient,
        embeddingFunction: mockEmbeddingFunction
      });

      expect(mockClient.deleteCollection).toHaveBeenCalledWith({
        name: 'file_chunk_embeddings'
      });

      expect(mockClient.createCollection).toHaveBeenCalledWith({
        name: 'file_chunk_embeddings',
        embeddingFunction: mockEmbeddingFunction,
        metadata: {
          description: 'Chunk embeddings for extracted text (semantic search deep recall)',
          'hnsw:space': 'cosine'
        }
      });

      expect(result).toBe(mockCollection);
    });

    it('should log success message', async () => {
      await resetFileChunks({
        client: mockClient,
        embeddingFunction: mockEmbeddingFunction
      });

      expect(logger.info).toHaveBeenCalledWith('[ChunkOps] Reset file chunk embeddings collection');
    });

    it('should throw on delete error', async () => {
      mockClient.deleteCollection.mockRejectedValue(new Error('Delete failed'));

      await expect(
        resetFileChunks({
          client: mockClient,
          embeddingFunction: mockEmbeddingFunction
        })
      ).rejects.toThrow('Delete failed');

      expect(logger.error).toHaveBeenCalledWith(
        '[ChunkOps] Failed to reset file chunks:',
        expect.any(Error)
      );
    });

    it('should throw on create error', async () => {
      mockClient.createCollection.mockRejectedValue(new Error('Create failed'));

      await expect(
        resetFileChunks({
          client: mockClient,
          embeddingFunction: mockEmbeddingFunction
        })
      ).rejects.toThrow('Create failed');
    });
  });

  describe('validateEmbeddingVector (via batchUpsertFileChunks)', () => {
    it('should reject non-array vectors', async () => {
      const chunks = [
        {
          id: 'chunk-1',
          vector: 'not an array',
          meta: { fileId: 'file-1' }
        }
      ];

      const result = await batchUpsertFileChunks({
        chunks,
        chunkCollection: mockCollection
      });

      expect(result).toBe(0);
    });

    it('should reject -Infinity in vector', async () => {
      const chunks = [
        {
          id: 'chunk-1',
          vector: [0.1, -Infinity],
          meta: { fileId: 'file-1' }
        }
      ];

      const result = await batchUpsertFileChunks({
        chunks,
        chunkCollection: mockCollection
      });

      expect(result).toBe(0);
    });
  });

  describe('validateChunkMetadata (via batchUpsertFileChunks)', () => {
    it('should reject null metadata', async () => {
      const chunks = [
        {
          id: 'chunk-1',
          vector: [0.1, 0.2],
          meta: null
        }
      ];

      const result = await batchUpsertFileChunks({
        chunks,
        chunkCollection: mockCollection
      });

      expect(result).toBe(0);
    });

    it('should reject non-string path', async () => {
      const chunks = [
        {
          id: 'chunk-1',
          vector: [0.1, 0.2],
          meta: { fileId: 'file-1', path: 123 }
        }
      ];

      const result = await batchUpsertFileChunks({
        chunks,
        chunkCollection: mockCollection
      });

      expect(result).toBe(0);
    });

    it('should reject non-integer chunkIndex', async () => {
      const chunks = [
        {
          id: 'chunk-1',
          vector: [0.1, 0.2],
          meta: { fileId: 'file-1', chunkIndex: 1.5 }
        }
      ];

      const result = await batchUpsertFileChunks({
        chunks,
        chunkCollection: mockCollection
      });

      expect(result).toBe(0);
    });

    it('should accept valid integer chunkIndex', async () => {
      const chunks = [
        {
          id: 'chunk-1',
          vector: [0.1, 0.2],
          meta: { fileId: 'file-1', chunkIndex: 5 }
        }
      ];

      const result = await batchUpsertFileChunks({
        chunks,
        chunkCollection: mockCollection
      });

      expect(result).toBe(1);
    });
  });
});
