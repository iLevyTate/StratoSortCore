/**
 * Tests for Window IPC Handlers
 * Tests window minimize, maximize, close operations for custom title bar
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

// Mock ipcWrappers
jest.mock('../src/main/ipc/ipcWrappers', () => ({
  createHandler: jest.fn(({ handler }) => handler),
  safeHandle: (ipcMain, channel, handler) => {
    ipcMain.handle(channel, handler);
  }
}));

describe('Window IPC Handlers', () => {
  let registerWindowIpc;
  let mockIpcMain;
  let mockWindow;
  let mockGetMainWindow;
  let mockLogger;
  let handlers;

  const IPC_CHANNELS = {
    WINDOW: {
      MINIMIZE: 'window:minimize',
      MAXIMIZE: 'window:maximize',
      UNMAXIMIZE: 'window:unmaximize',
      TOGGLE_MAXIMIZE: 'window:toggle-maximize',
      IS_MAXIMIZED: 'window:is-maximized',
      CLOSE: 'window:close'
    }
  };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();

    handlers = {};

    mockIpcMain = {
      handle: jest.fn((channel, handler) => {
        handlers[channel] = handler;
      })
    };

    mockWindow = {
      minimize: jest.fn(),
      maximize: jest.fn(),
      unmaximize: jest.fn(),
      isMaximized: jest.fn(() => false),
      close: jest.fn(),
      isDestroyed: jest.fn(() => false)
    };

    mockGetMainWindow = jest.fn(() => mockWindow);

    mockLogger = {
      info: jest.fn(),
      debug: jest.fn(),
      warn: jest.fn(),
      error: jest.fn()
    };

    registerWindowIpc = require('../src/main/ipc/window');
  });

  describe('registerWindowIpc', () => {
    test('registers all window handlers', () => {
      registerWindowIpc({
        ipcMain: mockIpcMain,
        IPC_CHANNELS,
        logger: mockLogger,
        getMainWindow: mockGetMainWindow
      });

      expect(mockIpcMain.handle).toHaveBeenCalledWith(
        IPC_CHANNELS.WINDOW.MINIMIZE,
        expect.any(Function)
      );
      expect(mockIpcMain.handle).toHaveBeenCalledWith(
        IPC_CHANNELS.WINDOW.MAXIMIZE,
        expect.any(Function)
      );
      expect(mockIpcMain.handle).toHaveBeenCalledWith(
        IPC_CHANNELS.WINDOW.UNMAXIMIZE,
        expect.any(Function)
      );
      expect(mockIpcMain.handle).toHaveBeenCalledWith(
        IPC_CHANNELS.WINDOW.TOGGLE_MAXIMIZE,
        expect.any(Function)
      );
      expect(mockIpcMain.handle).toHaveBeenCalledWith(
        IPC_CHANNELS.WINDOW.IS_MAXIMIZED,
        expect.any(Function)
      );
      expect(mockIpcMain.handle).toHaveBeenCalledWith(
        IPC_CHANNELS.WINDOW.CLOSE,
        expect.any(Function)
      );
    });
  });

  describe('WINDOW.MINIMIZE handler', () => {
    beforeEach(() => {
      registerWindowIpc({
        ipcMain: mockIpcMain,
        IPC_CHANNELS,
        logger: mockLogger,
        getMainWindow: mockGetMainWindow
      });
    });

    test('minimizes window when available', async () => {
      const handler = handlers[IPC_CHANNELS.WINDOW.MINIMIZE];

      const result = await handler();

      expect(mockWindow.minimize).toHaveBeenCalled();
      expect(result).toBe(true);
    });

    test('returns true when window is null', async () => {
      mockGetMainWindow.mockReturnValue(null);
      const handler = handlers[IPC_CHANNELS.WINDOW.MINIMIZE];

      const result = await handler();

      expect(mockWindow.minimize).not.toHaveBeenCalled();
      expect(result).toBe(true);
    });

    test('returns true when window is destroyed', async () => {
      mockWindow.isDestroyed.mockReturnValue(true);
      const handler = handlers[IPC_CHANNELS.WINDOW.MINIMIZE];

      const result = await handler();

      expect(mockWindow.minimize).not.toHaveBeenCalled();
      expect(result).toBe(true);
    });
  });

  describe('WINDOW.MAXIMIZE handler', () => {
    beforeEach(() => {
      registerWindowIpc({
        ipcMain: mockIpcMain,
        IPC_CHANNELS,
        logger: mockLogger,
        getMainWindow: mockGetMainWindow
      });
    });

    test('maximizes window when available', async () => {
      const handler = handlers[IPC_CHANNELS.WINDOW.MAXIMIZE];

      const result = await handler();

      expect(mockWindow.maximize).toHaveBeenCalled();
      expect(result).toBe(true);
    });

    test('handles null window gracefully', async () => {
      mockGetMainWindow.mockReturnValue(null);
      const handler = handlers[IPC_CHANNELS.WINDOW.MAXIMIZE];

      const result = await handler();

      expect(result).toBe(true);
    });
  });

  describe('WINDOW.UNMAXIMIZE handler', () => {
    beforeEach(() => {
      registerWindowIpc({
        ipcMain: mockIpcMain,
        IPC_CHANNELS,
        logger: mockLogger,
        getMainWindow: mockGetMainWindow
      });
    });

    test('unmaximizes window when available', async () => {
      const handler = handlers[IPC_CHANNELS.WINDOW.UNMAXIMIZE];

      const result = await handler();

      expect(mockWindow.unmaximize).toHaveBeenCalled();
      expect(result).toBe(true);
    });

    test('handles null window gracefully', async () => {
      mockGetMainWindow.mockReturnValue(null);
      const handler = handlers[IPC_CHANNELS.WINDOW.UNMAXIMIZE];

      const result = await handler();

      expect(result).toBe(true);
    });
  });

  describe('WINDOW.TOGGLE_MAXIMIZE handler', () => {
    beforeEach(() => {
      registerWindowIpc({
        ipcMain: mockIpcMain,
        IPC_CHANNELS,
        logger: mockLogger,
        getMainWindow: mockGetMainWindow
      });
    });

    test('unmaximizes when window is maximized', async () => {
      mockWindow.isMaximized.mockReturnValue(true);
      const handler = handlers[IPC_CHANNELS.WINDOW.TOGGLE_MAXIMIZE];

      await handler();

      expect(mockWindow.unmaximize).toHaveBeenCalled();
      expect(mockWindow.maximize).not.toHaveBeenCalled();
    });

    test('maximizes when window is not maximized', async () => {
      mockWindow.isMaximized.mockReturnValue(false);
      const handler = handlers[IPC_CHANNELS.WINDOW.TOGGLE_MAXIMIZE];

      await handler();

      expect(mockWindow.maximize).toHaveBeenCalled();
      expect(mockWindow.unmaximize).not.toHaveBeenCalled();
    });

    test('returns final maximized state', async () => {
      mockWindow.isMaximized
        .mockReturnValueOnce(false) // Initial check
        .mockReturnValueOnce(true); // After maximize

      const handler = handlers[IPC_CHANNELS.WINDOW.TOGGLE_MAXIMIZE];

      const result = await handler();

      expect(result).toBe(true);
    });

    test('returns false when window is null', async () => {
      mockGetMainWindow.mockReturnValue(null);
      const handler = handlers[IPC_CHANNELS.WINDOW.TOGGLE_MAXIMIZE];

      const result = await handler();

      expect(result).toBe(false);
    });
  });

  describe('WINDOW.IS_MAXIMIZED handler', () => {
    beforeEach(() => {
      registerWindowIpc({
        ipcMain: mockIpcMain,
        IPC_CHANNELS,
        logger: mockLogger,
        getMainWindow: mockGetMainWindow
      });
    });

    test('returns true when window is maximized', async () => {
      mockWindow.isMaximized.mockReturnValue(true);
      const handler = handlers[IPC_CHANNELS.WINDOW.IS_MAXIMIZED];

      const result = await handler();

      expect(result).toBe(true);
    });

    test('returns false when window is not maximized', async () => {
      mockWindow.isMaximized.mockReturnValue(false);
      const handler = handlers[IPC_CHANNELS.WINDOW.IS_MAXIMIZED];

      const result = await handler();

      expect(result).toBe(false);
    });

    test('returns false when window is null', async () => {
      mockGetMainWindow.mockReturnValue(null);
      const handler = handlers[IPC_CHANNELS.WINDOW.IS_MAXIMIZED];

      const result = await handler();

      expect(result).toBe(false);
    });

    test('returns false when window is destroyed', async () => {
      mockWindow.isDestroyed.mockReturnValue(true);
      const handler = handlers[IPC_CHANNELS.WINDOW.IS_MAXIMIZED];

      const result = await handler();

      expect(result).toBe(false);
    });
  });

  describe('WINDOW.CLOSE handler', () => {
    beforeEach(() => {
      registerWindowIpc({
        ipcMain: mockIpcMain,
        IPC_CHANNELS,
        logger: mockLogger,
        getMainWindow: mockGetMainWindow
      });
    });

    test('closes window when available', async () => {
      const handler = handlers[IPC_CHANNELS.WINDOW.CLOSE];

      const result = await handler();

      expect(mockWindow.close).toHaveBeenCalled();
      expect(result).toBe(true);
    });

    test('handles null window gracefully', async () => {
      mockGetMainWindow.mockReturnValue(null);
      const handler = handlers[IPC_CHANNELS.WINDOW.CLOSE];

      const result = await handler();

      expect(mockWindow.close).not.toHaveBeenCalled();
      expect(result).toBe(true);
    });

    test('handles destroyed window gracefully', async () => {
      mockWindow.isDestroyed.mockReturnValue(true);
      const handler = handlers[IPC_CHANNELS.WINDOW.CLOSE];

      const result = await handler();

      expect(mockWindow.close).not.toHaveBeenCalled();
      expect(result).toBe(true);
    });
  });

  describe('window safety checks', () => {
    beforeEach(() => {
      registerWindowIpc({
        ipcMain: mockIpcMain,
        IPC_CHANNELS,
        logger: mockLogger,
        getMainWindow: mockGetMainWindow
      });
    });

    test('all handlers check if window exists', async () => {
      mockGetMainWindow.mockReturnValue(null);

      for (const channel of Object.values(IPC_CHANNELS.WINDOW)) {
        const handler = handlers[channel];
        await expect(handler()).resolves.not.toThrow();
      }
    });

    test('all handlers check if window is destroyed', async () => {
      mockWindow.isDestroyed.mockReturnValue(true);

      for (const channel of Object.values(IPC_CHANNELS.WINDOW)) {
        const handler = handlers[channel];
        await expect(handler()).resolves.not.toThrow();
      }
    });
  });
});
