/**
 * Application Menu
 *
 * Creates the themed application menu bar.
 * Extracted from simple-main.js for better maintainability.
 *
 * @module core/applicationMenu
 */

const { Menu, shell, app } = require('electron');
const { getQuitAccelerator, isMacOS } = require('../../shared/platformUtils');
// FIX: Import safeSend for validated IPC event sending
const { safeSend } = require('../ipc/ipcWrappers');

const isDev = process.env.NODE_ENV === 'development';

/**
 * Create and set the application menu
 * @param {Function} getMainWindow - Function to get main window reference
 */
function createApplicationMenu(getMainWindow) {
  const template = [
    {
      label: 'File',
      submenu: [
        {
          label: 'Select Files',
          accelerator: 'CmdOrCtrl+O',
          click: () => {
            const mainWindow = getMainWindow();
            if (mainWindow && !mainWindow.isDestroyed()) {
              safeSend(mainWindow.webContents, 'menu-action', 'select-files');
            }
          }
        },
        {
          label: 'Select Folder',
          accelerator: 'CmdOrCtrl+Shift+O',
          click: () => {
            const mainWindow = getMainWindow();
            if (mainWindow && !mainWindow.isDestroyed()) {
              safeSend(mainWindow.webContents, 'menu-action', 'select-folder');
            }
          }
        }
      ]
    }
  ];

  // Windows/Linux specific File menu items
  if (!isMacOS) {
    template[0].submenu.push(
      { type: 'separator' },
      {
        label: 'Settings',
        accelerator: 'CmdOrCtrl+,',
        click: () => {
          const mainWindow = getMainWindow();
          if (mainWindow && !mainWindow.isDestroyed()) {
            safeSend(mainWindow.webContents, 'menu-action', 'open-settings');
          }
        }
      },
      { type: 'separator' },
      {
        label: 'Exit',
        accelerator: getQuitAccelerator(),
        click: () => {
          app.quit();
        }
      }
    );
  }

  // Edit Menu
  template.push({
    label: 'Edit',
    submenu: [
      { label: 'Undo', accelerator: 'CmdOrCtrl+Z', role: 'undo' },
      { label: 'Redo', accelerator: 'CmdOrCtrl+Y', role: 'redo' },
      { type: 'separator' },
      { label: 'Cut', accelerator: 'CmdOrCtrl+X', role: 'cut' },
      { label: 'Copy', accelerator: 'CmdOrCtrl+C', role: 'copy' },
      { label: 'Paste', accelerator: 'CmdOrCtrl+V', role: 'paste' },
      { label: 'Select All', accelerator: 'CmdOrCtrl+A', role: 'selectAll' }
    ]
  });

  // View Menu
  template.push({
    label: 'View',
    submenu: [
      { label: 'Reload', accelerator: 'CmdOrCtrl+R', role: 'reload' },
      {
        label: 'Force Reload',
        accelerator: 'CmdOrCtrl+Shift+R',
        role: 'forceReload'
      },
      { type: 'separator' },
      {
        label: 'Toggle Fullscreen',
        accelerator: 'F11',
        role: 'togglefullscreen'
      },
      ...(isDev
        ? [
            { type: 'separator' },
            {
              label: 'Toggle Developer Tools',
              accelerator: 'F12',
              role: 'toggleDevTools'
            }
          ]
        : [])
    ]
  });

  // Window Menu
  template.push({
    label: 'Window',
    submenu: [
      { label: 'Minimize', accelerator: 'CmdOrCtrl+M', role: 'minimize' },
      { label: 'Close', accelerator: 'CmdOrCtrl+W', role: 'close' }
    ]
  });

  // Help Menu
  const helpMenu = {
    label: 'Help',
    submenu: [
      { type: 'separator' },
      {
        label: 'Documentation',
        click: () => {
          shell.openExternal('https://github.com');
        }
      }
    ]
  };

  if (!isMacOS) {
    helpMenu.submenu.unshift({
      label: 'About StratoSort Core',
      click: () => {
        const mainWindow = getMainWindow();
        if (mainWindow && !mainWindow.isDestroyed()) {
          safeSend(mainWindow.webContents, 'menu-action', 'show-about');
        }
      }
    });
  }

  template.push(helpMenu);

  // macOS Application Menu (Must be first)
  if (isMacOS) {
    template.unshift({
      label: app.name,
      submenu: [
        {
          label: 'About StratoSort Core',
          click: () => {
            const mainWindow = getMainWindow();
            if (mainWindow && !mainWindow.isDestroyed()) {
              safeSend(mainWindow.webContents, 'menu-action', 'show-about');
            }
          }
        },
        { type: 'separator' },
        {
          label: 'Preferences...',
          accelerator: 'CmdOrCtrl+,',
          click: () => {
            const mainWindow = getMainWindow();
            if (mainWindow && !mainWindow.isDestroyed()) {
              safeSend(mainWindow.webContents, 'menu-action', 'open-settings');
            }
          }
        },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    });
  }

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

module.exports = {
  createApplicationMenu
};
