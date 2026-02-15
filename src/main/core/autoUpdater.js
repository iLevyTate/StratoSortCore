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
const { IPC_EVENTS } = require('../../shared/constants');
const { createLogger } = require('../../shared/logger');
// FIX: Import safeSend for validated IPC event sending
const { safeSend } = require('../ipc/ipcWrappers');

const logger = createLogger('AutoUpdater');
// Track active cleanup function and init guard
let activeCleanup = null;
let initPromise = null;
let initialized = false;

/**
 * Send update status to renderer
 * @param {Object|string} payload - Update payload or status string
 * @param {Function | undefined} getMainWindow - Accessor for the main window
 */
function notifyRenderer(payload, getMainWindow) {
  try {
    const win = (getMainWindow ? getMainWindow() : null) || BrowserWindow.getAllWindows()[0];
    if (win && !win.isDestroyed()) {
      // FIX: Use safeSend for validated IPC event sending
      const updatePayload =
        typeof payload === 'string'
          ? { status: payload }
          : payload && typeof payload === 'object'
            ? payload
            : null;

      if (!updatePayload) {
        logger.warn('[UPDATER] Invalid update payload', { payload });
        return;
      }

      safeSend(win.webContents, IPC_EVENTS.APP_UPDATE, updatePayload);
    }
  } catch (error) {
    logger.error('[UPDATER] Failed to send update message:', error);
  }
}

/**
 * Handle updater errors
 * @param {Error} err - The error that occurred
 * @param {Function | undefined} getMainWindow - Accessor for the main window
 */
function handleError(err, getMainWindow) {
  logger.error('[UPDATER] Error:', err);
  notifyRenderer(
    {
      status: 'error',
      error: err?.message || 'Update error'
    },
    getMainWindow
  );
}

/**
 * Handle update available event
 * @param {Function | undefined} getMainWindow - Accessor for the main window
 */
function handleUpdateAvailable(getMainWindow) {
  logger.info('[UPDATER] Update available');
  notifyRenderer('available', getMainWindow);
}

/**
 * Handle update not available event
 * @param {Function | undefined} getMainWindow - Accessor for the main window
 */
function handleUpdateNotAvailable(getMainWindow) {
  logger.info('[UPDATER] No updates available');
  notifyRenderer('not-available', getMainWindow);
}

/**
 * Handle update downloaded event
 * @param {Function | undefined} getMainWindow - Accessor for the main window
 */
function handleUpdateDownloaded(getMainWindow) {
  logger.info('[UPDATER] Update downloaded');
  notifyRenderer('downloaded', getMainWindow);
}

/**
 * Handle update progress event
 * @param {Object} progressObj - download progress
 * @param {Function | undefined} getMainWindow - Accessor for the main window
 */
function handleUpdateProgress(progressObj, getMainWindow) {
  try {
    const win = (getMainWindow ? getMainWindow() : null) || BrowserWindow.getAllWindows()[0];
    if (win && !win.isDestroyed()) {
      safeSend(win.webContents, IPC_EVENTS.APP_UPDATE, {
        status: 'downloading',
        progress: progressObj.percent
      });
    }
  } catch {
    // Ignore progress errors to avoid log spam
  }
}

/**
 * Initialize auto-updater (production only)
 * @param {boolean} isDev - Whether running in development mode
 * @param {Function | undefined} getMainWindow - Accessor for the main window
 * @returns {Promise<Object>} Result object with cleanup function
 */
async function initializeAutoUpdater(isDev, getMainWindow) {
  if (isDev) {
    logger.debug('[UPDATER] Skipping auto-updater setup in development mode');
    return { cleanup: () => {} };
  }

  // Prevent duplicate initialization: return existing promise if in-progress,
  // or return cached cleanup if already completed
  if (initPromise) {
    logger.debug('[UPDATER] Initialization already in progress');
    return initPromise;
  }
  if (initialized && activeCleanup) {
    logger.debug('[UPDATER] Already initialized');
    return { cleanup: activeCleanup };
  }

  initPromise = (async () => {
    if (activeCleanup) {
      cleanupAutoUpdater();
    }

    try {
      autoUpdater.autoDownload = true;

      // Register event handlers
      const updateAvailableHandler = () => handleUpdateAvailable(getMainWindow);
      const updateNotAvailableHandler = () => handleUpdateNotAvailable(getMainWindow);
      const updateDownloadedHandler = () => handleUpdateDownloaded(getMainWindow);
      const downloadProgressHandler = (progressObj) =>
        handleUpdateProgress(progressObj, getMainWindow);
      const updateErrorHandler = (err) => handleError(err, getMainWindow);

      autoUpdater.on('error', updateErrorHandler);
      autoUpdater.on('update-available', updateAvailableHandler);
      autoUpdater.on('update-not-available', updateNotAvailableHandler);
      autoUpdater.on('update-downloaded', updateDownloadedHandler);
      // FIX HIGH-57: Add progress listener
      autoUpdater.on('download-progress', downloadProgressHandler);

      // Store cleanup function
      const cleanup = () => {
        autoUpdater.removeListener('error', updateErrorHandler);
        autoUpdater.removeListener('update-available', updateAvailableHandler);
        autoUpdater.removeListener('update-not-available', updateNotAvailableHandler);
        autoUpdater.removeListener('update-downloaded', updateDownloadedHandler);
        autoUpdater.removeListener('download-progress', downloadProgressHandler);
        logger.debug('[UPDATER] Listeners cleaned up');
      };

      activeCleanup = cleanup;

      // Check for updates (with timeout to prevent hanging on network blackholes)
      try {
        const UPDATE_CHECK_TIMEOUT_MS = 30000;
        await Promise.race([
          autoUpdater.checkForUpdatesAndNotify(),
          new Promise((_, reject) => {
            const t = setTimeout(
              () => reject(new Error('Update check timed out')),
              UPDATE_CHECK_TIMEOUT_MS
            );
            if (typeof t.unref === 'function') t.unref();
          })
        ]);
        logger.info('[UPDATER] Update check completed');
      } catch (e) {
        logger.error('[UPDATER] Update check failed:', {
          error: e.message,
          stack: e.stack
        });
      }

      return { cleanup };
    } catch (error) {
      logger.error('[UPDATER] Failed to setup auto-updater:', error);
      return { cleanup: () => {} };
    } finally {
      initPromise = null;
      initialized = true;
    }
  })();

  return initPromise;
}

/**
 * Clean up all auto-updater listeners
 */
function cleanupAutoUpdater() {
  if (!activeCleanup) return;

  try {
    activeCleanup();
  } catch (error) {
    logger.error('[UPDATER] Cleanup error:', error);
  } finally {
    activeCleanup = null;
    initialized = false;
  }
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
  quitAndInstall
};
