const os = require('os');
const { spawn } = require('child_process');
const { getNvidiaSmiCommand } = require('../../shared/platformUtils');

/**
 * PerformanceService
 * - Detects system capabilities (CPU threads, GPU availability)
 * - Builds tuned Ollama options to maximize throughput, preferring GPU when available
 */

let cachedCapabilities = null;

async function detectNvidiaGpu() {
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
    };

    const safeResolve = (value) => {
      if (resolved) return;
      resolved = true;
      cleanup();
      resolve(value);
    };

    try {
      // Use cross-platform utility for nvidia-smi executable name
      proc = spawn(getNvidiaSmiCommand(), [
        '--query-gpu=name,memory.total',
        '--format=csv,noheader,nounits'
      ]);

      // Timeout to prevent hanging processes (5 seconds should be plenty)
      timeoutId = setTimeout(() => {
        safeResolve({ hasNvidiaGpu: false });
      }, 5000);

      let stdout = '';
      proc.stdout.on('data', (d) => {
        stdout += d.toString();
      });

      // Handle stderr to prevent buffer overflow (discard output)
      proc.stderr.on('data', () => {});

      proc.on('error', () => safeResolve({ hasNvidiaGpu: false }));
      proc.on('close', (code) => {
        if (code === 0 && stdout.trim()) {
          const lines = stdout.trim().split(/\r?\n/);
          const first = lines[0] || '';
          const [name, mem] = first.split(',').map((s) => s && s.trim());
          const gpuMemoryMB = Number(mem) || null;
          safeResolve({
            hasNvidiaGpu: true,
            gpuName: name || 'NVIDIA GPU',
            gpuMemoryMB
          });
        } else {
          safeResolve({ hasNvidiaGpu: false });
        }
      });
    } catch {
      safeResolve({ hasNvidiaGpu: false });
    }
  });
}

async function detectSystemCapabilities() {
  if (cachedCapabilities) return cachedCapabilities;

  const cpuThreads = Array.isArray(os.cpus()) ? os.cpus().length : 4;
  const nvidia = await detectNvidiaGpu();

  cachedCapabilities = {
    cpuThreads,
    hasNvidiaGpu: Boolean(nvidia.hasNvidiaGpu),
    gpuName: nvidia.gpuName || null,
    gpuMemoryMB: nvidia.gpuMemoryMB || null
  };
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
      numCtx = 2048; // Vision models have image token overhead
      break;
    case 'embeddings':
      numCtx = 512; // Embeddings need minimal context
      break;
    case 'text':
    default:
      numCtx = 8192; // Text models benefit from larger context for document analysis
      break;
  }

  // Batch sizing - larger when GPU VRAM is available
  let numBatch = envNumBatch || 256;
  if (!envNumBatch && caps.hasNvidiaGpu) {
    const vram = caps.gpuMemoryMB || 0;
    if (vram >= 16000)
      numBatch = 1024; // 16GB+ VRAM
    else if (vram >= 12000)
      numBatch = 512; // 12GB VRAM
    else if (vram >= 8000)
      numBatch = 384; // 8GB VRAM
    else if (vram >= 6000)
      numBatch = 256; // 6GB VRAM
    else numBatch = 192; // 4GB VRAM
  } else if (!envNumBatch) {
    numBatch = 128; // CPU-only safe default
  }

  // GPU offload configuration
  // num_gpu: -1 means "use all available GPU layers" (Ollama auto-detects)
  // This is safer than hardcoded 9999 which could exceed actual layer count
  let gpuHints;
  if (caps.hasNvidiaGpu) {
    const numGpuLayers = envNumGpu !== null ? envNumGpu : -1; // -1 = auto (use all GPU layers)
    gpuHints = {
      num_gpu: numGpuLayers,
      // Force GPU acceleration - Ollama will use CUDA if available
      main_gpu: 0 // Use first GPU
    };
  } else {
    gpuHints = { num_gpu: 0 }; // CPU-only mode
  }

  // Memory mapping helps on desktop; mlock can cause permission issues on some systems
  // On Linux with sufficient RAM, mlock can improve performance by preventing swapping
  const memoryHints = {
    use_mmap: true,
    use_mlock: process.platform === 'linux' && os.totalmem() / 1024 / 1024 / 1024 > 16
  };

  return {
    // Threading + context
    num_thread: numThread,
    num_ctx: numCtx,
    num_batch: numBatch,
    // GPU configuration
    ...gpuHints,
    // Memory hints
    ...memoryHints,
    // CRITICAL: Keep model loaded in memory to avoid reload latency (5-30 seconds per load)
    keep_alive: envKeepAlive
  };
}

module.exports = {
  detectSystemCapabilities,
  buildOllamaOptions
};
