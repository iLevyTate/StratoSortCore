jest.mock('../src/shared/performanceConstants', () => ({
  CHUNKING: {
    CHUNK_SIZE: 1000,
    OVERLAP: 200,
    MAX_CHUNKS: 3
  }
}));

const {
  getMaxChunkableTextLength,
  normalizeExtractedTextForStorage
} = require('../src/main/analysis/analysisTextUtils');

describe('analysisTextUtils', () => {
  test('getMaxChunkableTextLength uses chunking config', () => {
    const maxLen = getMaxChunkableTextLength();
    expect(maxLen).toBe(1000 + (1000 - 200) * 2);
  });

  test('normalizeExtractedTextForStorage trims and truncates', () => {
    const input = ' \u0000hello world ';
    const result = normalizeExtractedTextForStorage(input);
    expect(result).toBe('hello world');
  });
});
