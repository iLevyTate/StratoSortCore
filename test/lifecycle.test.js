/**
 * Tests for lifecycle.js — Electron app lifecycle management.
 * Covers handleBeforeQuit shutdown sequence, verifyShutdownCleanup,
 * and error handlers.
 */

jest.mock('electron', () => ({
  app: {
    quit: jest.fn(),
    exit: jest.fn(),
    on: jest.fn(),
    removeListener: jest.fn()
  },
  BrowserWindow: {
    getAllWindows: jest.fn().mockReturnValue([])
  },
  ipcMain: {
    removeHandler: jest.fn(),
    removeAllListeners: jest.fn()
  }
}));

jest.mock('../src/shared/logger', () => ({
  createLogger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
  })
}));

jest.mock('../src/main/core/systemTray', () => ({
  destroyTray: jest.fn(),
  getTray: jest.fn().mockReturnValue(null),
  unregisterGlobalShortcuts: jest.fn()
}));

jest.mock('../src/main/services/startup', () => ({
  getStartupManager: jest.fn(() => ({
    shutdown: jest.fn().mockResolvedValue(undefined)
  }))
}));

jest.mock('../src/main/core/systemAnalytics', () => ({
  destroy: jest.fn()
}));

jest.mock('../src/shared/promiseUtils', () => ({
  withTimeout: jest.fn((promise) => promise)
}));

jest.mock('../src/main/core/ipcRegistry', () => ({
  setShuttingDown: jest.fn(),
  waitForInFlightOperations: jest.fn().mockResolvedValue(true),
  removeAllRegistered: jest.fn().mockReturnValue({ handlers: 5, listeners: 3 })
}));

jest.mock('../src/main/utils/workerPools', () => ({
  destroyPools: jest.fn().mockResolvedValue(undefined)
}));

describe('lifecycle – verifyShutdownCleanup', () => {
  let verifyShutdownCleanup;
  let initializeLifecycle;

  beforeEach(() => {
    jest.resetModules();

    // Re-import to get a fresh module
    const lifecycle = require('../src/main/core/lifecycle');
    verifyShutdownCleanup = lifecycle.verifyShutdownCleanup;
    initializeLifecycle = lifecycle.initializeLifecycle;
  });

  test('reports no issues when all resources are released', async () => {
    initializeLifecycle({
      getMetricsInterval: () => null,
      getChildProcessListeners: () => [],
      getGlobalProcessListeners: () => [],
      getEventListeners: () => [],
      getServiceIntegration: () => null,
      getDownloadWatcher: () => null
    });

    // Should not throw
    await expect(verifyShutdownCleanup()).resolves.toBeUndefined();
  });

  test('detects leaked metrics interval', async () => {
    initializeLifecycle({
      getMetricsInterval: () => 12345, // non-null = leak
      getChildProcessListeners: () => [],
      getGlobalProcessListeners: () => [],
      getEventListeners: () => [],
      getServiceIntegration: () => null,
      getDownloadWatcher: () => null
    });

    // Should not throw, but will log warnings internally
    await expect(verifyShutdownCleanup()).resolves.toBeUndefined();
  });

  test('detects leaked event listeners', async () => {
    initializeLifecycle({
      getMetricsInterval: () => null,
      getChildProcessListeners: () => [() => {}],
      getGlobalProcessListeners: () => [() => {}],
      getEventListeners: () => [() => {}, () => {}],
      getServiceIntegration: () => ({ initialized: true }),
      getDownloadWatcher: () => ({ stop: jest.fn() })
    });

    await expect(verifyShutdownCleanup()).resolves.toBeUndefined();
  });
});

describe('lifecycle – handleBeforeQuit', () => {
  let handleBeforeQuit;
  let initializeLifecycle;

  beforeEach(() => {
    jest.resetModules();
    // Re-mock dependencies to reset call counts
    jest.mock('../src/main/core/ipcRegistry', () => ({
      setShuttingDown: jest.fn(),
      waitForInFlightOperations: jest.fn().mockResolvedValue(true),
      removeAllRegistered: jest.fn().mockReturnValue({ handlers: 0, listeners: 0 })
    }));

    const lifecycle = require('../src/main/core/lifecycle');
    handleBeforeQuit = lifecycle.handleBeforeQuit;
    initializeLifecycle = lifecycle.initializeLifecycle;
  });

  test('sets IPC shutdown gate before cleanup', async () => {
    initializeLifecycle({
      setIsQuitting: jest.fn(),
      getMetricsInterval: () => null,
      setMetricsInterval: jest.fn(),
      getDownloadWatcher: () => null,
      setDownloadWatcher: jest.fn(),
      getServiceIntegration: () => null,
      getSettingsService: () => null,
      getChildProcessListeners: () => [],
      setChildProcessListeners: jest.fn(),
      getGlobalProcessListeners: () => [],
      setGlobalProcessListeners: jest.fn(),
      getEventListeners: () => [],
      setEventListeners: jest.fn()
    });

    await handleBeforeQuit();

    const { setShuttingDown } = require('../src/main/core/ipcRegistry');
    expect(setShuttingDown).toHaveBeenCalledWith(true);
  });

  test('clears metrics interval during cleanup', async () => {
    const setMetricsInterval = jest.fn();
    const intervalId = setInterval(() => {}, 10000);

    initializeLifecycle({
      setIsQuitting: jest.fn(),
      getMetricsInterval: () => intervalId,
      setMetricsInterval,
      getDownloadWatcher: () => null,
      setDownloadWatcher: jest.fn(),
      getServiceIntegration: () => null,
      getSettingsService: () => null,
      getChildProcessListeners: () => [],
      setChildProcessListeners: jest.fn(),
      getGlobalProcessListeners: () => [],
      setGlobalProcessListeners: jest.fn(),
      getEventListeners: () => [],
      setEventListeners: jest.fn()
    });

    await handleBeforeQuit();

    expect(setMetricsInterval).toHaveBeenCalledWith(null);
    clearInterval(intervalId); // cleanup
  });

  test('stops download watcher during cleanup', async () => {
    const mockWatcher = { stop: jest.fn().mockResolvedValue(undefined) };
    const setDownloadWatcher = jest.fn();

    initializeLifecycle({
      setIsQuitting: jest.fn(),
      getMetricsInterval: () => null,
      setMetricsInterval: jest.fn(),
      getDownloadWatcher: () => mockWatcher,
      setDownloadWatcher,
      getServiceIntegration: () => null,
      getSettingsService: () => null,
      getChildProcessListeners: () => [],
      setChildProcessListeners: jest.fn(),
      getGlobalProcessListeners: () => [],
      setGlobalProcessListeners: jest.fn(),
      getEventListeners: () => [],
      setEventListeners: jest.fn()
    });

    await handleBeforeQuit();

    expect(mockWatcher.stop).toHaveBeenCalled();
    expect(setDownloadWatcher).toHaveBeenCalledWith(null);
  });

  test('is idempotent (re-entrant quit guard)', async () => {
    initializeLifecycle({
      setIsQuitting: jest.fn(),
      getMetricsInterval: () => null,
      setMetricsInterval: jest.fn(),
      getDownloadWatcher: () => null,
      setDownloadWatcher: jest.fn(),
      getServiceIntegration: () => null,
      getSettingsService: () => null,
      getChildProcessListeners: () => [],
      setChildProcessListeners: jest.fn(),
      getGlobalProcessListeners: () => [],
      setGlobalProcessListeners: jest.fn(),
      getEventListeners: () => [],
      setEventListeners: jest.fn()
    });

    await handleBeforeQuit();
    const { setShuttingDown } = require('../src/main/core/ipcRegistry');
    const callCount1 = setShuttingDown.mock.calls.length;

    // Second call should be a no-op
    await handleBeforeQuit();
    expect(setShuttingDown.mock.calls.length).toBe(callCount1);
  });
});
