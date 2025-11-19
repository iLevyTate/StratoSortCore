/**
 * Tests for FolderMatchingService
 * TIER 1 - CRITICAL: Core semantic matching service
 * Testing the embeddings-based folder matching system
 */

const FolderMatchingService = require('../src/main/services/FolderMatchingService');

// Mock ollama utils
jest.mock('../src/main/ollamaUtils', () => ({
  getOllama: jest.fn(),
  getOllamaEmbeddingModel: jest.fn().mockReturnValue('mxbai-embed-large'),
}));

// Mock logger
jest.mock('../src/shared/logger', () => ({
  logger: {
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

describe('FolderMatchingService', () => {
  let service;
  let mockChromaDBService;
  let mockOllama;

  beforeEach(() => {
    // Setup mock ChromaDB Service
    mockChromaDBService = {
      initialize: jest.fn().mockResolvedValue(undefined),
      upsertFolder: jest.fn().mockResolvedValue({ success: true }),
      upsertFile: jest.fn().mockResolvedValue({ success: true }),
      queryFolders: jest.fn().mockResolvedValue([]),
      querySimilarFiles: jest.fn().mockResolvedValue([]),
      fileCollection: {
        get: jest.fn().mockResolvedValue({
          embeddings: [[0.1, 0.2, 0.3]],
        }),
      },
      getStats: jest.fn().mockResolvedValue({
        folders: 10,
        files: 50,
      }),
    };

    // Setup mock Ollama
    mockOllama = {
      embeddings: jest.fn().mockResolvedValue({
        embedding: new Array(1024).fill(0.1),
      }),
    };

    const { getOllama } = require('../src/main/ollamaUtils');
    getOllama.mockReturnValue(mockOllama);

    // Create service instance with small cache for testing
    service = new FolderMatchingService(mockChromaDBService, {
      maxSize: 10,
      ttl: 1000,
    });
    service.initialize();
  });

  afterEach(() => {
    service.shutdown();
    jest.clearAllMocks();
  });

  describe('embedText', () => {
    test('should generate embeddings for text', async () => {
      const text = 'Project invoices and receipts';
      const result = await service.embedText(text);

      expect(result).toBeDefined();
      expect(result.vector).toBeInstanceOf(Array);
      expect(result.vector.length).toBe(1024);
      expect(result.model).toBe('mxbai-embed-large');
      expect(mockOllama.embeddings).toHaveBeenCalledWith({
        model: 'mxbai-embed-large',
        prompt: text,
      });
    });

    test('should use cache for repeated text', async () => {
      const text = 'Financial documents';

      // First call - cache miss
      const result1 = await service.embedText(text);
      expect(mockOllama.embeddings).toHaveBeenCalledTimes(1);

      // Second call - cache hit
      const result2 = await service.embedText(text);
      expect(mockOllama.embeddings).toHaveBeenCalledTimes(1); // Still only called once
      expect(result2).toEqual(result1);
    });

    test('should handle empty text gracefully', async () => {
      const result = await service.embedText('');

      expect(result).toBeDefined();
      expect(result.vector).toBeInstanceOf(Array);
      expect(mockOllama.embeddings).toHaveBeenCalledWith({
        model: 'mxbai-embed-large',
        prompt: '',
      });
    });

    test('should return fallback vector on error', async () => {
      mockOllama.embeddings.mockRejectedValueOnce(
        new Error('Ollama connection failed'),
      );

      const result = await service.embedText('test text');

      expect(result).toBeDefined();
      expect(result.vector).toBeInstanceOf(Array);
      expect(result.vector.length).toBe(1024);
      expect(result.model).toBe('fallback');
      expect(result.vector.every((v) => v === 0)).toBe(true);
    });

    test('should cache results per model', async () => {
      const text = 'test';
      const { getOllamaEmbeddingModel } = require('../src/main/ollamaUtils');

      // First model
      getOllamaEmbeddingModel.mockReturnValueOnce('model1');
      mockOllama.embeddings.mockResolvedValueOnce({
        embedding: new Array(1024).fill(0.1),
      });
      const result1 = await service.embedText(text);

      // Second model - should not use cache
      getOllamaEmbeddingModel.mockReturnValueOnce('model2');
      mockOllama.embeddings.mockResolvedValueOnce({
        embedding: new Array(1024).fill(0.2),
      });
      const result2 = await service.embedText(text);

      expect(mockOllama.embeddings).toHaveBeenCalledTimes(2);
      expect(result1.vector[0]).toBe(0.1);
      expect(result2.vector[0]).toBe(0.2);
    });
  });

  describe('generateFolderId', () => {
    test('should generate consistent IDs for same folder', () => {
      const folder = {
        name: 'Invoices',
        path: '/docs/Invoices',
        description: 'Financial invoices',
      };

      const id1 = service.generateFolderId(folder);
      const id2 = service.generateFolderId(folder);

      expect(id1).toBe(id2);
      expect(id1).toMatch(/^folder:[a-f0-9]{32}$/);
    });

    test('should generate different IDs for different folders', () => {
      const folder1 = {
        name: 'Invoices',
        path: '/docs/Invoices',
        description: 'Financial invoices',
      };
      const folder2 = {
        name: 'Projects',
        path: '/docs/Projects',
        description: 'Project files',
      };

      const id1 = service.generateFolderId(folder1);
      const id2 = service.generateFolderId(folder2);

      expect(id1).not.toBe(id2);
    });

    test('should handle missing optional fields', () => {
      const folder = { name: 'TestFolder' };
      const id = service.generateFolderId(folder);

      expect(id).toBeDefined();
      expect(id).toMatch(/^folder:[a-f0-9]{32}$/);
    });
  });

  describe('upsertFolderEmbedding', () => {
    test('should create and store folder embedding', async () => {
      const folder = {
        name: 'Invoices',
        path: '/docs/Invoices',
        description: 'Financial invoices and receipts',
      };

      const result = await service.upsertFolderEmbedding(folder);

      expect(result).toBeDefined();
      expect(result.id).toMatch(/^folder:/);
      expect(result.name).toBe('Invoices');
      expect(result.description).toBe('Financial invoices and receipts');
      expect(result.path).toBe('/docs/Invoices');
      expect(result.vector).toBeInstanceOf(Array);
      expect(result.model).toBe('mxbai-embed-large');
      expect(result.updatedAt).toBeDefined();

      expect(mockChromaDBService.upsertFolder).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Invoices',
          path: '/docs/Invoices',
          vector: expect.any(Array),
        }),
      );
    });

    test('should use provided folder ID if available', async () => {
      const folder = {
        id: 'custom-folder-id',
        name: 'Custom',
        description: 'Custom folder',
      };

      const result = await service.upsertFolderEmbedding(folder);

      expect(result.id).toBe('custom-folder-id');
      expect(mockChromaDBService.upsertFolder).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'custom-folder-id',
        }),
      );
    });

    test('should combine name and description for embedding', async () => {
      const folder = {
        name: 'Projects',
        description: 'Active development projects',
      };

      await service.upsertFolderEmbedding(folder);

      expect(mockOllama.embeddings).toHaveBeenCalledWith({
        model: 'mxbai-embed-large',
        prompt: 'Projects - Active development projects',
      });
    });

    test('should handle missing description', async () => {
      const folder = {
        name: 'SimpleFolder',
      };

      const result = await service.upsertFolderEmbedding(folder);

      expect(result.description).toBe('');
      expect(mockOllama.embeddings).toHaveBeenCalledWith({
        model: 'mxbai-embed-large',
        prompt: 'SimpleFolder',
      });
    });

    test('should propagate errors from ChromaDB', async () => {
      mockChromaDBService.upsertFolder.mockRejectedValueOnce(
        new Error('Database error'),
      );

      const folder = { name: 'Test' };

      await expect(service.upsertFolderEmbedding(folder)).rejects.toThrow(
        'Database error',
      );
    });
  });

  describe('upsertFileEmbedding', () => {
    test('should create and store file embedding', async () => {
      const fileId = 'file-123';
      const contentSummary = 'Invoice for project Alpha, Q1 2024';
      const fileMeta = {
        path: '/downloads/invoice.pdf',
        name: 'invoice.pdf',
        extension: 'pdf',
      };

      await service.upsertFileEmbedding(fileId, contentSummary, fileMeta);

      expect(mockOllama.embeddings).toHaveBeenCalledWith({
        model: 'mxbai-embed-large',
        prompt: contentSummary,
      });

      expect(mockChromaDBService.upsertFile).toHaveBeenCalledWith({
        id: fileId,
        vector: expect.any(Array),
        model: 'mxbai-embed-large',
        meta: fileMeta,
        updatedAt: expect.any(String),
      });
    });

    test('should handle empty content summary', async () => {
      await service.upsertFileEmbedding('file-123', '', {});

      expect(mockOllama.embeddings).toHaveBeenCalledWith({
        model: 'mxbai-embed-large',
        prompt: '',
      });
    });

    test('should handle null content summary', async () => {
      await service.upsertFileEmbedding('file-123', null, {});

      expect(mockOllama.embeddings).toHaveBeenCalledWith({
        model: 'mxbai-embed-large',
        prompt: '',
      });
    });

    test('should propagate errors from ChromaDB', async () => {
      mockChromaDBService.upsertFile.mockRejectedValueOnce(
        new Error('Database error'),
      );

      await expect(
        service.upsertFileEmbedding('file-123', 'content', {}),
      ).rejects.toThrow('Database error');
    });
  });

  describe('matchFileToFolders', () => {
    test('should return top matching folders', async () => {
      const mockResults = [
        {
          folderId: 'folder-1',
          name: 'Invoices',
          score: 0.85,
          path: '/docs/Invoices',
        },
        {
          folderId: 'folder-2',
          name: 'Financial',
          score: 0.75,
          path: '/docs/Financial',
        },
      ];

      mockChromaDBService.queryFolders.mockResolvedValue(mockResults);

      const results = await service.matchFileToFolders('file-123', 5);

      expect(results).toEqual(mockResults);
      expect(mockChromaDBService.queryFolders).toHaveBeenCalledWith(
        'file-123',
        5,
      );
    });

    test('should use default topK value', async () => {
      await service.matchFileToFolders('file-123');

      expect(mockChromaDBService.queryFolders).toHaveBeenCalledWith(
        'file-123',
        5,
      );
    });

    test('should return empty array on error', async () => {
      mockChromaDBService.queryFolders.mockRejectedValue(
        new Error('Query failed'),
      );

      const results = await service.matchFileToFolders('file-123');

      expect(results).toEqual([]);
    });
  });

  describe('findSimilarFiles', () => {
    test('should find similar files', async () => {
      const mockSimilarFiles = [
        { fileId: 'file-2', score: 0.9, name: 'similar-doc.pdf' },
        { fileId: 'file-3', score: 0.8, name: 'another-doc.pdf' },
      ];

      mockChromaDBService.querySimilarFiles.mockResolvedValue(
        mockSimilarFiles,
      );

      const results = await service.findSimilarFiles('file-1', 10);

      expect(results).toEqual(mockSimilarFiles);
      expect(mockChromaDBService.fileCollection.get).toHaveBeenCalledWith({
        ids: ['file-1'],
      });
      expect(mockChromaDBService.querySimilarFiles).toHaveBeenCalledWith(
        [0.1, 0.2, 0.3],
        10,
      );
    });

    test('should use default topK value', async () => {
      mockChromaDBService.querySimilarFiles.mockResolvedValue([]);

      await service.findSimilarFiles('file-1');

      expect(mockChromaDBService.querySimilarFiles).toHaveBeenCalledWith(
        expect.any(Array),
        10,
      );
    });

    test('should handle file not found', async () => {
      mockChromaDBService.fileCollection.get.mockResolvedValue({
        embeddings: [],
      });

      const results = await service.findSimilarFiles('nonexistent-file');

      expect(results).toEqual([]);
      expect(mockChromaDBService.querySimilarFiles).not.toHaveBeenCalled();
    });

    test('should return empty array on error', async () => {
      mockChromaDBService.fileCollection.get.mockRejectedValue(
        new Error('Database error'),
      );

      const results = await service.findSimilarFiles('file-1');

      expect(results).toEqual([]);
    });
  });

  describe('getStats', () => {
    test('should return database statistics', async () => {
      const mockStats = {
        folders: 15,
        files: 75,
        totalSize: 1024000,
      };

      mockChromaDBService.getStats.mockResolvedValue(mockStats);

      const stats = await service.getStats();

      expect(stats).toEqual(mockStats);
      expect(mockChromaDBService.getStats).toHaveBeenCalled();
    });
  });

  describe('getCacheStats', () => {
    test('should return cache statistics', () => {
      const stats = service.getCacheStats();

      expect(stats).toBeDefined();
      expect(stats).toHaveProperty('hits');
      expect(stats).toHaveProperty('misses');
      expect(stats).toHaveProperty('size');
    });

    test('should track cache hits and misses', async () => {
      const text = 'test text';

      // First call - cache miss
      await service.embedText(text);
      const stats1 = service.getCacheStats();
      expect(stats1.misses).toBeGreaterThan(0);

      // Second call - cache hit
      await service.embedText(text);
      const stats2 = service.getCacheStats();
      expect(stats2.hits).toBeGreaterThan(stats1.hits);
    });
  });

  describe('initialize and shutdown', () => {
    test('should initialize successfully', () => {
      const newService = new FolderMatchingService(mockChromaDBService);
      expect(newService.embeddingCache.initialized).toBe(false);

      newService.initialize();
      expect(newService.embeddingCache.initialized).toBe(true);

      newService.shutdown();
    });

    test('should not re-initialize if already initialized', () => {
      const newService = new FolderMatchingService(mockChromaDBService);
      newService.initialize();
      const cache1 = newService.embeddingCache;

      newService.initialize();
      const cache2 = newService.embeddingCache;

      expect(cache1).toBe(cache2);
      newService.shutdown();
    });

    test('should shutdown cleanly', () => {
      const newService = new FolderMatchingService(mockChromaDBService);
      newService.initialize();

      expect(() => newService.shutdown()).not.toThrow();
      expect(newService.embeddingCache.cleanupInterval).toBeNull();
    });
  });

  describe('Edge Cases', () => {
    test('should handle concurrent embedding requests', async () => {
      const texts = ['text1', 'text2', 'text3', 'text4', 'text5'];

      const results = await Promise.all(texts.map((t) => service.embedText(t)));

      expect(results).toHaveLength(5);
      results.forEach((result) => {
        expect(result.vector).toBeInstanceOf(Array);
        expect(result.model).toBeDefined();
      });
    });

    test('should handle large batch of folder upserts', async () => {
      const folders = Array.from({ length: 20 }, (_, i) => ({
        name: `Folder ${i}`,
        description: `Description ${i}`,
        path: `/docs/Folder${i}`,
      }));

      const results = await Promise.all(
        folders.map((f) => service.upsertFolderEmbedding(f)),
      );

      expect(results).toHaveLength(20);
      expect(mockChromaDBService.upsertFolder).toHaveBeenCalledTimes(20);
    });

    test('should handle special characters in text', async () => {
      const specialText = 'Documents & Files (2024) - €1,000 [IMPORTANT]';
      const result = await service.embedText(specialText);

      expect(result).toBeDefined();
      expect(result.vector).toBeInstanceOf(Array);
    });

    test('should handle very long text', async () => {
      const longText = 'word '.repeat(10000);
      const result = await service.embedText(longText);

      expect(result).toBeDefined();
      expect(mockOllama.embeddings).toHaveBeenCalledWith({
        model: 'mxbai-embed-large',
        prompt: longText,
      });
    });

    test('should handle unicode characters', async () => {
      const unicodeText = '文档 Documents Документы مستندات';
      const result = await service.embedText(unicodeText);

      expect(result).toBeDefined();
      expect(result.vector).toBeInstanceOf(Array);
    });
  });
});
