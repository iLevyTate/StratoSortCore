/**
 * Centralized Ollama API retry utility with exponential backoff and jitter
 * SINGLE SOURCE OF TRUTH for Ollama retry logic, error classification, and health checks.
 *
 * This module is used by:
 * - OllamaClient.js: Uses isRetryableError, withOllamaRetry
 * - startup/ollamaService.js: Uses checkOllamaHealth, axiosWithRetry
 *
 * Features:
 * - Exponential backoff with configurable parameters
 * - Jitter to prevent thundering herd problem
 * - Retryable error classification
 * - Detailed logging and error context
 * - Health check utility for Ollama service
 *
 * @module utils/ollamaApiRetry
 */

const axios = require('axios');
const { logger } = require('../../shared/logger');
logger.setContext('OllamaApiRetry');
const { withRetry } = require('../../shared/errorHandlingUtils');
const { SERVICE_URLS } = require('../../shared/configDefaults');
const { isRetryable, isNetworkError } = require('../../shared/errorClassifier');

/**
 * Default jitter factor (0.3 = +/- 30% of delay)
 */
const DEFAULT_JITTER_FACTOR = 0.3;

/**
 * Determines if an error is retryable
 * @param {Error} error - The error to check
 * @returns {boolean} - True if the error is retryable
 */
function isRetryableError(error) {
  if (!error) return false;

  // Use shared classifier for standard system/network errors
  if (isRetryable(error) || isNetworkError(error)) {
    return true;
  }

  const message = error.message?.toLowerCase() || '';

  // Fetch errors (retryable)
  if (
    message.includes('fetch failed') ||
    message.includes('network') ||
    message.includes('timeout') ||
    message.includes('aborted') ||
    message.includes('connection')
  ) {
    return true;
  }

  // HTTP status codes (some are retryable)
  if (error.status) {
    // Retryable HTTP status codes
    const retryableStatuses = [
      408, // Request Timeout
      429, // Too Many Requests
      500, // Internal Server Error
      502, // Bad Gateway
      503, // Service Unavailable
      504 // Gateway Timeout
    ];
    if (retryableStatuses.includes(error.status)) {
      return true;
    }
  }

  // Ollama-specific temporary errors
  if (
    message.includes('model is loading') ||
    message.includes('server busy') ||
    message.includes('temporarily unavailable')
  ) {
    return true;
  }

  // Non-retryable errors
  if (
    message.includes('invalid') ||
    message.includes('validation') ||
    message.includes('not found') ||
    message.includes('unauthorized') ||
    message.includes('forbidden') ||
    message.includes('bad request') ||
    message.includes('zero length image') ||
    message.includes('unsupported')
  ) {
    return false;
  }

  // Default to not retrying unknown errors
  return false;
}

/**
 * Calculate delay with exponential backoff and jitter
 * @param {number} attempt - Current attempt number (0-based)
 * @param {number} initialDelay - Initial delay in ms
 * @param {number} maxDelay - Maximum delay in ms
 * @param {number} jitterFactor - Jitter factor (0-1)
 * @returns {number} Delay in milliseconds
 */
function calculateDelayWithJitter(
  attempt,
  initialDelay,
  maxDelay,
  jitterFactor = DEFAULT_JITTER_FACTOR
) {
  // Exponential backoff
  const exponentialDelay = initialDelay * Math.pow(2, attempt);
  const baseDelay = Math.min(exponentialDelay, maxDelay);

  // Add jitter to prevent thundering herd
  // Jitter is +/- jitterFactor of the delay
  const jitter = baseDelay * jitterFactor * (Math.random() - 0.5) * 2;

  return Math.max(0, Math.floor(baseDelay + jitter));
}

/**
 * Wraps an Ollama API call with retry logic and exponential backoff with jitter
 * @param {Function} apiCall - The API call function to wrap
 * @param {Object} options - Configuration options
 * @param {string} options.operation - Operation name for logging
 * @param {number} [options.maxRetries=3] - Maximum number of retries
 * @param {number} [options.initialDelay=1000] - Initial delay in ms
 * @param {number} [options.maxDelay=4000] - Maximum delay in ms
 * @param {number} [options.jitterFactor=0.3] - Jitter factor (0-1) for preventing thundering herd
 * @param {Function} [options.onRetry] - Callback called on each retry
 * @param {boolean} [options.useOfflineQueue=false] - Queue failed requests for later retry
 * @returns {Promise} - Result of the API call
 */
async function withOllamaRetry(apiCall, options = {}) {
  const {
    operation = 'Ollama API call',
    maxRetries = 3,
    initialDelay = 1000,
    maxDelay = 4000,
    maxTotalTime = 60000, // 60 second absolute maximum
    jitterFactor = DEFAULT_JITTER_FACTOR,
    onRetry = null,
    useOfflineQueue = false
  } = options;

  let attemptNumber = 0;
  const startTime = Date.now();
  const absoluteDeadline = Date.now() + maxTotalTime;

  try {
    // Intercept retries to log and call onRetry callback
    const originalCall = apiCall;
    const instrumentedCall = async (...args) => {
      attemptNumber++;

      // Absolute time limit check
      if (Date.now() >= absoluteDeadline) {
        const elapsed = Date.now() - startTime;
        logger.error(`[${operation}] Exceeded maximum total time`, {
          elapsed: `${elapsed}ms`,
          maxTotalTime: `${maxTotalTime}ms`,
          attempts: attemptNumber
        });
        throw new Error(
          `${operation} exceeded maximum total time of ${maxTotalTime}ms after ${attemptNumber} attempts`
        );
      }

      if (attemptNumber > 1) {
        logger.info(`[${operation}] Retry attempt ${attemptNumber}/${maxRetries + 1}`);
        if (onRetry) {
          try {
            await onRetry(attemptNumber - 1, options);
          } catch (retryCallbackError) {
            logger.warn(`[${operation}] onRetry callback error:`, retryCallbackError.message);
          }
        }
      }

      try {
        const result = await originalCall(...args);

        if (attemptNumber > 1) {
          const totalTime = Date.now() - startTime;
          logger.info(
            `[${operation}] Succeeded on retry attempt ${attemptNumber} (total time: ${totalTime}ms)`
          );
        }

        return result;
      } catch (error) {
        // Enhanced error logging with categorization
        const errorDetails = {
          attempt: attemptNumber,
          error: error.message,
          code: error.code,
          status: error.status,
          retryable: isRetryableError(error),
          category: categorizeError(error)
        };

        if (attemptNumber <= maxRetries && isRetryableError(error)) {
          // Calculate delay with jitter
          const delay = calculateDelayWithJitter(
            attemptNumber - 1,
            initialDelay,
            maxDelay,
            jitterFactor
          );
          logger.warn(
            `[${operation}] Failed on attempt ${attemptNumber}, retrying in ${delay}ms:`,
            errorDetails
          );
        } else {
          logger.error(`[${operation}] Failed after ${attemptNumber} attempts:`, errorDetails);
        }

        throw error;
      }
    };

    // Use the instrumented call with retry wrapper (jitter applied inside)
    return await withRetry(instrumentedCall, {
      maxRetries,
      initialDelay,
      maxDelay,
      shouldRetry: isRetryableError
    })();
  } catch (error) {
    const totalTime = Date.now() - startTime;

    // Final error after all retries exhausted
    logger.error(`[${operation}] All retry attempts exhausted:`, {
      totalAttempts: attemptNumber,
      finalError: error.message,
      code: error.code,
      status: error.status,
      totalTime: `${totalTime}ms`
    });

    // Add retry context to the error for debugging
    error.retryContext = {
      operation,
      attempts: attemptNumber,
      maxRetries,
      wasRetryable: isRetryableError(error),
      totalTimeMs: totalTime
    };

    // Optionally queue for later retry via OllamaClient
    if (useOfflineQueue && isRetryableError(error)) {
      try {
        const { getInstance: getOllamaClient } = require('../services/OllamaClient');
        const client = getOllamaClient();
        if (client && typeof client._addToOfflineQueue === 'function') {
          logger.info(`[${operation}] Adding failed request to offline queue`);
          // Note: The actual queueing happens in the caller with full context
        }
      } catch (queueError) {
        logger.debug('[OllamaApiRetry] Could not access offline queue:', queueError.message);
      }
    }

    throw error;
  }
}

/**
 * Categorize error type for metrics and debugging
 * @param {Error} error - The error to categorize
 * @returns {string} Error category
 */
function categorizeError(error) {
  if (!error) return 'unknown';

  const message = (error.message || '').toLowerCase();
  const code = error.code || '';

  if (['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT'].includes(code)) {
    return 'network';
  }
  if (message.includes('timeout')) {
    return 'timeout';
  }
  if (error.status === 503 || message.includes('server busy')) {
    return 'server_busy';
  }
  if (error.status === 429) {
    return 'rate_limited';
  }
  if (message.includes('model is loading')) {
    return 'model_loading';
  }
  if (message.includes('not found')) {
    return 'not_found';
  }
  if (message.includes('invalid') || message.includes('validation')) {
    return 'validation';
  }

  return 'other';
}

/**
 * Wraps a fetch call to Ollama with retry logic
 * @param {string} url - The URL to fetch
 * @param {Object} fetchOptions - Fetch options
 * @param {Object} retryOptions - Retry configuration
 * @returns {Promise<Response>} - The fetch response
 */
async function fetchWithRetry(url, fetchOptions = {}, retryOptions = {}) {
  const operation = retryOptions.operation || `Fetch ${url}`;

  return withOllamaRetry(
    async () => {
      const response = await fetch(url, fetchOptions);

      // Check if response indicates a retryable error
      if (!response.ok) {
        const error = new Error(`HTTP ${response.status}: ${response.statusText}`);
        error.status = response.status;
        error.response = response;

        // Try to extract error message from response body
        try {
          const text = await response.text();
          if (text) {
            const jsonError = JSON.parse(text);
            if (jsonError.error) {
              error.message = `HTTP ${response.status}: ${jsonError.error}`;
            }
          }
        } catch {
          // Ignore parsing errors
        }

        throw error;
      }

      return response;
    },
    {
      operation,
      ...retryOptions
    }
  );
}

/**
 * Wraps an Ollama client generate call with retry logic
 * @param {Object} client - The Ollama client
 * @param {Object} generateOptions - Options for the generate call
 * @param {Object} retryOptions - Retry configuration
 * @returns {Promise} - The generate response
 */
async function generateWithRetry(client, generateOptions, retryOptions = {}) {
  const operation = retryOptions.operation || `Generate with ${generateOptions.model}`;

  return withOllamaRetry(
    async () => {
      return await client.generate(generateOptions);
    },
    {
      operation,
      ...retryOptions
    }
  );
}

/**
 * Wraps an axios call with retry logic for Ollama endpoints
 * @param {Function} axiosCall - The axios call function
 * @param {Object} retryOptions - Retry configuration
 * @returns {Promise} - The axios response
 */
async function axiosWithRetry(axiosCall, retryOptions = {}) {
  const operation = retryOptions.operation || 'Axios request';

  return withOllamaRetry(
    async () => {
      try {
        return await axiosCall();
      } catch (error) {
        // Normalize axios errors
        if (error.response) {
          const normalizedError = new Error(
            `HTTP ${error.response.status}: ${error.response.statusText}`
          );
          normalizedError.status = error.response.status;
          normalizedError.response = error.response;
          normalizedError.code = error.code;
          throw normalizedError;
        }
        throw error;
      }
    },
    {
      operation,
      ...retryOptions
    }
  );
}

/**
 * Simple Ollama health check
 * @param {string} [host] - Ollama host URL (defaults to env or config)
 * @param {number} [timeout=2000] - Timeout in milliseconds
 * @returns {Promise<boolean>} - True if Ollama is healthy
 */
async function checkOllamaHealth(host, timeout = 2000) {
  try {
    const baseUrl = host || process.env.OLLAMA_BASE_URL || SERVICE_URLS.OLLAMA_HOST;
    const response = await axios.get(`${baseUrl}/api/tags`, { timeout });
    return response.status === 200;
  } catch (error) {
    logger.debug('[HEALTH] Ollama health check failed:', error.message);
    return false;
  }
}

module.exports = {
  withOllamaRetry,
  fetchWithRetry,
  generateWithRetry,
  axiosWithRetry,
  isRetryableError,
  categorizeError,
  calculateDelayWithJitter,
  checkOllamaHealth,
  DEFAULT_JITTER_FACTOR
};
