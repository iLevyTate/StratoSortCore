/**
 * Centralized Electron Mock
 *
 * Provides standardized mocks for Electron modules.
 * Import this in test files instead of defining mocks inline.
 *
 * @example
 * jest.mock('electron', () => require('./mocks/electron'));
 */

const _ipcHandlers = new Map();

const mockIpcMain = {
  _handlers: _ipcHandlers,
  handle: jest.fn((channel, handler) => {
    _ipcHandlers.set(channel, handler);
  }),
  on: jest.fn(),
  removeHandler: jest.fn((channel) => {
    _ipcHandlers.delete(channel);
  }),
  removeAllListeners: jest.fn()
};

const mockIpcRenderer = {
  invoke: jest.fn(),
  on: jest.fn(),
  send: jest.fn(),
  removeListener: jest.fn(),
  removeAllListeners: jest.fn()
};

const mockApp = {
  getPath: jest.fn((name) => {
    const paths = {
      userData: '/mock/userData',
      appData: '/mock/appData',
      temp: '/mock/temp',
      home: '/mock/home',
      documents: '/mock/documents',
      downloads: '/mock/downloads'
    };
    return paths[name] || `/mock/${name}`;
  }),
  getName: jest.fn(() => 'ElStratoSort'),
  getVersion: jest.fn(() => '1.0.0'),
  isPackaged: false,
  quit: jest.fn(),
  exit: jest.fn(),
  on: jest.fn(),
  once: jest.fn(),
  whenReady: jest.fn(() => Promise.resolve())
};

const mockDialog = {
  showOpenDialog: jest.fn(() => Promise.resolve({ canceled: false, filePaths: [] })),
  showSaveDialog: jest.fn(() => Promise.resolve({ canceled: false, filePath: '' })),
  showMessageBox: jest.fn(() => Promise.resolve({ response: 0 })),
  showErrorBox: jest.fn()
};

const mockShell = {
  openPath: jest.fn(() => Promise.resolve('')),
  openExternal: jest.fn(() => Promise.resolve()),
  showItemInFolder: jest.fn(),
  trashItem: jest.fn(() => Promise.resolve())
};

const mockBrowserWindow = jest.fn().mockImplementation(() => ({
  loadURL: jest.fn(),
  loadFile: jest.fn(),
  on: jest.fn(),
  once: jest.fn(),
  show: jest.fn(),
  hide: jest.fn(),
  close: jest.fn(),
  destroy: jest.fn(),
  isDestroyed: jest.fn(() => false),
  webContents: {
    send: jest.fn(),
    on: jest.fn(),
    openDevTools: jest.fn(),
    closeDevTools: jest.fn()
  }
}));

mockBrowserWindow.getAllWindows = jest.fn(() => []);
mockBrowserWindow.getFocusedWindow = jest.fn(() => null);

const mockNativeTheme = {
  themeSource: 'system',
  shouldUseDarkColors: false,
  shouldUseHighContrastColors: false,
  shouldUseInvertedColorScheme: false,
  on: jest.fn(),
  off: jest.fn()
};

const mockScreen = {
  getPrimaryDisplay: jest.fn(() => ({
    workAreaSize: { width: 1920, height: 1080 },
    bounds: { x: 0, y: 0, width: 1920, height: 1080 },
    scaleFactor: 1
  })),
  getAllDisplays: jest.fn(() => [
    {
      workAreaSize: { width: 1920, height: 1080 },
      bounds: { x: 0, y: 0, width: 1920, height: 1080 },
      scaleFactor: 1
    }
  ])
};

module.exports = {
  ipcMain: mockIpcMain,
  ipcRenderer: mockIpcRenderer,
  app: mockApp,
  dialog: mockDialog,
  shell: mockShell,
  BrowserWindow: mockBrowserWindow,
  nativeTheme: mockNativeTheme,
  screen: mockScreen
};
