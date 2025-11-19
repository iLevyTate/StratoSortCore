/**
 * Edge Case Utilities - Centralized Defensive Programming Patterns
 * Provides reusable utilities to handle common edge cases across the application
 */

// Import standardized withTimeout from promiseUtils
const {
  withTimeout: promiseWithTimeout,
} = require('../main/utils/promiseUtils');

/**
 * CATEGORY 1: EMPTY ARRAY/STRING HANDLING
 */

/**
 * Safely get array from unknown input
 * @param {*} value - Input that might or might not be an array
 * @param {Array} defaultValue - Default value if input is invalid
 * @returns {Array} Valid array
 */
function safeArray(value, defaultValue = []) {
  if (Array.isArray(value)) {
    return value;
  }
  if (value === null || value === undefined) {
    return defaultValue;
  }
  // Try to convert iterable to array
  try {
    if (typeof value[Symbol.iterator] === 'function') {
      return Array.from(value);
    }
  } catch {
    // Not iterable
  }
  return defaultValue;
}

/**
 * Safely get non-empty array from unknown input
 * @param {*} value - Input that might or might not be a non-empty array
 * @param {Array} defaultValue - Default value if input is invalid or empty
 * @returns {Array} Valid non-empty array
 */
function safeNonEmptyArray(value, defaultValue = []) {
  const arr = safeArray(value, defaultValue);
  return arr.length > 0 ? arr : defaultValue;
}

/**
 * Safely get string from unknown input
 * @param {*} value - Input that might or might not be a string
 * @param {string} defaultValue - Default value if input is invalid
 * @returns {string} Valid string
 */
function safeString(value, defaultValue = '') {
  if (typeof value === 'string') {
    return value;
  }
  if (value === null || value === undefined) {
    return defaultValue;
  }
  // Try to convert to string safely
  try {
    const str = String(value);
    return str === '[object Object]' ? defaultValue : str;
  } catch {
    return defaultValue;
  }
}

/**
 * Safely get non-empty string from unknown input
 * @param {*} value - Input that might or might not be a non-empty string
 * @param {string} defaultValue - Default value if input is invalid or empty
 * @returns {string} Valid non-empty string
 */
function safeNonEmptyString(value, defaultValue = '') {
  const str = safeString(value, defaultValue);
  const trimmed = str.trim();
  return trimmed.length > 0 ? trimmed : defaultValue;
}

/**
 * Safely get number from unknown input
 * @param {*} value - Input that might or might not be a number
 * @param {number} defaultValue - Default value if input is invalid
 * @returns {number} Valid number
 */
function safeNumber(value, defaultValue = 0) {
  if (typeof value === 'number' && !isNaN(value) && isFinite(value)) {
    return value;
  }
  if (value === null || value === undefined) {
    return defaultValue;
  }
  const num = Number(value);
  return !isNaN(num) && isFinite(num) ? num : defaultValue;
}

/**
 * Safely get positive number from unknown input
 * @param {*} value - Input that might or might not be a positive number
 * @param {number} defaultValue - Default value if input is invalid or not positive
 * @returns {number} Valid positive number
 */
function safePositiveNumber(value, defaultValue = 0) {
  const num = safeNumber(value, defaultValue);
  return num > 0 ? num : defaultValue;
}

/**
 * CATEGORY 2: DIVISION BY ZERO / EMPTY COLLECTION OPERATIONS
 */

/**
 * Safely calculate average, returning fallback for empty arrays
 * @param {Array<number>} values - Array of numbers
 * @param {number} defaultValue - Default value for empty array
 * @returns {number} Average or default
 */
function safeAverage(values, defaultValue = 0) {
  const arr = safeArray(values, []);
  const validNumbers = arr.filter(
    (v) => typeof v === 'number' && !isNaN(v) && isFinite(v),
  );

  if (validNumbers.length === 0) {
    return defaultValue;
  }

  const sum = validNumbers.reduce((acc, val) => acc + val, 0);
  return sum / validNumbers.length;
}

/**
 * Safely divide two numbers, returning fallback for division by zero
 * @param {number} numerator - Numerator
 * @param {number} denominator - Denominator
 * @param {number} defaultValue - Default value for division by zero
 * @returns {number} Result or default
 */
function safeDivide(numerator, denominator, defaultValue = 0) {
  const num = safeNumber(numerator, 0);
  const denom = safeNumber(denominator, 1);

  if (denom === 0) {
    return defaultValue;
  }

  const result = num / denom;
  return isFinite(result) ? result : defaultValue;
}

/**
 * Safely calculate percentage, handling edge cases
 * @param {number} part - Part value
 * @param {number} total - Total value
 * @param {number} defaultValue - Default value for division by zero
 * @returns {number} Percentage (0-100) or default
 */
function safePercentage(part, total, defaultValue = 0) {
  const percentage = safeDivide(part, total, defaultValue / 100) * 100;
  // Clamp between 0 and 100
  return Math.max(0, Math.min(100, percentage));
}

/**
 * CATEGORY 3: ARRAY OPERATIONS EDGE CASES
 */

/**
 * Safely get first element of array
 * @param {Array} arr - Input array
 * @param {*} defaultValue - Default value if array is empty
 * @returns {*} First element or default
 */
function safeFirst(arr, defaultValue = null) {
  const array = safeArray(arr, []);
  return array.length > 0 ? array[0] : defaultValue;
}

/**
 * Safely get last element of array
 * @param {Array} arr - Input array
 * @param {*} defaultValue - Default value if array is empty
 * @returns {*} Last element or default
 */
function safeLast(arr, defaultValue = null) {
  const array = safeArray(arr, []);
  return array.length > 0 ? array[array.length - 1] : defaultValue;
}

/**
 * Safely get element at index
 * @param {Array} arr - Input array
 * @param {number} index - Index to access
 * @param {*} defaultValue - Default value if index out of bounds
 * @returns {*} Element at index or default
 */
function safeGet(arr, index, defaultValue = null) {
  const array = safeArray(arr, []);
  const idx = safeNumber(index, 0);

  if (idx < 0 || idx >= array.length) {
    return defaultValue;
  }

  return array[idx];
}

/**
 * Safely find element in array
 * @param {Array} arr - Input array
 * @param {Function} predicate - Predicate function
 * @param {*} defaultValue - Default value if not found
 * @returns {*} Found element or default
 */
function safeFind(arr, predicate, defaultValue = null) {
  const array = safeArray(arr, []);

  if (typeof predicate !== 'function') {
    return defaultValue;
  }

  try {
    const result = array.find(predicate);
    return result !== undefined ? result : defaultValue;
  } catch {
    return defaultValue;
  }
}

/**
 * Safely filter array
 * @param {Array} arr - Input array
 * @param {Function} predicate - Predicate function
 * @returns {Array} Filtered array (never null/undefined)
 */
function safeFilter(arr, predicate) {
  const array = safeArray(arr, []);

  if (typeof predicate !== 'function') {
    return array;
  }

  try {
    return array.filter(predicate);
  } catch {
    return array;
  }
}

/**
 * Safely map array
 * @param {Array} arr - Input array
 * @param {Function} mapper - Mapper function
 * @returns {Array} Mapped array (never null/undefined)
 */
function safeMap(arr, mapper) {
  const array = safeArray(arr, []);

  if (typeof mapper !== 'function') {
    return array;
  }

  try {
    return array.map(mapper);
  } catch {
    return array;
  }
}

/**
 * CATEGORY 4: OBJECT PROPERTY ACCESS
 */

/**
 * Safely get nested property from object
 * @param {Object} obj - Input object
 * @param {string} path - Dot-separated path (e.g., 'user.profile.name')
 * @param {*} defaultValue - Default value if path doesn't exist
 * @returns {*} Value at path or default
 */
function safeGetNestedProperty(obj, path, defaultValue = null) {
  if (!obj || typeof obj !== 'object') {
    return defaultValue;
  }

  const pathStr = safeString(path, '');
  if (!pathStr) {
    return defaultValue;
  }

  const keys = pathStr.split('.');
  let current = obj;

  for (const key of keys) {
    if (current === null || current === undefined) {
      return defaultValue;
    }

    if (typeof current !== 'object') {
      return defaultValue;
    }

    current = current[key];
  }

  return current !== undefined ? current : defaultValue;
}

/**
 * Safely check if object has property
 * @param {Object} obj - Input object
 * @param {string} prop - Property name
 * @returns {boolean} True if object has property
 */
function safeHasProperty(obj, prop) {
  if (!obj || typeof obj !== 'object') {
    return false;
  }

  return Object.prototype.hasOwnProperty.call(obj, prop);
}

/**
 * CATEGORY 5: ASYNC/PROMISE HELPERS
 */

/**
 * Wraps a promise with a timeout (delegates to promiseUtils for consistency)
 * @param {Promise} promise - Promise to wrap
 * @param {number} timeoutMs - Timeout in milliseconds
 * @param {string} timeoutMessage - Timeout error message
 * @returns {Promise} Promise with timeout
 */
function withTimeout(
  promise,
  timeoutMs,
  timeoutMessage = 'Operation timed out',
) {
  return promiseWithTimeout(promise, timeoutMs, timeoutMessage);
}

/**
 * Retry async operation with exponential backoff
 * @param {Function} operation - Async operation to retry
 * @param {Object} options - Retry options
 * @returns {Promise} Result of successful operation
 */
async function retry(operation, options = {}) {
  const {
    maxRetries = 3,
    initialDelay = 1000,
    maxDelay = 10000,
    backoffFactor = 2,
    shouldRetry = () => true,
  } = options;

  let lastError = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;

      if (attempt === maxRetries - 1) {
        // Final attempt failed
        break;
      }

      if (!shouldRetry(error, attempt)) {
        // Error is not retriable
        break;
      }

      // Calculate delay with exponential backoff
      const delay = Math.min(
        initialDelay * Math.pow(backoffFactor, attempt),
        maxDelay,
      );

      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError || new Error('Retry failed');
}

/**
 * Safely await promise with fallback value
 * @param {Promise} promise - Promise to await
 * @param {*} defaultValue - Default value if promise rejects
 * @returns {Promise} Result or default
 */
async function safeAwait(promise, defaultValue = null) {
  try {
    return await promise;
  } catch {
    return defaultValue;
  }
}

/**
 * CATEGORY 6: TYPE VALIDATION
 */

/**
 * Check if value is a valid plain object (not null, not array, not date, etc.)
 * @param {*} value - Value to check
 * @returns {boolean} True if plain object
 */
function isPlainObject(value) {
  if (value === null || value === undefined) {
    return false;
  }

  if (typeof value !== 'object') {
    return false;
  }

  // Exclude arrays, dates, regexes, etc.
  if (Array.isArray(value)) {
    return false;
  }

  if (value instanceof Date) {
    return false;
  }

  if (value instanceof RegExp) {
    return false;
  }

  // Check if it's a plain object
  const proto = Object.getPrototypeOf(value);
  return proto === null || proto === Object.prototype;
}

/**
 * Validate value against type constraints
 * @param {*} value - Value to validate
 * @param {Object} constraints - Type constraints
 * @returns {Object} { valid: boolean, value: sanitized value, errors: Array }
 */
function validateType(value, constraints) {
  const errors = [];
  let sanitized = value;

  // Type check
  if (constraints.type) {
    const actualType = Array.isArray(value) ? 'array' : typeof value;

    if (Array.isArray(constraints.type)) {
      if (!constraints.type.includes(actualType)) {
        errors.push(
          `Expected type ${constraints.type.join(' or ')}, got ${actualType}`,
        );
      }
    } else if (constraints.type !== actualType) {
      errors.push(`Expected type ${constraints.type}, got ${actualType}`);
    }
  }

  // Min/max for numbers
  if (typeof sanitized === 'number') {
    if (constraints.min !== undefined && sanitized < constraints.min) {
      sanitized = constraints.min;
      errors.push(`Value below minimum ${constraints.min}`);
    }

    if (constraints.max !== undefined && sanitized > constraints.max) {
      sanitized = constraints.max;
      errors.push(`Value above maximum ${constraints.max}`);
    }
  }

  // Length constraints for strings/arrays
  if (typeof sanitized === 'string' || Array.isArray(sanitized)) {
    if (
      constraints.minLength !== undefined &&
      sanitized.length < constraints.minLength
    ) {
      errors.push(`Length below minimum ${constraints.minLength}`);
    }

    if (
      constraints.maxLength !== undefined &&
      sanitized.length > constraints.maxLength
    ) {
      sanitized = Array.isArray(sanitized)
        ? sanitized.slice(0, constraints.maxLength)
        : sanitized.substring(0, constraints.maxLength);
      errors.push(`Length above maximum ${constraints.maxLength}, truncated`);
    }
  }

  // Pattern matching for strings
  if (typeof sanitized === 'string' && constraints.pattern) {
    if (!constraints.pattern.test(sanitized)) {
      errors.push(`Value does not match pattern ${constraints.pattern}`);
    }
  }

  // Enum validation
  if (constraints.enum && !constraints.enum.includes(sanitized)) {
    errors.push(`Value not in allowed enum: ${constraints.enum.join(', ')}`);
  }

  return {
    valid: errors.length === 0,
    value: sanitized,
    errors,
  };
}

/**
 * CATEGORY 7: RESOURCE LIMITING
 */

/**
 * Create a bounded cache with LRU eviction
 * @param {number} maxSize - Maximum cache size
 * @returns {Object} Cache object with get/set/has/clear methods
 */
function createBoundedCache(maxSize = 100) {
  const cache = new Map();

  return {
    get(key) {
      if (!cache.has(key)) {
        return undefined;
      }

      // LRU: Move to end by re-inserting
      const value = cache.get(key);
      cache.delete(key);
      cache.set(key, value);
      return value;
    },

    set(key, value) {
      // Remove existing key to update position
      if (cache.has(key)) {
        cache.delete(key);
      }

      // Evict oldest if at capacity
      if (cache.size >= maxSize) {
        const oldestKey = cache.keys().next().value;
        cache.delete(oldestKey);
      }

      cache.set(key, value);
    },

    has(key) {
      return cache.has(key);
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
 * Create a rate limiter
 * @param {number} maxCalls - Maximum calls per window
 * @param {number} windowMs - Time window in milliseconds
 * @returns {Function} Function that returns true if call is allowed
 */
function createRateLimiter(maxCalls, windowMs) {
  const calls = [];

  return function isAllowed() {
    const now = Date.now();
    const windowStart = now - windowMs;

    // Remove old calls outside window
    while (calls.length > 0 && calls[0] < windowStart) {
      calls.shift();
    }

    if (calls.length < maxCalls) {
      calls.push(now);
      return true;
    }

    return false;
  };
}

/**
 * Create a debounced function
 * @param {Function} func - Function to debounce
 * @param {number} waitMs - Wait time in milliseconds
 * @returns {Function} Debounced function
 */
function debounce(func, waitMs) {
  let timeoutId = null;

  return function debounced(...args) {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
    }

    timeoutId = setTimeout(() => {
      timeoutId = null;
      func.apply(this, args);
    }, waitMs);
  };
}

module.exports = {
  // Empty array/string handling
  safeArray,
  safeNonEmptyArray,
  safeString,
  safeNonEmptyString,
  safeNumber,
  safePositiveNumber,

  // Division by zero / empty collections
  safeAverage,
  safeDivide,
  safePercentage,

  // Array operations
  safeFirst,
  safeLast,
  safeGet,
  safeFind,
  safeFilter,
  safeMap,

  // Object property access
  safeGetNestedProperty,
  safeHasProperty,

  // Async/Promise helpers
  withTimeout,
  retry,
  safeAwait,

  // Type validation
  isPlainObject,
  validateType,

  // Resource limiting
  createBoundedCache,
  createRateLimiter,
  debounce,
};
