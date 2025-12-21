/**
 * System Tray
 *
 * System tray integration with quick actions.
 * Extracted from simple-main.js for better maintainability.
 *
 * @module core/systemTray
 */

const { app, BrowserWindow, Menu, Tray, nativeImage } = require('electron');
const path = require('path');
const { isWindows, isMacOS } = require('../../shared/platformUtils');
const { logger } = require('../../shared/logger');

logger.setContext('Tray');

const getAssetPath = (...paths) => {
  const RESOURCES_PATH = app.isPackaged
    ? path.join(process.resourcesPath, 'assets')
    : path.join(__dirname, '../../../assets');
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
      isWindows
        ? 'icons/icons/win/icon.ico'
        : isMacOS
          ? 'icons/icons/png/24x24.png'
          : 'icons/icons/png/16x16.png'
    );

    const trayIcon = nativeImage.createFromPath(iconPath);
    if (isMacOS) {
      trayIcon.setTemplateImage(true);
    }

    tray = new Tray(trayIcon);
    tray.setToolTip('StratoSort');

    // Single click on tray icon restores the window (except on macOS where it's context menu by default)
    if (!isMacOS) {
      tray.on('click', () => {
        const win = BrowserWindow.getAllWindows()[0];
        if (win) {
          if (win.isMinimized()) win.restore();
          win.show();
          win.focus();
        } else if (trayConfig.createWindow) {
          trayConfig.createWindow();
        }
      });
    }

    updateTrayMenu();
  } catch (e) {
    logger.warn('[TRAY] initialization failed', e);
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
      click: () => {
        const win = BrowserWindow.getAllWindows()[0];
        if (win) {
          if (win.isMinimized()) win.restore();
          win.show();
          win.focus();
        } else if (trayConfig.createWindow) {
          trayConfig.createWindow();
        }
      }
    },
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
  getTray
};
