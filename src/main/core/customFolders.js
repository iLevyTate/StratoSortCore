const { app } = require('electron');
const path = require('path');
const fs = require('fs').promises;
const { logger } = require('../../shared/logger');
logger.setContext('CustomFolders');

function getCustomFoldersPath() {
  const userDataPath = app.getPath('userData');
  return path.join(userDataPath, 'custom-folders.json');
}

function normalizeFolderPaths(folders) {
  try {
    return (Array.isArray(folders) ? folders : []).map((f) => {
      const normalized = { ...f };
      if (normalized && typeof normalized.path === 'string' && normalized.path.trim()) {
        normalized.path = path.normalize(normalized.path);
      }
      return normalized;
    });
  } catch {
    return Array.isArray(folders) ? folders : [];
  }
}

async function ensureUncategorizedFolder(folders) {
  // Always ensure the "Uncategorized" default folder exists
  const hasUncategorized = folders.some(
    (f) => f.isDefault && f.name.toLowerCase() === 'uncategorized'
  );

  if (!hasUncategorized) {
    logger.info('[STORAGE] Adding missing Uncategorized default folder');
    const documentsDir = app.getPath('documents');
    const uncategorizedPath = path.join(documentsDir, 'StratoSort', 'Uncategorized');

    // Create physical directory
    try {
      await fs.mkdir(uncategorizedPath, { recursive: true });
      logger.info('[STORAGE] Created physical Uncategorized directory at:', uncategorizedPath);
    } catch (error) {
      logger.error('[STORAGE] Failed to create Uncategorized directory:', error);
    }

    const newFolder = {
      id: `default-uncategorized-${Date.now()}`,
      name: 'Uncategorized',
      path: uncategorizedPath,
      description: "Default folder for files that don't match any category",
      keywords: [],
      isDefault: true,
      createdAt: new Date().toISOString()
    };

    folders.push(newFolder);

    // Save to persist the change
    try {
      await saveCustomFolders(folders);
      logger.info('[STORAGE] Persisted Uncategorized folder to custom-folders.json');
    } catch (error) {
      logger.error('[STORAGE] Failed to persist Uncategorized folder:', error);
    }
  }

  return folders;
}

/**
 * Default smart folders that match the categorization system in fallbackUtils.js
 * These provide a good starting point for file organization
 */
function getDefaultSmartFolders(baseDir) {
  const timestamp = Date.now();
  return [
    {
      id: `default-documents-${timestamp}`,
      name: 'Documents',
      path: path.join(baseDir, 'Documents'),
      description: 'PDF, Word, and text documents',
      keywords: ['document', 'pdf', 'doc', 'docx', 'txt', 'rtf', 'odt'],
      category: 'documents',
      isDefault: true,
      createdAt: new Date().toISOString()
    },
    {
      id: `default-images-${timestamp + 1}`,
      name: 'Images',
      path: path.join(baseDir, 'Images'),
      description: 'Photos and image files',
      keywords: ['image', 'photo', 'picture', 'png', 'jpg', 'jpeg', 'gif', 'svg'],
      category: 'images',
      isDefault: true,
      createdAt: new Date().toISOString()
    },
    {
      id: `default-videos-${timestamp + 2}`,
      name: 'Videos',
      path: path.join(baseDir, 'Videos'),
      description: 'Video and movie files',
      keywords: ['video', 'movie', 'mp4', 'avi', 'mov', 'mkv', 'recording'],
      category: 'videos',
      isDefault: true,
      createdAt: new Date().toISOString()
    },
    {
      id: `default-music-${timestamp + 3}`,
      name: 'Music',
      path: path.join(baseDir, 'Music'),
      description: 'Audio and music files',
      keywords: ['music', 'audio', 'mp3', 'wav', 'flac', 'song', 'sound'],
      category: 'music',
      isDefault: true,
      createdAt: new Date().toISOString()
    },
    {
      id: `default-spreadsheets-${timestamp + 4}`,
      name: 'Spreadsheets',
      path: path.join(baseDir, 'Spreadsheets'),
      description: 'Excel and spreadsheet files',
      keywords: ['spreadsheet', 'excel', 'xlsx', 'xls', 'csv', 'table', 'data'],
      category: 'spreadsheets',
      isDefault: true,
      createdAt: new Date().toISOString()
    },
    {
      id: `default-presentations-${timestamp + 5}`,
      name: 'Presentations',
      path: path.join(baseDir, 'Presentations'),
      description: 'PowerPoint and presentation files',
      keywords: ['presentation', 'powerpoint', 'pptx', 'ppt', 'slides', 'deck'],
      category: 'presentations',
      isDefault: true,
      createdAt: new Date().toISOString()
    },
    {
      id: `default-archives-${timestamp + 6}`,
      name: 'Archives',
      path: path.join(baseDir, 'Archives'),
      description: 'Compressed and archive files',
      keywords: ['archive', 'zip', 'rar', '7z', 'tar', 'compressed', 'backup'],
      category: 'archives',
      isDefault: true,
      createdAt: new Date().toISOString()
    },
    {
      id: `default-uncategorized-${timestamp + 7}`,
      name: 'Uncategorized',
      path: path.join(baseDir, 'Uncategorized'),
      description: "Default folder for files that don't match any smart folder",
      keywords: [],
      category: 'uncategorized',
      isDefault: true,
      createdAt: new Date().toISOString()
    }
  ];
}

async function loadCustomFolders() {
  try {
    const filePath = getCustomFoldersPath();
    const data = await fs.readFile(filePath, 'utf-8');
    const parsed = JSON.parse(data);
    const normalized = normalizeFolderPaths(parsed);

    // Always ensure Uncategorized folder exists (creates physical directory + persists)
    return await ensureUncategorizedFolder(normalized);
  } catch (error) {
    logger.info('[STARTUP] No saved custom folders found, creating default smart folders');
    const documentsDir = app.getPath('documents');
    const baseDir = path.join(documentsDir, 'StratoSort');

    // Create all default smart folders that match the categorization system
    const defaultFolders = getDefaultSmartFolders(baseDir);

    // Create physical directories for each folder
    for (const folder of defaultFolders) {
      try {
        await fs.mkdir(folder.path, { recursive: true });
        logger.info(`[STARTUP] Created directory: ${folder.name}`);
      } catch (err) {
        logger.error(`[STARTUP] Failed to create ${folder.name} directory:`, err);
      }
    }

    // Save the default folders
    try {
      await saveCustomFolders(defaultFolders);
      logger.info('[STARTUP] Saved default smart folders to disk');
    } catch (err) {
      logger.error('[STARTUP] Failed to save default folders:', err);
    }

    return defaultFolders;
  }
}

async function saveCustomFolders(folders) {
  try {
    const filePath = getCustomFoldersPath();
    const toSave = normalizeFolderPaths(folders);
    const data = JSON.stringify(toSave, null, 2);

    // FIX: Create backup before saving to prevent data loss
    try {
      const existingData = await fs.readFile(filePath, 'utf-8');
      if (existingData && existingData.trim()) {
        const backupPath = `${filePath}.backup`;
        await fs.writeFile(backupPath, existingData);
        logger.debug('[STORAGE] Created backup of custom folders');
      }
    } catch (backupError) {
      // File might not exist yet, that's OK
      if (backupError.code !== 'ENOENT') {
        logger.warn('[STORAGE] Failed to create backup:', backupError.message);
      }
    }

    // FIX: Use atomic write (temp file + rename) to prevent corruption on crash
    const tempPath = `${filePath}.tmp.${Date.now()}`;
    try {
      await fs.writeFile(tempPath, data);
      await fs.rename(tempPath, filePath);
    } catch (writeError) {
      // Clean up temp file on failure
      try {
        await fs.unlink(tempPath);
      } catch {
        // Ignore cleanup errors
      }
      throw writeError;
    }

    logger.info('[STORAGE] Saved custom folders to:', filePath);
  } catch (error) {
    logger.error('[ERROR] Failed to save custom folders:', error);
    throw error; // FIX: Re-throw so callers know save failed
  }
}

/**
 * Reset smart folders to defaults
 * This will replace all existing folders with the default set
 */
async function resetToDefaultFolders() {
  const documentsDir = app.getPath('documents');
  const baseDir = path.join(documentsDir, 'StratoSort');
  const defaultFolders = getDefaultSmartFolders(baseDir);

  // Create physical directories for each folder
  for (const folder of defaultFolders) {
    try {
      await fs.mkdir(folder.path, { recursive: true });
      logger.info(`[RESET] Created directory: ${folder.name}`);
    } catch (err) {
      logger.error(`[RESET] Failed to create ${folder.name} directory:`, err);
    }
  }

  // Save the default folders
  await saveCustomFolders(defaultFolders);
  logger.info('[RESET] Reset smart folders to defaults');

  return defaultFolders;
}

/**
 * Restore smart folders from backup
 * Used when the main file is corrupted
 */
async function restoreFromBackup() {
  const filePath = getCustomFoldersPath();
  const backupPath = `${filePath}.backup`;

  try {
    const backupData = await fs.readFile(backupPath, 'utf-8');
    const parsed = JSON.parse(backupData);

    if (!Array.isArray(parsed) || parsed.length === 0) {
      logger.warn('[STORAGE] Backup file is empty or invalid');
      return { success: false, error: 'Backup file is empty or invalid' };
    }

    // Restore the backup
    await fs.writeFile(filePath, backupData);
    logger.info('[STORAGE] Restored custom folders from backup');

    return { success: true, folders: parsed };
  } catch (error) {
    logger.error('[STORAGE] Failed to restore from backup:', error);
    return { success: false, error: error.message };
  }
}

module.exports = {
  getCustomFoldersPath,
  loadCustomFolders,
  saveCustomFolders,
  getDefaultSmartFolders,
  resetToDefaultFolders,
  restoreFromBackup
};
