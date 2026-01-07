const path = require('path');
const { getInstance: getChromaDB } = require('../services/chromadb');
const { getInstance: getFolderMatcher } = require('../services/FolderMatchingService');
const {
  getInstance: getParallelEmbeddingService
} = require('../services/ParallelEmbeddingService');
const { SearchService } = require('../services/SearchService');
const { ClusteringService } = require('../services/ClusteringService');
const { SUPPORTED_IMAGE_EXTENSIONS, AI_DEFAULTS } = require('../../shared/constants');
const {
  BATCH,
  TIMEOUTS,
  LIMITS,
  SEARCH,
  THRESHOLDS,
  CHUNKING
} = require('../../shared/performanceConstants');
const { withErrorLogging, withChromaInit, safeHandle } = require('./ipcWrappers');
const { cosineSimilarity } = require('../../shared/vectorMath');
const { getOllamaEmbeddingModel, getOllama } = require('../ollamaUtils');
const { chunkText } = require('../utils/textChunking');
const {
  readEmbeddingIndexMetadata,
  writeEmbeddingIndexMetadata
} = require('../services/chromadb/embeddingIndexMetadata');

/**
 * Verify embedding model is available in Ollama
 * @param {Object} logger - Logger instance
 * @returns {Promise<{available: boolean, model: string, error?: string}>}
 */
async function verifyEmbeddingModelAvailable(logger) {
  const model = getOllamaEmbeddingModel() || AI_DEFAULTS.EMBEDDING.MODEL;

  try {
    const ollama = getOllama();
    const response = await ollama.list();
    const models = response?.models || [];

    // Check if the configured model (or a variant) is installed
    const modelNames = models.map((m) => m.name?.toLowerCase() || '');
    const normalizedModel = model.toLowerCase();

    // Check for exact match or prefix match (e.g., "embeddinggemma:latest" matches "embeddinggemma")
    const isAvailable = modelNames.some(
      (name) =>
        name === normalizedModel ||
        name.startsWith(`${normalizedModel}:`) ||
        normalizedModel.startsWith(name.split(':')[0])
    );

    if (!isAvailable) {
      // Try fallback models
      const fallbackModels = AI_DEFAULTS.EMBEDDING.FALLBACK_MODELS || [];
      for (const fallback of fallbackModels) {
        const normalizedFallback = fallback.toLowerCase();
        const fallbackAvailable = modelNames.some(
          (name) =>
            name === normalizedFallback ||
            name.startsWith(`${normalizedFallback}:`) ||
            normalizedFallback.startsWith(name.split(':')[0])
        );
        if (fallbackAvailable) {
          logger.info('[EMBEDDINGS] Primary model not found, using fallback', {
            primary: model,
            fallback,
            availableModels: modelNames.slice(0, 10)
          });
          return { available: true, model: fallback };
        }
      }

      logger.error('[EMBEDDINGS] No embedding model available', {
        configured: model,
        fallbacks: fallbackModels,
        availableModels: modelNames.slice(0, 10)
      });

      return {
        available: false,
        model,
        error: `Embedding model "${model}" not installed. Install it with: ollama pull ${model}`,
        availableModels: modelNames.slice(0, 10)
      };
    }

    return { available: true, model };
  } catch (error) {
    logger.error('[EMBEDDINGS] Failed to verify embedding model:', error.message);
    return {
      available: false,
      model,
      error: `Cannot connect to Ollama: ${error.message}. Make sure Ollama is running.`
    };
  }
}

// Module-level reference to SearchService for cross-module access
let _searchServiceRef = null;

// Module-level reference to ClusteringService for cross-module access
let _clusteringServiceRef = null;

/**
 * Get the SearchService instance (if initialized)
 * Used by fileOperationHandlers to invalidate index after file moves
 * @returns {SearchService|null}
 */
function getSearchServiceInstance() {
  return _searchServiceRef;
}

/**
 * Set the SearchService instance reference
 * Called internally after initialization
 * @param {SearchService} service
 */
function setSearchServiceInstance(service) {
  _searchServiceRef = service;
}

/**
 * Get the ClusteringService instance (if initialized)
 * Used by fileOperationHandlers to invalidate clusters after file moves/deletes
 * @returns {ClusteringService|null}
 */
function getClusteringServiceInstance() {
  return _clusteringServiceRef;
}

/**
 * Set the ClusteringService instance reference
 * Called internally after initialization
 * @param {ClusteringService} service
 */
function setClusteringServiceInstance(service) {
  _clusteringServiceRef = service;
}

function registerEmbeddingsIpc({
  ipcMain,
  IPC_CHANNELS,
  logger,
  getCustomFolders,
  getServiceIntegration
}) {
  // Use ChromaDB and FolderMatcher singleton instances
  // FIX: Use singleton pattern instead of creating duplicate instance
  const chromaDbService = getChromaDB();
  const folderMatcher = getFolderMatcher();

  // SearchService will be initialized lazily when needed
  let searchService = null;
  let clusteringService = null;
  // FIX P0-1: Promise-based waiting for concurrent initialization
  // Uses promises to allow concurrent callers to wait instead of throwing
  let searchServicePromise = null;
  let clusteringServicePromise = null;

  /**
   * Gets or initializes the SearchService.
   * Uses promise-based waiting to handle concurrent initialization requests.
   * @returns {SearchService|Promise<SearchService>} The service instance or a promise that resolves to it
   */
  function getSearchService() {
    // Fast path: already initialized
    if (searchService) return searchService;

    // If initialization in progress, return existing promise for concurrent callers to await
    if (searchServicePromise) {
      return searchServicePromise;
    }

    // Start initialization - create promise for concurrent callers
    searchServicePromise = (async () => {
      try {
        // Double-check after acquiring mutex (another call may have completed)
        if (searchService) {
          return searchService;
        }

        const serviceIntegration = getServiceIntegration && getServiceIntegration();
        const historyService = serviceIntegration?.analysisHistory;
        const embeddingService = getParallelEmbeddingService();

        if (!historyService) {
          throw new Error(
            'SearchService unavailable: AnalysisHistoryService not initialized (ServiceIntegration missing)'
          );
        }
        if (!embeddingService) {
          throw new Error('SearchService unavailable: ParallelEmbeddingService not available');
        }

        searchService = new SearchService({
          chromaDbService,
          analysisHistoryService: historyService,
          parallelEmbeddingService: embeddingService
        });

        // Store reference for cross-module access (e.g., fileOperationHandlers)
        setSearchServiceInstance(searchService);
        return searchService;
      } finally {
        // Clear promise after completion to allow retry on failure
        searchServicePromise = null;
      }
    })();

    return searchServicePromise;
  }

  /**
   * Gets or initializes the ClusteringService.
   * Uses promise-based waiting to handle concurrent initialization requests.
   * @returns {ClusteringService|Promise<ClusteringService>} The service instance or a promise that resolves to it
   */
  function getClusteringService() {
    // Fast path: already initialized
    if (clusteringService) return clusteringService;

    // If initialization in progress, return existing promise for concurrent callers to await
    if (clusteringServicePromise) {
      return clusteringServicePromise;
    }

    // Start initialization - create promise for concurrent callers
    clusteringServicePromise = (async () => {
      try {
        // Double-check after acquiring mutex (another call may have completed)
        if (clusteringService) {
          return clusteringService;
        }

        const serviceIntegration = getServiceIntegration && getServiceIntegration();
        const ollamaService = serviceIntegration?.ollamaService;

        clusteringService = new ClusteringService({
          chromaDbService,
          ollamaService
        });
        // Store reference for cross-module access (e.g., fileOperationHandlers)
        setClusteringServiceInstance(clusteringService);
        return clusteringService;
      } finally {
        // Clear promise after completion to allow retry on failure
        clusteringServicePromise = null;
      }
    })();

    return clusteringServicePromise;
  }

  // CRITICAL FIX: Use proper state machine to prevent race conditions
  // State machine prevents concurrent re-initialization attempts
  const INIT_STATES = {
    PENDING: 'pending',
    IN_PROGRESS: 'in_progress',
    COMPLETED: 'completed',
    FAILED: 'failed'
  };

  let initState = INIT_STATES.PENDING;
  let initPromise = null;
  // FIX: Add mutex flag to prevent race conditions during state transitions
  let initMutexLocked = false;

  /**
   * Ensures services are initialized before IPC handlers execute
   * FIX: Uses state machine with mutex to prevent race conditions during initialization
   * @returns {Promise<void>}
   */
  async function ensureInitialized() {
    // Already initialized successfully
    if (initState === INIT_STATES.COMPLETED) {
      return Promise.resolve();
    }

    // Initialization in progress - wait for it
    if (initState === INIT_STATES.IN_PROGRESS && initPromise) {
      return initPromise;
    }

    // FIX: Use mutex to prevent race condition during FAILED -> IN_PROGRESS transition
    // This ensures only one caller can reset and start a new initialization
    // FIX P0-2: Add max wait time to prevent infinite recursion
    if (initMutexLocked) {
      // Another caller is handling the state transition, wait with timeout
      const maxWaitMs = 30000; // 30 second max wait
      const startWait = Date.now();
      while (initMutexLocked && Date.now() - startWait < maxWaitMs) {
        await new Promise((resolve) => setTimeout(resolve, 50));
        // Check if initialization completed while waiting
        if (initState === INIT_STATES.COMPLETED) {
          return Promise.resolve();
        }
        if (initState === INIT_STATES.IN_PROGRESS && initPromise) {
          return initPromise;
        }
      }
      if (initMutexLocked) {
        throw new Error('Initialization mutex timeout - possible deadlock detected');
      }
    }

    // Acquire mutex for state transition
    initMutexLocked = true;

    try {
      // Double-check state after acquiring mutex (another caller may have completed)
      if (initState === INIT_STATES.COMPLETED) {
        return Promise.resolve();
      }

      if (initState === INIT_STATES.IN_PROGRESS && initPromise) {
        return initPromise;
      }

      // Previously failed - allow retry by resetting state
      if (initState === INIT_STATES.FAILED) {
        logger.info('[SEMANTIC] Previous initialization failed, retrying...');
      }

      // Start new initialization - atomically set both state and promise
      initState = INIT_STATES.IN_PROGRESS;

      initPromise = (async () => {
        const MAX_RETRIES = 5;
        const RETRY_DELAY_BASE = 2000; // 2 seconds base delay

        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
          try {
            logger.info(
              `[SEMANTIC] Starting initialization (attempt ${attempt}/${MAX_RETRIES})...`
            );

            // FIX: Check if ChromaDB server is available before initializing
            const isServerReady = await chromaDbService.isServerAvailable(3000);
            if (!isServerReady) {
              throw new Error('ChromaDB server is not available yet');
            }

            // Initialize ChromaDB first
            await chromaDbService.initialize();

            // CRITICAL FIX: MUST await FolderMatchingService initialization
            await folderMatcher.initialize();

            // Attempt to migrate existing JSONL data if present
            const { app } = require('electron');
            const basePath = path.join(app.getPath('userData'), 'embeddings');
            const filesPath = path.join(basePath, 'file-embeddings.jsonl');
            const foldersPath = path.join(basePath, 'folder-embeddings.jsonl');

            const filesMigrated = await chromaDbService.migrateFromJsonl(filesPath, 'file');
            const foldersMigrated = await chromaDbService.migrateFromJsonl(foldersPath, 'folder');

            if (filesMigrated > 0 || foldersMigrated > 0) {
              logger.info('[SEMANTIC] Migration complete', {
                files: filesMigrated,
                folders: foldersMigrated
              });
            }

            logger.info('[SEMANTIC] Initialization complete');
            initState = INIT_STATES.COMPLETED;

            // Warm up search service in background (non-blocking)
            // This pre-builds the BM25 index for faster first search
            setImmediate(async () => {
              try {
                const searchSvc = await getSearchService();
                await searchSvc.warmUp({ buildBM25: true, warmChroma: false });
              } catch (warmErr) {
                logger.debug('[SEMANTIC] Search warm-up skipped:', warmErr.message);
              }
            });

            return; // Success - exit retry loop
          } catch (error) {
            logger.warn(`[SEMANTIC] Initialization attempt ${attempt} failed:`, error.message);

            if (attempt < MAX_RETRIES) {
              // Exponential backoff with jitter
              const delay = RETRY_DELAY_BASE * 2 ** (attempt - 1) + Math.random() * 1000;
              logger.info(`[SEMANTIC] Retrying in ${Math.round(delay)}ms...`);
              await new Promise((resolve) => {
                const timeoutId = setTimeout(resolve, delay);
                // Prevent timer from keeping process alive
                if (timeoutId && typeof timeoutId.unref === 'function') {
                  timeoutId.unref();
                }
              });
            } else {
              logger.error(
                '[SEMANTIC] All initialization attempts failed. ChromaDB features will be unavailable.'
              );
              initState = INIT_STATES.FAILED;
              // Don't throw - allow the app to continue in degraded mode
              return;
            }
          }
        }
      })();
    } finally {
      // FIX: Release mutex after promise is created
      // The promise will continue to run, but other callers can now wait on it
      initMutexLocked = false;
    }

    return initPromise;
  }

  // FIX: Removed arbitrary setTimeout - handlers now trigger initialization on-demand
  // with proper retry logic and exponential backoff in ensureInitialized().
  // This eliminates the race condition where users interact before the 5s delay.
  // Each handler calls ensureInitialized() which has built-in retry with backoff.
  //
  // Start background initialization after a shorter delay to pre-warm the service
  // but handlers will work correctly even if called before this completes.
  setImmediate(() => {
    // Use setImmediate to ensure IPC handlers are registered first
    setTimeout(() => {
      ensureInitialized().catch((error) => {
        logger.warn('[SEMANTIC] Background pre-warm failed (non-fatal):', error.message);
        // Non-fatal - handlers will retry with proper backoff when called
      });
    }, 1000); // 1 second delay for pre-warming, handlers use retries if called earlier
  });

  // Helper config for handlers that need ChromaDB initialization
  const chromaInitConfig = {
    ensureInit: ensureInitialized,
    isInitRef: () => initState === INIT_STATES.COMPLETED,
    logger
  };

  // Factory to create handlers with both error logging and chroma init
  const createChromaHandler = (handler) =>
    withErrorLogging(logger, withChromaInit({ ...chromaInitConfig, handler }));

  /**
   * Rebuild folder embeddings from current smart folders
   * SAFE: Only resets the 'folder_embeddings' collection (not the entire DB directory).
   * This is a user-controlled, intentional rebuild that preserves all other data.
   */
  safeHandle(
    ipcMain,
    IPC_CHANNELS.EMBEDDINGS.REBUILD_FOLDERS,
    createChromaHandler(async () => {
      try {
        // FIX: Verify embedding model is available before starting
        const modelCheck = await verifyEmbeddingModelAvailable(logger);
        if (!modelCheck.available) {
          return {
            success: false,
            error: modelCheck.error,
            errorCode: 'MODEL_NOT_AVAILABLE',
            model: modelCheck.model,
            availableModels: modelCheck.availableModels
          };
        }

        const smartFolders = getCustomFolders().filter((f) => f && f.name);

        if (smartFolders.length === 0) {
          return {
            success: true,
            folders: 0,
            message: 'No smart folders to embed'
          };
        }

        // SAFE: resetFolders() only deletes/recreates the collection, not the DB directory
        await chromaDbService.resetFolders();

        // Track successes and failures
        const results = { success: 0, failed: 0, errors: [] };

        // Process folder embeddings with error tracking
        const folderPayloads = await Promise.all(
          smartFolders.map(async (folder) => {
            try {
              const folderText = [folder.name, folder.description].filter(Boolean).join(' - ');

              const { vector, model } = await folderMatcher.embedText(folderText);
              const folderId = folder.id || folderMatcher.generateFolderId(folder);

              results.success++;
              return {
                id: folderId,
                name: folder.name,
                description: folder.description || '',
                path: folder.path || '',
                vector,
                model,
                updatedAt: new Date().toISOString()
              };
            } catch (error) {
              results.failed++;
              results.errors.push({
                folder: folder.name,
                error: error.message
              });
              logger.warn(
                '[EMBEDDINGS] Failed to generate folder embedding:',
                folder.name,
                error.message
              );
              return null;
            }
          })
        );

        const validPayloads = folderPayloads.filter((p) => p !== null);

        // Only upsert if we have valid payloads
        let upsertedCount = 0;
        if (validPayloads.length > 0) {
          upsertedCount = await chromaDbService.batchUpsertFolders(validPayloads);
        }

        // Record which model/dimensions were used for the index (for UI mismatch warnings)
        try {
          const probe = validPayloads[0];
          const dims = Array.isArray(probe?.vector) ? probe.vector.length : null;
          if (Number.isFinite(dims) && dims > 0) {
            await writeEmbeddingIndexMetadata({
              model: probe?.model || modelCheck.model,
              dims,
              source: 'rebuild-folders'
            });
          }
        } catch {
          // Non-fatal
        }

        // Return detailed status
        const allFailed = results.success === 0 && results.failed > 0;
        return {
          success: !allFailed,
          folders: upsertedCount,
          total: smartFolders.length,
          succeeded: results.success,
          failed: results.failed,
          errors: results.errors.slice(0, 5), // Limit error details
          model: modelCheck.model,
          message: allFailed
            ? `All ${results.failed} folder embeddings failed. Check Ollama connection.`
            : results.failed > 0
              ? `${results.success} folders embedded, ${results.failed} failed`
              : `Successfully embedded ${results.success} folders`
        };
      } catch (e) {
        logger.error('[EMBEDDINGS] Rebuild folders failed:', e);
        return {
          success: false,
          error: e.message,
          errorCode: e.code || 'REBUILD_FAILED'
        };
      }
    })
  );

  /**
   * Rebuild file embeddings from analysis history
   * SAFE: Only resets the 'file_embeddings' collection (not the entire DB directory).
   * This rebuilds the semantic search index from existing analysis history without
   * re-analyzing files. User-controlled and intentional.
   */
  safeHandle(
    ipcMain,
    IPC_CHANNELS.EMBEDDINGS.REBUILD_FILES,
    createChromaHandler(async () => {
      try {
        // FIX: Verify embedding model is available before starting
        const modelCheck = await verifyEmbeddingModelAvailable(logger);
        if (!modelCheck.available) {
          return {
            success: false,
            error: modelCheck.error,
            errorCode: 'MODEL_NOT_AVAILABLE',
            model: modelCheck.model,
            availableModels: modelCheck.availableModels
          };
        }

        const serviceIntegration = getServiceIntegration && getServiceIntegration();
        const historyService = serviceIntegration?.analysisHistory;

        if (!historyService?.getRecentAnalysis) {
          return {
            success: false,
            error: 'Analysis history service unavailable',
            errorCode: 'HISTORY_SERVICE_UNAVAILABLE'
          };
        }

        // Load all history entries (bounded by service defaults if any)
        const allEntries = await historyService.getRecentAnalysis(Number.MAX_SAFE_INTEGER);

        // FIX #17: Validate allEntries is an array to prevent crash
        if (!Array.isArray(allEntries)) {
          logger.warn('[EMBEDDINGS] getRecentAnalysis returned non-array:', typeof allEntries);
          return {
            success: false,
            error: 'Failed to load analysis history - invalid data format',
            errorCode: 'INVALID_HISTORY_FORMAT'
          };
        }

        if (allEntries.length === 0) {
          return {
            success: true,
            files: 0,
            message: 'No analysis history to embed. Analyze some files first.'
          };
        }

        // De-dupe analysis history to unique file IDs.
        // History can contain multiple entries per file (reanalysis, retries), which previously caused
        // misleading "file counts" in UI.
        const uniqueHistoryFileIds = new Set();

        const smartFolders = (
          typeof getCustomFolders === 'function' ? getCustomFolders() : []
        ).filter((f) => f && f.name);

        // Track results for folders
        const folderResults = { success: 0, failed: 0 };

        // Process folder embeddings (silently continue on failure)
        if (smartFolders.length > 0) {
          const folderPayloads = await Promise.all(
            smartFolders.map(async (folder) => {
              try {
                const folderText = [folder.name, folder.description].filter(Boolean).join(' - ');

                const { vector, model } = await folderMatcher.embedText(folderText);
                const folderId = folder.id || folderMatcher.generateFolderId(folder);

                folderResults.success++;
                return {
                  id: folderId,
                  name: folder.name,
                  description: folder.description || '',
                  path: folder.path || '',
                  vector,
                  model,
                  updatedAt: new Date().toISOString()
                };
              } catch (error) {
                folderResults.failed++;
                logger.warn('[EMBEDDINGS] Failed to generate folder embedding:', folder.name);
                return null;
              }
            })
          );

          const validFolderPayloads = folderPayloads.filter((p) => p !== null);
          if (validFolderPayloads.length > 0) {
            await chromaDbService.batchUpsertFolders(validFolderPayloads);
          }
        }

        // SAFE: resetFiles() only deletes/recreates the collection, not the DB directory
        // This rebuilds the search index from analysis history without re-analyzing files
        await chromaDbService.resetFiles();
        // SAFE: resetFileChunks() only deletes/recreates the chunk collection.
        // This rebuilds deep semantic recall from extractedText without re-analyzing files.
        await chromaDbService.resetFileChunks();

        // Track results for files
        const fileResults = {
          success: 0,
          failed: 0,
          errors: [],
          chunkFailures: 0,
          chunkFailureSamples: []
        };

        // Process file embeddings with proper error tracking
        const filePayloadsById = new Map();
        const chunkPayloads = [];
        const embeddingService = getParallelEmbeddingService();

        for (const entry of allEntries) {
          try {
            const organization = entry.organization || {};
            const filePath = organization.actual || entry.originalPath;
            const ext = (path.extname(filePath) || '').toLowerCase();
            const isImage = SUPPORTED_IMAGE_EXTENSIONS.includes(ext);
            const fileId = `${isImage ? 'image' : 'file'}:${filePath}`;

            // Track unique file IDs in history even if we later skip embedding due to empty content.
            uniqueHistoryFileIds.add(fileId);

            // Skip duplicates (keep the most recent history entry; getRecentAnalysis is expected to be ordered).
            if (filePayloadsById.has(fileId)) {
              continue;
            }

            const summary = [
              entry.analysis?.subject,
              entry.analysis?.summary,
              Array.isArray(entry.analysis?.tags) ? entry.analysis.tags.join(' ') : '',
              entry.analysis?.extractedText
                ? String(entry.analysis.extractedText).slice(0, 2000)
                : ''
            ]
              .filter(Boolean)
              .join('\n');

            // Skip empty summaries
            if (!summary.trim()) {
              fileResults.failed++;
              fileResults.errors.push({
                file: path.basename(filePath),
                error: 'No content to embed'
              });
              continue;
            }

            // Generate embedding
            const { vector, model } = await folderMatcher.embedText(summary);

            // Use renamed name if available, otherwise fall back to original basename
            const displayName = entry.organization?.newName || path.basename(filePath);

            // Extract rich metadata for graph visualization
            const tags = Array.isArray(entry.analysis?.tags) ? entry.analysis.tags : [];
            const category = entry.analysis?.category || '';
            const subject = entry.analysis?.subject || '';
            const summaryText = (entry.analysis?.summary || '').slice(0, 200);

            filePayloadsById.set(fileId, {
              id: fileId,
              vector,
              model,
              meta: {
                path: filePath,
                name: displayName,
                type: isImage ? 'image' : 'document',
                // Rich metadata for meaningful graph visualization
                tags: JSON.stringify(tags), // ChromaDB requires string, will parse on read
                category,
                subject,
                summary: summaryText
              },
              updatedAt: new Date().toISOString()
            });
            fileResults.success++;

            // Chunk embeddings (analyzed-only): embed extracted text for deep semantic recall.
            // This is intentionally behind the \"Rebuild\" flow so users can opt in.
            const extractedText =
              entry.analysis?.extractedText != null ? String(entry.analysis.extractedText) : '';
            if (extractedText.trim().length >= CHUNKING.MIN_TEXT_LENGTH) {
              const chunks = chunkText(extractedText, {
                chunkSize: CHUNKING.CHUNK_SIZE,
                overlap: CHUNKING.OVERLAP,
                maxChunks: CHUNKING.MAX_CHUNKS
              });

              for (const c of chunks) {
                try {
                  const { vector: chunkVector, model: chunkModel } =
                    await embeddingService.embedText(c.text);
                  if (!Array.isArray(chunkVector) || chunkVector.length === 0) continue;

                  const snippet = c.text.slice(0, 240);
                  chunkPayloads.push({
                    id: `chunk:${fileId}:${c.index}`,
                    vector: chunkVector,
                    model: chunkModel,
                    meta: {
                      fileId,
                      path: filePath,
                      name: displayName,
                      chunkIndex: c.index,
                      charStart: c.charStart,
                      charEnd: c.charEnd,
                      snippet
                    },
                    document: snippet,
                    updatedAt: new Date().toISOString()
                  });
                } catch (chunkErr) {
                  fileResults.chunkFailures++;
                  if (fileResults.chunkFailureSamples.length < 5) {
                    fileResults.chunkFailureSamples.push({
                      file: path.basename(filePath),
                      chunkIndex: c.index,
                      error: chunkErr?.message || String(chunkErr)
                    });
                  }
                  // Non-fatal: still keep file-level embedding even if a chunk fails
                  logger.debug('[EMBEDDINGS] Failed to embed chunk:', {
                    file: path.basename(filePath),
                    chunkIndex: c.index,
                    error: chunkErr?.message
                  });
                }
              }
            }
          } catch (e) {
            fileResults.failed++;
            const fileName = entry.originalPath ? path.basename(entry.originalPath) : 'unknown';
            fileResults.errors.push({
              file: fileName,
              error: e.message
            });
            logger.warn('[EMBEDDINGS] Failed to prepare file entry:', e.message);
            // continue on individual entry failure
          }
        }

        const filePayloads = Array.from(filePayloadsById.values());

        // Batch upsert all files at once (in chunks for large datasets)
        const BATCH_SIZE = BATCH.SEMANTIC_BATCH_SIZE;
        let rebuilt = 0;
        for (let i = 0; i < filePayloads.length; i += BATCH_SIZE) {
          const batch = filePayloads.slice(i, i + BATCH_SIZE);
          try {
            const count = await chromaDbService.batchUpsertFiles(batch);
            rebuilt += count;
          } catch (e) {
            logger.warn('[EMBEDDINGS] Failed to batch upsert files:', e.message);
          }
        }

        // Batch upsert chunk embeddings (in chunks to keep payloads bounded)
        let chunkRebuilt = 0;
        for (let i = 0; i < chunkPayloads.length; i += BATCH_SIZE) {
          const batch = chunkPayloads.slice(i, i + BATCH_SIZE);
          try {
            const count = await chromaDbService.batchUpsertFileChunks(batch);
            chunkRebuilt += count;
          } catch (e) {
            logger.warn('[EMBEDDINGS] Failed to batch upsert file chunks:', e.message);
          }
        }

        // Return detailed status
        const allFailed = fileResults.success === 0 && allEntries.length > 0;

        // Record which model/dimensions were used for the index (for UI mismatch warnings)
        try {
          const probe = filePayloads[0];
          const dims = Array.isArray(probe?.vector) ? probe.vector.length : null;
          if (Number.isFinite(dims) && dims > 0) {
            await writeEmbeddingIndexMetadata({
              model: probe?.model || modelCheck.model,
              dims,
              source: 'rebuild-files'
            });
          }
        } catch {
          // Non-fatal
        }

        return {
          success: !allFailed,
          files: rebuilt,
          fileChunks: chunkRebuilt,
          total: allEntries.length,
          totalUniqueFiles: uniqueHistoryFileIds.size,
          uniquePrepared: filePayloads.length,
          succeeded: fileResults.success,
          failed: fileResults.failed,
          errors: fileResults.errors.slice(0, 5), // Limit error details
          chunkFailures: fileResults.chunkFailures,
          chunkFailureSamples: fileResults.chunkFailureSamples.slice(0, 3),
          folders: {
            succeeded: folderResults.success,
            failed: folderResults.failed
          },
          model: modelCheck.model,
          message: allFailed
            ? `All ${fileResults.failed} file embeddings failed. Check Ollama connection.`
            : fileResults.failed > 0
              ? `${fileResults.success} files embedded, ${fileResults.failed} failed`
              : `Successfully embedded ${fileResults.success} files`
        };
      } catch (e) {
        logger.error('[EMBEDDINGS] Rebuild files failed:', e);
        return {
          success: false,
          error: e.message,
          errorCode: e.code || 'REBUILD_FAILED'
        };
      }
    })
  );

  /**
   * Full rebuild: Clears all embeddings and rebuilds everything from scratch.
   * Use this when changing embedding models or to fix any sync issues.
   * This clears ChromaDB, rebuilds folder embeddings, file embeddings,
   * file chunks, and the BM25 search index.
   */
  safeHandle(
    ipcMain,
    IPC_CHANNELS.EMBEDDINGS.FULL_REBUILD,
    createChromaHandler(async () => {
      const results = {
        folders: { success: 0, failed: 0 },
        files: { success: 0, failed: 0 },
        chunks: { success: 0, failed: 0 },
        bm25: false,
        model: null,
        errors: []
      };

      try {
        const embeddingService = getParallelEmbeddingService();
        if (!embeddingService) {
          return {
            success: false,
            error: 'ParallelEmbeddingService not available',
            errorCode: 'EMBEDDING_SERVICE_UNAVAILABLE'
          };
        }

        // Step 1: Verify embedding model is available
        const modelCheck = await verifyEmbeddingModelAvailable(logger);
        if (!modelCheck.available) {
          return {
            success: false,
            error: modelCheck.error,
            errorCode: 'MODEL_NOT_AVAILABLE',
            model: modelCheck.model,
            availableModels: modelCheck.availableModels
          };
        }
        results.model = modelCheck.model;

        logger.info('[EMBEDDINGS] Starting full rebuild with model:', modelCheck.model);

        // Record which model/dimensions were used for the index (for UI mismatch warnings)
        // Use a single probe embedding so we don't need to inspect downstream payloads.
        try {
          const probe = await embeddingService.embedText('embedding index dimension probe');
          const dims = Array.isArray(probe?.vector) ? probe.vector.length : null;
          if (Number.isFinite(dims) && dims > 0) {
            await writeEmbeddingIndexMetadata({
              model: probe?.model || modelCheck.model,
              dims,
              source: 'full-rebuild'
            });
          }
        } catch {
          // Non-fatal
        }

        // Step 2: Clear all ChromaDB collections
        logger.info('[EMBEDDINGS] Clearing all ChromaDB collections...');
        await chromaDbService.resetAll();

        // Step 3: Rebuild folder embeddings
        logger.info('[EMBEDDINGS] Rebuilding folder embeddings...');
        const smartFolders = (
          typeof getCustomFolders === 'function' ? getCustomFolders() : []
        ).filter((f) => f && f.name);

        if (smartFolders.length > 0) {
          const folderPayloads = await Promise.all(
            smartFolders.map(async (folder) => {
              try {
                const folderText = [folder.name, folder.description].filter(Boolean).join(' - ');
                const { vector, model } = await folderMatcher.embedText(folderText);
                const folderId = folder.id || folderMatcher.generateFolderId(folder);

                results.folders.success++;
                return {
                  id: folderId,
                  name: folder.name,
                  description: folder.description || '',
                  path: folder.path || '',
                  vector,
                  model,
                  updatedAt: new Date().toISOString()
                };
              } catch (error) {
                results.folders.failed++;
                results.errors.push({ type: 'folder', name: folder.name, error: error.message });
                return null;
              }
            })
          );

          const validFolderPayloads = folderPayloads.filter((p) => p !== null);
          if (validFolderPayloads.length > 0) {
            await chromaDbService.batchUpsertFolders(validFolderPayloads);
          }
        }

        // Step 4: Rebuild file embeddings from analysis history
        logger.info('[EMBEDDINGS] Rebuilding file embeddings...');
        const serviceIntegration = getServiceIntegration && getServiceIntegration();
        const historyService = serviceIntegration?.analysisHistory;

        if (historyService?.getRecentAnalysis) {
          const allEntries = await historyService.getRecentAnalysis(Number.MAX_SAFE_INTEGER);

          if (Array.isArray(allEntries) && allEntries.length > 0) {
            const filePayloads = [];
            const chunkPayloads = [];

            for (const entry of allEntries) {
              try {
                const analysis = entry.analysis || {};
                const organization = entry.organization || {};

                // Use current path after organization if available
                const filePath = organization.actual || entry.originalPath;
                const displayName =
                  organization.newName || entry.fileName || path.basename(filePath);
                const ext = (path.extname(filePath) || '').toLowerCase();
                const isImage = SUPPORTED_IMAGE_EXTENSIONS.includes(ext);
                const fileId = `${isImage ? 'image' : 'file'}:${filePath}`;

                // Build text representation for embedding
                const textParts = [
                  displayName,
                  analysis.subject,
                  analysis.summary,
                  ...(analysis.tags || []),
                  analysis.category
                ].filter(Boolean);

                const embeddingText = textParts.join(' ').trim();
                if (!embeddingText) continue;

                const { vector, model } = await embeddingService.embedText(embeddingText);
                if (!Array.isArray(vector) || vector.length === 0) continue;

                results.files.success++;
                filePayloads.push({
                  id: fileId,
                  vector,
                  model,
                  meta: {
                    path: filePath,
                    name: displayName,
                    category: analysis.category || '',
                    subject: analysis.subject || '',
                    tags: (analysis.tags || []).join(', ')
                  },
                  document: embeddingText.slice(0, 500),
                  updatedAt: new Date().toISOString()
                });

                // Also process chunks from extracted text
                const extractedText = analysis.extractedText || '';
                if (extractedText.length >= CHUNKING.MIN_TEXT_LENGTH) {
                  const chunks = chunkText(extractedText, {
                    chunkSize: CHUNKING.CHUNK_SIZE,
                    overlap: CHUNKING.OVERLAP,
                    maxChunks: CHUNKING.MAX_CHUNKS
                  });

                  for (const chunk of chunks) {
                    try {
                      const { vector: chunkVector, model: chunkModel } =
                        await embeddingService.embedText(chunk.text);
                      if (!Array.isArray(chunkVector) || chunkVector.length === 0) continue;

                      results.chunks.success++;
                      const snippet = chunk.text.slice(0, 240);
                      chunkPayloads.push({
                        id: `chunk:${fileId}:${chunk.index}`,
                        vector: chunkVector,
                        model: chunkModel,
                        meta: {
                          fileId,
                          path: filePath,
                          name: displayName,
                          chunkIndex: chunk.index,
                          charStart: chunk.charStart,
                          charEnd: chunk.charEnd,
                          snippet
                        },
                        document: snippet,
                        updatedAt: new Date().toISOString()
                      });
                    } catch (chunkErr) {
                      results.chunks.failed++;
                    }
                  }
                }
              } catch (e) {
                results.files.failed++;
                results.errors.push({
                  type: 'file',
                  name: entry.fileName || 'unknown',
                  error: e.message
                });
              }
            }

            // Batch upsert files
            const BATCH_SIZE = BATCH.SEMANTIC_BATCH_SIZE;
            for (let i = 0; i < filePayloads.length; i += BATCH_SIZE) {
              const batch = filePayloads.slice(i, i + BATCH_SIZE);
              try {
                await chromaDbService.batchUpsertFiles(batch);
              } catch (e) {
                logger.warn('[EMBEDDINGS] Failed to batch upsert files:', e.message);
              }
            }

            // Batch upsert chunks
            for (let i = 0; i < chunkPayloads.length; i += BATCH_SIZE) {
              const batch = chunkPayloads.slice(i, i + BATCH_SIZE);
              try {
                await chromaDbService.batchUpsertFileChunks(batch);
              } catch (e) {
                logger.warn('[EMBEDDINGS] Failed to batch upsert chunks:', e.message);
              }
            }
          }
        }

        // Step 5: Rebuild BM25 index
        logger.info('[EMBEDDINGS] Rebuilding BM25 search index...');
        try {
          const searchService = await getSearchService(
            getServiceIntegration,
            chromaDbService,
            logger
          );
          if (searchService) {
            await searchService.buildBM25Index();
            results.bm25 = true;
          }
        } catch (e) {
          results.errors.push({ type: 'bm25', error: e.message });
        }

        logger.info('[EMBEDDINGS] Full rebuild complete', {
          folders: results.folders,
          files: results.files,
          chunks: results.chunks,
          bm25: results.bm25
        });

        return {
          success: true,
          folders: results.folders.success,
          files: results.files.success,
          chunks: results.chunks.success,
          bm25Rebuilt: results.bm25,
          model: results.model,
          errors: results.errors.slice(0, 5),
          message: `Full rebuild complete: ${results.folders.success} folders, ${results.files.success} files, ${results.chunks.success} chunks`
        };
      } catch (e) {
        logger.error('[EMBEDDINGS] Full rebuild failed:', e);
        return {
          success: false,
          error: e.message,
          errorCode: 'FULL_REBUILD_FAILED',
          partialResults: results
        };
      }
    })
  );

  /**
   * Reanalyze All: Forces re-analysis of ALL files in smart folders and rebuilds embeddings.
   * Use this when changing AI models to regenerate all analysis and embeddings with the new model.
   * This clears analysis history and queues all files for fresh analysis.
   */
  safeHandle(
    ipcMain,
    IPC_CHANNELS.EMBEDDINGS.REANALYZE_ALL,
    withErrorLogging(logger, async () => {
      try {
        logger.info('[EMBEDDINGS] Starting reanalyze all files operation...');

        // Step 1: Verify models are available
        const modelCheck = await verifyEmbeddingModelAvailable(logger);
        if (!modelCheck.available) {
          return {
            success: false,
            error: modelCheck.error,
            errorCode: 'MODEL_NOT_AVAILABLE',
            model: modelCheck.model
          };
        }

        // Step 2: Get the smart folder watcher
        const serviceIntegration =
          typeof getServiceIntegration === 'function' ? getServiceIntegration() : null;
        const smartFolderWatcher = serviceIntegration?.smartFolderWatcher;

        if (!smartFolderWatcher) {
          return {
            success: false,
            error: 'Smart folder watcher not available. Configure smart folders first.',
            errorCode: 'WATCHER_NOT_AVAILABLE'
          };
        }

        // Step 3: Start the watcher if not running
        if (!smartFolderWatcher.isRunning) {
          logger.info('[EMBEDDINGS] Starting smart folder watcher...');
          const started = await smartFolderWatcher.start();
          if (!started) {
            return {
              success: false,
              error: 'Failed to start smart folder watcher. Check smart folder configuration.',
              errorCode: 'WATCHER_START_FAILED'
            };
          }
        }

        // Step 4: Clear existing analysis history (optional - files will be re-analyzed anyway)
        const historyService = serviceIntegration?.analysisHistory;
        if (historyService?.clear) {
          logger.info('[EMBEDDINGS] Clearing analysis history...');
          await historyService.clear();
        }

        // Step 5: Clear all embeddings
        logger.info('[EMBEDDINGS] Clearing all embeddings...');
        await chromaDbService.resetAll();

        // Step 6: Queue all files for reanalysis
        logger.info('[EMBEDDINGS] Queueing all files for reanalysis...');
        const result = await smartFolderWatcher.forceReanalyzeAll();

        logger.info('[EMBEDDINGS] Reanalyze all queued:', result);

        return {
          success: true,
          scanned: result.scanned,
          queued: result.queued,
          model: modelCheck.model,
          message: `Queued ${result.queued} files for reanalysis. Analysis will run in the background and embeddings will be rebuilt automatically.`
        };
      } catch (e) {
        logger.error('[EMBEDDINGS] Reanalyze all failed:', e);
        return {
          success: false,
          error: e.message,
          errorCode: 'REANALYZE_ALL_FAILED'
        };
      }
    })
  );

  safeHandle(
    ipcMain,
    IPC_CHANNELS.EMBEDDINGS.CLEAR_STORE,
    createChromaHandler(async () => {
      try {
        await chromaDbService.resetAll();
        return { success: true };
      } catch (e) {
        return { success: false, error: e.message };
      }
    })
  );

  // New endpoint for getting vector DB statistics
  safeHandle(
    ipcMain,
    IPC_CHANNELS.EMBEDDINGS.GET_STATS,
    createChromaHandler(async () => {
      try {
        const stats = await chromaDbService.getStats();

        // Provide lightweight context so the UI can explain *why* embeddings are empty.
        // This avoids confusing "rebuild embeddings" prompts when users already have analysis history.
        let analysisHistory = null;
        try {
          const serviceIntegration =
            typeof getServiceIntegration === 'function' ? getServiceIntegration() : null;
          const historyService = serviceIntegration?.analysisHistory;
          if (historyService?.getQuickStats) {
            analysisHistory = await historyService.getQuickStats();
          } else if (historyService?.getStatistics) {
            // Fallback (cached) stats if quick stats not available.
            const full = await historyService.getStatistics();
            analysisHistory = {
              totalFiles: typeof full?.totalFiles === 'number' ? full.totalFiles : 0
            };
          }
        } catch (e) {
          // Non-fatal: stats still useful without history context
          analysisHistory = null;
        }

        const historyTotal =
          typeof analysisHistory?.totalFiles === 'number' ? analysisHistory.totalFiles : 0;
        const needsFileEmbeddingRebuild =
          typeof stats?.files === 'number' && stats.files === 0 && historyTotal > 0;

        let embeddingIndex = null;
        try {
          embeddingIndex = await readEmbeddingIndexMetadata();
        } catch {
          embeddingIndex = null;
        }

        const activeEmbeddingModel = getOllamaEmbeddingModel() || AI_DEFAULTS.EMBEDDING.MODEL;
        const embeddingModelMismatch =
          Boolean(embeddingIndex?.model) &&
          typeof embeddingIndex?.model === 'string' &&
          embeddingIndex.model !== activeEmbeddingModel;

        return {
          success: true,
          ...stats,
          analysisHistory,
          needsFileEmbeddingRebuild,
          embeddingIndex,
          activeEmbeddingModel,
          embeddingModelMismatch
        };
      } catch (e) {
        return { success: false, error: e.message };
      }
    })
  );

  // New endpoint for finding similar documents
  safeHandle(
    ipcMain,
    IPC_CHANNELS.EMBEDDINGS.FIND_SIMILAR,
    createChromaHandler(async (event, { fileId, topK = SEARCH.DEFAULT_TOP_K_SIMILAR }) => {
      // HIGH PRIORITY FIX: Add timeout and validation (addresses HIGH-11)
      const QUERY_TIMEOUT = TIMEOUTS.SEMANTIC_QUERY;
      const { MAX_TOP_K } = LIMITS;

      try {
        if (!fileId) {
          return { success: false, error: 'File ID is required' };
        }

        // Validate topK parameter
        if (!Number.isInteger(topK) || topK < 1 || topK > MAX_TOP_K) {
          return {
            success: false,
            error: `topK must be between 1 and ${MAX_TOP_K}`
          };
        }

        // Create timeout promise
        // FIX: Store timeout ID to clear it after race resolves
        let timeoutId;
        const timeoutPromise = new Promise((_, reject) => {
          timeoutId = setTimeout(() => reject(new Error('Query timeout exceeded')), QUERY_TIMEOUT);
        });

        // Race query against timeout
        let similarFiles;
        try {
          similarFiles = await Promise.race([
            folderMatcher.findSimilarFiles(fileId, topK),
            timeoutPromise
          ]);
        } finally {
          // FIX: Always clear timeout to prevent memory leak
          if (timeoutId) clearTimeout(timeoutId);
        }

        return { success: true, results: similarFiles };
      } catch (e) {
        logger.error('[EMBEDDINGS] Find similar failed:', {
          fileId,
          topK,
          error: e.message,
          timeout: e.message.includes('timeout')
        });
        return {
          success: false,
          error: e.message,
          timeout: e.message.includes('timeout')
        };
      }
    })
  );

  // Global semantic search (query -> ranked files)
  // Uses SearchService.hybridSearch for combined BM25 + vector search with RRF fusion
  safeHandle(
    ipcMain,
    IPC_CHANNELS.EMBEDDINGS.SEARCH,
    createChromaHandler(
      async (
        event,
        {
          query,
          topK = SEARCH.DEFAULT_TOP_K,
          mode = 'hybrid',
          minScore,
          chunkWeight,
          chunkTopK
        } = {}
      ) => {
        const { MAX_TOP_K } = LIMITS;

        try {
          const cleanQuery = typeof query === 'string' ? query.trim() : '';
          if (!cleanQuery) {
            return { success: false, error: 'Query is required' };
          }
          if (cleanQuery.length < 2 || cleanQuery.length > 2000) {
            return { success: false, error: 'Query length must be between 2 and 2000 characters' };
          }

          // Validate topK parameter
          if (!Number.isInteger(topK) || topK < 1 || topK > MAX_TOP_K) {
            return {
              success: false,
              error: `topK must be between 1 and ${MAX_TOP_K}`
            };
          }

          // FIX P1-7: Verify embedding model for vector/hybrid modes
          // BM25-only mode doesn't need embeddings
          let effectiveMode = mode;
          if (mode !== 'bm25') {
            const modelCheck = await verifyEmbeddingModelAvailable(logger);
            if (!modelCheck.available) {
              if (mode === 'vector') {
                // Vector-only mode requires embeddings - fail gracefully
                return {
                  success: false,
                  error: `Embedding model not available: ${modelCheck.error}`,
                  errorCode: 'MODEL_NOT_AVAILABLE',
                  model: modelCheck.model
                };
              }
              // FIX P1-8: Hybrid mode can fall back to BM25-only
              logger.warn(
                '[EMBEDDINGS] Embedding model unavailable, falling back to BM25-only search',
                {
                  requestedMode: mode,
                  error: modelCheck.error
                }
              );
              effectiveMode = 'bm25';
            }
          }

          // Use SearchService for hybrid BM25 + vector search with quality filtering
          const service = await getSearchService();
          const searchOptions = {
            topK,
            mode: effectiveMode, // Use effective mode (may be fallback)
            ...(typeof minScore === 'number' && { minScore }),
            ...(typeof chunkWeight === 'number' && chunkWeight >= 0 && chunkWeight <= 1
              ? { chunkWeight }
              : {}),
            ...(Number.isInteger(chunkTopK) && chunkTopK >= 1 && chunkTopK <= MAX_TOP_K * 20
              ? { chunkTopK }
              : {})
          };

          const result = await service.hybridSearch(cleanQuery, searchOptions);

          if (!result.success) {
            // FIX P1-8: If hybrid/vector search fails, try BM25 fallback
            if (effectiveMode !== 'bm25') {
              logger.warn('[EMBEDDINGS] Search failed, attempting BM25 fallback', {
                originalMode: effectiveMode,
                error: result.error
              });
              const fallbackResult = await service.hybridSearch(cleanQuery, {
                ...searchOptions,
                mode: 'bm25'
              });
              if (fallbackResult.success) {
                return {
                  success: true,
                  results: fallbackResult.results,
                  mode: 'bm25',
                  meta: {
                    ...fallbackResult.meta,
                    fallback: true,
                    originalMode: effectiveMode,
                    fallbackReason: result.error
                  }
                };
              }
            }
            return {
              success: false,
              error: result.error || 'Search failed'
            };
          }

          return {
            success: true,
            results: result.results,
            mode: result.mode || effectiveMode,
            meta: {
              ...result.meta,
              ...(effectiveMode !== mode && { fallback: true, originalMode: mode })
            }
          };
        } catch (e) {
          logger.error('[EMBEDDINGS] Search failed:', {
            topK,
            error: e.message,
            timeout: e.message.includes('timeout')
          });

          // FIX P1-8: Last resort - try BM25 fallback on exception
          if (mode !== 'bm25') {
            try {
              const service = await getSearchService();
              const fallbackResult = await service.hybridSearch(
                typeof query === 'string' ? query.trim() : '',
                { topK, mode: 'bm25' }
              );
              if (fallbackResult.success) {
                return {
                  success: true,
                  results: fallbackResult.results,
                  mode: 'bm25',
                  meta: {
                    ...fallbackResult.meta,
                    fallback: true,
                    originalMode: mode,
                    fallbackReason: e.message
                  }
                };
              }
            } catch (fallbackError) {
              logger.error('[EMBEDDINGS] BM25 fallback also failed:', {
                error: fallbackError.message
              });
            }
          }

          return {
            success: false,
            error: e.message,
            timeout: e.message.includes('timeout')
          };
        }
      }
    )
  );

  // Score a subset of file IDs against a query (for "search within graph")
  safeHandle(
    ipcMain,
    IPC_CHANNELS.EMBEDDINGS.SCORE_FILES,
    createChromaHandler(async (event, { query, fileIds } = {}) => {
      const QUERY_TIMEOUT = TIMEOUTS.SEMANTIC_QUERY;

      const padOrTruncateVector = (vector, expectedDim) => {
        if (!Array.isArray(vector) || vector.length === 0) return null;
        if (!Number.isInteger(expectedDim) || expectedDim <= 0) return vector;
        if (vector.length === expectedDim) return vector;
        if (vector.length < expectedDim) {
          return vector.concat(new Array(expectedDim - vector.length).fill(0));
        }
        return vector.slice(0, expectedDim);
      };

      try {
        const cleanQuery = typeof query === 'string' ? query.trim() : '';
        if (!cleanQuery) {
          return { success: false, error: 'Query is required' };
        }
        if (cleanQuery.length < 2 || cleanQuery.length > 2000) {
          return { success: false, error: 'Query length must be between 2 and 2000 characters' };
        }

        if (!Array.isArray(fileIds) || fileIds.length === 0) {
          return { success: false, error: 'fileIds must be a non-empty array' };
        }

        // Keep scoring fast and payloads bounded (renderer typically stays < 1000 nodes)
        const MAX_IDS = 1000;
        if (fileIds.length > MAX_IDS) {
          return { success: false, error: `fileIds must contain at most ${MAX_IDS} ids` };
        }

        const normalizedIds = fileIds
          .filter((id) => typeof id === 'string' && id.length > 0 && id.length < 2048)
          .slice(0, MAX_IDS);

        if (normalizedIds.length === 0) {
          return { success: false, error: 'No valid fileIds provided' };
        }

        // Create timeout promise
        let timeoutId;
        const timeoutPromise = new Promise((_, reject) => {
          timeoutId = setTimeout(() => reject(new Error('Query timeout exceeded')), QUERY_TIMEOUT);
        });

        try {
          const scored = await Promise.race([
            (async () => {
              const embeddingService = getParallelEmbeddingService();
              const { vector: rawQueryVector } = await embeddingService.embedText(cleanQuery);
              if (!Array.isArray(rawQueryVector) || rawQueryVector.length === 0) {
                return [];
              }

              await chromaDbService.initialize();
              const expectedDim =
                typeof chromaDbService.getCollectionDimension === 'function'
                  ? await chromaDbService.getCollectionDimension('files')
                  : null;
              const queryVector = padOrTruncateVector(rawQueryVector, expectedDim);
              if (!Array.isArray(queryVector) || queryVector.length === 0) {
                return [];
              }

              const fileResult = await chromaDbService.fileCollection.get({ ids: normalizedIds });

              const ids = Array.isArray(fileResult?.ids) ? fileResult.ids : [];
              const embeddings = Array.isArray(fileResult?.embeddings) ? fileResult.embeddings : [];

              const scores = [];
              for (let i = 0; i < ids.length; i += 1) {
                const vec = embeddings[i];
                // FIX P0-3: Skip files with missing/invalid embeddings to prevent crash
                if (!Array.isArray(vec) || vec.length === 0) continue;
                // Prevent silent zero scores when embedding models/dims change
                if (vec.length !== queryVector.length) continue;
                const score = cosineSimilarity(queryVector, vec);
                scores.push({ id: ids[i], score });
              }

              scores.sort((a, b) => b.score - a.score);
              return scores;
            })(),
            timeoutPromise
          ]);

          return { success: true, scores: scored };
        } finally {
          if (timeoutId) clearTimeout(timeoutId);
        }
      } catch (e) {
        logger.error('[EMBEDDINGS] scoreFiles failed:', {
          fileCount: Array.isArray(fileIds) ? fileIds.length : 0,
          error: e.message,
          timeout: e.message.includes('timeout')
        });
        return {
          success: false,
          error: e.message,
          timeout: e.message.includes('timeout')
        };
      }
    })
  );

  // ============================================================================
  // Hybrid Search Handlers
  // ============================================================================

  // NOTE: HYBRID_SEARCH handler removed - use SEARCH handler instead
  // The SEARCH handler now uses SearchService.hybridSearch() internally
  // with full support for mode: 'hybrid' | 'vector' | 'bm25'

  /**
   * Rebuild the BM25 keyword search index
   */
  safeHandle(
    ipcMain,
    IPC_CHANNELS.EMBEDDINGS.REBUILD_BM25_INDEX,
    // FIX: Use createChromaHandler to ensure initialization before accessing service
    createChromaHandler(async () => {
      try {
        const service = await getSearchService();
        const result = await service.rebuildIndex();
        return result;
      } catch (e) {
        logger.error('[EMBEDDINGS] Rebuild BM25 index failed:', e);
        return { success: false, error: e.message };
      }
    })
  );

  /**
   * Get the current search index status
   */
  safeHandle(
    ipcMain,
    IPC_CHANNELS.EMBEDDINGS.GET_SEARCH_STATUS,
    // FIX: Use createChromaHandler to ensure initialization before accessing service
    createChromaHandler(async () => {
      try {
        const service = await getSearchService();
        return { success: true, status: service.getIndexStatus() };
      } catch (e) {
        logger.error('[EMBEDDINGS] Get search status failed:', e);
        return { success: false, error: e.message };
      }
    })
  );

  // ============================================================================
  // Multi-Hop Expansion Handlers
  // ============================================================================

  /**
   * Find similar files with multi-hop expansion
   * Explores neighbors of neighbors with decay scoring
   */
  safeHandle(
    ipcMain,
    IPC_CHANNELS.EMBEDDINGS.FIND_MULTI_HOP,
    createChromaHandler(async (event, { seedIds, options = {} } = {}) => {
      try {
        if (!Array.isArray(seedIds) || seedIds.length === 0) {
          return { success: false, error: 'seedIds must be a non-empty array' };
        }

        const validIds = seedIds
          .filter((id) => typeof id === 'string' && id.length > 0)
          .slice(0, 10); // Limit to 10 seeds for performance

        if (validIds.length === 0) {
          return { success: false, error: 'No valid seedIds provided' };
        }

        const results = await folderMatcher.findMultiHopNeighbors(validIds, options);
        return { success: true, results };
      } catch (e) {
        logger.error('[EMBEDDINGS] Multi-hop expansion failed:', e);
        return { success: false, error: e.message };
      }
    })
  );

  // ============================================================================
  // Clustering Handlers
  // ============================================================================

  /**
   * Compute semantic clusters of files
   */
  safeHandle(
    ipcMain,
    IPC_CHANNELS.EMBEDDINGS.COMPUTE_CLUSTERS,
    createChromaHandler(async (event, { k = 'auto', generateLabels = true } = {}) => {
      try {
        // Validate k parameter
        if (k !== 'auto') {
          const numK = Number(k);
          if (!Number.isInteger(numK) || numK < 1 || numK > 100) {
            return {
              success: false,
              error: "k must be 'auto' or an integer between 1 and 100"
            };
          }
        }

        const service = await getClusteringService();
        const result = await service.computeClusters(k);

        // Optionally generate LLM labels for clusters
        if (result.success && generateLabels && result.clusters.length > 0) {
          await service.generateClusterLabels();
          // Update result with labels
          result.clusters = service.getClustersForGraph();
        }

        return result;
      } catch (e) {
        logger.error('[EMBEDDINGS] Cluster computation failed:', e);
        // FIX P2-12: Enrich error message with operation context
        return {
          success: false,
          error: `Cluster computation failed: ${e.message}`,
          operation: 'COMPUTE_CLUSTERS'
        };
      }
    })
  );

  /**
   * Get computed clusters
   */
  safeHandle(
    ipcMain,
    IPC_CHANNELS.EMBEDDINGS.GET_CLUSTERS,
    withErrorLogging(logger, async () => {
      try {
        const service = await getClusteringService();
        const clusters = service.getClustersForGraph();
        const crossClusterEdges = service.findCrossClusterEdges(THRESHOLDS.SIMILARITY_EDGE_DEFAULT);

        return {
          success: true,
          clusters,
          crossClusterEdges,
          stale: service.isClustersStale()
        };
      } catch (e) {
        logger.error('[EMBEDDINGS] Get clusters failed:', e);
        // FIX P2-12: Enrich error message with operation context
        return {
          success: false,
          error: `Failed to retrieve clusters: ${e.message}`,
          operation: 'GET_CLUSTERS'
        };
      }
    })
  );

  /**
   * Get members of a specific cluster
   */
  safeHandle(
    ipcMain,
    IPC_CHANNELS.EMBEDDINGS.GET_CLUSTER_MEMBERS,
    withErrorLogging(logger, async (event, { clusterId } = {}) => {
      try {
        if (typeof clusterId !== 'number') {
          return { success: false, error: 'clusterId must be a number' };
        }

        const service = await getClusteringService();
        // Now async - fetches fresh metadata from ChromaDB
        const members = await service.getClusterMembers(clusterId);

        return {
          success: true,
          clusterId,
          members
        };
      } catch (e) {
        logger.error('[EMBEDDINGS] Get cluster members failed:', e);
        // FIX P2-12: Enrich error message with operation context
        return {
          success: false,
          error: `Failed to get members of cluster ${clusterId}: ${e.message}`,
          operation: 'GET_CLUSTER_MEMBERS',
          clusterId
        };
      }
    })
  );

  /**
   * Get similarity edges between files for graph visualization
   */
  safeHandle(
    ipcMain,
    IPC_CHANNELS.EMBEDDINGS.GET_SIMILARITY_EDGES,
    withErrorLogging(
      logger,
      async (
        event,
        {
          fileIds,
          threshold = THRESHOLDS.SIMILARITY_EDGE_DEFAULT,
          maxEdgesPerNode = THRESHOLDS.SIMILARITY_EDGE_MAX_PER_NODE
        } = {}
      ) => {
        try {
          if (!Array.isArray(fileIds) || fileIds.length < 2) {
            return { success: true, edges: [] };
          }

          // Validate threshold (should be between 0 and 1)
          const numThreshold = Number(threshold);
          if (isNaN(numThreshold) || numThreshold < 0 || numThreshold > 1) {
            return {
              success: false,
              error: 'threshold must be a number between 0 and 1',
              edges: []
            };
          }

          // Validate maxEdgesPerNode (should be a positive integer)
          const numMaxEdges = Number(maxEdgesPerNode);
          if (!Number.isInteger(numMaxEdges) || numMaxEdges < 1 || numMaxEdges > 20) {
            return {
              success: false,
              error: 'maxEdgesPerNode must be an integer between 1 and 20',
              edges: []
            };
          }

          // Filter and limit fileIds
          const validIds = fileIds
            .filter((id) => typeof id === 'string' && id.length > 0 && id.length < 2048)
            .slice(0, 500); // Limit to 500 files for performance

          if (validIds.length < 2) {
            return { success: true, edges: [] };
          }

          const service = await getClusteringService();
          const edges = await service.findFileSimilarityEdges(validIds, {
            threshold: numThreshold,
            maxEdgesPerNode: numMaxEdges
          });

          return {
            success: true,
            edges
          };
        } catch (e) {
          logger.error('[EMBEDDINGS] Get similarity edges failed:', e);
          // FIX P2-12: Enrich error message with operation context
          return {
            success: false,
            error: `Failed to compute similarity edges: ${e.message}`,
            operation: 'GET_SIMILARITY_EDGES',
            edges: []
          };
        }
      }
    )
  );

  /**
   * Get fresh file metadata from ChromaDB
   * Used to get current file paths after files have been moved/organized
   */
  safeHandle(
    ipcMain,
    IPC_CHANNELS.EMBEDDINGS.GET_FILE_METADATA,
    withErrorLogging(logger, async (event, { fileIds } = {}) => {
      try {
        if (!Array.isArray(fileIds) || fileIds.length === 0) {
          return { success: true, metadata: {} };
        }

        // Validate and limit file IDs
        const validIds = fileIds
          .filter((id) => typeof id === 'string' && id.length > 0 && id.length < 2048)
          .slice(0, 100); // Limit to 100 files per request

        if (validIds.length === 0) {
          return { success: true, metadata: {} };
        }

        await chromaDbService.initialize();
        const { fileCollection } = chromaDbService;

        if (!fileCollection) {
          return {
            success: false,
            error: 'File collection not available - ChromaDB may not be initialized',
            operation: 'GET_FILE_METADATA',
            metadata: {}
          };
        }

        const result = await fileCollection.get({
          ids: validIds,
          include: ['metadatas']
        });

        // Build metadata map from results
        const metadata = {};
        if (Array.isArray(result?.ids) && Array.isArray(result?.metadatas)) {
          for (let i = 0; i < result.ids.length; i++) {
            metadata[result.ids[i]] = result.metadatas[i] || {};
          }
        }

        return { success: true, metadata };
      } catch (e) {
        logger.error('[EMBEDDINGS] Get file metadata failed:', e);
        // FIX P2-12: Enrich error message with operation context
        return {
          success: false,
          error: `Failed to retrieve file metadata: ${e.message}`,
          operation: 'GET_FILE_METADATA',
          metadata: {}
        };
      }
    })
  );

  /**
   * Find near-duplicate files across the indexed collection
   * Groups files with high semantic similarity (>=0.9 by default)
   */
  safeHandle(
    ipcMain,
    IPC_CHANNELS.EMBEDDINGS.FIND_DUPLICATES,
    withErrorLogging(logger, async (event, { threshold = 0.9, maxResults = 50 } = {}) => {
      try {
        // Validate threshold (should be between 0.7 and 1.0 for duplicates)
        const numThreshold = Number(threshold);
        if (isNaN(numThreshold) || numThreshold < 0.7 || numThreshold > 1) {
          return {
            success: false,
            error: 'threshold must be a number between 0.7 and 1.0',
            groups: [],
            totalDuplicates: 0
          };
        }

        // Validate maxResults
        const numMaxResults = Number(maxResults);
        if (!Number.isInteger(numMaxResults) || numMaxResults < 1 || numMaxResults > 200) {
          return {
            success: false,
            error: 'maxResults must be an integer between 1 and 200',
            groups: [],
            totalDuplicates: 0
          };
        }

        const service = await getClusteringService();
        const result = await service.findNearDuplicates({
          threshold: numThreshold,
          maxResults: numMaxResults
        });

        return result;
      } catch (e) {
        logger.error('[EMBEDDINGS] Find duplicates failed:', e);
        // FIX P2-12: Enrich error message with operation context
        return {
          success: false,
          error: `Failed to find duplicate files: ${e.message}`,
          operation: 'FIND_DUPLICATES',
          groups: [],
          totalDuplicates: 0
        };
      }
    })
  );

  // Cleanup on app quit - FIX #15: Use once() to prevent multiple listener registration
  const { app } = require('electron');
  app.once('before-quit', async () => {
    try {
      // FIX: Wait for any pending initialization to complete before cleanup
      // This prevents cleanup from racing with in-progress initialization
      if (initState === INIT_STATES.IN_PROGRESS && initPromise) {
        try {
          await Promise.race([
            initPromise,
            new Promise((resolve) => setTimeout(resolve, 5000)) // 5s max wait
          ]);
        } catch (e) {
          logger.warn('[SEMANTIC] Cleanup: initialization did not complete, proceeding anyway');
        }
      }

      // FIX: Clear module-level service references to prevent memory leaks
      _searchServiceRef = null;
      _clusteringServiceRef = null;
      searchService = null;
      clusteringService = null;
      // Clear promise references (they self-clear via finally, but ensure clean state)
      searchServicePromise = null;
      clusteringServicePromise = null;

      await chromaDbService.cleanup();
    } catch (error) {
      logger.error('[ChromaDB] Cleanup error:', error);
    }
  });
}

module.exports = registerEmbeddingsIpc;
module.exports.getSearchServiceInstance = getSearchServiceInstance;
module.exports.getClusteringServiceInstance = getClusteringServiceInstance;
