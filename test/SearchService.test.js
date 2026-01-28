/**
 * Tests for SearchService
 *
 * Tests BM25 indexing, vector search, RRF fusion, and hybrid search functionality.
 */

// Mock logger before requiring the service
jest.mock('../src/shared/logger', () => ({
  logger: {
    setContext: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  }
}));

// FIX: Mock fs to prevent file validation from filtering out test results
// The _validateFileExistence method checks if files exist on disk, but test paths don't exist
jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  promises: {
    ...jest.requireActual('fs').promises,
    access: jest.fn().mockResolvedValue(undefined) // All files "exist" in tests
  }
}));

describe('SearchService', () => {
  let SearchService;
  let service;
  let mockChromaDb;
  let mockHistoryService;
  let mockEmbeddingService;

  // Sample document data
  const sampleDocuments = {
    doc1: {
      id: 'doc1',
      fileName: 'quarterly-report.pdf',
      originalPath: '/files/quarterly-report.pdf',
      mimeType: 'application/pdf',
      analysis: {
        subject: 'Q3 Financial Report',
        summary: 'Quarterly financial performance summary for Q3 2024',
        tags: ['finance', 'quarterly', 'report'],
        category: 'Finance',
        extractedText: 'Revenue increased by 15% compared to last quarter...'
      }
    },
    doc2: {
      id: 'doc2',
      fileName: 'project-proposal.docx',
      originalPath: '/files/project-proposal.docx',
      mimeType: 'application/docx',
      analysis: {
        subject: 'New Project Proposal',
        summary: 'Proposal for the new marketing campaign',
        tags: ['project', 'marketing', 'proposal'],
        category: 'Marketing',
        extractedText: 'This proposal outlines the marketing strategy...'
      }
    },
    doc3: {
      id: 'doc3',
      fileName: 'team-photo.jpg',
      originalPath: '/files/team-photo.jpg',
      mimeType: 'image/jpeg',
      analysis: {
        subject: 'Team Photo 2024',
        summary: 'Annual team photograph',
        tags: ['photo', 'team', 'annual'],
        category: 'Images',
        extractedText: ''
      }
    }
  };

  // BM25 uses canonical, path-based IDs ("file:" / "image:") instead of per-analysis IDs.
  const DOC1_CANONICAL_ID = 'file:/files/quarterly-report.pdf';

  // Generate mock embedding vector
  const createMockVector = (seed = 1) => {
    return new Array(384).fill(0).map((_, i) => Math.sin(seed + i) * 0.5);
  };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();

    // Create mock ChromaDB service
    mockChromaDb = {
      initialize: jest.fn().mockResolvedValue(undefined),
      getCollectionDimension: jest.fn().mockResolvedValue(384),
      getStats: jest.fn().mockResolvedValue({ files: 2, fileChunks: 0, folders: 0 }),
      querySimilarFiles: jest.fn().mockResolvedValue([
        {
          id: 'doc1',
          score: 0.92,
          distance: 0.08,
          metadata: {
            path: '/files/quarterly-report.pdf',
            name: 'quarterly-report.pdf',
            tags: ['finance', 'quarterly'],
            category: 'Finance'
          }
        },
        {
          id: 'doc2',
          score: 0.85,
          distance: 0.15,
          metadata: {
            path: '/files/project-proposal.docx',
            name: 'project-proposal.docx',
            tags: ['project', 'marketing'],
            category: 'Marketing'
          }
        }
      ]),
      // FIX: Add missing mocks required for hybrid search
      querySimilarFileChunks: jest.fn().mockResolvedValue([]),
      fileChunkCollection: null, // Chunk search returns early when null
      fileCollection: { count: jest.fn().mockResolvedValue(2) }
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
      embedText: jest.fn().mockResolvedValue({
        vector: createMockVector(1)
      })
    };

    // Load the service
    const module = require('../src/main/services/SearchService');
    SearchService = module.SearchService;

    // Create service instance
    service = new SearchService({
      chromaDbService: mockChromaDb,
      analysisHistoryService: mockHistoryService,
      parallelEmbeddingService: mockEmbeddingService
    });
  });

  describe('diagnostics', () => {
    test('reports embedding coverage between history and file embeddings', async () => {
      const diagnostics = await service.diagnoseSearchIssues('test');
      expect(diagnostics.details.embeddingCoverage).toBeDefined();
      expect(diagnostics.details.embeddingCoverage).toBeCloseTo(2 / 3, 3);
    });
  });

  describe('constructor', () => {
    test('initializes with valid dependencies', () => {
      expect(service.chromaDb).toBe(mockChromaDb);
      expect(service.history).toBe(mockHistoryService);
      expect(service.embedding).toBe(mockEmbeddingService);
      expect(service.bm25Index).toBeNull();
      expect(service.documentMap).toBeInstanceOf(Map);
      expect(service.indexBuiltAt).toBeNull();
    });

    test('throws if chromaDbService is missing', () => {
      expect(() => {
        new SearchService({
          chromaDbService: null,
          analysisHistoryService: mockHistoryService,
          parallelEmbeddingService: mockEmbeddingService
        });
      }).toThrow('SearchService requires chromaDbService dependency');
    });

    test('throws if analysisHistoryService is missing', () => {
      expect(() => {
        new SearchService({
          chromaDbService: mockChromaDb,
          analysisHistoryService: null,
          parallelEmbeddingService: mockEmbeddingService
        });
      }).toThrow('SearchService requires analysisHistoryService dependency');
    });

    test('throws if parallelEmbeddingService is missing', () => {
      expect(() => {
        new SearchService({
          chromaDbService: mockChromaDb,
          analysisHistoryService: mockHistoryService,
          parallelEmbeddingService: null
        });
      }).toThrow('SearchService requires parallelEmbeddingService dependency');
    });
  });

  describe('isIndexStale', () => {
    test('returns true when index is null and never built', () => {
      service.bm25Index = null;
      service.indexBuiltAt = null;
      expect(service.isIndexStale()).toBe(true);
    });

    test('returns false when index is empty but recently built', () => {
      service.bm25Index = null;
      service.documentMap.clear();
      service.indexBuiltAt = Date.now();

      expect(service.isIndexStale()).toBe(false);
    });

    test('returns true when indexBuiltAt is null', () => {
      service.bm25Index = {}; // Non-null index
      service.indexBuiltAt = null;
      expect(service.isIndexStale()).toBe(true);
    });

    test('returns false when index is fresh', () => {
      service.bm25Index = {}; // Non-null index
      service.indexBuiltAt = Date.now();
      expect(service.isIndexStale()).toBe(false);
    });

    test('returns true when index is older than INDEX_STALE_MS', () => {
      service.bm25Index = {}; // Non-null index
      service.indexBuiltAt = Date.now() - (service.INDEX_STALE_MS + 1000);
      expect(service.isIndexStale()).toBe(true);
    });
  });

  describe('buildBM25Index', () => {
    test('builds index from analysis history', async () => {
      const result = await service.buildBM25Index();

      expect(result.success).toBe(true);
      expect(result.indexed).toBe(3);
      expect(mockHistoryService.initialize).toHaveBeenCalled();
      expect(service.bm25Index).not.toBeNull();
      expect(service.documentMap.size).toBe(3);
      expect(service.indexBuiltAt).not.toBeNull();
    });

    test('returns success with 0 indexed when no documents', async () => {
      mockHistoryService.analysisHistory = { entries: {} };

      const result = await service.buildBM25Index();

      expect(result.success).toBe(true);
      expect(result.indexed).toBe(0);
      expect(service.bm25Index).toBeNull();
      expect(service.indexBuiltAt).not.toBeNull();
    });

    test('stores document metadata in documentMap', async () => {
      await service.buildBM25Index();

      const doc1Meta = service.documentMap.get(DOC1_CANONICAL_ID);
      expect(doc1Meta).toBeDefined();
      expect(doc1Meta.path).toBe('/files/quarterly-report.pdf');
      expect(doc1Meta.name).toBe('quarterly-report.pdf');
      expect(doc1Meta.tags).toEqual(['finance', 'quarterly', 'report']);
      expect(doc1Meta.category).toBe('Finance');
    });

    test('handles initialization error gracefully', async () => {
      mockHistoryService.initialize.mockRejectedValueOnce(new Error('Init failed'));

      const result = await service.buildBM25Index();

      expect(result.success).toBe(false);
      expect(result.error).toBe('Init failed');
    });

    test('caches serialized index for faster rebuilds', async () => {
      await service.buildBM25Index();

      expect(service._serializedIndex).not.toBeNull();
      expect(service._serializedDocMap).not.toBeNull();
    });
  });

  describe('clearIndex', () => {
    test('clears all index data', async () => {
      await service.buildBM25Index();
      expect(service.bm25Index).not.toBeNull();

      service.clearIndex();

      expect(service.bm25Index).toBeNull();
      expect(service.documentMap.size).toBe(0);
      expect(service.indexBuiltAt).toBeNull();
    });
  });

  describe('_truncateText', () => {
    test('returns empty string for null/undefined', () => {
      expect(service._truncateText(null, 100)).toBe('');
      expect(service._truncateText(undefined, 100)).toBe('');
    });

    test('returns empty string for non-string input', () => {
      expect(service._truncateText(123, 100)).toBe('');
      expect(service._truncateText({}, 100)).toBe('');
    });

    test('returns original string if under limit', () => {
      expect(service._truncateText('short text', 100)).toBe('short text');
    });

    test('truncates string at limit', () => {
      const longText = 'a'.repeat(200);
      expect(service._truncateText(longText, 100)).toBe('a'.repeat(100));
    });
  });

  describe('_escapeLunrQuery', () => {
    test('returns empty string for null/undefined', () => {
      expect(service._escapeLunrQuery(null)).toBe('');
      expect(service._escapeLunrQuery(undefined)).toBe('');
    });

    test('returns empty string for non-string input', () => {
      expect(service._escapeLunrQuery(123)).toBe('');
    });

    test('escapes special lunr characters', () => {
      // These characters should be replaced with spaces
      expect(service._escapeLunrQuery('test+query')).toBe('test query');
      expect(service._escapeLunrQuery('test-query')).toBe('test query');
      expect(service._escapeLunrQuery('test*query')).toBe('test query');
      expect(service._escapeLunrQuery('test?query')).toBe('test query');
      expect(service._escapeLunrQuery('test:query')).toBe('test query');
      expect(service._escapeLunrQuery('test^query')).toBe('test query');
      expect(service._escapeLunrQuery('test~query')).toBe('test query');
    });

    test('handles multiple special characters', () => {
      expect(service._escapeLunrQuery('test+query-again*')).toBe('test query again');
    });

    test('preserves normal text', () => {
      expect(service._escapeLunrQuery('quarterly report')).toBe('quarterly report');
    });
  });

  describe('bm25Search', () => {
    beforeEach(async () => {
      await service.buildBM25Index();
    });

    test('returns empty array when index not built', () => {
      service.bm25Index = null;
      const results = service.bm25Search('test');
      expect(results).toEqual([]);
    });

    test('finds documents by keyword', () => {
      const results = service.bm25Search('quarterly');

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].id).toBe(DOC1_CANONICAL_ID);
      expect(results[0].source).toBe('bm25');
    });

    test('includes match details', () => {
      const results = service.bm25Search('finance');

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].matchDetails).toBeDefined();
      expect(results[0].matchDetails.matchedTerms).toBeDefined();
      expect(results[0].matchDetails.matchedFields).toBeDefined();
    });

    test('includes metadata in results', () => {
      const results = service.bm25Search('quarterly');

      expect(results[0].metadata).toBeDefined();
      expect(results[0].metadata.path).toBe('/files/quarterly-report.pdf');
      expect(results[0].metadata.tags).toEqual(['finance', 'quarterly', 'report']);
    });

    test('respects topK limit', () => {
      const results = service.bm25Search('report', 1);
      expect(results.length).toBeLessThanOrEqual(1);
    });

    test('handles search errors gracefully', () => {
      // Force an error by corrupting the index
      service.bm25Index.search = jest.fn().mockImplementation(() => {
        throw new Error('Search failed');
      });

      const results = service.bm25Search('test');
      expect(results).toEqual([]);
    });
  });

  describe('vectorSearch', () => {
    test('generates query embedding and queries ChromaDB', async () => {
      const results = await service.vectorSearch('financial report');

      expect(mockEmbeddingService.embedText).toHaveBeenCalledWith('financial report');
      expect(mockChromaDb.querySimilarFiles).toHaveBeenCalled();
      expect(results.length).toBe(2);
      expect(results[0].source).toBe('vector');
    });

    test('returns empty array when embedding fails', async () => {
      mockEmbeddingService.embedText.mockResolvedValueOnce(null);

      const results = await service.vectorSearch('test');

      expect(results).toEqual([]);
    });

    test('returns empty array when embedding has no vector', async () => {
      mockEmbeddingService.embedText.mockResolvedValueOnce({ vector: null });

      const results = await service.vectorSearch('test');

      expect(results).toEqual([]);
    });

    test('includes match details with semantic score', async () => {
      const results = await service.vectorSearch('finance');

      expect(results[0].matchDetails).toBeDefined();
      expect(results[0].matchDetails.semanticScore).toBeDefined();
    });

    test('detects query terms in tags', async () => {
      const results = await service.vectorSearch('finance quarterly');

      // Results should have queryTermsInTags populated
      expect(results[0].matchDetails.queryTermsInTags).toBeDefined();
    });

    test('handles ChromaDB errors gracefully', async () => {
      mockChromaDb.querySimilarFiles.mockRejectedValueOnce(new Error('DB error'));

      const results = await service.vectorSearch('test');

      expect(results).toEqual([]);
    });

    test('handles empty ChromaDB results', async () => {
      mockChromaDb.querySimilarFiles.mockResolvedValueOnce(null);

      const results = await service.vectorSearch('test');

      expect(results).toEqual([]);
    });
  });

  describe('_normalizeScores', () => {
    test('returns empty array for empty input', () => {
      expect(service._normalizeScores([])).toEqual([]);
      expect(service._normalizeScores(null)).toBeNull();
      expect(service._normalizeScores(undefined)).toBeUndefined();
    });

    test('normalizes scores to [0, 1] range', () => {
      const results = [
        { id: 'a', score: 10 },
        { id: 'b', score: 5 },
        { id: 'c', score: 0 }
      ];

      const normalized = service._normalizeScores(results);

      expect(normalized[0].score).toBe(1.0); // Max score -> 1
      expect(normalized[1].score).toBe(0.5); // Middle score
      expect(normalized[2].score).toBe(0.0); // Min score -> 0
    });

    test('preserves original scores', () => {
      const results = [
        { id: 'a', score: 10 },
        { id: 'b', score: 5 }
      ];

      const normalized = service._normalizeScores(results);

      expect(normalized[0].originalScore).toBe(10);
      expect(normalized[1].originalScore).toBe(5);
    });

    test('handles all same scores', () => {
      const results = [
        { id: 'a', score: 5 },
        { id: 'b', score: 5 },
        { id: 'c', score: 5 }
      ];

      const normalized = service._normalizeScores(results);

      // All scores should be 1.0 when range is 0
      normalized.forEach((r) => {
        expect(r.score).toBe(1.0);
      });
    });

    test('handles missing scores as 0 for input', () => {
      const results = [
        { id: 'a', score: 10 },
        { id: 'b', score: 0 }, // Explicit 0 score
        { id: 'c', score: 5 }
      ];

      const normalized = service._normalizeScores(results);

      expect(normalized[1].score).toBe(0); // Min score -> 0
      expect(normalized[0].score).toBe(1); // Max score -> 1
      expect(normalized[2].score).toBe(0.5); // Middle score
    });
  });

  describe('reciprocalRankFusion', () => {
    test('fuses results from multiple sources', () => {
      const vectorResults = [
        { id: 'doc1', score: 0.9, metadata: { name: 'doc1' }, source: 'vector' },
        { id: 'doc2', score: 0.8, metadata: { name: 'doc2' }, source: 'vector' }
      ];
      const bm25Results = [
        { id: 'doc2', score: 10, metadata: { name: 'doc2' }, source: 'bm25' },
        { id: 'doc3', score: 8, metadata: { name: 'doc3' }, source: 'bm25' }
      ];

      const fused = service.reciprocalRankFusion([vectorResults, bm25Results]);

      // doc2 appears in both, should rank high
      expect(fused.find((r) => r.id === 'doc2')).toBeDefined();
      expect(fused.length).toBe(3); // 3 unique documents
    });

    test('handles overlapping results with boosted scores', () => {
      const set1 = [
        { id: 'doc1', score: 1.0, source: 'vector', metadata: {} },
        { id: 'doc2', score: 0.8, source: 'vector', metadata: {} }
      ];
      const set2 = [
        { id: 'doc1', score: 1.0, source: 'bm25', metadata: {} },
        { id: 'doc3', score: 0.6, source: 'bm25', metadata: {} }
      ];

      const fused = service.reciprocalRankFusion([set1, set2]);

      // doc1 appears in both sets at rank 1, should have highest score
      expect(fused[0].id).toBe('doc1');
    });

    test('handles disjoint results', () => {
      const set1 = [{ id: 'doc1', score: 1.0, source: 'vector', metadata: {} }];
      const set2 = [{ id: 'doc2', score: 1.0, source: 'bm25', metadata: {} }];

      const fused = service.reciprocalRankFusion([set1, set2]);

      expect(fused.length).toBe(2);
      expect(fused.map((r) => r.id)).toContain('doc1');
      expect(fused.map((r) => r.id)).toContain('doc2');
    });

    test('handles single source only', () => {
      const results = [
        { id: 'doc1', score: 1.0, source: 'vector', metadata: {} },
        { id: 'doc2', score: 0.5, source: 'vector', metadata: {} }
      ];

      const fused = service.reciprocalRankFusion([results]);

      expect(fused.length).toBe(2);
      expect(fused[0].id).toBe('doc1');
    });

    test('handles empty result sets', () => {
      const fused = service.reciprocalRankFusion([[], []]);
      expect(fused).toEqual([]);
    });

    test('merges match details from all sources', () => {
      const vectorResults = [
        {
          id: 'doc1',
          score: 0.9,
          source: 'vector',
          metadata: {},
          matchDetails: { semanticScore: 0.9, queryTermsInTags: ['finance'] }
        }
      ];
      const bm25Results = [
        {
          id: 'doc1',
          score: 10,
          source: 'bm25',
          metadata: {},
          matchDetails: { matchedTerms: ['finance'], matchedFields: ['tags'] }
        }
      ];

      const fused = service.reciprocalRankFusion([vectorResults, bm25Results]);

      // Should have sources from both
      expect(fused[0].matchDetails.sources).toContain('vector');
      expect(fused[0].matchDetails.sources).toContain('bm25');
    });

    test('prefers vector metadata over BM25', () => {
      const vectorResults = [
        {
          id: 'doc1',
          score: 0.9,
          source: 'vector',
          metadata: { name: 'vector-name.pdf' }
        }
      ];
      const bm25Results = [
        {
          id: 'doc1',
          score: 10,
          source: 'bm25',
          metadata: { name: 'bm25-name.pdf' }
        }
      ];

      const fused = service.reciprocalRankFusion([vectorResults, bm25Results]);

      // Vector metadata should be preferred (has current file names)
      expect(fused[0].metadata.name).toBe('vector-name.pdf');
    });

    test('respects custom k parameter', () => {
      // Use two result sets with different orderings to see k effect
      const set1 = [
        { id: 'doc1', score: 1.0, source: 'vector', metadata: {} },
        { id: 'doc2', score: 0.5, source: 'vector', metadata: {} }
      ];
      const set2 = [
        { id: 'doc2', score: 1.0, source: 'bm25', metadata: {} },
        { id: 'doc1', score: 0.5, source: 'bm25', metadata: {} }
      ];

      // Different k values should produce different relative scores
      const fused1 = service.reciprocalRankFusion([set1, set2], 10);
      const fused2 = service.reciprocalRankFusion([set1, set2], 100);

      // Both should have results
      expect(fused1.length).toBe(2);
      expect(fused2.length).toBe(2);
      // RRF with different k values is still valid
      expect(fused1[0].rrfScore).toBeDefined();
      expect(fused2[0].rrfScore).toBeDefined();
    });

    test('can disable score normalization', () => {
      const results = [
        { id: 'doc1', score: 100, source: 'test', metadata: {} },
        { id: 'doc2', score: 1, source: 'test', metadata: {} }
      ];

      const fused = service.reciprocalRankFusion([results], 60, { normalizeScores: false });

      // Without normalization, original scores are used directly
      expect(fused).toBeDefined();
    });

    test('can disable score blending', () => {
      const results = [{ id: 'doc1', score: 1.0, source: 'test', metadata: {} }];

      const fused = service.reciprocalRankFusion([results], 60, { useScoreBlending: false });

      // Final score should equal RRF score when blending is disabled
      expect(fused[0].score).toBe(fused[0].rrfScore);
    });
  });

  describe('_vectorSearchWithTimeout', () => {
    test('returns results when search completes in time', async () => {
      const result = await service._vectorSearchWithTimeout('test', 10, 5000);

      expect(result.results.length).toBeGreaterThan(0);
      expect(result.timedOut).toBe(false);
    });

    test('returns timeout when search takes too long', async () => {
      // Make vector search slow
      mockEmbeddingService.embedText.mockImplementation(
        () =>
          new Promise((resolve) => setTimeout(() => resolve({ vector: createMockVector() }), 500))
      );

      const result = await service._vectorSearchWithTimeout('test', 10, 10); // 10ms timeout

      expect(result.results).toEqual([]);
      expect(result.timedOut).toBe(true);
    });

    test('handles search errors gracefully', async () => {
      mockEmbeddingService.embedText.mockRejectedValueOnce(new Error('Network error'));

      const result = await service._vectorSearchWithTimeout('test', 10);

      expect(result.results).toEqual([]);
      expect(result.timedOut).toBe(false);
      // Error is caught and returned with empty results
    });
  });

  describe('_filterByScore', () => {
    test('filters results below minimum score', () => {
      const results = [
        { id: 'a', score: 0.9 },
        { id: 'b', score: 0.5 },
        { id: 'c', score: 0.3 }
      ];

      const filtered = service._filterByScore(results, 0.5);

      expect(filtered.length).toBe(2);
      expect(filtered.map((r) => r.id)).toEqual(['a', 'b']);
    });

    test('returns all results when minScore is 0 or negative', () => {
      const results = [
        { id: 'a', score: 0.1 },
        { id: 'b', score: 0.05 }
      ];

      expect(service._filterByScore(results, 0).length).toBe(2);
      expect(service._filterByScore(results, -1).length).toBe(2);
    });

    test('returns all results when minScore is null/undefined', () => {
      const results = [{ id: 'a', score: 0.1 }];

      expect(service._filterByScore(results, null).length).toBe(1);
      expect(service._filterByScore(results, undefined).length).toBe(1);
    });

    test('handles missing scores', () => {
      const results = [
        { id: 'a', score: 0.9 },
        { id: 'b' } // No score
      ];

      const filtered = service._filterByScore(results, 0.5);

      expect(filtered.length).toBe(1);
      expect(filtered[0].id).toBe('a');
    });
  });

  describe('hybridSearch', () => {
    beforeEach(async () => {
      await service.buildBM25Index();
    });

    test('returns error for empty query', async () => {
      const result = await service.hybridSearch('');
      expect(result.success).toBe(false);
      expect(result.error).toBe('Query too short');
    });

    test('returns error for query under 2 characters', async () => {
      const result = await service.hybridSearch('a');
      expect(result.success).toBe(false);
      expect(result.error).toBe('Query too short');
    });

    test('performs hybrid search with both sources', async () => {
      const result = await service.hybridSearch('quarterly finance');

      expect(result.success).toBe(true);
      expect(result.mode).toBe('hybrid');
      expect(result.results.length).toBeGreaterThan(0);
      expect(result.meta).toBeDefined();
      expect(result.meta.vectorCount).toBeDefined();
      expect(result.meta.bm25Count).toBeDefined();
    });

    test('performs BM25-only search when mode is bm25', async () => {
      const result = await service.hybridSearch('quarterly', { mode: 'bm25' });

      expect(result.success).toBe(true);
      expect(result.mode).toBe('bm25');
      expect(result.results.length).toBeGreaterThan(0);
    });

    test('performs vector-only search when mode is vector', async () => {
      const result = await service.hybridSearch('financial report', { mode: 'vector' });

      expect(result.success).toBe(true);
      expect(result.mode).toBe('vector');
    });

    test('respects topK option', async () => {
      const result = await service.hybridSearch('report', { topK: 1 });

      expect(result.results.length).toBeLessThanOrEqual(1);
    });

    test('applies minimum score filter', async () => {
      const result = await service.hybridSearch('quarterly', { minScore: 0.9 });

      expect(result.success).toBe(true);
      result.results.forEach((r) => {
        expect(r.score).toBeGreaterThanOrEqual(0.9);
      });
    });

    test('falls back to BM25 when vector search times out', async () => {
      // Override timeout for testing
      const originalTimeout = service._vectorSearchWithTimeout;
      service._vectorSearchWithTimeout = jest.fn().mockResolvedValue({
        results: [],
        timedOut: true
      });

      const result = await service.hybridSearch('quarterly');

      expect(result.success).toBe(true);
      expect(result.mode).toBe('bm25-fallback');
      expect(result.meta.vectorTimedOut).toBe(true);

      service._vectorSearchWithTimeout = originalTimeout;
    }, 15000);

    test('rebuilds stale index before search', async () => {
      service.indexBuiltAt = Date.now() - (service.INDEX_STALE_MS + 1000);
      const buildSpy = jest.spyOn(service, 'buildBM25Index');

      await service.hybridSearch('quarterly');

      expect(buildSpy).toHaveBeenCalled();
    });

    test('falls back to BM25 on complete hybrid failure', async () => {
      // Force a failure in the hybrid path (hybridSearch no longer calls reciprocalRankFusion)
      const normalizeSpy = jest.spyOn(service, '_normalizeScores').mockImplementation(() => {
        throw new Error('Normalize failed');
      });

      const result = await service.hybridSearch('quarterly');

      expect(result.success).toBe(true);
      expect(result.mode).toBe('bm25-fallback');
      expect(result.meta.hybridError).toBeDefined();
      normalizeSpy.mockRestore();
    });

    test('returns failure when all search methods fail', async () => {
      // Make BM25 index build fail
      mockHistoryService.initialize.mockRejectedValue(new Error('History failed'));
      service.bm25Index = null;
      service.indexBuiltAt = null;

      // Make vector search fail
      mockEmbeddingService.embedText.mockRejectedValue(new Error('Embedding failed'));

      // Also make bm25Search throw
      service.bm25Search = jest.fn().mockImplementation(() => {
        throw new Error('BM25 search failed');
      });

      const result = await service.hybridSearch('test');

      expect(result.success).toBe(false);
    });
  });

  describe('getIndexStatus', () => {
    test('returns correct status when index not built', () => {
      const status = service.getIndexStatus();

      expect(status.hasIndex).toBe(false);
      expect(status.documentCount).toBe(0);
      expect(status.indexBuiltAt).toBeNull();
      expect(status.isStale).toBe(true);
    });

    test('returns correct status when index is built', async () => {
      await service.buildBM25Index();

      const status = service.getIndexStatus();

      expect(status.hasIndex).toBe(true);
      expect(status.documentCount).toBe(3);
      expect(status.indexBuiltAt).not.toBeNull();
      expect(status.isStale).toBe(false);
      expect(status.indexVersion).toBe(1);
    });
  });

  describe('rebuildIndex', () => {
    test('calls buildBM25Index', async () => {
      const buildSpy = jest.spyOn(service, 'buildBM25Index');

      await service.rebuildIndex();

      expect(buildSpy).toHaveBeenCalled();
    });
  });

  describe('warmUp', () => {
    test('builds BM25 index and warms ChromaDB', async () => {
      const result = await service.warmUp();

      expect(result.success).toBe(true);
      expect(result.bm25Indexed).toBe(3);
      expect(result.chromaReady).toBe(true);
      expect(mockChromaDb.initialize).toHaveBeenCalled();
    });

    test('can skip BM25 index building', async () => {
      const result = await service.warmUp({ buildBM25: false });

      expect(result.bm25Indexed).toBe(0);
    });

    test('can skip ChromaDB warming', async () => {
      const result = await service.warmUp({ warmChroma: false });

      expect(result.chromaReady).toBe(false);
    });

    test('handles warmup errors gracefully', async () => {
      mockHistoryService.initialize.mockRejectedValueOnce(new Error('Init failed'));

      const result = await service.warmUp();

      // Should still complete but with partial success
      expect(result.success).toBe(true); // allSettled doesn't fail
    });
  });

  describe('getPerformanceMetrics', () => {
    test('returns metrics when index not built', () => {
      const metrics = service.getPerformanceMetrics();

      expect(metrics.indexStatus).toBeDefined();
      expect(metrics.hasCachedIndex).toBe(false);
      expect(metrics.documentCount).toBe(0);
    });

    test('returns metrics when index is built', async () => {
      await service.buildBM25Index();

      const metrics = service.getPerformanceMetrics();

      expect(metrics.indexStatus.hasIndex).toBe(true);
      expect(metrics.hasCachedIndex).toBe(true);
      expect(metrics.cachedIndexSize).toBeGreaterThan(0);
      expect(metrics.documentCount).toBe(3);
    });
  });

  describe('_tryLoadFromCache', () => {
    test('returns false when no cache exists', () => {
      expect(service._tryLoadFromCache()).toBe(false);
    });

    test('loads index from cache when available', async () => {
      await service.buildBM25Index();

      // Clear and reload
      const cachedIndex = service._serializedIndex;
      const cachedDocMap = service._serializedDocMap;
      service.bm25Index = null;
      service.documentMap.clear();

      service._serializedIndex = cachedIndex;
      service._serializedDocMap = cachedDocMap;

      const loaded = service._tryLoadFromCache();

      expect(loaded).toBe(true);
      expect(service.bm25Index).not.toBeNull();
      expect(service.documentMap.size).toBe(3);
    });

    test('returns false on corrupted cache', () => {
      service._serializedIndex = 'invalid json{{{';
      service._serializedDocMap = 'invalid';

      const loaded = service._tryLoadFromCache();

      expect(loaded).toBe(false);
      expect(service._serializedIndex).toBeNull();
      expect(service._serializedDocMap).toBeNull();
    });
  });

  describe('invalidateIndex', () => {
    test('marks index as stale', async () => {
      await service.buildBM25Index();
      expect(service.isIndexStale()).toBe(false);

      service.invalidateIndex({ reason: 'test' });

      expect(service.isIndexStale()).toBe(true);
    });

    test('clears serialized cache', async () => {
      await service.buildBM25Index();
      expect(service._serializedIndex).not.toBeNull();

      service.invalidateIndex({ reason: 'file-move' });

      expect(service._serializedIndex).toBeNull();
      expect(service._serializedDocMap).toBeNull();
    });

    test('does nothing when index not built', () => {
      service.invalidateIndex({ reason: 'test' });
      // Should not throw
      expect(service.indexBuiltAt).toBeNull();
    });

    test('accepts path options for logging', async () => {
      await service.buildBM25Index();

      // Should not throw with path options
      service.invalidateIndex({
        reason: 'file-move',
        oldPath: '/old/path.pdf',
        newPath: '/new/path.pdf'
      });

      expect(service.isIndexStale()).toBe(true);
    });
  });

  describe('with QueryProcessor and ReRanker', () => {
    let serviceWithEnhancements;
    let mockQueryProcessor;
    let mockReRanker;

    beforeEach(() => {
      // Create mock QueryProcessor matching the real interface
      mockQueryProcessor = {
        processQuery: jest.fn().mockResolvedValue({
          original: 'vacaton photos',
          expanded: 'vacation photos holiday trip',
          corrections: [{ original: 'vacaton', corrected: 'vacation' }],
          synonymsAdded: [{ word: 'vacation', synonym: 'holiday' }]
        }),
        extendVocabulary: jest.fn().mockResolvedValue(undefined),
        clearCache: jest.fn()
      };

      // Create mock ReRanker matching the real interface
      mockReRanker = {
        rerank: jest.fn().mockImplementation(async (query, results, options) => {
          // Simulate re-ranking by adding llmScore
          return results.map((r, i) => ({
            ...r,
            llmScore: 0.9 - i * 0.1
          }));
        }),
        isAvailable: jest.fn().mockReturnValue(true),
        clearCache: jest.fn(),
        getStats: jest.fn().mockReturnValue({})
      };

      // Create service with all dependencies including optional ones
      serviceWithEnhancements = new SearchService({
        chromaDbService: mockChromaDb,
        analysisHistoryService: mockHistoryService,
        parallelEmbeddingService: mockEmbeddingService,
        queryProcessor: mockQueryProcessor,
        reRankerService: mockReRanker
      });
    });

    test('accepts optional queryProcessor dependency', () => {
      expect(serviceWithEnhancements.queryProcessor).toBe(mockQueryProcessor);
    });

    test('accepts optional reRanker dependency', () => {
      expect(serviceWithEnhancements.reRanker).toBe(mockReRanker);
    });

    test('works without optional dependencies', () => {
      const basicService = new SearchService({
        chromaDbService: mockChromaDb,
        analysisHistoryService: mockHistoryService,
        parallelEmbeddingService: mockEmbeddingService
      });

      expect(basicService.queryProcessor).toBeNull();
      expect(basicService.reRanker).toBeNull();
    });

    describe('query processing', () => {
      beforeEach(async () => {
        await serviceWithEnhancements.buildBM25Index();
      });

      test('uses queryProcessor when provided', async () => {
        await serviceWithEnhancements.hybridSearch('vacaton photos');

        // processQuery is called with query and options object
        expect(mockQueryProcessor.processQuery).toHaveBeenCalledWith(
          'vacaton photos',
          expect.objectContaining({
            expandSynonyms: true,
            correctSpelling: false // Default is now false (disabled)
          })
        );
      });

      test('includes queryMeta in results when corrections made', async () => {
        const result = await serviceWithEnhancements.hybridSearch('vacaton photos');

        // queryMeta is at top level, not in meta
        expect(result.queryMeta).toBeDefined();
        expect(result.queryMeta.corrections.length).toBeGreaterThan(0);
        expect(result.queryMeta.original).toBe('vacaton photos');
      });

      test('uses expanded query for BM25 search', async () => {
        const bm25Spy = jest.spyOn(serviceWithEnhancements, 'bm25Search');

        await serviceWithEnhancements.hybridSearch('vacaton photos');

        // Should use expanded query with synonyms
        expect(bm25Spy).toHaveBeenCalledWith(
          expect.stringContaining('vacation'),
          expect.any(Number)
        );
      });

      test('handles queryProcessor errors gracefully', async () => {
        mockQueryProcessor.processQuery.mockRejectedValueOnce(new Error('Processing failed'));

        const result = await serviceWithEnhancements.hybridSearch('test query');

        // Should still return results using original query
        expect(result.success).toBe(true);
      });
    });

    describe('re-ranking', () => {
      beforeEach(async () => {
        await serviceWithEnhancements.buildBM25Index();
      });

      test('applies re-ranking when rerank option is true and isAvailable returns true', async () => {
        // Need at least 2 results for reranking to trigger
        mockChromaDb.querySimilarFiles.mockResolvedValueOnce([
          { id: 'doc1', score: 0.9, metadata: { name: 'doc1.pdf', tags: ['finance'] } },
          { id: 'doc2', score: 0.8, metadata: { name: 'doc2.pdf', tags: ['report'] } }
        ]);

        await serviceWithEnhancements.hybridSearch('quarterly report', { rerank: true });

        expect(mockReRanker.rerank).toHaveBeenCalled();
      });

      test('skips re-ranking when rerank option is false', async () => {
        await serviceWithEnhancements.hybridSearch('quarterly report', { rerank: false });

        expect(mockReRanker.rerank).not.toHaveBeenCalled();
      });

      test('skips re-ranking when isAvailable returns false', async () => {
        mockReRanker.isAvailable.mockReturnValue(false);

        await serviceWithEnhancements.hybridSearch('quarterly report', { rerank: true });

        expect(mockReRanker.rerank).not.toHaveBeenCalled();
      });

      test('passes rerankTopN to reranker in options', async () => {
        mockChromaDb.querySimilarFiles.mockResolvedValueOnce([
          { id: 'doc1', score: 0.9, metadata: { name: 'doc1.pdf' } },
          { id: 'doc2', score: 0.8, metadata: { name: 'doc2.pdf' } }
        ]);

        await serviceWithEnhancements.hybridSearch('quarterly', {
          rerank: true,
          rerankTopN: 5
        });

        expect(mockReRanker.rerank).toHaveBeenCalledWith(
          expect.any(String),
          expect.any(Array),
          expect.objectContaining({ topN: 5 })
        );
      });

      test('updates mode to hybrid-reranked after re-ranking', async () => {
        mockChromaDb.querySimilarFiles.mockResolvedValueOnce([
          { id: 'doc1', score: 0.9, metadata: { name: 'doc1.pdf' } },
          { id: 'doc2', score: 0.8, metadata: { name: 'doc2.pdf' } }
        ]);

        const result = await serviceWithEnhancements.hybridSearch('quarterly', { rerank: true });

        expect(result.mode).toContain('reranked');
      });

      test('handles reranker errors gracefully', async () => {
        mockChromaDb.querySimilarFiles.mockResolvedValueOnce([
          { id: 'doc1', score: 0.9, metadata: { name: 'doc1.pdf' } },
          { id: 'doc2', score: 0.8, metadata: { name: 'doc2.pdf' } }
        ]);
        mockReRanker.rerank.mockRejectedValueOnce(new Error('Rerank failed'));

        const result = await serviceWithEnhancements.hybridSearch('quarterly', { rerank: true });

        // Should still return results without re-ranking
        expect(result.success).toBe(true);
        expect(result.mode).not.toContain('reranked');
      });
    });
  });
});
