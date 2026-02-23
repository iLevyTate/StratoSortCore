const crypto = require('crypto');
const { getInstance: getLlamaService } = require('./LlamaService');
const { createLogger } = require('../../shared/logger');

const logger = createLogger('FolderMatchingService');
const EmbeddingCache = require('./EmbeddingCache');
const { getInstance: getParallelEmbeddingService } = require('./ParallelEmbeddingService');
const { get: getConfig } = require('../../shared/config/index');
const { enrichFolderTextForEmbedding } = require('../analysis/semanticExtensionMap');
const { validateEmbeddingDimensions } = require('../../shared/vectorMath');
const { capEmbeddingInput } = require('../utils/embeddingInput');
const { chunkText } = require('../utils/textChunking');
const { AI_DEFAULTS } = require('../../shared/constants');

const {
  resolveEmbeddingDimension,
  isKnownEmbeddingModel
} = require('../../shared/embeddingDimensions');

function meanPoolVectors(vectors, expectedDim) {
  if (!Array.isArray(vectors) || vectors.length === 0) return [];
  const dim =
    typeof expectedDim === 'number' && expectedDim > 0 ? expectedDim : vectors[0].length || 0;
  if (!dim) return [];
  const sums = new Array(dim).fill(0);
  for (const vector of vectors) {
    for (let i = 0; i < dim; i += 1) {
      sums[i] += vector[i] || 0;
    }
  }
  return sums.map((value) => value / vectors.length);
}

const getEmbeddingDimensionForModel = (modelName) =>
  resolveEmbeddingDimension(modelName, {
    defaultDimension: getConfig('ANALYSIS.embeddingDimension', 768)
  });

function isEmbeddingContextOverflow(error) {
  const message = String(
    error?.message || error?.originalError?.message || error?.cause?.message || ''
  ).toLowerCase();
  return (
    message.includes('input is longer than the context size') || message.includes('context size of')
  );
}

/**
 * FolderMatchingService - Handles file-to-folder matching using embeddings
 *
 * This service uses vector embeddings to match files with appropriate folders
 * based on semantic similarity. It supports dependency injection for:
 * - vectorDbService: Vector database for storing/querying embeddings
 * - embeddingCache: Cache for embedding results (optional, created if not provided)
 * - parallelEmbeddingService: Service for parallel embedding generation (optional)
 *
 * @example
 * // Using dependency injection (recommended)
 * const folderMatcher = new FolderMatchingService(vectorDb, {
 *   embeddingCache: myCache,
 *   parallelEmbeddingService: myParallelService
 * });
 *
 * // Using with ServiceContainer
 * container.registerSingleton(ServiceIds.FOLDER_MATCHING, (c) => {
 *   return new FolderMatchingService(c.resolve(ServiceIds.ORAMA_VECTOR));
 * });
 */
class FolderMatchingService {
  /**
   * Create a FolderMatchingService instance
   *
   * @param {Object} vectorDbService - Vector DB service for vector storage (required)
   * @param {Object} options - Configuration options
   * @param {Object} [options.embeddingCache] - Pre-configured embedding cache (optional)
   * @param {Object} [options.parallelEmbeddingService] - Pre-configured parallel embedding service (optional)
   * @param {number} [options.concurrencyLimit] - Override concurrency limit for parallel embeddings (optional)
   * @param {number} [options.maxRetries] - Override max retries for failed operations (optional)
   * @param {number} [options.maxCacheSize] - Maximum cache size
   * @param {number} [options.cacheTtl] - Cache TTL in milliseconds
   */
  constructor(vectorDbService, options = {}) {
    // Support both old signature (vectorDbService, cacheOptions) and new signature (vectorDbService, { embeddingCache, ... })
    const cacheOptions = options.maxCacheSize || options.cacheTtl ? options : {};

    this.vectorDbService = vectorDbService;
    this.modelName = '';
    this._upsertedFolderIds = new Set();
    this._maxUpsertedFolderIds = 10000;

    // Initialize embedding cache - use injected or create new
    this.embeddingCache = options.embeddingCache || new EmbeddingCache(cacheOptions);

    // Priority: options.concurrencyLimit > config value > default (5)
    const concurrencyLimit = options.concurrencyLimit ?? getConfig('ANALYSIS.maxConcurrency', 5);
    const maxRetries = options.maxRetries ?? getConfig('ANALYSIS.retryAttempts', 3);

    // Otherwise, access the live singleton via getter to avoid holding a stale
    // reference if the service is reset/recreated (same pattern as BatchAnalysisService).
    this._injectedEmbeddingService = options.parallelEmbeddingService || null;
    if (!this._injectedEmbeddingService) {
      // Ensure singleton is created with initial config
      getParallelEmbeddingService({ concurrencyLimit, maxRetries });
    }

    // Store limits for reference/debugging
    this._concurrencyLimit = concurrencyLimit;
    this._maxRetries = maxRetries;

    // This prevents stale embeddings with wrong dimensions after model switch
    this._modelChangeUnsubscribe = null;
    this._subscribeToModelChanges();

    this._invalidationUnsubscribe = null;
    this._subscribeToInvalidationBus();
  }

  /**
   * Get the parallel embedding service (injected or live singleton).
   * @returns {Object} ParallelEmbeddingService instance
   * @private
   */
  _getEmbeddingService() {
    return this._injectedEmbeddingService || getParallelEmbeddingService();
  }

  /**
   * Subscribe to the cache invalidation bus
   * @private
   */
  _subscribeToInvalidationBus() {
    try {
      const bus = require('../../shared/cacheInvalidation').getInstance();
      this._invalidationUnsubscribe = bus.subscribe('FolderMatchingService', {
        onInvalidate: (event) => {
          if (event.type === 'full-invalidate') {
            this.embeddingCache.clear();
            this._upsertedFolderIds.clear();
            logger.info('[FolderMatchingService] Cache cleared via invalidation bus');
          }
        },
        onPathChange: (_oldPath, _newPath) => {
          this._upsertedFolderIds.clear();
        },
        onDeletion: (_filePath) => {
          this._upsertedFolderIds.clear();
        }
      });
      logger.debug('[FolderMatchingService] Subscribed to cache invalidation bus');
    } catch (error) {
      logger.warn(
        '[FolderMatchingService] Failed to subscribe to invalidation bus:',
        error.message
      );
    }
  }

  /**
   * Subscribe to LlamaService model change events
   * Invalidates embedding cache when embedding model changes
   * @private
   */
  _subscribeToModelChanges() {
    try {
      const llamaService = getLlamaService();
      if (llamaService && typeof llamaService.onModelChange === 'function') {
        this._modelChangeUnsubscribe = llamaService.onModelChange(
          async ({ type, previousModel, newModel }) => {
            if (type === 'embedding') {
              if (this.embeddingCache) {
                const wasInvalidated = this.embeddingCache.invalidateOnModelChange(
                  newModel,
                  previousModel
                );
                if (wasInvalidated) {
                  logger.info(
                    '[FolderMatchingService] Embedding cache invalidated due to model change',
                    {
                      from: previousModel,
                      to: newModel
                    }
                  );
                }
              }

              // Previously, only the in-memory cache was cleared, but the vector DB still contained
              // vectors with the old dimension. This caused query failures or incorrect similarity
              // calculations when new embeddings (with different dimensions) were added.
              if (this.vectorDbService) {
                try {
                  logger.warn(
                    '[FolderMatchingService] Handling vector DB reset due to embedding model change',
                    {
                      from: previousModel,
                      to: newModel
                    }
                  );
                  if (typeof this.vectorDbService.handleEmbeddingModelChange === 'function') {
                    await this.vectorDbService.handleEmbeddingModelChange({
                      previousModel,
                      newModel,
                      source: 'FolderMatchingService'
                    });
                  } else {
                    await this.vectorDbService.resetAll();
                  }
                  logger.info(
                    '[FolderMatchingService] Vector DB collections reset after model change'
                  );
                } catch (vectorDbError) {
                  logger.error(
                    '[FolderMatchingService] Failed to reset vector DB collections:',
                    vectorDbError.message
                  );
                  // Continue - the cache is still cleared, and users can manually rebuild
                }
              }
            }
          }
        );
        logger.debug('[FolderMatchingService] Subscribed to embedding model changes');
      }
    } catch (error) {
      // Non-fatal - service may not be available yet
      logger.debug('[FolderMatchingService] Could not subscribe to model changes:', error.message);
    }
  }

  /**
   * Initialize the service and its resources
   * Should be called after construction and successful service setup
   * FIX: Made thread-safe with initialization promise to prevent race conditions
   * @returns {Promise<void>} Resolves when initialization is complete
   */
  initialize() {
    if (this._initPromise) {
      return this._initPromise;
    }

    // Already initialized
    if (this.embeddingCache?.initialized) {
      return Promise.resolve();
    }

    // Nothing to initialize
    if (!this.embeddingCache) {
      return Promise.resolve();
    }

    // Create promise IMMEDIATELY and SYNCHRONOUSLY before any async work
    // This ensures concurrent calls see the promise before we start initialization
    this._initializing = true;

    // Use explicit resolve/reject handlers for proper error propagation
    let resolveInit;
    let rejectInit;
    this._initPromise = new Promise((resolve, reject) => {
      resolveInit = resolve;
      rejectInit = reject;
    });

    // Schedule the actual initialization work asynchronously
    // The promise is already stored, so concurrent calls will await it
    Promise.resolve()
      .then(() => {
        // Double-check in case of race condition edge case
        if (!this.embeddingCache.initialized) {
          this.embeddingCache.initialize();
        }
        logger.info('[FolderMatchingService] Initialized successfully');
        resolveInit();
      })
      .catch((error) => {
        logger.error('[FolderMatchingService] Initialization failed:', error.message);
        // Clear _initPromise on failure so future calls can retry
        this._initPromise = null;
        rejectInit(error);
      })
      .finally(() => {
        this._initializing = false;
      });

    return this._initPromise;
  }

  /**
   * Track a folder ID as upserted, with bounded size to prevent memory leaks.
   * When the Set exceeds the maximum size, clears it entirely since the purpose
   * is deduplication within a session, and a reset just means a few redundant upserts.
   * @param {string} folderId - The folder ID to track
   * @private
   */
  _trackUpsertedFolder(folderId) {
    if (this._upsertedFolderIds.size >= this._maxUpsertedFolderIds) {
      logger.info('[FolderMatchingService] Clearing upserted folder ID cache (reached max size)', {
        maxSize: this._maxUpsertedFolderIds
      });
      this._upsertedFolderIds.clear();
    }
    this._upsertedFolderIds.add(folderId);
  }

  async embedText(text) {
    const startTime = Date.now();

    try {
      const llamaService = getLlamaService();
      const cfg = await llamaService.getConfig();
      const model = cfg.embeddingModel || AI_DEFAULTS.EMBEDDING.MODEL;
      const originalText = String(text || '');
      const capOptions = { modelName: model };
      if (Number.isFinite(cfg.embeddingContextSize) && cfg.embeddingContextSize > 0) {
        capOptions.maxTokens = cfg.embeddingContextSize;
      }
      const capped = capEmbeddingInput(originalText, capOptions);
      let embeddingInput = capped.text;

      if (capped.wasTruncated) {
        logger.warn('[FolderMatchingService] Embedding input truncated to token limit', {
          model,
          originalLength: String(text || '').length,
          truncatedLength: embeddingInput.length,
          estimatedTokens: capped.estimatedTokens,
          maxTokens: capped.maxTokens
        });
      }

      // Check cache first
      const cachedResult = this.embeddingCache.get(embeddingInput, model);
      if (cachedResult) {
        const duration = Date.now() - startTime;
        logger.debug(`[FolderMatchingService] Embedding retrieved in ${duration}ms (cache: HIT)`);
        return cachedResult;
      }

      if (capped.wasTruncated) {
        const pooledResult = await this._embedWithChunkPooling(
          originalText,
          model,
          capped.maxChars
        );
        if (pooledResult && pooledResult.vector?.length) {
          this.embeddingCache.set(embeddingInput, pooledResult.model, pooledResult.vector);
          const duration = Date.now() - startTime;
          logger.debug(
            `[FolderMatchingService] Pooled embedding generated in ${duration}ms (chunked)`
          );
          return pooledResult;
        }
      }

      // Cache miss - generate embedding via API
      // Use LlamaService.generateEmbedding
      let response;
      try {
        response = await llamaService.generateEmbedding(embeddingInput || '');
      } catch (embedError) {
        // Some token-dense inputs (CSV-like content, symbols-heavy OCR text) can exceed
        // context even when character-capped. Retry once with stricter truncation.
        if (!isEmbeddingContextOverflow(embedError)) {
          throw embedError;
        }

        const retryCap = capEmbeddingInput(originalText, {
          maxTokens: Math.max(64, Math.floor(capped.maxTokens * 0.7)),
          charsPerToken: 3,
          modelName: model
        });
        const retryInput = retryCap.text;

        if (!retryInput || retryInput === embeddingInput) {
          throw embedError;
        }

        logger.warn(
          '[FolderMatchingService] Retrying embedding with stricter truncation after context overflow',
          {
            model,
            originalLength: originalText.length,
            firstAttemptLength: embeddingInput.length,
            retryLength: retryInput.length,
            retryEstimatedTokens: retryCap.estimatedTokens
          }
        );

        const cachedRetry = this.embeddingCache.get(retryInput, model);
        if (cachedRetry) {
          const duration = Date.now() - startTime;
          logger.debug(
            `[FolderMatchingService] Embedding retrieved in ${duration}ms (cache: HIT on retry)`
          );
          return cachedRetry;
        }

        response = await llamaService.generateEmbedding(retryInput);
        embeddingInput = retryInput;
      }

      // generateEmbedding returns { embedding: number[] }
      const vector = response?.embedding;

      if (!Array.isArray(vector) || vector.length === 0) {
        const emptyError = new Error(
          `Embedding response returned empty vector for model "${model}"`
        );
        emptyError.code = 'EMBEDDING_FAILED';
        throw emptyError;
      }
      const expectedDim = getEmbeddingDimensionForModel(model);
      const actualDim = vector.length;

      // Only normalize dimensions when model is in our known lookup table
      // (meaning we're confident about the expected dimension).
      // If the expected dimension came from the fallback default, trust the
      // actual model output to avoid silently destroying vector data.
      const modelIsKnown = isKnownEmbeddingModel(model);

      let adjustedVector = vector;
      if (actualDim !== expectedDim && actualDim > 0) {
        if (modelIsKnown) {
          logger.warn('[FolderMatchingService] Embedding dimension mismatch for known model', {
            model,
            expected: expectedDim,
            actual: actualDim,
            action: actualDim < expectedDim ? 'padding' : 'truncating'
          });
          if (actualDim < expectedDim) {
            adjustedVector = adjustedVector.concat(new Array(expectedDim - actualDim).fill(0));
          } else if (actualDim > expectedDim) {
            adjustedVector = adjustedVector.slice(0, expectedDim);
          }
        } else {
          logger.info('[FolderMatchingService] Unknown model dimension, using actual', {
            model,
            lookupDefault: expectedDim,
            actual: actualDim
          });
          // Trust the actual dimension from the model response
        }
      }

      const result = { vector: adjustedVector, model };

      // Store in cache for future use
      this.embeddingCache.set(embeddingInput, model, adjustedVector);

      const duration = Date.now() - startTime;
      logger.debug(`[FolderMatchingService] Embedding generated in ${duration}ms (cache: MISS)`);

      return result;
    } catch (error) {
      logger.error('[FolderMatchingService] Failed to generate embedding:', error);
      // Zero vectors are useless for semantic search and pollute the database
      // Callers should handle the error and skip this item rather than storing garbage
      const errorMessage = error.message || 'Unknown embedding error';
      const embeddingError = new Error(`Embedding generation failed: ${errorMessage}`);
      embeddingError.code = 'EMBEDDING_FAILED';
      embeddingError.originalError = error;
      throw embeddingError;
    }
  }

  async _embedWithChunkPooling(text, model, chunkSize) {
    try {
      const overlap = Math.max(50, Math.floor(chunkSize * 0.1));
      const chunks = chunkText(text || '', {
        chunkSize,
        overlap,
        maxChunks: 3
      });
      if (chunks.length <= 1) return null;

      const items = chunks.map((chunk, index) => ({
        id: `chunk-${index}`,
        text: chunk.text
      }));
      const batch = await this._getEmbeddingService().batchEmbedTexts(items, {
        stopOnError: false
      });
      const vectors = batch.results
        .filter((result) => result?.success && Array.isArray(result.vector) && result.vector.length)
        .map((result) => ({
          vector: result.vector,
          model: result.model
        }));
      if (vectors.length === 0) return null;

      const pooled = meanPoolVectors(
        vectors.map((entry) => entry.vector),
        getEmbeddingDimensionForModel(model)
      );
      const pooledModel = vectors[0].model || model;
      return { vector: pooled, model: pooledModel };
    } catch (error) {
      logger.warn('[FolderMatchingService] Chunk pooling failed, falling back to truncation', {
        error: error.message
      });
      return null;
    }
  }

  /**
   * Generate a unique ID for a folder based on its properties
   * Note: Using SHA256 instead of MD5 for better collision resistance
   */
  generateFolderId(folder) {
    const uniqueString = `${folder.name}|${folder.path || ''}|${folder.description || ''}`;
    return `folder:${crypto.createHash('sha256').update(uniqueString).digest('hex').substring(0, 32)}`;
  }

  async upsertFolderEmbedding(folder) {
    try {
      if (!this.vectorDbService) {
        throw new Error('Vector DB service not available');
      }

      await this.vectorDbService.initialize();

      // Enrich folder text with semantic context for better file type matching
      // e.g., "3D Prints - Models for my Ender 3" becomes enriched with "stl obj 3mf gcode"
      const folderText = enrichFolderTextForEmbedding(folder.name, folder.description);

      const { vector, model } = await this.embedText(folderText);
      const folderId = folder.id || this.generateFolderId(folder);
      if (this._upsertedFolderIds.has(folderId)) {
        logger.debug('[FolderMatchingService] Skipping duplicate folder upsert', {
          id: folderId,
          name: folder.name
        });
        return null;
      }

      const payload = {
        id: folderId,
        name: folder.name,
        description: folder.description || '',
        path: folder.path || '',
        vector,
        model,
        updatedAt: new Date().toISOString()
      };

      await this.vectorDbService.upsertFolder(payload);
      logger.debug('[FolderMatchingService] Upserted folder embedding', {
        id: folderId,
        name: folder.name
      });
      this._trackUpsertedFolder(folderId);

      return payload;
    } catch (error) {
      logger.error('[FolderMatchingService] Failed to upsert folder embedding:', {
        folderId: folder.id,
        folderName: folder.name,
        error: error.message,
        errorStack: error.stack
      });
      throw error;
    }
  }

  /**
   * Batch upsert multiple folder embeddings
   * FIX: Now uses ParallelEmbeddingService for improved throughput
   * @param {Array<Object>} folders - Array of folders to upsert
   * @param {Object} options - Processing options
   * @param {Function} options.onProgress - Progress callback
   * @returns {Promise<Object>} Result with count and skipped items
   */
  async batchUpsertFolders(folders, options = {}) {
    try {
      if (!folders || folders.length === 0) {
        return { count: 0, skipped: [], stats: null };
      }

      if (!this.vectorDbService) {
        throw new Error('Vector DB service not available');
      }

      // Startup-safety: vector DB can still be booting even after process spawn.
      // If initialization fails, treat folder upsert as non-fatal and retry later via subsequent calls.
      try {
        await this.vectorDbService.initialize();
      } catch (initError) {
        const msg = initError?.message || '';
        const isStartupLike =
          initError?.name === 'VectorDbNotReadyError' ||
          /requested resource could not be found/i.test(msg) ||
          /ECONNREFUSED|ENOTFOUND|ETIMEDOUT|EHOSTUNREACH|ENETUNREACH/i.test(msg);

        // Expected during phased startup - use debug to avoid noise
        logger.debug(
          '[FolderMatchingService] Vector DB not ready; deferring folder embedding upsert',
          {
            reason: msg
          }
        );
        return {
          count: 0,
          skipped: folders.map((f) => ({
            folder: f,
            error: isStartupLike ? 'vector_db_not_ready' : msg
          })),
          stats: {
            total: folders.length,
            cached: 0,
            generated: 0,
            failed: folders.length,
            deferred: true
          }
        };
      }

      const { onProgress = null } = options;
      const forceRefresh = options.forceRefresh === true;
      const skipped = [];
      const payloads = [];
      const folderById = new Map(folders.map((f) => [f.id || this.generateFolderId(f), f]));

      const cfg = await getLlamaService().getConfig();
      const model = cfg.embeddingModel || AI_DEFAULTS.EMBEDDING.MODEL;

      const uncachedFolders = [];
      const cachedPayloads = [];

      let processedCount = 0;
      for (const folder of folders) {
        processedCount++;
        if (processedCount % 50 === 0) {
          await new Promise((resolve) => setImmediate(resolve));
        }

        // Enrich folder text with semantic context for better file type matching
        const folderText = enrichFolderTextForEmbedding(folder.name, folder.description);
        const folderId = folder.id || this.generateFolderId(folder);

        if (!forceRefresh && this._upsertedFolderIds.has(folderId)) {
          skipped.push({ folder, error: 'already_upserted_this_session' });
          continue;
        }

        // Check embedding cache first
        const cachedResult = this.embeddingCache.get(folderText, model);

        if (cachedResult) {
          cachedPayloads.push({
            id: folderId,
            name: folder.name,
            description: folder.description || '',
            path: folder.path || '',
            vector: cachedResult.vector,
            model: cachedResult.model,
            updatedAt: new Date().toISOString()
          });
        } else {
          uncachedFolders.push(folder);
        }
      }

      logger.debug('[FolderMatchingService] Batch folder embedding cache status', {
        total: folders.length,
        cached: cachedPayloads.length,
        uncached: uncachedFolders.length
      });

      // Add cached payloads to results
      payloads.push(...cachedPayloads);

      if (uncachedFolders.length > 0) {
        const { results, errors, stats } = await this._getEmbeddingService().batchEmbedFolders(
          uncachedFolders.map((folder) => ({
            id: folder.id || this.generateFolderId(folder),
            name: folder.name,
            description: folder.description || '',
            path: folder.path || ''
          })),
          {
            onProgress: onProgress
              ? (progress) => {
                  onProgress({
                    ...progress,
                    phase: 'embedding',
                    cachedCount: cachedPayloads.length
                  });
                }
              : null
          }
        );

        // This prevents misalignment when some embeddings fail and results array has gaps
        const folderById = new Map(
          uncachedFolders.map((f) => [f.id || this.generateFolderId(f), f])
        );

        for (const result of results) {
          if (result && result.success) {
            const folder = folderById.get(result.id);
            if (!folder) {
              logger.warn('[FolderMatchingService] Result ID not found in folder map', {
                resultId: result.id
              });
              continue;
            }

            // Previously this used a plain join which produced a different key than the
            // enriched text used in cache get(), causing permanent cache misses.
            const folderText = enrichFolderTextForEmbedding(folder.name, folder.description);
            this.embeddingCache.set(folderText, result.model, result.vector);

            payloads.push({
              id: result.id,
              name: folder.name,
              description: folder.description || '',
              path: folder.path || '',
              vector: result.vector,
              model: result.model,
              updatedAt: new Date().toISOString()
            });
          }
        }

        // Track errors as skipped
        for (const error of errors) {
          const folder = uncachedFolders.find(
            (f) => (f.id || this.generateFolderId(f)) === error.id
          );
          skipped.push({ folder, error: error.error });
        }

        logger.info('[FolderMatchingService] Parallel folder embedding complete', {
          ...stats,
          cachedCount: cachedPayloads.length
        });
      }

      // Batch upsert to vector DB
      let persistedCount = 0;
      let requiresRebuild = false;
      if (payloads.length > 0) {
        let upsertResult = await this.vectorDbService.batchUpsertFolders(payloads);

        // Automatic self-heal for folder embeddings after embedding-model dimension changes.
        // Folder vectors can be deterministically regenerated from smart-folder metadata,
        // so we can safely reset only the folders collection and retry once.
        if (
          upsertResult?.requiresRebuild === true &&
          typeof this.vectorDbService.resetFolders === 'function'
        ) {
          try {
            logger.warn(
              '[FolderMatchingService] Folder embedding dimension mismatch detected; resetting folders collection and retrying once'
            );
            await this.vectorDbService.resetFolders();
            upsertResult = await this.vectorDbService.batchUpsertFolders(payloads);
          } catch (resetError) {
            logger.warn(
              '[FolderMatchingService] Folder collection reset/retry failed after dimension mismatch',
              {
                error: resetError?.message
              }
            );
          }
        }
        const failedIds = new Set();

        if (Array.isArray(upsertResult?.failed)) {
          for (const failedItem of upsertResult.failed) {
            const id = failedItem?.id;
            if (!id) continue;
            failedIds.add(id);
            if (failedItem?.requiresRebuild === true) {
              requiresRebuild = true;
            }
            skipped.push({
              folder: folderById.get(id) || null,
              error: failedItem?.error || 'upsert_failed',
              stage: 'vector_upsert',
              requiresRebuild: failedItem?.requiresRebuild === true
            });
          }
        }

        if (Array.isArray(upsertResult?.skipped)) {
          for (const skippedItem of upsertResult.skipped) {
            const id = skippedItem?.id;
            if (!id) continue;
            failedIds.add(id);
            skipped.push({
              folder: folderById.get(id) || null,
              error: skippedItem?.error || 'upsert_skipped',
              stage: 'vector_upsert'
            });
          }
        }

        if (upsertResult?.success === false) {
          if (upsertResult?.requiresRebuild === true) {
            requiresRebuild = true;
          }
          if (failedIds.size === 0) {
            const errorCode = upsertResult?.error || 'upsert_failed';
            for (const payload of payloads) {
              failedIds.add(payload.id);
              skipped.push({
                folder: folderById.get(payload.id) || null,
                error: errorCode,
                stage: 'vector_upsert',
                requiresRebuild: upsertResult?.requiresRebuild === true
              });
            }
          }
        }

        const successfulPayloads = payloads.filter((payload) => !failedIds.has(payload.id));
        for (const payload of successfulPayloads) {
          this._trackUpsertedFolder(payload.id);
        }
        persistedCount = successfulPayloads.length;

        if (persistedCount === 0) {
          logger.warn(
            '[FolderMatchingService] Folder embedding upsert produced no persisted rows',
            {
              attempted: payloads.length,
              failed: failedIds.size,
              error: upsertResult?.error || null,
              requiresRebuild
            }
          );
        }

        logger.debug('[FolderMatchingService] Batch upserted folder embeddings', {
          count: persistedCount,
          attempted: payloads.length,
          skipped: skipped.length,
          requiresRebuild
        });
      }

      return {
        count: persistedCount,
        skipped,
        requiresRebuild,
        stats: {
          total: folders.length,
          cached: cachedPayloads.length,
          generated: payloads.length - cachedPayloads.length,
          failed: skipped.length
        }
      };
    } catch (error) {
      const msg = error?.message || '';
      const isStartupLike =
        error?.name === 'VectorDbNotReadyError' ||
        /requested resource could not be found/i.test(msg) ||
        /ECONNREFUSED|ENOTFOUND|ETIMEDOUT|EHOSTUNREACH|ENETUNREACH/i.test(msg);

      // During startup, don't spam error logs; treat as deferred/non-fatal.
      if (isStartupLike) {
        logger.debug(
          '[FolderMatchingService] Folder embedding upsert deferred (vector DB not ready)',
          {
            error: msg,
            totalFolders: folders?.length || 0
          }
        );
        return {
          count: 0,
          skipped: (folders || []).map((f) => ({ folder: f, error: 'vector_db_not_ready' })),
          stats: {
            total: folders?.length || 0,
            cached: 0,
            generated: 0,
            failed: (folders || []).length,
            deferred: true
          }
        };
      }

      logger.error('[FolderMatchingService] Failed to batch upsert folder embeddings:', {
        totalFolders: folders.length,
        error: msg,
        errorStack: error.stack
      });
      throw error;
    }
  }

  async upsertFileEmbedding(fileId, contentSummary, fileMeta = {}, options = {}) {
    try {
      if (!this.vectorDbService) {
        throw new Error('Vector DB service not available');
      }

      await this.vectorDbService.initialize();

      // This prevents OrganizationSuggestionService (metadata-only) from overwriting
      // high-quality embeddings generated by document analysis (full text)
      if (options.checkExisting) {
        try {
          // Use get() to check metadata without fetching heavy vector
          const existing = await this.vectorDbService.getFile(fileId);
          if (existing) {
            const existingMethod = existing.extractionMethod;
            const newMethod = fileMeta.extractionMethod; // Might be undefined for metadata-only

            // Priority: content/full_text > archive > metadata/undefined
            const isExistingHighQuality =
              existingMethod === 'content' || existingMethod === 'full_text';
            const isNewLowQuality = newMethod !== 'content' && newMethod !== 'full_text';

            if (isExistingHighQuality && isNewLowQuality) {
              logger.debug(
                '[FolderMatchingService] Skipping upsert: existing embedding has higher quality',
                {
                  fileId,
                  existingMethod,
                  newMethod: newMethod || 'metadata'
                }
              );
              return;
            }
          }
        } catch (checkError) {
          // If check fails (e.g. ID not found), just proceed to upsert
          // Ignore "not found" errors as they are expected for new files
          const isNotFound =
            checkError.message.includes('not found') ||
            checkError.message.includes('does not exist');

          if (!isNotFound) {
            logger.warn(
              '[FolderMatchingService] Failed to check existing embedding:',
              checkError.message
            );
          }
        }
      }

      const { vector, model } = await this.embedText(contentSummary || '');

      // Validate dimensions if we have a known model
      const expectedDim = getEmbeddingDimensionForModel(model);
      if (!validateEmbeddingDimensions(vector, expectedDim)) {
        logger.error('[FolderMatchingService] Vector dimension mismatch in upsert, rejecting', {
          id: fileId,
          model,
          expected: expectedDim,
          actual: vector?.length
        });
        throw new Error(
          `Embedding dimension mismatch: expected ${expectedDim}, got ${vector?.length}. ` +
            `Model "${model}" may have changed. Please rebuild your embedding index.`
        );
      }

      await this.vectorDbService.upsertFile({
        id: fileId,
        vector,
        model,
        meta: fileMeta,
        updatedAt: new Date().toISOString()
      });

      logger.debug('[FolderMatchingService] Upserted file embedding', {
        id: fileId,
        path: fileMeta.path,
        vectorLength: vector.length
      });
    } catch (error) {
      logger.error('[FolderMatchingService] Failed to upsert file embedding:', {
        fileId,
        filePath: fileMeta.path,
        error: error.message,
        errorStack: error.stack
      });
      throw error;
    }
  }

  /**
   * FIX: Batch generate file embeddings with parallelization
   * Now uses ParallelEmbeddingService for improved throughput with semaphore-based concurrency
   * @param {Array<{fileId: string, summary: string, meta: Object}>} fileSummaries
   * @param {Object} options - Processing options
   * @param {Function} options.onProgress - Progress callback
   * @returns {Promise<{results: Array, skipped: Array, stats: Object}>}
   */
  async batchGenerateFileEmbeddings(fileSummaries, options = {}) {
    try {
      if (!this.vectorDbService) {
        throw new Error('Vector DB service not available');
      }

      await this.vectorDbService.initialize();

      const { onProgress = null } = options;
      const cfg = await getLlamaService().getConfig();
      const model = cfg.embeddingModel || AI_DEFAULTS.EMBEDDING.MODEL;

      const uncachedFiles = [];
      const cachedResults = [];

      let processedCount = 0;
      for (const item of fileSummaries) {
        processedCount++;
        if (processedCount % 50 === 0) {
          await new Promise((resolve) => setImmediate(resolve));
        }

        const cachedResult = this.embeddingCache.get(item.summary || '', model);

        if (cachedResult) {
          cachedResults.push({
            fileId: item.fileId,
            vector: cachedResult.vector,
            model: cachedResult.model,
            meta: item.meta || {},
            success: true
          });
        } else {
          uncachedFiles.push(item);
        }
      }

      logger.debug('[FolderMatchingService] Batch file embedding cache status', {
        total: fileSummaries.length,
        cached: cachedResults.length,
        uncached: uncachedFiles.length
      });

      const results = [...cachedResults];
      const skipped = [];

      if (uncachedFiles.length > 0) {
        const {
          results: embedResults,
          errors,
          stats
        } = await this._getEmbeddingService().batchEmbedFileSummaries(
          uncachedFiles.map((item) => ({
            fileId: item.fileId,
            summary: item.summary || '',
            filePath: item.meta?.path || '',
            meta: item.meta || {}
          })),
          {
            onProgress: onProgress
              ? (progress) => {
                  onProgress({
                    ...progress,
                    phase: 'embedding',
                    cachedCount: cachedResults.length
                  });
                }
              : null
          }
        );

        // Process results and update cache
        for (const result of embedResults) {
          if (result && result.success) {
            const originalItem = uncachedFiles.find((f) => f.fileId === result.id);

            const expectedDim = getEmbeddingDimensionForModel(result.model);
            if (!validateEmbeddingDimensions(result.vector, expectedDim)) {
              logger.warn('[FolderMatchingService] Batch embedding dimension mismatch, skipping', {
                fileId: result.id,
                model: result.model,
                expected: expectedDim,
                actual: result.vector?.length
              });
              skipped.push({ fileId: result.id, error: 'dimension_mismatch' });
              continue;
            }

            // Cache the embedding for future use
            if (originalItem) {
              this.embeddingCache.set(originalItem.summary || '', result.model, result.vector);
            }

            results.push({
              fileId: result.id,
              vector: result.vector,
              model: result.model,
              meta: result.meta || {},
              success: true
            });
          }
        }

        // Track errors as skipped
        for (const error of errors) {
          skipped.push({ fileId: error.id, error: error.error });
        }

        logger.info('[FolderMatchingService] Parallel file embedding complete', {
          ...stats,
          cachedCount: cachedResults.length
        });
      }

      logger.debug('[FolderMatchingService] Batch generated file embeddings', {
        total: fileSummaries.length,
        success: results.length,
        skipped: skipped.length
      });

      return {
        results,
        skipped,
        stats: {
          total: fileSummaries.length,
          cached: cachedResults.length,
          generated: results.length - cachedResults.length,
          failed: skipped.length
        }
      };
    } catch (error) {
      logger.error('[FolderMatchingService] Failed to batch generate file embeddings:', {
        totalFiles: fileSummaries.length,
        error: error.message
      });
      throw error;
    }
  }

  async matchFileToFolders(fileId, topK = 5) {
    try {
      if (!this.vectorDbService) {
        logger.error('[FolderMatchingService] Vector DB service not available');
        return [];
      }

      const MAX_TOP_K = 100;
      const validTopK = Math.max(1, Math.min(Number.isInteger(topK) ? topK : 5, MAX_TOP_K));

      // Ensure vector DB is initialized
      await this.vectorDbService.initialize();

      logger.debug('[FolderMatchingService] Querying folder matches', {
        fileId,
        topK: validTopK
      });

      const results = await this.vectorDbService.queryFolders(fileId, validTopK);

      if (!Array.isArray(results)) {
        logger.warn('[FolderMatchingService] Invalid results format', {
          fileId,
          resultsType: typeof results
        });
        return [];
      }

      logger.debug('[FolderMatchingService] Folder matching results', {
        fileId,
        resultCount: results.length,
        topScore: results[0]?.score
      });

      return this._normalizeFolderMatches(results);
    } catch (error) {
      logger.error('[FolderMatchingService] Failed to match file to folders:', {
        fileId,
        topK,
        error: error.message,
        errorStack: error.stack
      });
      return [];
    }
  }

  /**
   * Batch match multiple files to folders
   * @param {Array<string>} fileIds - Array of file IDs to match
   * @param {number} topK - Number of matches per file
   * @returns {Promise<Object>} Map of fileId -> Array of folder matches
   */
  async batchMatchFilesToFolders(fileIds, topK = 5) {
    try {
      if (!this.vectorDbService) {
        logger.error('[FolderMatchingService] Vector DB service not available');
        return {};
      }

      await this.vectorDbService.initialize();

      logger.debug('[FolderMatchingService] Batch querying folder matches', {
        fileCount: fileIds.length,
        topK
      });

      const raw = await this.vectorDbService.batchQueryFolders(fileIds, topK);
      if (!raw || typeof raw !== 'object') return {};
      const normalized = {};
      for (const [fileId, matches] of Object.entries(raw)) {
        normalized[fileId] = this._normalizeFolderMatches(matches);
      }
      return normalized;
    } catch (error) {
      logger.error('[FolderMatchingService] Failed to batch match files:', {
        fileCount: fileIds.length,
        error: error.message
      });
      return {};
    }
  }

  /**
   * Normalize folder match results across vector DB implementations.
   *
   * Orama returns matches like: { id, score, metadata: { folderName, folderPath, description } }
   * Legacy/other implementations may return: { folderId, name, path, description, score }
   *
   * Downstream code (e.g. OrganizationSuggestionService) expects `folderId`, `name`, and `path`.
   *
   * @param {Array} matches
   * @returns {Array}
   * @private
   */
  _normalizeFolderMatches(matches) {
    if (!Array.isArray(matches)) return [];
    return matches.filter(Boolean).map((match) => {
      if (!match || typeof match !== 'object') return match;

      const folderId = match.folderId || match.folderID || match.id;
      const metadata = match.metadata && typeof match.metadata === 'object' ? match.metadata : null;
      const name = match.name || metadata?.folderName || metadata?.name;
      const path = match.path || metadata?.folderPath || metadata?.path;
      const description = match.description || metadata?.description;

      // Only add fields when we can derive them; do not overwrite present values.
      return {
        ...match,
        ...(folderId && !match.folderId ? { folderId } : null),
        ...(name && !match.name ? { name } : null),
        ...(path && !match.path ? { path } : null),
        ...(description && !match.description ? { description } : null)
      };
    });
  }

  /**
   * Match a raw embedding vector to folders
   * @param {Array<number>} vector - Embedding vector
   * @param {number} topK - Number of matches
   * @returns {Promise<Array>} Array of folder matches
   */
  async matchVectorToFolders(vector, topK = 5) {
    try {
      if (!this.vectorDbService) {
        logger.error('[FolderMatchingService] Vector DB service not available');
        return [];
      }

      await this.vectorDbService.initialize();

      const results = await this.vectorDbService.queryFoldersByEmbedding(vector, topK);
      return this._normalizeFolderMatches(results);
    } catch (error) {
      logger.error('[FolderMatchingService] Failed to match vector to folders:', {
        error: error.message
      });
      return [];
    }
  }

  /**
   * Find similar files using a raw query vector
   * @param {Array<number>} queryVector - The embedding vector to search with
   * @param {number} topK - Number of results to return
   * @returns {Promise<Array>} Array of similar files with scores and metadata
   */
  async findSimilarFilesByVector(queryVector, topK = 10) {
    try {
      if (!this.vectorDbService) {
        logger.error('[FolderMatchingService] Vector DB service not available');
        return [];
      }
      await this.vectorDbService.initialize();

      return await this.vectorDbService.querySimilarFiles(queryVector, topK);
    } catch (error) {
      logger.error('[FolderMatchingService] Failed to find similar files by vector:', error);
      return [];
    }
  }

  /**
   * Find similar files to a given file
   */
  async findSimilarFiles(fileId, topK = 10) {
    try {
      if (!this.vectorDbService) {
        logger.error('[FolderMatchingService] Vector DB service not available');
        return [];
      }
      await this.vectorDbService.initialize();

      // Get the file's embedding first
      const fileResult = await this.vectorDbService.getFile(fileId);

      if (!fileResult || !fileResult.embedding) {
        logger.warn(
          '[FolderMatchingService] File not found or invalid embeddings for similarity search:',
          fileId
        );
        return [];
      }

      const fileEmbedding = fileResult.embedding;
      return await this.vectorDbService.querySimilarFiles(fileEmbedding, topK);
    } catch (error) {
      logger.error('[FolderMatchingService] Failed to find similar files:', error);
      return [];
    }
  }

  /**
   * Find similar files with multi-hop expansion
   * Explores neighbors of neighbors with decay scoring (Degree of Interest)
   *
   * @param {string[]} seedIds - Array of starting file IDs
   * @param {Object} options - Expansion options
   * @param {number} options.maxHops - Maximum number of hops (1-3)
   * @param {number} options.topKPerHop - Results per expansion hop
   * @param {number} options.decayFactor - Score decay per hop (0.5-0.9)
   * @returns {Promise<Array>} Array of results with scores, hop levels, and paths
   */
  async findMultiHopNeighbors(seedIds, options = {}) {
    const { maxHops = 2, topKPerHop = 5, decayFactor = 0.7 } = options;

    // Validate inputs
    if (!Array.isArray(seedIds) || seedIds.length === 0) {
      logger.warn('[FolderMatchingService] findMultiHopNeighbors called with no seeds');
      return [];
    }

    const clampedMaxHops = Math.min(3, Math.max(1, maxHops));
    const clampedTopK = Math.min(10, Math.max(1, topKPerHop));
    const clampedDecay = Math.min(0.9, Math.max(0.5, decayFactor));

    try {
      if (!this.vectorDbService) {
        logger.error('[FolderMatchingService] Vector DB service not available');
        return [];
      }
      await this.vectorDbService.initialize();

      // Keep seeds separate - they should never appear in results (they're the query, not a discovery)
      const seedSet = new Set(seedIds);
      const visited = new Set(seedIds);
      const allResults = new Map();

      // Initialize frontier with seed nodes
      let frontier = seedIds.map((id) => ({
        id,
        score: 1.0,
        hop: 0,
        path: [id]
      }));

      // Explore each hop level
      for (let hop = 1; hop <= clampedMaxHops; hop++) {
        const nextFrontier = [];

        // Process each node in the current frontier
        for (const node of frontier) {
          try {
            // Find similar files to this node
            const neighbors = await this.findSimilarFiles(node.id, clampedTopK);

            for (const neighbor of neighbors) {
              // Skip invalid neighbors with missing id
              if (!neighbor?.id) {
                logger.debug('[FolderMatchingService] Skipping neighbor with missing id');
                continue;
              }

              // Never include seed nodes in results (they're the query)
              if (seedSet.has(neighbor.id)) {
                continue;
              }

              // Calculate decayed score
              // DOI formula: parentScore * neighborScore * decay^hop
              const neighborScore = neighbor.score ?? 1 - (neighbor.distance ?? 0) / 2;
              const decayedScore = node.score * neighborScore * clampedDecay ** hop;

              // This ensures multi-seed queries preserve the best path to each node
              const existing = allResults.get(neighbor.id);
              if (existing && existing.score >= decayedScore) {
                continue; // Existing path is better or equal, skip
              }

              // Track visited for frontier expansion (prevents infinite loops)
              const isNewNode = !visited.has(neighbor.id);
              visited.add(neighbor.id);

              // Store/update result (always update if better score)
              const result = {
                id: neighbor.id,
                score: decayedScore,
                hop,
                path: [...node.path, neighbor.id],
                metadata: neighbor.metadata || {}
              };

              allResults.set(neighbor.id, result);

              // Only add to next frontier if this is a new discovery
              // (prevents duplicate expansion even with score updates)
              if (isNewNode) {
                nextFrontier.push({
                  id: neighbor.id,
                  score: decayedScore,
                  hop,
                  path: result.path
                });
              }
            }
          } catch (error) {
            logger.warn('[FolderMatchingService] Failed to expand node:', node.id, error.message);
          }
        }

        // Update frontier for next hop
        frontier = nextFrontier;

        // Early exit if no more nodes to explore
        if (frontier.length === 0) {
          logger.debug('[FolderMatchingService] Multi-hop exhausted at hop', hop);
          break;
        }
      }

      // Sort by score and return
      const results = Array.from(allResults.values()).sort((a, b) => b.score - a.score);

      logger.info('[FolderMatchingService] Multi-hop expansion complete', {
        seeds: seedIds.length,
        hops: clampedMaxHops,
        results: results.length
      });

      return results;
    } catch (error) {
      logger.error('[FolderMatchingService] Multi-hop expansion failed:', error);
      return [];
    }
  }

  /**
   * Get database statistics
   */
  async getStats() {
    try {
      if (!this.vectorDbService) {
        logger.warn('[FolderMatchingService] Vector DB service not available for stats');
        return {
          error: 'Service not available',
          folderCount: 0,
          fileCount: 0,
          lastUpdate: null
        };
      }
      return await this.vectorDbService.getStats();
    } catch (error) {
      logger.error('[FolderMatchingService] Failed to get stats:', error);
      return {
        error: error.message,
        folderCount: 0,
        fileCount: 0,
        lastUpdate: null
      };
    }
  }

  /**
   * Get cache statistics
   * @returns {Object} - Cache metrics including hit rate and memory usage
   */
  getCacheStats() {
    return this.embeddingCache.getStats();
  }

  /**
   * Reset caches for reanalysis. Call when the vector DB has been
   * cleared so folder embeddings will be re-persisted on next upsert.
   */
  resetForReanalysis() {
    this._upsertedFolderIds.clear();
    if (this.embeddingCache?.clear) {
      this.embeddingCache.clear();
    }
    logger.info('[FolderMatchingService] Reset caches for reanalysis');
  }

  /**
   * Shutdown service and cleanup resources
   * Should be called when the application is closing
   * @returns {Promise<void>}
   */
  async shutdown() {
    if (this._modelChangeUnsubscribe) {
      this._modelChangeUnsubscribe();
      this._modelChangeUnsubscribe = null;
      logger.debug('[FolderMatchingService] Unsubscribed from model changes');
    }

    if (this._invalidationUnsubscribe) {
      this._invalidationUnsubscribe();
      this._invalidationUnsubscribe = null;
    }

    if (this.embeddingCache) {
      logger.info('[FolderMatchingService] Shutting down embedding cache');
      await this.embeddingCache.shutdown();
    }
  }

  /**
   * Calculate Levenshtein distance between two strings
   * @param {string} a - First string
   * @param {string} b - Second string
   * @returns {number} Distance (0 = identical)
   */
  static levenshteinDistance(a, b) {
    if (a.length === 0) return b.length;
    if (b.length === 0) return a.length;

    const matrix = [];

    // Increment along the first column of each row
    for (let i = 0; i <= b.length; i++) {
      matrix[i] = [i];
    }

    // Increment each column in the first row
    for (let j = 0; j <= a.length; j++) {
      matrix[0][j] = j;
    }

    // Fill in the rest of the matrix
    for (let i = 1; i <= b.length; i++) {
      for (let j = 1; j <= a.length; j++) {
        if (b.charAt(i - 1) === a.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1, // substitution
            Math.min(
              matrix[i][j - 1] + 1, // insertion
              matrix[i - 1][j] + 1 // deletion
            )
          );
        }
      }
    }

    return matrix[b.length][a.length];
  }

  /**
   * Match a category string to a smart folder using fuzzy matching logic
   * (Static helper to allow usage without instantiation)
   * @param {string} category - The raw category string from LLM
   * @param {Array} smartFolders - List of available smart folders
   * @returns {string} The matched folder name
   */
  static matchCategoryToFolder(category, smartFolders) {
    const folders = Array.isArray(smartFolders) ? smartFolders : [];
    // against. Returning the raw string caused non-existent folder names like
    // "documents" to propagate through the pipeline.
    if (folders.length === 0) return 'Uncategorized';

    const raw = String(category || '').trim();
    const normalizedRaw = raw.toLowerCase();

    // Prefer Uncategorized if model returns generic buckets
    const uncategorized = folders.find(
      (f) => String(f?.name || '').toLowerCase() === 'uncategorized'
    );
    if (
      normalizedRaw === 'document' ||
      normalizedRaw === 'documents' ||
      normalizedRaw === 'image' ||
      normalizedRaw === 'images' ||
      normalizedRaw === 'default'
    ) {
      return uncategorized?.name || folders[0].name;
    }

    // Exact match (case-insensitive)
    const exact = folders.find(
      (f) =>
        String(f?.name || '')
          .trim()
          .toLowerCase() === normalizedRaw
    );
    if (exact) return exact.name;

    // Normalize punctuation/whitespace for near-exact matches
    const canon = (s) =>
      String(s || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
    const rawCanon = canon(raw);
    if (rawCanon) {
      const canonMatch = folders.find((f) => canon(f?.name) === rawCanon);
      if (canonMatch) return canonMatch.name;
    }

    // Levenshtein distance check for typos (allow 2 edits for short strings, 3 for long)
    let bestLevenshtein = null;
    let minDistance = Infinity;

    for (const f of folders) {
      const name = String(f?.name || '').trim();
      if (!name) continue;
      const dist = FolderMatchingService.levenshteinDistance(normalizedRaw, name.toLowerCase());
      const threshold = name.length > 10 ? 3 : 2;

      if (dist <= threshold && dist < minDistance) {
        minDistance = dist;
        bestLevenshtein = name;
      }
    }

    if (bestLevenshtein) {
      logger.debug('[FolderMatching] Fuzzy match via Levenshtein', {
        rawCategory: raw,
        matchedFolder: bestLevenshtein,
        editDistance: minDistance
      });
      return bestLevenshtein;
    }

    // Token overlap scoring (simple, deterministic)
    const tokens = new Set(rawCanon.split(' ').filter(Boolean));
    let best = null;
    let bestScore = 0;
    for (const f of folders) {
      const name = String(f?.name || '').trim();
      if (!name) continue;
      const nameCanon = canon(name);
      const nameTokens = nameCanon.split(' ').filter(Boolean);
      if (nameTokens.length === 0) continue;
      let score = 0;
      nameTokens.forEach((t) => {
        if (tokens.has(t)) score += 1;
      });
      // Small bias for shorter names to avoid always matching long "Financial Documents" when raw is "Financial"
      score -= Math.min(0.25, nameTokens.length * 0.01);
      if (score > bestScore) {
        bestScore = score;
        best = name;
      }
    }

    if (bestScore > 0.5 && best) {
      logger.debug('[FolderMatching] Token overlap match', {
        rawCategory: raw,
        matchedFolder: best,
        overlapScore: +bestScore.toFixed(2)
      });
      return best;
    }
    const fallbackFolder = uncategorized?.name || null;
    if (raw && fallbackFolder && raw.toLowerCase() !== fallbackFolder.toLowerCase()) {
      logger.debug('[FolderMatching] No match found, using fallback', {
        rawCategory: raw,
        fallbackFolder
      });
    }
    return fallbackFolder;
  }
}

/**
 * Create a FolderMatchingService instance with default dependencies
 *
 * This factory function creates a FolderMatchingService with the default
 * vector service singleton. Use for simple cases where DI is not needed.
 *
 * @param {Object} options - Configuration options passed to constructor
 * @returns {FolderMatchingService} A new service instance
 */
function createWithDefaults(options = {}) {
  // Use OramaVectorService (in-process), fall back to legacy vector DB for backward compatibility
  const { getInstance: getOramaVector } = require('./OramaVectorService');
  return new FolderMatchingService(getOramaVector(), options);
}

// Singleton factory pattern for DI container support
const { createSingletonHelpers } = require('../../shared/singletonFactory');

const { getInstance, registerWithContainer, resetInstance } = createSingletonHelpers({
  ServiceClass: FolderMatchingService,
  serviceId: 'FOLDER_MATCHING',
  serviceName: 'FolderMatchingService',
  containerPath: './ServiceContainer',
  shutdownMethod: 'shutdown',
  createFactory: (options = {}) => createWithDefaults(options)
});

module.exports = FolderMatchingService;
module.exports.createWithDefaults = createWithDefaults;
module.exports.getInstance = getInstance;
module.exports.registerWithContainer = registerWithContainer;
module.exports.resetInstance = resetInstance;
