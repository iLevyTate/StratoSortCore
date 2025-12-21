/**
 * Centralized Error Handling Utilities
 * Provides reusable error handling patterns across the application.
 *
 * Note: Core async utilities (withTimeout, withRetry) are consolidated in
 * promiseUtils.js. This module re-exports withRetry for backward compatibility
 * and provides error-specific utilities.
 *
 * @module shared/errorHandlingUtils
 */

const { withRetry: consolidatedWithRetry } = require('./promiseUtils');

/**
 * Standard error response structure
 * @typedef {Object} ErrorResponse
 * @property {boolean} success - Always false for errors
 * @property {string} error - Error message
 * @property {string} [code] - Error code for programmatic handling
 * @property {Object} [details] - Additional error context
 */

/**
 * Standard success response structure
 * @typedef {Object} SuccessResponse
 * @property {boolean} success - Always true for success
 * @property {*} data - Response data
 */

/**
 * Error codes for consistent error handling
 */
const ERROR_CODES = {
  // File system errors
  FILE_NOT_FOUND: 'FILE_NOT_FOUND',
  FILE_ACCESS_DENIED: 'FILE_ACCESS_DENIED',
  FILE_READ_ERROR: 'FILE_READ_ERROR',
  FILE_WRITE_ERROR: 'FILE_WRITE_ERROR',
  DIRECTORY_NOT_FOUND: 'DIRECTORY_NOT_FOUND',

  // Analysis errors
  ANALYSIS_FAILED: 'ANALYSIS_FAILED',
  MODEL_NOT_AVAILABLE: 'MODEL_NOT_AVAILABLE',
  INVALID_FILE_TYPE: 'INVALID_FILE_TYPE',

  // Network errors
  NETWORK_ERROR: 'NETWORK_ERROR',
  TIMEOUT: 'TIMEOUT',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',

  // Validation errors
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  INVALID_INPUT: 'INVALID_INPUT',

  // Generic errors
  UNKNOWN_ERROR: 'UNKNOWN_ERROR',
  OPERATION_CANCELLED: 'OPERATION_CANCELLED'
};

/**
 * Creates a standardized success response
 * @param {*} data - Response data
 * @returns {SuccessResponse}
 */
function createSuccessResponse(data) {
  return {
    success: true,
    data
  };
}

/**
 * Retry wrapper with exponential backoff.
 * Re-exported from promiseUtils for backward compatibility.
 *
 * @param {Function} fn - Function to retry
 * @param {Object} options - Retry options
 * @returns {Function} Wrapped function with retry logic
 * @see module:shared/promiseUtils.withRetry
 */
const withRetry = consolidatedWithRetry;

/**
 * Log an error when using a fallback value and return the fallback.
 * This helper standardizes logging for catch blocks that use fallback values,
 * making otherwise silent failures visible for debugging.
 *
 * @param {Object} logger - Logger instance with debug/warn methods
 * @param {string} context - Context identifier (e.g., 'DocumentExtractor', 'OllamaUtils')
 * @param {string} operation - Description of the operation that failed
 * @param {Error|string} error - The caught error or error message
 * @param {*} fallbackValue - The fallback value to return
 * @param {Object} [options] - Additional options
 * @param {string} [options.level='debug'] - Log level ('debug', 'warn', 'error')
 * @returns {*} The fallback value
 *
 * @example
 * // In a catch block:
 * catch (error) {
 *   return logFallback(logger, 'DocumentExtractor', 'extractTextFromDoc', error, '');
 * }
 *
 * // With warn level:
 * catch (error) {
 *   return logFallback(logger, 'OllamaUtils', 'loadConfig', error, {}, { level: 'warn' });
 * }
 */
function logFallback(logger, context, operation, error, fallbackValue, options = {}) {
  const { level = 'debug' } = options;
  const errorMessage = error?.message || (typeof error === 'string' ? error : 'Unknown error');
  const fallbackDisplay =
    typeof fallbackValue === 'object'
      ? Array.isArray(fallbackValue)
        ? `[array(${fallbackValue.length})]`
        : '[object]'
      : String(fallbackValue);

  const logMessage = `[${context}] ${operation} failed, using fallback`;
  const logDetails = {
    error: errorMessage,
    fallback: fallbackDisplay
  };

  // Add error code if available
  if (error?.code) {
    logDetails.errorCode = error.code;
  }

  // Call appropriate log level
  if (logger && typeof logger[level] === 'function') {
    logger[level](logMessage, logDetails);
  } else if (logger && typeof logger.debug === 'function') {
    // Fallback to debug if specified level not available
    logger.debug(logMessage, logDetails);
  }

  return fallbackValue;
}

module.exports = {
  ERROR_CODES,
  createSuccessResponse,
  withRetry,
  logFallback
};
