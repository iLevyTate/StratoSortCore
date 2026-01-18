/**
 * Tests for Application Menu
 * Tests menu creation and action handling
 */

// Mock electron
const mockWebContents = {
  send: jest.fn()
};

const mockMainWindow = {
  webContents: mockWebContents,
  isDestroyed: jest.fn().mockReturnValue(false)
};

const mockGetMainWindow = jest.fn().mockReturnValue(mockMainWindow);

const mockMenu = {
  buildFromTemplate: jest.fn().mockReturnValue({}),
  setApplicationMenu: jest.fn()
};

const mockShell = {
  openExternal: jest.fn()
};

const mockApp = {
  quit: jest.fn()
};

jest.mock('electron', () => ({
  Menu: mockMenu,
  shell: mockShell,
  app: mockApp
}));

jest.mock('../src/shared/platformUtils', () => ({
  getQuitAccelerator: jest.fn().mockReturnValue('Alt+F4')
}));

describe('applicationMenu', () => {
  let createApplicationMenu;
  let capturedTemplate;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();

    // Capture the template passed to buildFromTemplate
    mockMenu.buildFromTemplate.mockImplementation((template) => {
      capturedTemplate = template;
      return {};
    });

    const applicationMenu = require('../src/main/core/applicationMenu');
    createApplicationMenu = applicationMenu.createApplicationMenu;
  });

  test('creates menu with all main sections', () => {
    createApplicationMenu(mockGetMainWindow);

    expect(mockMenu.buildFromTemplate).toHaveBeenCalled();
    expect(mockMenu.setApplicationMenu).toHaveBeenCalled();

    const labels = capturedTemplate.map((item) => item.label);
    expect(labels).toContain('File');
    expect(labels).toContain('Edit');
    expect(labels).toContain('View');
    expect(labels).toContain('Window');
    expect(labels).toContain('Help');
  });

  describe('File menu', () => {
    test('has Select Files action', () => {
      createApplicationMenu(mockGetMainWindow);

      const fileMenu = capturedTemplate.find((item) => item.label === 'File');
      const selectFiles = fileMenu.submenu.find((item) => item.label === 'Select Files');

      expect(selectFiles).toBeDefined();
      expect(selectFiles.accelerator).toBe('CmdOrCtrl+O');

      selectFiles.click();
      expect(mockWebContents.send).toHaveBeenCalledWith('menu-action', 'select-files');
    });

    test('has Select Folder action', () => {
      createApplicationMenu(mockGetMainWindow);

      const fileMenu = capturedTemplate.find((item) => item.label === 'File');
      const selectFolder = fileMenu.submenu.find((item) => item.label === 'Select Folder');

      expect(selectFolder).toBeDefined();
      expect(selectFolder.accelerator).toBe('CmdOrCtrl+Shift+O');

      selectFolder.click();
      expect(mockWebContents.send).toHaveBeenCalledWith('menu-action', 'select-folder');
    });

    test('has Settings action', () => {
      createApplicationMenu(mockGetMainWindow);

      const fileMenu = capturedTemplate.find((item) => item.label === 'File');
      const settings = fileMenu.submenu.find((item) => item.label === 'Settings');

      expect(settings).toBeDefined();
      expect(settings.accelerator).toBe('CmdOrCtrl+,');

      settings.click();
      expect(mockWebContents.send).toHaveBeenCalledWith('menu-action', 'open-settings');
    });

    test('has Exit action that quits app', () => {
      createApplicationMenu(mockGetMainWindow);

      const fileMenu = capturedTemplate.find((item) => item.label === 'File');
      const exit = fileMenu.submenu.find((item) => item.label === 'Exit');

      expect(exit).toBeDefined();

      exit.click();
      expect(mockApp.quit).toHaveBeenCalled();
    });

    test('handles null main window gracefully', () => {
      const nullWindowGetter = jest.fn().mockReturnValue(null);
      createApplicationMenu(nullWindowGetter);

      const fileMenu = capturedTemplate.find((item) => item.label === 'File');
      const selectFiles = fileMenu.submenu.find((item) => item.label === 'Select Files');

      // Should not throw
      selectFiles.click();
      expect(mockWebContents.send).not.toHaveBeenCalled();
    });
  });

  describe('Edit menu', () => {
    test('has standard edit actions', () => {
      createApplicationMenu(mockGetMainWindow);

      const editMenu = capturedTemplate.find((item) => item.label === 'Edit');
      const labels = editMenu.submenu.filter((item) => item.label).map((item) => item.label);

      expect(labels).toContain('Undo');
      expect(labels).toContain('Redo');
      expect(labels).toContain('Cut');
      expect(labels).toContain('Copy');
      expect(labels).toContain('Paste');
      expect(labels).toContain('Select All');
    });

    test('uses correct roles for edit actions', () => {
      createApplicationMenu(mockGetMainWindow);

      const editMenu = capturedTemplate.find((item) => item.label === 'Edit');

      expect(editMenu.submenu.find((item) => item.label === 'Undo').role).toBe('undo');
      expect(editMenu.submenu.find((item) => item.label === 'Copy').role).toBe('copy');
      expect(editMenu.submenu.find((item) => item.label === 'Paste').role).toBe('paste');
    });
  });

  describe('View menu', () => {
    test('has Reload action', () => {
      createApplicationMenu(mockGetMainWindow);

      const viewMenu = capturedTemplate.find((item) => item.label === 'View');
      const reload = viewMenu.submenu.find((item) => item.label === 'Reload');

      expect(reload).toBeDefined();
      expect(reload.role).toBe('reload');
    });

    test('has Toggle Fullscreen action', () => {
      createApplicationMenu(mockGetMainWindow);

      const viewMenu = capturedTemplate.find((item) => item.label === 'View');
      const fullscreen = viewMenu.submenu.find((item) => item.label === 'Toggle Fullscreen');

      expect(fullscreen).toBeDefined();
      expect(fullscreen.accelerator).toBe('F11');
      expect(fullscreen.role).toBe('togglefullscreen');
    });
  });

  describe('Window menu', () => {
    test('has Minimize action', () => {
      createApplicationMenu(mockGetMainWindow);

      const windowMenu = capturedTemplate.find((item) => item.label === 'Window');
      const minimize = windowMenu.submenu.find((item) => item.label === 'Minimize');

      expect(minimize).toBeDefined();
      expect(minimize.role).toBe('minimize');
    });

    test('has Close action', () => {
      createApplicationMenu(mockGetMainWindow);

      const windowMenu = capturedTemplate.find((item) => item.label === 'Window');
      const close = windowMenu.submenu.find((item) => item.label === 'Close');

      expect(close).toBeDefined();
      expect(close.role).toBe('close');
    });
  });

  describe('Help menu', () => {
    test('has About action', () => {
      createApplicationMenu(mockGetMainWindow);

      const helpMenu = capturedTemplate.find((item) => item.label === 'Help');
      const about = helpMenu.submenu.find((item) => item.label === 'About StratoSort');

      expect(about).toBeDefined();

      about.click();
      expect(mockWebContents.send).toHaveBeenCalledWith('menu-action', 'show-about');
    });

    test('has Documentation link', () => {
      createApplicationMenu(mockGetMainWindow);

      const helpMenu = capturedTemplate.find((item) => item.label === 'Help');
      const docs = helpMenu.submenu.find((item) => item.label === 'Documentation');

      expect(docs).toBeDefined();

      docs.click();
      expect(mockShell.openExternal).toHaveBeenCalledWith('https://github.com');
    });
  });
});
