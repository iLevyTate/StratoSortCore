const {
  deriveWatcherConfidencePercent,
  DEFAULT_CONFIDENCE_PERCENT
} = require('../src/main/services/confidence/watcherConfidence');

describe('deriveWatcherConfidencePercent', () => {
  test('normalizes decimal confidence to percent', () => {
    expect(deriveWatcherConfidencePercent({ confidence: 0.82 })).toBe(82);
  });

  test('keeps percent confidence unchanged within bounds', () => {
    expect(deriveWatcherConfidencePercent({ confidence: 91 })).toBe(91);
  });

  test('clamps values above 100 down to 100', () => {
    expect(deriveWatcherConfidencePercent({ confidence: 150 })).toBe(100);
  });

  test('falls back conservatively when confidence is missing', () => {
    expect(deriveWatcherConfidencePercent({})).toBe(35);
    expect(deriveWatcherConfidencePercent({})).toBeLessThan(DEFAULT_CONFIDENCE_PERCENT);
  });

  test('keeps derived fallback conservative even when useful fields exist', () => {
    const percent = deriveWatcherConfidencePercent({
      category: 'Finance',
      keywords: ['invoice', '2024', 'customer'],
      suggestedName: 'invoice-2024.pdf'
    });
    expect(percent).toBe(50);
    expect(percent).toBeLessThan(DEFAULT_CONFIDENCE_PERCENT);
  });

  test('maps similarity 0..1 into a conservative 30..70 range', () => {
    expect(deriveWatcherConfidencePercent({ similarity: 0 })).toBe(30);
    expect(deriveWatcherConfidencePercent({ similarity: 0.9 })).toBe(66);
    expect(deriveWatcherConfidencePercent({ similarity: 1 })).toBe(70);
  });

  test('caps percent-like score/similarity at 70 when explicit confidence is missing', () => {
    expect(deriveWatcherConfidencePercent({ score: 90 })).toBe(70);
    expect(deriveWatcherConfidencePercent({ similarity: 99 })).toBe(70);
  });
});
