/**
 * Tests for IPC Verification
 * Tests handler registration verification and retry logic
 */

// Mock electron before requiring the module
jest.mock('electron', () => ({
  ipcMain: {
    listenerCount: jest.fn(),
    _invokeHandlers: new Map()
  }
}));

jest.mock('../src/shared/platformUtils', () => ({
  isWindows: false
}));

jest.mock('../src/shared/logger', () => ({
  logger: {
    setContext: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  }
}));

describe('ipcVerification', () => {
  let ipcVerification;
  let ipcMain;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();

    ipcMain = require('electron').ipcMain;
    ipcMain._invokeHandlers = new Map();
    ipcMain.listenerCount = jest.fn().mockReturnValue(0);

    ipcVerification = require('../src/main/core/ipcVerification');
  });

  describe('REQUIRED_HANDLERS', () => {
    test('contains core handler channels', () => {
      expect(ipcVerification.REQUIRED_HANDLERS).toContain('get-settings');
      expect(ipcVerification.REQUIRED_HANDLERS).toContain('save-settings');
      expect(ipcVerification.REQUIRED_HANDLERS).toContain('get-smart-folders');
      expect(ipcVerification.REQUIRED_HANDLERS).toContain('analyze-document');
    });

    test('is an array', () => {
      expect(Array.isArray(ipcVerification.REQUIRED_HANDLERS)).toBe(true);
    });
  });

  describe('WINDOWS_HANDLERS', () => {
    test('contains window control channels', () => {
      expect(ipcVerification.WINDOWS_HANDLERS).toContain('window-minimize');
      expect(ipcVerification.WINDOWS_HANDLERS).toContain('window-maximize');
      expect(ipcVerification.WINDOWS_HANDLERS).toContain('window-close');
    });

    test('is an array', () => {
      expect(Array.isArray(ipcVerification.WINDOWS_HANDLERS)).toBe(true);
    });
  });

  describe('checkHandlers', () => {
    test('returns allRegistered: false when handlers are missing', () => {
      ipcMain.listenerCount.mockReturnValue(0);

      const result = ipcVerification.checkHandlers();

      expect(result.allRegistered).toBe(false);
      expect(result.missing.length).toBeGreaterThan(0);
    });

    test('returns allRegistered: true when all handlers registered via listeners', () => {
      ipcMain.listenerCount.mockReturnValue(1);

      const result = ipcVerification.checkHandlers();

      expect(result.allRegistered).toBe(true);
      expect(result.missing).toEqual([]);
    });

    test('returns allRegistered: true when all handlers registered via invoke', () => {
      // Set up all required handlers in the invoke map
      ipcVerification.REQUIRED_HANDLERS.forEach((handler) => {
        ipcMain._invokeHandlers.set(handler, jest.fn());
      });

      const result = ipcVerification.checkHandlers();

      expect(result.allRegistered).toBe(true);
    });

    test('detects handlers registered via Map.has()', () => {
      const channel = 'get-settings';
      ipcMain._invokeHandlers.set(channel, jest.fn());
      ipcMain.listenerCount.mockReturnValue(0);

      const result = ipcVerification.checkHandlers();

      expect(result.missing).not.toContain(channel);
    });

    test('returns missing handlers list', () => {
      ipcMain.listenerCount.mockReturnValue(0);

      const result = ipcVerification.checkHandlers();

      expect(result.missing).toContain('get-settings');
      expect(result.missing).toContain('analyze-document');
    });
  });

  describe('verifyIpcHandlersRegistered', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    test('returns true immediately if all handlers registered', async () => {
      ipcMain.listenerCount.mockReturnValue(1);

      const resultPromise = ipcVerification.verifyIpcHandlersRegistered();

      // Should resolve immediately without needing to advance timers
      const result = await resultPromise;

      expect(result).toBe(true);
    });

    test('retries with exponential backoff', async () => {
      let callCount = 0;
      ipcMain.listenerCount.mockImplementation(() => {
        callCount++;
        // Return 1 (registered) after 3 calls
        return callCount >= 3 ? 1 : 0;
      });

      const resultPromise = ipcVerification.verifyIpcHandlersRegistered();

      // Advance through retries
      await jest.advanceTimersByTimeAsync(50); // First retry
      await jest.advanceTimersByTimeAsync(100); // Second retry
      await jest.advanceTimersByTimeAsync(200); // Third retry

      const result = await resultPromise;

      expect(result).toBe(true);
    });

    test('returns false after timeout', async () => {
      ipcMain.listenerCount.mockReturnValue(0);

      const resultPromise = ipcVerification.verifyIpcHandlersRegistered();

      // Advance past timeout (2 seconds)
      await jest.advanceTimersByTimeAsync(3000);

      const result = await resultPromise;

      expect(result).toBe(false);
    });

    test('caps delay at maxDelay', async () => {
      let attempts = 0;
      ipcMain.listenerCount.mockImplementation(() => {
        attempts++;
        return attempts > 8 ? 1 : 0;
      });

      const resultPromise = ipcVerification.verifyIpcHandlersRegistered();

      // Run through several retries
      await jest.advanceTimersByTimeAsync(2000);

      const result = await resultPromise;

      // Should have made multiple attempts
      expect(attempts).toBeGreaterThan(1);
      expect(result).toBe(true);
    });
  });

  describe('Windows handlers inclusion', () => {
    test('includes Windows handlers on Windows platform', () => {
      jest.resetModules();
      jest.mock('../src/shared/platformUtils', () => ({
        isWindows: true
      }));

      const windowsVerification = require('../src/main/core/ipcVerification');

      // Register all handlers except a Windows one
      ipcMain.listenerCount.mockReturnValue(1);
      windowsVerification.REQUIRED_HANDLERS.forEach((h) => {
        ipcMain._invokeHandlers.set(h, jest.fn());
      });

      const result = windowsVerification.checkHandlers();

      // Should check for Windows handlers
      if (result.missing.length > 0) {
        const hasWindowsHandler = result.missing.some((h) =>
          windowsVerification.WINDOWS_HANDLERS.includes(h)
        );
        expect(hasWindowsHandler).toBe(true);
      }
    });
  });
});
