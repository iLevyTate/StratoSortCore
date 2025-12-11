/**
 * Centralized IPC Handler Wrappers
 *
 * Provides consistent error handling, validation, service checking,
 * and logging patterns for all IPC handlers.
 *
 * Usage:
 *   const handler = createHandler({
 *     logger,
 *     schema: z.object({ filePath: z.string() }),
 *     serviceName: 'analysisHistory',
 *     getService: () => getServiceIntegration()?.analysisHistory,
 *     handler: async (event, data) => {
 *       // Your handler logic
 *       return { result: 'data' };
 *     }
 *   });
 */

const {
  createSuccessResponse: createStandardSuccessResponse,
  ERROR_CODES
} = require('../../shared/errorHandlingUtils');
const { logger } = require('../../shared/logger');

// Try to load zod for validation
let z;
try {
  z = require('zod');
} catch (error) {
  // FIX: Log warning instead of silently swallowing the error
  // This aids debugging when Zod fails to load (e.g., missing module)
  logger.warn('[IPC] Zod not available, skipping schema validation:', error.message);
  z = null;
}

/**
 * Standard IPC error response format
 * @typedef {Object} IPCErrorResponse
 * @property {boolean} success - Always false for errors
 * @property {Object} error - Error details
 * @property {string} error.code - Error code for programmatic handling
 * @property {string} error.message - Human-readable error message
 * @property {Object} [error.details] - Additional error context
 */

/**
 * Standard IPC success response format
 * @typedef {Object} IPCSuccessResponse
 * @property {boolean} success - Always true for success
 * @property {*} [data] - Response data (spread into response for backwards compatibility)
 */

/**
 * Create standardized error response from error object (IPC-specific wrapper)
 * @param {Error|Object} error - Error object or error-like object
 * @param {Object} context - Additional context to include
 * @returns {IPCErrorResponse} Standardized error response
 */
function createErrorResponse(error, context = {}) {
  const errorMessage = error?.message || String(error || 'Unknown error');
  const errorName = error?.name || 'Error';
  const errorCode = error?.code || error?.errorCode || ERROR_CODES.UNKNOWN_ERROR;

  const details = {
    errorType: errorName,
    ...context,
    // Include validation errors/warnings if present
    ...(error?.validationErrors && {
      validationErrors: error.validationErrors
    }),
    ...(error?.validationWarnings && {
      validationWarnings: error.validationWarnings
    })
  };

  return {
    success: false,
    error: {
      code: errorCode,
      message: errorMessage,
      details: Object.keys(details).length > 1 ? details : undefined
    }
  };
}

/**
 * Create success response (IPC-specific wrapper)
 * For backwards compatibility, spreads object data directly into response
 * @param {*} data - Response data (defaults to empty object for IPC compatibility)
 * @returns {IPCSuccessResponse} Standardized success response
 */
function createSuccessResponse(data = {}) {
  // For IPC handlers, if data is already an object, spread it for backwards compatibility
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    return {
      success: true,
      ...data
    };
  }
  return createStandardSuccessResponse(data);
}

/**
 * Wrap an IPC handler with try/catch and error logging
 * @param {Object} logger - Logger instance
 * @param {Function} fn - Handler function to wrap
 * @param {Object} [options] - Additional options
 * @param {string} [options.context] - Context string for logging
 * @returns {Function} Wrapped handler function
 */
function withErrorLogging(logger, fn, options = {}) {
  const { context = 'IPC' } = options;

  return async (...args) => {
    try {
      return await fn(...args);
    } catch (error) {
      try {
        logger?.error?.(`[${context}] Handler error:`, error);
      } catch (logError) {
        // Fallback: If logger itself fails, use console.error as last resort
        // eslint-disable-next-line no-console
        console.error('Failed to log IPC error:', logError);
      }
      throw error;
    }
  };
}

/**
 * Wrap an IPC handler with input validation using Zod schema
 * @param {Object} logger - Logger instance
 * @param {Object} schema - Zod schema for validation
 * @param {Function} handler - Handler function to wrap
 * @param {Object} [options] - Additional options
 * @param {string} [options.context] - Context string for logging
 * @returns {Function} Wrapped handler function with validation
 */
function withValidation(logger, schema, handler, options = {}) {
  const { context = 'IPC' } = options;

  if (!z || !schema) {
    // If zod not available or no schema, just apply error logging
    return withErrorLogging(logger, handler, options);
  }

  return withErrorLogging(
    logger,
    async (...args) => {
      try {
        // Electron ipcMain.handle args: (event, ...payloadArgs)
        const payload = args.slice(1);
        const parsed = schema.safeParse(payload.length <= 1 ? payload[0] : payload);

        if (!parsed.success) {
          logger?.warn?.(`[${context}] Validation failed:`, parsed.error);
          return createErrorResponse(
            { message: 'Invalid input', name: 'ValidationError' },
            {
              details: parsed.error.flatten ? parsed.error.flatten() : String(parsed.error)
            }
          );
        }

        const normalized = parsed.data;
        // Reconstruct the args: keep event as first, then validated payload
        const nextArgs = [args[0], ...(Array.isArray(normalized) ? normalized : [normalized])];
        return await handler(...nextArgs);
      } catch (e) {
        logger?.error?.(`[${context}] Validation wrapper failed:`, e);
        throw e;
      }
    },
    options
  );
}

/**
 * Internal helper for service availability check logic
 * FIX: Extracted to avoid duplication between withServiceCheck and createHandler
 * @param {Object} options - Configuration options
 * @param {Object} options.logger - Logger instance
 * @param {string} options.serviceName - Name of the service
 * @param {Function} options.getService - Function that returns the service instance
 * @param {Function} options.handler - Handler function to wrap
 * @param {Object} [options.fallbackResponse] - Response to return if service unavailable
 * @param {string} [options.context] - Context string for logging
 * @returns {Function} Handler with service check (without error logging wrapper)
 */
function _createServiceCheckHandler({
  logger,
  serviceName,
  getService,
  handler,
  fallbackResponse = null,
  context = 'IPC'
}) {
  return async (...args) => {
    const service = getService();

    if (!service) {
      logger?.warn?.(`[${context}] Service not available: ${serviceName}`);

      if (fallbackResponse !== null) {
        return fallbackResponse;
      }

      return createErrorResponse(
        {
          message: `${serviceName} service is not available`,
          name: 'ServiceUnavailableError',
          code: ERROR_CODES.SERVICE_UNAVAILABLE
        },
        { serviceName }
      );
    }

    return await handler(...args, service);
  };
}

/**
 * Wrap an IPC handler with service availability check
 * @param {Object} options - Configuration options
 * @param {Object} options.logger - Logger instance
 * @param {string} options.serviceName - Name of the service (for error messages)
 * @param {Function} options.getService - Function that returns the service instance
 * @param {Function} options.handler - Handler function to wrap
 * @param {Object} [options.fallbackResponse] - Response to return if service unavailable
 * @param {string} [options.context] - Context string for logging
 * @returns {Function} Wrapped handler function with service check
 */
function withServiceCheck({
  logger,
  serviceName,
  getService,
  handler,
  fallbackResponse = null,
  context = 'IPC'
}) {
  // FIX: Reuse extracted helper function to avoid duplication
  const serviceCheckHandler = _createServiceCheckHandler({
    logger,
    serviceName,
    getService,
    handler,
    fallbackResponse,
    context
  });
  return withErrorLogging(logger, serviceCheckHandler, { context });
}

/**
 * Create a fully-wrapped IPC handler with all standard patterns
 *
 * This is the primary factory function that combines:
 * - Error logging
 * - Input validation (optional)
 * - Service availability checking (optional)
 * - Consistent error response format
 *
 * @param {Object} options - Configuration options
 * @param {Object} options.logger - Logger instance (required)
 * @param {Function} options.handler - Handler function (required)
 * @param {Object} [options.schema] - Zod schema for input validation
 * @param {string} [options.serviceName] - Name of required service
 * @param {Function} [options.getService] - Function to get service instance
 * @param {Object} [options.fallbackResponse] - Response when service unavailable
 * @param {string} [options.context] - Context string for logging (default: 'IPC')
 * @param {boolean} [options.wrapResponse] - Whether to wrap successful results in success response (default: false)
 * @returns {Function} Fully wrapped IPC handler
 *
 * @example
 * // Simple handler with just error logging
 * const handler = createHandler({
 *   logger,
 *   handler: async (event) => {
 *     return { data: 'result' };
 *   }
 * });
 *
 * @example
 * // Handler with validation
 * const handler = createHandler({
 *   logger,
 *   schema: z.object({ filePath: z.string().min(1) }),
 *   handler: async (event, { filePath }) => {
 *     return { path: filePath };
 *   }
 * });
 *
 * @example
 * // Handler with service check
 * const handler = createHandler({
 *   logger,
 *   serviceName: 'analysisHistory',
 *   getService: () => getServiceIntegration()?.analysisHistory,
 *   fallbackResponse: { entries: [], total: 0 },
 *   handler: async (event, data, service) => {
 *     return await service.getEntries();
 *   }
 * });
 */
function createHandler({
  logger,
  handler,
  schema = null,
  serviceName = null,
  getService = null,
  fallbackResponse = null,
  context = 'IPC',
  wrapResponse = false
}) {
  if (!logger) {
    throw new Error('createHandler requires a logger');
  }
  if (!handler || typeof handler !== 'function') {
    throw new Error('createHandler requires a handler function');
  }

  // Build the handler chain from inside out
  let wrappedHandler = handler;

  // Wrap response in success format if requested
  if (wrapResponse) {
    const innerHandler = wrappedHandler;
    wrappedHandler = async (...args) => {
      const result = await innerHandler(...args);
      // Don't double-wrap if already a success/error response
      if (result && typeof result === 'object' && 'success' in result) {
        return result;
      }
      return createSuccessResponse(result);
    };
  }

  // Add service check if configured
  // FIX: Reuse _createServiceCheckHandler to avoid code duplication (DRY principle)
  if (serviceName && getService) {
    wrappedHandler = _createServiceCheckHandler({
      logger,
      serviceName,
      getService,
      handler: wrappedHandler,
      fallbackResponse,
      context
    });
  }

  // Add validation if schema provided
  if (schema && z) {
    const innerHandler = wrappedHandler;
    wrappedHandler = async (...args) => {
      // Electron ipcMain.handle args: (event, ...payloadArgs)
      const payload = args.slice(1);
      const parsed = schema.safeParse(payload.length <= 1 ? payload[0] : payload);

      if (!parsed.success) {
        logger?.warn?.(`[${context}] Validation failed:`, parsed.error);
        return createErrorResponse(
          { message: 'Invalid input', name: 'ValidationError' },
          {
            validationErrors: parsed.error.flatten ? parsed.error.flatten() : String(parsed.error)
          }
        );
      }

      const normalized = parsed.data;
      // Reconstruct the args: keep event as first, then validated payload
      const nextArgs = [args[0], ...(Array.isArray(normalized) ? normalized : [normalized])];
      return await innerHandler(...nextArgs);
    };
  }

  // Always wrap with error logging
  return withErrorLogging(logger, wrappedHandler, { context });
}

/**
 * Register multiple IPC handlers with consistent patterns.
 * Uses the IPC registry for targeted cleanup during shutdown.
 *
 * @param {Object} options - Configuration options
 * @param {Object} options.ipcMain - Electron ipcMain instance
 * @param {Object} options.logger - Logger instance
 * @param {Object} options.handlers - Map of channel names to handler configs
 * @param {string} [options.context] - Default context for logging
 *
 * @example
 * registerHandlers({
 *   ipcMain,
 *   logger,
 *   context: 'Settings',
 *   handlers: {
 *     [IPC_CHANNELS.SETTINGS.GET]: {
 *       handler: async () => settingsService.load()
 *     },
 *     [IPC_CHANNELS.SETTINGS.SAVE]: {
 *       schema: settingsSchema,
 *       handler: async (event, settings) => settingsService.save(settings)
 *     }
 *   }
 * });
 */
function registerHandlers({ ipcMain, logger, handlers, context = 'IPC' }) {
  const { registerHandler } = require('../core/ipcRegistry');

  for (const [channel, config] of Object.entries(handlers)) {
    const handler = createHandler({
      logger,
      context,
      ...config
    });
    // CRITICAL FIX: Use registry for targeted cleanup instead of direct ipcMain.handle
    registerHandler(ipcMain, channel, handler);
  }
}

// Export Zod instance for convenience (if available)
module.exports = {
  // Primary exports
  createHandler,
  registerHandlers,

  // Individual wrappers for backwards compatibility
  withErrorLogging,
  withValidation,
  withServiceCheck,

  // Response helpers
  createErrorResponse,
  createSuccessResponse,

  // Re-export error codes for convenience
  ERROR_CODES,

  // Zod instance (may be null if not installed)
  z
};
