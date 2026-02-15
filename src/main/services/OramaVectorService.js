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
const { persist, restore: _restore } = require('@orama/plugin-data-persistence');
const { createLogger } = require('../../shared/logger');
const { createSingletonHelpers } = require('../../shared/singletonFactory');
const { AI_DEFAULTS } = require('../../shared/constants');
const { ERROR_CODES } = require('../../shared/errorCodes');
const { replaceFileWithRetry } = require('../../shared/atomicFile');
const { compress, uncompress } = require('../../shared/lz4Codec');
const { resolveEmbeddingDimension } = require('../../shared/embeddingDimensions');
const { getEmbeddingModel, loadLlamaConfig, getLlamaService } = require('../llamaUtils');
const { writeEmbeddingIndexMetadata } = require('./vectorDb/embeddingIndexMetadata');
const { get: getConfig } = require('../../shared/config/index');
const { SEARCH } = require('../../shared/performanceConstants');

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
const DEFAULT_BATCH_UPSERT_CONCURRENCY = 3;
const MAX_BATCH_UPSERT_CONCURRENCY = 6;
const VECTOR_PRIMARY_VALIDATION_INTERVAL_MS = 60000;
const VECTOR_PRIMARY_MAX_REPAIR_ATTEMPTS = 2;

function resolveBatchUpsertConcurrency() {
  const configured =
    process.env.STRATOSORT_ORAMA_BATCH_UPSERT_CONCURRENCY ??
    getConfig('VECTOR_DB.batchUpsertConcurrency', DEFAULT_BATCH_UPSERT_CONCURRENCY);
  const parsed = Number.parseInt(String(configured), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_BATCH_UPSERT_CONCURRENCY;
  }
  return Math.max(1, Math.min(parsed, MAX_BATCH_UPSERT_CONCURRENCY));
}

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
      hasVector: 'boolean',
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
    this._embeddingModel = null;
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

    // Embedding sidecar store – Orama's restore() loses vector data (v3.1.x bug),
    // so we cache embeddings separately, keyed by collection name → Map<docId, number[]>.
    this._embeddingStore = {};

    // Bounded concurrency for batch upsert paths to improve throughput without
    // overwhelming DB writes or event-loop latency.
    this._batchUpsertConcurrency = resolveBatchUpsertConcurrency();

    // Tracks whether primary vector retrieval is healthy. Fallback scoring is
    // allowed only when this health check remains degraded after repair.
    this._vectorHealth = {
      primaryHealthy: null,
      lastValidatedAt: 0,
      lastValidationReason: null,
      lastValidationError: null,
      lastRepairAt: 0,
      repairAttempts: 0
    };
    this._vectorHealthPromise = null;
  }

  async _runBoundedBatch(items, workerFn, concurrency = this._batchUpsertConcurrency) {
    const safeConcurrency = Math.max(
      1,
      Math.min(Number.isFinite(concurrency) ? Math.floor(concurrency) : 1, items.length || 1)
    );
    const results = new Array(items.length);
    let cursor = 0;

    const worker = async () => {
      while (true) {
        const index = cursor++;
        if (index >= items.length) break;
        try {
          const value = await workerFn(items[index], index);
          results[index] = { status: 'fulfilled', value };
        } catch (error) {
          results[index] = { status: 'rejected', reason: error };
        }
      }
    };

    const workers = Array.from({ length: safeConcurrency }, () => worker());
    await Promise.all(workers);
    return results;
  }

  /**
   * Normalize persisted embedding payloads to plain numeric arrays.
   * Handles Array, TypedArray, and object-with-numeric-keys shapes.
   * @private
   */
  _normalizeEmbeddingVector(value, expectedDim = null) {
    let vector = null;
    if (Array.isArray(value)) {
      vector = value;
    } else if (ArrayBuffer.isView(value)) {
      vector = Array.from(value);
    } else if (value && typeof value === 'object') {
      const keys = Object.keys(value);
      if (keys.length > 0 && keys.every((k) => /^\d+$/.test(k))) {
        keys.sort((a, b) => Number(a) - Number(b));
        vector = keys.map((k) => value[k]);
      }
    }

    if (!Array.isArray(vector) || vector.length === 0) return null;
    if (Number.isFinite(expectedDim) && expectedDim > 0 && vector.length !== expectedDim)
      return null;

    const normalized = vector.map((n) => Number(n));
    if (normalized.some((n) => !Number.isFinite(n))) return null;
    return normalized;
  }

  _getVectorHealthSnapshot() {
    return { ...this._vectorHealth };
  }

  _setVectorHealth(update) {
    this._vectorHealth = {
      ...this._vectorHealth,
      ...update
    };
    this.emit('vector-health', this._getVectorHealthSnapshot());
  }

  async _getAllFileDocuments() {
    if (!this._databases?.files) return [];

    // Prefer a persistence snapshot so repair/fallback logic is not capped by search limits.
    try {
      const snapshot = await persist(this._databases.files);
      const docsById = snapshot?.docs?.docs;
      if (docsById && typeof docsById === 'object') {
        return Object.values(docsById).filter((doc) => doc && typeof doc === 'object');
      }
    } catch (error) {
      logger.warn(
        '[OramaVectorService] Failed to snapshot files DB; falling back to paged search',
        {
          error: error?.message
        }
      );
    }

    const pageSize = 1000;
    const docs = [];
    const seenFirstIds = new Set();
    let offset = 0;

    while (true) {
      const page = await search(this._databases.files, {
        term: '',
        limit: pageSize,
        offset
      });
      const hits = Array.isArray(page?.hits) ? page.hits : [];
      if (hits.length === 0) break;

      const firstId = hits[0]?.document?.id;
      if (offset > 0 && firstId && seenFirstIds.has(firstId)) {
        logger.warn(
          '[OramaVectorService] Detected repeating paged search results; stopping to avoid infinite loop',
          { offset, pageSize, firstId }
        );
        break;
      }
      if (firstId) seenFirstIds.add(firstId);

      for (const hit of hits) {
        if (hit?.document && typeof hit.document === 'object') {
          docs.push(hit.document);
        }
      }

      if (hits.length < pageSize) break;
      offset += hits.length;
    }

    return docs;
  }

  async _repairFilesVectorIndexFromCurrentState() {
    if (!this._databases?.files) return { repaired: false, reason: 'files-db-unavailable' };

    const sourceDocs = await this._getAllFileDocuments();

    const rebuilt = await create({ schema: this._schemas.files });
    const rebuiltEmbeddings = new Map();
    let repairedDocs = 0;
    let placeholders = 0;

    for (const existing of sourceDocs) {
      const normalizedEmbedding = this._normalizeEmbeddingVector(
        this._embeddingStore?.files?.get(existing.id) || existing.embedding,
        this._dimension
      );
      const hasVector =
        Array.isArray(normalizedEmbedding) &&
        normalizedEmbedding.length === this._dimension &&
        !(normalizedEmbedding[0] === 0 && normalizedEmbedding.every((v) => v === 0));
      const embedding = hasVector
        ? normalizedEmbedding
        : Array.from({ length: this._dimension }, () => 0);

      await insert(rebuilt, {
        id: existing.id,
        embedding,
        hasVector,
        filePath: existing.filePath || '',
        fileName: existing.fileName || '',
        fileType: existing.fileType || '',
        analyzedAt: existing.analyzedAt || new Date().toISOString(),
        suggestedName: existing.suggestedName || '',
        keywords: Array.isArray(existing.keywords) ? existing.keywords : [],
        tags: Array.isArray(existing.tags) ? existing.tags : [],
        isOrphaned: Boolean(existing.isOrphaned),
        orphanedAt: existing.orphanedAt || '',
        extractionMethod: existing.extractionMethod || ''
      });

      if (hasVector) {
        rebuiltEmbeddings.set(existing.id, embedding);
      } else {
        placeholders++;
      }
      repairedDocs++;
    }

    this._databases.files = rebuilt;
    this._embeddingStore.files = rebuiltEmbeddings;
    this._collectionDimensions.files = this._dimension;
    this._clearQueryCache();
    await this.persistAll();

    return {
      repaired: true,
      repairedDocs,
      placeholders,
      embeddingsCached: rebuiltEmbeddings.size
    };
  }

  async _ensurePrimaryVectorHealth({ reason = 'runtime', force = false, autoRepair = true } = {}) {
    const now = Date.now();
    if (
      !force &&
      this._vectorHealth.lastValidatedAt > 0 &&
      now - this._vectorHealth.lastValidatedAt < VECTOR_PRIMARY_VALIDATION_INTERVAL_MS
    ) {
      return this._getVectorHealthSnapshot();
    }

    if (this._vectorHealthPromise) {
      return this._vectorHealthPromise;
    }

    this._vectorHealthPromise = (async () => {
      const embStore = this._embeddingStore?.files;
      if (!(embStore instanceof Map) || embStore.size === 0) {
        this._setVectorHealth({
          primaryHealthy: true,
          lastValidatedAt: Date.now(),
          lastValidationReason: `${reason}:no-vectors`,
          lastValidationError: null
        });
        return this._getVectorHealthSnapshot();
      }

      const probeEntry = Array.from(embStore.entries()).find(([_, vector]) => {
        const normalized = this._normalizeEmbeddingVector(vector, this._dimension);
        return (
          Array.isArray(normalized) &&
          normalized.length === this._dimension &&
          !(normalized[0] === 0 && normalized.every((v) => v === 0))
        );
      });

      if (!probeEntry) {
        this._setVectorHealth({
          primaryHealthy: true,
          lastValidatedAt: Date.now(),
          lastValidationReason: `${reason}:no-valid-probe`,
          lastValidationError: null
        });
        return this._getVectorHealthSnapshot();
      }

      const [probeId, probeVector] = probeEntry;
      const runProbe = async () => {
        const probeResults = await search(this._databases.files, {
          mode: 'vector',
          vector: { value: probeVector, property: 'embedding' },
          limit: 5,
          where: { isOrphaned: false, hasVector: true }
        });
        return (probeResults.hits || []).some((hit) => hit?.document?.id === probeId);
      };

      try {
        let healthy = await runProbe();
        if (
          !healthy &&
          autoRepair &&
          this._vectorHealth.repairAttempts < VECTOR_PRIMARY_MAX_REPAIR_ATTEMPTS
        ) {
          this._setVectorHealth({
            repairAttempts: this._vectorHealth.repairAttempts + 1,
            lastRepairAt: Date.now()
          });

          logger.warn(
            '[OramaVectorService] Primary vector self-check failed; attempting files index repair',
            {
              reason,
              probeId
            }
          );

          const repair = await this._repairFilesVectorIndexFromCurrentState();
          logger.info('[OramaVectorService] Files vector index repair completed', {
            ...repair,
            reason
          });
          healthy = await runProbe();
        }

        this._setVectorHealth({
          primaryHealthy: healthy,
          lastValidatedAt: Date.now(),
          lastValidationReason: reason,
          lastValidationError: null
        });

        return this._getVectorHealthSnapshot();
      } catch (error) {
        this._setVectorHealth({
          primaryHealthy: false,
          lastValidatedAt: Date.now(),
          lastValidationReason: reason,
          lastValidationError: error?.message || String(error)
        });
        logger.warn('[OramaVectorService] Primary vector self-check failed', {
          reason,
          error: error?.message
        });
        return this._getVectorHealthSnapshot();
      }
    })().finally(() => {
      this._vectorHealthPromise = null;
    });

    return this._vectorHealthPromise;
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

        await this._refreshEmbeddingDimension({ reason: 'initialize' });

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
          embeddingModel: this._embeddingModel || AI_DEFAULTS.EMBEDDING?.MODEL || 'unknown',
          counts
        });

        await this._ensurePrimaryVectorHealth({
          reason: 'initialize',
          force: true,
          autoRepair: true
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

  async _resolveEmbeddingConfig(modelOverride) {
    let modelName = modelOverride;
    if (!modelName) {
      try {
        const llamaService = getLlamaService();
        if (llamaService && typeof llamaService.getConfig === 'function') {
          const cfg = await llamaService.getConfig();
          modelName = cfg?.embeddingModel || null;
        }
      } catch (error) {
        logger.debug(
          '[OramaVectorService] Failed to read LlamaService config for dimension resolve',
          {
            error: error.message
          }
        );
      }
    }
    if (!modelName) {
      try {
        await loadLlamaConfig();
      } catch (error) {
        logger.debug('[OramaVectorService] Failed to load Llama config for dimension resolve', {
          error: error.message
        });
      }
      modelName = getEmbeddingModel();
    }

    if (!modelName) {
      modelName = AI_DEFAULTS.EMBEDDING?.MODEL || null;
    }

    const defaultDimension = getConfig('ANALYSIS.embeddingDimension', DEFAULT_EMBEDDING_DIMENSION);
    const dimension = resolveEmbeddingDimension(modelName, { defaultDimension });

    return { modelName, dimension };
  }

  async _refreshEmbeddingDimension({ reason, modelName } = {}) {
    const { modelName: resolvedModel, dimension } = await this._resolveEmbeddingConfig(modelName);
    const previousDimension = this._dimension;
    const previousModel = this._embeddingModel;

    const dimensionChanged =
      Number.isInteger(dimension) && dimension > 0 && dimension !== this._dimension;
    const modelChanged = resolvedModel && resolvedModel !== this._embeddingModel;

    if (dimensionChanged) {
      this._dimension = dimension;
      this._schemas = buildSchemas(this._dimension);
    } else if (!this._schemas) {
      this._schemas = buildSchemas(this._dimension);
    }

    if (modelChanged) {
      this._embeddingModel = resolvedModel;
    } else if (!this._embeddingModel && resolvedModel) {
      this._embeddingModel = resolvedModel;
    }

    if ((dimensionChanged || modelChanged) && reason) {
      logger.info('[OramaVectorService] Embedding config resolved', {
        reason,
        model: resolvedModel,
        dimension,
        previousDimension,
        previousModel
      });
    }

    return {
      modelName: resolvedModel,
      dimension: this._dimension,
      previousDimension,
      previousModel,
      dimensionChanged,
      modelChanged
    };
  }

  async handleEmbeddingModelChange({ previousModel, newModel, source } = {}) {
    const resolved = await this._refreshEmbeddingDimension({
      reason: 'model-change',
      modelName: newModel
    });

    if (resolved.dimensionChanged) {
      logger.warn('[OramaVectorService] Embedding dimension changed, resetting collections', {
        previousModel,
        newModel: resolved.modelName || newModel,
        previousDimension: resolved.previousDimension,
        newDimension: this._dimension
      });
      await this.resetAll();
    }

    try {
      await writeEmbeddingIndexMetadata({
        model: resolved.modelName || newModel || previousModel || 'unknown',
        dims: this._dimension,
        source: source || 'model-change'
      });
    } catch (error) {
      logger.debug('[OramaVectorService] Failed to update embedding metadata', {
        error: error.message
      });
    }

    this.emit('embedding-model-change', {
      previousModel,
      newModel: resolved.modelName || newModel,
      previousDimension: resolved.previousDimension,
      newDimension: this._dimension
    });

    return {
      previousModel,
      newModel: resolved.modelName || newModel,
      previousDimension: resolved.previousDimension,
      newDimension: this._dimension,
      dimensionChanged: resolved.dimensionChanged
    };
  }

  /**
   * Create or restore a database from persistence.
   *
   * IMPORTANT: Orama v3.1.x `restore()` has a bug where vector data is lost
   * after a persist/restore cycle (getByID returns null embeddings, vector
   * search returns 0 hits). We work around this by parsing the persisted JSON
   * ourselves, creating a fresh DB, and inserting documents one-by-one. This
   * ensures both text indexes and vector indexes are built correctly.
   *
   * @private
   */
  async _createOrRestoreDatabase(name, schema) {
    const persistPath = path.join(this._dataPath, `${name}.json`);
    const compressedPath = `${persistPath}.lz4`;

    try {
      // Try to read persisted data
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

      // Parse the persisted JSON to extract raw documents.
      let parsed;
      try {
        parsed = JSON.parse(data);
      } catch (parseError) {
        logger.warn(`[OramaVectorService] Failed to parse ${name} persistence`, {
          error: parseError.message
        });
        return await create({ schema });
      }

      const rawDocs = parsed?.docs?.docs;
      if (!rawDocs || typeof rawDocs !== 'object') {
        logger.debug(`[OramaVectorService] No documents in ${name} persistence, creating fresh DB`);
        return await create({ schema });
      }

      const docList = Object.values(rawDocs).filter((d) => d && d.id);

      // Detect embedding dimension from the first doc that has a vector
      let restoredDim = null;
      for (const doc of docList) {
        if (doc.embedding && doc.embedding.length > 0) {
          restoredDim = doc.embedding.length;
          break;
        }
      }

      // Check for dimension mismatch
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

      if (restoredDim) {
        this._collectionDimensions[name] = restoredDim;
      }

      // Create a fresh DB and insert all documents (bypasses broken restore())
      const db = await create({ schema });
      const embeddingStore = new Map();
      let insertedCount = 0;
      let failedCount = 0;
      let placeholderEmbeddingCount = 0;
      let restoredMissingFromSidecarCount = 0;

      let sidecarData = null;
      try {
        const sidecarPath = path.join(this._dataPath, `${name}.sidecar.json`);
        const sidecarRaw = await fs.readFile(sidecarPath, 'utf-8');
        const parsedSidecar = JSON.parse(sidecarRaw);
        if (parsedSidecar && typeof parsedSidecar === 'object') {
          const normalizedSidecar = {};
          for (const [docId, emb] of Object.entries(parsedSidecar)) {
            const normalized = this._normalizeEmbeddingVector(emb, this._dimension);
            if (normalized) {
              normalizedSidecar[docId] = normalized;
            }
          }
          sidecarData = normalizedSidecar;
        }
      } catch {
        // No sidecar file or parse error -- not critical
      }

      for (const doc of docList) {
        try {
          let hasVector = true;
          // Missing embeddings are recovered from sidecar when possible.
          // If unavailable, use a zero-vector placeholder so BM25 recall is preserved.
          if (!doc.embedding || !doc.embedding.length) {
            const sidecarEmbedding = sidecarData?.[doc.id];
            if (Array.isArray(sidecarEmbedding) && sidecarEmbedding.length === this._dimension) {
              doc.embedding = sidecarEmbedding;
              restoredMissingFromSidecarCount++;
            } else {
              doc.embedding = new Array(this._dimension).fill(0);
              hasVector = false;
              placeholderEmbeddingCount++;
              logger.warn(
                `[OramaVectorService] Using zero-vector placeholder for ${name} doc missing embedding during restore`,
                {
                  id: doc.id
                }
              );
            }
          } else if (!Array.isArray(doc.embedding)) {
            // Ensure embedding is a plain Array (not TypedArray/object shape) for Orama insert
            const normalizedEmbedding = this._normalizeEmbeddingVector(
              doc.embedding,
              this._dimension
            );
            if (normalizedEmbedding) {
              doc.embedding = normalizedEmbedding;
            } else {
              doc.embedding = new Array(this._dimension).fill(0);
              hasVector = false;
            }
          }

          const isZeroPlaceholderEmbedding =
            doc.embedding[0] === 0 && doc.embedding.every((value) => value === 0);
          if (isZeroPlaceholderEmbedding) {
            hasVector = false;
          }

          if (name === 'files') {
            doc.hasVector = hasVector;
          }

          await insert(db, doc);

          // Do not cache zero placeholders so sidecar repair can detect and replace them.
          if (!isZeroPlaceholderEmbedding) {
            embeddingStore.set(doc.id, doc.embedding);
          }
          insertedCount++;
        } catch (insertError) {
          failedCount++;
          logger.debug(`[OramaVectorService] Failed to restore doc in ${name}`, {
            id: doc.id,
            error: insertError.message
          });
        }
      }

      this._embeddingStore[name] = embeddingStore;

      // Attempt to repair zero-placeholder embeddings from persisted sidecar file.
      // The sidecar contains real embeddings saved during prior sessions.
      const lostEmbeddings = insertedCount - embeddingStore.size;
      if (lostEmbeddings > 0) {
        let repaired = 0;
        if (sidecarData && typeof sidecarData === 'object') {
          for (const [docId, emb] of Object.entries(sidecarData)) {
            if (!embeddingStore.has(docId) && Array.isArray(emb) && emb.length > 0) {
              try {
                const updateDoc =
                  name === 'files' ? { embedding: emb, hasVector: true } : { embedding: emb };
                await update(db, docId, updateDoc);
                embeddingStore.set(docId, emb);
                repaired++;
              } catch {
                // doc may not exist in this restore -- skip
              }
            }
          }
          if (repaired > 0) {
            logger.info(
              `[OramaVectorService] ${name}: repaired ${repaired} embeddings from sidecar`
            );
          }
        }

        const stillLost = lostEmbeddings - repaired;
        if (stillLost > 0) {
          logger.warn(
            `[OramaVectorService] ${name}: ${stillLost} document(s) still have zero-placeholder embeddings (Orama v3.1.x vector-loss). Re-embed to restore vector search.`
          );
        }
      }
      if (placeholderEmbeddingCount > 0) {
        logger.warn(
          `[OramaVectorService] ${name}: used placeholder embeddings for ${placeholderEmbeddingCount} document(s) during restore. Re-embed to restore vector search quality.`
        );
      }

      logger.info(`[OramaVectorService] Restored ${name} database`, {
        method: 'insert',
        total: docList.length,
        inserted: insertedCount,
        failed: failedCount,
        placeholderEmbeddings: placeholderEmbeddingCount,
        restoredMissingFromSidecar: restoredMissingFromSidecarCount,
        embeddingsCached: embeddingStore.size
      });

      // Handle compression format migration
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
      // FIX: Only start a new persist if none is running. When _isPersisting is
      // true, _doPersist() returns a resolved promise (no-op). Assigning that to
      // _currentPersistPromise would overwrite the reference to the real in-flight
      // persist, causing cleanup() to skip waiting for it and risk data loss.
      // Setting _persistPending = true (above) is sufficient: the running persist's
      // finally block will see the flag and reschedule.
      if (!this._isPersisting) {
        this._currentPersistPromise = this._doPersist();
      }
      return;
    }

    // Debounce
    if (this._persistTimer) {
      clearTimeout(this._persistTimer);
    }

    this._persistTimer = setTimeout(() => {
      // FIX: Same guard for the debounced path -- don't clobber the promise ref
      // if a persist is still running when the timer fires.
      if (!this._isPersisting) {
        this._currentPersistPromise = this._doPersist();
      }
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
      // Persist embedding sidecar maps before Orama JSON blobs so we always
      // have a recoverable vector source even if persistence is interrupted.
      for (const name of Object.keys(this._databases)) {
        try {
          const embMap = this._embeddingStore?.[name];
          const sidecarPath = path.join(this._dataPath, `${name}.sidecar.json`);
          const serializableEmbeddings = {};
          if (embMap && typeof embMap.entries === 'function') {
            for (const [docId, emb] of embMap.entries()) {
              const normalized = this._normalizeEmbeddingVector(emb, this._dimension);
              if (normalized) {
                serializableEmbeddings[docId] = normalized;
              }
            }
          }
          const sidecarData = JSON.stringify(serializableEmbeddings);
          await writeFileAtomic(sidecarPath, sidecarData);
        } catch (sidecarError) {
          logger.debug('[OramaVectorService] Failed to persist sidecar', {
            collection: name,
            error: sidecarError.message
          });
        }
      }

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
      this._persistPending = true;
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
   * Check if a hit has a zero-placeholder embedding (all zeros).
   * These are inserted during restore when Orama loses vector data.
   * Returns false (keep the hit) if the embedding field is absent from the result.
   * @private
   */
  _isZeroPlaceholderHit(hit) {
    const emb = hit.document?.embedding;
    // If embedding is not present in search result, assume it's valid
    if (!Array.isArray(emb) || emb.length === 0) return false;
    return emb[0] === 0 && emb.every((v) => v === 0);
  }

  /**
   * Request extra vector hits so placeholder filtering does not starve results.
   * Some restored indexes can contain zero-placeholder vectors that rank highly.
   * @private
   */
  _resolveVectorSearchLimit(topK) {
    const normalizedTopK = Number.isFinite(topK) && topK > 0 ? Math.max(1, Math.floor(topK)) : 10;
    return Math.min(200, Math.max(normalizedTopK, normalizedTopK * 4, normalizedTopK + 25));
  }

  _cosineSimilarity(a, b) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length === 0 || a.length !== b.length) {
      return -1;
    }
    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
      const av = a[i];
      const bv = b[i];
      if (!Number.isFinite(av) || !Number.isFinite(bv)) continue;
      dot += av * bv;
      normA += av * av;
      normB += bv * bv;
    }
    if (normA <= 0 || normB <= 0) return -1;
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  async _fallbackQuerySimilarFiles(queryEmbedding, topK) {
    const normalizedTopK = Number.isFinite(topK) && topK > 0 ? Math.max(1, Math.floor(topK)) : 10;
    const embStore = this._embeddingStore?.files;
    const scored = [];

    // Fast path: use in-memory sidecar vectors and only fetch metadata for top candidates.
    if (embStore instanceof Map && embStore.size > 0) {
      for (const [docId, rawVector] of embStore.entries()) {
        const emb = this._normalizeEmbeddingVector(rawVector, queryEmbedding.length);
        if (!Array.isArray(emb) || emb.length !== queryEmbedding.length) continue;
        if (emb[0] === 0 && emb.every((v) => v === 0)) continue;
        const score = this._cosineSimilarity(queryEmbedding, emb);
        if (!Number.isFinite(score) || score <= 0) continue;
        scored.push({ id: docId, score });
      }

      scored.sort((a, b) => b.score - a.score);
      const candidates = scored.slice(0, Math.max(normalizedTopK * 3, normalizedTopK));
      const results = [];

      for (const candidate of candidates) {
        const doc = await getByID(this._databases.files, candidate.id);
        if (!doc || doc.isOrphaned || doc.hasVector === false) continue;
        results.push({
          id: doc.id,
          score: candidate.score,
          distance: 1 - candidate.score,
          metadata: {
            path: doc.filePath,
            filePath: doc.filePath,
            fileName: doc.fileName,
            fileType: doc.fileType,
            analyzedAt: doc.analyzedAt,
            suggestedName: doc.suggestedName,
            keywords: doc.keywords,
            tags: doc.tags
          }
        });
        if (results.length >= normalizedTopK) break;
      }

      if (results.length > 0) {
        return results;
      }
    }

    // Slow path fallback for edge cases where sidecar map is unavailable.
    const docs = await this._getAllFileDocuments();
    const scoredDocs = [];
    for (const doc of docs) {
      if (doc?.isOrphaned) continue;
      const emb = this._normalizeEmbeddingVector(
        this._embeddingStore?.files?.get(doc.id) || doc.embedding,
        queryEmbedding.length
      );
      if (!Array.isArray(emb) || emb.length !== queryEmbedding.length) continue;
      if (emb[0] === 0 && emb.every((v) => v === 0)) continue;
      const score = this._cosineSimilarity(queryEmbedding, emb);
      if (!Number.isFinite(score) || score <= 0) continue;
      scoredDocs.push({ doc, score });
    }
    scoredDocs.sort((a, b) => b.score - a.score);
    return scoredDocs.slice(0, normalizedTopK).map(({ doc, score }) => ({
      id: doc.id,
      score,
      distance: 1 - score,
      metadata: {
        path: doc.filePath,
        filePath: doc.filePath,
        fileName: doc.fileName,
        fileType: doc.fileType,
        analyzedAt: doc.analyzedAt,
        suggestedName: doc.suggestedName,
        keywords: doc.keywords,
        tags: doc.tags
      }
    }));
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

  _validateEmbeddingValues(vector, _collectionType) {
    if (!Array.isArray(vector) || vector.length === 0) {
      return { valid: false, error: 'invalid_vector' };
    }
    if (vector.some((v) => !Number.isFinite(v))) {
      return { valid: false, error: 'invalid_vector_values' };
    }
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
      hasVector: !(file.vector[0] === 0 && file.vector.every((v) => v === 0)),
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

    // Update embedding sidecar store
    if (doc.embedding && doc.embedding.length > 0) {
      if (!this._embeddingStore.files) this._embeddingStore.files = new Map();
      this._embeddingStore.files.set(file.id, doc.embedding);
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
    const failed = [];
    const upsertResults = await this._runBoundedBatch(files, (file) => this.upsertFile(file));
    for (let i = 0; i < upsertResults.length; i++) {
      const settled = upsertResults[i];
      const file = files[i];
      if (settled?.status === 'fulfilled') {
        const result = settled.value;
        if (result?.success !== false) {
          successCount++;
        } else {
          failed.push({
            id: file.id,
            error: result?.error || 'upsert_failed',
            requiresRebuild: result?.requiresRebuild === true
          });
        }
      } else {
        const error = settled?.reason || new Error('upsert_failed');
        logger.warn('[OramaVectorService] Failed to upsert file in batch:', {
          fileId: file.id,
          error: error.message
        });
        failed.push({ id: file.id, error: error.message });
      }
    }

    return {
      queued: false,
      count: successCount,
      failed,
      success: failed.length === 0
    };
  }

  /**
   * Query similar files by embedding
   */
  async querySimilarFiles(queryEmbedding, topK = 10) {
    await this.initialize();

    this._validateEmbedding(queryEmbedding, 'files');

    try {
      const limit = this._resolveVectorSearchLimit(topK);
      const result = await search(this._databases.files, {
        mode: 'vector',
        vector: { value: queryEmbedding, property: 'embedding' },
        limit,
        where: { isOrphaned: false, hasVector: true }
      });

      const filtered = result.hits.filter((hit) => !this._isZeroPlaceholderHit(hit)).slice(0, topK);
      if (filtered.length > 0) {
        return filtered.map((hit) => ({
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
      }

      // On empty primary results, re-validate primary vector health and attempt
      // repair. Only use fallback scoring if primary path remains degraded.
      const health = await this._ensurePrimaryVectorHealth({
        reason: 'query-empty',
        force: true,
        autoRepair: true
      });
      if (health.primaryHealthy === false) {
        logger.warn(
          '[OramaVectorService] Primary vector query unavailable after validation/repair; using fallback scorer',
          { topK, health }
        );
        return await this._fallbackQuerySimilarFiles(queryEmbedding, topK);
      }

      // Even if the self-check passes, some Orama states can still return empty vector hits
      // for regular queries. Use a cosine fallback scorer so semantic retrieval remains useful.
      logger.debug(
        '[OramaVectorService] Primary vector query returned no hits; using fallback scorer',
        {
          topK,
          health
        }
      );
      return await this._fallbackQuerySimilarFiles(queryEmbedding, topK);
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
      this._embeddingStore?.files?.delete(fileId);
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
        this._embeddingStore?.files?.delete(id);
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
    this._embeddingStore.files = new Map();
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
          // Migrate embedding in sidecar store
          const embStore = this._embeddingStore?.files;
          if (embStore) {
            const emb = embStore.get(oldId);
            if (emb) {
              embStore.set(newId, emb);
            }
            embStore.delete(oldId);
          }
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
    // FIX: Build a Set of known file IDs first (O(n+m) instead of O(n*m) getByID calls).
    const [allChunks, allFiles] = await Promise.all([
      search(this._databases.fileChunks, { term: '', limit: 10000 }),
      search(this._databases.files, { term: '', limit: 10000 })
    ]);

    const knownFileIds = new Set((allFiles.hits || []).map((hit) => hit.document.id));

    const orphaned = [];
    for (const hit of allChunks.hits || []) {
      const fileId = hit.document.fileId;
      if (!fileId || !knownFileIds.has(fileId)) {
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

      // Prefer sidecar vectors over getByID() due Orama restore/getByID vector gaps.
      const sourceEmb = this._embeddingStore?.files?.get(sourceId);
      const embeddingToClone = this._normalizeEmbeddingVector(
        sourceEmb ?? source.embedding,
        this._dimension
      );
      if (!Array.isArray(embeddingToClone) || embeddingToClone.length !== this._dimension) {
        return {
          success: false,
          cloned: false,
          error: 'Source file has no valid embedding to clone'
        };
      }

      const hasVector = !(embeddingToClone[0] === 0 && embeddingToClone.every((v) => v === 0));

      // Only write fields that exist in the files schema (avoid clonedFrom/clonedAt
      // which are not in the Orama schema and would cause silent drops or errors)
      const { id: _id, ...sourceFields } = source;
      await insert(this._databases.files, {
        ...sourceFields,
        id: destId,
        embedding: embeddingToClone,
        hasVector,
        filePath: newMeta.path || source.filePath,
        fileName: newMeta.fileName || newMeta.name || source.fileName
      });

      // Clone embedding in sidecar store
      if (!this._embeddingStore.files) this._embeddingStore.files = new Map();
      this._embeddingStore.files.set(destId, [...embeddingToClone]);

      this._invalidateCacheForFile(destId);
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
    const valueValidation = this._validateEmbeddingValues(folder.vector, 'folders');
    if (!valueValidation.valid) {
      this.emit('embedding-blocked', {
        type: valueValidation.error,
        folderId: folder.id,
        message: 'Embedding vector contains invalid values.'
      });
      return {
        success: false,
        folderId: folder.id,
        error: valueValidation.error
      };
    }
    const dimValidation = await this.validateEmbeddingDimension(folder.vector, 'folders');
    if (!dimValidation.valid) {
      this.emit('embedding-blocked', {
        type: 'dimension_mismatch',
        folderId: folder.id,
        expectedDim: dimValidation.expectedDim,
        actualDim: dimValidation.actualDim,
        message: 'Embedding model changed. Run "Rebuild Embeddings" to fix.'
      });
      return {
        success: false,
        folderId: folder.id,
        error: 'dimension_mismatch',
        requiresRebuild: true
      };
    }

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

    // Update sidecar embedding store for folders
    if (doc.embedding && doc.embedding.length > 0) {
      if (!this._embeddingStore.folders) this._embeddingStore.folders = new Map();
      this._embeddingStore.folders.set(folder.id, doc.embedding);
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
    const failed = [];

    const upsertResults = await this._runBoundedBatch(folders, (folder) =>
      this.upsertFolder(folder)
    );
    for (let i = 0; i < upsertResults.length; i++) {
      const settled = upsertResults[i];
      const folder = folders[i];
      if (settled?.status === 'fulfilled') {
        const result = settled.value;
        if (result?.success !== false) {
          successCount++;
        } else {
          failed.push({
            id: folder.id,
            error: result?.error || 'upsert_failed',
            requiresRebuild: result?.requiresRebuild === true
          });
        }
      } else {
        const error = settled?.reason || new Error('upsert_failed');
        skipped.push({ id: folder.id, error: error.message });
        failed.push({ id: folder.id, error: error.message });
      }
    }

    return {
      queued: false,
      count: successCount,
      skipped,
      failed,
      success: failed.length === 0
    };
  }

  /**
   * Query folders by embedding
   */
  async queryFoldersByEmbedding(embedding, topK = 5) {
    await this.initialize();

    this._validateEmbedding(embedding, 'folders');

    try {
      const limit = this._resolveVectorSearchLimit(topK);
      const result = await search(this._databases.folders, {
        mode: 'vector',
        vector: { value: embedding, property: 'embedding' },
        limit
      });

      return result.hits
        .filter((hit) => !this._isZeroPlaceholderHit(hit))
        .slice(0, topK)
        .map((hit) => ({
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

    // Get file embedding — prefer sidecar (reliable) over getByID (may be zero-placeholder)
    const sidecarEmb = this._embeddingStore?.files?.get(fileId);
    const file = await getByID(this._databases.files, fileId);
    const embedding = sidecarEmb || file?.embedding;
    if (
      !embedding ||
      embedding.length === 0 ||
      (embedding[0] === 0 && embedding.every((v) => v === 0))
    ) {
      return [];
    }

    const results = await this.queryFoldersByEmbedding(embedding, topK);
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
      this._embeddingStore?.folders?.delete(folderId);
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
        this._embeddingStore?.folders?.delete(id);
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
    this._embeddingStore.folders = new Map();
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
        const content =
          chunk.meta?.content || chunk.meta?.text || chunk.meta?.snippet || chunk.document || '';
        const startOffset =
          typeof chunk.meta?.startOffset === 'number'
            ? chunk.meta.startOffset
            : typeof chunk.meta?.charStart === 'number'
              ? chunk.meta.charStart
              : 0;
        const endOffset =
          typeof chunk.meta?.endOffset === 'number'
            ? chunk.meta.endOffset
            : typeof chunk.meta?.charEnd === 'number'
              ? chunk.meta.charEnd
              : 0;
        const doc = {
          id: chunk.id,
          embedding: chunk.vector,
          fileId: chunk.meta?.fileId || chunk.meta?.parentFileId || '',
          chunkIndex: chunk.meta?.chunkIndex || 0,
          content,
          startOffset,
          endOffset
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
      const limit = this._resolveVectorSearchLimit(topK);
      const result = await search(this._databases.fileChunks, {
        mode: 'vector',
        vector: { value: queryEmbedding, property: 'embedding' },
        limit
      });

      const hits = result.hits.filter((hit) => !this._isZeroPlaceholderHit(hit)).slice(0, topK);
      return Promise.all(
        hits.map(async (hit) => {
          const chunkDoc = hit.document || {};
          let parentFile = null;
          if (chunkDoc.fileId) {
            try {
              parentFile = await getByID(this._databases.files, chunkDoc.fileId);
            } catch {
              parentFile = null;
            }
          }
          const content = chunkDoc.content || '';
          const startOffset =
            typeof chunkDoc.startOffset === 'number' ? chunkDoc.startOffset : undefined;
          const endOffset = typeof chunkDoc.endOffset === 'number' ? chunkDoc.endOffset : undefined;
          return {
            id: chunkDoc.id,
            score: hit.score,
            distance: 1 - hit.score,
            metadata: {
              fileId: chunkDoc.fileId,
              path: parentFile?.filePath || '',
              name: parentFile?.fileName || '',
              type: parentFile?.fileType || 'document',
              chunkIndex: chunkDoc.chunkIndex,
              content,
              snippet: content.slice(0, 240),
              startOffset: startOffset ?? 0,
              endOffset: endOffset ?? 0,
              charStart: startOffset ?? 0,
              charEnd: endOffset ?? 0
            }
          };
        })
      );
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
    const valueValidation = this._validateEmbeddingValues(vector, 'feedback');
    if (!valueValidation.valid) {
      this.emit('embedding-blocked', {
        type: valueValidation.error,
        feedbackId: id,
        message: 'Embedding vector contains invalid values.'
      });
      return {
        success: false,
        feedbackId: id,
        error: valueValidation.error
      };
    }
    const dimValidation = await this.validateEmbeddingDimension(vector, 'feedback');
    if (!dimValidation.valid) {
      this.emit('embedding-blocked', {
        type: 'dimension_mismatch',
        feedbackId: id,
        expectedDim: dimValidation.expectedDim,
        actualDim: dimValidation.actualDim,
        message: 'Embedding model changed. Run "Rebuild Embeddings" to fix.'
      });
      return {
        success: false,
        feedbackId: id,
        error: 'dimension_mismatch',
        requiresRebuild: true
      };
    }

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
      const limit = this._resolveVectorSearchLimit(topK);
      const result = await search(this._databases.feedback, {
        mode: 'vector',
        vector: { value: queryEmbedding, property: 'embedding' },
        limit
      });

      return result.hits
        .filter((hit) => !this._isZeroPlaceholderHit(hit))
        .slice(0, topK)
        .map((hit) => {
          let metadata = {};
          try {
            metadata = JSON.parse(hit.document.metadata || '{}');
          } catch (parseError) {
            logger.debug('[OramaVectorService] Malformed feedback metadata', {
              id: hit.document.id,
              error: parseError.message
            });
          }
          return {
            id: hit.document.id,
            score: hit.score,
            metadata,
            document: hit.document.text
          };
        });
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
      const vectorLimit = this._resolveVectorSearchLimit(topK * 2);
      vectorResults = await search(this._databases.files, {
        mode: 'vector',
        vector: { value: queryEmbedding, property: 'embedding' },
        limit: vectorLimit,
        where: { isOrphaned: false, hasVector: true }
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

    // Reciprocal Rank Fusion (use centralized constant to stay in sync with SearchService)
    const scores = new Map();
    const k = SEARCH.RRF_K;

    vectorResults.hits
      .filter((hit) => !this._isZeroPlaceholderHit(hit))
      .forEach((hit, rank) => {
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
    await this._refreshEmbeddingDimension({ reason: 'reset-all' });
    await this.resetFiles();
    await this.resetFileChunks();
    await this.resetFolders();
    await this.resetFeedbackMemory();
    await this.resetLearningPatterns();
    // Clear all sidecar embedding stores
    this._embeddingStore = {};
    this._setVectorHealth({
      primaryHealthy: true,
      lastValidatedAt: Date.now(),
      lastValidationReason: 'reset-all',
      lastValidationError: null
    });
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
      vectorHealth: this._getVectorHealthSnapshot(),
      queryCache: {
        size: this._queryCache.size,
        maxSize: this._queryCacheMaxSize
      }
    };
  }

  /**
   * Diagnose eligibility for primary file-level vector search.
   * Helps explain cases where file embeddings exist but vector retrieval returns no hits.
   *
   * @param {{ sampleSize?: number }} [options]
   * @returns {Promise<Object>}
   */
  async getFileVectorDiagnostics(options = {}) {
    await this.initialize();

    const sampleSize = Math.max(1, Math.min(Number(options?.sampleSize) || 5, 20));
    const docs = await this._getAllFileDocuments();
    const embStore = this._embeddingStore?.files;
    const sidecarSize = embStore instanceof Map ? embStore.size : 0;

    let hasVectorTrue = 0;
    let hasVectorFalse = 0;
    let orphaned = 0;
    let missingEmbedding = 0;
    let placeholderVectors = 0;
    let eligibleForPrimaryVector = 0;
    const ineligibleSample = [];

    for (const doc of docs) {
      const hasVector = doc?.hasVector === true;
      const isOrphaned = doc?.isOrphaned === true;

      if (hasVector) hasVectorTrue++;
      else hasVectorFalse++;
      if (isOrphaned) orphaned++;

      const normalizedEmbedding = this._normalizeEmbeddingVector(
        (embStore instanceof Map ? embStore.get(doc?.id) : null) || doc?.embedding,
        this._dimension
      );
      const hasEmbedding =
        Array.isArray(normalizedEmbedding) && normalizedEmbedding.length === this._dimension;
      const isPlaceholder =
        hasEmbedding &&
        normalizedEmbedding[0] === 0 &&
        normalizedEmbedding.every((value) => value === 0);

      if (!hasEmbedding) missingEmbedding++;
      if (isPlaceholder) placeholderVectors++;

      const eligible = hasVector && !isOrphaned && hasEmbedding && !isPlaceholder;
      if (eligible) {
        eligibleForPrimaryVector++;
      } else if (ineligibleSample.length < sampleSize) {
        ineligibleSample.push({
          id: doc?.id,
          hasVector,
          isOrphaned,
          hasEmbedding,
          isPlaceholder
        });
      }
    }

    return {
      totalFiles: docs.length,
      eligibleForPrimaryVector,
      hasVectorTrue,
      hasVectorFalse,
      orphaned,
      missingEmbedding,
      placeholderVectors,
      sidecarEmbeddings: sidecarSize,
      ineligibleSample
    };
  }

  getVectorHealth() {
    return this._getVectorHealthSnapshot();
  }

  /**
   * Peek a sample of file embeddings for diagnostics and clustering.
   *
   * Uses the in-memory embedding sidecar store for vectors because Orama's
   * getByID() does not reliably return vector fields after a persist/restore
   * cycle. Text search with term='' enumerates documents.
   *
   * @param {number} [limit=50] - Max number of documents to return
   * @returns {Promise<{ids: string[], embeddings: number[][], metadatas: Object[]}>}
   */
  async peekFiles(limit = 50) {
    await this.initialize();

    try {
      const effectiveLimit = Math.max(1, Math.min(Number(limit) || 50, 10000));
      const result = await search(this._databases.files, {
        term: '',
        limit: effectiveLimit
      });

      const ids = [];
      const embeddings = [];
      const metadatas = [];
      const embStore = this._embeddingStore?.files;

      for (const hit of result.hits || []) {
        const doc = hit.document || {};
        ids.push(doc.id);

        // Use sidecar embedding store (reliable) instead of getByID (broken for vectors)
        const cachedEmb = embStore?.get(doc.id);
        embeddings.push(cachedEmb && cachedEmb.length > 0 ? cachedEmb : []);

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
    return this._vectorHealth.primaryHealthy !== false;
  }

  // Circuit breaker compatibility stub — required by SearchService diagnostics
  getCircuitStats() {
    return { state: 'CLOSED', failures: 0, successes: 0 };
  }

  // ==================== QUERY CACHE ====================

  _getCachedQuery(key) {
    const entry = this._queryCache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.timestamp > this._queryCacheTtlMs) {
      this._queryCache.delete(key);
      return null;
    }
    // True LRU: re-insert to move to end of Map iteration order
    this._queryCache.delete(key);
    this._queryCache.set(key, entry);
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
    // FIX: Use delimiter-aware matching to avoid substring collisions.
    // Cache keys use the format "folders:{fileId}:{topK}" so checking for
    // the fileId bounded by delimiters or at key boundaries prevents
    // "abc" from matching "abc123".
    const delimited = `:${fileId}:`;
    const suffix = `:${fileId}`;
    for (const key of this._queryCache.keys()) {
      if (key.includes(delimited) || key.endsWith(suffix) || key === fileId) {
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
    // Re-entrance guard: prevent double cleanup from StartupManager + ServiceContainer
    if (this._cleanupInProgress) {
      logger.debug('[OramaVectorService] Cleanup already in progress, skipping');
      return;
    }
    this._cleanupInProgress = true;

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
    this._vectorHealth = {
      primaryHealthy: null,
      lastValidatedAt: 0,
      lastValidationReason: null,
      lastValidationError: null,
      lastRepairAt: 0,
      repairAttempts: 0
    };
    this._vectorHealthPromise = null;

    this.removeAllListeners();
    this._cleanupInProgress = false; // Reset so re-initialization can call cleanup again
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
