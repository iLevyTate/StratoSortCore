// src/main/services/ModelAccessCoordinator.js

const { createLogger } = require('../../shared/logger');
const PQueue = require('p-queue').default;

const logger = createLogger('ModelAccessCoordinator');

const MAX_INFERENCE_QUEUE = 100;
const DEFAULT_INFERENCE_CONCURRENCY = (() => {
  const raw = Number(process.env.STRATOSORT_INFERENCE_CONCURRENCY);
  if (Number.isFinite(raw) && raw > 0) {
    return Math.max(1, Math.min(4, Math.floor(raw)));
  }
  return 1;
})();

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

    // Inference concurrency: prefer explicit option, then env var, then default (1)
    const concurrency = options.inferenceSlots || DEFAULT_INFERENCE_CONCURRENCY;
    this._inferenceQueue = new PQueue({ concurrency });
    logger.info('[Coordinator] Inference concurrency', {
      concurrency,
      source: options.inferenceSlots ? 'PerformanceService' : 'default'
    });

    // Track active operations for debugging
    this._activeOperations = new Map();
  }

  /**
   * Acquire exclusive access for model loading
   */
  async acquireLoadLock(modelType) {
    const queue = this._loadQueues[modelType];
    if (!queue) {
      throw new Error(`Unknown model type: ${modelType}`);
    }

    let release;
    let startResolve;
    const started = new Promise((resolve) => {
      startResolve = resolve;
    });
    const held = new Promise((resolve) => {
      release = resolve;
    });

    queue.add(async () => {
      startResolve();
      await held;
    });

    await started;
    logger.debug(`[Coordinator] Acquired load lock for ${modelType}`);

    return () => {
      release();
      logger.debug(`[Coordinator] Released load lock for ${modelType}`);
    };
  }

  /**
   * Acquire slot for inference operation
   */
  async acquireInferenceSlot(operationId) {
    const startTime = Date.now();

    if (this._inferenceQueue.size >= MAX_INFERENCE_QUEUE) {
      const error = new Error('Inference queue full');
      error.code = 'QUEUE_FULL';
      throw error;
    }

    let release;
    let startResolve;
    const started = new Promise((resolve) => {
      startResolve = resolve;
    });
    const held = new Promise((resolve) => {
      release = resolve;
    });

    this._inferenceQueue.add(async () => {
      startResolve();
      await held;
    });

    await started;

    this._activeOperations.set(operationId, {
      startTime,
      acquiredAt: Date.now()
    });

    logger.debug(`[Coordinator] Acquired inference slot`, {
      operationId,
      waitTimeMs: Date.now() - startTime
    });

    return () => {
      release();
      this._activeOperations.delete(operationId);
      logger.debug(`[Coordinator] Released inference slot`, { operationId });
    };
  }

  /**
   * Execute with model coordination
   */
  async withModel(modelType, operation, options = {}) {
    const { operationId = `op-${Date.now()}` } = options;

    // Acquire inference slot
    const releaseSlot = await this.acquireInferenceSlot(operationId);

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
      operations: Array.from(this._activeOperations.entries()).map(([id, data]) => ({
        id,
        runningMs: Date.now() - data.startTime
      }))
    };
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
