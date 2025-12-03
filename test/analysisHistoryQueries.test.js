/**
 * Tests for Analysis History Queries
 * Tests query methods with pagination, sorting, and caching
 */

// Mock cacheManager
jest.mock('../src/main/services/analysisHistory/cacheManager', () => ({
  maintainCacheSize: jest.fn(),
}));

describe('Analysis History Queries', () => {
  let queries;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();

    queries = require('../src/main/services/analysisHistory/queries');
  });

  describe('sortEntries', () => {
    const entries = [
      {
        fileName: 'bravo.pdf',
        timestamp: '2024-01-02T00:00:00Z',
        analysis: { confidence: 0.7 },
        fileSize: 2000,
      },
      {
        fileName: 'alpha.pdf',
        timestamp: '2024-01-01T00:00:00Z',
        analysis: { confidence: 0.9 },
        fileSize: 1000,
      },
      {
        fileName: 'charlie.pdf',
        timestamp: '2024-01-03T00:00:00Z',
        analysis: { confidence: 0.8 },
        fileSize: 3000,
      },
    ];

    test('sorts by timestamp ascending', () => {
      const result = queries.sortEntries([...entries], 'timestamp', 'asc');

      expect(result[0].fileName).toBe('alpha.pdf');
      expect(result[2].fileName).toBe('charlie.pdf');
    });

    test('sorts by timestamp descending', () => {
      const result = queries.sortEntries([...entries], 'timestamp', 'desc');

      expect(result[0].fileName).toBe('charlie.pdf');
      expect(result[2].fileName).toBe('alpha.pdf');
    });

    test('sorts by fileName ascending', () => {
      const result = queries.sortEntries([...entries], 'fileName', 'asc');

      expect(result[0].fileName).toBe('alpha.pdf');
      expect(result[2].fileName).toBe('charlie.pdf');
    });

    test('sorts by confidence descending', () => {
      const result = queries.sortEntries([...entries], 'confidence', 'desc');

      expect(result[0].analysis.confidence).toBe(0.9);
      expect(result[2].analysis.confidence).toBe(0.7);
    });

    test('sorts by fileSize ascending', () => {
      const result = queries.sortEntries([...entries], 'fileSize', 'asc');

      expect(result[0].fileSize).toBe(1000);
      expect(result[2].fileSize).toBe(3000);
    });

    test('defaults to timestamp sort for unknown field', () => {
      const result = queries.sortEntries([...entries], 'unknown', 'asc');

      expect(result[0].fileName).toBe('alpha.pdf');
    });

    test('handles missing confidence values', () => {
      const entriesWithMissing = [
        { analysis: { confidence: 0.5 } },
        { analysis: {} },
        { analysis: { confidence: 0.8 } },
      ];

      const result = queries.sortEntries(entriesWithMissing, 'confidence', 'desc');

      expect(result[0].analysis.confidence).toBe(0.8);
    });
  });

  describe('getAnalysisByPath', () => {
    test('returns entry when found', () => {
      const analysisHistory = {
        entries: {
          entry1: { id: 'entry1', fileName: 'test.pdf' },
        },
      };
      const analysisIndex = {
        pathLookup: { '/path/to/test.pdf': 'entry1' },
      };

      const result = queries.getAnalysisByPath(
        analysisHistory,
        analysisIndex,
        '/path/to/test.pdf',
      );

      expect(result).toEqual({ id: 'entry1', fileName: 'test.pdf' });
    });

    test('returns null when not found', () => {
      const analysisHistory = { entries: {} };
      const analysisIndex = { pathLookup: {} };

      const result = queries.getAnalysisByPath(
        analysisHistory,
        analysisIndex,
        '/nonexistent',
      );

      expect(result).toBeNull();
    });
  });

  describe('getAnalysisByCategory', () => {
    const analysisHistory = {
      entries: {
        entry1: {
          id: 'entry1',
          timestamp: '2024-01-01',
          analysis: { confidence: 0.9 },
        },
        entry2: {
          id: 'entry2',
          timestamp: '2024-01-02',
          analysis: { confidence: 0.8 },
        },
      },
    };
    const analysisIndex = {
      categoryIndex: {
        documents: ['entry1', 'entry2'],
      },
    };

    test('returns paginated results', () => {
      const cache = {
        categoryResults: new Map(),
      };

      const result = queries.getAnalysisByCategory(
        analysisHistory,
        analysisIndex,
        cache,
        5000,
        'documents',
        { limit: 1, offset: 0 },
      );

      expect(result.results).toHaveLength(1);
      expect(result.total).toBe(2);
      expect(result.hasMore).toBe(true);
    });

    test('uses cache when valid', () => {
      const cache = {
        categoryResults: new Map([
          [
            'documents:timestamp:desc',
            {
              results: [{ id: 'cached' }],
              time: Date.now(),
            },
          ],
        ]),
      };

      const result = queries.getAnalysisByCategory(
        analysisHistory,
        analysisIndex,
        cache,
        5000,
        'documents',
      );

      expect(result.results[0].id).toBe('cached');
    });

    test('returns empty results for unknown category', () => {
      const cache = { categoryResults: new Map() };

      const result = queries.getAnalysisByCategory(
        analysisHistory,
        analysisIndex,
        cache,
        5000,
        'unknown',
      );

      expect(result.results).toHaveLength(0);
      expect(result.total).toBe(0);
    });
  });

  describe('getAnalysisByTag', () => {
    test('returns entries by tag', () => {
      const analysisHistory = {
        entries: {
          entry1: { id: 'entry1', timestamp: '2024-01-01' },
        },
      };
      const analysisIndex = {
        tagIndex: { important: ['entry1'] },
      };
      const cache = { tagResults: new Map() };

      const result = queries.getAnalysisByTag(
        analysisHistory,
        analysisIndex,
        cache,
        5000,
        'important',
      );

      expect(result.results).toHaveLength(1);
    });
  });

  describe('getRecentAnalysis', () => {
    test('returns cached results when valid', () => {
      const analysisHistory = { entries: {} };
      const cache = {
        sortedEntries: [{ id: 'entry1' }, { id: 'entry2' }],
        sortedEntriesValid: true,
        sortedEntriesTime: Date.now(),
      };

      const result = queries.getRecentAnalysis(
        analysisHistory,
        cache,
        5000,
        10,
        0,
      );

      expect(result.results).toEqual([{ id: 'entry1' }, { id: 'entry2' }]);
      expect(result.total).toBe(2);
    });

    test('rebuilds cache when invalid', () => {
      const analysisHistory = {
        entries: {
          entry1: { id: 'entry1', timestamp: '2024-01-01T00:00:00Z' },
          entry2: { id: 'entry2', timestamp: '2024-01-02T00:00:00Z' },
        },
      };
      const cache = {
        sortedEntries: null,
        sortedEntriesValid: false,
        sortedEntriesTime: 0,
      };

      const result = queries.getRecentAnalysis(
        analysisHistory,
        cache,
        5000,
        10,
        0,
      );

      expect(result.results).toHaveLength(2);
      expect(result.results[0].id).toBe('entry2'); // Most recent first
      expect(cache.sortedEntriesValid).toBe(true);
    });

    test('handles pagination', () => {
      const analysisHistory = { entries: {} };
      const cache = {
        sortedEntries: [{ id: '1' }, { id: '2' }, { id: '3' }],
        sortedEntriesValid: true,
        sortedEntriesTime: Date.now(),
      };

      const result = queries.getRecentAnalysis(
        analysisHistory,
        cache,
        5000,
        2,
        1,
      );

      expect(result.results).toEqual([{ id: '2' }, { id: '3' }]);
      expect(result.hasMore).toBe(false);
    });
  });

  describe('getAnalysisByDateRange', () => {
    test('returns entries in date range', () => {
      const analysisHistory = {
        entries: {
          entry1: { id: 'entry1', timestamp: '2024-01-15T00:00:00Z' },
          entry2: { id: 'entry2', timestamp: '2024-02-15T00:00:00Z' },
        },
      };
      const analysisIndex = {
        dateIndex: {
          '2024-01': ['entry1'],
          '2024-02': ['entry2'],
        },
      };

      const result = queries.getAnalysisByDateRange(
        analysisHistory,
        analysisIndex,
        '2024-01-01',
        '2024-01-31',
      );

      expect(result.results).toHaveLength(1);
      expect(result.results[0].id).toBe('entry1');
    });

    test('handles multi-month ranges', () => {
      const analysisHistory = {
        entries: {
          entry1: { id: 'entry1', timestamp: '2024-01-15T00:00:00Z' },
          entry2: { id: 'entry2', timestamp: '2024-02-15T00:00:00Z' },
        },
      };
      const analysisIndex = {
        dateIndex: {
          '2024-01': ['entry1'],
          '2024-02': ['entry2'],
        },
      };

      const result = queries.getAnalysisByDateRange(
        analysisHistory,
        analysisIndex,
        '2024-01-01',
        '2024-02-28',
      );

      expect(result.results).toHaveLength(2);
    });
  });

  describe('getCategories', () => {
    test('returns categories with counts sorted by count', () => {
      const analysisIndex = {
        categoryIndex: {
          documents: ['1', '2', '3'],
          images: ['4'],
          archives: ['5', '6'],
        },
      };

      const result = queries.getCategories(analysisIndex);

      expect(result[0]).toEqual({ name: 'documents', count: 3 });
      expect(result[1]).toEqual({ name: 'archives', count: 2 });
      expect(result[2]).toEqual({ name: 'images', count: 1 });
    });

    test('handles empty index', () => {
      const result = queries.getCategories({ categoryIndex: {} });

      expect(result).toEqual([]);
    });
  });

  describe('getTags', () => {
    test('returns tags with counts sorted by count', () => {
      const analysisIndex = {
        tagIndex: {
          important: ['1', '2'],
          urgent: ['3'],
        },
      };

      const result = queries.getTags(analysisIndex);

      expect(result[0]).toEqual({ name: 'important', count: 2 });
      expect(result[1]).toEqual({ name: 'urgent', count: 1 });
    });
  });
});
