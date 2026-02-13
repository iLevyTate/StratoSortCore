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
const { AI_DEFAULTS, DEFAULT_AI_MODELS } = require('../../shared/constants');
const { getModel } = require('../../shared/modelRegistry');
const { resolveEmbeddingDimension } = require('../../shared/embeddingDimensions');
const { ERROR_CODES } = require('../../shared/errorCodes');
const SettingsService = require('./SettingsService');
const { getInstance: getVisionService } = require('./VisionService');
const { ensureResolvedModelsPath } = require('./modelPathResolver');

// New Managers
const { GPUMonitor } = require('./GPUMonitor');
const { ModelMemoryManager } = require('./ModelMemoryManager');
const { DegradationManager } = require('./DegradationManager');
const { ModelAccessCoordinator } = require('./ModelAccessCoordinator');
const { PerformanceMetrics } = require('./PerformanceMetrics');
const {
  withLlamaResilience,
  cleanupLlamaCircuits,
  shouldFallbackToCPU
} = require('./LlamaResilience');
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
  return message.includes('no sequences left');
};

const normalizeEmbeddingInput = (text, operationName = 'embedding') => {
  if (typeof text !== 'string') {
    const error = new TypeError(
      `[LlamaService] ${operationName} expects "text" to be a string; received ${typeof text}`
    );
    throw attachErrorCode(error, ERROR_CODES.INVALID_INPUT);
  }
  const normalized = text.trim();
  if (!normalized) {
    const error = new TypeError(`[LlamaService] ${operationName} requires non-empty text input`);
    throw attachErrorCode(error, ERROR_CODES.INVALID_INPUT);
  }
  return normalized;
};

let _nodeLlamaModule = null;
let _nodeLlamaLoadPromise = null;
async function loadNodeLlamaModule() {
  if (_nodeLlamaModule) return _nodeLlamaModule;
  // FIX: Store the import promise to prevent duplicate imports when two
  // concurrent callers both see _nodeLlamaModule === null. Without this,
  // both callers start a separate dynamic import() and the second overwrites
  // the first's result. Storing the promise ensures all callers await the
  // same in-flight import.
  if (!_nodeLlamaLoadPromise) {
    _nodeLlamaLoadPromise = import(/* webpackIgnore: true */ 'node-llama-cpp');
  }
  try {
    _nodeLlamaModule = await _nodeLlamaLoadPromise;
    return _nodeLlamaModule;
  } catch (error) {
    // Clear promise on failure so a future caller can retry
    _nodeLlamaLoadPromise = null;
    throw error;
  }
}

// Vision models (LLaVA) encode images into ~4000 tokens. This floor guarantees
// enough room for image tokens + prompt + response in the vision context.
const VISION_MIN_CONTEXT = 4608;
const LOW_VRAM_TEXT_CONTEXT = 4096;
const LOW_VRAM_VISION_CONTEXT = 4608;
const LOW_VRAM_VISION_BATCH_SIZE = 1024;
const LOW_VRAM_VISION_UBATCH_SIZE = 256;
const LOW_VRAM_VISION_RETRY_BATCH_SIZE = 512;
const LOW_VRAM_VISION_RETRY_UBATCH_SIZE = 128;
const LOW_VRAM_VISION_RETRY_MAX_TOKENS = 256;

// Default model configuration (from aiModelConfig)
const DEFAULT_CONFIG = {
  textModel: AI_DEFAULTS.TEXT?.MODEL ?? DEFAULT_AI_MODELS.TEXT_ANALYSIS,
  visionModel: AI_DEFAULTS.IMAGE?.MODEL ?? DEFAULT_AI_MODELS.IMAGE_ANALYSIS,
  embeddingModel: AI_DEFAULTS.EMBEDDING?.MODEL ?? DEFAULT_AI_MODELS.EMBEDDING,
  gpuLayers: 'auto', // 'auto' = let node-llama-cpp fit GPU layers to VRAM
  contextSize: 8192,
  threads: 0 // 0 = auto-detect
};

function parsePositiveInt(value) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

// Allowed embedding models for validation (must match MODEL_CATALOG in modelRegistry.js)
const ALLOWED_EMBED_MODELS = [
  'nomic-embed-text-v1.5-Q8_0.gguf',
  'nomic-embed-text-v1.5-Q4_K_M.gguf',
  'mxbai-embed-large-v1-f16.gguf'
];

// Helper to detect legacy Ollama model names
const isLegacyModelName = (name) => {
  if (!name || typeof name !== 'string') return false;
  return !name.endsWith('.gguf') && (name.includes(':') || !name.includes('.'));
};

class LlamaService extends EventEmitter {
  constructor() {
    super();
    this._initialized = false;
    this._modelsPath = null;
    this._config = { ...DEFAULT_CONFIG };
    this._configLoaded = false;
    this._configLoadPromise = null; // Promise gate for _ensureConfigLoaded()

    // Llama core
    this._llama = null;
    this._gpuBackend = null;
    this._detectedGpu = null;
    this._gpuSelection = null;

    // Managers
    this._gpuMonitor = new GPUMonitor();
    this._modelMemoryManager = null; // Initialized after llama
    this._degradationManager = null; // Initialized after llama
    this._coordinator = new ModelAccessCoordinator();

    // FIX Bug #34: Use singleton PerformanceMetrics or ensure cleanup
    // Since PerformanceMetrics is stateful (interval), we should use the singleton
    // or properly destroy the old one. Here we use the new instance but ensure
    // we destroy it in shutdown().
    this._metrics = new PerformanceMetrics();

    // Internal state
    this._models = { text: null, vision: null, embedding: null };
    this._contexts = { text: null, vision: null, embedding: null };
    this._selectedModels = { text: null, vision: null, embedding: null };
    this._preferredContextSize = { text: null, vision: null };
    this._preferredContextSequences = { text: null, vision: null };
    this._visionContextSize = null;
    this._modelChangeCallbacks = new Set();
    this._visionProjectorStatus = {
      required: false,
      available: false,
      projectorName: null,
      projectorPath: null
    };
    this._visionInputSupported = null;
    this._visionCheckPromise = null; // Promise gate for _supportsVisionInput()
    this._initPromise = null; // Promise gate to prevent concurrent initialize() calls

    // Concurrency gates
    this._configChangeGate = null;
    this._modelReloadGates = new Map();

    // Vision batch mode — keeps vision server alive across multiple images
    this._visionBatchMode = false;
    this._visionBatchModeRefs = 0;
    this._visionBatchModeLock = Promise.resolve();
  }

  _createGate() {
    let resolve;
    const promise = new Promise((res) => {
      resolve = res;
    });
    return { promise, resolve };
  }

  _generateOperationId(prefix) {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  async _withVisionBatchModeLock(fn) {
    const previous = this._visionBatchModeLock;
    let release;
    this._visionBatchModeLock = new Promise((resolve) => {
      release = resolve;
    });
    try {
      await previous;
      return await fn();
    } finally {
      release();
    }
  }

  _beginConfigChangeGate() {
    if (this._configChangeGate) return this._configChangeGate;
    this._configChangeGate = this._createGate();
    return this._configChangeGate;
  }

  _endConfigChangeGate() {
    if (!this._configChangeGate) return;
    this._configChangeGate.resolve();
    this._configChangeGate = null;
  }

  _beginModelReloadGate(modelType) {
    if (this._modelReloadGates.has(modelType)) {
      return this._modelReloadGates.get(modelType);
    }
    const gate = this._createGate();
    this._modelReloadGates.set(modelType, gate);
    return gate;
  }

  _endModelReloadGate(modelType) {
    const gate = this._modelReloadGates.get(modelType);
    if (!gate) return;
    gate.resolve();
    this._modelReloadGates.delete(modelType);
  }

  async _awaitModelReady(modelType) {
    if (this._configChangeGate) {
      await this._configChangeGate.promise;
    }
    const gate = this._modelReloadGates.get(modelType);
    if (gate) {
      await gate.promise;
    }
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
      try {
        const resolved = await ensureResolvedModelsPath();
        this._modelsPath = resolved.modelsPath;
        if (resolved.source === 'legacy') {
          logger.warn('[LlamaService] Using legacy models directory', {
            modelsPath: resolved.modelsPath,
            currentModelsPath: resolved.currentModelsPath
          });
        }
      } catch (e) {
        const base =
          typeof app?.getPath === 'function' && app.getPath('userData')
            ? app.getPath('userData')
            : os.tmpdir();
        this._modelsPath = path.join(base, 'models');
        try {
          await fs.mkdir(this._modelsPath, { recursive: true });
        } catch {
          // Non-fatal in tests and restricted environments; model ops will surface errors later.
        }
        logger.debug('[LlamaService] Falling back to default models directory:', e?.message);
      }
    }

    if (this._configLoaded) return;

    // FIX: Use a promise gate to prevent concurrent callers from both
    // triggering _loadConfig(). Without this, two concurrent callers both
    // see _configLoaded === false, both call _loadConfig(), and the second
    // may overwrite partially-set state from the first.
    if (this._configLoadPromise) {
      return this._configLoadPromise;
    }

    this._configLoadPromise = this._loadConfig().then(() => {
      this._configLoaded = true;
    });

    try {
      await this._configLoadPromise;
    } catch (error) {
      // Clear promise on failure so a future caller can retry
      this._configLoadPromise = null;
      throw error;
    } finally {
      // Clear promise reference after completion (success path keeps _configLoaded = true)
      this._configLoadPromise = null;
    }
  }

  _applyContextSizing() {
    const vramMB = this._detectedGpu?.vramMB || 0;
    const isCpu = this._gpuBackend === 'cpu';

    // Auto-detect a sensible default only when no valid context size is configured.
    // Never clamp user-configured values; the fallback ladder in _loadModel
    // handles OOM dynamically by trying progressively smaller sizes.
    if (!Number.isFinite(this._config.contextSize) || this._config.contextSize <= 0) {
      let autoSize = 4096;
      if (isCpu) {
        autoSize = 2048;
      } else if (vramMB >= 12000) {
        autoSize = 8192;
      } else if (vramMB >= 8000) {
        autoSize = 6144;
      }
      this._config.contextSize = autoSize;
      logger.info('[LlamaService] Context size auto-configured', {
        contextSize: autoSize,
        vramMB: vramMB || null,
        backend: this._gpuBackend
      });
    }

    // Ensure the vision context is always large enough for image tokens + prompt + response.
    // On lower-VRAM GPUs, cap vision context to a safe floor to avoid decode/KV pressure.
    const configuredVisionContext = Math.max(this._config.contextSize, VISION_MIN_CONTEXT);
    this._visionContextSize =
      !isCpu && vramMB > 0 && vramMB < 8000
        ? Math.min(configuredVisionContext, LOW_VRAM_VISION_CONTEXT)
        : configuredVisionContext;

    // On lower-VRAM GPUs, avoid repeatedly attempting oversized contexts first.
    // Keep the configured value unchanged, but bias first-attempt context selection
    // via preferred sizes to reduce avoidable retries and KV-cache pressure.
    if (!isCpu && vramMB > 0 && vramMB < 8000) {
      this._preferredContextSize.text = Math.min(
        Math.max(this._config.contextSize, 1024),
        LOW_VRAM_TEXT_CONTEXT
      );
      this._preferredContextSize.vision = Math.min(
        Math.max(this._visionContextSize, VISION_MIN_CONTEXT),
        LOW_VRAM_VISION_CONTEXT
      );
      this._preferredContextSequences.text = 1;
      this._preferredContextSequences.vision = 1;
      logger.info('[LlamaService] Applied low-VRAM context preferences', {
        vramMB,
        preferredTextContext: this._preferredContextSize.text,
        preferredVisionContext: this._preferredContextSize.vision,
        preferredSequences: 1
      });
    } else {
      this._preferredContextSize.text = null;
      this._preferredContextSize.vision = null;
      this._preferredContextSequences.text = null;
      this._preferredContextSequences.vision = null;
    }

    logger.debug('[LlamaService] Context sizing resolved', {
      textContext: this._config.contextSize,
      visionContext: this._visionContextSize,
      vramMB: vramMB || null,
      backend: this._gpuBackend
    });
  }

  _getEffectiveContextSize(type = 'text') {
    if (type === 'vision') {
      // Prefer the pre-computed vision context size from _applyContextSizing.
      // If null (e.g. after updateConfig reset), recompute from current config
      // with the minimum floor guarantee so image analysis always works.
      if (Number.isFinite(this._visionContextSize)) {
        return this._visionContextSize;
      }
      return Math.max(this._config.contextSize, VISION_MIN_CONTEXT);
    }
    const preferred = this._preferredContextSize?.[type];
    if (Number.isFinite(preferred) && preferred > 0) {
      return preferred;
    }
    return this._config.contextSize;
  }

  _isLowVramProfile() {
    const vramMB = this._detectedGpu?.vramMB || 0;
    return this._gpuBackend !== 'cpu' && vramMB > 0 && vramMB < 8000;
  }

  _isUnknownVramGpuProfile() {
    const vramMB = this._detectedGpu?.vramMB || 0;
    return this._gpuBackend !== 'cpu' && vramMB <= 0;
  }

  _shouldUseConservativeVisionProfile() {
    return this._isLowVramProfile() || this._isUnknownVramGpuProfile();
  }

  _buildVisionRuntimeProfile({ maxTokens, retryDegraded = false } = {}) {
    const effectiveContextSize = this._getEffectiveContextSize('vision');
    const envBatchSize = parsePositiveInt(process.env.STRATOSORT_VISION_BATCH_SIZE);
    const envUbatchSize = parsePositiveInt(process.env.STRATOSORT_VISION_UBATCH_SIZE);
    const useConservativeProfile = this._shouldUseConservativeVisionProfile();

    const defaultBatchSize = retryDegraded
      ? LOW_VRAM_VISION_RETRY_BATCH_SIZE
      : LOW_VRAM_VISION_BATCH_SIZE;
    const defaultUbatchSize = retryDegraded
      ? LOW_VRAM_VISION_RETRY_UBATCH_SIZE
      : LOW_VRAM_VISION_UBATCH_SIZE;

    const profile = {
      contextSize: effectiveContextSize,
      batchSize: envBatchSize || (useConservativeProfile ? defaultBatchSize : null),
      ubatchSize: envUbatchSize || (useConservativeProfile ? defaultUbatchSize : null),
      maxTokens:
        retryDegraded && useConservativeProfile
          ? Math.max(
              64,
              Math.min(
                Number(maxTokens) || LOW_VRAM_VISION_RETRY_MAX_TOKENS,
                LOW_VRAM_VISION_RETRY_MAX_TOKENS
              )
            )
          : maxTokens
    };

    return profile;
  }

  _isVisionDecodePressureError(errorLike) {
    const message = String(errorLike?.message || errorLike || '').toLowerCase();
    return (
      message.includes('failed to process image') ||
      message.includes('failed to decode image') ||
      message.includes('failed to find a memory slot') ||
      message.includes('kv cache') ||
      message.includes('out of memory') ||
      message.includes('mtmd_helper_eval failed')
    );
  }

  _getContextSequences(type = 'text') {
    const preferred = this._preferredContextSequences?.[type];
    if (Number.isFinite(preferred) && preferred > 0) return preferred;
    if (type === 'embedding') return 1;
    if (this._gpuBackend === 'cpu') return 1;
    const vramMB = this._detectedGpu?.vramMB || 0;
    if (vramMB > 0 && vramMB < 7000) return 1;
    return 2;
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
      contextSize: this._getEffectiveContextSize('text'),
      visionContextSize: this._getEffectiveContextSize('vision'),
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
    // Backward-compatible key mapping:
    // IPC/settings historically used llamaGpuLayers/llamaContextSize,
    // while internal code uses gpuLayers/contextSize.
    const resolvedGpuLayers =
      partial.gpuLayers ?? partial.llamaGpuLayers ?? partial.llamaGPULayers ?? undefined;
    const resolvedContextSize = partial.contextSize ?? partial.llamaContextSize ?? undefined;

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

    if (typeof resolvedGpuLayers === 'number') this._config.gpuLayers = resolvedGpuLayers;
    if (typeof resolvedContextSize === 'number') {
      this._config.contextSize = resolvedContextSize;
      this._preferredContextSize.text = null;
      this._preferredContextSize.vision = null;
      this._preferredContextSequences.text = null;
      this._preferredContextSequences.vision = null;
      this._visionContextSize = null;
    }
    if (typeof partial.threads === 'number') this._config.threads = partial.threads;

    if (!skipSave) {
      try {
        await SettingsService.getInstance().save({
          textModel: this._selectedModels.text,
          visionModel: this._selectedModels.vision,
          embeddingModel: this._selectedModels.embedding,
          llamaGpuLayers: this._config.gpuLayers,
          llamaContextSize: this._config.contextSize
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
    const needsGate = changedTypes.length > 0;
    if (needsGate) {
      this._beginConfigChangeGate();
    }
    try {
      if (changedTypes.length > 0 && this._modelMemoryManager) {
        // Acquire load locks before unloading to avoid crashing in-flight inference
        const releaseLocks = [];
        try {
          for (const type of changedTypes) {
            if (this._coordinator) {
              releaseLocks.push(await this._coordinator.acquireLoadLock(type));
            }
          }
          const safeToUnload = await this._waitForIdleOperations('config-change', 60000);
          if (safeToUnload) {
            await this._modelMemoryManager.unloadAll();
          } else {
            logger.warn(
              '[LlamaService] Skipping unloadAll due to active operations - config change will apply on next load'
            );
          }
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
    } finally {
      if (needsGate) {
        this._endConfigChangeGate();
      }
    }

    // Reset circuit breakers for changed model types — the old breaker state
    // reflects failures from the previous model, not the newly selected one.
    if (changedTypes.length > 0) {
      const { resetLlamaCircuit: resetCircuit } = require('./LlamaResilience');
      for (const type of changedTypes) {
        resetCircuit(type);
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

    // Promise gate: concurrent callers all await the same initialization.
    // Without this, two concurrent calls both see _initialized = false and
    // both proceed, creating duplicate managers and orphaning state.
    if (this._initPromise) return this._initPromise;

    this._initPromise = this._doInitialize();
    try {
      await this._initPromise;
    } catch (error) {
      // Clear the promise so a future retry can attempt initialization again
      this._initPromise = null;
      throw error;
    }
  }

  /** @private Actual initialization logic, called once via the promise gate. */
  async _doInitialize() {
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

      // Apply context sizing based on detected GPU/CPU budgets
      this._applyContextSizing();

      // Initialize Memory Manager with GPU info for VRAM-aware budgeting
      this._modelMemoryManager = new ModelMemoryManager(this, {
        gpuInfo: this._detectedGpu || null
      });

      // Upgrade coordinator with GPU-aware concurrency from PerformanceService
      try {
        const { getRecommendedConcurrency } = require('./PerformanceService');
        const recs = await getRecommendedConcurrency();
        if (recs.maxConcurrent > 1) {
          if (
            this._coordinator &&
            typeof this._coordinator.updateInferenceConcurrency === 'function'
          ) {
            this._coordinator.updateInferenceConcurrency(recs.maxConcurrent);
          } else {
            this._coordinator = new ModelAccessCoordinator({
              inferenceSlots: recs.maxConcurrent
            });
          }
          logger.info('[LlamaService] Coordinator upgraded with GPU-aware concurrency', {
            maxConcurrent: recs.maxConcurrent,
            reason: recs.reason,
            vramMB: recs.vramMB,
            gpuName: recs.gpuName
          });
        }
      } catch (perfError) {
        logger.debug('[LlamaService] PerformanceService not available, using default concurrency', {
          error: perfError?.message
        });
      }

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
      this._detectedGpu = gpuInfo;
      logger.info('[LlamaService] System GPU detected', {
        type: gpuInfo.type,
        name: gpuInfo.name,
        vramMB: gpuInfo.vramMB || 0
      });
    } catch {
      this._detectedGpu = null;
      logger.debug('[LlamaService] GPU detection skipped');
    }

    // Initialize Llama backend deterministically (CUDA -> auto -> CPU)
    try {
      const { initLlamaWithBackend } = require('../utils/llamaBackendSelector');
      const selection = await initLlamaWithBackend({
        getLlama,
        gpuInfo: this._detectedGpu,
        logger,
        context: 'LlamaService'
      });
      this._llama = selection.llama;
      this._gpuBackend = selection.backend;
      this._gpuSelection = selection.selection;
    } catch (error) {
      logger.warn('[LlamaService] GPU initialization failed, falling back to CPU', {
        error: error?.message
      });
      this._llama = await getLlama({ gpu: false });
      this._gpuBackend = 'cpu';
      this._gpuSelection = {
        attempted: [],
        selected: 'cpu',
        requested: 'cpu',
        detectedGpu: this._detectedGpu || null
      };
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

      // Helper to resolve model name (fallback to default if legacy/missing)
      const resolveModel = (configured, defaultName, type) => {
        if (!configured) return defaultName;
        if (isLegacyModelName(configured)) {
          logger.warn(
            `[LlamaService] Detected legacy ${type} model name "${configured}", falling back to default`,
            {
              legacy: configured,
              fallback: defaultName
            }
          );
          return defaultName;
        }
        return configured;
      };

      this._selectedModels = {
        text: resolveModel(settings.textModel, AI_DEFAULTS.TEXT.MODEL, 'text'),
        vision: resolveModel(settings.visionModel, AI_DEFAULTS.IMAGE.MODEL, 'vision'),
        embedding: resolveModel(settings.embeddingModel, AI_DEFAULTS.EMBEDDING.MODEL, 'embedding')
      };

      if (typeof settings.llamaGpuLayers === 'number') {
        this._config.gpuLayers = settings.llamaGpuLayers;
      }
      if (typeof settings.llamaContextSize === 'number') {
        this._config.contextSize = settings.llamaContextSize;
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
   * Ensure a model is loaded and ready.
   * Uses ModelMemoryManager to handle swapping and OOM prevention.
   *
   * Always acquires the coordinator load lock to prevent use-after-dispose
   * races where a concurrent updateConfig() or enterVisionBatchMode() could
   * dispose the context between the fast-path return and the caller's first await.
   * The lock is fast when the model is already loaded (ensureModelLoaded returns
   * immediately with the existing context).
   *
   * Note: ParallelEmbeddingService uses pinModel()/unpinModel() instead of
   * acquireModelLoadLock() to avoid deadlock with this non-reentrant lock.
   */
  async _ensureModelLoaded(modelType) {
    if (!this._initialized) await this.initialize();

    const releaseLock = await this._coordinator.acquireLoadLock(modelType);

    try {
      return await this._modelMemoryManager.ensureModelLoaded(modelType);
    } catch (error) {
      // Handle degradation (e.g., model file corruption, OOM, disk full)
      const resolution = await this._degradationManager.handleError(error, { modelType });
      if (resolution.action === 'redownload_model') {
        const redownloadError = new Error(
          `Model corrupted, please redownload: ${this._selectedModels[modelType]}`
        );
        redownloadError.code = ERROR_CODES.LLAMA_MODEL_LOAD_FAILED;
        throw redownloadError;
      }
      if (resolution.action === 'retry_with_cpu') {
        logger.warn(
          `[LlamaService] GPU OOM loading ${modelType} — DegradationManager suggests CPU fallback`
        );
        // Surface the action so withLlamaResilience can trigger CPU fallback
        error._degradationAction = 'retry_with_cpu';
      }
      if (resolution.action === 'cleanup_disk') {
        const diskError = new Error(
          `Disk full, cannot load ${modelType} model. Please free up space.`
        );
        diskError.code = ERROR_CODES.LLAMA_MODEL_LOAD_FAILED;
        throw diskError;
      }
      throw error;
    } finally {
      releaseLock();
    }
  }

  async _waitForIdleOperations(reason, timeoutMs = 30000, options = {}) {
    if (!this._coordinator) return;
    const { modelType, excludeOperationId } = options || {};
    const getActiveCount = (status) => {
      const operations = Array.isArray(status?.operations) ? status.operations : [];
      return operations.filter((op) => {
        if (excludeOperationId && op.id === excludeOperationId) return false;
        if (modelType && op.modelType !== modelType) return false;
        return true;
      }).length;
    };
    const start = Date.now();
    let status = this._coordinator.getStatus();
    let activeCount = getActiveCount(status);
    while (activeCount > 0 && Date.now() - start < timeoutMs) {
      await delay(100);
      status = this._coordinator.getStatus();
      activeCount = getActiveCount(status);
    }
    if (activeCount > 0) {
      logger.warn(
        '[LlamaService] Operations still active after wait, aborting model unload to prevent crash',
        {
          reason,
          activeOperations: activeCount,
          modelType,
          excludeOperationId
        }
      );
      // Do not unload if operations are active - this prevents segfaults/crashes
      // The config change will apply to *future* loads, but current models stay resident
      return false;
    }
    return true;
  }

  /**
   * Acquire a model load lock to prevent configuration changes during a batch.
   * @param {string} modelType
   * @returns {Promise<Function>} release callback
   */
  async acquireModelLoadLock(modelType) {
    if (!this._coordinator) return () => {};
    return this._coordinator.acquireLoadLock(modelType);
  }

  /**
   * Pin a model to prevent the memory manager from evicting it.
   * Use this instead of acquireModelLoadLock() when you need to keep a model
   * resident during a batch but the batch's items will call generateEmbedding()
   * (which internally acquires the non-reentrant load lock).
   * Callers MUST call unpinModel() when done.
   * @param {string} modelType
   */
  pinModel(modelType) {
    this._modelMemoryManager?.acquireRef(modelType);
  }

  /**
   * Unpin a model, allowing the memory manager to evict it if needed.
   * @param {string} modelType
   */
  unpinModel(modelType) {
    this._modelMemoryManager?.releaseRef(modelType);
  }

  async _recoverFromSequenceExhaustion(modelType, error) {
    logger.warn('[LlamaService] Sequence exhaustion detected, reloading model', {
      modelType,
      error: error?.message
    });
    const currentSeq = this._preferredContextSequences?.[modelType];
    if (!Number.isFinite(currentSeq) || currentSeq > 1) {
      this._preferredContextSequences[modelType] = 1;
      logger.info('[LlamaService] Reduced sequences to 1 after exhaustion', { modelType });
    }
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
    await delay(100);
  }

  async _supportsVisionInput() {
    if (this._visionInputSupported != null) return this._visionInputSupported;

    // FIX: Use a promise gate to prevent duplicate vision asset checks when
    // concurrent callers both see _visionInputSupported === null.
    if (this._visionCheckPromise) return this._visionCheckPromise;

    this._visionCheckPromise = (async () => {
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
    })();

    try {
      return await this._visionCheckPromise;
    } finally {
      this._visionCheckPromise = null;
    }
  }

  /**
   * Determine the optimal GPU layer strategy based on available VRAM and the
   * actual GGUF model file size. Returns:
   *   - 999  → VRAM clearly sufficient for full offload (model + KV cache + overhead)
   *   - undefined → VRAM is tight; let node-llama-cpp auto-detect optimal layers
   *
   * Uses the real file size from disk (most accurate proxy for GPU memory) when
   * available, with a type-based estimate as fallback.
   *
   * The 60% VRAM threshold reserves ~40% for KV cache, OS/driver compositor,
   * and safety margin — suitable for laptops (shared thermal/power budgets)
   * through desktop GPUs with 4-24GB+ VRAM.
   *
   * @param {string} modelPath - Path to the GGUF model file
   * @param {string} type - Model type ('text', 'vision', 'embedding')
   * @returns {number|undefined} GPU layers value (999 = max, undefined = auto)
   * @private
   */
  _resolveGpuLayerStrategy(modelPath, type) {
    const vramMB = this._detectedGpu?.vramMB || 0;
    if (vramMB <= 0) {
      // No GPU info available — let node-llama-cpp decide
      return undefined;
    }

    // Best effort: read the actual GGUF file size (most accurate proxy for
    // model weight memory). Falls back to rough per-type estimates.
    let modelSizeMB;
    try {
      const stats = require('fs').statSync(modelPath);
      modelSizeMB = Math.ceil(stats.size / (1024 * 1024));
    } catch {
      const TYPE_ESTIMATES_MB = { embedding: 500, text: 4096, vision: 5120 };
      modelSizeMB = TYPE_ESTIMATES_MB[type] || 4096;
    }

    // If model file size is under 60% of VRAM, full offloading should be safe.
    // The remaining 40% covers KV cache, context buffers, OS compositor, and
    // driver overhead — conservative enough for laptop GPUs with tight VRAM.
    const maxSafeModelMB = Math.floor(vramMB * 0.6);

    if (modelSizeMB < maxSafeModelMB) {
      logger.debug('[LlamaService] VRAM sufficient for full GPU offload', {
        type,
        modelSizeMB,
        vramMB,
        headroomMB: maxSafeModelMB - modelSizeMB
      });
      return 999;
    }

    logger.debug('[LlamaService] VRAM tight, using auto GPU layer detection', {
      type,
      modelSizeMB,
      vramMB,
      deficitMB: modelSizeMB - maxSafeModelMB
    });
    return undefined;
  }

  /**
   * ACTUAL model loading logic called by ModelMemoryManager
   * @param {string} type - Model type ('text', 'vision', 'embedding')
   * @param {Object} [options={}] - Loading options
   * @param {number} [options.gpuLayersOverride] - Override GPU layers (e.g., 0 for CPU fallback)
   * @private
   */
  async _loadModel(type, options = {}) {
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
      // If primary model is missing, try default model as fallback
      const defaultModel =
        type === 'text'
          ? AI_DEFAULTS.TEXT.MODEL
          : type === 'vision'
            ? AI_DEFAULTS.IMAGE.MODEL
            : AI_DEFAULTS.EMBEDDING.MODEL;

      if (modelName !== defaultModel) {
        const defaultPath = path.join(this._modelsPath, defaultModel);
        try {
          await fs.access(defaultPath);
          logger.warn(
            `[LlamaService] Configured ${type} model "${modelName}" not found, falling back to default "${defaultModel}"`
          );
          this._selectedModels[type] = defaultModel;
          // Recursively call with the new model
          return this._loadModel(type, options);
        } catch {
          // Default also missing, proceed to throw original error
        }
      }

      const notFoundError = new Error(`Model not found: ${modelName}`);
      notFoundError.code = ERROR_CODES.LLAMA_MODEL_NOT_FOUND;
      throw notFoundError;
    }

    const startTime = Date.now();
    logger.info(`[LlamaService] Loading ${type} model: ${modelName}`);

    try {
      // Resolve gpuLayers with a three-tier fallback strategy:
      //   1. Max offload (gpuLayers: 999) — request all layers on GPU.
      //      node-llama-cpp clamps to the model's actual layer count.
      //   2. Auto (gpuLayers: undefined) — let node-llama-cpp conservatively
      //      pick layers that fit in available VRAM.
      //   3. CPU only (gpuLayers: 0) — no GPU offloading.
      // gpuLayersOverride takes precedence (set by CPU fallback retries).
      let gpuLayers;
      if (typeof options.gpuLayersOverride === 'number') {
        gpuLayers = options.gpuLayersOverride;
        logger.info(`[LlamaService] GPU layers overridden for ${type}`, {
          override: gpuLayers,
          reason: gpuLayers === 0 ? 'CPU fallback' : 'explicit'
        });
      } else if (options._gpuAutoFallback) {
        // Tier 2: intermediate fallback — let node-llama-cpp auto-detect
        gpuLayers = undefined;
        logger.info(`[LlamaService] GPU layers auto-detection for ${type} (fallback from max)`);
      } else {
        const configLayers = this._config.gpuLayers;
        if (typeof configLayers === 'number' && configLayers >= 0) {
          // Explicit numeric configuration from user (e.g., 20)
          gpuLayers = configLayers;
        } else {
          // 'auto', -1, null, undefined: use VRAM-aware strategy.
          // Compares actual model file size against available VRAM to decide
          // between max offloading (999) and auto-detection (undefined).
          // The three-tier fallback chain (max → auto → CPU) is the safety net.
          gpuLayers = this._resolveGpuLayerStrategy(modelPath, type);
        }
      }

      let model;
      try {
        const modelOptions = { modelPath };
        if (typeof gpuLayers === 'number') {
          modelOptions.gpuLayers = gpuLayers;
        }
        model = await this._llama.loadModel(modelOptions);
      } catch (err) {
        if (shouldFallbackToCPU(err)) {
          // Tier 2: max failed → try auto-detection
          if (!options._gpuAutoFallback && !options._cpuFallbackTried && gpuLayers > 0) {
            logger.warn('[LlamaService] Max GPU offload failed, falling back to auto-detection', {
              error: err?.message || String(err)
            });
            return this._loadModel(type, { ...options, _gpuAutoFallback: true });
          }
          // Tier 3: auto failed → try CPU only
          if (!options._cpuFallbackTried) {
            logger.warn('[LlamaService] GPU offload failed, falling back to CPU', {
              error: err?.message || String(err)
            });
            return this._loadModel(type, {
              ...options,
              gpuLayersOverride: 0,
              _cpuFallbackTried: true
            });
          }
        }
        throw err;
      }

      logger.info(`[LlamaService] Model ${type} GPU offload`, {
        requestedLayers:
          gpuLayers === 999 ? 'max' : typeof gpuLayers === 'number' ? gpuLayers : 'auto',
        actualGpuLayers: model.gpuLayers ?? 'unknown',
        backend: this._gpuBackend
      });

      let context;
      let lastError;

      if (type === 'embedding') {
        try {
          context = await model.createEmbeddingContext();
        } catch (err) {
          lastError = err;
          logger.warn(`[LlamaService] Failed to create embedding context: ${err.message}`);

          if (shouldFallbackToCPU(err)) {
            // Tier 2: max → auto
            if (
              !options._gpuAutoFallback &&
              !options._cpuFallbackTried &&
              typeof gpuLayers === 'number' &&
              gpuLayers > 0
            ) {
              logger.warn('[LlamaService] Embedding context failed, falling back to auto GPU');
              try {
                await model.dispose?.();
              } catch {
                /* ignore */
              }
              return this._loadModel(type, { ...options, _gpuAutoFallback: true });
            }
            // Tier 3: auto → CPU
            if (!options._cpuFallbackTried && gpuLayers !== 0) {
              logger.warn('[LlamaService] Embedding context failed on GPU, retrying on CPU');
              try {
                await model.dispose?.();
              } catch {
                /* ignore */
              }
              return this._loadModel(type, {
                ...options,
                gpuLayersOverride: 0,
                _cpuFallbackTried: true
              });
            }
          }
        }
      } else {
        // Try to create context, falling back to smaller sizes if OOM/failure occurs
        const configuredSize = this._config.contextSize;
        const preferredSize = this._preferredContextSize?.[type];
        const candidates = [];
        if (Number.isFinite(preferredSize) && preferredSize > 0) {
          candidates.push(preferredSize);
        }
        if (!candidates.includes(configuredSize)) {
          candidates.push(configuredSize);
        }
        if (configuredSize > 4096 && !candidates.includes(4096)) candidates.push(4096);
        if (configuredSize > 2048 && !candidates.includes(2048)) candidates.push(2048);
        if (configuredSize > 1024 && !candidates.includes(1024)) candidates.push(1024);

        const baseSequences = this._getContextSequences(type);
        const sequenceCandidates = [];
        if (Number.isFinite(baseSequences) && baseSequences > 0) {
          sequenceCandidates.push(baseSequences);
        }
        if (!sequenceCandidates.includes(1)) sequenceCandidates.push(1);

        let contextCreated = false;
        for (const size of candidates) {
          for (const sequences of sequenceCandidates) {
            try {
              context = await model.createContext({
                contextSize: size,
                sequences
              });

              if (size !== configuredSize) {
                logger.warn(
                  `[LlamaService] Context creation failed for size ${configuredSize}, fell back to ${size}`
                );
              }
              if (sequences !== baseSequences) {
                logger.warn('[LlamaService] Reduced context sequences to fit VRAM', {
                  type,
                  sequences
                });
              }

              this._preferredContextSize[type] = size;
              this._preferredContextSequences[type] = sequences;
              if (size < this._config.contextSize) {
                logger.info('[LlamaService] Updated effective context size after fallback', {
                  type,
                  contextSize: size
                });
              }
              contextCreated = true;
              break;
            } catch (err) {
              lastError = err;
              logger.warn(
                `[LlamaService] Failed to create ${type} context with size ${size} and sequences ${sequences}: ${err.message}`
              );
            }
          }
          if (contextCreated) break;
        }

        if (!context && shouldFallbackToCPU(lastError)) {
          // Exhausted all context candidates on the current backend profile.
          // Only now escalate to auto GPU / CPU fallback.
          if (
            !options._gpuAutoFallback &&
            !options._cpuFallbackTried &&
            typeof gpuLayers === 'number' &&
            gpuLayers > 0
          ) {
            logger.warn('[LlamaService] Context candidates exhausted, falling back to auto GPU');
            try {
              await model.dispose?.();
            } catch {
              /* ignore */
            }
            return this._loadModel(type, { ...options, _gpuAutoFallback: true });
          }
          if (!options._cpuFallbackTried && gpuLayers !== 0) {
            logger.warn('[LlamaService] Context candidates exhausted on GPU, retrying on CPU');
            try {
              await model.dispose?.();
            } catch {
              /* ignore */
            }
            return this._loadModel(type, {
              ...options,
              gpuLayersOverride: 0,
              _cpuFallbackTried: true
            });
          }
        }
      }

      if (!context) {
        // CRITICAL FIX: Dispose the loaded model to prevent GPU memory leak.
        // Without this, the model stays resident in VRAM despite having no
        // usable context, and repeated retries can exhaust GPU memory.
        try {
          await model?.dispose();
        } catch (disposeErr) {
          logger.debug('[LlamaService] Failed to dispose model after context failure', {
            type,
            error: disposeErr?.message
          });
        }
        throw lastError || new Error('Failed to create context');
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
   * Force-reload a model in CPU-only mode.
   * Called by resilience layer when GPU errors are detected.
   * @param {string} modelType - Model type to reload
   * @private
   */
  async _reloadModelCPU(modelType, options = {}) {
    logger.warn(`[LlamaService] Reloading ${modelType} model in CPU-only mode`);

    const releaseLock = this._coordinator
      ? await this._coordinator.acquireLoadLock(modelType)
      : null;
    this._beginModelReloadGate(modelType);
    const { operationId } = options || {};

    try {
      // FIX: Use a shorter timeout (10s) for idle-wait during CPU fallback.
      // Other operations of the same model type may be blocked on the reload
      // gate that we just acquired, creating a circular wait. A shorter timeout
      // prevents a 60s hang; if operations are still active after 10s, they are
      // likely blocked on us, so proceeding with the reload is the correct action.
      const safeToReload = await this._waitForIdleOperations('cpu-fallback', 10000, {
        modelType,
        excludeOperationId: operationId
      });
      if (!safeToReload) {
        logger.warn(
          '[LlamaService] Other operations still active during CPU fallback — ' +
            'likely blocked on reload gate. Proceeding with reload.',
          { modelType, operationId }
        );
        // Don't throw — proceed with the reload. Operations waiting on the gate
        // will get the new CPU-loaded model when we release the gate.
      }

      // Unload via ModelMemoryManager to keep its tracking (_loadedModels map,
      // _currentMemoryUsage) consistent. Bypassing the manager leaves stale
      // entries that cause getLoadedContext() to return disposed contexts.
      if (this._modelMemoryManager) {
        await this._modelMemoryManager.unloadModel(modelType);
      } else {
        // Fallback: no memory manager yet (early startup). Dispose directly.
        if (this._contexts[modelType]) {
          try {
            await this._contexts[modelType].dispose?.();
          } catch {
            /* ignore */
          }
          this._contexts[modelType] = null;
        }
        if (this._models[modelType]) {
          try {
            await this._models[modelType].dispose?.();
          } catch {
            /* ignore */
          }
          this._models[modelType] = null;
        }
      }

      // Reset circuit breaker before CPU reload — the GPU failures that triggered
      // this fallback are not indicative of the CPU path's health.
      const { resetLlamaCircuit: resetCircuitCPU } = require('./LlamaResilience');
      resetCircuitCPU(modelType);

      // Reload with gpuLayers: 0 (CPU only)
      if (this._modelMemoryManager) {
        return this._modelMemoryManager.ensureModelLoaded(modelType, { gpuLayersOverride: 0 });
      }
      return this._loadModel(modelType, { gpuLayersOverride: 0 });
    } finally {
      this._endModelReloadGate(modelType);
      if (releaseLock) {
        try {
          releaseLock();
        } catch {
          /* ignore */
        }
      }
    }
  }

  /**
   * Generate embedding with resilience, metrics, and fallback model chain.
   *
   * If the primary embedding model is missing or fails to load, tries each model
   * in AI_DEFAULTS.EMBEDDING.FALLBACK_MODELS before giving up. This mirrors the
   * fallback behavior of the old OllamaService.
   */
  async generateEmbedding(text, _options = {}) {
    const normalizedText = normalizeEmbeddingInput(text, 'generateEmbedding');
    const operationId = `embed-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await this._awaitModelReady('embedding');

    return this._coordinator.withModel(
      'embedding',
      async () => {
        this._modelMemoryManager?.acquireRef('embedding');
        try {
          try {
            return await this._executeEmbeddingInference(normalizedText, { operationId });
          } catch (error) {
            return await this._tryEmbeddingFallback(normalizedText, error);
          }
        } finally {
          this._modelMemoryManager?.releaseRef('embedding');
        }
      },
      { operationId }
    );
  }

  /**
   * Core embedding inference wrapped in resilience (retry + circuit breaker).
   * @private
   */
  async _executeEmbeddingInference(text, options = {}) {
    return withLlamaResilience(
      async (retryOptions) => {
        // Handle CPU fallback from LlamaResilience when GPU errors occur
        if (retryOptions?.forceCPU && this._gpuBackend !== 'cpu') {
          await this._reloadModelCPU('embedding', options);
        }

        const startTime = Date.now();

        try {
          const context = await this._ensureModelLoaded('embedding');

          const embedding = await context.getEmbeddingFor(text);
          const vector = Array.from(embedding.vector);
          const durationMs = Date.now() - startTime;

          this._metrics.recordEmbedding(durationMs, true);

          logger.debug('[LlamaService] Embedding generated', {
            model: this._selectedModels.embedding,
            inputChars: text?.length || 0,
            dimensions: vector.length,
            durationMs,
            gpu: this._gpuBackend !== 'cpu'
          });

          return {
            embedding: vector,
            model: this._selectedModels.embedding
          };
        } catch (error) {
          this._metrics.recordEmbedding(Date.now() - startTime, false);
          if (isOutOfMemoryError(error)) {
            throw attachErrorCode(error, ERROR_CODES.LLAMA_OOM);
          }
          const originalCode = error?.code || error?.originalError?.code;
          if (
            originalCode === ERROR_CODES.LLAMA_MODEL_NOT_FOUND ||
            originalCode === ERROR_CODES.LLAMA_MODEL_LOAD_FAILED
          ) {
            throw attachErrorCode(error, originalCode);
          }
          throw attachErrorCode(error, ERROR_CODES.LLAMA_INFERENCE_FAILED);
        }
      },
      { modelType: 'embedding' }
    );
  }

  /**
   * One-off embedding inference for a specific model without mutating selection.
   * Used only for fallback attempts to avoid mid-batch model changes.
   * @private
   */
  async _executeEmbeddingInferenceWithModel(text, modelName) {
    if (!this._initialized) {
      await this.initialize();
    }
    await this._ensureConfigLoaded();

    const resolvedName = String(modelName || '').trim();
    if (!resolvedName) {
      const noModelError = new Error('No embedding model configured');
      noModelError.code = ERROR_CODES.LLAMA_MODEL_NOT_FOUND;
      throw noModelError;
    }

    const modelPath = path.join(this._modelsPath, resolvedName);
    try {
      await fs.access(modelPath);
    } catch {
      const notFoundError = new Error(`Model not found: ${resolvedName}`);
      notFoundError.code = ERROR_CODES.LLAMA_MODEL_NOT_FOUND;
      throw notFoundError;
    }

    const normalizedText = normalizeEmbeddingInput(text, '_executeEmbeddingInferenceWithModel');

    const inferWithOptions = async (loadOptions = {}) => {
      let model = null;
      let context = null;
      const startTime = Date.now();

      try {
        let gpuLayers;
        const configLayers = this._config.gpuLayers;
        if (loadOptions.forceCPU || loadOptions._cpuFallbackTried) {
          gpuLayers = 0;
        } else if (loadOptions._gpuAutoFallback) {
          gpuLayers = undefined;
        } else if (typeof configLayers === 'number' && configLayers >= 0) {
          gpuLayers = configLayers;
        } else {
          gpuLayers = this._resolveGpuLayerStrategy(modelPath, 'embedding');
        }

        const modelOptions = { modelPath };
        if (typeof gpuLayers === 'number') {
          modelOptions.gpuLayers = gpuLayers;
        }
        model = await this._llama.loadModel(modelOptions);

        try {
          context = await model.createEmbeddingContext();
        } catch (contextError) {
          if (shouldFallbackToCPU(contextError)) {
            // Tier 2: explicit GPU layers -> auto GPU
            if (
              !loadOptions._gpuAutoFallback &&
              !loadOptions._cpuFallbackTried &&
              typeof gpuLayers === 'number' &&
              gpuLayers > 0
            ) {
              logger.warn(
                '[LlamaService] Fallback embedding context failed, retrying with auto GPU layers',
                { model: resolvedName }
              );
              return inferWithOptions({ ...loadOptions, _gpuAutoFallback: true });
            }
            // Tier 3: auto/explicit GPU -> CPU
            if (!loadOptions._cpuFallbackTried && gpuLayers !== 0) {
              logger.warn(
                '[LlamaService] Fallback embedding context failed on GPU, retrying on CPU',
                {
                  model: resolvedName
                }
              );
              return inferWithOptions({ ...loadOptions, _cpuFallbackTried: true, forceCPU: true });
            }
          }
          throw contextError;
        }

        const embedding = await context.getEmbeddingFor(normalizedText);
        const vector = Array.from(embedding.vector);
        this._metrics.recordEmbedding(Date.now() - startTime, true);
        return { embedding: vector, model: resolvedName };
      } catch (error) {
        this._metrics.recordEmbedding(Date.now() - startTime, false);
        if (shouldFallbackToCPU(error) && !loadOptions._cpuFallbackTried) {
          logger.warn('[LlamaService] Fallback embedding load failed on GPU, retrying on CPU', {
            model: resolvedName
          });
          return inferWithOptions({ ...loadOptions, _cpuFallbackTried: true, forceCPU: true });
        }
        if (isOutOfMemoryError(error)) {
          throw attachErrorCode(error, ERROR_CODES.LLAMA_OOM);
        }
        if (error?.code === ERROR_CODES.LLAMA_MODEL_NOT_FOUND) {
          throw error;
        }
        throw attachErrorCode(error, ERROR_CODES.LLAMA_MODEL_LOAD_FAILED);
      } finally {
        if (context?.dispose) {
          try {
            await context.dispose();
          } catch {
            /* ignore */
          }
        }
        if (model?.dispose) {
          try {
            await model.dispose();
          } catch {
            /* ignore */
          }
        }
      }
    };

    return withLlamaResilience(
      async (retryOptions = {}) => {
        const forceCPU = retryOptions?.forceCPU === true;
        return inferWithOptions(forceCPU ? { _cpuFallbackTried: true, forceCPU: true } : {});
      },
      { modelType: 'embedding' }
    );
  }

  /**
   * Try fallback embedding models when the primary model is missing or corrupt.
   *
   * Only activates for LLAMA_MODEL_NOT_FOUND and LLAMA_MODEL_LOAD_FAILED errors.
   * OOM and inference errors propagate immediately (fallback models would likely
   * hit the same issue).
   *
   * Checks both error.code and error.originalError.code because the resilience
   * wrapper may wrap the original error.
   *
   * @private
   */
  async _tryEmbeddingFallback(text, primaryError) {
    const errorCode = primaryError?.code || primaryError?.originalError?.code;

    if (
      errorCode !== ERROR_CODES.LLAMA_MODEL_NOT_FOUND &&
      errorCode !== ERROR_CODES.LLAMA_MODEL_LOAD_FAILED
    ) {
      throw primaryError;
    }

    const primaryModel = this._selectedModels.embedding;
    const expectedDim = resolveEmbeddingDimension(primaryModel, {
      defaultDimension: AI_DEFAULTS.EMBEDDING?.DIMENSIONS
    });
    const fallbackModels = (AI_DEFAULTS.EMBEDDING.FALLBACK_MODELS || []).filter(
      (m) => m !== primaryModel
    );

    if (fallbackModels.length === 0) {
      throw primaryError;
    }

    logger.warn('[LlamaService] Primary embedding model unavailable, trying fallback chain', {
      primaryModel,
      error: primaryError.message,
      code: errorCode,
      fallbacks: fallbackModels
    });

    for (const fallbackModel of fallbackModels) {
      const fallbackDim = resolveEmbeddingDimension(fallbackModel, {
        defaultDimension: expectedDim
      });
      if (fallbackDim !== expectedDim) {
        logger.warn('[LlamaService] Skipping embedding fallback due to dimension mismatch', {
          primaryModel,
          fallbackModel,
          expectedDim,
          fallbackDim
        });
        continue;
      }
      try {
        const result = await this._executeEmbeddingInferenceWithModel(text, fallbackModel);

        logger.warn('[LlamaService] Embedding fallback succeeded', {
          originalModel: primaryModel,
          fallbackModel
        });

        return result;
      } catch (fallbackError) {
        if (fallbackError?.code === ERROR_CODES.LLAMA_OOM) {
          throw fallbackError;
        }
        logger.warn(`[LlamaService] Fallback model also failed: ${fallbackModel}`, {
          error: fallbackError.message
        });
      }
    }

    // All fallbacks exhausted — throw the original error
    throw primaryError;
  }

  /**
   * Batch generate embeddings
   */
  async batchGenerateEmbeddings(texts, options = {}) {
    if (!Array.isArray(texts)) {
      const error = new TypeError(
        '[LlamaService] batchGenerateEmbeddings expects an array of texts'
      );
      throw attachErrorCode(error, ERROR_CODES.INVALID_INPUT);
    }
    const { onProgress } = options;

    // FIX Bug #10: Run embeddings in parallel but with bounded concurrency
    // to prevent flooding the ModelAccessCoordinator or creating too many Promises.
    const BATCH_CONCURRENCY = 4;
    let completed = 0;
    const total = texts.length;
    const results = [];

    for (let i = 0; i < total; i += BATCH_CONCURRENCY) {
      const chunk = texts.slice(i, i + BATCH_CONCURRENCY);
      const chunkPromises = chunk.map(async (text, idx) => {
        const globalIndex = i + idx;
        try {
          const result = await this.generateEmbedding(text);

          completed++;
          if (onProgress) {
            onProgress({
              current: completed,
              total: total,
              progress: completed / total
            });
          }

          return result.embedding;
        } catch (error) {
          logger.warn('[LlamaService] Batch embedding failed item', {
            index: globalIndex,
            error: error.message
          });
          completed++; // Still count as completed (failed)
          if (onProgress) {
            onProgress({
              current: completed,
              total: total,
              progress: completed / total
            });
          }
          return null;
        }
      });

      const chunkResults = await Promise.all(chunkPromises);
      results.push(...chunkResults);
    }

    return { embeddings: results };
  }

  /**
   * Generate text response
   */
  async generateText(options) {
    const { prompt, systemPrompt, maxTokens = 2048, temperature = 0.7, signal } = options;
    const requestedMaxTokens = Number.isFinite(Number(maxTokens))
      ? Math.max(1, Math.floor(Number(maxTokens)))
      : 2048;
    const effectiveContextSize = this._getEffectiveContextSize('text');
    const RESPONSE_TOKEN_RESERVE = 1024;
    const contextBoundMaxTokens = Math.max(
      128,
      Math.floor(Math.max(256, effectiveContextSize - RESPONSE_TOKEN_RESERVE) * 0.5)
    );
    const safeMaxTokens = Math.min(requestedMaxTokens, contextBoundMaxTokens);
    if (safeMaxTokens !== requestedMaxTokens) {
      logger.warn('[LlamaService] Clamped maxTokens to fit context budget', {
        requestedMaxTokens,
        clampedMaxTokens: safeMaxTokens,
        effectiveContextSize
      });
    }
    const operationId = this._generateOperationId('text');
    await this._awaitModelReady('text');

    return this._coordinator.withModel(
      'text',
      async () => {
        this._modelMemoryManager?.acquireRef('text');
        try {
          return await withLlamaResilience(
            async (retryOptions) => {
              // Handle CPU fallback from LlamaResilience when GPU errors occur
              if (retryOptions?.forceCPU && this._gpuBackend !== 'cpu') {
                await this._reloadModelCPU('text', { operationId });
              }

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

                // node-llama-cpp reclaims disposed sequence IDs asynchronously
                // (via withLock). After a previous session.dispose(), the slot
                // may not be immediately available. Yield briefly to let any
                // pending reclaim complete before allocating a new sequence.
                if (typeof context.sequencesLeft === 'number' && context.sequencesLeft === 0) {
                  for (let _wait = 0; _wait < 50; _wait++) {
                    await delay(10);
                    if (context.sequencesLeft > 0) break;
                  }
                }

                const { LlamaChatSession } = await loadNodeLlamaModule();
                session = new LlamaChatSession({
                  contextSequence: context.getSequence(),
                  systemPrompt: systemPrompt || 'You are a helpful assistant.',
                  autoDisposeSequence: true
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

                const promptOptions = { maxTokens: safeMaxTokens, temperature };
                if (signal) promptOptions.signal = signal;
                return await session.prompt(prompt, promptOptions);
              };

              try {
                let response;
                try {
                  response = await runOnce();
                } catch (error) {
                  if (isSequenceExhaustedError(error)) {
                    // FIX: Dispose the first session before recovery to prevent leak.
                    // _recoverFromSequenceExhaustion unloads the model (which cascades
                    // to contexts), but the LlamaChatSession wrapper holds internal
                    // state that must be explicitly released.
                    if (session) {
                      try {
                        session.dispose();
                      } catch {
                        /* model is being unloaded; dispose may throw */
                      }
                      session = null;
                    }
                    await this._recoverFromSequenceExhaustion('text', error);
                    response = await runOnce();
                  } else {
                    throw error;
                  }
                }

                const durationMs = Date.now() - startTime;
                const responseChars = response?.length || 0;
                const approxTokens = Math.round(responseChars / 4);
                this._metrics.recordTextGeneration(durationMs, approxTokens, true);

                logger.info('[LlamaService] Text inference complete', {
                  model: this._selectedModels?.text,
                  promptChars: prompt?.length || 0,
                  responseChars,
                  approxTokens,
                  durationMs,
                  maxTokens: safeMaxTokens,
                  requestedMaxTokens,
                  temperature,
                  gpu: this._gpuBackend !== 'cpu'
                });

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
      return {
        success: false,
        response: null,
        error: error.message || 'Text analysis failed',
        code: error.code || null
      };
    }
  }

  /**
   * Enter vision batch mode — unloads text/embedding models once, keeps vision
   * server alive across multiple analyzeImage() calls. Call exitVisionBatchMode()
   * when the batch is done.
   */
  async enterVisionBatchMode() {
    return this._withVisionBatchModeLock(async () => {
      this._visionBatchModeRefs += 1;
      if (this._visionBatchModeRefs > 1) {
        this._visionBatchMode = true;
        logger.debug('[LlamaService] Joined existing vision batch mode', {
          refs: this._visionBatchModeRefs
        });
        return;
      }

      this._visionBatchMode = true;
      try {
        if (this._modelMemoryManager) {
          await this._modelMemoryManager.unloadModel('text');
          await this._modelMemoryManager.unloadModel('embedding');
          // Brief delay for CUDA driver to release VRAM back to the OS
          await new Promise((r) => setTimeout(r, 500));
        }
      } catch (error) {
        this._visionBatchModeRefs = Math.max(0, this._visionBatchModeRefs - 1);
        this._visionBatchMode = this._visionBatchModeRefs > 0;
        throw error;
      }

      logger.info('[LlamaService] Entered vision batch mode', {
        refs: this._visionBatchModeRefs
      });
    });
  }

  /**
   * Exit vision batch mode — shuts down vision server, waits for VRAM release,
   * then pre-loads text model for subsequent inference.
   */
  async exitVisionBatchMode() {
    return this._withVisionBatchModeLock(async () => {
      if (this._visionBatchModeRefs <= 0) {
        this._visionBatchMode = false;
        logger.warn('[LlamaService] exitVisionBatchMode called without active batch mode');
        return;
      }

      this._visionBatchModeRefs -= 1;
      if (this._visionBatchModeRefs > 0) {
        this._visionBatchMode = true;
        logger.debug('[LlamaService] Deferred vision batch mode exit; active owners remain', {
          refs: this._visionBatchModeRefs
        });
        return;
      }

      this._visionBatchMode = false;
      try {
        const visionService = getVisionService();
        await visionService.shutdown();
      } catch {
        /* ignore — server may already be gone */
      }
      // Wait for CUDA VRAM release before reloading text model
      await new Promise((r) => setTimeout(r, 500));
      this._ensureModelLoaded('text')
        .catch((err) => {
          logger.warn('[LlamaService] Text model preload after vision batch failed:', err?.message);
          return null;
        })
        .then((result) => {
          if (!result) return;
          // Reset embedding circuit breaker only after text/embedding path is healthy again.
          const { resetLlamaCircuit: resetCircuit } = require('./LlamaResilience');
          resetCircuit('embedding');
        });
      logger.info('[LlamaService] Exited vision batch mode');
    });
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
    maxTokens = 512,
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

    const operationId = this._generateOperationId('vision');
    await this._awaitModelReady('vision');
    return this._coordinator.withModel(
      'vision',
      async () => {
        this._modelMemoryManager?.acquireRef('vision');
        try {
          return await withLlamaResilience(
            async (retryOptions) => {
              // Handle CPU fallback from LlamaResilience when GPU errors occur
              if (retryOptions?.forceCPU && this._gpuBackend !== 'cpu') {
                await this._reloadModelCPU('vision', { operationId });
              }

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

                // Free VRAM for vision server (it runs out-of-process, no shared memory)
                // In batch mode, enterVisionBatchMode() already handled this
                if (!this._visionBatchMode && this._modelMemoryManager) {
                  await this._modelMemoryManager.unloadModel('text');
                  await this._modelMemoryManager.unloadModel('embedding');
                  // Brief delay for CUDA driver to release VRAM back to the OS
                  await new Promise((r) => setTimeout(r, 500));
                }

                const visionService = getVisionService();
                logger.info('[LlamaService] Using local vision runtime for image analysis');
                const baseRuntimeProfile = this._buildVisionRuntimeProfile({ maxTokens });
                const buildVisionRequest = (runtimeProfile) => ({
                  imageBase64,
                  imagePath,
                  prompt,
                  systemPrompt:
                    'You are a vision assistant that analyzes images based on provided descriptions and OCR text.',
                  maxTokens: runtimeProfile.maxTokens,
                  temperature,
                  signal,
                  config: {
                    modelPath: path.join(this._modelsPath, modelName),
                    mmprojPath: this._visionProjectorStatus.projectorPath,
                    mmprojRequired: this._visionProjectorStatus.required,
                    contextSize: runtimeProfile.contextSize,
                    threads: this._config.threads,
                    gpuLayers: this._config.gpuLayers,
                    batchSize: runtimeProfile.batchSize,
                    ubatchSize: runtimeProfile.ubatchSize
                  }
                });

                let result;
                try {
                  result = await visionService.analyzeImage(buildVisionRequest(baseRuntimeProfile));
                } catch (visionError) {
                  const shouldRetryDegraded =
                    this._shouldUseConservativeVisionProfile() &&
                    !this._visionBatchMode &&
                    this._isVisionDecodePressureError(visionError);
                  if (!shouldRetryDegraded) {
                    throw visionError;
                  }
                  const degradedProfile = this._buildVisionRuntimeProfile({
                    maxTokens,
                    retryDegraded: true
                  });
                  logger.warn(
                    '[LlamaService] Vision request failed under memory pressure; retrying with reduced runtime profile',
                    {
                      contextSize: degradedProfile.contextSize,
                      batchSize: degradedProfile.batchSize,
                      ubatchSize: degradedProfile.ubatchSize,
                      maxTokens: degradedProfile.maxTokens,
                      error: visionError?.message
                    }
                  );
                  result = await visionService.analyzeImage(buildVisionRequest(degradedProfile));
                }

                const visionDuration = Date.now() - startTime;
                const visionChars = result?.response?.length || 0;
                this._metrics.recordTextGeneration(
                  visionDuration,
                  visionChars ? visionChars / 4 : 0,
                  true
                );

                logger.info('[LlamaService] Vision inference complete', {
                  model: modelName,
                  promptChars: prompt?.length || 0,
                  responseChars: visionChars,
                  durationMs: visionDuration,
                  gpu: this._gpuBackend !== 'cpu'
                });

                // In batch mode, exitVisionBatchMode() handles shutdown + reload
                if (!this._visionBatchMode) {
                  const keepAliveEnabled =
                    typeof visionService.isIdleKeepAliveEnabled === 'function' &&
                    visionService.isIdleKeepAliveEnabled();

                  if (keepAliveEnabled) {
                    visionService.scheduleIdleShutdown?.('single-image-complete');
                  } else {
                    // Shut down vision server to release VRAM before reloading text model
                    try {
                      await visionService.shutdown();
                    } catch {
                      /* ignore — server may already be gone */
                    }
                    // Wait for CUDA VRAM release before reloading text model
                    await new Promise((r) => setTimeout(r, 500));
                  }

                  // Vision done — pre-load text model for next inference
                  this._ensureModelLoaded('text')
                    .then(() => {
                      // Reset breakers once text path is healthy after vision handoff.
                      const {
                        resetLlamaCircuit: resetCircuitSingle
                      } = require('./LlamaResilience');
                      resetCircuitSingle('text');
                      resetCircuitSingle('embedding');
                    })
                    .catch((err) => {
                      logger.warn(
                        '[LlamaService] Text model preload after single-image vision failed:',
                        err?.message
                      );
                    });
                }

                return { response: result.response };
              } catch (error) {
                this._metrics.recordTextGeneration(Date.now() - startTime, 0, false);
                if (isOutOfMemoryError(error)) {
                  throw attachErrorCode(error, ERROR_CODES.LLAMA_OOM);
                }
                // Preserve existing error codes (e.g., LLAMA_MODEL_NOT_FOUND from _ensureModelLoaded)
                // instead of unconditionally overwriting with INFERENCE_FAILED
                if (!error.code) {
                  throw attachErrorCode(error, ERROR_CODES.LLAMA_INFERENCE_FAILED);
                }
                throw error;
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
    } catch (error) {
      if (error.code !== 'ENOENT') {
        logger.warn('[LlamaService] Failed to list models', {
          error: error.message,
          code: error.code
        });
      }
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
      gpuDetected: this._detectedGpu,
      gpuSelection: this._gpuSelection,
      metrics: this._metrics.getMetrics(),
      memory: this._modelMemoryManager?.getMemoryStatus()
    };
  }

  async shutdown() {
    // Re-entrance guard: prevent double shutdown from StartupManager + ServiceContainer
    if (this._isShuttingDown) {
      logger.debug('[LlamaService] Shutdown already in progress, skipping');
      return;
    }
    this._isShuttingDown = true;
    logger.info('[LlamaService] Shutting down...');

    const gateWasNotSet = !this._configChangeGate;
    let configGateTimedOut = false;
    if (this._configChangeGate) {
      try {
        await Promise.race([
          this._configChangeGate.promise,
          delay(5000).then(() => {
            configGateTimedOut = true;
          })
        ]);
        if (configGateTimedOut) {
          logger.warn('[LlamaService] Config-change gate wait timed out during shutdown');
        }
      } catch (error) {
        logger.warn(
          '[LlamaService] Config-change gate wait failed during shutdown:',
          error?.message
        );
      }
    }
    if (gateWasNotSet) {
      this._beginConfigChangeGate();
    }

    // Clear PerformanceMetrics interval to prevent leaks
    if (this._metrics?.destroy) {
      try {
        this._metrics.destroy();
      } catch {
        /* ignore */
      }
    }

    if (this._modelReloadGates?.size) {
      for (const [modelType, gate] of this._modelReloadGates.entries()) {
        try {
          await Promise.race([gate.promise, delay(5000)]);
        } catch (error) {
          logger.warn('[LlamaService] Model reload gate wait failed during shutdown', {
            modelType,
            error: error?.message
          });
        }
      }
    }

    let safeToUnload = true;
    try {
      if (this._coordinator) {
        safeToUnload = await this._waitForIdleOperations('shutdown', 30000);
      }
    } catch (error) {
      safeToUnload = false;
      logger.warn(
        '[LlamaService] Error waiting for idle operations during shutdown:',
        error?.message
      );
    }

    // Unload models with error isolation
    if (this._modelMemoryManager) {
      try {
        if (safeToUnload) {
          await this._modelMemoryManager.unloadAll();
        } else {
          logger.warn(
            '[LlamaService] Skipping model unload due to active operations during shutdown'
          );
        }
      } catch (error) {
        logger.warn('[LlamaService] Error unloading models during shutdown:', error?.message);
      }
    }

    // Dispose llama instance with error isolation
    if (this._llama) {
      try {
        if (safeToUnload) {
          await this._llama.dispose?.();
        } else {
          logger.warn('[LlamaService] Skipping llama dispose due to active operations');
        }
      } catch (error) {
        logger.warn('[LlamaService] Error disposing llama during shutdown:', error?.message);
      }
    }

    // Clean up circuit breaker timers
    cleanupLlamaCircuits();

    // Clean up all references to prevent stale state
    this._initialized = false;
    this._initPromise = null;
    this._configLoaded = false; // FIX: Reset so re-initialization loads fresh config
    this._modelsPath = null; // Reset so re-initialization discovers fresh path
    this._llama = null;
    this._models = { text: null, vision: null, embedding: null };
    this._contexts = { text: null, vision: null, embedding: null };
    this._modelChangeCallbacks.clear();
    if (this._modelReloadGates?.size) {
      // Force-resolve any leftover reload gates so future operations cannot
      // block on stale promises after re-initialization.
      for (const gate of this._modelReloadGates.values()) {
        try {
          gate?.resolve?.();
        } catch {
          /* ignore */
        }
      }
      this._modelReloadGates.clear();
    }
    // Note: _coordinator is intentionally NOT nulled — it has no resources to leak,
    // and fire-and-forget operations may still reference it after shutdown.
    this._degradationManager = null;
    this._isShuttingDown = false; // Reset so re-initialization can call shutdown again

    if (this._configChangeGate && (gateWasNotSet || configGateTimedOut)) {
      this._endConfigChangeGate();
    }
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
