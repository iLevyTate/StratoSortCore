/**
 * Centralized Ollama API retry utility with exponential backoff
 * Provides robust error handling for transient failures
 */

const { logger } = require('../../shared/logger');
logger.setContext('OllamaApiRetry');
const { withRetry } = require('../../shared/errorHandlingUtils');

/**
 * Determines if an error is retryable
 * @param {Error} error - The error to check
 * @returns {boolean} - True if the error is retryable
 */
function isRetryableError(error) {
  if (!error) return false;

  const message = error.message?.toLowerCase() || '';
  const code = error.code || '';

  // Network errors (retryable)
  if (
    code === 'ECONNREFUSED' ||
    code === 'ECONNRESET' ||
    code === 'ETIMEDOUT' ||
    code === 'ENOTFOUND' ||
    code === 'EHOSTUNREACH' ||
    code === 'ENETUNREACH'
  ) {
    return true;
  }

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
      504, // Gateway Timeout
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
 * Wraps an Ollama API call with retry logic and exponential backoff
 * @param {Function} apiCall - The API call function to wrap
 * @param {Object} options - Configuration options
 * @param {string} options.operation - Operation name for logging
 * @param {number} [options.maxRetries=3] - Maximum number of retries
 * @param {number} [options.initialDelay=1000] - Initial delay in ms
 * @param {number} [options.maxDelay=4000] - Maximum delay in ms
 * @param {Function} [options.onRetry] - Callback called on each retry
 * @returns {Promise} - Result of the API call
 */
async function withOllamaRetry(apiCall, options = {}) {
  const {
    operation = 'Ollama API call',
    maxRetries = 3,
    initialDelay = 1000,
    maxDelay = 4000,
    onRetry = null,
  } = options;

  let attemptNumber = 0;

  try {
    // Intercept retries to log and call onRetry callback
    const originalCall = apiCall;
    const instrumentedCall = async (...args) => {
      attemptNumber++;

      if (attemptNumber > 1) {
        logger.info(
          `[${operation}] Retry attempt ${attemptNumber}/${maxRetries + 1}`,
        );
        if (onRetry) {
          await onRetry(attemptNumber - 1, options);
        }
      }

      try {
        const result = await originalCall(...args);

        if (attemptNumber > 1) {
          logger.info(
            `[${operation}] Succeeded on retry attempt ${attemptNumber}`,
          );
        }

        return result;
      } catch (error) {
        // Enhanced error logging
        const errorDetails = {
          attempt: attemptNumber,
          error: error.message,
          code: error.code,
          status: error.status,
          retryable: isRetryableError(error),
        };

        if (attemptNumber <= maxRetries && isRetryableError(error)) {
          const delay = Math.min(
            initialDelay * Math.pow(2, attemptNumber - 1),
            maxDelay,
          );
          logger.warn(
            `[${operation}] Failed on attempt ${attemptNumber}, retrying in ${delay}ms:`,
            errorDetails,
          );
        } else {
          logger.error(
            `[${operation}] Failed after ${attemptNumber} attempts:`,
            errorDetails,
          );
        }

        throw error;
      }
    };

    // Use the instrumented call with retry wrapper
    return await withRetry(instrumentedCall, {
      maxRetries,
      initialDelay,
      maxDelay,
      shouldRetry: isRetryableError,
    })();
  } catch (error) {
    // Final error after all retries exhausted
    logger.error(`[${operation}] All retry attempts exhausted:`, {
      totalAttempts: attemptNumber,
      finalError: error.message,
      code: error.code,
      status: error.status,
    });

    // Add retry context to the error
    error.retryContext = {
      operation,
      attempts: attemptNumber,
      maxRetries,
      wasRetryable: isRetryableError(error),
    };

    throw error;
  }
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
        const error = new Error(
          `HTTP ${response.status}: ${response.statusText}`,
        );
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
      ...retryOptions,
    },
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
  const operation =
    retryOptions.operation || `Generate with ${generateOptions.model}`;

  return withOllamaRetry(
    async () => {
      return await client.generate(generateOptions);
    },
    {
      operation,
      ...retryOptions,
    },
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
            `HTTP ${error.response.status}: ${error.response.statusText}`,
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
      ...retryOptions,
    },
  );
}

module.exports = {
  withOllamaRetry,
  fetchWithRetry,
  generateWithRetry,
  axiosWithRetry,
  isRetryableError,
};
