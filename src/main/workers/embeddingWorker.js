const path = require('path');
const { createLogger } = require('../../shared/logger');
const { ERROR_CODES } = require('../../shared/errorCodes');

const logger = createLogger('EmbeddingWorker');

let llamaInstance = null;
let currentModelPath = null;
let currentGpuLayers = null;
let model = null;
let context = null;

const isOutOfMemoryError = (error) => {
  const message = String(error?.message || error || '').toLowerCase();
  return (
    message.includes('out of memory') ||
    message.includes('oom') ||
    message.includes('allocate') ||
    message.includes('buffer')
  );
};

/**
 * Resolve gpuLayers value to match LlamaService convention.
 * Leave undefined for auto so node-llama-cpp can fit to VRAM.
 */
function resolveGpuLayers(gpuLayers) {
  if (gpuLayers === 'auto' || gpuLayers === -1 || gpuLayers == null) return undefined;
  if (typeof gpuLayers === 'number' && gpuLayers >= 0) return gpuLayers;
  return undefined;
}

/**
 * Initialize the Llama runtime with GPU auto-detection.
 * Cached across calls so GPU probe only happens once per worker lifetime.
 */
async function getLlamaInstance() {
  if (llamaInstance) return llamaInstance;

  const { getLlama } = await import(/* webpackIgnore: true */ 'node-llama-cpp');
  // FIX: Import GPUMonitor dynamically to avoid circular deps or load issues in worker
  const { GPUMonitor } = require('../services/GPUMonitor');
  const { initLlamaWithBackend } = require('../utils/llamaBackendSelector');
  const gpuMonitor = new GPUMonitor();

  let gpuInfo = null;
  try {
    gpuInfo = await gpuMonitor.detectGPU();
  } catch {
    // Ignore detection error
  }

  try {
    const selection = await initLlamaWithBackend({
      getLlama,
      gpuInfo,
      logger,
      context: 'EmbeddingWorker'
    });
    llamaInstance = selection.llama;
  } catch (error) {
    logger.warn('[EmbeddingWorker] GPU init failed, falling back to CPU', {
      error: error?.message
    });
    llamaInstance = await getLlama({ gpu: false });
  }

  return llamaInstance;
}

async function ensureModelLoaded({ modelPath, gpuLayers }) {
  if (!modelPath) {
    const error = new Error('Embedding model path is required');
    error.code = ERROR_CODES.LLAMA_MODEL_NOT_FOUND;
    throw error;
  }

  const resolvedLayers = resolveGpuLayers(gpuLayers);

  if (model && context && currentModelPath === modelPath && currentGpuLayers === resolvedLayers) {
    return context;
  }

  const llama = await getLlamaInstance();
  const resolvedPath = path.normalize(modelPath);
  logger.info('[EmbeddingWorker] Loading embedding model', {
    modelPath: resolvedPath,
    gpuLayers: typeof resolvedLayers === 'number' ? resolvedLayers : 'auto'
  });

  // Dispose previous model if exists
  if (context) {
    try {
      await context.dispose();
    } catch (e) {
      logger.warn('[EmbeddingWorker] Failed to dispose previous context', { error: e.message });
    }
    context = null;
  }
  if (model) {
    try {
      await model.dispose();
    } catch (e) {
      logger.warn('[EmbeddingWorker] Failed to dispose previous model', { error: e.message });
    }
    model = null;
    context = null;
  }

  try {
    const modelOptions = { modelPath: resolvedPath };
    if (typeof resolvedLayers === 'number') {
      modelOptions.gpuLayers = resolvedLayers;
    }
    model = await llama.loadModel(modelOptions);
    context = await model.createEmbeddingContext();
    currentModelPath = modelPath;
    currentGpuLayers = resolvedLayers;
    return context;
  } catch (error) {
    logger.error('[EmbeddingWorker] Failed to load embedding model', { error: error.message });
    // Ensure partially loaded model/context are disposed to avoid leaks
    if (context?.dispose) {
      try {
        await context.dispose();
      } catch {
        /* ignore */
      }
      context = null;
    }
    if (model?.dispose) {
      try {
        await model.dispose();
      } catch {
        /* ignore */
      }
      model = null;
    }
    currentModelPath = null;
    currentGpuLayers = null;
    if (isOutOfMemoryError(error)) {
      error.code = ERROR_CODES.LLAMA_OOM;
    } else if (!error.code) {
      error.code = ERROR_CODES.LLAMA_MODEL_LOAD_FAILED;
    }
    throw error;
  }
}

module.exports = async function runEmbeddingTask(payload = {}) {
  const { text, modelPath, gpuLayers = 'auto' } = payload || {};
  if (typeof text !== 'string') {
    const error = new Error('Embedding text must be a string');
    error.code = ERROR_CODES.LLAMA_INFERENCE_FAILED;
    throw error;
  }

  try {
    const ctx = await ensureModelLoaded({ modelPath, gpuLayers });
    const embedding = await ctx.getEmbeddingFor(text);
    const vector = Array.from(embedding.vector);
    return { embedding: vector, model: path.basename(modelPath) };
  } catch (error) {
    if (isOutOfMemoryError(error)) {
      error.code = ERROR_CODES.LLAMA_OOM;
    } else if (!error.code) {
      error.code = ERROR_CODES.LLAMA_INFERENCE_FAILED;
    }
    throw error;
  }
};
