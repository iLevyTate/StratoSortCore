/**
 * Tests for Pattern Matcher
 * Tests user pattern matching and learning for organization suggestions
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

describe('PatternMatcher', () => {
  let PatternMatcher;
  let matcher;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();

    const module = require('../src/main/services/organization/patternMatcher');
    PatternMatcher = module.PatternMatcher;

    matcher = new PatternMatcher({
      maxUserPatterns: 100,
      maxMemoryMB: 10,
      patternSimilarityThreshold: 0.5,
      maxFeedbackHistory: 50
    });
  });

  describe('constructor', () => {
    test('initializes with default config', () => {
      const defaultMatcher = new PatternMatcher();

      expect(defaultMatcher.maxUserPatterns).toBe(5000);
      expect(defaultMatcher.maxMemoryMB).toBe(50);
      expect(defaultMatcher.patternSimilarityThreshold).toBe(0.5);
      expect(defaultMatcher.maxFeedbackHistory).toBe(1000);
    });

    test('accepts custom config', () => {
      expect(matcher.maxUserPatterns).toBe(100);
      expect(matcher.maxMemoryMB).toBe(10);
      expect(matcher.patternSimilarityThreshold).toBe(0.5);
      expect(matcher.maxFeedbackHistory).toBe(50);
    });

    test('initializes empty collections', () => {
      expect(matcher.userPatterns.size).toBe(0);
      expect(matcher.feedbackHistory).toHaveLength(0);
      expect(matcher.folderUsageStats.size).toBe(0);
    });
  });

  describe('loadPatterns', () => {
    test('loads patterns from stored data', () => {
      const stored = {
        patterns: [
          ['pdf:reports:docs', { folder: 'Documents', count: 5 }],
          ['jpg:photos:pics', { folder: 'Photos', count: 3 }]
        ],
        feedbackHistory: [{ timestamp: Date.now(), accepted: true }],
        folderUsageStats: [
          ['Documents', 10],
          ['Photos', 5]
        ]
      };

      matcher.loadPatterns(stored);

      expect(matcher.userPatterns.size).toBe(2);
      expect(matcher.feedbackHistory).toHaveLength(1);
      expect(matcher.folderUsageStats.size).toBe(2);
    });

    test('handles missing stored data gracefully', () => {
      matcher.loadPatterns({});

      expect(matcher.userPatterns.size).toBe(0);
    });
  });

  describe('exportPatterns', () => {
    test('exports patterns for storage', () => {
      matcher.userPatterns.set('pdf:reports:docs', { folder: 'Docs' });
      matcher.feedbackHistory.push({ timestamp: Date.now() });
      matcher.folderUsageStats.set('Documents', 5);

      const exported = matcher.exportPatterns();

      expect(exported.patterns).toHaveLength(1);
      expect(exported.feedbackHistory).toHaveLength(1);
      expect(exported.folderUsageStats).toHaveLength(1);
    });

    test('trims feedback history to max', () => {
      for (let i = 0; i < 100; i++) {
        matcher.feedbackHistory.push({ timestamp: Date.now(), index: i });
      }

      const exported = matcher.exportPatterns();

      expect(exported.feedbackHistory.length).toBeLessThanOrEqual(matcher.maxFeedbackHistory);
    });
  });

  describe('getPatternBasedSuggestions', () => {
    test('returns suggestions for matching patterns', () => {
      matcher.userPatterns.set('pdf:reports:documents', {
        folder: 'Documents',
        path: '/Documents',
        confidence: 0.9,
        count: 5
      });

      const file = {
        name: 'report.pdf',
        extension: 'pdf',
        analysis: { category: 'reports' }
      };

      const suggestions = matcher.getPatternBasedSuggestions(file);

      expect(suggestions.length).toBeGreaterThan(0);
      expect(suggestions[0].folder).toBe('Documents');
      expect(suggestions[0].method).toBe('user_pattern');
    });

    test('returns empty array when no patterns match', () => {
      matcher.userPatterns.set('jpg:photos:gallery', {
        folder: 'Photos',
        confidence: 0.9,
        count: 5
      });

      const file = {
        name: 'document.pdf',
        extension: 'pdf',
        analysis: { category: 'contracts' }
      };

      const suggestions = matcher.getPatternBasedSuggestions(file);

      expect(suggestions).toHaveLength(0);
    });

    test('limits suggestions to top 3', () => {
      // Add many matching patterns
      for (let i = 0; i < 10; i++) {
        matcher.userPatterns.set(`pdf:reports:folder${i}`, {
          folder: `Folder${i}`,
          confidence: 0.9,
          count: 5
        });
      }

      const file = {
        name: 'report.pdf',
        extension: 'pdf',
        analysis: { category: 'reports' }
      };

      const suggestions = matcher.getPatternBasedSuggestions(file);

      expect(suggestions.length).toBeLessThanOrEqual(3);
    });

    test('sorts suggestions by score', () => {
      matcher.userPatterns.set('pdf:reports:low', {
        folder: 'Low',
        confidence: 0.5,
        count: 1
      });
      matcher.userPatterns.set('pdf:reports:high', {
        folder: 'High',
        confidence: 0.95,
        count: 10
      });

      const file = {
        name: 'report.pdf',
        extension: 'pdf',
        analysis: { category: 'reports' }
      };

      const suggestions = matcher.getPatternBasedSuggestions(file);

      expect(suggestions[0].folder).toBe('High');
    });
  });

  describe('recordFeedback', () => {
    test('adds feedback to history', () => {
      const file = { name: 'test.pdf', extension: 'pdf' };
      const suggestion = { folder: 'Documents' };

      matcher.recordFeedback(file, suggestion, true);

      expect(matcher.feedbackHistory).toHaveLength(1);
      expect(matcher.feedbackHistory[0].accepted).toBe(true);
    });

    test('updates patterns when feedback is accepted', () => {
      const file = { name: 'test.pdf', extension: 'pdf', analysis: { category: 'reports' } };
      const suggestion = { folder: 'Documents', path: '/Docs' };

      matcher.recordFeedback(file, suggestion, true);

      expect(matcher.userPatterns.size).toBe(1);
    });

    test('does not update patterns when feedback is rejected', () => {
      const file = { name: 'test.pdf', extension: 'pdf' };
      const suggestion = { folder: 'Documents' };

      matcher.recordFeedback(file, suggestion, false);

      expect(matcher.userPatterns.size).toBe(0);
    });

    test('prunes old feedback entries', () => {
      // Add old feedback
      const oldTimestamp = Date.now() - 100 * 24 * 60 * 60 * 1000; // 100 days ago
      matcher.feedbackHistory.push({ timestamp: oldTimestamp, accepted: true });

      const file = { name: 'new.pdf', extension: 'pdf' };
      matcher.recordFeedback(file, { folder: 'Docs' }, true);

      // Old entry should be pruned
      expect(matcher.feedbackHistory.every((e) => e.timestamp > oldTimestamp)).toBe(true);
    });

    test('trims history when exceeding max', () => {
      matcher.maxFeedbackHistory = 5;

      for (let i = 0; i < 10; i++) {
        matcher.recordFeedback(
          { name: `file${i}.pdf`, extension: 'pdf' },
          { folder: 'Docs' },
          true
        );
      }

      expect(matcher.feedbackHistory.length).toBeLessThanOrEqual(5);
    });
  });

  describe('calculatePatternSimilarity', () => {
    test('returns 1.0 for exact match', () => {
      const file = { extension: 'pdf', analysis: { category: 'reports' } };
      const pattern = 'pdf:reports:unknown';

      const similarity = matcher.calculatePatternSimilarity(file, pattern);

      expect(similarity).toBe(1.0);
    });

    test('returns partial score for partial match', () => {
      const file = { extension: 'pdf', analysis: { category: 'invoices' } };
      const pattern = 'pdf:reports:documents';

      const similarity = matcher.calculatePatternSimilarity(file, pattern);

      expect(similarity).toBeGreaterThan(0);
      expect(similarity).toBeLessThan(1);
    });

    test('returns 0 for no match', () => {
      const file = { extension: 'jpg', analysis: { category: 'photos' } };
      const pattern = 'pdf:reports:documents';

      const similarity = matcher.calculatePatternSimilarity(file, pattern);

      expect(similarity).toBe(0);
    });
  });

  describe('extractPattern', () => {
    test('extracts pattern from file', () => {
      const file = { extension: 'pdf', analysis: { category: 'reports' } };
      const suggestion = { folder: 'Documents' };

      const pattern = matcher.extractPattern(file, suggestion);

      expect(pattern).toBe('pdf:reports:documents');
    });

    test('uses unknown for missing values', () => {
      const file = { extension: 'pdf' };

      const pattern = matcher.extractPattern(file);

      expect(pattern).toBe('pdf:unknown:unknown');
    });

    test('lowercases pattern', () => {
      const file = { extension: 'PDF', analysis: { category: 'REPORTS' } };
      const suggestion = { folder: 'DOCUMENTS' };

      const pattern = matcher.extractPattern(file, suggestion);

      expect(pattern).toBe('pdf:reports:documents');
    });
  });

  describe('getFolderUsage', () => {
    test('returns 0 for unknown folder', () => {
      expect(matcher.getFolderUsage('unknown')).toBe(0);
    });

    test('returns usage count for known folder', () => {
      matcher.folderUsageStats.set('Documents', 15);

      expect(matcher.getFolderUsage('Documents')).toBe(15);
    });
  });

  describe('incrementFolderUsage', () => {
    test('increments from 0 for new folder', () => {
      matcher.incrementFolderUsage('NewFolder');

      expect(matcher.getFolderUsage('NewFolder')).toBe(1);
    });

    test('increments existing count', () => {
      matcher.folderUsageStats.set('Documents', 5);

      matcher.incrementFolderUsage('Documents');

      expect(matcher.getFolderUsage('Documents')).toBe(6);
    });
  });

  describe('checkMemoryUsage', () => {
    test('does not evict patterns under limit', () => {
      for (let i = 0; i < 10; i++) {
        matcher.userPatterns.set(`pattern${i}`, { count: 1, confidence: 0.5 });
      }

      const initialSize = matcher.userPatterns.size;
      matcher.checkMemoryUsage();

      expect(matcher.userPatterns.size).toBe(initialSize);
    });

    test('handles errors gracefully', () => {
      // Force an error by corrupting the patterns
      matcher.userPatterns = null;

      expect(() => matcher.checkMemoryUsage()).not.toThrow();
    });
  });

  describe('_prunePatterns', () => {
    test('removes stale patterns first', () => {
      const now = Date.now();
      const staleTime = now - 200 * 24 * 60 * 60 * 1000; // 200 days ago

      matcher.userPatterns.set('stale', { lastUsed: staleTime, count: 1, confidence: 0.5 });
      matcher.userPatterns.set('recent', { lastUsed: now, count: 1, confidence: 0.5 });

      matcher._prunePatterns(now);

      expect(matcher.userPatterns.has('stale')).toBe(false);
      expect(matcher.userPatterns.has('recent')).toBe(true);
    });

    test('uses LRU when at capacity with stale patterns', () => {
      matcher.maxUserPatterns = 5;
      const now = Date.now();
      const staleTime = now - 200 * 24 * 60 * 60 * 1000; // 200 days ago

      // Add patterns that are all stale
      for (let i = 0; i < 10; i++) {
        matcher.userPatterns.set(`pattern${i}`, {
          lastUsed: staleTime - i * 1000,
          count: 1,
          confidence: 0.5
        });
      }

      matcher._prunePatterns(now);

      // Stale patterns should be removed
      expect(matcher.userPatterns.size).toBe(0);
    });
  });
});
