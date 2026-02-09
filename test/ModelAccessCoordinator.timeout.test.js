/**
 * Tests for ModelAccessCoordinator timeout behavior.
 *
 * Verifies that:
 * - acquireLoadLock times out and unblocks the PQueue task
 * - acquireInferenceSlot times out and unblocks the PQueue task
 * - The queue is usable again after a timeout
 *
 * Uses a concurrency-aware PQueue mock that actually queues tasks
 * when the concurrency limit is reached (unlike the global mock).
 */

jest.mock('../src/shared/logger', () => ({
  createLogger: () => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  })
}));

// Override the global PQueue mock with one that enforces concurrency.
// The global mock runs all tasks immediately, which prevents timeout
// scenarios from being testable.
jest.mock('p-queue', () => {
  class ConcurrencyQueue {
    constructor(opts = {}) {
      this.concurrency = opts.concurrency || Infinity;
      this._running = 0;
      this._queue = [];
      this.size = 0;
    }

    get pending() {
      return this._running;
    }

    add(fn) {
      this.size++;
      if (this._running < this.concurrency) {
        return this._runTask(fn);
      }
      // Queue the task -- it will run when a slot opens
      return new Promise((resolve, reject) => {
        this._queue.push({ fn, resolve, reject });
      });
    }

    async _runTask(fn) {
      this._running++;
      try {
        return await fn();
      } finally {
        this._running--;
        this.size = Math.max(0, this.size - 1);
        this._drain();
      }
    }

    _drain() {
      while (this._queue.length > 0 && this._running < this.concurrency) {
        const { fn, resolve, reject } = this._queue.shift();
        this._runTask(fn).then(resolve, reject);
      }
    }

    clear() {
      this._queue = [];
      this.size = 0;
    }
  }

  return { default: ConcurrencyQueue };
});

const { ModelAccessCoordinator } = require('../src/main/services/ModelAccessCoordinator');

describe('ModelAccessCoordinator timeout behavior', () => {
  describe('acquireLoadLock timeout', () => {
    test('rejects with LOAD_LOCK_TIMEOUT when lock is held too long', async () => {
      const coordinator = new ModelAccessCoordinator();

      // Acquire the lock and intentionally never release it
      const release1 = await coordinator.acquireLoadLock('text');

      // Try to acquire a second lock with a short timeout -- should fail
      await expect(coordinator.acquireLoadLock('text', { timeoutMs: 200 })).rejects.toThrow(
        /Load lock timeout/
      );

      // Clean up the first lock
      release1();
    });

    test('queue recovers after a load lock timeout', async () => {
      const coordinator = new ModelAccessCoordinator();

      // Hold the lock (simulates stuck model load)
      const release1 = await coordinator.acquireLoadLock('embedding');

      // Second caller times out
      await expect(coordinator.acquireLoadLock('embedding', { timeoutMs: 150 })).rejects.toThrow(
        /Load lock timeout/
      );

      // Release the first lock
      release1();

      // Queue should be usable again -- a new lock should succeed promptly
      const release3 = await coordinator.acquireLoadLock('embedding', { timeoutMs: 2000 });
      expect(typeof release3).toBe('function');
      release3();
    });

    test('timeout error has correct code', async () => {
      const coordinator = new ModelAccessCoordinator();
      const release = await coordinator.acquireLoadLock('vision');

      try {
        await coordinator.acquireLoadLock('vision', { timeoutMs: 100 });
        throw new Error('Should have thrown');
      } catch (error) {
        expect(error.code).toBe('LOAD_LOCK_TIMEOUT');
      } finally {
        release();
      }
    });
  });

  describe('acquireInferenceSlot timeout', () => {
    test('rejects with INFERENCE_SLOT_TIMEOUT when slot is held too long', async () => {
      // Use concurrency 1 so second acquisition must wait
      const coordinator = new ModelAccessCoordinator({ inferenceSlots: 1 });

      // Acquire the only slot and hold it
      const release1 = await coordinator.acquireInferenceSlot('op-hold', 'text');

      // Second caller should timeout
      await expect(
        coordinator.acquireInferenceSlot('op-wait', 'text', { timeoutMs: 200 })
      ).rejects.toThrow(/Inference slot timeout/);

      // Verify the held operation is still tracked
      expect(coordinator.getStatus().activeOperations).toBe(1);

      release1();
      expect(coordinator.getStatus().activeOperations).toBe(0);
    });

    test('timeout error has correct code', async () => {
      const coordinator = new ModelAccessCoordinator({ inferenceSlots: 1 });
      const release = await coordinator.acquireInferenceSlot('op-1', 'embedding');

      try {
        await coordinator.acquireInferenceSlot('op-2', 'embedding', { timeoutMs: 100 });
        throw new Error('Should have thrown');
      } catch (error) {
        expect(error.code).toBe('INFERENCE_SLOT_TIMEOUT');
      } finally {
        release();
      }
    });

    test('queue recovers after inference slot timeout', async () => {
      const coordinator = new ModelAccessCoordinator({ inferenceSlots: 1 });

      const release1 = await coordinator.acquireInferenceSlot('op-1', 'text');

      // Timeout
      await expect(
        coordinator.acquireInferenceSlot('op-2', 'text', { timeoutMs: 150 })
      ).rejects.toThrow(/Inference slot timeout/);

      // Release original slot
      release1();

      // Should be able to acquire a new slot promptly
      const release3 = await coordinator.acquireInferenceSlot('op-3', 'text', { timeoutMs: 2000 });
      expect(typeof release3).toBe('function');
      release3();
    });
  });

  describe('independent model type queues', () => {
    test('timeout on one model type does not affect another', async () => {
      const coordinator = new ModelAccessCoordinator({ inferenceSlots: 1 });

      // Hold the text slot
      const releaseText = await coordinator.acquireInferenceSlot('op-text', 'text');

      // Embedding slot should still be acquirable immediately
      const releaseEmbed = await coordinator.acquireInferenceSlot('op-embed', 'embedding');
      expect(coordinator.getStatus().activeOperations).toBe(2);

      releaseText();
      releaseEmbed();
    });
  });
});
