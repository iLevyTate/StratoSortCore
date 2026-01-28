// FIX: Load environment variables from .env file before anything else
require('dotenv').config();

const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');

const isDev = process.env.NODE_ENV === 'development';

// Logging utility
const tesseract = require('node-tesseract-ocr');
const fs = require('fs').promises;
const path = require('path');
const { logger } = require('../shared/logger');
const { withTimeout } = require('../shared/promiseUtils');

logger.setContext('Main');

// Import error handling system
const errorHandler = require('./errors/ErrorHandler');

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
  loadOllamaConfig
} = require('./ollamaUtils');
const { buildOllamaOptions } = require('./services/PerformanceService');
const { getService: getSettingsService } = require('./services/SettingsService');
// Import service integration
const ServiceIntegration = require('./services/ServiceIntegration');

// Import startup manager
const { getStartupManager } = require('./services/startup');

// Import shared constants
const { IPC_CHANNELS } = require('../shared/constants');

// Import path sanitization for security checks
const { isPathDangerous } = require('../shared/pathSanitization');

// Import IPC wrappers for safe event sending
const { safeSend } = require('./ipc/ipcWrappers');

// Import services
const { analyzeDocumentFile } = require('./analysis/ollamaDocumentAnalysis');
const { analyzeImageFile } = require('./analysis/ollamaImageAnalysis');

// Import OCR library
// platformUtils imported in core/jumpList.js for Windows detection

// Extracted core modules
const {
  initializeGpuConfig,
  handleGpuProcessGone,
  forceSoftwareRenderer
} = require('./core/gpuConfig');
const { createApplicationMenu } = require('./core/applicationMenu');
const {
  initializeTrayConfig,
  createSystemTray,
  updateTrayMenu,
  registerGlobalShortcut
} = require('./core/systemTray');
const { verifyIpcHandlersRegistered } = require('./core/ipcVerification');
const { initializeLifecycle, registerLifecycleHandlers } = require('./core/lifecycle');
const { initializeAutoUpdater } = require('./core/autoUpdater');
const { initializeJumpList, handleCommandLineTasks } = require('./core/jumpList');
const { runBackgroundSetup } = require('./core/backgroundSetup');
const { migrateUserDataState } = require('./core/userDataMigration');

// Windows integrations (Jump List, notifications, taskbar grouping) require AppUserModelId.
// Set it as early as possible so it applies even before any windows are created.
if (process.platform === 'win32') {
  try {
    app.setAppUserModelId('com.stratosort.app');
  } catch (error) {
    logger.debug('Failed to set AppUserModelId', { error: error?.message });
  }
}

let mainWindow;
let customFolders = []; // Initialize customFolders at module level

// Initialize service integration
let serviceIntegration;
let settingsService;
let downloadWatcher;
let currentSettings = {};
// FIX 2.4: Consolidated shutdown state to prevent race conditions
// Previously had separate isQuitting and _forceQuit flags that could get out of sync
const _shutdownState = {
  isQuitting: false, // Set by lifecycle during async cleanup
  forceQuit: false, // Set synchronously via prependListener before async cleanup
  get shouldClose() {
    // Combined getter - returns true if app is in any shutdown state
    return this.isQuitting || this.forceQuit;
  }
};
// Backward compatibility aliases (prefixed with _ as they're set via helpers, not used directly)
let _isQuitting = false;
let _forceQuit = false;
// Sync helper to update both the state object and legacy variables
const setIsQuitting = (val) => {
  _isQuitting = val;
  _shutdownState.isQuitting = val;
};
const setForceQuit = (val) => {
  _forceQuit = val;
  _shutdownState.forceQuit = val;
};
let chromaDbProcess = null;

// Track cleanup handlers for proper memory management
let metricsInterval = null;
let eventListeners = [];
let childProcessListeners = [];
let globalProcessListeners = [];

// Ensure any tracked timers are cleared during shutdown
eventListeners.push(() => {
  clearAllTrackedTimers();
});

const trackedTimers = new Map();
const trackTimeout = (handler, delay) => {
  const id = setTimeout(() => {
    trackedTimers.delete(id);
    handler();
  }, delay);
  trackedTimers.set(id, 'timeout');
  return id;
};
const trackInterval = (handler, delay) => {
  const id = setInterval(handler, delay);
  trackedTimers.set(id, 'interval');
  return id;
};
const clearTrackedTimer = (id) => {
  if (!id) return;
  const type = trackedTimers.get(id);
  if (type === 'interval') {
    clearInterval(id);
  } else {
    clearTimeout(id);
  }
  trackedTimers.delete(id);
};
const clearAllTrackedTimers = () => {
  for (const [id, type] of trackedTimers.entries()) {
    if (type === 'interval') {
      clearInterval(id);
    } else {
      clearTimeout(id);
    }
  }
  trackedTimers.clear();
};

// Background setup status is now tracked in ./core/backgroundSetup module

// NOTE: Startup logic is handled by StartupManager and ServiceIntegration
// IPC verification is handled by ./core/ipcVerification

// ===== GPU PREFERENCES (Windows rendering stability) =====
// GPU configuration is now handled by ./core/gpuConfig
initializeGpuConfig();
app.on('child-process-gone', handleGpuProcessGone);
eventListeners.push(() => app.removeListener('child-process-gone', handleGpuProcessGone));

// Custom folders helpers
const { loadCustomFolders, saveCustomFolders } = require('./core/customFolders');

// System monitoring and analytics
const systemAnalytics = require('./core/systemAnalytics');

// Window creation
const createMainWindow = require('./core/createWindow');

// Application menu is now handled by ./core/applicationMenu
// createApplicationMenu is imported and called with getMainWindow callback

// FIX: Mutex to prevent concurrent window creation (race condition fix)
let _windowCreationPromise = null;

function createWindow() {
  // FIX: If window creation is already in progress, return the existing promise
  if (_windowCreationPromise) {
    logger.debug('[WINDOW] createWindow() already in progress, waiting...');
    return _windowCreationPromise;
  }

  logger.debug('[WINDOW] createWindow() called');

  // HIGH-2 FIX: Use event-driven window state manager instead of nested setTimeout
  const { restoreWindow, ensureWindowOnScreen } = require('./core/windowState');

  // FIX: Check for existing window BEFORE setting mutex to avoid holding lock unnecessarily
  if (mainWindow && !mainWindow.isDestroyed()) {
    logger.debug('[WINDOW] Window already exists, restoring state...');

    // Use event-driven restoration (replaces complex setTimeout chain)
    restoreWindow(mainWindow).catch((error) => {
      logger.error('[WINDOW] Error during window state restoration:', error);
    });

    // Ensure window is on screen (handle multi-monitor issues)
    ensureWindowOnScreen(mainWindow);

    return Promise.resolve();
  }

  // FIX: Set mutex for window creation - will be cleared once window is ready or on error
  _windowCreationPromise = new Promise((resolve) => {
    try {
      // Double-check after acquiring mutex (another call might have created window)
      if (mainWindow && !mainWindow.isDestroyed()) {
        logger.debug('[WINDOW] Window created by concurrent call, using existing');
        _windowCreationPromise = null;
        resolve();
        return;
      }

      _createWindowInternal();

      // Wait for window to be ready before releasing mutex
      if (mainWindow) {
        let creationTimeout;

        const onReadyToShow = () => {
          logger.debug('[WINDOW] Window ready, releasing creation mutex');
          if (creationTimeout) clearTimeout(creationTimeout);
          _windowCreationPromise = null;
          resolve();
        };

        mainWindow.once('ready-to-show', onReadyToShow);

        // Also handle error case - release mutex after timeout
        creationTimeout = setTimeout(() => {
          if (_windowCreationPromise) {
            logger.warn('[WINDOW] Window creation timeout, releasing mutex');
            // Remove the listener to avoid memory leak or late execution
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.removeListener('ready-to-show', onReadyToShow);
            }
            _windowCreationPromise = null;
            resolve();
          }
        }, 10000);
      } else {
        _windowCreationPromise = null;
        resolve();
      }
    } catch (error) {
      logger.error('[WINDOW] Error creating window:', error);
      _windowCreationPromise = null;
      resolve();
    }
  });

  return _windowCreationPromise;
}

/**
 * Internal window creation logic (extracted for mutex wrapper)
 * @private
 */
function _createWindowInternal() {
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

  // FIX 2.4: Use consolidated shutdown state getter for cleaner shutdown handling
  const closeHandler = (e) => {
    if (!_shutdownState.shouldClose && currentSettings?.backgroundMode) {
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
    // FIX C-2: Ensure services are fully initialized before starting watcher
    // This prevents race condition where watcher starts with null service references
    if (!serviceIntegration?.initialized) {
      logger.warn('[AUTO-ORGANIZE] Cannot start watcher - services not yet initialized');
      return;
    }
    if (!serviceIntegration?.autoOrganizeService) {
      logger.warn('[AUTO-ORGANIZE] Cannot start watcher - autoOrganizeService not available');
      return;
    }
    if (!downloadWatcher) {
      const { container, ServiceIds } = require('./services/ServiceContainer');
      downloadWatcher = container.tryResolve(ServiceIds.DOWNLOAD_WATCHER);
      if (!downloadWatcher) {
        logger.warn('[AUTO-ORGANIZE] Download watcher not available');
        return;
      }

      // Ensure container-managed watcher has required dependencies
      serviceIntegration?.configureDownloadWatcher?.({
        getCustomFolders: () => customFolders,
        analyzeDocumentFile,
        analyzeImageFile
      });

      downloadWatcher.start();
      logger.info('[AUTO-ORGANIZE] Download watcher started successfully');
    }
  } else if (downloadWatcher) {
    downloadWatcher.stop();
    downloadWatcher = null;
    logger.info('[AUTO-ORGANIZE] Download watcher stopped');
  }
}

// Note: Smart folder watching is always enabled - files added to smart folders are automatically analyzed
// The watcher is started automatically during service initialization in ServiceIntegration.js

function handleSettingsChanged(settings) {
  // MEDIUM PRIORITY FIX (MED-1): Validate settings structure before use
  if (!settings || typeof settings !== 'object') {
    logger.warn('[SETTINGS] Invalid settings received, using defaults');
    currentSettings = {};
    return;
  }

  currentSettings = settings;
  updateDownloadWatcher(settings);
  // Note: Smart folder watcher is always enabled - no settings-based control needed
  // Propagate confidence threshold to auto-organize service (so it doesn't stick to defaults)
  try {
    serviceIntegration?.autoOrganizeService?.applySettings?.(settings);
  } catch (error) {
    logger.warn('[SETTINGS] Failed to apply settings to auto-organize service:', error?.message);
  }
  try {
    updateTrayMenu();
  } catch (error) {
    logger.warn('[SETTINGS] Failed to update tray menu:', error);
  }
}

// ===== IPC HANDLERS =====
const { registerAllIpc, IpcServiceContext } = require('./ipc');

// Prevent multiple instances
const gotTheLock = app.requestSingleInstanceLock();
logger.debug('Single instance lock:', gotTheLock);

if (!gotTheLock) {
  logger.debug('Failed to get lock, quitting');
  app.quit();
} else {
  const secondInstanceHandler = (_event, argv) => {
    // Someone tried to run a second instance, restore and focus our window
    // HIGH-2 FIX: Use event-driven window state manager
    const { restoreWindow } = require('./core/windowState');

    // Windows: Jump List tasks are passed via argv when the app is already running.
    // Process them here so tasks work reliably in the single-instance scenario.
    try {
      if (Array.isArray(argv)) {
        handleCommandLineTasks(argv);
      }
    } catch (error) {
      logger.warn('[SECOND-INSTANCE] Failed to handle command-line tasks:', error?.message);
    }

    if (mainWindow && !mainWindow.isDestroyed()) {
      logger.debug('[SECOND-INSTANCE] Restoring window for second instance attempt');

      restoreWindow(mainWindow).catch((error) => {
        logger.error('[SECOND-INSTANCE] Error restoring window:', error);
      });
    } else {
      // No window exists, create one
      createWindow();
    }
  };
  app.on('second-instance', secondInstanceHandler);

  // Track for cleanup
  eventListeners.push(() => app.removeListener('second-instance', secondInstanceHandler));

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
  // FIX: Create a referenced interval to keep the event loop alive during startup
  // This prevents premature exit when async operations use unreferenced timeouts
  const startupKeepalive = trackInterval(() => {}, 1000);

  try {
    // ---- Logging (best-practice defaults) ----
    // Use a single JSONL log file per app launch under userData/logs.
    // In production, we disable console logging by default (can be re-enabled via env var).
    const logsDir = path.join(app.getPath('userData'), 'logs');
    await fs.mkdir(logsDir, { recursive: true });
    const logTimestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const logFilePath = path.join(logsDir, `stratosort-${logTimestamp}.log`);
    logger.enableFileLogging(logFilePath, { format: 'jsonl' });
    if (!isDev && process.env.STRATOSORT_CONSOLE_LOGS !== '1') {
      logger.disableConsoleLogging();
    }
    logger.info('[LOGGING] File logging enabled', { logFilePath });
    logger.info('[DIAGNOSTICS] Runtime info', {
      appVersion: app.getVersion?.(),
      platform: process.platform,
      arch: process.arch,
      versions: process.versions,
      userDataPath: app.getPath('userData')
    });

    // Initialize error handler (uses same log file for consistency)
    await errorHandler.initialize({ logFilePath });

    // Clean up old log files (keep last 7 days)
    await errorHandler.cleanupLogs(7);

    // Restore legacy state/history before services read userData
    await migrateUserDataState();

    // Get the startup manager instance
    const startupManager = getStartupManager();

    // Check for first run moved to background task after window creation
    // to prevent blocking startup

    // CONSOLIDATED STARTUP: Single coordinated startup sequence with unified timeout
    // Previously had separate 30s timeouts for StartupManager and ServiceIntegration,
    // which could result in up to 60s total wait time. Now uses single 45s timeout.
    const { TIMEOUTS } = require('../shared/performanceConstants');
    let startupResult;

    // Create ServiceIntegration early so it's available for the coordinated startup
    serviceIntegration = new ServiceIntegration();

    try {
      // Coordinated startup with single timeout
      const coordinatedStartup = async () => {
        // Phase 1: Start external services (Ollama, ChromaDB)
        logger.info('[STARTUP] Phase 1: Starting external services...');
        const servicesResult = await startupManager.startup();

        // Phase 2: Initialize DI container and internal services
        // FIX: Pass startup result to skip redundant ChromaDB availability check (saves 2-4s)
        logger.info('[STARTUP] Phase 2: Initializing service integration...');
        await serviceIntegration.initialize({ startupResult: servicesResult });

        return servicesResult;
      };

      // Single timeout for entire coordinated startup (45 seconds)
      const COORDINATED_STARTUP_TIMEOUT = TIMEOUTS.SERVICE_STARTUP + 15000; // 45s
      let timeoutId;
      const timeoutPromise = new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(
            new Error(
              `Coordinated startup timeout after ${COORDINATED_STARTUP_TIMEOUT / 1000} seconds`
            )
          );
        }, COORDINATED_STARTUP_TIMEOUT);
      });

      try {
        startupResult = await Promise.race([coordinatedStartup(), timeoutPromise]);
        logger.info('[STARTUP] Coordinated startup completed successfully');
      } finally {
        if (timeoutId) clearTimeout(timeoutId);
      }
    } catch (error) {
      // Log full error details for debugging
      logger.error('[STARTUP] Coordinated startup failed:', {
        message: error?.message || 'Unknown error',
        stack: error?.stack
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
        logger.warn('[STARTUP] Invalid custom folders data (not an array), using empty array');
        customFolders = [];
      } else {
        // Filter out invalid folder entries
        customFolders = loadedFolders.filter((folder) => {
          if (!folder || typeof folder !== 'object') {
            logger.warn('[STARTUP] Skipping invalid folder entry (not an object)');
            return false;
          }
          if (!folder.id || typeof folder.id !== 'string') {
            logger.warn('[STARTUP] Skipping folder without valid id:', folder);
            return false;
          }
          if (!folder.name || typeof folder.name !== 'string') {
            logger.warn('[STARTUP] Skipping folder without valid name:', folder);
            return false;
          }
          if (!folder.path || typeof folder.path !== 'string') {
            logger.warn('[STARTUP] Skipping folder without valid path:', folder);
            return false;
          }
          // Security: skip folders with dangerous system paths
          if (isPathDangerous(folder.path)) {
            logger.warn('[STARTUP] Skipping folder with dangerous path:', folder.path);
            return false;
          }
          return true;
        });

        if (customFolders.length !== loadedFolders.length) {
          logger.warn(
            `[STARTUP] Filtered out ${loadedFolders.length - customFolders.length} invalid folder entries`
          );
        }
      }

      logger.info('[STARTUP] Loaded custom folders:', customFolders.length, 'folders');
    } catch (error) {
      logger.error('[STARTUP] Failed to load custom folders:', error.message);
      customFolders = [];
    }

    // Ensure default "Uncategorized" folder exists
    // CRITICAL FIX: Add null checks with optional chaining to prevent NULL dereference
    const hasDefaultFolder =
      customFolders?.some((f) => f?.isDefault || f?.name?.toLowerCase() === 'uncategorized') ??
      false;

    if (!hasDefaultFolder) {
      const documentsDir = app.getPath('documents');
      if (!documentsDir || typeof documentsDir !== 'string') {
        throw new Error('Failed to get documents directory path');
      }
      const defaultFolderPath = path.join(documentsDir, 'StratoSort', 'Uncategorized');

      try {
        // Create directory if it doesn't exist
        await fs.mkdir(defaultFolderPath, { recursive: true });

        // Verify directory was created successfully
        const stats = await fs.stat(defaultFolderPath);
        if (!stats.isDirectory()) {
          throw new Error('Default folder path exists but is not a directory');
        }

        const defaultFolder = {
          id: `default-uncategorized-${Date.now()}`,
          name: 'Uncategorized',
          path: defaultFolderPath,
          description: "Default folder for files that don't match any category",
          keywords: [],
          isDefault: true,
          createdAt: new Date().toISOString()
        };

        customFolders.push(defaultFolder);
        await saveCustomFolders(customFolders);

        // Verify folder was persisted
        const reloadedFolders = await loadCustomFolders();
        const persistedDefault = reloadedFolders.find(
          (f) => f?.isDefault || f?.name?.toLowerCase() === 'uncategorized'
        );

        if (!persistedDefault) {
          logger.error('[STARTUP] Default folder created but failed to persist');
        } else {
          logger.info(
            '[STARTUP] Created and verified default Uncategorized folder at:',
            defaultFolderPath
          );
        }
      } catch (error) {
        logger.error('[STARTUP] Failed to create default folder:', error);
        // This is critical - app should not proceed without default folder
        throw new Error(`Failed to create default Uncategorized folder: ${error.message}`);
      }
    } else {
      logger.info('[STARTUP] Default folder already exists, skipping creation');
    }

    // NOTE: ServiceIntegration is now initialized in the coordinated startup above

    // Initialize settings service
    settingsService = getSettingsService();
    const initialSettings = await settingsService.load();

    // Resume any incomplete organize batches (best-effort)
    try {
      const incompleteBatches =
        serviceIntegration?.processingState?.getIncompleteOrganizeBatches?.() || [];
      if (incompleteBatches.length > 0) {
        logger.warn(
          `[RESUME] Found ${incompleteBatches.length} incomplete organize batch(es). They will resume when a new organize request starts.`
        );
      }
    } catch (resumeErr) {
      logger.warn('[RESUME] Failed to check incomplete batches:', resumeErr.message);
    }

    // Verify AI models on startup (only if Ollama is running)
    if (startupResult?.services?.ollama?.success) {
      // Use ModelManager singleton which is now the single source of truth for model verification
      const { getInstance: getModelManager } = require('./services/ModelManager');
      const modelManager = getModelManager();
      // FIX 2.3: Add timeout to model verification to prevent indefinite hangs
      try {
        await withTimeout(
          modelManager.ensureWorkingModel(),
          10000, // 10 second timeout for model verification
          'Model verification'
        );
        logger.info('[STARTUP] ✅ AI models verified and ready');
      } catch (err) {
        // FIX 2.3: Distinguish between timeout and other errors
        if (err.message?.includes('timed out')) {
          logger.warn('[STARTUP] Model verification timed out - will retry on first use');
        } else {
          logger.warn('[STARTUP] Model verification warning:', err.message);
        }
        // Continue anyway - model can be verified later when needed
      }
    }

    // Register IPC groups now that services and state are ready
    const getMainWindow = () => mainWindow;
    const getServiceIntegration = () => serviceIntegration;
    const getCustomFolders = () => customFolders;
    const setCustomFolders = (folders) => {
      customFolders = folders;
    };

    // Create configured IPC service context
    const ipcContext = new IpcServiceContext()
      .setCore({
        ipcMain,
        IPC_CHANNELS,
        logger
      })
      .setElectron({
        dialog,
        shell,
        getMainWindow
      })
      .setSystemAnalytics(systemAnalytics)
      .setServiceIntegration(getServiceIntegration)
      .setFolders({
        getCustomFolders,
        setCustomFolders,
        saveCustomFolders,
        scanDirectory
      })
      .setAnalysis({
        analyzeDocumentFile,
        analyzeImageFile,
        tesseract
      })
      .setOllama({
        getOllama,
        getOllamaModel,
        getOllamaVisionModel,
        getOllamaEmbeddingModel,
        getOllamaHost,
        setOllamaHost,
        setOllamaModel,
        setOllamaVisionModel,
        setOllamaEmbeddingModel,
        buildOllamaOptions
      })
      .setSettings({
        settingsService,
        onSettingsChanged: handleSettingsChanged
      });

    // Register all IPC handlers using the context
    registerAllIpc(ipcContext);

    // Configure SmartFolderWatcher with required dependencies
    // This watcher auto-analyzes files added or modified in smart folders
    if (serviceIntegration) {
      serviceIntegration.configureSmartFolderWatcher({
        getSmartFolders: getCustomFolders,
        analyzeDocumentFile,
        analyzeImageFile
      });

      // Configure DownloadWatcher with required dependencies
      serviceIntegration.configureDownloadWatcher({
        getCustomFolders: () => customFolders,
        analyzeDocumentFile,
        analyzeImageFile
      });

      // Configure LearningFeedback to learn from file organization
      serviceIntegration.configureLearningFeedback({
        getSmartFolders: getCustomFolders
      });

      // Optional: Run startup learning scan to learn from existing organization
      // This teaches the system from files already in smart folders
      // Run in background to not block startup
      serviceIntegration
        .runLearningStartupScan({
          maxFilesPerFolder: 50,
          onlyWithAnalysis: true
        })
        .catch((err) => {
          logger.debug('[MAIN] Learning startup scan failed (non-critical):', err?.message);
        });
    }

    // Create application menu with theme
    createApplicationMenu(() => mainWindow);

    // Register IPC event listeners (not handlers) for renderer-to-main communication
    // FIX: Store handler reference for proper cleanup tracking
    const rendererErrorReportHandler = (event, errorData) => {
      try {
        logger.error('[RENDERER ERROR]', {
          message: errorData?.message || 'Unknown error',
          stack: errorData?.stack,
          componentStack: errorData?.componentStack,
          type: errorData?.type || 'unknown',
          timestamp: errorData?.timestamp || new Date().toISOString()
        });
      } catch (err) {
        logger.error('[RENDERER ERROR] Failed to process error report:', err);
      }
    };
    ipcMain.on('renderer-error-report', rendererErrorReportHandler);

    // FIX: Track renderer-error-report listener for explicit cleanup
    eventListeners.push(() => {
      ipcMain.removeListener('renderer-error-report', rendererErrorReportHandler);
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
        '[STARTUP] ⚠️ CRITICAL: Some IPC handlers not registered after verification timeout'
      );
      logger.error(
        '[STARTUP] App may not function correctly. Consider increasing timeout or checking handler registration logic.'
      );
      // Don't throw - allow app to start in degraded mode
      // The handlers may register later or may be optional
      // This prevents complete app failure, but user will see errors for missing functionality
    } else {
      logger.info('[STARTUP] ✅ All critical IPC handlers verified and ready');
    }

    createWindow();
    // FIX: Clear keepalive now that window is created and keeping event loop alive
    clearTrackedTimer(startupKeepalive);
    handleSettingsChanged(initialSettings);

    // Run first-time setup in background (non-blocking)
    // Handled by ./core/backgroundSetup module
    runBackgroundSetup();

    // Start periodic system metrics broadcast to renderer
    try {
      // Clear any existing interval before creating a new one
      if (metricsInterval) {
        clearTrackedTimer(metricsInterval);
        metricsInterval = null;
      }

      // PERFORMANCE FIX: Increased interval from 10s to 30s to reduce overhead
      // Renderer component polls directly, so main process doesn't need to poll as frequently
      const { TIMEOUTS } = require('../shared/performanceConstants');
      metricsInterval = trackInterval(async () => {
        try {
          const win = BrowserWindow.getAllWindows()[0];
          if (!win || win.isDestroyed()) return;
          const metrics = await systemAnalytics.collectMetrics();
          safeSend(win.webContents, 'system-metrics', metrics);
        } catch (error) {
          logger.error('[METRICS] Failed to collect or send metrics:', error);
        }
      }, TIMEOUTS.METRICS_BROADCAST);
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
      initializeTrayConfig({
        getDownloadWatcher: () => downloadWatcher,
        getSettingsService: () => settingsService,
        handleSettingsChanged,
        createWindow,
        setIsQuitting // FIX 2.4: Use consolidated setter
      });
      createSystemTray();
      // Register global shortcut for quick semantic search
      registerGlobalShortcut();
    } catch (e) {
      logger.warn('[TRAY] Failed to initialize tray:', e.message);
    }

    // Initialize lifecycle module with state accessors
    initializeLifecycle({
      getMetricsInterval: () => metricsInterval,
      setMetricsInterval: (val) => {
        metricsInterval = val;
      },
      getDownloadWatcher: () => downloadWatcher,
      setDownloadWatcher: (val) => {
        downloadWatcher = val;
      },
      getServiceIntegration: () => serviceIntegration,
      getSettingsService: () => settingsService,
      getChromaDbProcess: () => chromaDbProcess,
      setChromaDbProcess: (val) => {
        chromaDbProcess = val;
      },
      getEventListeners: () => eventListeners,
      setEventListeners: (val) => {
        eventListeners = val;
      },
      getChildProcessListeners: () => childProcessListeners,
      setChildProcessListeners: (val) => {
        childProcessListeners = val;
      },
      getGlobalProcessListeners: () => globalProcessListeners,
      setGlobalProcessListeners: (val) => {
        globalProcessListeners = val;
      },
      setIsQuitting // FIX 2.4: Use consolidated setter
    });

    // Register lifecycle handlers (replaces inline before-quit, window-all-closed, etc.)
    const lifecycleCleanup = registerLifecycleHandlers(createWindow);
    eventListeners.push(lifecycleCleanup.cleanupAppListeners);
    globalProcessListeners.push(lifecycleCleanup.cleanupProcessListeners);

    // FIX 2.4: Add synchronous pre-quit listener to set forceQuit flag BEFORE async cleanup
    // This prevents the race condition where window close handler hides window during quit
    app.prependListener('before-quit', () => {
      setForceQuit(true);
    });

    // Handle Windows Jump List command-line tasks and setup
    // Handled by ./core/jumpList module
    initializeJumpList();
    // Fire-and-forget resume of incomplete batches shortly after window is ready
    // FIX: Track timeout for cleanup to prevent execution during shutdown
    let resumeTimeoutCleared = false;
    const resumeTimeout = trackTimeout(() => {
      if (resumeTimeoutCleared) return; // Guard against execution during shutdown
      try {
        // Note: getMainWindow is already defined at line 566 and in scope here
        resumeIncompleteBatches(serviceIntegration, logger, getMainWindow);
      } catch (e) {
        logger.warn('[RESUME] Failed to schedule resume of incomplete batches:', e?.message);
      }
    }, 500);
    try {
      resumeTimeout.unref();
    } catch (error) {
      logger.warn('[RESUME] Failed to unref timeout:', error.message);
    }
    // FIX: Add cleanup function to clear the timeout on app quit
    eventListeners.push(() => {
      resumeTimeoutCleared = true;
      clearTrackedTimer(resumeTimeout);
    });

    // Load Ollama config and apply any saved selections (LOW-3: renamed cfg to ollamaConfig)
    const ollamaConfig = await loadOllamaConfig();
    if (ollamaConfig.selectedTextModel) await setOllamaModel(ollamaConfig.selectedTextModel);
    if (ollamaConfig.selectedVisionModel)
      await setOllamaVisionModel(ollamaConfig.selectedVisionModel);
    if (ollamaConfig.selectedEmbeddingModel)
      await setOllamaEmbeddingModel(ollamaConfig.selectedEmbeddingModel);
    logger.info('[STARTUP] Ollama configuration loaded');

    // Install React DevTools in development (opt-in to avoid noisy warnings)
    try {
      if (isDev && process.env.REACT_DEVTOOLS === 'true') {
        const {
          default: installExtension,
          REACT_DEVELOPER_TOOLS
        } = require('electron-devtools-installer');
        try {
          await installExtension(REACT_DEVELOPER_TOOLS);
        } catch (error) {
          logger.warn('Failed to install React DevTools', {
            error: error.message,
            stack: error.stack
          });
        }
      }
    } catch (error) {
      logger.error('[DEVTOOLS] Failed to setup React DevTools:', error);
    }

    // Auto-updates (production only) - handled by ./core/autoUpdater module
    const autoUpdaterResult = await initializeAutoUpdater(isDev, getMainWindow);
    if (autoUpdaterResult.cleanup) {
      eventListeners.push(autoUpdaterResult.cleanup);
    }
  } catch (error) {
    // Log full error details for debugging
    logger.error('[STARTUP] Failed to initialize:', {
      message: error?.message || 'Unknown error',
      stack: error?.stack,
      error
    });
    // Still create window even if startup fails - allow degraded mode
    logger.warn('[STARTUP] Creating window in degraded mode due to startup errors');
    createWindow();
    // FIX: Clear keepalive now that window is created and keeping event loop alive
    clearTrackedTimer(startupKeepalive);
  }
});

// ===== APP LIFECYCLE =====
// Lifecycle handlers (before-quit, window-all-closed, activate, error handling)
// are now managed by ./core/lifecycle module and registered via registerLifecycleHandlers()
logger.info('[STARTUP] Organizer AI App - Main Process Started with Full AI Features');
logger.info('[UI] Modern UI loaded with GPU acceleration');
logger.info('StratoSort main process initialized');

// All Analysis History and System metrics handlers are registered via ./ipc/* modules

// Audio analysis is not supported in this build.

// ===== TRAY INTEGRATION =====
// System tray is now handled by ./core/systemTray
// Functions createSystemTray and updateTrayMenu are imported
// tray variable is managed by the systemTray module (use getTray() to access)

// Resume service
const { resumeIncompleteBatches } = require('./services/OrganizeResumeService');

// Delete folder and its contents
