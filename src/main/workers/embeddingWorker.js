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
  return message.includes('out of memory') || message.includes('oom');
};

/**
 * Resolve gpuLayers value to match LlamaService convention.
 * node-llama-cpp treats -1 as 0 (CPU-only), so we map 'auto' and -1
 * to Infinity (offload all layers to GPU).
 */
function resolveGpuLayers(gpuLayers) {
  if (gpuLayers === 'auto' || gpuLayers === -1) return Infinity;
  if (typeof gpuLayers === 'number' && gpuLayers >= 0) return gpuLayers;
  return Infinity; // Default: full GPU offload
}

/**
 * Initialize the Llama runtime with GPU auto-detection.
 * Cached across calls so GPU probe only happens once per worker lifetime.
 */
async function getLlamaInstance() {
  if (llamaInstance) return llamaInstance;

  const { getLlama } = await import(/* webpackIgnore: true */ 'node-llama-cpp');

  try {
    llamaInstance = await getLlama({ gpu: 'auto' });
    logger.info('[EmbeddingWorker] Llama initialized', { gpu: llamaInstance.gpu || 'cpu' });
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
    gpuLayers: resolvedLayers === Infinity ? 'all' : resolvedLayers
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
    model = await llama.loadModel({ modelPath: resolvedPath, gpuLayers: resolvedLayers });
    context = await model.createEmbeddingContext();
    currentModelPath = modelPath;
    currentGpuLayers = resolvedLayers;
    return context;
  } catch (error) {
    logger.error('[EmbeddingWorker] Failed to load embedding model', { error: error.message });
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
    return { embedding: vector };
  } catch (error) {
    if (isOutOfMemoryError(error)) {
      error.code = ERROR_CODES.LLAMA_OOM;
    } else if (!error.code) {
      error.code = ERROR_CODES.LLAMA_INFERENCE_FAILED;
    }
    throw error;
  }
};
