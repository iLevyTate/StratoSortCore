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
const {
  createHealthCheckInterval: createSharedHealthCheckInterval
} = require('../../../shared/healthCheckUtils');
const { isNetworkError, isRetryable } = require('../../../shared/errorClassifier');
const { withTimeout } = require('../../../shared/promiseUtils');

logger.setContext('ChromaDB:HealthChecker');

function parseServerUrl(serverUrl) {
  const parsed = new URL(serverUrl);
  return {
    ssl: parsed.protocol === 'https:',
    host: parsed.hostname,
    port: parsed.port ? Number(parsed.port) : parsed.protocol === 'https:' ? 443 : 80
  };
}

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
 * FIX: Creates disposable client once outside the retry loop to prevent
 * connection leaks from creating multiple ChromaClient instances
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

  // FIX: Create disposable client once outside the loop to prevent connection leaks
  // Each ChromaClient creates HTTP agent connections that accumulate in TIME_WAIT state
  let checkClient = client;
  let isDisposableClient = false;

  if (!checkClient) {
    try {
      checkClient = new ChromaClient(parseServerUrl(serverUrl));
      isDisposableClient = true;
    } catch (error) {
      logger.warn('[HealthChecker] Failed to create check client:', error.message);
      return false;
    }
  }

  try {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        // Use shared timeout utility for heartbeat check
        const hb = await withTimeout(checkClient.heartbeat(), timeoutMs, 'ChromaDB heartbeat');

        logger.debug('[HealthChecker] Server heartbeat successful:', {
          hb,
          serverUrl,
          attempt: attempt + 1
        });
        return true;
      } catch (error) {
        lastError = error;

        const shouldRetry =
          (isRetryable(error) || isNetworkError(error)) && attempt < maxRetries - 1;

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
          logger.debug('[HealthChecker] Heartbeat failed:', {
            message: error.message,
            code: error.code,
            serverUrl,
            attempt: attempt + 1
          });
        }
      }
    }

    logger.warn('[HealthChecker] Availability check failed after all retries:', {
      maxRetries,
      lastError: lastError?.message
    });
    return false;
  } finally {
    // FIX: Clean up disposable client reference to allow garbage collection
    // Note: ChromaClient doesn't have an explicit close() method, but nulling
    // the reference helps GC and signals we're done with it
    if (isDisposableClient) {
      checkClient = null;
    }
  }
}

/**
 * Create a periodic health check interval
 *
 * Uses shared healthCheckUtils for consistent behavior across services.
 *
 * @param {Object} options - Options
 * @param {Function} options.checkFn - Health check function to call
 * @param {number} options.intervalMs - Interval in milliseconds
 * @returns {Object} Object with stop function and state
 */
function createHealthCheckInterval({ checkFn, intervalMs }) {
  const interval = getConfig('PERFORMANCE.healthCheckInterval', intervalMs || 30000);

  const checker = createSharedHealthCheckInterval({
    checkFn,
    intervalMs: interval,
    timeoutMs: 5000,
    name: 'ChromaDB:HealthChecker'
  });

  // Return compatible interface
  return {
    intervalId: null, // Not exposed by shared utility
    stop: checker.stop,
    state: checker.state
  };
}

module.exports = {
  checkHealthViaHttp,
  checkHealthViaClient,
  isServerAvailable,
  createHealthCheckInterval
};
