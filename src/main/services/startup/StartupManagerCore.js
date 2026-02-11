/**
 * StartupManager Core
 *
 * Slim coordinator class that composes startup functionality.
 * Extracted modules handle specific responsibilities.
 *
 * @module services/startup/StartupManagerCore
 */

const { createLogger } = require('../../../shared/logger');
const { container, ServiceIds } = require('../ServiceContainer');
const { withTimeout, delay } = require('../../../shared/promiseUtils');
const { getDataMigrationService } = require('../migration');
const { AI_DEFAULTS } = require('../../../shared/constants');
const { getModel } = require('../../../shared/modelRegistry');

// In-process services
const logger = createLogger('StartupManager');

/**
 * Detect Ollama-style model names (e.g. 'llama3.2:latest', 'mistral:7b').
 * These contain a ':' tag separator and are never valid GGUF filenames.
 */
function _isOllamaStyleName(name) {
  return typeof name === 'string' && name.includes(':') && !name.endsWith('.gguf');
}

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

  _registerCoreServices() {
    if (!this.container.has(ServiceIds.ORAMA_VECTOR)) {
      const { registerWithContainer } = require('../OramaVectorService');
      registerWithContainer(this.container, ServiceIds.ORAMA_VECTOR);
    }

    if (!this.container.has(ServiceIds.LLAMA_SERVICE)) {
      const { registerWithContainer } = require('../LlamaService');
      registerWithContainer(this.container, ServiceIds.LLAMA_SERVICE);
    }
  }

  _getLlamaService() {
    this._registerCoreServices();
    return this.container.resolve(ServiceIds.LLAMA_SERVICE);
  }

  _getOramaService() {
    this._registerCoreServices();
    return this.container.resolve(ServiceIds.ORAMA_VECTOR);
  }

  _verifyPhaseHealth(phase, options = {}) {
    const { requireVectorDb = false, requireLlama = false } = options;
    const failures = [];

    if (requireVectorDb && this.serviceStatus.vectorDb.status !== 'running') {
      failures.push('vectorDb');
    }
    if (requireLlama && this.serviceStatus.llama.status !== 'running') {
      failures.push('llama');
    }

    if (failures.length > 0) {
      const errorMessage = `Health check failed after ${phase}: ${failures.join(', ')}`;
      this.errors.push({
        phase: `health:${phase}`,
        error: errorMessage,
        critical: true
      });
      logger.error(`[STARTUP] ${errorMessage}`);
      throw new Error(errorMessage);
    }

    logger.info(`[STARTUP] Health check passed after ${phase}`);
  }

  _withTimeout(promise, timeoutMs, operation) {
    return withTimeout(promise, timeoutMs, operation);
  }

  async initializeServices(signal) {
    if (signal?.aborted) return;
    this.reportProgress('services', 'Initializing AI services...', 15);

    try {
      logger.info('[STARTUP] Starting LlamaService and OramaVectorService');

      this._registerCoreServices();
      const [oramaResult, llamaResult] = await Promise.all([
        (async () => {
          try {
            if (signal?.aborted) throw new Error('Startup aborted');
            const oramaService = this._getOramaService();
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
            const llamaService = this._getLlamaService();
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

      return {
        success: true,
        services: { ...this.serviceStatus },
        errors: [...this.errors],
        phase: this.startupPhase
      };
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
    this._verifyPhaseHealth('services', { requireVectorDb: true });

    // Phase 2: Check model availability (non-blocking)
    if (signal?.aborted) throw new Error('Startup aborted');
    await this._checkModelAvailability();
    this._verifyPhaseHealth('models', { requireVectorDb: true });

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
  /**
   * Fuzzy-match a configured model name against installed model filenames.
   * Returns the default GGUF name for Ollama-era names that can't be resolved.
   * @param {string} configured - Model name from user settings
   * @param {string[]} installedList - Array of installed model filenames
   * @param {string} [defaultModel] - Default GGUF model name to use if configured is stale
   * @returns {string|null} Resolved model name, or null if no match found
   */
  _resolveModelName(configured, installedList, defaultModel) {
    if (!configured) return defaultModel || null;
    if (installedList.includes(configured)) return configured;

    // Ollama-style names (e.g. 'llama3.2:latest') can't be fuzzy-matched to
    // GGUF filenames - reset to the default immediately
    if (_isOllamaStyleName(configured)) {
      logger.info('[STARTUP] Detected Ollama-era model name, replacing with GGUF default', {
        ollamaName: configured,
        default: defaultModel
      });
      // Try to find the default in the installed list
      if (defaultModel && installedList.includes(defaultModel)) return defaultModel;
      return defaultModel || null;
    }

    const lc = configured.toLowerCase();
    return (
      installedList.find((m) => m.toLowerCase().includes(lc)) ||
      installedList.find((m) => lc.includes(m.toLowerCase())) ||
      null
    );
  }

  async _checkModelAvailability() {
    this.reportProgress('models', 'Checking AI model availability...', 70);

    try {
      const llamaService = this._getLlamaService();
      const cfg = await llamaService.getConfig();
      const available = await llamaService.listModels();
      const availableNames = available.map((m) => m.name || m.filename || '').filter(Boolean);
      const availableSet = new Set(availableNames);

      const embeddingConfigured = cfg.embeddingModel || AI_DEFAULTS.EMBEDDING.MODEL;
      const textConfigured = cfg.textModel || AI_DEFAULTS.TEXT.MODEL;
      const visionConfigured = cfg.visionModel || AI_DEFAULTS.IMAGE.MODEL;

      // Resolve with defaults: Ollama-era names get replaced with GGUF defaults
      const resolvedEmbedding = this._resolveModelName(
        embeddingConfigured,
        availableNames,
        AI_DEFAULTS.EMBEDDING.MODEL
      );
      const resolvedText = this._resolveModelName(
        textConfigured,
        availableNames,
        AI_DEFAULTS.TEXT.MODEL
      );
      const resolvedVision = this._resolveModelName(
        visionConfigured,
        availableNames,
        AI_DEFAULTS.IMAGE.MODEL
      );

      // Auto-correct stale/Ollama model names in settings
      const corrections = {};
      if (resolvedEmbedding && resolvedEmbedding !== embeddingConfigured) {
        corrections.embeddingModel = resolvedEmbedding;
      }
      if (resolvedText && resolvedText !== textConfigured) {
        corrections.textModel = resolvedText;
      }
      if (resolvedVision && resolvedVision !== visionConfigured) {
        corrections.visionModel = resolvedVision;
      }
      if (Object.keys(corrections).length > 0) {
        logger.info('[STARTUP] Auto-corrected model names in settings', corrections);
        try {
          await llamaService.updateConfig(corrections);
        } catch (e) {
          logger.warn('[STARTUP] Failed to persist model name corrections:', e?.message);
        }
      }

      const missingRequired = [];
      if (!resolvedEmbedding || !availableSet.has(resolvedEmbedding)) {
        missingRequired.push(resolvedEmbedding || AI_DEFAULTS.EMBEDDING.MODEL);
      }
      if (!resolvedText || !availableSet.has(resolvedText)) {
        missingRequired.push(resolvedText || AI_DEFAULTS.TEXT.MODEL);
      }

      // Vision is optional but includes a companion projector
      const visionInfo = getModel(resolvedVision || visionConfigured);
      const projectorName = visionInfo?.clipModel?.name;
      const visionModelPresent = resolvedVision ? availableSet.has(resolvedVision) : false;
      const projectorPresent = projectorName ? availableSet.has(projectorName) : true;
      const visionAvailable = visionModelPresent && projectorPresent;

      this.serviceStatus.llama.modelsAvailable = missingRequired.length === 0;
      this.serviceStatus.llama.missingModels = missingRequired;
      this.serviceStatus.llama.visionAvailable = visionAvailable;
      this.serviceStatus.llama.availableModelCount = available.length;

      if (missingRequired.length > 0) {
        logger.warn('[STARTUP] Required models missing', {
          missing: missingRequired,
          available: availableNames
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

    // Simple health check polling (unref'd so it doesn't prevent process exit)
    this.healthMonitor = setInterval(async () => {
      try {
        const llamaService = this._getLlamaService();
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

    // Allow process to exit even if health monitor is still running
    if (this.healthMonitor.unref) {
      this.healthMonitor.unref();
    }
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
    if (this._isShuttingDown) return;
    this._isShuttingDown = true;

    if (this.healthMonitor) {
      clearInterval(this.healthMonitor);
      this.healthMonitor = null;
    }

    logger.info('[StartupManager] Shutting down services...');

    // Note: LlamaService and OramaVectorService have their own re-entrance guards,
    // so calling shutdown here is safe even if ServiceContainer also calls it.
    try {
      await this._getLlamaService().shutdown();
    } catch (error) {
      logger.error('[StartupManager] Error shutting down LlamaService:', error);
    }
    try {
      await this._getOramaService().shutdown();
    } catch (error) {
      logger.error('[StartupManager] Error shutting down OramaVectorService:', error);
    }
  }

  delay(ms) {
    return delay(ms);
  }
}

module.exports = { StartupManager };
