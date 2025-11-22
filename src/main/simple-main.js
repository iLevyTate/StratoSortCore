const {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  shell,
  Menu,
  Tray,
  nativeImage,
} = require('electron');
const { autoUpdater } = require('electron-updater');
const isDev = process.env.NODE_ENV === 'development';

// Logging utility
const { logger } = require('../shared/logger');
logger.setContext('Main');

// Import error handling system (not needed directly in this file)

const { scanDirectory } = require('./folderScanner');
const {
  getOllama,
  getOllamaModel,
  getOllamaVisionModel,
  getOllamaEmbeddingModel,
  getOllamaHost,
  setOllamaModel,
  setOllamaVisionModel,
  setOllamaEmbeddingModel,
  setOllamaHost,
  loadOllamaConfig,
} = require('./ollamaUtils');
const { buildOllamaOptions } = require('./services/PerformanceService');
const {
  getService: getSettingsService,
} = require('./services/SettingsService');
const DownloadWatcher = require('./services/DownloadWatcher');

// Import service integration
const ServiceIntegration = require('./services/ServiceIntegration');

// Import startup manager
const { getStartupManager } = require('./services/StartupManager');

// Import shared constants
const { IPC_CHANNELS } = require('../shared/constants');

// Import services
const { analyzeDocumentFile } = require('./analysis/ollamaDocumentAnalysis');
const { analyzeImageFile } = require('./analysis/ollamaImageAnalysis');

// Import OCR library
const tesseract = require('node-tesseract-ocr');
const fs = require('fs').promises;
const path = require('path');

let mainWindow;
let customFolders = []; // Initialize customFolders at module level

// Initialize service integration
let serviceIntegration;
let settingsService;
let downloadWatcher;
let currentSettings = {};
let isQuitting = false;
let chromaDbProcess = null;

// Track cleanup handlers for proper memory management
let metricsInterval = null;
let eventListeners = [];
let childProcessListeners = [];
let globalProcessListeners = [];

// Legacy functions removed: ensureChromaDbRunning, ensureOllamaRunning
// All startup logic is now handled by StartupManager and ServiceIntegration

/**
 * Verify that all critical IPC handlers are registered
 * This prevents race conditions where the renderer might try to call
 * IPC methods before handlers are fully registered
 * Uses exponential backoff retry logic with timeout protection
 * @returns {Promise<boolean>} true if all handlers are registered, false otherwise
 */
async function verifyIpcHandlersRegistered() {
  // Define all critical IPC channels that must be registered before window creation
  const requiredHandlers = [
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
    'test-ollama-connection',

    // Window controls (if on Windows)
    ...(process.platform === 'win32'
      ? [
          'window-minimize',
          'window-maximize',
          'window-toggle-maximize',
          'window-is-maximized',
          'window-close',
        ]
      : []),
  ];

  const maxRetries = 10;
  const maxTimeout = 2000; // Reduced to 2 seconds to prevent startup hang
  const initialDelay = 50; // Start with 50ms
  const maxDelay = 500; // Cap at 500ms
  const startTime = Date.now();

  /**
   * Check if all handlers are registered
   * @returns {{allRegistered: boolean, missing: string[]}}
   */
  const hasInvokeHandler = (channel) => {
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
  };

  const checkHandlers = () => {
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
          })`,
        );
      }
    }
    return {
      allRegistered: missing.length === 0,
      missing,
    };
  };

  // Initial check
  let checkResult = checkHandlers();
  if (checkResult.allRegistered) {
    logger.info(
      `[IPC-VERIFY] ✅ Verified ${requiredHandlers.length} critical handlers are registered`,
    );
    return true;
  }

  logger.warn(
    `[IPC-VERIFY] ⚠️ Missing ${checkResult.missing.length} handlers: ${checkResult.missing.join(', ')}`,
  );
  logger.info(`[IPC-VERIFY] Starting retry logic with exponential backoff...`);

  // Retry with exponential backoff
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    // Check timeout
    const elapsed = Date.now() - startTime;
    if (elapsed >= maxTimeout) {
      logger.error(
        `[IPC-VERIFY] ❌ Timeout after ${elapsed}ms. Still missing ${checkResult.missing.length} handlers: ${checkResult.missing.join(', ')}`,
      );
      return false;
    }

    // Calculate delay with exponential backoff
    const delay = Math.min(initialDelay * Math.pow(2, attempt), maxDelay);

    // Wait before retry
    await new Promise((resolve) => setTimeout(resolve, delay));

    // Re-check handlers
    checkResult = checkHandlers();

    if (checkResult.allRegistered) {
      const totalTime = Date.now() - startTime;
      logger.info(
        `[IPC-VERIFY] ✅ All handlers registered after ${attempt + 1} attempt(s) in ${totalTime}ms`,
      );
      return true;
    }

    // Log progress every 2 attempts
    if (attempt % 2 === 1) {
      logger.debug(
        `[IPC-VERIFY] Attempt ${attempt + 1}/${maxRetries}: Still missing ${checkResult.missing.length} handlers`,
      );
    }
  }

  // Final check after all retries
  checkResult = checkHandlers();
  if (checkResult.allRegistered) {
    logger.info(`[IPC-VERIFY] ✅ All handlers registered after retries`);
    return true;
  }

  logger.error(
    `[IPC-VERIFY] ❌ Failed to register all handlers after ${maxRetries} attempts. Missing: ${checkResult.missing.join(', ')}`,
  );
  return false;
}

// ===== GPU PREFERENCES (Windows rendering stability) =====
const forceSoftwareRenderer =
  process.env.STRATOSORT_FORCE_SOFTWARE_GPU === '1' ||
  process.env.ELECTRON_FORCE_SOFTWARE === '1';

try {
  if (forceSoftwareRenderer) {
    app.disableHardwareAcceleration();
    logger.warn(
      '[GPU] Hardware acceleration disabled via STRATOSORT_FORCE_SOFTWARE_GPU',
    );
  } else {
    // Use ANGLE with D3D11 backend for better Windows compatibility
    const angleBackend = process.env.ANGLE_BACKEND || 'd3d11'; // d3d11 is most stable on Windows
    app.commandLine.appendSwitch('use-angle', angleBackend);

    // Only set use-gl if explicitly requested, otherwise let Electron/Chromium choose
    const glImplementation = process.env.STRATOSORT_GL_IMPLEMENTATION;
    if (glImplementation) {
      app.commandLine.appendSwitch('use-gl', glImplementation);
      logger.info(`[GPU] Custom GL implementation set: ${glImplementation}`);
    }

    // Safer GPU settings - remove conflicting switches
    app.commandLine.appendSwitch('ignore-gpu-blocklist');

    logger.info(`[GPU] Flags set: ANGLE=${angleBackend}`);
  }
} catch (e) {
  logger.warn(
    '[GPU] Failed to apply GPU flags:',
    e?.message || 'Unknown error',
  );
}

// MEDIUM PRIORITY FIX (MED-2): Time-based sliding window for GPU failure tracking
let gpuFailureCount = 0;
let lastGpuFailureTime = 0;
const GPU_FAILURE_RESET_WINDOW = 60 * 60 * 1000; // Reset counter after 1 hour of stability

const gpuProcessHandler = (event, details) => {
  if (details?.type === 'GPU') {
    const now = Date.now();

    // Reset counter if last failure was more than 1 hour ago
    if (now - lastGpuFailureTime > GPU_FAILURE_RESET_WINDOW) {
      gpuFailureCount = 0;
      logger.debug('[GPU] Failure counter reset after stability window');
    }

    gpuFailureCount += 1;
    lastGpuFailureTime = now;

    logger.error('[GPU] Process exited', {
      reason: details?.reason,
      exitCode: details?.exitCode,
      crashCount: gpuFailureCount,
      lastFailure: new Date(lastGpuFailureTime).toISOString(),
    });

    if (
      gpuFailureCount >= 2 &&
      process.env.STRATOSORT_FORCE_SOFTWARE_GPU !== '1'
    ) {
      logger.warn(
        '[GPU] Repeated GPU failures detected. Set STRATOSORT_FORCE_SOFTWARE_GPU=1 to force software rendering.',
      );
    }
  }
};
app.on('child-process-gone', gpuProcessHandler);

// Track for cleanup
eventListeners.push(() =>
  app.removeListener('child-process-gone', gpuProcessHandler),
);

// Custom folders helpers
const {
  loadCustomFolders,
  saveCustomFolders,
} = require('./core/customFolders');

// System monitoring and analytics
const systemAnalytics = require('./core/systemAnalytics');

// Window creation
const createMainWindow = require('./core/createWindow');

// Create themed application menu
function createApplicationMenu() {
  const template = [
    {
      label: 'File',
      submenu: [
        {
          label: 'Select Files',
          accelerator: 'CmdOrCtrl+O',
          click: () => {
            if (mainWindow) {
              mainWindow.webContents.send('menu-action', 'select-files');
            }
          },
        },
        {
          label: 'Select Folder',
          accelerator: 'CmdOrCtrl+Shift+O',
          click: () => {
            if (mainWindow) {
              mainWindow.webContents.send('menu-action', 'select-folder');
            }
          },
        },
        { type: 'separator' },
        {
          label: 'Settings',
          accelerator: 'CmdOrCtrl+,',
          click: () => {
            if (mainWindow) {
              mainWindow.webContents.send('menu-action', 'open-settings');
            }
          },
        },
        { type: 'separator' },
        {
          label: 'Exit',
          accelerator: process.platform === 'darwin' ? 'Cmd+Q' : 'Ctrl+Q',
          click: () => {
            app.quit();
          },
        },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { label: 'Undo', accelerator: 'CmdOrCtrl+Z', role: 'undo' },
        { label: 'Redo', accelerator: 'CmdOrCtrl+Y', role: 'redo' },
        { type: 'separator' },
        { label: 'Cut', accelerator: 'CmdOrCtrl+X', role: 'cut' },
        { label: 'Copy', accelerator: 'CmdOrCtrl+C', role: 'copy' },
        { label: 'Paste', accelerator: 'CmdOrCtrl+V', role: 'paste' },
        { label: 'Select All', accelerator: 'CmdOrCtrl+A', role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { label: 'Reload', accelerator: 'CmdOrCtrl+R', role: 'reload' },
        {
          label: 'Force Reload',
          accelerator: 'CmdOrCtrl+Shift+R',
          role: 'forceReload',
        },
        { type: 'separator' },
        {
          label: 'Toggle Fullscreen',
          accelerator: 'F11',
          role: 'togglefullscreen',
        },
        ...(isDev
          ? [
              { type: 'separator' },
              {
                label: 'Toggle Developer Tools',
                accelerator: 'F12',
                role: 'toggleDevTools',
              },
            ]
          : []),
      ],
    },
    {
      label: 'Window',
      submenu: [
        { label: 'Minimize', accelerator: 'CmdOrCtrl+M', role: 'minimize' },
        { label: 'Close', accelerator: 'CmdOrCtrl+W', role: 'close' },
      ],
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'About StratoSort',
          click: () => {
            if (mainWindow) {
              mainWindow.webContents.send('menu-action', 'show-about');
            }
          },
        },
        { type: 'separator' },
        {
          label: 'Documentation',
          click: () => {
            shell.openExternal('https://github.com');
          },
        },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

function createWindow() {
  logger.debug('[DEBUG] createWindow() called');
  if (mainWindow && !mainWindow.isDestroyed()) {
    logger.debug('[DEBUG] Window already exists, restoring state...');

    // Prevent dangling pointer issues by deferring state changes
    // Use setImmediate to ensure Chromium's message loop is ready
    setImmediate(() => {
      if (!mainWindow || mainWindow.isDestroyed()) return;

      try {
        // Window state machine: Handle states in proper order
        // State priority: fullscreen > minimized > maximized > hidden > normal

        // 1. Fullscreen state - preserve and focus
        if (mainWindow.isFullScreen()) {
          logger.debug('[WINDOW] Window is fullscreen, focusing');
          mainWindow.focus();
          return;
        }

        // 2. Minimized state - must restore before showing
        // restore() brings window back from taskbar/dock and makes it visible
        if (mainWindow.isMinimized()) {
          logger.debug('[WINDOW] Window is minimized, restoring...');

          // Defer restore to next tick to avoid Chromium message pump issues
          setTimeout(() => {
            if (!mainWindow || mainWindow.isDestroyed()) return;

            mainWindow.restore();

            // Give Chromium time to process the restore
            setTimeout(() => {
              if (!mainWindow || mainWindow.isDestroyed()) return;

              // restore() should make window visible, but verify
              if (!mainWindow.isVisible()) {
                logger.debug(
                  '[WINDOW] Window still not visible after restore, showing...',
                );
                mainWindow.show();
              }

              // After restore, window might be maximized, so check that next
              if (mainWindow.isMaximized()) {
                logger.debug('[WINDOW] Window is maximized after restore');
              }

              mainWindow.focus();
            }, 50);
          }, 0);
          return;
        }

        // 3. Maximized state (but not minimized) - show if hidden, preserve maximized
        if (mainWindow.isMaximized()) {
          logger.debug('[WINDOW] Window is maximized');
          if (!mainWindow.isVisible()) {
            logger.debug('[WINDOW] Maximized window is hidden, showing it');
            mainWindow.show();
          }
          mainWindow.focus();
          return;
        }

        // 4. Hidden state (not minimized, not maximized) - just show
        if (!mainWindow.isVisible()) {
          logger.debug('[WINDOW] Window is hidden, showing it');
          mainWindow.show();
          mainWindow.focus();
          return;
        }

        // 5. Normal visible state - just focus
        logger.debug('[WINDOW] Window is visible, focusing');
        mainWindow.focus();
      } catch (error) {
        logger.error('[WINDOW] Error during window state restoration:', error);
      }
    });

    // 6. Ensure window is on screen (handle multi-monitor issues)
    // Only check if window is actually visible and not minimized
    if (mainWindow.isVisible() && !mainWindow.isMinimized()) {
      try {
        const bounds = mainWindow.getBounds();
        const { screen } = require('electron');
        const displays = screen.getAllDisplays();

        // Check if window center is visible on any display
        const windowCenter = {
          x: bounds.x + bounds.width / 2,
          y: bounds.y + bounds.height / 2,
        };

        const isOnScreen = displays.some((display) => {
          const { x, y, width, height } = display.bounds;
          return (
            windowCenter.x >= x &&
            windowCenter.x <= x + width &&
            windowCenter.y >= y &&
            windowCenter.y <= y + height
          );
        });

        if (!isOnScreen) {
          logger.warn(
            '[WINDOW] Window was off-screen, centering on primary display',
          );
          mainWindow.center();
        }
      } catch (error) {
        logger.debug('[WINDOW] Could not check screen bounds:', error.message);
      }
    }

    // 7. On Windows, force window to foreground after state restoration
    if (process.platform === 'win32' && mainWindow.isVisible()) {
      // Use setAlwaysOnTop trick to bring window to front
      mainWindow.setAlwaysOnTop(true);
      setTimeout(() => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.setAlwaysOnTop(false);
        }
      }, 100);
    }

    return;
  }

  // No existing window, create a new one
  mainWindow = createMainWindow();

  // Store event handlers for proper cleanup
  const windowEventHandlers = new Map();

  // Add state change event listeners for debugging
  const minimizeHandler = () => {
    logger.debug('[WINDOW] Window minimized');
  };
  windowEventHandlers.set('minimize', minimizeHandler);
  mainWindow.on('minimize', minimizeHandler);

  const restoreHandler = () => {
    logger.debug('[WINDOW] Window restored');
  };
  windowEventHandlers.set('restore', restoreHandler);
  mainWindow.on('restore', restoreHandler);

  const showHandler = () => {
    logger.debug('[WINDOW] Window shown');
  };
  windowEventHandlers.set('show', showHandler);
  mainWindow.on('show', showHandler);

  const hideHandler = () => {
    logger.debug('[WINDOW] Window hidden');
  };
  windowEventHandlers.set('hide', hideHandler);
  mainWindow.on('hide', hideHandler);

  const focusHandler = () => {
    logger.debug('[WINDOW] Window focused');
  };
  windowEventHandlers.set('focus', focusHandler);
  mainWindow.on('focus', focusHandler);

  const blurHandler = () => {
    logger.debug('[WINDOW] Window lost focus');
  };
  windowEventHandlers.set('blur', blurHandler);
  mainWindow.on('blur', blurHandler);

  const closeHandler = (e) => {
    if (!isQuitting && currentSettings?.backgroundMode) {
      e.preventDefault();
      mainWindow.hide();
    }
  };
  windowEventHandlers.set('close', closeHandler);
  mainWindow.on('close', closeHandler);

  const closedHandler = () => {
    // CRITICAL FIX: Enhanced cleanup with proper error handling and null checks
    if (windowEventHandlers.size > 0) {
      for (const [event, handler] of windowEventHandlers) {
        try {
          // Check if window still exists and is not destroyed before removing listener
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.removeListener(event, handler);
          }
        } catch (e) {
          logger.error(`[WINDOW] Failed to remove ${event} listener:`, e);
        }
      }
      windowEventHandlers.clear();
    }
    mainWindow = null;
  };
  windowEventHandlers.set('closed', closedHandler);
  mainWindow.on('closed', closedHandler);

  // CRITICAL FIX: Also register cleanup on 'destroy' event to catch cases where window
  // is destroyed without triggering 'closed' event
  const destroyHandler = () => {
    logger.warn('[WINDOW] Window destroyed - forcing cleanup');
    closedHandler();
  };
  mainWindow.once('destroy', destroyHandler);

  // Register global cleanup to ensure listeners are removed on app quit
  // even if window is hidden (background mode)
  eventListeners.push(() => {
    if (windowEventHandlers.size > 0) {
      logger.debug('[CLEANUP] Forcing window listener cleanup on app quit');
      closedHandler();
    }
  });
}

function updateDownloadWatcher(settings) {
  const enabled = settings?.autoOrganize;
  if (enabled) {
    if (!downloadWatcher) {
      downloadWatcher = new DownloadWatcher({
        analyzeDocumentFile,
        analyzeImageFile,
        getCustomFolders: () => customFolders,
        autoOrganizeService: serviceIntegration?.autoOrganizeService,
        settingsService: settingsService,
      });
      downloadWatcher.start();
    }
  } else if (downloadWatcher) {
    downloadWatcher.stop();
    downloadWatcher = null;
  }
}

function handleSettingsChanged(settings) {
  // MEDIUM PRIORITY FIX (MED-1): Validate settings structure before use
  if (!settings || typeof settings !== 'object') {
    logger.warn('[SETTINGS] Invalid settings received, using defaults');
    currentSettings = {};
    return;
  }

  currentSettings = settings;
  updateDownloadWatcher(settings);
  try {
    updateTrayMenu();
  } catch (error) {
    logger.warn('[SETTINGS] Failed to update tray menu:', error);
  }
}

// ===== IPC HANDLERS =====
const { registerAllIpc } = require('./ipc');

// Prevent multiple instances
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  const secondInstanceHandler = () => {
    // Someone tried to run a second instance, restore and focus our window
    if (mainWindow && !mainWindow.isDestroyed()) {
      logger.debug(
        '[SECOND-INSTANCE] Restoring window for second instance attempt',
      );

      // Handle fullscreen state
      if (mainWindow.isFullScreen()) {
        mainWindow.focus();
        return;
      }

      // Handle maximized state
      if (mainWindow.isMaximized()) {
        if (!mainWindow.isVisible()) mainWindow.show();
        mainWindow.focus();
        return;
      }

      // Restore if minimized
      if (mainWindow.isMinimized()) {
        mainWindow.restore();
      }

      // Show if hidden
      if (!mainWindow.isVisible()) {
        mainWindow.show();
      }

      // Focus and bring to front
      mainWindow.focus();

      // Windows-specific foreground forcing
      if (process.platform === 'win32') {
        mainWindow.setAlwaysOnTop(true);
        mainWindow.setAlwaysOnTop(false);
      }
    } else {
      // No window exists, create one
      createWindow();
    }
  };
  app.on('second-instance', secondInstanceHandler);

  // Track for cleanup
  eventListeners.push(() =>
    app.removeListener('second-instance', secondInstanceHandler),
  );

  // Production optimizations - ensure GPU acceleration
  if (!isDev) {
    // Production GPU optimizations - minimal set to avoid conflicts
    if (!forceSoftwareRenderer) {
      app.commandLine.appendSwitch('enable-gpu-rasterization');
      app.commandLine.appendSwitch('enable-zero-copy');
    }

    logger.info('[PRODUCTION] GPU acceleration optimizations enabled');
  } else {
    // Even in dev, prefer GPU acceleration where possible
    if (!forceSoftwareRenderer) {
      app.commandLine.appendSwitch('enable-gpu-rasterization');
      app.commandLine.appendSwitch('enable-zero-copy');
    }
    logger.info('[DEVELOPMENT] GPU acceleration flags enabled for development');
  }
} // End of else block for single instance lock

// Initialize services after app is ready
app.whenReady().then(async () => {
  try {
    // Get the startup manager instance
    const startupManager = getStartupManager();

    // Check for first run moved to background task after window creation
    // to prevent blocking startup

    // Run the new startup manager sequence with timeout
    let startupResult;
    try {
      // Add a hard timeout to prevent hanging
      const { TIMEOUTS } = require('../shared/performanceConstants');
      const startupPromise = startupManager.startup();
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => {
          reject(new Error('Startup manager timeout after 30 seconds'));
        }, TIMEOUTS.SERVICE_STARTUP); // 30 second hard timeout
      });

      startupResult = await Promise.race([startupPromise, timeoutPromise]);
      logger.info('[STARTUP] Startup manager completed successfully');
    } catch (error) {
      // Log full error details for debugging
      logger.error('[STARTUP] Startup manager failed:', {
        message: error?.message || 'Unknown error',
        stack: error?.stack,
        error: error,
      });
      // Continue in degraded mode - don't block startup
      logger.warn('[STARTUP] Continuing startup in degraded mode');
      startupResult = { degraded: true, error: error.message };
    }

    // Load custom folders
    // MEDIUM PRIORITY FIX (MED-3): Validate custom folders structure
    try {
      const loadedFolders = await loadCustomFolders();

      // Validate loaded data
      if (!Array.isArray(loadedFolders)) {
        logger.warn(
          '[STARTUP] Invalid custom folders data (not an array), using empty array',
        );
        customFolders = [];
      } else {
        // Filter out invalid folder entries
        customFolders = loadedFolders.filter((folder) => {
          if (!folder || typeof folder !== 'object') {
            logger.warn(
              '[STARTUP] Skipping invalid folder entry (not an object)',
            );
            return false;
          }
          if (!folder.id || typeof folder.id !== 'string') {
            logger.warn('[STARTUP] Skipping folder without valid id:', folder);
            return false;
          }
          if (!folder.name || typeof folder.name !== 'string') {
            logger.warn(
              '[STARTUP] Skipping folder without valid name:',
              folder,
            );
            return false;
          }
          if (!folder.path || typeof folder.path !== 'string') {
            logger.warn(
              '[STARTUP] Skipping folder without valid path:',
              folder,
            );
            return false;
          }
          return true;
        });

        if (customFolders.length !== loadedFolders.length) {
          logger.warn(
            `[STARTUP] Filtered out ${loadedFolders.length - customFolders.length} invalid folder entries`,
          );
        }
      }

      logger.info(
        '[STARTUP] Loaded custom folders:',
        customFolders.length,
        'folders',
      );
    } catch (error) {
      logger.error('[STARTUP] Failed to load custom folders:', error.message);
      customFolders = [];
    }

    // Ensure default "Uncategorized" folder exists
    // CRITICAL FIX: Add null checks with optional chaining to prevent NULL dereference
    const hasDefaultFolder =
      customFolders?.some(
        (f) => f?.isDefault || f?.name?.toLowerCase() === 'uncategorized',
      ) ?? false;

    if (!hasDefaultFolder) {
      const documentsDir = app.getPath('documents');
      if (!documentsDir || typeof documentsDir !== 'string') {
        throw new Error('Failed to get documents directory path');
      }
      const defaultFolderPath = path.join(
        documentsDir,
        'StratoSort',
        'Uncategorized',
      );

      try {
        // Create directory if it doesn't exist
        await fs.mkdir(defaultFolderPath, { recursive: true });

        // Verify directory was created successfully
        const stats = await fs.stat(defaultFolderPath);
        if (!stats.isDirectory()) {
          throw new Error('Default folder path exists but is not a directory');
        }

        const defaultFolder = {
          id: 'default-uncategorized-' + Date.now(),
          name: 'Uncategorized',
          path: defaultFolderPath,
          description: "Default folder for files that don't match any category",
          keywords: [],
          isDefault: true,
          createdAt: new Date().toISOString(),
        };

        customFolders.push(defaultFolder);
        await saveCustomFolders(customFolders);

        // Verify folder was persisted
        const reloadedFolders = await loadCustomFolders();
        const persistedDefault = reloadedFolders.find(
          (f) => f.isDefault || f.name.toLowerCase() === 'uncategorized',
        );

        if (!persistedDefault) {
          logger.error(
            '[STARTUP] Default folder created but failed to persist',
          );
        } else {
          logger.info(
            '[STARTUP] Created and verified default Uncategorized folder at:',
            defaultFolderPath,
          );
        }
      } catch (error) {
        logger.error('[STARTUP] Failed to create default folder:', error);
        // This is critical - app should not proceed without default folder
        throw new Error(
          `Failed to create default Uncategorized folder: ${error.message}`,
        );
      }
    } else {
      logger.info('[STARTUP] Default folder already exists, skipping creation');
    }

    // Initialize service integration
    serviceIntegration = new ServiceIntegration();
    await serviceIntegration.initialize();
    logger.info('[MAIN] Service integration initialized successfully');

    // Initialize settings service
    settingsService = getSettingsService();
    const initialSettings = await settingsService.load();

    // Resume any incomplete organize batches (best-effort)
    try {
      const incompleteBatches =
        serviceIntegration?.processingState?.getIncompleteOrganizeBatches?.() ||
        [];
      if (incompleteBatches.length > 0) {
        logger.warn(
          `[RESUME] Found ${incompleteBatches.length} incomplete organize batch(es). They will resume when a new organize request starts.`,
        );
      }
    } catch (resumeErr) {
      logger.warn(
        '[RESUME] Failed to check incomplete batches:',
        resumeErr.message,
      );
    }

    // Verify AI models on startup (only if Ollama is running)
    if (startupResult?.services?.ollama?.success) {
      const ModelVerifier = require('./services/ModelVerifier');
      const modelVerifier = new ModelVerifier();
      const modelStatus = await modelVerifier.verifyEssentialModels();

      if (!modelStatus.success) {
        logger.warn(
          '[STARTUP] Missing AI models detected:',
          modelStatus.missingModels,
        );
        logger.info('[STARTUP] Install missing models:');
        modelStatus.installationCommands.forEach((cmd) =>
          logger.info('  ', cmd),
        );
      } else {
        logger.info('[STARTUP] ✅ All essential AI models verified and ready');
        if (modelStatus.hasWhisper) {
          logger.info(
            '[STARTUP] ✅ Whisper model available for audio analysis',
          );
        }
      }
    }

    // Register IPC groups now that services and state are ready
    const getMainWindow = () => mainWindow;
    const getServiceIntegration = () => serviceIntegration;
    const getCustomFolders = () => customFolders;
    const setCustomFolders = (folders) => {
      customFolders = folders;
    };

    // Grouped IPC registration (single entry)
    registerAllIpc({
      ipcMain,
      IPC_CHANNELS,
      logger,
      dialog,
      shell,
      systemAnalytics,
      getMainWindow,
      getServiceIntegration,
      getCustomFolders,
      setCustomFolders,
      saveCustomFolders,
      analyzeDocumentFile,
      analyzeImageFile,
      tesseract,
      getOllama,
      getOllamaModel,
      getOllamaVisionModel,
      getOllamaEmbeddingModel,
      getOllamaHost,
      buildOllamaOptions,
      scanDirectory,
      settingsService,
      setOllamaHost,
      setOllamaModel,
      setOllamaVisionModel,
      setOllamaEmbeddingModel,
      onSettingsChanged: handleSettingsChanged,
    });

    // Create application menu with theme
    createApplicationMenu();

    // Register IPC event listeners (not handlers) for renderer-to-main communication
    ipcMain.on('renderer-error-report', (event, errorData) => {
      try {
        logger.error('[RENDERER ERROR]', {
          message: errorData?.message || 'Unknown error',
          stack: errorData?.stack,
          componentStack: errorData?.componentStack,
          type: errorData?.type || 'unknown',
          timestamp: errorData?.timestamp || new Date().toISOString(),
        });
      } catch (err) {
        logger.error('[RENDERER ERROR] Failed to process error report:', err);
      }
    });

    // HIGH PRIORITY FIX (HIGH-1): Removed unreliable setImmediate delay
    // The verifyIpcHandlersRegistered() function has robust retry logic with
    // exponential backoff and timeout, so no pre-delay is needed

    // VERIFY all critical IPC handlers are registered before creating the window
    // This prevents race conditions where the renderer tries to call IPC methods before they're ready
    logger.info('[STARTUP] Verifying IPC handlers are registered...');
    const handlersReady = await verifyIpcHandlersRegistered();

    if (!handlersReady) {
      logger.error(
        '[STARTUP] ⚠️ CRITICAL: Some IPC handlers not registered after verification timeout',
      );
      logger.error(
        '[STARTUP] App may not function correctly. Consider increasing timeout or checking handler registration logic.',
      );
      // Don't throw - allow app to start in degraded mode
      // The handlers may register later or may be optional
      // This prevents complete app failure, but user will see errors for missing functionality
    } else {
      logger.info('[STARTUP] ✅ All critical IPC handlers verified and ready');
    }

    createWindow();
    handleSettingsChanged(initialSettings);

    // Run first-time setup in background (non-blocking)
    (async () => {
      try {
        const setupMarker = path.join(
          app.getPath('userData'),
          'ollama-setup-complete.marker',
        );
        let isFirstRun = false;
        try {
          await fs.access(setupMarker);
        } catch {
          isFirstRun = true;
        }

        if (isFirstRun) {
          logger.info(
            '[STARTUP] First run detected - will check Ollama setup (background)',
          );

          // Check if installation marker exists (from installer)
          const installerMarker = path.join(
            app.getPath('exe'),
            '..',
            'first-run.marker',
          );
          try {
            await fs.access(installerMarker);
            try {
              await fs.unlink(installerMarker);
            } catch (e) {
              logger.debug(
                '[STARTUP] Could not remove installer marker:',
                e.message,
              );
            }
          } catch {
            // Installer marker doesn't exist, no action needed
          }

          // Run Ollama setup check
          const setupScript = path.join(__dirname, '../../setup-ollama.js');
          try {
            await fs.access(setupScript);
            const {
              isOllamaInstalled,
              getInstalledModels,
              installEssentialModels,
            } = require(setupScript);

            // Check if Ollama is installed and has models
            if (await isOllamaInstalled()) {
              const models = await getInstalledModels();
              if (models.length === 0) {
                logger.info(
                  '[STARTUP] No AI models found, installing essential models...',
                );

                // Notify UI about model installation
                const win = BrowserWindow.getAllWindows()[0];
                if (win) {
                  win.webContents.send('operation-progress', {
                    type: 'info',
                    message: 'Installing AI models in background...',
                  });
                }

                try {
                  await installEssentialModels();
                  logger.info('[STARTUP] AI models installed successfully');
                  if (win) {
                    win.webContents.send('operation-progress', {
                      type: 'success',
                      message: 'AI models installed successfully',
                    });
                  }
                } catch (e) {
                  logger.warn(
                    '[STARTUP] Could not install AI models automatically:',
                    e.message,
                  );
                }
              }
            } else {
              logger.warn(
                '[STARTUP] Ollama not installed - AI features will be limited',
              );
            }
          } catch (err) {
            logger.warn('[STARTUP] Setup script error:', err.message);
          }

          // Mark setup as complete
          try {
            await fs.writeFile(setupMarker, new Date().toISOString());
          } catch (e) {
            logger.debug('[STARTUP] Could not create setup marker:', e.message);
          }
        }
      } catch (error) {
        logger.error('[STARTUP] Background setup failed:', error);
      }
    })();

    // Start periodic system metrics broadcast to renderer
    try {
      // Clear any existing interval before creating a new one
      if (metricsInterval) {
        clearInterval(metricsInterval);
        metricsInterval = null;
      }

      // PERFORMANCE FIX: Increased interval from 10s to 30s to reduce overhead
      // Renderer component polls directly, so main process doesn't need to poll as frequently
      metricsInterval = setInterval(async () => {
        try {
          const win = BrowserWindow.getAllWindows()[0];
          if (!win || win.isDestroyed()) return;
          const metrics = await systemAnalytics.collectMetrics();
          win.webContents.send('system-metrics', metrics);
        } catch (error) {
          logger.error('[METRICS] Failed to collect or send metrics:', error);
        }
      }, 30000); // Increased from 10000ms to 30000ms (30 seconds)
      try {
        metricsInterval.unref();
      } catch (error) {
        logger.warn('[METRICS] Failed to unref interval:', error.message);
      }
    } catch (error) {
      logger.error('[METRICS] Failed to start metrics interval:', error);
    }

    // Create system tray with quick actions
    try {
      createSystemTray();
    } catch (e) {
      logger.warn('[TRAY] Failed to initialize tray:', e.message);
    }

    // Handle app command-line tasks (Windows Jump List)
    try {
      const args = process.argv.slice(1);
      if (args.includes('--open-documents')) {
        try {
          const docs = app.getPath('documents');
          shell.openPath(docs);
        } catch (error) {
          logger.error('[JUMP-LIST] Failed to open documents folder:', error);
        }
      }
      if (args.includes('--analyze-folder')) {
        // Bring window to front and trigger select directory
        const win = BrowserWindow.getAllWindows()[0];
        if (win) {
          win.focus();
          try {
            win.webContents.send('operation-progress', {
              type: 'hint',
              message: 'Use Select Directory to analyze a folder',
            });
          } catch (error) {
            logger.error('[JUMP-LIST] Failed to send hint message:', error);
          }
        }
      }
    } catch (error) {
      logger.error('[JUMP-LIST] Failed to handle command-line tasks:', error);
    }
    // Windows Jump List tasks
    try {
      if (process.platform === 'win32') {
        app.setAppUserModelId('com.stratosort.app');
        app.setJumpList([
          {
            type: 'tasks',
            items: [
              {
                type: 'task',
                title: 'Analyze Folder…',
                program: process.execPath,
                args: '--analyze-folder',
                iconPath: process.execPath,
                iconIndex: 0,
              },
              {
                type: 'task',
                title: 'Open Documents Folder',
                program: process.execPath,
                args: '--open-documents',
                iconPath: process.execPath,
                iconIndex: 0,
              },
            ],
          },
        ]);
      }
    } catch (error) {
      logger.error('[JUMP-LIST] Failed to set Windows Jump List:', error);
    }
    // Fire-and-forget resume of incomplete batches shortly after window is ready
    const resumeTimeout = setTimeout(() => {
      try {
        const getMainWindow = () => mainWindow;
        resumeIncompleteBatches(serviceIntegration, logger, getMainWindow);
      } catch (e) {
        logger.warn(
          '[RESUME] Failed to schedule resume of incomplete batches:',
          e?.message,
        );
      }
    }, 500);
    try {
      resumeTimeout.unref();
    } catch (error) {
      logger.warn('[RESUME] Failed to unref timeout:', error.message);
    }

    // Load Ollama config and apply any saved selections
    const cfg = await loadOllamaConfig();
    if (cfg.selectedTextModel) await setOllamaModel(cfg.selectedTextModel);
    if (cfg.selectedVisionModel)
      await setOllamaVisionModel(cfg.selectedVisionModel);
    if (cfg.selectedEmbeddingModel)
      await setOllamaEmbeddingModel(cfg.selectedEmbeddingModel);
    logger.info('[STARTUP] Ollama configuration loaded');

    // Install React DevTools in development (opt-in to avoid noisy warnings)
    try {
      if (isDev && process.env.REACT_DEVTOOLS === 'true') {
        const {
          default: installExtension,
          REACT_DEVELOPER_TOOLS,
        } = require('electron-devtools-installer');
        try {
          await installExtension(REACT_DEVELOPER_TOOLS);
        } catch (error) {
          logger.warn('Failed to install React DevTools', {
            error: error.message,
            stack: error.stack,
          });
        }
      }
    } catch (error) {
      logger.error('[DEVTOOLS] Failed to setup React DevTools:', error);
    }

    // Auto-updates (production only)
    try {
      if (!isDev) {
        autoUpdater.autoDownload = true;
        autoUpdater.on('error', (err) => logger.error('[UPDATER] Error:', err));
        autoUpdater.on('update-available', () => {
          logger.info('[UPDATER] Update available');
          try {
            const win = BrowserWindow.getAllWindows()[0];
            if (win && !win.isDestroyed())
              win.webContents.send('app:update', { status: 'available' });
          } catch (error) {
            logger.error(
              '[UPDATER] Failed to send update-available message:',
              error,
            );
          }
        });
        autoUpdater.on('update-not-available', () => {
          logger.info('[UPDATER] No updates available');
          try {
            const win = BrowserWindow.getAllWindows()[0];
            if (win && !win.isDestroyed())
              win.webContents.send('app:update', { status: 'none' });
          } catch (error) {
            logger.error(
              '[UPDATER] Failed to send update-not-available message:',
              error,
            );
          }
        });
        autoUpdater.on('update-downloaded', () => {
          logger.info('[UPDATER] Update downloaded');
          try {
            const win = BrowserWindow.getAllWindows()[0];
            if (win && !win.isDestroyed())
              win.webContents.send('app:update', { status: 'ready' });
          } catch (error) {
            logger.error(
              '[UPDATER] Failed to send update-downloaded message:',
              error,
            );
          }
        });
        try {
          await autoUpdater.checkForUpdatesAndNotify();
        } catch (e) {
          logger.error('Update check failed', {
            error: e.message,
            stack: e.stack,
          });
        }
      }
    } catch (error) {
      logger.error('[UPDATER] Failed to setup auto-updater:', error);
    }
  } catch (error) {
    // Log full error details for debugging
    logger.error('[STARTUP] Failed to initialize:', {
      message: error?.message || 'Unknown error',
      stack: error?.stack,
      error: error,
    });
    // Still create window even if startup fails - allow degraded mode
    logger.warn(
      '[STARTUP] Creating window in degraded mode due to startup errors',
    );
    createWindow();
  }
});

// ===== APP LIFECYCLE =====
logger.info(
  '[STARTUP] Organizer AI App - Main Process Started with Full AI Features',
);
logger.info('[UI] Modern UI loaded with GPU acceleration');

// App lifecycle
app.on('before-quit', async () => {
  isQuitting = true;

  // HIGH PRIORITY FIX (HIGH-2): Add hard timeout for all cleanup operations
  // Prevents hanging on shutdown and ensures app quits even if cleanup fails
  const CLEANUP_TIMEOUT = 5000; // 5 seconds max for all cleanup
  const cleanupStartTime = Date.now();

  logger.info('[SHUTDOWN] Starting cleanup with 5-second timeout...');

  // Wrap ALL cleanup in a timeout promise
  const cleanupPromise = (async () => {
    // Clean up all intervals first
    if (metricsInterval) {
      clearInterval(metricsInterval);
      metricsInterval = null;
      logger.info('[CLEANUP] Metrics interval cleared');
    }

    // Clean up download watcher
    if (downloadWatcher) {
      try {
        downloadWatcher.stop();
        downloadWatcher = null;
        logger.info('[CLEANUP] Download watcher stopped');
      } catch (error) {
        logger.error('[CLEANUP] Failed to stop download watcher:', error);
      }
    }

    // Clean up child process listeners
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
    childProcessListeners = [];

    // Clean up global process listeners
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
    globalProcessListeners = [];

    // Clean up app event listeners
    for (const cleanup of eventListeners) {
      try {
        cleanup();
      } catch (error) {
        logger.error('[CLEANUP] Failed to clean up app event listener:', error);
      }
    }
    eventListeners = [];

    // Clean up IPC listeners
    try {
      ipcMain.removeAllListeners();
      logger.info('[CLEANUP] All IPC listeners removed');
    } catch (error) {
      logger.error('[CLEANUP] Failed to remove IPC listeners:', error);
    }

    // Clean up tray
    if (tray) {
      try {
        tray.destroy();
        tray = null;
        logger.info('[CLEANUP] System tray destroyed');
      } catch (error) {
        logger.error('[CLEANUP] Failed to destroy tray:', error);
      }
    }

    // Use StartupManager for graceful shutdown
    try {
      const startupManager = getStartupManager();
      await startupManager.shutdown();
      logger.info('[SHUTDOWN] StartupManager cleanup completed');
    } catch (error) {
      logger.error('[SHUTDOWN] StartupManager cleanup failed:', error);
    }

    // Legacy chromaDbProcess cleanup (fallback if StartupManager didn't handle it)
    if (chromaDbProcess) {
      logger.info(
        '[ChromaDB] Stopping ChromaDB server process (PID: ' +
          chromaDbProcess.pid +
          ')',
      );
      try {
        // Remove all listeners first
        chromaDbProcess.removeAllListeners();

        // Fixed: Use synchronous kill to ensure completion before continuing
        if (process.platform === 'win32') {
          // On Windows, use async taskkill with force flag to avoid blocking
          const { asyncSpawn } = require('./utils/asyncSpawnUtils');
          const result = await asyncSpawn(
            'taskkill',
            ['/pid', chromaDbProcess.pid, '/f', '/t'],
            {
              windowsHide: true,
              timeout: 5000, // 5 second timeout for taskkill
              encoding: 'utf8',
            },
          );

          if (result.status === 0) {
            logger.info(
              '[ChromaDB] ✓ Process terminated successfully (taskkill)',
            );
          } else if (result.error) {
            logger.error('[ChromaDB] Taskkill error:', result.error.message);
          } else {
            logger.warn('[ChromaDB] Taskkill exited with code:', result.status);
            if (result.stderr) {
              logger.warn('[ChromaDB] Taskkill stderr:', result.stderr.trim());
            }
          }
        } else {
          // On Unix-like systems, use synchronous kill commands
          const { execSync } = require('child_process');
          try {
            // Try SIGTERM first for graceful shutdown
            execSync(`kill -TERM -${chromaDbProcess.pid}`, { timeout: 100 });
            logger.info('[ChromaDB] Sent SIGTERM to process group');

            // Synchronous sleep for 2 seconds using shell command
            try {
              execSync('sleep 2', { timeout: 3000 });
            } catch (e) {
              // Timeout or error is fine, continue
            }

            // Force kill if still alive
            try {
              execSync(`kill -KILL -${chromaDbProcess.pid}`, { timeout: 100 });
              logger.info('[ChromaDB] Sent SIGKILL to process group');
            } catch (killError) {
              // Process already dead, this is fine
              logger.info('[ChromaDB] Process already terminated');
            }
          } catch (termError) {
            // ESRCH means process not found, which is fine
            logger.info('[ChromaDB] Process already terminated or not found');
          }
        }

        // Synchronous sleep for cleanup
        const { execSync } = require('child_process');
        try {
          if (process.platform === 'win32') {
            execSync('timeout /t 1 /nobreak', {
              timeout: 2000,
              windowsHide: true,
            });
          } else {
            execSync('sleep 0.5', { timeout: 1000 });
          }
        } catch (e) {
          // Timeout is fine
        }

        // Verify process is actually terminated
        try {
          process.kill(chromaDbProcess.pid, 0); // Signal 0 just checks if process exists
          logger.warn(
            '[ChromaDB] ⚠️ Process may still be running after kill attempt!',
          );
        } catch (e) {
          if (e.code === 'ESRCH') {
            logger.info('[ChromaDB] ✓ Process confirmed terminated');
          } else {
            logger.warn('[ChromaDB] Process check error:', e.message);
          }
        }
      } catch (e) {
        logger.error('[ChromaDB] Error stopping ChromaDB process:', e);
      }
      chromaDbProcess = null;
    }

    // Clean up service integration
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
    logger.info(`[SHUTDOWN] ✅ Cleanup completed successfully in ${elapsed}ms`);
  } catch (error) {
    const elapsed = Date.now() - cleanupStartTime;
    if (error.message === 'Cleanup timeout exceeded') {
      logger.error(
        `[SHUTDOWN] ⚠️ Cleanup timed out after ${elapsed}ms (max: ${CLEANUP_TIMEOUT}ms)`,
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
});

/**
 * Verify that all resources are properly released after shutdown
 * @returns {Promise<void>}
 */
async function verifyShutdownCleanup() {
  const issues = [];

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
  if (tray !== null) {
    issues.push('tray is not null');
  }

  // Log verification results
  if (issues.length === 0) {
    logger.info('[SHUTDOWN-VERIFY] ✅ All resources verified as released');
  } else {
    logger.warn(
      `[SHUTDOWN-VERIFY] ⚠️ Found ${issues.length} potential resource leaks:`,
    );
    issues.forEach((issue) => logger.warn(`[SHUTDOWN-VERIFY]   - ${issue}`));
  }
}

const windowAllClosedHandler = () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
};
app.on('window-all-closed', windowAllClosedHandler);

const activateHandler = () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
};
app.on('activate', activateHandler);

// Track for cleanup
eventListeners.push(() => {
  app.removeListener('window-all-closed', windowAllClosedHandler);
  app.removeListener('activate', activateHandler);
});

// Error handling
logger.info('✅ StratoSort main process initialized');

// Add comprehensive error handling (single registration)
const uncaughtExceptionHandler = (error) => {
  logger.error('UNCAUGHT EXCEPTION:', {
    message: error.message,
    stack: error.stack,
  });
};

const unhandledRejectionHandler = (reason, promise) => {
  logger.error('UNHANDLED REJECTION', { reason, promise: String(promise) });
};

process.on('uncaughtException', uncaughtExceptionHandler);
process.on('unhandledRejection', unhandledRejectionHandler);

// Track for cleanup
globalProcessListeners.push(() => {
  process.removeListener('uncaughtException', uncaughtExceptionHandler);
  process.removeListener('unhandledRejection', unhandledRejectionHandler);
});

// Keep the process alive for debugging
logger.debug(
  '[DEBUG] Process should stay alive. If you see this and the app closes, check for errors above.',
);

// All Analysis History and System metrics handlers are registered via ./ipc/* modules

// NOTE: Audio analysis handlers removed - feature disabled for performance optimization

// ===== TRAY INTEGRATION =====
let tray = null;
function createSystemTray() {
  try {
    const path = require('path');
    const iconPath = path.join(
      __dirname,
      process.platform === 'win32'
        ? '../../assets/icons/icons/win/icon.ico'
        : process.platform === 'darwin'
          ? '../../assets/icons/icons/png/24x24.png'
          : '../../assets/icons/icons/png/16x16.png',
    );
    const trayIcon = nativeImage.createFromPath(iconPath);
    if (process.platform === 'darwin') {
      trayIcon.setTemplateImage(true);
    }
    tray = new Tray(trayIcon);
    tray.setToolTip('StratoSort');
    updateTrayMenu();
  } catch (e) {
    logger.warn('[TRAY] initialization failed', e);
  }
}

function updateTrayMenu() {
  if (!tray) return;
  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Open StratoSort',
      click: () => {
        const win = BrowserWindow.getAllWindows()[0] || createWindow();
        if (win && win.isMinimized()) win.restore();
        if (win) {
          win.show();
          win.focus();
        }
      },
    },
    {
      label: downloadWatcher ? 'Pause Auto-Sort' : 'Resume Auto-Sort',
      click: async () => {
        const enable = !downloadWatcher;
        try {
          if (settingsService) {
            const merged = await settingsService.save({
              autoOrganize: enable,
            });
            handleSettingsChanged(merged);
          } else {
            handleSettingsChanged({ autoOrganize: enable });
          }
        } catch (err) {
          logger.warn('[TRAY] Failed to toggle auto-sort:', err.message);
        }
        updateTrayMenu();
      },
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);
  tray.setContextMenu(contextMenu);
}

// Resume service
const { resumeIncompleteBatches } = require('./services/OrganizeResumeService');

// Delete folder and its contents
