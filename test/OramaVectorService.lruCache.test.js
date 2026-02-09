/**
 * Tests for OramaVectorService query cache true-LRU fix.
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

const { OramaVectorService } = require('../src/main/services/OramaVectorService');

describe('OramaVectorService – query cache LRU', () => {
  let service;

  beforeEach(() => {
    service = new OramaVectorService({ dataPath: '/mock/orama-test' });
    service._queryCacheMaxSize = 3;
    service._queryCacheTtlMs = 60000;
  });

  test('cache hit promotes entry to end of eviction order', () => {
    // Fill cache: A, B, C (A is oldest in insertion order)
    service._setCachedQuery('A', { data: 'a' });
    service._setCachedQuery('B', { data: 'b' });
    service._setCachedQuery('C', { data: 'c' });

    // Access A – should promote it to the end
    const hitA = service._getCachedQuery('A');
    expect(hitA).toEqual({ data: 'a' });

    // Insert D – should evict B (now the oldest), not A
    service._setCachedQuery('D', { data: 'd' });

    expect(service._getCachedQuery('B')).toBeNull(); // evicted
    expect(service._getCachedQuery('A')).toEqual({ data: 'a' }); // still present
    expect(service._getCachedQuery('C')).not.toBeNull();
    expect(service._getCachedQuery('D')).toEqual({ data: 'd' });
  });

  test('expired entries are evicted on access', () => {
    service._setCachedQuery('old', { data: 'stale' });

    // Manually backdate the timestamp to simulate expiry
    const entry = service._queryCache.get('old');
    entry.timestamp = Date.now() - service._queryCacheTtlMs - 1;

    expect(service._getCachedQuery('old')).toBeNull();
    expect(service._queryCache.has('old')).toBe(false);
  });

  test('FIFO eviction when no hits have occurred', () => {
    service._setCachedQuery('X', { data: 'x' });
    service._setCachedQuery('Y', { data: 'y' });
    service._setCachedQuery('Z', { data: 'z' });

    // No accesses – X is oldest
    service._setCachedQuery('W', { data: 'w' });

    expect(service._getCachedQuery('X')).toBeNull(); // evicted (oldest)
    expect(service._getCachedQuery('Y')).not.toBeNull();
  });

  test('clearQueryCache empties everything', () => {
    service._setCachedQuery('K', { data: 'k' });
    service.clearQueryCache();
    expect(service._queryCache.size).toBe(0);
  });
});
