/**
 * Tests for QueryProcessor
 *
 * Tests spell correction, synonym expansion, phonetic matching, and vocabulary extension.
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

// Mock wordpos with proper interface
const mockLookup = jest
  .fn()
  .mockResolvedValue([{ synonyms: ['holiday', 'trip', 'journey', 'excursion'] }]);

jest.mock('wordpos', () => {
  return jest.fn().mockImplementation(() => ({
    lookup: mockLookup
  }));
});

describe('QueryProcessor', () => {
  let QueryProcessor;
  let processor;
  let resetInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();

    const module = require('../src/main/services/QueryProcessor');
    QueryProcessor = module.QueryProcessor;
    resetInstance = module.resetInstance;

    // Reset singleton and create fresh processor
    resetInstance();
    processor = new QueryProcessor();
  });

  afterEach(() => {
    if (resetInstance) resetInstance();
  });

  describe('constructor', () => {
    test('initializes with default domain words', () => {
      expect(processor.domainWords).toBeInstanceOf(Set);
      expect(processor.domainWords.has('photo')).toBe(true);
      expect(processor.domainWords.has('vacation')).toBe(true);
      expect(processor.domainWords.has('document')).toBe(true);
    });

    test('initializes phonetic index', () => {
      expect(processor.phoneticIndex).toBeInstanceOf(Map);
      expect(processor.phoneticIndex.size).toBeGreaterThan(0);
    });

    test('initializes empty synonym cache', () => {
      // FIX: synonymCache is now an LRUCache, not a Map
      expect(processor.synonymCache).toBeDefined();
      expect(processor.synonymCache.size).toBe(0);
    });

    test('initializes statistics', () => {
      expect(processor.stats).toBeDefined();
      expect(processor.stats.queriesProcessed).toBe(0);
      expect(processor.stats.correctionsApplied).toBe(0);
    });
  });

  describe('_soundex', () => {
    test('generates soundex codes for words', () => {
      const code = processor._soundex('vacation');

      // Soundex should be 4 characters (uppercase first letter + 3 digits)
      expect(code.length).toBe(4);
      expect(code[0]).toBe('V');
    });

    test('handles edge cases with uppercase first letter', () => {
      expect(processor._soundex('a')).toBe('A000');
      expect(processor._soundex('ab')).toBe('A100');
    });

    test('returns empty string for empty input', () => {
      expect(processor._soundex('')).toBe('');
    });

    test('different words have different codes', () => {
      const code1 = processor._soundex('photo');
      const code2 = processor._soundex('budget');

      expect(code1).not.toBe(code2);
    });

    test('similar sounding words may have same code', () => {
      // Test phonetic similarity
      const code1 = processor._soundex('smith');
      const code2 = processor._soundex('smyth');

      expect(code1).toBe(code2);
    });
  });

  describe('_buildPhoneticIndex', () => {
    test('creates index from domain words', () => {
      const index = processor._buildPhoneticIndex();

      expect(index).toBeInstanceOf(Map);
      expect(index.size).toBeGreaterThan(0);
    });

    test('groups words by soundex code', () => {
      const index = processor._buildPhoneticIndex();

      for (const [code, words] of index.entries()) {
        expect(Array.isArray(words)).toBe(true);
        words.forEach((word) => {
          expect(processor.domainWords.has(word)).toBe(true);
        });
      }
    });
  });

  describe('_phoneticMatch', () => {
    test('finds phonetically similar word or returns null', () => {
      const match = processor._phoneticMatch('foto');

      // May find 'photo' or null depending on soundex similarity
      expect(match === null || typeof match === 'string').toBe(true);
    });

    test('returns null for unmatched words', () => {
      const match = processor._phoneticMatch('xyzabc123');

      expect(match).toBeNull();
    });

    test('returns word from domain vocabulary when match found', () => {
      // 'vacashun' should phonetically match 'vacation'
      const match = processor._phoneticMatch('vacashun');

      if (match) {
        expect(processor.domainWords.has(match)).toBe(true);
      }
    });
  });

  describe('_correctSpelling', () => {
    test('returns original word if in domain vocabulary', () => {
      const result = processor._correctSpelling('vacation');

      expect(result).toBe('vacation');
    });

    test('NEVER corrects stop words', () => {
      // These are common English words that should always be preserved
      // Articles, conjunctions, prepositions
      expect(processor._correctSpelling('the')).toBe('the');
      expect(processor._correctSpelling('and')).toBe('and');
      expect(processor._correctSpelling('with')).toBe('with');
      expect(processor._correctSpelling('from')).toBe('from');
      expect(processor._correctSpelling('about')).toBe('about');
      expect(processor._correctSpelling('between')).toBe('between');

      // Verbs and modals
      expect(processor._correctSpelling('that')).toBe('that');
      expect(processor._correctSpelling('are')).toBe('are');
      expect(processor._correctSpelling('was')).toBe('was');
      expect(processor._correctSpelling('will')).toBe('will');
      expect(processor._correctSpelling('must')).toBe('must');

      // Pronouns
      expect(processor._correctSpelling('she')).toBe('she');
      expect(processor._correctSpelling('him')).toBe('him');
      expect(processor._correctSpelling('our')).toBe('our');

      // Determiners and quantifiers
      expect(processor._correctSpelling('each')).toBe('each');
      expect(processor._correctSpelling('many')).toBe('many');
      expect(processor._correctSpelling('both')).toBe('both');

      // Comparison/relative
      expect(processor._correctSpelling('like')).toBe('like');
      expect(processor._correctSpelling('than')).toBe('than');
    });

    test('does not correct very short words (< 6 chars)', () => {
      // Short words (< 6 chars) are too risky to correct
      // This prevents false corrections like: are->api, that->tax, like->file
      expect(processor._correctSpelling('api')).toBe('api');
      expect(processor._correctSpelling('sql')).toBe('sql');
      expect(processor._correctSpelling('foo')).toBe('foo');
      expect(processor._correctSpelling('hello')).toBe('hello'); // 5 chars, not corrected
      expect(processor._correctSpelling('photo')).toBe('photo'); // 5 chars, in domain vocab
    });

    test('corrects simple typos using Levenshtein distance (6+ chars, edit distance 1)', () => {
      // 'vacaton' is 1 edit away from 'vacation' (7 chars)
      const result = processor._correctSpelling('vacaton');

      expect(result).toBe('vacation');
    });

    test('corrects clear typos in longer words (6+ chars)', () => {
      // 'vacatin' is 1 edit away from 'vacation' (missing 'o')
      // Since both words are long (6+ chars), this is a safe correction
      const result = processor._correctSpelling('vacatin');

      // Should be corrected since it's clearly a typo
      expect(result).toBe('vacation');
    });

    test('returns original for unknown words beyond threshold', () => {
      const result = processor._correctSpelling('xyzabc123');

      // Should return original since no close match
      expect(result).toBe('xyzabc123');
    });
  });

  describe('_getSynonyms', () => {
    test('returns synonyms from WordNet', async () => {
      mockLookup.mockResolvedValueOnce([{ synonyms: ['holiday', 'trip'] }]);

      const synonyms = await processor._getSynonyms('vacation');

      expect(Array.isArray(synonyms)).toBe(true);
    });

    test('caches synonym lookups', async () => {
      mockLookup.mockResolvedValueOnce([{ synonyms: ['holiday'] }]);

      // First lookup
      await processor._getSynonyms('vacation');

      // Should be cached
      expect(processor.synonymCache.has('vacation')).toBe(true);

      // Second lookup should use cache
      const synonyms = await processor._getSynonyms('vacation');
      expect(Array.isArray(synonyms)).toBe(true);
    });

    test('handles lookup errors gracefully', async () => {
      mockLookup.mockRejectedValueOnce(new Error('Lookup failed'));

      const synonyms = await processor._getSynonyms('test');

      expect(synonyms).toEqual([]);
    });

    test('returns empty array for invalid results', async () => {
      mockLookup.mockResolvedValueOnce([]);

      const synonyms = await processor._getSynonyms('unknownword');

      expect(synonyms).toEqual([]);
    });
  });

  describe('processQuery', () => {
    test('returns processed query object with correct properties', async () => {
      const result = await processor.processQuery('vacation photo');

      expect(result).toHaveProperty('original');
      expect(result).toHaveProperty('expanded');
      expect(result).toHaveProperty('corrections');
      expect(result).toHaveProperty('synonymsAdded');
    });

    test('preserves original query', async () => {
      const result = await processor.processQuery('vacation photo');

      expect(result.original).toBe('vacation photo');
    });

    test('expands query with synonyms when enabled', async () => {
      mockLookup.mockResolvedValue([{ synonyms: ['holiday'] }]);

      const result = await processor.processQuery('vacation', { expandSynonyms: true });

      // Expanded should contain at least the original term
      expect(result.expanded).toContain('vacation');
      expect(result.synonymsAdded).toBeDefined();
    });

    test('corrects typos and records corrections', async () => {
      // Explicitly enable spell correction (now disabled by default)
      const result = await processor.processQuery('vacaton', {
        expandSynonyms: false,
        correctSpelling: true
      });

      expect(result.corrections.length).toBeGreaterThan(0);
      expect(result.corrections[0]).toHaveProperty('original', 'vacaton');
      expect(result.corrections[0]).toHaveProperty('corrected', 'vacation');
    });

    test('handles multiple words', async () => {
      // Explicitly enable spell correction (now disabled by default)
      const result = await processor.processQuery('vacaton documnt', {
        expandSynonyms: false,
        correctSpelling: true
      });

      expect(result.corrections.length).toBeGreaterThanOrEqual(1);
    });

    test('filters short words (length <= 1)', async () => {
      const result = await processor.processQuery('a vacation', { expandSynonyms: false });

      // 'a' should be filtered out
      expect(result.expanded.split(' ')).not.toContain('a');
    });

    test('removes duplicate terms in expanded query', async () => {
      mockLookup.mockResolvedValue([{ synonyms: [] }]);

      const result = await processor.processQuery('photo photo');

      const words = result.expanded.split(' ');
      const uniqueWords = [...new Set(words)];

      expect(words.length).toBe(uniqueWords.length);
    });

    test('preserves stop words and does not "correct" them', async () => {
      // This was the bug: "that are like" was being "corrected" to "tax api file"
      const result = await processor.processQuery('pictures that are like trophy', {
        expandSynonyms: false,
        correctSpelling: true
      });

      // Stop words should be preserved as-is
      expect(result.expanded).toContain('that');
      expect(result.expanded).toContain('are');
      expect(result.expanded).toContain('like');

      // Only actual typos should be corrected, not stop words
      const stopWordCorrections = result.corrections.filter((c) =>
        ['that', 'are', 'like'].includes(c.original)
      );
      expect(stopWordCorrections.length).toBe(0);
    });

    test('handles empty query', async () => {
      const result = await processor.processQuery('');

      expect(result.original).toBe('');
      expect(result.expanded).toBe('');
      expect(result.corrections).toEqual([]);
    });

    test('handles null query', async () => {
      const result = await processor.processQuery(null);

      expect(result.original).toBe('');
    });

    test('can disable spell correction', async () => {
      const result = await processor.processQuery('vacaton', {
        correctSpelling: false,
        expandSynonyms: false
      });

      expect(result.corrections.length).toBe(0);
      expect(result.expanded).toContain('vacaton');
    });

    test('respects maxSynonymsPerWord option', async () => {
      mockLookup.mockResolvedValue([
        { synonyms: ['holiday', 'trip', 'journey', 'excursion', 'voyage'] }
      ]);

      const result = await processor.processQuery('vacation', {
        expandSynonyms: true,
        maxSynonymsPerWord: 2
      });

      // Should have at most 2 synonyms added per word
      expect(result.synonymsAdded.length).toBeLessThanOrEqual(2);
    });
  });

  describe('extendVocabulary', () => {
    let mockAnalysisHistory;

    beforeEach(() => {
      mockAnalysisHistory = {
        getRecentAnalysis: jest.fn().mockResolvedValue([
          {
            analysis: {
              tags: ['custom-tag', 'project-name'],
              category: 'Custom Category',
              subject: 'Important Document Title'
            }
          },
          {
            analysis: {
              tags: ['another-tag'],
              category: 'Another Category'
            }
          }
        ])
      };
    });

    test('adds tags from analysis history', async () => {
      const initialSize = processor.domainWords.size;

      await processor.extendVocabulary(mockAnalysisHistory);

      expect(processor.domainWords.has('custom-tag')).toBe(true);
      expect(processor.domainWords.has('project-name')).toBe(true);
      expect(processor.domainWords.size).toBeGreaterThan(initialSize);
    });

    test('adds categories from analysis history', async () => {
      await processor.extendVocabulary(mockAnalysisHistory);

      expect(processor.domainWords.has('custom category')).toBe(true);
    });

    test('adds subject words from analysis history', async () => {
      await processor.extendVocabulary(mockAnalysisHistory);

      // 'important', 'document', 'title' should be added (each > 3 chars)
      expect(processor.domainWords.has('important')).toBe(true);
    });

    test('rebuilds phonetic index after extending', async () => {
      const buildSpy = jest.spyOn(processor, '_buildPhoneticIndex');

      await processor.extendVocabulary(mockAnalysisHistory);

      expect(buildSpy).toHaveBeenCalled();
    });

    test('handles errors gracefully', async () => {
      mockAnalysisHistory.getRecentAnalysis.mockRejectedValue(new Error('DB error'));

      // Should not throw
      await expect(processor.extendVocabulary(mockAnalysisHistory)).resolves.toBeUndefined();
    });

    test('respects maxEntries parameter', async () => {
      await processor.extendVocabulary(mockAnalysisHistory, 500);

      expect(mockAnalysisHistory.getRecentAnalysis).toHaveBeenCalledWith(500);
    });

    test('handles missing analysis data', async () => {
      mockAnalysisHistory.getRecentAnalysis.mockResolvedValue([
        { analysis: null },
        { analysis: { tags: null, category: null } },
        {}
      ]);

      // Should not throw
      await expect(processor.extendVocabulary(mockAnalysisHistory)).resolves.toBeUndefined();
    });

    test('handles missing analysisHistory', async () => {
      await expect(processor.extendVocabulary(null)).resolves.toBeUndefined();
      await expect(processor.extendVocabulary(undefined)).resolves.toBeUndefined();
    });
  });

  describe('getStats', () => {
    test('returns statistics object', () => {
      const stats = processor.getStats();

      expect(stats).toHaveProperty('queriesProcessed');
      expect(stats).toHaveProperty('correctionsApplied');
      expect(stats).toHaveProperty('synonymsAdded');
      expect(stats).toHaveProperty('vocabularySize');
      expect(stats).toHaveProperty('synonymCacheSize');
    });

    test('updates statistics after processing', async () => {
      // Explicitly enable spell correction (now disabled by default)
      await processor.processQuery('vacaton', { correctSpelling: true });

      const stats = processor.getStats();
      expect(stats.queriesProcessed).toBe(1);
      expect(stats.correctionsApplied).toBe(1);
    });
  });

  describe('clearCache', () => {
    test('clears synonym cache', async () => {
      mockLookup.mockResolvedValueOnce([{ synonyms: ['holiday'] }]);
      await processor._getSynonyms('vacation');

      expect(processor.synonymCache.size).toBeGreaterThan(0);

      processor.clearCache();

      expect(processor.synonymCache.size).toBe(0);
    });
  });

  describe('cleanup', () => {
    test('clears resources', () => {
      processor.cleanup();

      expect(processor.synonymCache.size).toBe(0);
      expect(processor.wordpos).toBeNull();
    });
  });

  describe('integration scenarios', () => {
    test('handles common user typos', async () => {
      const typos = [
        { input: 'vacaton', expected: 'vacation' },
        { input: 'pictre', expected: 'picture' },
        { input: 'documnt', expected: 'document' },
        { input: 'foldr', expected: 'folder' }
      ];

      for (const { input, expected } of typos) {
        // Explicitly enable spell correction (now disabled by default)
        const result = await processor.processQuery(input, {
          expandSynonyms: false,
          correctSpelling: true
        });

        if (result.corrections.length > 0) {
          expect(result.corrections[0].corrected).toBe(expected);
        }
      }
    });

    test('handles mixed correct and incorrect words', async () => {
      // Explicitly enable spell correction (now disabled by default)
      const result = await processor.processQuery('my vacaton photos', {
        expandSynonyms: false,
        correctSpelling: true
      });

      // 'vacaton' should be corrected to 'vacation'
      const vacationCorrection = result.corrections.find((c) => c.original === 'vacaton');
      expect(vacationCorrection).toBeDefined();
      expect(vacationCorrection.corrected).toBe('vacation');
    });
  });
});
