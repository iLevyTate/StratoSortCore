const { getInstance: getChromaDB } = require('../services/chromadb');
const { getInstance: getFolderMatcher } = require('../services/FolderMatchingService');
const {
  getInstance: getParallelEmbeddingService
} = require('../services/ParallelEmbeddingService');
const { SearchService } = require('../services/SearchService');
const { ClusteringService } = require('../services/ClusteringService');
const path = require('path');
const { SUPPORTED_IMAGE_EXTENSIONS } = require('../../shared/constants');
const {
  BATCH,
  TIMEOUTS,
  LIMITS,
  SEARCH,
  THRESHOLDS
} = require('../../shared/performanceConstants');
const { withErrorLogging, withChromaInit } = require('./ipcWrappers');
const { cosineSimilarity } = require('../../shared/vectorMath');

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

  /**
   * Ensures services are initialized before IPC handlers execute
   * FIX: Uses state machine to prevent race conditions during initialization
   * @returns {Promise<void>}
   */
  async function ensureInitialized() {
    // Already initialized successfully
    if (initState === INIT_STATES.COMPLETED) {
      return Promise.resolve();
    }

    // Previously failed - allow retry by resetting state
    if (initState === INIT_STATES.FAILED) {
      logger.info('[SEMANTIC] Previous initialization failed, retrying...');
      initState = INIT_STATES.PENDING;
      initPromise = null;
    }

    // Initialization in progress - wait for it
    if (initState === INIT_STATES.IN_PROGRESS && initPromise) {
      return initPromise;
    }

    // Start new initialization
    initState = INIT_STATES.IN_PROGRESS;

    initPromise = (async () => {
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
          initState = INIT_STATES.COMPLETED;

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
  ipcMain.handle(
    IPC_CHANNELS.EMBEDDINGS.REBUILD_FOLDERS,
    createChromaHandler(async () => {
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
    createChromaHandler(async () => {
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

            // Use renamed name if available, otherwise fall back to original basename
            const displayName = entry.organization?.newName || path.basename(filePath);

            filePayloads.push({
              id: fileId,
              vector,
              model,
              meta: {
                path: filePath,
                name: displayName,
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
  ipcMain.handle(
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
    createChromaHandler(async (event, { fileId, topK = SEARCH.DEFAULT_TOP_K_SIMILAR }) => {
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
  // Uses SearchService.hybridSearch for combined BM25 + vector search with RRF fusion
  ipcMain.handle(
    IPC_CHANNELS.EMBEDDINGS.SEARCH,
    createChromaHandler(
      async (event, { query, topK = SEARCH.DEFAULT_TOP_K, mode = 'hybrid', minScore } = {}) => {
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

          // Use SearchService for hybrid BM25 + vector search with quality filtering
          const service = getSearchService();
          const searchOptions = {
            topK,
            mode, // 'hybrid', 'vector', or 'bm25'
            ...(typeof minScore === 'number' && { minScore })
          };

          const result = await service.hybridSearch(cleanQuery, searchOptions);

          if (!result.success) {
            return {
              success: false,
              error: result.error || 'Search failed'
            };
          }

          return {
            success: true,
            results: result.results,
            mode: result.mode,
            meta: result.meta
          };
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
      }
    )
  );

  // Score a subset of file IDs against a query (for "search within graph")
  ipcMain.handle(
    IPC_CHANNELS.EMBEDDINGS.SCORE_FILES,
    createChromaHandler(async (event, { query, fileIds } = {}) => {
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

  // NOTE: HYBRID_SEARCH handler removed - use SEARCH handler instead
  // The SEARCH handler now uses SearchService.hybridSearch() internally
  // with full support for mode: 'hybrid' | 'vector' | 'bm25'

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
  ipcMain.handle(
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
        const crossClusterEdges = service.findCrossClusterEdges(THRESHOLDS.SIMILARITY_EDGE_DEFAULT);

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

          const service = getClusteringService();
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
