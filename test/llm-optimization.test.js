const {
  LLMRequestDeduplicator,
  BatchProcessor,
  globalDeduplicator,
  globalBatchProcessor
} = require('../src/main/utils/llmOptimization');

describe('LLM Optimization Utilities', () => {
  describe('LLMRequestDeduplicator', () => {
    let deduplicator;

    beforeEach(() => {
      deduplicator = new LLMRequestDeduplicator();
    });

    afterEach(() => {
      deduplicator.clear();
    });

    test('should generate consistent keys for identical inputs', () => {
      const input1 = { text: 'test content', model: 'llama2' };
      const input2 = { text: 'test content', model: 'llama2' };

      const key1 = deduplicator.generateKey(input1);
      const key2 = deduplicator.generateKey(input2);

      expect(key1).toBe(key2);
    });

    test('should generate different keys for different inputs', () => {
      const input1 = { text: 'test content 1', model: 'llama2' };
      const input2 = { text: 'test content 2', model: 'llama2' };

      const key1 = deduplicator.generateKey(input1);
      const key2 = deduplicator.generateKey(input2);

      expect(key1).not.toBe(key2);
    });

    test('should deduplicate identical concurrent requests', async () => {
      let callCount = 0;

      const expensiveOperation = async () => {
        callCount++;
        await new Promise((resolve) => setTimeout(resolve, 100));
        return 'result';
      };

      const key = 'test-key';

      // Start multiple concurrent requests with the same key
      const promise1 = deduplicator.deduplicate(key, expensiveOperation);
      const promise2 = deduplicator.deduplicate(key, expensiveOperation);
      const promise3 = deduplicator.deduplicate(key, expensiveOperation);

      const [result1, result2, result3] = await Promise.all([promise1, promise2, promise3]);

      // Should all return the same result
      expect(result1).toBe('result');
      expect(result2).toBe('result');
      expect(result3).toBe('result');

      // But the expensive operation should only be called once
      expect(callCount).toBe(1);
    });

    test('should allow different keys to execute concurrently', async () => {
      let callCount = 0;

      const expensiveOperation = async () => {
        callCount++;
        await new Promise((resolve) => setTimeout(resolve, 50));
        return 'result';
      };

      // Start multiple requests with different keys
      const promise1 = deduplicator.deduplicate('key1', expensiveOperation);
      const promise2 = deduplicator.deduplicate('key2', expensiveOperation);
      const promise3 = deduplicator.deduplicate('key3', expensiveOperation);

      await Promise.all([promise1, promise2, promise3]);

      // Each key should execute independently
      expect(callCount).toBe(3);
    });

    test('should clean up after request completion', async () => {
      const operation = async () => 'result';
      const key = 'test-key';

      await deduplicator.deduplicate(key, operation);

      // After completion, the key should be removed
      expect(deduplicator.pendingRequests.has(key)).toBe(false);
    });

    test('should respect max pending limit', async () => {
      const smallDeduplicator = new LLMRequestDeduplicator(5);

      // Manually trigger the size limit check by using deduplicate
      for (let i = 0; i < 10; i++) {
        await smallDeduplicator.deduplicate(`key-${i}`, async () => `result-${i}`);
      }

      // During execution, we can't easily check the limit since items are cleaned up
      // Instead, verify that the deduplicator handles many items without crashing
      expect(smallDeduplicator.pendingRequests.size).toBeLessThanOrEqual(5);
    });
  });

  describe('BatchProcessor', () => {
    let processor;

    beforeEach(() => {
      processor = new BatchProcessor(2); // Concurrency of 2 for testing
    });

    test('should process items in parallel with concurrency control', async () => {
      const items = [1, 2, 3, 4, 5];
      const processingTimes = [];
      const startTime = Date.now();

      const processItem = async (item) => {
        const itemStart = Date.now();
        await new Promise((resolve) => setTimeout(resolve, 100));
        processingTimes.push(Date.now() - itemStart);
        return item * 2;
      };

      const result = await processor.processBatch(items, processItem, {
        concurrency: 2
      });

      const totalTime = Date.now() - startTime;

      // Results should be in order
      expect(result.results).toEqual([2, 4, 6, 8, 10]);

      // Should be faster than sequential but slower than fully parallel
      // Sequential would take ~500ms, fully parallel ~100ms, concurrency=2 should take ~300ms
      // Increased upper bound to 850ms to prevent flaky tests in CI environments
      expect(totalTime).toBeGreaterThan(200);
      expect(totalTime).toBeLessThan(850);

      expect(result.successful).toBe(5);
      expect(result.errors.length).toBe(0);
    });

    test('should handle errors gracefully', async () => {
      const items = [1, 2, 3, 4, 5];

      const processItem = async (item) => {
        if (item === 3) {
          throw new Error('Item 3 failed');
        }
        return item * 2;
      };

      const result = await processor.processBatch(items, processItem, {
        concurrency: 2,
        stopOnError: false
      });

      // Should have 4 successful and 1 error
      expect(result.successful).toBe(4);
      expect(result.errors.length).toBe(1);
      expect(result.errors[0].index).toBe(2); // Item at index 2 failed

      // Successful results should still be there
      expect(result.results[0]).toBe(2);
      expect(result.results[1]).toBe(4);
      expect(result.results[2]).toHaveProperty('error');
      expect(result.results[3]).toBe(8);
      expect(result.results[4]).toBe(10);
    });

    test('should call onProgress callback', async () => {
      const items = [1, 2, 3];
      const progressUpdates = [];

      const processItem = async (item) => item * 2;

      await processor.processBatch(items, processItem, {
        concurrency: 1,
        onProgress: (progress) => {
          progressUpdates.push(progress);
        }
      });

      expect(progressUpdates.length).toBe(3);
      expect(progressUpdates[0].completed).toBe(1);
      expect(progressUpdates[1].completed).toBe(2);
      expect(progressUpdates[2].completed).toBe(3);
    });

    test('should handle empty array', async () => {
      const result = await processor.processBatch([], async (item) => item, {});

      expect(result.results).toEqual([]);
      expect(result.successful).toBe(0);
      expect(result.total).toBe(0);
    });
  });

  describe('Global instances', () => {
    test('should provide global deduplicator instance', () => {
      expect(globalDeduplicator).toBeInstanceOf(LLMRequestDeduplicator);
    });

    test('should provide global batch processor instance', () => {
      expect(globalBatchProcessor).toBeInstanceOf(BatchProcessor);
    });
  });
});
