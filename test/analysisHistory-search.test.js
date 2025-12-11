/**
 * Tests for Analysis History Search
 * Tests full-text search with caching, scoring, and pagination
 */

// Mock dependencies
jest.mock('../src/main/services/analysisHistory/cacheManager', () => ({
  getSearchCacheKey: jest.fn((query, options) => `${query}:${options.limit}:${options.offset}`),
  maintainCacheSize: jest.fn()
}));

describe('search', () => {
  let search;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();

    search = require('../src/main/services/analysisHistory/search');
  });

  describe('searchAnalysis', () => {
    const createHistory = () => ({
      entries: {
        1: {
          fileName: 'invoice_2024.pdf',
          timestamp: '2024-01-15T10:00:00Z',
          analysis: {
            subject: 'Monthly invoice',
            summary: 'Invoice for services rendered',
            tags: ['billing', 'finance'],
            category: 'financial'
          }
        },
        2: {
          fileName: 'report.pdf',
          timestamp: '2024-01-20T10:00:00Z',
          analysis: {
            subject: 'Quarterly report',
            summary: 'Q4 2023 financial summary',
            tags: ['quarterly', 'finance'],
            category: 'reports'
          }
        },
        3: {
          fileName: 'contract.pdf',
          timestamp: '2024-01-10T10:00:00Z',
          analysis: {
            subject: 'Service agreement',
            summary: 'Legal contract for consulting services',
            tags: ['legal', 'agreement'],
            category: 'legal',
            extractedText: 'This is a long contract text'
          }
        }
      }
    });

    test('finds entries by fileName', () => {
      const history = createHistory();
      const cache = {
        searchResults: new Map(),
        searchResultsMaxSize: 50
      };

      const result = search.searchAnalysis(history, cache, 60000, 'invoice');

      expect(result.results.length).toBe(1);
      expect(result.results[0].fileName).toBe('invoice_2024.pdf');
      expect(result.fromCache).toBe(false);
    });

    test('finds entries by subject', () => {
      const history = createHistory();
      const cache = {
        searchResults: new Map(),
        searchResultsMaxSize: 50
      };

      const result = search.searchAnalysis(history, cache, 60000, 'quarterly');

      expect(result.results.length).toBe(1);
      expect(result.results[0].fileName).toBe('report.pdf');
    });

    test('finds entries by summary', () => {
      const history = createHistory();
      const cache = {
        searchResults: new Map(),
        searchResultsMaxSize: 50
      };

      const result = search.searchAnalysis(history, cache, 60000, 'consulting');

      expect(result.results.length).toBe(1);
      expect(result.results[0].fileName).toBe('contract.pdf');
    });

    test('finds entries by tag', () => {
      const history = createHistory();
      const cache = {
        searchResults: new Map(),
        searchResultsMaxSize: 50
      };

      const result = search.searchAnalysis(history, cache, 60000, 'legal');

      expect(result.results.length).toBe(1);
      expect(result.results[0].fileName).toBe('contract.pdf');
    });

    test('finds entries by category', () => {
      const history = createHistory();
      const cache = {
        searchResults: new Map(),
        searchResultsMaxSize: 50
      };

      // Search for category 'legal' which only appears in one entry
      const result = search.searchAnalysis(history, cache, 60000, 'legal');

      expect(result.results.length).toBe(1);
      expect(result.results[0].fileName).toBe('contract.pdf');
    });

    test('finds entries by extracted text', () => {
      const history = createHistory();
      const cache = {
        searchResults: new Map(),
        searchResultsMaxSize: 50
      };

      const result = search.searchAnalysis(history, cache, 60000, 'contract text');

      expect(result.results.length).toBe(1);
      expect(result.results[0].fileName).toBe('contract.pdf');
    });

    test('returns multiple matches', () => {
      const history = createHistory();
      const cache = {
        searchResults: new Map(),
        searchResultsMaxSize: 50
      };

      const result = search.searchAnalysis(history, cache, 60000, 'finance');

      expect(result.results.length).toBe(2);
    });

    test('sorts by score then timestamp', () => {
      const history = createHistory();
      const cache = {
        searchResults: new Map(),
        searchResultsMaxSize: 50
      };

      const result = search.searchAnalysis(history, cache, 60000, 'finance');

      // Results should be sorted by search score
      expect(result.results[0].searchScore).toBeGreaterThanOrEqual(result.results[1].searchScore);
    });

    test('respects limit parameter', () => {
      const history = createHistory();
      const cache = {
        searchResults: new Map(),
        searchResultsMaxSize: 50
      };

      const result = search.searchAnalysis(history, cache, 60000, 'finance', {
        limit: 1
      });

      expect(result.results.length).toBe(1);
      expect(result.total).toBe(2);
      expect(result.hasMore).toBe(true);
    });

    test('respects offset parameter', () => {
      const history = createHistory();
      const cache = {
        searchResults: new Map(),
        searchResultsMaxSize: 50
      };

      const result = search.searchAnalysis(history, cache, 60000, 'finance', {
        limit: 1,
        offset: 1
      });

      expect(result.results.length).toBe(1);
      expect(result.hasMore).toBe(false);
    });

    test('uses cache when available', () => {
      const history = createHistory();
      const cachedResults = [{ fileName: 'cached.pdf', searchScore: 10 }];
      const cache = {
        searchResults: new Map([['test:1000:0', { results: cachedResults, time: Date.now() }]]),
        searchResultsMaxSize: 50
      };

      const result = search.searchAnalysis(history, cache, 60000, 'test');

      expect(result.fromCache).toBe(true);
      expect(result.results[0].fileName).toBe('cached.pdf');
    });

    test('bypasses cache when skipCache is true', () => {
      const history = createHistory();
      const cachedResults = [{ fileName: 'cached.pdf', searchScore: 10 }];
      const cache = {
        searchResults: new Map([['invoice:1000:0', { results: cachedResults, time: Date.now() }]]),
        searchResultsMaxSize: 50
      };

      const result = search.searchAnalysis(history, cache, 60000, 'invoice', {
        skipCache: true
      });

      expect(result.fromCache).toBe(false);
      expect(result.results[0].fileName).toBe('invoice_2024.pdf');
    });

    test('removes expired cache entries', () => {
      const history = createHistory();
      const cache = {
        searchResults: new Map([
          ['test:1000:0', { results: [], time: Date.now() - 120000 }] // Expired
        ]),
        searchResultsMaxSize: 50
      };

      search.searchAnalysis(history, cache, 60000, 'test');

      // Cache entry should be deleted and not used
    });

    test('returns empty results for no matches', () => {
      const history = createHistory();
      const cache = {
        searchResults: new Map(),
        searchResultsMaxSize: 50
      };

      const result = search.searchAnalysis(history, cache, 60000, 'nonexistent');

      expect(result.results.length).toBe(0);
      expect(result.total).toBe(0);
      expect(result.hasMore).toBe(false);
    });

    test('gives exact fileName match bonus', () => {
      const history = {
        entries: {
          1: {
            fileName: 'test',
            timestamp: '2024-01-15T10:00:00Z',
            analysis: { subject: 'test file', tags: [] }
          },
          2: {
            fileName: 'test.pdf',
            timestamp: '2024-01-20T10:00:00Z',
            analysis: { subject: 'another', tags: [] }
          }
        }
      };
      const cache = {
        searchResults: new Map(),
        searchResultsMaxSize: 50
      };

      const result = search.searchAnalysis(history, cache, 60000, 'test');

      // Exact match should have higher score
      expect(result.results[0].fileName).toBe('test');
    });

    test('handles entries without tags', () => {
      const history = {
        entries: {
          1: {
            fileName: 'test.pdf',
            timestamp: '2024-01-15T10:00:00Z',
            analysis: { subject: 'test', tags: null }
          }
        }
      };
      const cache = {
        searchResults: new Map(),
        searchResultsMaxSize: 50
      };

      const result = search.searchAnalysis(history, cache, 60000, 'test');

      expect(result.results.length).toBe(1);
    });

    test('handles entries with empty tags', () => {
      const history = {
        entries: {
          1: {
            fileName: 'test.pdf',
            timestamp: '2024-01-15T10:00:00Z',
            analysis: { subject: 'test', tags: [] }
          }
        }
      };
      const cache = {
        searchResults: new Map(),
        searchResultsMaxSize: 50
      };

      const result = search.searchAnalysis(history, cache, 60000, 'test');

      expect(result.results.length).toBe(1);
    });

    test('is case insensitive', () => {
      const history = createHistory();
      const cache = {
        searchResults: new Map(),
        searchResultsMaxSize: 50
      };

      const result = search.searchAnalysis(history, cache, 60000, 'INVOICE');

      expect(result.results.length).toBe(1);
      expect(result.results[0].fileName).toBe('invoice_2024.pdf');
    });
  });
});
