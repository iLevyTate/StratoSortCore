/**
 * Tests for createWindow
 * Tests application window initialization
 */

// Mock electron modules
jest.mock('electron', () => ({
  BrowserWindow: jest.fn().mockImplementation(() => ({
    loadURL: jest.fn().mockResolvedValue(),
    loadFile: jest.fn().mockResolvedValue(),
    once: jest.fn(),
    on: jest.fn(),
    show: jest.fn(),
    focus: jest.fn(),
    isDestroyed: jest.fn().mockReturnValue(false),
    isVisible: jest.fn().mockReturnValue(true),
    isFocused: jest.fn().mockReturnValue(true),
    isMinimized: jest.fn().mockReturnValue(false),
    webContents: {
      isLoading: jest.fn().mockReturnValue(false),
      once: jest.fn(),
      on: jest.fn(),
      openDevTools: jest.fn(),
      setWindowOpenHandler: jest.fn(),
      session: {
        webRequest: {
          onHeadersReceived: jest.fn()
        },
        setPermissionRequestHandler: jest.fn()
      }
    }
  })),
  shell: {
    openExternal: jest.fn()
  },
  app: {
    setAppUserModelId: jest.fn()
  },
  screen: {
    getPrimaryDisplay: jest.fn(() => ({
      workAreaSize: { width: 1920, height: 1080 },
      bounds: { x: 0, y: 0, width: 1920, height: 1080 },
      scaleFactor: 1
    }))
  }
}));

jest.mock('electron-window-state', () =>
  jest.fn().mockReturnValue({
    x: 100,
    y: 100,
    width: 1440,
    height: 900,
    manage: jest.fn(),
    unmanage: jest.fn()
  })
);

jest.mock('../src/shared/logger', () => ({
  logger: {
    setContext: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  }
}));

jest.mock('../src/shared/configDefaults', () => ({
  isDevelopment: jest.fn().mockReturnValue(false),
  getEnvBool: jest.fn().mockReturnValue(false),
  SERVICE_URLS: {
    OLLAMA_HOST: 'http://127.0.0.1:11434',
    CHROMA_SERVER_URL: 'http://127.0.0.1:8000'
  }
}));

describe('createWindow', () => {
  let createMainWindow;
  let BrowserWindow;
  let windowStateKeeper;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();

    BrowserWindow = require('electron').BrowserWindow;
    windowStateKeeper = require('electron-window-state');
    createMainWindow = require('../src/main/core/createWindow');
  });

  describe('window creation', () => {
    test('creates BrowserWindow with correct dimensions', () => {
      createMainWindow();

      expect(BrowserWindow).toHaveBeenCalledWith(
        expect.objectContaining({
          width: 1440,
          height: 900,
          minWidth: 800,
          minHeight: 600
        })
      );
    });

    test('creates window with light theme (default)', () => {
      createMainWindow();

      expect(BrowserWindow).toHaveBeenCalledWith(
        expect.objectContaining({
          backgroundColor: '#f8fafc',
          darkTheme: false
        })
      );
    });

    test('creates window with show:false initially', () => {
      createMainWindow();

      expect(BrowserWindow).toHaveBeenCalledWith(
        expect.objectContaining({
          show: false
        })
      );
    });

    test('uses window state from windowStateKeeper', () => {
      windowStateKeeper.mockReturnValue({
        x: 200,
        y: 300,
        width: 1600,
        height: 1000,
        manage: jest.fn(),
        unmanage: jest.fn()
      });

      createMainWindow();

      expect(BrowserWindow).toHaveBeenCalledWith(
        expect.objectContaining({
          x: 200,
          y: 300,
          width: 1600,
          height: 1000
        })
      );
    });
  });

  describe('webPreferences security', () => {
    test('disables nodeIntegration', () => {
      createMainWindow();

      const options = BrowserWindow.mock.calls[0][0];
      expect(options.webPreferences.nodeIntegration).toBe(false);
    });

    test('enables contextIsolation', () => {
      createMainWindow();

      const options = BrowserWindow.mock.calls[0][0];
      expect(options.webPreferences.contextIsolation).toBe(true);
    });

    test('enables webSecurity', () => {
      createMainWindow();

      const options = BrowserWindow.mock.calls[0][0];
      expect(options.webPreferences.webSecurity).toBe(true);
    });

    test('disables remote module', () => {
      createMainWindow();

      const options = BrowserWindow.mock.calls[0][0];
      expect(options.webPreferences.enableRemoteModule).toBe(false);
    });

    test('disables webviewTag', () => {
      createMainWindow();

      const options = BrowserWindow.mock.calls[0][0];
      expect(options.webPreferences.webviewTag).toBe(false);
    });

    test('sets preload script path', () => {
      createMainWindow();

      const options = BrowserWindow.mock.calls[0][0];
      expect(options.webPreferences.preload).toContain('preload.js');
    });
  });

  describe('window state management', () => {
    test('calls windowStateKeeper.manage', () => {
      const manage = jest.fn();
      windowStateKeeper.mockReturnValue({
        x: 100,
        y: 100,
        width: 1440,
        height: 900,
        manage,
        unmanage: jest.fn()
      });

      const win = createMainWindow();

      expect(manage).toHaveBeenCalledWith(win);
    });

    test('registers closed event for unmanage', () => {
      const win = createMainWindow();

      expect(win.once).toHaveBeenCalledWith('closed', expect.any(Function));
    });
  });

  describe('content loading', () => {
    test('schedules content loading', () => {
      jest.useFakeTimers();

      createMainWindow();

      jest.advanceTimersByTime(200);

      jest.useRealTimers();
    });
  });

  describe('security headers', () => {
    test('sets up onHeadersReceived handler', () => {
      const win = createMainWindow();

      expect(win.webContents.session.webRequest.onHeadersReceived).toHaveBeenCalled();
    });

    test('sets CSP header in response', () => {
      const win = createMainWindow();

      const callback = win.webContents.session.webRequest.onHeadersReceived.mock.calls[0][0];

      const mockCallback = jest.fn();
      callback({ responseHeaders: {} }, mockCallback);

      expect(mockCallback).toHaveBeenCalledWith(
        expect.objectContaining({
          responseHeaders: expect.objectContaining({
            'Content-Security-Policy': expect.any(Array),
            'X-Content-Type-Options': ['nosniff'],
            'X-Frame-Options': ['DENY']
          })
        })
      );
    });
  });

  describe('ready-to-show event', () => {
    test('registers ready-to-show handler', () => {
      const win = createMainWindow();

      expect(win.once).toHaveBeenCalledWith('ready-to-show', expect.any(Function));
    });

    test('shows and focuses window when ready', () => {
      jest.useFakeTimers();

      const win = createMainWindow();

      // Find and call the ready-to-show handler
      const readyToShowCall = win.once.mock.calls.find((call) => call[0] === 'ready-to-show');
      const readyToShowHandler = readyToShowCall[1];

      readyToShowHandler();

      jest.advanceTimersByTime(200);

      expect(win.show).toHaveBeenCalled();
      expect(win.focus).toHaveBeenCalled();

      jest.useRealTimers();
    });
  });

  describe('navigation security', () => {
    test('blocks in-app navigation', () => {
      const win = createMainWindow();

      const navigateCall = win.webContents.on.mock.calls.find(
        (call) => call[0] === 'will-navigate'
      );
      const navigateHandler = navigateCall[1];

      const mockEvent = { preventDefault: jest.fn() };
      navigateHandler(mockEvent, 'https://malicious.com');

      expect(mockEvent.preventDefault).toHaveBeenCalled();
    });

    test('blocks webview attachment', () => {
      const win = createMainWindow();

      const attachCall = win.webContents.on.mock.calls.find(
        (call) => call[0] === 'will-attach-webview'
      );
      const attachHandler = attachCall[1];

      const mockEvent = { preventDefault: jest.fn() };
      attachHandler(mockEvent);

      expect(mockEvent.preventDefault).toHaveBeenCalled();
    });
  });

  describe('external link handling', () => {
    test('sets window open handler', () => {
      const win = createMainWindow();

      expect(win.webContents.setWindowOpenHandler).toHaveBeenCalled();
    });

    test('allows opening allowed domains externally', () => {
      const shell = require('electron').shell;
      const win = createMainWindow();

      const handlerConfig = win.webContents.setWindowOpenHandler.mock.calls[0][0];
      const result = handlerConfig({ url: 'https://github.com/test' });

      expect(shell.openExternal).toHaveBeenCalledWith('https://github.com/test');
      expect(result).toEqual({ action: 'deny' });
    });

    test('blocks opening non-allowed domains', () => {
      const shell = require('electron').shell;
      shell.openExternal.mockClear();

      const win = createMainWindow();

      const handlerConfig = win.webContents.setWindowOpenHandler.mock.calls[0][0];
      handlerConfig({ url: 'https://malicious.com' });

      expect(shell.openExternal).not.toHaveBeenCalled();
    });
  });

  describe('permission requests', () => {
    test('sets permission request handler', () => {
      const win = createMainWindow();

      expect(win.webContents.session.setPermissionRequestHandler).toHaveBeenCalled();
    });

    test('denies all permission requests', () => {
      const win = createMainWindow();

      const handler = win.webContents.session.setPermissionRequestHandler.mock.calls[0][0];

      const mockCallback = jest.fn();
      handler({}, 'camera', mockCallback);

      expect(mockCallback).toHaveBeenCalledWith(false);
    });
  });

  describe('AppUserModelId', () => {
    test('sets AppUserModelId on Windows', () => {
      const app = require('electron').app;

      createMainWindow();

      expect(app.setAppUserModelId).toHaveBeenCalledWith('com.stratosort.app');
    });
  });

  describe('development mode', () => {
    test('opens devTools when FORCE_DEV_TOOLS is true', () => {
      // Reset modules to get fresh imports with new mock values
      jest.resetModules();

      // Set up the mocks BEFORE requiring createMainWindow
      const { isDevelopment, getEnvBool } = require('../src/shared/configDefaults');
      isDevelopment.mockReturnValue(true);
      getEnvBool.mockImplementation((key) => key === 'USE_DEV_SERVER' || key === 'FORCE_DEV_TOOLS');

      // Now require createMainWindow with the updated mocks
      const freshCreateMainWindow = require('../src/main/core/createWindow');

      jest.useFakeTimers();

      const win = freshCreateMainWindow();

      jest.advanceTimersByTime(200);

      expect(win.webContents.openDevTools).toHaveBeenCalled();

      jest.useRealTimers();
    });
  });
});
