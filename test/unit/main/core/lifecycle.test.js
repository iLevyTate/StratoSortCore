/**
 * Tests for core/lifecycle module
 *
 * Tests application lifecycle management including shutdown,
 * cleanup, and error handling.
 */

// Store mock references at module level
const mockApp = {
  on: jest.fn(),
  removeListener: jest.fn(),
  quit: jest.fn(),
};

const mockGetAllWindows = jest.fn(() => []);

// Mock electron modules BEFORE requiring anything
jest.mock('electron', () => ({
  app: mockApp,
  BrowserWindow: {
    getAllWindows: mockGetAllWindows,
  },
  ipcMain: {
    removeHandler: jest.fn(),
    removeListener: jest.fn(),
  },
}));

// Mock dependencies
jest.mock('../../../../src/shared/logger', () => ({
  logger: {
    setContext: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

jest.mock('../../../../src/main/core/systemTray', () => ({
  destroyTray: jest.fn(),
  getTray: jest.fn(() => null),
}));

jest.mock('../../../../src/main/services/startup', () => ({
  getStartupManager: jest.fn(() => ({
    shutdown: jest.fn().mockResolvedValue(undefined),
  })),
}));

jest.mock('../../../../src/main/core/systemAnalytics', () => ({
  destroy: jest.fn(),
}));

jest.mock('../../../../src/main/core/ipcRegistry', () => ({
  removeAllRegistered: jest.fn(() => ({ handlers: 0, listeners: 0 })),
}));

jest.mock('../../../../src/main/ipc/chromadb', () => ({
  cleanupEventListeners: jest.fn(),
}));

const mockShouldQuit = jest.fn(() => true);
jest.mock('../../../../src/main/core/platformBehavior', () => ({
  shouldQuitOnAllWindowsClosed: mockShouldQuit,
  killProcess: jest.fn().mockResolvedValue({ success: true }),
  isProcessRunning: jest.fn(() => false),
}));

const lifecycle = require('../../../../src/main/core/lifecycle');

describe('lifecycle module', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('initializeLifecycle', () => {
    it('should accept configuration object', () => {
      const config = {
        getMetricsInterval: jest.fn(),
        setMetricsInterval: jest.fn(),
      };

      expect(() => lifecycle.initializeLifecycle(config)).not.toThrow();
    });
  });

  describe('registerLifecycleHandlers', () => {
    it('should register all lifecycle handlers', () => {
      const createWindow = jest.fn();

      const cleanup = lifecycle.registerLifecycleHandlers(createWindow);

      // Should register app handlers
      expect(mockApp.on).toHaveBeenCalledWith(
        'before-quit',
        expect.any(Function),
      );
      expect(mockApp.on).toHaveBeenCalledWith(
        'window-all-closed',
        expect.any(Function),
      );
      expect(mockApp.on).toHaveBeenCalledWith('activate', expect.any(Function));

      // Should return cleanup functions
      expect(cleanup).toHaveProperty('cleanupAppListeners');
      expect(cleanup).toHaveProperty('cleanupProcessListeners');
      expect(typeof cleanup.cleanupAppListeners).toBe('function');
      expect(typeof cleanup.cleanupProcessListeners).toBe('function');
    });

    it('should return working cleanup functions', () => {
      const createWindow = jest.fn();
      const cleanup = lifecycle.registerLifecycleHandlers(createWindow);

      // Execute cleanup
      cleanup.cleanupAppListeners();
      cleanup.cleanupProcessListeners();

      // Should remove listeners
      expect(mockApp.removeListener).toHaveBeenCalled();
    });
  });

  describe('handleWindowAllClosed', () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('should quit app on non-macOS platforms', () => {
      mockShouldQuit.mockReturnValue(true);

      lifecycle.handleWindowAllClosed();

      expect(mockApp.quit).toHaveBeenCalled();
    });

    it('should not quit app on macOS', () => {
      mockShouldQuit.mockReturnValue(false);

      lifecycle.handleWindowAllClosed();

      expect(mockApp.quit).not.toHaveBeenCalled();
    });
  });

  describe('handleActivate', () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('should create window when no windows exist', () => {
      mockGetAllWindows.mockReturnValue([]);
      const createWindow = jest.fn();

      lifecycle.handleActivate(createWindow);

      expect(createWindow).toHaveBeenCalled();
    });

    it('should not create window when windows exist', () => {
      mockGetAllWindows.mockReturnValue([{ id: 1 }]);
      const createWindow = jest.fn();

      lifecycle.handleActivate(createWindow);

      expect(createWindow).not.toHaveBeenCalled();
    });
  });

  describe('handleUncaughtException', () => {
    it('should log error details', () => {
      const { logger } = require('../../../../src/shared/logger');
      const error = new Error('Test error');

      lifecycle.handleUncaughtException(error);

      expect(logger.error).toHaveBeenCalledWith('UNCAUGHT EXCEPTION:', {
        message: 'Test error',
        stack: expect.any(String),
      });
    });
  });

  describe('handleUnhandledRejection', () => {
    it('should log rejection details', () => {
      const { logger } = require('../../../../src/shared/logger');
      const reason = 'Test rejection reason';
      const promise = Promise.reject(reason).catch(() => {}); // Catch to prevent unhandled rejection

      lifecycle.handleUnhandledRejection(reason, promise);

      expect(logger.error).toHaveBeenCalledWith('UNHANDLED REJECTION', {
        reason: 'Test rejection reason',
        promise: expect.any(String),
      });
    });
  });

  describe('verifyShutdownCleanup', () => {
    it('should verify all resources are released', async () => {
      const { logger } = require('../../../../src/shared/logger');

      // Initialize with clean state
      lifecycle.initializeLifecycle({
        getMetricsInterval: () => null,
        getChildProcessListeners: () => [],
        getGlobalProcessListeners: () => [],
        getEventListeners: () => [],
        getChromaDbProcess: () => null,
        getServiceIntegration: () => null,
        getDownloadWatcher: () => null,
      });

      await lifecycle.verifyShutdownCleanup();

      expect(logger.info).toHaveBeenCalledWith(
        '[SHUTDOWN-VERIFY] All resources verified as released',
      );
    });

    it('should report resource leaks', async () => {
      const { logger } = require('../../../../src/shared/logger');

      // Initialize with leaked resources
      lifecycle.initializeLifecycle({
        getMetricsInterval: () => setInterval(() => {}, 1000),
        getChildProcessListeners: () => [jest.fn()],
        getGlobalProcessListeners: () => [],
        getEventListeners: () => [],
        getChromaDbProcess: () => null,
        getServiceIntegration: () => null,
        getDownloadWatcher: () => null,
      });

      await lifecycle.verifyShutdownCleanup();

      expect(logger.warn).toHaveBeenCalled();
    });
  });
});
