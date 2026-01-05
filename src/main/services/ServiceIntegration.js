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
const { logger } = require('../../shared/logger');

logger.setContext('ServiceIntegration');

/**
 * FIX: Explicit service initialization order with dependencies
 * This makes the initialization sequence clear and documentable.
 * Services are grouped by dependency tier:
 * - Tier 0: No dependencies (can init in parallel)
 * - Tier 1: Depends on external services (ChromaDB server)
 * - Tier 2: Depends on Tier 0/1 services
 */
const SERVICE_INITIALIZATION_ORDER = {
  // Tier 0: Independent services (can init in parallel)
  tier0: ['analysisHistory', 'undoRedo', 'processingState'],
  // Tier 1: ChromaDB (depends on external server)
  tier1: ['chromaDb'],
  // Tier 2: Services that depend on ChromaDB
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
 * const chromaDb = integration.chromaDbService;
 *
 * // Or via the container (recommended for new code)
 * const chromaDb = container.resolve(ServiceIds.CHROMA_DB);
 */
class ServiceIntegration {
  constructor() {
    this.analysisHistory = null;
    this.undoRedo = null;
    this.processingState = null;
    this.chromaDbService = null;
    this.folderMatchingService = null;
    this.suggestionService = null;
    this.autoOrganizeService = null;
    this.smartFolderWatcher = null;
    this.initialized = false;

    // FIX: Add initialization mutex to prevent race conditions
    // Multiple concurrent initialize() calls would previously both pass the
    // if (this.initialized) check and run in parallel, causing undefined behavior
    this._initPromise = null;

    // Reference to the container for external access
    this.container = container;
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
    logger.info('[ServiceIntegration] Starting initialization...');

    // Register core services with the container
    this._registerCoreServices();

    // Initialize core services
    this.analysisHistory = container.resolve(ServiceIds.ANALYSIS_HISTORY);
    this.undoRedo = container.resolve(ServiceIds.UNDO_REDO);
    this.processingState = container.resolve(ServiceIds.PROCESSING_STATE);

    // Initialize ChromaDB and folder matching
    this.chromaDbService = container.resolve(ServiceIds.CHROMA_DB);
    if (!this.chromaDbService) {
      logger.warn(
        '[ServiceIntegration] ChromaDB service is null, some features will be unavailable'
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

    // FIX: Use startup result to skip redundant ChromaDB availability check (saves 2-4s)
    // StartupManager already verified ChromaDB is running, so we don't need to recheck
    let isChromaReady = false;
    const { startupResult } = options;

    if (startupResult?.services?.chromadb?.success) {
      // Trust the startup result - ChromaDB was already verified running
      logger.info('[ServiceIntegration] Using startup result: ChromaDB is available');
      isChromaReady = true;
    } else if (!this.chromaDbService) {
      logger.warn('[ServiceIntegration] ChromaDB service is null');
      isChromaReady = false;
    } else if (!startupResult) {
      // No startup result provided - fall back to availability check (legacy path)
      logger.debug('[ServiceIntegration] No startup result, checking ChromaDB availability...');
      try {
        let timeoutId;
        const timeoutPromise = new Promise((resolve) => {
          timeoutId = setTimeout(() => resolve(false), 2000);
        });

        try {
          isChromaReady = await Promise.race([
            this.chromaDbService.isServerAvailable(2000),
            timeoutPromise
          ]);
        } finally {
          if (timeoutId) clearTimeout(timeoutId);
        }
      } catch (error) {
        logger.warn('[ServiceIntegration] ChromaDB availability check failed:', error.message);
        isChromaReady = false;
      }
    } else {
      // Startup result provided but ChromaDB wasn't successful
      logger.warn('[ServiceIntegration] ChromaDB startup was not successful');
      isChromaReady = false;
    }

    if (!isChromaReady) {
      logger.warn(
        '[ServiceIntegration] ChromaDB server is not available. Running in degraded mode.'
      );
      // Continue without ChromaDB - don't block startup
    }

    // FIX: Tiered initialization with explicit dependency ordering
    // Tracks initialization status for each service
    const initStatus = {
      initialized: [],
      errors: [],
      skipped: []
    };

    // Tier 0: Initialize independent services in parallel
    const tier0Results = await Promise.allSettled([
      this.analysisHistory.initialize(),
      this.undoRedo.initialize(),
      this.processingState.initialize()
    ]);

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
        logger.error(`[ServiceIntegration] ${name} initialization failed:`, result.reason?.message);
      }
    });

    // Tier 1: Initialize ChromaDB if server is available
    if (isChromaReady && this.chromaDbService) {
      try {
        await this.chromaDbService.initialize();
        initStatus.initialized.push('chromaDb');
      } catch (error) {
        initStatus.errors.push({ service: 'chromaDb', error: error.message });
        logger.error('[ServiceIntegration] ChromaDB initialization failed:', error.message);
        isChromaReady = false; // Prevent dependent services from initializing
      }
    } else {
      initStatus.skipped.push('chromaDb');
      logger.warn('[ServiceIntegration] ChromaDB initialization skipped - server not available');
    }

    // Tier 2: Initialize services that depend on ChromaDB
    // FolderMatchingService depends on ChromaDB for vector operations
    if (this.folderMatchingService && isChromaReady) {
      try {
        await this.folderMatchingService.initialize();
        initStatus.initialized.push('folderMatching');
      } catch (error) {
        initStatus.errors.push({ service: 'folderMatching', error: error.message });
        logger.warn(
          '[ServiceIntegration] FolderMatchingService initialization failed:',
          error.message
        );
        // Non-fatal - continue with degraded functionality
      }
    } else if (this.folderMatchingService) {
      initStatus.skipped.push('folderMatching');
      logger.warn('[ServiceIntegration] FolderMatchingService skipped - ChromaDB not available');
    }

    // Log initialization summary
    logger.info('[ServiceIntegration] Initialization complete', {
      initialized: initStatus.initialized.length,
      errors: initStatus.errors.length,
      skipped: initStatus.skipped.length
    });

    this.initialized = true;

    // FIX: Return structured initialization status for callers to inspect
    return initStatus;
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
    const { getService: getSettingsService } = require('./SettingsService');

    // Register settings service (singleton from existing factory)
    if (!container.has(ServiceIds.SETTINGS)) {
      container.registerSingleton(ServiceIds.SETTINGS, () => {
        return getSettingsService();
      });
    }

    // Register ChromaDB service (singleton) - using registerWithContainer pattern
    if (!container.has(ServiceIds.CHROMA_DB)) {
      const { registerWithContainer: registerChromaDB } = require('./chromadb');
      registerChromaDB(container, ServiceIds.CHROMA_DB);
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

    // Register folder matching service (depends on ChromaDB)
    if (!container.has(ServiceIds.FOLDER_MATCHING)) {
      container.registerSingleton(ServiceIds.FOLDER_MATCHING, (c) => {
        const chromaDb = c.resolve(ServiceIds.CHROMA_DB);
        return new FolderMatchingService(chromaDb);
      });
    }

    // FIX: Register ClusteringService as separate DI entry to avoid circular dependency
    // This allows other services to depend on ClusteringService independently
    if (!container.has(ServiceIds.CLUSTERING)) {
      container.registerSingleton(ServiceIds.CLUSTERING, (c) => {
        const { ClusteringService } = require('./ClusteringService');
        const chromaDbService = c.resolve(ServiceIds.CHROMA_DB);

        // FIX: Use lazy resolution for OllamaService to break potential circular dependency
        // OllamaService is optional - clustering can work without it in degraded mode
        let ollamaService = null;
        try {
          const { getInstance: getOllamaInstance } = require('./OllamaService');
          ollamaService = getOllamaInstance();
        } catch (error) {
          logger.warn(
            '[ServiceIntegration] OllamaService not available for clustering:',
            error.message
          );
        }

        return new ClusteringService({
          chromaDbService,
          ollamaService
        });
      });
    }

    // Register organization suggestion service (depends on ChromaDB, FolderMatching, Settings, Clustering)
    if (!container.has(ServiceIds.ORGANIZATION_SUGGESTION)) {
      container.registerSingleton(ServiceIds.ORGANIZATION_SUGGESTION, (c) => {
        return new OrganizationSuggestionService({
          chromaDbService: c.resolve(ServiceIds.CHROMA_DB),
          folderMatchingService: c.resolve(ServiceIds.FOLDER_MATCHING),
          settingsService: c.resolve(ServiceIds.SETTINGS),
          // FIX: Use lazy resolution with getter to break potential circular dependency
          // This allows ClusteringService to be resolved when first needed, not during registration
          getClusteringService: () => c.resolve(ServiceIds.CLUSTERING)
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

    // Register AI/Embedding services - using registerWithContainer pattern
    if (!container.has(ServiceIds.OLLAMA_CLIENT)) {
      const { registerWithContainer: registerOllamaClient } = require('./OllamaClient');
      registerOllamaClient(container, ServiceIds.OLLAMA_CLIENT);
    }

    if (!container.has(ServiceIds.OLLAMA_SERVICE)) {
      const { registerWithContainer: registerOllamaService } = require('./OllamaService');
      registerOllamaService(container, ServiceIds.OLLAMA_SERVICE);
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
        const chromaDbService = c.resolve(ServiceIds.CHROMA_DB);
        // FIX: Add folderMatcher for auto-embedding analyzed files into ChromaDB
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
          chromaDbService,
          folderMatcher, // FIX: Pass folderMatcher for immediate auto-embedding
          notificationService // For user feedback on file analysis
        });
      });
    }

    // Register DependencyManagerService
    if (!container.has(ServiceIds.DEPENDENCY_MANAGER)) {
      const {
        registerWithContainer: registerDependencyManager
      } = require('./DependencyManagerService');
      registerDependencyManager(container, ServiceIds.DEPENDENCY_MANAGER);
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
    if (!this.initialized) return;

    try {
      logger.info('[ServiceIntegration] Starting coordinated shutdown...');

      // Use the container's shutdown with explicit shutdown order
      // This ensures dependent services are stopped before their dependencies
      await container.shutdown(SHUTDOWN_ORDER);

      // Clear all service references
      this.analysisHistory = null;
      this.undoRedo = null;
      this.processingState = null;
      this.chromaDbService = null;
      this.folderMatchingService = null;
      this.suggestionService = null;
      this.autoOrganizeService = null;
      this.initialized = false;

      logger.info('[ServiceIntegration] All services shut down successfully');
    } catch (error) {
      logger.error('[ServiceIntegration] Error during shutdown', {
        error: error.message
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
      logger.warn('[ServiceIntegration] Failed to configure SmartFolderWatcher:', error.message);
    }
  }

  /**
   * Auto-start the SmartFolderWatcher if enabled in settings
   * @private
   */
  async _autoStartSmartFolderWatcher() {
    if (!this.smartFolderWatcher) return;

    try {
      const settings = container.resolve(ServiceIds.SETTINGS);
      if (settings) {
        const config = await settings.load();
        if (config.smartFolderWatchEnabled) {
          logger.info('[ServiceIntegration] Auto-starting SmartFolderWatcher...');
          await this.smartFolderWatcher.start();
        }
      }
    } catch (error) {
      logger.warn('[ServiceIntegration] Error auto-starting SmartFolderWatcher:', error.message);
    }
  }
}

// Export the class and re-export container and service IDs for convenience
module.exports = ServiceIntegration;
module.exports.container = container;
module.exports.ServiceIds = ServiceIds;
module.exports.SERVICE_INITIALIZATION_ORDER = SERVICE_INITIALIZATION_ORDER;
