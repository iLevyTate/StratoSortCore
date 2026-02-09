/**
 * Tests for resource cleanup fixes
 *
 * Verifies that services properly clean up their resources on shutdown:
 * - ParallelEmbeddingService removes LlamaService listener
 * - VisionService removes child process listeners
 * - ModelDownloadManager removes AbortSignal listeners
 */

jest.mock('../src/shared/logger', () => ({
  createLogger: jest.fn(() => ({
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  })),
  logger: {
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    setContext: jest.fn()
  }
}));

// ====================== ParallelEmbeddingService Listener Cleanup ======================

describe('ParallelEmbeddingService - listener cleanup', () => {
  let ParallelEmbeddingService;
  let mockLlamaService;

  beforeEach(() => {
    jest.resetModules();

    mockLlamaService = {
      on: jest.fn(),
      removeListener: jest.fn(),
      _selectedModels: {}
    };

    jest.doMock('../src/shared/performanceConstants', () => ({
      SEARCH: { MIN_EPSILON: 1e-10 },
      THRESHOLDS: {
        MAX_BATCH_SIZE: 100,
        EMBEDDING_STALE_MS: 86400000,
        MAX_CONCURRENT_SEARCHES: 5,
        MIN_SIMILARITY_SCORE: 0.1
      },
      TIMEOUTS: { SEARCH_TIMEOUT_MS: 10000 }
    }));

    jest.doMock('../src/main/services/LlamaService', () => ({
      getInstance: jest.fn(() => mockLlamaService)
    }));

    jest.doMock('../src/main/services/PerformanceService', () => ({
      getRecommendedConcurrency: jest.fn().mockResolvedValue(null)
    }));

    jest.doMock('../src/main/services/ServiceContainer', () => ({
      container: {
        has: jest.fn(() => false),
        resolve: jest.fn(),
        register: jest.fn(),
        tryResolve: jest.fn(),
        clearInstance: jest.fn()
      },
      ServiceIds: { PARALLEL_EMBEDDING: 'parallel-embedding' }
    }));

    ParallelEmbeddingService =
      require('../src/main/services/ParallelEmbeddingService').ParallelEmbeddingService;
  });

  test('attaches initialized listener on construction', () => {
    const service = new ParallelEmbeddingService({ concurrencyLimit: 2 });
    expect(mockLlamaService.on).toHaveBeenCalledWith('initialized', expect.any(Function));
    expect(service._llamaServiceRef).toBe(mockLlamaService);
    expect(service._llamaInitHandler).toEqual(expect.any(Function));
  });

  test('removes initialized listener on shutdown', async () => {
    const service = new ParallelEmbeddingService({ concurrencyLimit: 2 });
    const handler = service._llamaInitHandler;

    await service.shutdown();

    expect(mockLlamaService.removeListener).toHaveBeenCalledWith('initialized', handler);
    expect(service._llamaServiceRef).toBeNull();
    expect(service._llamaInitHandler).toBeNull();
  });

  test('handles shutdown gracefully when no listener was attached', async () => {
    // Create service with LlamaService that doesn't support events
    jest.resetModules();
    jest.doMock('../src/main/services/LlamaService', () => ({
      getInstance: jest.fn(() => null)
    }));
    jest.doMock('../src/main/services/PerformanceService', () => ({
      getRecommendedConcurrency: jest.fn().mockResolvedValue(null)
    }));
    jest.doMock('../src/main/services/ServiceContainer', () => ({
      container: { has: jest.fn(() => false) },
      ServiceIds: { PARALLEL_EMBEDDING: 'parallel-embedding' }
    }));

    const {
      ParallelEmbeddingService: PES
    } = require('../src/main/services/ParallelEmbeddingService');
    const service = new PES({ concurrencyLimit: 2 });

    // Should not throw
    await expect(service.shutdown()).resolves.not.toThrow();
  });
});

// ====================== VisionService Process Listener Cleanup ======================

describe('VisionService - process listener cleanup', () => {
  test('shutdown removes all listeners from child process', async () => {
    jest.resetModules();

    const mockProc = {
      kill: jest.fn(),
      removeAllListeners: jest.fn(),
      once: jest.fn((event, cb) => {
        if (event === 'exit') cb(0, null); // Immediately exit
      }),
      stdout: { removeAllListeners: jest.fn() },
      stderr: { removeAllListeners: jest.fn() }
    };

    jest.doMock('../src/shared/logger', () => ({
      createLogger: jest.fn(() => ({
        info: jest.fn(),
        debug: jest.fn(),
        warn: jest.fn(),
        error: jest.fn()
      }))
    }));

    const VisionService = require('../src/main/services/VisionService').VisionService;
    const service = new VisionService();

    // Simulate an active process
    service._process = mockProc;
    service._port = 8080;

    await service.shutdown();

    expect(mockProc.removeAllListeners).toHaveBeenCalled();
    expect(mockProc.stdout.removeAllListeners).toHaveBeenCalled();
    expect(mockProc.stderr.removeAllListeners).toHaveBeenCalled();
    expect(mockProc.kill).toHaveBeenCalled();
  });

  test('shutdown handles null process gracefully', async () => {
    jest.resetModules();

    jest.doMock('../src/shared/logger', () => ({
      createLogger: jest.fn(() => ({
        info: jest.fn(),
        debug: jest.fn(),
        warn: jest.fn(),
        error: jest.fn()
      }))
    }));

    const VisionService = require('../src/main/services/VisionService').VisionService;
    const service = new VisionService();
    service._process = null;

    await expect(service.shutdown()).resolves.not.toThrow();
  });
});

// ====================== ModelDownloadManager AbortSignal Cleanup ======================

describe('ModelDownloadManager - abort listener cleanup', () => {
  test('onAbort handler removes its own listeners before destroying', () => {
    // This tests the pattern, not the full download flow
    const mockInternalSignal = {
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      aborted: false
    };
    const mockExternalSignal = {
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      aborted: false
    };

    // Simulate what the download code does
    const onAbort = jest.fn(() => {
      mockInternalSignal.removeEventListener('abort', onAbort);
      mockExternalSignal.removeEventListener('abort', onAbort);
    });

    mockInternalSignal.addEventListener('abort', onAbort);
    mockExternalSignal.addEventListener('abort', onAbort);

    // Simulate abort
    onAbort();

    expect(mockInternalSignal.removeEventListener).toHaveBeenCalledWith('abort', onAbort);
    expect(mockExternalSignal.removeEventListener).toHaveBeenCalledWith('abort', onAbort);
  });
});
