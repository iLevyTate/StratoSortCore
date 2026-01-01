/**
 * OllamaClient - Resilient client for Ollama API
 *
 * Features:
 * - Retry with exponential backoff and jitter (uses shared ollamaApiRetry)
 * - Offline queue with disk persistence
 * - Concurrency limiting (semaphore pattern)
 * - Health checking and availability monitoring
 * - Batch operations support
 *
 * Shared utilities from ollamaApiRetry.js:
 * - isRetryableError: Error classification for retry decisions
 * - withOllamaRetry: Retry wrapper with exponential backoff and jitter
 *
 * @module services/OllamaClient
 */

const path = require('path');
const { app } = require('electron');
const { logger } = require('../../shared/logger');
const { TIMEOUTS, RETRY } = require('../../shared/performanceConstants');
const { isRetryableError, withOllamaRetry } = require('../utils/ollamaApiRetry');
const { atomicWriteFile, loadJsonFile, safeUnlink } = require('../../shared/atomicFile');
const { Semaphore } = require('../../shared/RateLimiter');

logger.setContext('OllamaClient');

/**
 * Ollama request types for queue classification
 */
const REQUEST_TYPES = {
  EMBEDDING: 'embedding',
  GENERATE: 'generate',
  VISION: 'vision',
  LIST: 'list'
};

/**
 * Default configuration
 * Uses shared constants from performanceConstants.js where applicable
 */
const DEFAULT_CONFIG = {
  // Retry settings (from shared RETRY.OLLAMA_API config)
  maxRetries: RETRY.OLLAMA_API.maxAttempts,
  initialRetryDelay: RETRY.OLLAMA_API.initialDelay,
  maxRetryDelay: RETRY.OLLAMA_API.maxDelay,
  retryJitterFactor: 0.3,

  // Concurrency settings
  maxConcurrentRequests: 5,
  maxQueuedRequests: 100,

  // Health check settings
  healthCheckInterval: TIMEOUTS.HEALTH_CHECK || 30000,
  healthCheckTimeout: 5000,
  unhealthyThreshold: RETRY.MAX_ATTEMPTS_MEDIUM,

  // Offline queue settings
  maxOfflineQueueSize: 500,
  offlineQueueFlushInterval: 60000, // 1 minute
  persistQueueOnShutdown: true
};

/**
 * OllamaClient - Singleton instance for resilient Ollama operations
 */
class OllamaClient {
  constructor(options = {}) {
    this.config = { ...DEFAULT_CONFIG, ...options };

    // State
    this.initialized = false;
    this.isHealthy = false;
    this.consecutiveFailures = 0;
    this.lastHealthCheck = null;
    this.healthCheckTimer = null;

    // Concurrency control (uses shared Semaphore utility)
    this.semaphore = new Semaphore(
      this.config.maxConcurrentRequests,
      this.config.maxQueuedRequests,
      60000 // 1 minute timeout for queued requests
    );

    // Offline queue for failed requests
    this.offlineQueue = [];
    this.offlineQueuePath = null;
    this.offlineQueueTimer = null;
    this.isProcessingOfflineQueue = false;

    // Statistics
    this.stats = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      retriedRequests: 0,
      queuedRequests: 0,
      offlineQueuedRequests: 0,
      healthChecksPassed: 0,
      healthChecksFailed: 0,
      avgLatencyMs: 0,
      lastError: null,
      lastErrorTime: null
    };

    // Track pending operations for graceful shutdown
    this._pendingOperations = new Set();
  }

  /**
   * Initialize the client
   */
  async initialize() {
    if (this.initialized) return;

    try {
      // Set up offline queue persistence path
      this.offlineQueuePath = path.join(app.getPath('userData'), 'ollama_offline_queue.json');

      // Load persisted offline queue
      await this._loadOfflineQueue();

      // Start health monitoring
      await this._performHealthCheck();
      this._startHealthMonitoring();

      // Start offline queue processing
      this._startOfflineQueueProcessor();

      this.initialized = true;
      logger.info('[OllamaClient] Initialized', {
        config: {
          maxConcurrentRequests: this.config.maxConcurrentRequests,
          maxRetries: this.config.maxRetries,
          offlineQueueSize: this.offlineQueue.length
        }
      });
    } catch (error) {
      logger.error('[OllamaClient] Initialization failed:', error.message);
      this.initialized = true; // Continue even if init partially fails
    }
  }

  /**
   * Shutdown the client gracefully
   */
  async shutdown() {
    logger.info('[OllamaClient] Shutting down...');

    // Stop health monitoring
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }

    // Stop offline queue processor
    if (this.offlineQueueTimer) {
      clearInterval(this.offlineQueueTimer);
      this.offlineQueueTimer = null;
    }

    // Wait for pending operations (with timeout)
    if (this._pendingOperations.size > 0) {
      const timeout = 10000;
      const startTime = Date.now();

      while (this._pendingOperations.size > 0 && Date.now() - startTime < timeout) {
        await new Promise((resolve) => setTimeout(resolve, TIMEOUTS.DELAY_BATCH));
      }

      if (this._pendingOperations.size > 0) {
        logger.warn(
          '[OllamaClient] Shutdown timeout, pending operations:',
          this._pendingOperations.size
        );
      }
    }

    // Persist offline queue
    if (this.config.persistQueueOnShutdown) {
      await this._persistOfflineQueue();
    }

    logger.info('[OllamaClient] Shutdown complete', {
      offlineQueueSize: this.offlineQueue.length
    });
  }

  // ============= CONCURRENCY CONTROL =============

  /**
   * Acquire a slot in the concurrency semaphore
   * @returns {Promise<void>}
   */
  async _acquireSlot() {
    return this.semaphore.acquire();
  }

  /**
   * Release a slot in the concurrency semaphore
   */
  _releaseSlot() {
    this.semaphore.release();
  }

  // ============= RETRY LOGIC =============

  /**
   * Execute a function with retry logic
   * Delegates to shared withOllamaRetry utility while tracking stats
   * @param {Function} fn - Function to execute
   * @param {Object} options - Options
   * @returns {Promise<*>}
   */
  async _withRetry(fn, options = {}) {
    const {
      operation = 'Ollama request',
      maxRetries = this.config.maxRetries,
      onRetry = null
    } = options;

    let retryAttempts = 0;

    const result = await withOllamaRetry(fn, {
      operation,
      maxRetries,
      initialDelay: this.config.initialRetryDelay,
      maxDelay: this.config.maxRetryDelay,
      jitterFactor: this.config.retryJitterFactor,
      onRetry: async (attempt, error) => {
        retryAttempts = attempt;
        if (onRetry) {
          await onRetry(attempt, error);
        }
      }
    });

    // Track successful retries in stats
    if (retryAttempts > 0) {
      this.stats.retriedRequests++;
    }

    return result;
  }

  // ============= HEALTH MONITORING =============

  /**
   * Perform a health check
   * @returns {Promise<boolean>}
   */
  async _performHealthCheck() {
    let timer = null;
    try {
      const { getOllama } = require('../ollamaUtils');
      const ollama = getOllama();

      const timeoutPromise = new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('Health check timeout')),
          this.config.healthCheckTimeout
        );
        if (timer.unref) timer.unref();
      });

      const checkPromise = ollama.list();

      await Promise.race([checkPromise, timeoutPromise]);

      this.isHealthy = true;
      this.consecutiveFailures = 0;
      this.lastHealthCheck = Date.now();
      this.stats.healthChecksPassed++;

      return true;
    } catch (error) {
      this.consecutiveFailures++;
      this.stats.healthChecksFailed++;

      if (this.consecutiveFailures >= this.config.unhealthyThreshold) {
        if (this.isHealthy) {
          logger.warn(
            '[OllamaClient] Ollama marked unhealthy after consecutive failures:',
            this.consecutiveFailures
          );
        }
        this.isHealthy = false;
      }

      this.lastHealthCheck = Date.now();
      return false;
    } finally {
      // Clear timeout to prevent memory leak
      if (timer) clearTimeout(timer);
    }
  }

  /**
   * Start health monitoring
   */
  _startHealthMonitoring() {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
    }

    this.healthCheckTimer = setInterval(async () => {
      // FIX: Wrap async callback in try/catch to prevent unhandled rejections
      try {
        const wasHealthy = this.isHealthy;
        await this._performHealthCheck();

        // If we recovered, process offline queue
        if (!wasHealthy && this.isHealthy && this.offlineQueue.length > 0) {
          logger.info('[OllamaClient] Ollama recovered, processing offline queue');
          await this._processOfflineQueue();
        }
      } catch (error) {
        logger.error('[OllamaClient] Health check interval error:', error.message);
      }
    }, this.config.healthCheckInterval);

    // Don't prevent process exit
    if (this.healthCheckTimer.unref) {
      this.healthCheckTimer.unref();
    }
  }

  /**
   * Get health status
   * @returns {Object}
   */
  getHealthStatus() {
    const semaphoreStats = this.semaphore.getStats();
    return {
      isHealthy: this.isHealthy,
      consecutiveFailures: this.consecutiveFailures,
      lastHealthCheck: this.lastHealthCheck,
      activeRequests: semaphoreStats.activeCount,
      queuedRequests: semaphoreStats.queueLength,
      offlineQueueSize: this.offlineQueue.length
    };
  }

  // ============= OFFLINE QUEUE =============

  /**
   * Load offline queue from disk
   */
  async _loadOfflineQueue() {
    const data = await loadJsonFile(this.offlineQueuePath, {
      description: 'offline queue',
      backupCorrupt: true
    });

    if (Array.isArray(data)) {
      this.offlineQueue = data.slice(0, this.config.maxOfflineQueueSize);
      logger.info('[OllamaClient] Loaded offline queue:', this.offlineQueue.length);
    }
  }

  /**
   * Persist offline queue to disk
   */
  async _persistOfflineQueue() {
    try {
      if (this.offlineQueue.length === 0) {
        await safeUnlink(this.offlineQueuePath);
        return;
      }

      await atomicWriteFile(this.offlineQueuePath, this.offlineQueue, { pretty: true });
    } catch (error) {
      logger.warn('[OllamaClient] Error persisting offline queue:', error.message);
    }
  }

  /**
   * Add a request to the offline queue
   * @param {Object} request - Request to queue
   */
  _addToOfflineQueue(request) {
    if (this.offlineQueue.length >= this.config.maxOfflineQueueSize) {
      // Remove oldest entries
      const dropCount = Math.max(1, Math.floor(this.config.maxOfflineQueueSize * 0.1));
      this.offlineQueue.splice(0, dropCount);
      logger.warn('[OllamaClient] Offline queue full, dropped oldest entries:', dropCount);
    }

    this.offlineQueue.push({
      ...request,
      queuedAt: new Date().toISOString(),
      retryCount: 0
    });

    this.stats.offlineQueuedRequests++;

    // Persist asynchronously
    this._persistOfflineQueue().catch((e) => {
      logger.warn('[OllamaClient] Failed to persist offline queue:', e.message);
    });
  }

  /**
   * Start offline queue processor
   */
  _startOfflineQueueProcessor() {
    if (this.offlineQueueTimer) {
      clearInterval(this.offlineQueueTimer);
    }

    this.offlineQueueTimer = setInterval(() => {
      if (this.isHealthy && this.offlineQueue.length > 0 && !this.isProcessingOfflineQueue) {
        // FIX: Add .catch() to handle rejected promises from async processing
        // Previously, unhandled promise rejections could crash Node.js in strict mode
        this._processOfflineQueue().catch((err) => {
          logger.error('[OllamaClient] Offline queue processing error:', err.message);
        });
      }
    }, this.config.offlineQueueFlushInterval);

    if (this.offlineQueueTimer.unref) {
      this.offlineQueueTimer.unref();
    }
  }

  /**
   * Process offline queue
   */
  async _processOfflineQueue() {
    if (this.isProcessingOfflineQueue || !this.isHealthy) return;
    if (this.offlineQueue.length === 0) return;

    this.isProcessingOfflineQueue = true;

    try {
      logger.info('[OllamaClient] Processing offline queue:', this.offlineQueue.length);

      // Process in batches
      const batchSize = Math.min(10, this.offlineQueue.length);
      const batch = this.offlineQueue.splice(0, batchSize);

      const results = await Promise.allSettled(
        batch.map((request) => this._processQueuedRequest(request))
      );

      // Re-queue failed requests (up to max retries)
      let requeued = 0;
      results.forEach((result, index) => {
        if (result.status === 'rejected') {
          const request = batch[index];
          if (request.retryCount < 3) {
            this.offlineQueue.push({
              ...request,
              retryCount: request.retryCount + 1
            });
            requeued++;
          }
        }
      });

      const successful = results.filter((r) => r.status === 'fulfilled').length;
      logger.info('[OllamaClient] Processed offline queue batch', {
        successful,
        failed: results.length - successful,
        requeued,
        remaining: this.offlineQueue.length
      });

      // Persist updated queue
      await this._persistOfflineQueue();
    } catch (error) {
      logger.error('[OllamaClient] Error processing offline queue:', error.message);
    } finally {
      this.isProcessingOfflineQueue = false;
    }
  }

  /**
   * Process a single queued request
   * @param {Object} request - Queued request
   */
  async _processQueuedRequest(request) {
    const { getOllama } = require('../ollamaUtils');
    const ollama = getOllama();

    switch (request.type) {
      case REQUEST_TYPES.EMBEDDING: {
        // Use the newer embed() API with 'input' parameter (embeddings() with 'prompt' is deprecated)
        // Convert payload.prompt → input for the new API
        const { prompt, ...rest } = request.payload;
        const response = await ollama.embed({ ...rest, input: prompt });
        // Convert response back to legacy format for backward compatibility
        const embedding =
          Array.isArray(response.embeddings) && response.embeddings.length > 0
            ? response.embeddings[0]
            : [];
        return { ...response, embedding };
      }
      case REQUEST_TYPES.GENERATE:
        return ollama.generate(request.payload);
      case REQUEST_TYPES.VISION:
        // FIX: Handle VISION requests in offline queue
        // Vision requests use generate() with images array
        return ollama.generate(request.payload);
      case REQUEST_TYPES.LIST:
        // FIX: Handle LIST requests in offline queue (for model listing)
        return ollama.list();
      default:
        throw new Error(`Unknown request type: ${request.type}`);
    }
  }

  // ============= PUBLIC API =============

  /**
   * Generate embeddings with resilience
   * @param {Object} options - Embedding options
   * @param {string} options.model - Model name
   * @param {string} options.prompt - Text to embed
   * @param {Object} [options.options] - Additional Ollama options
   * @returns {Promise<Object>}
   */
  async embeddings(options) {
    if (!this.initialized) await this.initialize();

    const operationId = Symbol();
    this._pendingOperations.add(operationId);
    this.stats.totalRequests++;

    const startTime = Date.now();

    try {
      await this._acquireSlot();

      try {
        const result = await this._withRetry(
          async () => {
            const { getOllama } = require('../ollamaUtils');
            const ollama = getOllama();
            // Use the newer embed() API with 'input' parameter (embeddings() with 'prompt' is deprecated)
            // Convert options.prompt → input for the new API
            const { prompt, ...rest } = options;

            // FIX: CRITICAL - Add per-request timeout to prevent indefinite hangs
            // Previously, if model was loading or Ollama was unresponsive, this would hang forever
            const requestTimeout = TIMEOUTS.EMBEDDING_REQUEST;
            // FIX: Store timeout ID so we can clear it to prevent memory leak
            let timeoutId;
            const timeoutPromise = new Promise((_, reject) => {
              timeoutId = setTimeout(() => {
                reject(new Error(`Embedding request timeout after ${requestTimeout}ms`));
              }, requestTimeout);
            });

            try {
              const response = await Promise.race([
                ollama.embed({ ...rest, input: prompt }),
                timeoutPromise
              ]);
              // FIX: Clear timeout on success to prevent memory leak
              clearTimeout(timeoutId);

              // Convert response back to legacy format for backward compatibility
              const embedding =
                Array.isArray(response.embeddings) && response.embeddings.length > 0
                  ? response.embeddings[0]
                  : [];
              return { ...response, embedding };
            } catch (raceError) {
              // FIX: Clear timeout on error as well
              clearTimeout(timeoutId);
              throw raceError;
            }
          },
          { operation: `Embedding (${options.model})` }
        );

        this.stats.successfulRequests++;
        this._updateLatencyStats(Date.now() - startTime);
        return result;
      } finally {
        this._releaseSlot();
      }
    } catch (error) {
      this.stats.failedRequests++;
      this.stats.lastError = error.message;
      this.stats.lastErrorTime = new Date().toISOString();

      // Add to offline queue if service is unhealthy
      if (!this.isHealthy && isRetryableError(error)) {
        this._addToOfflineQueue({
          type: REQUEST_TYPES.EMBEDDING,
          payload: options
        });
      }

      throw error;
    } finally {
      this._pendingOperations.delete(operationId);
    }
  }

  /**
   * Generate text with resilience
   * @param {Object} options - Generate options
   * @returns {Promise<Object>}
   */
  async generate(options) {
    if (!this.initialized) await this.initialize();

    const operationId = Symbol();
    this._pendingOperations.add(operationId);
    this.stats.totalRequests++;

    const startTime = Date.now();

    try {
      await this._acquireSlot();

      try {
        const result = await this._withRetry(
          async () => {
            const { getOllama } = require('../ollamaUtils');
            const ollama = getOllama();
            return ollama.generate(options);
          },
          { operation: `Generate (${options.model})` }
        );

        this.stats.successfulRequests++;
        this._updateLatencyStats(Date.now() - startTime);
        return result;
      } finally {
        this._releaseSlot();
      }
    } catch (error) {
      this.stats.failedRequests++;
      this.stats.lastError = error.message;
      this.stats.lastErrorTime = new Date().toISOString();

      // Add to offline queue if service is unhealthy (only for non-streaming)
      if (!this.isHealthy && isRetryableError(error) && !options.stream) {
        this._addToOfflineQueue({
          type: REQUEST_TYPES.GENERATE,
          payload: options
        });
      }

      throw error;
    } finally {
      this._pendingOperations.delete(operationId);
    }
  }

  /**
   * Batch embeddings with controlled concurrency
   * @param {Array<{id: string, text: string}>} items - Items to embed
   * @param {Object} options - Options
   * @returns {Promise<{results: Array, errors: Array}>}
   */
  async batchEmbeddings(items, options = {}) {
    if (!this.initialized) await this.initialize();

    const { model, onProgress = null, batchSize = 10 } = options;

    const results = [];
    const errors = [];
    let completed = 0;

    // Process in batches
    for (let i = 0; i < items.length; i += batchSize) {
      const batch = items.slice(i, i + batchSize);

      const batchResults = await Promise.allSettled(
        batch.map(async (item) => {
          try {
            const response = await this.embeddings({
              model,
              prompt: item.text
            });
            return {
              id: item.id,
              embedding: response.embedding,
              success: true
            };
          } catch (error) {
            return {
              id: item.id,
              error: error.message,
              success: false
            };
          }
        })
      );

      batchResults.forEach((result) => {
        completed++;
        if (result.status === 'fulfilled') {
          if (result.value.success) {
            results.push(result.value);
          } else {
            errors.push(result.value);
          }
        } else {
          errors.push({ error: result.reason?.message || 'Unknown error' });
        }
      });

      if (onProgress) {
        onProgress({
          completed,
          total: items.length,
          percent: Math.round((completed / items.length) * 100)
        });
      }
    }

    return { results, errors };
  }

  /**
   * Update latency statistics
   * FIX: Added division by zero protection
   */
  _updateLatencyStats(latency) {
    const total = this.stats.successfulRequests;
    // FIX: Prevent division by zero when no successful requests yet
    if (total <= 0) {
      this.stats.avgLatencyMs = Math.round(latency);
      return;
    }
    this.stats.avgLatencyMs = Math.round((this.stats.avgLatencyMs * (total - 1) + latency) / total);
  }

  /**
   * Get statistics
   * @returns {Object}
   */
  getStats() {
    const semaphoreStats = this.semaphore.getStats();
    return {
      ...this.stats,
      isHealthy: this.isHealthy,
      activeRequests: semaphoreStats.activeCount,
      queuedRequests: semaphoreStats.queueLength,
      offlineQueueSize: this.offlineQueue.length,
      config: {
        maxConcurrentRequests: this.config.maxConcurrentRequests,
        maxRetries: this.config.maxRetries
      }
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
      retriedRequests: 0,
      queuedRequests: 0,
      offlineQueuedRequests: 0,
      healthChecksPassed: 0,
      healthChecksFailed: 0,
      avgLatencyMs: 0,
      lastError: null,
      lastErrorTime: null
    };
  }
}

// Use shared singleton factory for getInstance, registerWithContainer, resetInstance
const { createSingletonHelpers } = require('../../shared/singletonFactory');

const { getInstance, registerWithContainer, resetInstance } = createSingletonHelpers({
  ServiceClass: OllamaClient,
  serviceId: 'OLLAMA_CLIENT',
  serviceName: 'OllamaClient',
  containerPath: './ServiceContainer',
  shutdownMethod: 'shutdown'
});

module.exports = {
  OllamaClient,
  getInstance,
  resetInstance,
  registerWithContainer,
  REQUEST_TYPES
};
