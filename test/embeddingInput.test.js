jest.mock('../src/shared/performanceConstants', () => ({
  LLAMA: {
    CONTEXT_EMBEDDINGS: 1000
  }
}));

const {
  capEmbeddingInput,
  estimateTokens,
  getEmbeddingTokenLimit,
  truncateToTokenLimit
} = require('../src/main/utils/embeddingInput');

describe('embeddingInput', () => {
  test('estimateTokens handles strings and non-strings', () => {
    // DEFAULT_CHARS_PER_TOKEN is 3.5, so Math.ceil(4 / 3.5) = 2
    expect(estimateTokens('abcd')).toBe(2);
    // Math.ceil(8 / 3.5) = 3
    expect(estimateTokens('abcdefgh')).toBe(3);
    // String(1234) = '1234', length 4, Math.ceil(4 / 3.5) = 2
    expect(estimateTokens(1234)).toBe(2);
  });

  test('getEmbeddingTokenLimit uses explicit limit with headroom and min', () => {
    // DEFAULT_HEADROOM_RATIO is 0.85, so Math.floor(100 * 0.85) = 85
    expect(getEmbeddingTokenLimit(100)).toBe(85);
    // Math.floor(10 * 0.85) = 8, but min is 32
    expect(getEmbeddingTokenLimit(10)).toBe(32);
  });

  test('getEmbeddingTokenLimit falls back to LLAMA context', () => {
    // LLAMA.CONTEXT_EMBEDDINGS = 1000, Math.floor(1000 * 0.85) = 850
    expect(getEmbeddingTokenLimit()).toBe(850);
  });

  test('truncateToTokenLimit caps text and reports truncation', () => {
    const result = truncateToTokenLimit('abcdefghij', 2, 2);
    expect(result.text).toBe('abcd');
    expect(result.wasTruncated).toBe(true);
    expect(result.maxChars).toBe(4);
  });

  test('capEmbeddingInput returns metadata and respects limits', () => {
    const longText = 'a'.repeat(100);
    const result = capEmbeddingInput(longText, { maxTokens: 2, charsPerToken: 2 });
    expect(result.text).toHaveLength(64);
    expect(result.wasTruncated).toBe(true);
    expect(result.estimatedTokens).toBe(50);
    expect(result.maxTokens).toBe(32);
  });
});
