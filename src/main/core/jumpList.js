/**
 * Windows Jump List Module
 *
 * Handles Windows Jump List integration and command-line task handling.
 * Extracted from simple-main.js for better maintainability.
 *
 * @module core/jumpList
 */

const { app, BrowserWindow, shell } = require('electron');
const { isWindows } = require('../../shared/platformUtils');
const { logger } = require('../../shared/logger');

logger.setContext('JumpList');

/**
 * Handle command-line tasks from Jump List
 * @param {string[]} args - Command line arguments
 */
function handleCommandLineTasks(args) {
  try {
    if (args.includes('--open-documents')) {
      try {
        const docs = app.getPath('documents');
        shell.openPath(docs);
        logger.info('[JUMP-LIST] Opened documents folder');
      } catch (error) {
        logger.error('[JUMP-LIST] Failed to open documents folder:', error);
      }
    }

    if (args.includes('--analyze-folder')) {
      // Bring window to front and trigger select directory hint
      const win = BrowserWindow.getAllWindows()[0];
      if (win) {
        win.focus();
        try {
          win.webContents.send('operation-progress', {
            type: 'hint',
            message: 'Use Select Directory to analyze a folder'
          });
          logger.info('[JUMP-LIST] Sent analyze folder hint to renderer');
        } catch (error) {
          logger.error('[JUMP-LIST] Failed to send hint message:', error);
        }
      }
    }
  } catch (error) {
    logger.error('[JUMP-LIST] Failed to handle command-line tasks:', error);
  }
}

/**
 * Setup Windows Jump List tasks
 */
function setupWindowsJumpList() {
  if (!isWindows) {
    logger.debug('[JUMP-LIST] Skipping Jump List setup (not Windows)');
    return;
  }

  try {
    app.setAppUserModelId('com.stratosort.app');
    app.setJumpList([
      {
        type: 'tasks',
        items: [
          {
            type: 'task',
            title: 'Analyze Folder…',
            program: process.execPath,
            args: '--analyze-folder',
            iconPath: process.execPath,
            iconIndex: 0
          },
          {
            type: 'task',
            title: 'Open Documents Folder',
            program: process.execPath,
            args: '--open-documents',
            iconPath: process.execPath,
            iconIndex: 0
          }
        ]
      }
    ]);
    logger.info('[JUMP-LIST] Windows Jump List configured');
  } catch (error) {
    logger.error('[JUMP-LIST] Failed to set Windows Jump List:', error);
  }
}

/**
 * Initialize Jump List functionality
 * - Handles command-line tasks from previous invocation
 * - Sets up Jump List for future invocations
 */
function initializeJumpList() {
  const args = process.argv.slice(1);
  handleCommandLineTasks(args);
  setupWindowsJumpList();
}

module.exports = {
  initializeJumpList,
  handleCommandLineTasks,
  setupWindowsJumpList
};
