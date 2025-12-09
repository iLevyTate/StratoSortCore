/**
 * Auto-Updater Module
 *
 * Handles automatic application updates in production.
 * Extracted from simple-main.js for better maintainability.
 *
 * @module core/autoUpdater
 */

const { BrowserWindow } = require('electron');
const { autoUpdater } = require('electron-updater');
const { logger } = require('../../shared/logger');

logger.setContext('AutoUpdater');

// Track cleanup functions
let cleanupFunctions = [];

/**
 * Send update status to renderer
 * @param {string} status - Update status ('available', 'none', 'ready')
 */
function notifyRenderer(status) {
  try {
    const win = BrowserWindow.getAllWindows()[0];
    if (win && !win.isDestroyed()) {
      win.webContents.send('app:update', { status });
    }
  } catch (error) {
    logger.error(`[UPDATER] Failed to send ${status} message:`, error);
  }
}

/**
 * Handle updater errors
 * @param {Error} err - The error that occurred
 */
function handleError(err) {
  logger.error('[UPDATER] Error:', err);
}

/**
 * Handle update available event
 */
function handleUpdateAvailable() {
  logger.info('[UPDATER] Update available');
  notifyRenderer('available');
}

/**
 * Handle update not available event
 */
function handleUpdateNotAvailable() {
  logger.info('[UPDATER] No updates available');
  notifyRenderer('none');
}

/**
 * Handle update downloaded event
 */
function handleUpdateDownloaded() {
  logger.info('[UPDATER] Update downloaded');
  notifyRenderer('ready');
}

/**
 * Initialize auto-updater (production only)
 * @param {boolean} isDev - Whether running in development mode
 * @returns {Promise<Object>} Result object with cleanup function
 */
async function initializeAutoUpdater(isDev) {
  if (isDev) {
    logger.debug('[UPDATER] Skipping auto-updater setup in development mode');
    return { cleanup: () => {} };
  }

  try {
    autoUpdater.autoDownload = true;

    // Register event handlers
    autoUpdater.on('error', handleError);
    autoUpdater.on('update-available', handleUpdateAvailable);
    autoUpdater.on('update-not-available', handleUpdateNotAvailable);
    autoUpdater.on('update-downloaded', handleUpdateDownloaded);

    // Store cleanup function
    const cleanup = () => {
      autoUpdater.removeListener('error', handleError);
      autoUpdater.removeListener('update-available', handleUpdateAvailable);
      autoUpdater.removeListener(
        'update-not-available',
        handleUpdateNotAvailable,
      );
      autoUpdater.removeListener('update-downloaded', handleUpdateDownloaded);
      logger.debug('[UPDATER] Listeners cleaned up');
    };

    cleanupFunctions.push(cleanup);

    // Check for updates
    try {
      await autoUpdater.checkForUpdatesAndNotify();
      logger.info('[UPDATER] Update check completed');
    } catch (e) {
      logger.error('[UPDATER] Update check failed:', {
        error: e.message,
        stack: e.stack,
      });
    }

    return { cleanup };
  } catch (error) {
    logger.error('[UPDATER] Failed to setup auto-updater:', error);
    return { cleanup: () => {} };
  }
}

/**
 * Clean up all auto-updater listeners
 */
function cleanupAutoUpdater() {
  for (const cleanup of cleanupFunctions) {
    try {
      cleanup();
    } catch (error) {
      logger.error('[UPDATER] Cleanup error:', error);
    }
  }
  cleanupFunctions = [];
}

/**
 * Manually trigger an update check
 * @returns {Promise<void>}
 */
async function checkForUpdates() {
  try {
    await autoUpdater.checkForUpdatesAndNotify();
  } catch (error) {
    logger.error('[UPDATER] Manual update check failed:', error);
  }
}

/**
 * Quit and install the downloaded update
 */
function quitAndInstall() {
  autoUpdater.quitAndInstall();
}

module.exports = {
  initializeAutoUpdater,
  cleanupAutoUpdater,
  checkForUpdates,
  quitAndInstall,
};
