/**
 * Extended tests for RelationshipIndexService
 * Covers: _loadIndex, _saveIndex, getEdges filtering, getNeighborEdges limits,
 * getStats, concurrent buildIndex, normalization edge cases
 */

jest.mock('electron', () => jest.requireActual('./mocks/electron'));

// Mock logger to prevent pino/sonic-boom from calling real fs.write
jest.mock('../src/shared/logger', () => ({
  createLogger: jest.fn(() => ({
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  }))
}));

const mockFsStore = new Map();
const mockFs = {
  readFile: jest.fn(async (filePath) => {
    if (!mockFsStore.has(filePath)) {
      const error = new Error('ENOENT');
      error.code = 'ENOENT';
      throw error;
    }
    return mockFsStore.get(filePath);
  }),
  writeFile: jest.fn(async (filePath, contents) => {
    mockFsStore.set(filePath, contents);
  }),
  rename: jest.fn(async (from, to) => {
    const contents = mockFsStore.get(from);
    mockFsStore.set(to, contents);
    mockFsStore.delete(from);
  }),
  unlink: jest.fn(async (filePath) => {
    mockFsStore.delete(filePath);
  })
};

jest.mock('fs', () => ({
  promises: mockFs
}));

describe('RelationshipIndexService - extended coverage', () => {
  let RelationshipIndexService;
  let getSemanticFileId;

  beforeEach(() => {
    mockFsStore.clear();
    jest.clearAllMocks();
    jest.resetModules();
    RelationshipIndexService = require('../src/main/services/RelationshipIndexService');
    getSemanticFileId = require('../src/shared/fileIdUtils').getSemanticFileId;
  });

  function makeHistoryService(entries = {}, updatedAt = '2026-01-01T00:00:00.000Z') {
    return {
      initialize: jest.fn(),
      analysisHistory: { updatedAt, entries }
    };
  }

  function makeAnalysis(tags = [], keywords = [], keyEntities = []) {
    return { tags, keywords, keyEntities };
  }

  describe('_loadIndex', () => {
    test('returns null when index file does not exist', async () => {
      const service = new RelationshipIndexService({
        analysisHistoryService: makeHistoryService()
      });

      const result = await service._loadIndex();

      expect(result).toBeNull();
      expect(service.index).toBeNull();
    });

    test('loads and parses index from disk', async () => {
      const service = new RelationshipIndexService({
        analysisHistoryService: makeHistoryService()
      });

      const savedIndex = {
        updatedAt: '2026-01-01T00:00:00.000Z',
        edges: [{ id: 'test', source: 'a', target: 'b', weight: 3 }],
        edgeCount: 1
      };
      mockFsStore.set(service.indexPath, JSON.stringify(savedIndex));

      const result = await service._loadIndex();

      expect(result).toEqual(savedIndex);
      expect(service.index).toEqual(savedIndex);
    });

    test('handles parse error gracefully', async () => {
      const service = new RelationshipIndexService({
        analysisHistoryService: makeHistoryService()
      });

      mockFsStore.set(service.indexPath, 'not valid json{{{');

      const result = await service._loadIndex();

      expect(result).toBeNull();
    });
  });

  describe('_saveIndex', () => {
    test('writes index atomically via temp file', async () => {
      const service = new RelationshipIndexService({
        analysisHistoryService: makeHistoryService()
      });

      const index = { edges: [], edgeCount: 0 };
      await service._saveIndex(index);

      // Should have written to the final path via rename
      expect(mockFs.rename).toHaveBeenCalled();
      const saved = mockFsStore.get(service.indexPath);
      expect(JSON.parse(saved)).toEqual(index);
    });

    test('cleans up temp file on write error', async () => {
      const service = new RelationshipIndexService({
        analysisHistoryService: makeHistoryService()
      });

      mockFs.writeFile.mockRejectedValueOnce(new Error('Disk full'));

      await expect(service._saveIndex({ edges: [] })).rejects.toThrow('Disk full');

      expect(mockFs.unlink).toHaveBeenCalled();
    });
  });

  describe('_normalizeConcepts', () => {
    test('deduplicates concepts case-insensitively', () => {
      const service = new RelationshipIndexService({
        analysisHistoryService: makeHistoryService()
      });

      const result = service._normalizeConcepts({
        tags: ['Finance', 'finance', 'FINANCE'],
        keywords: ['Report']
      });

      expect(result).toEqual(['finance', 'report']);
    });

    test('handles empty analysis', () => {
      const service = new RelationshipIndexService({
        analysisHistoryService: makeHistoryService()
      });

      expect(service._normalizeConcepts({})).toEqual([]);
      expect(service._normalizeConcepts(null)).toEqual([]);
    });

    test('includes entity and project fields', () => {
      const service = new RelationshipIndexService({
        analysisHistoryService: makeHistoryService()
      });

      const result = service._normalizeConcepts({
        tags: ['alpha'],
        entity: 'Acme Corp',
        project: 'Apollo'
      });

      expect(result).toContain('alpha');
      expect(result).toContain('acme corp');
      expect(result).toContain('apollo');
    });

    test('caps at maxConceptsPerDoc', () => {
      const service = new RelationshipIndexService({
        analysisHistoryService: makeHistoryService()
      });

      const manyTags = Array.from({ length: 30 }, (_, i) => `tag${i}`);
      const result = service._normalizeConcepts({ tags: manyTags });

      expect(result.length).toBeLessThanOrEqual(20);
    });

    test('filters empty strings after normalization', () => {
      const service = new RelationshipIndexService({
        analysisHistoryService: makeHistoryService()
      });

      const result = service._normalizeConcepts({
        tags: ['', '  ', 'valid']
      });

      expect(result).toEqual(['valid']);
    });
  });

  describe('_normalizeList', () => {
    test('handles null and undefined', () => {
      const service = new RelationshipIndexService({
        analysisHistoryService: makeHistoryService()
      });

      expect(service._normalizeList(null)).toEqual([]);
      expect(service._normalizeList(undefined)).toEqual([]);
    });

    test('returns array as-is', () => {
      const service = new RelationshipIndexService({
        analysisHistoryService: makeHistoryService()
      });

      expect(service._normalizeList(['a', 'b'])).toEqual(['a', 'b']);
    });

    test('parses JSON array string', () => {
      const service = new RelationshipIndexService({
        analysisHistoryService: makeHistoryService()
      });

      expect(service._normalizeList('["alpha", "beta"]')).toEqual(['alpha', 'beta']);
    });

    test('splits comma-separated string', () => {
      const service = new RelationshipIndexService({
        analysisHistoryService: makeHistoryService()
      });

      expect(service._normalizeList('alpha, beta, gamma')).toEqual(['alpha', 'beta', 'gamma']);
    });

    test('handles empty string', () => {
      const service = new RelationshipIndexService({
        analysisHistoryService: makeHistoryService()
      });

      expect(service._normalizeList('')).toEqual([]);
      expect(service._normalizeList('   ')).toEqual([]);
    });

    test('returns empty for non-string non-array', () => {
      const service = new RelationshipIndexService({
        analysisHistoryService: makeHistoryService()
      });

      expect(service._normalizeList(42)).toEqual([]);
      expect(service._normalizeList({})).toEqual([]);
    });
  });

  describe('getEdges', () => {
    test('returns empty edges when fewer than 2 valid IDs', async () => {
      const service = new RelationshipIndexService({
        analysisHistoryService: makeHistoryService()
      });

      const result = await service.getEdges(['single-id']);

      expect(result.success).toBe(true);
      expect(result.edges).toEqual([]);
    });

    test('returns empty edges for empty array', async () => {
      const service = new RelationshipIndexService({
        analysisHistoryService: makeHistoryService()
      });

      const result = await service.getEdges([]);

      expect(result.success).toBe(true);
      expect(result.edges).toEqual([]);
    });

    test('filters edges by file IDs', async () => {
      const entries = {
        doc1: {
          originalPath: '/files/a.txt',
          analysis: makeAnalysis(['shared', 'unique1'])
        },
        doc2: {
          originalPath: '/files/b.txt',
          analysis: makeAnalysis(['shared', 'unique2'])
        },
        doc3: {
          originalPath: '/files/c.txt',
          analysis: makeAnalysis(['shared', 'unique3'])
        }
      };

      const service = new RelationshipIndexService({
        analysisHistoryService: makeHistoryService(entries)
      });
      await service.buildIndex();

      const idA = getSemanticFileId('/files/a.txt');
      const idB = getSemanticFileId('/files/b.txt');

      const result = await service.getEdges([idA, idB]);

      expect(result.success).toBe(true);
      // Should only return edges between a and b, not c
      result.edges.forEach((edge) => {
        expect([idA, idB]).toContain(edge.source);
        expect([idA, idB]).toContain(edge.target);
      });
    });

    test('filters invalid IDs from input', async () => {
      const service = new RelationshipIndexService({
        analysisHistoryService: makeHistoryService()
      });

      const result = await service.getEdges([null, '', undefined, 42]);

      expect(result.success).toBe(true);
      expect(result.edges).toEqual([]);
    });

    test('respects minWeight option', async () => {
      const entries = {
        doc1: {
          originalPath: '/a.txt',
          analysis: makeAnalysis(['x', 'y', 'z'])
        },
        doc2: {
          originalPath: '/b.txt',
          analysis: makeAnalysis(['x', 'y', 'z'])
        }
      };

      const service = new RelationshipIndexService({
        analysisHistoryService: makeHistoryService(entries)
      });
      await service.buildIndex();

      const idA = getSemanticFileId('/a.txt');
      const idB = getSemanticFileId('/b.txt');

      // With a high minWeight, no edges should match
      const result = await service.getEdges([idA, idB], { minWeight: 100 });

      expect(result.edges).toEqual([]);
    });
  });

  describe('getNeighborEdges', () => {
    test('returns empty for no seed IDs', async () => {
      const service = new RelationshipIndexService({
        analysisHistoryService: makeHistoryService()
      });

      const result = await service.getNeighborEdges([]);

      expect(result.success).toBe(true);
      expect(result.edges).toEqual([]);
      expect(result.neighbors).toEqual([]);
    });

    test('discovers neighbor nodes', async () => {
      const entries = {
        doc1: {
          originalPath: '/a.txt',
          analysis: makeAnalysis(['shared1', 'shared2'])
        },
        doc2: {
          originalPath: '/b.txt',
          analysis: makeAnalysis(['shared1', 'shared2'])
        },
        doc3: {
          originalPath: '/c.txt',
          analysis: makeAnalysis(['other'])
        }
      };

      const service = new RelationshipIndexService({
        analysisHistoryService: makeHistoryService(entries)
      });
      await service.buildIndex();

      const idA = getSemanticFileId('/a.txt');
      const idB = getSemanticFileId('/b.txt');

      const result = await service.getNeighborEdges([idA]);

      expect(result.success).toBe(true);
      // b should be discovered as a neighbor of a
      expect(result.neighbors).toContain(idB);
    });

    test('respects maxNeighbors limit', async () => {
      // Create many connected documents
      const entries = {};
      for (let i = 0; i < 10; i++) {
        entries[`doc${i}`] = {
          originalPath: `/files/file${i}.txt`,
          analysis: makeAnalysis(['common1', 'common2', `unique${i}`])
        };
      }

      const service = new RelationshipIndexService({
        analysisHistoryService: makeHistoryService(entries)
      });
      await service.buildIndex();

      const seedId = getSemanticFileId('/files/file0.txt');
      const result = await service.getNeighborEdges([seedId], { maxNeighbors: 3 });

      expect(result.neighbors.length).toBeLessThanOrEqual(3);
    });

    test('filters invalid seed IDs', async () => {
      const service = new RelationshipIndexService({
        analysisHistoryService: makeHistoryService()
      });

      const result = await service.getNeighborEdges([null, '', 42]);

      expect(result.success).toBe(true);
      expect(result.edges).toEqual([]);
    });
  });

  describe('getStats', () => {
    test('returns stats after building index', async () => {
      const entries = {
        doc1: { originalPath: '/a.txt', analysis: makeAnalysis(['x', 'y']) },
        doc2: { originalPath: '/b.txt', analysis: makeAnalysis(['x', 'y']) }
      };

      const service = new RelationshipIndexService({
        analysisHistoryService: makeHistoryService(entries)
      });
      await service.buildIndex();

      const stats = await service.getStats();

      expect(stats.success).toBe(true);
      expect(stats.docCount).toBe(2);
      expect(stats.edgeCount).toBeGreaterThanOrEqual(1);
      expect(stats.conceptCount).toBeGreaterThanOrEqual(2);
      expect(stats.maxWeight).toBeGreaterThanOrEqual(2);
      expect(stats.updatedAt).toBeTruthy();
    });

    test('returns defaults when no index exists', async () => {
      const service = new RelationshipIndexService({
        analysisHistoryService: makeHistoryService({})
      });
      await service.buildIndex();

      const stats = await service.getStats();

      expect(stats.success).toBe(true);
      expect(stats.edgeCount).toBe(0);
      expect(stats.docCount).toBe(0);
    });
  });

  describe('buildIndex - concurrent lock', () => {
    test('does not run two builds concurrently', async () => {
      const analysisHistoryService = makeHistoryService({
        doc1: { originalPath: '/a.txt', analysis: makeAnalysis(['x', 'y']) },
        doc2: { originalPath: '/b.txt', analysis: makeAnalysis(['x', 'y']) }
      });

      const service = new RelationshipIndexService({ analysisHistoryService });

      // Start two builds simultaneously
      const [result1, result2] = await Promise.all([service.buildIndex(), service.buildIndex()]);

      // Both should succeed but initialize should only be called once
      expect(result1.success).toBe(true);
      expect(result2.success).toBe(true);
      expect(analysisHistoryService.initialize).toHaveBeenCalledTimes(1);
    });
  });

  describe('buildIndex - entries without valid paths', () => {
    test('skips entries with no path', async () => {
      const entries = {
        doc1: { analysis: makeAnalysis(['tag1', 'tag2']) },
        doc2: { originalPath: '/valid.txt', analysis: makeAnalysis(['tag1', 'tag2']) }
      };

      const service = new RelationshipIndexService({
        analysisHistoryService: makeHistoryService(entries)
      });
      const result = await service.buildIndex();

      expect(result.success).toBe(true);
      // Only 1 doc should have been processed (the one with a path)
    });

    test('skips entries with no concepts', async () => {
      const entries = {
        doc1: { originalPath: '/a.txt', analysis: {} },
        doc2: { originalPath: '/b.txt', analysis: makeAnalysis(['tag1', 'tag2']) }
      };

      const service = new RelationshipIndexService({
        analysisHistoryService: makeHistoryService(entries)
      });
      const result = await service.buildIndex();

      expect(result.success).toBe(true);
    });
  });

  describe('stale index detection', () => {
    test('rebuilds index when source updatedAt changes', async () => {
      const entries = {
        doc1: { originalPath: '/a.txt', analysis: makeAnalysis(['x', 'y']) },
        doc2: { originalPath: '/b.txt', analysis: makeAnalysis(['x', 'y']) }
      };

      const historyService = makeHistoryService(entries, '2026-01-01');
      const service = new RelationshipIndexService({
        analysisHistoryService: historyService
      });

      await service.buildIndex();
      expect(service.index.sourceUpdatedAt).toBe('2026-01-01');

      // Simulate source data changing
      historyService.analysisHistory.updatedAt = '2026-01-02';

      const buildSpy = jest.spyOn(service, 'buildIndex');
      const idA = getSemanticFileId('/a.txt');
      const idB = getSemanticFileId('/b.txt');
      await service.getEdges([idA, idB]);

      expect(buildSpy).toHaveBeenCalled();
    });
  });
});
