/**
 * LlamaService - In-process LLM using node-llama-cpp
 *
 * Fully in-process GGUF model inference service.
 * Supports Metal (macOS), CUDA (Windows/Linux), Vulkan, and CPU fallback.
 * Integrates resilience, memory management, and performance tracking.
 *
 * @module services/LlamaService
 */

const path = require('path');
const fs = require('fs').promises;
const os = require('os');
const { app } = require('electron');
const { EventEmitter } = require('events');
const { createLogger } = require('../../shared/logger');
const { createSingletonHelpers } = require('../../shared/singletonFactory');
const { AI_DEFAULTS } = require('../../shared/constants');
const { getModel } = require('../../shared/modelRegistry');
const { ERROR_CODES } = require('../../shared/errorCodes');
const SettingsService = require('./SettingsService');
const { getInstance: getVisionService } = require('./VisionService');

// New Managers
const { GPUMonitor } = require('./GPUMonitor');
const { ModelMemoryManager } = require('./ModelMemoryManager');
const { DegradationManager } = require('./DegradationManager');
const { ModelAccessCoordinator } = require('./ModelAccessCoordinator');
const { PerformanceMetrics } = require('./PerformanceMetrics');
const { withLlamaResilience, cleanupLlamaCircuits } = require('./LlamaResilience');
const { delay } = require('../../shared/promiseUtils');

const logger = createLogger('LlamaService');

const attachErrorCode = (error, code) => {
  if (error && typeof error === 'object') {
    if (!error.code) {
      error.code = code;
    }
    return error;
  }
  const wrapped = new Error(String(error || 'Unknown error'));
  wrapped.code = code;
  return wrapped;
};

const isOutOfMemoryError = (error) => {
  const message = String(error?.message || error || '').toLowerCase();
  return message.includes('out of memory') || message.includes('oom');
};

const isSequenceExhaustedError = (error) => {
  const message = String(error?.message || error || '').toLowerCase();
  return message.includes('no sequences left') || message.includes('sequence');
};

let _nodeLlamaModule = null;
async function loadNodeLlamaModule() {
  if (_nodeLlamaModule) return _nodeLlamaModule;
  _nodeLlamaModule = await import(/* webpackIgnore: true */ 'node-llama-cpp');
  return _nodeLlamaModule;
}

// Default model configuration
const DEFAULT_CONFIG = {
  textModel: AI_DEFAULTS.TEXT?.MODEL || 'Mistral-7B-Instruct-v0.3-Q4_K_M.gguf',
  visionModel: AI_DEFAULTS.IMAGE?.MODEL || 'llava-v1.6-mistral-7b-Q4_K_M.gguf',
  embeddingModel: AI_DEFAULTS.EMBEDDING?.MODEL || 'nomic-embed-text-v1.5-Q8_0.gguf',
  gpuLayers: 'auto', // 'auto' = offload all layers to GPU when available
  contextSize: 8192,
  threads: 0 // 0 = auto-detect
};

// Allowed embedding models for validation (must match MODEL_CATALOG in modelRegistry.js)
const ALLOWED_EMBED_MODELS = [
  'nomic-embed-text-v1.5-Q8_0.gguf',
  'nomic-embed-text-v1.5-Q4_K_M.gguf',
  'mxbai-embed-large-v1-f16.gguf'
];

class LlamaService extends EventEmitter {
  constructor() {
    super();
    this._initialized = false;
    this._modelsPath = null;
    this._config = { ...DEFAULT_CONFIG };
    this._configLoaded = false;

    // Llama core
    this._llama = null;
    this._gpuBackend = null;

    // Managers
    this._gpuMonitor = new GPUMonitor();
    this._modelMemoryManager = null; // Initialized after llama
    this._degradationManager = null; // Initialized after llama
    this._coordinator = new ModelAccessCoordinator();
    this._metrics = new PerformanceMetrics();

    // Internal state
    this._models = { text: null, vision: null, embedding: null };
    this._contexts = { text: null, vision: null, embedding: null };
    this._selectedModels = { text: null, vision: null, embedding: null };
    this._modelChangeCallbacks = new Set();
    this._visionProjectorStatus = {
      required: false,
      available: false,
      projectorName: null,
      projectorPath: null
    };
    this._visionInputSupported = null;
  }

  async _ensureVisionAssets(modelName) {
    const modelInfo = getModel(modelName);
    const clipModel = modelInfo?.clipModel;
    if (!clipModel?.name) {
      this._visionProjectorStatus = {
        required: false,
        available: false,
        projectorName: null,
        projectorPath: null
      };
      return this._visionProjectorStatus;
    }

    const projectorName = clipModel.name;
    const projectorPath = path.join(this._modelsPath, projectorName);
    try {
      await fs.access(projectorPath);
      this._visionProjectorStatus = {
        required: true,
        available: true,
        projectorName,
        projectorPath
      };
      return this._visionProjectorStatus;
    } catch {
      this._visionProjectorStatus = {
        required: true,
        available: false,
        projectorName,
        projectorPath
      };
      logger.warn('[LlamaService] Vision projector missing for model', {
        modelName,
        projectorName,
        modelsPath: this._modelsPath
      });
      return this._visionProjectorStatus;
    }
  }

  async _ensureConfigLoaded() {
    if (!this._modelsPath) {
      const base =
        typeof app?.getPath === 'function' && app.getPath('userData')
          ? app.getPath('userData')
          : os.tmpdir();
      this._modelsPath = path.join(base, 'models');
      try {
        await fs.mkdir(this._modelsPath, { recursive: true });
      } catch (e) {
        // Non-fatal in tests and restricted environments; model ops will surface errors later.
        logger.debug('[LlamaService] Could not create models directory:', e?.message);
      }
    }

    if (!this._configLoaded) {
      await this._loadConfig();
      this._configLoaded = true;
    }
  }

  /**
   * Get the current effective configuration.
   * This is the public API used by IPC and analysis modules.
   */
  async getConfig() {
    await this._ensureConfigLoaded();
    return {
      textModel: this._selectedModels.text || this._config.textModel,
      visionModel: this._selectedModels.vision || this._config.visionModel,
      embeddingModel: this._selectedModels.embedding || this._config.embeddingModel,
      gpuLayers: this._config.gpuLayers,
      contextSize: this._config.contextSize,
      threads: this._config.threads,
      gpuBackend: this._gpuBackend,
      modelsPath: this._modelsPath,
      visionProjector: { ...this._visionProjectorStatus }
    };
  }

  /**
   * Update configuration and persist to SettingsService.
   * Triggers model-change notifications when a selected model changes.
   *
   * @param {Object} partial - Partial config (textModel/visionModel/embeddingModel/gpuLayers/contextSize/threads)
   * @param {Object} [options]
   * @param {boolean} [options.skipSave=false] - Skip persisting settings (caller already saving).
   */
  async updateConfig(partial = {}, options = {}) {
    const { skipSave = false } = options || {};
    await this._ensureConfigLoaded();

    const prev = { ...this._selectedModels };
    let modelDowngraded = false;

    if (partial.textModel) this._selectedModels.text = String(partial.textModel);
    if (partial.visionModel) this._selectedModels.vision = String(partial.visionModel);
    if (partial.embeddingModel) {
      const requested = String(partial.embeddingModel);
      if (ALLOWED_EMBED_MODELS.includes(requested)) {
        this._selectedModels.embedding = requested;
      } else {
        this._selectedModels.embedding = DEFAULT_CONFIG.embeddingModel;
        modelDowngraded = true;
      }
    }

    if (typeof partial.gpuLayers === 'number') this._config.gpuLayers = partial.gpuLayers;
    if (typeof partial.contextSize === 'number') this._config.contextSize = partial.contextSize;
    if (typeof partial.threads === 'number') this._config.threads = partial.threads;

    if (!skipSave) {
      try {
        await SettingsService.getInstance().save({
          textModel: this._selectedModels.text,
          visionModel: this._selectedModels.vision,
          embeddingModel: this._selectedModels.embedding,
          llamaGpuLayers: this._config.gpuLayers
        });
      } catch (error) {
        logger.warn('[LlamaService] Failed to persist config:', error.message);
      }
    }

    // If any selected model changed, force unload so next operation reloads correct model.
    const changedTypes = [];
    if (prev.text !== this._selectedModels.text) changedTypes.push('text');
    if (prev.vision !== this._selectedModels.vision) changedTypes.push('vision');
    if (prev.embedding !== this._selectedModels.embedding) changedTypes.push('embedding');
    if (changedTypes.includes('vision')) {
      this._visionInputSupported = null;
    }
    if (changedTypes.length > 0 && this._modelMemoryManager) {
      // Acquire load locks before unloading to avoid crashing in-flight inference
      const releaseLocks = [];
      try {
        for (const type of changedTypes) {
          if (this._coordinator) {
            releaseLocks.push(await this._coordinator.acquireLoadLock(type));
          }
        }
        await this._waitForIdleOperations('config-change', 30000);
        await this._modelMemoryManager.unloadAll();
      } catch (e) {
        logger.debug('[LlamaService] unloadAll failed (non-fatal):', e?.message);
      } finally {
        for (const release of releaseLocks) {
          try {
            release();
          } catch {
            /* ignore */
          }
        }
      }
    }

    // Notify subscribers
    for (const type of changedTypes) {
      const payload = {
        type,
        previousModel: prev[type],
        newModel: this._selectedModels[type]
      };
      this.emit('model-change', payload);
      for (const cb of this._modelChangeCallbacks) {
        try {
          cb(payload);
        } catch {
          // ignore callback errors
        }
      }
    }

    return { success: true, modelDowngraded, selected: { ...this._selectedModels } };
  }

  /**
   * Subscribe to model changes.
   * @returns {Function} unsubscribe
   */
  onModelChange(callback) {
    if (typeof callback !== 'function') return () => {};
    this._modelChangeCallbacks.add(callback);
    return () => this._modelChangeCallbacks.delete(callback);
  }

  /**
   * Lightweight health check for the in-process AI engine.
   */
  async testConnection() {
    try {
      await this._ensureConfigLoaded();
      const models = await this.listModels();
      return {
        success: true,
        status: 'healthy',
        modelCount: models.length,
        gpuBackend: this._gpuBackend
      };
    } catch (error) {
      return { success: false, status: 'unhealthy', error: error.message };
    }
  }

  /**
   * Initialize the LlamaService
   */
  async initialize() {
    if (this._initialized) return;

    logger.info('[LlamaService] Initializing...');

    try {
      await this._ensureConfigLoaded();

      // Initialize Managers
      this._degradationManager = new DegradationManager(this);

      // Check system readiness (GPU, disk, models)
      const readiness = await this._degradationManager.checkSystemReadiness();
      if (!readiness.ready) {
        logger.warn('[LlamaService] System degradation detected', readiness.issues);
        // We continue initialization but note the degradation
      }

      // Initialize Llama with GPU detection
      await this._initializeLlama();

      // Initialize Memory Manager (needs llama instance)
      this._modelMemoryManager = new ModelMemoryManager(this);

      // Configuration is loaded via _ensureConfigLoaded()

      this._initialized = true;
      this.emit('initialized', {
        gpuBackend: this._gpuBackend,
        gpuDevice: readiness.gpuInfo?.name
      });

      logger.info('[LlamaService] Initialized successfully', {
        gpuBackend: this._gpuBackend,
        modelsPath: this._modelsPath
      });
    } catch (error) {
      logger.error('[LlamaService] Initialization failed:', error);
      throw error;
    }
  }

  /**
   * Initialize Llama with automatic GPU detection/fallback.
   *
   * node-llama-cpp's `getLlama({ gpu: 'auto' })` probes for CUDA → Vulkan → Metal
   * and silently falls back to CPU when none are usable.  We surface the result
   * so users know whether inference will be fast (GPU) or slow (CPU-only).
   */
  async _initializeLlama() {
    const { getLlama } = await loadNodeLlamaModule();

    // Detect what GPU the OS sees (independent of node-llama-cpp's own probe)
    try {
      const gpuInfo = await this._gpuMonitor.detectGPU();
      logger.info('[LlamaService] System GPU detected', {
        type: gpuInfo.type,
        name: gpuInfo.name,
        vramMB: gpuInfo.vramMB || 0
      });
    } catch {
      logger.debug('[LlamaService] GPU detection skipped');
    }

    // Try GPU-enabled init first
    try {
      this._llama = await getLlama({ gpu: 'auto' });
      this._gpuBackend = this._llama.gpu || 'cpu';
    } catch (error) {
      logger.warn('[LlamaService] GPU initialization failed, falling back to CPU', {
        error: error?.message
      });
      this._llama = await getLlama({ gpu: false });
      this._gpuBackend = 'cpu';
    }

    if (this._gpuBackend === 'cpu' || this._gpuBackend === false || !this._gpuBackend) {
      this._gpuBackend = 'cpu';
      logger.warn(
        '[LlamaService] Running on CPU only — inference will be slow for large models. ' +
          'Install CUDA toolkit (NVIDIA) or ensure Vulkan drivers are up to date for GPU acceleration.'
      );
    } else {
      logger.info('[LlamaService] GPU backend active', { backend: this._gpuBackend });
    }
  }

  /**
   * Load configuration from settings
   */
  async _loadConfig() {
    try {
      const settingsService = SettingsService.getInstance();
      const settings = settingsService?.getAll?.() || {};

      this._selectedModels = {
        text: settings.textModel || AI_DEFAULTS.TEXT.MODEL,
        vision: settings.visionModel || AI_DEFAULTS.IMAGE.MODEL,
        embedding: settings.embeddingModel || AI_DEFAULTS.EMBEDDING.MODEL
      };

      if (typeof settings.llamaGpuLayers === 'number') {
        this._config.gpuLayers = settings.llamaGpuLayers;
      }
    } catch (error) {
      logger.warn('[LlamaService] Failed to load config from settings:', error.message);
      this._selectedModels = {
        text: AI_DEFAULTS.TEXT.MODEL,
        vision: AI_DEFAULTS.IMAGE.MODEL,
        embedding: AI_DEFAULTS.EMBEDDING.MODEL
      };
    }
  }

  /**
   * Ensure a model is loaded and ready
   * Uses ModelMemoryManager to handle swapping and OOM prevention
   */
  async _ensureModelLoaded(modelType) {
    if (!this._initialized) await this.initialize();

    // Use coordinator to prevent race conditions during load
    const releaseLock = await this._coordinator.acquireLoadLock(modelType);

    try {
      // Check if already loaded via memory manager
      // The memory manager handles the actual loading logic via _loadModel callback
      return await this._modelMemoryManager.ensureModelLoaded(modelType);
    } catch (error) {
      // Handle degradation (e.g., model file corruption)
      const resolution = await this._degradationManager.handleError(error, { modelType });
      if (resolution.action === 'redownload_model') {
        const redownloadError = new Error(
          `Model corrupted, please redownload: ${this._selectedModels[modelType]}`
        );
        redownloadError.code = ERROR_CODES.LLAMA_MODEL_LOAD_FAILED;
        throw redownloadError;
      }
      throw error;
    } finally {
      releaseLock();
    }
  }

  async _waitForIdleOperations(reason, timeoutMs = 30000) {
    if (!this._coordinator) return;
    const start = Date.now();
    let status = this._coordinator.getStatus();
    while (status.activeOperations > 0 && Date.now() - start < timeoutMs) {
      await delay(100);
      status = this._coordinator.getStatus();
    }
    if (status.activeOperations > 0) {
      logger.warn('[LlamaService] Proceeding with model unload while operations active', {
        reason,
        activeOperations: status.activeOperations
      });
    }
  }

  async _recoverFromSequenceExhaustion(modelType, error) {
    logger.warn('[LlamaService] Sequence exhaustion detected, reloading model', {
      modelType,
      error: error?.message
    });
    try {
      if (this._modelMemoryManager?.unloadModel) {
        await this._modelMemoryManager.unloadModel(modelType);
      } else if (this._modelMemoryManager?.unloadAll) {
        await this._modelMemoryManager.unloadAll();
      }
    } catch (unloadError) {
      logger.warn('[LlamaService] Failed to unload model during recovery', {
        modelType,
        error: unloadError?.message
      });
    }
    await delay(50);
  }

  async _supportsVisionInput() {
    if (this._visionInputSupported != null) return this._visionInputSupported;
    try {
      await this._ensureConfigLoaded();
      const modelName = this._selectedModels.vision || this._config.visionModel;
      if (!modelName) {
        this._visionInputSupported = false;
        return this._visionInputSupported;
      }
      await this._ensureVisionAssets(modelName);
      if (this._visionProjectorStatus.required && !this._visionProjectorStatus.available) {
        this._visionInputSupported = false;
        return this._visionInputSupported;
      }
      this._visionInputSupported = true;
    } catch {
      this._visionInputSupported = false;
    }
    return this._visionInputSupported;
  }

  /**
   * ACTUAL model loading logic called by ModelMemoryManager
   * @private
   */
  async _loadModel(type) {
    const modelName = this._selectedModels[type];
    if (!modelName) {
      const noModelError = new Error(`No ${type} model configured`);
      noModelError.code = ERROR_CODES.LLAMA_MODEL_NOT_FOUND;
      throw noModelError;
    }

    const modelPath = path.join(this._modelsPath, modelName);

    if (type === 'vision') {
      await this._ensureVisionAssets(modelName);
    }

    // Verify file exists
    try {
      await fs.access(modelPath);
    } catch {
      const notFoundError = new Error(`Model not found: ${modelName}`);
      notFoundError.code = ERROR_CODES.LLAMA_MODEL_NOT_FOUND;
      throw notFoundError;
    }

    const startTime = Date.now();
    logger.info(`[LlamaService] Loading ${type} model: ${modelName}`);

    try {
      // Resolve gpuLayers: 'auto' or -1 → Infinity (offload all layers to GPU).
      // node-llama-cpp treats -1 as 0 (CPU-only), so we must map it ourselves.
      const configLayers = this._config.gpuLayers;
      const gpuLayers =
        configLayers === 'auto' || configLayers === -1 ? Infinity : (configLayers ?? Infinity);

      const model = await this._llama.loadModel({
        modelPath,
        gpuLayers
      });

      logger.info(`[LlamaService] Model ${type} GPU offload`, {
        requestedLayers: gpuLayers === Infinity ? 'all' : gpuLayers,
        actualGpuLayers: model.gpuLayers ?? 'unknown',
        backend: this._gpuBackend
      });

      let context;
      if (type === 'embedding') {
        context = await model.createEmbeddingContext();
      } else {
        context = await model.createContext({
          contextSize: this._config.contextSize,
          // Use 2 sequences so a stale/orphaned session from a timed-out
          // inference doesn't block the next request with "No sequences left"
          sequences: 2
        });
      }

      this._models[type] = model;
      this._contexts[type] = context;

      this._metrics.recordModelLoad(type, Date.now() - startTime);
      return context;
    } catch (error) {
      logger.error(`[LlamaService] Failed to load ${type} model:`, error);
      if (isOutOfMemoryError(error)) {
        throw attachErrorCode(error, ERROR_CODES.LLAMA_OOM);
      }
      throw attachErrorCode(error, ERROR_CODES.LLAMA_MODEL_LOAD_FAILED);
    }
  }

  /**
   * Generate embedding with resilience and metrics
   */
  async generateEmbedding(text, _options = {}) {
    const operationId = `embed-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    return this._coordinator.withModel(
      'embedding',
      async () => {
        this._modelMemoryManager?.acquireRef('embedding');
        try {
          return await withLlamaResilience(
            async (_retryOptions) => {
              const startTime = Date.now();

              try {
                const context = await this._ensureModelLoaded('embedding');

                // Use retryOptions to handle CPU fallback if needed
                // Note: node-llama-cpp context might need recreation for CPU fallback,
                // but for now we rely on LlamaResilience to handle re-attempts

                const embedding = await context.getEmbeddingFor(text);
                const vector = Array.from(embedding.vector);

                this._metrics.recordEmbedding(Date.now() - startTime, true);
                return { embedding: vector };
              } catch (error) {
                this._metrics.recordEmbedding(Date.now() - startTime, false);
                if (isOutOfMemoryError(error)) {
                  throw attachErrorCode(error, ERROR_CODES.LLAMA_OOM);
                }
                throw attachErrorCode(error, ERROR_CODES.LLAMA_INFERENCE_FAILED);
              }
            },
            { modelType: 'embedding' }
          );
        } finally {
          this._modelMemoryManager?.releaseRef('embedding');
        }
      },
      { operationId }
    );
  }

  /**
   * Batch generate embeddings
   */
  async batchGenerateEmbeddings(texts, options = {}) {
    const { onProgress } = options;
    const results = [];

    for (let i = 0; i < texts.length; i++) {
      try {
        const result = await this.generateEmbedding(texts[i]);
        results.push(result.embedding);

        if (onProgress) {
          onProgress({
            current: i + 1,
            total: texts.length,
            progress: (i + 1) / texts.length
          });
        }
      } catch (error) {
        logger.warn('[LlamaService] Batch embedding failed item', {
          index: i,
          error: error.message
        });
        results.push(null);
      }
    }
    return { embeddings: results };
  }

  /**
   * Generate text response
   */
  async generateText(options) {
    const { prompt, systemPrompt, maxTokens = 2048, temperature = 0.7, signal } = options;
    const operationId = `text-${Date.now()}`;

    return this._coordinator.withModel(
      'text',
      async () => {
        this._modelMemoryManager?.acquireRef('text');
        try {
          return await withLlamaResilience(
            async () => {
              const startTime = Date.now();
              let session;
              let abortHandler;

              const runOnce = async () => {
                if (signal?.aborted) {
                  const abortError = new Error('Operation aborted');
                  abortError.name = 'AbortError';
                  throw abortError;
                }

                const context = await this._ensureModelLoaded('text');
                const { LlamaChatSession } = await loadNodeLlamaModule();
                session = new LlamaChatSession({
                  contextSequence: context.getSequence(),
                  systemPrompt: systemPrompt || 'You are a helpful assistant.'
                });

                if (signal) {
                  abortHandler = () => {
                    try {
                      session?.dispose();
                    } catch (disposeError) {
                      logger.warn('[LlamaService] Session dispose on abort failed', {
                        error: disposeError?.message
                      });
                    }
                  };
                  signal.addEventListener('abort', abortHandler, { once: true });
                }

                const promptOptions = { maxTokens, temperature };
                if (signal) promptOptions.signal = signal;
                return await session.prompt(prompt, promptOptions);
              };

              try {
                let response;
                try {
                  response = await runOnce();
                } catch (error) {
                  if (isSequenceExhaustedError(error)) {
                    await this._recoverFromSequenceExhaustion('text', error);
                    response = await runOnce();
                  } else {
                    throw error;
                  }
                }

                const tokenCount = response.length / 4;
                this._metrics.recordTextGeneration(Date.now() - startTime, tokenCount, true);
                return { response };
              } catch (error) {
                this._metrics.recordTextGeneration(Date.now() - startTime, 0, false);
                if (isOutOfMemoryError(error)) {
                  throw attachErrorCode(error, ERROR_CODES.LLAMA_OOM);
                }
                throw attachErrorCode(error, ERROR_CODES.LLAMA_INFERENCE_FAILED);
              } finally {
                if (signal && abortHandler) {
                  try {
                    signal.removeEventListener('abort', abortHandler);
                  } catch {
                    /* ignore */
                  }
                }
                if (session) {
                  try {
                    session.dispose();
                  } catch (disposeError) {
                    logger.warn('[LlamaService] Session dispose failed', {
                      error: disposeError?.message
                    });
                  }
                }
              }
            },
            { modelType: 'text' }
          );
        } finally {
          this._modelMemoryManager?.releaseRef('text');
        }
      },
      { operationId }
    );
  }

  /**
   * Analyze text with structured response (convenience wrapper around generateText).
   * Matches the contract expected by ChatService and other callers that pass
   * (prompt, options) and expect {success, response, error}.
   */
  async analyzeText(prompt, options = {}) {
    try {
      const result = await this.generateText({
        prompt,
        systemPrompt:
          options.systemPrompt || 'You are a helpful assistant. Always return valid JSON.',
        maxTokens: options.maxTokens || 2048,
        temperature: options.temperature || 0.7,
        ...(options.format && { format: options.format }),
        ...(options.signal && { signal: options.signal })
      });
      return { success: true, response: result.response };
    } catch (error) {
      return { success: false, response: null, error: error.message || 'Text analysis failed' };
    }
  }

  /**
   * Analyze image using the vision model.
   * @param {Object} options
   * @param {string} [options.imagePath] - Path to image file
   * @param {string} [options.imageBase64] - Base64-encoded image data
   * @param {string} [options.prompt] - Prompt for the vision model
   * @param {number} [options.maxTokens] - Maximum tokens to generate
   * @param {number} [options.temperature] - Sampling temperature
   * @param {AbortSignal} [options.signal] - Abort signal for cancellation
   */
  async analyzeImage({
    imagePath,
    imageBase64,
    prompt = 'Describe this image.',
    maxTokens = 1024,
    temperature = 0.2,
    signal
  } = {}) {
    const imageSource = imageBase64 || imagePath;
    if (!imageSource) {
      return this.generateText({
        prompt,
        systemPrompt: 'You are a helpful assistant.',
        maxTokens,
        temperature,
        ...(signal && { signal })
      });
    }

    const operationId = `vision-${Date.now()}`;
    return this._coordinator.withModel(
      'vision',
      async () => {
        this._modelMemoryManager?.acquireRef('vision');
        try {
          return await withLlamaResilience(
            async () => {
              const startTime = Date.now();
              try {
                const modelName = this._selectedModels.vision || this._config.visionModel;
                await this._ensureVisionAssets(modelName);
                try {
                  await fs.access(path.join(this._modelsPath, modelName));
                } catch {
                  const missingModelError = new Error(`Vision model not found: ${modelName}`);
                  missingModelError.code = ERROR_CODES.LLAMA_MODEL_NOT_FOUND;
                  throw missingModelError;
                }
                if (
                  this._visionProjectorStatus.required &&
                  !this._visionProjectorStatus.available
                ) {
                  const missingError = new Error(
                    `Vision model not found: missing projector ${this._visionProjectorStatus.projectorName}`
                  );
                  missingError.code = ERROR_CODES.LLAMA_MODEL_NOT_FOUND;
                  throw missingError;
                }

                const visionService = getVisionService();
                logger.info('[LlamaService] Using local vision runtime for image analysis');
                const result = await visionService.analyzeImage({
                  imageBase64,
                  imagePath,
                  prompt,
                  systemPrompt:
                    'You are a vision assistant that analyzes images based on provided descriptions and OCR text.',
                  maxTokens,
                  temperature,
                  signal,
                  config: {
                    modelPath: path.join(this._modelsPath, modelName),
                    mmprojPath: this._visionProjectorStatus.projectorPath,
                    mmprojRequired: this._visionProjectorStatus.required,
                    contextSize: this._config.contextSize,
                    threads: this._config.threads,
                    gpuLayers: this._config.gpuLayers
                  }
                });

                this._metrics.recordTextGeneration(
                  Date.now() - startTime,
                  result?.response?.length ? result.response.length / 4 : 0,
                  true
                );
                return { response: result.response };
              } catch (error) {
                this._metrics.recordTextGeneration(Date.now() - startTime, 0, false);
                if (isOutOfMemoryError(error)) {
                  throw attachErrorCode(error, ERROR_CODES.LLAMA_OOM);
                }
                throw attachErrorCode(error, ERROR_CODES.LLAMA_INFERENCE_FAILED);
              }
            },
            { modelType: 'vision' }
          );
        } finally {
          this._modelMemoryManager?.releaseRef('vision');
        }
      },
      { operationId }
    );
  }

  async supportsVisionInput() {
    return this._supportsVisionInput();
  }

  /**
   * List available models
   */
  async listModels() {
    await this._ensureConfigLoaded();
    try {
      const files = await fs.readdir(this._modelsPath);
      return files
        .filter((f) => f.endsWith('.gguf'))
        .map((f) => {
          const lower = f.toLowerCase();
          let type = 'text';
          if (lower.includes('embed') || lower.includes('bge') || lower.includes('nomic-embed')) {
            type = 'embedding';
          } else if (
            lower.includes('vision') ||
            lower.includes('llava') ||
            lower.includes('bakllava')
          ) {
            type = 'vision';
          }
          return { name: f, path: path.join(this._modelsPath, f), type };
        });
    } catch {
      return [];
    }
  }

  /**
   * Get service status
   */
  getHealthStatus() {
    return {
      healthy: this._initialized,
      initialized: this._initialized,
      gpuBackend: this._gpuBackend,
      metrics: this._metrics.getMetrics(),
      memory: this._modelMemoryManager?.getMemoryStatus()
    };
  }

  async shutdown() {
    logger.info('[LlamaService] Shutting down...');

    // Clear PerformanceMetrics interval to prevent leaks
    if (this._metrics?.destroy) {
      try {
        this._metrics.destroy();
      } catch {
        /* ignore */
      }
    }

    // Unload models with error isolation
    if (this._modelMemoryManager) {
      try {
        await this._waitForIdleOperations('shutdown', 30000);
        await this._modelMemoryManager.unloadAll();
      } catch (error) {
        logger.warn('[LlamaService] Error unloading models during shutdown:', error?.message);
      }
    }

    // Dispose llama instance with error isolation
    if (this._llama) {
      try {
        await this._llama.dispose?.();
      } catch (error) {
        logger.warn('[LlamaService] Error disposing llama during shutdown:', error?.message);
      }
    }

    // Clean up circuit breaker timers
    cleanupLlamaCircuits();

    // Clean up all references to prevent stale state
    this._initialized = false;
    this._llama = null;
    this._models = {};
    this._contexts = {};
    this._modelChangeCallbacks.clear();
    this._coordinator = null;
    this._degradationManager = null;
  }
}

// Singleton export
const { getInstance, createInstance, registerWithContainer, resetInstance } =
  createSingletonHelpers({
    ServiceClass: LlamaService,
    serviceId: 'LLAMA_SERVICE',
    serviceName: 'LlamaService',
    containerPath: './ServiceContainer',
    shutdownMethod: 'shutdown'
  });

module.exports = {
  LlamaService,
  getInstance,
  createInstance,
  registerWithContainer,
  resetInstance,
  ALLOWED_EMBED_MODELS
};
