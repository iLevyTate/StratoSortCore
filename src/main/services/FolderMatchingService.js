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
   */
  initialize() {
    // Fixed: Initialize the embedding cache after construction to prevent orphaned intervals
    if (this.embeddingCache && !this.embeddingCache.initialized) {
      this.embeddingCache.initialize();
      logger.info('[FolderMatchingService] Initialized successfully');
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
   */
  generateFolderId(folder) {
    const uniqueString = `${folder.name}|${folder.path || ''}|${folder.description || ''}`;
    return `folder:${crypto.createHash('md5').update(uniqueString).digest('hex')}`;
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
