/**
 * ChromaDB File Operations
 *
 * File embedding operations for ChromaDB.
 * Extracted from ChromaDBService for better maintainability.
 *
 * @module services/chromadb/fileOperations
 */

const { logger } = require('../../../shared/logger');
const { withRetry } = require('../../../shared/errorHandlingUtils');
const { sanitizeMetadata } = require('../../../shared/pathSanitization');
const { OperationType } = require('../../utils/OfflineQueue');

logger.setContext('ChromaDB:FileOps');

/**
 * Direct upsert file without circuit breaker (used by queue flush)
 *
 * @param {Object} params - Parameters
 * @param {Object} params.file - File object with id, vector, meta
 * @param {Object} params.fileCollection - ChromaDB file collection
 * @param {Object} params.queryCache - Query cache instance
 * @returns {Promise<void>}
 */
async function directUpsertFile({ file, fileCollection, queryCache }) {
  return withRetry(
    async () => {
      try {
        // Sanitize metadata to prevent injection and bloat
        const baseMetadata = {
          path: file.meta?.path || '',
          name: file.meta?.name || '',
          model: file.model || '',
          updatedAt: file.updatedAt || new Date().toISOString()
        };

        // Merge with sanitized additional metadata (filters dangerous fields)
        const sanitized = sanitizeMetadata({
          ...baseMetadata,
          ...file.meta
        });

        // ChromaDB expects embeddings as arrays
        await fileCollection.upsert({
          ids: [file.id],
          embeddings: [file.vector],
          metadatas: [sanitized],
          documents: [sanitized.path || file.id]
        });

        // Invalidate query cache entries that might reference this file
        if (queryCache) {
          queryCache.invalidateForFile(file.id);
        }

        logger.debug('[FileOps] Upserted file embedding', {
          id: file.id,
          path: sanitized.path
        });
      } catch (error) {
        logger.error('[FileOps] Failed to upsert file with context:', {
          operation: 'upsert-file',
          fileId: file.id,
          filePath: file.meta?.path,
          fileName: file.meta?.name,
          timestamp: new Date().toISOString(),
          error: error.message,
          errorStack: error.stack
        });
        throw error;
      }
    },
    { maxRetries: 3, initialDelay: 500 }
  )();
}

/**
 * Direct batch upsert files without circuit breaker
 *
 * @param {Object} params - Parameters
 * @param {Array<Object>} params.files - Array of file objects
 * @param {Object} params.fileCollection - ChromaDB file collection
 * @param {Object} params.queryCache - Query cache instance
 * @returns {Promise<number>} Number of successfully upserted files
 */
async function directBatchUpsertFiles({ files, fileCollection, queryCache }) {
  return withRetry(
    async () => {
      const ids = [];
      const embeddings = [];
      const metadatas = [];
      const documents = [];

      try {
        for (const file of files) {
          if (!file.id || !file.vector || !Array.isArray(file.vector)) {
            logger.warn('[FileOps] Skipping invalid file in batch', {
              id: file.id
            });
            continue;
          }

          const baseMetadata = {
            path: file.meta?.path || '',
            name: file.meta?.name || '',
            model: file.model || '',
            updatedAt: file.updatedAt || new Date().toISOString()
          };

          const sanitized = sanitizeMetadata({
            ...baseMetadata,
            ...file.meta
          });

          ids.push(file.id);
          embeddings.push(file.vector);
          metadatas.push(sanitized);
          documents.push(sanitized.path || file.id);
        }

        if (ids.length > 0) {
          await fileCollection.upsert({
            ids,
            embeddings,
            metadatas,
            documents
          });

          // Invalidate cache for all affected files
          if (queryCache) {
            ids.forEach((id) => queryCache.invalidateForFile(id));
          }

          logger.info('[FileOps] Batch upserted file embeddings', {
            count: ids.length
          });
        }

        return ids.length;
      } catch (error) {
        logger.error('[FileOps] Failed to batch upsert files with context:', {
          operation: 'batch-upsert-files',
          totalFiles: files.length,
          successfulCount: ids.length,
          timestamp: new Date().toISOString(),
          error: error.message,
          errorStack: error.stack
        });
        throw error;
      }
    },
    { maxRetries: 3, initialDelay: 500 }
  )();
}

/**
 * Delete a file embedding from the database
 *
 * @param {Object} params - Parameters
 * @param {string} params.fileId - The file ID to delete
 * @param {Object} params.fileCollection - ChromaDB file collection
 * @param {Object} params.queryCache - Query cache instance
 * @returns {Promise<boolean>} True if deleted
 */
async function deleteFileEmbedding({ fileId, fileCollection, queryCache }) {
  try {
    await fileCollection.delete({ ids: [fileId] });

    // Invalidate cache
    if (queryCache) {
      queryCache.invalidateForFile(fileId);
    }

    logger.debug('[FileOps] Deleted file embedding', { fileId });
    return true;
  } catch (error) {
    logger.error('[FileOps] Failed to delete file embedding:', {
      fileId,
      error: error.message
    });
    return false;
  }
}

/**
 * Batch delete file embeddings
 *
 * @param {Object} params - Parameters
 * @param {Array<string>} params.fileIds - Array of file IDs to delete
 * @param {Object} params.fileCollection - ChromaDB file collection
 * @param {Object} params.queryCache - Query cache instance
 * @returns {Promise<number>} Number of deleted files
 */
async function batchDeleteFileEmbeddings({ fileIds, fileCollection, queryCache }) {
  if (!fileIds || fileIds.length === 0) {
    return 0;
  }

  try {
    await fileCollection.delete({ ids: fileIds });

    // Invalidate cache for all
    if (queryCache) {
      fileIds.forEach((id) => queryCache.invalidateForFile(id));
    }

    logger.info('[FileOps] Batch deleted file embeddings', {
      count: fileIds.length
    });
    return fileIds.length;
  } catch (error) {
    logger.error('[FileOps] Failed to batch delete file embeddings:', {
      count: fileIds.length,
      error: error.message
    });
    throw error;
  }
}

/**
 * Update file paths in batch after file organization
 *
 * @param {Object} params - Parameters
 * @param {Array<Object>} params.pathUpdates - Array of path update objects
 * @param {Object} params.fileCollection - ChromaDB file collection
 * @param {Object} params.queryCache - Query cache instance
 * @returns {Promise<number>} Number of successfully updated files
 */
async function updateFilePaths({ pathUpdates, fileCollection, queryCache }) {
  if (!pathUpdates || pathUpdates.length === 0) {
    return 0;
  }

  let updatedCount = 0;

  try {
    // Process updates in batches
    const BATCH_SIZE = 50;
    for (let i = 0; i < pathUpdates.length; i += BATCH_SIZE) {
      const batch = pathUpdates.slice(i, i + BATCH_SIZE);
      const updatesToProcess = [];

      for (const update of batch) {
        if (!update.oldId || !update.newId) {
          logger.warn('[FileOps] Skipping invalid path update', {
            oldId: update.oldId,
            newId: update.newId
          });
          continue;
        }

        try {
          const existingFile = await fileCollection.get({
            ids: [update.oldId],
            include: ['embeddings', 'metadatas', 'documents']
          });

          if (
            existingFile &&
            existingFile.ids &&
            existingFile.ids.length > 0 &&
            existingFile.embeddings &&
            existingFile.embeddings.length > 0
          ) {
            const existingMeta = existingFile.metadatas?.[0] || {};
            const updatedMeta = sanitizeMetadata({
              ...existingMeta,
              ...update.newMeta,
              path: update.newMeta.path || existingMeta.path,
              name: update.newMeta.name || existingMeta.name,
              updatedAt: new Date().toISOString()
            });

            updatesToProcess.push({
              id: update.newId,
              embedding: existingFile.embeddings[0],
              metadata: updatedMeta,
              document: update.newMeta.path || update.newId
            });

            // Delete old entry if ID changed
            if (update.oldId !== update.newId) {
              try {
                await fileCollection.delete({ ids: [update.oldId] });
                logger.debug('[FileOps] Deleted old file entry', {
                  oldId: update.oldId
                });
              } catch (deleteError) {
                logger.debug('[FileOps] Could not delete old file entry', {
                  oldId: update.oldId,
                  error: deleteError.message
                });
              }
            }
          } else {
            logger.warn('[FileOps] File not found for path update', {
              oldId: update.oldId
            });
          }
        } catch (getError) {
          logger.warn('[FileOps] Error getting file for path update', {
            oldId: update.oldId,
            error: getError.message
          });
        }
      }

      // Batch upsert updated files
      if (updatesToProcess.length > 0) {
        await fileCollection.upsert({
          ids: updatesToProcess.map((u) => u.id),
          embeddings: updatesToProcess.map((u) => u.embedding),
          metadatas: updatesToProcess.map((u) => u.metadata),
          documents: updatesToProcess.map((u) => u.document)
        });

        // Invalidate cache for all affected files
        if (queryCache) {
          updatesToProcess.forEach((u) => {
            queryCache.invalidateForFile(u.id);
            // Also invalidate any old IDs to avoid stale entries
            // (oldId was deleted above when different from newId)
          });
          pathUpdates.forEach((u) => {
            if (u.oldId && u.oldId !== u.newId) {
              queryCache.invalidateForFile(u.oldId);
            }
          });
        }

        updatedCount += updatesToProcess.length;
        logger.debug('[FileOps] Batch updated file paths', {
          count: updatesToProcess.length,
          batch: i / BATCH_SIZE + 1
        });
      }
    }

    logger.info('[FileOps] Batch updated file paths', {
      total: pathUpdates.length,
      updated: updatedCount
    });

    return updatedCount;
  } catch (error) {
    logger.error('[FileOps] Failed to update file paths', {
      error: error.message,
      errorStack: error.stack,
      totalUpdates: pathUpdates.length,
      updatedCount
    });
    throw error;
  }
}

/**
 * Query files for similarity search
 *
 * @param {Object} params - Parameters
 * @param {Array} params.queryEmbedding - The embedding vector to search for
 * @param {number} params.topK - Number of results to return
 * @param {Object} params.fileCollection - ChromaDB file collection
 * @returns {Promise<Array>} Similar files with scores
 */
async function querySimilarFiles({ queryEmbedding, topK = 10, fileCollection }) {
  try {
    const results = await fileCollection.query({
      queryEmbeddings: [queryEmbedding],
      nResults: topK
    });

    if (!results.ids || !results.ids[0] || results.ids[0].length === 0) {
      return [];
    }

    // Validate result arrays exist and have matching lengths
    const ids = results.ids[0];
    const distances = results.distances?.[0] || [];
    const metadatas = results.metadatas?.[0] || [];
    const documents = results.documents?.[0] || [];

    const matches = [];
    for (let i = 0; i < ids.length; i++) {
      const distance = i < distances.length ? distances[i] : 1;
      const metadata = i < metadatas.length ? metadatas[i] : {};
      const document = i < documents.length ? documents[i] : '';

      // Convert distance to similarity score
      const score = Math.max(0, 1 - distance / 2);

      matches.push({
        id: ids[i],
        score,
        metadata,
        document
      });
    }

    return matches.sort((a, b) => b.score - a.score);
  } catch (error) {
    logger.error('[FileOps] Failed to query similar files:', error);
    return [];
  }
}

/**
 * Reset all file embeddings
 *
 * @param {Object} params - Parameters
 * @param {Object} params.client - ChromaDB client
 * @returns {Promise<Object>} New file collection
 */
async function resetFiles({ client }) {
  try {
    await client.deleteCollection({ name: 'file_embeddings' });

    const fileCollection = await client.createCollection({
      name: 'file_embeddings',
      metadata: {
        description: 'Document and image file embeddings for semantic search',
        hnsw_space: 'cosine',
        'hnsw:space': 'cosine' // Keep for backward compatibility with existing collections
      }
    });

    logger.info('[FileOps] Reset file embeddings collection');
    return fileCollection;
  } catch (error) {
    logger.error('[FileOps] Failed to reset files:', error);
    throw error;
  }
}

module.exports = {
  directUpsertFile,
  directBatchUpsertFiles,
  deleteFileEmbedding,
  batchDeleteFileEmbeddings,
  updateFilePaths,
  querySimilarFiles,
  resetFiles,
  OperationType
};
