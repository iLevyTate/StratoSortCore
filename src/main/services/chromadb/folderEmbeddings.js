/**
 * ChromaDB Folder Embeddings
 *
 * Folder embedding operations for ChromaDB.
 * Extracted from ChromaDBService for better maintainability.
 *
 * @module services/chromadb/folderEmbeddings
 */

const { logger } = require('../../../shared/logger');
const { RETRY } = require('../../../shared/performanceConstants');
const { withRetry } = require('../../../shared/errorHandlingUtils');
const { prepareFolderMetadata } = require('../../../shared/pathSanitization');

logger.setContext('ChromaDB:FolderOps');

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
      logger.warn(`[FolderOps] Invalid vector value at index ${i}`, {
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
 * Direct upsert folder without circuit breaker (used by queue flush)
 *
 * @param {Object} params - Parameters
 * @param {Object} params.folder - Folder object with id, name, vector, etc.
 * @param {Object} params.folderCollection - ChromaDB folder collection
 * @param {Object} params.queryCache - Query cache instance
 * @returns {Promise<void>}
 */
async function directUpsertFolder({ folder, folderCollection, queryCache }) {
  // FIX: Validate vector before upsert to prevent corrupted embeddings
  const validation = validateEmbeddingVector(folder.vector, folder.id);
  if (!validation.valid) {
    throw new Error(
      `Invalid embedding vector for folder ${folder.id}: ${validation.error}${validation.index !== undefined ? ` at index ${validation.index}` : ''}`
    );
  }

  const sanitized = prepareFolderMetadata(folder);

  try {
    await withRetry(
      async () => {
        await folderCollection.upsert({
          ids: [folder.id],
          embeddings: [folder.vector],
          metadatas: [sanitized],
          documents: [folder.name || folder.id]
        });
      },
      {
        maxRetries: 3,
        initialDelay: 500
      }
    )();

    // Invalidate query cache entries that might reference this folder
    if (queryCache) {
      queryCache.invalidateForFolder();
    }

    logger.debug('[FolderOps] Upserted folder embedding', {
      id: folder.id,
      name: folder.name
    });
  } catch (error) {
    // Log once after retries are exhausted to avoid noisy startup spam.
    logger.error('[FolderOps] Failed to upsert folder with context:', {
      operation: 'upsert-folder',
      folderId: folder.id,
      folderName: folder.name,
      folderPath: folder.path,
      timestamp: new Date().toISOString(),
      error: error.message,
      errorStack: error.stack
    });
    throw error;
  }
}

/**
 * Direct batch upsert folders without circuit breaker
 *
 * @param {Object} params - Parameters
 * @param {Array<Object>} params.folders - Array of folder objects
 * @param {Object} params.folderCollection - ChromaDB folder collection
 * @param {Object} params.queryCache - Query cache instance
 * @returns {Promise<Object>} Object with count and skipped array
 */
async function directBatchUpsertFolders({ folders, folderCollection, queryCache }) {
  const ids = [];
  const embeddings = [];
  const metadatas = [];
  const documents = [];
  const skipped = [];

  // FIX: Track seen IDs to prevent duplicate ID error from ChromaDB
  const seenIds = new Set();
  let duplicateCount = 0;

  for (const folder of folders) {
    if (!folder.id || !folder.vector || !Array.isArray(folder.vector)) {
      logger.warn('[FolderOps] Skipping invalid folder in batch', {
        id: folder.id,
        name: folder.name,
        reason: !folder.id
          ? 'missing_id'
          : !folder.vector
            ? 'missing_vector'
            : 'invalid_vector_type'
      });
      skipped.push({
        folder: { id: folder.id, name: folder.name },
        reason: !folder.id
          ? 'missing_id'
          : !folder.vector
            ? 'missing_vector'
            : 'invalid_vector_type'
      });
      continue;
    }

    // FIX: Skip duplicate IDs - ChromaDB requires unique IDs in batch
    if (seenIds.has(folder.id)) {
      duplicateCount++;
      logger.debug('[FolderOps] Skipping duplicate folder ID in batch', {
        id: folder.id,
        name: folder.name
      });
      continue;
    }
    seenIds.add(folder.id);

    // FIX: Validate vector for NaN/Infinity before including in batch
    const validation = validateEmbeddingVector(folder.vector, folder.id);
    if (!validation.valid) {
      logger.warn('[FolderOps] Skipping folder with invalid vector in batch', {
        id: folder.id,
        name: folder.name,
        error: validation.error,
        index: validation.index
      });
      skipped.push({
        folder: { id: folder.id, name: folder.name },
        reason: `invalid_vector_value${validation.index !== undefined ? `_at_${validation.index}` : ''}`
      });
      continue;
    }

    const sanitized = prepareFolderMetadata(folder);
    ids.push(folder.id);
    embeddings.push(folder.vector);
    metadatas.push(sanitized);
    documents.push(folder.name || folder.id);
  }

  // Log if duplicates were found
  if (duplicateCount > 0) {
    logger.info('[FolderOps] Deduplicated batch before upsert', {
      originalCount: folders.length,
      uniqueCount: ids.length,
      duplicatesRemoved: duplicateCount
    });
  }

  if (ids.length === 0) {
    return { count: 0, skipped };
  }

  try {
    await withRetry(
      async () => {
        await folderCollection.upsert({
          ids,
          embeddings,
          metadatas,
          documents
        });
      },
      { maxRetries: 3, initialDelay: 500 }
    )();

    // Invalidate cache for all affected folders
    if (queryCache) {
      queryCache.invalidateForFolder();
    }

    logger.info('[FolderOps] Batch upserted folder embeddings', {
      count: ids.length,
      skipped: skipped.length
    });

    return { count: ids.length, skipped };
  } catch (error) {
    // Log once after retries are exhausted to avoid noisy startup spam.
    logger.error('[FolderOps] Failed to batch upsert folders with context:', {
      operation: 'batch-upsert-folders',
      totalFolders: folders.length,
      successfulCount: ids.length,
      skippedCount: skipped.length,
      timestamp: new Date().toISOString(),
      error: error.message,
      errorStack: error.stack
    });
    throw error;
  }
}

/**
 * Query folders by embedding vector
 *
 * @param {Object} params - Parameters
 * @param {Array} params.embedding - The embedding vector to query
 * @param {number} params.topK - Number of top results to return
 * @param {Object} params.folderCollection - ChromaDB folder collection
 * @returns {Promise<Array>} Sorted array of folder matches with scores
 */
async function queryFoldersByEmbedding({ embedding, topK = 5, folderCollection }) {
  try {
    if (!Array.isArray(embedding) || embedding.length === 0) {
      logger.warn('[FolderOps] Invalid embedding for folder query');
      return [];
    }

    const results = await folderCollection.query({
      queryEmbeddings: [embedding],
      nResults: topK
    });

    if (
      !results ||
      !results.ids ||
      !Array.isArray(results.ids) ||
      results.ids.length === 0 ||
      !Array.isArray(results.ids[0]) ||
      results.ids[0].length === 0
    ) {
      return [];
    }

    const matches = [];
    const idsArray = results.ids[0];
    const distancesArray = results.distances[0];
    const metadatasArray = results.metadatas?.[0] || [];

    const resultCount = Math.min(idsArray.length, distancesArray.length);

    for (let i = 0; i < resultCount; i++) {
      const folderId = idsArray[i];
      const distance = distancesArray[i];
      const metadata = metadatasArray[i];

      if (!folderId || distance === undefined) {
        continue;
      }

      const score = Math.max(0, 1 - distance / 2);

      matches.push({
        folderId,
        name: metadata?.name || folderId,
        score,
        description: metadata?.description,
        path: metadata?.path
      });
    }

    return matches.sort((a, b) => b.score - a.score);
  } catch (error) {
    logger.error('[FolderOps] Failed to query folders by embedding:', error);
    return [];
  }
}

/**
 * Execute folder query for a file (get file embedding first, then query folders)
 *
 * @param {Object} params - Parameters
 * @param {string} params.fileId - The file ID to query
 * @param {number} params.topK - Number of top results
 * @param {Object} params.fileCollection - ChromaDB file collection
 * @param {Object} params.folderCollection - ChromaDB folder collection
 * @returns {Promise<Array>} Sorted array of folder matches
 */
async function executeQueryFolders({ fileId, topK, fileCollection, folderCollection }) {
  try {
    if (!fileCollection) {
      logger.error('[FolderOps] File collection not initialized');
      return [];
    }
    if (!folderCollection) {
      logger.error('[FolderOps] Folder collection not initialized');
      return [];
    }

    // Get file embedding with retry logic for read-after-write consistency
    let fileResult = null;
    let lastError = null;
    const maxRetries = 3;
    const retryDelays = [50, 100, 200];

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        fileResult = await fileCollection.get({
          ids: [fileId],
          include: ['embeddings', 'metadatas', 'documents']
        });

        if (attempt > 0 || !fileResult?.embeddings?.length) {
          logger.debug('[FolderOps] File get response:', {
            fileId,
            attempt: attempt + 1,
            hasResult: !!fileResult,
            hasEmbeddings: !!fileResult?.embeddings,
            embeddingsLength: fileResult?.embeddings?.length || 0
          });
        }

        if (fileResult && fileResult.embeddings && fileResult.embeddings.length > 0) {
          if (attempt > 0) {
            logger.info(
              `[FolderOps] File found on retry attempt ${attempt + 1}/${maxRetries}`,
              fileId
            );
          }
          break;
        }

        if (attempt < maxRetries - 1) {
          const delay = retryDelays[attempt];
          logger.debug(
            `[FolderOps] File not found on attempt ${attempt + 1}, retrying in ${delay}ms...`,
            fileId
          );
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      } catch (error) {
        lastError = error;
        logger.warn(`[FolderOps] Error getting file on attempt ${attempt + 1}:`, error.message);
        if (attempt < maxRetries - 1) {
          const delay = retryDelays[attempt];
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }

    if (!fileResult || !fileResult.embeddings || fileResult.embeddings.length === 0) {
      logger.warn('[FolderOps] File not found after retries:', {
        fileId,
        attempts: maxRetries,
        lastError: lastError?.message
      });
      return [];
    }

    const fileEmbedding = fileResult.embeddings[0];

    if (!Array.isArray(fileEmbedding) || fileEmbedding.length === 0) {
      logger.warn('[FolderOps] Invalid file embedding:', fileId);
      return [];
    }

    // Query the folder collection for similar embeddings
    const results = await folderCollection.query({
      queryEmbeddings: [fileEmbedding],
      nResults: topK
    });

    // Comprehensive validation
    if (
      !results ||
      !results.ids ||
      !Array.isArray(results.ids) ||
      results.ids.length === 0 ||
      !Array.isArray(results.ids[0]) ||
      results.ids[0].length === 0
    ) {
      logger.debug('[FolderOps] No matching folders found for file:', fileId);
      return [];
    }

    if (
      !results.distances ||
      !Array.isArray(results.distances) ||
      results.distances.length === 0 ||
      !Array.isArray(results.distances[0])
    ) {
      logger.warn('[FolderOps] Invalid distances structure in query results');
      return [];
    }

    const matches = [];
    const idsArray = results.ids[0];
    const distancesArray = results.distances[0];
    const metadatasArray = results.metadatas?.[0] || [];

    const resultCount = Math.min(idsArray.length, distancesArray.length);

    for (let i = 0; i < resultCount; i++) {
      const folderId = idsArray[i];
      const distance = distancesArray[i];
      const metadata = metadatasArray[i];

      if (!folderId || distance === undefined) {
        logger.warn('[FolderOps] Incomplete query result, skipping entry');
        continue;
      }

      const score = Math.max(0, 1 - distance / 2);

      matches.push({
        folderId,
        name: metadata?.name || folderId,
        score,
        description: metadata?.description,
        path: metadata?.path
      });
    }

    return matches.sort((a, b) => b.score - a.score);
  } catch (error) {
    logger.error('[FolderOps] Failed to query folders:', error);
    return [];
  }
}

/**
 * Batch query folders for multiple files
 *
 * @param {Object} params - Parameters
 * @param {Array<string>} params.fileIds - Array of file IDs to query
 * @param {number} params.topK - Number of top results
 * @param {Object} params.fileCollection - ChromaDB file collection
 * @param {Object} params.folderCollection - ChromaDB folder collection
 * @param {Object} params.queryCache - Query cache instance
 * @returns {Promise<Object>} Map of fileId -> Array of folder matches
 */
async function batchQueryFolders({
  fileIds,
  topK = 5,
  fileCollection,
  folderCollection,
  queryCache
}) {
  if (!fileIds || fileIds.length === 0) {
    return {};
  }

  try {
    // Get embeddings for all files with retries
    let fileResults = null;
    const maxRetries = 3;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        fileResults = await fileCollection.get({
          ids: fileIds,
          include: ['embeddings']
        });

        if (fileResults && fileResults.embeddings && fileResults.embeddings.length > 0) {
          break;
        }

        if (attempt < maxRetries - 1) {
          await new Promise((r) => setTimeout(r, RETRY.CHROMADB_BACKOFF_STEP_MS * (attempt + 1)));
        }
      } catch (e) {
        if (attempt === maxRetries - 1) throw e;
        await new Promise((r) => setTimeout(r, RETRY.CHROMADB_BACKOFF_STEP_MS * (attempt + 1)));
      }
    }

    if (!fileResults || !fileResults.ids || fileResults.ids.length === 0) {
      logger.warn('[FolderOps] No embeddings found for batch query', {
        count: fileIds.length
      });
      return {};
    }

    // Map embeddings by ID
    const embeddingMap = new Map();
    for (let i = 0; i < fileResults.ids.length; i++) {
      if (fileResults.embeddings[i]) {
        embeddingMap.set(fileResults.ids[i], fileResults.embeddings[i]);
      }
    }

    const validFileIds = fileIds.filter((id) => embeddingMap.has(id));
    const queryEmbeddings = validFileIds.map((id) => embeddingMap.get(id));

    if (queryEmbeddings.length === 0) {
      return {};
    }

    // Batch query folders
    const results = await folderCollection.query({
      queryEmbeddings,
      nResults: topK
    });

    // Process results
    const resultMap = {};

    if (results && results.ids && results.ids.length === queryEmbeddings.length) {
      for (let i = 0; i < queryEmbeddings.length; i++) {
        const fileId = validFileIds[i];
        const matches = [];

        const idsArray = results.ids[i];
        const distancesArray = results.distances[i];
        const metadatasArray = results.metadatas?.[i] || [];

        const count = Math.min(idsArray.length, distancesArray.length);

        for (let j = 0; j < count; j++) {
          const distance = distancesArray[j];
          const score = Math.max(0, 1 - distance / 2);

          matches.push({
            folderId: idsArray[j],
            name: metadatasArray[j]?.name || idsArray[j],
            score,
            description: metadatasArray[j]?.description,
            path: metadatasArray[j]?.path
          });
        }

        resultMap[fileId] = matches.sort((a, b) => b.score - a.score);

        // Cache individual results
        if (queryCache) {
          const cacheKey = `query:folders:${fileId}:${topK}`;
          queryCache.set(cacheKey, resultMap[fileId]);
        }
      }
    }

    return resultMap;
  } catch (error) {
    logger.error('[FolderOps] Failed to batch query folders:', error);
    return {};
  }
}

/**
 * Get all folder embeddings
 *
 * @param {Object} params - Parameters
 * @param {Object} params.folderCollection - ChromaDB folder collection
 * @returns {Promise<Array>} Array of folder objects
 */
async function getAllFolders({ folderCollection }) {
  try {
    const result = await folderCollection.get({});

    const folders = [];
    if (result.ids && result.ids.length > 0) {
      const metadatas = result.metadatas || [];
      const embeddings = result.embeddings || [];

      for (let i = 0; i < result.ids.length; i++) {
        const metadata = i < metadatas.length ? metadatas[i] : {};
        const vector = i < embeddings.length ? embeddings[i] : null;

        folders.push({
          id: result.ids[i],
          name: metadata?.name || result.ids[i],
          vector,
          metadata
        });
      }
    }

    return folders;
  } catch (error) {
    logger.error('[FolderOps] Failed to get all folders:', error);
    return [];
  }
}

/**
 * Reset all folder embeddings
 *
 * @param {Object} params - Parameters
 * @param {Object} params.client - ChromaDB client
 * @param {Object} [params.embeddingFunction] - Embedding function to prevent DefaultEmbeddingFunction instantiation
 * @returns {Promise<Object>} New folder collection
 */
async function resetFolders({ client, embeddingFunction }) {
  try {
    await client.deleteCollection({ name: 'folder_embeddings' });

    const folderCollection = await client.createCollection({
      name: 'folder_embeddings',
      embeddingFunction,
      metadata: {
        description: 'Smart folder embeddings for categorization',
        'hnsw:space': 'cosine' // Correct ChromaDB API syntax (not hnsw_space)
      }
    });

    logger.info('[FolderOps] Reset folder embeddings collection');
    return folderCollection;
  } catch (error) {
    logger.error('[FolderOps] Failed to reset folders:', error);
    throw error;
  }
}

module.exports = {
  directUpsertFolder,
  directBatchUpsertFolders,
  queryFoldersByEmbedding,
  executeQueryFolders,
  batchQueryFolders,
  getAllFolders,
  resetFolders
};
