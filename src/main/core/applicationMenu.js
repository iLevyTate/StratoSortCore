/**
 * Application Menu
 *
 * Creates the themed application menu bar.
 * Extracted from simple-main.js for better maintainability.
 *
 * @module core/applicationMenu
 */

const { Menu, shell } = require('electron');
const { getQuitAccelerator } = require('../../shared/platformUtils');

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
            if (mainWindow) {
              mainWindow.webContents.send('menu-action', 'select-files');
            }
          }
        },
        {
          label: 'Select Folder',
          accelerator: 'CmdOrCtrl+Shift+O',
          click: () => {
            const mainWindow = getMainWindow();
            if (mainWindow) {
              mainWindow.webContents.send('menu-action', 'select-folder');
            }
          }
        },
        { type: 'separator' },
        {
          label: 'Settings',
          accelerator: 'CmdOrCtrl+,',
          click: () => {
            const mainWindow = getMainWindow();
            if (mainWindow) {
              mainWindow.webContents.send('menu-action', 'open-settings');
            }
          }
        },
        { type: 'separator' },
        {
          label: 'Exit',
          accelerator: getQuitAccelerator(),
          click: () => {
            const { app } = require('electron');
            app.quit();
          }
        }
      ]
    },
    {
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
    },
    {
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
    },
    {
      label: 'Window',
      submenu: [
        { label: 'Minimize', accelerator: 'CmdOrCtrl+M', role: 'minimize' },
        { label: 'Close', accelerator: 'CmdOrCtrl+W', role: 'close' }
      ]
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'About StratoSort',
          click: () => {
            const mainWindow = getMainWindow();
            if (mainWindow) {
              mainWindow.webContents.send('menu-action', 'show-about');
            }
          }
        },
        { type: 'separator' },
        {
          label: 'Documentation',
          click: () => {
            shell.openExternal('https://github.com');
          }
        }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

module.exports = {
  createApplicationMenu
};
