/**
 * Shutdown Handler
 *
 * Graceful shutdown logic for services.
 * Extracted from StartupManager for better maintainability.
 *
 * @module services/startup/shutdownHandler
 */

const os = require('os');
const { spawn } = require('child_process');
const { logger } = require('../../../shared/logger');
logger.setContext('StartupManager:Shutdown');

/**
 * Shutdown a single process gracefully
 * @param {string} serviceName - Service name
 * @param {Object} process - Process object
 * @returns {Promise<void>}
 */
async function shutdownProcess(serviceName, process) {
  try {
    logger.info(`[STARTUP] Stopping ${serviceName}...`);

    // Comprehensive null/existence checks
    if (!process) {
      logger.debug(`[STARTUP] ${serviceName} process is null, nothing to stop`);
      return;
    }

    if (typeof process !== 'object') {
      logger.warn(`[STARTUP] ${serviceName} process is not an object:`, typeof process);
      return;
    }

    if (!process.pid) {
      logger.debug(`[STARTUP] ${serviceName} process has no PID, likely already terminated`);
      return;
    }

    if (process.killed) {
      logger.debug(`[STARTUP] ${serviceName} already killed`);
      return;
    }

    if (process.exitCode !== null && process.exitCode !== undefined) {
      logger.debug(`[STARTUP] ${serviceName} already exited with code ${process.exitCode}`);
      return;
    }

    // Remove event listeners
    if (typeof process.removeAllListeners === 'function') {
      try {
        process.removeAllListeners();
      } catch (error) {
        logger.warn(`[STARTUP] Failed to remove listeners for ${serviceName}:`, error.message);
      }
    } else {
      logger.warn(`[STARTUP] ${serviceName} process does not have removeAllListeners method`);
    }

    if (typeof process.kill !== 'function') {
      logger.error(`[STARTUP] ${serviceName} process does not have kill method`);
      return;
    }

    // Try graceful shutdown first
    try {
      process.kill('SIGTERM');
    } catch (killError) {
      if (killError.code === 'ESRCH') {
        logger.debug(
          `[STARTUP] ${serviceName} process not found (PID: ${process.pid}), already terminated`
        );
        return;
      }
      logger.warn(`[STARTUP] Failed to send SIGTERM to ${serviceName}:`, killError.message);
    }

    // Wait up to 5 seconds for graceful shutdown
    await new Promise((resolve) => {
      let resolved = false;
      const timeout = setTimeout(() => {
        if (!resolved) {
          resolved = true;

          if (!process || process.killed || process.exitCode !== null) {
            logger.debug(`[STARTUP] ${serviceName} already terminated, no force kill needed`);
            resolve();
            return;
          }

          logger.warn(`[STARTUP] Force killing ${serviceName}...`);
          try {
            const isWindows = os.platform() === 'win32';
            if (isWindows && process.pid) {
              spawn('taskkill', ['/pid', process.pid.toString(), '/f', '/t'], {
                windowsHide: true,
                stdio: 'ignore'
              });
            } else if (process.pid && typeof process.kill === 'function') {
              process.kill('SIGKILL');
            }
          } catch (e) {
            if (e.code === 'ESRCH') {
              logger.debug(
                `[STARTUP] Process ${serviceName} not found during force kill, already terminated`
              );
            } else {
              logger.debug(`[STARTUP] Process ${serviceName} may have already exited:`, e.message);
            }
          }
          resolve();
        }
      }, 5000);

      if (!process || typeof process.once !== 'function') {
        logger.warn(`[STARTUP] ${serviceName} process does not support event listeners`);
        clearTimeout(timeout);
        resolved = true;
        resolve();
        return;
      }

      try {
        process.once('exit', () => {
          if (!resolved) {
            resolved = true;
            clearTimeout(timeout);
            logger.info(`[STARTUP] ${serviceName} stopped gracefully`);
            resolve();
          }
        });
      } catch (error) {
        logger.warn(`[STARTUP] Failed to attach exit listener to ${serviceName}:`, error.message);
      }

      try {
        process.once('error', (error) => {
          if (!resolved) {
            resolved = true;
            clearTimeout(timeout);
            if (error.code === 'ESRCH') {
              logger.debug(`[STARTUP] ${serviceName} process not found, already terminated`);
            } else {
              logger.debug(
                `[STARTUP] ${serviceName} process error during shutdown:`,
                error.message
              );
            }
            resolve();
          }
        });
      } catch (error) {
        logger.warn(`[STARTUP] Failed to attach error listener to ${serviceName}:`, error.message);
      }
    });
  } catch (error) {
    logger.error(`[STARTUP] Error stopping ${serviceName}:`, {
      error: error.message,
      stack: error.stack
    });
  }
}

/**
 * Shutdown all services
 * @param {Object} options - Options
 * @param {Map} options.serviceProcesses - Service processes map
 * @param {Object} options.serviceStatus - Service status object
 * @param {NodeJS.Timeout|null} options.healthMonitor - Health monitor interval
 * @param {Object} options.healthCheckState - Health check state
 * @returns {Promise<void>}
 */
async function shutdown({ serviceProcesses, serviceStatus, healthMonitor, healthCheckState }) {
  logger.info('[STARTUP] Shutting down services...');

  // Stop health monitoring first
  if (healthMonitor) {
    clearInterval(healthMonitor);
    logger.info('[STARTUP] Health monitoring stopped');
  }

  // Reset health check flag
  if (healthCheckState) {
    healthCheckState.inProgress = false;
  }

  // Gracefully stop all service processes
  const shutdownPromises = [];
  for (const [serviceName, process] of serviceProcesses) {
    shutdownPromises.push(shutdownProcess(serviceName, process));
  }

  // Wait for all processes to shut down
  await Promise.allSettled(shutdownPromises);

  // Clear the service processes map
  serviceProcesses.clear();

  // Reset service status
  for (const service in serviceStatus) {
    serviceStatus[service].status = 'stopped';
    serviceStatus[service].health = 'unknown';
  }

  logger.info('[STARTUP] All services shut down successfully');
}

module.exports = {
  shutdownProcess,
  shutdown
};
