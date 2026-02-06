/**
 * Tests for RateLimiter utilities
 */

jest.mock('../src/shared/performanceConstants', () => ({
  TIMEOUTS: {
    DELAY_BATCH: 50
  }
}));

const {
  SlidingWindowRateLimiter,
  Semaphore,
  createLlamaRateLimiter
} = require('../src/shared/RateLimiter');

describe('SlidingWindowRateLimiter', () => {
  let limiter;

  beforeEach(() => {
    limiter = new SlidingWindowRateLimiter(3, 1000); // 3 calls per second
  });

  describe('canCall', () => {
    test('allows calls under limit', () => {
      expect(limiter.canCall()).toBe(true);
      limiter.recordCall();
      expect(limiter.canCall()).toBe(true);
      limiter.recordCall();
      expect(limiter.canCall()).toBe(true);
    });

    test('blocks calls at limit', () => {
      limiter.recordCall();
      limiter.recordCall();
      limiter.recordCall();
      expect(limiter.canCall()).toBe(false);
    });

    test('allows calls after window expires', async () => {
      const fastLimiter = new SlidingWindowRateLimiter(2, 100);
      fastLimiter.recordCall();
      fastLimiter.recordCall();
      expect(fastLimiter.canCall()).toBe(false);

      await new Promise((r) => setTimeout(r, 150));
      expect(fastLimiter.canCall()).toBe(true);
    });
  });

  describe('recordCall', () => {
    test('tracks call timestamps', () => {
      expect(limiter.getStats().currentCalls).toBe(0);
      limiter.recordCall();
      expect(limiter.getStats().currentCalls).toBe(1);
      limiter.recordCall();
      expect(limiter.getStats().currentCalls).toBe(2);
    });
  });

  describe('waitForSlot', () => {
    test('resolves immediately when under limit', async () => {
      const start = Date.now();
      await limiter.waitForSlot();
      const elapsed = Date.now() - start;
      expect(elapsed).toBeLessThan(50);
    });

    test('waits when at limit', async () => {
      const fastLimiter = new SlidingWindowRateLimiter(1, 100);
      fastLimiter.recordCall();

      const start = Date.now();
      await fastLimiter.waitForSlot(20);
      const elapsed = Date.now() - start;

      expect(elapsed).toBeGreaterThanOrEqual(80); // Should wait ~100ms for window to expire
    });
  });

  describe('getStats', () => {
    test('returns current stats', () => {
      limiter.recordCall();
      limiter.recordCall();

      const stats = limiter.getStats();

      expect(stats.currentCalls).toBe(2);
      expect(stats.maxCalls).toBe(3);
      expect(stats.windowMs).toBe(1000);
    });
  });

  describe('reset', () => {
    test('clears all recorded calls', () => {
      limiter.recordCall();
      limiter.recordCall();
      expect(limiter.getStats().currentCalls).toBe(2);

      limiter.reset();

      expect(limiter.getStats().currentCalls).toBe(0);
    });
  });
});

describe('Semaphore', () => {
  let semaphore;

  beforeEach(() => {
    semaphore = new Semaphore(2, 10, 1000); // 2 concurrent, 10 queue, 1s timeout
  });

  describe('acquire/release', () => {
    test('allows acquisitions under limit', async () => {
      await semaphore.acquire();
      await semaphore.acquire();

      expect(semaphore.getStats().activeCount).toBe(2);
    });

    test('release decrements active count', async () => {
      await semaphore.acquire();
      expect(semaphore.getStats().activeCount).toBe(1);

      semaphore.release();
      expect(semaphore.getStats().activeCount).toBe(0);
    });

    test('queued request gets slot on release', async () => {
      await semaphore.acquire();
      await semaphore.acquire();

      // Start a third acquisition (should queue)
      const acquirePromise = semaphore.acquire();
      expect(semaphore.getStats().queueLength).toBe(1);

      // Release one slot
      semaphore.release();

      // The queued request should now be active
      await acquirePromise;
      expect(semaphore.getStats().activeCount).toBe(2);
      expect(semaphore.getStats().queueLength).toBe(0);
    });
  });

  describe('queue limits', () => {
    test('throws when queue is full', async () => {
      const smallSemaphore = new Semaphore(1, 2);
      await smallSemaphore.acquire(); // Takes the one slot

      // Fill the queue
      smallSemaphore.acquire(); // Queue position 1
      smallSemaphore.acquire(); // Queue position 2

      // This should throw
      await expect(smallSemaphore.acquire()).rejects.toThrow('Request queue full');
    });

    test('throws on timeout', async () => {
      const fastSemaphore = new Semaphore(1, 10, 100); // 100ms timeout
      await fastSemaphore.acquire();

      await expect(fastSemaphore.acquire()).rejects.toThrow('Request queue timeout');
    });
  });

  describe('getStats', () => {
    test('returns current stats', async () => {
      await semaphore.acquire();
      await semaphore.acquire();
      semaphore.acquire(); // Queued (3rd acquire, only 2 concurrent allowed)

      const stats = semaphore.getStats();

      expect(stats.activeCount).toBe(2);
      expect(stats.queueLength).toBe(1);
      expect(stats.maxConcurrent).toBe(2);
    });
  });

  describe('reset', () => {
    test('clears queue and rejects pending', async () => {
      await semaphore.acquire();
      await semaphore.acquire();

      const pending = semaphore.acquire();

      semaphore.reset();

      await expect(pending).rejects.toThrow('Semaphore reset');
      expect(semaphore.getStats().activeCount).toBe(0);
      expect(semaphore.getStats().queueLength).toBe(0);
    });
  });
});

describe('createLlamaRateLimiter', () => {
  test('creates limiter with defaults', () => {
    const limiter = createLlamaRateLimiter();
    const stats = limiter.getStats();

    expect(stats.maxCalls).toBe(5);
    expect(stats.windowMs).toBe(1000);
  });

  test('accepts custom options', () => {
    const limiter = createLlamaRateLimiter({ maxCalls: 10, windowMs: 2000 });
    const stats = limiter.getStats();

    expect(stats.maxCalls).toBe(10);
    expect(stats.windowMs).toBe(2000);
  });
});
