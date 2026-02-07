// src/main/services/ModelMemoryManager.js

const os = require('os');
const { createLogger } = require('../../shared/logger');

const logger = createLogger('ModelMemoryManager');

class ModelMemoryManager {
  /**
   * @param {Object} llamaService - LlamaService instance that provides model loading/unloading.
   *   The manager accesses _loadModel(type), _models, and _contexts through bound callbacks
   *   to keep the coupling explicit and auditable.
   * @param {Object} [options={}] - Configuration options
   * @param {Object} [options.gpuInfo] - GPU info from GPUMonitor.detectGPU() for VRAM-aware budgeting
   */
  constructor(llamaService, options = {}) {
    // Bind specific callbacks rather than holding the entire service reference.
    // This makes the contract between ModelMemoryManager and LlamaService explicit.
    this._loadModelFn = (type) => llamaService._loadModel(type);
    this._disposeModelFn = async (type) => {
      if (llamaService._models?.[type]) {
        await llamaService._models[type].dispose();
        llamaService._models[type] = null;
        llamaService._contexts[type] = null;
      }
    };
    this._loadedModels = new Map(); // type -> { model, context, lastUsed, sizeBytes }
    this._activeRefs = new Map(); // type -> number of in-flight operations using this model
    this._gpuInfo = options.gpuInfo || null;
    this._maxMemoryUsage = this._calculateMaxMemory();
    this._currentMemoryUsage = 0;

    // Model size estimates (in bytes)
    this._modelSizeEstimates = {
      embedding: 500 * 1024 * 1024, // ~500MB
      text: 4 * 1024 * 1024 * 1024, // ~4GB
      vision: 5 * 1024 * 1024 * 1024 // ~5GB
    };
  }

  /**
   * Update GPU info after construction (e.g., after async GPU detection completes).
   * Recalculates memory budget with new VRAM data.
   * @param {Object} gpuInfo - GPU info from GPUMonitor
   */
  setGpuInfo(gpuInfo) {
    this._gpuInfo = gpuInfo;
    this._maxMemoryUsage = this._calculateMaxMemory();
    logger.info('[Memory] GPU info updated, recalculated budget', {
      vramMB: gpuInfo?.vramMB || 0,
      maxUsableGB: Math.round(this._maxMemoryUsage / 1024 / 1024 / 1024)
    });
  }

  /**
   * Calculate maximum memory we can use.
   * When GPU VRAM info is available, uses the smaller of:
   *   - 80% of VRAM (GPU-loaded models live in VRAM)
   *   - 70% of free system RAM, capped at 16GB
   * This prevents over-allocating VRAM on dedicated GPUs and
   * over-allocating system RAM on unified memory (Apple Silicon).
   */
  _calculateMaxMemory() {
    const totalMemory = os.totalmem();
    const freeMemory = os.freemem();

    // System RAM budget: 70% of free, capped at 16GB
    const ramBudget = Math.min(freeMemory * 0.7, 16 * 1024 * 1024 * 1024);

    let maxUsable = ramBudget;

    // When GPU info is available, constrain to VRAM as well.
    // Models loaded with GPU offload consume VRAM, so VRAM is the real bottleneck.
    if (this._gpuInfo?.vramMB && this._gpuInfo.vramMB > 0) {
      const vramBytes = this._gpuInfo.vramMB * 1024 * 1024;
      const vramBudget = Math.floor(vramBytes * 0.8); // 80% of VRAM
      maxUsable = Math.min(ramBudget, vramBudget);

      logger.info('[Memory] VRAM-aware budget calculated', {
        vramMB: this._gpuInfo.vramMB,
        vramBudgetGB: Math.round(vramBudget / 1024 / 1024 / 1024),
        ramBudgetGB: Math.round(ramBudget / 1024 / 1024 / 1024),
        effectiveBudgetGB: Math.round(maxUsable / 1024 / 1024 / 1024)
      });
    } else {
      logger.info('[Memory] Calculated max memory usage (no GPU VRAM info)', {
        totalGB: Math.round(totalMemory / 1024 / 1024 / 1024),
        freeGB: Math.round(freeMemory / 1024 / 1024 / 1024),
        maxUsableGB: Math.round(maxUsable / 1024 / 1024 / 1024)
      });
    }

    return maxUsable;
  }

  /**
   * Refresh the memory budget based on current free memory.
   * Called before load decisions to avoid using a stale snapshot from constructor time.
   */
  _refreshMemoryBudget() {
    this._maxMemoryUsage = this._calculateMaxMemory();
  }

  /**
   * Mark a model as actively in-use (prevents eviction while held).
   * Callers MUST call releaseRef when done.
   * @param {string} modelType
   */
  acquireRef(modelType) {
    this._activeRefs.set(modelType, (this._activeRefs.get(modelType) || 0) + 1);
  }

  /**
   * Release an active reference on a model type.
   * @param {string} modelType
   */
  releaseRef(modelType) {
    const current = this._activeRefs.get(modelType) || 0;
    if (current <= 1) {
      this._activeRefs.delete(modelType);
    } else {
      this._activeRefs.set(modelType, current - 1);
    }
  }

  /**
   * Check if we can load a model of given type
   */
  canLoadModel(modelType) {
    const estimatedSize = this._modelSizeEstimates[modelType] || 0;
    const projectedUsage = this._currentMemoryUsage + estimatedSize;
    return projectedUsage < this._maxMemoryUsage;
  }

  /**
   * Ensure model is loaded, unloading others if necessary
   */
  async ensureModelLoaded(modelType) {
    // Already loaded?
    if (this._loadedModels.has(modelType)) {
      const entry = this._loadedModels.get(modelType);
      entry.lastUsed = Date.now();
      return entry.context;
    }

    // Refresh budget from current system state before making load decisions
    this._refreshMemoryBudget();

    // Check if we need to free memory -- evict LRU models until budget allows.
    // Break if _unloadLeastRecentlyUsed could not evict (all models in active use).
    const estimatedSize = this._modelSizeEstimates[modelType] || 0;
    while (!this.canLoadModel(modelType) && this._loadedModels.size > 0) {
      const sizeBefore = this._loadedModels.size;
      await this._unloadLeastRecentlyUsed();
      if (this._loadedModels.size === sizeBefore) {
        // Nothing was evicted (all models have active refs) -- stop to avoid infinite loop
        logger.warn('[Memory] Cannot free enough memory -- all models in active use', {
          requestedType: modelType,
          loadedModels: Array.from(this._loadedModels.keys())
        });
        break;
      }
    }

    // Load the model via the bound callback
    const context = await this._loadModelFn(modelType);

    this._loadedModels.set(modelType, {
      context,
      lastUsed: Date.now(),
      sizeBytes: estimatedSize
    });
    this._currentMemoryUsage += estimatedSize;

    logger.info('[Memory] Model loaded', {
      type: modelType,
      currentUsageMB: Math.round(this._currentMemoryUsage / 1024 / 1024)
    });

    return context;
  }

  /**
   * Unload least recently used model, skipping models with active references.
   */
  async _unloadLeastRecentlyUsed() {
    let oldest = null;
    let oldestTime = Infinity;

    for (const [type, entry] of this._loadedModels) {
      // Never evict a model that is currently in-use for inference
      if ((this._activeRefs.get(type) || 0) > 0) continue;

      if (entry.lastUsed < oldestTime) {
        oldest = type;
        oldestTime = entry.lastUsed;
      }
    }

    if (oldest) {
      await this._unloadModel(oldest);
    } else {
      logger.warn('[Memory] Cannot evict any model -- all loaded models are in active use');
    }
  }

  /**
   * Unload a specific model
   */
  async _unloadModel(modelType) {
    const entry = this._loadedModels.get(modelType);
    if (!entry) return;

    // Remove from map FIRST to prevent double-dispose if called concurrently
    this._loadedModels.delete(modelType);
    this._currentMemoryUsage = Math.max(0, this._currentMemoryUsage - entry.sizeBytes);

    logger.info('[Memory] Unloading model', { type: modelType });

    try {
      if (entry.context?.dispose) {
        await entry.context.dispose();
      }
      await this._disposeModelFn(modelType);
    } catch (error) {
      logger.error('[Memory] Error unloading model', error);
    }
  }

  /**
   * Get current memory status
   */
  getMemoryStatus() {
    return {
      maxMemoryMB: Math.round(this._maxMemoryUsage / 1024 / 1024),
      currentUsageMB: Math.round(this._currentMemoryUsage / 1024 / 1024),
      loadedModels: Array.from(this._loadedModels.keys()),
      systemFreeMemoryMB: Math.round(os.freemem() / 1024 / 1024)
    };
  }

  /**
   * Unload all models
   */
  async unloadAll() {
    // Snapshot keys to avoid mutating Map during iteration
    const types = [...this._loadedModels.keys()];
    for (const type of types) {
      await this._unloadModel(type);
    }
  }

  /**
   * Unload a specific model (public helper)
   */
  async unloadModel(modelType) {
    await this._unloadModel(modelType);
  }
}

module.exports = { ModelMemoryManager };
