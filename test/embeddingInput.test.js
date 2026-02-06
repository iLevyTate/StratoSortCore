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
    expect(estimateTokens('abcd')).toBe(1);
    expect(estimateTokens('abcdefgh')).toBe(2);
    expect(estimateTokens(1234)).toBe(1);
  });

  test('getEmbeddingTokenLimit uses explicit limit with headroom and min', () => {
    expect(getEmbeddingTokenLimit(100)).toBe(90);
    expect(getEmbeddingTokenLimit(10)).toBe(32);
  });

  test('getEmbeddingTokenLimit falls back to LLAMA context', () => {
    expect(getEmbeddingTokenLimit()).toBe(900);
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
