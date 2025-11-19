/**
 * Performance optimization utilities for React components
 * Provides debouncing, throttling, and memoization helpers
 */

/**
 * Creates a debounced function that delays invoking func until after wait milliseconds
 * have elapsed since the last time the debounced function was invoked
 *
 * @param {Function} func - The function to debounce
 * @param {number} wait - The number of milliseconds to delay
 * @param {Object} options - Options object
 * @param {boolean} options.leading - Invoke on the leading edge of the timeout
 * @param {boolean} options.trailing - Invoke on the trailing edge of the timeout
 * @returns {Function} The debounced function with cancel and flush methods
 */
function debounce(func, wait, options = {}) {
  let lastArgs;
  let lastThis;
  let lastCallTime;
  let result;
  let timerId;
  let lastInvokeTime = 0;

  const leading = options.leading || false;
  const trailing = options.trailing !== false;
  const maxWait = options.maxWait;
  const hasMaxWait = 'maxWait' in options;

  function invokeFunc(time) {
    const args = lastArgs;
    const thisArg = lastThis;

    lastArgs = lastThis = undefined;
    lastInvokeTime = time;
    result = func.apply(thisArg, args);
    return result;
  }

  function leadingEdge(time) {
    lastInvokeTime = time;
    timerId = setTimeout(timerExpired, wait);
    return leading ? invokeFunc(time) : result;
  }

  function remainingWait(time) {
    const timeSinceLastCall = time - lastCallTime;
    const timeSinceLastInvoke = time - lastInvokeTime;
    const timeWaiting = wait - timeSinceLastCall;

    return hasMaxWait
      ? Math.min(timeWaiting, maxWait - timeSinceLastInvoke)
      : timeWaiting;
  }

  function shouldInvoke(time) {
    const timeSinceLastCall = time - lastCallTime;
    const timeSinceLastInvoke = time - lastInvokeTime;

    return (
      lastCallTime === undefined ||
      timeSinceLastCall >= wait ||
      timeSinceLastCall < 0 ||
      (hasMaxWait && timeSinceLastInvoke >= maxWait)
    );
  }

  function timerExpired() {
    const time = Date.now();
    if (shouldInvoke(time)) {
      return trailingEdge(time);
    }
    timerId = setTimeout(timerExpired, remainingWait(time));
  }

  function trailingEdge(time) {
    timerId = undefined;

    if (trailing && lastArgs) {
      return invokeFunc(time);
    }
    lastArgs = lastThis = undefined;
    return result;
  }

  function cancel() {
    if (timerId !== undefined) {
      clearTimeout(timerId);
    }
    lastInvokeTime = 0;
    lastArgs = lastCallTime = lastThis = timerId = undefined;
  }

  function flush() {
    return timerId === undefined ? result : trailingEdge(Date.now());
  }

  function debounced(...args) {
    const time = Date.now();
    const isInvoking = shouldInvoke(time);

    lastArgs = args;
    lastThis = this;
    lastCallTime = time;

    if (isInvoking) {
      if (timerId === undefined) {
        return leadingEdge(lastCallTime);
      }
      if (hasMaxWait) {
        timerId = setTimeout(timerExpired, wait);
        return invokeFunc(lastCallTime);
      }
    }
    if (timerId === undefined) {
      timerId = setTimeout(timerExpired, wait);
    }
    return result;
  }

  debounced.cancel = cancel;
  debounced.flush = flush;
  return debounced;
}

/**
 * Creates a throttled function that only invokes func at most once per every wait milliseconds
 *
 * @param {Function} func - The function to throttle
 * @param {number} wait - The number of milliseconds to throttle invocations to
 * @param {Object} options - Options object
 * @param {boolean} options.leading - Invoke on the leading edge of the timeout
 * @param {boolean} options.trailing - Invoke on the trailing edge of the timeout
 * @returns {Function} The throttled function with cancel and flush methods
 */
function throttle(func, wait, options = {}) {
  return debounce(func, wait, {
    leading: options.leading !== false,
    trailing: options.trailing !== false,
    maxWait: wait,
  });
}

/**
 * Simple memoization function for expensive computations
 *
 * @param {Function} fn - The function to memoize
 * @param {Function} keyResolver - Function to resolve cache key from arguments
 * @returns {Function} The memoized function with clear method
 */
function memoize(fn, keyResolver) {
  const cache = new Map();

  const memoized = function (...args) {
    const key = keyResolver ? keyResolver.apply(this, args) : args[0];

    if (cache.has(key)) {
      return cache.get(key);
    }

    const result = fn.apply(this, args);
    cache.set(key, result);
    return result;
  };

  memoized.clear = () => cache.clear();
  memoized.delete = (key) => cache.delete(key);
  memoized.has = (key) => cache.has(key);

  return memoized;
}

/**
 * LRU (Least Recently Used) cache implementation
 *
 * @param {number} maxSize - Maximum number of items in cache
 * @returns {Object} Cache object with get, set, has, delete, and clear methods
 */
function createLRUCache(maxSize = 100) {
  const cache = new Map();

  return {
    get(key) {
      if (!cache.has(key)) {
        return undefined;
      }
      // Move to end (most recently used)
      const value = cache.get(key);
      cache.delete(key);
      cache.set(key, value);
      return value;
    },

    set(key, value) {
      // Remove key if it exists (to update position)
      if (cache.has(key)) {
        cache.delete(key);
      }
      // Add to end
      cache.set(key, value);

      // Remove oldest if over capacity
      if (cache.size > maxSize) {
        const firstKey = cache.keys().next().value;
        cache.delete(firstKey);
      }
    },

    has(key) {
      return cache.has(key);
    },

    delete(key) {
      return cache.delete(key);
    },

    clear() {
      cache.clear();
    },

    get size() {
      return cache.size;
    },
  };
}

/**
 * Request animation frame throttle for smooth animations
 *
 * @param {Function} callback - The function to throttle
 * @returns {Function} The throttled function
 */
function rafThrottle(callback) {
  let requestId = null;
  let lastArgs;

  const throttled = function (...args) {
    lastArgs = args;

    if (requestId === null) {
      requestId = requestAnimationFrame(() => {
        callback.apply(this, lastArgs);
        requestId = null;
      });
    }
  };

  throttled.cancel = () => {
    if (requestId !== null) {
      cancelAnimationFrame(requestId);
      requestId = null;
    }
  };

  return throttled;
}

/**
 * Creates a function that batches multiple calls into a single async operation
 *
 * @param {Function} fn - The function to batch
 * @param {number} wait - Time to wait before executing batch
 * @param {number} maxBatchSize - Maximum batch size
 * @returns {Function} The batched function
 */
function batchProcessor(fn, wait = 0, maxBatchSize = Infinity) {
  let batch = [];
  let timeoutId;

  const processBatch = async () => {
    const currentBatch = batch;
    batch = [];
    timeoutId = null;

    if (currentBatch.length > 0) {
      await fn(currentBatch);
    }
  };

  return {
    add(item) {
      batch.push(item);

      if (batch.length >= maxBatchSize) {
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
        processBatch();
      } else if (!timeoutId) {
        timeoutId = setTimeout(processBatch, wait);
      }
    },

    flush() {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      return processBatch();
    },

    clear() {
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      batch = [];
    },
  };
}

/**
 * Deep comparison of two values for memoization
 *
 * @param {*} a - First value
 * @param {*} b - Second value
 * @returns {boolean} True if values are deeply equal
 */
function deepEqual(a, b) {
  if (a === b) return true;

  if (a == null || b == null) return false;

  if (typeof a !== 'object' || typeof b !== 'object') return false;

  const keysA = Object.keys(a);
  const keysB = Object.keys(b);

  if (keysA.length !== keysB.length) return false;

  for (const key of keysA) {
    if (!keysB.includes(key)) return false;
    if (!deepEqual(a[key], b[key])) return false;
  }

  return true;
}

/**
 * Create a memoized selector for computed values
 *
 * @param {Function[]} inputSelectors - Array of input selector functions
 * @param {Function} resultFunc - Function that computes result from inputs
 * @returns {Function} Memoized selector function
 */
function createSelector(inputSelectors, resultFunc) {
  let lastInputs = [];
  let lastResult;

  return (...args) => {
    const inputs = inputSelectors.map((selector) => selector(...args));

    if (
      !lastInputs.length ||
      !inputs.every((input, i) => input === lastInputs[i])
    ) {
      lastInputs = inputs;
      lastResult = resultFunc(...inputs);
    }

    return lastResult;
  };
}

module.exports = {
  debounce,
  throttle,
  memoize,
  createLRUCache,
  rafThrottle,
  batchProcessor,
  deepEqual,
  createSelector,
};
