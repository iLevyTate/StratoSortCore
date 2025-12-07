const { getOllama, getOllamaEmbeddingModel } = require('../ollamaUtils');
const crypto = require('crypto');
const { logger } = require('../../shared/logger');
logger.setContext('FolderMatchingService');
const EmbeddingCache = require('./EmbeddingCache');
const {
  getInstance: getParallelEmbeddingService,
} = require('./ParallelEmbeddingService');
const { get: getConfig } = require('../../shared/config/index');

/**
 * Embedding dimension constants for different models
 * FIX: Made configurable instead of hardcoding 1024
 * These are the default dimensions for common embedding models
 */
const EMBEDDING_DIMENSIONS = {
  'nomic-embed-text': 768,
  'mxbai-embed-large': 1024,
  'all-minilm': 384,
  'bge-large': 1024,
  default: 1024, // Fallback for unknown models
};

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
    const cacheOptions =
      options.maxCacheSize || options.cacheTtl ? options : {};

    this.chromaDbService = chromaDbService;
    this.ollama = null;
    this.modelName = '';
    this._upsertedFolderIds = new Set();

    // Initialize embedding cache - use injected or create new
    this.embeddingCache =
      options.embeddingCache || new EmbeddingCache(cacheOptions);

    // FIX: Allow concurrency limit to be overridden via options
    // Priority: options.concurrencyLimit > config value > default (5)
    const concurrencyLimit =
      options.concurrencyLimit ?? getConfig('ANALYSIS.maxConcurrency', 5);
    const maxRetries =
      options.maxRetries ?? getConfig('ANALYSIS.retryAttempts', 3);

    // Use injected parallel embedding service or get singleton with configurable values
    this.parallelEmbeddingService =
      options.parallelEmbeddingService ||
      getParallelEmbeddingService({
        concurrencyLimit,
        maxRetries,
      });

    // Store limits for reference/debugging
    this._concurrencyLimit = concurrencyLimit;
    this._maxRetries = maxRetries;
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

    // Fixed: Initialize the embedding cache after construction to prevent orphaned intervals
    if (this.embeddingCache && !this.embeddingCache.initialized) {
      this._initPromise = Promise.resolve().then(() => {
        try {
          this.embeddingCache.initialize();
          logger.info('[FolderMatchingService] Initialized successfully');
        } finally {
          // Keep the promise but mark initialization complete
          this._initializing = false;
        }
      });
      this._initializing = true;
      return this._initPromise;
    }

    return Promise.resolve();
  }

  async embedText(text) {
    const startTime = Date.now();

    try {
      const ollama = getOllama();
      const model = getOllamaEmbeddingModel();

      // Check cache first
      const cachedResult = this.embeddingCache.get(text, model);
      if (cachedResult) {
        const duration = Date.now() - startTime;
        logger.debug(
          `[FolderMatchingService] Embedding retrieved in ${duration}ms (cache: HIT)`,
        );
        return cachedResult;
      }

      // Cache miss - generate embedding via API
      const response = await ollama.embeddings({
        model,
        prompt: text || '',
      });

      let vector = Array.isArray(response.embedding) ? response.embedding : [];
      const expectedDim = getEmbeddingDimension(model);
      if (vector.length < expectedDim) {
        vector = vector.concat(new Array(expectedDim - vector.length).fill(0));
      } else if (vector.length > expectedDim) {
        vector = vector.slice(0, expectedDim);
      }

      const result = { vector, model };

      // Store in cache for future use
      this.embeddingCache.set(text, model, vector);

      const duration = Date.now() - startTime;
      logger.debug(
        `[FolderMatchingService] Embedding generated in ${duration}ms (cache: MISS)`,
      );

      return result;
    } catch (error) {
      logger.error(
        '[FolderMatchingService] Failed to generate embedding:',
        error,
      );
      // FIX: Return a zero vector with dimension based on current model
      // instead of hardcoded 1024 which may mismatch the actual model
      const currentModel = getOllamaEmbeddingModel();
      const dimension = getEmbeddingDimension(currentModel);
      logger.debug(
        '[FolderMatchingService] Using fallback embedding with dimension:',
        {
          model: currentModel,
          dimension,
        },
      );
      return { vector: new Array(dimension).fill(0), model: 'fallback' };
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

      const folderText = [folder.name, folder.description]
        .filter(Boolean)
        .join(' - ');

      const { vector, model } = await this.embedText(folderText);
      const folderId = folder.id || this.generateFolderId(folder);
      if (this._upsertedFolderIds.has(folderId)) {
        logger.debug(
          '[FolderMatchingService] Skipping duplicate folder upsert',
          { id: folderId, name: folder.name },
        );
        return null;
      }

      const payload = {
        id: folderId,
        name: folder.name,
        description: folder.description || '',
        path: folder.path || '',
        vector,
        model,
        updatedAt: new Date().toISOString(),
      };

      await this.chromaDbService.upsertFolder(payload);
      logger.debug('[FolderMatchingService] Upserted folder embedding', {
        id: folderId,
        name: folder.name,
      });
      this._upsertedFolderIds.add(folderId);

      return payload;
    } catch (error) {
      logger.error(
        '[FolderMatchingService] Failed to upsert folder embedding:',
        {
          folderId: folder.id,
          folderName: folder.name,
          error: error.message,
          errorStack: error.stack,
        },
      );
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

      await this.chromaDbService.initialize();

      const { onProgress = null } = options;
      const skipped = [];
      const payloads = [];

      // FIX: Check cache first and separate cached vs uncached folders
      const uncachedFolders = [];
      const cachedPayloads = [];

      for (const folder of folders) {
        const folderText = [folder.name, folder.description]
          .filter(Boolean)
          .join(' - ');
        const model = getOllamaEmbeddingModel();
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
            updatedAt: new Date().toISOString(),
          });
          this._upsertedFolderIds.add(folderId);
        } else {
          uncachedFolders.push(folder);
        }
      }

      logger.debug(
        '[FolderMatchingService] Batch folder embedding cache status',
        {
          total: folders.length,
          cached: cachedPayloads.length,
          uncached: uncachedFolders.length,
        },
      );

      // Add cached payloads to results
      payloads.push(...cachedPayloads);

      // FIX: Use ParallelEmbeddingService for uncached folders
      if (uncachedFolders.length > 0) {
        const { results, errors, stats } =
          await this.parallelEmbeddingService.batchEmbedFolders(
            uncachedFolders.map((folder) => ({
              id: folder.id || this.generateFolderId(folder),
              name: folder.name,
              description: folder.description || '',
              path: folder.path || '',
            })),
            {
              onProgress: onProgress
                ? (progress) => {
                    onProgress({
                      ...progress,
                      phase: 'embedding',
                      cachedCount: cachedPayloads.length,
                    });
                  }
                : null,
            },
          );

        // Process results
        for (let i = 0; i < results.length; i++) {
          const result = results[i];
          if (result && result.success) {
            const folder = uncachedFolders[i];

            // Cache the embedding for future use
            const folderText = [folder.name, folder.description]
              .filter(Boolean)
              .join(' - ');
            this.embeddingCache.set(folderText, result.model, result.vector);

            payloads.push({
              id: result.id,
              name: folder.name,
              description: folder.description || '',
              path: folder.path || '',
              vector: result.vector,
              model: result.model,
              updatedAt: new Date().toISOString(),
            });
            this._upsertedFolderIds.add(result.id);
          }
        }

        // Track errors as skipped
        for (const error of errors) {
          const folder = uncachedFolders.find(
            (f) => (f.id || this.generateFolderId(f)) === error.id,
          );
          skipped.push({ folder, error: error.error });
        }

        logger.info(
          '[FolderMatchingService] Parallel folder embedding complete',
          {
            ...stats,
            cachedCount: cachedPayloads.length,
          },
        );
      }

      // Batch upsert to ChromaDB
      if (payloads.length > 0) {
        await this.chromaDbService.batchUpsertFolders(payloads);
        logger.debug(
          '[FolderMatchingService] Batch upserted folder embeddings',
          {
            count: payloads.length,
            skipped: skipped.length,
          },
        );
      }

      return {
        count: payloads.length,
        skipped,
        stats: {
          total: folders.length,
          cached: cachedPayloads.length,
          generated: payloads.length - cachedPayloads.length,
          failed: skipped.length,
        },
      };
    } catch (error) {
      logger.error(
        '[FolderMatchingService] Failed to batch upsert folder embeddings:',
        {
          totalFolders: folders.length,
          error: error.message,
          errorStack: error.stack,
        },
      );
      throw error;
    }
  }

  async upsertFileEmbedding(fileId, contentSummary, fileMeta = {}) {
    try {
      // CRITICAL FIX: Ensure ChromaDB is initialized before upserting
      if (!this.chromaDbService) {
        throw new Error('ChromaDB service not available');
      }

      await this.chromaDbService.initialize();

      const { vector, model } = await this.embedText(contentSummary || '');

      await this.chromaDbService.upsertFile({
        id: fileId,
        vector,
        model,
        meta: fileMeta,
        updatedAt: new Date().toISOString(),
      });

      logger.debug('[FolderMatchingService] Upserted file embedding', {
        id: fileId,
        path: fileMeta.path,
        vectorLength: vector.length,
      });
    } catch (error) {
      logger.error('[FolderMatchingService] Failed to upsert file embedding:', {
        fileId,
        filePath: fileMeta.path,
        error: error.message,
        errorStack: error.stack,
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
      const model = getOllamaEmbeddingModel();

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
            success: true,
          });
        } else {
          uncachedFiles.push(item);
        }
      }

      logger.debug(
        '[FolderMatchingService] Batch file embedding cache status',
        {
          total: fileSummaries.length,
          cached: cachedResults.length,
          uncached: uncachedFiles.length,
        },
      );

      const results = [...cachedResults];
      const skipped = [];

      // FIX: Use ParallelEmbeddingService for uncached files
      if (uncachedFiles.length > 0) {
        const {
          results: embedResults,
          errors,
          stats,
        } = await this.parallelEmbeddingService.batchEmbedFileSummaries(
          uncachedFiles.map((item) => ({
            fileId: item.fileId,
            summary: item.summary || '',
            filePath: item.meta?.path || '',
            meta: item.meta || {},
          })),
          {
            onProgress: onProgress
              ? (progress) => {
                  onProgress({
                    ...progress,
                    phase: 'embedding',
                    cachedCount: cachedResults.length,
                  });
                }
              : null,
          },
        );

        // Process results and update cache
        for (const result of embedResults) {
          if (result && result.success) {
            const originalItem = uncachedFiles.find(
              (f) => f.fileId === result.id,
            );

            // Cache the embedding for future use
            if (originalItem) {
              this.embeddingCache.set(
                originalItem.summary || '',
                result.model,
                result.vector,
              );
            }

            results.push({
              fileId: result.id,
              vector: result.vector,
              model: result.model,
              meta: result.meta || {},
              success: true,
            });
          }
        }

        // Track errors as skipped
        for (const error of errors) {
          skipped.push({ fileId: error.id, error: error.error });
        }

        logger.info(
          '[FolderMatchingService] Parallel file embedding complete',
          {
            ...stats,
            cachedCount: cachedResults.length,
          },
        );
      }

      logger.debug('[FolderMatchingService] Batch generated file embeddings', {
        total: fileSummaries.length,
        success: results.length,
        skipped: skipped.length,
      });

      return {
        results,
        skipped,
        stats: {
          total: fileSummaries.length,
          cached: cachedResults.length,
          generated: results.length - cachedResults.length,
          failed: skipped.length,
        },
      };
    } catch (error) {
      logger.error(
        '[FolderMatchingService] Failed to batch generate file embeddings:',
        {
          totalFiles: fileSummaries.length,
          error: error.message,
        },
      );
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
      const validTopK = Math.max(
        1,
        Math.min(Number.isInteger(topK) ? topK : 5, MAX_TOP_K),
      );

      // Ensure ChromaDB is initialized
      await this.chromaDbService.initialize();

      logger.debug('[FolderMatchingService] Querying folder matches', {
        fileId,
        topK: validTopK,
      });

      const results = await this.chromaDbService.queryFolders(
        fileId,
        validTopK,
      );

      if (!Array.isArray(results)) {
        logger.warn('[FolderMatchingService] Invalid results format', {
          fileId,
          resultsType: typeof results,
        });
        return [];
      }

      logger.debug('[FolderMatchingService] Folder matching results', {
        fileId,
        resultCount: results.length,
        topScore: results[0]?.score,
      });

      return results;
    } catch (error) {
      logger.error('[FolderMatchingService] Failed to match file to folders:', {
        fileId,
        topK,
        error: error.message,
        errorStack: error.stack,
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
        topK,
      });

      return await this.chromaDbService.batchQueryFolders(fileIds, topK);
    } catch (error) {
      logger.error('[FolderMatchingService] Failed to batch match files:', {
        fileCount: fileIds.length,
        error: error.message,
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
      logger.error(
        '[FolderMatchingService] Failed to match vector to folders:',
        {
          error: error.message,
        },
      );
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
        ids: [fileId],
      });

      // FIX: Add explicit array check for embeddings
      if (
        !fileResult.embeddings ||
        !Array.isArray(fileResult.embeddings) ||
        fileResult.embeddings.length === 0
      ) {
        logger.warn(
          '[FolderMatchingService] File not found or invalid embeddings for similarity search:',
          fileId,
        );
        return [];
      }

      const fileEmbedding = fileResult.embeddings[0];
      return await this.chromaDbService.querySimilarFiles(fileEmbedding, topK);
    } catch (error) {
      logger.error(
        '[FolderMatchingService] Failed to find similar files:',
        error,
      );
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
        logger.warn(
          '[FolderMatchingService] ChromaDB service not available for stats',
        );
        return {
          error: 'Service not available',
          folderCount: 0,
          fileCount: 0,
          lastUpdate: null,
        };
      }
      return await this.chromaDbService.getStats();
    } catch (error) {
      logger.error('[FolderMatchingService] Failed to get stats:', error);
      return {
        error: error.message,
        folderCount: 0,
        fileCount: 0,
        lastUpdate: null,
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
    if (this.embeddingCache) {
      logger.info('[FolderMatchingService] Shutting down embedding cache');
      await this.embeddingCache.shutdown();
    }
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

module.exports = FolderMatchingService;
module.exports.FolderMatchingService = FolderMatchingService;
module.exports.createWithDefaults = createWithDefaults;
