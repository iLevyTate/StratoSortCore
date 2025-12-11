/**
 * Window Control IPC Handlers
 *
 * Handles window minimize, maximize, close operations for custom title bar.
 */
const { createHandler } = require('./ipcWrappers');

function registerWindowIpc({ ipcMain, IPC_CHANNELS, logger, getMainWindow }) {
  const context = 'Window';

  // Helper to get window safely
  const getWindow = () => {
    const win = getMainWindow();
    return win && !win.isDestroyed() ? win : null;
  };

  ipcMain.handle(
    IPC_CHANNELS.WINDOW.MINIMIZE,
    createHandler({
      logger,
      context,
      handler: async () => {
        const win = getWindow();
        if (win) win.minimize();
        return true;
      }
    })
  );

  ipcMain.handle(
    IPC_CHANNELS.WINDOW.MAXIMIZE,
    createHandler({
      logger,
      context,
      handler: async () => {
        const win = getWindow();
        if (win) win.maximize();
        return true;
      }
    })
  );

  ipcMain.handle(
    IPC_CHANNELS.WINDOW.UNMAXIMIZE,
    createHandler({
      logger,
      context,
      handler: async () => {
        const win = getWindow();
        if (win) win.unmaximize();
        return true;
      }
    })
  );

  ipcMain.handle(
    IPC_CHANNELS.WINDOW.TOGGLE_MAXIMIZE,
    createHandler({
      logger,
      context,
      handler: async () => {
        const win = getWindow();
        if (win) {
          if (win.isMaximized()) {
            win.unmaximize();
          } else {
            win.maximize();
          }
          return win.isMaximized();
        }
        return false;
      }
    })
  );

  ipcMain.handle(
    IPC_CHANNELS.WINDOW.IS_MAXIMIZED,
    createHandler({
      logger,
      context,
      handler: async () => {
        const win = getWindow();
        return win ? win.isMaximized() : false;
      }
    })
  );

  ipcMain.handle(
    IPC_CHANNELS.WINDOW.CLOSE,
    createHandler({
      logger,
      context,
      handler: async () => {
        const win = getWindow();
        if (win) win.close();
        return true;
      }
    })
  );
}

module.exports = registerWindowIpc;
