const EmbeddingQueue = require('../../src/main/analysis/embeddingQueue/EmbeddingQueueCore');
const { createLogger } = require('../../src/shared/logger');
const { container, ServiceIds } = require('../../src/main/services/ServiceContainer');

// Mock dependencies
jest.mock('electron', () => ({
  app: {
    getPath: jest.fn().mockReturnValue('/tmp/userData')
  }
}));

jest.mock('../../src/shared/logger', () => ({
  createLogger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
  })
}));

jest.mock('../../src/main/services/ServiceContainer', () => ({
  container: {
    resolve: jest.fn(),
    tryResolve: jest.fn()
  },
  ServiceIds: {
    ORAMA_VECTOR: 'ORAMA_VECTOR'
  }
}));

jest.mock('../../src/main/analysis/embeddingQueue/persistence', () => ({
  loadPersistedData: jest.fn(),
  persistQueueData: jest.fn().mockResolvedValue(true),
  persistFailedItems: jest.fn().mockResolvedValue(true),
  persistDeadLetterQueue: jest.fn().mockResolvedValue(true)
}));

describe('EmbeddingQueueCore Fixes', () => {
  let queue;
  let mockVectorDb;

  beforeEach(() => {
    jest.clearAllMocks();
    mockVectorDb = {
      initialize: jest.fn().mockResolvedValue(true),
      isOnline: true,
      batchUpsertFiles: jest.fn().mockResolvedValue({ success: true, count: 1 }),
      upsertFile: jest.fn().mockResolvedValue({ success: true }),
      batchUpsertFolders: jest.fn().mockResolvedValue({ success: true, count: 1 })
    };
    container.resolve.mockReturnValue(mockVectorDb);

    queue = new EmbeddingQueue({
      batchSize: 5,
      flushDelayMs: 50
    });
  });

  test('should validate vector format on enqueue', async () => {
    const invalidItem = {
      id: 'file:test.txt',
      vector: [] // Empty vector
    };

    const result = await queue.enqueue(invalidItem);

    expect(result.success).toBe(false);
    expect(result.reason).toBe('invalid_vector_format');
    expect(queue.queue.length).toBe(0);
  });

  test('should sanitize invalid vector values', async () => {
    const itemWithNaN = {
      id: 'file:nan.txt',
      vector: [0.1, NaN, 0.3]
    };

    const result = await queue.enqueue(itemWithNaN);

    expect(result.success).toBe(true);
    expect(result.warnings).toContain('vector_sanitized');
    expect(queue.queue[0].vector[1]).toBe(0); // NaN replaced with 0
  });

  test('should handle offline database gracefully', async () => {
    mockVectorDb.isOnline = false;

    await queue.enqueue({ id: 'file:1', vector: [0.1] });

    // Trigger flush manually
    await queue.flush();

    // Should still be in queue (or moved to failed/retry depending on implementation details)
    // The implementation moves to retry logic which keeps it in queue or failed items
    expect(queue.retryCount).toBeGreaterThan(0);
  });

  test('should respect flush lock', async () => {
    let resolveMutex;
    queue._flushMutex = new Promise((r) => (resolveMutex = r));
    queue.isFlushing = true;

    const flushPromise = queue.flush();

    // It should be pending
    const isPending = await Promise.race([
      flushPromise.then(() => false),
      new Promise((r) => setTimeout(() => r(true), 50))
    ]);
    expect(isPending).toBe(true);

    // Resolve mutex
    resolveMutex();
    // Logic in flush() will eventually proceed
    // We need to ensure mocks don't crash it.
    await expect(flushPromise).resolves.not.toThrow();
  });

  test('should remove items by file path', async () => {
    await queue.enqueue({
      id: 'file:/path/to/file.txt',
      vector: [0.1],
      meta: { path: '/path/to/file.txt' }
    });
    await queue.enqueue({
      id: 'file:/path/to/other.txt',
      vector: [0.2],
      meta: { path: '/path/to/other.txt' }
    });

    expect(queue.queue.length).toBe(2);

    const removed = queue.removeByFilePath('/path/to/file.txt');

    expect(removed).toBe(1);
    expect(queue.queue.length).toBe(1);
    expect(queue.queue[0].id).toBe('file:/path/to/other.txt');
  });
});
