const AnalysisHistoryService = require('./AnalysisHistoryService');
const UndoRedoService = require('./UndoRedoService');
const ProcessingStateService = require('./ProcessingStateService');
const { getInstance: getChromaDB } = require('./ChromaDBService');
const FolderMatchingService = require('./FolderMatchingService');
const OrganizationSuggestionService = require('./OrganizationSuggestionService');
const AutoOrganizeService = require('./AutoOrganizeService');
const { logger } = require('../../shared/logger');

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
  }

  async initialize() {
    if (this.initialized) return;

    logger.info('[ServiceIntegration] Starting initialization...');

    // Initialize core services
    this.analysisHistory = new AnalysisHistoryService();
    this.undoRedo = new UndoRedoService();
    this.processingState = new ProcessingStateService();

    // Initialize ChromaDB and folder matching
    this.chromaDbService = getChromaDB();
    this.folderMatchingService = new FolderMatchingService(
      this.chromaDbService,
    );

    // Initialize suggestion service
    const { getService: getSettingsService } = require('./SettingsService');
    this.suggestionService = new OrganizationSuggestionService({
      chromaDbService: this.chromaDbService,
      folderMatchingService: this.folderMatchingService,
      settingsService: getSettingsService(),
    });

    // Initialize auto-organize service
    this.autoOrganizeService = new AutoOrganizeService({
      suggestionService: this.suggestionService,
      settingsService: getSettingsService(),
      folderMatchingService: this.folderMatchingService,
      undoRedoService: this.undoRedo,
    });

    // Check ChromaDB availability before initializing with timeout
    let isChromaReady = false;
    try {
      // Add a shorter timeout for the availability check
      isChromaReady = await Promise.race([
        this.chromaDbService.isServerAvailable(2000),
        new Promise((resolve) => setTimeout(() => resolve(false), 2000)),
      ]);
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

  async shutdown() {
    if (!this.initialized) return;

    try {
      // Shutdown services that may have resources to clean up
      const shutdownPromises = [];

      // Shutdown ChromaDB service if it has a shutdown method
      if (this.chromaDbService?.shutdown) {
        shutdownPromises.push(this.chromaDbService.shutdown());
      }

      // Shutdown other services if they have cleanup methods
      if (this.processingState?.cleanup) {
        shutdownPromises.push(this.processingState.cleanup());
      }

      if (this.analysisHistory?.cleanup) {
        shutdownPromises.push(this.analysisHistory.cleanup());
      }

      if (this.undoRedo?.cleanup) {
        shutdownPromises.push(this.undoRedo.cleanup());
      }

      if (this.autoOrganizeService?.cleanup) {
        shutdownPromises.push(this.autoOrganizeService.cleanup());
      }

      // Shutdown FolderMatchingService to cleanup embedding cache
      if (this.folderMatchingService?.shutdown) {
        shutdownPromises.push(this.folderMatchingService.shutdown());
      }

      await Promise.allSettled(shutdownPromises);

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
}

module.exports = ServiceIntegration;
