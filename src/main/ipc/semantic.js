const { getInstance: getChromaDB } = require('../services/chromadb');
const FolderMatchingService = require('../services/FolderMatchingService');
const {
  getInstance: getParallelEmbeddingService
} = require('../services/ParallelEmbeddingService');
const { SearchService } = require('../services/SearchService');
const { ClusteringService } = require('../services/ClusteringService');
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

  // SearchService will be initialized lazily when needed
  let searchService = null;
  let clusteringService = null;

  function getSearchService() {
    if (!searchService) {
      const serviceIntegration = getServiceIntegration && getServiceIntegration();
      const historyService = serviceIntegration?.analysisHistory;
      const embeddingService = getParallelEmbeddingService();

      searchService = new SearchService({
        chromaDbService,
        analysisHistoryService: historyService,
        parallelEmbeddingService: embeddingService
      });
    }
    return searchService;
  }

  function getClusteringService() {
    if (!clusteringService) {
      const serviceIntegration = getServiceIntegration && getServiceIntegration();
      const ollamaService = serviceIntegration?.ollamaService;

      clusteringService = new ClusteringService({
        chromaDbService,
        ollamaService
      });
    }
    return clusteringService;
  }

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

          // Warm up search service in background (non-blocking)
          // This pre-builds the BM25 index for faster first search
          setImmediate(() => {
            try {
              const searchSvc = getSearchService();
              searchSvc.warmUp({ buildBM25: true, warmChroma: false }).catch((warmErr) => {
                logger.debug('[SEMANTIC] Search warm-up skipped:', warmErr.message);
              });
            } catch (warmErr) {
              logger.debug('[SEMANTIC] Search warm-up init skipped:', warmErr.message);
            }
          });

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

  /**
   * Rebuild folder embeddings from current smart folders
   * SAFE: Only resets the 'folder_embeddings' collection (not the entire DB directory).
   * This is a user-controlled, intentional rebuild that preserves all other data.
   */
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
        // SAFE: resetFolders() only deletes/recreates the collection, not the DB directory
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

  /**
   * Rebuild file embeddings from analysis history
   * SAFE: Only resets the 'file_embeddings' collection (not the entire DB directory).
   * This rebuilds the semantic search index from existing analysis history without
   * re-analyzing files. User-controlled and intentional.
   */
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

        // SAFE: resetFiles() only deletes/recreates the collection, not the DB directory
        // This rebuilds the search index from analysis history without re-analyzing files
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

        return {
          success: true,
          ...stats,
          analysisHistory,
          needsFileEmbeddingRebuild
        };
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

  // Global semantic search (query -> ranked files)
  ipcMain.handle(
    IPC_CHANNELS.EMBEDDINGS.SEARCH,
    withErrorLogging(logger, async (event, { query, topK = 20 } = {}) => {
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

      const QUERY_TIMEOUT = TIMEOUTS.SEMANTIC_QUERY;
      const MAX_TOP_K = LIMITS.MAX_TOP_K;

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

        // Create timeout promise
        let timeoutId;
        const timeoutPromise = new Promise((_, reject) => {
          timeoutId = setTimeout(() => reject(new Error('Query timeout exceeded')), QUERY_TIMEOUT);
        });

        try {
          const results = await Promise.race([
            (async () => {
              const embeddingService = getParallelEmbeddingService();
              const { vector } = await embeddingService.embedText(cleanQuery);
              return chromaDbService.querySimilarFiles(vector, topK);
            })(),
            timeoutPromise
          ]);

          return { success: true, results };
        } finally {
          if (timeoutId) clearTimeout(timeoutId);
        }
      } catch (e) {
        logger.error('[EMBEDDINGS] Search failed:', {
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

  function cosineSimilarity(a, b) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length === 0 || b.length === 0) return 0;
    const len = Math.min(a.length, b.length);
    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < len; i += 1) {
      const av = Number(a[i]) || 0;
      const bv = Number(b[i]) || 0;
      dot += av * bv;
      normA += av * av;
      normB += bv * bv;
    }
    if (normA === 0 || normB === 0) return 0;
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  // Score a subset of file IDs against a query (for "search within graph")
  ipcMain.handle(
    IPC_CHANNELS.EMBEDDINGS.SCORE_FILES,
    withErrorLogging(logger, async (event, { query, fileIds } = {}) => {
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

      const QUERY_TIMEOUT = TIMEOUTS.SEMANTIC_QUERY;

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
              const { vector: queryVector } = await embeddingService.embedText(cleanQuery);

              await chromaDbService.initialize();
              const fileResult = await chromaDbService.fileCollection.get({ ids: normalizedIds });

              const ids = Array.isArray(fileResult?.ids) ? fileResult.ids : [];
              const embeddings = Array.isArray(fileResult?.embeddings) ? fileResult.embeddings : [];

              const scores = [];
              for (let i = 0; i < ids.length; i += 1) {
                const vec = embeddings[i];
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

  /**
   * Perform hybrid search combining BM25 keyword search with vector similarity
   */
  ipcMain.handle(
    IPC_CHANNELS.EMBEDDINGS.HYBRID_SEARCH,
    withErrorLogging(logger, async (event, { query, options = {} } = {}) => {
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
        const service = getSearchService();
        const result = await service.hybridSearch(query, options);
        return result;
      } catch (e) {
        logger.error('[EMBEDDINGS] Hybrid search failed:', e);
        return { success: false, error: e.message };
      }
    })
  );

  /**
   * Rebuild the BM25 keyword search index
   */
  ipcMain.handle(
    IPC_CHANNELS.EMBEDDINGS.REBUILD_BM25_INDEX,
    withErrorLogging(logger, async () => {
      try {
        const service = getSearchService();
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
  ipcMain.handle(
    IPC_CHANNELS.EMBEDDINGS.GET_SEARCH_STATUS,
    withErrorLogging(logger, async () => {
      try {
        const service = getSearchService();
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
  ipcMain.handle(
    IPC_CHANNELS.EMBEDDINGS.FIND_MULTI_HOP,
    withErrorLogging(logger, async (event, { seedIds, options = {} } = {}) => {
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
  // Clustering Handlers (placeholder for ClusteringService)
  // ============================================================================

  /**
   * Compute semantic clusters of files
   */
  ipcMain.handle(
    IPC_CHANNELS.EMBEDDINGS.COMPUTE_CLUSTERS,
    withErrorLogging(logger, async (event, { k = 'auto', generateLabels = true } = {}) => {
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
        const service = getClusteringService();
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
        return { success: false, error: e.message };
      }
    })
  );

  /**
   * Get computed clusters
   */
  ipcMain.handle(
    IPC_CHANNELS.EMBEDDINGS.GET_CLUSTERS,
    withErrorLogging(logger, async () => {
      try {
        const service = getClusteringService();
        const clusters = service.getClustersForGraph();
        const crossClusterEdges = service.findCrossClusterEdges(0.5);

        return {
          success: true,
          clusters,
          crossClusterEdges,
          stale: service.isClustersStale()
        };
      } catch (e) {
        logger.error('[EMBEDDINGS] Get clusters failed:', e);
        return { success: false, error: e.message };
      }
    })
  );

  /**
   * Get members of a specific cluster
   */
  ipcMain.handle(
    IPC_CHANNELS.EMBEDDINGS.GET_CLUSTER_MEMBERS,
    withErrorLogging(logger, async (event, { clusterId } = {}) => {
      try {
        if (typeof clusterId !== 'number') {
          return { success: false, error: 'clusterId must be a number' };
        }

        const service = getClusteringService();
        // Now async - fetches fresh metadata from ChromaDB
        const members = await service.getClusterMembers(clusterId);

        return {
          success: true,
          clusterId,
          members
        };
      } catch (e) {
        logger.error('[EMBEDDINGS] Get cluster members failed:', e);
        return { success: false, error: e.message };
      }
    })
  );

  /**
   * Get similarity edges between files for graph visualization
   */
  ipcMain.handle(
    IPC_CHANNELS.EMBEDDINGS.GET_SIMILARITY_EDGES,
    withErrorLogging(
      logger,
      async (event, { fileIds, threshold = 0.5, maxEdgesPerNode = 3 } = {}) => {
        try {
          if (!Array.isArray(fileIds) || fileIds.length < 2) {
            return { success: true, edges: [] };
          }

          const service = getClusteringService();
          const edges = await service.findFileSimilarityEdges(fileIds, {
            threshold,
            maxEdgesPerNode
          });

          return {
            success: true,
            edges
          };
        } catch (e) {
          logger.error('[EMBEDDINGS] Get similarity edges failed:', e);
          return { success: false, error: e.message, edges: [] };
        }
      }
    )
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
