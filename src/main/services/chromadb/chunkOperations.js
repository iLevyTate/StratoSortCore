/**
 * ChromaDB Chunk Operations
 *
 * Chunk-level embedding operations for semantic search.
 * Stores embeddings for extractedText chunks so natural-language queries can match deep content.
 *
 * @module services/chromadb/chunkOperations
 */

const { logger } = require('../../../shared/logger');
const { withRetry } = require('../../../shared/errorHandlingUtils');
const { sanitizeMetadata } = require('../../../shared/pathSanitization');
const { normalizeChunkMetadata } = require('../../../shared/normalization');
const { chunkMetaSchema, validateSchema } = require('../../../shared/normalization/schemas');

logger.setContext('ChromaDB:ChunkOps');

/**
 * Validate embedding vector for NaN/Infinity.
 * Dimension validation is handled at the service layer.
 */
function validateEmbeddingVector(vector, context = 'unknown') {
  if (!Array.isArray(vector)) return { valid: false, error: 'not_array' };
  if (vector.length === 0) return { valid: false, error: 'empty_vector' };
  for (let i = 0; i < vector.length; i++) {
    if (!Number.isFinite(vector[i])) {
      logger.warn(`[ChunkOps] Invalid vector value at index ${i}`, {
        context,
        value: String(vector[i]),
        vectorLength: vector.length
      });
      return { valid: false, error: 'invalid_value', index: i };
    }
  }
  return { valid: true };
}

function validateChunkMetadata(meta) {
  if (!meta || typeof meta !== 'object') return { valid: false, error: 'missing_meta' };
  if (typeof meta.fileId !== 'string' || meta.fileId.trim().length === 0) {
    return { valid: false, error: 'missing_fileId' };
  }
  if (meta.path != null && typeof meta.path !== 'string')
    return { valid: false, error: 'bad_path' };
  if (meta.name != null && typeof meta.name !== 'string')
    return { valid: false, error: 'bad_name' };
  if (meta.chunkIndex != null && !Number.isInteger(meta.chunkIndex)) {
    return { valid: false, error: 'bad_chunkIndex' };
  }
  if (meta.charStart != null && !Number.isFinite(meta.charStart)) {
    return { valid: false, error: 'bad_charStart' };
  }
  if (meta.charEnd != null && !Number.isFinite(meta.charEnd)) {
    return { valid: false, error: 'bad_charEnd' };
  }
  return { valid: true };
}

/**
 * Batch upsert chunk embeddings.
 *
 * @param {Object} params
 * @param {Array<Object>} params.chunks - { id, vector, meta, document? }
 * @param {Object} params.chunkCollection
 * @returns {Promise<number>} upserted count
 */
async function batchUpsertFileChunks({ chunks, chunkCollection }) {
  if (!Array.isArray(chunks) || chunks.length === 0) return 0;

  return withRetry(
    async () => {
      const ids = [];
      const embeddings = [];
      const metadatas = [];
      const documents = [];

      const seenIds = new Set();
      for (const chunk of chunks) {
        if (!chunk?.id || !Array.isArray(chunk.vector) || chunk.vector.length === 0) continue;
        if (seenIds.has(chunk.id)) continue;
        seenIds.add(chunk.id);

        const validation = validateEmbeddingVector(chunk.vector, chunk.id);
        if (!validation.valid) continue;

        const rawMeta = chunk.meta || {};
        const rawValidation = validateChunkMetadata(rawMeta);
        if (!rawValidation.valid) continue;

        const normalizedMeta = normalizeChunkMetadata(rawMeta);
        const schemaValidation = validateSchema(chunkMetaSchema, normalizedMeta);
        if (!schemaValidation.valid) {
          logger.warn('[ChunkOps] Invalid chunk metadata shape', {
            chunkId: chunk.id,
            error: schemaValidation.error?.message
          });
        }

        const metaValidation = validateChunkMetadata(schemaValidation.data || normalizedMeta);
        if (!metaValidation.valid) continue;

        const sanitized = sanitizeMetadata({
          ...(schemaValidation.data || normalizedMeta),
          updatedAt: chunk.updatedAt || new Date().toISOString()
        });

        ids.push(chunk.id);
        embeddings.push(chunk.vector);
        metadatas.push(sanitized);
        const fallbackDocument =
          chunk.document || sanitized.snippet || sanitized.path || rawMeta.path || chunk.id;
        documents.push(String(fallbackDocument));
      }

      if (ids.length === 0) return 0;

      await chunkCollection.upsert({
        ids,
        embeddings,
        metadatas,
        documents
      });

      logger.debug('[ChunkOps] Batch upserted file chunk embeddings', { count: ids.length });
      return ids.length;
    },
    { maxRetries: 3, initialDelay: 500 }
  )();
}

/**
 * Query chunk embeddings for a semantic match.
 *
 * @param {Object} params
 * @param {Array<number>} params.queryEmbedding
 * @param {number} params.topK
 * @param {Object} params.chunkCollection
 * @returns {Promise<Array<{id: string, score: number, distance: number, metadata: Object, document: string}>>}
 */
async function querySimilarFileChunks({ queryEmbedding, topK = 20, chunkCollection }) {
  try {
    const results = await chunkCollection.query({
      queryEmbeddings: [queryEmbedding],
      nResults: topK
    });

    const ids = results.ids?.[0] || [];
    if (!ids.length) return [];

    const distances = results.distances?.[0] || [];
    const metadatas = results.metadatas?.[0] || [];
    const documents = results.documents?.[0] || [];

    const matches = [];
    for (let i = 0; i < ids.length; i++) {
      const distance = i < distances.length ? distances[i] : 1;
      const metadata = i < metadatas.length ? metadatas[i] : {};
      const document = i < documents.length ? documents[i] : '';
      const score = Math.max(0, 1 - distance / 2);

      matches.push({
        id: ids[i],
        score,
        distance,
        metadata,
        document
      });
    }

    const sorted = matches.sort((a, b) => b.score - a.score);
    logger.debug('[ChunkOps] Top chunk matches', {
      top: sorted.slice(0, 3).map((m) => ({
        score: m.score?.toFixed?.(3),
        id: m.id,
        fileId: m.metadata?.fileId?.split(/[\\/]/).pop()
      }))
    });
    return sorted;
  } catch (error) {
    logger.error('[ChunkOps] Failed to query similar file chunks:', error);
    return [];
  }
}

/**
 * Reset chunk embeddings collection.
 *
 * @param {Object} params
 * @param {Object} params.client
 * @param {Object} params.embeddingFunction
 * @returns {Promise<Object>} new collection
 */
async function resetFileChunks({ client, embeddingFunction }) {
  try {
    await client.deleteCollection({ name: 'file_chunk_embeddings' });
    const chunkCollection = await client.createCollection({
      name: 'file_chunk_embeddings',
      embeddingFunction,
      metadata: {
        description: 'Chunk embeddings for extracted text (semantic search deep recall)',
        'hnsw:space': 'cosine'
      }
    });
    logger.info('[ChunkOps] Reset file chunk embeddings collection');
    return chunkCollection;
  } catch (error) {
    logger.error('[ChunkOps] Failed to reset file chunks:', error);
    throw error;
  }
}

/**
 * Mark chunks as orphaned when parent file embedding is marked orphaned
 * Uses fileId metadata to find all chunks belonging to a file
 *
 * FIX: Prevents orphaned chunks from accumulating unbounded in file_chunk_embeddings
 *
 * @param {Object} params - Parameters
 * @param {Array<string>} params.fileIds - Array of parent file IDs whose chunks should be marked
 * @param {Object} params.chunkCollection - ChromaDB chunk collection
 * @returns {Promise<{ marked: number, failed: number }>}
 */
async function markChunksOrphaned({ fileIds, chunkCollection }) {
  if (!fileIds || fileIds.length === 0) {
    return { marked: 0, failed: 0 };
  }

  let marked = 0;
  let failed = 0;

  try {
    // Process each fileId and find its chunks
    for (const fileId of fileIds) {
      try {
        // Find chunks belonging to this file
        const chunks = await chunkCollection.get({
          where: { fileId },
          include: ['embeddings', 'metadatas', 'documents']
        });

        if (!chunks?.ids || chunks.ids.length === 0) {
          continue;
        }

        // Update metadata to mark as orphaned
        const updatedIds = [];
        const updatedEmbeddings = [];
        const updatedMetadatas = [];
        const updatedDocuments = [];

        for (let i = 0; i < chunks.ids.length; i++) {
          const existingMeta = chunks.metadatas?.[i] || {};
          const embedding = chunks.embeddings?.[i];
          const document = chunks.documents?.[i];

          if (!embedding) continue;

          updatedIds.push(chunks.ids[i]);
          updatedEmbeddings.push(embedding);
          updatedMetadatas.push(
            sanitizeMetadata({
              ...existingMeta,
              orphaned: 'true',
              orphanedAt: new Date().toISOString()
            })
          );
          updatedDocuments.push(document || chunks.ids[i]);
        }

        if (updatedIds.length > 0) {
          await chunkCollection.upsert({
            ids: updatedIds,
            embeddings: updatedEmbeddings,
            metadatas: updatedMetadatas,
            documents: updatedDocuments
          });
          marked += updatedIds.length;
        }
      } catch (fileError) {
        logger.warn('[ChunkOps] Failed to mark chunks orphaned for file:', {
          fileId,
          error: fileError.message
        });
        failed++;
      }
    }

    if (marked > 0) {
      logger.info('[ChunkOps] Marked file chunks as orphaned', {
        marked,
        failed,
        totalFiles: fileIds.length
      });
    }

    return { marked, failed };
  } catch (error) {
    logger.error('[ChunkOps] Failed to mark chunks as orphaned:', {
      fileCount: fileIds.length,
      error: error.message
    });
    return { marked, failed: fileIds.length };
  }
}

/**
 * Get all orphaned chunks (for cleanup operations)
 *
 * @param {Object} params - Parameters
 * @param {Object} params.chunkCollection - ChromaDB chunk collection
 * @param {number} [params.maxAge] - Maximum age in milliseconds (optional, filters by orphanedAt)
 * @returns {Promise<Array<string>>} Array of orphaned chunk IDs
 */
async function getOrphanedChunks({ chunkCollection, maxAge }) {
  try {
    // Query for orphaned chunks using where filter
    const results = await chunkCollection.get({
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
    logger.error('[ChunkOps] Failed to get orphaned chunks:', {
      error: error.message
    });
    return [];
  }
}

/**
 * Update chunk IDs + metadata when a file is moved/renamed.
 *
 * Chunks are keyed by `chunk:${fileId}:${chunkIndex}` and also store `fileId` and `path` in metadata.
 * If a file path changes (and thus fileId changes), chunk IDs must be rewritten to stay joinable
 * with file-level results and to avoid stale paths in UI.
 *
 * @param {Object} params
 * @param {Array<{oldId: string, newId: string, newMeta: {path: string, name?: string}}>} params.pathUpdates
 * @param {Object} params.chunkCollection
 * @returns {Promise<number>} updated count
 */
async function updateFileChunkPaths({ pathUpdates, chunkCollection }) {
  if (!Array.isArray(pathUpdates) || pathUpdates.length === 0) return 0;

  let updated = 0;

  for (const update of pathUpdates) {
    const oldFileId = update?.oldId;
    const newFileId = update?.newId;
    const newPath = update?.newMeta?.path;
    const newName = update?.newMeta?.name;

    if (!oldFileId || !newFileId || !newPath) continue;

    try {
      const chunks = await chunkCollection.get({
        where: { fileId: oldFileId },
        include: ['embeddings', 'metadatas', 'documents']
      });

      const ids = Array.isArray(chunks?.ids) ? chunks.ids : [];
      const embeddings = Array.isArray(chunks?.embeddings) ? chunks.embeddings : [];
      const metadatas = Array.isArray(chunks?.metadatas) ? chunks.metadatas : [];
      const documents = Array.isArray(chunks?.documents) ? chunks.documents : [];

      if (ids.length === 0) continue;

      const newIds = [];
      const newEmbeddings = [];
      const newMetadatas = [];
      const newDocuments = [];
      const oldIdsToDelete = [];

      for (let i = 0; i < ids.length; i++) {
        const existingId = ids[i];
        const vec = embeddings[i];
        const meta = metadatas[i] || {};
        const doc = documents[i];

        if (!Array.isArray(vec) || vec.length === 0) continue;

        const chunkIndex = Number.isInteger(meta.chunkIndex)
          ? meta.chunkIndex
          : Number(existingId.split(':').pop());

        if (!Number.isInteger(chunkIndex)) continue;

        const newId = `chunk:${newFileId}:${chunkIndex}`;

        newIds.push(newId);
        newEmbeddings.push(vec);
        newMetadatas.push(
          sanitizeMetadata({
            ...meta,
            fileId: newFileId,
            path: newPath,
            ...(newName ? { name: newName } : {}),
            updatedAt: new Date().toISOString()
          })
        );
        newDocuments.push(doc || meta.snippet || newPath || newId);
        oldIdsToDelete.push(existingId);
      }

      if (newIds.length === 0) continue;

      await chunkCollection.upsert({
        ids: newIds,
        embeddings: newEmbeddings,
        metadatas: newMetadatas,
        documents: newDocuments
      });

      // Remove old IDs to prevent duplicates and stale joins
      try {
        await chunkCollection.delete({ ids: oldIdsToDelete });
      } catch (deleteErr) {
        logger.warn('[ChunkOps] Failed to delete old chunk IDs after path update', {
          oldFileId,
          error: deleteErr.message
        });
      }

      updated += newIds.length;
    } catch (error) {
      logger.warn('[ChunkOps] Failed to update chunks for moved file', {
        oldFileId,
        newFileId,
        error: error.message
      });
    }
  }

  if (updated > 0) {
    logger.info('[ChunkOps] Updated file chunk paths', { updated });
  }

  return updated;
}

/**
 * Delete all chunks belonging to a specific file
 * FIX P0-1: Prevents orphaned chunks when files are deleted
 *
 * @param {Object} params - Parameters
 * @param {string} params.fileId - The parent file ID whose chunks should be deleted
 * @param {Object} params.chunkCollection - ChromaDB chunk collection
 * @returns {Promise<number>} Number of deleted chunks
 */
async function deleteFileChunks({ fileId, chunkCollection }) {
  if (!fileId || typeof fileId !== 'string') {
    return 0;
  }

  try {
    // Find all chunks belonging to this file
    const chunks = await chunkCollection.get({
      where: { fileId },
      include: [] // Only need IDs
    });

    if (!chunks?.ids || chunks.ids.length === 0) {
      return 0;
    }

    // Delete all found chunks
    await chunkCollection.delete({ ids: chunks.ids });

    logger.debug('[ChunkOps] Deleted file chunks', {
      fileId,
      count: chunks.ids.length
    });

    return chunks.ids.length;
  } catch (error) {
    logger.error('[ChunkOps] Failed to delete file chunks:', {
      fileId,
      error: error.message
    });
    return 0;
  }
}

/**
 * Batch delete chunks for multiple files
 * FIX P0-1: Efficient bulk deletion when multiple files are removed
 *
 * @param {Object} params - Parameters
 * @param {Array<string>} params.fileIds - Array of parent file IDs whose chunks should be deleted
 * @param {Object} params.chunkCollection - ChromaDB chunk collection
 * @returns {Promise<number>} Total number of deleted chunks
 */
async function batchDeleteFileChunks({ fileIds, chunkCollection }) {
  if (!Array.isArray(fileIds) || fileIds.length === 0) {
    return 0;
  }

  let totalDeleted = 0;

  // Process in batches to avoid overwhelming ChromaDB
  const BATCH_SIZE = 20;
  for (let i = 0; i < fileIds.length; i += BATCH_SIZE) {
    const batch = fileIds.slice(i, i + BATCH_SIZE);

    for (const fileId of batch) {
      try {
        const deleted = await deleteFileChunks({ fileId, chunkCollection });
        totalDeleted += deleted;
      } catch (error) {
        logger.warn('[ChunkOps] Failed to delete chunks for file in batch:', {
          fileId,
          error: error.message
        });
      }
    }
  }

  if (totalDeleted > 0) {
    logger.info('[ChunkOps] Batch deleted file chunks', {
      fileCount: fileIds.length,
      chunksDeleted: totalDeleted
    });
  }

  return totalDeleted;
}

module.exports = {
  batchUpsertFileChunks,
  querySimilarFileChunks,
  resetFileChunks,
  markChunksOrphaned,
  getOrphanedChunks,
  updateFileChunkPaths,
  deleteFileChunks,
  batchDeleteFileChunks
};
