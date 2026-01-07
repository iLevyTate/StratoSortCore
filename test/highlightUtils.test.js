/**
 * Tests for highlightUtils - Search text highlighting utilities
 */

// Import the functions to test
const { highlightMatches, hasMatches } = require('../src/renderer/utils/highlightUtils');

describe('highlightUtils', () => {
  describe('highlightMatches', () => {
    describe('edge cases and input validation', () => {
      test('returns empty text segment for null input', () => {
        const result = highlightMatches(null, 'query');
        expect(result).toEqual([{ text: '', highlight: false }]);
      });

      test('returns empty text segment for undefined input', () => {
        const result = highlightMatches(undefined, 'query');
        expect(result).toEqual([{ text: '', highlight: false }]);
      });

      test('returns original text when query is null', () => {
        const result = highlightMatches('some text', null);
        expect(result).toEqual([{ text: 'some text', highlight: false }]);
      });

      test('returns original text when query is undefined', () => {
        const result = highlightMatches('some text', undefined);
        expect(result).toEqual([{ text: 'some text', highlight: false }]);
      });

      test('returns original text when query is empty', () => {
        const result = highlightMatches('some text', '');
        expect(result).toEqual([{ text: 'some text', highlight: false }]);
      });

      test('returns original text when query is too short (1 character)', () => {
        const result = highlightMatches('some text', 'a');
        expect(result).toEqual([{ text: 'some text', highlight: false }]);
      });

      test('returns original text when query has only short words', () => {
        const result = highlightMatches('some text', 'a b c');
        expect(result).toEqual([{ text: 'some text', highlight: false }]);
      });

      test('handles non-string text input gracefully', () => {
        const result = highlightMatches(123, 'query');
        // Non-string input returns the value as-is in the text field
        expect(result).toEqual([{ text: 123, highlight: false }]);
      });

      test('handles non-string query input gracefully', () => {
        const result = highlightMatches('some text', 123);
        expect(result).toEqual([{ text: 'some text', highlight: false }]);
      });
    });

    describe('basic highlighting', () => {
      test('highlights single word match', () => {
        const result = highlightMatches('hello world', 'hello');
        expect(result).toEqual([
          { text: 'hello', highlight: true },
          { text: ' world', highlight: false }
        ]);
      });

      test('highlights word at end of text', () => {
        const result = highlightMatches('hello world', 'world');
        expect(result).toEqual([
          { text: 'hello ', highlight: false },
          { text: 'world', highlight: true }
        ]);
      });

      test('highlights word in middle of text', () => {
        const result = highlightMatches('the quick brown fox', 'quick');
        expect(result).toEqual([
          { text: 'the ', highlight: false },
          { text: 'quick', highlight: true },
          { text: ' brown fox', highlight: false }
        ]);
      });

      test('returns no highlights when query not found', () => {
        const result = highlightMatches('hello world', 'foo');
        expect(result).toEqual([{ text: 'hello world', highlight: false }]);
      });
    });

    describe('case insensitivity', () => {
      test('highlights case-insensitively', () => {
        const result = highlightMatches('Hello World', 'hello');
        expect(result).toEqual([
          { text: 'Hello', highlight: true },
          { text: ' World', highlight: false }
        ]);
      });

      test('highlights uppercase query against lowercase text', () => {
        const result = highlightMatches('hello world', 'WORLD');
        expect(result).toEqual([
          { text: 'hello ', highlight: false },
          { text: 'world', highlight: true }
        ]);
      });

      test('highlights mixed case query', () => {
        const result = highlightMatches('Hello World', 'HeLLo');
        expect(result).toEqual([
          { text: 'Hello', highlight: true },
          { text: ' World', highlight: false }
        ]);
      });
    });

    describe('multiple matches', () => {
      test('highlights multiple occurrences of same word', () => {
        const result = highlightMatches('hello hello hello', 'hello');
        expect(result).toEqual([
          { text: 'hello', highlight: true },
          { text: ' ', highlight: false },
          { text: 'hello', highlight: true },
          { text: ' ', highlight: false },
          { text: 'hello', highlight: true }
        ]);
      });

      test('highlights multiple different words from query', () => {
        const result = highlightMatches('the quick brown fox', 'quick fox');
        expect(result).toEqual([
          { text: 'the ', highlight: false },
          { text: 'quick', highlight: true },
          { text: ' brown ', highlight: false },
          { text: 'fox', highlight: true }
        ]);
      });

      test('highlights adjacent matches', () => {
        const result = highlightMatches('quickfox', 'quick fox');
        // quickfox should highlight 'quick' then 'fox' will be separate
        expect(result.some((s) => s.text === 'quick' && s.highlight)).toBe(true);
      });
    });

    describe('query word filtering', () => {
      test('filters out single-character words from query', () => {
        const result = highlightMatches('a test string', 'a test');
        // Only 'test' should be highlighted (>= 2 chars)
        expect(result).toEqual([
          { text: 'a ', highlight: false },
          { text: 'test', highlight: true },
          { text: ' string', highlight: false }
        ]);
      });

      test('uses 2+ character words only', () => {
        // Note: 'to' also matches within 'store' (substring matching)
        const result = highlightMatches('go to the store', 'go to');
        expect(result).toEqual([
          { text: 'go', highlight: true },
          { text: ' ', highlight: false },
          { text: 'to', highlight: true },
          { text: ' the s', highlight: false },
          { text: 'to', highlight: true },
          { text: 're', highlight: false }
        ]);
      });
    });

    describe('special characters', () => {
      test('handles regex special characters in query safely', () => {
        const result = highlightMatches('file.txt and file[1].doc', 'file.txt');
        // Should not crash due to regex special chars
        expect(result).toBeDefined();
        expect(Array.isArray(result)).toBe(true);
      });

      test('handles parentheses in query', () => {
        const result = highlightMatches('test (value)', '(value)');
        expect(result).toBeDefined();
      });

      test('handles brackets in query', () => {
        const result = highlightMatches('array[0] item', 'array[0]');
        expect(result).toBeDefined();
      });

      test('handles asterisks in query', () => {
        const result = highlightMatches('important* note', 'important*');
        expect(result).toBeDefined();
      });
    });

    describe('whitespace handling', () => {
      test('trims query whitespace', () => {
        const result = highlightMatches('hello world', '  hello  ');
        expect(result).toEqual([
          { text: 'hello', highlight: true },
          { text: ' world', highlight: false }
        ]);
      });

      test('handles multiple spaces between query words', () => {
        const result = highlightMatches('hello world', 'hello    world');
        expect(result).toEqual([
          { text: 'hello', highlight: true },
          { text: ' ', highlight: false },
          { text: 'world', highlight: true }
        ]);
      });
    });
  });

  describe('hasMatches', () => {
    describe('input validation', () => {
      test('returns false for null text', () => {
        expect(hasMatches(null, 'query')).toBe(false);
      });

      test('returns false for undefined text', () => {
        expect(hasMatches(undefined, 'query')).toBe(false);
      });

      test('returns false for null query', () => {
        expect(hasMatches('some text', null)).toBe(false);
      });

      test('returns false for empty query', () => {
        expect(hasMatches('some text', '')).toBe(false);
      });

      test('returns false for single character query', () => {
        expect(hasMatches('some text', 'a')).toBe(false);
      });
    });

    describe('match detection', () => {
      test('returns true when text contains query word', () => {
        expect(hasMatches('hello world', 'hello')).toBe(true);
      });

      test('returns true for case-insensitive match', () => {
        expect(hasMatches('Hello World', 'hello')).toBe(true);
      });

      test('returns false when no match found', () => {
        expect(hasMatches('hello world', 'foo')).toBe(false);
      });

      test('returns true when any word matches', () => {
        expect(hasMatches('hello world', 'foo world')).toBe(true);
      });

      test('returns true for partial word match', () => {
        expect(hasMatches('hello world', 'ell')).toBe(true);
      });

      test('returns false when only short words in query', () => {
        expect(hasMatches('a b c d', 'a b')).toBe(false);
      });
    });
  });

  describe('ReDoS protection', () => {
    test('limits query words to MAX_QUERY_WORDS (10)', () => {
      // Create query with 15 words
      const manyWords =
        'word1 word2 word3 word4 word5 word6 word7 word8 word9 word10 ' +
        'word11 word12 word13 word14 word15';
      const result = highlightMatches('text with word1 and word11 and word15', manyWords);

      // word1 should be highlighted (within first 10 words)
      const word1Highlighted = result.some((s) => s.highlight && s.text === 'word1');
      expect(word1Highlighted).toBe(true);

      // word11 should NOT be highlighted (exceeds 10 word limit)
      const word11Highlighted = result.some((s) => s.highlight && s.text === 'word11');
      expect(word11Highlighted).toBe(false);
    });

    test('truncates text longer than MAX_TEXT_LENGTH (10000)', () => {
      const longText = 'start ' + 'x'.repeat(10000) + ' searchterm';
      const result = highlightMatches(longText, 'start searchterm');

      // 'start' should be highlighted (within first 10000 chars)
      const startHighlighted = result.some((s) => s.highlight && s.text === 'start');
      expect(startHighlighted).toBe(true);

      // 'searchterm' should NOT be highlighted (beyond 10000 chars)
      const searchtermHighlighted = result.some((s) => s.highlight && s.text === 'searchterm');
      expect(searchtermHighlighted).toBe(false);
    });

    test('handles edge case at exactly MAX_TEXT_LENGTH boundary', () => {
      // Place 'test' at position 9996, so it ends exactly at 10000
      const text = 'x'.repeat(9996) + 'test';
      const result = highlightMatches(text, 'test');

      // 'test' should be highlighted as it's within the 10000 char limit
      const hasHighlight = result.some((s) => s.highlight && s.text === 'test');
      expect(hasHighlight).toBe(true);
    });

    test('does not include text beyond truncation point', () => {
      const longText = 'a'.repeat(15000);
      const result = highlightMatches(longText, 'aaa');

      // Total characters in result should not exceed MAX_TEXT_LENGTH
      const totalChars = result.reduce((sum, seg) => sum + seg.text.length, 0);
      expect(totalChars).toBeLessThanOrEqual(10000);
    });

    test('handles very long query gracefully', () => {
      const longQuery = Array(20)
        .fill('word')
        .map((w, i) => `${w}${i}`)
        .join(' ');
      const result = highlightMatches('word0 word5 word10 word15', longQuery);

      // Should not throw and should return valid result
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeGreaterThan(0);

      // Only first 10 words should match
      const word0Match = result.some((s) => s.highlight && s.text === 'word0');
      const word10Match = result.some((s) => s.highlight && s.text === 'word10');
      expect(word0Match).toBe(true);
      expect(word10Match).toBe(false); // word10 is the 11th word in the query
    });
  });
});
