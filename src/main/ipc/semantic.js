const { IpcServiceContext, createFromLegacyParams } = require('./IpcServiceContext');
const { container, ServiceIds } = require('../services/ServiceContainer');
const path = require('path');
const fs = require('fs').promises;

// Resolve services via container to ensure shared state
const getOramaService = () => container.resolve(ServiceIds.ORAMA_VECTOR);
const getFolderMatcher = () => container.resolve(ServiceIds.FOLDER_MATCHING);
const getParallelEmbeddingService = () => container.resolve(ServiceIds.PARALLEL_EMBEDDING);
const getSearchService = () => container.resolve(ServiceIds.SEARCH_SERVICE);
const getClusteringService = () => container.resolve(ServiceIds.CLUSTERING);
const getLlamaService = () => container.resolve(ServiceIds.LLAMA_SERVICE);

const { getInstance: getQueryProcessor } = require('../services/QueryProcessor');
const { SUPPORTED_IMAGE_EXTENSIONS, AI_DEFAULTS } = require('../../shared/constants');
const {
  BATCH,
  TIMEOUTS,
  LIMITS,
  SEARCH,
  THRESHOLDS,
  CHUNKING,
  RETRY
} = require('../../shared/performanceConstants');
const { createHandler, safeHandle, z } = require('./ipcWrappers');
const { delay } = require('../../shared/promiseUtils');
const { cosineSimilarity, padOrTruncateVector } = require('../../shared/vectorMath');
const { validateFileOperationPath } = require('../../shared/pathSanitization');
const { chunkText } = require('../utils/textChunking');
const { normalizeText } = require('../../shared/normalization');
const { getFileEmbeddingId } = require('../utils/fileIdUtils');
const { enrichFolderTextForEmbedding } = require('../analysis/semanticExtensionMap');
const {
  readEmbeddingIndexMetadata,
  writeEmbeddingIndexMetadata
} = require('../services/vectorDb/embeddingIndexMetadata');
const { createLogger } = require('../../shared/logger');
const { ERROR_CODES } = require('../../shared/errorCodes');
const _moduleLogger = createLogger('semantic-ipc');

const isDimensionMismatchError = (error) => {
  if (!error) return false;
  const message = error?.message || error?.error || (typeof error === 'string' ? error : '') || '';
  return (
    error?.code === ERROR_CODES.VECTOR_DB_DIMENSION_MISMATCH || /dimension mismatch/i.test(message)
  );
};

/**
 * Verify embedding model is available locally
 * @param {Object} logger - Logger instance
 * @returns {Promise<{available: boolean, model: string, error?: string}>}
 */
/**
 * Detect Ollama-style model names (e.g. 'llama3.2:latest', 'mistral:7b').
 * These contain a ':' tag separator and are never valid GGUF filenames.
 */
function _isOllamaStyleName(name) {
  return typeof name === 'string' && name.includes(':') && !name.endsWith('.gguf');
}

async function verifyEmbeddingModelAvailable(logger) {
  const cfg = await getLlamaService().getConfig();
  let model = cfg.embeddingModel || AI_DEFAULTS.EMBEDDING.MODEL;

  // Replace Ollama-era names with the GGUF default and persist the correction
  if (_isOllamaStyleName(model)) {
    logger.info('[EMBEDDINGS] Replacing Ollama-era embedding model name with GGUF default', {
      ollamaName: model,
      default: AI_DEFAULTS.EMBEDDING.MODEL
    });
    model = AI_DEFAULTS.EMBEDDING.MODEL;
    try {
      await getLlamaService().updateConfig({ embeddingModel: model });
    } catch (e) {
      logger.warn('[EMBEDDINGS] Failed to persist embedding model correction:', e?.message);
    }
  }

  // Unit tests mock embedding generation and don't require real GGUF files.
  if (process.env.JEST_WORKER_ID) {
    return { available: true, model };
  }

  try {
    const models = await getLlamaService().listModels();

    // Check if the configured model (or a variant) is installed
    const modelNames = models.map((m) => (m.name || '').toLowerCase());
    const normalizedModel = model.toLowerCase();

    const isAvailable = modelNames.includes(normalizedModel);

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
        error: `Embedding model "${model}" not downloaded. Download it in Settings > Models.`,
        availableModels: modelNames.slice(0, 10)
      };
    }

    return { available: true, model };
  } catch (error) {
    logger.error('[EMBEDDINGS] Failed to verify embedding model:', error.message);
    return {
      available: false,
      model,
      error: `AI engine unavailable: ${error.message}. Check model downloads and try again.`
    };
  }
}

function isModelAvailable(modelNames, model) {
  const normalizedModel = String(model || '').toLowerCase();
  if (!normalizedModel) return false;
  // Exact match
  if (modelNames.includes(normalizedModel)) return true;
  // Fuzzy match: handles stale Ollama-era names (e.g. 'mistral' matches 'mistral-7b-instruct-v0.3-q4_k_m.gguf')
  return modelNames.some((m) => m.includes(normalizedModel) || normalizedModel.includes(m));
}

async function verifyReanalyzeModelsAvailable(logger) {
  const cfg = await getLlamaService().getConfig();
  let textModel = cfg.textModel || AI_DEFAULTS.TEXT.MODEL;
  let visionModel = cfg.visionModel || AI_DEFAULTS.IMAGE.MODEL;
  let embeddingModel = cfg.embeddingModel || AI_DEFAULTS.EMBEDDING.MODEL;

  // Replace Ollama-era names with GGUF defaults and persist corrections
  const corrections = {};
  if (_isOllamaStyleName(textModel)) {
    corrections.textModel = AI_DEFAULTS.TEXT.MODEL;
    textModel = AI_DEFAULTS.TEXT.MODEL;
  }
  if (_isOllamaStyleName(visionModel)) {
    corrections.visionModel = AI_DEFAULTS.IMAGE.MODEL;
    visionModel = AI_DEFAULTS.IMAGE.MODEL;
  }
  if (_isOllamaStyleName(embeddingModel)) {
    corrections.embeddingModel = AI_DEFAULTS.EMBEDDING.MODEL;
    embeddingModel = AI_DEFAULTS.EMBEDDING.MODEL;
  }
  if (Object.keys(corrections).length > 0) {
    logger.info('[REANALYZE] Replacing Ollama-era model names with GGUF defaults', corrections);
    try {
      await getLlamaService().updateConfig(corrections);
    } catch (e) {
      logger.warn('[REANALYZE] Failed to persist model name corrections:', e?.message);
    }
  }

  // Unit tests mock analysis/embedding and don't require real GGUF files.
  if (process.env.JEST_WORKER_ID) {
    return { available: true, textModel, visionModel, embeddingModel };
  }

  try {
    const models = await getLlamaService().listModels();
    const modelNames = models.map((m) => (m.name || '').toLowerCase());

    if (!isModelAvailable(modelNames, textModel)) {
      return {
        available: false,
        model: textModel,
        modelType: 'text',
        error: `Text model "${textModel}" not downloaded. Download it in Settings > Models.`
      };
    }

    if (!isModelAvailable(modelNames, visionModel)) {
      return {
        available: false,
        model: visionModel,
        modelType: 'vision',
        error: `Vision model "${visionModel}" not downloaded. Download it in Settings > Models.`
      };
    }

    let embeddingModelToUse = embeddingModel;
    if (!isModelAvailable(modelNames, embeddingModelToUse)) {
      const fallbackModels = AI_DEFAULTS.EMBEDDING.FALLBACK_MODELS || [];
      const fallback = fallbackModels.find((candidate) => isModelAvailable(modelNames, candidate));
      if (fallback) {
        logger.info('[EMBEDDINGS] Primary model not found, using fallback', {
          primary: embeddingModel,
          fallback,
          availableModels: modelNames.slice(0, 10)
        });
        embeddingModelToUse = fallback;
      } else {
        return {
          available: false,
          model: embeddingModel,
          modelType: 'embedding',
          error: `Embedding model "${embeddingModel}" not downloaded. Download it in Settings > Models.`
        };
      }
    }

    return {
      available: true,
      textModel,
      visionModel,
      embeddingModel: embeddingModelToUse
    };
  } catch (error) {
    logger.error('[EMBEDDINGS] Failed to verify models for reanalysis:', error.message);
    return {
      available: false,
      model: embeddingModel,
      modelType: 'ai',
      error: `AI engine unavailable: ${error.message}. Check model downloads and try again.`
    };
  }
}

// Module-level reference to SearchService for cross-module access
// Module-level reference to SearchService for cross-module access
// FIX: Use container resolution instead of manual reference

/**
 * Get the SearchService instance (if initialized)
 * Used by fileOperationHandlers to invalidate index after file moves
 * @returns {SearchService|null}
 */
function getSearchServiceInstance() {
  return getSearchService();
}

/**
 * Get the ClusteringService instance (if initialized)
 * Used by fileOperationHandlers to invalidate clusters after file moves/deletes
 * @returns {ClusteringService|null}
 */
function getClusteringServiceInstance() {
  return getClusteringService();
}

// FIX P0-2: Rebuild operation lock to prevent concurrent rebuilds
// This prevents data corruption when user clicks rebuild multiple times
let _rebuildLock = {
  isLocked: false,
  operation: null,
  startedAt: null
};

/**
 * Acquire rebuild lock for an operation
 * @param {string} operation - Name of the operation (e.g., 'REBUILD_FILES', 'FULL_REBUILD')
 * @returns {{ acquired: boolean, reason?: string }}
 */
function acquireRebuildLock(operation) {
  if (_rebuildLock.isLocked) {
    const STALE_LOCK_TIMEOUT = 10 * 60 * 1000; // 10 minutes
    if (Date.now() - _rebuildLock.startedAt > STALE_LOCK_TIMEOUT) {
      _moduleLogger.warn('[SEMANTIC] Force-releasing stale rebuild lock', {
        staleLockOperation: _rebuildLock.operation,
        heldForMs: Date.now() - _rebuildLock.startedAt
      });
    } else {
      return {
        acquired: false,
        reason: `Another rebuild operation is in progress: ${_rebuildLock.operation} (started ${Math.round((Date.now() - _rebuildLock.startedAt) / 1000)}s ago)`
      };
    }
  }
  _rebuildLock = {
    isLocked: true,
    operation,
    startedAt: Date.now()
  };
  return { acquired: true };
}

/**
 * Release the rebuild lock
 */
function releaseRebuildLock() {
  _rebuildLock = {
    isLocked: false,
    operation: null,
    startedAt: null
  };
}

function registerEmbeddingsIpc(servicesOrParams) {
  let container;
  if (servicesOrParams instanceof IpcServiceContext) {
    container = servicesOrParams;
  } else {
    container = createFromLegacyParams(servicesOrParams);
  }

  const { ipcMain, IPC_CHANNELS, logger } = container.core;
  const { getCustomFolders } = container.folders;
  const { getServiceIntegration } = container;

  // Use container-resolved services
  // FIX: Use singleton pattern via ServiceContainer

  // SearchService and ClusteringService are resolved lazily via getters defined at module scope

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
  let initFailureReason = null;
  let initFailedAt = null;

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
    // Initialization previously failed - rate-limit retries but allow recovery
    if (initState === INIT_STATES.FAILED) {
      const now = Date.now();
      const retryDelayMs = 10000;
      if (initFailedAt && now - initFailedAt < retryDelayMs) {
        const err = new Error(initFailureReason || 'Vector DB is not available');
        err.code = 'VECTOR_DB_UNAVAILABLE';
        throw err;
      }
      logger.info('[SEMANTIC] Retrying initialization after failure', {
        reason: initFailureReason
      });
      initState = INIT_STATES.PENDING;
      initFailureReason = null;
      initFailedAt = null;
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
        await delay(50);
        // Check if initialization completed while waiting
        if (initState === INIT_STATES.COMPLETED) {
          return Promise.resolve();
        }
        if (initState === INIT_STATES.IN_PROGRESS && initPromise) {
          return initPromise;
        }
      }
      if (initMutexLocked) {
        // Force unlock to allow recovery on the next attempt
        logger.error('[SEMANTIC] Initialization mutex timeout - forcing unlock');
        initMutexLocked = false;
        initState = INIT_STATES.PENDING;
        initPromise = null;
        initFailureReason = 'Initialization mutex timeout';
        initFailedAt = Date.now();
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
        // In-process Orama either works immediately or has a permanent error.
        // No point in long exponential backoff for a local in-memory database.
        const MAX_RETRIES = RETRY.MAX_ATTEMPTS_LOW; // 2
        const RETRY_DELAY_BASE = 500; // 500ms base delay

        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
          try {
            logger.info(
              `[SEMANTIC] Starting initialization (attempt ${attempt}/${MAX_RETRIES})...`
            );

            await getOramaService().initialize();

            // CRITICAL FIX: MUST await FolderMatchingService initialization
            await getFolderMatcher().initialize();

            logger.info('[SEMANTIC] Initialization complete');
            initState = INIT_STATES.COMPLETED;

            // Warm up search service in background (non-blocking)
            // This pre-builds the BM25 index for faster first search
            setImmediate(async () => {
              try {
                const searchSvc = await getSearchService();
                await searchSvc.warmUp({ buildBM25: true, warmVectorDb: true });
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
                '[SEMANTIC] All initialization attempts failed. Vector DB features will be unavailable.'
              );
              initState = INIT_STATES.FAILED;
              initFailureReason = 'Vector DB initialization failed';
              initFailedAt = Date.now();
              throw new Error(initFailureReason);
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
  // FIX: Store timer ID so it can be cleared if the module is torn down
  // before the pre-warm fires (prevents stale callback after shutdown).
  let _preWarmTimerId = null;
  setImmediate(() => {
    // Use setImmediate to ensure IPC handlers are registered first
    _preWarmTimerId = setTimeout(() => {
      _preWarmTimerId = null;
      ensureInitialized().catch((error) => {
        logger.warn('[SEMANTIC] Background pre-warm failed (non-fatal):', error.message);
        // Non-fatal - handlers will retry with proper backoff when called
      });
    }, 1000); // 1 second delay for pre-warming, handlers use retries if called earlier
  });

  // Reusable Zod schemas for handler validation
  const context = 'Semantic';
  const schemaVoid = z ? z.void() : null;
  const schemaObject = z ? z.object({}).passthrough() : null;
  const schemaObjectOptional = z ? z.object({}).passthrough().optional() : null;
  const schemaStringOrObject = z ? z.union([z.string().min(1), z.object({}).passthrough()]) : null;

  /**
   * Safely ensure vector DB is initialized, returning a graceful error response on failure.
   * Mirrors the safety net that withVectorDbInit previously provided.
   * @returns {Object|null} Error response object if init failed, null if successful
   */
  async function safeEnsureInit() {
    try {
      await ensureInitialized();
    } catch (e) {
      return {
        success: false,
        error: 'Vector DB is not available yet. Please try again in a moment.',
        code: e?.code || 'VECTOR_DB_UNAVAILABLE',
        unavailable: true
      };
    }
    return null;
  }

  /**
   * Rebuild folder embeddings from current smart folders
   * SAFE: Only resets the 'folder_embeddings' collection (not the entire DB directory).
   * This is a user-controlled, intentional rebuild that preserves all other data.
   */
  safeHandle(
    ipcMain,
    IPC_CHANNELS.EMBEDDINGS.REBUILD_FOLDERS,
    createHandler({
      logger,
      context,
      schema: schemaVoid,
      handler: async () => {
        const initErr = await safeEnsureInit();
        if (initErr) return initErr;
        // FIX P0-2: Acquire rebuild lock to prevent concurrent rebuilds
        const lockResult = acquireRebuildLock('REBUILD_FOLDERS');
        if (!lockResult.acquired) {
          return {
            success: false,
            error: lockResult.reason,
            errorCode: 'REBUILD_IN_PROGRESS'
          };
        }

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
          await getOramaService().resetFolders();

          // Track successes and failures
          const results = { success: 0, failed: 0, errors: [] };

          // Process folder embeddings with error tracking
          const folderPayloads = await Promise.all(
            smartFolders.map(async (folder) => {
              try {
                const folderText = enrichFolderTextForEmbedding(folder.name, folder.description);

                const { vector, model } = await getFolderMatcher().embedText(folderText);
                const folderId = folder.id || getFolderMatcher().generateFolderId(folder);

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
            const folderResult = await getOramaService().batchUpsertFolders(validPayloads);
            upsertedCount = folderResult?.count ?? folderResult ?? 0;
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
              ? `All ${results.failed} folder embeddings failed. Check AI engine status.`
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
        } finally {
          // FIX P0-2: Always release lock when done
          releaseRebuildLock();
        }
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
    createHandler({
      logger,
      context,
      schema: schemaVoid,
      handler: async () => {
        const initErr = await safeEnsureInit();
        if (initErr) return initErr;
        // FIX P0-2: Acquire rebuild lock to prevent concurrent rebuilds
        const lockResult = acquireRebuildLock('REBUILD_FILES');
        if (!lockResult.acquired) {
          return {
            success: false,
            error: lockResult.reason,
            errorCode: 'REBUILD_IN_PROGRESS'
          };
        }

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
                  const folderText = enrichFolderTextForEmbedding(folder.name, folder.description);

                  const { vector, model } = await getFolderMatcher().embedText(folderText);
                  const folderId = folder.id || getFolderMatcher().generateFolderId(folder);

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
                } catch {
                  folderResults.failed++;
                  logger.warn('[EMBEDDINGS] Failed to generate folder embedding:', folder.name);
                  return null;
                }
              })
            );

            const validFolderPayloads = folderPayloads.filter((p) => p !== null);
            if (validFolderPayloads.length > 0) {
              await getOramaService().batchUpsertFolders(validFolderPayloads);
            }
          }

          // SAFE: resetFiles() only deletes/recreates the collection, not the DB directory
          // This rebuilds the search index from analysis history without re-analyzing files
          await getOramaService().resetFiles();
          // SAFE: resetFileChunks() only deletes/recreates the chunk collection.
          // This rebuilds deep semantic recall from extractedText without re-analyzing files.
          await getOramaService().resetFileChunks();

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

          // FIX: Yield every N entries to prevent UI blocking during large rebuilds
          const YIELD_EVERY_N = 50;
          let processedCount = 0;

          for (const entry of allEntries) {
            // FIX: Yield to event loop periodically to prevent UI blocking
            processedCount++;
            if (processedCount % YIELD_EVERY_N === 0) {
              await new Promise((resolve) => setImmediate(resolve));
            }
            try {
              const organization = entry.organization || {};
              const filePath = organization.actual || entry.originalPath;
              if (!filePath || typeof filePath !== 'string') {
                fileResults.failed++;
                fileResults.errors.push({
                  file: entry.originalPath ? path.basename(entry.originalPath) : 'unknown',
                  error: 'Invalid file path in analysis history'
                });
                continue;
              }

              const ext = (path.extname(filePath) || '').toLowerCase();
              const isImage = SUPPORTED_IMAGE_EXTENSIONS.includes(ext);
              const fileId = getFileEmbeddingId(filePath, isImage ? 'image' : 'file');

              // Track unique file IDs in history even if we later skip embedding due to empty content.
              uniqueHistoryFileIds.add(fileId);

              try {
                await fs.access(filePath);
              } catch (accessError) {
                fileResults.failed++;
                fileResults.errors.push({
                  file: path.basename(filePath),
                  error:
                    accessError.code === 'ENOENT'
                      ? 'File no longer exists'
                      : `File access error: ${accessError.message}`
                });
                continue;
              }

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
              const { vector, model } = await getFolderMatcher().embedText(summary);

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
                  fileName: displayName,
                  suggestedName: entry.organization?.newName || '',
                  fileType: isImage ? 'image' : 'document',
                  // Rich metadata for meaningful graph visualization
                  tags: Array.isArray(tags) ? tags : [], // Orama expects string[] (not JSON string)
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
                        snippet,
                        // FIX P0-3: Store embedding model version for mismatch detection
                        model: chunkModel || 'unknown'
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
              const result = await getOramaService().batchUpsertFiles(batch);
              rebuilt += result?.count ?? result ?? 0;
            } catch (e) {
              logger.warn('[EMBEDDINGS] Failed to batch upsert files:', e.message);
            }
            // FIX: Yield between batches to prevent UI blocking
            await new Promise((resolve) => setImmediate(resolve));
          }

          // Batch upsert chunk embeddings (in chunks to keep payloads bounded)
          let chunkRebuilt = 0;
          for (let i = 0; i < chunkPayloads.length; i += BATCH_SIZE) {
            const batch = chunkPayloads.slice(i, i + BATCH_SIZE);
            try {
              const count = await getOramaService().batchUpsertFileChunks(batch);
              chunkRebuilt += count;
            } catch (e) {
              logger.warn('[EMBEDDINGS] Failed to batch upsert file chunks:', e.message);
            }
            // FIX: Yield between batches to prevent UI blocking
            await new Promise((resolve) => setImmediate(resolve));
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
              ? `All ${fileResults.failed} file embeddings failed. Check AI engine status.`
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
        } finally {
          // FIX P0-2: Always release lock when done
          releaseRebuildLock();
        }
      }
    })
  );

  /**
   * Full rebuild: Clears all embeddings and rebuilds everything from scratch.
   * Use this when changing embedding models or to fix any sync issues.
   * This clears the vector DB, rebuilds folder embeddings, file embeddings,
   * file chunks, and the BM25 search index.
   */
  safeHandle(
    ipcMain,
    IPC_CHANNELS.EMBEDDINGS.FULL_REBUILD,
    createHandler({
      logger,
      context,
      schema: schemaVoid,
      handler: async () => {
        const initErr = await safeEnsureInit();
        if (initErr) return initErr;
        // FIX P0-2: Acquire rebuild lock to prevent concurrent rebuilds
        const lockResult = acquireRebuildLock('FULL_REBUILD');
        if (!lockResult.acquired) {
          return {
            success: false,
            error: lockResult.reason,
            errorCode: 'REBUILD_IN_PROGRESS'
          };
        }

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

          // Step 2: Clear all vector DB collections
          logger.info('[EMBEDDINGS] Clearing all vector DB collections...');
          await getOramaService().resetAll();

          // Step 3: Rebuild folder embeddings
          logger.info('[EMBEDDINGS] Rebuilding folder embeddings...');
          const smartFolders = (
            typeof getCustomFolders === 'function' ? getCustomFolders() : []
          ).filter((f) => f && f.name);

          if (smartFolders.length > 0) {
            const folderPayloads = await Promise.all(
              smartFolders.map(async (folder) => {
                try {
                  const folderText = enrichFolderTextForEmbedding(folder.name, folder.description);
                  const { vector, model } = await getFolderMatcher().embedText(folderText);
                  const folderId = folder.id || getFolderMatcher().generateFolderId(folder);

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
              await getOramaService().batchUpsertFolders(validFolderPayloads);
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
              const processedFileIds = new Set();

              for (const entry of allEntries) {
                try {
                  const analysis = entry.analysis || {};
                  const organization = entry.organization || {};

                  // Use current path after organization if available
                  const filePath = organization.actual || entry.originalPath;
                  if (!filePath || typeof filePath !== 'string') {
                    results.files.failed++;
                    results.errors.push({
                      type: 'file',
                      file: entry.originalPath ? path.basename(entry.originalPath) : 'unknown',
                      error: 'Invalid file path in analysis history'
                    });
                    continue;
                  }

                  try {
                    await fs.access(filePath);
                  } catch (accessError) {
                    results.files.failed++;
                    results.errors.push({
                      type: 'file',
                      file: path.basename(filePath),
                      error:
                        accessError.code === 'ENOENT'
                          ? 'File no longer exists'
                          : `File access error: ${accessError.message}`
                    });
                    continue;
                  }

                  const displayName =
                    organization.newName || entry.fileName || path.basename(filePath);
                  const ext = (path.extname(filePath) || '').toLowerCase();
                  const isImage = SUPPORTED_IMAGE_EXTENSIONS.includes(ext);
                  const fileId = getFileEmbeddingId(filePath, isImage ? 'image' : 'file');

                  // Skip duplicate file IDs (history may contain multiple entries per file)
                  if (processedFileIds.has(fileId)) {
                    continue;
                  }
                  processedFileIds.add(fileId);

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
                      fileName: displayName,
                      suggestedName: organization.newName || '',
                      fileType: isImage ? 'image' : 'document',
                      category: analysis.category || '',
                      subject: analysis.subject || '',
                      tags: Array.isArray(analysis.tags) ? analysis.tags : []
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
                            snippet,
                            // FIX P0-3: Store embedding model version for mismatch detection
                            model: chunkModel || 'unknown'
                          },
                          document: snippet,
                          updatedAt: new Date().toISOString()
                        });
                      } catch {
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
                  await getOramaService().batchUpsertFiles(batch);
                } catch (e) {
                  logger.warn('[EMBEDDINGS] Failed to batch upsert files:', e.message);
                }
              }

              // Batch upsert chunks
              for (let i = 0; i < chunkPayloads.length; i += BATCH_SIZE) {
                const batch = chunkPayloads.slice(i, i + BATCH_SIZE);
                try {
                  await getOramaService().batchUpsertFileChunks(batch);
                } catch (e) {
                  logger.warn('[EMBEDDINGS] Failed to batch upsert chunks:', e.message);
                }
              }
            }
          }

          // Step 5: Rebuild BM25 index
          logger.info('[EMBEDDINGS] Rebuilding BM25 search index...');
          try {
            const searchService = await getSearchService();
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
        } finally {
          // FIX P0-2: Always release lock when done
          releaseRebuildLock();
        }
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
    createHandler({
      logger,
      context,
      schema: schemaObjectOptional,
      handler: async (_event, options = {}) => {
        // FIX P0-2: Acquire rebuild lock to prevent concurrent rebuilds
        const lockResult = acquireRebuildLock('REANALYZE_ALL');
        if (!lockResult.acquired) {
          return {
            success: false,
            error: lockResult.reason,
            errorCode: 'REBUILD_IN_PROGRESS'
          };
        }

        try {
          logger.info('[EMBEDDINGS] Starting reanalyze all files operation...', {
            applyNaming: options.applyNaming
          });

          // Step 1: Verify text, vision, and embedding models are available
          const modelCheck = await verifyReanalyzeModelsAvailable(logger);
          if (!modelCheck.available) {
            return {
              success: false,
              error: `MODEL_NOT_AVAILABLE: ${modelCheck.error}`,
              errorCode: 'MODEL_NOT_AVAILABLE',
              model: modelCheck.model,
              modelType: modelCheck.modelType
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

          // Step 4: Optional dry run (no clears/queues)
          if (options.dryRun === true) {
            const preview = await smartFolderWatcher.previewReanalyzeAll();
            return {
              success: true,
              dryRun: true,
              scanned: preview.scanned,
              watchedFolders: preview.watchedFolders,
              message: `Dry run complete: ${preview.scanned} files would be queued for reanalysis.`
            };
          }

          // Step 5: Clear existing analysis history (optional - files will be re-analyzed anyway)
          const historyService = serviceIntegration?.analysisHistory;
          if (historyService?.clear) {
            logger.info('[EMBEDDINGS] Clearing analysis history...');
            await historyService.clear();
          }

          // Step 6: Clear all embeddings
          logger.info('[EMBEDDINGS] Clearing all embeddings...');
          await getOramaService().resetAll();

          // Step 7: Queue all files for reanalysis with naming option
          logger.info('[EMBEDDINGS] Queueing all files for reanalysis...');
          const result = await smartFolderWatcher.forceReanalyzeAll({
            applyNaming: options.applyNaming === true // Default to false if not specified
          });

          logger.info('[EMBEDDINGS] Reanalyze all queued:', result);

          return {
            success: true,
            scanned: result.scanned,
            queued: result.queued,
            model: modelCheck.embeddingModel,
            message: `Queued ${result.queued} files for reanalysis. Analysis will run in the background and embeddings will be rebuilt automatically.`
          };
        } catch (e) {
          logger.error('[EMBEDDINGS] Reanalyze all failed:', e);
          return {
            success: false,
            error: e.message,
            errorCode: 'REANALYZE_ALL_FAILED'
          };
        } finally {
          // FIX P0-2: Always release lock when done
          releaseRebuildLock();
        }
      }
    })
  );

  /**
   * Reanalyze File: Forces re-analysis of a single file in a smart folder.
   */
  safeHandle(
    ipcMain,
    IPC_CHANNELS.EMBEDDINGS.REANALYZE_FILE,
    createHandler({
      logger,
      context,
      schema: schemaStringOrObject,
      handler: async (_event, payload = {}) => {
        const filePath = typeof payload === 'string' ? payload : payload?.filePath;
        const applyNaming = payload?.applyNaming;

        if (!filePath) {
          return {
            success: false,
            error: 'filePath is required',
            errorCode: 'MISSING_FILE_PATH'
          };
        }

        const validation = await validateFileOperationPath(filePath, { checkSymlinks: true });
        if (!validation.valid) {
          return {
            success: false,
            error: validation.error,
            errorCode: 'INVALID_PATH'
          };
        }

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

        if (!smartFolderWatcher.isRunning) {
          const started = await smartFolderWatcher.start();
          if (!started) {
            return {
              success: false,
              error: 'Failed to start smart folder watcher. Check smart folder configuration.',
              errorCode: 'WATCHER_START_FAILED'
            };
          }
        }

        const result = await smartFolderWatcher.reanalyzeFile(validation.normalizedPath, {
          applyNaming
        });
        if (!result?.queued) {
          return {
            success: false,
            error: result?.error || 'File not eligible for reanalysis',
            errorCode: result?.errorCode || 'REANALYZE_FILE_SKIPPED'
          };
        }

        return {
          success: true,
          queued: true,
          filePath: validation.normalizedPath,
          message: `Queued ${path.basename(validation.normalizedPath)} for reanalysis.`
        };
      }
    })
  );

  safeHandle(
    ipcMain,
    IPC_CHANNELS.EMBEDDINGS.CLEAR_STORE,
    createHandler({
      logger,
      context,
      schema: schemaVoid,
      handler: async () => {
        const initErr = await safeEnsureInit();
        if (initErr) return initErr;
        try {
          await getOramaService().resetAll();
          return { success: true };
        } catch (e) {
          return { success: false, error: e.message };
        }
      }
    })
  );

  // New endpoint for getting vector DB statistics
  safeHandle(
    ipcMain,
    IPC_CHANNELS.EMBEDDINGS.GET_STATS,
    createHandler({
      logger,
      context,
      schema: schemaVoid,
      handler: async () => {
        const initErr = await safeEnsureInit();
        if (initErr) return initErr;
        try {
          const stats = await getOramaService().getStats();

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
          } catch {
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

          const cfg = await getLlamaService().getConfig();
          const activeEmbeddingModel = cfg.embeddingModel || AI_DEFAULTS.EMBEDDING.MODEL;
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
      }
    })
  );

  // Diagnostic endpoint for troubleshooting search issues
  // Returns detailed analysis of why search might return partial or no results
  safeHandle(
    ipcMain,
    IPC_CHANNELS.EMBEDDINGS.DIAGNOSE_SEARCH,
    createHandler({
      logger,
      context,
      schema: schemaObjectOptional,
      handler: async (event, { testQuery = 'test' } = {}) => {
        const initErr = await safeEnsureInit();
        if (initErr) return initErr;
        try {
          const searchSvc = await getSearchService();

          if (!searchSvc || !searchSvc.diagnoseSearchIssues) {
            return {
              success: false,
              error: 'SearchService not available or missing diagnoseSearchIssues method'
            };
          }

          const diagnostics = await searchSvc.diagnoseSearchIssues(testQuery);

          return {
            success: true,
            diagnostics
          };
        } catch (e) {
          logger.error('[EMBEDDINGS] Diagnose search failed:', {
            error: e.message,
            stack: e.stack
          });
          return {
            success: false,
            error: e.message
          };
        }
      }
    })
  );

  // New endpoint for finding similar documents
  safeHandle(
    ipcMain,
    IPC_CHANNELS.EMBEDDINGS.FIND_SIMILAR,
    createHandler({
      logger,
      context,
      schema: schemaObject,
      handler: async (event, { fileId, topK = SEARCH.DEFAULT_TOP_K_SIMILAR }) => {
        const initErr = await safeEnsureInit();
        if (initErr) return initErr;
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
            timeoutId = setTimeout(
              () => reject(new Error('Query timeout exceeded')),
              QUERY_TIMEOUT
            );
          });

          // Race query against timeout
          let similarFiles;
          try {
            similarFiles = await Promise.race([
              getFolderMatcher().findSimilarFiles(fileId, topK),
              timeoutPromise
            ]);
          } finally {
            // FIX: Always clear timeout to prevent memory leak
            if (timeoutId) clearTimeout(timeoutId);
          }

          return { success: true, results: similarFiles };
        } catch (e) {
          const requiresRebuild = isDimensionMismatchError(e);
          logger.error('[EMBEDDINGS] Find similar failed:', {
            fileId,
            topK,
            error: e.message,
            timeout: e.message.includes('timeout')
          });
          return {
            success: false,
            error: e.message,
            errorCode:
              e.code || (requiresRebuild ? ERROR_CODES.VECTOR_DB_DIMENSION_MISMATCH : null),
            requiresRebuild,
            timeout: e.message.includes('timeout')
          };
        }
      }
    })
  );

  // Global semantic search (query -> ranked files)
  // Uses SearchService.hybridSearch for combined BM25 + vector search with RRF fusion
  // Enhanced with query processing (spell correction, synonyms) and LLM re-ranking
  safeHandle(
    ipcMain,
    IPC_CHANNELS.EMBEDDINGS.SEARCH,
    createHandler({
      logger,
      context,
      schema: schemaObjectOptional,
      handler: async (
        event,
        {
          query,
          topK = SEARCH.DEFAULT_TOP_K,
          mode = 'hybrid',
          minScore,
          chunkWeight,
          chunkTopK,
          // Query processing options
          expandSynonyms = true,
          correctSpelling = false, // DISABLED - causes false corrections (are->api, that->tax)
          // Re-ranking options
          rerank = true,
          rerankTopN = 10,
          // Graph expansion options
          graphExpansion,
          graphExpansionWeight,
          graphExpansionMaxNeighbors,
          // Contextual chunk options
          chunkContext,
          chunkContextMaxNeighbors
        } = {}
      ) => {
        const initErr = await safeEnsureInit();
        if (initErr) return initErr;
        const { MAX_TOP_K } = LIMITS;

        let cleanQuery;
        try {
          cleanQuery = normalizeText(query, { maxLength: 2000 });
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

          // Validate rerankTopN parameter
          if (!Number.isInteger(rerankTopN) || rerankTopN < 1 || rerankTopN > 50) {
            rerankTopN = 10; // Reset to default if invalid
          }

          let settings = null;
          try {
            const settingsService = container.settings?.settingsService;
            if (settingsService?.load) {
              settings = await settingsService.load();
            }
          } catch (settingsErr) {
            logger.debug('[EMBEDDINGS] Failed to load settings for search', {
              error: settingsErr?.message || String(settingsErr)
            });
          }

          const graphExpansionSetting =
            typeof graphExpansion === 'boolean'
              ? graphExpansion
              : typeof settings?.graphExpansionEnabled === 'boolean'
                ? settings.graphExpansionEnabled
                : undefined;
          const graphExpansionWeightSetting = Number.isFinite(graphExpansionWeight)
            ? graphExpansionWeight
            : Number.isFinite(settings?.graphExpansionWeight)
              ? settings.graphExpansionWeight
              : undefined;
          const graphExpansionMaxNeighborsSetting = Number.isInteger(graphExpansionMaxNeighbors)
            ? graphExpansionMaxNeighbors
            : Number.isInteger(settings?.graphExpansionMaxNeighbors)
              ? settings.graphExpansionMaxNeighbors
              : undefined;
          const chunkContextSetting =
            typeof chunkContext === 'boolean'
              ? chunkContext
              : typeof settings?.chunkContextEnabled === 'boolean'
                ? settings.chunkContextEnabled
                : undefined;
          const chunkContextMaxNeighborsSetting = Number.isInteger(chunkContextMaxNeighbors)
            ? chunkContextMaxNeighbors
            : Number.isInteger(settings?.chunkContextMaxNeighbors)
              ? settings.chunkContextMaxNeighbors
              : undefined;

          // FIX P1-7: Verify embedding model for vector/hybrid modes
          // BM25-only mode doesn't need embeddings
          let effectiveMode = mode;
          let fallbackReason = null; // FIX C-3: Track fallback reason for UI notification
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
              // FIX C-3: Capture reason for UI banner
              fallbackReason = modelCheck.error?.includes('not running')
                ? 'AI engine unavailable - using keyword search only'
                : `Embedding model unavailable: ${modelCheck.error}`;
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
              : {}),
            ...(typeof graphExpansionSetting === 'boolean'
              ? { graphExpansion: graphExpansionSetting }
              : {}),
            ...(Number.isFinite(graphExpansionWeightSetting)
              ? { graphExpansionWeight: graphExpansionWeightSetting }
              : {}),
            ...(Number.isInteger(graphExpansionMaxNeighborsSetting)
              ? { graphExpansionMaxNeighbors: graphExpansionMaxNeighborsSetting }
              : {}),
            ...(typeof chunkContextSetting === 'boolean'
              ? { chunkContext: chunkContextSetting }
              : {}),
            ...(Number.isInteger(chunkContextMaxNeighborsSetting)
              ? { chunkContextMaxNeighbors: chunkContextMaxNeighborsSetting }
              : {}),
            // Query processing options
            expandSynonyms: Boolean(expandSynonyms),
            correctSpelling: Boolean(correctSpelling),
            // Re-ranking options
            rerank: Boolean(rerank),
            rerankTopN
          };

          const result = await service.hybridSearch(cleanQuery, searchOptions);

          if (!result.success) {
            const requiresRebuild = isDimensionMismatchError({ message: result.error });
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
              error: result.error || 'Search failed',
              errorCode: requiresRebuild ? ERROR_CODES.VECTOR_DB_DIMENSION_MISMATCH : null,
              requiresRebuild
            };
          }

          return {
            success: true,
            results: result.results,
            mode: result.mode || effectiveMode,
            queryMeta: result.queryMeta, // Include query processing info (corrections, synonyms)
            meta: {
              ...result.meta,
              // FIX C-3: Include fallback info for UI banner
              ...(effectiveMode !== mode && {
                fallback: true,
                originalMode: mode,
                fallbackReason: fallbackReason || 'Semantic search unavailable'
              })
            }
          };
        } catch (e) {
          const requiresRebuild = isDimensionMismatchError(e);
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
                cleanQuery || (typeof query === 'string' ? query.trim() : ''),
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
            errorCode:
              e.code || (requiresRebuild ? ERROR_CODES.VECTOR_DB_DIMENSION_MISMATCH : null),
            requiresRebuild,
            timeout: e.message.includes('timeout')
          };
        }
      }
    })
  );

  // Score a subset of file IDs against a query (for "search within graph")
  safeHandle(
    ipcMain,
    IPC_CHANNELS.EMBEDDINGS.SCORE_FILES,
    createHandler({
      logger,
      context,
      schema: schemaObjectOptional,
      handler: async (event, { query, fileIds } = {}) => {
        const initErr = await safeEnsureInit();
        if (initErr) return initErr;
        const QUERY_TIMEOUT = TIMEOUTS.SEMANTIC_QUERY;

        try {
          const cleanQuery = normalizeText(query, { maxLength: 2000 });
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

          const normalizedIds = [];
          const seenIds = new Set();
          for (const id of fileIds) {
            if (typeof id !== 'string' || id.length === 0 || id.length >= 2048) continue;
            if (seenIds.has(id)) continue;
            seenIds.add(id);
            normalizedIds.push(id);
            if (normalizedIds.length >= MAX_IDS) break;
          }

          if (normalizedIds.length === 0) {
            return { success: false, error: 'No valid fileIds provided' };
          }

          // Create timeout promise
          let timeoutId;
          const timeoutPromise = new Promise((_, reject) => {
            timeoutId = setTimeout(
              () => reject(new Error('Query timeout exceeded')),
              QUERY_TIMEOUT
            );
          });

          try {
            const scored = await Promise.race([
              (async () => {
                const embeddingService = getParallelEmbeddingService();
                const { vector: rawQueryVector } = await embeddingService.embedText(cleanQuery);
                if (!Array.isArray(rawQueryVector) || rawQueryVector.length === 0) {
                  return [];
                }

                await getOramaService().initialize();
                const expectedDim =
                  typeof getOramaService().getCollectionDimension === 'function'
                    ? await getOramaService().getCollectionDimension('files')
                    : null;
                const queryVector = padOrTruncateVector(rawQueryVector, expectedDim);
                if (!Array.isArray(queryVector) || queryVector.length === 0) {
                  return [];
                }

                // Batch-fetch file embeddings via OramaVectorService.getFile()
                const fileEntries = await Promise.all(
                  normalizedIds.map(async (id) => {
                    try {
                      const doc = await getOramaService().getFile(id);
                      return doc ? { id: doc.id, embedding: doc.embedding } : null;
                    } catch {
                      return null;
                    }
                  })
                );
                const validEntries = fileEntries.filter(Boolean);
                const ids = validEntries.map((e) => e.id);
                const embeddings = validEntries.map((e) => e.embedding);

                const scores = [];
                for (let i = 0; i < ids.length; i += 1) {
                  const vec = embeddings[i];
                  // FIX P0-3: Skip files with missing/invalid embeddings to prevent crash
                  if (!Array.isArray(vec) || vec.length === 0) continue;
                  const fileVector = padOrTruncateVector(vec, queryVector.length);
                  if (!Array.isArray(fileVector) || fileVector.length !== queryVector.length)
                    continue;
                  const score = cosineSimilarity(queryVector, fileVector);
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
      }
    })
  );

  // ============================================================================
  // Hybrid Search Handlers
  // ============================================================================

  // Hybrid search uses the SEARCH handler (mode: 'hybrid' | 'vector' | 'bm25')

  /**
   * Rebuild the BM25 keyword search index
   * Also extends QueryProcessor vocabulary for better spell correction
   */
  safeHandle(
    ipcMain,
    IPC_CHANNELS.EMBEDDINGS.REBUILD_BM25_INDEX,
    createHandler({
      logger,
      context,
      schema: schemaVoid,
      handler: async () => {
        const initErr = await safeEnsureInit();
        if (initErr) return initErr;
        try {
          const service = await getSearchService();
          const result = await service.rebuildIndex();

          // Extend vocabulary for spell correction after index rebuild
          try {
            const queryProcessor = getQueryProcessor();
            const serviceIntegration = getServiceIntegration && getServiceIntegration();
            const historyService = serviceIntegration?.analysisHistory;
            if (queryProcessor && historyService) {
              await queryProcessor.extendVocabulary(historyService);
              logger.debug('[EMBEDDINGS] Vocabulary extended after BM25 rebuild');
            }
          } catch (vocabErr) {
            logger.debug('[EMBEDDINGS] Vocabulary extension failed:', vocabErr.message);
          }

          return result;
        } catch (e) {
          logger.error('[EMBEDDINGS] Rebuild BM25 index failed:', e);
          return { success: false, error: e.message };
        }
      }
    })
  );

  /**
   * Get the current search index status
   */
  safeHandle(
    ipcMain,
    IPC_CHANNELS.EMBEDDINGS.GET_SEARCH_STATUS,
    createHandler({
      logger,
      context,
      schema: schemaVoid,
      handler: async () => {
        const initErr = await safeEnsureInit();
        if (initErr) return initErr;
        try {
          const service = await getSearchService();
          return { success: true, status: service.getIndexStatus() };
        } catch (e) {
          logger.error('[EMBEDDINGS] Get search status failed:', e);
          return { success: false, error: e.message };
        }
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
    createHandler({
      logger,
      context,
      schema: schemaObjectOptional,
      handler: async (event, { seedIds, options = {} } = {}) => {
        const initErr = await safeEnsureInit();
        if (initErr) return initErr;
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

          // Map UI parameters to service parameters (fixes parameter name mismatch)
          // UI sends: { hops, decay } but service expects: { maxHops, decayFactor }
          const mappedOptions = {
            maxHops: options.hops ?? options.maxHops,
            topKPerHop: options.topKPerHop,
            decayFactor: options.decay ?? options.decayFactor
          };

          const results = await getFolderMatcher().findMultiHopNeighbors(validIds, mappedOptions);
          return { success: true, results };
        } catch (e) {
          logger.error('[EMBEDDINGS] Multi-hop expansion failed:', e);
          return { success: false, error: e.message };
        }
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
    createHandler({
      logger,
      context,
      schema: schemaObjectOptional,
      handler: async (event, { k = 'auto', generateLabels = true } = {}) => {
        const initErr = await safeEnsureInit();
        if (initErr) return initErr;
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
      }
    })
  );

  /**
   * Get computed clusters
   */
  safeHandle(
    ipcMain,
    IPC_CHANNELS.EMBEDDINGS.GET_CLUSTERS,
    createHandler({
      logger,
      context,
      schema: schemaVoid,
      handler: async () => {
        try {
          const service = await getClusteringService();
          const clusters = service.getClustersForGraph();
          const crossClusterEdges = service.findCrossClusterEdges(
            THRESHOLDS.SIMILARITY_EDGE_DEFAULT
          );

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
      }
    })
  );

  /**
   * FIX: Clear cluster cache manually
   * Allows users/admins to force cluster recalculation without waiting for staleness timeout
   */
  safeHandle(
    ipcMain,
    IPC_CHANNELS.EMBEDDINGS.CLEAR_CLUSTERS,
    createHandler({
      logger,
      context,
      schema: schemaVoid,
      handler: async () => {
        try {
          const service = await getClusteringService();
          service.clearClusters();
          logger.info('[EMBEDDINGS] Cluster cache cleared manually');
          return { success: true, message: 'Cluster cache cleared' };
        } catch (e) {
          logger.error('[EMBEDDINGS] Clear clusters failed:', e);
          return {
            success: false,
            error: `Failed to clear cluster cache: ${e.message}`,
            operation: 'CLEAR_CLUSTERS'
          };
        }
      }
    })
  );

  /**
   * Get members of a specific cluster
   */
  safeHandle(
    ipcMain,
    IPC_CHANNELS.EMBEDDINGS.GET_CLUSTER_MEMBERS,
    createHandler({
      logger,
      context,
      schema: schemaObjectOptional,
      handler: async (event, { clusterId } = {}) => {
        try {
          if (typeof clusterId !== 'number') {
            return { success: false, error: 'clusterId must be a number' };
          }

          const service = await getClusteringService();
          // Now async - fetches fresh metadata from vector DB
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
      }
    })
  );

  /**
   * Get similarity edges between files for graph visualization
   */
  safeHandle(
    ipcMain,
    IPC_CHANNELS.EMBEDDINGS.GET_SIMILARITY_EDGES,
    createHandler({
      logger,
      context,
      schema: schemaObjectOptional,
      handler: async (
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
    })
  );

  /**
   * Get fresh file metadata from vector DB
   * Used to get current file paths after files have been moved/organized
   */
  safeHandle(
    ipcMain,
    IPC_CHANNELS.EMBEDDINGS.GET_FILE_METADATA,
    createHandler({
      logger,
      context,
      schema: schemaObjectOptional,
      handler: async (event, { fileIds } = {}) => {
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

          await getOramaService().initialize();

          // Batch-fetch file metadata via OramaVectorService.getFile()
          const metadata = {};
          await Promise.all(
            validIds.map(async (id) => {
              try {
                const doc = await getOramaService().getFile(id);
                if (doc) {
                  metadata[id] = {
                    path: doc.filePath,
                    filePath: doc.filePath,
                    fileName: doc.fileName,
                    fileType: doc.fileType,
                    analyzedAt: doc.analyzedAt,
                    suggestedName: doc.suggestedName,
                    keywords: doc.keywords,
                    tags: doc.tags,
                    extractionMethod: doc.extractionMethod
                  };
                }
              } catch {
                // Individual fetch failure is non-critical
              }
            })
          );

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
    createHandler({
      logger,
      context,
      schema: schemaObjectOptional,
      handler: async (event, { threshold = 0.9, maxResults = 50 } = {}) => {
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
        } catch {
          logger.warn('[SEMANTIC] Cleanup: initialization did not complete, proceeding anyway');
        }
      }

      // FIX: Clear module-level service references to prevent memory leaks
      // (No-op: references managed by container)

      await getOramaService().cleanup();
    } catch (error) {
      logger.error('[VectorDB] Cleanup error:', error);
    }
  });
}

module.exports = registerEmbeddingsIpc;
module.exports.getSearchServiceInstance = getSearchServiceInstance;
module.exports.getClusteringServiceInstance = getClusteringServiceInstance;
