// src/main/services/ModelAccessCoordinator.js

const { createLogger } = require('../../shared/logger');
const PQueue = require('p-queue').default;

const logger = createLogger('ModelAccessCoordinator');

const MAX_INFERENCE_QUEUE = 100;
const LOAD_LOCK_TIMEOUT_MS = 120000; // 2 minutes: model loads can be slow on HDD/CPU
const INFERENCE_SLOT_TIMEOUT_MS = 300000; // 5 minutes: vision inference on CPU can be very slow
const DEFAULT_INFERENCE_CONCURRENCY = (() => {
  const raw = Number(process.env.STRATOSORT_INFERENCE_CONCURRENCY);
  if (Number.isFinite(raw) && raw > 0) {
    return Math.max(1, Math.min(4, Math.floor(raw)));
  }
  return 1;
})();

const MODEL_TYPES = ['text', 'vision', 'embedding'];

class ModelAccessCoordinator {
  /**
   * @param {Object} [options={}] - Configuration options
   * @param {number} [options.inferenceSlots] - Override inference concurrency (from PerformanceService)
   */
  constructor(options = {}) {
    // Per-model-type queues for loading (mutex semantics)
    this._loadQueues = {
      text: new PQueue({ concurrency: 1 }),
      vision: new PQueue({ concurrency: 1 }),
      embedding: new PQueue({ concurrency: 1 })
    };

    // Per-model-type inference queues.
    // This prevents vision operations (which may take minutes to load on CPU) from
    // starving embedding or text operations that share no GPU memory contention.
    const concurrency = options.inferenceSlots || DEFAULT_INFERENCE_CONCURRENCY;
    this._inferenceQueues = {};
    for (const type of MODEL_TYPES) {
      this._inferenceQueues[type] = new PQueue({ concurrency });
    }

    logger.info('[Coordinator] Per-model inference concurrency', {
      concurrency,
      modelTypes: MODEL_TYPES,
      source: options.inferenceSlots ? 'PerformanceService' : 'default'
    });

    // Track active operations for debugging
    this._activeOperations = new Map();
  }

  /**
   * Update inference concurrency limit dynamically
   * @param {number} concurrency - New concurrency limit
   */
  updateInferenceConcurrency(concurrency) {
    if (!Number.isFinite(concurrency) || concurrency < 1) return;

    logger.info('[Coordinator] Updating inference concurrency', { concurrency });

    for (const type of MODEL_TYPES) {
      if (this._inferenceQueues[type]) {
        this._inferenceQueues[type].concurrency = concurrency;
      }
    }
  }

  /**
   * Acquire exclusive access for model loading.
   *
   * Includes a timeout to prevent indefinite hangs when the lock holder is
   * stuck (e.g. frozen GPU driver, blocked disk I/O).
   *
   * @param {string} modelType - 'text' | 'vision' | 'embedding'
   * @param {Object} [options]
   * @param {number} [options.timeoutMs] - Override the default timeout
   * @returns {Promise<Function>} Release callback
   */
  async acquireLoadLock(modelType, options = {}) {
    const queue = this._loadQueues[modelType];
    if (!queue) {
      throw new Error(`Unknown model type: ${modelType}`);
    }

    const timeoutMs = options.timeoutMs || LOAD_LOCK_TIMEOUT_MS;
    let releaseHeld;
    let timer = null;
    let startedRunning = false;
    let cancelledBeforeStart = false;
    let released = false;
    let startedSettled = false;
    let startResolve;
    let startReject;
    const started = new Promise((resolve, reject) => {
      startResolve = resolve;
      startReject = reject;
    });
    const held = new Promise((resolve) => {
      releaseHeld = resolve;
    });

    const releaseLock = (reason = 'caller') => {
      if (released) return false;
      released = true;
      try {
        releaseHeld();
      } catch {
        // No-op: releasing a held promise should not throw, but never break callers
      }
      logger.debug(`[Coordinator] Released load lock for ${modelType}`, { reason });
      return true;
    };

    queue.add(async () => {
      startedRunning = true;
      if (!startedSettled) {
        startedSettled = true;
        startResolve();
      }
      if (cancelledBeforeStart) {
        releaseLock('queue-wait-timeout');
        return;
      }
      await held;
    });

    timer = setTimeout(() => {
      // Phase 1: waiting in queue; reject caller and let queued task auto-release on dequeue.
      if (!startedRunning) {
        cancelledBeforeStart = true;
        if (!startedSettled) {
          startedSettled = true;
          const error = new Error(`Load lock timeout for ${modelType} after ${timeoutMs}ms`);
          error.code = 'LOAD_LOCK_TIMEOUT';
          startReject(error);
        }
        return;
      }
      // Phase 2: lock acquired but still running.
      // Schedule a force-release safety net at 2x the timeout to prevent permanent deadlock
      // if the holder crashes or hangs without releasing.
      logger.warn('[Coordinator] Load lock held past timeout; scheduling force-release', {
        modelType,
        timeoutMs,
        forceReleaseMs: timeoutMs
      });
      setTimeout(() => {
        if (!released) {
          logger.error('[Coordinator] Force-releasing stuck load lock', { modelType });
          releaseLock('force-release-deadlock');
        }
      }, timeoutMs);
    }, timeoutMs);

    try {
      await started;
    } catch (error) {
      clearTimeout(timer);
      throw error;
    }

    logger.debug(`[Coordinator] Acquired load lock for ${modelType}`);

    return () => {
      releaseLock('caller');
      clearTimeout(timer);
    };
  }

  /**
   * Get the inference queue for a model type (falls back to embedding queue for unknown types)
   * @private
   */
  _getInferenceQueue(modelType) {
    return this._inferenceQueues[modelType] || this._inferenceQueues.embedding;
  }

  /**
   * Acquire slot for inference operation.
   *
   * Includes a timeout to prevent indefinite hangs when the slot holder is
   * stuck (e.g. frozen GPU driver, hung inference).
   *
   * @param {string} operationId - Unique operation identifier
   * @param {string} [modelType] - Model type for per-type queue routing
   * @param {Object} [options]
   * @param {number} [options.timeoutMs] - Override the default timeout
   */
  async acquireInferenceSlot(operationId, modelType, options = {}) {
    const queue = this._getInferenceQueue(modelType);
    const startTime = Date.now();

    // queue.size only counts waiting items, queue.pending counts active items
    if (queue.size + queue.pending >= MAX_INFERENCE_QUEUE) {
      const error = new Error('Inference queue full');
      error.code = 'QUEUE_FULL';
      throw error;
    }

    const timeoutMs = options.timeoutMs || INFERENCE_SLOT_TIMEOUT_MS;
    let releaseHeld;
    let timer = null;
    let startedRunning = false;
    let cancelledBeforeStart = false;
    let released = false;
    let startedSettled = false;
    let startResolve;
    let startReject;
    const started = new Promise((resolve, reject) => {
      startResolve = resolve;
      startReject = reject;
    });
    const held = new Promise((resolve) => {
      releaseHeld = resolve;
    });

    const releaseSlot = (reason = 'caller') => {
      if (released) return false;
      released = true;
      try {
        releaseHeld();
      } catch {
        // No-op: releasing a held promise should not throw, but never break callers
      }
      this._activeOperations.delete(operationId);
      logger.debug(`[Coordinator] Released inference slot`, { operationId, reason });
      return true;
    };

    queue.add(async () => {
      startedRunning = true;
      if (!startedSettled) {
        startedSettled = true;
        startResolve();
      }
      if (cancelledBeforeStart) {
        releaseSlot('queue-wait-timeout');
        return;
      }
      await held;
    });

    timer = setTimeout(() => {
      // Phase 1: waiting in queue
      if (!startedRunning) {
        cancelledBeforeStart = true;
        if (!startedSettled) {
          startedSettled = true;
          const error = new Error(
            `Inference slot timeout for ${modelType || 'unknown'} (op: ${operationId}) after ${timeoutMs}ms`
          );
          error.code = 'INFERENCE_SLOT_TIMEOUT';
          startReject(error);
        }
        return;
      }
      // Phase 2: slot acquired but not released
      // Do not force release here: the inference may still be running and
      // releasing early can allow unsafe concurrent use of model resources.
      logger.warn('[Coordinator] Inference slot held past timeout; waiting for holder to release', {
        operationId,
        modelType,
        timeoutMs,
        safetyMode: 'no-force-release'
      });
    }, timeoutMs);

    try {
      await started;
    } catch (error) {
      clearTimeout(timer);
      throw error;
    }

    this._activeOperations.set(operationId, {
      startTime,
      acquiredAt: Date.now(),
      modelType
    });

    logger.debug(`[Coordinator] Acquired inference slot`, {
      operationId,
      modelType,
      waitTimeMs: Date.now() - startTime
    });

    return () => {
      releaseSlot('caller');
      clearTimeout(timer);
    };
  }

  /**
   * Execute with model coordination
   */
  async withModel(modelType, operation, options = {}) {
    const { operationId = `op-${Date.now()}` } = options;

    // Acquire inference slot for the specific model type
    const releaseSlot = await this.acquireInferenceSlot(operationId, modelType);

    try {
      return await operation();
    } finally {
      releaseSlot();
    }
  }

  /**
   * Get coordinator status
   */
  getStatus() {
    return {
      activeOperations: this._activeOperations.size,
      queues: this.getQueueStats(),
      operations: Array.from(this._activeOperations.entries()).map(([id, data]) => ({
        id,
        modelType: data.modelType,
        runningMs: Date.now() - data.startTime
      }))
    };
  }

  /**
   * Get per-model queue pressure snapshot for adaptive callers.
   * @returns {Record<string, { queued: number, pending: number, concurrency: number }>}
   */
  getQueueStats() {
    const snapshot = {};
    for (const type of MODEL_TYPES) {
      const queue = this._inferenceQueues[type];
      if (!queue) continue;
      snapshot[type] = {
        queued: queue.size,
        pending: queue.pending,
        concurrency: queue.concurrency
      };
    }
    return snapshot;
  }
}

// Singleton
let instance = null;

function getInstance() {
  if (!instance) {
    instance = new ModelAccessCoordinator();
  }
  return instance;
}

module.exports = { ModelAccessCoordinator, getInstance };
