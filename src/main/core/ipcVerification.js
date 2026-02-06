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
const { createLogger } = require('../../shared/logger');
const { IPC_CHANNELS } = require('../../shared/constants');

const logger = createLogger('IPC-Verify');
/**
 * Required IPC handlers that must be registered before window creation
 */
const REQUIRED_HANDLERS = [
  // Settings - critical for initial load
  IPC_CHANNELS.SETTINGS.GET,
  IPC_CHANNELS.SETTINGS.SAVE,

  // Smart Folders - needed for UI initialization
  IPC_CHANNELS.SMART_FOLDERS.GET,
  IPC_CHANNELS.SMART_FOLDERS.SAVE,
  IPC_CHANNELS.SMART_FOLDERS.GET_CUSTOM,
  IPC_CHANNELS.SMART_FOLDERS.UPDATE_CUSTOM,

  // File operations - core functionality
  IPC_CHANNELS.FILES.SELECT,
  IPC_CHANNELS.FILES.SELECT_DIRECTORY,
  IPC_CHANNELS.FILES.GET_DOCUMENTS_PATH,
  IPC_CHANNELS.FILES.GET_FILE_STATS,
  IPC_CHANNELS.FILES.GET_FILES_IN_DIRECTORY,

  // Analysis - core functionality
  IPC_CHANNELS.ANALYSIS.ANALYZE_DOCUMENT,
  IPC_CHANNELS.ANALYSIS.ANALYZE_IMAGE,

  // Organization - core functionality
  IPC_CHANNELS.ORGANIZE.AUTO,
  IPC_CHANNELS.ORGANIZE.BATCH,

  // Suggestions - needed for UI
  IPC_CHANNELS.SUGGESTIONS.GET_FILE_SUGGESTIONS,
  IPC_CHANNELS.SUGGESTIONS.GET_BATCH_SUGGESTIONS,

  // System monitoring
  IPC_CHANNELS.SYSTEM.GET_METRICS,
  IPC_CHANNELS.SYSTEM.GET_APPLICATION_STATISTICS,

  // Llama - AI features
  IPC_CHANNELS.LLAMA.GET_MODELS,
  IPC_CHANNELS.LLAMA.TEST_CONNECTION
];

/**
 * Windows-specific IPC handlers
 */
const WINDOWS_HANDLERS = [
  IPC_CHANNELS.WINDOW.MINIMIZE,
  IPC_CHANNELS.WINDOW.MAXIMIZE,
  IPC_CHANNELS.WINDOW.TOGGLE_MAXIMIZE,
  IPC_CHANNELS.WINDOW.IS_MAXIMIZED,
  IPC_CHANNELS.WINDOW.CLOSE
];

/**
 * Check if a specific IPC handler is registered
 * @param {string} channel - Channel name
 * @returns {boolean}
 */
function hasInvokeHandler(channel) {
  // FIX 87: Use the project's own IPC registry instead of private Electron API.
  // ipcMain._invokeHandlers is undocumented and may not exist in Electron 40+,
  // causing all invoke handlers to appear missing and adding startup delay.
  try {
    const { hasHandler } = require('./ipcRegistry');
    return hasHandler(channel);
  } catch {
    // Fallback to private API if registry unavailable during early startup
    const map = ipcMain._invokeHandlers;
    if (!map) return false;
    if (typeof map.has === 'function') return map.has(channel);
    if (typeof map.get === 'function') return !!map.get(channel);
    return false;
  }
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
