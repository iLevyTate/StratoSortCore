/**
 * @jest-environment node
 *
 * Tests for the smart content selection module (contentSelector.js).
 * Covers outline extraction, middle sampling, and full representative selection.
 */

jest.mock('../src/shared/logger', () => {
  const logger = {
    setContext: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  };
  return { logger, createLogger: jest.fn(() => logger) };
});

const {
  selectRepresentativeContent,
  extractDocumentOutline,
  sampleMiddleContent
} = require('../src/main/analysis/contentSelector');

// ---------------------------------------------------------------------------
// extractDocumentOutline
// ---------------------------------------------------------------------------

describe('extractDocumentOutline', () => {
  test('extracts markdown headings', () => {
    const text = '# Introduction\n\nSome text.\n\n## Background\n\nMore text.\n\n### Methods\n\n';
    const outline = extractDocumentOutline(text, 500);
    expect(outline).toContain('Introduction');
    expect(outline).toContain('Background');
    expect(outline).toContain('Methods');
  });

  test('extracts numbered headings (1.1 Style)', () => {
    const text = '1.1 Overview\n\nText here.\n\n2.1 Results\n\nMore text.\n';
    const outline = extractDocumentOutline(text, 500);
    expect(outline).toContain('Overview');
    expect(outline).toContain('Results');
  });

  test('extracts ALL CAPS headings', () => {
    const text = 'EXECUTIVE SUMMARY\n\nSome text.\n\nCONCLUSION\n\nFinal thoughts.\n';
    const outline = extractDocumentOutline(text, 500);
    expect(outline).toContain('EXECUTIVE SUMMARY');
    expect(outline).toContain('CONCLUSION');
  });

  test('extracts HTML headings', () => {
    const text = '<h1>Title</h1>\n<p>Text</p>\n<h2>Subtitle</h2>\n<p>More text</p>';
    const outline = extractDocumentOutline(text, 500);
    expect(outline).toContain('Title');
    expect(outline).toContain('Subtitle');
  });

  test('deduplicates headings (case-insensitive)', () => {
    const text = '# Introduction\n\n# INTRODUCTION\n\n# introduction\n';
    const outline = extractDocumentOutline(text, 500);
    const matches = outline.match(/introduction/gi);
    expect(matches).not.toBeNull();
    expect(matches.length).toBe(1);
  });

  test('respects maxLength budget', () => {
    const text =
      '# Very Long Heading One\n# Very Long Heading Two\n' +
      '# Very Long Heading Three\n# Very Long Heading Four\n';
    const outline = extractDocumentOutline(text, 40);
    expect(outline.length).toBeLessThanOrEqual(40);
  });

  test('returns empty string when no headings are found', () => {
    const text = 'Just some plain text without any headings or structure whatsoever.';
    const outline = extractDocumentOutline(text, 500);
    expect(outline).toBe('');
  });

  test('returns empty string for empty or null text', () => {
    expect(extractDocumentOutline('', 500)).toBe('');
    expect(extractDocumentOutline(null, 500)).toBe('');
    expect(extractDocumentOutline(undefined, 500)).toBe('');
  });

  test('returns empty string for zero budget', () => {
    expect(extractDocumentOutline('# Heading', 0)).toBe('');
  });

  test('caps extracted headings at 25', () => {
    const lines = Array.from({ length: 50 }, (_, i) => `# Heading ${i}`);
    const text = lines.join('\n');
    const outline = extractDocumentOutline(text, 10000);
    const count = (outline.match(/^- /gm) || []).length;
    expect(count).toBeLessThanOrEqual(25);
  });
});

// ---------------------------------------------------------------------------
// sampleMiddleContent
// ---------------------------------------------------------------------------

describe('sampleMiddleContent', () => {
  // Build a predictable text with paragraph boundaries
  const paragraphs = Array.from({ length: 10 }, (_, i) => `Paragraph ${i}: ${'w'.repeat(400)}`);
  const longText = paragraphs.join('\n\n');

  test('returns evenly-spaced samples', () => {
    const samples = sampleMiddleContent(longText, 500, 4000, 2000, 2);
    expect(samples.length).toBe(2);
    samples.forEach((s) => expect(s.length).toBeGreaterThan(0));
  });

  test('returns entire region when it fits in budget', () => {
    const samples = sampleMiddleContent(longText, 1000, 2000, 5000, 4);
    // Should return one chunk containing the whole region
    expect(samples.length).toBe(1);
    expect(samples[0].length).toBe(1000);
  });

  test('returns empty array for zero-length region', () => {
    expect(sampleMiddleContent(longText, 500, 500, 1000, 4)).toEqual([]);
  });

  test('returns empty array for negative region', () => {
    expect(sampleMiddleContent(longText, 600, 500, 1000, 4)).toEqual([]);
  });

  test('returns empty array for zero budget', () => {
    expect(sampleMiddleContent(longText, 0, 4000, 0, 4)).toEqual([]);
  });

  test('returns empty array for zero sample count', () => {
    expect(sampleMiddleContent(longText, 0, 4000, 2000, 0)).toEqual([]);
  });

  test('returns empty array when budget per sample is too small', () => {
    // 100 chars / 4 samples = 25 chars each, below 50 minimum
    expect(sampleMiddleContent(longText, 0, longText.length, 100, 4)).toEqual([]);
  });

  test('defaults sampleCount from CONTENT_SELECTION constant', () => {
    // Omit sampleCount — should fall back to MIDDLE_SAMPLE_COUNT (4)
    const samples = sampleMiddleContent(longText, 200, 4000, 3000);
    expect(samples.length).toBeGreaterThanOrEqual(1);
    expect(samples.length).toBeLessThanOrEqual(4);
  });
});

// ---------------------------------------------------------------------------
// selectRepresentativeContent
// ---------------------------------------------------------------------------

describe('selectRepresentativeContent', () => {
  test('returns full text when under budget', () => {
    const result = selectRepresentativeContent('Hello world', 1000);
    expect(result.content).toBe('Hello world');
    expect(result.strategy).toBe('full');
    expect(result.coveragePercent).toBe(100);
    expect(result.totalLength).toBe(11);
  });

  test('handles empty text', () => {
    const result = selectRepresentativeContent('', 1000);
    expect(result.content).toBe('');
    expect(result.strategy).toBe('empty');
    expect(result.coveragePercent).toBe(0);
    expect(result.totalLength).toBe(0);
  });

  test('handles null text', () => {
    const result = selectRepresentativeContent(null, 1000);
    expect(result.content).toBe('');
    expect(result.strategy).toBe('empty');
  });

  test('handles undefined text', () => {
    const result = selectRepresentativeContent(undefined, 1000);
    expect(result.content).toBe('');
    expect(result.strategy).toBe('empty');
  });

  test('applies representative strategy for large text', () => {
    const sections = Array.from({ length: 100 }, (_, i) => `Section ${i}: ${'x'.repeat(950)}`);
    const largeText = sections.join('\n\n');
    const budget = 5000;

    const result = selectRepresentativeContent(largeText, budget);

    expect(result.strategy).toBe('representative');
    expect(result.content.length).toBeLessThanOrEqual(budget);
    expect(result.totalLength).toBeGreaterThan(budget);
    expect(result.coveragePercent).toBeGreaterThan(0);
    expect(result.coveragePercent).toBeLessThan(100);
  });

  test('includes content from beginning and end', () => {
    const beginning = 'UNIQUE_START_MARKER here';
    const ending = 'UNIQUE_END_MARKER here';
    const padding = 'filler '.repeat(1500);
    const largeText = `${beginning}\n\n${padding}\n\n${padding}\n\n${padding}\n\n${ending}`;

    const result = selectRepresentativeContent(largeText, 3000);

    expect(result.strategy).toBe('representative');
    expect(result.content).toContain('UNIQUE_START_MARKER');
    expect(result.content).toContain('UNIQUE_END_MARKER');
  });

  test('includes section markers for representative selection', () => {
    const largeText = 'x'.repeat(50000);
    const result = selectRepresentativeContent(largeText, 5000);

    expect(result.content).toContain('[BEGINNING]');
    expect(result.content).toContain('[END]');
  });

  test('includes [MIDDLE SECTIONS] marker when samples are taken', () => {
    const largeText = 'x'.repeat(50000);
    const result = selectRepresentativeContent(largeText, 5000);

    expect(result.content).toContain('[MIDDLE SECTIONS]');
  });

  test('respects budget limit strictly', () => {
    const largeText = '# Heading\n\n' + 'x'.repeat(100000);
    const budget = 2000;
    const result = selectRepresentativeContent(largeText, budget);

    expect(result.content.length).toBeLessThanOrEqual(budget);
  });

  test('cleans null bytes and normalizes whitespace', () => {
    const dirtyText = 'Hello\u0000World\t\twith\r\ntabs   and   spaces';
    const result = selectRepresentativeContent(dirtyText, 1000);

    expect(result.content).not.toContain('\u0000');
    expect(result.content).not.toContain('\t');
    expect(result.content).not.toContain('\r');
  });

  test('includes document outline when headings exist in large text', () => {
    const textWithHeadings =
      '# Introduction\n\n' +
      'x'.repeat(20000) +
      '\n\n# Methodology\n\n' +
      'x'.repeat(20000) +
      '\n\n# Results\n\n' +
      'x'.repeat(20000);

    const result = selectRepresentativeContent(textWithHeadings, 5000);

    expect(result.content).toContain('[DOCUMENT OUTLINE]');
    expect(result.content).toContain('Introduction');
  });

  test('preserves paragraph boundaries (double newlines)', () => {
    const text = 'First paragraph.\n\nSecond paragraph.\n\nThird paragraph.';
    const result = selectRepresentativeContent(text, 1000);

    // Full strategy — text should keep paragraph breaks
    expect(result.content).toContain('\n\n');
    expect(result.strategy).toBe('full');
  });

  test('text exactly at budget returns full strategy', () => {
    const text = 'a'.repeat(500);
    const result = selectRepresentativeContent(text, 500);

    expect(result.strategy).toBe('full');
    expect(result.content.length).toBe(500);
  });

  test('coveragePercent is accurate', () => {
    const totalChars = 100000;
    const budget = 10000;
    const largeText = 'x'.repeat(totalChars);

    const result = selectRepresentativeContent(largeText, budget);

    // Coverage should be approximately budget/total = 10%
    expect(result.coveragePercent).toBe(10);
  });
});
