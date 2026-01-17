/**
 * ChromaDB File Operations
 *
 * File embedding operations for ChromaDB.
 * Extracted from ChromaDBService for better maintainability.
 *
 * @module services/chromadb/fileOperations
 */

const { logger } = require('../../../shared/logger');
const { buildLogMeta } = require('../../../shared/loggingStandards');
const { withRetry } = require('../../../shared/errorHandlingUtils');
const { prepareFileMetadata, sanitizeMetadata } = require('../../../shared/pathSanitization');
const { normalizeEmbeddingMetadata } = require('../../../shared/normalization');
const { embeddingMetaSchema, validateSchema } = require('../../../shared/normalization/schemas');
const { OperationType } = require('../../utils/OfflineQueue');

logger.setContext('ChromaDB:FileOps');

/**
 * Validate embedding vector for NaN, Infinity, and dimension issues
 * FIX: Prevents corrupted embeddings from being stored in ChromaDB
 *
 * @param {Array<number>} vector - Embedding vector to validate
 * @param {string} [context] - Optional context for error messages
 * @returns {{ valid: boolean, error?: string, index?: number }}
 */
function validateEmbeddingVector(vector, context = 'unknown') {
  if (!Array.isArray(vector)) {
    return { valid: false, error: 'not_array' };
  }
  if (vector.length === 0) {
    return { valid: false, error: 'empty_vector' };
  }
  // Check for NaN or Infinity values
  for (let i = 0; i < vector.length; i++) {
    if (!Number.isFinite(vector[i])) {
      logger.warn(`[FileOps] Invalid vector value at index ${i}`, {
        context,
        value: String(vector[i]),
        vectorLength: vector.length
      });
      return { valid: false, error: 'invalid_value', index: i };
    }
  }
  return { valid: true };
}

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
        // FIX: Validate vector before upsert to prevent corrupted embeddings
        const validation = validateEmbeddingVector(file.vector, file.id);
        if (!validation.valid) {
          throw new Error(
            `Invalid embedding vector for file ${file.id}: ${validation.error}${validation.index !== undefined ? ` at index ${validation.index}` : ''}`
          );
        }

        const metaCandidate = {
          ...(file.meta || {}),
          model: file.model,
          updatedAt: file.updatedAt
        };
        const normalizedMeta = normalizeEmbeddingMetadata(metaCandidate);
        const metaValidation = validateSchema(embeddingMetaSchema, normalizedMeta);
        if (!metaValidation.valid) {
          logger.warn('[FileOps] Invalid metadata shape in upsertFile', {
            fileId: file.id,
            error: metaValidation.error?.message
          });
        }
        const sanitized = prepareFileMetadata({
          ...file,
          meta: metaValidation.data || normalizedMeta
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
        logger.error(
          '[FileOps] Failed to upsert file with context:',
          buildLogMeta({
            component: 'ChromaDB:FileOps',
            operation: 'upsert-file',
            fileId: file.id,
            filePath: file.meta?.path,
            fileName: file.meta?.name,
            error: error.message,
            errorStack: error.stack
          })
        );
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

      // FIX: Track seen IDs to prevent duplicate ID error from ChromaDB
      // This can happen when SmartFolderWatcher detects the same file multiple times
      // or when rebuild processes include duplicates
      const seenIds = new Set();
      let duplicateCount = 0;

      try {
        for (const file of files) {
          if (!file.id || !file.vector || !Array.isArray(file.vector)) {
            logger.warn('[FileOps] Skipping invalid file in batch', {
              id: file.id
            });
            continue;
          }

          // FIX: Skip duplicate IDs - ChromaDB requires unique IDs in batch
          if (seenIds.has(file.id)) {
            duplicateCount++;
            logger.debug('[FileOps] Skipping duplicate file ID in batch', {
              id: file.id
            });
            continue;
          }
          seenIds.add(file.id);

          // FIX: Validate vector for NaN/Infinity before including in batch
          const validation = validateEmbeddingVector(file.vector, file.id);
          if (!validation.valid) {
            logger.warn('[FileOps] Skipping file with invalid vector in batch', {
              id: file.id,
              error: validation.error,
              index: validation.index
            });
            continue;
          }

          const metaCandidate = {
            ...(file.meta || {}),
            model: file.model || '',
            updatedAt: file.updatedAt || new Date().toISOString()
          };
          const normalizedMeta = normalizeEmbeddingMetadata(metaCandidate);
          const metaValidation = validateSchema(embeddingMetaSchema, normalizedMeta);
          if (!metaValidation.valid) {
            logger.warn('[FileOps] Invalid metadata shape in batch upsert', {
              id: file.id,
              error: metaValidation.error?.message
            });
          }
          const sanitized = sanitizeMetadata(metaValidation.data || normalizedMeta);

          ids.push(file.id);
          embeddings.push(file.vector);
          metadatas.push(sanitized);
          documents.push(sanitized.path || file.id);
        }

        // Log if duplicates were found
        if (duplicateCount > 0) {
          logger.info('[FileOps] Deduplicated batch before upsert', {
            originalCount: files.length,
            uniqueCount: ids.length,
            duplicatesRemoved: duplicateCount
          });
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
 * FIX: Returns structured result with error details for better caller awareness
 *
 * @param {Object} params - Parameters
 * @param {string} params.fileId - The file ID to delete
 * @param {Object} params.fileCollection - ChromaDB file collection
 * @param {Object} params.queryCache - Query cache instance
 * @returns {Promise<{success: boolean, notFound?: boolean, error?: string}>} Result object
 */
async function deleteFileEmbedding({ fileId, fileCollection, queryCache }) {
  try {
    await fileCollection.delete({ ids: [fileId] });

    // Invalidate cache
    if (queryCache) {
      queryCache.invalidateForFile(fileId);
    }

    logger.debug('[FileOps] Deleted file embedding', { fileId });
    return { success: true };
  } catch (error) {
    // Check if it's a "not found" error (acceptable - file wasn't indexed)
    const errorMsg = error.message?.toLowerCase() || '';
    if (errorMsg.includes('not found') || error.code === 'NOT_FOUND') {
      logger.debug('[FileOps] File embedding not found (already deleted or never indexed)', {
        fileId
      });
      return { success: true, notFound: true };
    }

    // Log and return failure for other errors
    logger.error('[FileOps] Failed to delete file embedding:', {
      fileId,
      error: error.message
    });

    // FIX: Return structured error instead of just false
    return { success: false, error: error.message };
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
      // FIX: Track old IDs for deletion AFTER upsert to prevent data loss on crash
      const oldIdsToDelete = [];

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

            // FIX: Collect old IDs for deletion AFTER upsert (prevents data loss)
            // Only if ID actually changed
            if (update.oldId !== update.newId) {
              oldIdsToDelete.push(update.oldId);
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

      // FIX: UPSERT new entries FIRST to ensure data is never lost
      // If crash occurs after upsert but before delete, we get temporary duplicates
      // which are harmless and will be cleaned by reconciliation
      if (updatesToProcess.length > 0) {
        await fileCollection.upsert({
          ids: updatesToProcess.map((u) => u.id),
          embeddings: updatesToProcess.map((u) => u.embedding),
          metadatas: updatesToProcess.map((u) => u.metadata),
          documents: updatesToProcess.map((u) => u.document)
        });

        // FIX: DELETE old entries AFTER successful upsert
        // This order guarantees we never lose data even on crash
        if (oldIdsToDelete.length > 0) {
          try {
            await fileCollection.delete({ ids: oldIdsToDelete });
            logger.debug('[FileOps] Deleted old file entries after upsert', {
              count: oldIdsToDelete.length
            });
          } catch (deleteError) {
            // Log but don't fail - reconciliation will clean duplicates later
            logger.warn('[FileOps] Could not delete old entries after upsert', {
              count: oldIdsToDelete.length,
              error: deleteError.message
            });
          }
        }

        // Invalidate cache for all affected files
        if (queryCache) {
          updatesToProcess.forEach((u) => {
            queryCache.invalidateForFile(u.id);
          });
          oldIdsToDelete.forEach((oldId) => {
            queryCache.invalidateForFile(oldId);
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
    // Check collection count before querying
    const count = await fileCollection.count();
    logger.debug(`[FileOps] Querying collection with ${count} embeddings, topK=${topK}`);

    if (count === 0) {
      logger.warn('[FileOps] Collection is empty - no embeddings to search');
      return [];
    }

    const results = await fileCollection.query({
      queryEmbeddings: [queryEmbedding],
      nResults: topK
    });

    if (!results.ids || !results.ids[0] || results.ids[0].length === 0) {
      logger.debug('[FileOps] Query returned no matching results');
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

    const sorted = matches.sort((a, b) => b.score - a.score);
    logger.debug('[FileOps] Top file matches', {
      top: sorted.slice(0, 3).map((m) => ({
        score: m.score?.toFixed?.(3),
        id: m.id?.split(/[\\/]/).pop()
      }))
    });

    return sorted;
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
 * @param {Object} [params.embeddingFunction] - Embedding function to prevent DefaultEmbeddingFunction instantiation
 * @returns {Promise<Object>} New file collection
 */
async function resetFiles({ client, embeddingFunction }) {
  try {
    await client.deleteCollection({ name: 'file_embeddings' });

    const fileCollection = await client.createCollection({
      name: 'file_embeddings',
      embeddingFunction,
      metadata: {
        description: 'Document and image file embeddings for semantic search',
        'hnsw:space': 'cosine' // Correct ChromaDB API syntax (not hnsw_space)
      }
    });

    logger.info('[FileOps] Reset file embeddings collection');
    return fileCollection;
  } catch (error) {
    logger.error('[FileOps] Failed to reset files:', error);
    throw error;
  }
}

/**
 * Mark file embeddings as orphaned (soft delete) by updating their metadata
 * This is used when analysis history entries are pruned but we want to preserve
 * embeddings for potential recovery or deferred cleanup.
 *
 * FIX: Prevents orphaned embeddings from accumulating unbounded storage
 *
 * @param {Object} params - Parameters
 * @param {Array<string>} params.fileIds - Array of file IDs to mark as orphaned
 * @param {Object} params.fileCollection - ChromaDB file collection
 * @param {Object} params.queryCache - Query cache instance
 * @returns {Promise<{ marked: number, failed: number }>}
 */
async function markEmbeddingsOrphaned({ fileIds, fileCollection, queryCache }) {
  if (!fileIds || fileIds.length === 0) {
    return { marked: 0, failed: 0 };
  }

  let marked = 0;
  let failed = 0;

  try {
    // Process in batches to avoid overwhelming ChromaDB
    const BATCH_SIZE = 50;
    for (let i = 0; i < fileIds.length; i += BATCH_SIZE) {
      const batch = fileIds.slice(i, i + BATCH_SIZE);

      try {
        // Get existing embeddings to update their metadata
        const existing = await fileCollection.get({
          ids: batch,
          include: ['embeddings', 'metadatas', 'documents']
        });

        if (!existing?.ids || existing.ids.length === 0) {
          continue;
        }

        // Update metadata to mark as orphaned
        const updatedIds = [];
        const updatedEmbeddings = [];
        const updatedMetadatas = [];
        const updatedDocuments = [];

        for (let j = 0; j < existing.ids.length; j++) {
          const existingMeta = existing.metadatas?.[j] || {};
          const embedding = existing.embeddings?.[j];
          const document = existing.documents?.[j];

          if (!embedding) continue;

          updatedIds.push(existing.ids[j]);
          updatedEmbeddings.push(embedding);
          updatedMetadatas.push(
            sanitizeMetadata({
              ...existingMeta,
              orphaned: 'true',
              orphanedAt: new Date().toISOString()
            })
          );
          updatedDocuments.push(document || existing.ids[j]);
        }

        if (updatedIds.length > 0) {
          await fileCollection.upsert({
            ids: updatedIds,
            embeddings: updatedEmbeddings,
            metadatas: updatedMetadatas,
            documents: updatedDocuments
          });
          marked += updatedIds.length;

          // Invalidate cache for all marked files
          if (queryCache) {
            updatedIds.forEach((id) => queryCache.invalidateForFile(id));
          }
        }
      } catch (batchError) {
        logger.warn('[FileOps] Failed to mark batch as orphaned:', {
          batchStart: i,
          error: batchError.message
        });
        failed += batch.length;
      }
    }

    if (marked > 0) {
      logger.info('[FileOps] Marked file embeddings as orphaned', {
        marked,
        failed,
        total: fileIds.length
      });
    }

    return { marked, failed };
  } catch (error) {
    logger.error('[FileOps] Failed to mark embeddings as orphaned:', {
      count: fileIds.length,
      error: error.message
    });
    return { marked, failed: fileIds.length - marked };
  }
}

/**
 * Get all orphaned embeddings (for cleanup operations)
 *
 * @param {Object} params - Parameters
 * @param {Object} params.fileCollection - ChromaDB file collection
 * @param {number} [params.maxAge] - Maximum age in milliseconds (optional, filters by orphanedAt)
 * @returns {Promise<Array<string>>} Array of orphaned file IDs
 */
async function getOrphanedEmbeddings({ fileCollection, maxAge }) {
  try {
    // Query for orphaned embeddings using where filter
    const results = await fileCollection.get({
      where: { orphaned: 'true' },
      include: ['metadatas']
    });

    if (!results?.ids || results.ids.length === 0) {
      return [];
    }

    // If maxAge specified, filter by orphanedAt timestamp
    if (maxAge && typeof maxAge === 'number') {
      const cutoffTime = Date.now() - maxAge;
      const filteredIds = [];

      for (let i = 0; i < results.ids.length; i++) {
        const meta = results.metadatas?.[i];
        if (meta?.orphanedAt) {
          const orphanedTime = new Date(meta.orphanedAt).getTime();
          if (orphanedTime <= cutoffTime) {
            filteredIds.push(results.ids[i]);
          }
        } else {
          // No timestamp, include it (legacy orphaned entry)
          filteredIds.push(results.ids[i]);
        }
      }

      return filteredIds;
    }

    return results.ids;
  } catch (error) {
    logger.error('[FileOps] Failed to get orphaned embeddings:', {
      error: error.message
    });
    return [];
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
  markEmbeddingsOrphaned,
  getOrphanedEmbeddings,
  OperationType
};
