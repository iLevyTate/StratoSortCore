const AnalysisHistoryService = require('./analysisHistory');
const UndoRedoService = require('./UndoRedoService');
const ProcessingStateService = require('./ProcessingStateService');
const FolderMatchingService = require('./FolderMatchingService');
const OrganizationSuggestionService = require('./organization');
const AutoOrganizeService = require('./autoOrganize');
const EmbeddingCache = require('./EmbeddingCache');
const SmartFolderWatcher = require('./SmartFolderWatcher');
const NotificationService = require('./NotificationService');
const { container, ServiceIds, SHUTDOWN_ORDER } = require('./ServiceContainer');
const { getCanonicalFileId } = require('../../shared/pathSanitization');
const { createLogger } = require('../../shared/logger');

const logger = createLogger('ServiceIntegration');

function throwIfAborted(signal, phase) {
  if (signal?.aborted) {
    const reason =
      signal.reason instanceof Error
        ? signal.reason.message
        : typeof signal.reason === 'string'
          ? signal.reason
          : 'Aborted';
    throw new Error(`[ServiceIntegration] Aborted during ${phase}: ${reason}`);
  }
}
/**
 * FIX: Explicit service initialization order with dependencies
 * This makes the initialization sequence clear and documentable.
 * Services are grouped by dependency tier:
 * - Tier 0: No dependencies (can init in parallel)
 * - Tier 1: Depends on vector DB services
 * - Tier 2: Depends on Tier 0/1 services
 */
const SERVICE_INITIALIZATION_ORDER = {
  // Tier 0: Independent services (can init in parallel)
  tier0: ['analysisHistory', 'undoRedo', 'processingState', 'chatHistoryStore'],
  // Tier 1: Vector DB (in-process Orama - no external server needed)
  tier1: ['vectorDb'],
  // Tier 2: Services that depend on Vector DB
  tier2: ['folderMatching']
};

/**
 * ServiceIntegration - Central service orchestration and lifecycle management
 *
 * This class manages the initialization, lifecycle, and coordination of all
 * application services. It uses the ServiceContainer for dependency injection
 * and provides a centralized point for service access.
 *
 * The class supports two modes of operation:
 * 1. Instance-based: Traditional approach where services are stored as instance properties
 * 2. Container-based: Modern DI approach using the ServiceContainer
 *
 * @example
 * // Using ServiceIntegration
 * const integration = new ServiceIntegration();
 * await integration.initialize();
 *
 * // Access services via instance properties (backward compatible)
 * const vectorDb = integration.vectorService;
 *
 * // Or via the container (recommended for new code)
 * const vectorDb = container.resolve(ServiceIds.ORAMA_VECTOR);
 */
class ServiceIntegration {
  constructor() {
    this.analysisHistory = null;
    this.undoRedo = null;
    this.processingState = null;
    this.vectorService = null; // OramaVectorService (in-process)
    this.folderMatchingService = null;
    this.suggestionService = null;
    this.autoOrganizeService = null;
    this.smartFolderWatcher = null;
    this.relationshipIndex = null;
    this.initialized = false;

    // FIX: Register all services in constructor so they exist even when initialize() never runs
    // (e.g. degraded mode after startup timeout). Handlers like GET_CLUSTERS will then resolve
    // 'clustering' successfully; individual services may remain uninitialized until first use.
    this._registerCoreServices();

    // FIX: Add initialization mutex to prevent race conditions
    // Multiple concurrent initialize() calls would previously both pass the
    // if (this.initialized) check and run in parallel, causing undefined behavior
    this._initPromise = null;

    // Track last initialization outcome for debugging/telemetry
    this._lastInitStatus = null;
    this._lastInitError = null;

    // Reference to the container for external access
    this.container = container;
  }

  /**
   * Backward-compatible alias.
   * Many legacy call sites (including some IPC registrars) still look for `vectorDbService`.
   * In the Orama migration the instance is stored on `vectorService`.
   */
  get vectorDbService() {
    return this.vectorService;
  }

  /**
   * Additional alias for older code that expects `vectorDb`.
   */
  get vectorDb() {
    return this.vectorService;
  }

  /**
   * Initialize all services
   *
   * This method initializes all services in the correct order, respecting
   * their dependencies. It registers services with the container and
   * stores references for backward compatibility.
   *
   * @param {Object} [options={}] - Initialization options
   * @param {Object} [options.startupResult] - Result from StartupManager.startup() to skip redundant checks
   * @returns {Promise<{initialized: string[], errors: Array<{service: string, error: string}>, skipped: string[]}>}
   */
  async initialize(options = {}) {
    // FIX: Return existing initialization promise if one is in progress
    // This prevents race conditions when multiple calls happen concurrently
    if (this._initPromise) {
      return this._initPromise;
    }

    if (this.initialized) {
      return { initialized: [], errors: [], skipped: [], alreadyInitialized: true };
    }

    // FIX: Store the initialization promise so concurrent calls can await it
    this._initPromise = this._doInitialize(options);
    try {
      return await this._initPromise;
    } finally {
      // Clear the promise after initialization completes (success or failure)
      this._initPromise = null;
    }
  }

  /**
   * Internal initialization implementation
   * @param {Object} [options={}] - Initialization options
   * @param {Object} [options.startupResult] - Result from StartupManager.startup()
   * @private
   */
  async _doInitialize(options = {}) {
    const { signal } = options;
    throwIfAborted(signal, 'initialization setup');
    logger.info('[ServiceIntegration] Starting initialization...');

    // FIX L3: Clear stale init status from any previous initialization attempts
    this._lastInitStatus = null;
    this._lastInitError = null;

    // Track initialization status for each service (returned to callers)
    const initStatus = {
      initialized: [],
      errors: [],
      skipped: []
    };

    try {
      // Register core services with the container
      this._registerCoreServices();
      throwIfAborted(signal, 'service registration');

      // Initialize core services
      this.analysisHistory = container.resolve(ServiceIds.ANALYSIS_HISTORY);
      this.undoRedo = container.resolve(ServiceIds.UNDO_REDO);
      this.processingState = container.resolve(ServiceIds.PROCESSING_STATE);
      this.relationshipIndex = container.resolve(ServiceIds.RELATIONSHIP_INDEX);
      this.chatHistoryStore = container.tryResolve(ServiceIds.CHAT_HISTORY_STORE);

      // Initialize vector service and folder matching
      this.vectorService = container.resolve(ServiceIds.ORAMA_VECTOR);
      if (!this.vectorService) {
        logger.warn(
          '[ServiceIntegration] Vector service is null, some features will be unavailable'
        );
      }

      this.folderMatchingService = container.resolve(ServiceIds.FOLDER_MATCHING);

      // Initialize suggestion service
      const settingsService = container.resolve(ServiceIds.SETTINGS);
      if (!settingsService) {
        logger.warn('[ServiceIntegration] Settings service is null, using defaults');
      }

      this.suggestionService = container.resolve(ServiceIds.ORGANIZATION_SUGGESTION);

      // Initialize auto-organize service
      this.autoOrganizeService = container.resolve(ServiceIds.AUTO_ORGANIZE);
      throwIfAborted(signal, 'service resolution');

      // Vector DB availability check
      // OramaVectorService is in-process, so it's always available (no external server)
      // Only need to check if the service exists
      const { startupResult } = options;
      let isVectorDbReady = !!this.vectorService;
      let skipVectorInit = false;

      if (startupResult?.services?.vectorDb) {
        const vectorStatus = startupResult.services.vectorDb;
        const wasRunning =
          vectorStatus.status === 'running' ||
          vectorStatus.status === 'online' ||
          vectorStatus.success;
        const failed =
          vectorStatus.status === 'failed' ||
          vectorStatus.status === 'error' ||
          vectorStatus.success === false;

        if (wasRunning) {
          isVectorDbReady = true;
          skipVectorInit = true;
          logger.debug('[ServiceIntegration] Using startupResult - vector DB already initialized');
        } else if (failed) {
          isVectorDbReady = false;
          logger.warn(
            '[ServiceIntegration] startupResult indicates vector DB failed to initialize'
          );
        }
      }

      if (!isVectorDbReady) {
        logger.warn(
          '[ServiceIntegration] Vector service is not available. Running in degraded mode.'
        );
      }

      // FIX: Tiered initialization with explicit dependency ordering
      // Tier 0: Initialize independent services in parallel
      throwIfAborted(signal, 'tier0 initialization');
      const tier0Results = await Promise.allSettled([
        this.analysisHistory.initialize(),
        this.undoRedo.initialize(),
        this.processingState.initialize(),
        this.chatHistoryStore ? this.chatHistoryStore.initialize() : Promise.resolve()
      ]);
      throwIfAborted(signal, 'tier0 initialization');

      // Process Tier 0 results
      SERVICE_INITIALIZATION_ORDER.tier0.forEach((name, index) => {
        const result = tier0Results[index];
        if (result.status === 'fulfilled') {
          initStatus.initialized.push(name);
        } else {
          initStatus.errors.push({
            service: name,
            error: result.reason?.message || String(result.reason)
          });
          logger.error(
            `[ServiceIntegration] ${name} initialization failed:`,
            result.reason?.message
          );
        }
      });

      // Tier 1: Initialize Vector DB (OramaVectorService is in-process, always available)
      if (isVectorDbReady && this.vectorService) {
        try {
          throwIfAborted(signal, 'vectorDb initialization');
          if (!skipVectorInit) {
            await this.vectorService.initialize();
          }
          throwIfAborted(signal, 'vectorDb initialization');
          initStatus.initialized.push('vectorDb');

          // Wire up cascade orphan marking when analysis entries are removed
          // This ensures embeddings and chunks are marked orphaned when their analysis entry is pruned
          if (this.analysisHistory && this.vectorService) {
            this.analysisHistory.setOnEntriesRemovedCallback(async (removedEntries) => {
              if (!removedEntries || removedEntries.length === 0) return;

              // Embeddings are stored under semantic IDs (file:/image: + path), not analysis-history UUIDs.
              // Use the most current known path when available (actualPath), otherwise fall back to originalPath.
              const path = require('path');
              const { SUPPORTED_IMAGE_EXTENSIONS } = require('../../shared/constants');

              const fileIds = Array.from(
                new Set(
                  removedEntries
                    .map((e) => e?.actualPath || e?.originalPath)
                    .filter((p) => typeof p === 'string' && p.length > 0)
                    .map((p) => {
                      const ext = (path.extname(p) || '').toLowerCase();
                      const isImage = SUPPORTED_IMAGE_EXTENSIONS.includes(ext);
                      return getCanonicalFileId(p, isImage);
                    })
                )
              );
              logger.debug('[ServiceIntegration] Marking orphaned embeddings for pruned entries', {
                count: fileIds.length
              });

              try {
                const result = await this.vectorService.markEmbeddingsOrphaned(fileIds);
                logger.info('[ServiceIntegration] Cascade orphan marking complete', {
                  fileEmbeddings: result?.marked || 0,
                  failed: result?.failed || 0
                });
              } catch (error) {
                logger.warn('[ServiceIntegration] Cascade orphan marking failed:', {
                  error: error.message,
                  fileIds: fileIds.length
                });
              }
            });
          }
        } catch (error) {
          const errorMsg = error?.message || String(error);
          initStatus.errors.push({ service: 'vectorDb', error: errorMsg });
          logger.error('[ServiceIntegration] Vector DB initialization failed:', errorMsg);
          isVectorDbReady = false; // Prevent dependent services from initializing
        }
      } else {
        initStatus.skipped.push('vectorDb');
        logger.warn(
          '[ServiceIntegration] Vector DB initialization skipped - service not available'
        );
      }

      // Tier 2: Initialize services that depend on Vector DB
      // FolderMatchingService depends on vector DB for vector operations
      if (this.folderMatchingService && isVectorDbReady) {
        try {
          throwIfAborted(signal, 'folderMatching initialization');
          await this.folderMatchingService.initialize();
          throwIfAborted(signal, 'folderMatching initialization');
          initStatus.initialized.push('folderMatching');
        } catch (error) {
          const errorMsg = error?.message || String(error);
          initStatus.errors.push({ service: 'folderMatching', error: errorMsg });
          logger.warn(
            '[ServiceIntegration] FolderMatchingService initialization failed:',
            errorMsg
          );
          // Non-fatal - continue with degraded functionality
        }
      } else if (this.folderMatchingService) {
        initStatus.skipped.push('folderMatching');
        logger.warn('[ServiceIntegration] FolderMatchingService skipped - Vector DB not available');
      }

      // Log initialization summary
      logger.info('[ServiceIntegration] Initialization complete', {
        initialized: initStatus.initialized.length,
        errors: initStatus.errors.length,
        skipped: initStatus.skipped.length
      });

      // Only consider the integration "initialized" if Tier 0 (core) services succeeded.
      // Other services can fail and the app can run in degraded mode.
      const criticalTier0Failures = initStatus.errors.filter((e) =>
        SERVICE_INITIALIZATION_ORDER.tier0.includes(e.service)
      );
      const success = criticalTier0Failures.length === 0;
      this.initialized = success;
      this._lastInitStatus = initStatus;
      this._lastInitError = success ? null : criticalTier0Failures.map((e) => e.error).join('; ');

      if (!success) {
        logger.error('[ServiceIntegration] Initialization failed for core services', {
          failures: criticalTier0Failures
        });
      }

      // FIX: Return structured initialization status for callers to inspect
      return { ...initStatus, success };
    } catch (error) {
      const errorMsg = error?.message || String(error);
      logger.error(
        '[ServiceIntegration] Initialization aborted due to unexpected error:',
        errorMsg
      );
      this.initialized = false;
      initStatus.errors.push({ service: 'serviceIntegration', error: errorMsg });
      this._lastInitStatus = initStatus;
      this._lastInitError = errorMsg;
      return { ...initStatus, success: false };
    }
  }

  /**
   * Register core services with the dependency injection container
   *
   * This method sets up the service registrations in the container,
   * defining how each service should be created and what dependencies
   * it requires.
   *
   * @private
   */
  _registerCoreServices() {
    const { getInstance: getSettingsService } = require('./SettingsService');

    // Register settings service (singleton from existing factory)
    if (!container.has(ServiceIds.SETTINGS)) {
      container.registerSingleton(ServiceIds.SETTINGS, () => {
        return getSettingsService();
      });
    }

    // Register OramaVectorService (in-process vector DB)
    if (!container.has(ServiceIds.ORAMA_VECTOR)) {
      const { registerWithContainer: registerOramaVector } = require('./OramaVectorService');
      registerOramaVector(container, ServiceIds.ORAMA_VECTOR);
    }

    // Register state management services
    if (!container.has(ServiceIds.ANALYSIS_HISTORY)) {
      container.registerSingleton(ServiceIds.ANALYSIS_HISTORY, () => {
        return new AnalysisHistoryService();
      });
    }

    if (!container.has(ServiceIds.UNDO_REDO)) {
      container.registerSingleton(ServiceIds.UNDO_REDO, () => {
        return new UndoRedoService();
      });
    }

    if (!container.has(ServiceIds.PROCESSING_STATE)) {
      container.registerSingleton(ServiceIds.PROCESSING_STATE, () => {
        return new ProcessingStateService();
      });
    }

    if (!container.has(ServiceIds.CHAT_HISTORY_STORE)) {
      container.registerSingleton(ServiceIds.CHAT_HISTORY_STORE, () => {
        const { ChatHistoryStore } = require('./ChatHistoryStore');
        return new ChatHistoryStore();
      });
    }

    // Register folder matching service (depends on vector DB)
    if (!container.has(ServiceIds.FOLDER_MATCHING)) {
      container.registerSingleton(ServiceIds.FOLDER_MATCHING, (c) => {
        const vectorDb = c.resolve(ServiceIds.ORAMA_VECTOR);
        return new FolderMatchingService(vectorDb);
      });
    }

    if (!container.has(ServiceIds.RELATIONSHIP_INDEX)) {
      container.registerSingleton(ServiceIds.RELATIONSHIP_INDEX, (c) => {
        const RelationshipIndexService = require('./RelationshipIndexService');
        return new RelationshipIndexService({
          analysisHistoryService: c.resolve(ServiceIds.ANALYSIS_HISTORY)
        });
      });
    }

    // FIX: Register ClusteringService as separate DI entry to avoid circular dependency
    // This allows other services to depend on ClusteringService independently
    if (!container.has(ServiceIds.CLUSTERING)) {
      container.registerSingleton(ServiceIds.CLUSTERING, (c) => {
        const { ClusteringService } = require('./ClusteringService');
        const vectorDbService = c.resolve(ServiceIds.ORAMA_VECTOR);
        const { getInstance: getLlamaInstance } = require('./LlamaService');
        const llamaService = getLlamaInstance();

        return new ClusteringService({
          vectorDbService,
          llamaService
        });
      });
    }

    // Register organization suggestion service (depends on vector DB, FolderMatching, Settings, Clustering)
    if (!container.has(ServiceIds.ORGANIZATION_SUGGESTION)) {
      container.registerSingleton(ServiceIds.ORGANIZATION_SUGGESTION, (c) => {
        const settingsService = c.resolve(ServiceIds.SETTINGS);
        return new OrganizationSuggestionService({
          vectorDbService: c.resolve(ServiceIds.ORAMA_VECTOR),
          folderMatchingService: c.resolve(ServiceIds.FOLDER_MATCHING),
          settingsService: settingsService,
          // FIX: Use lazy resolution with getter to break potential circular dependency
          // This allows ClusteringService to be resolved when first needed, not during registration
          getClusteringService: () => c.resolve(ServiceIds.CLUSTERING),
          config: {
            enableLearningSync: false
          }
        });
      });
    }

    // Register auto-organize service (depends on multiple services)
    if (!container.has(ServiceIds.AUTO_ORGANIZE)) {
      container.registerSingleton(ServiceIds.AUTO_ORGANIZE, (c) => {
        return new AutoOrganizeService({
          suggestionService: c.resolve(ServiceIds.ORGANIZATION_SUGGESTION),
          settingsService: c.resolve(ServiceIds.SETTINGS),
          folderMatchingService: c.resolve(ServiceIds.FOLDER_MATCHING),
          undoRedoService: c.resolve(ServiceIds.UNDO_REDO)
        });
      });
    }

    // Register learning feedback service (records implicit organization patterns)
    // This service learns from file placements in smart folders
    if (!container.has(ServiceIds.LEARNING_FEEDBACK)) {
      container.registerSingleton(ServiceIds.LEARNING_FEEDBACK, (c) => {
        const { LearningFeedbackService } = require('./organization/learningFeedback');
        return new LearningFeedbackService({
          suggestionService: c.resolve(ServiceIds.ORGANIZATION_SUGGESTION),
          getSmartFolders: () => [] // Will be updated during app init
        });
      });
    }

    // Register AI/Embedding services
    // New in-process LlamaService (node-llama-cpp)
    if (!container.has(ServiceIds.VISION_SERVICE)) {
      const { registerWithContainer: registerVisionService } = require('./VisionService');
      registerVisionService(container, ServiceIds.VISION_SERVICE);
    }

    if (!container.has(ServiceIds.LLAMA_SERVICE)) {
      const { registerWithContainer: registerLlamaService } = require('./LlamaService');
      registerLlamaService(container, ServiceIds.LLAMA_SERVICE);
    }

    if (!container.has(ServiceIds.EMBEDDING_CACHE)) {
      container.registerSingleton(ServiceIds.EMBEDDING_CACHE, () => {
        return new EmbeddingCache();
      });
    }

    if (!container.has(ServiceIds.PARALLEL_EMBEDDING)) {
      const {
        registerWithContainer: registerParallelEmbedding
      } = require('./ParallelEmbeddingService');
      registerParallelEmbedding(container, ServiceIds.PARALLEL_EMBEDDING);
    }

    // Register ModelManager
    if (!container.has(ServiceIds.MODEL_MANAGER)) {
      const { registerWithContainer: registerModelManager } = require('./ModelManager');
      registerModelManager(container, ServiceIds.MODEL_MANAGER);
    }

    // Register ModelDownloadManager (singleton via existing factory)
    if (!container.has(ServiceIds.MODEL_DOWNLOAD_MANAGER)) {
      container.registerSingleton(ServiceIds.MODEL_DOWNLOAD_MANAGER, () => {
        const { getInstance } = require('./ModelDownloadManager');
        return getInstance();
      });
    }

    // Register AnalysisCacheService
    if (!container.has(ServiceIds.ANALYSIS_CACHE)) {
      const { registerWithContainer: registerAnalysisCache } = require('./AnalysisCacheService');
      registerAnalysisCache(container, ServiceIds.ANALYSIS_CACHE);
    }

    // Register FileAccessPolicy
    if (!container.has(ServiceIds.FILE_ACCESS_POLICY)) {
      const { registerWithContainer: registerFileAccessPolicy } = require('./FileAccessPolicy');
      registerFileAccessPolicy(container, ServiceIds.FILE_ACCESS_POLICY);
    }

    // Register CacheInvalidationBus (used by all caches for coordinated invalidation)
    if (!container.has(ServiceIds.CACHE_INVALIDATION_BUS)) {
      container.registerSingleton(ServiceIds.CACHE_INVALIDATION_BUS, () => {
        const { getInstance: getCacheInvalidationBus } = require('../../shared/cacheInvalidation');
        return getCacheInvalidationBus();
      });
    }

    // Register FilePathCoordinator (coordinates all path-dependent systems)
    if (!container.has(ServiceIds.FILE_PATH_COORDINATOR)) {
      container.registerSingleton(ServiceIds.FILE_PATH_COORDINATOR, (c) => {
        const { FilePathCoordinator } = require('./FilePathCoordinator');
        const coordinator = new FilePathCoordinator();

        // Wire up services lazily to avoid circular dependencies
        // Services are set after initial construction
        const vectorDb = c.tryResolve(ServiceIds.ORAMA_VECTOR);
        const analysisHistory = c.tryResolve(ServiceIds.ANALYSIS_HISTORY);
        const processingState = c.tryResolve(ServiceIds.PROCESSING_STATE);
        const cacheInvalidationBus = c.tryResolve(ServiceIds.CACHE_INVALIDATION_BUS);

        // EmbeddingQueue is not in the container, use direct require.
        // Use the queue manager so path updates apply to all staged queues.
        let embeddingQueue = null;
        try {
          embeddingQueue = require('../analysis/embeddingQueue/queueManager');
        } catch {
          logger.debug('[ServiceIntegration] EmbeddingQueue not available for FilePathCoordinator');
        }

        coordinator.setServices({
          vectorDbService: vectorDb,
          analysisHistoryService: analysisHistory,
          embeddingQueue,
          processingStateService: processingState,
          cacheInvalidationBus
        });

        return coordinator;
      });
    }

    // Register NotificationService (used by watchers for user feedback)
    if (!container.has(ServiceIds.NOTIFICATION_SERVICE)) {
      container.registerSingleton(ServiceIds.NOTIFICATION_SERVICE, (c) => {
        const settingsService = c.resolve(ServiceIds.SETTINGS);
        return new NotificationService({ settingsService });
      });
    }

    // Register SmartFolderWatcher (depends on multiple services)
    // This watcher auto-analyzes files when they are added to or modified in smart folders
    if (!container.has(ServiceIds.SMART_FOLDER_WATCHER)) {
      container.registerSingleton(ServiceIds.SMART_FOLDER_WATCHER, (c) => {
        // Get required dependencies
        const analysisHistoryService = c.resolve(ServiceIds.ANALYSIS_HISTORY);
        const settingsService = c.resolve(ServiceIds.SETTINGS);
        const vectorDbService = c.resolve(ServiceIds.ORAMA_VECTOR);
        const filePathCoordinator = c.resolve(ServiceIds.FILE_PATH_COORDINATOR);
        // FIX: Add folderMatcher for auto-embedding analyzed files into vector DB
        const folderMatcher = c.resolve(ServiceIds.FOLDER_MATCHING);
        const notificationService = c.resolve(ServiceIds.NOTIFICATION_SERVICE);

        // Get analysis functions - these are passed in during setup
        // They will be set via setAnalysisFunctions after service creation
        return new SmartFolderWatcher({
          getSmartFolders: () => [], // Will be set during app init
          analysisHistoryService,
          analyzeDocumentFile: null, // Will be set during app init
          analyzeImageFile: null, // Will be set during app init
          settingsService,
          vectorDbService,
          filePathCoordinator,
          folderMatcher, // FIX: Pass folderMatcher for immediate auto-embedding
          notificationService // For user feedback on file analysis
        });
      });
    }

    // FIX: Register SearchService with container for proper DI and lifecycle management
    // SearchService is a core feature service that was previously manually instantiated
    if (!container.has(ServiceIds.SEARCH_SERVICE)) {
      container.registerSingleton(ServiceIds.SEARCH_SERVICE, (c) => {
        const { SearchService } = require('./SearchService');
        return new SearchService({
          vectorDbService: c.resolve(ServiceIds.ORAMA_VECTOR),
          analysisHistoryService: c.resolve(ServiceIds.ANALYSIS_HISTORY),
          parallelEmbeddingService: c.resolve(ServiceIds.PARALLEL_EMBEDDING),
          llamaService: c.tryResolve(ServiceIds.LLAMA_SERVICE),
          relationshipIndexService: c.tryResolve(ServiceIds.RELATIONSHIP_INDEX),
          chatHistoryStore: c.tryResolve(ServiceIds.CHAT_HISTORY_STORE)
        });
      });
    }

    // FIX: Register DownloadWatcher with container for proper lifecycle management
    // DownloadWatcher monitors downloads folder and needs proper shutdown handling
    if (!container.has(ServiceIds.DOWNLOAD_WATCHER)) {
      container.registerSingleton(ServiceIds.DOWNLOAD_WATCHER, (c) => {
        const DownloadWatcher = require('./DownloadWatcher');
        return new DownloadWatcher({
          analyzeDocumentFile: null, // Set during app init via configureDownloadWatcher
          analyzeImageFile: null, // Set during app init via configureDownloadWatcher
          getCustomFolders: () => [], // Set during app init
          autoOrganizeService: c.resolve(ServiceIds.AUTO_ORGANIZE),
          settingsService: c.resolve(ServiceIds.SETTINGS),
          notificationService: c.resolve(ServiceIds.NOTIFICATION_SERVICE),
          analysisHistoryService: c.resolve(ServiceIds.ANALYSIS_HISTORY),
          vectorDbService: c.resolve(ServiceIds.ORAMA_VECTOR),
          folderMatcher: c.resolve(ServiceIds.FOLDER_MATCHING)
        });
      });
    }

    logger.info('[ServiceIntegration] Core services registered with container');
  }

  /**
   * Shutdown all services and cleanup resources
   *
   * This method shuts down all services in the reverse order of initialization,
   * ensuring that dependent services are stopped before their dependencies.
   * It uses both the legacy shutdown approach and the container's shutdown.
   *
   * @returns {Promise<void>}
   */
  async shutdown() {
    // FIX: Wait for any in-progress initialization to complete before shutting down
    // This prevents race conditions where shutdown runs concurrently with init
    if (this._initPromise) {
      logger.debug(
        '[ServiceIntegration] Waiting for initialization to complete before shutdown...'
      );
      try {
        await this._initPromise;
      } catch {
        // Ignore init errors - we're shutting down anyway
      }
    }

    if (!this.initialized) return;

    try {
      logger.info('[ServiceIntegration] Starting coordinated shutdown...');

      // Clear orphan marking callback before nulling services
      // This callback holds closures to vectorService, preventing garbage collection
      if (this.analysisHistory?.setOnEntriesRemovedCallback) {
        this.analysisHistory.setOnEntriesRemovedCallback(null);
      }

      // Use the container's shutdown with explicit shutdown order
      // This ensures dependent services are stopped before their dependencies
      await container.shutdown(SHUTDOWN_ORDER);

      // Clear all service references
      this.analysisHistory = null;
      this.undoRedo = null;
      this.processingState = null;
      this.vectorService = null;
      this.folderMatchingService = null;
      this.suggestionService = null;
      this.autoOrganizeService = null;
      // Also clear SmartFolderWatcher reference to prevent memory leaks
      this.smartFolderWatcher = null;
      this.relationshipIndex = null;
      this.chatHistoryStore = null;
      this.initialized = false;

      logger.info('[ServiceIntegration] All services shut down successfully');
    } catch (error) {
      logger.error('[ServiceIntegration] Error during shutdown', {
        error: error?.message || String(error)
      });
    }
  }

  /**
   * Get a service from the container by its ID
   *
   * @param {string} serviceId - The service identifier (from ServiceIds)
   * @returns {*} The resolved service instance
   */
  getService(serviceId) {
    return container.resolve(serviceId);
  }

  /**
   * Check if a service is available
   *
   * @param {string} serviceId - The service identifier
   * @returns {boolean} True if the service is registered and available
   */
  hasService(serviceId) {
    return container.has(serviceId);
  }

  /**
   * Configure the SmartFolderWatcher with required dependencies
   * This must be called after the main process has set up analysis functions
   *
   * @param {Object} config - Configuration object
   * @param {Function} config.getSmartFolders - Function to get current smart folders
   * @param {Function} config.analyzeDocumentFile - Function to analyze documents
   * @param {Function} config.analyzeImageFile - Function to analyze images
   */
  configureSmartFolderWatcher({ getSmartFolders, analyzeDocumentFile, analyzeImageFile }) {
    try {
      this.smartFolderWatcher = container.resolve(ServiceIds.SMART_FOLDER_WATCHER);

      if (this.smartFolderWatcher) {
        // Update the watcher's dependencies
        this.smartFolderWatcher.getSmartFolders = getSmartFolders;
        this.smartFolderWatcher.analyzeDocumentFile = analyzeDocumentFile;
        this.smartFolderWatcher.analyzeImageFile = analyzeImageFile;

        logger.info('[ServiceIntegration] SmartFolderWatcher configured');

        // Auto-start if enabled in settings (async, don't block)
        this._autoStartSmartFolderWatcher();
      }
    } catch (error) {
      logger.warn(
        '[ServiceIntegration] Failed to configure SmartFolderWatcher:',
        error?.message || String(error)
      );
    }
  }

  /**
   * Configure the DownloadWatcher with required dependencies
   * This must be called after the main process has set up analysis functions
   *
   * @param {Object} config - Configuration object
   * @param {Function} config.getCustomFolders - Function to get custom folders
   * @param {Function} config.analyzeDocumentFile - Function to analyze documents
   * @param {Function} config.analyzeImageFile - Function to analyze images
   */
  configureDownloadWatcher({ getCustomFolders, analyzeDocumentFile, analyzeImageFile }) {
    try {
      const downloadWatcher = container.resolve(ServiceIds.DOWNLOAD_WATCHER);

      if (downloadWatcher) {
        // Update the watcher's dependencies
        downloadWatcher.getCustomFolders = getCustomFolders;
        downloadWatcher.analyzeDocumentFile = analyzeDocumentFile;
        downloadWatcher.analyzeImageFile = analyzeImageFile;

        logger.info('[ServiceIntegration] DownloadWatcher configured');
      }
    } catch (error) {
      logger.warn(
        '[ServiceIntegration] Failed to configure DownloadWatcher:',
        error?.message || String(error)
      );
    }
  }

  /**
   * Auto-start the SmartFolderWatcher
   * Smart folder watching is always enabled - files added to smart folders are automatically analyzed
   * @private
   */
  async _autoStartSmartFolderWatcher() {
    if (!this.smartFolderWatcher) return;

    try {
      logger.info('[ServiceIntegration] Auto-starting SmartFolderWatcher...');
      await this.smartFolderWatcher.start();
    } catch (error) {
      logger.warn(
        '[ServiceIntegration] Error auto-starting SmartFolderWatcher:',
        error?.message || String(error)
      );
    }
  }

  /**
   * Configure the LearningFeedbackService with required dependencies
   * This must be called after the main process has set up smart folders
   *
   * @param {Object} config - Configuration object
   * @param {Function} config.getSmartFolders - Function to get current smart folders
   */
  configureLearningFeedback({ getSmartFolders }) {
    try {
      const learningService = container.resolve(ServiceIds.LEARNING_FEEDBACK);

      if (learningService) {
        learningService.getSmartFolders = getSmartFolders;
        logger.info('[ServiceIntegration] LearningFeedbackService configured');
      }
    } catch (error) {
      logger.warn(
        '[ServiceIntegration] Failed to configure LearningFeedbackService:',
        error?.message || String(error)
      );
    }
  }

  /**
   * Run a learning scan on existing smart folder contents
   * This teaches the system from how files are already organized
   *
   * @param {Object} options - Scan options
   * @param {number} options.maxFilesPerFolder - Max files to scan per folder
   * @param {boolean} options.onlyWithAnalysis - Only learn from analyzed files
   * @returns {Promise<{scanned: number, learned: number}>}
   */
  async runLearningStartupScan(options = {}) {
    try {
      const learningService = container.resolve(ServiceIds.LEARNING_FEEDBACK);
      const analysisHistory = container.resolve(ServiceIds.ANALYSIS_HISTORY);

      if (!learningService) {
        logger.warn('[ServiceIntegration] LearningFeedbackService not available for startup scan');
        return { scanned: 0, learned: 0 };
      }

      logger.info('[ServiceIntegration] Running learning startup scan...');
      const result = await learningService.learnFromExistingFiles(analysisHistory, {
        maxFilesPerFolder: options.maxFilesPerFolder || 50,
        onlyWithAnalysis: options.onlyWithAnalysis !== false
      });

      logger.info('[ServiceIntegration] Learning startup scan complete', result);
      return result;
    } catch (error) {
      logger.warn(
        '[ServiceIntegration] Error during learning startup scan:',
        error?.message || String(error)
      );
      return { scanned: 0, learned: 0 };
    }
  }
}

// Export the class and re-export container and service IDs for convenience
module.exports = ServiceIntegration;
module.exports.container = container;
module.exports.ServiceIds = ServiceIds;
module.exports.SERVICE_INITIALIZATION_ORDER = SERVICE_INITIALIZATION_ORDER;
