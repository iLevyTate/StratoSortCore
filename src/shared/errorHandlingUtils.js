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

module.exports = {
  ERROR_CODES,
  createSuccessResponse,
  withRetry
};
