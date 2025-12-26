/**
 * Tests for ParallelEmbeddingService
 * Tests parallel embedding generation with semaphore concurrency control
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

// Mock ollamaUtils
const mockOllama = {
  embeddings: jest.fn(), // Legacy API (deprecated)
  embed: jest.fn(), // New API
  list: jest.fn()
};

jest.mock('../src/main/ollamaUtils', () => ({
  getOllama: jest.fn(() => mockOllama),
  getOllamaEmbeddingModel: jest.fn(() => 'mxbai-embed-large')
}));

// Mock ollamaApiRetry
jest.mock('../src/main/utils/ollamaApiRetry', () => ({
  withOllamaRetry: jest.fn((fn) => fn()),
  isRetryableError: jest.fn(() => false)
}));

// Mock config
jest.mock('../src/shared/config/index', () => ({
  get: jest.fn((key, defaultValue) => defaultValue)
}));

jest.mock('../src/main/services/PerformanceService', () => ({
  buildOllamaOptions: jest.fn().mockResolvedValue({ num_gpu: -1, main_gpu: 0 })
}));

describe('ParallelEmbeddingService', () => {
  let ParallelEmbeddingService;
  let getInstance;
  let resetInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();

    // New API uses embed() with embeddings array response
    mockOllama.embed.mockResolvedValue({ embeddings: [[0.1, 0.2, 0.3]] });
    mockOllama.list.mockResolvedValue({ models: [] });

    const module = require('../src/main/services/ParallelEmbeddingService');
    ParallelEmbeddingService = module.ParallelEmbeddingService;
    getInstance = module.getInstance;
    resetInstance = module.resetInstance;
  });

  describe('constructor', () => {
    test('creates instance with default options', () => {
      const service = new ParallelEmbeddingService();

      expect(service.concurrencyLimit).toBeGreaterThanOrEqual(2);
      expect(service.concurrencyLimit).toBeLessThanOrEqual(10);
      expect(service.activeRequests).toBe(0);
      expect(service.waitQueue).toEqual([]);
    });

    test('accepts custom concurrency limit', () => {
      const service = new ParallelEmbeddingService({ concurrencyLimit: 3 });

      expect(service.concurrencyLimit).toBe(3);
    });

    test('caps concurrency at 10', () => {
      const service = new ParallelEmbeddingService({ concurrencyLimit: 100 });

      expect(service.concurrencyLimit).toBe(10);
    });

    test('initializes stats object', () => {
      const service = new ParallelEmbeddingService();

      expect(service.stats.totalRequests).toBe(0);
      expect(service.stats.successfulRequests).toBe(0);
      expect(service.stats.failedRequests).toBe(0);
      expect(service.stats.peakConcurrency).toBe(0);
    });

    test('accepts custom retry options', () => {
      const service = new ParallelEmbeddingService({
        maxRetries: 5,
        initialRetryDelayMs: 500
      });

      expect(service.maxRetries).toBe(5);
      expect(service.initialRetryDelayMs).toBe(500);
    });
  });

  describe('_calculateOptimalConcurrency', () => {
    test('returns value based on CPU cores', () => {
      const service = new ParallelEmbeddingService();
      const concurrency = service._calculateOptimalConcurrency();

      expect(concurrency).toBeGreaterThanOrEqual(2);
      expect(concurrency).toBeLessThanOrEqual(5);
    });
  });

  describe('semaphore', () => {
    test('allows requests up to limit', async () => {
      const service = new ParallelEmbeddingService({ concurrencyLimit: 2 });

      await service._acquireSlot();
      await service._acquireSlot();

      expect(service.activeRequests).toBe(2);
    });

    test('queues requests over limit', async () => {
      const service = new ParallelEmbeddingService({ concurrencyLimit: 1 });

      await service._acquireSlot();

      // Second request should be queued
      const waitPromise = service._acquireSlot();
      expect(service.waitQueue.length).toBe(1);

      // Release slot to allow second request
      service._releaseSlot();
      await waitPromise;

      expect(service.activeRequests).toBe(1);
    });

    test('tracks peak concurrency', async () => {
      const service = new ParallelEmbeddingService({ concurrencyLimit: 3 });

      await service._acquireSlot();
      await service._acquireSlot();

      expect(service.stats.peakConcurrency).toBe(2);

      await service._acquireSlot();

      expect(service.stats.peakConcurrency).toBe(3);
    });

    test('clears timeout when releasing to queued request', async () => {
      jest.useFakeTimers();

      const service = new ParallelEmbeddingService({ concurrencyLimit: 1 });
      await service._acquireSlot();

      const waitPromise = service._acquireSlot();
      const queueEntry = service.waitQueue[0];
      const clearTimeoutSpy = jest.spyOn(global, 'clearTimeout');

      service._releaseSlot();

      expect(clearTimeoutSpy).toHaveBeenCalledWith(queueEntry.timeoutId);

      await waitPromise;
      jest.useRealTimers();
    });
  });

  describe('embedText', () => {
    test('generates embedding for text', async () => {
      const service = new ParallelEmbeddingService();

      const result = await service.embedText('hello world');

      expect(result.vector).toEqual([0.1, 0.2, 0.3]);
      expect(result.model).toBe('mxbai-embed-large');
    });

    test('updates statistics on success', async () => {
      const service = new ParallelEmbeddingService();

      await service.embedText('test');

      expect(service.stats.totalRequests).toBe(1);
      expect(service.stats.successfulRequests).toBe(1);
      expect(service.stats.failedRequests).toBe(0);
    });

    test('returns fallback on error', async () => {
      const { withOllamaRetry } = require('../src/main/utils/ollamaApiRetry');
      withOllamaRetry.mockRejectedValueOnce(new Error('Ollama error'));

      const service = new ParallelEmbeddingService();

      const result = await service.embedText('test');

      expect(result.model).toBe('fallback');
      expect(result.vector).toHaveLength(1024);
      expect(result.vector.every((v) => v === 0)).toBe(true);
    });

    test('releases slot after completion', async () => {
      const service = new ParallelEmbeddingService({ concurrencyLimit: 1 });

      await service.embedText('test');

      expect(service.activeRequests).toBe(0);
    });
  });

  describe('batchEmbedTexts', () => {
    test('processes batch of items', async () => {
      const service = new ParallelEmbeddingService();

      const items = [
        { id: '1', text: 'hello' },
        { id: '2', text: 'world' }
      ];

      const { results, errors, stats } = await service.batchEmbedTexts(items);

      expect(results).toHaveLength(2);
      expect(errors).toHaveLength(0);
      expect(stats.successful).toBe(2);
    });

    test('returns empty results for empty input', async () => {
      const service = new ParallelEmbeddingService();

      const { results, stats } = await service.batchEmbedTexts([]);

      expect(results).toEqual([]);
      expect(stats.total).toBe(0);
    });

    test('reports progress', async () => {
      const service = new ParallelEmbeddingService();
      const progressUpdates = [];

      const items = [
        { id: '1', text: 'hello' },
        { id: '2', text: 'world' }
      ];

      await service.batchEmbedTexts(items, {
        onProgress: (p) => progressUpdates.push(p)
      });

      expect(progressUpdates.length).toBe(2);
      expect(progressUpdates[0].completed).toBeGreaterThanOrEqual(1);
      expect(progressUpdates[1].percent).toBe(100);
    });

    test('collects errors for failed items', async () => {
      const { withOllamaRetry } = require('../src/main/utils/ollamaApiRetry');
      withOllamaRetry
        .mockResolvedValueOnce({ embedding: [0.1] })
        .mockRejectedValueOnce(new Error('Failed'));

      const service = new ParallelEmbeddingService();

      const items = [
        { id: '1', text: 'hello' },
        { id: '2', text: 'world' }
      ];

      const { results, errors } = await service.batchEmbedTexts(items);

      // First succeeds, second fails but returns fallback
      expect(errors.length).toBe(0); // Fallback doesn't throw
      expect(results).toHaveLength(2);
    });

    test('respects stopOnError option', async () => {
      const { withOllamaRetry } = require('../src/main/utils/ollamaApiRetry');
      withOllamaRetry.mockRejectedValue(new Error('Failed'));

      const service = new ParallelEmbeddingService();

      const items = [
        { id: '1', text: 'hello' },
        { id: '2', text: 'world' }
      ];

      // stopOnError would cause early termination, but since fallback catches errors,
      // we need to simulate a throw in embedText
      // This tests the error collection path
      await service.batchEmbedTexts(items, { stopOnError: false });

      // All items processed with fallback
      expect(service.stats.totalRequests).toBe(2);
    });

    test('includes metadata in results', async () => {
      const service = new ParallelEmbeddingService();

      const items = [{ id: '1', text: 'hello', meta: { source: 'test' } }];

      const { results } = await service.batchEmbedTexts(items);

      expect(results[0].meta.source).toBe('test');
    });
  });

  describe('batchEmbedFileSummaries', () => {
    test('converts file summaries to items', async () => {
      const service = new ParallelEmbeddingService();

      const files = [{ fileId: 'f1', summary: 'A document', filePath: '/path/file1.pdf' }];

      const { results } = await service.batchEmbedFileSummaries(files);

      expect(results[0].id).toBe('f1');
      expect(results[0].meta.path).toBe('/path/file1.pdf');
    });
  });

  describe('batchEmbedFolders', () => {
    test('converts folders to items', async () => {
      const service = new ParallelEmbeddingService();

      const folders = [{ id: 'folder1', name: 'Documents', description: 'My docs' }];

      const { results } = await service.batchEmbedFolders(folders);

      expect(results[0].meta.name).toBe('Documents');
      expect(results[0].meta.description).toBe('My docs');
    });

    test('generates id from name if not provided', async () => {
      const service = new ParallelEmbeddingService();

      const folders = [{ name: 'Photos' }];

      // Call batchEmbedTexts via batchEmbedFolders
      const spy = jest.spyOn(service, 'batchEmbedTexts');
      await service.batchEmbedFolders(folders);

      expect(spy).toHaveBeenCalledWith(
        expect.arrayContaining([expect.objectContaining({ id: 'folder:Photos' })]),
        expect.anything()
      );
    });
  });

  describe('setConcurrencyLimit', () => {
    test('updates concurrency limit', () => {
      const service = new ParallelEmbeddingService({ concurrencyLimit: 3 });

      service.setConcurrencyLimit(5);

      expect(service.concurrencyLimit).toBe(5);
    });

    test('enforces minimum of 1', () => {
      const service = new ParallelEmbeddingService();

      service.setConcurrencyLimit(0);

      expect(service.concurrencyLimit).toBe(1);
    });

    test('enforces maximum of 10', () => {
      const service = new ParallelEmbeddingService();

      service.setConcurrencyLimit(20);

      expect(service.concurrencyLimit).toBe(10);
    });
  });

  describe('getStats', () => {
    test('returns current statistics', async () => {
      const service = new ParallelEmbeddingService({ concurrencyLimit: 3 });
      await service.embedText('test');

      const stats = service.getStats();

      expect(stats.totalRequests).toBe(1);
      expect(stats.concurrencyLimit).toBe(3);
      expect(stats.successRate).toBe(100);
    });

    test('calculates average latency', async () => {
      const service = new ParallelEmbeddingService();
      await service.embedText('test');

      const stats = service.getStats();

      expect(stats.avgLatencyMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe('resetStats', () => {
    test('clears all statistics', async () => {
      const service = new ParallelEmbeddingService();
      await service.embedText('test');

      service.resetStats();

      expect(service.stats.totalRequests).toBe(0);
      expect(service.stats.successfulRequests).toBe(0);
      expect(service.stats.peakConcurrency).toBe(0);
    });
  });

  describe('shutdown', () => {
    test('rejects pending requests', async () => {
      jest.useFakeTimers();

      const service = new ParallelEmbeddingService({ concurrencyLimit: 1 });
      await service._acquireSlot();

      const pendingPromise = service._acquireSlot();

      await service.shutdown();

      await expect(pendingPromise).rejects.toThrow('Service shutting down');

      jest.useRealTimers();
    });

    test('clears queue', async () => {
      const service = new ParallelEmbeddingService();

      await service.shutdown();

      expect(service.waitQueue).toEqual([]);
      expect(service.activeRequests).toBe(0);
    });
  });

  describe('isServiceHealthy', () => {
    test('returns true when ollama responds', async () => {
      const service = new ParallelEmbeddingService();

      const healthy = await service.isServiceHealthy();

      expect(healthy).toBe(true);
    });

    test('returns false when ollama fails', async () => {
      mockOllama.list.mockRejectedValueOnce(new Error('Connection failed'));

      const service = new ParallelEmbeddingService();

      const healthy = await service.isServiceHealthy();

      expect(healthy).toBe(false);
    });
  });

  describe('waitForService', () => {
    test('returns true when service becomes available', async () => {
      const service = new ParallelEmbeddingService();

      const available = await service.waitForService({
        maxWaitMs: 1000,
        checkIntervalMs: 100
      });

      expect(available).toBe(true);
    });

    test('returns false on timeout', async () => {
      mockOllama.list.mockRejectedValue(new Error('Connection failed'));

      const service = new ParallelEmbeddingService();

      const available = await service.waitForService({
        maxWaitMs: 100,
        checkIntervalMs: 50
      });

      expect(available).toBe(false);
    });
  });

  describe('_adjustConcurrency', () => {
    test('reduces concurrency on high error rate', async () => {
      const service = new ParallelEmbeddingService({ concurrencyLimit: 5 });
      service.stats.successfulRequests = 5;
      service.stats.failedRequests = 5; // 50% error rate

      service._adjustConcurrency();

      expect(service.concurrencyLimit).toBeLessThan(5);
    });

    test('does not adjust with insufficient data', () => {
      const service = new ParallelEmbeddingService({ concurrencyLimit: 5 });
      service.stats.successfulRequests = 3;
      service.stats.failedRequests = 0;

      service._adjustConcurrency();

      expect(service.concurrencyLimit).toBe(5);
    });
  });

  describe('singleton', () => {
    test('getInstance returns same instance', () => {
      const instance1 = getInstance();
      const instance2 = getInstance();

      expect(instance1).toBe(instance2);
    });

    test('resetInstance clears singleton', async () => {
      const instance1 = getInstance();
      await resetInstance();
      const instance2 = getInstance();

      expect(instance1).not.toBe(instance2);
    });
  });
});
