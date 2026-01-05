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
  resetFiles: resetFilesOp
} = require('./fileOperations');
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
const DEFAULT_HTTPS_PORT = 443;
const DEFAULT_HTTP_PORT = 80;

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
    this.folderCollection = null;
    this.initialized = false;

    // Initialization mutex to prevent race conditions
    this._initPromise = null;
    this._isInitializing = false;
    this._recoveryAttempted = false;

    // FIX: Track collection dimensions to detect embedding model changes
    this._collectionDimensions = {
      files: null,
      folders: null
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
    this.inflightQueries = new Map();
    this.MAX_INFLIGHT_QUERIES = getConfig('CHROMADB.maxInflightQueries', 100);

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
    this.circuitBreaker.on('stateChange', (data) => {
      this._onCircuitStateChange(data);
    });
    this.circuitBreaker.on('open', (data) => {
      logger.warn('[ChromaDB] Circuit breaker opened due to failures', data);
      this.emit('offline', {
        reason: 'circuit_open',
        failureCount: data.failureCount
      });
    });
    this.circuitBreaker.on('close', () => {
      logger.info('[ChromaDB] Circuit breaker closed, service recovered');
      this.emit('online', { reason: 'circuit_closed' });
    });
    this.circuitBreaker.on('halfOpen', () => {
      logger.info('[ChromaDB] Circuit breaker half-open, testing recovery');
      this.emit('recovering', { reason: 'circuit_half_open' });
    });

    // Initialize offline queue
    this.offlineQueue = new OfflineQueue({
      maxQueueSize: getConfig('CIRCUIT_BREAKER.maxQueueSize', 1000),
      flushBatchSize: 50,
      flushDelayMs: 1000
    });

    // Forward queue events
    this.offlineQueue.on('enqueued', (op) => {
      this.emit('operationQueued', {
        type: op.type,
        queueSize: this.offlineQueue.size()
      });
    });
    this.offlineQueue.on('flushComplete', (result) => {
      this.emit('queueFlushed', result);
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
   * @param {'files' | 'folders'} collectionType - Which collection to check
   * @returns {Promise<number | null>} Dimension of stored embeddings, or null if collection is empty
   */
  async getCollectionDimension(collectionType) {
    try {
      const collection = collectionType === 'files' ? this.fileCollection : this.folderCollection;
      if (!collection) {
        return null;
      }

      // Return cached dimension if available
      if (this._collectionDimensions[collectionType] !== null) {
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
      logger.debug('[ChromaDB] Could not get collection dimension:', {
        collectionType,
        error: error.message
      });
      return null;
    }
  }

  /**
   * Validate that an embedding vector matches the expected collection dimension.
   * FIX: Provides clear error when embedding model changed and dimensions mismatch.
   *
   * @param {Array<number>} vector - Embedding vector to validate
   * @param {'files' | 'folders'} collectionType - Which collection this is for
   * @returns {Promise<{ valid: boolean, error?: string, expectedDim?: number, actualDim?: number }>}
   */
  async validateEmbeddingDimension(vector, collectionType) {
    if (!Array.isArray(vector) || vector.length === 0) {
      return { valid: false, error: 'invalid_vector' };
    }

    const expectedDim = await this.getCollectionDimension(collectionType);

    // If collection is empty, any dimension is valid (first insert sets the dimension)
    if (expectedDim === null) {
      // Cache the dimension for future validations
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
      folders: null
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
    this.folderCollection = null;
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
        const parsed = new URL(envUrl);

        const protocol = parsed.protocol?.replace(':', '') || DEFAULT_SERVER_PROTOCOL;
        if (!VALID_PROTOCOLS.includes(protocol)) {
          throw new Error(`Invalid protocol "${protocol}". Must be http or https.`);
        }

        const hostname = parsed.hostname || DEFAULT_SERVER_HOST;
        if (!hostname || typeof hostname !== 'string' || hostname.length > 253) {
          throw new Error('Invalid hostname in CHROMA_SERVER_URL');
        }

        let port = Number(parsed.port);
        if (!port) {
          port = protocol === 'https' ? DEFAULT_HTTPS_PORT : DEFAULT_HTTP_PORT;
        }
        if (isNaN(port) || port < MIN_PORT_NUMBER || port > MAX_PORT_NUMBER) {
          throw new Error(
            `Invalid port number ${port}. Must be between ${MIN_PORT_NUMBER} and ${MAX_PORT_NUMBER}.`
          );
        }

        this.serverProtocol = protocol;
        this.serverHost = hostname;
        this.serverPort = port;
        this.serverUrl = `${protocol}://${hostname}:${port}`;
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
  }

  /**
   * Stop periodic health check
   */
  stopHealthCheck() {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
  }

  /**
   * Add to in-flight queries with LRU eviction to prevent memory exhaustion
   * @private
   * @param {string} key - Cache key for the query
   * @param {Promise} promise - The query promise
   */
  _addInflightQuery(key, promise) {
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
    this.inflightQueries.set(key, promise);

    // FIX: CRITICAL - Remove entry when promise settles to prevent memory leak
    // Previously, completed promises remained in the map indefinitely
    promise.finally(() => {
      this.inflightQueries.delete(key);
    });
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
        if (wasOffline) {
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
          if (wasOffline) {
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
      if (wasOnline) {
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
      if (wasOnline) {
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

    // FIX: Atomic pattern - set promise BEFORE setting _isInitializing
    // This ensures concurrent calls always see the promise
    this._isInitializing = true;

    // Use explicit resolve/reject for proper error propagation
    let resolveInit;
    let rejectInit;
    this._initPromise = new Promise((resolve, reject) => {
      resolveInit = resolve;
      rejectInit = reject;
    });

    // Perform actual initialization in a separate async block
    (async () => {
      try {
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

        this.initialized = true;
        this.isOnline = true;

        // Start periodic health monitoring now that we're connected
        this.startHealthCheck();

        process.nextTick(() => {
          this._isInitializing = false;
        });

        // Count operations with timeout protection
        const [fileCount, folderCount] = await Promise.all([
          withTimeout(
            this.fileCollection.count(),
            CHROMADB_OPERATION_TIMEOUT_MS,
            'ChromaDB file count'
          ),
          withTimeout(
            this.folderCollection.count(),
            CHROMADB_OPERATION_TIMEOUT_MS,
            'ChromaDB folder count'
          )
        ]);

        logger.info('[ChromaDB] Successfully initialized vector database', {
          dbPath: this.dbPath,
          serverUrl: this.serverUrl,
          fileCount,
          folderCount
        });

        // FIX: Resolve the promise to signal successful initialization
        resolveInit();
      } catch (error) {
        this._initPromise = null;
        this._isInitializing = false;
        this.initialized = false;

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
          if (this.client) this.client = null;
        } catch (cleanupError) {
          logger.error('[ChromaDB] Error during cleanup:', cleanupError);
        }

        // FIX: Reject the promise instead of throwing to properly propagate errors
        rejectInit(new Error(`Failed to initialize ChromaDB: ${errorMsg}`));
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
    return this._executeWithNotFoundRecovery('queryFoldersByEmbedding', async () =>
      withTimeout(
        queryFoldersByEmbeddingOp({
          embedding,
          topK,
          folderCollection: this.folderCollection
        }),
        CHROMADB_OPERATION_TIMEOUT_MS,
        'ChromaDB queryFoldersByEmbedding'
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
      return this.inflightQueries.get(cacheKey);
    }

    // Wrap query with timeout to prevent UI freeze on slow server
    const queryPromise = this._executeWithNotFoundRecovery('queryFolders', async () =>
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
    );
    // Use bounded helper to prevent memory exhaustion
    this._addInflightQuery(cacheKey, queryPromise);

    // FIX: Removed redundant finally block - _addInflightQuery already handles cleanup
    // via promise.finally(). The double-delete was harmless but confusing.
    const results = await queryPromise;
    this.queryCache.set(cacheKey, results);
    return results;
  }

  async batchQueryFolders(fileIds, topK = 5) {
    await this.initialize();
    // FIX: Wrap with not-found recovery to handle stale collection handles after server restart
    return this._executeWithNotFoundRecovery('batchQueryFolders', async () =>
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
    );
  }

  async getAllFolders() {
    await this.initialize();
    return getAllFoldersOp({ folderCollection: this.folderCollection });
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
    return this.circuitBreaker.execute(async () => this._directUpsertFile(file));
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
    const count = await this.circuitBreaker.execute(async () =>
      this._directBatchUpsertFiles(files)
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
    return deleteFileEmbeddingOp({
      fileId,
      fileCollection: this.fileCollection,
      queryCache: this.queryCache
    });
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
   * @private
   */
  async _directBatchDeleteFiles(fileIds) {
    return batchDeleteFileEmbeddingsOp({
      fileIds,
      fileCollection: this.fileCollection,
      queryCache: this.queryCache
    });
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
    return updateFilePathsOp({
      pathUpdates,
      fileCollection: this.fileCollection,
      queryCache: this.queryCache
    });
  }

  async querySimilarFiles(queryEmbedding, topK = 10) {
    await this.initialize();
    return querySimilarFilesOp({
      queryEmbedding,
      topK,
      fileCollection: this.fileCollection
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

  async resetAll() {
    await this.resetFiles();
    await this.resetFolders();
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
      const fileCount = await this.fileCollection.count();
      const folderCount = await this.folderCollection.count();

      return {
        files: fileCount,
        folders: folderCount,
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

  // ============== Cleanup ==============

  async cleanup() {
    if (this.batchInsertTimer) {
      clearTimeout(this.batchInsertTimer);
      this.batchInsertTimer = null;
    }

    if (this.inflightQueries.size > 0) {
      logger.info(`[ChromaDB] Waiting for ${this.inflightQueries.size} in-flight queries...`);
      try {
        const { TIMEOUTS } = require('../../../shared/performanceConstants');
        await Promise.race([
          Promise.allSettled(Array.from(this.inflightQueries.values())),
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
