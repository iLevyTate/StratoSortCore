const mockGetAllWindows = jest.fn();
let mockAutoUpdaterHandlers = new Map();

jest.mock('../src/shared/logger', () => ({
  logger: {
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    setContext: jest.fn()
  }
}));

jest.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: (...args) => mockGetAllWindows(...args)
  }
}));

jest.mock('electron-updater', () => ({
  autoUpdater: {
    autoDownload: true,
    on: jest.fn((event, handler) => {
      mockAutoUpdaterHandlers.set(event, handler);
    }),
    removeListener: jest.fn(),
    checkForUpdatesAndNotify: jest.fn().mockResolvedValue(undefined),
    quitAndInstall: jest.fn()
  }
}));

jest.mock('../src/main/ipc/ipcWrappers', () => ({
  safeSend: jest.fn()
}));

describe('autoUpdater', () => {
  beforeEach(() => {
    mockAutoUpdaterHandlers = new Map();
    mockGetAllWindows.mockReset();
    const { safeSend } = require('../src/main/ipc/ipcWrappers');
    safeSend.mockClear();
    jest.resetModules();
  });

  test('falls back to BrowserWindow when getMainWindow returns null', async () => {
    const mockWindow = {
      isDestroyed: jest.fn().mockReturnValue(false),
      webContents: {}
    };
    mockGetAllWindows.mockReturnValue([mockWindow]);

    const getMainWindow = jest.fn().mockReturnValue(null);
    const { initializeAutoUpdater } = require('../src/main/core/autoUpdater');

    await initializeAutoUpdater(false, getMainWindow);

    const updateAvailableHandler = mockAutoUpdaterHandlers.get('update-available');
    expect(typeof updateAvailableHandler).toBe('function');

    updateAvailableHandler();

    const { safeSend } = require('../src/main/ipc/ipcWrappers');
    expect(safeSend).toHaveBeenCalledWith(mockWindow.webContents, 'app:update', {
      status: 'available'
    });
  });
});
