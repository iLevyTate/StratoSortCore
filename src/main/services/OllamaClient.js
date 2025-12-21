/**
 * OllamaClient - Resilient client for Ollama API
 *
 * Features:
 * - Retry with exponential backoff and jitter
 * - Offline queue with disk persistence
 * - Concurrency limiting (semaphore pattern)
 * - Health checking and availability monitoring
 * - Batch operations support
 */

const fs = require('fs').promises;
const path = require('path');
const { app } = require('electron');
const { logger } = require('../../shared/logger');
const { TIMEOUTS } = require('../../shared/performanceConstants');

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
 */
const DEFAULT_CONFIG = {
  // Retry settings
  maxRetries: 3,
  initialRetryDelay: 1000,
  maxRetryDelay: 8000,
  retryJitterFactor: 0.3,

  // Concurrency settings
  maxConcurrentRequests: 5,
  maxQueuedRequests: 100,

  // Health check settings
  healthCheckInterval: 30000, // 30 seconds
  healthCheckTimeout: 5000, // 5 seconds
  unhealthyThreshold: 3, // consecutive failures to mark unhealthy

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

    // Concurrency control (semaphore)
    this.activeRequests = 0;
    this.waitQueue = [];

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
    if (this.activeRequests < this.config.maxConcurrentRequests) {
      this.activeRequests++;
      return Promise.resolve();
    }

    // Check if queue is full
    if (this.waitQueue.length >= this.config.maxQueuedRequests) {
      throw new Error('Request queue full, try again later');
    }

    // Wait for a slot
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        const index = this.waitQueue.findIndex((item) => item.resolve === resolve);
        if (index !== -1) {
          this.waitQueue.splice(index, 1);
          reject(new Error('Request queue timeout'));
        }
      }, 60000); // 1 minute timeout for queued requests

      this.waitQueue.push({ resolve, reject, timeout });
    });
  }

  /**
   * Release a slot in the concurrency semaphore
   */
  _releaseSlot() {
    this.activeRequests--;

    if (this.waitQueue.length > 0) {
      const next = this.waitQueue.shift();
      clearTimeout(next.timeout);
      this.activeRequests++;
      next.resolve();
    }
  }

  // ============= RETRY LOGIC =============

  /**
   * Calculate delay with exponential backoff and jitter
   * @param {number} attempt - Current attempt number (0-based)
   * @returns {number} Delay in milliseconds
   */
  _calculateRetryDelay(attempt) {
    const { initialRetryDelay, maxRetryDelay, retryJitterFactor } = this.config;

    // Exponential backoff
    const exponentialDelay = initialRetryDelay * Math.pow(2, attempt);
    const baseDelay = Math.min(exponentialDelay, maxRetryDelay);

    // Add jitter to prevent thundering herd
    const jitter = baseDelay * retryJitterFactor * (Math.random() - 0.5) * 2;

    return Math.max(0, Math.floor(baseDelay + jitter));
  }

  /**
   * Determine if an error is retryable
   * @param {Error} error - The error to check
   * @returns {boolean}
   */
  _isRetryableError(error) {
    if (!error) return false;

    const message = (error.message || '').toLowerCase();
    const code = error.code || '';

    // Network errors - always retry
    if (
      [
        'ECONNREFUSED',
        'ECONNRESET',
        'ETIMEDOUT',
        'ENOTFOUND',
        'EHOSTUNREACH',
        'ENETUNREACH'
      ].includes(code)
    ) {
      return true;
    }

    // Fetch/network errors - retry
    if (
      message.includes('fetch failed') ||
      message.includes('network') ||
      message.includes('timeout') ||
      message.includes('aborted') ||
      message.includes('connection')
    ) {
      return true;
    }

    // HTTP status codes
    if (error.status) {
      const retryableStatuses = [408, 429, 500, 502, 503, 504];
      if (retryableStatuses.includes(error.status)) {
        return true;
      }
    }

    // Ollama-specific temporary errors
    if (
      message.includes('model is loading') ||
      message.includes('server busy') ||
      message.includes('temporarily unavailable')
    ) {
      return true;
    }

    // Non-retryable errors
    if (
      message.includes('invalid') ||
      message.includes('validation') ||
      message.includes('not found') ||
      message.includes('unauthorized') ||
      message.includes('forbidden') ||
      message.includes('bad request') ||
      message.includes('zero length image') ||
      message.includes('unsupported')
    ) {
      return false;
    }

    return false;
  }

  /**
   * Execute a function with retry logic
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

    let lastError;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const result = await fn();

        if (attempt > 0) {
          logger.info(`[OllamaClient] ${operation} succeeded on retry ${attempt}`);
          this.stats.retriedRequests++;
        }

        return result;
      } catch (error) {
        lastError = error;

        const isRetryable = this._isRetryableError(error);
        const hasRetriesLeft = attempt < maxRetries;

        if (isRetryable && hasRetriesLeft) {
          const delay = this._calculateRetryDelay(attempt);

          logger.warn(
            `[OllamaClient] ${operation} failed (attempt ${attempt + 1}/${maxRetries + 1}), retrying in ${delay}ms`,
            {
              error: error.message,
              code: error.code
            }
          );

          if (onRetry) {
            try {
              await onRetry(attempt, error);
            } catch (retryError) {
              logger.warn('[OllamaClient] onRetry callback error:', retryError.message);
            }
          }

          await new Promise((resolve) => setTimeout(resolve, delay));
        } else {
          // No more retries
          if (!isRetryable) {
            logger.debug(
              `[OllamaClient] ${operation} failed with non-retryable error:`,
              error.message
            );
          } else {
            logger.error(
              `[OllamaClient] ${operation} failed after ${attempt + 1} attempts:`,
              error.message
            );
          }
          break;
        }
      }
    }

    throw lastError;
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
    return {
      isHealthy: this.isHealthy,
      consecutiveFailures: this.consecutiveFailures,
      lastHealthCheck: this.lastHealthCheck,
      activeRequests: this.activeRequests,
      queuedRequests: this.waitQueue.length,
      offlineQueueSize: this.offlineQueue.length
    };
  }

  // ============= OFFLINE QUEUE =============

  /**
   * Load offline queue from disk
   */
  async _loadOfflineQueue() {
    try {
      const data = await fs.readFile(this.offlineQueuePath, 'utf8');
      const parsed = JSON.parse(data);

      if (Array.isArray(parsed)) {
        this.offlineQueue = parsed.slice(0, this.config.maxOfflineQueueSize);
        logger.info('[OllamaClient] Loaded offline queue:', this.offlineQueue.length);
      }
    } catch (error) {
      if (error.code !== 'ENOENT') {
        logger.warn('[OllamaClient] Error loading offline queue:', error.message);
      }
    }
  }

  /**
   * Persist offline queue to disk
   */
  async _persistOfflineQueue() {
    try {
      if (this.offlineQueue.length === 0) {
        await fs.unlink(this.offlineQueuePath).catch((e) => {
          if (e.code !== 'ENOENT') throw e;
        });
        return;
      }

      // FIX: Use atomic write (temp + rename) to prevent corruption on crash
      const tempPath = `${this.offlineQueuePath}.tmp.${Date.now()}`;
      try {
        await fs.writeFile(tempPath, JSON.stringify(this.offlineQueue, null, 2), 'utf8');
        await fs.rename(tempPath, this.offlineQueuePath);
      } catch (writeError) {
        // Clean up temp file on failure
        try {
          await fs.unlink(tempPath);
        } catch {
          // Ignore cleanup errors
        }
        throw writeError;
      }
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
        this._processOfflineQueue();
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
      case REQUEST_TYPES.EMBEDDING:
        return ollama.embeddings(request.payload);
      case REQUEST_TYPES.GENERATE:
        return ollama.generate(request.payload);
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
            return ollama.embeddings(options);
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
      if (!this.isHealthy && this._isRetryableError(error)) {
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
      if (!this.isHealthy && this._isRetryableError(error) && !options.stream) {
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
    return {
      ...this.stats,
      isHealthy: this.isHealthy,
      activeRequests: this.activeRequests,
      queuedRequests: this.waitQueue.length,
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
 * @returns {OllamaClient}
 */
function getInstance(options = {}) {
  // Try to get from DI container first (preferred)
  try {
    const { container, ServiceIds } = require('./ServiceContainer');
    if (container.has(ServiceIds.OLLAMA_CLIENT)) {
      return container.resolve(ServiceIds.OLLAMA_CLIENT);
    }
  } catch {
    // Container not available yet, use local instance
  }

  // Fallback to local instance for early startup or testing
  if (!_localInstance) {
    _localInstance = new OllamaClient(options);
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
    return new OllamaClient();
  });
  _containerRegistered = true;
  logger.debug('[OllamaClient] Registered with DI container');
}

/**
 * Reset the singleton (for testing)
 * @returns {Promise<void>}
 */
async function resetInstance() {
  // Reset container registration flag
  _containerRegistered = false;

  // Clear from DI container if registered
  try {
    const { container, ServiceIds } = require('./ServiceContainer');
    if (container.has(ServiceIds.OLLAMA_CLIENT)) {
      const instance = container.tryResolve(ServiceIds.OLLAMA_CLIENT);
      container.clearInstance(ServiceIds.OLLAMA_CLIENT);
      if (instance) {
        try {
          await instance.shutdown();
        } catch (e) {
          logger.warn('[OllamaClient] Error during container instance shutdown:', e.message);
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
    } catch (e) {
      logger.warn('[OllamaClient] Error during reset shutdown:', e.message);
    }
  }
}

module.exports = {
  OllamaClient,
  getInstance,
  resetInstance,
  registerWithContainer,
  REQUEST_TYPES
};
