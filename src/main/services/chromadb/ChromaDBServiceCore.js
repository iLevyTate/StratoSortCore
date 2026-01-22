/**
 * ChromaDB Service Core
 *
 * Slim coordinator class that composes the extracted modules.
 * Maintains full backward compatibility with the original ChromaDBService API.
 *
 * @module services/chromadb/ChromaDBServiceCore
 */

const { app } = require('electron');
const { ChromaClient } = require('chromadb');
const path = require('path');
const fs = require('fs').promises;
const { EventEmitter } = require('events');
const { logger } = require('../../../shared/logger');
const { get: getConfig } = require('../../../shared/config/index');
const { parseChromaConfig } = require('../../../shared/config/chromaDefaults');
const { CircuitBreaker, CircuitState } = require('../../utils/CircuitBreaker');
const { OfflineQueue, OperationType } = require('../../utils/OfflineQueue');
const { NETWORK, TIMEOUTS } = require('../../../shared/performanceConstants');
const { withTimeout } = require('../../../shared/promiseUtils');

// Timeout configuration for ChromaDB operations (prevents UI freeze on slow/unresponsive server)
const CHROMADB_OPERATION_TIMEOUT_MS = getConfig('CHROMADB.operationTimeout', 30000);
const CHROMADB_INIT_TIMEOUT_MS = getConfig('CHROMADB.initTimeout', 60000);

// Extracted modules
const { ChromaQueryCache } = require('./ChromaQueryCache');
const {
  checkHealthViaHttp,
  checkHealthViaClient,
  isServerAvailable
} = require('./ChromaHealthChecker');
const {
  directUpsertFile,
  directBatchUpsertFiles,
  deleteFileEmbedding: deleteFileEmbeddingOp,
  batchDeleteFileEmbeddings: batchDeleteFileEmbeddingsOp,
  updateFilePaths: updateFilePathsOp,
  querySimilarFiles: querySimilarFilesOp,
  resetFiles: resetFilesOp,
  markEmbeddingsOrphaned: markEmbeddingsOrphanedOp,
  getOrphanedEmbeddings: getOrphanedEmbeddingsOp
} = require('./fileOperations');
const chunkOps = require('./chunkOperations');

const {
  batchUpsertFileChunks: batchUpsertFileChunksOp,
  querySimilarFileChunks: querySimilarFileChunksOp,
  resetFileChunks: resetFileChunksOp,
  markChunksOrphaned: markChunksOrphanedOp,
  getOrphanedChunks: getOrphanedChunksOp,
  updateFileChunkPaths: updateFileChunkPathsOp,
  cloneFileChunks: cloneFileChunksOp
} = chunkOps;
// Provide safe fallbacks to avoid undefined functions in tests/mocks
const deleteFileChunks = chunkOps.deleteFileChunks || (async () => 0);
const batchDeleteFileChunks = chunkOps.batchDeleteFileChunks || (async () => 0);
const {
  directUpsertFolder,
  directBatchUpsertFolders,
  queryFoldersByEmbedding: queryFoldersByEmbeddingOp,
  executeQueryFolders,
  batchQueryFolders: batchQueryFoldersOp,
  getAllFolders: getAllFoldersOp,
  resetFolders: resetFoldersOp
} = require('./folderEmbeddings');

logger.setContext('ChromaDBService');

/**
 * Embedding function placeholder.
 *
 * We always provide embeddings explicitly (Ollama + our own embedding pipeline),
 * so we must NOT rely on the Chroma JS SDK auto-embedding behavior.
 *
 * Passing a non-null embeddingFunction prevents the SDK from trying to instantiate
 * DefaultEmbeddingFunction (which requires the optional @chroma-core/default-embed package).
 */
const explicitEmbeddingsOnlyEmbeddingFunction = {
  generate: async () => {
    throw new Error(
      'ChromaDB embeddingFunction was invoked unexpectedly. StratoSort should always pass embeddings/queryEmbeddings explicitly.'
    );
  },
  // Some SDK paths prefer generateForQueries; keep the message identical.
  generateForQueries: async () => {
    throw new Error(
      'ChromaDB embeddingFunction was invoked unexpectedly. StratoSort should always pass embeddings/queryEmbeddings explicitly.'
    );
  }
};

// Configuration constants
const QUERY_CACHE_TTL_MS = getConfig('PERFORMANCE.cacheTtlShort', 120000);
const MAX_CACHE_SIZE = getConfig('PERFORMANCE.queryCacheSize', 200);
const BATCH_INSERT_DELAY_MS = getConfig('PERFORMANCE.batchInsertDelay', 100);
const DEFAULT_SERVER_PROTOCOL = getConfig('SERVER.chromaProtocol', 'http');
const DEFAULT_SERVER_HOST = getConfig('SERVER.chromaHost', '127.0.0.1');
const DEFAULT_SERVER_PORT = getConfig('SERVER.chromaPort', 8000);

// Validation constants
const MAX_PORT_NUMBER = NETWORK.MAX_PORT;
const MIN_PORT_NUMBER = NETWORK.MIN_PORT;
const VALID_PROTOCOLS = ['http', 'https'];

/**
 * ChromaDB-based Vector Database Service
 *
 * Features:
 * - Circuit breaker pattern for fault tolerance
 * - Offline queue with disk persistence for crash recovery
 * - Automatic health checks and recovery
 * - Event emission for UI status updates
 */
class ChromaDBServiceCore extends EventEmitter {
  constructor() {
    super();
    this.dbPath = path.join(app.getPath('userData'), 'chromadb');
    this.client = null;
    this.fileCollection = null;
    this.fileChunkCollection = null;
    this.folderCollection = null;
    this.feedbackCollection = null;
    this.initialized = false;

    // Initialization mutex to prevent race conditions
    this._initPromise = null;
    this._isInitializing = false;
    this._recoveryAttempted = false;

    // FIX: Track initialization completion for event handler guards
    // Event handlers registered in constructor can fire before initialize() completes,
    // causing UI events to be emitted when the service state is undefined
    this._initializationComplete = false;

    // FIX: Track collection dimensions to detect embedding model changes
    this._collectionDimensions = {
      files: null,
      folders: null,
      fileChunks: null,
      feedback: null
    };

    // Query cache
    this.queryCache = new ChromaQueryCache({
      maxSize: MAX_CACHE_SIZE,
      ttlMs: QUERY_CACHE_TTL_MS
    });

    // Batch operation queues
    this.batchInsertQueue = [];
    this.batchInsertTimer = null;
    this.batchInsertDelay = BATCH_INSERT_DELAY_MS;

    // In-flight query deduplication with bounds to prevent memory exhaustion
    // FIX: Store timestamps with promises to enable stale cleanup
    this.inflightQueries = new Map(); // Map<key, { promise, addedAt }>
    this.MAX_INFLIGHT_QUERIES = getConfig('CHROMADB.maxInflightQueries', 100);
    this._stalePromiseCleanupInterval = null;
    this.STALE_PROMISE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

    // Connection health monitoring
    this.isOnline = false;
    this.healthCheckInterval = null;
    this.HEALTH_CHECK_INTERVAL_MS = getConfig('PERFORMANCE.healthCheckInterval', 30000);

    // Circuit breaker configuration
    const circuitBreakerConfig = {
      failureThreshold: getConfig('CIRCUIT_BREAKER.failureThreshold', 5),
      successThreshold: getConfig('CIRCUIT_BREAKER.successThreshold', 2),
      timeout: getConfig('CIRCUIT_BREAKER.timeout', 30000),
      resetTimeout: getConfig('CIRCUIT_BREAKER.resetTimeout', 60000)
    };

    // Initialize circuit breaker
    this.circuitBreaker = new CircuitBreaker('ChromaDB', circuitBreakerConfig);

    // Forward circuit breaker events
    // FIX: Guard UI-facing events to only emit after initialization completes
    // This prevents confusing UI state during startup when service state is undefined
    this.circuitBreaker.on('stateChange', (data) => {
      this._onCircuitStateChange(data);
    });
    this.circuitBreaker.on('open', (data) => {
      logger.warn('[ChromaDB] Circuit breaker opened due to failures', data);
      // FIX: Only emit UI events after initialization to prevent confusing state
      if (this._initializationComplete) {
        this.emit('offline', {
          reason: 'circuit_open',
          failureCount: data.failureCount
        });
      }
    });
    this.circuitBreaker.on('close', () => {
      logger.info('[ChromaDB] Circuit breaker closed, service recovered');
      if (this._initializationComplete) {
        this.emit('online', { reason: 'circuit_closed' });
      }
    });
    this.circuitBreaker.on('halfOpen', () => {
      logger.info('[ChromaDB] Circuit breaker half-open, testing recovery');
      if (this._initializationComplete) {
        this.emit('recovering', { reason: 'circuit_half_open' });
      }
    });

    // Initialize offline queue
    this.offlineQueue = new OfflineQueue({
      maxQueueSize: getConfig('CIRCUIT_BREAKER.maxQueueSize', 1000),
      flushBatchSize: 50,
      flushDelayMs: 1000
    });

    // Forward queue events
    // FIX: Guard UI-facing events to only emit after initialization completes
    this.offlineQueue.on('enqueued', (op) => {
      if (this._initializationComplete) {
        this.emit('operationQueued', {
          type: op.type,
          queueSize: this.offlineQueue.size()
        });
      }
    });
    this.offlineQueue.on('flushComplete', (result) => {
      if (this._initializationComplete) {
        this.emit('queueFlushed', result);
      }
    });

    // Server configuration
    this._initializeServerConfig();
  }

  /**
   * Detect Chroma "not found" style failures (commonly caused by stale collection handles
   * after server restarts, wrong server on the configured port, or missing tenant/db).
   * @private
   */
  _isChromaNotFoundError(error) {
    const msg = error?.message || '';
    return (
      error?.name === 'ChromaNotFoundError' ||
      /requested resource could not be found/i.test(msg) ||
      /not found/i.test(msg)
    );
  }

  /**
   * Get the embedding dimension of an existing collection by peeking at stored embeddings.
   * FIX: Helps detect dimension mismatches when embedding models change.
   *
   * @param {'files' | 'folders' | 'fileChunks' | 'feedback'} collectionType - Which collection to check
   * @returns {Promise<number | null>} Dimension of stored embeddings, or null if collection is empty
   */
  async getCollectionDimension(collectionType, { skipCache = false } = {}) {
    try {
      const collection =
        collectionType === 'files'
          ? this.fileCollection
          : collectionType === 'folders'
            ? this.folderCollection
            : collectionType === 'fileChunks'
              ? this.fileChunkCollection
              : this.feedbackCollection;
      if (!collection) {
        // FIX P1-5: Invalidate cache if collection doesn't exist
        this._collectionDimensions[collectionType] = null;
        return null;
      }

      // Return cached dimension if available (unless skipCache requested)
      if (!skipCache && this._collectionDimensions[collectionType] !== null) {
        return this._collectionDimensions[collectionType];
      }

      // Peek at first embedding to get dimension
      const peek = await collection.peek({ limit: 1 });
      if (peek.embeddings && peek.embeddings.length > 0 && peek.embeddings[0]) {
        const dimension = peek.embeddings[0].length;
        this._collectionDimensions[collectionType] = dimension;
        return dimension;
      }

      return null; // Collection is empty
    } catch (error) {
      // FIX MED-03: Distinguish connection errors from empty/missing collection
      // Only return null if the error indicates "not found" or empty state
      // For network/connection errors, we should propogate them so the caller knows the check failed
      if (this._isChromaNotFoundError(error)) {
        return null;
      }

      logger.warn('[ChromaDB] Error getting collection dimension:', {
        collectionType,
        error: error.message
      });
      // Return null to allow operation to proceed (and likely fail with better error),
      // or throw if strict validation is required. For now, returning null disables validation
      // which is safer than blocking valid operations on network hiccups.
      return null;
    }
  }

  /**
   * Validate that an embedding vector matches the expected collection dimension.
   * FIX: Provides clear error when embedding model changed and dimensions mismatch.
   *
   * @param {Array<number>} vector - Embedding vector to validate
   * @param {'files' | 'folders' | 'fileChunks' | 'feedback'} collectionType - Which collection this is for
   * @returns {Promise<{ valid: boolean, error?: string, expectedDim?: number, actualDim?: number }>}
   */
  async validateEmbeddingDimension(vector, collectionType) {
    if (!Array.isArray(vector) || vector.length === 0) {
      return { valid: false, error: 'invalid_vector' };
    }

    const expectedDim = await this.getCollectionDimension(collectionType);

    // If collection is empty, any dimension is valid (first insert sets the dimension)
    if (expectedDim === null) {
      // Cache the first observed dimension to keep validation consistent on first insert.
      // This matches existing expectations and avoids a null cache when collection is empty.
      this._collectionDimensions[collectionType] = vector.length;
      return { valid: true };
    }

    if (vector.length !== expectedDim) {
      const error =
        `Embedding dimension mismatch: collection "${collectionType}" expects ${expectedDim} dimensions but received ${vector.length}. ` +
        `This typically occurs when changing embedding models. Use "Rebuild Embeddings" to migrate to the new model.`;

      logger.error(`[ChromaDB] ${error}`);

      // Emit event so UI can display warning
      this.emit('dimension-mismatch', {
        collectionType,
        expectedDim,
        actualDim: vector.length,
        message: error
      });

      return {
        valid: false,
        error: 'dimension_mismatch',
        expectedDim,
        actualDim: vector.length
      };
    }

    return { valid: true };
  }

  /**
   * Clear cached collection dimensions (call after reset operations)
   * @private
   */
  _clearDimensionCache() {
    this._collectionDimensions = {
      files: null,
      folders: null,
      fileChunks: null,
      feedback: null
    };
  }

  /**
   * Force a clean re-initialization of client/collections.
   * @private
   */
  async _forceReinitialize(reason, context = {}) {
    logger.warn('[ChromaDB] Forcing re-initialization', { reason, ...context });
    this.initialized = false;
    this.isOnline = false;
    this.client = null;
    this.fileCollection = null;
    this.fileChunkCollection = null;
    this.folderCollection = null;
    this.feedbackCollection = null;
    // Clear cached dimensions since collections/embedding state may change after re-init.
    this._clearDimensionCache();
    this._initPromise = null;
    this._isInitializing = false;
    return this.initialize();
  }

  /**
   * Execute an operation once; if it fails with a not-found error, attempt a single
   * re-initialize + retry to recover from stale collection IDs.
   * FIX: Added explicit retry limit to prevent infinite loops in pathological cases
   * @private
   * @param {string} operation - Operation name for logging
   * @param {Function} fn - Async function to execute
   * @param {number} [retryCount=0] - Current retry count (internal use)
   */
  async _executeWithNotFoundRecovery(operation, fn, retryCount = 0) {
    const MAX_NOT_FOUND_RETRIES = 2; // Maximum reinit attempts for not-found errors

    try {
      return await fn();
    } catch (error) {
      if (!this._isChromaNotFoundError(error)) {
        throw error;
      }

      // FIX: Prevent infinite reinit loops
      if (retryCount >= MAX_NOT_FOUND_RETRIES) {
        logger.error('[ChromaDB] Max not-found recovery retries exceeded', {
          operation,
          retryCount,
          error: error?.message
        });
        throw new Error(
          `ChromaDB operation "${operation}" failed after ${MAX_NOT_FOUND_RETRIES} recovery attempts: ${error?.message}`
        );
      }

      logger.warn('[ChromaDB] Not-found error, attempting recovery', {
        operation,
        retryCount: retryCount + 1,
        maxRetries: MAX_NOT_FOUND_RETRIES
      });

      await this._forceReinitialize('not_found_recovery', { operation, error: error?.message });
      // Retry with incremented count
      return await this._executeWithNotFoundRecovery(operation, fn, retryCount + 1);
    }
  }

  /**
   * Initialize server configuration from environment
   * @private
   */
  _initializeServerConfig() {
    this.serverProtocol = DEFAULT_SERVER_PROTOCOL;
    this.serverHost = DEFAULT_SERVER_HOST;
    this.serverPort = DEFAULT_SERVER_PORT;
    this.serverUrl = `${DEFAULT_SERVER_PROTOCOL}://${DEFAULT_SERVER_HOST}:${DEFAULT_SERVER_PORT}`;

    const envUrl = process.env.CHROMA_SERVER_URL;
    if (envUrl) {
      try {
        let parsedUrl;
        try {
          parsedUrl = new URL(envUrl);
        } catch {
          parsedUrl = null;
        }

        if (!parsedUrl) {
          throw new Error('Invalid CHROMA_SERVER_URL');
        }

        const { protocol, host, port } = parseChromaConfig(envUrl);

        if (!VALID_PROTOCOLS.includes(protocol)) {
          throw new Error(`Invalid protocol "${protocol}". Must be http or https.`);
        }

        if (!host || typeof host !== 'string' || host.length > 253) {
          throw new Error('Invalid hostname in CHROMA_SERVER_URL');
        }

        if (isNaN(port) || port < MIN_PORT_NUMBER || port > MAX_PORT_NUMBER) {
          throw new Error(
            `Invalid port number ${port}. Must be between ${MIN_PORT_NUMBER} and ${MAX_PORT_NUMBER}.`
          );
        }

        this.serverProtocol = protocol;
        this.serverHost = host;
        this.serverPort = port;
        this.serverUrl = `${protocol}://${host}:${port}`;
      } catch (error) {
        logger.warn('[ChromaDB] Invalid CHROMA_SERVER_URL, using defaults', {
          url: envUrl,
          message: error?.message
        });
      }
    } else {
      // Validate individual env vars
      const envProtocol = process.env.CHROMA_SERVER_PROTOCOL;
      if (envProtocol && VALID_PROTOCOLS.includes(envProtocol)) {
        this.serverProtocol = envProtocol;
      }

      const envHost = process.env.CHROMA_SERVER_HOST;
      const hostnameRegex =
        /^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)*[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$|^localhost$|^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/;
      if (
        envHost &&
        typeof envHost === 'string' &&
        envHost.length > 0 &&
        envHost.length <= 253 &&
        hostnameRegex.test(envHost)
      ) {
        this.serverHost = envHost;
      } else if (envHost) {
        logger.warn('[ChromaDB] Invalid hostname format:', envHost);
      }

      const envPort = Number(process.env.CHROMA_SERVER_PORT);
      if (!isNaN(envPort) && envPort >= MIN_PORT_NUMBER && envPort <= MAX_PORT_NUMBER) {
        this.serverPort = envPort;
      }

      this.serverUrl = `${this.serverProtocol}://${this.serverHost}:${this.serverPort}`;
    }

    // SECURITY: Warn about non-HTTPS connections for non-localhost servers
    this._warnIfInsecureRemoteConnection();
  }

  /**
   * Warn if using HTTP (non-HTTPS) for remote server connections
   * @private
   */
  _warnIfInsecureRemoteConnection() {
    const isLocalhost =
      this.serverHost === 'localhost' ||
      this.serverHost === '127.0.0.1' ||
      this.serverHost === '::1' ||
      this.serverHost.startsWith('192.168.') ||
      this.serverHost.startsWith('10.') ||
      this.serverHost.startsWith('172.16.') ||
      this.serverHost.startsWith('172.17.') ||
      this.serverHost.startsWith('172.18.') ||
      this.serverHost.startsWith('172.19.') ||
      this.serverHost.startsWith('172.2') || // 172.20-172.29
      this.serverHost.startsWith('172.30.') ||
      this.serverHost.startsWith('172.31.');

    if (this.serverProtocol === 'http' && !isLocalhost) {
      logger.warn(
        '[ChromaDB] SECURITY WARNING: Using unencrypted HTTP connection to remote server',
        {
          host: this.serverHost,
          port: this.serverPort,
          recommendation:
            'Consider using HTTPS for remote ChromaDB connections to protect data in transit'
        }
      );
      // Emit event so UI can display warning if needed
      this.emit('security-warning', {
        type: 'insecure_connection',
        message:
          'ChromaDB is configured to use HTTP for a remote server. Data may be transmitted unencrypted.',
        host: this.serverHost
      });
    }
  }

  async ensureDbDirectory() {
    try {
      await fs.mkdir(this.dbPath, { recursive: true });
    } catch (error) {
      logger.error('[ChromaDB] Failed to create database directory:', error);
      throw error;
    }
  }

  /**
   * Start periodic health check
   */
  startHealthCheck() {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }

    this.checkHealth().catch((err) => {
      logger.debug('[ChromaDB] Initial health check failed', {
        error: err.message
      });
    });

    this.healthCheckInterval = setInterval(() => {
      this.checkHealth().catch((err) => {
        logger.debug('[ChromaDB] Periodic health check failed', {
          error: err.message
        });
      });
    }, this.HEALTH_CHECK_INTERVAL_MS);

    if (this.healthCheckInterval.unref) {
      this.healthCheckInterval.unref();
    }

    // Start stale promise cleanup (extracted to separate method)
    this._startStalePromiseCleanup();
  }

  /**
   * Start stale promise cleanup interval
   * FIX: Extracted to separate method so it can be started early in initialize()
   * This prevents memory leaks from promises that never settle (e.g., due to network issues)
   * even if later initialization steps fail
   * @private
   */
  _startStalePromiseCleanup() {
    // Clear any existing interval first (idempotent)
    if (this._stalePromiseCleanupInterval) {
      clearInterval(this._stalePromiseCleanupInterval);
    }

    this._stalePromiseCleanupInterval = setInterval(() => {
      this._cleanupStaleInflightQueries();
    }, this.STALE_PROMISE_TIMEOUT_MS);

    if (this._stalePromiseCleanupInterval.unref) {
      this._stalePromiseCleanupInterval.unref();
    }
  }

  /**
   * Clean up stale in-flight queries that have been pending too long
   * FIX: Prevents memory exhaustion from promises that never settle
   * @private
   */
  _cleanupStaleInflightQueries() {
    const now = Date.now();
    let cleanedCount = 0;

    // First pass: Remove stale entries based on timeout
    for (const [key, entry] of this.inflightQueries.entries()) {
      // FIX MED-06: Upgrade legacy Promise entries to the new object format
      const isLegacyPromise = entry && typeof entry.then === 'function';
      if (isLegacyPromise) {
        this.inflightQueries.set(key, { promise: entry, addedAt: now });
        continue;
      }

      const addedAt = entry && typeof entry === 'object' && 'addedAt' in entry ? entry.addedAt : 0;

      if (now - addedAt > this.STALE_PROMISE_TIMEOUT_MS) {
        this.inflightQueries.delete(key);
        cleanedCount++;
      }
    }

    // FIX: Second pass - If still over limit after stale cleanup, remove oldest entries
    if (this.inflightQueries.size > this.MAX_INFLIGHT_QUERIES) {
      const entries = Array.from(this.inflightQueries.entries()).sort((a, b) => {
        const aTime = a[1]?.addedAt || 0;
        const bTime = b[1]?.addedAt || 0;
        return aTime - bTime; // Oldest first
      });

      const toRemove = this.inflightQueries.size - this.MAX_INFLIGHT_QUERIES;
      for (let i = 0; i < toRemove; i++) {
        this.inflightQueries.delete(entries[i][0]);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      logger.debug('[ChromaDB] Cleaned up in-flight queries', {
        cleanedCount,
        remaining: this.inflightQueries.size
      });
    }
  }

  /**
   * Stop periodic health check and stale promise cleanup
   */
  stopHealthCheck() {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
    // FIX: Also clean up the stale promise cleanup interval
    if (this._stalePromiseCleanupInterval) {
      clearInterval(this._stalePromiseCleanupInterval);
      this._stalePromiseCleanupInterval = null;
    }
  }

  /**
   * Add to in-flight queries with LRU eviction to prevent memory exhaustion
   * @private
   * @param {string} key - Cache key for the query
   * @param {Promise} promise - The query promise
   */
  _addInflightQuery(key, promise) {
    // FIX P0-1: Check if key already exists - return existing promise to prevent memory leak
    // This handles the case where duplicate queries arrive before the first one settles
    const existing = this.inflightQueries.get(key);
    if (existing) {
      logger.debug('[ChromaDB] Returning existing in-flight query', { key });
      // FIX: Refresh timestamp to prevent premature staleness cleanup
      existing.addedAt = Date.now();
      return existing.promise;
    }

    // Evict oldest entries if at capacity (LRU-style eviction)
    if (this.inflightQueries.size >= this.MAX_INFLIGHT_QUERIES) {
      const oldestKey = this.inflightQueries.keys().next().value;
      if (oldestKey) {
        logger.debug('[ChromaDB] Evicting oldest in-flight query due to capacity', {
          evictedKey: oldestKey,
          currentSize: this.inflightQueries.size
        });
        this.inflightQueries.delete(oldestKey);
      }
    }
    // Always store a real Promise so we can reliably attach finally() cleanup.
    const wrappedPromise = Promise.resolve(promise);
    // FIX: Store timestamp with promise for stale cleanup
    this.inflightQueries.set(key, { promise: wrappedPromise, addedAt: Date.now() });

    // FIX: CRITICAL - Remove entry when promise settles to prevent memory leak.
    // Also protect against unexpected errors in cleanup itself.
    wrappedPromise.finally(() => {
      try {
        this.inflightQueries.delete(key);
      } catch {
        // Non-fatal; map cleanup should never crash the app.
      }
    });

    return wrappedPromise;
  }

  /**
   * Handle circuit breaker state changes
   * @private
   */
  _onCircuitStateChange(data) {
    logger.info('[ChromaDB] Circuit state changed', {
      from: data.previousState,
      to: data.currentState
    });

    this.emit('circuitStateChange', {
      serviceName: 'chromadb',
      previousState: data.previousState,
      currentState: data.currentState,
      timestamp: data.timestamp
    });

    if (data.currentState === CircuitState.CLOSED) {
      this._flushOfflineQueue().catch((error) => {
        logger.error('[ChromaDB] Failed to flush offline queue', {
          error: error.message
        });
      });
    }
  }

  /**
   * Flush the offline queue when service recovers
   * @private
   */
  async _flushOfflineQueue() {
    if (this.offlineQueue.isEmpty()) {
      return { processed: 0, failed: 0, remaining: 0 };
    }

    logger.info('[ChromaDB] Flushing offline queue', {
      queueSize: this.offlineQueue.size()
    });

    const processor = async (operation) => {
      switch (operation.type) {
        case OperationType.UPSERT_FILE:
          await this._directUpsertFile(operation.data);
          break;
        case OperationType.UPSERT_FOLDER:
          await this._directUpsertFolder(operation.data);
          break;
        case OperationType.DELETE_FILE:
          await this.deleteFileEmbedding(operation.data.fileId);
          break;
        case OperationType.BATCH_UPSERT_FILES:
          await this._directBatchUpsertFiles(operation.data.files);
          break;
        case OperationType.BATCH_UPSERT_FOLDERS:
          await this._directBatchUpsertFolders(operation.data.folders);
          break;
        case OperationType.BATCH_DELETE_FILES:
          await this._directBatchDeleteFiles(operation.data.fileIds);
          break;
        case OperationType.BATCH_DELETE_FOLDERS:
          await this._directBatchDeleteFolders(operation.data.folderIds);
          break;
        case OperationType.DELETE_FOLDER:
          await this._directDeleteFolder(operation.data.folderId);
          break;
        case OperationType.UPDATE_FILE_PATHS:
          await this.updateFilePaths(operation.data.pathUpdates);
          break;
        default:
          logger.warn('[ChromaDB] Unknown operation type in queue', {
            type: operation.type
          });
      }
    };

    return this.offlineQueue.flush(processor);
  }

  getCircuitState() {
    return this.circuitBreaker.getState();
  }

  getCircuitStats() {
    return this.circuitBreaker.getStats();
  }

  getQueueStats() {
    return this.offlineQueue.getStats();
  }

  isServiceAvailable() {
    return this.circuitBreaker.isAvailable();
  }

  forceRecovery() {
    logger.info('[ChromaDB] Forcing recovery attempt');
    this.circuitBreaker.reset();
  }

  /**
   * Check if ChromaDB connection is healthy
   */
  async checkHealth() {
    try {
      // Try HTTP endpoints first
      const httpResult = await checkHealthViaHttp(this.serverUrl);

      if (httpResult.healthy) {
        const wasOffline = !this.isOnline;
        if (!this.isOnline) {
          logger.info('[ChromaDB] Connection restored/established');
          this.isOnline = true;
        }
        this.circuitBreaker.recordSuccess();
        // FIX: Only emit UI events after initialization to prevent premature state updates
        if (wasOffline && this._initializationComplete) {
          this.emit('online', { reason: 'health_check_success' });
        }
        return true;
      }

      // Fallback to client heartbeat
      if (this.client) {
        const isHealthy = await checkHealthViaClient(this.client);
        if (isHealthy) {
          const wasOffline = !this.isOnline;
          if (!this.isOnline) {
            logger.info('[ChromaDB] Connection restored via client');
            this.isOnline = true;
          }
          this.circuitBreaker.recordSuccess();
          // FIX: Only emit UI events after initialization
          if (wasOffline && this._initializationComplete) {
            this.emit('online', { reason: 'health_check_client' });
          }
          return true;
        }
      }

      // Health check failed
      const wasOnline = this.isOnline;
      if (this.isOnline) {
        logger.warn('[ChromaDB] Connection lost');
        this.isOnline = false;
      }
      this.circuitBreaker.recordFailure(new Error('Health check failed'));
      // FIX: Only emit UI events after initialization
      if (wasOnline && this._initializationComplete) {
        this.emit('offline', { reason: 'health_check_failed' });
      }
      return false;
    } catch (error) {
      logger.debug('[ChromaDB] Health check failed:', error.message);
      const wasOnline = this.isOnline;
      if (this.isOnline) {
        logger.warn('[ChromaDB] Connection lost due to error:', error.message);
        this.isOnline = false;
      }
      this.circuitBreaker.recordFailure(error);
      // FIX: Only emit UI events after initialization
      if (wasOnline && this._initializationComplete) {
        this.emit('offline', {
          reason: 'health_check_error',
          error: error.message
        });
      }
      return false;
    }
  }

  async initialize() {
    if (this._initPromise) {
      return this._initPromise;
    }

    if (this.initialized) {
      // FIX: Check circuit breaker before health check to avoid hammering failing service
      if (!this.circuitBreaker.isAllowed()) {
        logger.debug('[ChromaDB] Skipping health check - circuit open');
        return Promise.resolve(); // Consider initialized if circuit is managing recovery
      }

      try {
        const isHealthy = await this.checkHealth();
        if (isHealthy) {
          return Promise.resolve();
        }
        logger.warn('[ChromaDB] Connection lost, reinitializing...');
        this.initialized = false;
        this.client = null;
        this.fileCollection = null;
        this.folderCollection = null;
      } catch (error) {
        logger.warn('[ChromaDB] Health check error:', error.message);
        this.initialized = false;
        this.client = null;
      }
    }

    // FIX: Removed polling loop - use atomic check-and-set pattern instead
    // The _initPromise is now set BEFORE _isInitializing, eliminating race conditions
    if (this._isInitializing) {
      // _initPromise should always exist when _isInitializing is true
      // If not, another call is in the process of setting it up - wait briefly
      if (this._initPromise) {
        return this._initPromise;
      }
      // Edge case: _isInitializing was set but promise not yet assigned
      // Wait a microtask for the assignment to complete
      await new Promise((resolve) => setTimeout(resolve, TIMEOUTS.DELAY_MICRO));
      if (this._initPromise) {
        return this._initPromise;
      }
      // If still no promise, the previous init likely failed - allow retry
      this._isInitializing = false;
    }

    // FIX P1-6: Atomic pattern - set promise BEFORE setting _isInitializing
    // This ensures concurrent calls always see the promise
    // Use explicit resolve/reject for proper error propagation
    let resolveInit;
    let rejectInit;
    this._initPromise = new Promise((resolve, reject) => {
      resolveInit = resolve;
      rejectInit = reject;
    });
    // Set _isInitializing AFTER promise is assigned to eliminate race window
    this._isInitializing = true;

    // Perform actual initialization in a separate async block
    (async () => {
      // FIX: Suppress annoying ChromaDB warning about missing embedding configuration
      // We provide embeddings explicitly, so this warning is a false positive
      // eslint-disable-next-line no-console
      const originalWarn = console.warn;
      // eslint-disable-next-line no-console
      console.warn = (...args) => {
        if (
          args.length > 0 &&
          typeof args[0] === 'string' &&
          args[0].includes(
            'No embedding function configuration found for collection schema deserialization'
          )
        ) {
          return; // Suppress
        }
        // eslint-disable-next-line no-console
        originalWarn.apply(console, args);
      };

      try {
        // FIX: Start stale promise cleanup early in initialization
        // This prevents memory leaks even if later initialization steps fail
        this._startStalePromiseCleanup();

        await this.ensureDbDirectory();
        await this.offlineQueue.initialize();

        // The Chroma JS SDK deprecated { path }. Use { ssl, host, port } to avoid console noise.
        this.client = new ChromaClient({
          ssl: this.serverProtocol === 'https',
          host: this.serverHost,
          port: this.serverPort
        });

        // Wrap collection operations with timeout to prevent hanging on slow/unresponsive server
        this.fileCollection = await withTimeout(
          this.client.getOrCreateCollection({
            name: 'file_embeddings',
            embeddingFunction: explicitEmbeddingsOnlyEmbeddingFunction,
            metadata: {
              description: 'Document and image file embeddings for semantic search',
              'hnsw:space': 'cosine'
            }
          }),
          CHROMADB_INIT_TIMEOUT_MS,
          'ChromaDB file collection init'
        );

        this.fileChunkCollection = await withTimeout(
          this.client.getOrCreateCollection({
            name: 'file_chunk_embeddings',
            embeddingFunction: explicitEmbeddingsOnlyEmbeddingFunction,
            metadata: {
              description: 'Chunk embeddings for extracted text (semantic search deep recall)',
              'hnsw:space': 'cosine'
            }
          }),
          CHROMADB_INIT_TIMEOUT_MS,
          'ChromaDB file chunk collection init'
        );

        this.folderCollection = await withTimeout(
          this.client.getOrCreateCollection({
            name: 'folder_embeddings',
            embeddingFunction: explicitEmbeddingsOnlyEmbeddingFunction,
            metadata: {
              description: 'Smart folder embeddings for categorization',
              'hnsw:space': 'cosine'
            }
          }),
          CHROMADB_INIT_TIMEOUT_MS,
          'ChromaDB folder collection init'
        );

        this.feedbackCollection = await withTimeout(
          this.client.getOrCreateCollection({
            name: 'feedback_memory',
            embeddingFunction: explicitEmbeddingsOnlyEmbeddingFunction,
            metadata: {
              description: 'User feedback memories for recommendation tuning',
              'hnsw:space': 'cosine'
            }
          }),
          CHROMADB_INIT_TIMEOUT_MS,
          'ChromaDB feedback memory collection init'
        );

        this.initialized = true;
        this.isOnline = true;

        // Start periodic health monitoring now that we're connected
        this.startHealthCheck();

        // Count operations with timeout protection
        const [fileCount, folderCount, fileChunkCount, feedbackCount] = await Promise.all([
          withTimeout(
            this.fileCollection.count(),
            CHROMADB_OPERATION_TIMEOUT_MS,
            'ChromaDB file count'
          ),
          withTimeout(
            this.folderCollection.count(),
            CHROMADB_OPERATION_TIMEOUT_MS,
            'ChromaDB folder count'
          ),
          withTimeout(
            this.fileChunkCollection.count(),
            CHROMADB_OPERATION_TIMEOUT_MS,
            'ChromaDB file chunk count'
          ),
          withTimeout(
            this.feedbackCollection.count(),
            CHROMADB_OPERATION_TIMEOUT_MS,
            'ChromaDB feedback memory count'
          )
        ]);

        logger.info('[ChromaDB] Successfully initialized vector database', {
          dbPath: this.dbPath,
          serverUrl: this.serverUrl,
          fileCount,
          folderCount,
          fileChunkCount,
          feedbackCount
        });

        // FIX: Mark initialization complete to enable event handler guards
        // This allows UI events to be emitted now that all state is properly initialized
        this._initializationComplete = true;

        // FIX: Resolve the promise to signal successful initialization
        resolveInit();
        this._isInitializing = false;
      } catch (error) {
        this._initPromise = null;
        this._isInitializing = false;
        this.initialized = false;
        // FIX: Reset initialization complete flag on failure
        this._initializationComplete = false;

        logger.error('[ChromaDB] Initialization failed:', error);

        // IMPORTANT: Do not aggressively delete the on-disk DB on transient startup errors.
        // We only consider a backup+reset when:
        // - the server is reachable/healthy (so this isn't a race / "server not ready" case)
        // - the error strongly suggests on-disk schema/tenant corruption
        //
        // This preserves the user's previously working DB (pre-wizard behavior) and avoids data loss.
        const errorMsg = error?.message || '';
        const corruptionLike =
          /default_tenant/i.test(errorMsg) ||
          /tenant.*not found/i.test(errorMsg) ||
          /could not find tenant/i.test(errorMsg) ||
          /no such table/i.test(errorMsg) ||
          /sqlite/i.test(errorMsg);

        let serverHealthy = false;
        try {
          const health = await checkHealthViaHttp(this.serverUrl);
          serverHealthy = Boolean(health?.healthy);
        } catch {
          serverHealthy = false;
        }

        // IMPORTANT:
        // Never auto-reset the user's local ChromaDB directory in production by default.
        // We have seen tenant/db errors ("default_tenant", sqlite issues) that can be transient
        // or caused by an externally-managed Chroma server. Automatically renaming/deleting the
        // local directory risks silent data loss (and won't help in external-server mode).
        //
        // If someone needs the old behavior for debugging, it can be explicitly enabled via:
        //   STRATOSORT_ALLOW_CHROMADB_AUTO_RESET=1
        const allowAutoReset = process.env.STRATOSORT_ALLOW_CHROMADB_AUTO_RESET === '1';

        if (serverHealthy && corruptionLike) {
          logger.warn('[ChromaDB] Detected likely DB/tenant corruption while server is healthy', {
            serverUrl: this.serverUrl,
            dbPath: this.dbPath,
            allowAutoReset,
            error: errorMsg
          });

          if (allowAutoReset && !this._recoveryAttempted) {
            this._recoveryAttempted = true;
            logger.warn(
              '[ChromaDB] Auto-reset is enabled. Backing up DB directory and resetting local data...'
            );

            try {
              const fsSync = require('fs');
              if (fsSync.existsSync(this.dbPath)) {
                const backupPath = `${this.dbPath}.bak.${Date.now()}`;
                await fs.rename(this.dbPath, backupPath);
                logger.warn('[ChromaDB] Backed up database directory', { backupPath });
              }

              await this.ensureDbDirectory();

              // Note: the running Chroma server must be restarted to pick up the new database directory.
              logger.warn(
                '[ChromaDB] Local database reset complete. Please restart the application.'
              );
            } catch (recoveryError) {
              logger.error('[ChromaDB] Recovery attempt failed:', recoveryError.message);
            }
          } else {
            logger.warn(
              '[ChromaDB] Auto-reset is disabled. To recover, fix/restart ChromaDB or use the in-app "Clear/Rebuild embeddings" tools. Your existing DB directory was left untouched.'
            );
          }
        }

        // Cleanup references last (so health checks can still use serverUrl above).
        try {
          if (this.fileCollection) this.fileCollection = null;
          if (this.folderCollection) this.folderCollection = null;
          if (this.fileChunkCollection) this.fileChunkCollection = null;
          if (this.feedbackCollection) this.feedbackCollection = null;
          if (this.client) this.client = null;
        } catch (cleanupError) {
          logger.error('[ChromaDB] Error during cleanup:', cleanupError);
        }

        // FIX: Reject the promise instead of throwing to properly propagate errors
        rejectInit(new Error(`Failed to initialize ChromaDB: ${errorMsg}`));
      } finally {
        // Restore console.warn
        // eslint-disable-next-line no-console
        console.warn = originalWarn;
      }
    })();

    return this._initPromise;
  }

  // ============== Folder Operations ==============

  async upsertFolder(folder) {
    if (!folder.id || !folder.vector || !Array.isArray(folder.vector)) {
      throw new Error('Invalid folder data: missing id or vector');
    }

    if (!this.circuitBreaker.isAllowed()) {
      logger.debug('[ChromaDB] Circuit open, queueing folder upsert', {
        folderId: folder.id
      });
      this.offlineQueue.enqueue(OperationType.UPSERT_FOLDER, folder);
      return { queued: true, folderId: folder.id };
    }

    await this.initialize();
    return this.circuitBreaker.execute(async () =>
      this._executeWithNotFoundRecovery('upsertFolder', () => this._directUpsertFolder(folder))
    );
  }

  async _directUpsertFolder(folder) {
    return directUpsertFolder({
      folder,
      folderCollection: this.folderCollection,
      queryCache: this.queryCache
    });
  }

  async batchUpsertFolders(folders) {
    if (!folders || folders.length === 0) {
      return { queued: false, count: 0, skipped: [] };
    }

    if (!this.circuitBreaker.isAllowed()) {
      logger.debug('[ChromaDB] Circuit open, queueing batch folder upsert', {
        count: folders.length
      });
      this.offlineQueue.enqueue(OperationType.BATCH_UPSERT_FOLDERS, {
        folders
      });
      this.emit('operationQueued', {
        type: 'batch_upsert_folders',
        count: folders.length
      });
      return { queued: true, count: folders.length, skipped: [] };
    }

    await this.initialize();
    const result = await this.circuitBreaker.execute(async () =>
      this._executeWithNotFoundRecovery('batchUpsertFolders', () =>
        this._directBatchUpsertFolders(folders)
      )
    );
    return { queued: false, ...result };
  }

  async _directBatchUpsertFolders(folders) {
    return directBatchUpsertFolders({
      folders,
      folderCollection: this.folderCollection,
      queryCache: this.queryCache
    });
  }

  async queryFoldersByEmbedding(embedding, topK = 5) {
    await this.initialize();
    // Wrap query with timeout to prevent UI freeze on slow server
    return this.circuitBreaker.execute(async () =>
      this._executeWithNotFoundRecovery('queryFoldersByEmbedding', async () =>
        withTimeout(
          queryFoldersByEmbeddingOp({
            embedding,
            topK,
            folderCollection: this.folderCollection
          }),
          CHROMADB_OPERATION_TIMEOUT_MS,
          'ChromaDB queryFoldersByEmbedding'
        )
      )
    );
  }

  async queryFolders(fileId, topK = 5) {
    await this.initialize();

    const cacheKey = `query:folders:${fileId}:${topK}`;
    const cached = this.queryCache.get(cacheKey);
    if (cached) {
      logger.debug('[ChromaDB] Query cache hit for folders', { fileId });
      return cached;
    }

    if (this.inflightQueries.has(cacheKey)) {
      logger.debug('[ChromaDB] Deduplicating in-flight query', { fileId });
      // FIX: Extract promise from stored entry { promise, addedAt }
      const entry = this.inflightQueries.get(cacheKey);
      return entry?.promise || entry;
    }

    // Wrap query with timeout to prevent UI freeze on slow server
    const queryPromise = this._addInflightQuery(
      cacheKey,
      this.circuitBreaker.execute(async () =>
        this._executeWithNotFoundRecovery('queryFolders', async () =>
          withTimeout(
            executeQueryFolders({
              fileId,
              topK,
              fileCollection: this.fileCollection,
              folderCollection: this.folderCollection
            }),
            CHROMADB_OPERATION_TIMEOUT_MS,
            'ChromaDB queryFolders'
          )
        )
      )
    );

    // FIX: Removed redundant finally block - _addInflightQuery already handles cleanup
    // via promise.finally(). The double-delete was harmless but confusing.
    const results = await queryPromise;
    this.queryCache.set(cacheKey, results);
    return results;
  }

  async batchQueryFolders(fileIds, topK = 5) {
    await this.initialize();
    // FIX: Wrap with not-found recovery to handle stale collection handles after server restart
    return this.circuitBreaker.execute(async () =>
      this._executeWithNotFoundRecovery('batchQueryFolders', async () =>
        // Wrap batch query with timeout (longer for batch operations)
        withTimeout(
          batchQueryFoldersOp({
            fileIds,
            topK,
            fileCollection: this.fileCollection,
            folderCollection: this.folderCollection,
            queryCache: this.queryCache
          }),
          CHROMADB_OPERATION_TIMEOUT_MS * 2, // Double timeout for batch operations
          'ChromaDB batchQueryFolders'
        )
      )
    );
  }

  async getAllFolders() {
    await this.initialize();
    return getAllFoldersOp({ folderCollection: this.folderCollection });
  }

  // ============== Feedback Memory Operations ==============

  async upsertFeedbackMemory({ id, vector, metadata = {}, document = '' }) {
    if (!id || !vector || !Array.isArray(vector)) {
      throw new Error('Invalid feedback memory data: missing id or vector');
    }
    await this.initialize();
    const dimValidation = await this.validateEmbeddingDimension(vector, 'feedback');
    if (!dimValidation.valid) {
      throw new Error(
        `Feedback memory embedding dimension mismatch: expected ${dimValidation.expectedDim}, got ${dimValidation.actualDim}`
      );
    }
    await withTimeout(
      this.feedbackCollection.upsert({
        ids: [id],
        embeddings: [vector],
        metadatas: [metadata],
        documents: [document]
      }),
      CHROMADB_OPERATION_TIMEOUT_MS,
      'ChromaDB upsert feedback memory'
    );
  }

  async queryFeedbackMemory(queryEmbedding, topK = 5) {
    await this.initialize();
    return this.circuitBreaker.execute(async () => {
      const count = await this.feedbackCollection.count();
      if (count === 0) return [];
      const results = await withTimeout(
        this.feedbackCollection.query({
          queryEmbeddings: [queryEmbedding],
          nResults: topK
        }),
        CHROMADB_OPERATION_TIMEOUT_MS,
        'ChromaDB query feedback memory'
      );

      const ids = results.ids?.[0] || [];
      const distances = results.distances?.[0] || [];
      const metadatas = results.metadatas?.[0] || [];
      const documents = results.documents?.[0] || [];

      const matches = [];
      for (let i = 0; i < ids.length; i++) {
        const distance = i < distances.length ? distances[i] : 1;
        matches.push({
          id: ids[i],
          score: Math.max(0, 1 - distance / 2),
          metadata: i < metadatas.length ? metadatas[i] : {},
          document: i < documents.length ? documents[i] : ''
        });
      }
      return matches.sort((a, b) => b.score - a.score);
    });
  }

  async deleteFeedbackMemory(id) {
    await this.initialize();
    await withTimeout(
      this.feedbackCollection.delete({ ids: [id] }),
      CHROMADB_OPERATION_TIMEOUT_MS,
      'ChromaDB delete feedback memory'
    );
  }

  async resetFolders() {
    await this.initialize();
    this.folderCollection = await resetFoldersOp({
      client: this.client,
      embeddingFunction: explicitEmbeddingsOnlyEmbeddingFunction
    });
    // FIX: Clear cached dimension so new embeddings can set it
    this._collectionDimensions.folders = null;
  }

  async resetFeedbackMemory() {
    await this.initialize();
    await this.client.deleteCollection({ name: 'feedback_memory' });
    this.feedbackCollection = await this.client.createCollection({
      name: 'feedback_memory',
      embeddingFunction: explicitEmbeddingsOnlyEmbeddingFunction,
      metadata: {
        description: 'User feedback memories for recommendation tuning',
        'hnsw:space': 'cosine'
      }
    });
    this._collectionDimensions.feedback = null;
  }

  // ============== File Operations ==============

  async upsertFile(file) {
    if (!file.id || !file.vector || !Array.isArray(file.vector)) {
      throw new Error('Invalid file data: missing id or vector');
    }

    if (!this.circuitBreaker.isAllowed()) {
      logger.debug('[ChromaDB] Circuit open, queueing file upsert', {
        fileId: file.id
      });
      this.offlineQueue.enqueue(OperationType.UPSERT_FILE, file);
      return { queued: true, fileId: file.id };
    }

    await this.initialize();

    // FIX P1-3: Validate embedding dimensions before upsert
    const dimValidation = await this.validateEmbeddingDimension(file.vector, 'files');
    if (!dimValidation.valid) {
      logger.warn('[ChromaDB] Dimension mismatch in upsertFile', {
        fileId: file.id,
        expected: dimValidation.expectedDim,
        actual: dimValidation.actualDim
      });
      this.emit('dimension-mismatch', {
        type: 'files',
        expected: dimValidation.expectedDim,
        actual: dimValidation.actualDim
      });
      this.offlineQueue.enqueue(OperationType.UPSERT_FILE, file, {
        reason: 'dimension_mismatch'
      });
      return { queued: true, fileId: file.id, reason: 'dimension_mismatch' };
    }

    return this.circuitBreaker.execute(async () =>
      this._executeWithNotFoundRecovery('upsertFile', () => this._directUpsertFile(file))
    );
  }

  async _directUpsertFile(file) {
    return directUpsertFile({
      file,
      fileCollection: this.fileCollection,
      queryCache: this.queryCache
    });
  }

  async batchUpsertFiles(files) {
    if (!files || files.length === 0) {
      return { queued: false, count: 0 };
    }

    if (!this.circuitBreaker.isAllowed()) {
      logger.debug('[ChromaDB] Circuit open, queueing batch file upsert', {
        count: files.length
      });
      this.offlineQueue.enqueue(OperationType.BATCH_UPSERT_FILES, { files });
      this.emit('operationQueued', {
        type: 'batch_upsert_files',
        count: files.length
      });
      return { queued: true, count: files.length };
    }

    await this.initialize();

    // FIX P1-3: Validate first file's dimensions against collection
    // (all files should have same dimensions from same embedding model)
    const firstFileWithVector = files.find((f) => Array.isArray(f.vector) && f.vector.length > 0);
    if (firstFileWithVector) {
      const dimValidation = await this.validateEmbeddingDimension(
        firstFileWithVector.vector,
        'files'
      );
      if (!dimValidation.valid && dimValidation.error === 'dimension_mismatch') {
        logger.warn('[ChromaDB] Dimension mismatch in batchUpsertFiles', {
          expected: dimValidation.expectedDim,
          actual: dimValidation.actualDim,
          fileCount: files.length
        });
        this.emit('dimension-mismatch', {
          type: 'files',
          expected: dimValidation.expectedDim,
          actual: dimValidation.actualDim
        });
        this.offlineQueue.enqueue(
          OperationType.BATCH_UPSERT_FILES,
          { files },
          {
            reason: 'dimension_mismatch'
          }
        );
        return { queued: true, count: files.length, reason: 'dimension_mismatch' };
      }
    }

    const count = await this.circuitBreaker.execute(async () =>
      this._executeWithNotFoundRecovery('batchUpsertFiles', () =>
        this._directBatchUpsertFiles(files)
      )
    );
    return { queued: false, count };
  }

  async _directBatchUpsertFiles(files) {
    return directBatchUpsertFiles({
      files,
      fileCollection: this.fileCollection,
      queryCache: this.queryCache
    });
  }

  async deleteFileEmbedding(fileId) {
    await this.initialize();

    // FIX P0-1: Also delete associated chunks to prevent orphaned data
    await deleteFileChunks({
      fileId,
      chunkCollection: this.fileChunkCollection
    });

    const result = await deleteFileEmbeddingOp({
      fileId,
      fileCollection: this.fileCollection,
      queryCache: this.queryCache
    });

    // FIX: Log warnings for failed deletions to help debugging
    if (!result.success) {
      logger.warn('[ChromaDB] Delete file embedding failed', {
        fileId,
        error: result.error
      });
    }

    // Return success boolean for backward compatibility
    return result.success;
  }

  async batchDeleteFileEmbeddings(fileIds) {
    if (!fileIds || fileIds.length === 0) {
      return { count: 0, queued: false };
    }

    // Check circuit breaker - queue if service unavailable
    if (!this.circuitBreaker.isAllowed()) {
      logger.debug('[ChromaDB] Circuit open, queueing batch file delete', {
        count: fileIds.length
      });
      this.offlineQueue.enqueue(OperationType.BATCH_DELETE_FILES, { fileIds });
      this.emit('operationQueued', {
        type: 'batch_delete_files',
        count: fileIds.length
      });
      return { queued: true, count: fileIds.length };
    }

    await this.initialize();
    const count = await this._directBatchDeleteFiles(fileIds);
    return { queued: false, count };
  }

  /**
   * Direct batch delete files (bypasses circuit breaker)
   * FIX P0-1: Also deletes associated chunks to prevent orphaned data
   * @private
   */
  async _directBatchDeleteFiles(fileIds) {
    // FIX P0-1: Delete chunks first, then file embeddings
    await batchDeleteFileChunks({
      fileIds,
      chunkCollection: this.fileChunkCollection
    });

    return batchDeleteFileEmbeddingsOp({
      fileIds,
      fileCollection: this.fileCollection,
      queryCache: this.queryCache
    });
  }

  /**
   * Clone a file embedding for a copied file.
   * Retrieves the source embedding and creates a new entry for the destination.
   *
   * @param {string} sourceId - Source file ID (e.g., "file:/path/to/source")
   * @param {string} destId - Destination file ID (e.g., "file:/path/to/dest")
   * @param {Object} newMeta - New metadata for the cloned embedding
   * @returns {Promise<{success: boolean, cloned?: boolean, error?: string}>}
   */
  async cloneFileEmbedding(sourceId, destId, newMeta = {}) {
    if (!sourceId || !destId) {
      return { success: false, error: 'Source and destination IDs required' };
    }

    // Check circuit breaker
    if (!this.circuitBreaker.isAllowed()) {
      logger.debug('[ChromaDB] Circuit open, cannot clone embedding', {
        sourceId,
        destId
      });
      return { success: false, error: 'Service unavailable' };
    }

    await this.initialize();

    try {
      // Get the source embedding
      const sourceResult = await this.fileCollection.get({
        ids: [sourceId],
        include: ['embeddings', 'metadatas']
      });

      if (!sourceResult?.ids?.length || !sourceResult.embeddings?.length) {
        // No embedding for source file - not an error, just nothing to clone
        return { success: true, cloned: false };
      }

      // Clone the embedding with new ID and metadata
      const sourceEmbedding = sourceResult.embeddings[0];
      const sourceMeta = sourceResult.metadatas?.[0] || {};

      const clonedMeta = {
        ...sourceMeta,
        ...newMeta,
        clonedFrom: sourceId,
        clonedAt: new Date().toISOString()
      };

      // Upsert the cloned embedding
      await this.fileCollection.upsert({
        ids: [destId],
        embeddings: [sourceEmbedding],
        metadatas: [clonedMeta]
      });

      // Invalidate query cache for the new ID
      this.queryCache?.invalidateForFile?.(destId);

      logger.debug('[ChromaDB] Cloned file embedding', {
        sourceId,
        destId
      });

      return { success: true, cloned: true };
    } catch (error) {
      logger.error('[ChromaDB] Failed to clone file embedding', {
        error: error.message,
        sourceId,
        destId
      });
      return { success: false, error: error.message };
    }
  }

  async cloneFileChunks(sourceId, destId, newMeta = {}) {
    if (!sourceId || !destId) {
      return { success: false, error: 'Source and destination IDs required' };
    }

    // Check circuit breaker
    if (!this.circuitBreaker.isAllowed()) {
      logger.debug('[ChromaDB] Circuit open, cannot clone chunks', {
        sourceId,
        destId
      });
      return { success: false, error: 'Service unavailable' };
    }

    await this.initialize();
    const clonedCount = await cloneFileChunksOp({
      sourceId,
      destId,
      newMeta,
      chunkCollection: this.fileChunkCollection
    });
    return { success: true, cloned: clonedCount > 0, count: clonedCount };
  }

  /**
   * Delete a folder embedding with offline queue support
   */
  async deleteFolderEmbedding(folderId) {
    if (!folderId) {
      return { success: false, queued: false };
    }

    // Check circuit breaker - queue if service unavailable
    if (!this.circuitBreaker.isAllowed()) {
      logger.debug('[ChromaDB] Circuit open, queueing folder delete', {
        folderId
      });
      this.offlineQueue.enqueue(OperationType.DELETE_FOLDER, { folderId });
      this.emit('operationQueued', { type: 'delete_folder', folderId });
      return { queued: true, success: true };
    }

    await this.initialize();
    await this._directDeleteFolder(folderId);
    return { queued: false, success: true };
  }

  /**
   * Direct delete folder (bypasses circuit breaker)
   * @private
   */
  async _directDeleteFolder(folderId) {
    try {
      await this.folderCollection.delete({ ids: [folderId] });
      if (this.queryCache) {
        this.queryCache.invalidateForFile(folderId);
      }
    } catch (error) {
      logger.warn('[ChromaDB] Failed to delete folder embedding', {
        folderId,
        error: error.message
      });
    }
  }

  /**
   * Batch delete folder embeddings with offline queue support
   */
  async batchDeleteFolders(folderIds) {
    if (!folderIds || folderIds.length === 0) {
      return { count: 0, queued: false };
    }

    // Check circuit breaker - queue if service unavailable
    if (!this.circuitBreaker.isAllowed()) {
      logger.debug('[ChromaDB] Circuit open, queueing batch folder delete', {
        count: folderIds.length
      });
      this.offlineQueue.enqueue(OperationType.BATCH_DELETE_FOLDERS, {
        folderIds
      });
      this.emit('operationQueued', {
        type: 'batch_delete_folders',
        count: folderIds.length
      });
      return { queued: true, count: folderIds.length };
    }

    await this.initialize();
    const count = await this._directBatchDeleteFolders(folderIds);
    return { queued: false, count };
  }

  /**
   * Direct batch delete folders (bypasses circuit breaker)
   * @private
   */
  async _directBatchDeleteFolders(folderIds) {
    if (!folderIds || folderIds.length === 0) {
      return 0;
    }

    try {
      await this.folderCollection.delete({ ids: folderIds });

      // Invalidate cache for all deleted folders
      if (this.queryCache) {
        folderIds.forEach((id) => this.queryCache.invalidateForFile(id));
      }

      return folderIds.length;
    } catch (error) {
      logger.error('[ChromaDB] Batch folder delete failed', {
        count: folderIds.length,
        error: error.message
      });
      throw error;
    }
  }

  async updateFilePaths(pathUpdates) {
    await this.initialize();
    const updatedFiles = await updateFilePathsOp({
      pathUpdates,
      fileCollection: this.fileCollection,
      queryCache: this.queryCache
    });
    await updateFileChunkPathsOp({
      pathUpdates,
      chunkCollection: this.fileChunkCollection
    });

    // Ensure both old and new file IDs can't serve stale cached results
    if (this.queryCache && Array.isArray(pathUpdates)) {
      pathUpdates.forEach((u) => {
        if (u?.oldId) this.queryCache.invalidateForFile(u.oldId);
        if (u?.newId) this.queryCache.invalidateForFile(u.newId);
      });
    }

    return updatedFiles;
  }

  async querySimilarFiles(queryEmbedding, topK = 10) {
    await this.initialize();
    return this.circuitBreaker.execute(async () =>
      querySimilarFilesOp({
        queryEmbedding,
        topK,
        fileCollection: this.fileCollection
      })
    );
  }

  async batchUpsertFileChunks(chunks) {
    if (!chunks || chunks.length === 0) {
      return 0;
    }

    await this.initialize();

    // FIX P1-3: Validate first chunk's dimensions against collection
    const firstChunkWithVector = chunks.find((c) => Array.isArray(c.vector) && c.vector.length > 0);
    if (firstChunkWithVector) {
      const dimValidation = await this.validateEmbeddingDimension(
        firstChunkWithVector.vector,
        'fileChunks'
      );
      if (!dimValidation.valid && dimValidation.error === 'dimension_mismatch') {
        logger.warn('[ChromaDB] Dimension mismatch in batchUpsertFileChunks', {
          expected: dimValidation.expectedDim,
          actual: dimValidation.actualDim,
          chunkCount: chunks.length
        });
        throw new Error(
          `Chunk embedding dimension mismatch: expected ${dimValidation.expectedDim}, got ${dimValidation.actualDim}. ` +
            `Run "Rebuild Embeddings" to fix.`
        );
      }
    }

    return batchUpsertFileChunksOp({
      chunks,
      chunkCollection: this.fileChunkCollection
    });
  }

  async querySimilarFileChunks(queryEmbedding, topK = 20) {
    await this.initialize();
    return querySimilarFileChunksOp({
      queryEmbedding,
      topK,
      chunkCollection: this.fileChunkCollection
    });
  }

  /**
   * Delete all chunks belonging to a specific file
   * FIX P2-2: Used to clean up old chunks before re-analysis
   *
   * @param {string} fileId - The parent file ID whose chunks should be deleted
   * @returns {Promise<number>} Number of deleted chunks
   */
  async deleteFileChunks(fileId) {
    await this.initialize();
    return deleteFileChunks({
      fileId,
      chunkCollection: this.fileChunkCollection
    });
  }

  async resetFiles() {
    await this.initialize();
    this.fileCollection = await resetFilesOp({
      client: this.client,
      embeddingFunction: explicitEmbeddingsOnlyEmbeddingFunction
    });
    // FIX: Clear cached dimension so new embeddings can set it
    this._collectionDimensions.files = null;
  }

  async resetFileChunks() {
    await this.initialize();
    this.fileChunkCollection = await resetFileChunksOp({
      client: this.client,
      embeddingFunction: explicitEmbeddingsOnlyEmbeddingFunction
    });
    this._collectionDimensions.fileChunks = null;
  }

  async resetAll() {
    await this.resetFiles();
    await this.resetFileChunks();
    await this.resetFolders();
  }

  // ============== Orphan Management ==============

  /**
   * Mark file embeddings as orphaned (soft delete)
   * FIX: Called when analysis history entries are pruned to mark corresponding embeddings
   *
   * @param {Array<string>} fileIds - Array of file IDs to mark as orphaned
   * @returns {Promise<{ marked: number, failed: number }>}
   */
  async markEmbeddingsOrphaned(fileIds) {
    if (!fileIds || fileIds.length === 0) {
      return { marked: 0, failed: 0 };
    }

    await this.initialize();

    // Mark file embeddings
    const fileResult = await markEmbeddingsOrphanedOp({
      fileIds,
      fileCollection: this.fileCollection,
      queryCache: this.queryCache
    });

    // Also mark associated chunks
    const chunkResult = await markChunksOrphanedOp({
      fileIds,
      chunkCollection: this.fileChunkCollection
    });

    logger.info('[ChromaDB] Marked embeddings as orphaned', {
      filesMarked: fileResult.marked,
      chunksMarked: chunkResult.marked
    });

    return {
      marked: fileResult.marked,
      failed: fileResult.failed,
      chunksMarked: chunkResult.marked,
      chunksFailed: chunkResult.failed
    };
  }

  /**
   * Get all orphaned file embeddings
   *
   * @param {number} [maxAge] - Optional max age in milliseconds to filter by
   * @returns {Promise<Array<string>>} Array of orphaned file IDs
   */
  async getOrphanedEmbeddings(maxAge) {
    await this.initialize();
    return getOrphanedEmbeddingsOp({
      fileCollection: this.fileCollection,
      maxAge
    });
  }

  /**
   * Get all orphaned chunk embeddings
   *
   * @param {number} [maxAge] - Optional max age in milliseconds to filter by
   * @returns {Promise<Array<string>>} Array of orphaned chunk IDs
   */
  async getOrphanedChunks(maxAge) {
    await this.initialize();
    return getOrphanedChunksOp({
      chunkCollection: this.fileChunkCollection,
      maxAge
    });
  }

  /**
   * Delete orphaned embeddings older than specified age
   * Used for periodic cleanup of soft-deleted embeddings
   *
   * @param {number} [maxAge=7 * 24 * 60 * 60 * 1000] - Max age in milliseconds (default 7 days)
   * @returns {Promise<{ files: number, chunks: number }>}
   */
  async cleanupOrphanedEmbeddings(maxAge = 7 * 24 * 60 * 60 * 1000) {
    await this.initialize();

    // Get orphaned embeddings older than maxAge
    const orphanedFiles = await this.getOrphanedEmbeddings(maxAge);
    const orphanedChunks = await this.getOrphanedChunks(maxAge);

    let filesDeleted = 0;
    let chunksDeleted = 0;

    // Delete orphaned file embeddings
    if (orphanedFiles.length > 0) {
      try {
        await batchDeleteFileEmbeddingsOp({
          fileIds: orphanedFiles,
          fileCollection: this.fileCollection,
          queryCache: this.queryCache
        });
        filesDeleted = orphanedFiles.length;
      } catch (error) {
        logger.warn('[ChromaDB] Failed to delete orphaned file embeddings', {
          error: error.message
        });
      }
    }

    // Delete orphaned chunk embeddings
    if (orphanedChunks.length > 0) {
      try {
        await this.fileChunkCollection.delete({ ids: orphanedChunks });
        chunksDeleted = orphanedChunks.length;
      } catch (error) {
        logger.warn('[ChromaDB] Failed to delete orphaned chunk embeddings', {
          error: error.message
        });
      }
    }

    if (filesDeleted > 0 || chunksDeleted > 0) {
      logger.info('[ChromaDB] Cleaned up orphaned embeddings', {
        filesDeleted,
        chunksDeleted
      });
    }

    return { files: filesDeleted, chunks: chunksDeleted };
  }

  // ============== Migration ==============

  async migrateFromJsonl(jsonlPath, type = 'file') {
    await this.initialize();

    try {
      const data = await fs.readFile(jsonlPath, 'utf8');
      const lines = data.split(/\r?\n/).filter(Boolean);
      logger.info(`[ChromaDB] Found ${lines.length} lines in JSONL file.`);

      let migrated = 0;
      for (const line of lines) {
        try {
          const obj = JSON.parse(line);
          logger.debug('[ChromaDB] Parsed object:', obj);
          if (obj && obj.id && obj.vector) {
            if (type === 'folder') {
              await this.upsertFolder(obj);
            } else {
              await this.upsertFile({
                id: obj.id,
                vector: obj.vector,
                meta: obj.meta || {}
              });
            }
            migrated++;
            logger.debug('[ChromaDB] Migrated entry:', obj.id);
          }
        } catch (error) {
          logger.warn('[ChromaDB] Failed to migrate line:', error.message);
        }
      }

      logger.info(`[ChromaDB] Migrated ${migrated} ${type} embeddings from JSONL`);
      return migrated;
    } catch (error) {
      if (error.code === 'ENOENT') {
        logger.info(`[ChromaDB] No existing JSONL file to migrate: ${jsonlPath}`);
        return 0;
      }
      logger.error('[ChromaDB] Migration failed:', error);
      throw error;
    }
  }

  // ============== Stats & Cache ==============

  async getStats() {
    await this.initialize();

    try {
      // FIX: Safely handle uninitialized collections (e.g. if circuit breaker prevented init)
      if (!this.fileCollection || !this.folderCollection || !this.fileChunkCollection) {
        return {
          files: 0,
          folders: 0,
          fileChunks: 0,
          dbPath: this.dbPath,
          serverUrl: this.serverUrl,
          initialized: false,
          queryCache: this.queryCache.getStats(),
          inflightQueries: this.inflightQueries.size,
          status: 'uninitialized'
        };
      }

      const fileCount = await this.fileCollection.count();
      const folderCount = await this.folderCollection.count();
      const fileChunkCount = await this.fileChunkCollection.count();

      return {
        files: fileCount,
        folders: folderCount,
        fileChunks: fileChunkCount,
        dbPath: this.dbPath,
        serverUrl: this.serverUrl,
        initialized: this.initialized,
        queryCache: this.queryCache.getStats(),
        inflightQueries: this.inflightQueries.size
      };
    } catch (error) {
      logger.error('[ChromaDB] Failed to get stats:', error);
      return {
        files: 0,
        folders: 0,
        fileChunks: 0,
        dbPath: this.dbPath,
        serverUrl: this.serverUrl,
        initialized: false,
        queryCache: this.queryCache.getStats(),
        inflightQueries: 0,
        error: error.message
      };
    }
  }

  // Legacy cache methods for backward compatibility
  _getCachedQuery(key) {
    return this.queryCache.get(key);
  }

  _setCachedQuery(key, data) {
    this.queryCache.set(key, data);
  }

  _invalidateCacheForFile(fileId) {
    this.queryCache.invalidateForFile(fileId);
  }

  _invalidateCacheForFolder() {
    this.queryCache.invalidateForFolder();
  }

  clearQueryCache() {
    this.queryCache.clear();
  }

  getQueryCacheStats() {
    return this.queryCache.getStats();
  }

  // ============== Filesystem Reconciliation ==============

  /**
   * Reconcile ChromaDB entries with the filesystem
   * Identifies and removes embeddings for files that no longer exist
   * FIX: Eliminates "ghost" entries caused by external file deletions
   *
   * @param {Object} options - Reconciliation options
   * @param {number} [options.batchSize=100] - Number of entries to check per batch
   * @param {boolean} [options.dryRun=false] - If true, only report without deleting
   * @param {Function} [options.onProgress] - Progress callback (current, total, found)
   * @returns {Promise<{checked: number, removed: number, errors: number, orphanedIds: string[]}>}
   */
  async reconcileWithFilesystem(options = {}) {
    const { batchSize = 100, dryRun = false, onProgress } = options;

    await this.initialize();

    const result = {
      checked: 0,
      removed: 0,
      errors: 0,
      orphanedIds: []
    };

    try {
      logger.info('[ChromaDB] Starting filesystem reconciliation', { dryRun, batchSize });

      // Get total count for progress tracking
      const totalCount = await this.fileCollection.count();

      if (totalCount === 0) {
        logger.info('[ChromaDB] No embeddings to reconcile');
        return result;
      }

      // Process in batches to avoid memory issues
      let offset = 0;
      while (offset < totalCount) {
        try {
          // FIX MED-04: Use get() instead of peek() for pagination support
          // peek() does not support offset in all Chroma versions
          const batch = await this.fileCollection.get({
            limit: batchSize,
            offset,
            include: ['metadatas', 'documents', 'embeddings']
          });

          if (!batch?.ids || batch.ids.length === 0) {
            break;
          }

          const orphanedInBatch = [];

          for (let i = 0; i < batch.ids.length; i++) {
            const id = batch.ids[i];
            const metadata = batch.metadatas?.[i] || {};
            const filePath = metadata.path;

            result.checked++;

            if (!filePath) {
              // No path in metadata - can't verify, skip
              continue;
            }

            try {
              // Check if file exists on disk
              await fs.access(filePath);
            } catch {
              // File doesn't exist - this is a ghost entry
              orphanedInBatch.push(id);
              result.orphanedIds.push(id);

              logger.debug('[ChromaDB] Found ghost entry:', {
                id,
                path: filePath
              });
            }
          }

          // Delete orphaned entries from this batch (unless dry run)
          if (orphanedInBatch.length > 0 && !dryRun) {
            try {
              await this.fileCollection.delete({ ids: orphanedInBatch });
              result.removed += orphanedInBatch.length;

              // Also delete associated chunks
              for (const orphanId of orphanedInBatch) {
                try {
                  await deleteFileChunks({
                    fileId: orphanId,
                    chunkCollection: this.fileChunkCollection
                  });
                } catch (chunkErr) {
                  logger.debug('[ChromaDB] Could not delete chunks for orphan:', {
                    id: orphanId,
                    error: chunkErr.message
                  });
                }
              }

              // Invalidate cache
              orphanedInBatch.forEach((id) => this.queryCache.invalidateForFile(id));
            } catch (deleteError) {
              logger.warn('[ChromaDB] Failed to delete orphaned batch:', {
                count: orphanedInBatch.length,
                error: deleteError.message
              });
              result.errors += orphanedInBatch.length;
            }
          }

          // Report progress
          if (onProgress) {
            onProgress(result.checked, totalCount, result.orphanedIds.length);
          }

          offset += batch.ids.length;
        } catch (batchError) {
          logger.warn('[ChromaDB] Error processing reconciliation batch:', {
            offset,
            error: batchError.message
          });
          result.errors++;
          offset += batchSize; // Skip to next batch
        }
      }

      logger.info('[ChromaDB] Filesystem reconciliation complete', {
        checked: result.checked,
        removed: result.removed,
        errors: result.errors,
        dryRun
      });

      return result;
    } catch (error) {
      logger.error('[ChromaDB] Reconciliation failed:', error);
      throw error;
    }
  }

  /**
   * Schedule periodic reconciliation (call during app startup)
   * @param {Object} options - Options
   * @param {number} [options.intervalMs=3600000] - Interval between reconciliations (default: 1 hour)
   * @param {number} [options.initialDelayMs=300000] - Delay before first run (default: 5 minutes)
   */
  startPeriodicReconciliation(options = {}) {
    const { intervalMs = 60 * 60 * 1000, initialDelayMs = 5 * 60 * 1000 } = options;

    if (this._reconciliationInterval) {
      clearInterval(this._reconciliationInterval);
    }
    if (this._reconciliationInitialTimeout) {
      clearTimeout(this._reconciliationInitialTimeout);
    }

    // Run initial reconciliation after delay (give app time to start)
    this._reconciliationInitialTimeout = setTimeout(() => {
      this._reconciliationInitialTimeout = null;
      this.reconcileWithFilesystem({ batchSize: 200 }).catch((err) =>
        logger.warn('[ChromaDB] Initial reconciliation failed:', err.message)
      );
    }, initialDelayMs);

    // Schedule periodic reconciliation
    this._reconciliationInterval = setInterval(() => {
      this.reconcileWithFilesystem({ batchSize: 200 }).catch((err) =>
        logger.warn('[ChromaDB] Periodic reconciliation failed:', err.message)
      );
    }, intervalMs);

    // Don't prevent process exit
    if (this._reconciliationInterval.unref) {
      this._reconciliationInterval.unref();
    }
    if (this._reconciliationInitialTimeout.unref) {
      this._reconciliationInitialTimeout.unref();
    }

    logger.info('[ChromaDB] Periodic reconciliation scheduled', {
      intervalMs,
      initialDelayMs
    });
  }

  /**
   * Stop periodic reconciliation
   */
  stopPeriodicReconciliation() {
    if (this._reconciliationInterval) {
      clearInterval(this._reconciliationInterval);
      this._reconciliationInterval = null;
    }
    if (this._reconciliationInitialTimeout) {
      clearTimeout(this._reconciliationInitialTimeout);
      this._reconciliationInitialTimeout = null;
    }
    logger.debug('[ChromaDB] Periodic reconciliation stopped');
  }

  // ============== Cleanup ==============

  async cleanup() {
    // Stop periodic reconciliation
    this.stopPeriodicReconciliation();
    // FIX: Reset initialization complete flag to prevent events during cleanup
    this._initializationComplete = false;

    if (this.batchInsertTimer) {
      clearTimeout(this.batchInsertTimer);
      this.batchInsertTimer = null;
    }

    if (this.inflightQueries.size > 0) {
      logger.info(`[ChromaDB] Waiting for ${this.inflightQueries.size} in-flight queries...`);
      try {
        const { TIMEOUTS } = require('../../../shared/performanceConstants');
        // FIX: Extract promises from stored entries { promise, addedAt }
        const promises = Array.from(this.inflightQueries.values()).map(
          (entry) => entry?.promise || entry
        );
        await Promise.race([
          Promise.allSettled(promises),
          new Promise((resolve) => setTimeout(resolve, TIMEOUTS.HEALTH_CHECK))
        ]);
      } catch (error) {
        logger.warn('[ChromaDB] Error waiting for in-flight queries:', error.message);
      }
    }

    // FIX: CRITICAL - Remove event listeners before cleanup to prevent memory leaks
    // Previously, CircuitBreaker and OfflineQueue listeners were never removed
    if (this.circuitBreaker) {
      this.circuitBreaker.removeAllListeners();
      this.circuitBreaker.cleanup();
    }

    if (this.offlineQueue) {
      this.offlineQueue.removeAllListeners();
      await this.offlineQueue.cleanup();
    }

    this.queryCache.clear();
    this.inflightQueries.clear();

    this.stopHealthCheck();
    this.removeAllListeners();

    if (this.client) {
      this.fileCollection = null;
      this.folderCollection = null;
      this.client = null;
      this.initialized = false;
      logger.info('[ChromaDB] Cleaned up connections');
    }
  }

  async isServerAvailable(timeoutMs = 3000, maxRetries = 3) {
    return isServerAvailable({
      serverUrl: this.serverUrl,
      client: this.client,
      timeoutMs,
      maxRetries
    });
  }

  getServerConfig() {
    return {
      host: this.serverHost,
      port: this.serverPort,
      protocol: this.serverProtocol,
      url: this.serverUrl,
      dbPath: this.dbPath
    };
  }
}

module.exports = { ChromaDBServiceCore, explicitEmbeddingsOnlyEmbeddingFunction };
