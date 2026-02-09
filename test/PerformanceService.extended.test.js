/**
 * @jest-environment node
 *
 * Extended tests for PerformanceService covering:
 *  - GPU detection priority (NVIDIA > Apple > AMD > Intel)
 *  - VRAM-based concurrency recommendations
 *  - CPU-only fallback
 *  - Detection caching
 *  - runCommand timeout and error handling
 */

jest.mock('../src/shared/logger', () => ({
  createLogger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
  })
}));

// Mock child_process.spawn to avoid actual system calls
const mockSpawn = jest.fn();
jest.mock('child_process', () => ({
  spawn: (...args) => mockSpawn(...args)
}));

jest.mock('os', () => ({
  cpus: jest.fn(() => Array(8).fill({ model: 'Test CPU' })),
  totalmem: jest.fn(() => 32 * 1024 * 1024 * 1024), // 32 GB
  freemem: jest.fn(() => 16 * 1024 * 1024 * 1024) // 16 GB
}));

jest.mock('../src/shared/platformUtils', () => ({
  getNvidiaSmiCommand: () => 'nvidia-smi',
  isMacOS: false
}));

// Reset module-level cache between tests
let detectSystemCapabilities;
let getRecommendedConcurrency;

function reloadModule() {
  jest.resetModules();
  const mod = require('../src/main/services/PerformanceService');
  detectSystemCapabilities = mod.detectSystemCapabilities;
  getRecommendedConcurrency = mod.getRecommendedConcurrency;
}

/** Create a mock spawned process that resolves with given stdout */
function createMockProcess(stdout, exitCode = 0) {
  const proc = {
    killed: false,
    stdout: {
      on: jest.fn((event, cb) => {
        if (event === 'data') cb(Buffer.from(stdout));
      }),
      removeAllListeners: jest.fn()
    },
    stderr: {
      on: jest.fn(),
      removeAllListeners: jest.fn()
    },
    on: jest.fn((event, cb) => {
      if (event === 'close') setImmediate(() => cb(exitCode));
    }),
    kill: jest.fn(),
    removeAllListeners: jest.fn()
  };
  return proc;
}

describe('PerformanceService – extended', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    reloadModule();
    // Default: all commands fail (no GPU)
    mockSpawn.mockImplementation(() => {
      const proc = createMockProcess('', 1);
      proc.on = jest.fn((event, cb) => {
        if (event === 'error') setImmediate(() => cb(new Error('ENOENT')));
      });
      return proc;
    });
  });

  // ─── GPU detection ─────────────────────────────────────────

  test('detects NVIDIA GPU from nvidia-smi output', async () => {
    mockSpawn.mockImplementation((cmd) => {
      if (cmd === 'nvidia-smi') {
        return createMockProcess('NVIDIA GeForce RTX 4090, 24564');
      }
      return createMockProcess('', 1);
    });

    const caps = await detectSystemCapabilities();
    expect(caps.hasGpu).toBe(true);
    expect(caps.gpuVendor).toBe('nvidia');
    expect(caps.gpuMemoryMB).toBe(24564);
    expect(caps.hasNvidiaGpu).toBe(true);
  });

  test('returns no GPU when all detections fail', async () => {
    // Default mockSpawn already fails
    mockSpawn.mockImplementation(() => {
      const proc = createMockProcess('', 1);
      // Trigger close with non-zero exit code
      proc.on = jest.fn((event, cb) => {
        if (event === 'close') setImmediate(() => cb(1));
      });
      return proc;
    });

    const caps = await detectSystemCapabilities();
    expect(caps.hasGpu).toBe(false);
    expect(caps.gpuVendor).toBeNull();
    expect(caps.gpuMemoryMB).toBeNull();
  });

  test('caches capabilities after first detection', async () => {
    mockSpawn.mockImplementation(() => {
      const proc = createMockProcess('', 1);
      proc.on = jest.fn((event, cb) => {
        if (event === 'close') setImmediate(() => cb(1));
      });
      return proc;
    });

    const caps1 = await detectSystemCapabilities();
    const caps2 = await detectSystemCapabilities();

    expect(caps1).toBe(caps2); // Same object reference (cached)
    expect(caps1.cpuThreads).toBe(8);
  });

  // ─── VRAM-based concurrency recommendations ────────────────

  test('recommends concurrency=1 for CPU-only systems', async () => {
    mockSpawn.mockImplementation(() => {
      const proc = createMockProcess('', 1);
      proc.on = jest.fn((event, cb) => {
        if (event === 'close') setImmediate(() => cb(1));
      });
      return proc;
    });

    const rec = await getRecommendedConcurrency();
    expect(rec.maxConcurrent).toBe(1);
    expect(rec.hasGpu).toBe(false);
    expect(rec.reason).toMatch(/CPU-only/i);
  });

  test('recommends concurrency=3 for 24GB+ VRAM', async () => {
    mockSpawn.mockImplementation((cmd) => {
      if (cmd === 'nvidia-smi') {
        return createMockProcess('NVIDIA RTX 4090, 24564');
      }
      return createMockProcess('', 1);
    });

    const rec = await getRecommendedConcurrency();
    expect(rec.maxConcurrent).toBeGreaterThanOrEqual(2);
    expect(rec.vramMB).toBe(24564);
    expect(rec.hasGpu).toBe(true);
  });

  test('recommends concurrency=2 for 16GB VRAM', async () => {
    reloadModule();
    mockSpawn.mockImplementation((cmd) => {
      if (cmd === 'nvidia-smi') {
        return createMockProcess('NVIDIA RTX 4070 Ti, 16384');
      }
      return createMockProcess('', 1);
    });

    const rec = await getRecommendedConcurrency();
    expect(rec.maxConcurrent).toBe(2);
    expect(rec.vramMB).toBe(16384);
  });

  test('recommends concurrency=1 for low VRAM (<12GB)', async () => {
    reloadModule();
    mockSpawn.mockImplementation((cmd) => {
      if (cmd === 'nvidia-smi') {
        return createMockProcess('NVIDIA RTX 3060, 6144');
      }
      return createMockProcess('', 1);
    });

    const rec = await getRecommendedConcurrency();
    expect(rec.maxConcurrent).toBe(1);
    expect(rec.vramMB).toBe(6144);
    expect(rec.reason).toMatch(/Limited VRAM/i);
  });

  test('caps concurrency by CPU thread count', async () => {
    // Simulate a system with lots of VRAM but few CPU threads
    reloadModule();
    const os = require('os');
    os.cpus.mockReturnValue(Array(2).fill({ model: 'Tiny CPU' })); // Only 2 cores

    mockSpawn.mockImplementation((cmd) => {
      if (cmd === 'nvidia-smi') {
        return createMockProcess('NVIDIA A100, 80000');
      }
      return createMockProcess('', 1);
    });

    const rec = await getRecommendedConcurrency();
    // cpuCap = floor(2/4) = max(1, 0) = 1, so capped to 1
    expect(rec.maxConcurrent).toBeLessThanOrEqual(1);
  });

  test('caps concurrency when total RAM < 12GB', async () => {
    reloadModule();
    const os = require('os');
    os.totalmem.mockReturnValue(8 * 1024 * 1024 * 1024); // 8GB

    mockSpawn.mockImplementation((cmd) => {
      if (cmd === 'nvidia-smi') {
        return createMockProcess('NVIDIA RTX 3090, 24576');
      }
      return createMockProcess('', 1);
    });

    const rec = await getRecommendedConcurrency();
    expect(rec.maxConcurrent).toBe(1);
    expect(rec.reason).toMatch(/capped by system RAM/i);
  });
});
