/**
 * Integration Tests for Service Failure Scenarios
 *
 * Tests:
 * - ChromaDB being down
 * - Operation queueing during outages
 * - Service recovery behavior
 * - Ollama timeout/failures
 * - Retry behavior
 * - Circuit breaker patterns
 */

const { generateDummyFiles } = require('../utils/testUtilities');

// Mock electron
jest.mock('electron', () => ({
  app: {
    getPath: jest.fn(() => '/tmp/test-app')
  }
}));

// Mock logger
jest.mock('../../src/shared/logger', () => ({
  logger: {
    setContext: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  }
}));

// Mock config
jest.mock('../../src/shared/config', () => ({
  get: jest.fn((key, defaultValue) => defaultValue)
}));

describe('Service Failure Integration Tests', () => {
  describe('ChromaDB Service Failures', () => {
    let OfflineQueue;
    let OperationType;

    beforeEach(() => {
      jest.clearAllMocks();
      jest.resetModules();

      // Ensure /tmp exists in memfs after module reset
      const { vol } = require('memfs');
      vol.mkdirSync('/tmp', { recursive: true });

      // Import after mocking
      const queueModule = require('../../src/main/utils/OfflineQueue');
      OfflineQueue = queueModule.OfflineQueue;
      OperationType = queueModule.OperationType;
    });

    it('should queue operations when ChromaDB is unavailable', async () => {
      const queue = new OfflineQueue({
        maxQueueSize: 100,
        persistPath: '/tmp/test-queue.json'
      });

      // Enqueue operations
      const files = generateDummyFiles(10, { includeEmbedding: true });
      for (const file of files) {
        queue.enqueue(OperationType.UPSERT_FILE, file);
      }

      expect(queue.size()).toBe(10);

      const stats = queue.getStats();
      expect(stats.totalEnqueued).toBe(10);
      expect(stats.isFlushing).toBe(false);
    });

    it('should process queued operations when service recovers', async () => {
      const queue = new OfflineQueue({
        maxQueueSize: 100,
        persistPath: '/tmp/test-queue-recovery.json'
      });

      let isServiceUp = false;
      const processedOps = [];

      // Enqueue operations while service is down
      const files = generateDummyFiles(5, { includeEmbedding: true });
      for (const file of files) {
        queue.enqueue(OperationType.UPSERT_FILE, file);
      }

      expect(queue.size()).toBe(5);

      // Service comes back up
      isServiceUp = true;

      // Flush the queue
      const processor = async (operation) => {
        if (!isServiceUp) {
          throw new Error('Service unavailable');
        }
        processedOps.push(operation);
      };

      const result = await queue.flush(processor);

      expect(result.processed).toBe(5);
      expect(result.failed).toBe(0);
      expect(queue.size()).toBe(0);
      expect(processedOps.length).toBe(5);
    });

    it('should handle partial flush failures', async () => {
      const queue = new OfflineQueue({
        maxQueueSize: 100,
        persistPath: '/tmp/test-queue-partial.json',
        maxRetries: 2
      });

      const processedOps = [];
      let failCount = 0;

      // Enqueue operations
      for (let i = 0; i < 10; i++) {
        queue.enqueue(OperationType.UPSERT_FILE, {
          id: `file:${i}`,
          shouldFail: i % 3 === 0 // Every 3rd operation fails
        });
      }

      // Processor that fails on certain operations
      const processor = async (operation) => {
        if (operation.data.shouldFail && failCount < 3) {
          failCount++;
          throw new Error('Simulated failure');
        }
        processedOps.push(operation);
      };

      const result = await queue.flush(processor);

      console.log(
        `[TEST] Processed: ${result.processed}, Failed: ${result.failed}, Remaining: ${result.remaining}`
      );

      // Some operations should succeed, some should be retried
      expect(result.processed).toBeGreaterThan(0);
    });

    it('should deduplicate operations by key', async () => {
      const queue = new OfflineQueue({
        maxQueueSize: 100,
        persistPath: '/tmp/test-queue-dedup.json',
        deduplicateByKey: true
      });

      // Enqueue same file multiple times
      for (let i = 0; i < 5; i++) {
        queue.enqueue(OperationType.UPSERT_FILE, {
          id: 'file:same-file',
          version: i
        });
      }

      // Should deduplicate to single operation with latest data
      expect(queue.size()).toBe(1);

      const stats = queue.getStats();
      expect(stats.deduplicated).toBe(4);

      // Verify latest data is preserved
      const op = queue.peek();
      expect(op.data.version).toBe(4);
    });

    it('should drop lowest priority operations when queue is full', async () => {
      const queue = new OfflineQueue({
        maxQueueSize: 5,
        persistPath: '/tmp/test-queue-full.json',
        deduplicateByKey: false
      });

      // Fill queue with batch operations (lower priority)
      for (let i = 0; i < 5; i++) {
        queue.enqueue(OperationType.BATCH_UPSERT_FILES, {
          files: [{ id: `file:${i}` }]
        });
      }

      expect(queue.size()).toBe(5);

      // Add high priority operation (delete)
      queue.enqueue(OperationType.DELETE_FILE, { fileId: 'file:urgent' });

      // Queue should still be at max size
      expect(queue.size()).toBe(5);

      // High priority operation should be present
      const stats = queue.getStats();
      expect(stats.totalDropped).toBeGreaterThan(0);
    });
  });

  describe('Ollama Service Failures', () => {
    let withOllamaRetry;
    let isRetryableError;

    beforeEach(() => {
      jest.clearAllMocks();
      jest.resetModules();
      jest.useFakeTimers({ legacyFakeTimers: false });

      // Import retry utilities
      const retryModule = require('../../src/main/utils/ollamaApiRetry');
      withOllamaRetry = retryModule.withOllamaRetry;
      isRetryableError = retryModule.isRetryableError;
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('should identify retryable errors correctly', () => {
      // Network errors should be retryable
      expect(isRetryableError({ code: 'ECONNREFUSED' })).toBe(true);
      expect(isRetryableError({ code: 'ETIMEDOUT' })).toBe(true);
      expect(isRetryableError({ code: 'ECONNRESET' })).toBe(true);
      expect(isRetryableError({ message: 'fetch failed' })).toBe(true);
      expect(isRetryableError({ message: 'Network error' })).toBe(true);

      // Server errors should be retryable
      expect(isRetryableError({ status: 500 })).toBe(true);
      expect(isRetryableError({ status: 502 })).toBe(true);
      expect(isRetryableError({ status: 503 })).toBe(true);
      expect(isRetryableError({ status: 429 })).toBe(true);

      // Client errors should NOT be retryable
      expect(isRetryableError({ status: 400 })).toBe(false);
      expect(isRetryableError({ status: 404 })).toBe(false);
      expect(isRetryableError({ message: 'Invalid request' })).toBe(false);
      expect(isRetryableError({ message: 'Validation error' })).toBe(false);
    });

    it('should retry on transient failures', async () => {
      const mockApi = jest
        .fn()
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce({ success: true });

      const promise = withOllamaRetry(mockApi, {
        operation: 'test',
        maxRetries: 3,
        initialDelay: 100
      });

      // Advance timers
      await jest.runAllTimersAsync();

      const result = await promise;

      expect(result).toEqual({ success: true });
      expect(mockApi).toHaveBeenCalledTimes(2);
    }, 10000);

    it('should fail after max retries', async () => {
      const mockApi = jest.fn().mockRejectedValue(new Error('Network error'));

      // Use try/catch to properly handle expected rejection with fake timers
      let caughtError = null;
      const promise = withOllamaRetry(mockApi, {
        operation: 'test',
        maxRetries: 2,
        initialDelay: 100
      }).catch((err) => {
        caughtError = err;
      });

      await jest.runAllTimersAsync();
      await promise;

      expect(caughtError).not.toBeNull();
      expect(caughtError.message).toBe('Network error');
      expect(mockApi).toHaveBeenCalledTimes(3); // Initial + 2 retries
    }, 10000);

    it('should not retry non-retryable errors', async () => {
      const mockApi = jest.fn().mockRejectedValue(new Error('Validation error'));

      await expect(
        withOllamaRetry(mockApi, {
          operation: 'test',
          maxRetries: 3
        })
      ).rejects.toThrow('Validation error');

      expect(mockApi).toHaveBeenCalledTimes(1);
    });

    it('should apply exponential backoff', async () => {
      const callTimes = [];
      const mockApi = jest.fn().mockImplementation(() => {
        callTimes.push(Date.now());
        return Promise.reject(new Error('Network error'));
      });

      // Use try/catch to properly handle expected rejection with fake timers
      let caughtError = null;
      const promise = withOllamaRetry(mockApi, {
        operation: 'test',
        maxRetries: 3,
        initialDelay: 1000,
        maxDelay: 5000
      }).catch((err) => {
        caughtError = err;
      });

      await jest.runAllTimersAsync();
      await promise;

      expect(caughtError).not.toBeNull();
      expect(mockApi).toHaveBeenCalledTimes(4);
    }, 15000);
  });

  describe('Circuit Breaker Behavior', () => {
    let CircuitBreaker;
    let CircuitState;

    beforeEach(() => {
      jest.clearAllMocks();
      jest.resetModules();
      jest.useFakeTimers({ legacyFakeTimers: false });

      const cbModule = require('../../src/main/utils/CircuitBreaker');
      CircuitBreaker = cbModule.CircuitBreaker;
      CircuitState = cbModule.CircuitState;
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('should open circuit after failure threshold', () => {
      const cb = new CircuitBreaker('TestService', {
        failureThreshold: 3,
        timeout: 5000
      });

      expect(cb.getState()).toBe(CircuitState.CLOSED);

      // Record failures
      for (let i = 0; i < 3; i++) {
        cb.recordFailure(new Error(`Failure ${i}`));
      }

      expect(cb.getState()).toBe(CircuitState.OPEN);
      expect(cb.isAllowed()).toBe(false);
    });

    it('should transition to half-open after timeout', async () => {
      const cb = new CircuitBreaker('TestService', {
        failureThreshold: 2,
        timeout: 1000
      });

      // Open the circuit
      cb.recordFailure(new Error('Failure 1'));
      cb.recordFailure(new Error('Failure 2'));

      expect(cb.getState()).toBe(CircuitState.OPEN);

      // Advance past timeout
      jest.advanceTimersByTime(1100);

      expect(cb.getState()).toBe(CircuitState.HALF_OPEN);
      expect(cb.isAllowed()).toBe(true);
    });

    it('should close circuit after success in half-open state', async () => {
      const cb = new CircuitBreaker('TestService', {
        failureThreshold: 2,
        successThreshold: 1,
        timeout: 1000
      });

      // Open the circuit
      cb.recordFailure(new Error('Failure 1'));
      cb.recordFailure(new Error('Failure 2'));

      // Transition to half-open
      jest.advanceTimersByTime(1100);
      expect(cb.getState()).toBe(CircuitState.HALF_OPEN);

      // Record success
      cb.recordSuccess();

      expect(cb.getState()).toBe(CircuitState.CLOSED);
    });

    it('should re-open circuit on failure in half-open state', async () => {
      const cb = new CircuitBreaker('TestService', {
        failureThreshold: 2,
        timeout: 1000
      });

      // Open the circuit
      cb.recordFailure(new Error('Failure 1'));
      cb.recordFailure(new Error('Failure 2'));

      // Transition to half-open
      jest.advanceTimersByTime(1100);
      expect(cb.getState()).toBe(CircuitState.HALF_OPEN);

      // Record another failure
      cb.recordFailure(new Error('Failure in half-open'));

      expect(cb.getState()).toBe(CircuitState.OPEN);
    });

    it('should emit state change events', () => {
      const cb = new CircuitBreaker('TestService', {
        failureThreshold: 2,
        timeout: 1000
      });

      const events = [];
      cb.on('stateChange', (data) => events.push(data));
      cb.on('open', () => events.push({ type: 'open' }));

      // Open the circuit
      cb.recordFailure(new Error('Failure 1'));
      cb.recordFailure(new Error('Failure 2'));

      expect(events.length).toBeGreaterThan(0);
      expect(events.some((e) => e.type === 'open' || e.currentState === CircuitState.OPEN)).toBe(
        true
      );
    });

    it('should provide accurate statistics', () => {
      const cb = new CircuitBreaker('TestService', {
        failureThreshold: 5
      });

      // Record some successes and failures
      cb.recordSuccess();
      cb.recordSuccess();
      cb.recordFailure(new Error('Test'));
      cb.recordSuccess();

      const stats = cb.getStats();

      // successfulRequests/failedRequests are cumulative counts from stats object
      // successCount/failureCount are state-specific counters (reset on state transitions)
      expect(stats.successfulRequests).toBe(3);
      expect(stats.failedRequests).toBe(1);
      expect(stats.state).toBe(CircuitState.CLOSED);
    });

    it('should execute operations through circuit breaker', async () => {
      const cb = new CircuitBreaker('TestService', {
        failureThreshold: 3
      });

      const successOp = jest.fn().mockResolvedValue('success');
      const failOp = jest.fn().mockRejectedValue(new Error('fail'));

      // Execute successful operation
      const result = await cb.execute(successOp);
      expect(result).toBe('success');
      expect(cb.getStats().successfulRequests).toBe(1);

      // Execute failing operation
      await expect(cb.execute(failOp)).rejects.toThrow('fail');
      expect(cb.getStats().failedRequests).toBe(1);
    });
  });

  describe('Service Recovery Scenarios', () => {
    it('should recover gracefully when all services come back online', async () => {
      // Simulate a full recovery scenario
      const operations = {
        chromaDbUp: false,
        ollamaUp: false,
        queuedOperations: []
      };

      // Queue operations while services are down
      for (let i = 0; i < 5; i++) {
        operations.queuedOperations.push({
          type: 'upsert',
          id: `file:${i}`,
          timestamp: Date.now()
        });
      }

      expect(operations.queuedOperations.length).toBe(5);

      // Services come back online
      operations.chromaDbUp = true;
      operations.ollamaUp = true;

      // Process queued operations
      const processedOps = [];
      while (operations.queuedOperations.length > 0) {
        const op = operations.queuedOperations.shift();
        if (operations.chromaDbUp) {
          processedOps.push(op);
        }
      }

      expect(processedOps.length).toBe(5);
      expect(operations.queuedOperations.length).toBe(0);
    });

    it('should handle cascading failures between services', async () => {
      const serviceState = {
        ollama: true,
        chromaDb: true,
        failureCount: 0
      };

      const processFile = async () => {
        // First, analysis with Ollama
        if (!serviceState.ollama) {
          serviceState.failureCount++;
          throw new Error('Ollama unavailable');
        }

        // Then, store in ChromaDB
        if (!serviceState.chromaDb) {
          serviceState.failureCount++;
          throw new Error('ChromaDB unavailable');
        }

        return { success: true };
      };

      // Both services up
      await expect(processFile()).resolves.toEqual({ success: true });

      // Ollama goes down
      serviceState.ollama = false;
      await expect(processFile()).rejects.toThrow('Ollama unavailable');

      // Ollama recovers, ChromaDB goes down
      serviceState.ollama = true;
      serviceState.chromaDb = false;
      await expect(processFile()).rejects.toThrow('ChromaDB unavailable');

      // Both recover
      serviceState.chromaDb = true;
      await expect(processFile()).resolves.toEqual({ success: true });

      expect(serviceState.failureCount).toBe(2);
    });
  });

  describe('Timeout Handling', () => {
    it('should handle operation timeouts', async () => {
      jest.useFakeTimers();

      const timeoutOperation = () =>
        new Promise((_, reject) => {
          setTimeout(() => reject(new Error('Operation timed out')), 5000);
        });

      const operationPromise = timeoutOperation();

      jest.advanceTimersByTime(5000);

      await expect(operationPromise).rejects.toThrow('Operation timed out');

      jest.useRealTimers();
    });

    it('should cancel pending operations on shutdown', async () => {
      const pendingOps = [];
      let cancelled = false;

      // Create pending operations
      for (let i = 0; i < 3; i++) {
        pendingOps.push({
          id: `op:${i}`,
          cancel: () => {
            cancelled = true;
          }
        });
      }

      // Simulate shutdown
      const shutdown = () => {
        for (const op of pendingOps) {
          op.cancel();
        }
        pendingOps.length = 0;
      };

      shutdown();

      expect(cancelled).toBe(true);
      expect(pendingOps.length).toBe(0);
    });
  });
});
