/**
 * File Selection Handlers
 *
 * Handlers for file selection dialogs.
 *
 * @module ipc/files/fileSelectionHandlers
 */

const path = require('path');
const fs = require('fs').promises;
const {
  SUPPORTED_DOCUMENT_EXTENSIONS,
  SUPPORTED_IMAGE_EXTENSIONS,
  SUPPORTED_ARCHIVE_EXTENSIONS,
  SUPPORTED_3D_EXTENSIONS,
  SUPPORTED_DESIGN_EXTENSIONS
} = require('../../../shared/constants');
const { withErrorLogging, safeHandle } = require('../ipcWrappers');
const { logger } = require('../../../shared/logger');
const SettingsService = require('../../services/SettingsService');

logger.setContext('IPC:Files:Selection');

/**
 * Get the last browsed path from settings, falling back to documents folder
 * @returns {Promise<string|undefined>} The default path for file dialogs
 */
async function getDefaultBrowsePath() {
  try {
    const settingsService = SettingsService.getInstance();
    const settings = await settingsService.load();
    if (settings.lastBrowsedPath) {
      // Verify the path still exists
      try {
        await fs.access(settings.lastBrowsedPath);
        return settings.lastBrowsedPath;
      } catch {
        // Path no longer exists, fall through to default
      }
    }
  } catch (err) {
    logger.warn('[FILE-SELECTION] Failed to get last browsed path:', err.message);
  }
  // Return undefined to let the dialog use its default
  return undefined;
}

/**
 * Save the last browsed path to settings
 * @param {string} browsedPath - The path that was browsed/selected
 */
async function saveLastBrowsedPath(browsedPath) {
  try {
    if (!browsedPath) return;

    // Get the directory of the selected path
    const dirPath = (await fs.stat(browsedPath)).isDirectory()
      ? browsedPath
      : path.dirname(browsedPath);

    const settingsService = SettingsService.getInstance();
    const settings = await settingsService.load();

    // Only save if different from current
    if (settings.lastBrowsedPath !== dirPath) {
      await settingsService.save({ ...settings, lastBrowsedPath: dirPath });
      logger.debug('[FILE-SELECTION] Saved last browsed path:', dirPath);
    }
  } catch (err) {
    // Non-fatal - just log and continue
    logger.warn('[FILE-SELECTION] Failed to save last browsed path:', err.message);
  }
}

/**
 * Build file filters for dialog
 */
function buildFileFilters() {
  const stripDot = (exts) => exts.map((e) => (e.startsWith('.') ? e.slice(1) : e));

  const docs = stripDot([...SUPPORTED_DOCUMENT_EXTENSIONS, '.txt', '.md', '.rtf']);
  const images = stripDot(SUPPORTED_IMAGE_EXTENSIONS);
  const archives = stripDot(SUPPORTED_ARCHIVE_EXTENSIONS);
  const models3d = stripDot(SUPPORTED_3D_EXTENSIONS);
  const designs = stripDot(SUPPORTED_DESIGN_EXTENSIONS);
  const allSupported = Array.from(
    new Set([...docs, ...images, ...archives, ...models3d, ...designs])
  );

  return [
    { name: 'All Supported Files', extensions: allSupported },
    { name: 'Documents', extensions: docs },
    { name: 'Images', extensions: images },
    { name: 'Archives', extensions: archives },
    { name: '3D Models', extensions: models3d },
    { name: 'Design Files', extensions: designs },
    { name: 'All Files', extensions: ['*'] }
  ];
}

/**
 * Recursively scan folder for supported files
 */
// Unused but kept for potential future recursive scanning needs
// eslint-disable-next-line no-unused-vars
async function scanFolder(folderPath, supportedExts, log, depth = 0, maxDepth = 3) {
  if (depth > maxDepth) return [];

  try {
    const items = await fs.readdir(folderPath, { withFileTypes: true });
    const foundFiles = [];

    for (const item of items) {
      const itemPath = path.join(folderPath, item.name);

      if (item.isFile()) {
        const ext = path.extname(item.name).toLowerCase();
        if (supportedExts.includes(ext)) {
          foundFiles.push(itemPath);
        }
      } else if (
        item.isDirectory() &&
        !item.name.startsWith('.') &&
        !item.name.startsWith('node_modules')
      ) {
        const subFiles = await scanFolder(itemPath, supportedExts, log, depth + 1, maxDepth);
        foundFiles.push(...subFiles);
      }
    }

    return foundFiles;
  } catch (error) {
    log.warn(`[FILE-SELECTION] Error scanning folder ${folderPath}:`, error.message);
    return [];
  }
}

/**
 * Get supported extensions list
 */
function getSupportedExtensions() {
  return Array.from(
    new Set([
      ...SUPPORTED_DOCUMENT_EXTENSIONS,
      ...SUPPORTED_IMAGE_EXTENSIONS,
      ...SUPPORTED_ARCHIVE_EXTENSIONS,
      ...SUPPORTED_3D_EXTENSIONS,
      ...SUPPORTED_DESIGN_EXTENSIONS,
      '.csv',
      '.json',
      '.xml',
      '.txt',
      '.md',
      '.rtf'
    ])
  );
}

const { IpcServiceContext, createFromLegacyParams } = require('../IpcServiceContext');

/**
 * Register file selection IPC handlers
 * @param {IpcServiceContext|Object} servicesOrParams - Service context or legacy parameters
 */
function registerFileSelectionHandlers(servicesOrParams) {
  let container;
  if (servicesOrParams instanceof IpcServiceContext) {
    container = servicesOrParams;
  } else {
    container = createFromLegacyParams(servicesOrParams);
  }

  const { ipcMain, IPC_CHANNELS, logger } = container.core;
  const { dialog, getMainWindow } = container.electron;

  const log = logger || require('../../../shared/logger').logger;
  const supportedExts = getSupportedExtensions();
  const { app } = require('electron');

  // Select directory handler
  safeHandle(
    ipcMain,
    IPC_CHANNELS.FILES.SELECT_DIRECTORY,
    withErrorLogging(log, async () => {
      log.debug('[FILE-SELECTION] Select directory handler called');
      const mainWindow = getMainWindow();

      try {
        // Get the last browsed path to use as default
        const defaultPath = await getDefaultBrowsePath();

        const result = await dialog.showOpenDialog(mainWindow || null, {
          properties: ['openDirectory', 'createDirectory'],
          title: 'Select Folder',
          buttonLabel: 'Select Folder',
          defaultPath
        });

        if (result.canceled || !result.filePaths.length) {
          return { success: false, path: null };
        }

        const selectedPath = result.filePaths[0];

        // Save the selected path for future dialogs
        await saveLastBrowsedPath(selectedPath);

        return { success: true, path: selectedPath };
      } catch (error) {
        log.error('[FILE-SELECTION] Error selecting directory:', error);
        return { success: false, error: error.message, path: null };
      }
    })
  );

  // Get documents path handler
  safeHandle(
    ipcMain,
    IPC_CHANNELS.FILES.GET_DOCUMENTS_PATH,
    withErrorLogging(log, async () => {
      log.debug('[FILE-SELECTION] Get documents path handler called');
      try {
        const documentsPath = app.getPath('documents');
        return { success: true, path: documentsPath };
      } catch (error) {
        log.error('[FILE-SELECTION] Error getting documents path:', error);
        return { success: false, error: error.message, path: null };
      }
    })
  );

  // Get file stats handler
  safeHandle(
    ipcMain,
    IPC_CHANNELS.FILES.GET_FILE_STATS,
    withErrorLogging(log, async (_event, filePath) => {
      log.debug('[FILE-SELECTION] Get file stats handler called for:', filePath);
      try {
        if (!filePath || typeof filePath !== 'string') {
          return { success: false, error: 'Invalid file path', stats: null };
        }
        const stats = await fs.stat(filePath);
        return {
          success: true,
          stats: {
            size: stats.size,
            isFile: stats.isFile(),
            isDirectory: stats.isDirectory(),
            created: stats.birthtime,
            modified: stats.mtime,
            accessed: stats.atime
          }
        };
      } catch (error) {
        log.error('[FILE-SELECTION] Error getting file stats:', error);
        return { success: false, error: error.message, stats: null };
      }
    })
  );

  // Get files in directory handler
  safeHandle(
    ipcMain,
    IPC_CHANNELS.FILES.GET_FILES_IN_DIRECTORY,
    withErrorLogging(log, async (_event, dirPath) => {
      log.debug('[FILE-SELECTION] Get files in directory handler called for:', dirPath);
      try {
        if (!dirPath || typeof dirPath !== 'string') {
          return { success: false, error: 'Invalid directory path', files: [] };
        }
        const items = await fs.readdir(dirPath, { withFileTypes: true });
        const files = items
          .filter((item) => item.isFile())
          .map((item) => ({
            name: item.name,
            path: path.join(dirPath, item.name)
          }));
        return { success: true, files };
      } catch (error) {
        log.error('[FILE-SELECTION] Error getting files in directory:', error);
        return { success: false, error: error.message, files: [] };
      }
    })
  );

  // Select files handler
  safeHandle(
    ipcMain,
    IPC_CHANNELS.FILES.SELECT,
    withErrorLogging(log, async () => {
      log.info('[MAIN-FILE-SELECT] ===== FILE SELECTION HANDLER CALLED =====');

      const mainWindow = getMainWindow();
      log.info('[MAIN-FILE-SELECT] mainWindow exists?', !!mainWindow);

      try {
        // Focus window before dialog
        if (mainWindow) {
          if (!mainWindow.isFocused()) {
            log.info('[MAIN-FILE-SELECT] Focusing window before dialog...');
            mainWindow.focus();
          }
          if (mainWindow.isMinimized()) mainWindow.restore();
          if (!mainWindow.isVisible()) mainWindow.show();
          if (!mainWindow.isFocused()) mainWindow.focus();

          const { TIMEOUTS } = require('../../../shared/performanceConstants');
          await new Promise((resolve) => {
            const t = setTimeout(resolve, TIMEOUTS.DELAY_BATCH);
            try {
              t.unref();
            } catch {
              // Non-fatal
            }
          });
        }

        // Get the last browsed path to use as default
        const defaultPath = await getDefaultBrowsePath();

        const result = await dialog.showOpenDialog(mainWindow || null, {
          properties: ['openFile', 'multiSelections', 'dontAddToRecent'],
          title: 'Select Files to Organize',
          buttonLabel: 'Select Files',
          filters: buildFileFilters(),
          defaultPath
        });

        log.info('[MAIN-FILE-SELECT] Dialog closed, result:', result);

        if (result.canceled || !result.filePaths.length) {
          return { success: false, files: [] };
        }

        log.info(`[FILE-SELECTION] Selected ${result.filePaths.length} items`);

        const allFiles = [];

        for (const selectedPath of result.filePaths) {
          const ext = path.extname(selectedPath).toLowerCase();
          if (!ext) {
            log.warn('[FILE-SELECTION] Skipping path without extension', selectedPath);
            continue;
          }
          if (supportedExts.includes(ext)) {
            try {
              const stats = await fs.stat(selectedPath);
              if (stats.isFile()) {
                allFiles.push(selectedPath);
              }
            } catch (statError) {
              log.warn('[FILE-SELECTION] Skipping path with stat error', {
                path: selectedPath,
                error: statError.message
              });
            }
          }
        }

        log.info(`[FILE-SELECTION] Total files after expansion: ${allFiles.length}`);

        // Save the selected path for future dialogs (use first selected path)
        if (result.filePaths.length > 0) {
          await saveLastBrowsedPath(result.filePaths[0]);
        }

        return {
          success: true,
          files: allFiles.map((filePath) => ({
            path: filePath,
            name: path.basename(filePath)
          })),
          count: allFiles.length
        };
      } catch (error) {
        log.error('[FILE-SELECTION] Error in file selection:', error);
        return { success: false, error: error.message, files: [] };
      }
    })
  );
}

module.exports = { registerFileSelectionHandlers };
