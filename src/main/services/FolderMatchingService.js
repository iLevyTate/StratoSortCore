const crypto = require('crypto');
const { getOllama, getOllamaEmbeddingModel } = require('../ollamaUtils');
const { logger } = require('../../shared/logger');

logger.setContext('FolderMatchingService');
const EmbeddingCache = require('./EmbeddingCache');
const { getInstance: getParallelEmbeddingService } = require('./ParallelEmbeddingService');
const { get: getConfig } = require('../../shared/config/index');
const { buildOllamaOptions } = require('./PerformanceService');
const { getInstance: getOllamaInstance } = require('./OllamaService');
const { enrichFolderTextForEmbedding } = require('../analysis/semanticExtensionMap');
const { validateEmbeddingDimensions } = require('../../shared/vectorMath');
const { capEmbeddingInput } = require('../utils/embeddingInput');
const { chunkText } = require('../utils/textChunking');

/**
 * Embedding dimension constants for different models
 * FIX: Made configurable instead of hardcoding 1024
 * These are the default dimensions for common embedding models
 */
const EMBEDDING_DIMENSIONS = {
  embeddinggemma: 768, // New default - Google's best-in-class
  'nomic-embed-text': 768,
  'mxbai-embed-large': 1024,
  'all-minilm': 384,
  'bge-large': 1024,
  'snowflake-arctic-embed': 1024, // FIX: Added Snowflake Arctic Embed
  gte: 768, // FIX: Added Alibaba GTE models (default to 768)
  default: 768 // Updated fallback for new default model
};

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

/**
 * Get the embedding dimension for a model
 * @param {string} modelName - Name of the embedding model
 * @returns {number} The embedding dimension
 */
function getEmbeddingDimension(modelName) {
  if (!modelName) return EMBEDDING_DIMENSIONS.default;

  // Check exact match first
  if (EMBEDDING_DIMENSIONS[modelName]) {
    return EMBEDDING_DIMENSIONS[modelName];
  }

  // Check partial match (model names often include version suffixes)
  const normalizedName = modelName.toLowerCase();
  for (const [key, dimension] of Object.entries(EMBEDDING_DIMENSIONS)) {
    if (normalizedName.includes(key.toLowerCase())) {
      return dimension;
    }
  }

  // Use configurable default
  return getConfig('ANALYSIS.embeddingDimension', EMBEDDING_DIMENSIONS.default);
}

/**
 * FolderMatchingService - Handles file-to-folder matching using embeddings
 *
 * This service uses vector embeddings to match files with appropriate folders
 * based on semantic similarity. It supports dependency injection for:
 * - chromaDbService: Vector database for storing/querying embeddings
 * - embeddingCache: Cache for embedding results (optional, created if not provided)
 * - parallelEmbeddingService: Service for parallel embedding generation (optional)
 *
 * @example
 * // Using dependency injection (recommended)
 * const folderMatcher = new FolderMatchingService(chromaDb, {
 *   embeddingCache: myCache,
 *   parallelEmbeddingService: myParallelService
 * });
 *
 * // Using with ServiceContainer
 * container.registerSingleton(ServiceIds.FOLDER_MATCHING, (c) => {
 *   return new FolderMatchingService(c.resolve(ServiceIds.CHROMA_DB));
 * });
 */
class FolderMatchingService {
  /**
   * Create a FolderMatchingService instance
   *
   * @param {Object} chromaDbService - ChromaDB service for vector storage (required)
   * @param {Object} options - Configuration options
   * @param {Object} [options.embeddingCache] - Pre-configured embedding cache (optional)
   * @param {Object} [options.parallelEmbeddingService] - Pre-configured parallel embedding service (optional)
   * @param {number} [options.concurrencyLimit] - Override concurrency limit for parallel embeddings (optional)
   * @param {number} [options.maxRetries] - Override max retries for failed operations (optional)
   * @param {number} [options.maxCacheSize] - Maximum cache size
   * @param {number} [options.cacheTtl] - Cache TTL in milliseconds
   */
  constructor(chromaDbService, options = {}) {
    // Support both old signature (chromaDbService, cacheOptions) and new signature (chromaDbService, { embeddingCache, ... })
    const cacheOptions = options.maxCacheSize || options.cacheTtl ? options : {};

    this.chromaDbService = chromaDbService;
    this.ollama = null;
    this.modelName = '';
    this._upsertedFolderIds = new Set();

    // Initialize embedding cache - use injected or create new
    this.embeddingCache = options.embeddingCache || new EmbeddingCache(cacheOptions);

    // FIX: Allow concurrency limit to be overridden via options
    // Priority: options.concurrencyLimit > config value > default (5)
    const concurrencyLimit = options.concurrencyLimit ?? getConfig('ANALYSIS.maxConcurrency', 5);
    const maxRetries = options.maxRetries ?? getConfig('ANALYSIS.retryAttempts', 3);

    // Use injected parallel embedding service or get singleton with configurable values
    this.parallelEmbeddingService =
      options.parallelEmbeddingService ||
      getParallelEmbeddingService({
        concurrencyLimit,
        maxRetries
      });

    // Store limits for reference/debugging
    this._concurrencyLimit = concurrencyLimit;
    this._maxRetries = maxRetries;

    // FIX: Subscribe to embedding model changes to invalidate cache
    // This prevents stale embeddings with wrong dimensions after model switch
    this._modelChangeUnsubscribe = null;
    this._subscribeToModelChanges();

    // FIX: Subscribe to cache invalidation bus for coordinated cleanup
    this._invalidationUnsubscribe = null;
    this._subscribeToInvalidationBus();
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
   * Subscribe to OllamaService model change events
   * Invalidates embedding cache when embedding model changes
   * @private
   */
  _subscribeToModelChanges() {
    try {
      const ollamaService = getOllamaInstance();
      if (ollamaService && typeof ollamaService.onModelChange === 'function') {
        this._modelChangeUnsubscribe = ollamaService.onModelChange(
          async ({ type, previousModel, newModel }) => {
            if (type === 'embedding') {
              // FIX: Invalidate in-memory embedding cache
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

              // FIX: CRITICAL - Also clear ChromaDB collections when embedding model changes
              // Previously, only the in-memory cache was cleared, but ChromaDB still contained
              // vectors with the old dimension. This caused query failures or incorrect similarity
              // calculations when new embeddings (with different dimensions) were added.
              if (this.chromaDbService) {
                try {
                  logger.warn(
                    '[FolderMatchingService] Clearing ChromaDB collections due to embedding model change',
                    {
                      from: previousModel,
                      to: newModel
                    }
                  );
                  // Reset both file and folder collections to clear old-dimension vectors
                  await this.chromaDbService.resetAll();
                  logger.info(
                    '[FolderMatchingService] ChromaDB collections reset after model change'
                  );
                } catch (chromaError) {
                  logger.error(
                    '[FolderMatchingService] Failed to reset ChromaDB collections:',
                    chromaError.message
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
    // FIX: Return existing initialization promise if already in progress
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

    // FIX: Atomic check-and-set pattern to prevent race conditions
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
        rejectInit(error);
      })
      .finally(() => {
        this._initializing = false;
        // Keep _initPromise as resolved promise for future callers
        // Don't clear it - concurrent callers need to await the same promise
      });

    return this._initPromise;
  }

  async embedText(text) {
    const startTime = Date.now();

    try {
      const ollama = getOllama();
      // FIX: Add fallback to default embedding model when none configured
      const { AI_DEFAULTS } = require('../../shared/constants');
      const model = getOllamaEmbeddingModel() || AI_DEFAULTS.EMBEDDING.MODEL;
      const perfOptions = await buildOllamaOptions('embeddings');
      const originalText = String(text || '');
      const capped = capEmbeddingInput(originalText);
      const embeddingInput = capped.text;

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
      // Use the newer embed() API with 'input' parameter (embeddings() with 'prompt' is deprecated)
      const response = await ollama.embed({
        model,
        input: embeddingInput || '',
        options: { ...perfOptions }
      });

      // embed() returns embeddings array; extract first vector
      const embeddings = response?.embeddings;
      if (!Array.isArray(embeddings) || embeddings.length === 0 || !Array.isArray(embeddings[0])) {
        const emptyError = new Error(`Embedding response missing vector for model "${model}"`);
        emptyError.code = 'EMBEDDING_FAILED';
        throw emptyError;
      }
      let vector = embeddings[0];
      if (!Array.isArray(vector) || vector.length === 0) {
        const emptyError = new Error(
          `Embedding response returned empty vector for model "${model}"`
        );
        emptyError.code = 'EMBEDDING_FAILED';
        throw emptyError;
      }
      const expectedDim = getEmbeddingDimension(model);
      const actualDim = vector.length;

      // Warn on dimension mismatch - this indicates model config may be wrong
      if (actualDim !== expectedDim && actualDim > 0) {
        logger.warn('[FolderMatchingService] Embedding dimension mismatch detected', {
          model,
          expected: expectedDim,
          actual: actualDim,
          action: actualDim < expectedDim ? 'padding' : 'truncating'
        });
      }

      if (actualDim < expectedDim) {
        vector = vector.concat(new Array(expectedDim - actualDim).fill(0));
      } else if (actualDim > expectedDim) {
        vector = vector.slice(0, expectedDim);
      }

      const result = { vector, model };

      // Store in cache for future use
      this.embeddingCache.set(embeddingInput, model, vector);

      const duration = Date.now() - startTime;
      logger.debug(`[FolderMatchingService] Embedding generated in ${duration}ms (cache: MISS)`);

      return result;
    } catch (error) {
      logger.error('[FolderMatchingService] Failed to generate embedding:', error);
      // FIX: Throw error instead of returning zero vector
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
      const batch = await this.parallelEmbeddingService.batchEmbedTexts(items, {
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
        getEmbeddingDimension(model)
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
      // CRITICAL FIX: Ensure ChromaDB is initialized before upserting
      if (!this.chromaDbService) {
        throw new Error('ChromaDB service not available');
      }

      await this.chromaDbService.initialize();

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

      await this.chromaDbService.upsertFolder(payload);
      logger.debug('[FolderMatchingService] Upserted folder embedding', {
        id: folderId,
        name: folder.name
      });
      this._upsertedFolderIds.add(folderId);

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

      // CRITICAL FIX: Ensure ChromaDB is initialized before upserting
      if (!this.chromaDbService) {
        throw new Error('ChromaDB service not available');
      }

      // Startup-safety: Chroma can still be booting even after process spawn.
      // If initialization fails, treat folder upsert as non-fatal and retry later via subsequent calls.
      try {
        await this.chromaDbService.initialize();
      } catch (initError) {
        const msg = initError?.message || '';
        const isStartupLike =
          initError?.name === 'ChromaNotFoundError' ||
          /requested resource could not be found/i.test(msg) ||
          /ECONNREFUSED|ENOTFOUND|ETIMEDOUT|EHOSTUNREACH|ENETUNREACH/i.test(msg);

        // Avoid log spam during boot: log at warn once per call, and skip.
        logger.warn(
          '[FolderMatchingService] ChromaDB not ready; deferring folder embedding upsert',
          {
            reason: msg
          }
        );
        return {
          count: 0,
          skipped: folders.map((f) => ({
            folder: f,
            error: isStartupLike ? 'chromadb_not_ready' : msg
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
      const skipped = [];
      const payloads = [];

      // FIX: Check cache first and separate cached vs uncached folders
      const uncachedFolders = [];
      const cachedPayloads = [];

      for (const folder of folders) {
        // Enrich folder text with semantic context for better file type matching
        const folderText = enrichFolderTextForEmbedding(folder.name, folder.description);
        // FIX: Add fallback to default embedding model when none configured
        const { AI_DEFAULTS } = require('../../shared/constants');
        const model = getOllamaEmbeddingModel() || AI_DEFAULTS.EMBEDDING.MODEL;
        const folderId = folder.id || this.generateFolderId(folder);

        if (this._upsertedFolderIds.has(folderId)) {
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
          this._upsertedFolderIds.add(folderId);
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

      // FIX: Use ParallelEmbeddingService for uncached folders
      if (uncachedFolders.length > 0) {
        const { results, errors, stats } = await this.parallelEmbeddingService.batchEmbedFolders(
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

        // FIX: Process results by matching on ID instead of index
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

            // Cache the embedding for future use
            const folderText = [folder.name, folder.description].filter(Boolean).join(' - ');
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
            this._upsertedFolderIds.add(result.id);
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

      // Batch upsert to ChromaDB
      if (payloads.length > 0) {
        await this.chromaDbService.batchUpsertFolders(payloads);
        logger.debug('[FolderMatchingService] Batch upserted folder embeddings', {
          count: payloads.length,
          skipped: skipped.length
        });
      }

      return {
        count: payloads.length,
        skipped,
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
        error?.name === 'ChromaNotFoundError' ||
        /requested resource could not be found/i.test(msg) ||
        /ECONNREFUSED|ENOTFOUND|ETIMEDOUT|EHOSTUNREACH|ENETUNREACH/i.test(msg);

      // During startup, don't spam error logs; treat as deferred/non-fatal.
      if (isStartupLike) {
        logger.warn(
          '[FolderMatchingService] Folder embedding upsert deferred (ChromaDB not ready)',
          {
            error: msg,
            totalFolders: folders?.length || 0
          }
        );
        return {
          count: 0,
          skipped: (folders || []).map((f) => ({ folder: f, error: 'chromadb_not_ready' })),
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
      // CRITICAL FIX: Ensure ChromaDB is initialized before upserting
      if (!this.chromaDbService) {
        throw new Error('ChromaDB service not available');
      }

      await this.chromaDbService.initialize();

      // FIX: Check if existing embedding is better before overwriting
      // This prevents OrganizationSuggestionService (metadata-only) from overwriting
      // high-quality embeddings generated by OllamaDocumentAnalysis (full text)
      if (options.checkExisting) {
        try {
          // Use get() to check metadata without fetching heavy vector
          const existing = await this.chromaDbService.fileCollection.get({
            ids: [fileId],
            include: ['metadatas']
          });

          if (existing && existing.metadatas && existing.metadatas.length > 0) {
            const metadata = existing.metadatas[0] || {};
            const existingMethod = metadata.extractionMethod;
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
            checkError.name === 'ChromaNotFoundError' ||
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
      const expectedDim = getEmbeddingDimension(model);
      if (!validateEmbeddingDimensions(vector, expectedDim)) {
        logger.warn('[FolderMatchingService] Vector dimension mismatch in upsert', {
          id: fileId,
          model,
          expected: expectedDim,
          actual: vector?.length
        });
        // Proceed anyway as it might be a custom model not in our list,
        // but log warning. Or fail? ClusteringService fails on validation.
        // SearchService fails. We should probably fail or at least be very loud.
      }

      await this.chromaDbService.upsertFile({
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
      if (!this.chromaDbService) {
        throw new Error('ChromaDB service not available');
      }

      await this.chromaDbService.initialize();

      const { onProgress = null } = options;
      // FIX: Add fallback to default embedding model when none configured
      const { AI_DEFAULTS } = require('../../shared/constants');
      const model = getOllamaEmbeddingModel() || AI_DEFAULTS.EMBEDDING.MODEL;

      // FIX: Check cache first and separate cached vs uncached files
      const uncachedFiles = [];
      const cachedResults = [];

      for (const item of fileSummaries) {
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

      // FIX: Use ParallelEmbeddingService for uncached files
      if (uncachedFiles.length > 0) {
        const {
          results: embedResults,
          errors,
          stats
        } = await this.parallelEmbeddingService.batchEmbedFileSummaries(
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
      // CRITICAL FIX: Ensure ChromaDB is initialized before querying
      if (!this.chromaDbService) {
        logger.error('[FolderMatchingService] ChromaDB service not available');
        return [];
      }

      // FIX: Validate topK parameter to prevent performance issues
      const MAX_TOP_K = 100;
      const validTopK = Math.max(1, Math.min(Number.isInteger(topK) ? topK : 5, MAX_TOP_K));

      // Ensure ChromaDB is initialized
      await this.chromaDbService.initialize();

      logger.debug('[FolderMatchingService] Querying folder matches', {
        fileId,
        topK: validTopK
      });

      const results = await this.chromaDbService.queryFolders(fileId, validTopK);

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

      return results;
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
      if (!this.chromaDbService) {
        logger.error('[FolderMatchingService] ChromaDB service not available');
        return {};
      }

      await this.chromaDbService.initialize();

      logger.debug('[FolderMatchingService] Batch querying folder matches', {
        fileCount: fileIds.length,
        topK
      });

      return await this.chromaDbService.batchQueryFolders(fileIds, topK);
    } catch (error) {
      logger.error('[FolderMatchingService] Failed to batch match files:', {
        fileCount: fileIds.length,
        error: error.message
      });
      return {};
    }
  }

  /**
   * Match a raw embedding vector to folders
   * @param {Array<number>} vector - Embedding vector
   * @param {number} topK - Number of matches
   * @returns {Promise<Array>} Array of folder matches
   */
  async matchVectorToFolders(vector, topK = 5) {
    try {
      if (!this.chromaDbService) {
        logger.error('[FolderMatchingService] ChromaDB service not available');
        return [];
      }

      await this.chromaDbService.initialize();

      return await this.chromaDbService.queryFoldersByEmbedding(vector, topK);
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
      if (!this.chromaDbService) {
        logger.error('[FolderMatchingService] ChromaDB service not available');
        return [];
      }
      await this.chromaDbService.initialize();

      return await this.chromaDbService.querySimilarFiles(queryVector, topK);
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
      // CRITICAL FIX: Ensure ChromaDB is initialized before accessing collections
      if (!this.chromaDbService) {
        logger.error('[FolderMatchingService] ChromaDB service not available');
        return [];
      }
      await this.chromaDbService.initialize();

      // Get the file's embedding first
      const fileResult = await this.chromaDbService.fileCollection.get({
        ids: [fileId]
      });

      // FIX: Add explicit array check for embeddings
      if (
        !fileResult.embeddings ||
        !Array.isArray(fileResult.embeddings) ||
        fileResult.embeddings.length === 0
      ) {
        logger.warn(
          '[FolderMatchingService] File not found or invalid embeddings for similarity search:',
          fileId
        );
        return [];
      }

      const fileEmbedding = fileResult.embeddings[0];
      return await this.chromaDbService.querySimilarFiles(fileEmbedding, topK);
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
      // CRITICAL FIX: Ensure ChromaDB is initialized
      if (!this.chromaDbService) {
        logger.error('[FolderMatchingService] ChromaDB service not available');
        return [];
      }
      await this.chromaDbService.initialize();

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
              // FIX: Use nullish coalescing to handle score=0 correctly (0 is falsy but valid)
              // FIX: Use /2 for cosine distance range [0,2] -> similarity [0,1]
              const neighborScore = neighbor.score ?? 1 - (neighbor.distance ?? 0) / 2;
              const decayedScore = node.score * neighborScore * clampedDecay ** hop;

              // FIX: Check if already found via different path - update only if better score
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
      // CRITICAL FIX: Check service availability
      if (!this.chromaDbService) {
        logger.warn('[FolderMatchingService] ChromaDB service not available for stats');
        return {
          error: 'Service not available',
          folderCount: 0,
          fileCount: 0,
          lastUpdate: null
        };
      }
      return await this.chromaDbService.getStats();
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
   * Shutdown service and cleanup resources
   * Should be called when the application is closing
   * @returns {Promise<void>}
   */
  async shutdown() {
    // FIX: Unsubscribe from model change events
    if (this._modelChangeUnsubscribe) {
      this._modelChangeUnsubscribe();
      this._modelChangeUnsubscribe = null;
      logger.debug('[FolderMatchingService] Unsubscribed from model changes');
    }

    // FIX: Unsubscribe from invalidation bus
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
    if (folders.length === 0) return category;

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

    if (bestLevenshtein) return bestLevenshtein;

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

    if (bestScore > 0.5 && best) return best;
    return uncategorized?.name || folders[0].name;
  }
}

/**
 * Create a FolderMatchingService instance with default dependencies
 *
 * This factory function creates a FolderMatchingService with the default
 * ChromaDB singleton. Use for simple cases where DI is not needed.
 *
 * @param {Object} options - Configuration options passed to constructor
 * @returns {FolderMatchingService} A new service instance
 */
function createWithDefaults(options = {}) {
  const { getInstance: getChromaDB } = require('./chromadb');
  return new FolderMatchingService(getChromaDB(), options);
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
