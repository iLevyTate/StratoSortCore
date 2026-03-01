/**
 * Tests for EmbeddingQueueCore
 * Focus: mutex timeout safety, enqueue validation/backpressure, and offline DB handling.
 */

jest.mock('electron', () => ({
  app: {
    getPath: jest.fn(() => 'C:\\user-data')
  }
}));

jest.mock('../src/shared/logger', () => ({
  createLogger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
  })
}));

jest.mock('../src/shared/config/index', () => ({
  get: jest.fn((_key, fallback) => fallback)
}));

jest.mock('../src/shared/pathSanitization', () => ({
  normalizePathForIndex: (p) => String(p).replace(/\\/g, '/')
}));

jest.mock('../src/shared/pathTraceLogger', () => ({
  traceQueueUpdate: jest.fn()
}));

jest.mock('../src/shared/performanceConstants', () => ({
  BATCH: { EMBEDDING_FLUSH_DELAY_MS: 10 },
  LIMITS: { MAX_QUEUE_SIZE: 2, MAX_DEAD_LETTER_SIZE: 100 },
  THRESHOLDS: { QUEUE_HIGH_WATERMARK: 0.8, QUEUE_CRITICAL_WATERMARK: 0.9 },
  RETRY: { BACKOFF_BASE_MS: 10, BACKOFF_MAX_MS: 1000 },
  CONCURRENCY: { EMBEDDING_FLUSH: 2 },
  TIMEOUTS: { MUTEX_ACQUIRE: 50 }
}));

jest.mock('../src/shared/errorCodes', () => ({
  ERROR_CODES: { TIMEOUT: 'GEN_001' }
}));

jest.mock('../src/main/analysis/embeddingQueue/persistence', () => ({
  loadPersistedData: jest.fn().mockResolvedValue(undefined),
  persistQueueData: jest.fn().mockResolvedValue(undefined)
}));

const mockFailedHandler = {
  failedItems: new Map(),
  deadLetterQueue: [],
  trackFailedItem: jest.fn(),
  retryFailedItems: jest.fn().mockResolvedValue(undefined),
  setDeadLetterQueue: jest.fn()
};

jest.mock('../src/main/analysis/embeddingQueue/failedItemHandler', () => ({
  createFailedItemHandler: jest.fn(() => mockFailedHandler)
}));

const mockProgressTracker = {
  onProgress: jest.fn(() => () => {}),
  notify: jest.fn(),
  clear: jest.fn()
};

jest.mock('../src/main/analysis/embeddingQueue/progress', () => ({
  createProgressTracker: jest.fn(() => mockProgressTracker)
}));

jest.mock('../src/main/analysis/embeddingQueue/parallelProcessor', () => ({
  processItemsInParallel: jest.fn(async ({ items, startProcessedCount, onProgress }) => {
    const completed = startProcessedCount + items.length;
    onProgress({
      phase: 'processing',
      total: items.length,
      completed,
      percent: 100
    });
    return completed;
  })
}));

const mockContainer = {
  resolve: jest.fn()
};

jest.mock('../src/main/services/ServiceContainer', () => ({
  container: mockContainer,
  ServiceIds: { ORAMA_VECTOR: 'ORAMA_VECTOR' }
}));

describe('EmbeddingQueueCore', () => {
  const flushMicrotasks = async () => {
    await Promise.resolve();
    await Promise.resolve();
  };

  const advance = async (ms) => {
    if (typeof jest.advanceTimersByTimeAsync === 'function') {
      await jest.advanceTimersByTimeAsync(ms);
      return;
    }
    jest.advanceTimersByTime(ms);
    await flushMicrotasks();
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockFailedHandler.failedItems = new Map();
    mockFailedHandler.deadLetterQueue = [];
  });

  test('enqueue rejects when shutdown in progress', async () => {
    const EmbeddingQueue = require('../src/main/analysis/embeddingQueue/EmbeddingQueueCore');
    const q = new EmbeddingQueue({ flushDelayMs: 0 });
    q._isShuttingDown = true;

    await expect(q.enqueue({ id: 'file:a', vector: [1] })).resolves.toEqual({
      success: false,
      reason: 'shutting_down'
    });
  });

  test('enqueue sanitizes minor NaN corruption (<=5%) but rejects major corruption (>5%)', async () => {
    const EmbeddingQueue = require('../src/main/analysis/embeddingQueue/EmbeddingQueueCore');
    const q = new EmbeddingQueue({ flushDelayMs: 0 });
    q.initialized = true;

    // Minor corruption: 1 NaN in 384 dims (0.26%) — should be sanitized to 0
    const minorCorrupt = new Array(384).fill(1);
    minorCorrupt[100] = Number.NaN;
    const res = await q.enqueue({ id: 'file:minor', vector: minorCorrupt });
    expect(res).toEqual({ success: true, warnings: ['vector_sanitized'] });
    expect(q.queue[0].vector[100]).toBe(0);

    // Major corruption: 1 NaN in 3 dims (33%) — should be rejected
    const res2 = await q.enqueue({ id: 'file:major', vector: [1, Number.NaN, 2] });
    expect(res2.success).toBe(false);
    expect(res2.reason).toBe('invalid_vector_values');
  });

  test('enqueue applies backpressure when queue is full (diverts to failed queue)', async () => {
    jest.useFakeTimers();

    const EmbeddingQueue = require('../src/main/analysis/embeddingQueue/EmbeddingQueueCore');
    const { persistQueueData } = require('../src/main/analysis/embeddingQueue/persistence');

    const q = new EmbeddingQueue({ flushDelayMs: 0 });
    q.initialized = true;
    q.MAX_QUEUE_SIZE = 1;
    q.queue = [{ id: 'file:existing', vector: [1] }];

    const res = await q.enqueue({ id: 'file:overflow', vector: [1] });
    expect(res.success).toBe(false);
    expect(res.reason).toBe('queue_overflow');
    expect(mockFailedHandler.trackFailedItem).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'file:overflow' }),
      'queue_overflow'
    );
    expect(persistQueueData).toHaveBeenCalled();

    jest.useRealTimers();
  });

  test('_acquireFlushMutex times out but forces release so subsequent acquisitions succeed', async () => {
    jest.useFakeTimers();

    const EmbeddingQueue = require('../src/main/analysis/embeddingQueue/EmbeddingQueueCore');
    const q = new EmbeddingQueue();

    // make current mutex never resolve
    q._flushMutex = new Promise(() => {});

    const p1 = q._acquireFlushMutex(30);
    // Attach rejection handler immediately to avoid unhandled rejection warning
    const assertion = expect(p1).rejects.toEqual(expect.objectContaining({ code: 'GEN_001' }));
    await flushMicrotasks();
    await advance(40);

    await assertion;

    // second acquisition should succeed quickly (previous was forced released)
    await expect(q._acquireFlushMutex(30)).resolves.toEqual(expect.any(Function));

    jest.useRealTimers();
  });

  test('flush handles vector DB resolve error as offline and moves items to failed after max retries', async () => {
    jest.useFakeTimers();

    const EmbeddingQueue = require('../src/main/analysis/embeddingQueue/EmbeddingQueueCore');
    const { persistQueueData } = require('../src/main/analysis/embeddingQueue/persistence');

    mockContainer.resolve.mockImplementation(() => {
      throw new Error('no service');
    });

    const q = new EmbeddingQueue({ flushDelayMs: 0 });
    q.initialized = true;
    q.MAX_RETRY_COUNT = 1;
    q.queue = [{ id: 'file:a', vector: [1, 2, 3] }];

    await q.flush();

    expect(mockFailedHandler.trackFailedItem).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'file:a' }),
      'Database offline'
    );
    expect(q.queue).toHaveLength(0);
    expect(persistQueueData).toHaveBeenCalled();

    // progress should include offline then fatal_error
    const phases = mockProgressTracker.notify.mock.calls.map((c) => c[0]?.phase).filter(Boolean);
    expect(phases).toEqual(expect.arrayContaining(['offline', 'fatal_error']));

    jest.useRealTimers();
  });

  test('_handleOfflineDatabase removes only batch items when queue mutates', async () => {
    const EmbeddingQueue = require('../src/main/analysis/embeddingQueue/EmbeddingQueueCore');

    const q = new EmbeddingQueue({ flushDelayMs: 0 });
    q.initialized = true;
    q.MAX_RETRY_COUNT = 1;

    q.queue = [
      { id: 'file:C:\\a.pdf', vector: [1], meta: { path: 'C:\\a.pdf' } },
      { id: 'file:C:\\b.pdf', vector: [1], meta: { path: 'C:\\b.pdf' } },
      { id: 'file:C:\\c.pdf', vector: [1], meta: { path: 'C:\\c.pdf' } }
    ];

    const batch = q.queue.slice(0, 2);

    // Simulate concurrent removal while a flush is in progress
    q.removeByFilePath('C:\\a.pdf');

    await q._handleOfflineDatabase(batch, batch.length);

    expect(q.queue.map((item) => item.id)).toEqual(['file:C:\\c.pdf']);
  });

  test('removeByFilePath defers removal while flush is active', async () => {
    const EmbeddingQueue = require('../src/main/analysis/embeddingQueue/EmbeddingQueueCore');
    const {
      processItemsInParallel
    } = require('../src/main/analysis/embeddingQueue/parallelProcessor');

    processItemsInParallel.mockImplementationOnce(
      async ({ items, startProcessedCount, onProgress }) => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        const completed = startProcessedCount + items.length;
        onProgress({
          phase: 'processing',
          total: items.length,
          completed,
          percent: 100
        });
        return completed;
      }
    );

    mockContainer.resolve.mockReturnValue({
      initialize: jest.fn().mockResolvedValue(undefined),
      isOnline: true
    });

    const q = new EmbeddingQueue({ flushDelayMs: 0 });
    q.initialized = true;
    q.queue = [{ id: 'file:C:\\a.pdf', vector: [1], meta: { path: 'C:\\a.pdf' } }];

    const flushPromise = q.flush();
    await Promise.resolve();

    const removed = q.removeByFilePath('C:\\a.pdf');
    expect(removed).toBe(1);

    await flushPromise;
    expect(q.queue).toHaveLength(0);
  });

  test('updateByFilePath updates queued + failed IDs and persists both', async () => {
    const EmbeddingQueue = require('../src/main/analysis/embeddingQueue/EmbeddingQueueCore');
    const { persistQueueData } = require('../src/main/analysis/embeddingQueue/persistence');

    const q = new EmbeddingQueue({ flushDelayMs: 0 });
    q.initialized = true;
    q.queue = [
      { id: 'file:C:\\Old\\a.pdf', vector: [1], meta: { path: 'C:\\Old\\a.pdf', name: 'a.pdf' } }
    ];
    mockFailedHandler.failedItems.set('file:C:\\Old\\a.pdf', {
      item: {
        id: 'file:C:\\Old\\a.pdf',
        vector: [1],
        meta: { path: 'C:\\Old\\a.pdf', name: 'a.pdf' }
      },
      retryCount: 1,
      lastAttempt: Date.now(),
      error: 'x'
    });
    mockFailedHandler.persistAll = jest.fn().mockResolvedValue(undefined);

    const updated = q.updateByFilePath('C:\\Old\\a.pdf', 'C:\\New\\b.pdf');
    expect(updated).toBe(1);
    // buildPathUpdatePairs normalizes destination IDs to canonical form (forward slashes)
    expect(q.queue[0].id).toBe('file:C:/New/b.pdf');
    expect(q.queue[0].meta.path).toBe('C:\\New\\b.pdf');
    expect(q.queue[0].meta.name).toBe('b.pdf');
    expect(mockFailedHandler.failedItems.has('file:C:/New/b.pdf')).toBe(true);
    expect(mockFailedHandler.failedItems.has('file:C:\\Old\\a.pdf')).toBe(false);

    // Persistence is scheduled async; allow microtasks to run
    await flushMicrotasks();
    expect(persistQueueData).toHaveBeenCalled();
    expect(mockFailedHandler.persistAll).toHaveBeenCalled();
  });

  test('updateByFilePaths batches persistence once and updates multiple entries', async () => {
    const EmbeddingQueue = require('../src/main/analysis/embeddingQueue/EmbeddingQueueCore');
    const { persistQueueData } = require('../src/main/analysis/embeddingQueue/persistence');

    const q = new EmbeddingQueue({ flushDelayMs: 0 });
    q.initialized = true;
    q.queue = [
      { id: 'file:C:\\Old\\a.pdf', vector: [1], meta: { path: 'C:\\Old\\a.pdf', name: 'a.pdf' } },
      { id: 'file:C:\\Old\\c.pdf', vector: [1], meta: { path: 'C:\\Old\\c.pdf', name: 'c.pdf' } }
    ];
    mockFailedHandler.failedItems.clear();
    mockFailedHandler.persistAll = jest.fn().mockResolvedValue(undefined);

    const count = q.updateByFilePaths([
      { oldPath: 'C:\\Old\\a.pdf', newPath: 'C:\\New\\a.pdf' },
      { oldPath: 'C:\\Old\\c.pdf', newPath: 'C:\\New\\c.pdf' }
    ]);

    expect(count).toBe(2);
    // buildPathUpdatePairs normalizes destination IDs to canonical form (forward slashes)
    expect(q.queue.map((i) => i.id)).toEqual(['file:C:/New/a.pdf', 'file:C:/New/c.pdf']);
    await flushMicrotasks();
    expect(persistQueueData).toHaveBeenCalledTimes(1);
    expect(mockFailedHandler.persistAll).not.toHaveBeenCalled(); // no failed items updated
  });

  test('forceFlush waits pending flush up to timeout then persists only', async () => {
    jest.useFakeTimers();
    const EmbeddingQueue = require('../src/main/analysis/embeddingQueue/EmbeddingQueueCore');
    const { persistQueueData } = require('../src/main/analysis/embeddingQueue/persistence');

    const q = new EmbeddingQueue({ flushDelayMs: 0 });
    q.initialized = true;
    q.queue = [{ id: 'file:a', vector: [1] }];
    q.isFlushing = true;
    q._pendingFlush = new Promise(() => {}); // never resolves
    mockFailedHandler.persistAll = jest.fn().mockResolvedValue(undefined);

    const p = q.forceFlush();
    const assertion = expect(p).resolves.toBeUndefined();
    await flushMicrotasks();
    await advance(30050);
    await assertion;

    expect(persistQueueData).toHaveBeenCalled();
    expect(mockFailedHandler.persistAll).toHaveBeenCalled();
    jest.useRealTimers();
  });

  test('shutdown waits for a scheduled flush that is in progress', async () => {
    jest.useFakeTimers();
    const EmbeddingQueue = require('../src/main/analysis/embeddingQueue/EmbeddingQueueCore');

    const q = new EmbeddingQueue({ flushDelayMs: 10 });
    q.initialized = true;
    q.queue = [{ id: 'file:a', vector: [1] }];

    let resolveFlush;
    const flushPromise = new Promise((resolve) => {
      resolveFlush = resolve;
    });
    const flushSpy = jest.spyOn(q, 'flush').mockImplementation(() => flushPromise);
    mockFailedHandler.persistAll = jest.fn().mockResolvedValue(undefined);

    q.scheduleFlush();
    await advance(15);
    expect(flushSpy).toHaveBeenCalled();
    expect(q._pendingFlush).toBeTruthy();

    const shutdownP = q.shutdown();
    await flushMicrotasks();
    let settled = false;
    shutdownP.finally(() => {
      settled = true;
    });
    await flushMicrotasks();
    expect(settled).toBe(false);

    resolveFlush();
    await flushMicrotasks();
    await expect(shutdownP).resolves.toBeUndefined();

    jest.useRealTimers();
  });

  test('shutdown drains outstanding persistence promises and rejects further enqueues', async () => {
    jest.useFakeTimers();
    const EmbeddingQueue = require('../src/main/analysis/embeddingQueue/EmbeddingQueueCore');
    const { persistQueueData } = require('../src/main/analysis/embeddingQueue/persistence');

    const q = new EmbeddingQueue({ flushDelayMs: 0 });
    q.initialized = true;
    mockFailedHandler.persistAll = jest.fn().mockResolvedValue(undefined);

    // create an outstanding persistence promise
    let resolveOutstanding;
    const outstanding = new Promise((r) => {
      resolveOutstanding = r;
    });
    q._outstandingPersistence.add(outstanding);

    const shutdownP = q.shutdown();
    await flushMicrotasks();

    // still waiting on outstanding promise
    let settled = false;
    shutdownP.finally(() => {
      settled = true;
    });
    await flushMicrotasks();
    expect(settled).toBe(false);

    resolveOutstanding();
    await flushMicrotasks();
    await expect(shutdownP).resolves.toBeUndefined();

    expect(q._isShuttingDown).toBe(true);
    await expect(q.enqueue({ id: 'file:x', vector: [1] })).resolves.toEqual({
      success: false,
      reason: 'shutting_down'
    });

    expect(persistQueueData).toHaveBeenCalled();
    expect(mockFailedHandler.persistAll).toHaveBeenCalled();

    jest.useRealTimers();
  });
});
