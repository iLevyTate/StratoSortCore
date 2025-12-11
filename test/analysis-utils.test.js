/**
 * Tests for Analysis Utils
 * Tests result normalization utilities
 */

describe('Analysis Utils', () => {
  let normalizeAnalysisResult;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();

    const module = require('../src/main/analysis/utils');
    normalizeAnalysisResult = module.normalizeAnalysisResult;
  });

  describe('normalizeAnalysisResult', () => {
    test('normalizes valid result', () => {
      const raw = {
        category: 'Reports',
        keywords: ['report', 'quarterly'],
        confidence: 0.95,
        suggestedName: 'Q4_Report.pdf',
        extractionMethod: 'text',
        contentLength: 5000
      };

      const result = normalizeAnalysisResult(raw);

      expect(result.category).toBe('Reports');
      expect(result.keywords).toEqual(['report', 'quarterly']);
      expect(result.confidence).toBe(0.95);
      expect(result.suggestedName).toBe('Q4_Report.pdf');
      expect(result.extractionMethod).toBe('text');
      expect(result.contentLength).toBe(5000);
    });

    test('uses fallback for missing category', () => {
      const raw = { confidence: 0.8 };
      const fallback = { category: 'Documents' };

      const result = normalizeAnalysisResult(raw, fallback);

      expect(result.category).toBe('Documents');
    });

    test('uses default category when no fallback', () => {
      const raw = { confidence: 0.8 };

      const result = normalizeAnalysisResult(raw);

      expect(result.category).toBe('document');
    });

    test('uses fallback for empty string category', () => {
      const raw = { category: '' };
      const fallback = { category: 'Fallback' };

      const result = normalizeAnalysisResult(raw, fallback);

      expect(result.category).toBe('Fallback');
    });

    test('uses fallback for whitespace-only category', () => {
      const raw = { category: '   ' };
      const fallback = { category: 'Fallback' };

      const result = normalizeAnalysisResult(raw, fallback);

      expect(result.category).toBe('Fallback');
    });

    test('uses fallback for non-string category', () => {
      const raw = { category: 123 };
      const fallback = { category: 'Fallback' };

      const result = normalizeAnalysisResult(raw, fallback);

      expect(result.category).toBe('Fallback');
    });

    test('uses fallback for non-array keywords', () => {
      const raw = { keywords: 'not-an-array' };
      const fallback = { keywords: ['fallback', 'keyword'] };

      const result = normalizeAnalysisResult(raw, fallback);

      expect(result.keywords).toEqual(['fallback', 'keyword']);
    });

    test('uses empty array when no keywords fallback', () => {
      const raw = { keywords: 'not-an-array' };

      const result = normalizeAnalysisResult(raw);

      expect(result.keywords).toEqual([]);
    });

    test('uses fallback for non-number confidence', () => {
      const raw = { confidence: 'high' };
      const fallback = { confidence: 0.5 };

      const result = normalizeAnalysisResult(raw, fallback);

      expect(result.confidence).toBe(0.5);
    });

    test('uses 0 when no confidence fallback', () => {
      const raw = { confidence: 'invalid' };

      const result = normalizeAnalysisResult(raw);

      expect(result.confidence).toBe(0);
    });

    test('uses fallback for non-string suggestedName', () => {
      const raw = { suggestedName: 123 };
      const fallback = { suggestedName: 'fallback.pdf' };

      const result = normalizeAnalysisResult(raw, fallback);

      expect(result.suggestedName).toBe('fallback.pdf');
    });

    test('uses null when no suggestedName fallback', () => {
      const raw = { suggestedName: 123 };

      const result = normalizeAnalysisResult(raw);

      expect(result.suggestedName).toBeNull();
    });

    test('preserves extractionMethod from raw', () => {
      const raw = { extractionMethod: 'ocr' };

      const result = normalizeAnalysisResult(raw);

      expect(result.extractionMethod).toBe('ocr');
    });

    test('uses fallback for missing extractionMethod', () => {
      const raw = {};
      const fallback = { extractionMethod: 'text' };

      const result = normalizeAnalysisResult(raw, fallback);

      expect(result.extractionMethod).toBe('text');
    });

    test('uses fallback for non-number contentLength', () => {
      const raw = { contentLength: 'large' };
      const fallback = { contentLength: 1000 };

      const result = normalizeAnalysisResult(raw, fallback);

      expect(result.contentLength).toBe(1000);
    });

    test('handles null raw input', () => {
      const result = normalizeAnalysisResult(null);

      expect(result.category).toBe('document');
      expect(result.keywords).toEqual([]);
      expect(result.confidence).toBe(0);
    });

    test('handles undefined raw input', () => {
      const result = normalizeAnalysisResult(undefined);

      expect(result.category).toBe('document');
      expect(result.confidence).toBe(0);
    });

    test('preserves extra properties from raw', () => {
      const raw = {
        category: 'Reports',
        customProperty: 'custom-value',
        anotherProp: 123
      };

      const result = normalizeAnalysisResult(raw);

      expect(result.customProperty).toBe('custom-value');
      expect(result.anotherProp).toBe(123);
    });

    test('normalized values override raw values', () => {
      const raw = {
        category: 'ValidCategory',
        keywords: ['valid']
      };

      const result = normalizeAnalysisResult(raw);

      // Normalized category should override raw
      expect(result.category).toBe('ValidCategory');
      expect(result.keywords).toEqual(['valid']);
    });
  });
});
