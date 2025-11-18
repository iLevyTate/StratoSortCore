/**
 * Promise utilities for robust async operations
 */

const { logger } = require('../../shared/logger');

/**
 * Execute a promise with a timeout
 * @param {Promise} promise - The promise to execute
 * @param {number} timeoutMs - Timeout in milliseconds
 * @param {string} operationName - Name of the operation for logging
 * @returns {Promise} The result or timeout error
 */
async function withTimeout(
  promise,
  timeoutMs = 30000,
  operationName = 'Operation',
) {
  let timeoutId = null;

  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`${operationName} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    // Allow process to exit even if timeout is pending
    if (timeoutId.unref) {
      timeoutId.unref();
    }
  });

  try {
    const result = await Promise.race([promise, timeoutPromise]);
    clearTimeout(timeoutId);
    return result;
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}

/**
 * Execute a promise with retry logic
 * @param {Function} fn - Function that returns a promise
 * @param {Object} options - Retry options
 * @returns {Promise} The successful result or final error
 */
async function withRetry(
  fn,
  {
    maxAttempts = 3,
    delay = 1000,
    backoff = 2,
    operationName = 'Operation',
    shouldRetry = () => true,
  } = {},
) {
  let lastError;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      if (attempt === maxAttempts) {
        logger.error(
          `[Retry] ${operationName} failed after ${maxAttempts} attempts`,
          {
            error: error.message,
          },
        );
        break;
      }

      // Check if we should retry this error
      if (!shouldRetry(error, attempt)) {
        logger.info(`[Retry] ${operationName} not retryable`, {
          error: error.message,
          attempt,
        });
        break;
      }

      const waitTime = delay * Math.pow(backoff, attempt - 1);
      logger.warn(
        `[Retry] ${operationName} attempt ${attempt} failed, retrying in ${waitTime}ms`,
        {
          error: error.message,
        },
      );

      await new Promise((resolve) => setTimeout(resolve, waitTime));
    }
  }

  throw lastError;
}

/**
 * Ensure all promises in an array are settled with proper error handling
 * @param {Array<Promise>} promises - Array of promises
 * @param {Function} onError - Error handler for failed promises
 * @returns {Promise<Array>} Array of results
 */
async function allSettledWithErrors(promises, onError = null) {
  if (!Array.isArray(promises)) {
    throw new Error('Expected an array of promises');
  }

  const results = await Promise.allSettled(promises);
  const finalResults = [];
  const errors = [];

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (result.status === 'fulfilled') {
      finalResults.push(result.value);
    } else {
      errors.push({ index: i, error: result.reason });
      finalResults.push(null);

      if (onError) {
        try {
          await onError(result.reason, i);
        } catch (handlerError) {
          logger.error('[AllSettled] Error handler failed', {
            error: handlerError.message,
            originalError: result.reason?.message,
          });
        }
      }
    }
  }

  if (errors.length > 0) {
    logger.warn(
      `[AllSettled] ${errors.length} of ${promises.length} promises failed`,
      {
        errors: errors.map((e) => ({
          index: e.index,
          message: e.error?.message,
        })),
      },
    );
  }

  return finalResults;
}

/**
 * Create a deferred promise that can be resolved/rejected externally
 * @returns {Object} Object with promise, resolve, and reject functions
 */
function createDeferred() {
  let resolve, reject;

  const promise = new Promise((_resolve, _reject) => {
    resolve = _resolve;
    reject = _reject;
  });

  return { promise, resolve, reject };
}

/**
 * Execute promises in batches with controlled concurrency
 * @param {Array} items - Items to process
 * @param {Function} fn - Function to execute for each item
 * @param {number} batchSize - Number of concurrent promises
 * @returns {Promise<Array>} Array of results
 */
async function batchProcess(items, fn, batchSize = 5) {
  const results = [];

  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const batchPromises = batch.map((item, index) => fn(item, i + index));
    const batchResults = await allSettledWithErrors(batchPromises);
    results.push(...batchResults);

    // Add small delay between batches to prevent overwhelming the system
    if (i + batchSize < items.length) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  return results;
}

/**
 * Create a promise that resolves after a delay
 * @param {number} ms - Delay in milliseconds
 * @returns {Promise} Promise that resolves after delay
 */
function delay(ms) {
  return new Promise((resolve) => {
    const timeoutId = setTimeout(resolve, ms);
    // Allow process to exit even if timeout is pending
    if (timeoutId.unref) {
      timeoutId.unref();
    }
  });
}

/**
 * Execute a promise with an abort signal
 * @param {Function} fn - Function that accepts an abort signal and returns a promise
 * @param {number} timeoutMs - Optional timeout in milliseconds
 * @returns {Object} Object with promise and abort function
 */
function withAbort(fn, timeoutMs = null) {
  const abortController = new AbortController();
  let timeoutId = null;

  if (timeoutMs) {
    timeoutId = setTimeout(() => {
      abortController.abort(
        new Error(`Operation aborted after ${timeoutMs}ms`),
      );
    }, timeoutMs);

    // Allow process to exit even if timeout is pending
    if (timeoutId.unref) {
      timeoutId.unref();
    }
  }

  const promise = (async () => {
    try {
      const result = await fn(abortController.signal);
      if (timeoutId) clearTimeout(timeoutId);
      return result;
    } catch (error) {
      if (timeoutId) clearTimeout(timeoutId);
      throw error;
    }
  })();

  return {
    promise,
    abort: () => {
      if (timeoutId) clearTimeout(timeoutId);
      abortController.abort();
    },
  };
}

/**
 * Debounce a promise-returning function
 * @param {Function} fn - Function that returns a promise
 * @param {number} waitMs - Debounce delay in milliseconds
 * @returns {Function} Debounced function
 */
function debouncePromise(fn, waitMs = 300) {
  let timeoutId = null;
  let pendingPromise = null;

  return function (...args) {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }

    if (!pendingPromise) {
      pendingPromise = new Promise((resolve, reject) => {
        timeoutId = setTimeout(async () => {
          try {
            const result = await fn.apply(this, args);
            resolve(result);
          } catch (error) {
            reject(error);
          } finally {
            pendingPromise = null;
            timeoutId = null;
          }
        }, waitMs);
      });
    }

    return pendingPromise;
  };
}

module.exports = {
  withTimeout,
  withRetry,
  allSettledWithErrors,
  createDeferred,
  batchProcess,
  delay,
  withAbort,
  debouncePromise,
};
