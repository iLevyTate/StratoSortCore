/**
 * Tests for Application Lifecycle Management
 * Tests app lifecycle events including shutdown, cleanup, and error handling
 */

// Mock electron
jest.mock('electron', () => ({
  app: {
    on: jest.fn(),
    removeListener: jest.fn(),
    quit: jest.fn()
  },
  BrowserWindow: {
    getAllWindows: jest.fn(() => [])
  },
  ipcMain: {
    removeAllListeners: jest.fn()
  }
}));

// Mock logger
jest.mock('../src/shared/logger', () => ({
  logger: {
    setContext: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  }
}));

// Mock performance constants
jest.mock('../src/shared/performanceConstants', () => ({
  TIMEOUTS: {
    PROCESS_KILL_VERIFY: 100
  }
}));

// Mock systemTray
jest.mock('../src/main/core/systemTray', () => ({
  destroyTray: jest.fn(),
  getTray: jest.fn(() => null)
}));

// Mock startup manager
jest.mock('../src/main/services/startup', () => ({
  getStartupManager: jest.fn(() => ({
    shutdown: jest.fn().mockResolvedValue(undefined)
  }))
}));

// Mock systemAnalytics
jest.mock('../src/main/core/systemAnalytics', () => ({
  destroy: jest.fn()
}));

// Mock platformBehavior
jest.mock('../src/main/core/platformBehavior', () => ({
  shouldQuitOnAllWindowsClosed: jest.fn(() => true),
  killProcess: jest.fn().mockResolvedValue({ success: true }),
  isProcessRunning: jest.fn(() => false)
}));

// Mock ipcRegistry
jest.mock('../src/main/core/ipcRegistry', () => ({
  removeAllRegistered: jest.fn(() => ({ handlers: 5, listeners: 3 }))
}));

// Mock chromadb
jest.mock('../src/main/ipc/chromadb', () => ({
  cleanupEventListeners: jest.fn()
}));

describe('Lifecycle', () => {
  let lifecycle;
  let app;
  let BrowserWindow;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
    jest.useFakeTimers();

    // Re-require modules after reset
    const electron = require('electron');
    app = electron.app;
    BrowserWindow = electron.BrowserWindow;

    lifecycle = require('../src/main/core/lifecycle');
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('initializeLifecycle', () => {
    test('initializes lifecycle configuration', () => {
      const config = {
        getMetricsInterval: jest.fn(() => null),
        setMetricsInterval: jest.fn(),
        getDownloadWatcher: jest.fn(() => null),
        setDownloadWatcher: jest.fn()
      };

      lifecycle.initializeLifecycle(config);

      // Initialization should not throw
      expect(() => lifecycle.initializeLifecycle(config)).not.toThrow();
    });

    test('merges config with defaults', () => {
      const partialConfig = {
        getMetricsInterval: jest.fn(() => 123)
      };

      lifecycle.initializeLifecycle(partialConfig);

      // Should not throw when only partial config is provided
      expect(() => lifecycle.initializeLifecycle(partialConfig)).not.toThrow();
    });
  });

  describe('handleWindowAllClosed', () => {
    test('quits app when shouldQuitOnAllWindowsClosed returns true', () => {
      const { shouldQuitOnAllWindowsClosed } = require('../src/main/core/platformBehavior');
      shouldQuitOnAllWindowsClosed.mockReturnValue(true);

      lifecycle.initializeLifecycle({
        getSettingsService: jest.fn(() => ({ get: () => false }))
      });

      lifecycle.handleWindowAllClosed();

      expect(app.quit).toHaveBeenCalled();
    });

    test('does not quit when background mode is enabled', () => {
      const { shouldQuitOnAllWindowsClosed } = require('../src/main/core/platformBehavior');
      shouldQuitOnAllWindowsClosed.mockReturnValue(true);

      lifecycle.initializeLifecycle({
        getSettingsService: jest.fn(() => ({
          get: (key) => (key === 'backgroundMode' ? true : false)
        }))
      });

      lifecycle.handleWindowAllClosed();

      expect(app.quit).not.toHaveBeenCalled();
    });

    test('does not quit on macOS when shouldQuitOnAllWindowsClosed returns false', () => {
      const { shouldQuitOnAllWindowsClosed } = require('../src/main/core/platformBehavior');
      shouldQuitOnAllWindowsClosed.mockReturnValue(false);

      lifecycle.initializeLifecycle({
        getSettingsService: jest.fn(() => ({ get: () => false }))
      });

      lifecycle.handleWindowAllClosed();

      expect(app.quit).not.toHaveBeenCalled();
    });
  });

  describe('handleActivate', () => {
    test('creates window when no windows exist', () => {
      BrowserWindow.getAllWindows.mockReturnValue([]);
      const createWindow = jest.fn();

      lifecycle.handleActivate(createWindow);

      expect(createWindow).toHaveBeenCalled();
    });

    test('does not create window when windows exist', () => {
      BrowserWindow.getAllWindows.mockReturnValue([{ id: 1 }]);
      const createWindow = jest.fn();

      lifecycle.handleActivate(createWindow);

      expect(createWindow).not.toHaveBeenCalled();
    });
  });

  describe('handleUncaughtException', () => {
    test('logs uncaught exceptions', () => {
      const { logger } = require('../src/shared/logger');
      const error = new Error('Test uncaught exception');

      lifecycle.handleUncaughtException(error);

      expect(logger.error).toHaveBeenCalledWith(
        'UNCAUGHT EXCEPTION:',
        expect.objectContaining({
          message: 'Test uncaught exception',
          stack: expect.any(String)
        })
      );
    });
  });

  describe('handleUnhandledRejection', () => {
    test('logs unhandled rejections', () => {
      const { logger } = require('../src/shared/logger');
      const reason = 'Test rejection reason';
      const promise = Promise.reject(reason).catch(() => {}); // Prevent actual rejection

      lifecycle.handleUnhandledRejection(reason, promise);

      expect(logger.error).toHaveBeenCalledWith(
        'UNHANDLED REJECTION',
        expect.objectContaining({
          reason: 'Test rejection reason'
        })
      );
    });
  });

  describe('registerLifecycleHandlers', () => {
    test('registers all lifecycle event handlers', () => {
      const createWindow = jest.fn();

      const cleanup = lifecycle.registerLifecycleHandlers(createWindow);

      expect(app.on).toHaveBeenCalledWith('before-quit', expect.any(Function));
      expect(app.on).toHaveBeenCalledWith('window-all-closed', expect.any(Function));
      expect(app.on).toHaveBeenCalledWith('activate', expect.any(Function));
      expect(cleanup).toHaveProperty('cleanupAppListeners');
      expect(cleanup).toHaveProperty('cleanupProcessListeners');
    });

    test('returns cleanup functions', () => {
      const createWindow = jest.fn();

      const cleanup = lifecycle.registerLifecycleHandlers(createWindow);

      expect(typeof cleanup.cleanupAppListeners).toBe('function');
      expect(typeof cleanup.cleanupProcessListeners).toBe('function');
    });

    test('cleanupAppListeners removes app event listeners', () => {
      const createWindow = jest.fn();

      const cleanup = lifecycle.registerLifecycleHandlers(createWindow);
      cleanup.cleanupAppListeners();

      expect(app.removeListener).toHaveBeenCalledWith('before-quit', expect.any(Function));
      expect(app.removeListener).toHaveBeenCalledWith('window-all-closed', expect.any(Function));
      expect(app.removeListener).toHaveBeenCalledWith('activate', expect.any(Function));
    });
  });

  describe('handleBeforeQuit', () => {
    beforeEach(() => {
      lifecycle.initializeLifecycle({
        setIsQuitting: jest.fn(),
        getMetricsInterval: jest.fn(() => null),
        setMetricsInterval: jest.fn(),
        getDownloadWatcher: jest.fn(() => null),
        setDownloadWatcher: jest.fn(),
        getChildProcessListeners: jest.fn(() => []),
        setChildProcessListeners: jest.fn(),
        getGlobalProcessListeners: jest.fn(() => []),
        setGlobalProcessListeners: jest.fn(),
        getEventListeners: jest.fn(() => []),
        setEventListeners: jest.fn(),
        getChromaDbProcess: jest.fn(() => null),
        setChromaDbProcess: jest.fn(),
        getServiceIntegration: jest.fn(() => null),
        getSettingsService: jest.fn(() => null)
      });
    });

    test('sets isQuitting flag', async () => {
      const setIsQuitting = jest.fn();
      lifecycle.initializeLifecycle({
        setIsQuitting,
        getMetricsInterval: () => null,
        setMetricsInterval: jest.fn(),
        getDownloadWatcher: () => null,
        getChildProcessListeners: () => [],
        setChildProcessListeners: jest.fn(),
        getGlobalProcessListeners: () => [],
        setGlobalProcessListeners: jest.fn(),
        getEventListeners: () => [],
        setEventListeners: jest.fn(),
        getChromaDbProcess: () => null,
        getServiceIntegration: () => null,
        getSettingsService: () => null
      });

      const promise = lifecycle.handleBeforeQuit();
      jest.runAllTimers();
      await promise;

      expect(setIsQuitting).toHaveBeenCalledWith(true);
    });

    test('clears metrics interval', async () => {
      const interval = setInterval(() => {}, 1000);
      const setMetricsInterval = jest.fn();

      lifecycle.initializeLifecycle({
        setIsQuitting: jest.fn(),
        getMetricsInterval: () => interval,
        setMetricsInterval,
        getDownloadWatcher: () => null,
        getChildProcessListeners: () => [],
        setChildProcessListeners: jest.fn(),
        getGlobalProcessListeners: () => [],
        setGlobalProcessListeners: jest.fn(),
        getEventListeners: () => [],
        setEventListeners: jest.fn(),
        getChromaDbProcess: () => null,
        getServiceIntegration: () => null,
        getSettingsService: () => null
      });

      const promise = lifecycle.handleBeforeQuit();
      jest.runAllTimers();
      await promise;

      expect(setMetricsInterval).toHaveBeenCalledWith(null);
    });

    test('stops download watcher', async () => {
      const downloadWatcher = { stop: jest.fn() };
      const setDownloadWatcher = jest.fn();

      lifecycle.initializeLifecycle({
        setIsQuitting: jest.fn(),
        getMetricsInterval: () => null,
        setMetricsInterval: jest.fn(),
        getDownloadWatcher: () => downloadWatcher,
        setDownloadWatcher,
        getChildProcessListeners: () => [],
        setChildProcessListeners: jest.fn(),
        getGlobalProcessListeners: () => [],
        setGlobalProcessListeners: jest.fn(),
        getEventListeners: () => [],
        setEventListeners: jest.fn(),
        getChromaDbProcess: () => null,
        getServiceIntegration: () => null,
        getSettingsService: () => null
      });

      const promise = lifecycle.handleBeforeQuit();
      jest.runAllTimers();
      await promise;

      expect(downloadWatcher.stop).toHaveBeenCalled();
      expect(setDownloadWatcher).toHaveBeenCalledWith(null);
    });

    test('executes child process cleanup functions', async () => {
      const cleanup1 = jest.fn();
      const cleanup2 = jest.fn();
      const setChildProcessListeners = jest.fn();

      lifecycle.initializeLifecycle({
        setIsQuitting: jest.fn(),
        getMetricsInterval: () => null,
        setMetricsInterval: jest.fn(),
        getDownloadWatcher: () => null,
        getChildProcessListeners: () => [cleanup1, cleanup2],
        setChildProcessListeners,
        getGlobalProcessListeners: () => [],
        setGlobalProcessListeners: jest.fn(),
        getEventListeners: () => [],
        setEventListeners: jest.fn(),
        getChromaDbProcess: () => null,
        getServiceIntegration: () => null,
        getSettingsService: () => null
      });

      const promise = lifecycle.handleBeforeQuit();
      jest.runAllTimers();
      await promise;

      expect(cleanup1).toHaveBeenCalled();
      expect(cleanup2).toHaveBeenCalled();
      expect(setChildProcessListeners).toHaveBeenCalledWith([]);
    });

    test('destroys system tray', async () => {
      const { destroyTray } = require('../src/main/core/systemTray');

      lifecycle.initializeLifecycle({
        setIsQuitting: jest.fn(),
        getMetricsInterval: () => null,
        setMetricsInterval: jest.fn(),
        getDownloadWatcher: () => null,
        getChildProcessListeners: () => [],
        setChildProcessListeners: jest.fn(),
        getGlobalProcessListeners: () => [],
        setGlobalProcessListeners: jest.fn(),
        getEventListeners: () => [],
        setEventListeners: jest.fn(),
        getChromaDbProcess: () => null,
        getServiceIntegration: () => null,
        getSettingsService: () => null
      });

      const promise = lifecycle.handleBeforeQuit();
      jest.runAllTimers();
      await promise;

      expect(destroyTray).toHaveBeenCalled();
    });

    test('shuts down service integration', async () => {
      const serviceIntegration = { shutdown: jest.fn().mockResolvedValue(undefined) };

      lifecycle.initializeLifecycle({
        setIsQuitting: jest.fn(),
        getMetricsInterval: () => null,
        setMetricsInterval: jest.fn(),
        getDownloadWatcher: () => null,
        getChildProcessListeners: () => [],
        setChildProcessListeners: jest.fn(),
        getGlobalProcessListeners: () => [],
        setGlobalProcessListeners: jest.fn(),
        getEventListeners: () => [],
        setEventListeners: jest.fn(),
        getChromaDbProcess: () => null,
        getServiceIntegration: () => serviceIntegration,
        getSettingsService: () => null
      });

      const promise = lifecycle.handleBeforeQuit();
      jest.runAllTimers();
      await promise;

      expect(serviceIntegration.shutdown).toHaveBeenCalled();
    });

    test('shuts down settings service', async () => {
      const settingsService = { shutdown: jest.fn() };

      lifecycle.initializeLifecycle({
        setIsQuitting: jest.fn(),
        getMetricsInterval: () => null,
        setMetricsInterval: jest.fn(),
        getDownloadWatcher: () => null,
        getChildProcessListeners: () => [],
        setChildProcessListeners: jest.fn(),
        getGlobalProcessListeners: () => [],
        setGlobalProcessListeners: jest.fn(),
        getEventListeners: () => [],
        setEventListeners: jest.fn(),
        getChromaDbProcess: () => null,
        getServiceIntegration: () => null,
        getSettingsService: () => settingsService
      });

      const promise = lifecycle.handleBeforeQuit();
      jest.runAllTimers();
      await promise;

      expect(settingsService.shutdown).toHaveBeenCalled();
    });

    test('handles cleanup errors gracefully', async () => {
      const { logger } = require('../src/shared/logger');
      const downloadWatcher = {
        stop: jest.fn(() => {
          throw new Error('Stop failed');
        })
      };

      lifecycle.initializeLifecycle({
        setIsQuitting: jest.fn(),
        getMetricsInterval: () => null,
        setMetricsInterval: jest.fn(),
        getDownloadWatcher: () => downloadWatcher,
        setDownloadWatcher: jest.fn(),
        getChildProcessListeners: () => [],
        setChildProcessListeners: jest.fn(),
        getGlobalProcessListeners: () => [],
        setGlobalProcessListeners: jest.fn(),
        getEventListeners: () => [],
        setEventListeners: jest.fn(),
        getChromaDbProcess: () => null,
        getServiceIntegration: () => null,
        getSettingsService: () => null
      });

      const promise = lifecycle.handleBeforeQuit();
      jest.runAllTimers();
      await promise;

      // Should log error but not throw
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('verifyShutdownCleanup', () => {
    test('logs success when all resources are released', async () => {
      const { logger } = require('../src/shared/logger');

      lifecycle.initializeLifecycle({
        getMetricsInterval: () => null,
        getChildProcessListeners: () => [],
        getGlobalProcessListeners: () => [],
        getEventListeners: () => [],
        getChromaDbProcess: () => null,
        getServiceIntegration: () => null,
        getDownloadWatcher: () => null
      });

      await lifecycle.verifyShutdownCleanup();

      expect(logger.info).toHaveBeenCalledWith(
        '[SHUTDOWN-VERIFY] All resources verified as released'
      );
    });

    test('warns about unreleased metrics interval', async () => {
      const { logger } = require('../src/shared/logger');
      const interval = setInterval(() => {}, 1000);

      lifecycle.initializeLifecycle({
        getMetricsInterval: () => interval,
        getChildProcessListeners: () => [],
        getGlobalProcessListeners: () => [],
        getEventListeners: () => [],
        getChromaDbProcess: () => null,
        getServiceIntegration: () => null,
        getDownloadWatcher: () => null
      });

      await lifecycle.verifyShutdownCleanup();

      expect(logger.warn).toHaveBeenCalled();
      clearInterval(interval);
    });

    test('warns about remaining event listeners', async () => {
      const { logger } = require('../src/shared/logger');

      lifecycle.initializeLifecycle({
        getMetricsInterval: () => null,
        getChildProcessListeners: () => [],
        getGlobalProcessListeners: () => [],
        getEventListeners: () => [jest.fn()],
        getChromaDbProcess: () => null,
        getServiceIntegration: () => null,
        getDownloadWatcher: () => null
      });

      await lifecycle.verifyShutdownCleanup();

      expect(logger.warn).toHaveBeenCalled();
    });
  });
});
