/**
 * Application Lifecycle Management
 *
 * Handles app lifecycle events including shutdown, cleanup, and error handling.
 * Extracted from simple-main.js for better maintainability.
 *
 * @module core/lifecycle
 */

const { app, BrowserWindow, ipcMain } = require('electron');
const { createLogger } = require('../../shared/logger');
const { destroyTray, getTray, unregisterGlobalShortcuts } = require('./systemTray');
const { getStartupManager } = require('../services/startup');
const systemAnalytics = require('./systemAnalytics');
const { withTimeout } = require('../../shared/promiseUtils');

const logger = createLogger('Lifecycle');
// Module-level state (injected via initializeLifecycle)
let lifecycleConfig = {
  getMetricsInterval: null,
  setMetricsInterval: null,
  getDownloadWatcher: null,
  setDownloadWatcher: null,
  getServiceIntegration: null,
  getSettingsService: null,
  getEventListeners: null,
  setEventListeners: null,
  getChildProcessListeners: null,
  setChildProcessListeners: null,
  getGlobalProcessListeners: null,
  setGlobalProcessListeners: null,
  setIsQuitting: null
};

/**
 * Initialize lifecycle configuration
 * @param {Object} config - Configuration object with getters/setters for shared state
 */
function initializeLifecycle(config) {
  lifecycleConfig = { ...lifecycleConfig, ...config };
}

/**
 * Verify that all resources are properly released after shutdown
 * @returns {Promise<void>}
 */
async function verifyShutdownCleanup() {
  const issues = [];

  const metricsInterval = lifecycleConfig.getMetricsInterval?.();
  const childProcessListeners = lifecycleConfig.getChildProcessListeners?.() || [];
  const globalProcessListeners = lifecycleConfig.getGlobalProcessListeners?.() || [];
  const eventListeners = lifecycleConfig.getEventListeners?.() || [];
  const serviceIntegration = lifecycleConfig.getServiceIntegration?.();
  const downloadWatcher = lifecycleConfig.getDownloadWatcher?.();

  // 1. Verify intervals are cleared
  if (metricsInterval !== null) {
    issues.push('metricsInterval is not null');
  }

  // 2. Verify child process listeners are cleared
  if (childProcessListeners.length > 0) {
    issues.push(`childProcessListeners still has ${childProcessListeners.length} entries`);
  }

  // 3. Verify global process listeners are cleared
  if (globalProcessListeners.length > 0) {
    issues.push(`globalProcessListeners still has ${globalProcessListeners.length} entries`);
  }

  // 4. Verify app event listeners are cleared
  if (eventListeners.length > 0) {
    issues.push(`eventListeners still has ${eventListeners.length} entries`);
  }

  // 5. Verify service integration is nullified
  if (serviceIntegration && serviceIntegration.initialized !== false) {
    issues.push('ServiceIntegration may not be fully shut down');
  }

  // 6. Verify download watcher is cleared
  if (downloadWatcher !== null) {
    issues.push('downloadWatcher is not null');
  }

  // 7. Verify tray is destroyed
  if (getTray() !== null) {
    issues.push('tray is not null');
  }

  // Log verification results
  if (issues.length === 0) {
    logger.info('[SHUTDOWN-VERIFY] All resources verified as released');
  } else {
    logger.warn(`[SHUTDOWN-VERIFY] Found ${issues.length} potential resource leaks:`);
    issues.forEach((issue) => logger.warn(`[SHUTDOWN-VERIFY]   - ${issue}`));
  }
}

/**
 * Handle before-quit event - performs all cleanup operations
 * @returns {Promise<void>}
 */
let _quitCleanupStarted = false;
async function handleBeforeQuit() {
  // FIX: Guard against re-entrant quit (CMD+Q, dock quit, app.quit() overlap)
  if (_quitCleanupStarted) return;
  _quitCleanupStarted = true;

  lifecycleConfig.setIsQuitting?.(true);

  // FIX: CRITICAL - Enable IPC shutdown gate immediately to prevent new handler calls
  // This must happen before any cleanup to prevent handlers accessing destroyed services
  try {
    const { setShuttingDown } = require('./ipcRegistry');
    setShuttingDown(true);
  } catch (e) {
    logger.warn('[SHUTDOWN] Could not set IPC shutdown gate:', e.message);
  }

  // HIGH PRIORITY FIX (HIGH-2): Add hard timeout for all cleanup operations
  // Prevents hanging on shutdown and ensures app quits even if cleanup fails
  // FIX: Increased from 5s to 12s - legacy external shutdown can be slow, plus services need time, plus buffer
  const CLEANUP_TIMEOUT = 12000; // 12 seconds max for all cleanup
  const cleanupStartTime = Date.now();

  logger.info('[SHUTDOWN] Starting cleanup with 12-second timeout...');

  // Wrap ALL cleanup in a timeout promise
  const cleanupPromise = (async () => {
    // Unregister global shortcuts first
    try {
      unregisterGlobalShortcuts();
      logger.info('[CLEANUP] Global shortcuts unregistered');
    } catch (error) {
      logger.warn('[CLEANUP] Failed to unregister global shortcuts:', error.message);
    }

    // Clean up all intervals first
    const metricsInterval = lifecycleConfig.getMetricsInterval?.();
    if (metricsInterval) {
      clearInterval(metricsInterval);
      lifecycleConfig.setMetricsInterval?.(null);
      logger.info('[CLEANUP] Metrics interval cleared');
    }

    // Clean up download watcher
    const downloadWatcher = lifecycleConfig.getDownloadWatcher?.();
    if (downloadWatcher) {
      try {
        await Promise.resolve(downloadWatcher.stop?.());
        logger.info('[CLEANUP] Download watcher stopped');
      } catch (error) {
        logger.error('[CLEANUP] Failed to stop download watcher:', error);
      } finally {
        lifecycleConfig.setDownloadWatcher?.(null);
      }
    }

    // Clean up child process listeners
    const childProcessListeners = lifecycleConfig.getChildProcessListeners?.() || [];
    for (const cleanup of childProcessListeners) {
      try {
        cleanup();
      } catch (error) {
        logger.error('[CLEANUP] Failed to clean up child process listener:', error);
      }
    }
    lifecycleConfig.setChildProcessListeners?.([]);

    // Clean up global process listeners
    const globalProcessListeners = lifecycleConfig.getGlobalProcessListeners?.() || [];
    for (const cleanup of globalProcessListeners) {
      try {
        cleanup();
      } catch (error) {
        logger.error('[CLEANUP] Failed to clean up global process listener:', error);
      }
    }
    lifecycleConfig.setGlobalProcessListeners?.([]);

    // Clean up app event listeners
    const eventListeners = lifecycleConfig.getEventListeners?.() || [];
    for (const cleanup of eventListeners) {
      try {
        cleanup();
      } catch (error) {
        logger.error('[CLEANUP] Failed to clean up app event listener:', error);
      }
    }
    lifecycleConfig.setEventListeners?.([]);

    // Clean up IPC listeners (CRITICAL FIX: use targeted cleanup via registry)
    try {
      const { removeAllRegistered } = require('./ipcRegistry');
      const stats = removeAllRegistered(ipcMain);
      logger.info(
        `[CLEANUP] IPC cleanup: ${stats.handlers} handlers, ${stats.listeners} listeners removed`
      );
    } catch (error) {
      logger.error('[CLEANUP] Failed to remove IPC listeners:', error);
    }

    // Vector DB (Orama) is in-process - cleanup happens via ServiceContainer shutdown
    logger.debug('[CLEANUP] Vector DB cleanup handled by ServiceContainer');

    // Clean up tray
    destroyTray();

    // Clean up AI engine resources
    try {
      const { cleanup } = require('../llamaUtils');
      await cleanup();
      logger.info('[CLEANUP] AI engine resources cleaned up');
    } catch (error) {
      logger.error('[CLEANUP] Failed to clean up AI engine resources:', error);
    }

    // Use StartupManager for graceful shutdown
    try {
      const startupManager = getStartupManager();
      await startupManager.shutdown();
      logger.info('[SHUTDOWN] StartupManager cleanup completed');
    } catch (error) {
      logger.error('[SHUTDOWN] StartupManager cleanup failed:', error);
    }

    // Clean up service integration
    const serviceIntegration = lifecycleConfig.getServiceIntegration?.();
    if (serviceIntegration) {
      try {
        // Ensure all services are properly shut down
        await serviceIntegration.shutdown?.();
        logger.info('[CLEANUP] Service integration shut down');
      } catch (error) {
        logger.error('[CLEANUP] Failed to shut down service integration:', error);
      }
    }

    // Fixed: Clean up settings service file watcher
    // FIX: Await shutdown - settingsService.shutdown() is async and closes file watchers
    const settingsService = lifecycleConfig.getSettingsService?.();
    if (settingsService) {
      try {
        await settingsService.shutdown?.();
        logger.info('[CLEANUP] Settings service shut down');
      } catch (error) {
        logger.error('[CLEANUP] Failed to shut down settings service:', error);
      }
    } else {
      // FIX 2.5: Warn when settings service wasn't available for shutdown
      // This helps identify initialization failures that could leak file watchers
      logger.warn(
        '[CLEANUP] Settings service not available for shutdown - may indicate initialization failure'
      );
    }

    // Clean up system analytics
    try {
      systemAnalytics.destroy();
      logger.info('[CLEANUP] System analytics destroyed');
    } catch {
      // Silently ignore destroy errors on quit
    }
    // FIX: Verification moved outside cleanup promise to avoid nested timeout issues
  })(); // Close cleanup promise wrapper

  // Race cleanup against timeout
  try {
    await withTimeout(cleanupPromise, CLEANUP_TIMEOUT, 'Cleanup');
    const elapsed = Date.now() - cleanupStartTime;
    logger.info(`[SHUTDOWN] Cleanup completed successfully in ${elapsed}ms`);
  } catch (error) {
    const elapsed = Date.now() - cleanupStartTime;
    if (error.message.includes('timed out')) {
      logger.error(`[SHUTDOWN] Cleanup timed out after ${elapsed}ms (max: ${CLEANUP_TIMEOUT}ms)`);
      logger.error(
        '[SHUTDOWN] Forcing app quit to prevent hanging. Some resources may not be properly released.'
      );
    } else {
      logger.error(`[SHUTDOWN] Cleanup failed after ${elapsed}ms:`, error.message);
    }
  }

  // FIX: Post-shutdown verification runs AFTER cleanup completes (not nested inside)
  // This avoids the previous issue where 10s verification was nested inside 12s cleanup timeout
  try {
    await verifyShutdownCleanup();
  } catch (verifyError) {
    logger.warn('[SHUTDOWN-VERIFY] Verification failed:', verifyError.message);
  }
}

/**
 * Handle window-all-closed event
 */
function handleWindowAllClosed() {
  // Check if background mode is enabled - if so, don't quit when windows are closed
  const settingsService = lifecycleConfig.getSettingsService?.();
  const backgroundMode = settingsService?.get?.('backgroundMode');

  if (backgroundMode) {
    logger.info('[LIFECYCLE] Background mode enabled - keeping app running in tray');
    return; // Don't quit, keep running in tray
  }

  // Use platform abstraction instead of direct isMacOS check
  const { shouldQuitOnAllWindowsClosed } = require('./platformBehavior');
  if (shouldQuitOnAllWindowsClosed()) {
    app.quit();
  }
}

/**
 * Handle activate event (macOS dock click)
 * @param {Function} createWindow - Function to create the main window
 */
function handleActivate(createWindow) {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
}

// FIX: Track unhandled errors for monitoring
let _unhandledExceptionCount = 0;
let _unhandledRejectionCount = 0;

/**
 * Classify error type for better monitoring and debugging
 * @param {Error|any} error - The error to classify
 * @returns {string} Error classification
 * @private
 */
function _classifyError(error) {
  const message = (error?.message || String(error)).toLowerCase();
  const code = error?.code || '';

  if (code === 'ECONNREFUSED' || code === 'ECONNRESET' || code === 'ETIMEDOUT') {
    return 'NETWORK';
  }
  if (message.includes('out of memory') || message.includes('heap')) {
    return 'MEMORY';
  }
  if (message.includes('permission') || message.includes('access denied')) {
    return 'PERMISSION';
  }
  if (code === 'ENOENT' || message.includes('file not found')) {
    return 'FILE_NOT_FOUND';
  }
  if (message.includes('timeout')) {
    return 'TIMEOUT';
  }
  if (message.includes('vector db') || message.includes('orama')) {
    return 'VECTOR_DB';
  }
  if (message.includes('llama')) {
    return 'LLAMA';
  }
  return 'UNKNOWN';
}

/**
 * Handle uncaught exceptions
 * FIX: Enhanced with error classification and count tracking
 * @param {Error} error - The uncaught error
 */
function handleUncaughtException(error) {
  _unhandledExceptionCount++;
  const errorType = _classifyError(error);

  logger.error('UNCAUGHT EXCEPTION:', {
    message: error?.message || String(error),
    stack: error?.stack,
    code: error?.code,
    errorType,
    exceptionCount: _unhandledExceptionCount
  });

  // For fatal errors (memory, etc.), we may want to force exit
  if (errorType === 'MEMORY') {
    logger.error('[LIFECYCLE] Critical memory error - application may become unstable');
  }
}

/**
 * Handle unhandled promise rejections
 * FIX: Enhanced with error classification, stack traces, and count tracking
 * @param {any} reason - The rejection reason
 * @param {Promise} promise - The rejected promise
 */
function handleUnhandledRejection(reason, promise) {
  _unhandledRejectionCount++;

  // Extract useful information from the reason
  const isError = reason instanceof Error;
  const message = isError ? reason.message : String(reason);
  const stack = isError ? reason.stack : new Error().stack;
  const code = reason?.code;
  const errorType = _classifyError(reason);

  logger.error('UNHANDLED REJECTION:', {
    message,
    stack,
    code,
    errorType,
    rejectionCount: _unhandledRejectionCount,
    promiseInfo: String(promise)
  });

  // Log warning for common issues
  if (errorType === 'NETWORK') {
    logger.warn('[LIFECYCLE] Network-related unhandled rejection - check service connectivity');
  } else if (errorType === 'VECTOR_DB') {
    logger.warn('[LIFECYCLE] Vector DB-related unhandled rejection - check vector state');
  } else if (errorType === 'LLAMA') {
    logger.warn('[LIFECYCLE] AI engine-related unhandled rejection - check model state');
  }
}

/**
 * Get unhandled error counts for monitoring
 * @returns {Object} Counts of unhandled exceptions and rejections
 */
function getUnhandledErrorCounts() {
  return {
    exceptions: _unhandledExceptionCount,
    rejections: _unhandledRejectionCount
  };
}

/**
 * Register all lifecycle event handlers
 * @param {Function} createWindow - Function to create the main window
 * @returns {Object} Object containing cleanup functions
 */
function registerLifecycleHandlers(createWindow) {
  // Register before-quit handler
  app.on('before-quit', handleBeforeQuit);

  // Store handler references so they can be removed during cleanup
  const willQuitHandler = () => {
    logger.info('[SHUTDOWN] will-quit event - app will terminate');
  };
  const quitHandler = (event, exitCode) => {
    logger.info(`[SHUTDOWN] App quit with exit code: ${exitCode}`);
  };

  app.on('will-quit', willQuitHandler);
  app.on('quit', quitHandler);

  // Register window-all-closed handler
  app.on('window-all-closed', handleWindowAllClosed);

  // Register activate handler
  const activateHandler = () => handleActivate(createWindow);
  app.on('activate', activateHandler);

  // Register process error handlers
  process.on('uncaughtException', handleUncaughtException);
  process.on('unhandledRejection', handleUnhandledRejection);

  logger.info('[LIFECYCLE] All lifecycle handlers registered');

  // Return cleanup functions for proper teardown
  return {
    cleanupAppListeners: () => {
      app.removeListener('before-quit', handleBeforeQuit);
      app.removeListener('will-quit', willQuitHandler);
      app.removeListener('quit', quitHandler);
      app.removeListener('window-all-closed', handleWindowAllClosed);
      app.removeListener('activate', activateHandler);
    },
    cleanupProcessListeners: () => {
      process.removeListener('uncaughtException', handleUncaughtException);
      process.removeListener('unhandledRejection', handleUnhandledRejection);
    }
  };
}

module.exports = {
  initializeLifecycle,
  registerLifecycleHandlers,
  handleBeforeQuit,
  handleWindowAllClosed,
  handleActivate,
  handleUncaughtException,
  handleUnhandledRejection,
  getUnhandledErrorCounts,
  verifyShutdownCleanup
};
