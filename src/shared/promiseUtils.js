/**
 * Consolidated Promise Utilities
 *
 * This module provides a single source of truth for all async/promise-related
 * utilities across the application. All timeout, retry, delay, and debounce
 * functionality should be imported from this module.
 *
 * @module shared/promiseUtils
 */

const { logger } = require('./logger');

logger.setContext('PromiseUtils');

// ============================================================================
// DELAY / SLEEP UTILITIES
// ============================================================================

/**
 * Creates a promise that resolves after a specified delay.
 * The timeout is unreferenced to allow the Node.js process to exit naturally
 * if this is the only pending operation.
 *
 * @param {number} ms - Delay in milliseconds
 * @returns {Promise<void>} Promise that resolves after the delay
 * @example
 * await delay(1000); // Wait 1 second
 * console.log('1 second has passed');
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
 * Alias for delay - creates a promise that resolves after a specified time.
 * Provided for semantic clarity when the intent is to "sleep" the execution.
 *
 * @param {number} ms - Sleep duration in milliseconds
 * @returns {Promise<void>} Promise that resolves after sleeping
 * @example
 * await sleep(500); // Sleep for 500ms
 */
const sleep = delay;

// ============================================================================
// TIMEOUT UTILITIES
// ============================================================================

/**
 * Wraps a promise or function with a timeout.
 * If the operation takes longer than the specified timeout, the promise
 * rejects with a timeout error.
 *
 * Supports two usage patterns:
 * 1. Direct promise timeout: withTimeout(promise, 5000, 'Database query')
 * 2. Function wrapper: withTimeout(asyncFn, 5000, 'API call')
 *
 * @param {Promise|Function} fnOrPromise - Promise to timeout OR async function to wrap
 * @param {number} timeoutMs - Timeout in milliseconds
 * @param {string} [operationName='Operation'] - Name of the operation for error messages
 * @returns {Promise|Function} Wrapped promise with timeout OR wrapped function
 * @throws {Error} Throws if operation times out
 * @example
 * // Direct promise timeout
 * const result = await withTimeout(fetch('/api/data'), 5000, 'API fetch');
 *
 * // Function wrapper
 * const timedFetch = withTimeout(fetchData, 5000, 'Data fetch');
 * const result = await timedFetch(params);
 */
function withTimeout(fnOrPromise, timeoutMs, operationName = 'Operation') {
  const createTimeoutPromise = () => {
    let timeoutId;
    const timeoutPromise = new Promise((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(new Error(`${operationName} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      // Allow process to exit even if timeout is pending
      if (timeoutId.unref) {
        timeoutId.unref();
      }
    });
    return { timeoutPromise, timeoutId };
  };

  // If a promise is passed directly, race it with timeout
  if (fnOrPromise && typeof fnOrPromise.then === 'function' && typeof fnOrPromise !== 'function') {
    const { timeoutPromise, timeoutId } = createTimeoutPromise();
    return Promise.race([fnOrPromise, timeoutPromise]).finally(() => {
      clearTimeout(timeoutId);
    });
  }

  // If a function is passed, return a wrapped function
  return async function (...args) {
    const { timeoutPromise, timeoutId } = createTimeoutPromise();
    try {
      return await Promise.race([fnOrPromise(...args), timeoutPromise]);
    } finally {
      clearTimeout(timeoutId);
    }
  };
}

// ============================================================================
// RETRY UTILITIES
// ============================================================================

/**
 * Wraps an async function with retry logic and exponential backoff.
 * Returns a new function that will automatically retry on failure.
 *
 * @param {Function} fn - Async function to wrap with retry logic
 * @param {Object} [options={}] - Retry configuration options
 * @param {number} [options.maxRetries=3] - Maximum number of retry attempts (alias: maxAttempts)
 * @param {number} [options.maxAttempts] - Alias for maxRetries
 * @param {number} [options.initialDelay=1000] - Initial delay between retries in ms (alias: delay)
 * @param {number} [options.delay] - Alias for initialDelay
 * @param {number} [options.maxDelay=10000] - Maximum delay between retries in ms
 * @param {number} [options.backoff=2] - Backoff multiplier for exponential delay (alias: backoffFactor)
 * @param {number} [options.backoffFactor] - Alias for backoff
 * @param {string} [options.operationName='Operation'] - Name for logging
 * @param {Function} [options.shouldRetry] - Function(error, attempt) => boolean to determine if retry should occur
 * @param {Function} [options.onRetry] - Callback(error, attempt) called before each retry
 * @returns {Function} Wrapped function with retry logic
 * @example
 * const fetchWithRetry = withRetry(fetchData, {
 *   maxRetries: 3,
 *   initialDelay: 1000,
 *   backoff: 2,
 *   shouldRetry: (err) => err.code !== 'AUTH_FAILED'
 * });
 * const data = await fetchWithRetry(url);
 */
function withRetry(fn, options = {}) {
  const {
    maxRetries,
    maxAttempts,
    initialDelay,
    delay: delayOption,
    maxDelay = 10000,
    backoff,
    backoffFactor,
    operationName = 'Operation',
    shouldRetry = () => true,
    onRetry
  } = options;

  // Support both parameter naming conventions
  const effectiveMaxRetries = maxRetries ?? maxAttempts ?? 3;
  const effectiveInitialDelay = initialDelay ?? delayOption ?? 1000;
  const effectiveBackoff = backoff ?? backoffFactor ?? 2;

  return async function (...args) {
    let lastError;

    for (let attempt = 0; attempt <= effectiveMaxRetries; attempt++) {
      try {
        return await fn(...args);
      } catch (error) {
        lastError = error;

        if (attempt < effectiveMaxRetries && shouldRetry(error, attempt)) {
          const waitTime = Math.min(
            effectiveInitialDelay * Math.pow(effectiveBackoff, attempt),
            maxDelay
          );

          logger.warn(
            `[Retry] ${operationName} attempt ${attempt + 1}/${effectiveMaxRetries} failed, retrying in ${waitTime}ms`,
            { error: error.message }
          );

          if (onRetry) {
            try {
              onRetry(error, attempt);
            } catch (callbackError) {
              logger.warn('[Retry] onRetry callback threw error', {
                error: callbackError.message
              });
            }
          }

          await new Promise((resolve) => setTimeout(resolve, waitTime));
        } else {
          if (attempt === effectiveMaxRetries) {
            logger.error(`[Retry] ${operationName} failed after ${effectiveMaxRetries} attempts`, {
              error: error.message
            });
          }
          break;
        }
      }
    }

    throw lastError;
  };
}

/**
 * Executes an async operation with retry logic.
 * Convenience function that immediately invokes the retry-wrapped function.
 *
 * @param {Function} operation - Async operation to execute with retries
 * @param {Object} [options={}] - Same options as withRetry
 * @returns {Promise<*>} Result of the operation
 * @example
 * const result = await retry(() => fetchData(url), { maxRetries: 3 });
 */
async function retry(operation, options = {}) {
  return withRetry(operation, options)();
}

// ============================================================================
// SAFE EXECUTION UTILITIES
// ============================================================================

/**
 * Safely executes a function with error handling, returning a fallback on failure.
 * Wraps both sync and async functions.
 *
 * @param {Function} fn - Function to execute safely
 * @param {*} [fallback=null] - Value to return if the function throws
 * @param {Object} [options={}] - Additional options
 * @param {boolean} [options.logError=true] - Whether to log errors
 * @param {string} [options.context='safeCall'] - Context for logging
 * @returns {Function} Wrapped function that catches errors
 * @example
 * const safeParseJson = safeCall(JSON.parse, {});
 * const data = safeParseJson(maybeInvalidJson); // Returns {} on error
 */
function safeCall(fn, fallback = null, options = {}) {
  const { logError = true, context = 'safeCall' } = options;

  return async function (...args) {
    if (typeof fn !== 'function') {
      if (logError) {
        logger.warn(`[${context}] Attempted to call non-function`, {
          type: typeof fn
        });
      }
      return fallback;
    }

    try {
      const result = await fn(...args);
      return result !== undefined ? result : fallback;
    } catch (error) {
      if (logError) {
        logger.error(`[${context}] Function call failed`, {
          error: error.message,
          stack: error.stack
        });
      }
      return fallback;
    }
  };
}

/**
 * Safely awaits a promise, returning a fallback value on rejection.
 *
 * @param {Promise} promise - Promise to await
 * @param {*} [defaultValue=null] - Default value if promise rejects
 * @returns {Promise<*>} Result or default value
 * @example
 * const data = await safeAwait(fetch('/api/data'), null);
 */
async function safeAwait(promise, defaultValue = null) {
  try {
    return await promise;
  } catch {
    return defaultValue;
  }
}

// ============================================================================
// DEBOUNCE / THROTTLE UTILITIES
// ============================================================================

/**
 * Creates a debounced function that delays invoking fn until after wait milliseconds
 * have elapsed since the last time the debounced function was invoked.
 *
 * @param {Function} fn - Function to debounce
 * @param {number} waitMs - Debounce delay in milliseconds
 * @param {Object} [options={}] - Configuration options
 * @param {boolean} [options.leading=false] - Invoke on leading edge
 * @param {boolean} [options.trailing=true] - Invoke on trailing edge
 * @returns {Function} Debounced function with cancel() method
 * @example
 * const debouncedSave = debounce(saveData, 300);
 * debouncedSave(); // Will only execute after 300ms of no calls
 * debouncedSave.cancel(); // Cancel pending execution
 */
function debounce(fn, waitMs, options = {}) {
  const { leading = false, trailing = true } = options;
  let timeoutId = null;
  let lastArgs = null;
  let lastThis = null;
  let result;
  let lastCallTime;

  function invokeFunc() {
    const args = lastArgs;
    const thisArg = lastThis;
    lastArgs = lastThis = null;
    result = fn.apply(thisArg, args);
    return result;
  }

  function shouldInvoke(time) {
    const timeSinceLastCall = time - lastCallTime;
    return lastCallTime === undefined || timeSinceLastCall >= waitMs || timeSinceLastCall < 0;
  }

  function timerExpired() {
    const time = Date.now();
    if (shouldInvoke(time)) {
      return trailingEdge();
    }
    timeoutId = setTimeout(timerExpired, waitMs - (time - lastCallTime));
    return undefined;
  }

  function trailingEdge() {
    timeoutId = null;
    if (trailing && lastArgs) {
      return invokeFunc();
    }
    lastArgs = lastThis = null;
    return result;
  }

  function leadingEdge() {
    timeoutId = setTimeout(timerExpired, waitMs);
    return leading ? invokeFunc() : result;
  }

  function debounced(...args) {
    const time = Date.now();
    const isInvoking = shouldInvoke(time);

    lastArgs = args;
    lastThis = this;
    lastCallTime = time;

    if (isInvoking) {
      if (timeoutId === null) {
        return leadingEdge(lastCallTime);
      }
    }

    if (timeoutId === null) {
      timeoutId = setTimeout(timerExpired, waitMs);
    }

    return result;
  }

  debounced.cancel = function () {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
    }
    lastArgs = lastCallTime = lastThis = timeoutId = null;
  };

  debounced.flush = function () {
    return timeoutId === null ? result : trailingEdge();
  };

  return debounced;
}

/**
 * Creates a throttled function that only invokes fn at most once per wait period.
 *
 * @param {Function} fn - Function to throttle
 * @param {number} waitMs - Throttle period in milliseconds
 * @param {Object} [options={}] - Configuration options
 * @param {boolean} [options.leading=true] - Invoke on leading edge
 * @param {boolean} [options.trailing=true] - Invoke on trailing edge
 * @returns {Function} Throttled function with cancel() method
 * @example
 * const throttledScroll = throttle(handleScroll, 100);
 * window.addEventListener('scroll', throttledScroll);
 */
function throttle(fn, waitMs, options = {}) {
  return debounce(fn, waitMs, {
    leading: options.leading !== false,
    trailing: options.trailing !== false,
    maxWait: waitMs
  });
}

// ============================================================================
// BATCH & CONCURRENCY UTILITIES
// ============================================================================

/**
 * Ensures all promises in an array are settled with proper error handling.
 * Returns results in order, with null for failed promises.
 *
 * @param {Array<Promise>} promises - Array of promises to settle
 * @param {Function} [onError=null] - Error handler for failed promises
 * @returns {Promise<Array>} Array of results (null for rejected promises)
 * @example
 * const results = await allSettledWithErrors([p1, p2, p3], (err, idx) => {
 *   console.log(`Promise ${idx} failed:`, err.message);
 * });
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
            originalError: result.reason?.message
          });
        }
      }
    }
  }

  if (errors.length > 0) {
    logger.warn(`[AllSettled] ${errors.length} of ${promises.length} promises failed`, {
      errors: errors.map((e) => ({
        index: e.index,
        message: e.error?.message
      }))
    });
  }

  return finalResults;
}

/**
 * Executes promises in batches with controlled concurrency.
 *
 * @param {Array} items - Items to process
 * @param {Function} fn - Function to execute for each item
 * @param {number} [batchSize=5] - Number of concurrent promises per batch
 * @returns {Promise<Array>} Array of results
 * @example
 * const results = await batchProcess(urls, fetchUrl, 3);
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
      await delay(50);
    }
  }

  return results;
}

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
  // Delay / Sleep
  delay,
  sleep,

  // Timeout
  withTimeout,

  // Retry
  withRetry,
  retry,

  // Safe execution
  safeCall,
  safeAwait,

  // Debounce / Throttle
  debounce,
  throttle,

  // Batch & Concurrency
  batchProcess
};
