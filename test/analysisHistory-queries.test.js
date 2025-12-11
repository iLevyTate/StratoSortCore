/**
 * Tests for Analysis History Queries
 * Tests query methods with pagination, sorting, and caching
 */

// Mock dependencies
jest.mock('../src/main/services/analysisHistory/cacheManager', () => ({
  maintainCacheSize: jest.fn()
}));

describe('queries', () => {
  let queries;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();

    queries = require('../src/main/services/analysisHistory/queries');
  });

  describe('sortEntries', () => {
    const entries = [
      {
        timestamp: '2024-01-15T10:00:00Z',
        fileName: 'beta.pdf',
        analysis: { confidence: 0.8 },
        fileSize: 1000
      },
      {
        timestamp: '2024-01-10T10:00:00Z',
        fileName: 'alpha.pdf',
        analysis: { confidence: 0.9 },
        fileSize: 500
      },
      {
        timestamp: '2024-01-20T10:00:00Z',
        fileName: 'gamma.pdf',
        analysis: { confidence: 0.7 },
        fileSize: 2000
      }
    ];

    test('sorts by timestamp ascending', () => {
      const sorted = queries.sortEntries([...entries], 'timestamp', 'asc');

      expect(sorted[0].fileName).toBe('alpha.pdf');
      expect(sorted[2].fileName).toBe('gamma.pdf');
    });

    test('sorts by timestamp descending', () => {
      const sorted = queries.sortEntries([...entries], 'timestamp', 'desc');

      expect(sorted[0].fileName).toBe('gamma.pdf');
      expect(sorted[2].fileName).toBe('alpha.pdf');
    });

    test('sorts by fileName ascending', () => {
      const sorted = queries.sortEntries([...entries], 'fileName', 'asc');

      expect(sorted[0].fileName).toBe('alpha.pdf');
      expect(sorted[2].fileName).toBe('gamma.pdf');
    });

    test('sorts by confidence descending', () => {
      const sorted = queries.sortEntries([...entries], 'confidence', 'desc');

      expect(sorted[0].analysis.confidence).toBe(0.9);
      expect(sorted[2].analysis.confidence).toBe(0.7);
    });

    test('sorts by fileSize ascending', () => {
      const sorted = queries.sortEntries([...entries], 'fileSize', 'asc');

      expect(sorted[0].fileSize).toBe(500);
      expect(sorted[2].fileSize).toBe(2000);
    });

    test('uses timestamp as default sort field', () => {
      const sorted = queries.sortEntries([...entries], 'unknown', 'asc');

      expect(sorted[0].fileName).toBe('alpha.pdf');
    });
  });

  describe('getAnalysisByPath', () => {
    test('returns entry when path exists', () => {
      const history = {
        entries: { 'entry-1': { fileName: 'test.pdf' } }
      };
      const index = {
        pathLookup: { '/path/to/test.pdf': 'entry-1' }
      };

      const result = queries.getAnalysisByPath(history, index, '/path/to/test.pdf');

      expect(result).toEqual({ fileName: 'test.pdf' });
    });

    test('returns null when path not found', () => {
      const history = { entries: {} };
      const index = { pathLookup: {} };

      const result = queries.getAnalysisByPath(history, index, '/unknown/path');

      expect(result).toBeNull();
    });
  });

  describe('getAnalysisByCategory', () => {
    const history = {
      entries: {
        1: { id: 1, timestamp: '2024-01-15', fileName: 'a.pdf', analysis: {} },
        2: { id: 2, timestamp: '2024-01-10', fileName: 'b.pdf', analysis: {} },
        3: { id: 3, timestamp: '2024-01-20', fileName: 'c.pdf', analysis: {} }
      }
    };
    const index = {
      categoryIndex: { documents: [1, 2, 3] }
    };

    test('returns entries for category', () => {
      const cache = { categoryResults: new Map() };

      const result = queries.getAnalysisByCategory(history, index, cache, 5000, 'documents');

      expect(result.results.length).toBe(3);
      expect(result.total).toBe(3);
      expect(result.hasMore).toBe(false);
    });

    test('respects pagination', () => {
      const cache = { categoryResults: new Map() };

      const result = queries.getAnalysisByCategory(history, index, cache, 5000, 'documents', {
        limit: 2,
        offset: 0
      });

      expect(result.results.length).toBe(2);
      expect(result.total).toBe(3);
      expect(result.hasMore).toBe(true);
    });

    test('uses cache when available', () => {
      const cachedResults = [{ id: 1 }, { id: 2 }];
      const cache = {
        categoryResults: new Map([
          ['documents:timestamp:desc', { results: cachedResults, time: Date.now() }]
        ])
      };

      const result = queries.getAnalysisByCategory(history, index, cache, 5000, 'documents');

      expect(result.total).toBe(2);
    });

    test('returns empty results for unknown category', () => {
      const cache = { categoryResults: new Map() };

      const result = queries.getAnalysisByCategory(history, index, cache, 5000, 'unknown');

      expect(result.results.length).toBe(0);
      expect(result.total).toBe(0);
    });
  });

  describe('getAnalysisByTag', () => {
    const history = {
      entries: {
        1: { id: 1, timestamp: '2024-01-15', fileName: 'a.pdf', analysis: {} },
        2: { id: 2, timestamp: '2024-01-10', fileName: 'b.pdf', analysis: {} }
      }
    };
    const index = {
      tagIndex: { invoice: [1, 2] }
    };

    test('returns entries for tag', () => {
      const cache = { tagResults: new Map() };

      const result = queries.getAnalysisByTag(history, index, cache, 5000, 'invoice');

      expect(result.results.length).toBe(2);
      expect(result.total).toBe(2);
    });

    test('uses cache when available', () => {
      const cachedResults = [{ id: 1 }];
      const cache = {
        tagResults: new Map([
          ['invoice:timestamp:desc', { results: cachedResults, time: Date.now() }]
        ])
      };

      const result = queries.getAnalysisByTag(history, index, cache, 5000, 'invoice');

      expect(result.total).toBe(1);
    });
  });

  describe('getRecentAnalysis', () => {
    const history = {
      entries: {
        1: { timestamp: '2024-01-15', fileName: 'recent.pdf' },
        2: { timestamp: '2024-01-10', fileName: 'older.pdf' },
        3: { timestamp: '2024-01-20', fileName: 'newest.pdf' }
      }
    };

    test('returns entries sorted by timestamp descending', () => {
      const cache = { sortedEntriesValid: false, sortedEntries: null };

      const result = queries.getRecentAnalysis(history, cache, 5000);

      expect(result.results[0].fileName).toBe('newest.pdf');
      expect(result.results[2].fileName).toBe('older.pdf');
    });

    test('respects limit parameter', () => {
      const cache = { sortedEntriesValid: false, sortedEntries: null };

      const result = queries.getRecentAnalysis(history, cache, 5000, 2);

      expect(result.results.length).toBe(2);
      expect(result.hasMore).toBe(true);
    });

    test('respects offset parameter', () => {
      const cache = { sortedEntriesValid: false, sortedEntries: null };

      const result = queries.getRecentAnalysis(history, cache, 5000, 2, 1);

      expect(result.results.length).toBe(2);
      expect(result.results[0].fileName).toBe('recent.pdf');
    });

    test('uses cache when valid', () => {
      const cachedEntries = [{ fileName: 'cached.pdf' }];
      const cache = {
        sortedEntriesValid: true,
        sortedEntries: cachedEntries,
        sortedEntriesTime: Date.now()
      };

      const result = queries.getRecentAnalysis(history, cache, 5000);

      expect(result.results[0].fileName).toBe('cached.pdf');
    });
  });

  describe('getAnalysisByDateRange', () => {
    const history = {
      entries: {
        1: { id: 1, timestamp: '2024-01-15T10:00:00Z', fileName: 'jan.pdf' },
        2: { id: 2, timestamp: '2024-02-10T10:00:00Z', fileName: 'feb.pdf' },
        3: { id: 3, timestamp: '2024-03-20T10:00:00Z', fileName: 'mar.pdf' }
      }
    };
    const index = {
      dateIndex: {
        '2024-01': [1],
        '2024-02': [2],
        '2024-03': [3]
      }
    };

    test('returns entries within date range', () => {
      const result = queries.getAnalysisByDateRange(history, index, '2024-01-01', '2024-02-28');

      expect(result.results.length).toBe(2);
      expect(result.total).toBe(2);
    });

    test('filters to exact date range', () => {
      const result = queries.getAnalysisByDateRange(history, index, '2024-01-10', '2024-01-20');

      expect(result.results.length).toBe(1);
      expect(result.results[0].fileName).toBe('jan.pdf');
    });
  });

  describe('getCategories', () => {
    test('returns categories sorted by count', () => {
      const index = {
        categoryIndex: {
          documents: [1, 2, 3],
          images: [4],
          audio: [5, 6]
        }
      };

      const result = queries.getCategories(index);

      expect(result[0]).toEqual({ name: 'documents', count: 3 });
      expect(result[1]).toEqual({ name: 'audio', count: 2 });
      expect(result[2]).toEqual({ name: 'images', count: 1 });
    });
  });

  describe('getTags', () => {
    test('returns tags sorted by count', () => {
      const index = {
        tagIndex: {
          invoice: [1, 2, 3, 4],
          receipt: [5, 6],
          contract: [7]
        }
      };

      const result = queries.getTags(index);

      expect(result[0]).toEqual({ name: 'invoice', count: 4 });
      expect(result[1]).toEqual({ name: 'receipt', count: 2 });
      expect(result[2]).toEqual({ name: 'contract', count: 1 });
    });
  });
});
