/**
 * Tests for OllamaClient
 * Tests resilient Ollama API client with retry, offline queue, and health monitoring
 */

// Mock electron
jest.mock('electron', () => ({
  app: {
    getPath: jest.fn().mockReturnValue('/tmp/test-app')
  }
}));

// Mock fs
const mockFs = {
  readFile: jest.fn(),
  writeFile: jest.fn().mockResolvedValue(undefined),
  unlink: jest.fn().mockResolvedValue(undefined),
  rename: jest.fn().mockResolvedValue(undefined),
  access: jest.fn()
};
jest.mock('fs', () => ({
  promises: mockFs
}));

// Mock atomicFile module to use the same fs mocks
jest.mock('../src/shared/atomicFile', () => {
  const fs = require('fs').promises;
  return {
    atomicWriteFile: jest.fn(async (filePath, data, options = {}) => {
      const { pretty = false } = options;
      const tempPath = `${filePath}.tmp.${Date.now()}`;
      const content = pretty ? JSON.stringify(data, null, 2) : JSON.stringify(data);
      await fs.writeFile(tempPath, content, 'utf8');
      await fs.rename(tempPath, filePath);
    }),
    loadJsonFile: jest.fn(async (filePath) => {
      try {
        const data = await fs.readFile(filePath, 'utf8');
        return JSON.parse(data);
      } catch (e) {
        if (e.code === 'ENOENT') return null;
        throw e;
      }
    }),
    safeUnlink: jest.fn(async (filePath) => {
      try {
        await fs.unlink(filePath);
      } catch (e) {
        if (e.code !== 'ENOENT') throw e;
      }
    })
  };
});

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

// Mock ollama
const mockOllama = {
  embeddings: jest.fn(), // Legacy API (deprecated)
  embed: jest.fn(), // New API
  generate: jest.fn(),
  list: jest.fn()
};

jest.mock('../src/main/ollamaUtils', () => ({
  getOllama: jest.fn(() => mockOllama)
}));

describe('OllamaClient', () => {
  let OllamaClient;
  let getInstance;
  let resetInstance;
  let REQUEST_TYPES;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
    jest.useFakeTimers();

    mockFs.readFile.mockRejectedValue({ code: 'ENOENT' });
    mockOllama.list.mockResolvedValue({ models: [] });
    // New API uses embed() with embeddings array response
    mockOllama.embed.mockResolvedValue({ embeddings: [[0.1, 0.2, 0.3]] });
    mockOllama.generate.mockResolvedValue({ response: 'test' });

    const module = require('../src/main/services/OllamaClient');
    OllamaClient = module.OllamaClient;
    getInstance = module.getInstance;
    resetInstance = module.resetInstance;
    REQUEST_TYPES = module.REQUEST_TYPES;
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('constructor', () => {
    test('creates instance with default config', () => {
      const client = new OllamaClient();

      expect(client.config.maxRetries).toBe(3);
      expect(client.config.maxConcurrentRequests).toBe(5);
      expect(client.initialized).toBe(false);
      expect(client.isHealthy).toBe(false);
    });

    test('accepts custom options', () => {
      const client = new OllamaClient({
        maxRetries: 5,
        maxConcurrentRequests: 10
      });

      expect(client.config.maxRetries).toBe(5);
      expect(client.config.maxConcurrentRequests).toBe(10);
    });

    test('initializes stats object', () => {
      const client = new OllamaClient();

      expect(client.stats.totalRequests).toBe(0);
      expect(client.stats.successfulRequests).toBe(0);
      expect(client.stats.failedRequests).toBe(0);
    });
  });

  describe('initialize', () => {
    test('sets up offline queue path', async () => {
      const client = new OllamaClient();
      await client.initialize();

      expect(client.offlineQueuePath).toContain('ollama_offline_queue.json');
    });

    test('performs initial health check', async () => {
      const client = new OllamaClient();
      await client.initialize();

      expect(mockOllama.list).toHaveBeenCalled();
      expect(client.isHealthy).toBe(true);
    });

    test('marks as initialized even on partial failure', async () => {
      mockOllama.list.mockRejectedValueOnce(new Error('Connection failed'));

      const client = new OllamaClient();
      await client.initialize();

      expect(client.initialized).toBe(true);
    });

    test('loads persisted offline queue', async () => {
      const queueData = [{ type: 'embedding', payload: { model: 'test', prompt: 'hello' } }];
      mockFs.readFile.mockResolvedValueOnce(JSON.stringify(queueData));

      const client = new OllamaClient();
      await client.initialize();

      expect(client.offlineQueue).toHaveLength(1);
    });

    test('does not reinitialize if already initialized', async () => {
      const client = new OllamaClient();
      await client.initialize();
      mockOllama.list.mockClear();

      await client.initialize();

      expect(mockOllama.list).not.toHaveBeenCalled();
    });
  });

  describe('shutdown', () => {
    test('stops health monitoring', async () => {
      const client = new OllamaClient();
      await client.initialize();

      await client.shutdown();

      expect(client.healthCheckTimer).toBeNull();
    });

    test('persists offline queue', async () => {
      const client = new OllamaClient();
      await client.initialize();
      client.offlineQueue = [{ type: 'test', payload: {} }];

      await client.shutdown();

      expect(mockFs.writeFile).toHaveBeenCalled();
    });
  });

  // Note: calculateDelayWithJitter and isRetryableError tests are in ollamaApiRetry.test.js
  // OllamaClient uses these shared functions from ollamaApiRetry

  describe('concurrency control', () => {
    test('allows requests up to concurrency limit', async () => {
      const client = new OllamaClient({ maxConcurrentRequests: 2 });

      await client._acquireSlot();
      await client._acquireSlot();

      // Uses shared Semaphore - check via getStats()
      const stats = client.semaphore.getStats();
      expect(stats.activeCount).toBe(2);
    });

    test('queues requests over concurrency limit', async () => {
      const client = new OllamaClient({ maxConcurrentRequests: 1 });

      await client._acquireSlot();

      const waitPromise = client._acquireSlot();
      // Uses shared Semaphore - check via getStats()
      expect(client.semaphore.getStats().queueLength).toBe(1);

      client._releaseSlot();
      jest.runAllTimers();

      await waitPromise;
      expect(client.semaphore.getStats().activeCount).toBe(1);
    });

    test('throws when queue is full', async () => {
      const client = new OllamaClient({
        maxConcurrentRequests: 1,
        maxQueuedRequests: 1
      });

      await client._acquireSlot();
      client._acquireSlot(); // Goes to queue

      await expect(client._acquireSlot()).rejects.toThrow('Request queue full');
    });
  });

  describe('embeddings', () => {
    test('generates embeddings successfully', async () => {
      const client = new OllamaClient();
      await client.initialize();

      const result = await client.embeddings({
        model: 'test-model',
        prompt: 'hello world'
      });

      expect(result.embedding).toEqual([0.1, 0.2, 0.3]);
      expect(client.stats.successfulRequests).toBe(1);
    });

    test('auto-initializes if not initialized', async () => {
      const client = new OllamaClient();

      await client.embeddings({
        model: 'test-model',
        prompt: 'hello'
      });

      expect(client.initialized).toBe(true);
    });

    test('retries on retryable error', async () => {
      jest.useRealTimers(); // Need real timers for retry delays

      // New API: mock embed() which is called internally
      mockOllama.embed
        .mockRejectedValueOnce(new Error('fetch failed'))
        .mockResolvedValueOnce({ embeddings: [[0.1]] });

      const client = new OllamaClient({ maxRetries: 1, initialRetryDelay: 10 });
      await client.initialize();

      // Public API is still embeddings() for backward compatibility
      const result = await client.embeddings({
        model: 'test',
        prompt: 'hello'
      });

      expect(result.embedding).toEqual([0.1]);
      expect(client.stats.retriedRequests).toBe(1);
    });

    test('adds to offline queue when unhealthy', async () => {
      // New API: mock embed() which is called internally
      mockOllama.embed.mockRejectedValue(new Error('fetch failed'));

      const client = new OllamaClient({ maxRetries: 0 });
      await client.initialize();
      client.isHealthy = false;

      await expect(client.embeddings({ model: 'test', prompt: 'hello' })).rejects.toThrow();

      expect(client.offlineQueue).toHaveLength(1);
    });
  });

  describe('generate', () => {
    test('generates text successfully', async () => {
      const client = new OllamaClient();
      await client.initialize();

      const result = await client.generate({
        model: 'test-model',
        prompt: 'hello'
      });

      expect(result.response).toBe('test');
    });

    test('does not queue streaming requests', async () => {
      mockOllama.generate.mockRejectedValue(new Error('fetch failed'));

      const client = new OllamaClient({ maxRetries: 0 });
      await client.initialize();
      client.isHealthy = false;

      await expect(
        client.generate({ model: 'test', prompt: 'hello', stream: true })
      ).rejects.toThrow();

      expect(client.offlineQueue).toHaveLength(0);
    });
  });

  describe('batchEmbeddings', () => {
    test('processes batch of embeddings', async () => {
      const client = new OllamaClient();
      await client.initialize();

      const items = [
        { id: '1', text: 'hello' },
        { id: '2', text: 'world' }
      ];

      const { results, errors } = await client.batchEmbeddings(items, {
        model: 'test'
      });

      expect(results).toHaveLength(2);
      expect(errors).toHaveLength(0);
    });

    test('reports progress', async () => {
      const client = new OllamaClient();
      await client.initialize();

      const progressUpdates = [];
      const items = [
        { id: '1', text: 'hello' },
        { id: '2', text: 'world' }
      ];

      await client.batchEmbeddings(items, {
        model: 'test',
        onProgress: (p) => progressUpdates.push(p)
      });

      expect(progressUpdates.length).toBeGreaterThan(0);
    });

    test('collects errors for failed items', async () => {
      // New API: mock embed() which is called internally
      mockOllama.embed
        .mockResolvedValueOnce({ embeddings: [[0.1]] })
        .mockRejectedValueOnce(new Error('bad request'));

      const client = new OllamaClient({ maxRetries: 0 });
      await client.initialize();

      const items = [
        { id: '1', text: 'hello' },
        { id: '2', text: 'world' }
      ];

      const { results, errors } = await client.batchEmbeddings(items, {
        model: 'test'
      });

      expect(results).toHaveLength(1);
      expect(errors).toHaveLength(1);
    });
  });

  describe('health monitoring', () => {
    test('getHealthStatus returns current state', async () => {
      const client = new OllamaClient();
      await client.initialize();

      const status = client.getHealthStatus();

      expect(status.isHealthy).toBe(true);
      expect(status.consecutiveFailures).toBe(0);
      expect(status.lastHealthCheck).toBeDefined();
    });

    test('marks unhealthy after consecutive failures', async () => {
      mockOllama.list.mockRejectedValue(new Error('Connection failed'));

      const client = new OllamaClient({ unhealthyThreshold: 2 });

      await client._performHealthCheck();
      expect(client.isHealthy).toBe(false); // Still healthy

      await client._performHealthCheck();
      expect(client.isHealthy).toBe(false); // Now unhealthy
    });

    test('recovers health on success', async () => {
      const client = new OllamaClient();
      client.consecutiveFailures = 5;
      client.isHealthy = false;

      await client._performHealthCheck();

      expect(client.isHealthy).toBe(true);
      expect(client.consecutiveFailures).toBe(0);
    });
  });

  describe('offline queue', () => {
    test('persists queue on add', async () => {
      jest.useRealTimers(); // Need real timers for async persist

      const client = new OllamaClient();
      await client.initialize();

      client._addToOfflineQueue({
        type: REQUEST_TYPES.EMBEDDING,
        payload: { model: 'test', prompt: 'hello' }
      });

      // Wait for async persist
      await new Promise((r) => setTimeout(r, 50));

      expect(mockFs.writeFile).toHaveBeenCalled();

      // Restore fake timers for other tests
      jest.useFakeTimers();
    });

    test('drops oldest entries when queue is full', async () => {
      const client = new OllamaClient({ maxOfflineQueueSize: 3 });
      await client.initialize();

      client.offlineQueue = [{ id: 1 }, { id: 2 }, { id: 3 }];

      client._addToOfflineQueue({ id: 4 });

      expect(client.offlineQueue.length).toBeLessThanOrEqual(3);
    });
  });

  describe('statistics', () => {
    test('getStats returns all statistics', async () => {
      const client = new OllamaClient();
      await client.initialize();

      await client.embeddings({ model: 'test', prompt: 'hello' });

      const stats = client.getStats();

      expect(stats.totalRequests).toBe(1);
      expect(stats.successfulRequests).toBe(1);
      expect(stats.isHealthy).toBe(true);
    });

    test('resetStats clears all statistics', async () => {
      const client = new OllamaClient();
      client.stats.totalRequests = 100;
      client.stats.failedRequests = 50;

      client.resetStats();

      expect(client.stats.totalRequests).toBe(0);
      expect(client.stats.failedRequests).toBe(0);
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

  describe('REQUEST_TYPES', () => {
    test('defines expected request types', () => {
      expect(REQUEST_TYPES.EMBEDDING).toBe('embedding');
      expect(REQUEST_TYPES.GENERATE).toBe('generate');
      expect(REQUEST_TYPES.VISION).toBe('vision');
      expect(REQUEST_TYPES.LIST).toBe('list');
    });
  });
});
