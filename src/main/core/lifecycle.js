/**
 * Application Lifecycle Management
 *
 * Handles app lifecycle events including shutdown, cleanup, and error handling.
 * Extracted from simple-main.js for better maintainability.
 *
 * @module core/lifecycle
 */

const { app, BrowserWindow, ipcMain } = require('electron');
const { logger } = require('../../shared/logger');
const { destroyTray, getTray } = require('./systemTray');
const { getStartupManager } = require('../services/startup');
const systemAnalytics = require('./systemAnalytics');

logger.setContext('Lifecycle');

// Module-level state (injected via initializeLifecycle)
let lifecycleConfig = {
  getMetricsInterval: null,
  setMetricsInterval: null,
  getDownloadWatcher: null,
  setDownloadWatcher: null,
  getServiceIntegration: null,
  getSettingsService: null,
  getChromaDbProcess: null,
  setChromaDbProcess: null,
  getEventListeners: null,
  setEventListeners: null,
  getChildProcessListeners: null,
  setChildProcessListeners: null,
  getGlobalProcessListeners: null,
  setGlobalProcessListeners: null,
  setIsQuitting: null,
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
  const childProcessListeners =
    lifecycleConfig.getChildProcessListeners?.() || [];
  const globalProcessListeners =
    lifecycleConfig.getGlobalProcessListeners?.() || [];
  const eventListeners = lifecycleConfig.getEventListeners?.() || [];
  const chromaDbProcess = lifecycleConfig.getChromaDbProcess?.();
  const serviceIntegration = lifecycleConfig.getServiceIntegration?.();
  const downloadWatcher = lifecycleConfig.getDownloadWatcher?.();

  // 1. Verify intervals are cleared
  if (metricsInterval !== null) {
    issues.push('metricsInterval is not null');
  }

  // 2. Verify child process listeners are cleared
  if (childProcessListeners.length > 0) {
    issues.push(
      `childProcessListeners still has ${childProcessListeners.length} entries`,
    );
  }

  // 3. Verify global process listeners are cleared
  if (globalProcessListeners.length > 0) {
    issues.push(
      `globalProcessListeners still has ${globalProcessListeners.length} entries`,
    );
  }

  // 4. Verify app event listeners are cleared
  if (eventListeners.length > 0) {
    issues.push(`eventListeners still has ${eventListeners.length} entries`);
  }

  // 5. Verify ChromaDB process is terminated
  if (chromaDbProcess !== null) {
    issues.push('chromaDbProcess is not null');
    // Try to verify process is actually dead
    try {
      if (chromaDbProcess.pid) {
        process.kill(chromaDbProcess.pid, 0);
        issues.push(
          `ChromaDB process ${chromaDbProcess.pid} may still be running`,
        );
      }
    } catch (e) {
      if (e.code !== 'ESRCH') {
        // ESRCH means process doesn't exist (good), other errors are issues
        issues.push(`ChromaDB process check failed: ${e.message}`);
      }
    }
  }

  // 6. Verify service integration is nullified
  if (serviceIntegration && serviceIntegration.initialized !== false) {
    issues.push('ServiceIntegration may not be fully shut down');
  }

  // 7. Verify download watcher is cleared
  if (downloadWatcher !== null) {
    issues.push('downloadWatcher is not null');
  }

  // 8. Verify tray is destroyed
  if (getTray() !== null) {
    issues.push('tray is not null');
  }

  // Log verification results
  if (issues.length === 0) {
    logger.info('[SHUTDOWN-VERIFY] All resources verified as released');
  } else {
    logger.warn(
      `[SHUTDOWN-VERIFY] Found ${issues.length} potential resource leaks:`,
    );
    issues.forEach((issue) => logger.warn(`[SHUTDOWN-VERIFY]   - ${issue}`));
  }
}

/**
 * Handle before-quit event - performs all cleanup operations
 * @returns {Promise<void>}
 */
async function handleBeforeQuit() {
  lifecycleConfig.setIsQuitting?.(true);

  // HIGH PRIORITY FIX (HIGH-2): Add hard timeout for all cleanup operations
  // Prevents hanging on shutdown and ensures app quits even if cleanup fails
  const CLEANUP_TIMEOUT = 5000; // 5 seconds max for all cleanup
  const cleanupStartTime = Date.now();

  logger.info('[SHUTDOWN] Starting cleanup with 5-second timeout...');

  // Wrap ALL cleanup in a timeout promise
  const cleanupPromise = (async () => {
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
        downloadWatcher.stop();
        lifecycleConfig.setDownloadWatcher?.(null);
        logger.info('[CLEANUP] Download watcher stopped');
      } catch (error) {
        logger.error('[CLEANUP] Failed to stop download watcher:', error);
      }
    }

    // Clean up child process listeners
    const childProcessListeners =
      lifecycleConfig.getChildProcessListeners?.() || [];
    for (const cleanup of childProcessListeners) {
      try {
        cleanup();
      } catch (error) {
        logger.error(
          '[CLEANUP] Failed to clean up child process listener:',
          error,
        );
      }
    }
    lifecycleConfig.setChildProcessListeners?.([]);

    // Clean up global process listeners
    const globalProcessListeners =
      lifecycleConfig.getGlobalProcessListeners?.() || [];
    for (const cleanup of globalProcessListeners) {
      try {
        cleanup();
      } catch (error) {
        logger.error(
          '[CLEANUP] Failed to clean up global process listener:',
          error,
        );
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
        `[CLEANUP] IPC cleanup: ${stats.handlers} handlers, ${stats.listeners} listeners removed`,
      );
    } catch (error) {
      logger.error('[CLEANUP] Failed to remove IPC listeners:', error);
    }

    // Clean up ChromaDB event listeners
    try {
      const { cleanupEventListeners } = require('../ipc/chromadb');
      cleanupEventListeners();
      logger.info('[CLEANUP] ChromaDB event listeners cleaned up');
    } catch (error) {
      logger.error(
        '[CLEANUP] Failed to clean up ChromaDB event listeners:',
        error,
      );
    }

    // Clean up tray
    destroyTray();

    // Use StartupManager for graceful shutdown
    try {
      const startupManager = getStartupManager();
      await startupManager.shutdown();
      logger.info('[SHUTDOWN] StartupManager cleanup completed');
    } catch (error) {
      logger.error('[SHUTDOWN] StartupManager cleanup failed:', error);
    }

    // Legacy chromaDbProcess cleanup (fallback if StartupManager didn't handle it)
    // Uses async killProcess from platformBehavior to avoid blocking main thread
    const chromaDbProcess = lifecycleConfig.getChromaDbProcess?.();
    if (chromaDbProcess) {
      const pid = chromaDbProcess.pid;
      logger.info(`[ChromaDB] Stopping ChromaDB server process (PID: ${pid})`);

      try {
        // Remove listeners before killing to avoid spurious error events
        chromaDbProcess.removeAllListeners();

        // Use async platform-aware process killing (no blocking execSync)
        const { killProcess, isProcessRunning } = require('./platformBehavior');
        const result = await killProcess(pid);

        if (result.success) {
          logger.info('[ChromaDB] Process terminated successfully');
        } else {
          logger.warn(
            '[ChromaDB] Process kill may have failed:',
            result.error?.message,
          );
        }

        // Brief async wait then verify (replaces blocking sleep)
        await new Promise((resolve) => setTimeout(resolve, 500));

        // Verify process is actually terminated
        if (isProcessRunning(pid)) {
          logger.warn(
            '[ChromaDB] Process may still be running after kill attempt!',
          );
        } else {
          logger.info('[ChromaDB] Process confirmed terminated');
        }
      } catch (e) {
        logger.error('[ChromaDB] Error stopping ChromaDB process:', e);
      }
      lifecycleConfig.setChromaDbProcess?.(null);
    }

    // Clean up service integration
    const serviceIntegration = lifecycleConfig.getServiceIntegration?.();
    if (serviceIntegration) {
      try {
        // Ensure all services are properly shut down
        await serviceIntegration.shutdown?.();
        logger.info('[CLEANUP] Service integration shut down');
      } catch (error) {
        logger.error(
          '[CLEANUP] Failed to shut down service integration:',
          error,
        );
      }
    }

    // Fixed: Clean up settings service file watcher
    const settingsService = lifecycleConfig.getSettingsService?.();
    if (settingsService) {
      try {
        settingsService.shutdown?.();
        logger.info('[CLEANUP] Settings service shut down');
      } catch (error) {
        logger.error('[CLEANUP] Failed to shut down settings service:', error);
      }
    }

    // Clean up system analytics
    try {
      systemAnalytics.destroy();
      logger.info('[CLEANUP] System analytics destroyed');
    } catch {
      // Silently ignore destroy errors on quit
    }

    // Post-shutdown verification: Verify all resources are released
    const shutdownTimeout = 10000; // 10 seconds max for shutdown

    try {
      await Promise.race([
        verifyShutdownCleanup(),
        new Promise((_, reject) =>
          setTimeout(
            () => reject(new Error('Shutdown verification timeout')),
            shutdownTimeout,
          ),
        ),
      ]);
    } catch (error) {
      logger.warn(
        '[SHUTDOWN-VERIFY] Verification failed or timed out:',
        error.message,
      );
    }
  })(); // Close cleanup promise wrapper

  // HIGH PRIORITY FIX (HIGH-2): Race cleanup against timeout
  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(
      () => reject(new Error('Cleanup timeout exceeded')),
      CLEANUP_TIMEOUT,
    ),
  );

  try {
    await Promise.race([cleanupPromise, timeoutPromise]);
    const elapsed = Date.now() - cleanupStartTime;
    logger.info(`[SHUTDOWN] Cleanup completed successfully in ${elapsed}ms`);
  } catch (error) {
    const elapsed = Date.now() - cleanupStartTime;
    if (error.message === 'Cleanup timeout exceeded') {
      logger.error(
        `[SHUTDOWN] Cleanup timed out after ${elapsed}ms (max: ${CLEANUP_TIMEOUT}ms)`,
      );
      logger.error(
        '[SHUTDOWN] Forcing app quit to prevent hanging. Some resources may not be properly released.',
      );
    } else {
      logger.error(
        `[SHUTDOWN] Cleanup failed after ${elapsed}ms:`,
        error.message,
      );
    }
  }
}

/**
 * Handle window-all-closed event
 */
function handleWindowAllClosed() {
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

/**
 * Handle uncaught exceptions
 * @param {Error} error - The uncaught error
 */
function handleUncaughtException(error) {
  logger.error('UNCAUGHT EXCEPTION:', {
    message: error.message,
    stack: error.stack,
  });
}

/**
 * Handle unhandled promise rejections
 * @param {any} reason - The rejection reason
 * @param {Promise} promise - The rejected promise
 */
function handleUnhandledRejection(reason, promise) {
  logger.error('UNHANDLED REJECTION', { reason, promise: String(promise) });
}

/**
 * Register all lifecycle event handlers
 * @param {Function} createWindow - Function to create the main window
 * @returns {Object} Object containing cleanup functions
 */
function registerLifecycleHandlers(createWindow) {
  // Register before-quit handler
  app.on('before-quit', handleBeforeQuit);

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
      app.removeListener('window-all-closed', handleWindowAllClosed);
      app.removeListener('activate', activateHandler);
    },
    cleanupProcessListeners: () => {
      process.removeListener('uncaughtException', handleUncaughtException);
      process.removeListener('unhandledRejection', handleUnhandledRejection);
    },
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
  verifyShutdownCleanup,
};
