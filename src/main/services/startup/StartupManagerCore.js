/**
 * StartupManager Core
 *
 * Slim coordinator class that composes startup functionality.
 * Extracted modules handle specific responsibilities.
 *
 * @module services/startup/StartupManagerCore
 */

const { createLogger } = require('../../../shared/logger');
const { container } = require('../ServiceContainer');
const { withTimeout, delay } = require('../../../shared/promiseUtils');
const { getDataMigrationService } = require('../migration');
const { AI_DEFAULTS } = require('../../../shared/constants');
const { getModel } = require('../../../shared/modelRegistry');

// In-process services
const { getInstance: getLlamaService } = require('../LlamaService');
const { getInstance: getOramaService } = require('../OramaVectorService');
const logger = createLogger('StartupManager');

/**
 * StartupManager - Application startup orchestration
 *
 * Centralized service for managing application startup sequence.
 * Updated for in-process AI stack (node-llama-cpp + Orama).
 */
class StartupManager {
  /**
   * Create a StartupManager instance
   *
   * @param {Object} [options={}] - Configuration options
   */
  constructor(options = {}) {
    this.services = new Map();
    this.healthMonitor = null;
    this.startupState = 'initializing';
    this.errors = [];

    this.config = {
      startupTimeout: options.startupTimeout || 60000,
      healthCheckInterval: options.healthCheckInterval || 120000
    };

    this.serviceStatus = {
      vectorDb: { status: 'not_started', health: 'unknown' },
      llama: { status: 'not_started', health: 'unknown' }
    };

    this.startupPhase = 'idle';
    this.onProgressCallback = null;
    this.container = container;
  }

  setProgressCallback(callback) {
    this.onProgressCallback = callback;
  }

  reportProgress(phase, message, progress, details = {}) {
    this.startupPhase = phase;

    const logMessage = details.error
      ? `[STARTUP] [${phase}] ${message} - ${details.error}`
      : `[STARTUP] [${phase}] ${message}`;
    logger.info(logMessage);

    if (this.onProgressCallback) {
      this.onProgressCallback({
        phase,
        message,
        progress,
        serviceStatus: { ...this.serviceStatus },
        errors: [...this.errors],
        details
      });
    }
  }

  _withTimeout(promise, timeoutMs, operation) {
    return withTimeout(promise, timeoutMs, operation);
  }

  async initializeServices(signal) {
    if (signal?.aborted) return;
    this.reportProgress('services', 'Initializing AI services...', 15);

    try {
      logger.info('[STARTUP] Starting LlamaService and OramaVectorService');

      const [oramaResult, llamaResult] = await Promise.all([
        (async () => {
          try {
            if (signal?.aborted) throw new Error('Startup aborted');
            const oramaService = getOramaService();
            await oramaService.initialize();

            this.serviceStatus.vectorDb = { status: 'running', health: 'healthy' };
            this.reportProgress('services', 'Vector DB initialized', 40, {
              service: 'vectorDb',
              status: 'started'
            });
            return { success: true };
          } catch (error) {
            if (signal?.aborted) throw error;
            logger.error('Vector DB startup error', { error: error.message });
            this.serviceStatus.vectorDb = { status: 'failed', health: 'unhealthy' };
            return { success: false, error };
          }
        })(),
        (async () => {
          try {
            if (signal?.aborted) throw new Error('Startup aborted');
            const llamaService = getLlamaService();
            await llamaService.initialize();

            // Check if models are actually loaded/available (even if service init passed)
            const health = llamaService.getHealthStatus();

            this.serviceStatus.llama = {
              status: 'running',
              health: 'healthy',
              gpu: health.gpuBackend
            };

            this.reportProgress('services', 'AI Engine initialized', 55, {
              service: 'llama',
              status: 'started'
            });
            return { success: true };
          } catch (error) {
            if (signal?.aborted) throw error;
            logger.error('Llama startup error', { error: error.message });
            this.serviceStatus.llama = { status: 'failed', health: 'unhealthy' };
            // Llama failure is not critical for startup (can download models later)
            return { success: false, error, nonCritical: true };
          }
        })()
      ]);

      const allSuccess = oramaResult.success && llamaResult.success;

      if (allSuccess) {
        this.reportProgress('services', 'All services initialized successfully', 65);
      } else {
        this.reportProgress('services', 'Services initialized with warnings', 65, {
          warning: true,
          details: { orama: oramaResult.success, llama: llamaResult.success }
        });
      }

      return { vectorDb: oramaResult, llama: llamaResult };
    } catch (error) {
      if (signal?.aborted || error.message === 'Startup aborted') throw error;
      logger.error('[STARTUP] Service initialization failed:', error);
      this.reportProgress('services', 'Service initialization error', 65, {
        error: error.message,
        critical: true
      });
      throw error;
    }
  }

  async startup() {
    this.startupState = 'running';
    this.reportProgress('starting', 'Application starting...', 0);

    // Create abort controller for startup sequence
    this.startupController = new AbortController();
    const { signal } = this.startupController;

    try {
      // Run startup sequence with timeout
      let startupTimer;
      const timeoutPromise = new Promise((_, reject) => {
        startupTimer = setTimeout(() => {
          this.startupController.abort(); // Signal cancellation
          reject(new Error('Startup timeout exceeded'));
        }, this.config.startupTimeout);
      });

      await Promise.race([this._runStartupSequence(signal), timeoutPromise]);
      clearTimeout(startupTimer);

      if (signal.aborted) {
        throw new Error('Startup aborted');
      }

      this.startupState = 'completed';
      this.reportProgress('ready', 'Application ready', 100);

      // Start background health monitoring
      this.startHealthMonitoring();

      return { success: true };
    } catch (error) {
      // Ensure shutdown on timeout/failure to prevent zombie processes
      logger.warn('[STARTUP] Startup failed or timed out, initiating shutdown cleanup...');
      try {
        await this.shutdown();
      } catch (shutdownError) {
        logger.error('[STARTUP] Error during cleanup shutdown:', shutdownError);
      }

      this.startupState = 'failed';
      logger.error('[STARTUP] Startup failed:', error);
      this.errors.push({
        phase: 'startup',
        error: error.message,
        critical: true
      });
      throw error;
    } finally {
      this.startupController = null;
    }
  }

  async _runStartupSequence(signal) {
    if (signal?.aborted) return;
    logger.info('[STARTUP] Beginning internal startup sequence');

    // Phase 0: Data migration (best-effort)
    this.reportProgress('migration', 'Checking data migration status...', 5);
    try {
      if (signal?.aborted) throw new Error('Startup aborted');
      const migrationService = getDataMigrationService();
      const needsMigration = await migrationService.needsMigration();
      if (needsMigration) {
        this.reportProgress('migration', 'Migrating legacy vector data...', 10);
        const result = await migrationService.migrate({
          onProgress: (update) => {
            if (update?.message) {
              this.reportProgress('migration', update.message, 10, {
                progress: update.progress
              });
            }
          }
        });
        if (!result?.success) {
          this.errors.push({
            phase: 'migration',
            error: result?.errors?.[0] || 'Data migration failed',
            critical: false
          });
          this.reportProgress('migration', 'Data migration failed (continuing)', 10, {
            warning: true,
            error: result?.errors?.[0]
          });
        } else {
          this.reportProgress('migration', 'Data migration completed', 10);
        }
      } else {
        this.reportProgress('migration', 'No legacy data migration required', 10);
      }
    } catch (error) {
      if (signal?.aborted || error.message === 'Startup aborted') throw error;
      logger.warn('[STARTUP] Data migration error:', error);
      this.errors.push({
        phase: 'migration',
        error: error.message,
        critical: false
      });
      this.reportProgress('migration', 'Data migration error (continuing)', 10, {
        warning: true,
        error: error.message
      });
    }

    // Phase 1: Services
    if (signal?.aborted) throw new Error('Startup aborted');
    await this.initializeServices(signal);

    // Phase 2: Check model availability (non-blocking)
    if (signal?.aborted) throw new Error('Startup aborted');
    await this._checkModelAvailability();

    // Phase 3: App Services (Placeholders for other initializers)
    if (signal?.aborted) throw new Error('Startup aborted');
    this.reportProgress('app-services', 'Initializing application components...', 85);

    logger.info('[STARTUP] Internal startup sequence complete');
  }

  /**
   * Check if required AI models are available.
   * Non-blocking: missing models are reported via progress events
   * so the renderer can show the ModelSetupWizard.
   */
  async _checkModelAvailability() {
    this.reportProgress('models', 'Checking AI model availability...', 70);

    try {
      const llamaService = getLlamaService();
      const cfg = await llamaService.getConfig();
      const available = await llamaService.listModels();
      const availableNames = new Set(available.map((m) => m.name || m.filename || ''));

      const required = [
        cfg.embeddingModel || AI_DEFAULTS.EMBEDDING.MODEL,
        cfg.textModel || AI_DEFAULTS.TEXT.MODEL
      ].filter(Boolean);

      // Vision is optional but includes a companion projector
      const visionModel = cfg.visionModel || AI_DEFAULTS.IMAGE.MODEL;
      const visionInfo = getModel(visionModel);
      const projectorName = visionInfo?.clipModel?.name;

      const missingRequired = required.filter((name) => !availableNames.has(name));
      const visionModelPresent = visionModel ? availableNames.has(visionModel) : false;
      const projectorPresent = projectorName ? availableNames.has(projectorName) : true;
      const visionAvailable = visionModelPresent && projectorPresent;

      this.serviceStatus.llama.modelsAvailable = missingRequired.length === 0;
      this.serviceStatus.llama.missingModels = missingRequired;
      this.serviceStatus.llama.visionAvailable = visionAvailable;
      this.serviceStatus.llama.availableModelCount = available.length;

      if (missingRequired.length > 0) {
        logger.warn('[STARTUP] Required models missing', {
          missing: missingRequired,
          available: Array.from(availableNames)
        });
        this.reportProgress('models', 'Some AI models need to be downloaded', 75, {
          warning: true,
          missingModels: missingRequired,
          visionAvailable
        });
      } else {
        logger.info('[STARTUP] All required models available', {
          count: available.length,
          vision: visionAvailable
        });
        this.reportProgress('models', 'AI models ready', 75, {
          modelsReady: true,
          visionAvailable
        });
      }
    } catch (error) {
      logger.warn('[STARTUP] Model availability check failed (non-fatal):', error?.message);
      this.serviceStatus.llama.modelsAvailable = false;
      this.reportProgress('models', 'Could not verify model availability', 75, {
        warning: true,
        error: error?.message
      });
    }
  }

  startHealthMonitoring() {
    if (this.healthMonitor) {
      clearInterval(this.healthMonitor);
    }

    // Simple health check polling
    this.healthMonitor = setInterval(async () => {
      try {
        const llamaService = getLlamaService();
        const health = await llamaService.testConnection(); // Checks model loading

        this.serviceStatus.llama.health = health.success ? 'healthy' : 'unhealthy';

        // Vector DB is always healthy if running, but we can check stats
        this.serviceStatus.vectorDb.health = 'healthy';
      } catch (error) {
        // Mark Llama as unhealthy on health check failures.
        // Vector DB health is unknown without a successful check.
        this.serviceStatus.llama.health = 'unhealthy';
        this.serviceStatus.vectorDb.health = 'unknown';
        logger.warn('[Health] Health check failed', error);
      }
    }, this.config.healthCheckInterval);
  }

  getServiceStatus() {
    return {
      startup: this.startupState,
      phase: this.startupPhase,
      services: { ...this.serviceStatus },
      errors: [...this.errors],
      degraded: this.serviceStatus.llama.status === 'failed' // Consider degraded if AI fails
    };
  }

  async shutdown() {
    if (this.healthMonitor) {
      clearInterval(this.healthMonitor);
      this.healthMonitor = null;
    }

    logger.info('[StartupManager] Shutting down services...');

    try {
      await getLlamaService().shutdown();
      await getOramaService().shutdown();
    } catch (error) {
      logger.error('[StartupManager] Error during service shutdown:', error);
    }
  }

  delay(ms) {
    return delay(ms);
  }
}

module.exports = { StartupManager };
