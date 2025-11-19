/**
 * Import standardized error response functions from shared utilities
 */
const {
  createErrorResponse: createStandardErrorResponse,
  createSuccessResponse: createStandardSuccessResponse,
  ERROR_CODES,
} = require('../../shared/errorHandlingUtils');

/**
 * Create error response from error object (IPC-specific wrapper)
 * @param {Error|Object} error - Error object or error-like object
 * @param {Object} context - Additional context to include
 * @returns {Object} Standardized error response
 */
function createErrorResponse(error, context = {}) {
  const errorMessage = error?.message || String(error || 'Unknown error');
  const errorName = error?.name || 'Error';
  const errorCode =
    error?.code || error?.errorCode || ERROR_CODES.UNKNOWN_ERROR;

  const details = {
    errorType: errorName,
    ...context,
    // Include validation errors/warnings if present
    ...(error?.validationErrors && {
      validationErrors: error.validationErrors,
    }),
    ...(error?.validationWarnings && {
      validationWarnings: error.validationWarnings,
    }),
  };

  return createStandardErrorResponse(errorMessage, errorCode, details);
}

/**
 * Create success response (IPC-specific wrapper)
 * @param {*} data - Response data (defaults to empty object for IPC compatibility)
 * @returns {Object} Standardized success response
 */
function createSuccessResponse(data = {}) {
  // For IPC handlers, if data is already an object, spread it
  // Otherwise wrap it in the standard format
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    return {
      success: true,
      ...data,
    };
  }
  return createStandardSuccessResponse(data);
}

function withErrorLogging(logger, fn) {
  return async (...args) => {
    try {
      return await fn(...args);
    } catch (error) {
      try {
        logger?.error?.('[IPC] Handler error:', error);
      } catch (logError) {
        // Fallback: If logger itself fails, use console.error as last resort
        // This is acceptable since it's a fallback for logging failures
        // eslint-disable-next-line no-console
        console.error('Failed to log IPC error:', logError);
      }
      throw error;
    }
  };
}

/**
 * Wrap an IPC handler with validation using a provided schema.
 * schema should have a safeParse method (e.g., zod). If validation fails, a structured error is returned.
 */
function withValidation(logger, schema, handler) {
  return withErrorLogging(logger, async (...args) => {
    try {
      // Electron ipcMain.handle args: (event, ...payloadArgs)
      const payload = args.slice(1);
      const parsed = schema.safeParse(
        payload.length <= 1 ? payload[0] : payload,
      );
      if (!parsed.success) {
        return createErrorResponse(
          { message: 'Invalid input', name: 'ValidationError' },
          {
            details: parsed.error.flatten
              ? parsed.error.flatten()
              : String(parsed.error),
          },
        );
      }
      const normalized = parsed.data;
      // Reconstruct the args: keep event as first, then validated payload
      const nextArgs = [
        args[0],
        ...(Array.isArray(normalized) ? normalized : [normalized]),
      ];
      return await handler(...nextArgs);
    } catch (e) {
      logger?.error?.('[IPC] Validation wrapper failed:', e);
      throw e;
    }
  });
}

module.exports = {
  withErrorLogging,
  withValidation,
  createErrorResponse,
  createSuccessResponse,
};
