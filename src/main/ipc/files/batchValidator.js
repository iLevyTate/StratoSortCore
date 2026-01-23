/**
 * Batch Validator
 *
 * Centralizes validation for batch organize requests.
 */

const { ERROR_CODES } = require('../../../shared/errorHandlingUtils');
const { PROCESSING_LIMITS } = require('../../../shared/constants');

const MAX_BATCH_SIZE = PROCESSING_LIMITS.MAX_BATCH_OPERATION_SIZE;

/**
 * Validate batch operation input.
 * Returns an error object if validation fails, null if valid.
 *
 * @param {Object} operation - Batch operation configuration
 * @param {Object} log - Logger instance
 * @returns {Object|null} Error object or null if valid
 */
function validateBatchOperation(operation, log) {
  if (!operation.operations || !Array.isArray(operation.operations)) {
    return {
      success: false,
      error: 'Invalid batch: operations must be an array',
      errorCode: ERROR_CODES.INVALID_BATCH
    };
  }

  if (operation.operations.length === 0) {
    return {
      success: false,
      error: 'Invalid batch: no operations provided',
      errorCode: ERROR_CODES.EMPTY_BATCH
    };
  }

  if (operation.operations.length > MAX_BATCH_SIZE) {
    log.warn(
      `[FILE-OPS] Batch size ${operation.operations.length} exceeds maximum ${MAX_BATCH_SIZE}`
    );
    return {
      success: false,
      error: `Batch size exceeds maximum of ${MAX_BATCH_SIZE} operations`,
      errorCode: ERROR_CODES.BATCH_TOO_LARGE,
      maxAllowed: MAX_BATCH_SIZE,
      provided: operation.operations.length
    };
  }

  // Validate individual operation objects have required fields
  for (let i = 0; i < operation.operations.length; i++) {
    const op = operation.operations[i];
    if (!op || typeof op !== 'object') {
      return {
        success: false,
        error: `Invalid operation at index ${i}: must be an object`,
        errorCode: ERROR_CODES.INVALID_OPERATION
      };
    }
    if (!op.source || typeof op.source !== 'string') {
      return {
        success: false,
        error: `Invalid operation at index ${i}: missing or invalid source path`,
        errorCode: ERROR_CODES.INVALID_OPERATION
      };
    }
    if (!op.destination || typeof op.destination !== 'string') {
      return {
        success: false,
        error: `Invalid operation at index ${i}: missing or invalid destination path`,
        errorCode: ERROR_CODES.INVALID_OPERATION
      };
    }
  }

  return null;
}

module.exports = {
  validateBatchOperation,
  MAX_BATCH_SIZE
};
