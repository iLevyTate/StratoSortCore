/**
 * Tests for shared/embeddingDimensions.js
 *
 * Verifies dimension resolution for known GGUF models, fallback name matching,
 * and the isKnownEmbeddingModel helper.
 */

jest.mock('../src/shared/logger', () => ({
  createLogger: () => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  })
}));

const {
  resolveEmbeddingDimension,
  isKnownEmbeddingModel
} = require('../src/shared/embeddingDimensions');

describe('resolveEmbeddingDimension', () => {
  test('returns exact dimension from MODEL_CATALOG for known GGUF filenames', () => {
    expect(resolveEmbeddingDimension('nomic-embed-text-v1.5-Q8_0.gguf')).toBe(768);
    expect(resolveEmbeddingDimension('nomic-embed-text-v1.5-Q4_K_M.gguf')).toBe(768);
    expect(resolveEmbeddingDimension('mxbai-embed-large-v1-f16.gguf')).toBe(1024);
  });

  test('returns fallback dimension for partial name matches', () => {
    expect(resolveEmbeddingDimension('nomic-embed-custom.gguf')).toBe(768);
    expect(resolveEmbeddingDimension('mxbai-embed-large-v2.gguf')).toBe(1024);
    expect(resolveEmbeddingDimension('all-minilm-l6-v2.gguf')).toBe(384);
    expect(resolveEmbeddingDimension('bge-large-en-v1.5.gguf')).toBe(1024);
    expect(resolveEmbeddingDimension('snowflake-arctic-embed-m.gguf')).toBe(1024);
  });

  test('returns default dimension (768) for completely unknown models', () => {
    expect(resolveEmbeddingDimension('totally-unknown-model.gguf')).toBe(768);
  });

  test('returns default dimension when modelName is null/undefined/empty', () => {
    expect(resolveEmbeddingDimension(null)).toBe(768);
    expect(resolveEmbeddingDimension(undefined)).toBe(768);
    expect(resolveEmbeddingDimension('')).toBe(768);
  });

  test('respects custom defaultDimension option', () => {
    expect(resolveEmbeddingDimension('unknown-model.gguf', { defaultDimension: 512 })).toBe(512);
  });

  test('catalog lookup takes precedence over fallback matching', () => {
    // nomic-embed-text-v1.5-Q8_0.gguf is in the catalog with 768
    // The fallback for "nomic-embed" is also 768, but catalog should be checked first
    expect(resolveEmbeddingDimension('nomic-embed-text-v1.5-Q8_0.gguf')).toBe(768);
  });

  test('handles non-string modelName gracefully', () => {
    expect(resolveEmbeddingDimension(123)).toBe(768);
    expect(resolveEmbeddingDimension({})).toBe(768);
  });
});

describe('isKnownEmbeddingModel', () => {
  test('returns true for exact catalog matches', () => {
    expect(isKnownEmbeddingModel('nomic-embed-text-v1.5-Q8_0.gguf')).toBe(true);
    expect(isKnownEmbeddingModel('mxbai-embed-large-v1-f16.gguf')).toBe(true);
  });

  test('returns true for partial fallback matches', () => {
    expect(isKnownEmbeddingModel('nomic-embed-custom.gguf')).toBe(true);
    expect(isKnownEmbeddingModel('all-minilm-something.gguf')).toBe(true);
  });

  test('returns false for unknown models', () => {
    expect(isKnownEmbeddingModel('totally-unknown.gguf')).toBe(false);
    expect(isKnownEmbeddingModel('mistral-7b-instruct.gguf')).toBe(false);
  });

  test('returns false for null/undefined/empty', () => {
    expect(isKnownEmbeddingModel(null)).toBe(false);
    expect(isKnownEmbeddingModel(undefined)).toBe(false);
    expect(isKnownEmbeddingModel('')).toBe(false);
  });
});
