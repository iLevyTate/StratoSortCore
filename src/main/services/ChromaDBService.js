const { app } = require('electron');
const { ChromaClient } = require('chromadb');
const path = require('path');
const fs = require('fs').promises;
const { logger } = require('../../shared/logger');
logger.setContext('ChromaDBService');
const { sanitizeMetadata } = require('../../shared/pathSanitization');

// FIXED Bug #26: Named constants for magic numbers
const QUERY_CACHE_TTL_MS = 120000; // 2 minutes
const MAX_CACHE_SIZE = 200;
const BATCH_INSERT_DELAY_MS = 100;
const DEFAULT_SERVER_PROTOCOL = 'http';
const DEFAULT_SERVER_HOST = '127.0.0.1';
const DEFAULT_SERVER_PORT = 8000;
const DEFAULT_HTTPS_PORT = 443;
const DEFAULT_HTTP_PORT = 80;

// FIXED Bug #40: Validation constants for environment variables
const MAX_PORT_NUMBER = 65535;
const MIN_PORT_NUMBER = 1;
const VALID_PROTOCOLS = ['http', 'https'];

/**
 * ChromaDB-based Vector Database Service
 * Replaces the JSON-based EmbeddingIndexService with a proper vector database
 */
class ChromaDBService {
  constructor() {
    this.dbPath = path.join(app.getPath('userData'), 'chromadb');
    this.client = null;
    this.fileCollection = null;
    this.folderCollection = null;
    this.initialized = false;

    // Fixed: Add initialization mutex to prevent race conditions
    this._initPromise = null;
    this._isInitializing = false; // Lock flag to prevent concurrent init attempts

    // FIXED Bug #31: Proper LRU cache with Map for ordered iteration
    this.queryCache = new Map(); // Cache for query results (insertion-ordered)
    this.queryCacheTTL = QUERY_CACHE_TTL_MS;
    this.maxCacheSize = MAX_CACHE_SIZE;

    // Query optimization: Batch operation queues
    this.batchInsertQueue = [];
    this.batchInsertTimer = null;
    this.batchInsertDelay = BATCH_INSERT_DELAY_MS;

    // Query optimization: In-flight query deduplication
    this.inflightQueries = new Map(); // Track in-flight queries to deduplicate

    // FIXED Bug #40: Validate and sanitize environment variables
    this.serverProtocol = DEFAULT_SERVER_PROTOCOL;
    this.serverHost = DEFAULT_SERVER_HOST;
    this.serverPort = DEFAULT_SERVER_PORT;
    this.serverUrl = `${DEFAULT_SERVER_PROTOCOL}://${DEFAULT_SERVER_HOST}:${DEFAULT_SERVER_PORT}`;

    const envUrl = process.env.CHROMA_SERVER_URL;
    if (envUrl) {
      try {
        const parsed = new URL(envUrl);

        // Validate protocol
        const protocol =
          parsed.protocol?.replace(':', '') || DEFAULT_SERVER_PROTOCOL;
        if (!VALID_PROTOCOLS.includes(protocol)) {
          throw new Error(
            `Invalid protocol "${protocol}". Must be http or https.`,
          );
        }

        // Validate and sanitize hostname
        const hostname = parsed.hostname || DEFAULT_SERVER_HOST;
        if (
          !hostname ||
          typeof hostname !== 'string' ||
          hostname.length > 253
        ) {
          throw new Error('Invalid hostname in CHROMA_SERVER_URL');
        }

        // Validate port
        let port = Number(parsed.port);
        if (!port) {
          port = protocol === 'https' ? DEFAULT_HTTPS_PORT : DEFAULT_HTTP_PORT;
        }
        if (isNaN(port) || port < MIN_PORT_NUMBER || port > MAX_PORT_NUMBER) {
          throw new Error(
            `Invalid port number ${port}. Must be between ${MIN_PORT_NUMBER} and ${MAX_PORT_NUMBER}.`,
          );
        }

        this.serverProtocol = protocol;
        this.serverHost = hostname;
        this.serverPort = port;
        this.serverUrl = `${protocol}://${hostname}:${port}`;
      } catch (error) {
        logger.warn(
          '[ChromaDB] Invalid CHROMA_SERVER_URL provided, falling back to defaults',
          { url: envUrl, message: error?.message },
        );
        // Keep defaults set above
      }
    } else {
      // Validate individual env vars
      const envProtocol = process.env.CHROMA_SERVER_PROTOCOL;
      if (envProtocol && VALID_PROTOCOLS.includes(envProtocol)) {
        this.serverProtocol = envProtocol;
      }

      const envHost = process.env.CHROMA_SERVER_HOST;
      // Validate hostname format (RFC 1123 compliant)
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
        logger.warn(
          '[ChromaDB] Invalid hostname format in CHROMA_SERVER_HOST:',
          envHost,
        );
      }

      const envPort = Number(process.env.CHROMA_SERVER_PORT);
      if (
        !isNaN(envPort) &&
        envPort >= MIN_PORT_NUMBER &&
        envPort <= MAX_PORT_NUMBER
      ) {
        this.serverPort = envPort;
      }

      this.serverUrl = `${this.serverProtocol}://${this.serverHost}:${this.serverPort}`;
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
   * Check if ChromaDB connection is healthy
   * @returns {boolean} true if healthy, false otherwise
   */
  async checkHealth() {
    try {
      // CRITICAL FIX: Use HTTP endpoint directly for health check instead of client.heartbeat()
      // which may fail due to connection state issues
      const axios = require('axios');
      const baseUrl = this.serverUrl;

      // Try multiple endpoints for compatibility with different ChromaDB versions
      const endpoints = [
        '/api/v2/heartbeat', // v2 endpoint (current version)
        '/api/v1/heartbeat', // v1 endpoint (ChromaDB 1.0.x)
        '/api/v1', // Some versions just have this
      ];

      for (const endpoint of endpoints) {
        try {
          const response = await axios.get(`${baseUrl}${endpoint}`, {
            timeout: 2000,
            validateStatus: () => true, // Accept any status code for checking
          });

          if (response.status === 200) {
            // Validate response data
            if (response.data) {
              // Check for error responses
              if (typeof response.data === 'object' && response.data.error) {
                logger.debug(
                  `[ChromaDB] Health check endpoint ${endpoint} returned error: ${response.data.error}`,
                );
                continue;
              }

              // Check for valid heartbeat response
              if (
                response.data.nanosecond_heartbeat !== undefined ||
                response.data['nanosecond heartbeat'] !== undefined ||
                response.data.status === 'ok' ||
                response.data.version
              ) {
                logger.debug(
                  `[ChromaDB] Health check successful on ${endpoint}`,
                );
                return true;
              }
            }

            // If we got a 200 with no specific error, consider it healthy
            logger.debug(
              `[ChromaDB] Health check successful (generic 200) on ${endpoint}`,
            );
            return true;
          }
        } catch (error) {
          // Continue to next endpoint
          logger.debug(
            `[ChromaDB] Health check failed on ${endpoint}: ${error.message}`,
          );
        }
      }

      // If none of the endpoints worked, try the client heartbeat as fallback
      if (this.client) {
        try {
          const response = await this.client.heartbeat();
          const isHealthy =
            response &&
            (response.nanosecond_heartbeat > 0 ||
              response['nanosecond heartbeat'] > 0);
          if (isHealthy) {
            logger.debug(
              '[ChromaDB] Health check successful via client.heartbeat()',
            );
          }
          return isHealthy;
        } catch (error) {
          logger.debug('[ChromaDB] Client heartbeat failed:', error.message);
        }
      }

      return false;
    } catch (error) {
      logger.debug('[ChromaDB] Health check failed:', error.message);
      return false;
    }
  }

  async initialize() {
    // Fixed: Use initialization promise to prevent race conditions
    // If initialization is already in progress, wait for it
    if (this._initPromise) {
      return this._initPromise;
    }

    // PERFORMANCE FIX: Check health before assuming initialized
    if (this.initialized) {
      try {
        const isHealthy = await this.checkHealth();
        if (isHealthy) {
          return Promise.resolve();
        }
        // Connection lost, need to reinitialize
        logger.warn('[ChromaDB] Connection lost, reinitializing...');
        this.initialized = false;
        this.client = null;
        this.fileCollection = null;
        this.folderCollection = null;
      } catch (error) {
        // Health check failed, reinitialize
        logger.warn('[ChromaDB] Health check error:', error.message);
        this.initialized = false;
        this.client = null;
      }
    }

    // BUG FIX #6: Atomic flag + promise reference for race condition prevention
    // CRITICAL: If _isInitializing is true, another thread is actively initializing
    // We must wait for that initialization to complete (either success or failure)
    if (this._isInitializing) {
      // Return the existing init promise if available
      if (this._initPromise) {
        return this._initPromise;
      }

      // CRITICAL FIX #2: Enhanced race condition handling with proper timeout
      // This edge case can occur if initialization fails and leaves _isInitializing true
      return new Promise((resolve, reject) => {
        const maxWait = 30000; // Extended to 30 seconds for slow systems
        const checkInterval = 100; // Check every 100ms
        const startTime = Date.now();
        let timeoutId = null; // Track timeout ID for cleanup

        const cleanup = () => {
          if (timeoutId !== null) {
            clearTimeout(timeoutId);
            timeoutId = null;
          }
        };

        const checkStatus = () => {
          // ATOMIC CHECK: Re-check both flags to ensure consistency
          if (!this._isInitializing && this.initialized) {
            // Initialization complete successfully
            cleanup();
            resolve();
          } else if (!this._isInitializing && !this.initialized) {
            // Initialization failed
            cleanup();
            reject(new Error('Previous initialization attempt failed'));
          } else if (Date.now() - startTime > maxWait) {
            // CRITICAL: Clean up flags on timeout to prevent forever-locked state
            this._isInitializing = false;
            this._initPromise = null;
            this.initialized = false;
            cleanup();
            reject(
              new Error(
                'Initialization timeout after 30 seconds - flags cleaned up',
              ),
            );
          } else {
            // Continue checking with recursive setTimeout
            timeoutId = setTimeout(checkStatus, checkInterval);
            // Allow process to exit even if this timeout is pending
            if (timeoutId.unref) {
              timeoutId.unref();
            }
          }
        };

        // Start the recursive check
        checkStatus();
      });
    }

    // ATOMIC OPERATION: Set both flags before starting async work
    // This ensures concurrent calls will wait for this initialization
    this._isInitializing = true;

    // Create initialization promise that concurrent calls can wait on
    this._initPromise = (async () => {
      try {
        await this.ensureDbDirectory();

        // Initialize ChromaDB client with configured server
        this.client = new ChromaClient({
          path: this.serverUrl,
        });

        // Create or get collections for files and folders
        // Files collection stores document embeddings
        this.fileCollection = await this.client.getOrCreateCollection({
          name: 'file_embeddings',
          metadata: {
            description:
              'Document and image file embeddings for semantic search',
            hnsw_space: 'cosine',
          },
        });

        // Folders collection stores smart folder embeddings
        this.folderCollection = await this.client.getOrCreateCollection({
          name: 'folder_embeddings',
          metadata: {
            description: 'Smart folder embeddings for categorization',
            hnsw_space: 'cosine',
          },
        });

        // HIGH PRIORITY FIX #7: Use atomic flag update pattern with proper ordering
        // Update flags in correct order to prevent race conditions
        // 1. First mark as initialized (allows operations to proceed)
        // 2. Then clear the initializing flag (allows new init attempts)
        // This ordering ensures no window where both are false
        this.initialized = true;
        // Memory barrier - ensure initialized is set before clearing lock
        process.nextTick(() => {
          this._isInitializing = false; // Clear lock flag after initialization is visible
        });

        logger.info('[ChromaDB] Successfully initialized vector database', {
          dbPath: this.dbPath,
          serverUrl: this.serverUrl,
          fileCount: await this.fileCollection.count(),
          folderCount: await this.folderCollection.count(),
        });
      } catch (error) {
        // CRITICAL FIX #2b: Enhanced cleanup on initialization failure
        // ATOMIC CLEANUP: Clear both promise and lock on failure
        // This allows retries and prevents permanent deadlock
        this._initPromise = null;
        this._isInitializing = false; // Clear lock flag on failure
        this.initialized = false; // Ensure consistent state

        logger.error('[ChromaDB] Initialization failed:', error);

        // Ensure we always clean up properly even on unexpected errors
        try {
          if (this.fileCollection) this.fileCollection = null;
          if (this.folderCollection) this.folderCollection = null;
          if (this.client) this.client = null;
        } catch (cleanupError) {
          logger.error('[ChromaDB] Error during cleanup:', cleanupError);
        }

        throw new Error(`Failed to initialize ChromaDB: ${error.message}`);
      }
    })();

    return this._initPromise;
  }

  /**
   * Upsert a folder embedding into the database
   * @param {Object} folder - Folder object with id, name, vector, etc.
   */
  async upsertFolder(folder) {
    await this.initialize();

    try {
      if (!folder.id || !folder.vector || !Array.isArray(folder.vector)) {
        throw new Error('Invalid folder data: missing id or vector');
      }

      // Fixed: Sanitize folder metadata
      const metadata = {
        name: folder.name || '',
        description: folder.description || '',
        path: folder.path || '',
        model: folder.model || '',
        updatedAt: folder.updatedAt || new Date().toISOString(),
      };

      const sanitized = sanitizeMetadata(metadata);

      // ChromaDB expects embeddings as arrays
      await this.folderCollection.upsert({
        ids: [folder.id],
        embeddings: [folder.vector],
        metadatas: [sanitized],
        documents: [folder.name || folder.id], // Store name as document for reference
      });

      // Invalidate query cache entries that might reference this folder
      this._invalidateCacheForFolder();

      logger.debug('[ChromaDB] Upserted folder embedding', {
        id: folder.id,
        name: folder.name,
      });
    } catch (error) {
      // ERROR CONTEXT FIX #11: Enhanced error logging with operation context
      logger.error('[ChromaDB] Failed to upsert folder with context:', {
        operation: 'upsert-folder',
        folderId: folder.id,
        folderName: folder.name,
        folderPath: folder.path,
        timestamp: new Date().toISOString(),
        error: error.message,
        errorStack: error.stack,
      });
      throw error;
    }
  }

  /**
   * Batch upsert folder embeddings (optimization for bulk operations)
   * @param {Array<Object>} folders - Array of folder objects
   * @returns {Object} Object with count of successful upserts and array of skipped items
   */
  async batchUpsertFolders(folders) {
    await this.initialize();

    if (!folders || folders.length === 0) {
      return { count: 0, skipped: [] };
    }

    const ids = [];
    const embeddings = [];
    const metadatas = [];
    const documents = [];
    // CRITICAL FIX: Return array of skipped items for better error tracking
    const skipped = [];

    try {
      for (const folder of folders) {
        if (!folder.id || !folder.vector || !Array.isArray(folder.vector)) {
          logger.warn('[ChromaDB] Skipping invalid folder in batch', {
            id: folder.id,
            name: folder.name,
            reason: !folder.id
              ? 'missing_id'
              : !folder.vector
                ? 'missing_vector'
                : 'invalid_vector_type',
          });
          skipped.push({
            folder: { id: folder.id, name: folder.name },
            reason: !folder.id
              ? 'missing_id'
              : !folder.vector
                ? 'missing_vector'
                : 'invalid_vector_type',
          });
          continue;
        }

        const metadata = {
          name: folder.name || '',
          description: folder.description || '',
          path: folder.path || '',
          model: folder.model || '',
          updatedAt: folder.updatedAt || new Date().toISOString(),
        };

        ids.push(folder.id);
        embeddings.push(folder.vector);
        metadatas.push(sanitizeMetadata(metadata));
        documents.push(folder.name || folder.id);
      }

      if (ids.length > 0) {
        await this.folderCollection.upsert({
          ids,
          embeddings,
          metadatas,
          documents,
        });

        // Invalidate cache for all affected folders
        this._invalidateCacheForFolder();

        logger.info('[ChromaDB] Batch upserted folder embeddings', {
          count: ids.length,
          skipped: skipped.length,
        });
      }

      return { count: ids.length, skipped };
    } catch (error) {
      // ERROR CONTEXT FIX #11: Enhanced error logging with batch context
      logger.error('[ChromaDB] Failed to batch upsert folders with context:', {
        operation: 'batch-upsert-folders',
        totalFolders: folders.length,
        successfulCount: ids.length,
        skippedCount: skipped.length,
        timestamp: new Date().toISOString(),
        error: error.message,
        errorStack: error.stack,
      });
      throw error;
    }
  }

  /**
   * Upsert a file embedding into the database
   * @param {Object} file - File object with id, vector, meta, etc.
   */
  async upsertFile(file) {
    await this.initialize();

    try {
      if (!file.id || !file.vector || !Array.isArray(file.vector)) {
        throw new Error('Invalid file data: missing id or vector');
      }

      // Fixed: Sanitize metadata to prevent injection and bloat
      const baseMetadata = {
        path: file.meta?.path || '',
        name: file.meta?.name || '',
        model: file.model || '',
        updatedAt: file.updatedAt || new Date().toISOString(),
      };

      // Merge with sanitized additional metadata (filters dangerous fields)
      const sanitized = sanitizeMetadata({ ...baseMetadata, ...file.meta });

      // ChromaDB expects embeddings as arrays
      await this.fileCollection.upsert({
        ids: [file.id],
        embeddings: [file.vector],
        metadatas: [sanitized],
        documents: [sanitized.path || file.id], // Store sanitized path as document
      });

      // Invalidate query cache entries that might reference this file
      this._invalidateCacheForFile(file.id);

      logger.debug('[ChromaDB] Upserted file embedding', {
        id: file.id,
        path: sanitized.path,
      });
    } catch (error) {
      // ERROR CONTEXT FIX #11: Enhanced error logging with file context
      logger.error('[ChromaDB] Failed to upsert file with context:', {
        operation: 'upsert-file',
        fileId: file.id,
        filePath: file.meta?.path,
        fileName: file.meta?.name,
        timestamp: new Date().toISOString(),
        error: error.message,
        errorStack: error.stack,
      });
      throw error;
    }
  }

  /**
   * Batch upsert file embeddings (optimization for bulk operations)
   * @param {Array<Object>} files - Array of file objects
   * @returns {number} Number of successfully upserted files
   */
  async batchUpsertFiles(files) {
    await this.initialize();

    if (!files || files.length === 0) {
      return 0;
    }

    const ids = [];
    const embeddings = [];
    const metadatas = [];
    const documents = [];

    try {
      for (const file of files) {
        if (!file.id || !file.vector || !Array.isArray(file.vector)) {
          logger.warn('[ChromaDB] Skipping invalid file in batch', {
            id: file.id,
          });
          continue;
        }

        const baseMetadata = {
          path: file.meta?.path || '',
          name: file.meta?.name || '',
          model: file.model || '',
          updatedAt: file.updatedAt || new Date().toISOString(),
        };

        const sanitized = sanitizeMetadata({ ...baseMetadata, ...file.meta });

        ids.push(file.id);
        embeddings.push(file.vector);
        metadatas.push(sanitized);
        documents.push(sanitized.path || file.id);
      }

      if (ids.length > 0) {
        await this.fileCollection.upsert({
          ids,
          embeddings,
          metadatas,
          documents,
        });

        // Invalidate cache for all affected files
        ids.forEach((id) => this._invalidateCacheForFile(id));

        logger.info('[ChromaDB] Batch upserted file embeddings', {
          count: ids.length,
        });
      }

      return ids.length;
    } catch (error) {
      // ERROR CONTEXT FIX #11: Enhanced error logging with batch context
      logger.error('[ChromaDB] Failed to batch upsert files with context:', {
        operation: 'batch-upsert-files',
        totalFiles: files.length,
        successfulCount: ids.length,
        timestamp: new Date().toISOString(),
        error: error.message,
        errorStack: error.stack,
      });
      throw error;
    }
  }

  /**
   * Query folders to find the best matches for a given file
   * @param {string} fileId - The file ID to query
   * @param {number} topK - Number of top results to return
   * @returns {Array} Sorted array of folder matches with scores
   */
  async queryFolders(fileId, topK = 5) {
    await this.initialize();

    // Check cache first
    const cacheKey = `query:folders:${fileId}:${topK}`;
    const cached = this._getCachedQuery(cacheKey);
    if (cached) {
      logger.debug('[ChromaDB] Query cache hit for folders', { fileId });
      return cached;
    }

    // Check for in-flight query and deduplicate
    if (this.inflightQueries.has(cacheKey)) {
      logger.debug('[ChromaDB] Deduplicating in-flight query', { fileId });
      return this.inflightQueries.get(cacheKey);
    }

    // Create query promise and track it
    const queryPromise = this._executeQueryFolders(fileId, topK);
    this.inflightQueries.set(cacheKey, queryPromise);

    try {
      const results = await queryPromise;

      // Cache the results
      this._setCachedQuery(cacheKey, results);

      return results;
    } finally {
      // Remove from in-flight queries
      this.inflightQueries.delete(cacheKey);
    }
  }

  /**
   * Internal method to execute folder query (used by queryFolders)
   * @private
   */
  async _executeQueryFolders(fileId, topK) {
    try {
      // Validate collections are initialized
      if (!this.fileCollection) {
        logger.error('[ChromaDB] File collection not initialized');
        return [];
      }
      if (!this.folderCollection) {
        logger.error('[ChromaDB] Folder collection not initialized');
        return [];
      }

      // CRITICAL FIX: Get file embedding with retry logic for read-after-write consistency
      // Implement exponential backoff: 50ms, 100ms, 200ms
      let fileResult = null;
      let lastError = null;
      const maxRetries = 3;
      const retryDelays = [50, 100, 200]; // Exponential backoff in ms

      for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
          // CRITICAL FIX: Explicitly request embeddings in get() call
          // ChromaDB may not return embeddings by default
          fileResult = await this.fileCollection.get({
            ids: [fileId],
            include: ['embeddings', 'metadatas', 'documents'],
          });

          // DIAGNOSTIC FIX: Log actual response structure for debugging
          if (attempt > 0 || !fileResult?.embeddings?.length) {
            logger.debug('[ChromaDB] File get response:', {
              fileId,
              attempt: attempt + 1,
              hasResult: !!fileResult,
              hasEmbeddings: !!fileResult?.embeddings,
              embeddingsLength: fileResult?.embeddings?.length || 0,
              resultKeys: fileResult ? Object.keys(fileResult) : [],
            });
          }

          // Check if we got valid embeddings
          if (
            fileResult &&
            fileResult.embeddings &&
            fileResult.embeddings.length > 0
          ) {
            if (attempt > 0) {
              logger.info(
                `[ChromaDB] File found on retry attempt ${attempt + 1}/${maxRetries}`,
                fileId,
              );
            }
            break; // Success!
          }

          // No embeddings found, retry if we have attempts left
          if (attempt < maxRetries - 1) {
            const delay = retryDelays[attempt];
            logger.debug(
              `[ChromaDB] File not found on attempt ${attempt + 1}, retrying in ${delay}ms...`,
              fileId,
            );
            await new Promise((resolve) => setTimeout(resolve, delay));
          }
        } catch (error) {
          lastError = error;
          logger.warn(
            `[ChromaDB] Error getting file on attempt ${attempt + 1}:`,
            error.message,
          );
          if (attempt < maxRetries - 1) {
            const delay = retryDelays[attempt];
            await new Promise((resolve) => setTimeout(resolve, delay));
          }
        }
      }

      // Final validation after retries
      if (
        !fileResult ||
        !fileResult.embeddings ||
        fileResult.embeddings.length === 0
      ) {
        logger.warn('[ChromaDB] File not found after retries:', {
          fileId,
          attempts: maxRetries,
          lastError: lastError?.message,
        });
        return [];
      }

      const fileEmbedding = fileResult.embeddings[0];

      // Validate embedding
      if (!Array.isArray(fileEmbedding) || fileEmbedding.length === 0) {
        logger.warn('[ChromaDB] Invalid file embedding:', fileId);
        return [];
      }

      // Query the folder collection for similar embeddings
      const results = await this.folderCollection.query({
        queryEmbeddings: [fileEmbedding],
        nResults: topK,
      });

      // Fixed: Comprehensive validation to prevent array access errors
      if (
        !results ||
        !results.ids ||
        !Array.isArray(results.ids) ||
        results.ids.length === 0 ||
        !Array.isArray(results.ids[0]) ||
        results.ids[0].length === 0
      ) {
        logger.debug('[ChromaDB] No matching folders found for file:', fileId);
        return [];
      }

      // Validate distances array structure
      if (
        !results.distances ||
        !Array.isArray(results.distances) ||
        results.distances.length === 0 ||
        !Array.isArray(results.distances[0])
      ) {
        logger.warn('[ChromaDB] Invalid distances structure in query results');
        return [];
      }

      // HIGH PRIORITY FIX #4: Add comprehensive bounds checking before accessing array indices
      // Validate that all arrays have matching structure
      if (
        !results.ids ||
        !Array.isArray(results.ids) ||
        results.ids.length === 0 ||
        !Array.isArray(results.ids[0]) ||
        results.ids[0].length === 0
      ) {
        logger.warn(
          '[ChromaDB] Invalid or empty ids structure in query results',
        );
        return [];
      }

      // Format results to match expected interface
      const matches = [];
      const idsArray = results.ids[0];
      const distancesArray = results.distances[0];
      const metadatasArray = results.metadatas?.[0] || [];

      // HIGH PRIORITY FIX #4: Ensure arrays have matching lengths to prevent out-of-bounds access
      const resultCount = Math.min(idsArray.length, distancesArray.length);

      for (let i = 0; i < resultCount; i++) {
        const folderId = idsArray[i];
        const distance = distancesArray[i];
        const metadata = metadatasArray[i];

        // Validate required fields
        if (!folderId || distance === undefined) {
          logger.warn('[ChromaDB] Incomplete query result, skipping entry');
          continue;
        }

        // Convert distance to similarity score (1 - distance for cosine)
        // ChromaDB returns distances where 0 = identical, 2 = opposite
        const score = Math.max(0, 1 - distance / 2);

        matches.push({
          folderId,
          name: metadata?.name || folderId,
          score,
          description: metadata?.description,
          path: metadata?.path,
        });
      }

      return matches.sort((a, b) => b.score - a.score);
    } catch (error) {
      logger.error('[ChromaDB] Failed to query folders:', error);
      return [];
    }
  }

  /**
   * Query files for similarity search
   * @param {Array} queryEmbedding - The embedding vector to search for
   * @param {number} topK - Number of results to return
   * @returns {Array} Similar files with scores
   */
  async querySimilarFiles(queryEmbedding, topK = 10) {
    await this.initialize();

    try {
      const results = await this.fileCollection.query({
        queryEmbeddings: [queryEmbedding],
        nResults: topK,
      });

      if (!results.ids || results.ids[0].length === 0) {
        return [];
      }

      const matches = [];
      for (let i = 0; i < results.ids[0].length; i++) {
        const distance = results.distances[0][i];
        const metadata = results.metadatas[0][i];

        // Convert distance to similarity score
        const score = Math.max(0, 1 - distance / 2);

        matches.push({
          id: results.ids[0][i],
          score,
          metadata,
          document: results.documents[0][i],
        });
      }

      return matches.sort((a, b) => b.score - a.score);
    } catch (error) {
      logger.error('[ChromaDB] Failed to query similar files:', error);
      return [];
    }
  }

  /**
   * Get all folder embeddings
   */
  async getAllFolders() {
    await this.initialize();

    try {
      // ChromaDB's get() without parameters returns all items
      const result = await this.folderCollection.get({});

      const folders = [];
      if (result.ids) {
        for (let i = 0; i < result.ids.length; i++) {
          folders.push({
            id: result.ids[i],
            name: result.metadatas[i]?.name || result.ids[i],
            vector: result.embeddings[i],
            metadata: result.metadatas[i],
          });
        }
      }

      return folders;
    } catch (error) {
      logger.error('[ChromaDB] Failed to get all folders:', error);
      return [];
    }
  }

  /**
   * Reset all file embeddings
   */
  async resetFiles() {
    await this.initialize();

    try {
      // Delete and recreate the collection
      await this.client.deleteCollection({ name: 'file_embeddings' });

      this.fileCollection = await this.client.createCollection({
        name: 'file_embeddings',
        metadata: {
          description: 'Document and image file embeddings for semantic search',
          hnsw_space: 'cosine',
        },
      });

      logger.info('[ChromaDB] Reset file embeddings collection');
    } catch (error) {
      logger.error('[ChromaDB] Failed to reset files:', error);
      throw error;
    }
  }

  /**
   * Reset all folder embeddings
   */
  async resetFolders() {
    await this.initialize();

    try {
      // Delete and recreate the collection
      await this.client.deleteCollection({ name: 'folder_embeddings' });

      this.folderCollection = await this.client.createCollection({
        name: 'folder_embeddings',
        metadata: {
          description: 'Smart folder embeddings for categorization',
          hnsw_space: 'cosine',
        },
      });

      logger.info('[ChromaDB] Reset folder embeddings collection');
    } catch (error) {
      logger.error('[ChromaDB] Failed to reset folders:', error);
      throw error;
    }
  }

  /**
   * Reset all embeddings (both files and folders)
   */
  async resetAll() {
    await this.resetFiles();
    await this.resetFolders();
  }

  /**
   * Migrate from old JSONL format to ChromaDB
   * @param {string} jsonlPath - Path to JSONL file
   * @param {string} type - 'file' or 'folder'
   */
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
              // Correctly pass the file object to upsertFile
              await this.upsertFile({
                id: obj.id,
                vector: obj.vector,
                meta: obj.meta || {},
              });
            }
            migrated++;
            logger.debug('[ChromaDB] Migrated entry:', obj.id);
          }
        } catch (error) {
          logger.warn('[ChromaDB] Failed to migrate line:', error.message);
        }
      }

      logger.info(
        `[ChromaDB] Migrated ${migrated} ${type} embeddings from JSONL`,
      );
      return migrated;
    } catch (error) {
      if (error.code === 'ENOENT') {
        logger.info(
          `[ChromaDB] No existing JSONL file to migrate: ${jsonlPath}`,
        );
        return 0;
      }
      logger.error('[ChromaDB] Migration failed:', error);
      throw error;
    }
  }

  /**
   * Get collection statistics (including query cache metrics)
   */
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
        queryCache: this.getQueryCacheStats(),
        inflightQueries: this.inflightQueries.size,
      };
    } catch (error) {
      logger.error('[ChromaDB] Failed to get stats:', error);
      return {
        files: 0,
        folders: 0,
        dbPath: this.dbPath,
        serverUrl: this.serverUrl,
        initialized: false,
        queryCache: this.getQueryCacheStats(),
        inflightQueries: 0,
        error: error.message,
      };
    }
  }

  /**
   * Cache management: Get cached query result
   * @private
   */
  _getCachedQuery(key) {
    const cached = this.queryCache.get(key);
    if (!cached) {
      return null;
    }

    // Check if cache entry has expired
    if (Date.now() - cached.timestamp > this.queryCacheTTL) {
      this.queryCache.delete(key);
      return null;
    }

    return cached.data;
  }

  /**
   * Cache management: Set cached query result
   * FIXED Bug #31: Proper LRU eviction with Map
   * @private
   */
  _setCachedQuery(key, data) {
    // If key already exists, delete it first to update its position (LRU behavior)
    if (this.queryCache.has(key)) {
      this.queryCache.delete(key);
    }

    // Evict oldest entry if cache is at capacity (Map maintains insertion order)
    if (this.queryCache.size >= this.maxCacheSize) {
      const oldestKey = this.queryCache.keys().next().value;
      if (oldestKey) {
        this.queryCache.delete(oldestKey);
      }
    }

    // Add new entry (will be at the end of iteration order)
    this.queryCache.set(key, {
      data,
      timestamp: Date.now(),
    });
  }

  /**
   * Cache invalidation: Remove cache entries for a specific file
   * Optimized to delete directly during iteration (single pass)
   * @private
   */
  _invalidateCacheForFile(fileId) {
    // Optimization: Delete directly during iteration instead of creating array first
    // This reduces memory allocation and makes it a true single-pass operation
    for (const key of this.queryCache.keys()) {
      if (key.includes(fileId)) {
        this.queryCache.delete(key);
      }
    }
  }

  /**
   * Cache invalidation: Remove cache entries that might reference a folder
   * Optimized to delete directly during iteration (single pass)
   * @private
   */
  _invalidateCacheForFolder() {
    // Optimization: Delete directly during iteration instead of creating array first
    // This reduces memory allocation and makes it a true single-pass operation
    for (const key of this.queryCache.keys()) {
      if (key.startsWith('query:folders:')) {
        this.queryCache.delete(key);
      }
    }
  }

  /**
   * Clear all query cache
   */
  clearQueryCache() {
    const size = this.queryCache.size;
    this.queryCache.clear();
    logger.info('[ChromaDB] Query cache cleared', { entriesCleared: size });
  }

  /**
   * Get query cache statistics
   */
  getQueryCacheStats() {
    return {
      size: this.queryCache.size,
      maxSize: this.maxCacheSize,
      ttlMs: this.queryCacheTTL,
    };
  }

  /**
   * Cleanup and close connections
   * FIXED Bug #38: Wait for pending operations before cleanup
   */
  async cleanup() {
    if (this.client) {
      // Clear batch insert timer if active
      if (this.batchInsertTimer) {
        clearTimeout(this.batchInsertTimer);
        this.batchInsertTimer = null;
      }

      // FIXED Bug #38: Wait for all in-flight queries to complete
      if (this.inflightQueries.size > 0) {
        logger.info(
          `[ChromaDB] Waiting for ${this.inflightQueries.size} in-flight queries to complete...`,
        );
        try {
          // Wait for all in-flight queries with a timeout
          await Promise.race([
            Promise.allSettled(Array.from(this.inflightQueries.values())),
            (() => {
              const { TIMEOUTS } = require('../../shared/performanceConstants');
              return new Promise((resolve) =>
                setTimeout(resolve, TIMEOUTS.HEALTH_CHECK),
              );
            })(), // 5 second timeout
          ]);
        } catch (error) {
          logger.warn(
            '[ChromaDB] Error waiting for in-flight queries:',
            error.message,
          );
        }
      }

      // Clear caches
      this.queryCache.clear();
      this.inflightQueries.clear();

      // ChromaDB client doesn't require explicit cleanup in JS
      // but we'll reset our references
      this.fileCollection = null;
      this.folderCollection = null;
      this.client = null;
      this.initialized = false;
      logger.info('[ChromaDB] Cleaned up connections');
    }
  }

  /**
   * Check if ChromaDB server is running and available
   * FIXED Bug #30: Add exponential backoff retry for network failures
   * @param {number} timeoutMs - Timeout in milliseconds (default: 3000)
   * @param {number} maxRetries - Maximum retry attempts (default: 3)
   * @returns {Promise<boolean>}
   */
  async isServerAvailable(timeoutMs = 3000, maxRetries = 3) {
    let lastError = null;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        // PERFORMANCE FIX: Reuse existing client if available to avoid creating
        // disposable ChromaClient instances that create TIME_WAIT connections
        const client =
          this.client ||
          new ChromaClient({
            path: this.serverUrl,
          });

        // Wrap heartbeat in Promise.race with timeout (reduced from 10s to 3s)
        const heartbeatPromise = client.heartbeat();
        const timeoutPromise = new Promise((_, reject) => {
          setTimeout(() => {
            reject(new Error(`Heartbeat timeout after ${timeoutMs}ms`));
          }, timeoutMs);
        });

        const hb = await Promise.race([heartbeatPromise, timeoutPromise]);

        logger.debug('[ChromaDB] Server heartbeat successful:', {
          hb,
          serverUrl: this.serverUrl,
          attempt: attempt + 1,
        });
        return true;
      } catch (error) {
        lastError = error;

        // Distinguish between timeout and connection failures
        const isTimeout = error.message && error.message.includes('timeout');
        const isNetworkError =
          error.code === 'ECONNREFUSED' ||
          error.code === 'ETIMEDOUT' ||
          error.code === 'ENOTFOUND';

        // Only retry on transient errors (network issues, timeouts)
        const shouldRetry =
          (isTimeout || isNetworkError) && attempt < maxRetries - 1;

        if (shouldRetry) {
          // Exponential backoff: 500ms, 1000ms, 2000ms
          const delay = 500 * Math.pow(2, attempt);
          logger.debug('[ChromaDB] Server heartbeat failed, retrying...:', {
            attempt: attempt + 1,
            maxRetries,
            delayMs: delay,
            error: error.message,
            serverUrl: this.serverUrl,
          });
          await new Promise((resolve) => setTimeout(resolve, delay));
        } else {
          // Non-retriable error or final attempt
          if (isTimeout) {
            logger.debug('[ChromaDB] Server heartbeat timed out:', {
              timeoutMs,
              serverUrl: this.serverUrl,
              attempt: attempt + 1,
            });
          } else {
            logger.debug('[ChromaDB] Server heartbeat failed:', {
              message: error.message,
              serverUrl: this.serverUrl,
              attempt: attempt + 1,
            });
          }
        }
      }
    }

    // All retries exhausted
    logger.warn(
      '[ChromaDB] Server availability check failed after all retries:',
      {
        maxRetries,
        lastError: lastError?.message,
      },
    );
    return false;
  }

  getServerConfig() {
    return {
      host: this.serverHost,
      port: this.serverPort,
      protocol: this.serverProtocol,
      url: this.serverUrl,
      dbPath: this.dbPath,
    };
  }
}

// Export as singleton to maintain single database connection
let instance = null;

module.exports = {
  ChromaDBService,
  getInstance: () => {
    if (!instance) {
      instance = new ChromaDBService();
    }
    return instance;
  },
};
