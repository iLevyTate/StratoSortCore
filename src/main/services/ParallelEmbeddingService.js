const os = require('os');
const path = require('path');
const { createLogger } = require('../../shared/logger');
const { getInstance: getLlamaService } = require('./LlamaService');
const { getEmbeddingPool } = require('../utils/workerPools');
const { ERROR_CODES } = require('../../shared/errorCodes');
const { AI_DEFAULTS } = require('../../shared/constants');
const { resolveEmbeddingDimension } = require('../../shared/embeddingDimensions');
const { capEmbeddingInput } = require('../utils/embeddingInput');
const { chunkText } = require('../utils/textChunking');

const logger = createLogger('ParallelEmbeddingService');
const { TIMEOUTS } = require('../../shared/performanceConstants');

function isEmbeddingContextOverflow(error) {
  const message = String(
    error?.message || error?.originalError?.message || error?.cause?.message || ''
  ).toLowerCase();
  return (
    message.includes('input is longer than the context size') || message.includes('context size of')
  );
}

function meanPoolVectors(vectors) {
  if (!Array.isArray(vectors) || vectors.length === 0) return [];
  const dim = vectors[0]?.length || 0;
  if (!dim) return [];
  const sums = new Array(dim).fill(0);
  for (const vector of vectors) {
    for (let i = 0; i < dim; i += 1) {
      sums[i] += vector[i] || 0;
    }
  }
  return sums.map((value) => value / vectors.length);
}

/**
 * Semaphore configuration constants
 * FIX: Made configurable to prevent hanging promises and memory bloat
 * Increased timeout to 3 minutes to withstand long-running blocking operations (like large image analysis)
 */
const SEMAPHORE_CONFIG = {
  MAX_QUEUE_SIZE: 100, // Maximum queued requests before rejecting
  QUEUE_TIMEOUT_MS: TIMEOUTS.AI_ANALYSIS_LONG // 180 second timeout to survive blocking operations
};
const MIN_CONCURRENCY = 1;
const MIN_ADAPTIVE_CONCURRENCY = 2;
const MAX_CONCURRENCY = 10;

/**
 * ParallelEmbeddingService
 *
 * Provides controlled concurrent embedding generation to improve analysis performance.
 * Uses a semaphore pattern to limit concurrent API calls and prevent overwhelming
 * the AI engine.
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
      MAX_CONCURRENCY // Hard cap increased from 5 to 10
    );
    // Upper bound sourced from system capability recommendations.
    // Adaptive logic must never scale above this once known.
    this.maxRecommendedConcurrency = MAX_CONCURRENCY;

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

    // Align initial limit with system recommendation (async).
    this._syncRecommendedConcurrency('startup').catch(() => {});

    // Initial calculation often happens before LlamaService has detected GPU
    this._llamaInitHandler = null;
    this._llamaServiceRef = null;
    try {
      const llamaService = getLlamaService();
      if (llamaService && typeof llamaService.on === 'function') {
        this._llamaInitHandler = () => {
          const newLimit = Math.min(this._calculateOptimalConcurrency(), MAX_CONCURRENCY);
          if (newLimit !== this.concurrencyLimit) {
            this.setConcurrencyLimit(newLimit);
            logger.info('[ParallelEmbeddingService] Concurrency updated after LlamaService init', {
              limit: this.concurrencyLimit
            });
          }
          this._syncRecommendedConcurrency('llama-init').catch(() => {});
        };
        this._llamaServiceRef = llamaService;
        llamaService.on('initialized', this._llamaInitHandler);
      }
    } catch {
      // Ignore errors during listener attachment
    }
  }

  async _syncRecommendedConcurrency(source) {
    try {
      const { getRecommendedConcurrency } = require('./PerformanceService');
      const recs = await getRecommendedConcurrency();
      if (!recs?.maxConcurrent) return;
      this.maxRecommendedConcurrency = Math.max(
        MIN_CONCURRENCY,
        Math.min(recs.maxConcurrent, MAX_CONCURRENCY)
      );
      const capped = Math.max(
        MIN_CONCURRENCY,
        Math.min(this.concurrencyLimit, this.maxRecommendedConcurrency, MAX_CONCURRENCY)
      );
      if (capped !== this.concurrencyLimit) {
        this.setConcurrencyLimit(capped);
        logger.info('[ParallelEmbeddingService] Concurrency capped by system recommendation', {
          limit: this.concurrencyLimit,
          recommended: recs.maxConcurrent,
          reason: recs.reason,
          source
        });
      }
    } catch (error) {
      logger.debug('[ParallelEmbeddingService] Failed to sync system concurrency recommendation', {
        error: error?.message,
        source
      });
    }
  }

  /**
   * Calculate optimal concurrency based on system resources and GPU capabilities.
   * Embeddings are lightweight on GPU, so GPU systems get a concurrency boost.
   * @returns {number} Recommended concurrency level
   */
  _calculateOptimalConcurrency() {
    const cpuCores = os.cpus().length;
    const freeMem = os.freemem();
    const totalMem = os.totalmem();
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

    // Boost concurrency for GPU systems — embeddings are lightweight on GPU.
    // Query PerformanceService synchronously from cached capabilities if available.
    try {
      const llamaService = getLlamaService();
      const health = llamaService?.getHealthStatus?.();
      const gpuBackend = health?.gpuBackend;

      if (gpuBackend && gpuBackend !== 'cpu' && gpuBackend !== false) {
        // GPU is active — boost embedding concurrency
        // Embeddings use far less VRAM than text/vision inference
        const prevConcurrency = concurrency;
        concurrency = Math.max(concurrency, 6);
        logger.info('[ParallelEmbeddingService] GPU-boosted concurrency', {
          gpuBackend,
          cpuBased: prevConcurrency,
          gpuBoosted: concurrency
        });
      }
    } catch {
      // LlamaService not yet available — use CPU-based calculation
    }

    // Cap at reasonable maximum
    return Math.min(concurrency, MAX_CONCURRENCY);
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
    // Previous pattern: if (active < limit) { active++ } - two concurrent calls could both pass
    // New pattern: active++; if (active > limit) { active--; queue } - atomic acquisition
    this.activeRequests++;

    if (this.activeRequests <= this.concurrencyLimit) {
      this.stats.peakConcurrency = Math.max(this.stats.peakConcurrency, this.activeRequests);
      return Promise.resolve();
    }

    // We've exceeded the limit, decrement and queue
    this.activeRequests--;

    if (this.waitQueue.length >= SEMAPHORE_CONFIG.MAX_QUEUE_SIZE) {
      const error = new Error('ParallelEmbeddingService: Request queue full');
      error.code = 'QUEUE_FULL';
      logger.warn('[ParallelEmbeddingService] Queue full, rejecting request', {
        queueSize: this.waitQueue.length,
        maxQueueSize: SEMAPHORE_CONFIG.MAX_QUEUE_SIZE
      });
      throw error;
    }

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
   * FIX: Respects concurrencyLimit when releasing, preventing over-limit execution
   * if the limit was dynamically reduced.
   */
  _releaseSlot() {
    if (this.activeRequests <= 0) {
      logger.warn(
        '[ParallelEmbeddingService] _releaseSlot() called without matching acquire, ignoring'
      );
      return;
    }

    this.activeRequests--;

    // Try to wake up next waiting request if we have capacity
    if (this.waitQueue.length > 0 && this.activeRequests < this.concurrencyLimit) {
      const next = this.waitQueue.shift();
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
      // Adjust concurrency after each request
      this._adjustConcurrency();
    }
  }

  /**
   * Internal embedding with retry logic using centralized retry utility
   * @param {string} text - Text to embed
   * @returns {Promise<{vector: number[], model: string}>}
   */
  async _embedTextWithRetry(text) {
    const originalText = String(text || '');
    const llamaService = getLlamaService();

    const config = await llamaService.getConfig();
    const modelName = config?.embeddingModel || AI_DEFAULTS.EMBEDDING.MODEL;

    // Health check enhancement: fail fast when service is known unhealthy.
    const health = llamaService.getHealthStatus?.();
    if (health && health.initialized === false) {
      const error = new Error('Llama service is unhealthy (not initialized)');
      error.code = 'SERVICE_UNAVAILABLE';
      throw error;
    }

    // Query the actual embedding context size from the loaded model when available.
    // This adapts to any model (including custom ones not in the registry).
    const runtimeContextSize =
      Number.isFinite(config?.embeddingContextSize) && config.embeddingContextSize > 0
        ? config.embeddingContextSize
        : undefined;

    const primaryCapOptions = { modelName };
    if (runtimeContextSize) {
      primaryCapOptions.maxTokens = runtimeContextSize;
    }

    const capPlans = [];
    const primaryCap = capEmbeddingInput(originalText, primaryCapOptions);
    capPlans.push({
      ...primaryCap,
      reason: 'default_cap'
    });

    const strictCap = capEmbeddingInput(originalText, {
      modelName,
      maxTokens: Math.max(64, Math.floor(primaryCap.maxTokens * 0.7)),
      charsPerToken: 3
    });
    capPlans.push({
      ...strictCap,
      reason: 'strict_cap'
    });

    const ultraStrictCap = capEmbeddingInput(originalText, {
      modelName,
      maxTokens: Math.max(48, Math.floor(primaryCap.maxTokens * 0.55)),
      charsPerToken: 2.5
    });
    capPlans.push({
      ...ultraStrictCap,
      reason: 'ultra_strict_cap'
    });

    const uniquePlans = [];
    const seenTexts = new Set();
    for (const plan of capPlans) {
      const key = `${plan.text.length}:${plan.text}`;
      if (seenTexts.has(key)) continue;
      seenTexts.add(key);
      uniquePlans.push(plan);
    }

    let lastOverflowError = null;
    try {
      for (const plan of uniquePlans) {
        try {
          return await this._embedWithProviders(plan.text, {
            llamaService,
            modelName,
            config
          });
        } catch (error) {
          if (!isEmbeddingContextOverflow(error)) {
            throw error;
          }
          lastOverflowError = error;
          logger.warn(
            '[ParallelEmbeddingService] Embedding overflow, retrying with stricter input cap',
            {
              reason: plan.reason,
              originalLength: originalText.length,
              attemptedLength: plan.text.length,
              estimatedTokens: plan.estimatedTokens,
              maxTokens: plan.maxTokens
            }
          );
        }
      }

      // Final fallback: chunk and mean-pool. This ensures oversized/token-dense
      // inputs remain processable rather than being dropped.
      const pooled = await this._embedWithChunkPooling(
        originalText,
        modelName,
        llamaService,
        config,
        ultraStrictCap.maxChars
      );
      if (pooled && Array.isArray(pooled.vector) && pooled.vector.length > 0) {
        logger.warn('[ParallelEmbeddingService] Recovered embedding via chunk pooling', {
          originalLength: originalText.length,
          pooledDim: pooled.vector.length
        });
        return pooled;
      }

      if (lastOverflowError) {
        throw lastOverflowError;
      }
      throw new Error('Embedding overflow recovery failed');
    } catch (error) {
      logger.error('[ParallelEmbeddingService] Embedding failed via AI service', {
        error: error.message,
        retryable: this._isRetryableError(error)
      });

      const embeddingError = new Error(`Embedding failed: ${error.message}`);
      embeddingError.code = ERROR_CODES.EMBEDDING_GENERATION_FAILED;
      embeddingError.originalError = error;
      embeddingError.retryable = this._isRetryableError(error);
      throw embeddingError;
    }
  }

  async _embedWithProviders(textToEmbed, { llamaService, modelName, config }) {
    const pool = getEmbeddingPool();
    if (pool) {
      try {
        const modelPath =
          config?.modelsPath && config?.embeddingModel
            ? path.join(config.modelsPath, config.embeddingModel)
            : null;
        if (modelPath) {
          const result = await pool.run({
            text: textToEmbed,
            modelPath,
            gpuLayers: config?.gpuLayers ?? 'auto'
          });
          if (result?.embedding) {
            const expectedDim = resolveEmbeddingDimension(modelName);
            if (result.embedding.length !== expectedDim) {
              logger.warn(
                '[ParallelEmbeddingService] Worker returned embedding with wrong dimension',
                {
                  actual: result.embedding.length,
                  expected: expectedDim,
                  model: modelName
                }
              );
              throw new Error(
                `Dimension mismatch: got ${result.embedding.length}, expected ${expectedDim}`
              );
            }
            return {
              success: true,
              vector: result.embedding,
              model: modelName
            };
          }
        }
      } catch (workerError) {
        // can immediately try a stricter input cap instead of falling back to
        // the main process (which will likely fail with the same error).
        if (isEmbeddingContextOverflow(workerError)) {
          throw workerError;
        }
        logger.warn('[ParallelEmbeddingService] Embedding worker failed, falling back', {
          error: workerError.message
        });
      }
    }

    // Pass retry configuration to LlamaService
    // Note: LlamaService handles retries internally via LlamaResilience, but we pass options if supported
    const options = {
      // maxRetries: this.maxRetries, // LlamaService uses internal config for retries
      // initialDelay: this.initialRetryDelayMs,
      // maxDelay: this.maxRetryDelayMs
    };

    const result = await llamaService.generateEmbedding(textToEmbed, options);

    // Normalize shape to { vector, model, success } expected by callers
    if (result && result.embedding) {
      // LlamaService.generateEmbedding() returns {embedding, model}.
      // Fall back to config lookup if model is missing for any reason.
      const resolvedModelName =
        result.model ||
        (await llamaService.getConfig())?.embeddingModel ||
        AI_DEFAULTS.EMBEDDING.MODEL;

      // Dimension validation — warn only for the LlamaService path.
      // Unlike the worker pool (which could load a different model), LlamaService
      // generated this embedding from the actual loaded model, so the vector is
      // valid. The resolver's expectation may be stale for custom models.
      const expectedDim = resolveEmbeddingDimension(resolvedModelName);
      if (expectedDim > 0 && result.embedding.length !== expectedDim) {
        logger.warn(
          '[ParallelEmbeddingService] LlamaService returned embedding with unexpected dimension',
          { actual: result.embedding.length, expected: expectedDim, model: resolvedModelName }
        );
      }

      const normalized = {
        success: true,
        vector: result.embedding,
        model: resolvedModelName
      };
      return normalized;
    }

    // Propagate structured failure for upstream handling
    const err = new Error(result?.error || 'Embedding failed');
    err.code = ERROR_CODES.EMBEDDING_GENERATION_FAILED;
    logger.warn('[ParallelEmbeddingService] Embedding failed', {
      model: result?.model,
      error: err.message
    });
    throw err;
  }

  async _embedWithChunkPooling(originalText, modelName, llamaService, config, maxCharsHint) {
    try {
      const baseChunkSize = Number.isFinite(maxCharsHint) && maxCharsHint > 0 ? maxCharsHint : 900;
      const chunkSize = Math.max(200, Math.floor(baseChunkSize * 0.35));
      const overlap = Math.max(60, Math.floor(chunkSize * 0.12));
      const chunks = chunkText(originalText, {
        chunkSize,
        overlap,
        maxChunks: 5
      });

      if (chunks.length <= 1) return null;

      const vectors = [];
      for (const chunk of chunks) {
        const safeChunk = capEmbeddingInput(chunk.text, {
          modelName,
          maxTokens: Math.max(48, Math.floor((baseChunkSize / 4) * 0.6)),
          charsPerToken: 2.5
        }).text;
        if (!safeChunk) continue;
        try {
          const chunkResult = await this._embedWithProviders(safeChunk, {
            llamaService,
            modelName,
            config
          });
          if (chunkResult?.vector?.length) {
            vectors.push(chunkResult.vector);
          }
        } catch (error) {
          if (!isEmbeddingContextOverflow(error)) {
            throw error;
          }
        }
      }

      if (vectors.length === 0) return null;
      return {
        success: true,
        vector: meanPoolVectors(vectors),
        model: modelName
      };
    } catch (error) {
      logger.warn('[ParallelEmbeddingService] Chunk pooling fallback failed', {
        error: error.message
      });
      return null;
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

    // Pin embedding model to prevent eviction during batch processing.
    // NOTE: We do NOT use acquireModelLoadLock() here because each item calls
    // generateEmbedding() which internally calls _ensureModelLoaded(), and that
    // acquires the same non-reentrant load lock — causing a deadlock.
    // Instead, pinModel() increments a ref counter that the memory manager
    // respects during LRU eviction, keeping the model resident without blocking.
    const llamaService = getLlamaService();
    llamaService.pinModel?.('embedding');
    try {
      // Capture model at batch start to prevent dimension mismatches.
      // If the model changes during a batch, different items would have different
      // dimensions, causing vector store corruption.
      const batchCfg = await llamaService.getConfig();
      const batchModel = batchCfg.embeddingModel || AI_DEFAULTS.EMBEDDING.MODEL;

      const startTime = Date.now();
      const results = new Array(items.length);
      const errors = [];
      let completedCount = 0;
      let modelChangedDuringBatch = false;

      logger.info('[ParallelEmbeddingService] Starting batch embedding', {
        itemCount: items.length,
        concurrencyLimit: this.concurrencyLimit,
        model: batchModel
      });

      // Process all items with semaphore-controlled concurrency
      const processItem = async (item, index) => {
        try {
          // Check model before each item to prevent mixed-dimension vectors
          const currentCfg = await llamaService.getConfig();
          const currentModel = currentCfg.embeddingModel || AI_DEFAULTS.EMBEDDING.MODEL;
          if (currentModel !== batchModel) {
            modelChangedDuringBatch = true;
            const errorMsg = `Model changed during batch operation (started with ${batchModel}, now ${currentModel}). Aborting batch to prevent vector dimension mismatch.`;
            logger.error('[ParallelEmbeddingService] ' + errorMsg);
            throw new Error(errorMsg);
          }

          const { vector, model } = await this.embedText(item.text);

          // Also tolerate the default fallback name (AI_DEFAULTS.EMBEDDING.MODEL) which
          // may be returned when the actual model name can't be resolved from LlamaService.
          if (
            model !== batchModel &&
            model !== 'fallback' &&
            model !== AI_DEFAULTS.EMBEDDING.MODEL
          ) {
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
            batchModel,
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

      // Process items in chunks to avoid overflowing the semaphore queue
      // Use a chunk size slightly less than MAX_QUEUE_SIZE to be safe
      const CHUNK_SIZE = Math.max(1, Math.floor(SEMAPHORE_CONFIG.MAX_QUEUE_SIZE * 0.8));

      if (stopOnError) {
        for (let index = 0; index < items.length; index++) {
          await processItem(items[index], index);
        }
      } else {
        // Process in chunks
        for (let i = 0; i < items.length; i += CHUNK_SIZE) {
          const chunk = items.slice(i, i + CHUNK_SIZE);
          const chunkPromises = chunk.map((item, offset) => processItem(item, i + offset));
          await Promise.allSettled(chunkPromises);
        }
      }

      const duration = Date.now() - startTime;
      const successCount = items.length - errors.length;

      logger.info('[ParallelEmbeddingService] Batch embedding complete', {
        total: items.length,
        successful: successCount,
        failed: errors.length,
        duration: `${duration}ms`,
        avgPerItem: `${Math.round(duration / items.length)}ms`,
        throughput:
          duration > 0 ? `${(items.length / (duration / 1000)).toFixed(2)} items/sec` : 'instant',
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
          throughput: duration > 0 ? items.length / (duration / 1000) : 0,
          model: batchModel,
          modelChangedDuringBatch
        }
      };
    } finally {
      llamaService.unpinModel?.('embedding');
    }
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
    const recommendedCap =
      Number.isFinite(this.maxRecommendedConcurrency) && this.maxRecommendedConcurrency > 0
        ? this.maxRecommendedConcurrency
        : MAX_CONCURRENCY;
    const newLimit = Math.max(MIN_CONCURRENCY, Math.min(limit, recommendedCap, MAX_CONCURRENCY));

    if (newLimit !== this.concurrencyLimit) {
      logger.info('[ParallelEmbeddingService] Concurrency limit changed', {
        previous: this.concurrencyLimit,
        new: newLimit
      });
      this.concurrencyLimit = newLimit;

      // If limit increased, try to wake up queued requests
      while (this.waitQueue.length > 0 && this.activeRequests < this.concurrencyLimit) {
        const next = this.waitQueue.shift();
        if (next.timeoutId) {
          clearTimeout(next.timeoutId);
        }
        this.activeRequests++;
        this.stats.peakConcurrency = Math.max(this.stats.peakConcurrency, this.activeRequests);
        next.resolve();
      }
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

    if (this._llamaServiceRef && this._llamaInitHandler) {
      try {
        this._llamaServiceRef.removeListener('initialized', this._llamaInitHandler);
      } catch {
        // Ignore -- service may already be destroyed
      }
      this._llamaServiceRef = null;
      this._llamaInitHandler = null;
    }

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
   * Check if Llama service is healthy
   * @returns {Promise<boolean>}
   */
  async isServiceHealthy() {
    try {
      const llamaService = getLlamaService();
      const status = await llamaService.testConnection();
      return status && status.success;
    } catch (error) {
      logger.warn('[ParallelEmbeddingService] Health check failed:', error.message);
      return false;
    }
  }

  /**
   * Wait for AI service to become available
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

    logger.warn('[ParallelEmbeddingService] Timeout waiting for Llama service');
    return false;
  }

  /**
   * Dynamically adjust concurrency based on error rate
   */
  _adjustConcurrency() {
    // wake queued requests that will immediately fail.
    if (this._isShuttingDown) return;

    const { successfulRequests, failedRequests } = this.stats;
    const totalProcessed = successfulRequests + failedRequests;

    if (totalProcessed < 10) return; // Need enough data

    const errorRate = failedRequests / totalProcessed;

    if (errorRate > 0.2 && this.concurrencyLimit > MIN_ADAPTIVE_CONCURRENCY) {
      // High error rate - reduce concurrency
      const newLimit = Math.max(MIN_ADAPTIVE_CONCURRENCY, Math.floor(this.concurrencyLimit * 0.7));
      if (newLimit !== this.concurrencyLimit) {
        logger.info('[ParallelEmbeddingService] Reducing concurrency due to high error rate', {
          errorRate: `${(errorRate * 100).toFixed(1)}%`,
          previousLimit: this.concurrencyLimit,
          newLimit
        });
        this.setConcurrencyLimit(newLimit);
      }
    } else if (
      errorRate < 0.05 &&
      this.concurrencyLimit < this.maxRecommendedConcurrency &&
      totalProcessed > 50
    ) {
      // Low error rate - can increase concurrency
      const newLimit = Math.min(
        this.maxRecommendedConcurrency,
        Math.ceil(this.concurrencyLimit * 1.2)
      );
      if (newLimit !== this.concurrencyLimit) {
        logger.debug('[ParallelEmbeddingService] Increasing concurrency due to low error rate', {
          errorRate: `${(errorRate * 100).toFixed(1)}%`,
          previousLimit: this.concurrencyLimit,
          newLimit,
          recommendationCap: this.maxRecommendedConcurrency
        });
        this.setConcurrencyLimit(newLimit);
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
