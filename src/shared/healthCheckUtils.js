/**
 * Health Check Utilities
 *
 * Provides reusable health checking primitives for service monitoring.
 *
 * @module shared/healthCheckUtils
 */

const { logger } = require('./logger');

/**
 * Create a periodic health check interval
 *
 * Features:
 * - Configurable interval and timeout
 * - Prevents overlapping checks
 * - Handles stuck checks with force reset
 * - Unref'd to not prevent process exit
 *
 * @param {Object} options - Options
 * @param {Function} options.checkFn - Async function that performs the health check
 * @param {number} options.intervalMs - Interval between checks in milliseconds
 * @param {number} options.timeoutMs - Timeout for each check (default: 5000)
 * @param {string} options.name - Name for logging (default: 'HealthCheck')
 * @param {Function} options.onHealthy - Callback when check passes
 * @param {Function} options.onUnhealthy - Callback when check fails
 * @returns {Object} Object with stop() method and state
 */
function createHealthCheckInterval(options) {
  const {
    checkFn,
    intervalMs,
    timeoutMs = 5000,
    name = 'HealthCheck',
    onHealthy,
    onUnhealthy
  } = options;

  const state = {
    inProgress: false,
    startedAt: null,
    lastCheckTime: null,
    consecutiveFailures: 0,
    isHealthy: true,
    stopped: false
  };

  let intervalId = null;

  async function performCheck() {
    if (state.stopped) return;

    // Handle stuck checks
    if (state.inProgress) {
      if (state.startedAt && Date.now() - state.startedAt > timeoutMs * 2) {
        logger.warn(
          `[${name}] Health check stuck for ${(Date.now() - state.startedAt) / 1000}s, force resetting`
        );
        state.inProgress = false;
        state.startedAt = null;
      } else {
        logger.debug(`[${name}] Previous health check still in progress, skipping`);
        return;
      }
    }

    state.inProgress = true;
    state.startedAt = Date.now();

    let timeoutId = null;
    try {
      const checkPromise = checkFn();
      const timeoutPromise = new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new Error(`Health check timeout after ${timeoutMs}ms`));
        }, timeoutMs);
      });

      await Promise.race([checkPromise, timeoutPromise]);

      state.isHealthy = true;
      state.consecutiveFailures = 0;
      state.lastCheckTime = Date.now();

      if (onHealthy) {
        try {
          onHealthy();
        } catch (e) {
          logger.debug(`[${name}] onHealthy callback error:`, e.message);
        }
      }
    } catch (error) {
      state.consecutiveFailures++;
      state.isHealthy = false;
      state.lastCheckTime = Date.now();

      logger.debug(`[${name}] Health check failed:`, error.message);

      if (onUnhealthy) {
        try {
          onUnhealthy(error, state.consecutiveFailures);
        } catch (e) {
          logger.debug(`[${name}] onUnhealthy callback error:`, e.message);
        }
      }
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
      state.inProgress = false;
      state.startedAt = null;
    }
  }

  // Perform initial check
  performCheck().catch((err) => {
    logger.debug(`[${name}] Initial check failed:`, err.message);
  });

  // Start interval
  intervalId = setInterval(performCheck, intervalMs);

  // Unref to allow process to exit
  if (intervalId.unref) {
    intervalId.unref();
  }

  return {
    state,
    stop: () => {
      state.stopped = true;
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
      }
    },
    forceCheck: () => performCheck()
  };
}

module.exports = {
  createHealthCheckInterval
};
