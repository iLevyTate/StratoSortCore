/**
 * IPC Verification
 *
 * Verifies that all critical IPC handlers are registered.
 * Extracted from simple-main.js for better maintainability.
 *
 * @module core/ipcVerification
 */

const { ipcMain } = require('electron');
const { isWindows } = require('../../shared/platformUtils');
const { logger } = require('../../shared/logger');

logger.setContext('IPC-Verify');

/**
 * Required IPC handlers that must be registered before window creation
 */
const REQUIRED_HANDLERS = [
  // Settings - critical for initial load
  'get-settings',
  'save-settings',

  // Smart Folders - needed for UI initialization
  'get-smart-folders',
  'save-smart-folders',
  'get-custom-folders',
  'update-custom-folders',

  // File operations - core functionality
  'handle-file-selection',
  'select-directory',
  'get-documents-path',
  'get-file-stats',
  'get-files-in-directory',

  // Analysis - core functionality
  'analyze-document',
  'analyze-image',

  // Organization - core functionality
  'auto-organize-files',
  'batch-organize-files',

  // Suggestions - needed for UI
  'get-file-suggestions',
  'get-batch-suggestions',

  // System monitoring
  'get-system-metrics',
  'get-application-statistics',

  // Ollama - AI features
  'get-ollama-models',
  'test-ollama-connection'
];

/**
 * Windows-specific IPC handlers
 */
const WINDOWS_HANDLERS = [
  'window-minimize',
  'window-maximize',
  'window-toggle-maximize',
  'window-is-maximized',
  'window-close'
];

/**
 * Check if a specific IPC handler is registered
 * @param {string} channel - Channel name
 * @returns {boolean}
 */
function hasInvokeHandler(channel) {
  const map = ipcMain._invokeHandlers;
  if (!map) return false;

  // Electron 28+ stores handlers in a Map with has()
  if (typeof map.has === 'function') {
    return map.has(channel);
  }
  // Older versions expose get() that returns handler or undefined
  if (typeof map.get === 'function') {
    return !!map.get(channel);
  }
  return false;
}

/**
 * Check which handlers are registered
 * @returns {{allRegistered: boolean, missing: string[]}}
 */
function checkHandlers() {
  const requiredHandlers = [...REQUIRED_HANDLERS, ...(isWindows ? WINDOWS_HANDLERS : [])];

  const missing = [];
  for (const handler of requiredHandlers) {
    const listenerCount = ipcMain.listenerCount(handler);
    const handled = listenerCount > 0 || hasInvokeHandler(handler);
    if (!handled) {
      missing.push(handler);
    } else {
      logger.debug(
        `[IPC-VERIFY] Handler verified: ${handler} (${listenerCount} listener${listenerCount > 1 ? 's' : ''}${
          listenerCount === 0 ? ', invoke handler' : ''
        })`
      );
    }
  }

  return {
    allRegistered: missing.length === 0,
    missing
  };
}

/**
 * Verify that all critical IPC handlers are registered.
 * Uses exponential backoff retry logic with timeout protection.
 * @returns {Promise<boolean>} true if all handlers are registered
 */
async function verifyIpcHandlersRegistered() {
  const maxRetries = 10;
  const maxTimeout = 2000; // Reduced to 2 seconds to prevent startup hang
  const initialDelay = 50; // Start with 50ms
  const maxDelay = 500; // Cap at 500ms
  const startTime = Date.now();

  const requiredHandlers = [...REQUIRED_HANDLERS, ...(isWindows ? WINDOWS_HANDLERS : [])];

  // Initial check
  let checkResult = checkHandlers();
  if (checkResult.allRegistered) {
    logger.info(
      `[IPC-VERIFY] Verified ${requiredHandlers.length} critical handlers are registered`
    );
    return true;
  }

  logger.warn(
    `[IPC-VERIFY] Missing ${checkResult.missing.length} handlers: ${checkResult.missing.join(', ')}`
  );
  logger.info('[IPC-VERIFY] Starting retry logic with exponential backoff...');

  // Retry with exponential backoff
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    // Check timeout
    const elapsed = Date.now() - startTime;
    if (elapsed >= maxTimeout) {
      logger.error(
        `[IPC-VERIFY] Timeout after ${elapsed}ms. Still missing ${checkResult.missing.length} handlers: ${checkResult.missing.join(', ')}`
      );
      return false;
    }

    // Calculate delay with exponential backoff
    const delay = Math.min(initialDelay * 2 ** attempt, maxDelay);

    // Wait before retry
    await new Promise((resolve) => setTimeout(resolve, delay));

    // Re-check handlers
    checkResult = checkHandlers();

    if (checkResult.allRegistered) {
      const totalTime = Date.now() - startTime;
      logger.info(
        `[IPC-VERIFY] All handlers registered after ${attempt + 1} attempt(s) in ${totalTime}ms`
      );
      return true;
    }

    // Log progress every 2 attempts
    if (attempt % 2 === 1) {
      logger.debug(
        `[IPC-VERIFY] Attempt ${attempt + 1}/${maxRetries}: Still missing ${checkResult.missing.length} handlers`
      );
    }
  }

  // Final check after all retries
  checkResult = checkHandlers();
  if (checkResult.allRegistered) {
    logger.info('[IPC-VERIFY] All handlers registered after retries');
    return true;
  }

  logger.error(
    `[IPC-VERIFY] Failed to register all handlers after ${maxRetries} attempts. Missing: ${checkResult.missing.join(', ')}`
  );
  return false;
}

module.exports = {
  verifyIpcHandlersRegistered,
  checkHandlers,
  REQUIRED_HANDLERS,
  WINDOWS_HANDLERS
};
