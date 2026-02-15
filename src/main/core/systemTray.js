/**
 * System Tray
 *
 * System tray integration with quick actions.
 * Extracted from simple-main.js for better maintainability.
 *
 * @module core/systemTray
 */

const { app, BrowserWindow, Menu, Tray, nativeImage, globalShortcut } = require('electron');
const path = require('path');
const { isWindows, isMacOS } = require('../../shared/platformUtils');
const { IPC_EVENTS } = require('../../shared/constants');
const { createLogger } = require('../../shared/logger');
// FIX: Import safeSend for validated IPC event sending
const { safeSend } = require('../ipc/ipcWrappers');

const logger = createLogger('Tray');

// Resolve app root reliably in both dev (webpack bundles to dist/) and packaged builds.
// Avoids __dirname which points to dist/ after webpack bundling.
function _getAppRoot() {
  try {
    const appPath = app.getAppPath();
    if (appPath.endsWith('src/main') || appPath.endsWith('src\\main')) {
      return path.resolve(appPath, '../..');
    }
    return appPath;
  } catch {
    return process.cwd();
  }
}

const getAssetPath = (...paths) => {
  const RESOURCES_PATH = app.isPackaged
    ? path.join(process.resourcesPath, 'assets')
    : path.join(_getAppRoot(), 'assets');
  return path.join(RESOURCES_PATH, ...paths);
};

let tray = null;
let trayConfig = {
  getDownloadWatcher: null,
  getSettingsService: null,
  handleSettingsChanged: null,
  createWindow: null,
  setIsQuitting: null
};

// Global shortcut for semantic search
const SEARCH_SHORTCUT = isWindows ? 'Ctrl+Shift+F' : 'Cmd+Shift+F';

/**
 * Initialize tray configuration
 * @param {Object} config - Configuration object
 */
function initializeTrayConfig(config) {
  trayConfig = { ...trayConfig, ...config };
}

/**
 * Create the system tray
 */
function createSystemTray() {
  try {
    const iconPath = getAssetPath(
      isWindows ? 'icons/win/icon.ico' : isMacOS ? 'icons/png/24x24.png' : 'icons/png/16x16.png'
    );

    const trayIcon = nativeImage.createFromPath(iconPath);
    if (isMacOS) {
      trayIcon.setTemplateImage(true);
    }

    tray = new Tray(trayIcon);
    tray.setToolTip('StratoSort');

    // Single click on tray icon restores the window (except on macOS where it's context menu by default)
    if (!isMacOS) {
      tray.on('click', async () => {
        const win = BrowserWindow.getAllWindows()[0];
        if (win) {
          if (win.isMinimized()) win.restore();
          win.show();
          win.focus();
        } else if (trayConfig.createWindow) {
          await trayConfig.createWindow();
        }
      });
    }

    updateTrayMenu();
  } catch (e) {
    logger.warn('[TRAY] initialization failed', e);
  }
}

/**
 * Open or show the main window and trigger semantic search
 */
async function openSemanticSearch() {
  let win = BrowserWindow.getAllWindows()[0];

  if (!win) {
    // Create window if it doesn't exist
    // FIX: createWindow() returns a Promise, so we must await it
    // before trying to use the window reference
    if (trayConfig.createWindow) {
      await trayConfig.createWindow();
      win = BrowserWindow.getAllWindows()[0];
    }
  }

  if (win) {
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();

    // Send message to renderer to open semantic search
    // Small delay to ensure window is ready
    // FIX: Use safeSend for validated IPC event sending
    // FIX: Store timer ID and clear on window close to prevent stale callback
    const searchTimerId = setTimeout(() => {
      if (!win.isDestroyed()) {
        safeSend(win.webContents, IPC_EVENTS.OPEN_SEMANTIC_SEARCH);
      }
    }, 100);
    win.once('closed', () => clearTimeout(searchTimerId));
  }
}

/**
 * Register global keyboard shortcut for semantic search
 */
function registerGlobalShortcut() {
  try {
    const success = globalShortcut.register(SEARCH_SHORTCUT, () => {
      logger.info(`[TRAY] Global shortcut ${SEARCH_SHORTCUT} triggered`);
      openSemanticSearch();
    });

    if (success) {
      logger.info(`[TRAY] Registered global shortcut: ${SEARCH_SHORTCUT}`);
      // FIX CRIT-27: Ensure global shortcuts are unregistered on app quit/crash.
      // Use a dedicated flag instead of listenerCount (which includes unrelated listeners).
      if (!registerGlobalShortcut._willQuitRegistered) {
        app.on('will-quit', unregisterGlobalShortcuts);
        registerGlobalShortcut._willQuitRegistered = true;
      }
    } else {
      logger.warn(`[TRAY] Failed to register global shortcut: ${SEARCH_SHORTCUT}`);
    }
  } catch (error) {
    logger.warn('[TRAY] Error registering global shortcut:', error.message);
  }
}

/**
 * Unregister global shortcuts
 */
function unregisterGlobalShortcuts() {
  try {
    globalShortcut.unregisterAll();
    logger.info('[TRAY] Unregistered all global shortcuts');
  } catch (error) {
    logger.warn('[TRAY] Error unregistering shortcuts:', error.message);
  }
}

/**
 * Update the tray context menu
 */
function updateTrayMenu() {
  if (!tray) return;

  const downloadWatcher = trayConfig.getDownloadWatcher?.();

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Open StratoSort',
      click: async () => {
        const win = BrowserWindow.getAllWindows()[0];
        if (win) {
          if (win.isMinimized()) win.restore();
          win.show();
          win.focus();
        } else if (trayConfig.createWindow) {
          await trayConfig.createWindow();
        }
      }
    },
    { type: 'separator' },
    {
      label: `Semantic Search (${SEARCH_SHORTCUT})`,
      click: openSemanticSearch
    },
    { type: 'separator' },
    {
      label: downloadWatcher ? 'Pause Auto-Sort' : 'Resume Auto-Sort',
      click: async () => {
        const enable = !downloadWatcher;
        try {
          const settingsService = trayConfig.getSettingsService?.();
          if (settingsService) {
            const merged = await settingsService.save({
              autoOrganize: enable
            });
            trayConfig.handleSettingsChanged?.(merged);
          } else {
            trayConfig.handleSettingsChanged?.({ autoOrganize: enable });
          }
        } catch (err) {
          logger.warn('[TRAY] Failed to toggle auto-sort:', err.message);
        }
        updateTrayMenu();
      }
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        trayConfig.setIsQuitting?.(true);
        app.quit();
      }
    }
  ]);

  tray.setContextMenu(contextMenu);
}

/**
 * Destroy the system tray
 */
function destroyTray() {
  if (tray) {
    try {
      tray.destroy();
      tray = null;
      logger.info('[CLEANUP] System tray destroyed');
    } catch (error) {
      logger.error('[CLEANUP] Failed to destroy tray:', error);
    }
  }
}

/**
 * Get the tray instance
 * @returns {Tray|null}
 */
function getTray() {
  return tray;
}

module.exports = {
  initializeTrayConfig,
  createSystemTray,
  updateTrayMenu,
  destroyTray,
  getTray,
  registerGlobalShortcut,
  unregisterGlobalShortcuts,
  openSemanticSearch,
  SEARCH_SHORTCUT
};
