/**
 * OramaVectorService - In-process vector database using Orama
 *
 * In-process, zero-dependency vector storage.
 * Supports BM25 + vector hybrid search and persistence with a stable service API.
 *
 * @module services/OramaVectorService
 */

const path = require('path');
const fs = require('fs').promises;
const { app } = require('electron');
const { EventEmitter } = require('events');
const { create, insert, search, remove, update, count, getByID } = require('@orama/orama');
const { persist, restore } = require('@orama/plugin-data-persistence');
const { createLogger } = require('../../shared/logger');
const { createSingletonHelpers } = require('../../shared/singletonFactory');
const { AI_DEFAULTS } = require('../../shared/constants');
const { ERROR_CODES } = require('../../shared/errorCodes');
const { replaceFileWithRetry } = require('../../shared/atomicFile');
const { compress, uncompress } = require('lz4-napi');

const logger = createLogger('OramaVectorService');

const PERSIST_COMPRESSION_ENABLED =
  String(process.env.STRATOSORT_ORAMA_COMPRESS || 'true').toLowerCase() !== 'false';

const attachErrorCode = (error, code) => {
  if (error && typeof error === 'object') {
    if (!error.code) {
      error.code = code;
    }
    return error;
  }
  const wrapped = new Error(String(error || 'Unknown error'));
  wrapped.code = code;
  return wrapped;
};

const writeFileAtomic = async (filePath, data) => {
  const tempPath = `${filePath}.tmp.${Date.now()}.${Math.random().toString(36).slice(2)}`;
  try {
    await fs.writeFile(tempPath, data);
    await replaceFileWithRetry(tempPath, filePath);
  } catch (error) {
    try {
      await fs.unlink(tempPath);
    } catch {
      // Ignore cleanup errors
    }
    throw error;
  }
};

// Standard embedding dimension (768 for nomic-embed-text, configurable)
const DEFAULT_EMBEDDING_DIMENSION = AI_DEFAULTS.EMBEDDING?.DIMENSIONS || 768;

// Persistence settings
const PERSIST_DEBOUNCE_MS = 5000; // Debounce persistence writes
const MAX_PERSIST_WAIT_MS = 30000; // Max wait before forcing persistence

/**
 * Build Orama schema with dynamic vector dimension
 * @param {number} dimension - Embedding vector dimension
 * @returns {Object} Schema definitions for all collections
 */
function buildSchemas(dimension) {
  return {
    files: {
      id: 'string',
      embedding: `vector[${dimension}]`,
      filePath: 'string',
      fileName: 'string',
      fileType: 'string',
      analyzedAt: 'string',
      suggestedName: 'string',
      keywords: 'string[]',
      tags: 'string[]',
      isOrphaned: 'boolean',
      orphanedAt: 'string',
      extractionMethod: 'string'
    },
    folders: {
      id: 'string',
      embedding: `vector[${dimension}]`,
      folderPath: 'string',
      folderName: 'string',
      description: 'string',
      patterns: 'string[]'
    },
    fileChunks: {
      id: 'string',
      embedding: `vector[${dimension}]`,
      fileId: 'string',
      chunkIndex: 'number',
      content: 'string',
      startOffset: 'number',
      endOffset: 'number'
    },
    feedback: {
      id: 'string',
      embedding: `vector[${dimension}]`,
      text: 'string',
      feedbackType: 'string',
      metadata: 'string'
    },
    learningPatterns: {
      id: 'string',
      embedding: `vector[${dimension}]`,
      document: 'string',
      lastUpdated: 'string',
      patternCount: 'number',
      feedbackCount: 'number',
      folderStatsCount: 'number'
    }
  };
}

/**
 * OramaVectorService - In-process vector database
 *
 * Features:
 * - Zero external dependencies (no server required)
 * - Automatic persistence to disk
 * - Hybrid BM25 + vector search
 * - Stable API for vector storage and search
 */
class OramaVectorService extends EventEmitter {
  constructor() {
    super();
    this._databases = {};
    this._initialized = false;
    this._dataPath = null;
    this._dimension = DEFAULT_EMBEDDING_DIMENSION;
    this._schemas = null;

    // Persistence state
    this._persistTimer = null;
    this._persistPending = false;
    this._isPersisting = false;
    this._currentPersistPromise = null;
    this._lastPersist = 0;

    // Track collection dimensions for validation
    this._collectionDimensions = {
      files: null,
      folders: null,
      fileChunks: null,
      feedback: null,
      learningPatterns: null
    };

    // Initialization state
    this._initPromise = null;
    this._isInitializing = false;
    this._isShuttingDown = false;

    // Always online (in-process)
    this.isOnline = true;

    // Query cache (simple LRU)
    this._queryCache = new Map();
    this._queryCacheMaxSize = 200;
    this._queryCacheTtlMs = 120000;
  }

  /**
   * Initialize the vector service
   */
  async initialize() {
    if (this._initPromise) {
      return this._initPromise;
    }

    if (this._initialized) {
      return Promise.resolve();
    }

    this._isInitializing = true;

    this._initPromise = (async () => {
      try {
        logger.info('[OramaVectorService] Initializing...');

        this._dataPath = path.join(app.getPath('userData'), 'vector-db');
        await fs.mkdir(this._dataPath, { recursive: true });

        // Build schemas with default dimension
        this._schemas = buildSchemas(this._dimension);

        // Initialize dimension cache
        const collectionNames = ['files', 'folders', 'fileChunks', 'feedback', 'learningPatterns'];
        for (const name of collectionNames) {
          this._collectionDimensions[name] = this._dimension;
          this._databases[name] = await this._createOrRestoreDatabase(name, this._schemas[name]);
        }

        this._initialized = true;
        this.isOnline = true;
        this.emit('online', { reason: 'initialized' });

        // Get counts for logging
        const counts = {};
        for (const name of collectionNames) {
          counts[name] = await count(this._databases[name]);
        }

        logger.info('[OramaVectorService] Initialized', {
          collections: collectionNames,
          dimension: this._dimension,
          counts
        });

        this._isInitializing = false;
      } catch (error) {
        this._isInitializing = false;
        this._initPromise = null;
        logger.error('[OramaVectorService] Initialization failed:', error);
        if (!error?.code) {
          error.code = ERROR_CODES.VECTOR_DB_INIT_FAILED;
        }
        throw error;
      }
    })();

    return this._initPromise;
  }

  /**
   * Create or restore a database from persistence
   * @private
   */
  async _createOrRestoreDatabase(name, schema) {
    const persistPath = path.join(this._dataPath, `${name}.json`);
    const compressedPath = `${persistPath}.lz4`;

    try {
      // Try to restore from persistence
      let data;
      let usedCompressed = false;
      try {
        const compressed = await fs.readFile(compressedPath);
        data = (await uncompress(compressed)).toString('utf8');
        usedCompressed = true;
      } catch (error) {
        if (error?.code !== 'ENOENT') {
          logger.warn('[OramaVectorService] Failed to read compressed persistence', {
            name,
            error: error.message
          });
        }
      }
      if (!data) {
        data = await fs.readFile(persistPath, 'utf-8');
      }

      // Restore using Orama's restore function
      const db = await restore('json', data);
      logger.debug(`[OramaVectorService] Restored ${name} database`);

      // Update dimension cache from restored data
      const existingCount = await count(db);
      let restoredDim = null;
      if (existingCount > 0) {
        // Orama search() returns null for vector fields, so we get the first
        // document's ID from search then use getByID() for the full document.
        try {
          const results = await search(db, { term: '', limit: 1 });
          if (results.hits.length > 0 && results.hits[0].document?.id) {
            const fullDoc = await getByID(db, results.hits[0].document.id);
            if (fullDoc && Array.isArray(fullDoc.embedding)) {
              restoredDim = fullDoc.embedding.length;
              this._collectionDimensions[name] = restoredDim;
            }
          }
        } catch {
          // If dimension detection fails, we'll proceed with current config dimension
        }
      }

      if (restoredDim && restoredDim !== this._dimension) {
        logger.warn(
          `[OramaVectorService] Dimension changed (${restoredDim} → ${this._dimension}) for ${name}. Wiping collection.`
        );
        this._clearQueryCache();
        this._collectionDimensions[name] = null;
        try {
          await fs.unlink(persistPath);
          await fs.unlink(compressedPath);
        } catch (unlinkError) {
          logger.debug(
            `[OramaVectorService] Failed to remove stale ${name} persistence file: ${unlinkError.message}`
          );
        }
        return await create({ schema });
      }

      if (!PERSIST_COMPRESSION_ENABLED && usedCompressed) {
        try {
          const json = await persist(db, 'json');
          await writeFileAtomic(persistPath, json);
          await fs.rename(compressedPath, `${compressedPath}.legacy.${Date.now()}`);
          logger.info(`[OramaVectorService] Migrated ${name} persistence to JSON`);
        } catch (migrateError) {
          logger.debug('[OramaVectorService] Failed to migrate persistence to JSON', {
            error: migrateError.message
          });
        }
      }

      if (PERSIST_COMPRESSION_ENABLED && !usedCompressed) {
        try {
          const compressed = await compress(Buffer.from(data, 'utf8'));
          await writeFileAtomic(compressedPath, compressed);
          await fs.rename(persistPath, `${persistPath}.legacy.${Date.now()}`);
          logger.info(`[OramaVectorService] Migrated ${name} persistence to LZ4`);
        } catch (migrateError) {
          logger.debug('[OramaVectorService] Failed to migrate persistence to LZ4', {
            error: migrateError.message
          });
        }
      }

      return db;
    } catch (error) {
      // Create new database
      logger.debug(`[OramaVectorService] Creating new ${name} database (${error.message})`);
      const db = await create({ schema });
      return db;
    }
  }

  /**
   * Schedule persistence (debounced)
   * @private
   */
  _schedulePersist() {
    if (this._isShuttingDown) return;

    this._persistPending = true;
    const now = Date.now();

    // Force persist if max wait exceeded
    if (now - this._lastPersist > MAX_PERSIST_WAIT_MS) {
      if (this._persistTimer) {
        clearTimeout(this._persistTimer);
        this._persistTimer = null;
      }
      this._currentPersistPromise = this._doPersist();
      return;
    }

    // Debounce
    if (this._persistTimer) {
      clearTimeout(this._persistTimer);
    }

    this._persistTimer = setTimeout(() => {
      this._currentPersistPromise = this._doPersist();
    }, PERSIST_DEBOUNCE_MS);
  }

  /**
   * Persist all databases to disk
   * @private
   */
  async _doPersist() {
    if (!this._persistPending || this._isShuttingDown) return;
    if (this._isPersisting) return; // prevent concurrent persist runs

    this._isPersisting = true;
    this._persistPending = false;
    this._lastPersist = Date.now();

    if (this._persistTimer) {
      clearTimeout(this._persistTimer);
      this._persistTimer = null;
    }

    try {
      for (const [name, db] of Object.entries(this._databases)) {
        const persistPath = path.join(this._dataPath, `${name}.json`);
        const compressedPath = `${persistPath}.lz4`;
        const data = await persist(db, 'json');
        if (PERSIST_COMPRESSION_ENABLED) {
          const compressed = await compress(Buffer.from(data, 'utf8'));
          await writeFileAtomic(compressedPath, compressed);
          try {
            await fs.unlink(persistPath);
          } catch {
            // Ignore if legacy JSON doesn't exist
          }
        } else {
          await writeFileAtomic(persistPath, data);
        }
      }
      logger.debug('[OramaVectorService] Persisted all databases');
    } catch (error) {
      logger.error(
        '[OramaVectorService] Persistence failed:',
        attachErrorCode(error, ERROR_CODES.VECTOR_DB_PERSIST_FAILED)
      );
    } finally {
      this._isPersisting = false;
      // If new writes arrived while we were persisting, the debounce timer that
      // fired during our run was dropped (guard on line 368). Reschedule so
      // those writes are not silently orphaned.
      if (this._persistPending && !this._isShuttingDown) {
        this._persistTimer = setTimeout(() => {
          this._currentPersistPromise = this._doPersist();
        }, PERSIST_DEBOUNCE_MS);
      }
    }
  }

  /**
   * Force persist all databases immediately.
   * Waits for any in-flight background persist before starting a new one.
   */
  async persistAll() {
    // Wait for any fire-and-forget persist triggered by _schedulePersist
    if (this._currentPersistPromise) {
      await this._currentPersistPromise;
    }
    this._persistPending = true;
    const myPromise = this._doPersist();
    this._currentPersistPromise = myPromise;
    await myPromise;
    // Only null out if no new persist was scheduled while we were running
    if (this._currentPersistPromise === myPromise) {
      this._currentPersistPromise = null;
    }
  }

  /**
   * Validate embedding dimensions
   * @private
   */
  _validateEmbedding(embedding, collectionType = 'files') {
    if (!Array.isArray(embedding)) {
      throw new Error('Embedding must be an array');
    }
    if (embedding.length === 0) {
      throw new Error('Embedding cannot be empty');
    }
    if (embedding.some((v) => !Number.isFinite(v))) {
      throw new Error('Embedding contains invalid values (NaN or Infinity)');
    }

    // Check against cached dimension
    const expectedDim = this._collectionDimensions[collectionType];
    if (expectedDim !== null && embedding.length !== expectedDim) {
      const error =
        `Embedding dimension mismatch: collection "${collectionType}" expects ${expectedDim} dimensions but received ${embedding.length}. ` +
        `This typically occurs when changing embedding models. Use "Rebuild Embeddings" to migrate to the new model.`;

      this.emit('dimension-mismatch', {
        collectionType,
        expectedDim,
        actualDim: embedding.length,
        message: error
      });

      throw attachErrorCode(new Error(error), ERROR_CODES.VECTOR_DB_DIMENSION_MISMATCH);
    }

    // Cache dimension on first insert
    if (expectedDim === null) {
      this._collectionDimensions[collectionType] = embedding.length;
    }
  }

  /**
   * Validate embedding dimension without throwing
   * @param {Array<number>} vector - Embedding vector
   * @param {string} collectionType - Collection name
   * @returns {Promise<{valid: boolean, error?: string, expectedDim?: number, actualDim?: number}>}
   */
  async validateEmbeddingDimension(vector, collectionType) {
    if (!Array.isArray(vector) || vector.length === 0) {
      return { valid: false, error: 'invalid_vector' };
    }

    const expectedDim = this._collectionDimensions[collectionType];

    // If collection is empty, any dimension is valid
    if (expectedDim === null) {
      this._collectionDimensions[collectionType] = vector.length;
      return { valid: true };
    }

    if (vector.length !== expectedDim) {
      return {
        valid: false,
        error: 'dimension_mismatch',
        expectedDim,
        actualDim: vector.length
      };
    }

    return { valid: true };
  }

  _validateBatchDimensions(items, collectionType) {
    const vectors = (items || [])
      .map((item) => item?.vector)
      .filter((vector) => Array.isArray(vector) && vector.length > 0);

    if (vectors.length === 0) {
      return { valid: true };
    }

    const expectedDim = this._collectionDimensions[collectionType];
    if (expectedDim !== null) {
      const mismatch = vectors.find((vector) => vector.length !== expectedDim);
      if (mismatch) {
        return {
          valid: false,
          error: 'dimension_mismatch',
          expectedDim,
          actualDim: mismatch.length
        };
      }
      return { valid: true };
    }

    const expected = vectors[0].length;
    const mismatch = vectors.find((vector) => vector.length !== expected);
    if (mismatch) {
      return {
        valid: false,
        error: 'dimension_mismatch',
        expectedDim: expected,
        actualDim: mismatch.length
      };
    }

    this._collectionDimensions[collectionType] = expected;
    return { valid: true };
  }

  /**
   * Get collection dimension
   * @param {string} collectionType - Collection name
   * @returns {Promise<number|null>}
   */
  async getCollectionDimension(collectionType) {
    return this._collectionDimensions[collectionType];
  }

  // ==================== FILE OPERATIONS ====================

  /**
   * Get a file document by ID
   * @param {string} id - File ID
   * @returns {Promise<Object|null>} File document or null
   */
  async getFile(id) {
    await this.initialize();
    try {
      const doc = await getByID(this._databases.files, id);
      return doc || null;
    } catch {
      return null;
    }
  }

  /**
   * Get a folder document by ID
   * @param {string} id - Folder ID
   * @returns {Promise<Object|null>} Folder document or null
   */
  async getFolder(id) {
    await this.initialize();
    try {
      return await getByID(this._databases.folders, id);
    } catch {
      return null;
    }
  }

  /**
   * Upsert a file embedding
   */
  async upsertFile(file) {
    if (!file.id || !file.vector || !Array.isArray(file.vector)) {
      throw new Error('Invalid file data: missing id or vector');
    }

    if (this._isShuttingDown) {
      return { queued: false, fileId: file.id, skipped: true, reason: 'shutdown' };
    }

    await this.initialize();

    // Validate dimensions
    const dimValidation = await this.validateEmbeddingDimension(file.vector, 'files');
    if (!dimValidation.valid) {
      this.emit('embedding-blocked', {
        type: 'dimension_mismatch',
        fileId: file.id,
        expectedDim: dimValidation.expectedDim,
        actualDim: dimValidation.actualDim,
        message: 'Embedding model changed. Run "Rebuild Embeddings" to fix.'
      });
      return {
        success: false,
        fileId: file.id,
        error: 'dimension_mismatch',
        requiresRebuild: true
      };
    }

    const doc = {
      id: file.id,
      embedding: file.vector,
      filePath: file.meta?.path || file.meta?.filePath || '',
      fileName: file.meta?.fileName || path.basename(file.meta?.path || ''),
      fileType: file.meta?.fileType || file.meta?.mimeType || '',
      analyzedAt: file.meta?.analyzedAt || new Date().toISOString(),
      suggestedName: file.meta?.suggestedName || '',
      keywords: file.meta?.keywords || [],
      tags: file.meta?.tags || [],
      isOrphaned: false,
      orphanedAt: '',
      extractionMethod: file.meta?.extractionMethod || ''
    };

    try {
      // Try to get existing document
      const existing = await getByID(this._databases.files, file.id);
      if (existing) {
        await update(this._databases.files, file.id, doc);
      } else {
        await insert(this._databases.files, doc);
      }
    } catch {
      // If getByID fails, try insert
      try {
        await insert(this._databases.files, doc);
      } catch {
        // Already exists, try update
        await update(this._databases.files, file.id, doc);
      }
    }

    this._invalidateCacheForFile(file.id);
    this._schedulePersist();

    return { success: true, fileId: file.id };
  }

  /**
   * Batch upsert files
   */
  async batchUpsertFiles(files) {
    if (!files || files.length === 0) {
      return { queued: false, count: 0 };
    }

    if (this._isShuttingDown) {
      return { queued: false, count: 0, skipped: true, reason: 'shutdown' };
    }

    await this.initialize();

    // Validate batch dimensions before upserting any items to avoid partial writes
    const dimValidation = this._validateBatchDimensions(files, 'files');
    if (!dimValidation.valid && dimValidation.error === 'dimension_mismatch') {
      this.emit('embedding-blocked', {
        type: 'dimension_mismatch',
        fileCount: files.length,
        expectedDim: dimValidation.expectedDim,
        actualDim: dimValidation.actualDim,
        message: 'Embedding model changed. Run "Rebuild Embeddings" to fix.'
      });
      return {
        success: false,
        count: files.length,
        error: 'dimension_mismatch',
        requiresRebuild: true
      };
    }

    let successCount = 0;
    for (const file of files) {
      try {
        const result = await this.upsertFile(file);
        if (result?.success !== false) {
          successCount++;
        }
      } catch (error) {
        logger.warn('[OramaVectorService] Failed to upsert file in batch:', {
          fileId: file.id,
          error: error.message
        });
      }
    }

    return { queued: false, count: successCount };
  }

  /**
   * Query similar files by embedding
   */
  async querySimilarFiles(queryEmbedding, topK = 10) {
    await this.initialize();

    this._validateEmbedding(queryEmbedding, 'files');

    try {
      const result = await search(this._databases.files, {
        mode: 'vector',
        vector: { value: queryEmbedding, property: 'embedding' },
        limit: topK,
        where: { isOrphaned: false }
      });

      return result.hits.map((hit) => ({
        id: hit.document.id,
        score: hit.score,
        distance: 1 - hit.score, // Convert similarity to distance
        metadata: {
          path: hit.document.filePath,
          filePath: hit.document.filePath,
          fileName: hit.document.fileName,
          fileType: hit.document.fileType,
          analyzedAt: hit.document.analyzedAt,
          suggestedName: hit.document.suggestedName,
          keywords: hit.document.keywords,
          tags: hit.document.tags
        }
      }));
    } catch (error) {
      throw attachErrorCode(error, ERROR_CODES.VECTOR_DB_QUERY_FAILED);
    }
  }

  /**
   * Delete a file embedding
   */
  async deleteFileEmbedding(fileId) {
    await this.initialize();

    try {
      await remove(this._databases.files, fileId);
      this._invalidateCacheForFile(fileId);

      // Cascade-delete associated chunks
      if (this._databases.fileChunks) {
        try {
          const chunkResults = await search(this._databases.fileChunks, {
            term: '',
            where: { fileId },
            limit: 10000
          });
          for (const hit of chunkResults.hits || []) {
            try {
              await remove(this._databases.fileChunks, hit.document.id);
            } catch {
              /* chunk may already be gone */
            }
          }
        } catch {
          logger.debug('[OramaVectorService] Chunk cascade-delete skipped for:', fileId);
        }
      }

      this._schedulePersist();
      return true;
    } catch (error) {
      logger.warn('[OramaVectorService] Delete file embedding failed:', {
        fileId,
        error: error.message
      });
      return false;
    }
  }

  /**
   * Batch delete file embeddings
   */
  async batchDeleteFileEmbeddings(fileIds) {
    if (!fileIds || fileIds.length === 0) {
      return { count: 0, queued: false };
    }

    await this.initialize();

    let deleted = 0;
    for (const id of fileIds) {
      try {
        await remove(this._databases.files, id);
        this._invalidateCacheForFile(id);
        deleted++;

        // Cascade-delete associated chunks
        try {
          const chunkResults = await search(this._databases.fileChunks, {
            term: '',
            where: { fileId: id },
            limit: 10000
          });
          for (const hit of chunkResults.hits || []) {
            try {
              await remove(this._databases.fileChunks, hit.document.id);
            } catch {
              /* chunk may already be gone */
            }
          }
        } catch {
          // Chunk cleanup is best-effort
        }
      } catch {
        // Continue on error
      }
    }

    this._schedulePersist();
    return { queued: false, count: deleted };
  }

  /**
   * Reset files collection
   */
  async resetFiles() {
    await this.initialize();
    this._databases.files = await create({ schema: this._schemas.files });
    this._collectionDimensions.files = null;
    this._clearQueryCache();
    await this.persistAll();
    logger.info('[OramaVectorService] Files collection reset');
  }

  /**
   * Update file paths (for move operations)
   */
  async updateFilePaths(pathUpdates) {
    if (!pathUpdates || pathUpdates.length === 0) {
      return 0;
    }

    await this.initialize();

    let updated = 0;
    for (const updateSpec of pathUpdates) {
      try {
        const { oldId, newId } = updateSpec || {};
        // Backward-compatible meta handling:
        // Some callers pass { newPath, newName } (legacy),
        // others pass { newMeta: { path, name } } (FilePathCoordinator).
        const newPath =
          updateSpec?.newPath || updateSpec?.newMeta?.path || updateSpec?.newMeta?.filePath || null;
        const newName =
          updateSpec?.newName || updateSpec?.newMeta?.name || updateSpec?.newMeta?.fileName || null;

        if (!oldId) continue;

        // Get existing document
        const existing = await getByID(this._databases.files, oldId);
        if (!existing) continue;

        // If ID changed, delete old and insert new
        if (newId && newId !== oldId) {
          await remove(this._databases.files, oldId);
          await insert(this._databases.files, {
            ...existing,
            id: newId,
            filePath: newPath || existing.filePath,
            fileName: newName || existing.fileName
          });
        } else {
          // Just update the path
          await update(this._databases.files, oldId, {
            ...existing,
            filePath: newPath || existing.filePath,
            fileName: newName || existing.fileName
          });
        }

        this._invalidateCacheForFile(oldId);
        if (newId) this._invalidateCacheForFile(newId);
        updated++;
      } catch (error) {
        logger.warn('[OramaVectorService] Failed to update file path:', {
          oldId: updateSpec?.oldId,
          newId: updateSpec?.newId,
          error: error.message
        });
      }
    }

    this._schedulePersist();
    return updated;
  }

  /**
   * Mark embeddings as orphaned
   */
  async markEmbeddingsOrphaned(fileIds) {
    if (!fileIds || fileIds.length === 0) {
      return { marked: 0, failed: 0 };
    }

    await this.initialize();

    let marked = 0;
    let failed = 0;

    for (const id of fileIds) {
      try {
        const existing = await getByID(this._databases.files, id);
        if (existing) {
          await update(this._databases.files, id, {
            ...existing,
            isOrphaned: true,
            orphanedAt: new Date().toISOString()
          });
          marked++;
        }
      } catch {
        failed++;
      }
    }

    this._schedulePersist();
    return { marked, failed };
  }

  /**
   * Get orphaned embeddings
   */
  async getOrphanedEmbeddings(maxAge) {
    await this.initialize();

    const result = await search(this._databases.files, {
      term: '',
      where: { isOrphaned: true },
      limit: 10000
    });

    let orphaned = result.hits.map((hit) => hit.document.id);

    // Filter by age if specified
    if (maxAge) {
      const cutoff = Date.now() - maxAge;
      orphaned = result.hits
        .filter((hit) => {
          const orphanedAt = hit.document.orphanedAt;
          if (!orphanedAt) return true;
          return new Date(orphanedAt).getTime() < cutoff;
        })
        .map((hit) => hit.document.id);
    }

    return orphaned;
  }

  /**
   * Get orphaned chunks (chunks whose parent file no longer exists)
   * @param {number|null} maxAge - Optional age filter in ms
   * @returns {Promise<string[]>} orphaned chunk IDs
   */
  async getOrphanedChunks(_maxAge) {
    await this.initialize();

    if (!this._databases.fileChunks) return [];

    // fileChunks schema has no isOrphaned flag, so we find orphans by checking
    // whether each chunk's fileId still exists in the files database.
    const allChunks = await search(this._databases.fileChunks, {
      term: '',
      limit: 10000
    });

    const orphaned = [];
    for (const hit of allChunks.hits || []) {
      const fileId = hit.document.fileId;
      if (!fileId) {
        orphaned.push(hit.document.id);
        continue;
      }
      try {
        const parent = await getByID(this._databases.files, fileId);
        if (!parent) {
          orphaned.push(hit.document.id);
        }
      } catch {
        // getByID throws if not found in some Orama versions
        orphaned.push(hit.document.id);
      }
    }

    return orphaned;
  }

  /**
   * Clone a file embedding
   */
  async cloneFileEmbedding(sourceId, destId, newMeta = {}) {
    await this.initialize();

    try {
      const source = await getByID(this._databases.files, sourceId);
      if (!source) {
        return { success: true, cloned: false };
      }

      // Only write fields that exist in the files schema (avoid clonedFrom/clonedAt
      // which are not in the Orama schema and would cause silent drops or errors)
      const { id: _id, ...sourceFields } = source;
      await insert(this._databases.files, {
        ...sourceFields,
        id: destId,
        filePath: newMeta.path || source.filePath,
        fileName: newMeta.fileName || source.fileName
      });

      this._schedulePersist();
      return { success: true, cloned: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  // ==================== FOLDER OPERATIONS ====================

  /**
   * Upsert a folder embedding
   */
  async upsertFolder(folder) {
    if (!folder.id || !folder.vector || !Array.isArray(folder.vector)) {
      throw new Error('Invalid folder data: missing id or vector');
    }

    if (this._isShuttingDown) {
      return { queued: false, folderId: folder.id, skipped: true, reason: 'shutdown' };
    }

    await this.initialize();
    this._validateEmbedding(folder.vector, 'folders');

    // Backward-compatible meta handling:
    // Some callers (legacy services) pass { name, path, description } at the top level.
    // Prefer `meta` when provided, but fall back to top-level fields.
    const meta = folder.meta && typeof folder.meta === 'object' ? folder.meta : {};
    const doc = {
      id: folder.id,
      embedding: folder.vector,
      folderPath: meta.path || meta.folderPath || folder.path || folder.folderPath || '',
      folderName: meta.name || meta.folderName || folder.name || folder.folderName || '',
      description: meta.description || folder.description || '',
      patterns: meta.patterns || folder.patterns || []
    };

    try {
      const existing = await getByID(this._databases.folders, folder.id);
      if (existing) {
        await update(this._databases.folders, folder.id, doc);
      } else {
        await insert(this._databases.folders, doc);
      }
    } catch {
      try {
        await insert(this._databases.folders, doc);
      } catch {
        await update(this._databases.folders, folder.id, doc);
      }
    }

    this._invalidateCacheForFolder();
    this._schedulePersist();

    return { success: true, folderId: folder.id };
  }

  /**
   * Batch upsert folders
   */
  async batchUpsertFolders(folders) {
    if (!folders || folders.length === 0) {
      return { queued: false, count: 0, skipped: [] };
    }

    await this.initialize();

    // Validate batch dimensions before upserting any items to avoid partial writes
    const dimValidation = this._validateBatchDimensions(folders, 'folders');
    if (!dimValidation.valid && dimValidation.error === 'dimension_mismatch') {
      this.emit('embedding-blocked', {
        type: 'dimension_mismatch',
        fileCount: folders.length,
        expectedDim: dimValidation.expectedDim,
        actualDim: dimValidation.actualDim,
        message: 'Embedding model changed. Run "Rebuild Embeddings" to fix.'
      });
      return {
        success: false,
        count: folders.length,
        error: 'dimension_mismatch',
        requiresRebuild: true
      };
    }

    let successCount = 0;
    const skipped = [];

    for (const folder of folders) {
      try {
        await this.upsertFolder(folder);
        successCount++;
      } catch (error) {
        skipped.push({ id: folder.id, error: error.message });
      }
    }

    return { queued: false, count: successCount, skipped };
  }

  /**
   * Query folders by embedding
   */
  async queryFoldersByEmbedding(embedding, topK = 5) {
    await this.initialize();

    this._validateEmbedding(embedding, 'folders');

    try {
      const result = await search(this._databases.folders, {
        mode: 'vector',
        vector: { value: embedding, property: 'embedding' },
        limit: topK
      });

      return result.hits.map((hit) => ({
        id: hit.document.id,
        score: hit.score,
        distance: 1 - hit.score,
        metadata: {
          path: hit.document.folderPath,
          folderPath: hit.document.folderPath,
          folderName: hit.document.folderName,
          description: hit.document.description,
          patterns: hit.document.patterns
        }
      }));
    } catch (error) {
      throw attachErrorCode(error, ERROR_CODES.VECTOR_DB_QUERY_FAILED);
    }
  }

  /**
   * Query folders for a file (gets file embedding first, then queries folders)
   */
  async queryFolders(fileId, topK = 5) {
    await this.initialize();

    // Check cache
    const cacheKey = `folders:${fileId}:${topK}`;
    const cached = this._getCachedQuery(cacheKey);
    if (cached) return cached;

    // Get file embedding
    const file = await getByID(this._databases.files, fileId);
    if (!file || !file.embedding) {
      return [];
    }

    const results = await this.queryFoldersByEmbedding(file.embedding, topK);
    this._setCachedQuery(cacheKey, results);
    return results;
  }

  /**
   * Batch query folders for multiple files
   */
  async batchQueryFolders(fileIds, topK = 5) {
    const results = {};
    for (const fileId of fileIds) {
      results[fileId] = await this.queryFolders(fileId, topK);
    }
    return results;
  }

  /**
   * Get all folders
   */
  async getAllFolders() {
    await this.initialize();

    const result = await search(this._databases.folders, {
      term: '',
      limit: 10000
    });

    return result.hits.map((hit) => ({
      id: hit.document.id,
      metadata: {
        path: hit.document.folderPath,
        folderPath: hit.document.folderPath,
        folderName: hit.document.folderName,
        description: hit.document.description,
        patterns: hit.document.patterns
      }
    }));
  }

  /**
   * Delete a folder embedding
   */
  async deleteFolderEmbedding(folderId) {
    await this.initialize();

    try {
      await remove(this._databases.folders, folderId);
      this._invalidateCacheForFolder();
      this._schedulePersist();
      return { queued: false, success: true };
    } catch (error) {
      return { queued: false, success: false, error: error.message };
    }
  }

  /**
   * Batch delete folders
   */
  async batchDeleteFolders(folderIds) {
    if (!folderIds || folderIds.length === 0) {
      return { count: 0, queued: false };
    }

    await this.initialize();

    let deleted = 0;
    for (const id of folderIds) {
      try {
        await remove(this._databases.folders, id);
        deleted++;
      } catch {
        // Continue
      }
    }

    this._invalidateCacheForFolder();
    this._schedulePersist();
    return { queued: false, count: deleted };
  }

  /**
   * Reset folders collection
   */
  async resetFolders() {
    await this.initialize();
    this._databases.folders = await create({ schema: this._schemas.folders });
    this._collectionDimensions.folders = null;
    this._invalidateCacheForFolder();
    await this.persistAll();
    logger.info('[OramaVectorService] Folders collection reset');
  }

  // ==================== CHUNK OPERATIONS ====================

  /**
   * Batch upsert file chunks
   */
  async batchUpsertFileChunks(chunks) {
    if (!chunks || chunks.length === 0) {
      return 0;
    }

    await this.initialize();

    // Validate first chunk's dimensions
    const firstChunkWithVector = chunks.find((c) => Array.isArray(c.vector) && c.vector.length > 0);
    if (firstChunkWithVector) {
      const dimValidation = await this.validateEmbeddingDimension(
        firstChunkWithVector.vector,
        'fileChunks'
      );
      if (!dimValidation.valid && dimValidation.error === 'dimension_mismatch') {
        throw new Error(
          `Chunk embedding dimension mismatch: expected ${dimValidation.expectedDim}, got ${dimValidation.actualDim}. ` +
            `Run "Rebuild Embeddings" to fix.`
        );
      }
    }

    let inserted = 0;
    for (const chunk of chunks) {
      try {
        const doc = {
          id: chunk.id,
          embedding: chunk.vector,
          fileId: chunk.meta?.fileId || chunk.meta?.parentFileId || '',
          chunkIndex: chunk.meta?.chunkIndex || 0,
          content: chunk.meta?.content || chunk.meta?.text || '',
          startOffset: chunk.meta?.startOffset || 0,
          endOffset: chunk.meta?.endOffset || 0
        };

        try {
          await insert(this._databases.fileChunks, doc);
        } catch {
          await update(this._databases.fileChunks, chunk.id, doc);
        }
        inserted++;
      } catch (error) {
        logger.warn('[OramaVectorService] Failed to upsert chunk:', {
          chunkId: chunk.id,
          error: error.message
        });
      }
    }

    this._schedulePersist();
    return inserted;
  }

  /**
   * Query similar file chunks
   */
  async querySimilarFileChunks(queryEmbedding, topK = 20) {
    await this.initialize();

    this._validateEmbedding(queryEmbedding, 'fileChunks');

    try {
      const result = await search(this._databases.fileChunks, {
        mode: 'vector',
        vector: { value: queryEmbedding, property: 'embedding' },
        limit: topK
      });

      return result.hits.map((hit) => ({
        id: hit.document.id,
        score: hit.score,
        distance: 1 - hit.score,
        metadata: {
          fileId: hit.document.fileId,
          chunkIndex: hit.document.chunkIndex,
          content: hit.document.content,
          startOffset: hit.document.startOffset,
          endOffset: hit.document.endOffset
        }
      }));
    } catch (error) {
      throw attachErrorCode(error, ERROR_CODES.VECTOR_DB_QUERY_FAILED);
    }
  }

  /**
   * Get all chunks for a given file, sorted by chunkIndex.
   * @param {string} fileId - The file ID to fetch chunks for
   * @returns {Promise<Array<{chunkIndex: number, text: string, snippet: string}>>}
   */
  async getChunksForFile(fileId) {
    await this.initialize();
    try {
      const result = await search(this._databases.fileChunks, {
        term: '',
        where: { fileId },
        limit: 10000
      });

      const chunks = (result.hits || []).map((hit) => {
        const doc = hit.document || {};
        return {
          chunkIndex: doc.chunkIndex,
          text: doc.content || '',
          snippet: doc.content || ''
        };
      });

      // Sort by chunk index for ordered context
      chunks.sort((a, b) => (a.chunkIndex ?? 0) - (b.chunkIndex ?? 0));
      return chunks;
    } catch (error) {
      logger.debug('[OramaVectorService] Failed to get chunks for file:', error.message);
      return [];
    }
  }

  /**
   * Delete file chunks
   */
  async deleteFileChunks(fileId) {
    await this.initialize();

    // Find all chunks for this file
    const result = await search(this._databases.fileChunks, {
      term: '',
      where: { fileId },
      limit: 10000
    });

    let deleted = 0;
    for (const hit of result.hits) {
      try {
        await remove(this._databases.fileChunks, hit.document.id);
        deleted++;
      } catch {
        // Continue
      }
    }

    this._schedulePersist();
    return deleted;
  }

  /**
   * Clone file chunks
   */
  async cloneFileChunks(sourceId, destId, _newMeta = {}) {
    await this.initialize();

    // Find all chunks for source file
    const result = await search(this._databases.fileChunks, {
      term: '',
      where: { fileId: sourceId },
      limit: 10000
    });

    let cloned = 0;
    for (const hit of result.hits) {
      try {
        // Orama search() returns null for vector fields; use getByID() for full document
        const fullChunk = await getByID(this._databases.fileChunks, hit.document.id);
        if (!fullChunk) continue;

        const newChunkId = fullChunk.id.replaceAll(sourceId, destId);
        await insert(this._databases.fileChunks, {
          ...fullChunk,
          id: newChunkId,
          fileId: destId
        });
        cloned++;
      } catch {
        // Continue
      }
    }

    this._schedulePersist();
    return { success: true, cloned: cloned > 0, count: cloned };
  }

  /**
   * Reset file chunks collection
   */
  async resetFileChunks() {
    await this.initialize();
    this._databases.fileChunks = await create({ schema: this._schemas.fileChunks });
    this._collectionDimensions.fileChunks = null;
    await this.persistAll();
    logger.info('[OramaVectorService] File chunks collection reset');
  }

  // ==================== FEEDBACK MEMORY OPERATIONS ====================

  /**
   * Upsert feedback memory
   */
  async upsertFeedbackMemory({ id, vector, metadata = {}, document = '' }) {
    if (!id || !vector || !Array.isArray(vector)) {
      throw new Error('Invalid feedback memory data: missing id or vector');
    }

    await this.initialize();
    this._validateEmbedding(vector, 'feedback');

    const doc = {
      id,
      embedding: vector,
      text: document,
      feedbackType: metadata.type || '',
      metadata: JSON.stringify(metadata)
    };

    try {
      await insert(this._databases.feedback, doc);
    } catch {
      await update(this._databases.feedback, id, doc);
    }

    this._schedulePersist();
  }

  /**
   * Query feedback memory
   */
  async queryFeedbackMemory(queryEmbedding, topK = 5) {
    await this.initialize();
    this._validateEmbedding(queryEmbedding, 'feedback');

    const totalCount = await count(this._databases.feedback);
    if (totalCount === 0) return [];

    try {
      const result = await search(this._databases.feedback, {
        mode: 'vector',
        vector: { value: queryEmbedding, property: 'embedding' },
        limit: topK
      });

      return result.hits.map((hit) => ({
        id: hit.document.id,
        score: hit.score,
        metadata: JSON.parse(hit.document.metadata || '{}'),
        document: hit.document.text
      }));
    } catch (error) {
      throw attachErrorCode(error, ERROR_CODES.VECTOR_DB_QUERY_FAILED);
    }
  }

  /**
   * Delete feedback memory
   */
  async deleteFeedbackMemory(id) {
    await this.initialize();
    try {
      await remove(this._databases.feedback, id);
      this._schedulePersist();
    } catch {
      // Ignore
    }
  }

  /**
   * Reset feedback memory
   */
  async resetFeedbackMemory() {
    await this.initialize();
    this._databases.feedback = await create({ schema: this._schemas.feedback });
    this._collectionDimensions.feedback = null;
    await this.persistAll();
  }

  // ==================== LEARNING PATTERNS OPERATIONS ====================

  /**
   * Upsert learning patterns
   */
  async upsertLearningPatterns({ id, patterns, feedbackHistory, folderUsageStats, lastUpdated }) {
    if (!id) {
      throw new Error('Invalid learning pattern data: missing id');
    }

    await this.initialize();

    // Use placeholder vector (learning patterns are retrieved by ID, not similarity)
    const dimension =
      this._collectionDimensions.learningPatterns ||
      this._collectionDimensions.files ||
      this._dimension;

    const placeholderVector = new Array(dimension).fill(0);
    placeholderVector[0] = 1;

    const doc = {
      id,
      embedding: placeholderVector,
      document: JSON.stringify({
        patterns: patterns || [],
        feedbackHistory: feedbackHistory || [],
        folderUsageStats: folderUsageStats || []
      }),
      lastUpdated: lastUpdated || new Date().toISOString(),
      patternCount: Array.isArray(patterns) ? patterns.length : 0,
      feedbackCount: Array.isArray(feedbackHistory) ? feedbackHistory.length : 0,
      folderStatsCount: Array.isArray(folderUsageStats) ? folderUsageStats.length : 0
    };

    try {
      await insert(this._databases.learningPatterns, doc);
    } catch {
      await update(this._databases.learningPatterns, id, doc);
    }

    this._schedulePersist();
  }

  /**
   * Get learning patterns
   */
  async getLearningPatterns(id) {
    await this.initialize();

    try {
      const doc = await getByID(this._databases.learningPatterns, id);
      if (!doc) return null;

      const parsed = JSON.parse(doc.document || '{}');
      return {
        id: doc.id,
        patterns: parsed.patterns || [],
        feedbackHistory: parsed.feedbackHistory || [],
        folderUsageStats: parsed.folderUsageStats || [],
        lastUpdated: doc.lastUpdated,
        metadata: {
          patternCount: doc.patternCount,
          feedbackCount: doc.feedbackCount,
          folderStatsCount: doc.folderStatsCount
        }
      };
    } catch {
      return null;
    }
  }

  /**
   * Delete learning patterns
   */
  async deleteLearningPatterns(id) {
    await this.initialize();
    try {
      await remove(this._databases.learningPatterns, id);
      this._schedulePersist();
    } catch {
      // Ignore
    }
  }

  /**
   * Reset learning patterns
   */
  async resetLearningPatterns() {
    await this.initialize();
    this._databases.learningPatterns = await create({ schema: this._schemas.learningPatterns });
    this._collectionDimensions.learningPatterns = null;
    await this.persistAll();
  }

  // ==================== HYBRID SEARCH ====================

  /**
   * Perform hybrid BM25 + vector search
   */
  async hybridSearch(queryText, queryEmbedding, options = {}) {
    const { topK = 10, vectorWeight = 0.7 } = options;

    await this.initialize();
    this._validateEmbedding(queryEmbedding, 'files');

    let vectorResults;
    let bm25Results;
    try {
      // Vector search
      vectorResults = await search(this._databases.files, {
        mode: 'vector',
        vector: { value: queryEmbedding, property: 'embedding' },
        limit: topK * 2,
        where: { isOrphaned: false }
      });

      // BM25 search
      bm25Results = await search(this._databases.files, {
        term: queryText,
        properties: ['fileName', 'suggestedName', 'keywords'],
        limit: topK * 2,
        where: { isOrphaned: false }
      });
    } catch (error) {
      throw attachErrorCode(error, ERROR_CODES.VECTOR_DB_QUERY_FAILED);
    }

    // Reciprocal Rank Fusion
    const scores = new Map();
    const k = 60; // RRF constant

    vectorResults.hits.forEach((hit, rank) => {
      const current = scores.get(hit.document.id) || { doc: hit.document, score: 0 };
      current.score += vectorWeight / (k + rank + 1);
      scores.set(hit.document.id, current);
    });

    bm25Results.hits.forEach((hit, rank) => {
      const current = scores.get(hit.document.id) || { doc: hit.document, score: 0 };
      current.score += (1 - vectorWeight) / (k + rank + 1);
      scores.set(hit.document.id, current);
    });

    // Sort and return top K
    return Array.from(scores.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, topK)
      .map(({ doc, score }) => ({
        id: doc.id,
        score,
        metadata: {
          filePath: doc.filePath,
          fileName: doc.fileName,
          fileType: doc.fileType,
          suggestedName: doc.suggestedName,
          keywords: doc.keywords,
          tags: doc.tags
        }
      }));
  }

  // ==================== UTILITY ====================

  /**
   * Reset all collections
   */
  async resetAll() {
    await this.resetFiles();
    await this.resetFileChunks();
    await this.resetFolders();
    await this.resetFeedbackMemory();
    await this.resetLearningPatterns();
    logger.info('[OramaVectorService] All collections reset');
  }

  /**
   * Get statistics
   */
  async getStats() {
    await this.initialize();

    const counts = {};
    for (const [name, db] of Object.entries(this._databases)) {
      counts[name] = await count(db);
    }

    const totalDocuments = Object.values(counts).reduce((sum, c) => sum + c, 0);
    return {
      files: counts.files || 0,
      folders: counts.folders || 0,
      fileChunks: counts.fileChunks || 0,
      feedback: counts.feedback || 0,
      learningPatterns: counts.learningPatterns || 0,
      // Aliases expected by IPC vectordb handler
      collections: Object.keys(this._databases).length,
      documents: totalDocuments,
      dbPath: this._dataPath,
      initialized: this._initialized,
      dimension: this._dimension,
      queryCache: {
        size: this._queryCache.size,
        maxSize: this._queryCacheMaxSize
      }
    };
  }

  /**
   * Peek a sample of file embeddings for diagnostics
   * @param {number} [limit=50] - Max number of documents to return
   * @returns {Promise<{ids: string[], embeddings: number[][], metadatas: Object[]}>}
   */
  async peekFiles(limit = 50) {
    await this.initialize();

    try {
      const result = await search(this._databases.files, {
        term: '',
        limit: Math.max(1, Math.min(Number(limit) || 50, 10000))
      });

      const ids = [];
      const embeddings = [];
      const metadatas = [];

      for (const hit of result.hits || []) {
        const searchDoc = hit.document || {};
        // Orama search() returns null for vector fields; use getByID() to get actual embeddings
        let doc = searchDoc;
        if (searchDoc.id && !Array.isArray(searchDoc.embedding)) {
          try {
            const fullDoc = await getByID(this._databases.files, searchDoc.id);
            if (fullDoc) doc = fullDoc;
          } catch {
            /* fall back to search result */
          }
        }
        ids.push(doc.id);
        embeddings.push(Array.isArray(doc.embedding) ? doc.embedding : []);
        metadatas.push({
          path: doc.filePath,
          filePath: doc.filePath,
          fileName: doc.fileName,
          fileType: doc.fileType,
          analyzedAt: doc.analyzedAt,
          suggestedName: doc.suggestedName,
          keywords: doc.keywords,
          tags: doc.tags,
          extractionMethod: doc.extractionMethod
        });
      }

      return { ids, embeddings, metadatas };
    } catch (error) {
      logger.debug('[OramaVectorService] Failed to peek files:', error.message);
      return { ids: [], embeddings: [], metadatas: [] };
    }
  }

  /**
   * Check health (always healthy for in-process)
   */
  async checkHealth() {
    return true;
  }

  // Circuit breaker compatibility (no-op for in-process)
  getCircuitState() {
    return 'CLOSED';
  }

  getCircuitStats() {
    return { state: 'CLOSED', failures: 0, successes: 0 };
  }

  getQueueStats() {
    return { size: 0, processed: 0, failed: 0 };
  }

  isServiceAvailable() {
    return true;
  }

  forceRecovery() {
    // No-op
  }

  // ==================== QUERY CACHE ====================

  _getCachedQuery(key) {
    const entry = this._queryCache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.timestamp > this._queryCacheTtlMs) {
      this._queryCache.delete(key);
      return null;
    }
    return entry.data;
  }

  _setCachedQuery(key, data) {
    // LRU eviction
    if (this._queryCache.size >= this._queryCacheMaxSize) {
      const firstKey = this._queryCache.keys().next().value;
      this._queryCache.delete(firstKey);
    }
    this._queryCache.set(key, { data, timestamp: Date.now() });
  }

  _invalidateCacheForFile(fileId) {
    for (const key of this._queryCache.keys()) {
      if (key.includes(fileId)) {
        this._queryCache.delete(key);
      }
    }
  }

  _invalidateCacheForFolder() {
    for (const key of this._queryCache.keys()) {
      if (key.startsWith('folders:')) {
        this._queryCache.delete(key);
      }
    }
  }

  _clearQueryCache() {
    this._queryCache.clear();
  }

  clearQueryCache() {
    this._clearQueryCache();
  }

  getQueryCacheStats() {
    return {
      size: this._queryCache.size,
      maxSize: this._queryCacheMaxSize,
      ttlMs: this._queryCacheTtlMs
    };
  }

  // ==================== CLEANUP ====================

  /**
   * Cleanup and shutdown
   */
  async cleanup() {
    // Clear timers first to prevent new debounced persists
    if (this._persistTimer) {
      clearTimeout(this._persistTimer);
      this._persistTimer = null;
    }

    // Final persistence BEFORE setting _isShuttingDown (the guard in _doPersist blocks writes when shutting down)
    if (this._initialized) {
      try {
        // Wait for any in-flight background persist before starting final persist
        if (this._currentPersistPromise) {
          await this._currentPersistPromise;
        }
        this._persistPending = true; // Ensure _doPersist doesn't short-circuit
        await this._doPersist();
      } catch (error) {
        logger.error('[OramaVectorService] Final persistence failed:', error);
      }
      // Clear any timer the reschedule logic in _doPersist may have created
      // during the final persist (writes arriving mid-persist set _persistPending
      // which triggers a new timer in the finally block).
      if (this._persistTimer) {
        clearTimeout(this._persistTimer);
        this._persistTimer = null;
      }
    }

    this._isShuttingDown = true;
    this.isOnline = false;

    // Clear state
    this._queryCache.clear();
    this._databases = {};
    this._initialized = false;
    this._initPromise = null;

    this.removeAllListeners();
    logger.info('[OramaVectorService] Cleanup complete');
  }

  // Alias for cleanup
  async shutdown() {
    await this.cleanup();
  }
}

// Singleton helpers
const { getInstance, createInstance, registerWithContainer, resetInstance } =
  createSingletonHelpers({
    ServiceClass: OramaVectorService,
    serviceId: 'ORAMA_VECTOR',
    serviceName: 'OramaVector',
    containerPath: './ServiceContainer',
    shutdownMethod: 'shutdown'
  });

module.exports = {
  OramaVectorService,
  getInstance,
  createInstance,
  registerWithContainer,
  resetInstance,
  DEFAULT_EMBEDDING_DIMENSION
};
