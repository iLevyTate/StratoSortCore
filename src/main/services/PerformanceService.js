const os = require('os');
const { spawn } = require('child_process');
const { getNvidiaSmiCommand, isMacOS } = require('../../shared/platformUtils');
const { GPU_TUNING, OLLAMA } = require('../../shared/performanceConstants');
const { logger } = require('../../shared/logger');

logger.setContext('PerformanceService');

/**
 * PerformanceService
 * - Detects system capabilities (CPU threads, GPU availability)
 * - Builds tuned Ollama options to maximize throughput, preferring GPU when available
 * - Supports NVIDIA (CUDA), AMD (ROCm), Intel, and Apple Silicon (Metal) GPUs
 */

let cachedCapabilities = null;

/**
 * Run a command with timeout and return stdout
 * @param {string} command - Command to run
 * @param {string[]} args - Command arguments
 * @param {number} timeout - Timeout in ms
 * @returns {Promise<{success: boolean, stdout: string}>}
 */
async function runCommand(command, args, timeout = 5000) {
  return new Promise((resolve) => {
    let resolved = false;
    let timeoutId = null;
    let proc = null;

    const cleanup = () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      if (proc && !proc.killed) {
        try {
          proc.kill();
        } catch {
          // Process may have already exited
        }
      }
      // Ensure we release event listeners promptly (avoids retaining closures in edge cases).
      if (proc) {
        try {
          proc.stdout?.removeAllListeners?.();
          proc.stderr?.removeAllListeners?.();
          proc.removeAllListeners?.();
        } catch {
          // Non-fatal cleanup
        }
      }
    };

    const safeResolve = (value) => {
      if (resolved) return;
      resolved = true;
      cleanup();
      resolve(value);
    };

    try {
      proc = spawn(command, args, { windowsHide: true });

      timeoutId = setTimeout(() => {
        safeResolve({ success: false, stdout: '' });
      }, timeout);

      // Prevent timer from keeping Node.js process alive
      if (timeoutId && typeof timeoutId.unref === 'function') {
        timeoutId.unref();
      }

      let stdout = '';
      proc.stdout.on('data', (d) => {
        stdout += d.toString();
      });
      proc.stderr.on('data', () => {}); // Discard stderr

      proc.on('error', () => safeResolve({ success: false, stdout: '' }));
      proc.on('close', (code) => {
        safeResolve({ success: code === 0, stdout: stdout.trim() });
      });
    } catch (spawnErr) {
      // Intentionally handled: command may not exist on this system (e.g., nvidia-smi on non-NVIDIA)
      // Debug-level logging to avoid noise in logs for expected failures
      safeResolve({ success: false, stdout: '' });
    }
  });
}

/**
 * Detect NVIDIA GPU via nvidia-smi
 */
async function detectNvidiaGpu() {
  const result = await runCommand(getNvidiaSmiCommand(), [
    '--query-gpu=name,memory.total',
    '--format=csv,noheader,nounits'
  ]);

  if (result.success && result.stdout) {
    const lines = result.stdout.split(/\r?\n/);
    const first = lines[0] || '';
    const [name, mem] = first.split(',').map((s) => s && s.trim());
    return {
      vendor: 'nvidia',
      gpuName: name || 'NVIDIA GPU',
      gpuMemoryMB: Number(mem) || null
    };
  }
  return null;
}

/**
 * Detect AMD GPU via rocm-smi (Linux) or checking for AMD in device list
 */
async function detectAmdGpu() {
  // Try rocm-smi on Linux
  if (process.platform === 'linux') {
    const result = await runCommand('rocm-smi', ['--showmeminfo', 'vram', '--csv']);
    if (result.success && result.stdout) {
      // Parse rocm-smi output for VRAM
      const match = result.stdout.match(/(\d+)\s*$/m);
      const vramMB = match ? Math.floor(Number(match[1]) / (1024 * 1024)) : null;
      return {
        vendor: 'amd',
        gpuName: 'AMD GPU (ROCm)',
        gpuMemoryMB: vramMB
      };
    }
  }

  // On Windows, check for AMD GPU via WMIC (less reliable for VRAM)
  if (process.platform === 'win32') {
    const result = await runCommand('wmic', ['path', 'win32_VideoController', 'get', 'name']);
    if (result.success && /AMD|Radeon/i.test(result.stdout)) {
      return {
        vendor: 'amd',
        gpuName: 'AMD GPU',
        gpuMemoryMB: null // WMIC doesn't reliably report VRAM for AMD
      };
    }
  }
  return null;
}

/**
 * Detect Intel GPU (Arc, Iris, UHD)
 */
async function detectIntelGpu() {
  if (process.platform === 'win32') {
    const result = await runCommand('wmic', ['path', 'win32_VideoController', 'get', 'name']);
    if (result.success && /Intel.*(?:Arc|Iris|UHD|Graphics)/i.test(result.stdout)) {
      return {
        vendor: 'intel',
        gpuName: 'Intel GPU',
        gpuMemoryMB: null
      };
    }
  }

  if (process.platform === 'linux') {
    const result = await runCommand('lspci', []);
    if (result.success && /Intel.*(?:Arc|Iris|UHD|Graphics)/i.test(result.stdout)) {
      return {
        vendor: 'intel',
        gpuName: 'Intel GPU',
        gpuMemoryMB: null
      };
    }
  }
  return null;
}

/**
 * Detect Apple Silicon GPU (M1, M2, M3, M4)
 */
async function detectAppleGpu() {
  if (!isMacOS) return null;

  const result = await runCommand('sysctl', ['-n', 'machdep.cpu.brand_string']);
  if (result.success && /Apple M[1-9]/i.test(result.stdout)) {
    // Get unified memory size (shared between CPU and GPU on Apple Silicon)
    const memResult = await runCommand('sysctl', ['-n', 'hw.memsize']);
    const totalMemBytes = memResult.success ? Number(memResult.stdout) : 0;
    // Apple Silicon uses unified memory - estimate ~70% available for GPU
    const gpuMemoryMB = totalMemBytes ? Math.floor((totalMemBytes * 0.7) / (1024 * 1024)) : null;

    return {
      vendor: 'apple',
      gpuName: result.stdout.trim(),
      gpuMemoryMB
    };
  }
  return null;
}

/**
 * Detect any available GPU (NVIDIA, AMD, Intel, Apple)
 */
async function detectGpu() {
  logger.debug('[PerformanceService] Detecting GPU...');

  // Try vendors in order of Ollama optimization level
  const nvidia = await detectNvidiaGpu();
  if (nvidia) {
    logger.info('[PerformanceService] NVIDIA GPU detected', nvidia);
    return nvidia;
  }

  const apple = await detectAppleGpu();
  if (apple) {
    logger.info('[PerformanceService] Apple Silicon GPU detected', apple);
    return apple;
  }

  const amd = await detectAmdGpu();
  if (amd) {
    logger.info('[PerformanceService] AMD GPU detected', amd);
    return amd;
  }

  const intel = await detectIntelGpu();
  if (intel) {
    logger.info('[PerformanceService] Intel GPU detected', intel);
    return intel;
  }

  logger.debug('[PerformanceService] No GPU detected, using CPU-only mode');
  return null;
}

async function detectSystemCapabilities() {
  if (cachedCapabilities) {
    logger.debug('[PerformanceService] Returning cached capabilities');
    return cachedCapabilities;
  }

  logger.info('[PerformanceService] Detecting system capabilities...');
  const cpuThreads = Array.isArray(os.cpus()) ? os.cpus().length : 4;
  const gpu = await detectGpu();

  cachedCapabilities = {
    cpuThreads,
    hasGpu: gpu !== null,
    gpuVendor: gpu?.vendor || null,
    gpuName: gpu?.gpuName || null,
    gpuMemoryMB: gpu?.gpuMemoryMB || null,
    // Legacy compatibility
    hasNvidiaGpu: gpu?.vendor === 'nvidia'
  };

  logger.info('[PerformanceService] System capabilities detected', {
    cpuThreads,
    hasGpu: cachedCapabilities.hasGpu,
    gpuVendor: cachedCapabilities.gpuVendor,
    gpuName: cachedCapabilities.gpuName,
    gpuMemoryMB: cachedCapabilities.gpuMemoryMB
  });

  return cachedCapabilities;
}

/**
 * Build Ollama generation options tuned for performance, preferring GPU when available.
 * task: 'text' | 'vision' | 'audio' | 'embeddings'
 *
 * GPU Best Practices:
 * - Uses environment variables for fine-tuning: OLLAMA_NUM_GPU, OLLAMA_NUM_THREAD, OLLAMA_KEEP_ALIVE
 * - keep_alive prevents costly model reloading between requests
 * - num_gpu=-1 tells Ollama to use all available GPU layers (safer than hardcoded 9999)
 */
async function buildOllamaOptions(task = 'text') {
  logger.debug('[PerformanceService] Building Ollama options', { task });
  const caps = await detectSystemCapabilities();

  // Environment variable overrides for fine-tuning
  const envNumGpu = process.env.OLLAMA_NUM_GPU ? parseInt(process.env.OLLAMA_NUM_GPU, 10) : null;
  const envNumThread = process.env.OLLAMA_NUM_THREAD
    ? parseInt(process.env.OLLAMA_NUM_THREAD, 10)
    : null;
  const envKeepAlive = process.env.OLLAMA_KEEP_ALIVE || '10m'; // Default: keep model loaded for 10 minutes
  const envNumBatch = process.env.OLLAMA_NUM_BATCH
    ? parseInt(process.env.OLLAMA_NUM_BATCH, 10)
    : null;

  // Base threading - can be overridden via env var
  const numThread = envNumThread || Math.max(2, Math.min(caps.cpuThreads || 4, 16));

  // Context window: larger for text models to handle longer documents
  // Vision models need smaller context due to image token overhead
  // Embeddings use minimal context
  let numCtx;
  switch (task) {
    case 'vision':
      numCtx = OLLAMA.CONTEXT_VISION;
      break;
    case 'embeddings':
      numCtx = OLLAMA.CONTEXT_EMBEDDINGS;
      break;
    case 'text':
    default:
      numCtx = OLLAMA.CONTEXT_TEXT;
      break;
  }

  // Batch sizing - larger when GPU VRAM is available
  let numBatch = envNumBatch || GPU_TUNING.NUM_BATCH_LOW_MEMORY;
  if (!envNumBatch && caps.hasGpu) {
    const vram = caps.gpuMemoryMB || 0;
    if (vram >= GPU_TUNING.VERY_HIGH_MEMORY_THRESHOLD)
      numBatch = GPU_TUNING.NUM_BATCH_VERY_HIGH_MEMORY;
    else if (vram >= GPU_TUNING.HIGH_MEMORY_THRESHOLD) numBatch = GPU_TUNING.NUM_BATCH_HIGH_MEMORY;
    else if (vram >= GPU_TUNING.MEDIUM_MEMORY_THRESHOLD)
      numBatch = GPU_TUNING.NUM_BATCH_MEDIUM_MEMORY;
    else if (vram >= GPU_TUNING.LOW_MEMORY_THRESHOLD) numBatch = GPU_TUNING.NUM_BATCH_LOW_MEMORY;
    else numBatch = GPU_TUNING.NUM_BATCH_MINIMAL;
  } else if (!envNumBatch) {
    numBatch = GPU_TUNING.NUM_BATCH_CPU_ONLY;
  }

  // GPU offload configuration
  // num_gpu: -1 means "use all available GPU layers" (Ollama auto-detects)
  // This is safer than hardcoded 9999 which could exceed actual layer count
  // Ollama supports NVIDIA (CUDA), AMD (ROCm), Intel (oneAPI), and Apple Silicon (Metal)
  let gpuHints;
  if (caps.hasGpu) {
    const numGpuLayers = envNumGpu !== null ? envNumGpu : -1; // -1 = auto (use all GPU layers)
    gpuHints = {
      num_gpu: numGpuLayers,
      // Use first GPU - Ollama auto-detects the appropriate backend (CUDA/ROCm/Metal/oneAPI)
      main_gpu: 0
    };
  } else {
    gpuHints = { num_gpu: 0 }; // CPU-only mode
  }

  // Memory mapping helps on desktop; mlock can cause permission issues on some systems
  // On Linux with sufficient RAM, mlock can improve performance by preventing swapping
  const shouldUseMlock = process.platform === 'linux' && os.totalmem() / 1024 / 1024 / 1024 > 16;
  const memoryHints = {
    use_mmap: true,
    use_mlock: shouldUseMlock
  };

  const options = {
    // Threading + context
    num_thread: numThread,
    num_ctx: numCtx,
    num_batch: numBatch,
    keep_alive: envKeepAlive,
    // GPU configuration
    ...gpuHints,
    // Memory hints
    ...memoryHints
  };

  logger.debug('[PerformanceService] Ollama options built', {
    task,
    numThread,
    numCtx,
    numBatch,
    hasGpu: caps.hasGpu,
    gpuLayers: gpuHints.num_gpu
  });

  return options;
}

/**
 * Get recommended environment variables for optimal Ollama performance
 * Users can set these in their shell profile or system environment
 * @returns {Promise<Object>} Recommended environment variable settings
 */
async function getRecommendedEnvSettings() {
  const caps = await detectSystemCapabilities();

  const recommendations = {
    // Limit to 1 model in memory to reduce VRAM usage
    OLLAMA_MAX_LOADED_MODELS: '1',
    // Default base parallel request count (will be overridden by GPU logic)
    OLLAMA_NUM_PARALLEL: '1',
    // Keep model loaded for 10 minutes to avoid reload latency
    OLLAMA_KEEP_ALIVE: '10m'
  };

  // Thread optimization: use physical cores, not logical
  const physicalCores = Math.max(2, Math.floor(caps.cpuThreads / 2));
  recommendations.OLLAMA_NUM_THREAD = String(Math.min(physicalCores, 8));

  // GPU-specific recommendations
  if (caps.hasGpu) {
    recommendations.OLLAMA_NUM_GPU = '-1'; // Auto-detect all GPU layers

    // Batch size based on VRAM
    const vram = caps.gpuMemoryMB || 0;

    if (vram >= GPU_TUNING.VERY_HIGH_MEMORY_THRESHOLD) {
      // 16GB+
      recommendations.OLLAMA_NUM_PARALLEL = '8';
      recommendations.OLLAMA_NUM_BATCH = String(GPU_TUNING.NUM_BATCH_VERY_HIGH_MEMORY);
    } else if (vram >= GPU_TUNING.HIGH_MEMORY_THRESHOLD) {
      // 12GB+
      recommendations.OLLAMA_NUM_PARALLEL = '6';
      recommendations.OLLAMA_NUM_BATCH = String(GPU_TUNING.NUM_BATCH_HIGH_MEMORY);
    } else if (vram >= GPU_TUNING.MEDIUM_MEMORY_THRESHOLD) {
      // 8GB+
      recommendations.OLLAMA_NUM_PARALLEL = '4';
      recommendations.OLLAMA_NUM_BATCH = String(GPU_TUNING.NUM_BATCH_MEDIUM_MEMORY);
    } else {
      // Low VRAM (<8GB)
      recommendations.OLLAMA_NUM_PARALLEL = '2';
      recommendations.OLLAMA_NUM_BATCH = String(GPU_TUNING.NUM_BATCH_LOW_MEMORY);
    }
  } else {
    recommendations.OLLAMA_NUM_GPU = '0';
    recommendations.OLLAMA_NUM_BATCH = String(GPU_TUNING.NUM_BATCH_CPU_ONLY);
    // Keep parallel requests low for CPU
    recommendations.OLLAMA_NUM_PARALLEL = '2';
  }

  return {
    recommendations,
    capabilities: caps,
    notes: [
      'Set these in your shell profile (~/.bashrc, ~/.zshrc) or system environment',
      'OLLAMA_NUM_THREAD should match physical CPU cores (not logical/hyperthreaded)',
      'OLLAMA_KEEP_ALIVE prevents costly model reloading between requests',
      'OLLAMA_NUM_PARALLEL scales with VRAM capacity'
    ]
  };
}

/**
 * Get optimal embedding model recommendations
 * @returns {Object} Recommended embedding models by use case
 */
function getRecommendedEmbeddingModels() {
  return {
    // Best balance of speed, size, and quality for accessibility
    recommended: 'embeddinggemma',
    alternatives: [
      { model: 'embeddinggemma', note: 'Google best-in-class, 308MB, 768 dims, <15ms' },
      { model: 'nomic-embed-text', note: 'Good quality, fast, 768 dimensions' },
      { model: 'mxbai-embed-large', note: 'Higher quality, 1024 dimensions (legacy)' },
      { model: 'all-minilm', note: 'Fastest, lower quality, 384 dimensions' }
    ],
    notes: [
      'embeddinggemma offers best speed/quality ratio at 308MB',
      'nomic-embed-text is a good alternative with same dimensions',
      'mxbai-embed-large requires re-embedding if switching (1024 vs 768 dims)'
    ]
  };
}

module.exports = {
  detectSystemCapabilities,
  buildOllamaOptions,
  getRecommendedEnvSettings,
  getRecommendedEmbeddingModels
};
