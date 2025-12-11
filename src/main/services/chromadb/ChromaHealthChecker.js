/**
 * ChromaDB Health Checker
 *
 * Health checking utilities for ChromaDB connections.
 * Extracted from ChromaDBService for better maintainability.
 *
 * @module services/chromadb/ChromaHealthChecker
 */

const axios = require('axios');
const { ChromaClient } = require('chromadb');
const { logger } = require('../../../shared/logger');
const { get: getConfig } = require('../../../shared/config/index');

logger.setContext('ChromaDB:HealthChecker');

/**
 * Check if ChromaDB server is healthy via HTTP endpoints
 *
 * Tries multiple API endpoints in parallel for faster detection.
 *
 * @param {string} serverUrl - Base server URL
 * @returns {Promise<{healthy: boolean, endpoint?: string}>}
 */
async function checkHealthViaHttp(serverUrl) {
  const endpoints = [
    '/api/v2/heartbeat', // v2 endpoint (current version)
    '/api/v1/heartbeat', // v1 endpoint (ChromaDB 1.0.x)
    '/api/v1' // Some versions just have this
  ];

  // Try all endpoints in parallel for faster health check
  const healthCheckPromises = endpoints.map(async (endpoint) => {
    try {
      const response = await axios.get(`${serverUrl}${endpoint}`, {
        timeout: 500, // 500ms timeout for quick failure
        validateStatus: () => true
      });

      if (response.status === 200) {
        // Validate response data
        if (response.data) {
          // Check for error responses
          if (typeof response.data === 'object' && response.data.error) {
            logger.debug(
              `[HealthChecker] Endpoint ${endpoint} returned error: ${response.data.error}`
            );
            return null;
          }

          // Check for valid heartbeat response
          if (
            response.data.nanosecond_heartbeat !== undefined ||
            response.data['nanosecond heartbeat'] !== undefined ||
            response.data.status === 'ok' ||
            response.data.version
          ) {
            logger.debug(`[HealthChecker] Successful on ${endpoint}`);
            return endpoint;
          }
        }

        // If we got a 200 with no specific error, consider it healthy
        logger.debug(`[HealthChecker] Successful (generic 200) on ${endpoint}`);
        return endpoint;
      }
    } catch (error) {
      logger.debug(`[HealthChecker] Failed on ${endpoint}: ${error.message}`);
    }
    return null;
  });

  const results = await Promise.all(healthCheckPromises);
  const successfulEndpoint = results.find((result) => result !== null);

  return {
    healthy: !!successfulEndpoint,
    endpoint: successfulEndpoint
  };
}

/**
 * Check health via ChromaDB client heartbeat
 *
 * @param {ChromaClient} client - ChromaDB client instance
 * @returns {Promise<boolean>}
 */
async function checkHealthViaClient(client) {
  if (!client) {
    return false;
  }

  try {
    const response = await client.heartbeat();
    const isHealthy =
      response && (response.nanosecond_heartbeat > 0 || response['nanosecond heartbeat'] > 0);

    if (isHealthy) {
      logger.debug('[HealthChecker] Successful via client.heartbeat()');
    }
    return isHealthy;
  } catch (error) {
    logger.debug('[HealthChecker] Client heartbeat failed:', error.message);
    return false;
  }
}

/**
 * Check if ChromaDB server is available with retry logic
 *
 * @param {Object} options - Options
 * @param {string} options.serverUrl - Server URL
 * @param {ChromaClient} options.client - Existing client (optional)
 * @param {number} options.timeoutMs - Timeout in ms (default: 3000)
 * @param {number} options.maxRetries - Max retry attempts (default: 3)
 * @returns {Promise<boolean>}
 */
async function isServerAvailable({ serverUrl, client = null, timeoutMs = 3000, maxRetries = 3 }) {
  let lastError = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      // Reuse existing client if available to avoid creating
      // disposable ChromaClient instances that create TIME_WAIT connections
      const checkClient =
        client ||
        new ChromaClient({
          path: serverUrl
        });

      // Wrap heartbeat in Promise.race with timeout
      let timeoutId;
      const heartbeatPromise = checkClient.heartbeat();
      const timeoutPromise = new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new Error(`Heartbeat timeout after ${timeoutMs}ms`));
        }, timeoutMs);
      });

      let hb;
      try {
        hb = await Promise.race([heartbeatPromise, timeoutPromise]);
      } finally {
        if (timeoutId) clearTimeout(timeoutId);
      }

      logger.debug('[HealthChecker] Server heartbeat successful:', {
        hb,
        serverUrl,
        attempt: attempt + 1
      });
      return true;
    } catch (error) {
      lastError = error;

      const isTimeout = error.message && error.message.includes('timeout');
      const isNetworkError =
        error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT' || error.code === 'ENOTFOUND';

      const shouldRetry = (isTimeout || isNetworkError) && attempt < maxRetries - 1;

      if (shouldRetry) {
        // Exponential backoff: 500ms, 1000ms, 2000ms
        const delay = 500 * Math.pow(2, attempt);
        logger.debug('[HealthChecker] Heartbeat failed, retrying...:', {
          attempt: attempt + 1,
          maxRetries,
          delayMs: delay,
          error: error.message,
          serverUrl
        });
        await new Promise((resolve) => setTimeout(resolve, delay));
      } else {
        if (isTimeout) {
          logger.debug('[HealthChecker] Heartbeat timed out:', {
            timeoutMs,
            serverUrl,
            attempt: attempt + 1
          });
        } else {
          logger.debug('[HealthChecker] Heartbeat failed:', {
            message: error.message,
            serverUrl,
            attempt: attempt + 1
          });
        }
      }
    }
  }

  logger.warn('[HealthChecker] Availability check failed after all retries:', {
    maxRetries,
    lastError: lastError?.message
  });
  return false;
}

/**
 * Create a periodic health check interval
 *
 * @param {Object} options - Options
 * @param {Function} options.checkFn - Health check function to call
 * @param {number} options.intervalMs - Interval in milliseconds
 * @returns {Object} Object with interval ID and stop function
 */
function createHealthCheckInterval({ checkFn, intervalMs }) {
  const interval = getConfig('PERFORMANCE.healthCheckInterval', intervalMs || 30000);

  // Initial check
  checkFn().catch((err) => {
    logger.debug('[HealthChecker] Initial check failed', {
      error: err.message
    });
  });

  const intervalId = setInterval(() => {
    checkFn().catch((err) => {
      logger.debug('[HealthChecker] Periodic check failed', {
        error: err.message
      });
    });
  }, interval);

  // Unref to allow process to exit
  if (intervalId.unref) {
    intervalId.unref();
  }

  return {
    intervalId,
    stop: () => {
      clearInterval(intervalId);
    }
  };
}

module.exports = {
  checkHealthViaHttp,
  checkHealthViaClient,
  isServerAvailable,
  createHealthCheckInterval
};
