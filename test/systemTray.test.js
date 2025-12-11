/**
 * Tests for System Tray
 * Tests tray creation, menu updates, and actions
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

const mockTrayInstance = {
  setToolTip: jest.fn(),
  setContextMenu: jest.fn(),
  destroy: jest.fn()
};

const mockNativeImage = {
  createFromPath: jest.fn().mockReturnValue({
    setTemplateImage: jest.fn()
  })
};

const mockMenu = {
  buildFromTemplate: jest.fn().mockReturnValue({})
};

const mockWindow = {
  isMinimized: jest.fn().mockReturnValue(false),
  restore: jest.fn(),
  show: jest.fn(),
  focus: jest.fn()
};

const mockApp = {
  quit: jest.fn()
};

const mockBrowserWindow = {
  getAllWindows: jest.fn().mockReturnValue([mockWindow])
};

jest.mock('electron', () => ({
  Tray: jest.fn().mockImplementation(() => mockTrayInstance),
  Menu: mockMenu,
  app: mockApp,
  BrowserWindow: mockBrowserWindow,
  nativeImage: mockNativeImage
}));

jest.mock('../src/shared/platformUtils', () => ({
  isWindows: false,
  isMacOS: false
}));

describe('systemTray', () => {
  let systemTray;
  let capturedMenuTemplate;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();

    // Capture the template passed to buildFromTemplate
    mockMenu.buildFromTemplate.mockImplementation((template) => {
      capturedMenuTemplate = template;
      return {};
    });

    systemTray = require('../src/main/core/systemTray');
  });

  describe('initializeTrayConfig', () => {
    test('sets tray configuration', () => {
      const config = {
        getDownloadWatcher: jest.fn(),
        getSettingsService: jest.fn(),
        handleSettingsChanged: jest.fn(),
        createWindow: jest.fn(),
        setIsQuitting: jest.fn()
      };

      systemTray.initializeTrayConfig(config);

      // Config is internal, but we can verify it's used by other functions
      expect(systemTray.getTray).toBeDefined();
    });
  });

  describe('createSystemTray', () => {
    test('creates tray with correct tooltip', () => {
      systemTray.createSystemTray();

      expect(mockTrayInstance.setToolTip).toHaveBeenCalledWith('StratoSort');
    });

    test('creates tray with icon', () => {
      systemTray.createSystemTray();

      expect(mockNativeImage.createFromPath).toHaveBeenCalled();
    });

    test('handles tray creation errors gracefully', () => {
      const { Tray } = require('electron');
      Tray.mockImplementationOnce(() => {
        throw new Error('Tray creation failed');
      });

      // Should not throw
      expect(() => systemTray.createSystemTray()).not.toThrow();
    });
  });

  describe('updateTrayMenu', () => {
    beforeEach(() => {
      systemTray.createSystemTray();
    });

    test('creates context menu with Open action', () => {
      systemTray.updateTrayMenu();

      const openItem = capturedMenuTemplate.find((item) => item.label === 'Open StratoSort');
      expect(openItem).toBeDefined();
    });

    test('Open action shows and focuses window', () => {
      systemTray.updateTrayMenu();

      const openItem = capturedMenuTemplate.find((item) => item.label === 'Open StratoSort');
      openItem.click();

      expect(mockWindow.show).toHaveBeenCalled();
      expect(mockWindow.focus).toHaveBeenCalled();
    });

    test('Open action restores minimized window', () => {
      mockWindow.isMinimized.mockReturnValueOnce(true);
      systemTray.updateTrayMenu();

      const openItem = capturedMenuTemplate.find((item) => item.label === 'Open StratoSort');
      openItem.click();

      expect(mockWindow.restore).toHaveBeenCalled();
    });

    test('Open action creates window if none exist', () => {
      const createWindow = jest.fn();
      systemTray.initializeTrayConfig({ createWindow });
      mockBrowserWindow.getAllWindows.mockReturnValueOnce([]);

      systemTray.updateTrayMenu();

      const openItem = capturedMenuTemplate.find((item) => item.label === 'Open StratoSort');
      openItem.click();

      expect(createWindow).toHaveBeenCalled();
    });

    test('shows Pause Auto-Sort when download watcher is active', () => {
      const getDownloadWatcher = jest.fn().mockReturnValue({});
      systemTray.initializeTrayConfig({ getDownloadWatcher });

      systemTray.updateTrayMenu();

      const autoSortItem = capturedMenuTemplate.find((item) => item.label === 'Pause Auto-Sort');
      expect(autoSortItem).toBeDefined();
    });

    test('shows Resume Auto-Sort when download watcher is inactive', () => {
      const getDownloadWatcher = jest.fn().mockReturnValue(null);
      systemTray.initializeTrayConfig({ getDownloadWatcher });

      systemTray.updateTrayMenu();

      const autoSortItem = capturedMenuTemplate.find((item) => item.label === 'Resume Auto-Sort');
      expect(autoSortItem).toBeDefined();
    });

    test('auto-sort toggle calls settings service', async () => {
      const mockSettingsService = {
        save: jest.fn().mockResolvedValue({ autoOrganize: true })
      };
      const handleSettingsChanged = jest.fn();

      systemTray.initializeTrayConfig({
        getDownloadWatcher: jest.fn().mockReturnValue(null),
        getSettingsService: jest.fn().mockReturnValue(mockSettingsService),
        handleSettingsChanged
      });

      systemTray.updateTrayMenu();

      const autoSortItem = capturedMenuTemplate.find((item) => item.label === 'Resume Auto-Sort');
      await autoSortItem.click();

      expect(mockSettingsService.save).toHaveBeenCalledWith({
        autoOrganize: true
      });
      expect(handleSettingsChanged).toHaveBeenCalled();
    });

    test('auto-sort toggle handles missing settings service', async () => {
      const handleSettingsChanged = jest.fn();

      systemTray.initializeTrayConfig({
        getDownloadWatcher: jest.fn().mockReturnValue(null),
        getSettingsService: jest.fn().mockReturnValue(null),
        handleSettingsChanged
      });

      systemTray.updateTrayMenu();

      const autoSortItem = capturedMenuTemplate.find((item) => item.label === 'Resume Auto-Sort');
      await autoSortItem.click();

      expect(handleSettingsChanged).toHaveBeenCalledWith({
        autoOrganize: true
      });
    });

    test('Quit action quits app', () => {
      const setIsQuitting = jest.fn();
      systemTray.initializeTrayConfig({ setIsQuitting });

      systemTray.updateTrayMenu();

      const quitItem = capturedMenuTemplate.find((item) => item.label === 'Quit');
      quitItem.click();

      expect(setIsQuitting).toHaveBeenCalledWith(true);
      expect(mockApp.quit).toHaveBeenCalled();
    });

    test('does nothing if tray is null', () => {
      systemTray.destroyTray();
      mockMenu.buildFromTemplate.mockClear();

      systemTray.updateTrayMenu();

      expect(mockMenu.buildFromTemplate).not.toHaveBeenCalled();
    });
  });

  describe('destroyTray', () => {
    test('destroys tray instance', () => {
      systemTray.createSystemTray();
      systemTray.destroyTray();

      expect(mockTrayInstance.destroy).toHaveBeenCalled();
    });

    test('handles destroy errors gracefully', () => {
      mockTrayInstance.destroy.mockImplementationOnce(() => {
        throw new Error('Destroy failed');
      });

      systemTray.createSystemTray();

      expect(() => systemTray.destroyTray()).not.toThrow();
    });

    test('sets tray to null after destroy', () => {
      systemTray.createSystemTray();
      systemTray.destroyTray();

      expect(systemTray.getTray()).toBeNull();
    });

    test('does nothing if tray is already null', () => {
      systemTray.destroyTray();

      // Should not throw
      expect(() => systemTray.destroyTray()).not.toThrow();
    });
  });

  describe('getTray', () => {
    test('returns null before creation', () => {
      expect(systemTray.getTray()).toBeNull();
    });

    test('returns tray instance after creation', () => {
      systemTray.createSystemTray();

      expect(systemTray.getTray()).toBe(mockTrayInstance);
    });
  });
});
