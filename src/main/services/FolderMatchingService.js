const { getOllama, getOllamaEmbeddingModel } = require('../ollamaUtils');
const crypto = require('crypto');
const { logger } = require('../../shared/logger');
logger.setContext('FolderMatchingService');
const EmbeddingCache = require('./EmbeddingCache');

class FolderMatchingService {
  constructor(chromaDbService, cacheOptions = {}) {
    this.chromaDbService = chromaDbService;
    this.ollama = null;
    this.modelName = '';

    // Initialize embedding cache for performance optimization
    this.embeddingCache = new EmbeddingCache(cacheOptions);
  }

  /**
   * Initialize the service and its resources
   * Should be called after construction and successful service setup
   * FIX: Made thread-safe with initialization lock to prevent race conditions
   */
  initialize() {
    // FIX: Use synchronous lock check to prevent multiple concurrent initializations
    if (this._initializing) {
      logger.debug(
        '[FolderMatchingService] Initialization already in progress, skipping',
      );
      return;
    }

    // Fixed: Initialize the embedding cache after construction to prevent orphaned intervals
    if (this.embeddingCache && !this.embeddingCache.initialized) {
      this._initializing = true;
      try {
        this.embeddingCache.initialize();
        logger.info('[FolderMatchingService] Initialized successfully');
      } finally {
        this._initializing = false;
      }
    }
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

      const result = { vector: response.embedding, model };

      // Store in cache for future use
      this.embeddingCache.set(text, model, response.embedding);

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
      // Return a zero vector as fallback
      return { vector: new Array(1024).fill(0), model: 'fallback' };
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
   * @param {Array<Object>} folders - Array of folders to upsert
   * @returns {Promise<Object>} Result with count and skipped items
   */
  async batchUpsertFolders(folders) {
    try {
      if (!folders || folders.length === 0) {
        return { count: 0, skipped: [] };
      }

      // CRITICAL FIX: Ensure ChromaDB is initialized before upserting
      if (!this.chromaDbService) {
        throw new Error('ChromaDB service not available');
      }

      await this.chromaDbService.initialize();

      // Process embeddings in parallel with concurrency limit
      // We use a limit to avoid overwhelming Ollama
      const CONCURRENCY_LIMIT = 3;
      const payloads = [];
      const skipped = [];

      // Helper for batched processing
      const processBatch = async (batch) => {
        const promises = batch.map(async (folder) => {
          try {
            const folderText = [folder.name, folder.description]
              .filter(Boolean)
              .join(' - ');

            const { vector, model } = await this.embedText(folderText);
            const folderId = folder.id || this.generateFolderId(folder);

            return {
              id: folderId,
              name: folder.name,
              description: folder.description || '',
              path: folder.path || '',
              vector,
              model,
              updatedAt: new Date().toISOString(),
            };
          } catch (error) {
            logger.warn(
              `[FolderMatchingService] Failed to generate embedding for folder: ${folder.name}`,
              { error: error.message },
            );
            skipped.push({ folder, error: error.message });
            return null;
          }
        });
        return Promise.all(promises);
      };

      // Process in chunks
      for (let i = 0; i < folders.length; i += CONCURRENCY_LIMIT) {
        const batch = folders.slice(i, i + CONCURRENCY_LIMIT);
        const results = await processBatch(batch);
        payloads.push(...results.filter(Boolean));
      }

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

      return { count: payloads.length, skipped };
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

  async matchFileToFolders(fileId, topK = 5) {
    try {
      // CRITICAL FIX: Ensure ChromaDB is initialized before querying
      if (!this.chromaDbService) {
        logger.error('[FolderMatchingService] ChromaDB service not available');
        return [];
      }

      // Ensure ChromaDB is initialized
      await this.chromaDbService.initialize();

      logger.debug('[FolderMatchingService] Querying folder matches', {
        fileId,
        topK,
      });

      const results = await this.chromaDbService.queryFolders(fileId, topK);

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
      // Get the file's embedding first
      const fileResult = await this.chromaDbService.fileCollection.get({
        ids: [fileId],
      });

      if (!fileResult.embeddings || fileResult.embeddings.length === 0) {
        logger.warn(
          '[FolderMatchingService] File not found for similarity search:',
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
   */
  shutdown() {
    if (this.embeddingCache) {
      logger.info('[FolderMatchingService] Shutting down embedding cache');
      this.embeddingCache.shutdown();
    }
  }
}

module.exports = FolderMatchingService;
