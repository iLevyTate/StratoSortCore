/**
 * StartupManager Core
 *
 * Slim coordinator class that composes startup functionality.
 * Extracted modules handle specific responsibilities.
 *
 * @module services/startup/StartupManagerCore
 */

const { logger } = require('../../../shared/logger');
const { container } = require('../ServiceContainer');
const { hasPythonModuleAsync } = require('../../utils/asyncSpawnUtils');
const { withTimeout, delay } = require('../../../shared/promiseUtils');

const { runPreflightChecks, isPortAvailable } = require('./preflightChecks');
const { startChromaDB, isChromaDBRunning, checkChromaDBHealth } = require('./chromaService');
const { startOllama, isOllamaRunning, checkOllamaHealth } = require('./ollamaService');
const { createHealthMonitor } = require('./healthMonitoring');
const { shutdown, shutdownProcess } = require('./shutdownHandler');

logger.setContext('StartupManager');

/**
 * StartupManager - Application startup orchestration
 *
 * Centralized service for managing application startup sequence with:
 * - Retry logic with exponential backoff
 * - Health monitoring for services
 * - Graceful degradation when services fail
 * - Pre-flight checks before startup
 * - User-friendly error reporting
 * - Timeout protection
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
    this.healthCheckState = {
      inProgress: false,
      startedAt: null
    };
    this.startupState = 'initializing';
    this.errors = [];
    this.serviceProcesses = new Map();

    this.config = {
      startupTimeout: options.startupTimeout || 60000,
      healthCheckInterval: options.healthCheckInterval || 120000,
      maxRetries: options.maxRetries || 3,
      baseRetryDelay: options.baseRetryDelay || 1000,
      axiosTimeout: options.axiosTimeout || 5000,
      circuitBreakerThreshold: options.circuitBreakerThreshold || 5,
      circuitBreakerConsecutiveFailures: options.circuitBreakerConsecutiveFailures || 3
    };

    this.serviceStatus = {
      chromadb: { status: 'not_started', required: false, health: 'unknown' },
      ollama: { status: 'not_started', required: false, health: 'unknown' }
    };

    this.startupPhase = 'idle';
    this.onProgressCallback = null;
    this.chromadbDependencyMissing = false;
    this.restartLocks = {
      chromadb: false,
      ollama: false
    };
    this.cachedChromaSpawnPlan = null;
    this.container = container;
  }

  async hasPythonModule(moduleName) {
    return await hasPythonModuleAsync(moduleName);
  }

  setProgressCallback(callback) {
    this.onProgressCallback = callback;
  }

  /**
   * Set the ChromaDB dependency missing flag
   * Use this instead of directly mutating the property
   * @param {boolean} value - Whether ChromaDB dependency is missing
   */
  setChromadbDependencyMissing(value) {
    this.chromadbDependencyMissing = Boolean(value);
    logger.debug('[STARTUP] ChromaDB dependency missing flag set', {
      value: this.chromadbDependencyMissing
    });
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

  async runPreflightChecks() {
    return runPreflightChecks({
      reportProgress: this.reportProgress.bind(this),
      errors: this.errors
    });
  }

  async isPortAvailable(host, port) {
    return isPortAvailable(host, port);
  }

  async startServiceWithRetry(serviceName, startFunc, checkFunc, config = {}) {
    const maxRetries = config.maxRetries || this.config.maxRetries;
    const required = config.required || false;
    let lastError = null;

    this.serviceStatus[serviceName] = {
      status: 'starting',
      required,
      health: 'unknown',
      attempts: 0
    };

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        this.serviceStatus[serviceName].attempts = attempt + 1;
        this.reportProgress(
          'service-startup',
          `Starting ${serviceName}... (attempt ${attempt + 1}/${maxRetries})`,
          20 + (serviceName === 'chromadb' ? attempt * 10 : attempt * 15)
        );

        if (attempt > 0) {
          const delayMs = Math.min(this.config.baseRetryDelay * Math.pow(2, attempt), 10000);
          logger.info(`[STARTUP] Waiting ${delayMs}ms before retry...`);
          await delay(delayMs);
        }

        const alreadyRunning = await checkFunc();
        if (alreadyRunning) {
          logger.info(`[STARTUP] ${serviceName} is already running`);
          this.serviceStatus[serviceName].status = 'running';
          this.serviceStatus[serviceName].health = 'healthy';
          return { success: true, alreadyRunning: true };
        }

        logger.info(`[STARTUP] Attempting to start ${serviceName}...`);
        const startResult = await startFunc();

        if (startResult) {
          if (startResult.external || startResult.portInUse) {
            logger.info(`[STARTUP] ${serviceName} is running externally`);
            this.serviceStatus[serviceName].status = 'running';
            this.serviceStatus[serviceName].health = 'healthy';
            this.serviceStatus[serviceName].external = true;
            return { success: true, external: true };
          }

          if (startResult.process) {
            this.serviceProcesses.set(serviceName, startResult.process);
          }
        }

        const verifyTimeout = config.verifyTimeout || 10000;
        const startTime = Date.now();
        let isRunning = false;
        let pollInterval = 50;
        let checksPerformed = 0;

        while (Date.now() - startTime < verifyTimeout) {
          isRunning = await checkFunc();
          if (isRunning) {
            const elapsedTime = Date.now() - startTime;
            logger.info(`[STARTUP] ${serviceName} started successfully in ${elapsedTime}ms`);
            this.serviceStatus[serviceName].status = 'running';
            this.serviceStatus[serviceName].health = 'healthy';
            return { success: true, alreadyRunning: false };
          }

          checksPerformed++;
          if (checksPerformed <= 5) {
            pollInterval = 200;
          } else if (checksPerformed <= 10) {
            pollInterval = 500;
          } else {
            pollInterval = 1000;
          }

          await delay(pollInterval);
        }

        throw new Error(`${serviceName} failed to respond within ${verifyTimeout}ms`);
      } catch (error) {
        lastError = error;
        logger.warn(`[STARTUP] ${serviceName} attempt ${attempt + 1} failed:`, error.message);
        this.serviceStatus[serviceName].lastError = error.message;
      }
    }

    this.serviceStatus[serviceName].status = 'failed';
    this.serviceStatus[serviceName].health = 'unhealthy';

    const errorInfo = {
      service: serviceName,
      error: lastError?.message || 'Unknown error',
      critical: required
    };

    this.errors.push(errorInfo);

    if (required) {
      throw new Error(`Critical service ${serviceName} failed to start: ${lastError?.message}`);
    }

    logger.warn(`[STARTUP] ${serviceName} failed to start but is not required. Continuing...`);
    return { success: false, error: lastError, fallbackMode: true };
  }

  async startChromaDB() {
    // If we previously marked ChromaDB as "missing dependency", re-check periodically.
    // Users can install chromadb from the dependency wizard without restarting the whole app,
    // so we must allow the service to recover automatically.
    if (this.chromadbDependencyMissing) {
      try {
        const moduleNowAvailable = await hasPythonModuleAsync('chromadb');
        if (moduleNowAvailable) {
          logger.info(
            '[STARTUP] ChromaDB dependency was previously missing but is now installed. Re-enabling startup.'
          );
          this.chromadbDependencyMissing = false;
        }
      } catch (e) {
        logger.debug('[STARTUP] Failed to re-check chromadb module availability', {
          error: e?.message
        });
      }
    }

    // Check if disabled before attempting retries
    const initialResult = await startChromaDB({
      serviceStatus: this.serviceStatus,
      errors: this.errors,
      chromadbDependencyMissing: this.chromadbDependencyMissing,
      cachedChromaSpawnPlan: this.cachedChromaSpawnPlan,
      setCachedSpawnPlan: (plan) => {
        this.cachedChromaSpawnPlan = plan;
      }
    });

    if (initialResult.setDependencyMissing) {
      this.chromadbDependencyMissing = true;
    }

    if (initialResult.disabled) {
      return initialResult;
    }

    // FIX: Pass a function that actually re-executes startChromaDB on each retry
    // instead of returning a stale cached result
    return await this.startServiceWithRetry(
      'chromadb',
      async () => {
        return startChromaDB({
          serviceStatus: this.serviceStatus,
          errors: this.errors,
          chromadbDependencyMissing: this.chromadbDependencyMissing,
          cachedChromaSpawnPlan: this.cachedChromaSpawnPlan,
          setCachedSpawnPlan: (plan) => {
            this.cachedChromaSpawnPlan = plan;
          }
        });
      },
      isChromaDBRunning,
      {
        required: false,
        verifyTimeout: 12000
      }
    );
  }

  async startOllama() {
    return await this.startServiceWithRetry(
      'ollama',
      async () => startOllama({ serviceStatus: this.serviceStatus }),
      isOllamaRunning,
      { required: false, verifyTimeout: 8000 }
    );
  }

  async initializeServices() {
    this.reportProgress('services', 'Initializing services...', 15);

    try {
      logger.info('[STARTUP] Starting ChromaDB and Ollama in parallel');

      const [chromaResult, ollamaResult] = await Promise.all([
        (async () => {
          try {
            const result = await this.startChromaDB();
            this._reportServiceStatus('chromadb', result);
            return result;
          } catch (error) {
            logger.error('ChromaDB startup error', { error: error.message });
            return { success: false, error };
          }
        })(),
        (async () => {
          try {
            const result = await this.startOllama();
            this._reportServiceStatus('ollama', result);
            return result;
          } catch (error) {
            logger.error('Ollama startup error', { error: error.message });
            return { success: false, error };
          }
        })()
      ]);

      const allSuccess = chromaResult.success && ollamaResult.success;
      const partialSuccess = chromaResult.success || ollamaResult.success;

      if (allSuccess) {
        this.reportProgress('services', 'All services initialized successfully', 65, {
          chromadb: chromaResult.success,
          ollama: ollamaResult.success
        });
      } else if (partialSuccess) {
        this.reportProgress('services', 'Services initialized with limitations', 65, {
          chromadb: chromaResult.success,
          ollama: ollamaResult.success,
          warning: true
        });
      } else {
        this.reportProgress('services', 'Service initialization failed', 65, {
          chromadb: chromaResult.success,
          ollama: ollamaResult.success,
          error: true
        });
      }

      return { chromadb: chromaResult, ollama: ollamaResult };
    } catch (error) {
      logger.error('[STARTUP] Service initialization failed:', error);
      this.reportProgress('services', 'Service initialization error', 65, {
        error: error.message,
        critical: true
      });
      throw error;
    }
  }

  _reportServiceStatus(serviceName, result) {
    const progress = serviceName === 'chromadb' ? 40 : 55;

    if (result.success) {
      if (result.external) {
        this.reportProgress('services', `${serviceName} detected (external instance)`, progress, {
          service: serviceName,
          status: 'external'
        });
      } else if (result.alreadyRunning) {
        this.reportProgress('services', `${serviceName} already running`, progress, {
          service: serviceName,
          status: 'running'
        });
      } else {
        this.reportProgress('services', `${serviceName} started successfully`, progress, {
          service: serviceName,
          status: 'started'
        });
      }
    } else if (result.disabled) {
      this.reportProgress('services', `${serviceName} disabled (dependency missing)`, progress, {
        service: serviceName,
        status: 'disabled',
        error: result.reason
      });
    } else if (result.fallbackMode) {
      this.reportProgress('services', `${serviceName} unavailable`, progress, {
        service: serviceName,
        status: 'failed',
        error: result.error?.message
      });
    } else {
      this.reportProgress('services', `${serviceName} failed to start`, progress, {
        service: serviceName,
        status: 'failed',
        error: result.error?.message
      });
    }
  }

  async startup() {
    this.startupState = 'running';
    this.reportProgress('starting', 'Application starting...', 0);

    try {
      const startupPromise = this._runStartupSequence();
      let timeoutId;
      const timeoutPromise = new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new Error('Startup timeout exceeded'));
        }, this.config.startupTimeout);
      });

      let result;
      try {
        result = await Promise.race([startupPromise, timeoutPromise]);
      } finally {
        if (timeoutId) clearTimeout(timeoutId);
      }

      this.startupState = 'completed';
      this.reportProgress('ready', 'Application ready', 100);

      this.startHealthMonitoring();

      return result;
    } catch (error) {
      this.startupState = 'failed';
      logger.error('[STARTUP] Startup failed:', error);
      this.errors.push({
        phase: 'startup',
        error: error.message,
        critical: true
      });

      await this.enableGracefulDegradation();

      throw error;
    }
  }

  async _runStartupSequence() {
    logger.info('[STARTUP] Beginning internal startup sequence');

    logger.info('[STARTUP] Phase 1: Running pre-flight checks');
    const preflightResults = await this.runPreflightChecks();
    logger.info('[STARTUP] Pre-flight checks complete');

    logger.info('[STARTUP] Phase 2: Initializing services (ChromaDB & Ollama)');
    const serviceResults = await this.initializeServices();
    logger.info('[STARTUP] Services initialization complete');

    if (serviceResults.ollama?.success) {
      logger.info('[STARTUP] Phase 3: Verifying AI models');
      this.reportProgress('models', 'Verifying AI models...', 70);
    }

    logger.info('[STARTUP] Phase 4: Initializing application services');
    this.reportProgress('app-services', 'Initializing application services...', 85);

    logger.info('[STARTUP] Internal startup sequence complete');
    return {
      preflight: preflightResults,
      services: serviceResults,
      degraded: this.errors.length > 0
    };
  }

  async enableGracefulDegradation() {
    logger.info('[STARTUP] Enabling graceful degradation mode...');

    global.degradedMode = {
      enabled: true,
      missingServices: [],
      limitations: []
    };

    const chromaUnavailableStatuses = ['failed', 'permanently_failed', 'disabled'];
    if (chromaUnavailableStatuses.includes(this.serviceStatus.chromadb.status)) {
      global.degradedMode.missingServices.push('chromadb');
      global.degradedMode.limitations.push('Semantic search disabled');
      global.degradedMode.limitations.push('Smart folder matching may be limited');
    }

    const ollamaUnavailableStatuses = ['failed', 'permanently_failed', 'disabled'];
    if (ollamaUnavailableStatuses.includes(this.serviceStatus.ollama.status)) {
      global.degradedMode.missingServices.push('ollama');
      global.degradedMode.limitations.push('AI analysis disabled');
      global.degradedMode.limitations.push('Manual organization only');
    }

    await this.cleanupFailedServiceProcesses();

    this.reportProgress('degraded', 'Running in degraded mode', 100);
  }

  async cleanupFailedServiceProcesses() {
    const stopPromises = [];

    for (const [serviceName, process] of this.serviceProcesses.entries()) {
      const status = this.serviceStatus[serviceName]?.status;
      const shouldStop = status !== 'running' && status !== 'disabled' && status !== 'stopped';

      if (shouldStop) {
        stopPromises.push(
          shutdownProcess(serviceName, process).catch((error) => {
            logger.warn(`[STARTUP] Failed to stop ${serviceName} during degradation`, {
              error: error.message
            });
          })
        );
      }
    }

    if (stopPromises.length > 0) {
      await Promise.allSettled(stopPromises);

      for (const [serviceName] of this.serviceProcesses.entries()) {
        const status = this.serviceStatus[serviceName]?.status;
        if (status !== 'running' && status !== 'disabled') {
          this.serviceProcesses.delete(serviceName);
        }
      }
    }
  }

  startHealthMonitoring() {
    if (this.healthMonitor) {
      clearInterval(this.healthMonitor);
      this.healthMonitor = null;
    }

    this.healthMonitor = createHealthMonitor({
      serviceStatus: this.serviceStatus,
      config: this.config,
      restartLocks: this.restartLocks,
      startChromaDB: this.startChromaDB.bind(this),
      startOllama: this.startOllama.bind(this),
      healthCheckState: this.healthCheckState
    });
  }

  async checkChromaDBHealth() {
    return checkChromaDBHealth();
  }

  async checkOllamaHealth() {
    return checkOllamaHealth();
  }

  getServiceStatus() {
    return {
      startup: this.startupState,
      phase: this.startupPhase,
      services: { ...this.serviceStatus },
      errors: [...this.errors],
      degraded: global.degradedMode?.enabled || false
    };
  }

  async shutdown() {
    return shutdown({
      serviceProcesses: this.serviceProcesses,
      serviceStatus: this.serviceStatus,
      healthMonitor: this.healthMonitor,
      healthCheckState: this.healthCheckState
    });
  }

  delay(ms) {
    return delay(ms);
  }
}

module.exports = { StartupManager };
