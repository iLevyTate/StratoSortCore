/**
 * Health Monitoring
 *
 * Continuous health monitoring with circuit breaker pattern.
 * Extracted from StartupManager for better maintainability.
 *
 * @module services/startup/healthMonitoring
 */

const axios = require('axios');
const { logger } = require('../../../shared/logger');
const { TIMEOUTS } = require('../../../shared/performanceConstants');
const { axiosWithRetry } = require('../../utils/ollamaApiRetry');
const { isPortAvailable } = require('./preflightChecks');
const { checkChromaDBHealth } = require('./chromaService');
const { checkOllamaHealth } = require('./ollamaService');
const { container, ServiceIds } = require('../ServiceContainer');

logger.setContext('StartupManager:Health');

// Circuit breaker recovery window - same as global analysis timeout
const CIRCUIT_BREAKER_RECOVERY_WINDOW = TIMEOUTS.GLOBAL_ANALYSIS;

/**
 * Handle circuit breaker recovery for a service
 * @param {string} serviceName - Service name
 * @param {Object} serviceStatus - Service status object
 * @param {Function} startService - Function to start the service
 * @param {Function} checkHealth - Function to check health
 * @returns {Promise<boolean>} Whether recovery was attempted
 */
async function handleCircuitBreakerRecovery(serviceName, serviceStatus, startService, checkHealth) {
  const status = serviceStatus[serviceName];

  if (!status.circuitBreakerTripped || !status.circuitBreakerTrippedAt) {
    return false;
  }

  const trippedTime = new Date(status.circuitBreakerTrippedAt).getTime();
  const now = Date.now();

  // Initialize recovery attempt counter
  if (!status.recoveryAttempts) {
    status.recoveryAttempts = 0;
  }

  const attemptCount = status.recoveryAttempts;
  const maxAttempts = 5;
  const backoffMultiplier = Math.pow(2, attemptCount);
  const adjustedRecoveryWindow = CIRCUIT_BREAKER_RECOVERY_WINDOW * backoffMultiplier;

  if (now - trippedTime < adjustedRecoveryWindow) {
    return false;
  }

  if (attemptCount >= maxAttempts) {
    logger.error(
      `[HEALTH] ${serviceName} exceeded maximum recovery attempts (${maxAttempts}). Service permanently disabled.`
    );
    status.status = 'permanently_failed';
    return true;
  }

  logger.info(
    `[HEALTH] ${serviceName} circuit breaker recovery attempt ${attemptCount + 1}/${maxAttempts} (backoff: ${adjustedRecoveryWindow / 1000}s)...`
  );

  try {
    await startService();

    const isHealthy = await checkHealth();

    if (isHealthy) {
      logger.info(
        `[HEALTH] ${serviceName} circuit breaker recovery successful - service is healthy`
      );
      status.circuitBreakerTripped = false;
      status.circuitBreakerTrippedAt = null;
      status.restartCount = 0;
      status.consecutiveFailures = 0;
      status.recoveryAttempts = 0;
      status.status = 'running';
      status.health = 'healthy';

      // FIX: Emit recovery notification to renderer
      try {
        const { emitServiceStatusChange } = require('../../ipc/dependencies');
        emitServiceStatusChange({
          service: serviceName,
          status: 'running',
          health: 'healthy',
          details: { reason: 'circuit_breaker_recovered' }
        });
      } catch (e) {
        logger.debug(`[HEALTH] Could not emit ${serviceName} recovery status`, {
          error: e?.message
        });
      }
    } else {
      throw new Error('Service started but health check failed');
    }
  } catch (error) {
    logger.warn(
      `[HEALTH] ${serviceName} circuit breaker recovery attempt ${attemptCount + 1} failed: ${error.message}`
    );
    status.recoveryAttempts = attemptCount + 1;
    status.circuitBreakerTrippedAt = new Date().toISOString();
  }

  return true;
}

/**
 * Check health of a specific service and handle failures
 * @param {string} serviceName - Service name
 * @param {Object} serviceStatus - Service status object
 * @param {Object} config - Circuit breaker config
 * @param {Object} restartLocks - Restart locks object
 * @param {Function} startService - Function to start the service
 * @returns {Promise<void>}
 */
async function checkServiceHealthWithRecovery(
  serviceName,
  serviceStatus,
  config,
  restartLocks,
  startService
) {
  const status = serviceStatus[serviceName];

  if (status.status === 'permanently_failed' || status.health === 'permanently_failed') {
    logger.debug(`[HEALTH] Skipping ${serviceName} health check - service permanently failed`);
    return;
  }

  if (status.status !== 'running') {
    return;
  }

  try {
    let isHealthy;
    if (serviceName === 'chromadb') {
      let chromaDbService = null;
      try {
        chromaDbService = container.resolve(ServiceIds.CHROMA_DB);
      } catch {
        try {
          chromaDbService = require('../chromadb').getInstance();
        } catch {
          chromaDbService = null;
        }
      }
      // FIX: Ensure Boolean result to avoid undefined being treated ambiguously
      isHealthy = Boolean(await chromaDbService?.checkHealth?.());
    } else if (serviceName === 'ollama') {
      const baseUrl = process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434';
      const response = await axiosWithRetry(
        () => axios.get(`${baseUrl}/api/tags`, { timeout: 10000 }),
        {
          operation: 'Ollama service health check',
          maxRetries: 3,
          initialDelay: 1000,
          maxDelay: 4000
        }
      );
      isHealthy = response.status === 200;
    }

    if (isHealthy) {
      status.health = 'healthy';
      status.consecutiveFailures = 0;
    } else {
      throw new Error(`${serviceName} health check failed`);
    }
  } catch (error) {
    status.health = 'unhealthy';
    status.consecutiveFailures = (status.consecutiveFailures || 0) + 1;

    logger.warn(`[HEALTH] ${serviceName} health check failed:`, error.message);

    if (status.consecutiveFailures >= config.circuitBreakerConsecutiveFailures) {
      const restartCount = status.restartCount || 0;

      if (restartCount >= config.circuitBreakerThreshold) {
        logger.error(
          `[HEALTH] ${serviceName} exceeded circuit breaker threshold (${config.circuitBreakerThreshold} failures). Auto-disabling service.`
        );
        status.status = 'permanently_failed';
        status.health = 'permanently_failed';
        status.consecutiveFailures = 0;
        status.circuitBreakerTripped = true;
        status.circuitBreakerTrippedAt = new Date().toISOString();

        // FIX: Emit circuit breaker trip notification to renderer
        try {
          const { emitServiceStatusChange } = require('../../ipc/dependencies');
          emitServiceStatusChange({
            service: serviceName,
            status: 'permanently_failed',
            health: 'permanently_failed',
            details: {
              reason: 'circuit_breaker_tripped',
              restartAttempts: restartCount,
              trippedAt: status.circuitBreakerTrippedAt
            }
          });
        } catch (e) {
          logger.debug(`[HEALTH] Could not emit ${serviceName} circuit breaker status`, {
            error: e?.message
          });
        }
      } else {
        // Check for restart lock
        if (restartLocks[serviceName]) {
          logger.warn(
            `[HEALTH] ${serviceName} restart already in progress, skipping duplicate attempt.`
          );
        } else {
          // For Ollama, check port availability first
          if (serviceName === 'ollama') {
            const baseUrl = process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434';
            let host = '127.0.0.1';
            let port = 11434;
            try {
              const parsed = new URL(baseUrl);
              host = parsed.hostname || host;
              port = Number(parsed.port) || port;
            } catch {
              // ignore parse errors
            }

            const portAvailable = await isPortAvailable(host, port);
            if (!portAvailable) {
              logger.warn(
                '[HEALTH] Ollama port is already in use. Assuming external instance is running.'
              );
              status.consecutiveFailures = 0;
              status.health = 'degraded';
              return;
            }
          }

          logger.warn(
            `[HEALTH] Attempting to restart ${serviceName} (attempt ${restartCount + 1}/5)...`
          );
          restartLocks[serviceName] = true;
          status.restartCount = restartCount + 1;
          status.consecutiveFailures = 0;
          try {
            await startService();
          } finally {
            restartLocks[serviceName] = false;
          }
        }
      }
    }
  }
}

/**
 * Check health of all services
 * @param {Object} serviceStatus - Service status map
 * @param {Object} config - Circuit breaker config
 * @param {Object} restartLocks - Restart locks object
 * @param {Function} startChromaDB - Function to start ChromaDB
 * @param {Function} startOllama - Function to start Ollama
 * @returns {Promise<void>}
 */
async function checkServicesHealth(
  serviceStatus,
  config,
  restartLocks,
  startChromaDB,
  startOllama
) {
  logger.debug('[HEALTH] Checking service health...');

  // Handle circuit breaker recovery for ChromaDB
  await handleCircuitBreakerRecovery('chromadb', serviceStatus, startChromaDB, checkChromaDBHealth);

  // Handle circuit breaker recovery for Ollama
  await handleCircuitBreakerRecovery('ollama', serviceStatus, startOllama, checkOllamaHealth);

  // Check ChromaDB health
  await checkServiceHealthWithRecovery(
    'chromadb',
    serviceStatus,
    config,
    restartLocks,
    startChromaDB
  );

  // Check Ollama health
  await checkServiceHealthWithRecovery('ollama', serviceStatus, config, restartLocks, startOllama);
}

/**
 * Create health monitoring interval
 * @param {Object} options - Options
 * @param {Object} options.serviceStatus - Service status map
 * @param {Object} options.config - Config object
 * @param {Object} options.restartLocks - Restart locks
 * @param {Function} options.startChromaDB - ChromaDB start function
 * @param {Function} options.startOllama - Ollama start function
 * @param {Object} options.healthCheckState - Health check state ref
 * @returns {NodeJS.Timeout} Interval ID
 */
function createHealthMonitor({
  serviceStatus,
  config,
  restartLocks,
  startChromaDB,
  startOllama,
  healthCheckState
}) {
  logger.info('[STARTUP] Starting health monitoring...');

  const healthMonitor = setInterval(async () => {
    const healthCheckStartTime = Date.now();
    const healthCheckTimeout = 5000;

    if (healthCheckState.inProgress) {
      if (
        healthCheckState.startedAt &&
        Date.now() - healthCheckState.startedAt > healthCheckTimeout
      ) {
        logger.error(
          `[HEALTH] Health check stuck for ${(Date.now() - healthCheckState.startedAt) / 1000}s, force resetting flag`
        );
        healthCheckState.inProgress = false;
        healthCheckState.startedAt = null;
      } else {
        logger.warn('[HEALTH] Previous health check still in progress, skipping');
        return;
      }
    }

    healthCheckState.inProgress = true;
    healthCheckState.startedAt = healthCheckStartTime;

    // FIX: Store timeout ID so we can clear it after the race completes
    let timeoutId = null;
    try {
      const healthCheckPromise = checkServicesHealth(
        serviceStatus,
        config,
        restartLocks,
        startChromaDB,
        startOllama
      );

      const timeoutPromise = new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new Error(`Health check timeout after ${healthCheckTimeout}ms`));
        }, healthCheckTimeout);
      });

      await Promise.race([healthCheckPromise, timeoutPromise]);
    } catch (error) {
      logger.error('[HEALTH] Health check failed:', error.message);
    } finally {
      // FIX: Clear timeout to prevent memory leak
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      healthCheckState.inProgress = false;
      healthCheckState.startedAt = null;
    }
  }, config.healthCheckInterval);

  try {
    healthMonitor.unref();
  } catch (error) {
    logger.warn('[HEALTH] Failed to unref health monitor interval:', error.message);
  }

  return healthMonitor;
}

module.exports = {
  handleCircuitBreakerRecovery,
  checkServiceHealthWithRecovery,
  checkServicesHealth,
  createHealthMonitor,
  CIRCUIT_BREAKER_RECOVERY_WINDOW
};
