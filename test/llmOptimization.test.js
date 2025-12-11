/**
 * Tests for LLM Optimization Utilities
 * Tests request deduplication and batch processing
 */

// Mock logger
jest.mock('../src/shared/logger', () => ({
  logger: {
    setContext: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  }
}));

// Mock crypto
jest.mock('crypto', () => ({
  createHash: jest.fn().mockReturnValue({
    update: jest.fn().mockReturnThis(),
    digest: jest.fn().mockReturnValue('mockhash123')
  })
}));

describe('LLM Optimization Utilities', () => {
  let LLMRequestDeduplicator;
  let BatchProcessor;
  let globalDeduplicator;
  let globalBatchProcessor;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();

    const module = require('../src/main/utils/llmOptimization');
    LLMRequestDeduplicator = module.LLMRequestDeduplicator;
    BatchProcessor = module.BatchProcessor;
    globalDeduplicator = module.globalDeduplicator;
    globalBatchProcessor = module.globalBatchProcessor;
  });

  describe('LLMRequestDeduplicator', () => {
    describe('constructor', () => {
      test('initializes with default max pending requests', () => {
        const dedup = new LLMRequestDeduplicator();
        expect(dedup.maxPendingRequests).toBe(100);
      });

      test('accepts custom max pending requests', () => {
        const dedup = new LLMRequestDeduplicator(50);
        expect(dedup.maxPendingRequests).toBe(50);
      });

      test('initializes with empty pending requests map', () => {
        const dedup = new LLMRequestDeduplicator();
        expect(dedup.pendingRequests.size).toBe(0);
      });
    });

    describe('generateKey', () => {
      test('generates key for string input', () => {
        const dedup = new LLMRequestDeduplicator();
        const key = dedup.generateKey('test input');
        expect(key).toBeDefined();
        expect(typeof key).toBe('string');
      });

      test('generates key for object input', () => {
        const dedup = new LLMRequestDeduplicator();
        const key = dedup.generateKey({ model: 'llama2', prompt: 'test' });
        expect(key).toBeDefined();
        expect(typeof key).toBe('string');
      });

      test('generates key for null input', () => {
        const dedup = new LLMRequestDeduplicator();
        const key = dedup.generateKey(null);
        expect(key).toBeDefined();
      });

      test('generates key for number input', () => {
        const dedup = new LLMRequestDeduplicator();
        const key = dedup.generateKey(12345);
        expect(key).toBeDefined();
      });
    });

    describe('deduplicate', () => {
      test('executes function and returns result', async () => {
        const dedup = new LLMRequestDeduplicator();
        const fn = jest.fn().mockResolvedValue({ result: 'success' });

        const result = await dedup.deduplicate('key1', fn);

        expect(result).toEqual({ result: 'success' });
        expect(fn).toHaveBeenCalledTimes(1);
      });

      test('returns existing promise for duplicate request', async () => {
        const dedup = new LLMRequestDeduplicator();
        let resolveFirst;
        const firstPromise = new Promise((resolve) => {
          resolveFirst = resolve;
        });
        const fn = jest.fn().mockReturnValue(firstPromise);

        // Start first request
        const promise1 = dedup.deduplicate('key1', fn);

        // Second request with same key should reuse - only called once
        dedup.deduplicate('key1', fn);
        expect(fn).toHaveBeenCalledTimes(1);

        // Resolve to complete the test
        resolveFirst({ result: 'done' });
        const result = await promise1;
        expect(result).toEqual({ result: 'done' });
      });

      test('cleans up after completion', async () => {
        const dedup = new LLMRequestDeduplicator();
        const fn = jest.fn().mockResolvedValue({ result: 'success' });

        await dedup.deduplicate('key1', fn);

        expect(dedup.pendingRequests.size).toBe(0);
      });

      test('evicts oldest when max size reached', async () => {
        const dedup = new LLMRequestDeduplicator(2);

        // Create pending promises that don't resolve
        const neverResolve = () => new Promise(() => {});

        dedup.deduplicate('key1', neverResolve);
        dedup.deduplicate('key2', neverResolve);
        dedup.deduplicate('key3', neverResolve);

        // key1 should be evicted
        expect(dedup.pendingRequests.has('key1')).toBe(false);
        expect(dedup.pendingRequests.has('key2')).toBe(true);
        expect(dedup.pendingRequests.has('key3')).toBe(true);
      });
    });

    describe('clear', () => {
      test('clears all pending requests', async () => {
        const dedup = new LLMRequestDeduplicator();

        // Add some pending requests
        dedup.deduplicate('key1', () => new Promise(() => {}));
        dedup.deduplicate('key2', () => new Promise(() => {}));

        expect(dedup.pendingRequests.size).toBe(2);

        dedup.clear();

        expect(dedup.pendingRequests.size).toBe(0);
      });
    });

    describe('getStats', () => {
      test('returns correct stats', async () => {
        const dedup = new LLMRequestDeduplicator(50);

        dedup.deduplicate('key1', () => new Promise(() => {}));

        const stats = dedup.getStats();

        expect(stats.pendingCount).toBe(1);
        expect(stats.maxPending).toBe(50);
      });
    });
  });

  describe('BatchProcessor', () => {
    describe('constructor', () => {
      test('initializes with default concurrency', () => {
        const processor = new BatchProcessor();
        expect(processor.concurrencyLimit).toBe(3);
      });

      test('accepts custom concurrency', () => {
        const processor = new BatchProcessor(5);
        expect(processor.concurrencyLimit).toBe(5);
      });

      test('initializes with zero active count', () => {
        const processor = new BatchProcessor();
        expect(processor.activeCount).toBe(0);
      });
    });

    describe('processBatch', () => {
      test('returns empty results for empty array', async () => {
        const processor = new BatchProcessor();
        const processFn = jest.fn();

        const result = await processor.processBatch([], processFn);

        expect(result.results).toEqual([]);
        expect(result.errors).toEqual([]);
        expect(result.successful).toBe(0);
        expect(result.total).toBe(0);
        expect(processFn).not.toHaveBeenCalled();
      });

      test('returns empty results for non-array input', async () => {
        const processor = new BatchProcessor();
        const processFn = jest.fn();

        const result = await processor.processBatch(null, processFn);

        expect(result.results).toEqual([]);
        expect(result.total).toBe(0);
      });

      test('processes all items successfully', async () => {
        const processor = new BatchProcessor();
        const items = ['a', 'b', 'c'];
        const processFn = jest
          .fn()
          .mockImplementation((item) => Promise.resolve({ processed: item }));

        const result = await processor.processBatch(items, processFn);

        expect(result.successful).toBe(3);
        expect(result.total).toBe(3);
        expect(result.errors).toHaveLength(0);
        expect(processFn).toHaveBeenCalledTimes(3);
      });

      test('handles partial failures', async () => {
        const processor = new BatchProcessor();
        const items = ['a', 'b', 'c'];
        const processFn = jest
          .fn()
          .mockResolvedValueOnce({ processed: 'a' })
          .mockRejectedValueOnce(new Error('Failed'))
          .mockResolvedValueOnce({ processed: 'c' });

        const result = await processor.processBatch(items, processFn);

        expect(result.successful).toBe(2);
        expect(result.errors).toHaveLength(1);
        expect(result.errors[0].index).toBe(1);
      });

      test('respects concurrency limit', async () => {
        const processor = new BatchProcessor(2);
        const items = ['a', 'b', 'c', 'd'];
        let maxConcurrent = 0;
        let currentConcurrent = 0;

        const processFn = jest.fn().mockImplementation(async () => {
          currentConcurrent++;
          maxConcurrent = Math.max(maxConcurrent, currentConcurrent);
          await new Promise((resolve) => setTimeout(resolve, 10));
          currentConcurrent--;
          return { done: true };
        });

        await processor.processBatch(items, processFn, { concurrency: 2 });

        expect(maxConcurrent).toBeLessThanOrEqual(2);
      });

      test('calls onProgress callback', async () => {
        const processor = new BatchProcessor();
        const items = ['a', 'b'];
        const onProgress = jest.fn();
        const processFn = jest.fn().mockResolvedValue({ done: true });

        await processor.processBatch(items, processFn, { onProgress });

        expect(onProgress).toHaveBeenCalledTimes(2);
        expect(onProgress).toHaveBeenCalledWith(
          expect.objectContaining({
            completed: expect.any(Number),
            total: 2
          })
        );
      });

      test('records error when stopOnError is true', async () => {
        const processor = new BatchProcessor(1); // Sequential to ensure order
        const items = ['a', 'b', 'c'];
        const processFn = jest
          .fn()
          .mockResolvedValueOnce({ processed: 'a' })
          .mockRejectedValueOnce(new Error('Stop here'))
          .mockResolvedValueOnce({ processed: 'c' });

        const result = await processor.processBatch(items, processFn, {
          stopOnError: true,
          concurrency: 1
        });

        // stopOnError throws from processItem which is caught by Promise.allSettled
        expect(result.errors).toHaveLength(1);
        expect(result.errors[0].error.message).toBe('Stop here');
      });

      test('maintains result order', async () => {
        const processor = new BatchProcessor();
        const items = [1, 2, 3];
        const processFn = jest.fn().mockImplementation(async (item) => {
          // Variable delay to potentially mix up order
          await new Promise((resolve) => setTimeout(resolve, Math.random() * 10));
          return { value: item * 2 };
        });

        const result = await processor.processBatch(items, processFn);

        expect(result.results[0].value).toBe(2);
        expect(result.results[1].value).toBe(4);
        expect(result.results[2].value).toBe(6);
      });
    });

    describe('getStats', () => {
      test('returns correct stats', () => {
        const processor = new BatchProcessor(5);

        const stats = processor.getStats();

        expect(stats.activeCount).toBe(0);
        expect(stats.concurrencyLimit).toBe(5);
        expect(stats.queueSize).toBe(0);
      });
    });
  });

  describe('Global instances', () => {
    test('globalDeduplicator is an instance of LLMRequestDeduplicator', () => {
      expect(globalDeduplicator).toBeInstanceOf(LLMRequestDeduplicator);
    });

    test('globalBatchProcessor is an instance of BatchProcessor', () => {
      expect(globalBatchProcessor).toBeInstanceOf(BatchProcessor);
    });

    test('globalBatchProcessor has default concurrency of 3', () => {
      expect(globalBatchProcessor.concurrencyLimit).toBe(3);
    });
  });
});
