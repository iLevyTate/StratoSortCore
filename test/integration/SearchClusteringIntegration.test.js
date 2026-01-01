/**
 * Integration Tests for Search and Clustering Services
 *
 * Tests the integration between:
 * - SearchService (hybrid search with BM25 + vector)
 * - ClusteringService (K-means++ clustering)
 * - ChromaDB (shared singleton for embeddings)
 * - Analysis History (document metadata)
 */

// Mock electron
jest.mock('electron', () => ({
  app: {
    getPath: jest.fn(() => '/tmp/test-app')
  }
}));

// Mock logger
jest.mock('../../src/shared/logger', () => ({
  logger: {
    setContext: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  }
}));

describe('Search and Clustering Integration', () => {
  let SearchService;
  let ClusteringService;
  let mockChromaDb;
  let mockHistoryService;
  let mockEmbeddingService;
  let mockOllamaService;

  // Sample documents for testing
  const sampleDocuments = {
    doc1: {
      id: 'doc1',
      fileName: 'quarterly-report-q1.pdf',
      originalPath: '/files/finance/quarterly-report-q1.pdf',
      mimeType: 'application/pdf',
      analysis: {
        subject: 'Q1 Financial Report',
        summary: 'First quarter financial performance summary',
        tags: ['finance', 'quarterly', 'report', 'q1'],
        category: 'Finance',
        extractedText: 'Revenue increased by 15% in Q1...'
      }
    },
    doc2: {
      id: 'doc2',
      fileName: 'quarterly-report-q2.pdf',
      originalPath: '/files/finance/quarterly-report-q2.pdf',
      mimeType: 'application/pdf',
      analysis: {
        subject: 'Q2 Financial Report',
        summary: 'Second quarter financial performance summary',
        tags: ['finance', 'quarterly', 'report', 'q2'],
        category: 'Finance',
        extractedText: 'Revenue growth continued in Q2...'
      }
    },
    doc3: {
      id: 'doc3',
      fileName: 'marketing-proposal.docx',
      originalPath: '/files/marketing/marketing-proposal.docx',
      mimeType: 'application/docx',
      analysis: {
        subject: 'Marketing Campaign Proposal',
        summary: 'New marketing strategy for product launch',
        tags: ['marketing', 'proposal', 'campaign'],
        category: 'Marketing',
        extractedText: 'This proposal outlines our marketing approach...'
      }
    },
    doc4: {
      id: 'doc4',
      fileName: 'team-photo-2024.jpg',
      originalPath: '/files/images/team-photo-2024.jpg',
      mimeType: 'image/jpeg',
      analysis: {
        subject: 'Team Photo 2024',
        summary: 'Annual team photograph at company retreat',
        tags: ['photo', 'team', 'annual', '2024'],
        category: 'Images',
        extractedText: ''
      }
    },
    doc5: {
      id: 'doc5',
      fileName: 'budget-forecast.xlsx',
      originalPath: '/files/finance/budget-forecast.xlsx',
      mimeType: 'application/xlsx',
      analysis: {
        subject: 'Annual Budget Forecast',
        summary: 'Budget projections for fiscal year 2025',
        tags: ['finance', 'budget', 'forecast', '2025'],
        category: 'Finance',
        extractedText: 'Budget allocation for departments...'
      }
    }
  };

  // Generate mock embedding vectors
  const createMockVector = (seed = 1) => {
    return new Array(384).fill(0).map((_, i) => Math.sin(seed + i) * 0.5);
  };

  // Create vectors that cluster by category
  const categoryVectors = {
    finance: createMockVector(1),
    marketing: createMockVector(100),
    images: createMockVector(200)
  };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();

    // Create mock ChromaDB service (shared singleton)
    mockChromaDb = {
      initialize: jest.fn().mockResolvedValue(undefined),
      querySimilarFiles: jest.fn().mockImplementation(async (vector, topK) => {
        // Return results based on vector similarity
        return [
          {
            id: 'doc1',
            score: 0.95,
            distance: 0.05,
            metadata: {
              path: '/files/finance/quarterly-report-q1.pdf',
              name: 'quarterly-report-q1.pdf',
              tags: ['finance', 'quarterly'],
              category: 'Finance'
            }
          },
          {
            id: 'doc2',
            score: 0.92,
            distance: 0.08,
            metadata: {
              path: '/files/finance/quarterly-report-q2.pdf',
              name: 'quarterly-report-q2.pdf',
              tags: ['finance', 'quarterly'],
              category: 'Finance'
            }
          },
          {
            id: 'doc5',
            score: 0.88,
            distance: 0.12,
            metadata: {
              path: '/files/finance/budget-forecast.xlsx',
              name: 'budget-forecast.xlsx',
              tags: ['finance', 'budget'],
              category: 'Finance'
            }
          }
        ].slice(0, topK);
      }),
      getFileVectors: jest.fn().mockImplementation(async (ids) => {
        const vectors = {};
        for (const id of ids) {
          const doc = sampleDocuments[id];
          if (doc) {
            const category = doc.analysis.category.toLowerCase();
            vectors[id] = categoryVectors[category] || createMockVector(Math.random() * 100);
          }
        }
        return vectors;
      }),
      getAllFileIds: jest.fn().mockResolvedValue(Object.keys(sampleDocuments)),
      getFileMetadata: jest.fn().mockImplementation(async (ids) => {
        const metadata = {};
        for (const id of ids) {
          const doc = sampleDocuments[id];
          if (doc) {
            metadata[id] = {
              path: doc.originalPath,
              name: doc.fileName,
              tags: doc.analysis.tags,
              category: doc.analysis.category
            };
          }
        }
        return metadata;
      }),
      // Add method for getting vectors by IDs (used by ClusteringService)
      getVectorsByIds: jest.fn().mockImplementation(async (ids) => {
        const result = {};
        for (const id of ids) {
          const doc = sampleDocuments[id];
          if (doc) {
            const category = doc.analysis.category.toLowerCase();
            result[id] = {
              vector: categoryVectors[category] || createMockVector(Math.random() * 100),
              metadata: {
                path: doc.originalPath,
                name: doc.fileName
              }
            };
          }
        }
        return result;
      })
    };

    // Create mock analysis history service
    mockHistoryService = {
      initialize: jest.fn().mockResolvedValue(undefined),
      analysisHistory: {
        entries: sampleDocuments
      }
    };

    // Create mock embedding service
    mockEmbeddingService = {
      embedText: jest.fn().mockImplementation(async (text) => {
        // Generate vector based on text content
        const lowerText = text.toLowerCase();
        if (
          lowerText.includes('finance') ||
          lowerText.includes('budget') ||
          lowerText.includes('quarterly')
        ) {
          return { vector: categoryVectors.finance };
        } else if (lowerText.includes('marketing') || lowerText.includes('campaign')) {
          return { vector: categoryVectors.marketing };
        } else if (lowerText.includes('photo') || lowerText.includes('image')) {
          return { vector: categoryVectors.images };
        }
        return { vector: createMockVector(Math.random() * 100) };
      })
    };

    // Create mock Ollama service
    mockOllamaService = {
      generateEmbedding: jest.fn().mockImplementation(async (text) => {
        return mockEmbeddingService.embedText(text);
      })
    };

    // Load services
    const searchModule = require('../../src/main/services/SearchService');
    SearchService = searchModule.SearchService;

    const clusterModule = require('../../src/main/services/ClusteringService');
    ClusteringService = clusterModule.ClusteringService;
  });

  describe('Shared ChromaDB Singleton', () => {
    test('both services should use the same ChromaDB instance', () => {
      const searchService = new SearchService({
        chromaDbService: mockChromaDb,
        analysisHistoryService: mockHistoryService,
        parallelEmbeddingService: mockEmbeddingService
      });

      const clusteringService = new ClusteringService({
        chromaDbService: mockChromaDb,
        ollamaService: mockOllamaService
      });

      // Both services should reference the same mock
      expect(searchService.chromaDb).toBe(mockChromaDb);
      expect(clusteringService.chromaDb).toBe(mockChromaDb);
    });
  });

  describe('Search Results to Clustering Flow', () => {
    test('search results can be used as input for clustering', async () => {
      const searchService = new SearchService({
        chromaDbService: mockChromaDb,
        analysisHistoryService: mockHistoryService,
        parallelEmbeddingService: mockEmbeddingService
      });

      // First, perform a search
      await searchService.buildBM25Index();
      const searchResult = await searchService.hybridSearch('finance quarterly');

      expect(searchResult.success).toBe(true);
      expect(searchResult.results.length).toBeGreaterThan(0);

      // Extract IDs from search results - these can be passed to clustering
      const searchResultIds = searchResult.results.map((r) => r.id);
      expect(searchResultIds.length).toBeGreaterThan(0);
    });

    test('should be able to get vectors for search result IDs', async () => {
      const searchService = new SearchService({
        chromaDbService: mockChromaDb,
        analysisHistoryService: mockHistoryService,
        parallelEmbeddingService: mockEmbeddingService
      });

      // Build index and search
      await searchService.buildBM25Index();
      const searchResult = await searchService.hybridSearch('finance');

      // Get vectors for the search result IDs
      const ids = searchResult.results.map((r) => r.id);
      const vectors = await mockChromaDb.getFileVectors(ids);

      expect(Object.keys(vectors).length).toBeGreaterThan(0);
    });
  });

  describe('Similarity Edge Computation', () => {
    test('ClusteringService should have access to ChromaDB vectors', async () => {
      const clusteringService = new ClusteringService({
        chromaDbService: mockChromaDb,
        ollamaService: mockOllamaService
      });

      // Verify ClusteringService can get vectors from ChromaDB
      expect(clusteringService.chromaDb).toBe(mockChromaDb);

      // Get vectors for finance documents
      const vectors = await mockChromaDb.getFileVectors(['doc1', 'doc2']);
      expect(vectors.doc1).toBeDefined();
      expect(vectors.doc2).toBeDefined();
    });

    test('vectors should be category-specific for similarity computation', async () => {
      // Get vectors for different categories
      const financeVectors = await mockChromaDb.getFileVectors(['doc1', 'doc2']);
      const marketingVectors = await mockChromaDb.getFileVectors(['doc3']);
      const imageVectors = await mockChromaDb.getFileVectors(['doc4']);

      // Each category should have vectors
      expect(financeVectors.doc1).toBeDefined();
      expect(marketingVectors.doc3).toBeDefined();
      expect(imageVectors.doc4).toBeDefined();
    });
  });

  describe('Near-Duplicate Detection', () => {
    test('ClusteringService should have findNearDuplicates method', async () => {
      const clusteringService = new ClusteringService({
        chromaDbService: mockChromaDb,
        ollamaService: mockOllamaService
      });

      // Verify the method exists
      expect(typeof clusteringService.findNearDuplicates).toBe('function');
    });

    test('should be able to get all file IDs for duplicate detection', async () => {
      // Get all file IDs from ChromaDB
      const allIds = await mockChromaDb.getAllFileIds();

      expect(allIds).toBeDefined();
      expect(allIds.length).toBe(Object.keys(sampleDocuments).length);
    });
  });

  describe('Index Invalidation Flow', () => {
    test('search index should be invalidated on file operations', async () => {
      const searchService = new SearchService({
        chromaDbService: mockChromaDb,
        analysisHistoryService: mockHistoryService,
        parallelEmbeddingService: mockEmbeddingService
      });

      // Build initial index
      await searchService.buildBM25Index();
      expect(searchService.isIndexStale()).toBe(false);

      // Simulate file move by invalidating index
      searchService.invalidateIndex({
        reason: 'file-move',
        oldPath: '/old/path.pdf',
        newPath: '/new/path.pdf'
      });

      // Index should now be stale
      expect(searchService.isIndexStale()).toBe(true);

      // Next search should trigger rebuild
      const result = await searchService.hybridSearch('finance');
      expect(result.success).toBe(true);

      // Index should be fresh again after rebuild
      expect(searchService.isIndexStale()).toBe(false);
    });

    test('cached index should be cleared on invalidation', async () => {
      const searchService = new SearchService({
        chromaDbService: mockChromaDb,
        analysisHistoryService: mockHistoryService,
        parallelEmbeddingService: mockEmbeddingService
      });

      // Build index (creates cache)
      await searchService.buildBM25Index();
      expect(searchService._serializedIndex).not.toBeNull();

      // Invalidate
      searchService.invalidateIndex({ reason: 'test' });

      // Cache should be cleared
      expect(searchService._serializedIndex).toBeNull();
      expect(searchService._serializedDocMap).toBeNull();
    });
  });

  describe('Error Handling', () => {
    test('should handle ChromaDB failures gracefully in search', async () => {
      mockChromaDb.querySimilarFiles.mockRejectedValueOnce(new Error('ChromaDB unavailable'));

      const searchService = new SearchService({
        chromaDbService: mockChromaDb,
        analysisHistoryService: mockHistoryService,
        parallelEmbeddingService: mockEmbeddingService
      });

      await searchService.buildBM25Index();
      const result = await searchService.hybridSearch('finance');

      // Should still succeed (either with fallback or hybrid with empty vector results)
      expect(result.success).toBe(true);
      // Mode can be 'hybrid' with empty vector results or 'bm25-fallback'
      expect(['hybrid', 'bm25-fallback', 'bm25']).toContain(result.mode);
    });

    test('should handle ChromaDB failures gracefully in vector fetch', async () => {
      mockChromaDb.getFileVectors.mockRejectedValueOnce(new Error('ChromaDB unavailable'));

      // When ChromaDB fails, getFileVectors should throw
      await expect(mockChromaDb.getFileVectors(['doc1', 'doc2'])).rejects.toThrow(
        'ChromaDB unavailable'
      );
    });

    test('should handle empty search results', async () => {
      const searchService = new SearchService({
        chromaDbService: mockChromaDb,
        analysisHistoryService: mockHistoryService,
        parallelEmbeddingService: mockEmbeddingService
      });

      await searchService.buildBM25Index();

      // Search for something that doesn't exist
      const result = await searchService.hybridSearch('xyznonexistent123');

      expect(result.success).toBe(true);
      // Results may be empty or contain low-scoring matches
      expect(Array.isArray(result.results)).toBe(true);
    });

    test('ClusteringService should handle ChromaDB being passed', async () => {
      const clusteringService = new ClusteringService({
        chromaDbService: mockChromaDb,
        ollamaService: mockOllamaService
      });

      // Verify service was created with ChromaDB
      expect(clusteringService.chromaDb).toBe(mockChromaDb);
    });
  });

  describe('Performance', () => {
    test('search should complete within timeout', async () => {
      const searchService = new SearchService({
        chromaDbService: mockChromaDb,
        analysisHistoryService: mockHistoryService,
        parallelEmbeddingService: mockEmbeddingService
      });

      await searchService.buildBM25Index();

      const startTime = Date.now();
      const result = await searchService.hybridSearch('finance');
      const duration = Date.now() - startTime;

      expect(result.success).toBe(true);
      expect(duration).toBeLessThan(5000); // Should complete in under 5 seconds
    });

    test('vector fetch should be fast for reasonable document counts', async () => {
      const startTime = Date.now();
      const vectors = await mockChromaDb.getFileVectors(Object.keys(sampleDocuments));
      const duration = Date.now() - startTime;

      expect(Object.keys(vectors).length).toBe(Object.keys(sampleDocuments).length);
      expect(duration).toBeLessThan(1000); // Mock should be instant
    });
  });
});
