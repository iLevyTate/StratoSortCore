/**
 * Focused tests for EmbeddingQueueCore.flush/offline/retry paths
 */

jest.mock('electron', () => ({
  app: { getPath: jest.fn().mockReturnValue('/tmp/test') }
}));

jest.mock('../src/shared/logger', () => ({
  logger: {
    setContext: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  }
}));

const mockResolve = jest.fn();
jest.mock('../src/main/services/ServiceContainer', () => ({
  container: { resolve: (...args) => mockResolve(...args) },
  ServiceIds: { CHROMA_DB: 'CHROMA_DB' }
}));

jest.mock('../src/shared/config/index', () => ({
  get: jest.fn((_k, d) => d)
}));

jest.mock('../src/shared/performanceConstants', () => ({
  BATCH: { EMBEDDING_FLUSH_DELAY_MS: 10 },
  LIMITS: { MAX_QUEUE_SIZE: 1000, MAX_DEAD_LETTER_SIZE: 100 },
  THRESHOLDS: { QUEUE_HIGH_WATERMARK: 0.8, QUEUE_CRITICAL_WATERMARK: 0.95 },
  RETRY: { BACKOFF_BASE_MS: 10, BACKOFF_MAX_MS: 50 },
  CONCURRENCY: { EMBEDDING_FLUSH: 2 },
  TIMEOUTS: { SERVICE_STARTUP: 5000 }
}));

const mockPersistQueueData = jest.fn().mockResolvedValue(undefined);
const mockLoadPersistedData = jest.fn().mockResolvedValue(undefined);
jest.mock('../src/main/analysis/embeddingQueue/persistence', () => ({
  loadPersistedData: (...args) => mockLoadPersistedData(...args),
  persistQueueData: (...args) => mockPersistQueueData(...args)
}));

const mockProcessItemsInParallel = jest.fn();
jest.mock('../src/main/analysis/embeddingQueue/parallelProcessor', () => ({
  processItemsInParallel: (...args) => mockProcessItemsInParallel(...args)
}));

const mockProgressNotify = jest.fn();
jest.mock('../src/main/analysis/embeddingQueue/progress', () => ({
  createProgressTracker: () => ({
    onProgress: jest.fn(() => () => {}),
    notify: (...args) => mockProgressNotify(...args),
    clear: jest.fn()
  })
}));

const mockTrackFailedItem = jest.fn();
const mockRetryFailedItems = jest.fn().mockResolvedValue(undefined);
jest.mock('../src/main/analysis/embeddingQueue/failedItemHandler', () => ({
  createFailedItemHandler: () => ({
    failedItems: new Map(),
    trackFailedItem: (...args) => mockTrackFailedItem(...args),
    retryFailedItems: (...args) => mockRetryFailedItems(...args),
    setDeadLetterQueue: jest.fn()
  })
}));

describe('EmbeddingQueueCore flush paths', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockProcessItemsInParallel.mockReset();
    mockResolve.mockReset();
  });

  test('flush processes file + folder items and persists queue', async () => {
    const chromaDb = { initialize: jest.fn().mockResolvedValue(undefined), isOnline: true };
    mockResolve.mockReturnValue(chromaDb);
    mockProcessItemsInParallel.mockImplementation(async ({ items }) => items.length);

    const EmbeddingQueue = require('../src/main/analysis/embeddingQueue/EmbeddingQueueCore');
    const q = new EmbeddingQueue();
    q.initialized = true;

    q.queue = [
      { id: 'file:/a', vector: [1] },
      { id: 'folder:1', vector: [2] }
    ];

    await q.flush();

    expect(chromaDb.initialize).toHaveBeenCalled();
    expect(mockProcessItemsInParallel).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'file' })
    );
    expect(mockProcessItemsInParallel).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'folder' })
    );
    expect(q.queue).toHaveLength(0);
    expect(mockPersistQueueData).toHaveBeenCalled();
    expect(mockRetryFailedItems).toHaveBeenCalled();
    expect(mockProgressNotify).toHaveBeenCalledWith(expect.objectContaining({ phase: 'start' }));
    expect(mockProgressNotify).toHaveBeenCalledWith(expect.objectContaining({ phase: 'complete' }));
  });

  test('flush handles offline database by moving items to failed queue after max retries', async () => {
    const chromaDb = { initialize: jest.fn().mockResolvedValue(undefined), isOnline: false };
    mockResolve.mockReturnValue(chromaDb);

    const EmbeddingQueue = require('../src/main/analysis/embeddingQueue/EmbeddingQueueCore');
    const q = new EmbeddingQueue();
    q.initialized = true;
    q.MAX_RETRY_COUNT = 1; // fail fast
    q.queue = [{ id: 'file:/a', vector: [1] }];

    await q.flush();

    expect(mockTrackFailedItem).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'file:/a' }),
      'Database offline'
    );
    expect(q.queue).toHaveLength(0);
    expect(mockPersistQueueData).toHaveBeenCalled();
  });

  test('flush schedules retry on processing error', async () => {
    jest.useFakeTimers();
    const chromaDb = { initialize: jest.fn().mockResolvedValue(undefined), isOnline: true };
    mockResolve.mockReturnValue(chromaDb);
    mockProcessItemsInParallel.mockRejectedValueOnce(new Error('boom'));

    const EmbeddingQueue = require('../src/main/analysis/embeddingQueue/EmbeddingQueueCore');
    const q = new EmbeddingQueue();
    q.initialized = true;
    q.queue = [{ id: 'file:/a', vector: [1] }];

    const p = q.flush();
    // Allow promise chain to run and schedule backoff timer
    await Promise.resolve();
    await Promise.resolve();

    // Backoff base is 10ms in our mock
    await jest.advanceTimersByTimeAsync(12);
    await p;

    // After backoff, scheduleFlush should have been called (via timer -> scheduleFlush)
    expect(q.flushTimer).not.toBeNull();

    jest.useRealTimers();
  });
});
