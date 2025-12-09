const AnalysisHistoryService = require('./analysisHistory');
const UndoRedoService = require('./UndoRedoService');
const ProcessingStateService = require('./ProcessingStateService');
const { getInstance: getChromaDB } = require('./chromadb');
const FolderMatchingService = require('./FolderMatchingService');
const OrganizationSuggestionService = require('./organization');
const AutoOrganizeService = require('./autoOrganize');
const { getInstance: getOllamaService } = require('./OllamaService');
const { getInstance: getOllamaClient } = require('./OllamaClient');
const {
  getInstance: getParallelEmbedding,
} = require('./ParallelEmbeddingService');
const EmbeddingCache = require('./EmbeddingCache');
const { container, ServiceIds } = require('./ServiceContainer');
const { logger } = require('../../shared/logger');
logger.setContext('ServiceIntegration');

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
    this.initialized = false;

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
   * @returns {Promise<void>}
   */
  async initialize() {
    if (this.initialized) return;

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
        '[ServiceIntegration] ChromaDB service is null, some features will be unavailable',
      );
    }

    this.folderMatchingService = container.resolve(ServiceIds.FOLDER_MATCHING);

    // Initialize suggestion service
    const settingsService = container.resolve(ServiceIds.SETTINGS);
    if (!settingsService) {
      logger.warn(
        '[ServiceIntegration] Settings service is null, using defaults',
      );
    }

    this.suggestionService = container.resolve(
      ServiceIds.ORGANIZATION_SUGGESTION,
    );

    // Initialize auto-organize service
    this.autoOrganizeService = container.resolve(ServiceIds.AUTO_ORGANIZE);

    // Check ChromaDB availability before initializing with timeout
    let isChromaReady = false;
    try {
      // FIX: Add null check for chromaDbService before accessing
      if (!this.chromaDbService) {
        logger.warn('[ServiceIntegration] ChromaDB service is null');
        isChromaReady = false;
      } else {
        // FIX: Store timeout ID to clear it after race resolves
        let timeoutId;
        const timeoutPromise = new Promise((resolve) => {
          timeoutId = setTimeout(() => resolve(false), 2000);
        });

        try {
          isChromaReady = await Promise.race([
            this.chromaDbService.isServerAvailable(2000),
            timeoutPromise,
          ]);
        } finally {
          // FIX: Always clear timeout to prevent memory leak
          if (timeoutId) clearTimeout(timeoutId);
        }
      }
    } catch (error) {
      logger.warn(
        '[ServiceIntegration] ChromaDB availability check failed:',
        error.message,
      );
      isChromaReady = false;
    }

    if (!isChromaReady) {
      logger.warn(
        '[ServiceIntegration] ChromaDB server is not available. Running in degraded mode.',
      );
      // Continue without ChromaDB - don't block startup
    }

    // Fixed: Initialize all services with graceful degradation
    // Use Promise.allSettled to continue even if some services fail
    const results = await Promise.allSettled([
      this.analysisHistory.initialize(),
      this.undoRedo.initialize(),
      this.processingState.initialize(),
      isChromaReady ? this.chromaDbService.initialize() : Promise.resolve(),
    ]);

    // Log any service initialization failures but continue
    const serviceNames = [
      'analysisHistory',
      'undoRedo',
      'processingState',
      'chromaDb',
    ];
    const failures = results
      .map((result, index) => ({ result, name: serviceNames[index] }))
      .filter(({ result }) => result.status === 'rejected');

    if (failures.length > 0) {
      logger.error('[ServiceIntegration] Some services failed to initialize:');
      failures.forEach(({ name, result }) => {
        logger.error(`  - ${name}: ${result.reason?.message || result.reason}`);
      });
      // Continue with degraded functionality
    }

    // Fixed: Initialize FolderMatchingService after ChromaDB is ready
    // This starts the embedding cache cleanup interval only after successful initialization
    if (this.folderMatchingService) {
      this.folderMatchingService.initialize();
    }

    this.initialized = true;
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

    // Register ChromaDB service (singleton)
    if (!container.has(ServiceIds.CHROMA_DB)) {
      container.registerSingleton(ServiceIds.CHROMA_DB, () => {
        return getChromaDB();
      });
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

    // Register organization suggestion service (depends on ChromaDB, FolderMatching, Settings)
    if (!container.has(ServiceIds.ORGANIZATION_SUGGESTION)) {
      container.registerSingleton(ServiceIds.ORGANIZATION_SUGGESTION, (c) => {
        return new OrganizationSuggestionService({
          chromaDbService: c.resolve(ServiceIds.CHROMA_DB),
          folderMatchingService: c.resolve(ServiceIds.FOLDER_MATCHING),
          settingsService: c.resolve(ServiceIds.SETTINGS),
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
          undoRedoService: c.resolve(ServiceIds.UNDO_REDO),
        });
      });
    }

    // Register AI/Embedding services (wrapping existing singletons)
    if (!container.has(ServiceIds.OLLAMA_CLIENT)) {
      container.registerSingleton(ServiceIds.OLLAMA_CLIENT, () => {
        return getOllamaClient();
      });
    }

    if (!container.has(ServiceIds.OLLAMA_SERVICE)) {
      container.registerSingleton(ServiceIds.OLLAMA_SERVICE, () => {
        return getOllamaService();
      });
    }

    if (!container.has(ServiceIds.EMBEDDING_CACHE)) {
      container.registerSingleton(ServiceIds.EMBEDDING_CACHE, () => {
        return new EmbeddingCache();
      });
    }

    if (!container.has(ServiceIds.PARALLEL_EMBEDDING)) {
      container.registerSingleton(ServiceIds.PARALLEL_EMBEDDING, () => {
        return getParallelEmbedding();
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
    if (!this.initialized) return;

    try {
      logger.info('[ServiceIntegration] Starting shutdown...');

      // Use the container's shutdown which handles all registered services
      await container.shutdown();

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
        error: error.message,
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
}

// Export the class and re-export container and service IDs for convenience
module.exports = ServiceIntegration;
module.exports.container = container;
module.exports.ServiceIds = ServiceIds;
