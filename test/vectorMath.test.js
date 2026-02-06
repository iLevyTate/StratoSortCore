jest.mock('../src/shared/logger', () => ({
  createLogger: () => ({
    warn: jest.fn(),
    info: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
  })
}));

const {
  cosineSimilarity,
  squaredEuclideanDistance,
  validateEmbeddingDimensions,
  validateEmbeddingVector,
  padOrTruncateVector
} = require('../src/shared/vectorMath');

describe('vectorMath', () => {
  test('cosineSimilarity returns 1 for identical vectors', () => {
    expect(cosineSimilarity([1, 2], [1, 2])).toBeCloseTo(1);
  });

  test('cosineSimilarity returns 0 for invalid vectors', () => {
    expect(cosineSimilarity([1, 2], [1])).toBe(0);
  });

  test('squaredEuclideanDistance computes distance', () => {
    expect(squaredEuclideanDistance([1, 2], [4, 6])).toBe(25);
  });

  test('validateEmbeddingDimensions handles expectedDim', () => {
    expect(validateEmbeddingDimensions([1, 2], 2)).toBe(true);
    expect(validateEmbeddingDimensions([1, 2], 3)).toBe(false);
    expect(validateEmbeddingDimensions([1, 2], null)).toBe(true);
  });

  test('validateEmbeddingVector rejects invalid values', () => {
    expect(validateEmbeddingVector([1, Infinity]).valid).toBe(false);
    expect(validateEmbeddingVector([0.1]).valid).toBe(true);
  });

  test('padOrTruncateVector adjusts dimensions', () => {
    expect(padOrTruncateVector([1, 2], 3)).toEqual([1, 2, 0]);
    expect(padOrTruncateVector([1, 2, 3], 2)).toEqual([1, 2]);
  });
});
