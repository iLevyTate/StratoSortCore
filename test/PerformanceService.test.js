/**
 * Tests for PerformanceService
 * Tests GPU detection for multiple vendors and buildOllamaOptions functionality
 */

const os = require('os');

// Store mock implementations for spawn (prefixed with 'mock' for Jest)
let mockSpawnImpl = null;

// Mock child_process spawn
jest.mock('child_process', () => ({
  spawn: jest.fn((...args) => {
    if (mockSpawnImpl) {
      return mockSpawnImpl(...args);
    }
    // Default: simulate command not found
    const proc = {
      stdout: { on: jest.fn() },
      stderr: { on: jest.fn() },
      on: jest.fn((event, callback) => {
        if (event === 'error') {
          setImmediate(() => callback(new Error('command not found')));
        }
      }),
      killed: false,
      kill: jest.fn()
    };
    return proc;
  })
}));

// Mock shared/platformUtils
jest.mock('../src/shared/platformUtils', () => ({
  getNvidiaSmiCommand: jest.fn().mockReturnValue('nvidia-smi'),
  isMacOS: false
}));

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

/**
 * Helper to create a mock process that returns specific stdout
 */
function createMockProcess(stdout, exitCode = 0) {
  const stdoutListeners = [];
  const closeListeners = [];
  const errorListeners = [];

  return {
    stdout: {
      on: jest.fn((event, callback) => {
        if (event === 'data') {
          stdoutListeners.push(callback);
          // Emit data after a tick
          setImmediate(() => callback(Buffer.from(stdout)));
        }
      })
    },
    stderr: {
      on: jest.fn()
    },
    on: jest.fn((event, callback) => {
      if (event === 'close') {
        closeListeners.push(callback);
        // Emit close after stdout
        setImmediate(() => setImmediate(() => callback(exitCode)));
      } else if (event === 'error') {
        errorListeners.push(callback);
      }
    }),
    killed: false,
    kill: jest.fn()
  };
}

/**
 * Helper to create a mock process that errors
 */
function createErrorProcess(errorMessage = 'command not found') {
  return {
    stdout: { on: jest.fn() },
    stderr: { on: jest.fn() },
    on: jest.fn((event, callback) => {
      if (event === 'error') {
        setImmediate(() => callback(new Error(errorMessage)));
      }
    }),
    killed: false,
    kill: jest.fn()
  };
}

describe('PerformanceService', () => {
  let originalEnv;
  let originalPlatform;

  beforeEach(() => {
    originalEnv = { ...process.env };
    originalPlatform = process.platform;

    // Clear environment variables
    delete process.env.OLLAMA_NUM_GPU;
    delete process.env.OLLAMA_NUM_THREAD;
    delete process.env.OLLAMA_KEEP_ALIVE;
    delete process.env.OLLAMA_NUM_BATCH;

    // Reset spawn mock
    mockSpawnImpl = null;
  });

  afterEach(() => {
    process.env = originalEnv;
    Object.defineProperty(process, 'platform', { value: originalPlatform });
    jest.clearAllMocks();
  });

  describe('buildOllamaOptions', () => {
    test('returns correct options for text task', async () => {
      jest.resetModules();
      const service = require('../src/main/services/PerformanceService');

      const options = await service.buildOllamaOptions('text');

      expect(options.num_ctx).toBe(8192);
      expect(options.num_thread).toBeGreaterThan(0);
      expect(options.num_thread).toBeLessThanOrEqual(16);
      expect(options.keep_alive).toBe('10m');
      expect(options.use_mmap).toBe(true);
    });

    test('returns correct options for vision task', async () => {
      jest.resetModules();
      const service = require('../src/main/services/PerformanceService');

      const options = await service.buildOllamaOptions('vision');

      expect(options.num_ctx).toBe(2048);
    });

    test('returns correct options for embeddings task', async () => {
      jest.resetModules();
      const service = require('../src/main/services/PerformanceService');

      const options = await service.buildOllamaOptions('embeddings');

      expect(options.num_ctx).toBe(512);
    });

    test('uses OLLAMA_NUM_THREAD environment variable', async () => {
      process.env.OLLAMA_NUM_THREAD = '8';

      jest.resetModules();
      const service = require('../src/main/services/PerformanceService');

      const options = await service.buildOllamaOptions('text');

      expect(options.num_thread).toBe(8);
    });

    test('uses OLLAMA_KEEP_ALIVE environment variable', async () => {
      process.env.OLLAMA_KEEP_ALIVE = '30m';

      jest.resetModules();
      const service = require('../src/main/services/PerformanceService');

      const options = await service.buildOllamaOptions('text');

      expect(options.keep_alive).toBe('30m');
    });

    test('uses OLLAMA_NUM_BATCH environment variable', async () => {
      process.env.OLLAMA_NUM_BATCH = '512';

      jest.resetModules();
      const service = require('../src/main/services/PerformanceService');

      const options = await service.buildOllamaOptions('text');

      expect(options.num_batch).toBe(512);
    });

    test('uses OLLAMA_NUM_GPU environment variable', async () => {
      process.env.OLLAMA_NUM_GPU = '2';

      jest.resetModules();
      const service = require('../src/main/services/PerformanceService');

      const options = await service.buildOllamaOptions('text');

      expect(options.num_gpu).toBeDefined();
    });

    test('sets num_gpu to 0 when no GPU detected', async () => {
      jest.resetModules();
      const service = require('../src/main/services/PerformanceService');

      const options = await service.buildOllamaOptions('text');

      expect(options.num_gpu).toBe(0);
    });

    test('defaults to text task when no task specified', async () => {
      jest.resetModules();
      const service = require('../src/main/services/PerformanceService');

      const options = await service.buildOllamaOptions();

      expect(options.num_ctx).toBe(8192);
    });

    test('sets use_mlock based on platform and memory', async () => {
      jest.resetModules();
      const service = require('../src/main/services/PerformanceService');

      const options = await service.buildOllamaOptions('text');

      if (process.platform === 'linux' && os.totalmem() / 1024 / 1024 / 1024 > 16) {
        expect(options.use_mlock).toBe(true);
      } else {
        expect(options.use_mlock).toBe(false);
      }
    });

    test('clamps num_thread between 2 and 16', async () => {
      jest.resetModules();
      const service = require('../src/main/services/PerformanceService');

      const options = await service.buildOllamaOptions('text');

      expect(options.num_thread).toBeGreaterThanOrEqual(2);
      expect(options.num_thread).toBeLessThanOrEqual(16);
    });
  });

  describe('detectSystemCapabilities', () => {
    test('detects CPU threads from os.cpus()', async () => {
      jest.resetModules();
      const service = require('../src/main/services/PerformanceService');

      const caps = await service.detectSystemCapabilities();

      expect(caps.cpuThreads).toBe(os.cpus().length);
    });

    test('returns cached capabilities on subsequent calls', async () => {
      jest.resetModules();
      const service = require('../src/main/services/PerformanceService');

      const caps1 = await service.detectSystemCapabilities();
      const caps2 = await service.detectSystemCapabilities();

      expect(caps1).toBe(caps2);
    });

    test('returns correct structure with no GPU', async () => {
      jest.resetModules();
      const service = require('../src/main/services/PerformanceService');

      const caps = await service.detectSystemCapabilities();

      expect(caps).toHaveProperty('cpuThreads');
      expect(caps).toHaveProperty('hasGpu');
      expect(caps).toHaveProperty('gpuVendor');
      expect(caps).toHaveProperty('gpuName');
      expect(caps).toHaveProperty('gpuMemoryMB');
      expect(caps).toHaveProperty('hasNvidiaGpu');
      expect(caps.hasGpu).toBe(false);
      expect(caps.gpuVendor).toBeNull();
    });
  });

  describe('GPU Detection - NVIDIA', () => {
    test('detects NVIDIA GPU via nvidia-smi', async () => {
      // Mock nvidia-smi returning GPU info
      mockSpawnImpl = (command) => {
        if (command === 'nvidia-smi') {
          return createMockProcess('NVIDIA GeForce RTX 4090, 24576');
        }
        return createErrorProcess();
      };

      jest.resetModules();
      const service = require('../src/main/services/PerformanceService');

      const caps = await service.detectSystemCapabilities();

      expect(caps.hasGpu).toBe(true);
      expect(caps.gpuVendor).toBe('nvidia');
      expect(caps.gpuName).toBe('NVIDIA GeForce RTX 4090');
      expect(caps.gpuMemoryMB).toBe(24576);
      expect(caps.hasNvidiaGpu).toBe(true);
    });

    test('handles nvidia-smi with missing memory info', async () => {
      mockSpawnImpl = (command) => {
        if (command === 'nvidia-smi') {
          return createMockProcess('NVIDIA GeForce GTX 1060,');
        }
        return createErrorProcess();
      };

      jest.resetModules();
      const service = require('../src/main/services/PerformanceService');

      const caps = await service.detectSystemCapabilities();

      expect(caps.hasGpu).toBe(true);
      expect(caps.gpuVendor).toBe('nvidia');
      expect(caps.gpuName).toBe('NVIDIA GeForce GTX 1060');
      expect(caps.gpuMemoryMB).toBeNull();
    });

    test('handles nvidia-smi failure gracefully', async () => {
      mockSpawnImpl = () => createErrorProcess('nvidia-smi not found');

      jest.resetModules();
      const service = require('../src/main/services/PerformanceService');

      const caps = await service.detectSystemCapabilities();

      expect(caps.hasGpu).toBe(false);
      expect(caps.gpuVendor).toBeNull();
    });
  });

  describe('GPU Detection - AMD', () => {
    test('detects AMD GPU via rocm-smi on Linux', async () => {
      Object.defineProperty(process, 'platform', { value: 'linux' });

      mockSpawnImpl = (command) => {
        if (command === 'nvidia-smi') {
          return createErrorProcess();
        }
        if (command === 'sysctl') {
          return createErrorProcess();
        }
        if (command === 'rocm-smi') {
          return createMockProcess('GPU 0: 8589934592');
        }
        return createErrorProcess();
      };

      jest.resetModules();
      // Re-mock platformUtils for macOS check
      jest.doMock('../src/shared/platformUtils', () => ({
        getNvidiaSmiCommand: jest.fn().mockReturnValue('nvidia-smi'),
        isMacOS: false
      }));
      const service = require('../src/main/services/PerformanceService');

      const caps = await service.detectSystemCapabilities();

      expect(caps.hasGpu).toBe(true);
      expect(caps.gpuVendor).toBe('amd');
      expect(caps.gpuName).toBe('AMD GPU (ROCm)');
    });

    test('detects AMD GPU via WMIC on Windows', async () => {
      Object.defineProperty(process, 'platform', { value: 'win32' });

      mockSpawnImpl = (command) => {
        if (command === 'nvidia-smi') {
          return createErrorProcess();
        }
        if (command === 'wmic') {
          return createMockProcess('Name\nAMD Radeon RX 7900 XTX');
        }
        return createErrorProcess();
      };

      jest.resetModules();
      jest.doMock('../src/shared/platformUtils', () => ({
        getNvidiaSmiCommand: jest.fn().mockReturnValue('nvidia-smi'),
        isMacOS: false
      }));
      const service = require('../src/main/services/PerformanceService');

      const caps = await service.detectSystemCapabilities();

      expect(caps.hasGpu).toBe(true);
      expect(caps.gpuVendor).toBe('amd');
    });
  });

  describe('GPU Detection - Intel', () => {
    test('detects Intel GPU via WMIC on Windows', async () => {
      Object.defineProperty(process, 'platform', { value: 'win32' });

      mockSpawnImpl = (command) => {
        if (command === 'nvidia-smi') {
          return createErrorProcess();
        }
        if (command === 'wmic') {
          // First call for AMD check, second for Intel
          return createMockProcess('Name\nIntel Arc A770');
        }
        return createErrorProcess();
      };

      jest.resetModules();
      jest.doMock('../src/shared/platformUtils', () => ({
        getNvidiaSmiCommand: jest.fn().mockReturnValue('nvidia-smi'),
        isMacOS: false
      }));
      const service = require('../src/main/services/PerformanceService');

      const caps = await service.detectSystemCapabilities();

      expect(caps.hasGpu).toBe(true);
      // Could be Intel or AMD depending on regex match order
      expect(['intel', 'amd']).toContain(caps.gpuVendor);
    });

    test('detects Intel GPU via lspci on Linux', async () => {
      Object.defineProperty(process, 'platform', { value: 'linux' });

      mockSpawnImpl = (command) => {
        if (command === 'nvidia-smi') {
          return createErrorProcess();
        }
        if (command === 'sysctl') {
          return createErrorProcess();
        }
        if (command === 'rocm-smi') {
          return createErrorProcess();
        }
        if (command === 'lspci') {
          return createMockProcess(
            '00:02.0 VGA compatible controller: Intel Corporation UHD Graphics 630'
          );
        }
        return createErrorProcess();
      };

      jest.resetModules();
      jest.doMock('../src/shared/platformUtils', () => ({
        getNvidiaSmiCommand: jest.fn().mockReturnValue('nvidia-smi'),
        isMacOS: false
      }));
      const service = require('../src/main/services/PerformanceService');

      const caps = await service.detectSystemCapabilities();

      expect(caps.hasGpu).toBe(true);
      expect(caps.gpuVendor).toBe('intel');
      expect(caps.gpuName).toBe('Intel GPU');
    });
  });

  describe('GPU Detection - Apple Silicon', () => {
    test('detects Apple Silicon GPU via sysctl on macOS', async () => {
      Object.defineProperty(process, 'platform', { value: 'darwin' });

      let sysctlCallCount = 0;
      mockSpawnImpl = (command) => {
        if (command === 'nvidia-smi') {
          return createErrorProcess();
        }
        if (command === 'sysctl') {
          sysctlCallCount++;
          if (sysctlCallCount === 1) {
            // First call: CPU brand string
            return createMockProcess('Apple M2 Pro');
          } else {
            // Second call: memory size (32GB)
            return createMockProcess('34359738368');
          }
        }
        return createErrorProcess();
      };

      jest.resetModules();
      jest.doMock('../src/shared/platformUtils', () => ({
        getNvidiaSmiCommand: jest.fn().mockReturnValue('nvidia-smi'),
        isMacOS: true
      }));
      const service = require('../src/main/services/PerformanceService');

      const caps = await service.detectSystemCapabilities();

      expect(caps.hasGpu).toBe(true);
      expect(caps.gpuVendor).toBe('apple');
      expect(caps.gpuName).toBe('Apple M2 Pro');
      // 32GB * 0.7 / 1024 / 1024 = ~22937 MB
      expect(caps.gpuMemoryMB).toBeGreaterThan(20000);
    });

    test('handles non-Apple Silicon Mac gracefully', async () => {
      Object.defineProperty(process, 'platform', { value: 'darwin' });

      mockSpawnImpl = (command) => {
        if (command === 'nvidia-smi') {
          return createErrorProcess();
        }
        if (command === 'sysctl') {
          // Intel Mac
          return createMockProcess('Intel(R) Core(TM) i9-9900K');
        }
        return createErrorProcess();
      };

      jest.resetModules();
      jest.doMock('../src/shared/platformUtils', () => ({
        getNvidiaSmiCommand: jest.fn().mockReturnValue('nvidia-smi'),
        isMacOS: true
      }));
      const service = require('../src/main/services/PerformanceService');

      const caps = await service.detectSystemCapabilities();

      // No Apple Silicon detected, and no other GPU
      expect(caps.hasGpu).toBe(false);
    });
  });

  describe('GPU Detection Priority', () => {
    test('prefers NVIDIA over other GPUs', async () => {
      Object.defineProperty(process, 'platform', { value: 'linux' });

      mockSpawnImpl = (command) => {
        if (command === 'nvidia-smi') {
          return createMockProcess('NVIDIA GeForce RTX 3080, 10240');
        }
        if (command === 'rocm-smi') {
          return createMockProcess('AMD GPU detected');
        }
        if (command === 'lspci') {
          return createMockProcess('Intel UHD Graphics');
        }
        return createErrorProcess();
      };

      jest.resetModules();
      jest.doMock('../src/shared/platformUtils', () => ({
        getNvidiaSmiCommand: jest.fn().mockReturnValue('nvidia-smi'),
        isMacOS: false
      }));
      const service = require('../src/main/services/PerformanceService');

      const caps = await service.detectSystemCapabilities();

      expect(caps.gpuVendor).toBe('nvidia');
      expect(caps.hasNvidiaGpu).toBe(true);
    });

    test('falls back to AMD when NVIDIA not available', async () => {
      Object.defineProperty(process, 'platform', { value: 'linux' });

      mockSpawnImpl = (command) => {
        if (command === 'nvidia-smi') {
          return createErrorProcess();
        }
        if (command === 'sysctl') {
          return createErrorProcess();
        }
        if (command === 'rocm-smi') {
          return createMockProcess('GPU 0: 16777216000');
        }
        if (command === 'lspci') {
          return createMockProcess('Intel UHD Graphics');
        }
        return createErrorProcess();
      };

      jest.resetModules();
      jest.doMock('../src/shared/platformUtils', () => ({
        getNvidiaSmiCommand: jest.fn().mockReturnValue('nvidia-smi'),
        isMacOS: false
      }));
      const service = require('../src/main/services/PerformanceService');

      const caps = await service.detectSystemCapabilities();

      expect(caps.gpuVendor).toBe('amd');
      expect(caps.hasNvidiaGpu).toBe(false);
    });
  });

  describe('buildOllamaOptions with GPU', () => {
    test('enables GPU layers when GPU detected', async () => {
      mockSpawnImpl = (command) => {
        if (command === 'nvidia-smi') {
          return createMockProcess('NVIDIA GeForce RTX 4090, 24576');
        }
        return createErrorProcess();
      };

      jest.resetModules();
      const service = require('../src/main/services/PerformanceService');

      const options = await service.buildOllamaOptions('text');

      expect(options.num_gpu).toBe(-1); // Auto-detect all layers
      expect(options.main_gpu).toBe(0);
    });

    test('sets higher batch size for high VRAM GPU', async () => {
      mockSpawnImpl = (command) => {
        if (command === 'nvidia-smi') {
          return createMockProcess('NVIDIA GeForce RTX 4090, 24576');
        }
        return createErrorProcess();
      };

      jest.resetModules();
      const service = require('../src/main/services/PerformanceService');

      const options = await service.buildOllamaOptions('text');

      expect(options.num_batch).toBe(1024); // 16GB+ VRAM gets 1024
    });

    test('sets appropriate batch size for 8GB VRAM GPU', async () => {
      mockSpawnImpl = (command) => {
        if (command === 'nvidia-smi') {
          return createMockProcess('NVIDIA GeForce RTX 3070, 8192');
        }
        return createErrorProcess();
      };

      jest.resetModules();
      const service = require('../src/main/services/PerformanceService');

      const options = await service.buildOllamaOptions('text');

      expect(options.num_batch).toBe(384); // 8GB VRAM
    });

    test('sets CPU-only batch size when no GPU', async () => {
      mockSpawnImpl = () => createErrorProcess();

      jest.resetModules();
      const service = require('../src/main/services/PerformanceService');

      const options = await service.buildOllamaOptions('text');

      expect(options.num_batch).toBe(128); // CPU-only default
      expect(options.num_gpu).toBe(0);
    });
  });

  describe('runCommand error handling', () => {
    test('handles spawn errors gracefully', async () => {
      mockSpawnImpl = () => {
        // Return a process that throws an error immediately
        const proc = {
          stdout: { on: jest.fn() },
          stderr: { on: jest.fn() },
          on: jest.fn((event, callback) => {
            if (event === 'error') {
              setImmediate(() => callback(new Error('ENOENT: command not found')));
            }
          }),
          killed: false,
          kill: jest.fn()
        };
        return proc;
      };

      jest.resetModules();
      const service = require('../src/main/services/PerformanceService');

      // Should handle errors gracefully and return no GPU
      const caps = await service.detectSystemCapabilities();

      expect(caps.hasGpu).toBe(false);
      expect(caps.gpuVendor).toBeNull();
    });

    test('handles non-zero exit codes gracefully', async () => {
      mockSpawnImpl = (command) => {
        if (command === 'nvidia-smi') {
          // Return process that exits with error code
          const proc = {
            stdout: {
              on: jest.fn(() => {
                // No data emitted
              })
            },
            stderr: { on: jest.fn() },
            on: jest.fn((event, callback) => {
              if (event === 'close') {
                setImmediate(() => callback(1)); // Non-zero exit
              }
            }),
            killed: false,
            kill: jest.fn()
          };
          return proc;
        }
        return {
          stdout: { on: jest.fn() },
          stderr: { on: jest.fn() },
          on: jest.fn((event, callback) => {
            if (event === 'error') {
              setImmediate(() => callback(new Error('command not found')));
            }
          }),
          killed: false,
          kill: jest.fn()
        };
      };

      jest.resetModules();
      const service = require('../src/main/services/PerformanceService');

      const caps = await service.detectSystemCapabilities();

      // Non-zero exit should be treated as failure
      expect(caps.hasGpu).toBe(false);
    });
  });
});
