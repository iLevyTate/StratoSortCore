jest.mock('../src/main/utils/embeddingInput', () => ({
  capEmbeddingInput: jest.fn((text) => text)
}));

jest.mock('../src/main/analysis/semanticExtensionMap', () => ({
  enrichFileTextForEmbedding: jest.fn((text, ext) => `${text}::${ext}`)
}));

const { buildEmbeddingSummary } = require('../src/main/analysis/embeddingSummary');

describe('embeddingSummary', () => {
  test('buildEmbeddingSummary combines analysis and extracted text', () => {
    const analysis = {
      summary: 'Summary',
      keywords: ['a', 'b'],
      keyEntities: ['x']
    };
    const result = buildEmbeddingSummary(analysis, 'Extracted text', '.pdf', 'document');
    expect(result).toContain('Summary');
    expect(result).toContain('a b');
    expect(result).toContain('Extracted text');
  });
});
