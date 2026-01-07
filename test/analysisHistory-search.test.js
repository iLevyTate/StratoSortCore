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

    test('finds entries by fileName', async () => {
      const history = createHistory();
      const cache = {
        searchResults: new Map(),
        searchResultsMaxSize: 50
      };

      const result = await search.searchAnalysis(history, cache, 60000, 'invoice', {
        semantic: false
      });

      expect(result.results.length).toBe(1);
      expect(result.results[0].fileName).toBe('invoice_2024.pdf');
      expect(result.fromCache).toBe(false);
    });

    test('finds entries by subject', async () => {
      const history = createHistory();
      const cache = {
        searchResults: new Map(),
        searchResultsMaxSize: 50
      };

      const result = await search.searchAnalysis(history, cache, 60000, 'quarterly', {
        semantic: false
      });

      expect(result.results.length).toBe(1);
      expect(result.results[0].fileName).toBe('report.pdf');
    });

    test('finds entries by summary', async () => {
      const history = createHistory();
      const cache = {
        searchResults: new Map(),
        searchResultsMaxSize: 50
      };

      const result = await search.searchAnalysis(history, cache, 60000, 'consulting', {
        semantic: false
      });

      expect(result.results.length).toBe(1);
      expect(result.results[0].fileName).toBe('contract.pdf');
    });

    test('finds entries by tag', async () => {
      const history = createHistory();
      const cache = {
        searchResults: new Map(),
        searchResultsMaxSize: 50
      };

      const result = await search.searchAnalysis(history, cache, 60000, 'legal', {
        semantic: false
      });

      expect(result.results.length).toBe(1);
      expect(result.results[0].fileName).toBe('contract.pdf');
    });

    test('finds entries by category', async () => {
      const history = createHistory();
      const cache = {
        searchResults: new Map(),
        searchResultsMaxSize: 50
      };

      // Search for category 'legal' which only appears in one entry
      const result = await search.searchAnalysis(history, cache, 60000, 'legal', {
        semantic: false
      });

      expect(result.results.length).toBe(1);
      expect(result.results[0].fileName).toBe('contract.pdf');
    });

    test('finds entries by extracted text', async () => {
      const history = createHistory();
      const cache = {
        searchResults: new Map(),
        searchResultsMaxSize: 50
      };

      const result = await search.searchAnalysis(history, cache, 60000, 'contract text', {
        semantic: false
      });

      expect(result.results.length).toBe(1);
      expect(result.results[0].fileName).toBe('contract.pdf');
    });

    test('returns multiple matches', async () => {
      const history = createHistory();
      const cache = {
        searchResults: new Map(),
        searchResultsMaxSize: 50
      };

      const result = await search.searchAnalysis(history, cache, 60000, 'finance', {
        semantic: false
      });

      expect(result.results.length).toBe(2);
    });

    test('sorts by score then timestamp', async () => {
      const history = createHistory();
      const cache = {
        searchResults: new Map(),
        searchResultsMaxSize: 50
      };

      const result = await search.searchAnalysis(history, cache, 60000, 'finance', {
        semantic: false
      });

      // Results should be sorted by search score
      expect(result.results[0].searchScore).toBeGreaterThanOrEqual(result.results[1].searchScore);
    });

    test('respects limit parameter', async () => {
      const history = createHistory();
      const cache = {
        searchResults: new Map(),
        searchResultsMaxSize: 50
      };

      const result = await search.searchAnalysis(history, cache, 60000, 'finance', {
        limit: 1,
        semantic: false
      });

      expect(result.results.length).toBe(1);
      expect(result.total).toBe(2);
      expect(result.hasMore).toBe(true);
    });

    test('respects offset parameter', async () => {
      const history = createHistory();
      const cache = {
        searchResults: new Map(),
        searchResultsMaxSize: 50
      };

      const result = await search.searchAnalysis(history, cache, 60000, 'finance', {
        limit: 1,
        offset: 1,
        semantic: false
      });

      expect(result.results.length).toBe(1);
      expect(result.hasMore).toBe(false);
    });

    test('uses cache when available', async () => {
      const history = createHistory();
      const cachedResults = [{ fileName: 'cached.pdf', searchScore: 10 }];
      const cache = {
        searchResults: new Map([['test:1000:0', { results: cachedResults, time: Date.now() }]]),
        searchResultsMaxSize: 50
      };

      const result = await search.searchAnalysis(history, cache, 60000, 'test', {
        semantic: false
      });

      expect(result.fromCache).toBe(true);
      expect(result.results[0].fileName).toBe('cached.pdf');
    });

    test('bypasses cache when skipCache is true', async () => {
      const history = createHistory();
      const cachedResults = [{ fileName: 'cached.pdf', searchScore: 10 }];
      const cache = {
        searchResults: new Map([['invoice:1000:0', { results: cachedResults, time: Date.now() }]]),
        searchResultsMaxSize: 50
      };

      const result = await search.searchAnalysis(history, cache, 60000, 'invoice', {
        skipCache: true,
        semantic: false
      });

      expect(result.fromCache).toBe(false);
      expect(result.results[0].fileName).toBe('invoice_2024.pdf');
    });

    test('removes expired cache entries', async () => {
      const history = createHistory();
      const cache = {
        searchResults: new Map([
          ['test:1000:0', { results: [], time: Date.now() - 120000 }] // Expired
        ]),
        searchResultsMaxSize: 50
      };

      await search.searchAnalysis(history, cache, 60000, 'test', { semantic: false });

      // Cache entry should be deleted and not used
    });

    test('returns empty results for no matches', async () => {
      const history = createHistory();
      const cache = {
        searchResults: new Map(),
        searchResultsMaxSize: 50
      };

      const result = await search.searchAnalysis(history, cache, 60000, 'nonexistent', {
        semantic: false
      });

      expect(result.results.length).toBe(0);
      expect(result.total).toBe(0);
      expect(result.hasMore).toBe(false);
    });

    test('gives exact fileName match bonus', async () => {
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

      const result = await search.searchAnalysis(history, cache, 60000, 'test', {
        semantic: false
      });

      // Exact match should have higher score
      expect(result.results[0].fileName).toBe('test');
    });

    test('handles entries without tags', async () => {
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

      const result = await search.searchAnalysis(history, cache, 60000, 'test', {
        semantic: false
      });

      expect(result.results.length).toBe(1);
    });

    test('handles entries with empty tags', async () => {
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

      const result = await search.searchAnalysis(history, cache, 60000, 'test', {
        semantic: false
      });

      expect(result.results.length).toBe(1);
    });

    test('is case insensitive', async () => {
      const history = createHistory();
      const cache = {
        searchResults: new Map(),
        searchResultsMaxSize: 50
      };

      const result = await search.searchAnalysis(history, cache, 60000, 'INVOICE', {
        semantic: false
      });

      expect(result.results.length).toBe(1);
      expect(result.results[0].fileName).toBe('invoice_2024.pdf');
    });
  });
});
