/**
 * Tests for jsonRepair utility
 * Tests JSON extraction, repair logic, and document validation
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

const {
  extractAndParseJSON,
  repairJSON,
  validateDocumentAnalysis
} = require('../src/main/utils/jsonRepair');

describe('jsonRepair', () => {
  describe('extractAndParseJSON', () => {
    describe('valid JSON', () => {
      test('parses valid JSON object directly', () => {
        const input = '{"name": "test", "value": 123}';
        const result = extractAndParseJSON(input);

        expect(result).toEqual({ name: 'test', value: 123 });
      });

      test('parses valid JSON array directly', () => {
        const input = '[1, 2, 3]';
        const result = extractAndParseJSON(input);

        expect(result).toEqual([1, 2, 3]);
      });

      test('parses nested JSON', () => {
        const input = '{"outer": {"inner": "value"}}';
        const result = extractAndParseJSON(input);

        expect(result).toEqual({ outer: { inner: 'value' } });
      });
    });

    describe('markdown code fences', () => {
      test('extracts JSON from ```json code fence', () => {
        const input = '```json\n{"name": "test"}\n```';
        const result = extractAndParseJSON(input);

        expect(result).toEqual({ name: 'test' });
      });

      test('extracts JSON from ``` code fence without language', () => {
        const input = '```\n{"name": "test"}\n```';
        const result = extractAndParseJSON(input);

        expect(result).toEqual({ name: 'test' });
      });

      test('handles code fence with surrounding text', () => {
        const input = 'Here is the result:\n```json\n{"name": "test"}\n```\nThat was the output.';
        const result = extractAndParseJSON(input);

        expect(result).toEqual({ name: 'test' });
      });
    });

    describe('JSON extraction from text', () => {
      test('extracts JSON object from surrounding text', () => {
        const input = 'The result is: {"name": "test"} and that is all.';
        const result = extractAndParseJSON(input);

        expect(result).toEqual({ name: 'test' });
      });

      test('extracts JSON array from surrounding text', () => {
        const input = 'Here are the items: [1, 2, 3] as requested.';
        const result = extractAndParseJSON(input);

        expect(result).toEqual([1, 2, 3]);
      });
    });

    describe('invalid inputs', () => {
      test('returns default value for null input', () => {
        expect(extractAndParseJSON(null)).toBeNull();
        expect(extractAndParseJSON(null, { default: true })).toEqual({
          default: true
        });
      });

      test('returns default value for undefined input', () => {
        expect(extractAndParseJSON(undefined)).toBeNull();
      });

      test('returns default value for non-string input', () => {
        expect(extractAndParseJSON(123)).toBeNull();
        expect(extractAndParseJSON({})).toBeNull();
      });

      test('returns default value when all parsing fails', () => {
        const input = 'This is not JSON at all';
        const result = extractAndParseJSON(input, { fallback: true });

        expect(result).toEqual({ fallback: true });
      });
    });

    describe('malformed JSON repair', () => {
      test('handles trailing commas', () => {
        const input = '{"name": "test", "value": 123,}';
        const result = extractAndParseJSON(input);

        expect(result).toEqual({ name: 'test', value: 123 });
      });

      test('handles trailing commas in arrays', () => {
        const input = '[1, 2, 3,]';
        const result = extractAndParseJSON(input);

        expect(result).toEqual([1, 2, 3]);
      });

      test('handles missing commas between properties', () => {
        const input = '{"name": "test"\n"value": 123}';
        const result = extractAndParseJSON(input);

        expect(result).toEqual({ name: 'test', value: 123 });
      });

      test('handles truncated JSON (missing closing brace)', () => {
        const input = '{"name": "test"';
        const result = extractAndParseJSON(input);

        expect(result).toEqual({ name: 'test' });
      });

      test('handles truncated JSON (missing closing bracket)', () => {
        const input = '[1, 2, 3';
        const result = extractAndParseJSON(input);

        expect(result).toEqual([1, 2, 3]);
      });

      test('handles nested truncated JSON', () => {
        const input = '{"outer": {"inner": "value"';
        const result = extractAndParseJSON(input);

        expect(result).toEqual({ outer: { inner: 'value' } });
      });
    });
  });

  describe('repairJSON', () => {
    test('returns input unchanged for valid JSON', () => {
      const input = '{"name": "test"}';
      expect(repairJSON(input)).toBe(input);
    });

    test('handles null input', () => {
      expect(repairJSON(null)).toBeNull();
    });

    test('handles non-string input', () => {
      expect(repairJSON(123)).toBe(123);
    });

    test('removes control characters', () => {
      const input = '{"name": "test\u0000\u0001value"}';
      const result = repairJSON(input);

      expect(result).not.toContain('\u0000');
      expect(result).not.toContain('\u0001');
    });

    test('preserves newlines, tabs, and carriage returns', () => {
      const input = '{"name": "line1\\nline2"}';
      const result = repairJSON(input);

      expect(result).toContain('\\n');
    });

    test('fixes trailing comma before closing brace', () => {
      const input = '{"a": 1, "b": 2,}';
      const result = repairJSON(input);

      expect(result).toBe('{"a": 1, "b": 2}');
    });

    test('fixes trailing comma before closing bracket', () => {
      const input = '["a", "b",]';
      const result = repairJSON(input);

      expect(result).toBe('["a", "b"]');
    });

    test('adds missing closing braces', () => {
      const input = '{"outer": {"inner": "value"';
      const result = repairJSON(input);

      expect(result).toBe('{"outer": {"inner": "value"}}');
    });

    test('adds missing closing brackets', () => {
      const input = '[[1, 2], [3, 4';
      const result = repairJSON(input);

      expect(result).toBe('[[1, 2], [3, 4]]');
    });

    test('removes text after final closing brace', () => {
      const input = '{"name": "test"} some extra text';
      const result = repairJSON(input);

      expect(result).toBe('{"name": "test"}');
    });

    test('handles missing commas between simple values', () => {
      // The repair only handles missing commas after simple values (strings, numbers, booleans, null)
      // followed by newline and another property - NOT after arrays/objects
      const input = `{
  "category": "document"
  "name": "test"
  "confidence": 85
}`;
      const result = repairJSON(input);
      const parsed = JSON.parse(result);

      expect(parsed.category).toBe('document');
      expect(parsed.name).toBe('test');
      expect(parsed.confidence).toBe(85);
    });
  });

  describe('validateDocumentAnalysis', () => {
    test('validates complete valid object', () => {
      const input = {
        date: '2024-01-15',
        project: 'Project Alpha',
        purpose: 'Invoice',
        category: 'financial',
        keywords: ['invoice', 'payment'],
        confidence: 85,
        suggestedName: 'invoice_alpha.pdf'
      };

      const result = validateDocumentAnalysis(input);

      expect(result).toEqual(input);
    });

    test('returns null for null input', () => {
      expect(validateDocumentAnalysis(null)).toBeNull();
    });

    test('returns null for non-object input', () => {
      expect(validateDocumentAnalysis('string')).toBeNull();
      expect(validateDocumentAnalysis(123)).toBeNull();
    });

    test('provides default category', () => {
      const result = validateDocumentAnalysis({});

      expect(result.category).toBe('document');
    });

    test('provides default confidence', () => {
      const result = validateDocumentAnalysis({});

      expect(result.confidence).toBe(70);
    });

    test('provides empty keywords array by default', () => {
      const result = validateDocumentAnalysis({});

      expect(result.keywords).toEqual([]);
    });

    test('filters invalid keywords', () => {
      const input = {
        keywords: ['valid', '', null, 123, 'also-valid']
      };

      const result = validateDocumentAnalysis(input);

      expect(result.keywords).toEqual(['valid', 'also-valid']);
    });

    test('clamps confidence to valid range', () => {
      expect(validateDocumentAnalysis({ confidence: -10 }).confidence).toBe(70);
      expect(validateDocumentAnalysis({ confidence: 150 }).confidence).toBe(70);
      expect(validateDocumentAnalysis({ confidence: 50 }).confidence).toBe(50);
    });

    test('ignores non-string date', () => {
      const result = validateDocumentAnalysis({ date: 12345 });

      expect(result.date).toBeUndefined();
    });

    test('ignores non-string project', () => {
      const result = validateDocumentAnalysis({ project: { name: 'test' } });

      expect(result.project).toBeUndefined();
    });

    test('ignores non-string purpose', () => {
      const result = validateDocumentAnalysis({ purpose: ['test'] });

      expect(result.purpose).toBeUndefined();
    });

    test('ignores non-string suggestedName', () => {
      const result = validateDocumentAnalysis({ suggestedName: 123 });

      expect(result.suggestedName).toBeUndefined();
    });
  });

  describe('real-world LLM output scenarios', () => {
    test('handles typical Claude/GPT JSON response', () => {
      const input = `Here's the analysis of your document:

\`\`\`json
{
  "category": "invoice",
  "date": "2024-01-15",
  "project": "Website Redesign",
  "purpose": "Payment for design services",
  "keywords": ["invoice", "design", "payment"],
  "confidence": 92
}
\`\`\`

I hope this helps!`;

      const result = extractAndParseJSON(input);

      expect(result.category).toBe('invoice');
      expect(result.confidence).toBe(92);
    });

    test('handles response with extra explanation text', () => {
      const input = `Based on the content analysis, I've identified this as:
{"category": "contract", "keywords": ["agreement", "terms"], "confidence": 88}
This appears to be a standard contract document.`;

      const result = extractAndParseJSON(input);

      expect(result.category).toBe('contract');
    });

    test('handles response with thinking/reasoning prefix', () => {
      const input = `<thinking>
Let me analyze this document...
</thinking>

{"category": "report", "purpose": "quarterly results", "confidence": 75}`;

      const result = extractAndParseJSON(input);

      expect(result.category).toBe('report');
    });

    test('handles truncated JSON with missing closing brace', () => {
      // repairJSON can fix missing closing braces
      // Note: extractAndParseJSON may not recover if the extraction regex
      // matches a nested array first (limitation of current implementation)
      const input = `{"category": "memo", "purpose": "meeting notes", "confidence": 80`;

      const result = extractAndParseJSON(input);

      expect(result.category).toBe('memo');
      expect(result.purpose).toBe('meeting notes');
      expect(result.confidence).toBe(80);
    });
  });
});
