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
const { CircuitBreaker } = require('../utils/CircuitBreaker');

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
    this._healthCheckInFlight = null; // FIX Bug 6: Track in-flight health check for clean shutdown

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

    // Circuit Breaker for fault tolerance
    this.circuitBreaker = new CircuitBreaker('OllamaClient', {
      failureThreshold: 5,
      successThreshold: 2,
      timeout: 30000,
      resetTimeout: 60000
    });

    // Log circuit breaker state changes
    this.circuitBreaker.on('stateChange', (data) => {
      logger.info(
        `[OllamaClient] Circuit breaker state changed: ${data.previousState} -> ${data.currentState}`,
        data
      );
    });

    // FIX: Process offline queue when circuit closes to ensure queue is processed immediately
    // This fixes the race condition where circuit closes before health check interval
    this.circuitBreaker.on('close', async ({ serviceName }) => {
      logger.info(
        `[OllamaClient] Circuit closed for ${serviceName}, triggering offline queue processing`
      );
      try {
        // Mark as healthy since circuit closed successfully
        this.isHealthy = true;
        this.consecutiveFailures = 0;

        // Process offline queue if not already processing
        if (this.offlineQueue.length > 0 && !this.isProcessingOfflineQueue) {
          await this._processOfflineQueue();
        }
      } catch (error) {
        logger.error(
          '[OllamaClient] Error processing offline queue on circuit close:',
          error.message
        );
      }
    });
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
   * FIX Bug 6: Wait for in-flight health check before shutdown
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

    // FIX Bug 6: Wait for in-flight health check to complete (with 5s timeout)
    if (this._healthCheckInFlight) {
      logger.debug('[OllamaClient] Waiting for in-flight health check to complete');
      try {
        const healthCheckTimeout = 5000;
        await Promise.race([
          this._healthCheckInFlight,
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Health check shutdown timeout')), healthCheckTimeout)
          )
        ]);
      } catch (error) {
        logger.warn('[OllamaClient] Health check did not complete before shutdown:', error.message);
      }
      this._healthCheckInFlight = null;
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
   * FIX Bug 6: Track in-flight health check for clean shutdown
   * @returns {Promise<boolean>}
   */
  async _performHealthCheck() {
    // FIX Bug 6: Create and track the health check promise
    const healthCheckPromise = this._doHealthCheck();
    this._healthCheckInFlight = healthCheckPromise;

    try {
      return await healthCheckPromise;
    } finally {
      // FIX Bug 6: Clear in-flight tracker when done
      if (this._healthCheckInFlight === healthCheckPromise) {
        this._healthCheckInFlight = null;
      }
    }
  }

  /**
   * Internal health check implementation
   * @private
   * @returns {Promise<boolean>}
   */
  async _doHealthCheck() {
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
    } catch {
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
   * FIX Bug 3: Recovery logic for items that were being processed during crash
   */
  async _loadOfflineQueue() {
    const data = await loadJsonFile(this.offlineQueuePath, {
      description: 'offline queue',
      backupCorrupt: true
    });

    if (Array.isArray(data)) {
      // FIX Bug 3: Clean up items that were being processed when crash occurred
      // Items with _processingId indicate they were mid-processing - recover them
      let recoveredCount = 0;
      this.offlineQueue = data.slice(0, this.config.maxOfflineQueueSize).map((item) => {
        if (item._processingId) {
          recoveredCount++;
          // Remove processing markers, item will be re-processed
          const { _processingId, _processingStartedAt, ...cleanItem } = item;
          return cleanItem;
        }
        return item;
      });

      logger.info('[OllamaClient] Loaded offline queue:', {
        total: this.offlineQueue.length,
        recoveredFromCrash: recoveredCount
      });

      // If we recovered items, persist the cleaned queue
      if (recoveredCount > 0) {
        await this._persistOfflineQueue();
      }
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
   * FIX Bug 3: Use processing markers to prevent data loss on crash
   */
  async _processOfflineQueue() {
    if (this.isProcessingOfflineQueue || !this.isHealthy) return;
    if (this.offlineQueue.length === 0) return;

    this.isProcessingOfflineQueue = true;

    try {
      logger.info('[OllamaClient] Processing offline queue:', this.offlineQueue.length);

      // Process in batches
      const batchSize = Math.min(10, this.offlineQueue.length);

      // FIX Bug 3: Generate unique processing ID for this batch
      const processingId = `batch_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      // FIX Bug 3: Mark items as being processed BEFORE starting
      // This allows recovery on crash - marked items can be identified and re-queued
      const batch = this.offlineQueue.slice(0, batchSize).map((request) => ({
        ...request,
        _processingId: processingId,
        _processingStartedAt: Date.now()
      }));

      // FIX Bug 3: Update queue with processing markers and persist BEFORE processing
      // On crash, recovery can identify in-progress items by _processingId
      this.offlineQueue = [...batch, ...this.offlineQueue.slice(batchSize)];
      await this._persistOfflineQueue();

      const results = await Promise.allSettled(
        batch.map((request) => this._processQueuedRequest(request))
      );

      // FIX Bug 3: Track which items to remove by processingId, not index
      const processedIds = new Set();
      const retryQueue = [];

      results.forEach((result, index) => {
        const request = batch[index];
        if (result.status === 'fulfilled') {
          // Success - mark for removal
          processedIds.add(request._processingId + '_' + index);
        } else {
          // Failed - check retry count
          if (request.retryCount < 3) {
            // Remove processing marker and increment retry
            const { _processingId, _processingStartedAt, ...cleanRequest } = request;
            retryQueue.push({
              ...cleanRequest,
              retryCount: (cleanRequest.retryCount || 0) + 1
            });
          }
          // Max retries exceeded - will be removed
          processedIds.add(request._processingId + '_' + index);
        }
      });

      // FIX Bug 3: Filter out processed items by processingId, rebuild queue
      // This is crash-safe because items without _processingId are untouched
      const remainingQueue = this.offlineQueue.filter((item, idx) => {
        if (item._processingId === processingId) {
          // This was in our batch - check if it should be removed
          return !processedIds.has(item._processingId + '_' + idx);
        }
        // Not part of this batch - keep it
        return true;
      });

      // Clean processing markers from any remaining items and add retry items
      this.offlineQueue = [
        ...retryQueue,
        ...remainingQueue.map((item) => {
          if (item._processingId) {
            const { _processingId, _processingStartedAt, ...clean } = item;
            return clean;
          }
          return item;
        })
      ];

      const successful = results.filter((r) => r.status === 'fulfilled').length;
      logger.info('[OllamaClient] Processed offline queue batch', {
        successful,
        failed: results.length - successful,
        requeued: retryQueue.length,
        remaining: this.offlineQueue.length
      });

      // Persist final state
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
        const result = await this.circuitBreaker.execute(() =>
          this._withRetry(
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
          )
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

      // Add to offline queue if service is unhealthy or circuit is open
      if ((!this.isHealthy && isRetryableError(error)) || error.code === 'CIRCUIT_OPEN') {
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
        const result = await this.circuitBreaker.execute(() =>
          this._withRetry(
            async () => {
              const { getOllama } = require('../ollamaUtils');
              const ollama = getOllama();
              return ollama.generate(options);
            },
            { operation: `Generate (${options.model})` }
          )
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

      // Add to offline queue if service is unhealthy or circuit is open (only for non-streaming)
      if (
        ((!this.isHealthy && isRetryableError(error)) || error.code === 'CIRCUIT_OPEN') &&
        !options.stream
      ) {
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

  /**
   * FIX MED #14: Reset circuit breaker state when model configuration changes
   * Should be called when user switches Ollama models to clear stale failure state
   * from the previous model configuration
   */
  resetCircuitBreaker() {
    if (this.circuitBreaker && typeof this.circuitBreaker.reset === 'function') {
      this.circuitBreaker.reset();
      logger.info('[OllamaClient] Circuit breaker reset due to model configuration change');
    }
    // Also reset health state since it may have been affected by old model
    this.isHealthy = true;
    this.consecutiveFailures = 0;
  }

  /**
   * Notify client of model configuration change
   * Resets circuit breaker and triggers health check with new model
   */
  async onModelChanged() {
    this.resetCircuitBreaker();
    // Trigger fresh health check to verify new model works
    await this._performHealthCheck();
    logger.info('[OllamaClient] Model change processed, health check triggered');
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
