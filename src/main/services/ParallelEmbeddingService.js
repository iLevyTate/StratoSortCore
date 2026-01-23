const os = require('os');
const { getOllama, getOllamaEmbeddingModel } = require('../ollamaUtils');
const { logger } = require('../../shared/logger');
const { isRetryableError } = require('../utils/ollamaApiRetry');
const { getInstance: getOllamaService } = require('./OllamaService');

logger.setContext('ParallelEmbeddingService');

const { TIMEOUTS } = require('../../shared/performanceConstants');

/**
 * Semaphore configuration constants
 * FIX: Made configurable to prevent hanging promises and memory bloat
 * Increased timeout to 3 minutes to withstand long-running blocking operations (like large image analysis)
 */
const SEMAPHORE_CONFIG = {
  MAX_QUEUE_SIZE: 100, // Maximum queued requests before rejecting
  QUEUE_TIMEOUT_MS: TIMEOUTS.AI_ANALYSIS_LONG // 180 second timeout to survive blocking operations
};

/**
 * ParallelEmbeddingService
 *
 * Provides controlled concurrent embedding generation to improve analysis performance.
 * Uses a semaphore pattern to limit concurrent API calls and prevent overwhelming
 * the Ollama service.
 *
 * Key features:
 * - Configurable concurrency limit (default: 5, max: 10)
 * - Semaphore-based request throttling
 * - Progress tracking for batch operations
 * - Graceful error handling with partial results
 * - Automatic retry with exponential backoff
 * - Memory-aware concurrency adjustment
 */
class ParallelEmbeddingService {
  constructor(options = {}) {
    // Configurable concurrency limit - increased hard cap for powerful GPUs
    this.concurrencyLimit = Math.min(
      options.concurrencyLimit || this._calculateOptimalConcurrency(),
      10 // Hard cap increased from 5 to 10
    );

    // Semaphore state
    this.activeRequests = 0;
    this.waitQueue = [];
    this._isShuttingDown = false;

    // Statistics tracking
    this.stats = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      totalLatencyMs: 0,
      peakConcurrency: 0
    };

    // Retry configuration
    this.maxRetries = options.maxRetries || 3;
    this.initialRetryDelayMs = options.initialRetryDelayMs || 1000;
    this.maxRetryDelayMs = options.maxRetryDelayMs || 10000;

    logger.info('[ParallelEmbeddingService] Initialized', {
      concurrencyLimit: this.concurrencyLimit,
      maxRetries: this.maxRetries
    });
  }

  /**
   * Calculate optimal concurrency based on system resources
   * @returns {number} Recommended concurrency level
   */
  _calculateOptimalConcurrency() {
    const cpuCores = os.cpus().length;
    const freeMem = os.freemem();
    const totalMem = os.totalmem();
    // FIX: Prevent division by zero in edge cases (VMs, containers)
    const memUsageRatio = totalMem > 0 ? 1 - freeMem / totalMem : 0.5;

    // Base concurrency on CPU cores (50% utilization for embedding model)
    let concurrency = Math.max(2, Math.floor(cpuCores * 0.5));

    // Reduce if memory pressure is high (>80% usage)
    if (memUsageRatio > 0.8) {
      concurrency = Math.max(2, Math.floor(concurrency * 0.6));
      logger.warn('[ParallelEmbeddingService] High memory usage, reducing concurrency', {
        memUsage: `${(memUsageRatio * 100).toFixed(1)}%`,
        reducedConcurrency: concurrency
      });
    }

    // Cap at reasonable maximum - higher for GPU setups
    return Math.min(concurrency, 10);
  }

  /**
   * Acquire a semaphore slot for making a request
   * FIX: Added timeout and queue limit to prevent hanging promises and memory bloat
   * @returns {Promise<void>} Resolves when slot is available
   * @throws {Error} If queue is full or timeout is reached
   */
  async _acquireSlot() {
    if (this._isShuttingDown) {
      const error = new Error('ParallelEmbeddingService: Service shutting down');
      error.code = 'SERVICE_SHUTDOWN';
      throw error;
    }
    // FIX: Atomic increment-then-check pattern to prevent race condition
    // Previous pattern: if (active < limit) { active++ } - two concurrent calls could both pass
    // New pattern: active++; if (active > limit) { active--; queue } - atomic acquisition
    this.activeRequests++;

    if (this.activeRequests <= this.concurrencyLimit) {
      this.stats.peakConcurrency = Math.max(this.stats.peakConcurrency, this.activeRequests);
      return Promise.resolve();
    }

    // We've exceeded the limit, decrement and queue
    this.activeRequests--;

    // FIX: Enforce maximum queue size to prevent memory bloat
    if (this.waitQueue.length >= SEMAPHORE_CONFIG.MAX_QUEUE_SIZE) {
      const error = new Error('ParallelEmbeddingService: Request queue full');
      error.code = 'QUEUE_FULL';
      logger.warn('[ParallelEmbeddingService] Queue full, rejecting request', {
        queueSize: this.waitQueue.length,
        maxQueueSize: SEMAPHORE_CONFIG.MAX_QUEUE_SIZE
      });
      throw error;
    }

    // FIX: Add timeout to prevent indefinite waiting
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        // Remove this entry from waitQueue
        const index = this.waitQueue.findIndex((entry) => entry.resolve === resolve);
        if (index !== -1) {
          this.waitQueue.splice(index, 1);
        }
        const error = new Error('ParallelEmbeddingService: Queue timeout');
        error.code = 'QUEUE_TIMEOUT';
        logger.warn('[ParallelEmbeddingService] Request timed out waiting for slot', {
          timeoutMs: SEMAPHORE_CONFIG.QUEUE_TIMEOUT_MS,
          queueLength: this.waitQueue.length
        });
        reject(error);
      }, SEMAPHORE_CONFIG.QUEUE_TIMEOUT_MS);

      // Store resolve, reject, and timeout for cleanup
      this.waitQueue.push({ resolve, reject, timeoutId });
    });
  }

  /**
   * Release a semaphore slot
   * FIX: Clears timeout when resolving queued requests
   */
  _releaseSlot() {
    this.activeRequests--;

    // Wake up next waiting request
    if (this.waitQueue.length > 0) {
      const next = this.waitQueue.shift();
      // FIX: Clear the timeout to prevent memory leak and spurious rejection
      if (next.timeoutId) {
        clearTimeout(next.timeoutId);
      }
      this.activeRequests++;
      this.stats.peakConcurrency = Math.max(this.stats.peakConcurrency, this.activeRequests);
      next.resolve();
    }
  }

  /**
   * Generate embedding for a single text with retry logic
   * @param {string} text - Text to embed
   * @returns {Promise<{vector: number[], model: string}>}
   */
  async embedText(text) {
    const startTime = Date.now();
    this.stats.totalRequests++;
    let acquiredSlot = false;

    try {
      await this._acquireSlot();
      acquiredSlot = true;
      const result = await this._embedTextWithRetry(text);
      this.stats.successfulRequests++;
      this.stats.totalLatencyMs += Date.now() - startTime;
      return result;
    } catch (error) {
      this.stats.failedRequests++;
      throw error;
    } finally {
      if (acquiredSlot) {
        this._releaseSlot();
      }
      // FIX: Invoke concurrency adjustment after each request
      // This was previously defined but never called (dead code)
      this._adjustConcurrency();
    }
  }

  /**
   * Internal embedding with retry logic using centralized retry utility
   * @param {string} text - Text to embed
   * @returns {Promise<{vector: number[], model: string}>}
   */
  async _embedTextWithRetry(text) {
    // FIX: Delegate to OllamaService for consistent model resolution and fallback logic
    // This ensures ingestion uses the same logic as search
    try {
      const ollamaService = getOllamaService();

      // Health check enhancement: Fail fast if service is known to be unhealthy
      const ollamaClient = ollamaService.getClient();
      if (ollamaClient && typeof ollamaClient.isHealthy === 'boolean' && !ollamaClient.isHealthy) {
        const error = new Error('Ollama service is unhealthy (circuit open or disconnected)');
        error.code = 'SERVICE_UNAVAILABLE';
        throw error;
      }

      // Pass retry configuration to OllamaService
      const options = {
        maxRetries: this.maxRetries,
        initialDelay: this.initialRetryDelayMs,
        maxDelay: this.maxRetryDelayMs
      };

      const result = await ollamaService.generateEmbedding(text, options);

      // Normalize shape to { vector, model, success } expected by callers
      if (result && result.success) {
        const normalized = {
          success: true,
          vector: result.embedding || result.vector || [],
          model: result.model || 'fallback'
        };
        // Reduce log verbosity for successful embeddings - only log debug if needed
        // logger.debug('[ParallelEmbeddingService] Embedding generated', {
        //   model: normalized.model,
        //   dim: Array.isArray(normalized.vector) ? normalized.vector.length : 0
        // });
        return normalized;
      }

      // Propagate structured failure for upstream handling
      const err = new Error(result?.error || 'Embedding failed');
      err.code = 'EMBEDDING_FAILED';
      logger.warn('[ParallelEmbeddingService] Embedding failed', {
        model: result?.model,
        error: err.message
      });
      throw err;
    } catch (error) {
      logger.error('[ParallelEmbeddingService] Embedding failed via OllamaService', {
        error: error.message,
        retryable: isRetryableError(error)
      });

      const embeddingError = new Error(`Embedding failed: ${error.message}`);
      embeddingError.code = 'EMBEDDING_FAILED';
      embeddingError.originalError = error;
      embeddingError.retryable = isRetryableError(error);
      throw embeddingError;
    }
  }

  /**
   * Generate embeddings for multiple texts in parallel with controlled concurrency
   * @param {Array<{id: string, text: string, meta?: Object}>} items - Items to embed
   * @param {Object} options - Processing options
   * @returns {Promise<{results: Array, errors: Array, stats: Object}>}
   */
  async batchEmbedTexts(items, options = {}) {
    const { onProgress = null, stopOnError = false } = options;

    if (!Array.isArray(items) || items.length === 0) {
      return {
        results: [],
        errors: [],
        stats: { total: 0, successful: 0, failed: 0, duration: 0 }
      };
    }

    // FIX: CRITICAL - Capture model at batch start to prevent dimension mismatches
    // If the model changes during a batch, different items would have different dimensions,
    // causing vector store corruption
    const { AI_DEFAULTS } = require('../../shared/constants');
    const batchModel = getOllamaEmbeddingModel() || AI_DEFAULTS.EMBEDDING.MODEL;

    const startTime = Date.now();
    const results = new Array(items.length);
    const errors = [];
    let completedCount = 0;
    let modelChangedDuringBatch = false;

    // Cache model lookup (Fix 6: Cache model lookup)
    let lastModelCheck = Date.now();
    const MODEL_CHECK_INTERVAL = 5000;

    logger.info('[ParallelEmbeddingService] Starting batch embedding', {
      itemCount: items.length,
      concurrencyLimit: this.concurrencyLimit,
      model: batchModel
    });

    // Process all items with semaphore-controlled concurrency
    const processItem = async (item, index) => {
      try {
        // FIX: Check if model changed during batch - early exit if detected
        // Cached lookup to avoid reading config on every item
        const now = Date.now();
        if (now - lastModelCheck > MODEL_CHECK_INTERVAL) {
          const currentModel = getOllamaEmbeddingModel() || AI_DEFAULTS.EMBEDDING.MODEL;
          if (currentModel !== batchModel) {
            modelChangedDuringBatch = true;
            const errorMsg = `Model changed during batch operation (started with ${batchModel}, now ${currentModel}). Aborting batch to prevent vector dimension mismatch.`;
            logger.error('[ParallelEmbeddingService] ' + errorMsg);
            throw new Error(errorMsg);
          }
          lastModelCheck = now;
        }

        const { vector, model } = await this.embedText(item.text);

        // FIX: Validate model consistency - warn if model used differs from batch model
        if (model !== batchModel && model !== 'fallback') {
          // FIX CRIT-29: Throw on model mismatch to prevent vector space corruption
          const mismatchMsg = `Model mismatch in batch: expected ${batchModel}, got ${model}. Aborting to protect vector integrity.`;
          logger.error('[ParallelEmbeddingService] ' + mismatchMsg, {
            itemId: item.id
          });
          throw new Error(mismatchMsg);
        }

        const result = {
          id: item.id,
          vector,
          model,
          batchModel, // FIX: Include batch model for validation by caller
          meta: item.meta || {},
          success: true
        };

        results[index] = result;
        completedCount++;

        if (onProgress) {
          onProgress({
            completed: completedCount,
            total: items.length,
            percent: Math.round((completedCount / items.length) * 100),
            current: item.id,
            success: true
          });
        }

        return result;
      } catch (error) {
        completedCount++;

        // FIX: Enhanced error information with retryable flag and error type
        const errorMessage = error.message || String(error);
        const errorType = this._classifyError(error);
        const retryable = this._isRetryableError(error);

        const errorInfo = {
          id: item.id,
          error: errorMessage,
          errorType,
          retryable,
          index
        };

        errors.push(errorInfo);
        results[index] = { ...errorInfo, success: false };

        if (onProgress) {
          onProgress({
            completed: completedCount,
            total: items.length,
            percent: Math.round((completedCount / items.length) * 100),
            current: item.id,
            success: false,
            error: error.message
          });
        }

        if (stopOnError) {
          throw error;
        }

        return null;
      }
    };

    if (stopOnError) {
      for (let index = 0; index < items.length; index++) {
        await processItem(items[index], index);
      }
    } else {
      // Launch all tasks - the semaphore will control actual concurrency
      const promises = items.map((item, index) => processItem(item, index));
      // Wait for all to complete (errors are caught individually unless stopOnError)
      await Promise.allSettled(promises);
    }

    const duration = Date.now() - startTime;
    const successCount = items.length - errors.length;

    logger.info('[ParallelEmbeddingService] Batch embedding complete', {
      total: items.length,
      successful: successCount,
      failed: errors.length,
      duration: `${duration}ms`,
      avgPerItem: `${Math.round(duration / items.length)}ms`,
      throughput: `${(items.length / (duration / 1000)).toFixed(2)} items/sec`,
      modelChangedDuringBatch
    });

    return {
      results: results.filter(Boolean),
      errors,
      stats: {
        total: items.length,
        successful: successCount,
        failed: errors.length,
        duration,
        avgLatencyMs: Math.round(duration / items.length),
        throughput: items.length / (duration / 1000),
        // FIX: Include model info for caller validation
        model: batchModel,
        modelChangedDuringBatch
      }
    };
  }

  /**
   * Generate embeddings for files with their summaries
   * Optimized for file analysis workflow
   * @param {Array<{fileId: string, summary: string, filePath: string, meta?: Object}>} fileSummaries
   * @param {Object} options - Processing options
   * @returns {Promise<{results: Array, errors: Array, stats: Object}>}
   */
  async batchEmbedFileSummaries(fileSummaries, options = {}) {
    const items = fileSummaries.map((file) => ({
      id: file.fileId,
      text: file.summary,
      meta: {
        path: file.filePath,
        ...file.meta
      }
    }));

    return this.batchEmbedTexts(items, options);
  }

  /**
   * Generate embeddings for folders
   * @param {Array<{id?: string, name: string, description?: string, path?: string}>} folders
   * @param {Object} options - Processing options
   * @returns {Promise<{results: Array, errors: Array, stats: Object}>}
   */
  async batchEmbedFolders(folders, options = {}) {
    const items = folders.map((folder) => ({
      id: folder.id || `folder:${folder.name}`,
      text: [folder.name, folder.description].filter(Boolean).join(' - '),
      meta: {
        name: folder.name,
        path: folder.path || '',
        description: folder.description || ''
      }
    }));

    return this.batchEmbedTexts(items, options);
  }

  /**
   * Set concurrency limit dynamically
   * @param {number} limit - New concurrency limit (1-10)
   */
  setConcurrencyLimit(limit) {
    const newLimit = Math.max(1, Math.min(limit, 10));

    if (newLimit !== this.concurrencyLimit) {
      logger.info('[ParallelEmbeddingService] Concurrency limit changed', {
        previous: this.concurrencyLimit,
        new: newLimit
      });
      this.concurrencyLimit = newLimit;
    }
  }

  /**
   * Get current statistics
   * @returns {Object} Service statistics
   */
  getStats() {
    return {
      ...this.stats,
      concurrencyLimit: this.concurrencyLimit,
      activeRequests: this.activeRequests,
      queuedRequests: this.waitQueue.length,
      avgLatencyMs:
        this.stats.successfulRequests > 0
          ? Math.round(this.stats.totalLatencyMs / this.stats.successfulRequests)
          : 0,
      successRate:
        this.stats.totalRequests > 0
          ? Math.round((this.stats.successfulRequests / this.stats.totalRequests) * 100)
          : 100
    };
  }

  /**
   * Reset statistics
   */
  resetStats() {
    this.stats = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      totalLatencyMs: 0,
      peakConcurrency: 0
    };
  }

  /**
   * Shutdown the service gracefully
   * Rejects all pending requests and clears timeouts
   * @returns {Promise<void>}
   */
  async shutdown() {
    logger.info('[ParallelEmbeddingService] Shutting down', {
      activeRequests: this.activeRequests,
      queuedRequests: this.waitQueue.length
    });

    this._isShuttingDown = true;

    // Reject all pending queued requests and clear their timeouts
    const shutdownError = new Error('ParallelEmbeddingService: Service shutting down');
    shutdownError.code = 'SERVICE_SHUTDOWN';

    for (const entry of this.waitQueue) {
      if (entry.timeoutId) {
        clearTimeout(entry.timeoutId);
      }
      if (entry.reject) {
        entry.reject(shutdownError);
      }
    }

    // Clear the queue
    this.waitQueue = [];

    logger.info('[ParallelEmbeddingService] Shutdown complete');
  }

  /**
   * Check if Ollama service is healthy
   * @returns {Promise<boolean>}
   */
  async isServiceHealthy() {
    try {
      const ollama = getOllama();
      await ollama.list();
      return true;
    } catch (error) {
      logger.warn('[ParallelEmbeddingService] Health check failed:', error.message);
      return false;
    }
  }

  /**
   * Wait for Ollama service to become available
   * @param {Object} options - Options
   * @param {number} [options.maxWaitMs=30000] - Maximum wait time
   * @param {number} [options.checkIntervalMs=2000] - Check interval
   * @returns {Promise<boolean>} True if service became available
   */
  async waitForService(options = {}) {
    const { maxWaitMs = 30000, checkIntervalMs = 2000 } = options;
    const startTime = Date.now();

    while (Date.now() - startTime < maxWaitMs) {
      if (await this.isServiceHealthy()) {
        return true;
      }
      await new Promise((resolve) => {
        const timeoutId = setTimeout(resolve, checkIntervalMs);
        // Prevent timer from keeping Node.js process alive during wait
        if (timeoutId && typeof timeoutId.unref === 'function') {
          timeoutId.unref();
        }
      });
    }

    logger.warn('[ParallelEmbeddingService] Timeout waiting for Ollama service');
    return false;
  }

  /**
   * Dynamically adjust concurrency based on error rate
   */
  _adjustConcurrency() {
    const { successfulRequests, failedRequests } = this.stats;
    const totalProcessed = successfulRequests + failedRequests;

    if (totalProcessed < 10) return; // Need enough data

    const errorRate = failedRequests / totalProcessed;

    if (errorRate > 0.2 && this.concurrencyLimit > 2) {
      // High error rate - reduce concurrency
      const newLimit = Math.max(2, Math.floor(this.concurrencyLimit * 0.7));
      if (newLimit !== this.concurrencyLimit) {
        logger.info('[ParallelEmbeddingService] Reducing concurrency due to high error rate', {
          errorRate: `${(errorRate * 100).toFixed(1)}%`,
          previousLimit: this.concurrencyLimit,
          newLimit
        });
        this.concurrencyLimit = newLimit;
      }
    } else if (errorRate < 0.05 && this.concurrencyLimit < 10 && totalProcessed > 50) {
      // Low error rate - can increase concurrency
      const newLimit = Math.min(10, Math.ceil(this.concurrencyLimit * 1.2));
      if (newLimit !== this.concurrencyLimit) {
        logger.debug('[ParallelEmbeddingService] Increasing concurrency due to low error rate', {
          errorRate: `${(errorRate * 100).toFixed(1)}%`,
          previousLimit: this.concurrencyLimit,
          newLimit
        });
        this.concurrencyLimit = newLimit;
      }
    }
  }

  /**
   * Classify error type for better error handling
   * @param {Error} error - The error to classify
   * @returns {string} Error type classification
   * @private
   */
  _classifyError(error) {
    const message = (error.message || String(error)).toLowerCase();
    const code = error.code || '';

    // Network/connection errors
    if (
      code === 'ECONNREFUSED' ||
      code === 'ECONNRESET' ||
      code === 'ETIMEDOUT' ||
      code === 'ENOTFOUND' ||
      message.includes('connection refused') ||
      message.includes('network') ||
      message.includes('socket')
    ) {
      return 'NETWORK_ERROR';
    }

    // Service unavailable
    if (
      code === 'SERVICE_UNAVAILABLE' ||
      code === 'SERVICE_SHUTDOWN' ||
      message.includes('service unavailable') ||
      message.includes('shutting down') ||
      message.includes('not running')
    ) {
      return 'SERVICE_UNAVAILABLE';
    }

    // Timeout errors
    if (
      code === 'TIMEOUT' ||
      code === 'QUEUE_TIMEOUT' ||
      message.includes('timeout') ||
      message.includes('timed out')
    ) {
      return 'TIMEOUT';
    }

    // Model not found
    if (
      message.includes('model') &&
      (message.includes('not found') ||
        message.includes('does not exist') ||
        message.includes('unknown'))
    ) {
      return 'MODEL_NOT_FOUND';
    }

    // Rate limiting
    if (
      code === 'RATE_LIMITED' ||
      message.includes('rate limit') ||
      message.includes('too many requests') ||
      message.includes('429')
    ) {
      return 'RATE_LIMITED';
    }

    // Out of memory
    if (
      message.includes('out of memory') ||
      message.includes('oom') ||
      message.includes('memory')
    ) {
      return 'OUT_OF_MEMORY';
    }

    // Invalid input
    if (
      message.includes('invalid') ||
      message.includes('malformed') ||
      message.includes('empty') ||
      message.includes('required')
    ) {
      return 'INVALID_INPUT';
    }

    return 'UNKNOWN';
  }

  /**
   * Determine if an error is retryable
   * @param {Error} error - The error to check
   * @returns {boolean} True if the error is retryable
   * @private
   */
  _isRetryableError(error) {
    const errorType = this._classifyError(error);

    // Retryable error types
    const retryableTypes = ['NETWORK_ERROR', 'SERVICE_UNAVAILABLE', 'TIMEOUT', 'RATE_LIMITED'];

    if (retryableTypes.includes(errorType)) {
      return true;
    }

    // Check for specific error codes that are retryable
    const code = error.code || '';
    const retryableCodes = [
      'ECONNREFUSED',
      'ECONNRESET',
      'ETIMEDOUT',
      'ENOTFOUND',
      'EPIPE',
      'EAI_AGAIN',
      'QUEUE_TIMEOUT'
    ];

    if (retryableCodes.includes(code)) {
      return true;
    }

    // Non-retryable: model not found, invalid input, out of memory
    return false;
  }
}

// Singleton management - delegates to DI container when available
let _localInstance = null;
let _containerRegistered = false;

/**
 * Get or create the singleton instance
 *
 * This function provides backward compatibility while the DI container
 * is the single source of truth for singleton instances.
 *
 * @param {Object} options - Configuration options
 * @returns {ParallelEmbeddingService}
 */
function getInstance(options = {}) {
  // Try to get from DI container first (preferred)
  try {
    const { container, ServiceIds } = require('./ServiceContainer');
    if (container.has(ServiceIds.PARALLEL_EMBEDDING)) {
      return container.resolve(ServiceIds.PARALLEL_EMBEDDING);
    }
  } catch {
    // Container not available yet, use local instance
  }

  // Fallback to local instance for early startup or testing
  if (!_localInstance) {
    _localInstance = new ParallelEmbeddingService(options);
  }
  return _localInstance;
}

/**
 * Register this service with the DI container
 * Called by ServiceIntegration during initialization
 * @param {ServiceContainer} container - The DI container
 * @param {string} serviceId - The service identifier
 */
function registerWithContainer(container, serviceId) {
  if (_containerRegistered) return;

  container.registerSingleton(serviceId, () => {
    // If we have a local instance, migrate it to the container
    if (_localInstance) {
      const instance = _localInstance;
      _localInstance = null; // Clear local reference
      return instance;
    }
    return new ParallelEmbeddingService();
  });
  _containerRegistered = true;
  logger.debug('[ParallelEmbeddingService] Registered with DI container');
}

/**
 * Reset the singleton instance (useful for testing)
 * Calls shutdown on existing instance before resetting
 */
async function resetInstance() {
  // Reset container registration flag
  _containerRegistered = false;

  // Clear from DI container if registered
  try {
    const { container, ServiceIds } = require('./ServiceContainer');
    if (container.has(ServiceIds.PARALLEL_EMBEDDING)) {
      const instance = container.tryResolve(ServiceIds.PARALLEL_EMBEDDING);
      container.clearInstance(ServiceIds.PARALLEL_EMBEDDING);
      if (instance && typeof instance.shutdown === 'function') {
        try {
          await instance.shutdown();
        } catch (e) {
          logger.warn(
            '[ParallelEmbeddingService] Error during container instance shutdown:',
            e.message
          );
        }
      }
    }
  } catch {
    // Container not available
  }

  // Also clear local instance
  if (_localInstance) {
    const oldInstance = _localInstance;
    _localInstance = null;
    try {
      await oldInstance.shutdown();
    } catch (error) {
      logger.warn('[ParallelEmbeddingService] Error during shutdown in reset:', error.message);
    }
  }
}

module.exports = {
  ParallelEmbeddingService,
  getInstance,
  resetInstance,
  registerWithContainer
};
