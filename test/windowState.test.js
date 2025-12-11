/**
 * Tests for Window State Management
 * Tests window state detection, restoration, and screen positioning
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

// Mock platformBehavior
jest.mock('../src/main/core/platformBehavior', () => ({
  bringWindowToForeground: jest.fn(),
  isWindows: false
}));

// Mock timingConstants
jest.mock('../src/main/core/timingConstants', () => ({
  WINDOW: {
    RESTORE_SETTLE_MS: 50
  }
}));

// Mock electron
const mockScreen = {
  getAllDisplays: jest.fn().mockReturnValue([{ bounds: { x: 0, y: 0, width: 1920, height: 1080 } }])
};
jest.mock('electron', () => ({
  screen: mockScreen
}));

describe('Window State', () => {
  let windowState;
  let mockWindow;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
    jest.useFakeTimers();

    windowState = require('../src/main/core/windowState');

    mockWindow = {
      isDestroyed: jest.fn().mockReturnValue(false),
      isFullScreen: jest.fn().mockReturnValue(false),
      isMinimized: jest.fn().mockReturnValue(false),
      isMaximized: jest.fn().mockReturnValue(false),
      isVisible: jest.fn().mockReturnValue(true),
      isFocused: jest.fn().mockReturnValue(false),
      focus: jest.fn(),
      show: jest.fn(),
      restore: jest.fn(),
      center: jest.fn(),
      getBounds: jest.fn().mockReturnValue({ x: 100, y: 100, width: 800, height: 600 }),
      on: jest.fn(),
      once: jest.fn(),
      removeListener: jest.fn()
    };
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('WindowState enum', () => {
    test('defines all states', () => {
      expect(windowState.WindowState.UNKNOWN).toBe('unknown');
      expect(windowState.WindowState.FULLSCREEN).toBe('fullscreen');
      expect(windowState.WindowState.MAXIMIZED).toBe('maximized');
      expect(windowState.WindowState.MINIMIZED).toBe('minimized');
      expect(windowState.WindowState.HIDDEN).toBe('hidden');
      expect(windowState.WindowState.NORMAL).toBe('normal');
    });
  });

  describe('getWindowState', () => {
    test('returns UNKNOWN for null window', () => {
      expect(windowState.getWindowState(null)).toBe('unknown');
    });

    test('returns UNKNOWN for destroyed window', () => {
      mockWindow.isDestroyed.mockReturnValue(true);
      expect(windowState.getWindowState(mockWindow)).toBe('unknown');
    });

    test('returns FULLSCREEN for fullscreen window', () => {
      mockWindow.isFullScreen.mockReturnValue(true);
      expect(windowState.getWindowState(mockWindow)).toBe('fullscreen');
    });

    test('returns MINIMIZED for minimized window', () => {
      mockWindow.isMinimized.mockReturnValue(true);
      expect(windowState.getWindowState(mockWindow)).toBe('minimized');
    });

    test('returns MAXIMIZED for maximized window', () => {
      mockWindow.isMaximized.mockReturnValue(true);
      expect(windowState.getWindowState(mockWindow)).toBe('maximized');
    });

    test('returns HIDDEN for hidden window', () => {
      mockWindow.isVisible.mockReturnValue(false);
      expect(windowState.getWindowState(mockWindow)).toBe('hidden');
    });

    test('returns NORMAL for visible normal window', () => {
      expect(windowState.getWindowState(mockWindow)).toBe('normal');
    });

    test('prioritizes fullscreen over minimized', () => {
      mockWindow.isFullScreen.mockReturnValue(true);
      mockWindow.isMinimized.mockReturnValue(true);
      expect(windowState.getWindowState(mockWindow)).toBe('fullscreen');
    });

    test('prioritizes minimized over maximized', () => {
      mockWindow.isMinimized.mockReturnValue(true);
      mockWindow.isMaximized.mockReturnValue(true);
      expect(windowState.getWindowState(mockWindow)).toBe('minimized');
    });
  });

  describe('restoreWindow', () => {
    test('does nothing for null window', async () => {
      await windowState.restoreWindow(null);
      // No error should be thrown
    });

    test('does nothing for destroyed window', async () => {
      mockWindow.isDestroyed.mockReturnValue(true);
      await windowState.restoreWindow(mockWindow);
      expect(mockWindow.focus).not.toHaveBeenCalled();
    });

    test('focuses fullscreen window', async () => {
      mockWindow.isFullScreen.mockReturnValue(true);
      await windowState.restoreWindow(mockWindow);
      expect(mockWindow.focus).toHaveBeenCalled();
    });

    test('shows and focuses hidden window', async () => {
      mockWindow.isVisible.mockReturnValue(false);
      await windowState.restoreWindow(mockWindow);
      expect(mockWindow.show).toHaveBeenCalled();
      expect(mockWindow.focus).toHaveBeenCalled();
    });

    test('focuses normal visible window', async () => {
      await windowState.restoreWindow(mockWindow);
      expect(mockWindow.focus).toHaveBeenCalled();
    });

    test('shows and focuses maximized hidden window', async () => {
      mockWindow.isMaximized.mockReturnValue(true);
      mockWindow.isVisible.mockReturnValue(false);
      await windowState.restoreWindow(mockWindow);
      expect(mockWindow.show).toHaveBeenCalled();
      expect(mockWindow.focus).toHaveBeenCalled();
    });
  });

  describe('restoreMinimizedWindow', () => {
    test('calls restore and sets up event handler', async () => {
      mockWindow.isMinimized.mockReturnValue(true);

      // Simulate restore event
      mockWindow.once.mockImplementation((event, callback) => {
        if (event === 'restore') {
          setTimeout(callback, 10);
        }
      });

      const promise = windowState.restoreMinimizedWindow(mockWindow);

      jest.advanceTimersByTime(100);
      await promise;

      expect(mockWindow.restore).toHaveBeenCalled();
    });

    test('handles timeout if restore event never fires', async () => {
      mockWindow.isMinimized.mockReturnValue(true);

      // Don't fire the restore event
      mockWindow.once.mockImplementation(() => {});

      const promise = windowState.restoreMinimizedWindow(mockWindow);

      // Advance past the timeout
      jest.advanceTimersByTime(1500);
      await promise;

      expect(mockWindow.show).toHaveBeenCalled();
      expect(mockWindow.focus).toHaveBeenCalled();
    });

    test('handles destroyed window during restore', async () => {
      mockWindow.once.mockImplementation((event, callback) => {
        if (event === 'restore') {
          mockWindow.isDestroyed.mockReturnValue(true);
          setTimeout(callback, 10);
        }
      });

      const promise = windowState.restoreMinimizedWindow(mockWindow);

      jest.advanceTimersByTime(100);
      await promise;

      // Should not throw
    });
  });

  describe('ensureWindowOnScreen', () => {
    test('returns false for null window', () => {
      expect(windowState.ensureWindowOnScreen(null)).toBe(false);
    });

    test('returns false for destroyed window', () => {
      mockWindow.isDestroyed.mockReturnValue(true);
      expect(windowState.ensureWindowOnScreen(mockWindow)).toBe(false);
    });

    test('returns false for invisible window', () => {
      mockWindow.isVisible.mockReturnValue(false);
      expect(windowState.ensureWindowOnScreen(mockWindow)).toBe(false);
    });

    test('returns false for minimized window', () => {
      mockWindow.isMinimized.mockReturnValue(true);
      expect(windowState.ensureWindowOnScreen(mockWindow)).toBe(false);
    });

    test('returns false when window is on screen', () => {
      mockWindow.getBounds.mockReturnValue({ x: 100, y: 100, width: 800, height: 600 });
      expect(windowState.ensureWindowOnScreen(mockWindow)).toBe(false);
      expect(mockWindow.center).not.toHaveBeenCalled();
    });

    test('centers window when off screen', () => {
      mockWindow.getBounds.mockReturnValue({ x: 5000, y: 5000, width: 800, height: 600 });
      expect(windowState.ensureWindowOnScreen(mockWindow)).toBe(true);
      expect(mockWindow.center).toHaveBeenCalled();
    });

    test('handles getBounds error gracefully', () => {
      mockWindow.getBounds.mockImplementation(() => {
        throw new Error('Cannot get bounds');
      });
      expect(windowState.ensureWindowOnScreen(mockWindow)).toBe(false);
    });
  });

  describe('attachWindowEventHandlers', () => {
    test('attaches debug event handlers', () => {
      windowState.attachWindowEventHandlers(mockWindow);

      // Should attach handlers for standard events
      expect(mockWindow.on).toHaveBeenCalledWith('minimize', expect.any(Function));
      expect(mockWindow.on).toHaveBeenCalledWith('restore', expect.any(Function));
      expect(mockWindow.on).toHaveBeenCalledWith('show', expect.any(Function));
      expect(mockWindow.on).toHaveBeenCalledWith('hide', expect.any(Function));
      expect(mockWindow.on).toHaveBeenCalledWith('focus', expect.any(Function));
      expect(mockWindow.on).toHaveBeenCalledWith('blur', expect.any(Function));
    });

    test('attaches close handler when provided', () => {
      const onClose = jest.fn();
      windowState.attachWindowEventHandlers(mockWindow, { onClose });

      expect(mockWindow.on).toHaveBeenCalledWith('close', onClose);
    });

    test('attaches closed handler when provided', () => {
      const onClosed = jest.fn();
      windowState.attachWindowEventHandlers(mockWindow, { onClosed });

      expect(mockWindow.on).toHaveBeenCalledWith('closed', onClosed);
    });

    test('returns cleanup function', () => {
      const cleanup = windowState.attachWindowEventHandlers(mockWindow);

      expect(typeof cleanup).toBe('function');

      cleanup();

      expect(mockWindow.removeListener).toHaveBeenCalled();
    });

    test('cleanup handles destroyed window', () => {
      const cleanup = windowState.attachWindowEventHandlers(mockWindow);

      mockWindow.isDestroyed.mockReturnValue(true);

      // Should not throw
      cleanup();
    });
  });
});
