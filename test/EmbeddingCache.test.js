const EmbeddingCache = require('../src/main/services/EmbeddingCache');

describe('EmbeddingCache', () => {
  test('set/get returns cached vectors', () => {
    const cache = new EmbeddingCache({ maxSize: 10, ttlMs: 5000 });
    cache.set('hello', 'mxbai-embed-large', [0.1, 0.2]);

    const result = cache.get('hello', 'mxbai-embed-large');
    expect(result.vector).toEqual([0.1, 0.2]);
    cache.shutdown();
  });

  test('ttl expiration invalidates entries', () => {
    const cache = new EmbeddingCache({ maxSize: 10, ttlMs: 1 });
    cache.set('hello', 'mxbai-embed-large', [0.1, 0.2]);
    jest.useFakeTimers();
    jest.advanceTimersByTime(5);

    const result = cache.get('hello', 'mxbai-embed-large');
    expect(result).toBeNull();
    cache.shutdown();
    jest.useRealTimers();
  });

  test('stats track hits and misses', () => {
    const cache = new EmbeddingCache({ maxSize: 10, ttlMs: 5000 });
    cache.set('hello', 'mxbai-embed-large', [0.1, 0.2]);
    cache.get('hello', 'mxbai-embed-large');
    cache.get('missing', 'mxbai-embed-large');
    const stats = cache.getStats();
    expect(stats.hits).toBe(1);
    expect(stats.misses).toBe(1);
    cache.shutdown();
  });
});
