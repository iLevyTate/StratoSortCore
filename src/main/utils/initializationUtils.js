/**
 * Initialization Utilities
 *
 * Reusable patterns for service initialization with retry logic.
 *
 * @module utils/initializationUtils
 */

const { logger } = require('../../shared/logger');

logger.setContext('InitializationUtils');

/**
 * Creates a memoized initialization function with retry logic.
 *
 * This utility ensures:
 * - Only one initialization runs at a time
 * - Failed initializations can be retried
 * - Exponential backoff with jitter for retries
 * - Graceful degradation (doesn't throw, returns boolean)
 *
 * @param {Object} options - Options
 * @param {Function} options.initFn - Async function to perform initialization
 * @param {string} options.serviceName - Name for logging (e.g., '[SEMANTIC]')
 * @param {number} options.maxRetries - Maximum retry attempts (default: 5)
 * @param {number} options.baseDelay - Base delay in ms for exponential backoff (default: 2000)
 * @param {Object} options.logger - Logger instance (optional, uses default if not provided)
 * @returns {Object} Object with ensureInitialized(), isInitialized(), and reset()
 *
 * @example
 * const { ensureInitialized, isInitialized } = createInitializer({
 *   serviceName: '[CHROMADB]',
 *   initFn: async () => {
 *     await chromaDbService.initialize();
 *     await folderMatcher.initialize();
 *   }
 * });
 *
 * // In IPC handler:
 * await ensureInitialized();
 * if (!isInitialized()) {
 *   return { success: false, error: 'Service not available' };
 * }
 */
function createInitializer(options) {
  const {
    initFn,
    serviceName = '[INIT]',
    maxRetries = 5,
    baseDelay = 2000,
    logger: customLogger = logger
  } = options;

  let initializationPromise = null;
  let isInitializedFlag = false;

  /**
   * Ensures the service is initialized, with retry logic.
   * @returns {Promise<void>} Resolves when initialized (or retries exhausted)
   */
  async function ensureInitialized() {
    if (isInitializedFlag) return Promise.resolve();
    if (initializationPromise) return initializationPromise;

    initializationPromise = (async () => {
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          customLogger.info(
            `${serviceName} Starting initialization (attempt ${attempt}/${maxRetries})...`
          );

          await initFn();

          customLogger.info(`${serviceName} Initialization complete`);
          isInitializedFlag = true;
          return;
        } catch (error) {
          customLogger.warn(
            `${serviceName} Initialization attempt ${attempt} failed:`,
            error.message
          );

          if (attempt < maxRetries) {
            // Exponential backoff with jitter
            const delay = baseDelay * 2 ** (attempt - 1) + Math.random() * 1000;
            customLogger.info(`${serviceName} Retrying in ${Math.round(delay)}ms...`);
            await new Promise((resolve) => setTimeout(resolve, delay));
          } else {
            customLogger.error(
              `${serviceName} All initialization attempts failed. Service will be unavailable.`
            );
            initializationPromise = null; // Allow retry on next explicit call
            // Don't throw - allow the app to continue in degraded mode
            return;
          }
        }
      }
    })();

    return initializationPromise;
  }

  /**
   * Check if initialization has completed successfully.
   * @returns {boolean}
   */
  function isInitialized() {
    return isInitializedFlag;
  }

  /**
   * Reset initialization state (for testing).
   */
  function reset() {
    isInitializedFlag = false;
    initializationPromise = null;
  }

  /**
   * Pre-warm the service by starting initialization in the background.
   * Non-blocking, failures are logged but don't throw.
   * @param {number} delayMs - Delay before starting (default: 1000)
   */
  function preWarm(delayMs = 1000) {
    setImmediate(() => {
      setTimeout(() => {
        ensureInitialized().catch((error) => {
          customLogger.warn(
            `${serviceName} Background pre-warm failed (non-fatal):`,
            error.message
          );
        });
      }, delayMs);
    });
  }

  return {
    ensureInitialized,
    isInitialized,
    reset,
    preWarm
  };
}

/**
 * Creates a standard unavailable response for handlers.
 * @param {string} serviceName - Name of the unavailable service
 * @param {boolean} pending - Whether initialization is still pending
 * @returns {Object} Standard unavailable response
 */
function createUnavailableResponse(serviceName, pending = false) {
  return {
    success: false,
    error: pending
      ? `${serviceName} initialization pending. Please try again in a few seconds.`
      : `${serviceName} is not available. Please ensure the service is running.`,
    unavailable: !pending,
    pending
  };
}

module.exports = {
  createInitializer,
  createUnavailableResponse
};
