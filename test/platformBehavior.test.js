/**
 * Tests for platformBehavior
 * Tests cross-platform window and process management
 */

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

// Mock timingConstants
jest.mock('../src/main/core/timingConstants', () => ({
  WINDOW: {
    ALWAYS_ON_TOP_DURATION_MS: 50
  },
  PROCESS: {
    KILL_COMMAND_TIMEOUT_MS: 100,
    GRACEFUL_SHUTDOWN_WAIT_MS: 100
  }
}));

// Store platform state for tests
let mockIsWindows = false;
let mockIsMacOS = false;

// Mock platformUtils
jest.mock('../src/shared/platformUtils', () => ({
  get isWindows() {
    return mockIsWindows;
  },
  get isMacOS() {
    return mockIsMacOS;
  }
}));

// Mock asyncSpawnUtils
jest.mock('../src/main/utils/asyncSpawnUtils', () => ({
  asyncSpawn: jest.fn()
}));

describe('platformBehavior', () => {
  let platformBehavior;
  let asyncSpawnUtils;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
    jest.useFakeTimers();

    // Reset platform flags
    mockIsWindows = false;
    mockIsMacOS = false;

    asyncSpawnUtils = require('../src/main/utils/asyncSpawnUtils');
    platformBehavior = require('../src/main/core/platformBehavior');
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('bringWindowToForeground', () => {
    test('focuses window on non-Windows platforms', () => {
      mockIsWindows = false;
      jest.resetModules();
      platformBehavior = require('../src/main/core/platformBehavior');

      const mockWindow = {
        isDestroyed: jest.fn().mockReturnValue(false),
        setAlwaysOnTop: jest.fn(),
        focus: jest.fn()
      };

      platformBehavior.bringWindowToForeground(mockWindow);

      expect(mockWindow.focus).toHaveBeenCalled();
      expect(mockWindow.setAlwaysOnTop).not.toHaveBeenCalled();
    });

    test('uses setAlwaysOnTop trick on Windows', () => {
      mockIsWindows = true;
      jest.resetModules();
      platformBehavior = require('../src/main/core/platformBehavior');

      const mockWindow = {
        isDestroyed: jest.fn().mockReturnValue(false),
        setAlwaysOnTop: jest.fn(),
        focus: jest.fn()
      };

      platformBehavior.bringWindowToForeground(mockWindow);

      expect(mockWindow.setAlwaysOnTop).toHaveBeenCalledWith(true);
      expect(mockWindow.focus).toHaveBeenCalled();

      // Fast-forward timer
      jest.advanceTimersByTime(100);

      expect(mockWindow.setAlwaysOnTop).toHaveBeenCalledWith(false);
    });

    test('handles null window gracefully', () => {
      expect(() => {
        platformBehavior.bringWindowToForeground(null);
      }).not.toThrow();
    });

    test('handles destroyed window gracefully', () => {
      const mockWindow = {
        isDestroyed: jest.fn().mockReturnValue(true),
        setAlwaysOnTop: jest.fn(),
        focus: jest.fn()
      };

      platformBehavior.bringWindowToForeground(mockWindow);

      expect(mockWindow.focus).not.toHaveBeenCalled();
    });

    test('does not reset alwaysOnTop if window destroyed during timeout', () => {
      mockIsWindows = true;
      jest.resetModules();
      platformBehavior = require('../src/main/core/platformBehavior');

      const mockWindow = {
        isDestroyed: jest.fn().mockReturnValue(false),
        setAlwaysOnTop: jest.fn(),
        focus: jest.fn()
      };

      platformBehavior.bringWindowToForeground(mockWindow);

      // Window becomes destroyed
      mockWindow.isDestroyed.mockReturnValue(true);

      // Fast-forward timer
      jest.advanceTimersByTime(100);

      // Should not call setAlwaysOnTop(false) on destroyed window
      expect(mockWindow.setAlwaysOnTop).toHaveBeenCalledTimes(1);
    });
  });

  describe('killProcess', () => {
    test('returns error for invalid PID', async () => {
      const result = await platformBehavior.killProcess(null);

      expect(result.success).toBe(false);
      expect(result.error.message).toBe('Invalid PID');
    });

    test('returns error for non-number PID', async () => {
      const result = await platformBehavior.killProcess('1234');

      expect(result.success).toBe(false);
      expect(result.error.message).toBe('Invalid PID');
    });

    test('uses taskkill on Windows', async () => {
      mockIsWindows = true;
      jest.resetModules();
      asyncSpawnUtils = require('../src/main/utils/asyncSpawnUtils');
      platformBehavior = require('../src/main/core/platformBehavior');

      asyncSpawnUtils.asyncSpawn.mockResolvedValue({
        status: 0,
        stdout: 'SUCCESS',
        stderr: ''
      });

      const result = await platformBehavior.killProcess(1234);

      expect(result.success).toBe(true);
      expect(asyncSpawnUtils.asyncSpawn).toHaveBeenCalledWith(
        'taskkill',
        ['/pid', '1234', '/f', '/t'],
        expect.any(Object)
      );
    });

    test('handles taskkill failure', async () => {
      mockIsWindows = true;
      jest.resetModules();
      asyncSpawnUtils = require('../src/main/utils/asyncSpawnUtils');
      platformBehavior = require('../src/main/core/platformBehavior');

      asyncSpawnUtils.asyncSpawn.mockResolvedValue({
        status: 1,
        stdout: '',
        stderr: 'Access denied'
      });

      const result = await platformBehavior.killProcess(1234);

      expect(result.success).toBe(false);
    });

    test('handles taskkill error', async () => {
      mockIsWindows = true;
      jest.resetModules();
      asyncSpawnUtils = require('../src/main/utils/asyncSpawnUtils');
      platformBehavior = require('../src/main/core/platformBehavior');

      asyncSpawnUtils.asyncSpawn.mockResolvedValue({
        status: null,
        error: new Error('Command failed')
      });

      const result = await platformBehavior.killProcess(1234);

      expect(result.success).toBe(false);
      expect(result.error.message).toBe('Command failed');
    });
  });

  describe('isProcessRunning', () => {
    // Store original process.kill
    const originalKill = process.kill;

    afterEach(() => {
      process.kill = originalKill;
    });

    test('returns false for invalid PID', () => {
      expect(platformBehavior.isProcessRunning(null)).toBe(false);
      expect(platformBehavior.isProcessRunning('string')).toBe(false);
    });

    test('returns true for running process', () => {
      process.kill = jest.fn(); // No error means process exists

      const result = platformBehavior.isProcessRunning(1234);

      expect(result).toBe(true);
      expect(process.kill).toHaveBeenCalledWith(1234, 0);
    });

    test('returns false when process not found (ESRCH)', () => {
      process.kill = jest.fn(() => {
        const error = new Error('No such process');
        error.code = 'ESRCH';
        throw error;
      });

      const result = platformBehavior.isProcessRunning(1234);

      expect(result).toBe(false);
    });

    test('returns true when permission denied (EPERM)', () => {
      // EPERM means process exists but we can't signal it
      process.kill = jest.fn(() => {
        const error = new Error('Permission denied');
        error.code = 'EPERM';
        throw error;
      });

      const result = platformBehavior.isProcessRunning(1234);

      expect(result).toBe(true);
    });
  });

  describe('shouldQuitOnAllWindowsClosed', () => {
    test('returns true on Windows', () => {
      mockIsWindows = true;
      mockIsMacOS = false;
      jest.resetModules();
      platformBehavior = require('../src/main/core/platformBehavior');

      expect(platformBehavior.shouldQuitOnAllWindowsClosed()).toBe(true);
    });

    test('returns true on Linux', () => {
      mockIsWindows = false;
      mockIsMacOS = false;
      jest.resetModules();
      platformBehavior = require('../src/main/core/platformBehavior');

      expect(platformBehavior.shouldQuitOnAllWindowsClosed()).toBe(true);
    });

    test('returns false on macOS', () => {
      mockIsWindows = false;
      mockIsMacOS = true;
      jest.resetModules();
      platformBehavior = require('../src/main/core/platformBehavior');

      expect(platformBehavior.shouldQuitOnAllWindowsClosed()).toBe(false);
    });
  });

  describe('exports', () => {
    test('exports platform flags', () => {
      expect(platformBehavior.isWindows).toBeDefined();
      expect(platformBehavior.isMacOS).toBeDefined();
    });
  });
});
