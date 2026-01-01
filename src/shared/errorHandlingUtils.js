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
  DIRECTORY_CREATION_FAILED: 'DIRECTORY_CREATION_FAILED',
  PATH_ACCESS_FAILED: 'PATH_ACCESS_FAILED',
  PATH_NOT_DIRECTORY: 'PATH_NOT_DIRECTORY',
  PARENT_NOT_DIRECTORY: 'PARENT_NOT_DIRECTORY',
  ORIGINAL_NOT_DIRECTORY: 'ORIGINAL_NOT_DIRECTORY',
  RENAME_FAILED: 'RENAME_FAILED',

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
  INVALID_PATH: 'INVALID_PATH',
  INVALID_FOLDER_PATH: 'INVALID_FOLDER_PATH',
  INVALID_FOLDER_ID: 'INVALID_FOLDER_ID',
  INVALID_FOLDER_DATA: 'INVALID_FOLDER_DATA',
  INVALID_FOLDER_NAME: 'INVALID_FOLDER_NAME',
  INVALID_FOLDER_NAME_CHARS: 'INVALID_FOLDER_NAME_CHARS',
  FOLDER_NOT_FOUND: 'FOLDER_NOT_FOUND',
  FOLDER_NAME_EXISTS: 'FOLDER_NAME_EXISTS',
  FOLDER_ALREADY_EXISTS: 'FOLDER_ALREADY_EXISTS',
  PARENT_NOT_WRITABLE: 'PARENT_NOT_WRITABLE',
  PARENT_NOT_ACCESSIBLE: 'PARENT_NOT_ACCESSIBLE',

  // Security errors
  SECURITY_PATH_VIOLATION: 'SECURITY_PATH_VIOLATION',

  // Smart folder operation errors
  SAVE_FAILED: 'SAVE_FAILED',
  UPDATE_FAILED: 'UPDATE_FAILED',
  EDIT_FAILED: 'EDIT_FAILED',
  DELETE_FAILED: 'DELETE_FAILED',
  ADD_FOLDER_FAILED: 'ADD_FOLDER_FAILED',
  CONFIG_SAVE_FAILED: 'CONFIG_SAVE_FAILED',

  // Batch operation errors
  BATCH_OPERATION_FAILED: 'BATCH_OPERATION_FAILED',
  PARTIAL_FAILURE: 'PARTIAL_FAILURE',
  INVALID_BATCH: 'INVALID_BATCH',
  EMPTY_BATCH: 'EMPTY_BATCH',
  BATCH_TOO_LARGE: 'BATCH_TOO_LARGE',
  INVALID_OPERATION: 'INVALID_OPERATION',

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

/**
 * Safely extracts an error message from any type of error.
 * Handles Error objects, strings, objects with message property, and unknown types.
 *
 * FIX: Prevents issues when error is not an Error object (e.g., string, null, object)
 *
 * @param {*} error - The error to extract message from
 * @param {string} [fallback='Unknown error'] - Fallback message if extraction fails
 * @returns {string} The error message
 *
 * @example
 * // Works with Error objects
 * getErrorMessage(new Error('Something failed')) // 'Something failed'
 *
 * // Works with strings
 * getErrorMessage('Connection refused') // 'Connection refused'
 *
 * // Works with objects
 * getErrorMessage({ message: 'API error', code: 500 }) // 'API error'
 *
 * // Handles null/undefined
 * getErrorMessage(null) // 'Unknown error'
 */
function getErrorMessage(error, fallback = 'Unknown error') {
  if (error === null || error === undefined) {
    return fallback;
  }

  if (typeof error === 'string') {
    return error || fallback;
  }

  if (error instanceof Error) {
    return error.message || fallback;
  }

  if (typeof error === 'object') {
    // Try common error message properties
    if (typeof error.message === 'string') {
      return error.message || fallback;
    }
    if (typeof error.error === 'string') {
      return error.error || fallback;
    }
    if (typeof error.msg === 'string') {
      return error.msg || fallback;
    }
    // Try to stringify as last resort
    try {
      const str = JSON.stringify(error);
      return str !== '{}' ? str : fallback;
    } catch {
      return fallback;
    }
  }

  // For numbers, booleans, etc.
  try {
    return String(error) || fallback;
  } catch {
    return fallback;
  }
}

module.exports = {
  ERROR_CODES,
  createSuccessResponse,
  withRetry,
  logFallback,
  getErrorMessage
};
