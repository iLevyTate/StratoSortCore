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

  test('falls back to default when confidence is missing', () => {
    expect(deriveWatcherConfidencePercent({})).toBe(DEFAULT_CONFIDENCE_PERCENT);
  });

  test('boosts fallback when useful fields exist', () => {
    const percent = deriveWatcherConfidencePercent({
      category: 'Finance',
      keywords: ['invoice', '2024', 'customer'],
      suggestedName: 'invoice-2024.pdf'
    });
    expect(percent).toBeGreaterThan(DEFAULT_CONFIDENCE_PERCENT);
    expect(percent).toBe(85);
  });
});
