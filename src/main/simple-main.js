const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const { autoUpdater } = require('electron-updater');
const isDev = process.env.NODE_ENV === 'development';

// Logging utility
const { logger } = require('../shared/logger');
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
const { getStartupManager } = require('./services/startup');

// Import shared constants
const { IPC_CHANNELS } = require('../shared/constants');

// Import services
const { analyzeDocumentFile } = require('./analysis/ollamaDocumentAnalysis');
const { analyzeImageFile } = require('./analysis/ollamaImageAnalysis');

// Import OCR library
const tesseract = require('node-tesseract-ocr');
const fs = require('fs').promises;
const path = require('path');
const { isWindows } = require('../shared/platformUtils');

// Extracted core modules
const {
  initializeGpuConfig,
  handleGpuProcessGone,
  forceSoftwareRenderer,
} = require('./core/gpuConfig');
const { createApplicationMenu } = require('./core/applicationMenu');
const {
  initializeTrayConfig,
  createSystemTray,
  updateTrayMenu,
  destroyTray,
  getTray,
} = require('./core/systemTray');
const { verifyIpcHandlersRegistered } = require('./core/ipcVerification');

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

// HIGH-3 FIX: Track background setup status for visibility
let backgroundSetupStatus = {
  complete: false,
  error: null,
  startedAt: null,
  completedAt: null,
};

// NOTE: Startup logic is handled by StartupManager and ServiceIntegration
// IPC verification is handled by ./core/ipcVerification

// ===== GPU PREFERENCES (Windows rendering stability) =====
// GPU configuration is now handled by ./core/gpuConfig
initializeGpuConfig();
app.on('child-process-gone', handleGpuProcessGone);
eventListeners.push(() =>
  app.removeListener('child-process-gone', handleGpuProcessGone),
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

// Application menu is now handled by ./core/applicationMenu
// createApplicationMenu is imported and called with getMainWindow callback

function createWindow() {
  logger.debug('[WINDOW] createWindow() called');

  // HIGH-2 FIX: Use event-driven window state manager instead of nested setTimeout
  const { restoreWindow, ensureWindowOnScreen } = require('./core/windowState');

  if (mainWindow && !mainWindow.isDestroyed()) {
    logger.debug('[WINDOW] Window already exists, restoring state...');

    // Use event-driven restoration (replaces complex setTimeout chain)
    restoreWindow(mainWindow).catch((error) => {
      logger.error('[WINDOW] Error during window state restoration:', error);
    });

    // Ensure window is on screen (handle multi-monitor issues)
    ensureWindowOnScreen(mainWindow);

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
    // HIGH-2 FIX: Use event-driven window state manager
    const { restoreWindow } = require('./core/windowState');

    if (mainWindow && !mainWindow.isDestroyed()) {
      logger.debug(
        '[SECOND-INSTANCE] Restoring window for second instance attempt',
      );

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
    // Initialize error handler and logging
    await errorHandler.initialize();

    // Enable file logging in development for easier debugging
    if (isDev) {
      const logPath = path.join(
        app.getPath('userData'),
        'logs',
        `dev-${new Date().toISOString().split('T')[0]}.log`,
      );
      logger.enableFileLogging(logPath);
      logger.info('File logging enabled', { logPath });
    }

    // Clean up old log files (keep last 7 days)
    await errorHandler.cleanupLogs(7);

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
          id: `default-uncategorized-${Date.now()}`,
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

    // Initialize service integration with timeout (HIGH-4 FIX)
    serviceIntegration = new ServiceIntegration();
    try {
      const { TIMEOUTS } = require('../shared/performanceConstants');
      const initPromise = serviceIntegration.initialize();
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => {
          reject(
            new Error(
              'Service integration initialization timeout after 30 seconds',
            ),
          );
        }, TIMEOUTS.SERVICE_STARTUP);
      });

      await Promise.race([initPromise, timeoutPromise]);
      logger.info('[MAIN] Service integration initialized successfully');
    } catch (error) {
      logger.error('[MAIN] Service integration initialization failed:', {
        message: error?.message || 'Unknown error',
        stack: error?.stack,
      });
      logger.warn(
        '[MAIN] Continuing in degraded mode without full service integration',
      );
      // Don't throw - allow app to continue in degraded mode
    }

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
          timestamp: errorData?.timestamp || new Date().toISOString(),
        });
      } catch (err) {
        logger.error('[RENDERER ERROR] Failed to process error report:', err);
      }
    };
    ipcMain.on('renderer-error-report', rendererErrorReportHandler);

    // FIX: Track renderer-error-report listener for explicit cleanup
    eventListeners.push(() => {
      ipcMain.removeListener(
        'renderer-error-report',
        rendererErrorReportHandler,
      );
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
    // HIGH-3 FIX: Track status for visibility and error reporting
    (async () => {
      backgroundSetupStatus.startedAt = new Date().toISOString();

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
          // FIX: Use atomic write (temp + rename) to prevent corruption
          try {
            const tempPath = `${setupMarker}.tmp.${Date.now()}`;
            await fs.writeFile(tempPath, new Date().toISOString());
            await fs.rename(tempPath, setupMarker);
          } catch (e) {
            logger.debug('[STARTUP] Could not create setup marker:', e.message);
          }
        }

        // HIGH-3 FIX: Mark background setup as complete
        backgroundSetupStatus.complete = true;
        backgroundSetupStatus.completedAt = new Date().toISOString();
        logger.info('[STARTUP] Background setup completed successfully');
      } catch (error) {
        // HIGH-3 FIX: Track error and notify renderer
        backgroundSetupStatus.error = error.message;
        backgroundSetupStatus.completedAt = new Date().toISOString();
        logger.error('[STARTUP] Background setup failed:', error);

        // Notify renderer of degraded state if window exists
        try {
          const win = BrowserWindow.getAllWindows()[0];
          if (win && !win.isDestroyed()) {
            win.webContents.send('startup-degraded', {
              reason: error.message,
              component: 'background-setup',
            });
          }
        } catch (notifyError) {
          logger.debug(
            '[STARTUP] Could not notify renderer of error:',
            notifyError.message,
          );
        }
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
      initializeTrayConfig({
        getDownloadWatcher: () => downloadWatcher,
        getSettingsService: () => settingsService,
        handleSettingsChanged,
        createWindow,
        setIsQuitting: (val) => {
          isQuitting = val;
        },
      });
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
      if (isWindows) {
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
        // Note: getMainWindow is already defined at line 566 and in scope here
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

    // Load Ollama config and apply any saved selections (LOW-3: renamed cfg to ollamaConfig)
    const ollamaConfig = await loadOllamaConfig();
    if (ollamaConfig.selectedTextModel)
      await setOllamaModel(ollamaConfig.selectedTextModel);
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

        // FIX: Store handler references for proper cleanup
        const autoUpdaterErrorHandler = (err) =>
          logger.error('[UPDATER] Error:', err);
        const autoUpdaterAvailableHandler = () => {
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
        };
        const autoUpdaterNotAvailableHandler = () => {
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
        };
        const autoUpdaterDownloadedHandler = () => {
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
        };

        autoUpdater.on('error', autoUpdaterErrorHandler);
        autoUpdater.on('update-available', autoUpdaterAvailableHandler);
        autoUpdater.on('update-not-available', autoUpdaterNotAvailableHandler);
        autoUpdater.on('update-downloaded', autoUpdaterDownloadedHandler);

        // FIX: Track autoUpdater listeners for cleanup
        eventListeners.push(() => {
          autoUpdater.removeListener('error', autoUpdaterErrorHandler);
          autoUpdater.removeListener(
            'update-available',
            autoUpdaterAvailableHandler,
          );
          autoUpdater.removeListener(
            'update-not-available',
            autoUpdaterNotAvailableHandler,
          );
          autoUpdater.removeListener(
            'update-downloaded',
            autoUpdaterDownloadedHandler,
          );
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

    // Clean up IPC listeners (CRITICAL FIX: use targeted cleanup via registry)
    try {
      const { removeAllRegistered } = require('./core/ipcRegistry');
      const stats = removeAllRegistered(ipcMain);
      logger.info(
        `[CLEANUP] IPC cleanup: ${stats.handlers} handlers, ${stats.listeners} listeners removed`,
      );
    } catch (error) {
      logger.error('[CLEANUP] Failed to remove IPC listeners:', error);
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
    if (chromaDbProcess) {
      const pid = chromaDbProcess.pid;
      logger.info(`[ChromaDB] Stopping ChromaDB server process (PID: ${pid})`);

      try {
        // Remove listeners before killing to avoid spurious error events
        chromaDbProcess.removeAllListeners();

        // Use async platform-aware process killing (no blocking execSync)
        const {
          killProcess,
          isProcessRunning,
        } = require('./core/platformBehavior');
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
  if (getTray() !== null) {
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
  // Use platform abstraction instead of direct isMacOS check
  const { shouldQuitOnAllWindowsClosed } = require('./core/platformBehavior');
  if (shouldQuitOnAllWindowsClosed()) {
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
// System tray is now handled by ./core/systemTray
// Functions createSystemTray and updateTrayMenu are imported
// tray variable is managed by the systemTray module (use getTray() to access)

// Resume service
const { resumeIncompleteBatches } = require('./services/OrganizeResumeService');

// Delete folder and its contents
