const { getInstance: getChromaDB } = require('../services/chromadb');
const FolderMatchingService = require('../services/FolderMatchingService');
const path = require('path');
const { SUPPORTED_IMAGE_EXTENSIONS } = require('../../shared/constants');
const { BATCH, TIMEOUTS, LIMITS } = require('../../shared/performanceConstants');
const { withErrorLogging } = require('./ipcWrappers');

function registerEmbeddingsIpc({
  ipcMain,
  IPC_CHANNELS,
  logger,
  getCustomFolders,
  getServiceIntegration
}) {
  // Use ChromaDB singleton instance
  const chromaDbService = getChromaDB();
  const folderMatcher = new FolderMatchingService(chromaDbService);

  // CRITICAL FIX: Track initialization state to prevent race conditions
  let initializationPromise = null;
  let isInitialized = false;

  /**
   * Ensures services are initialized before IPC handlers execute
   * FIX: Added retry logic and better error handling for ChromaDB startup race condition
   * @returns {Promise<void>}
   */
  async function ensureInitialized() {
    // FIX: Consistent return values - all paths return Promise<void>
    if (isInitialized) return Promise.resolve();
    if (initializationPromise) return initializationPromise;

    initializationPromise = (async () => {
      const MAX_RETRIES = 5;
      const RETRY_DELAY_BASE = 2000; // 2 seconds base delay

      for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
          logger.info(`[SEMANTIC] Starting initialization (attempt ${attempt}/${MAX_RETRIES})...`);

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
          isInitialized = true;
          return; // Success - exit retry loop
        } catch (error) {
          logger.warn(`[SEMANTIC] Initialization attempt ${attempt} failed:`, error.message);

          if (attempt < MAX_RETRIES) {
            // Exponential backoff with jitter
            const delay = RETRY_DELAY_BASE * Math.pow(2, attempt - 1) + Math.random() * 1000;
            logger.info(`[SEMANTIC] Retrying in ${Math.round(delay)}ms...`);
            await new Promise((resolve) => setTimeout(resolve, delay));
          } else {
            logger.error(
              '[SEMANTIC] All initialization attempts failed. ChromaDB features will be unavailable.'
            );
            initializationPromise = null; // Allow retry on next explicit call
            // Don't throw - allow the app to continue in degraded mode
            return;
          }
        }
      }
    })();

    return initializationPromise;
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

  ipcMain.handle(
    IPC_CHANNELS.EMBEDDINGS.REBUILD_FOLDERS,
    withErrorLogging(logger, async () => {
      // CRITICAL FIX: Wait for initialization before executing
      try {
        await ensureInitialized();
      } catch (initError) {
        logger.warn('[EMBEDDINGS] ChromaDB not available:', initError.message);
        return {
          success: false,
          error: 'ChromaDB is not available. Please ensure the ChromaDB server is running.',
          unavailable: true
        };
      }

      // FIX: Check if initialization succeeded
      if (!isInitialized) {
        return {
          success: false,
          error: 'ChromaDB initialization pending. Please try again in a few seconds.',
          pending: true
        };
      }

      try {
        const smartFolders = getCustomFolders().filter((f) => f && f.name);
        await chromaDbService.resetFolders();

        // Optimization: Batch process folder embeddings
        const folderPayloads = await Promise.all(
          smartFolders.map(async (folder) => {
            try {
              const folderText = [folder.name, folder.description].filter(Boolean).join(' - ');

              const { vector, model } = await folderMatcher.embedText(folderText);
              const folderId = folder.id || folderMatcher.generateFolderId(folder);

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

        // Optimization: Use batch upsert instead of individual operations
        const count = await chromaDbService.batchUpsertFolders(validPayloads);

        return { success: true, folders: count };
      } catch (e) {
        logger.error('[EMBEDDINGS] Rebuild folders failed:', e);
        return { success: false, error: e.message };
      }
    })
  );

  ipcMain.handle(
    IPC_CHANNELS.EMBEDDINGS.REBUILD_FILES,
    withErrorLogging(logger, async () => {
      // CRITICAL FIX: Wait for initialization before executing
      try {
        await ensureInitialized();
      } catch (initError) {
        logger.warn('[EMBEDDINGS] ChromaDB not available:', initError.message);
        return {
          success: false,
          error: 'ChromaDB is not available. Please ensure the ChromaDB server is running.',
          unavailable: true
        };
      }

      // FIX: Check if initialization succeeded
      if (!isInitialized) {
        return {
          success: false,
          error: 'ChromaDB initialization pending. Please try again in a few seconds.',
          pending: true
        };
      }

      try {
        const serviceIntegration = getServiceIntegration && getServiceIntegration();
        const historyService = serviceIntegration?.analysisHistory;

        if (!historyService?.getRecentAnalysis) {
          return {
            success: false,
            error: 'Analysis history service unavailable'
          };
        }

        // Load all history entries (bounded by service defaults if any)
        const allEntries = await historyService.getRecentAnalysis(Number.MAX_SAFE_INTEGER);

        // FIX #17: Validate allEntries is an array to prevent crash
        if (!Array.isArray(allEntries)) {
          logger.warn('[EMBEDDINGS] getRecentAnalysis returned non-array:', typeof allEntries);
          return {
            success: false,
            error: 'Failed to load analysis history - invalid data format'
          };
        }

        const smartFolders = (
          typeof getCustomFolders === 'function' ? getCustomFolders() : []
        ).filter((f) => f && f.name);

        // Optimization: Batch process folder embeddings
        if (smartFolders.length > 0) {
          const folderPayloads = await Promise.all(
            smartFolders.map(async (folder) => {
              try {
                const folderText = [folder.name, folder.description].filter(Boolean).join(' - ');

                const { vector, model } = await folderMatcher.embedText(folderText);
                const folderId = folder.id || folderMatcher.generateFolderId(folder);

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
                logger.warn('[EMBEDDINGS] Failed to generate folder embedding:', folder.name);
                return null;
              }
            })
          );

          const validFolderPayloads = folderPayloads.filter((p) => p !== null);
          await chromaDbService.batchUpsertFolders(validFolderPayloads);
        }

        // Reset file vectors to rebuild from scratch
        await chromaDbService.resetFiles();

        // Optimization: Batch process file embeddings
        const filePayloads = [];
        for (const entry of allEntries) {
          try {
            const filePath = entry.originalPath;
            const ext = (path.extname(filePath) || '').toLowerCase();
            const isImage = SUPPORTED_IMAGE_EXTENSIONS.includes(ext);
            const fileId = `${isImage ? 'image' : 'file'}:${filePath}`;

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

            // Generate embedding
            const { vector, model } = await folderMatcher.embedText(summary);

            filePayloads.push({
              id: fileId,
              vector,
              model,
              meta: {
                path: filePath,
                name: path.basename(filePath),
                type: isImage ? 'image' : 'document'
              },
              updatedAt: new Date().toISOString()
            });
          } catch (e) {
            logger.warn('[EMBEDDINGS] Failed to prepare file entry:', e.message);
            // continue on individual entry failure
          }
        }

        // Optimization: Batch upsert all files at once (in chunks for large datasets)
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

        return { success: true, files: rebuilt };
      } catch (e) {
        logger.error('[EMBEDDINGS] Rebuild files failed:', e);
        return { success: false, error: e.message };
      }
    })
  );

  ipcMain.handle(
    IPC_CHANNELS.EMBEDDINGS.CLEAR_STORE,
    withErrorLogging(logger, async () => {
      // CRITICAL FIX: Wait for initialization before executing
      try {
        await ensureInitialized();
      } catch (initError) {
        return {
          success: false,
          error: 'ChromaDB is not available.',
          unavailable: true
        };
      }
      if (!isInitialized) {
        return {
          success: false,
          error: 'ChromaDB initialization pending.',
          pending: true
        };
      }

      try {
        await chromaDbService.resetAll();
        return { success: true };
      } catch (e) {
        return { success: false, error: e.message };
      }
    })
  );

  // New endpoint for getting vector DB statistics
  ipcMain.handle(
    IPC_CHANNELS.EMBEDDINGS.GET_STATS,
    withErrorLogging(logger, async () => {
      // CRITICAL FIX: Wait for initialization before executing
      try {
        await ensureInitialized();
      } catch (initError) {
        return {
          success: false,
          error: 'ChromaDB is not available.',
          unavailable: true
        };
      }
      if (!isInitialized) {
        return {
          success: false,
          error: 'ChromaDB initialization pending.',
          pending: true
        };
      }

      try {
        const stats = await chromaDbService.getStats();
        return { success: true, ...stats };
      } catch (e) {
        return { success: false, error: e.message };
      }
    })
  );

  // New endpoint for finding similar documents
  ipcMain.handle(
    IPC_CHANNELS.EMBEDDINGS.FIND_SIMILAR,
    withErrorLogging(logger, async (event, { fileId, topK = 10 }) => {
      // CRITICAL FIX: Wait for initialization before executing
      try {
        await ensureInitialized();
      } catch (initError) {
        return {
          success: false,
          error: 'ChromaDB is not available.',
          unavailable: true
        };
      }
      if (!isInitialized) {
        return {
          success: false,
          error: 'ChromaDB initialization pending.',
          pending: true
        };
      }

      // HIGH PRIORITY FIX: Add timeout and validation (addresses HIGH-11)
      const QUERY_TIMEOUT = TIMEOUTS.SEMANTIC_QUERY;
      const MAX_TOP_K = LIMITS.MAX_TOP_K;

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

  // Cleanup on app quit - FIX #15: Use once() to prevent multiple listener registration
  const { app } = require('electron');
  app.once('before-quit', async () => {
    try {
      await chromaDbService.cleanup();
    } catch (error) {
      logger.error('[ChromaDB] Cleanup error:', error);
    }
  });
}

module.exports = registerEmbeddingsIpc;
