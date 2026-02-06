const {
  analysisResultSchema,
  embeddingMetaSchema,
  chunkMetaSchema,
  validateSchema
} = require('../src/shared/normalization/schemas');

describe('normalization/schemas', () => {
  test('validateSchema returns valid for null schema', () => {
    const result = validateSchema(null, { a: 1 });
    expect(result.valid).toBe(true);
  });

  test('analysisResultSchema accepts optional fields', () => {
    const result = validateSchema(analysisResultSchema, { category: 'docs', confidence: 0.5 });
    expect(result.valid).toBe(true);
  });

  test('embeddingMetaSchema allows extra keys', () => {
    const result = validateSchema(embeddingMetaSchema, { path: 'x', extra: 'y' });
    expect(result.valid).toBe(true);
  });

  test('chunkMetaSchema validates fileId', () => {
    const result = validateSchema(chunkMetaSchema, { fileId: 'file-1', chunkIndex: 1 });
    expect(result.valid).toBe(true);
  });
});
