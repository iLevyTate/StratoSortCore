/**
 * @jest-environment node
 *
 * Tests for urlUtils.js
 * Covers URL normalization utilities for service URLs (Ollama, ChromaDB, etc.)
 */

const {
  isHttps,
  hasProtocol,
  collapseDuplicateProtocols,
  normalizeProtocolCase,
  normalizeSlashes,
  extractBaseUrl,
  ensureProtocol,
  normalizeServiceUrl
} = require('../src/shared/urlUtils');

describe('urlUtils', () => {
  describe('isHttps', () => {
    test('returns true for https URLs', () => {
      expect(isHttps('https://localhost:11434')).toBe(true);
      expect(isHttps('https://example.com/api')).toBe(true);
    });

    test('returns true for uppercase HTTPS', () => {
      expect(isHttps('HTTPS://localhost:11434')).toBe(true);
      expect(isHttps('Https://localhost:11434')).toBe(true);
    });

    test('returns false for http URLs', () => {
      expect(isHttps('http://localhost:11434')).toBe(false);
      expect(isHttps('HTTP://localhost:11434')).toBe(false);
    });

    test('returns false for URLs without protocol', () => {
      expect(isHttps('localhost:11434')).toBe(false);
    });
  });

  describe('hasProtocol', () => {
    test('returns true for http URLs', () => {
      expect(hasProtocol('http://localhost:11434')).toBe(true);
    });

    test('returns true for https URLs', () => {
      expect(hasProtocol('https://localhost:11434')).toBe(true);
    });

    test('returns true for uppercase protocols', () => {
      expect(hasProtocol('HTTP://localhost')).toBe(true);
      expect(hasProtocol('HTTPS://localhost')).toBe(true);
    });

    test('returns false for URLs without protocol', () => {
      expect(hasProtocol('localhost:11434')).toBe(false);
      expect(hasProtocol('127.0.0.1:11434')).toBe(false);
    });

    test('returns false for other protocols', () => {
      expect(hasProtocol('ftp://example.com')).toBe(false);
      expect(hasProtocol('file://path/to/file')).toBe(false);
    });
  });

  describe('collapseDuplicateProtocols', () => {
    test('collapses duplicate http protocols', () => {
      expect(collapseDuplicateProtocols('http://http://localhost')).toBe('http://localhost');
      expect(collapseDuplicateProtocols('http://http://http://localhost')).toBe('http://localhost');
    });

    test('collapses duplicate https protocols', () => {
      expect(collapseDuplicateProtocols('https://https://localhost')).toBe('https://localhost');
    });

    test('collapses mixed duplicate protocols preserving first https', () => {
      expect(collapseDuplicateProtocols('https://http://localhost')).toBe('https://localhost');
    });

    test('collapses mixed duplicate protocols preserving http if first', () => {
      expect(collapseDuplicateProtocols('http://https://localhost')).toBe('http://localhost');
    });

    test('returns unchanged URL if no duplicates', () => {
      expect(collapseDuplicateProtocols('http://localhost')).toBe('http://localhost');
      expect(collapseDuplicateProtocols('https://localhost')).toBe('https://localhost');
    });

    test('returns unchanged URL without protocol', () => {
      expect(collapseDuplicateProtocols('localhost:11434')).toBe('localhost:11434');
    });
  });

  describe('normalizeProtocolCase', () => {
    test('lowercases HTTP to http', () => {
      expect(normalizeProtocolCase('HTTP://localhost')).toBe('http://localhost');
    });

    test('lowercases HTTPS to https', () => {
      expect(normalizeProtocolCase('HTTPS://localhost')).toBe('https://localhost');
    });

    test('lowercases mixed case Http', () => {
      expect(normalizeProtocolCase('Http://localhost')).toBe('http://localhost');
      expect(normalizeProtocolCase('hTtP://localhost')).toBe('http://localhost');
    });

    test('preserves already lowercase protocol', () => {
      expect(normalizeProtocolCase('http://localhost')).toBe('http://localhost');
      expect(normalizeProtocolCase('https://localhost')).toBe('https://localhost');
    });

    test('returns unchanged URL without protocol', () => {
      expect(normalizeProtocolCase('localhost:11434')).toBe('localhost:11434');
    });
  });

  describe('normalizeSlashes', () => {
    test('converts backslashes to forward slashes', () => {
      expect(normalizeSlashes('http:\\\\localhost\\api')).toBe('http://localhost/api');
    });

    test('handles multiple backslashes', () => {
      expect(normalizeSlashes('http:\\\\\\localhost')).toBe('http:///localhost');
    });

    test('preserves forward slashes', () => {
      expect(normalizeSlashes('http://localhost/api')).toBe('http://localhost/api');
    });

    test('handles mixed slashes', () => {
      expect(normalizeSlashes('http://localhost\\api/v1\\test')).toBe(
        'http://localhost/api/v1/test'
      );
    });
  });

  describe('extractBaseUrl', () => {
    test('extracts base URL with port', () => {
      expect(extractBaseUrl('http://localhost:11434/api/tags')).toBe('http://localhost:11434');
    });

    test('extracts base URL without port', () => {
      expect(extractBaseUrl('https://example.com/path/to/resource')).toBe('https://example.com');
    });

    test('strips query string', () => {
      expect(extractBaseUrl('http://localhost:11434?query=value')).toBe('http://localhost:11434');
    });

    test('strips hash', () => {
      expect(extractBaseUrl('http://localhost:11434#section')).toBe('http://localhost:11434');
    });

    test('handles URL without protocol by adding http', () => {
      expect(extractBaseUrl('localhost:11434/api')).toBe('http://localhost:11434');
    });

    test('returns original on parse error', () => {
      // Very malformed URLs that can't be parsed
      expect(extractBaseUrl('not a valid url at all:::')).toBe('not a valid url at all:::');
    });
  });

  describe('ensureProtocol', () => {
    test('adds http:// to URL without protocol', () => {
      expect(ensureProtocol('localhost:11434')).toBe('http://localhost:11434');
      expect(ensureProtocol('127.0.0.1:11434')).toBe('http://127.0.0.1:11434');
    });

    test('adds https:// when specified', () => {
      expect(ensureProtocol('localhost:11434', 'https')).toBe('https://localhost:11434');
    });

    test('preserves existing http protocol', () => {
      expect(ensureProtocol('http://localhost:11434')).toBe('http://localhost:11434');
    });

    test('preserves existing https protocol', () => {
      expect(ensureProtocol('https://localhost:11434')).toBe('https://localhost:11434');
    });

    test('trims whitespace before processing', () => {
      expect(ensureProtocol('  localhost:11434  ')).toBe('http://localhost:11434');
    });

    test('returns null/undefined as-is', () => {
      expect(ensureProtocol(null)).toBe(null);
      expect(ensureProtocol(undefined)).toBe(undefined);
    });

    test('returns non-string values as-is', () => {
      expect(ensureProtocol(123)).toBe(123);
      expect(ensureProtocol({})).toEqual({});
    });
  });

  describe('normalizeServiceUrl', () => {
    describe('basic normalization', () => {
      test('normalizes a simple URL', () => {
        expect(normalizeServiceUrl('localhost:11434')).toBe('http://localhost:11434');
      });

      test('normalizes URL with uppercase protocol', () => {
        expect(normalizeServiceUrl('HTTP://localhost:11434')).toBe('http://localhost:11434');
      });

      test('normalizes URL with backslashes', () => {
        expect(normalizeServiceUrl('http:\\\\localhost:11434')).toBe('http://localhost:11434');
      });

      test('normalizes URL with duplicate protocols', () => {
        expect(normalizeServiceUrl('http://http://localhost:11434')).toBe('http://localhost:11434');
      });
    });

    describe('options.defaultUrl', () => {
      test('uses defaultUrl when input is empty', () => {
        expect(normalizeServiceUrl('', { defaultUrl: 'http://localhost:11434' })).toBe(
          'http://localhost:11434'
        );
      });

      test('uses defaultUrl when input is null', () => {
        expect(normalizeServiceUrl(null, { defaultUrl: 'http://localhost:11434' })).toBe(
          'http://localhost:11434'
        );
      });

      test('prefers input over defaultUrl', () => {
        expect(
          normalizeServiceUrl('http://custom:8080', { defaultUrl: 'http://localhost:11434' })
        ).toBe('http://custom:8080');
      });
    });

    describe('options.stripPath', () => {
      test('strips path when stripPath is true', () => {
        expect(normalizeServiceUrl('http://localhost:11434/api/tags', { stripPath: true })).toBe(
          'http://localhost:11434'
        );
      });

      test('preserves path when stripPath is false', () => {
        expect(normalizeServiceUrl('http://localhost:11434/api/tags', { stripPath: false })).toBe(
          'http://localhost:11434/api/tags'
        );
      });

      test('preserves path by default', () => {
        expect(normalizeServiceUrl('http://localhost:11434/api/tags')).toBe(
          'http://localhost:11434/api/tags'
        );
      });
    });

    describe('edge cases', () => {
      test('handles empty string', () => {
        expect(normalizeServiceUrl('')).toBe('');
      });

      test('handles whitespace-only string', () => {
        // After trim, empty string is returned unchanged (falsy check in ensureProtocol)
        expect(normalizeServiceUrl('   ')).toBe('');
      });

      test('trims whitespace', () => {
        expect(normalizeServiceUrl('  http://localhost:11434  ')).toBe('http://localhost:11434');
      });

      test('handles complex malformed URL', () => {
        // Common user error: copy-paste from browser with extra path
        const result = normalizeServiceUrl('HTTP:\\\\http://localhost:11434\\api\\tags', {
          stripPath: true
        });
        expect(result).toBe('http://localhost:11434');
      });
    });
  });
});
