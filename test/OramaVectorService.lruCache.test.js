/**
 * Tests for OramaVectorService query cache (backed by shared LRUCache).
 * Verifies that cache hits promote entries (true LRU),
 * so frequently-accessed items survive eviction.
 */

jest.mock('electron', () => ({
  app: { getPath: jest.fn(() => '/mock') }
}));

jest.mock('../src/shared/logger', () => ({
  createLogger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
  })
}));

jest.mock('../src/shared/singletonFactory', () => ({
  createSingletonHelpers: () => ({
    getInstance: jest.fn(),
    createInstance: jest.fn(),
    registerWithContainer: jest.fn(),
    resetInstance: jest.fn()
  })
}));

jest.mock('@orama/plugin-data-persistence', () => ({
  persist: jest.fn(async () => '{}'),
  restore: jest.fn(async () => {
    throw new Error('no-op');
  })
}));

jest.mock('../src/main/llamaUtils', () => ({
  getEmbeddingModel: jest.fn(() => 'test-model.gguf'),
  loadLlamaConfig: jest.fn().mockResolvedValue({ selectedEmbeddingModel: 'test-model.gguf' })
}));

const { LRUCache } = require('../src/shared/LRUCache');
const { OramaVectorService } = require('../src/main/services/OramaVectorService');

describe('OramaVectorService – query cache LRU', () => {
  let service;

  beforeEach(() => {
    service = new OramaVectorService({ dataPath: '/mock/orama-test' });
    // Replace the default cache with a small one for testing eviction
    service._queryCache = new LRUCache({
      maxSize: 3,
      ttlMs: 60000,
      lruStrategy: 'access',
      name: 'OramaQueryCache-test'
    });
  });

  test('cache hit promotes entry to end of eviction order', () => {
    const cache = service._queryCache;

    // Fill cache: A, B, C (A is oldest in insertion order)
    cache.set('A', { data: 'a' });
    cache.set('B', { data: 'b' });
    cache.set('C', { data: 'c' });

    // Access A – should promote it to the end
    const hitA = cache.get('A');
    expect(hitA).toEqual({ data: 'a' });

    // Insert D – should evict B (now the oldest), not A
    cache.set('D', { data: 'd' });

    expect(cache.get('B')).toBeNull(); // evicted
    expect(cache.get('A')).toEqual({ data: 'a' }); // still present
    expect(cache.get('C')).not.toBeNull();
    expect(cache.get('D')).toEqual({ data: 'd' });
  });

  test('expired entries are evicted on access', () => {
    const cache = service._queryCache;
    cache.set('old', { data: 'stale' });

    // Manually backdate the timestamp to simulate expiry
    const entry = cache.cache.get('old');
    entry.timestamp = Date.now() - cache.ttlMs - 1;

    expect(cache.get('old')).toBeNull();
    expect(cache.has('old')).toBe(false);
  });

  test('FIFO eviction when no hits have occurred', () => {
    const cache = service._queryCache;
    cache.set('X', { data: 'x' });
    cache.set('Y', { data: 'y' });
    cache.set('Z', { data: 'z' });

    // No accesses – X is oldest
    cache.set('W', { data: 'w' });

    expect(cache.get('X')).toBeNull(); // evicted (oldest)
    expect(cache.get('Y')).not.toBeNull();
  });

  test('clearQueryCache empties everything', () => {
    service._queryCache.set('K', { data: 'k' });
    service.clearQueryCache();
    expect(service._queryCache.size).toBe(0);
  });
});
