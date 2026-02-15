const { app } = require('electron');
const path = require('path');
const fs = require('fs').promises;
const crypto = require('crypto');
const { createLogger } = require('../../shared/logger');
const { getLegacyUserDataPaths } = require('./userDataMigration');

const logger = createLogger('CustomFolders');
const CUSTOM_FOLDERS_FILENAME = 'custom-folders.json';

// Serialize concurrent save operations to prevent race conditions
let _saveQueue = Promise.resolve();

const normalizeName = (value) =>
  String(value || '')
    .trim()
    .toLowerCase();

const normalizeFolderPath = (value) => {
  if (typeof value !== 'string') return '';
  const normalized = path.normalize(value);
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
};

const buildFolderKey = (folder) =>
  `${normalizeName(folder?.name)}|${normalizeFolderPath(folder?.path)}`;

function getCustomFoldersPath() {
  const userDataPath = app.getPath('userData');
  return path.join(userDataPath, CUSTOM_FOLDERS_FILENAME);
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

/**
 * Ensure the essential Uncategorized fallback folder exists.
 * We no longer auto-inject the full default set — users choose their own
 * folder structure. The full defaults are only applied via "Reset to Defaults".
 */
async function ensureUncategorizedFolder(folders) {
  const safeFolders = Array.isArray(folders) ? folders : [];
  const hasUncategorized = safeFolders.some(
    (folder) => normalizeName(folder?.name) === 'uncategorized'
  );

  if (hasUncategorized) return safeFolders;

  const documentsDir = app.getPath('documents');
  const baseDir = path.join(documentsDir, 'StratoSort');
  const uncategorized = createUncategorizedFolder(baseDir);

  logger.info('[STORAGE] Adding missing Uncategorized fallback folder');

  try {
    await fs.mkdir(uncategorized.path, { recursive: true });
    logger.info('[STORAGE] Created Uncategorized directory at:', uncategorized.path);
  } catch (error) {
    logger.error('[STORAGE] Failed to create Uncategorized directory:', error);
  }

  const updatedFolders = [...safeFolders, uncategorized];

  try {
    await saveCustomFolders(updatedFolders);
    logger.info('[STORAGE] Persisted Uncategorized folder to custom-folders.json');
  } catch (error) {
    logger.error('[STORAGE] Failed to persist Uncategorized folder:', error);
  }

  return updatedFolders;
}

async function readCustomFoldersFile(filePath) {
  try {
    const data = await fs.readFile(filePath, 'utf-8');
    if (!data || typeof data !== 'string') return null;
    const parsed = JSON.parse(data);
    if (!Array.isArray(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function hasCustomFolders(folders, defaultNameSet) {
  return (Array.isArray(folders) ? folders : []).some((folder) => {
    const nameKey = normalizeName(folder?.name);
    if (!nameKey) return false;
    if (defaultNameSet.has(nameKey)) return false;
    return true;
  });
}

function mergeFolders(currentFolders, legacyFolders) {
  const merged = [];
  const seenKeys = new Set();

  for (const folder of currentFolders) {
    const key = buildFolderKey(folder);
    if (!key || seenKeys.has(key)) continue;
    seenKeys.add(key);
    merged.push(folder);
  }

  for (const folder of legacyFolders) {
    const key = buildFolderKey(folder);
    if (!key || seenKeys.has(key)) continue;
    seenKeys.add(key);
    merged.push(folder);
  }

  return merged;
}

async function recoverLegacyCustomFolders(currentFolders, defaultNameSet) {
  if (hasCustomFolders(currentFolders, defaultNameSet)) return currentFolders;

  const legacyPaths = getLegacyUserDataPaths();
  const recoveredFolders = [];
  const sources = [];

  for (const legacyPath of legacyPaths) {
    const legacyFilePath = path.join(legacyPath, CUSTOM_FOLDERS_FILENAME);
    const legacyData = await readCustomFoldersFile(legacyFilePath);
    if (!legacyData || legacyData.length === 0) continue;
    const normalizedLegacy = normalizeFolderPaths(legacyData);
    if (!hasCustomFolders(normalizedLegacy, defaultNameSet)) continue;
    recoveredFolders.push(...normalizedLegacy);
    sources.push(legacyFilePath);
  }

  if (recoveredFolders.length === 0) return currentFolders;

  const merged = mergeFolders(currentFolders, recoveredFolders);
  const addedCount = merged.length - currentFolders.length;
  if (addedCount <= 0) return currentFolders;

  try {
    await saveCustomFolders(merged);
    logger.warn('[STORAGE] Recovered custom smart folders from legacy data', {
      addedCount,
      sources
    });
  } catch (error) {
    logger.error('[STORAGE] Failed to persist recovered custom folders:', error);
  }

  return merged;
}

/**
 * Create a single Uncategorized folder entry.
 * Used for first-launch bootstrapping and the ensureUncategorizedFolder guard.
 */
function createUncategorizedFolder(baseDir) {
  return {
    id: `default-uncategorized-${crypto.randomUUID().slice(0, 8)}`,
    name: 'Uncategorized',
    path: path.join(baseDir, 'Uncategorized'),
    description: "Default folder for files that don't match any smart folder",
    keywords: [],
    category: 'uncategorized',
    isDefault: true,
    createdAt: new Date().toISOString()
  };
}

/**
 * Full default smart folders that match the categorization system in fallbackUtils.js
 * Only used when the user explicitly clicks "Reset to Defaults"
 */
function getDefaultSmartFolders(baseDir) {
  // FIX (M-8): Use crypto.randomUUID() instead of Date.now() offsets.
  // Two calls in the same millisecond previously produced identical IDs.
  const uid = () => crypto.randomUUID().slice(0, 8);
  return [
    {
      id: `default-documents-${uid()}`,
      name: 'Documents',
      path: path.join(baseDir, 'Documents'),
      description: 'PDF, Word, and text documents',
      keywords: ['document', 'pdf', 'doc', 'docx', 'txt', 'rtf', 'odt'],
      category: 'documents',
      isDefault: true,
      createdAt: new Date().toISOString()
    },
    {
      id: `default-images-${uid()}`,
      name: 'Images',
      path: path.join(baseDir, 'Images'),
      description: 'Photos and image files',
      keywords: ['image', 'photo', 'picture', 'png', 'jpg', 'jpeg', 'gif', 'svg'],
      category: 'images',
      isDefault: true,
      createdAt: new Date().toISOString()
    },
    {
      id: `default-videos-${uid()}`,
      name: 'Videos',
      path: path.join(baseDir, 'Videos'),
      description: 'Video and movie files',
      keywords: ['video', 'movie', 'mp4', 'avi', 'mov', 'mkv', 'recording'],
      category: 'videos',
      isDefault: true,
      createdAt: new Date().toISOString()
    },
    {
      id: `default-music-${uid()}`,
      name: 'Music',
      path: path.join(baseDir, 'Music'),
      description: 'Audio and music files',
      keywords: ['music', 'audio', 'mp3', 'wav', 'flac', 'song', 'sound'],
      category: 'music',
      isDefault: true,
      createdAt: new Date().toISOString()
    },
    {
      id: `default-spreadsheets-${uid()}`,
      name: 'Spreadsheets',
      path: path.join(baseDir, 'Spreadsheets'),
      description: 'Excel and spreadsheet files',
      keywords: ['spreadsheet', 'excel', 'xlsx', 'xls', 'csv', 'table', 'data'],
      category: 'spreadsheets',
      isDefault: true,
      createdAt: new Date().toISOString()
    },
    {
      id: `default-presentations-${uid()}`,
      name: 'Presentations',
      path: path.join(baseDir, 'Presentations'),
      description: 'PowerPoint and presentation files',
      keywords: ['presentation', 'powerpoint', 'pptx', 'ppt', 'slides', 'deck'],
      category: 'presentations',
      isDefault: true,
      createdAt: new Date().toISOString()
    },
    {
      id: `default-archives-${uid()}`,
      name: 'Archives',
      path: path.join(baseDir, 'Archives'),
      description: 'Compressed and archive files',
      keywords: ['archive', 'zip', 'rar', '7z', 'tar', 'compressed', 'backup'],
      category: 'archives',
      isDefault: true,
      createdAt: new Date().toISOString()
    },
    {
      id: `default-uncategorized-${uid()}`,
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
    if (!Array.isArray(parsed)) {
      throw new Error('Invalid custom folders format: expected array');
    }
    const normalized = normalizeFolderPaths(parsed);
    const documentsDir = app.getPath('documents');
    const baseDir = path.join(documentsDir, 'StratoSort');
    const defaultNameSet = new Set(
      getDefaultSmartFolders(baseDir).map((folder) => normalizeName(folder.name))
    );

    const recovered = await recoverLegacyCustomFolders(normalized, defaultNameSet);

    // Only ensure the essential Uncategorized fallback exists
    return await ensureUncategorizedFolder(recovered);
  } catch {
    const documentsDir = app.getPath('documents');
    const baseDir = path.join(documentsDir, 'StratoSort');
    const defaultNameSet = new Set(
      getDefaultSmartFolders(baseDir).map((folder) => normalizeName(folder.name))
    );

    const backupRestore = await restoreFromBackup();
    if (backupRestore?.success && Array.isArray(backupRestore.folders)) {
      const normalizedBackup = normalizeFolderPaths(backupRestore.folders);
      const recoveredFromBackup = await recoverLegacyCustomFolders(
        normalizedBackup,
        defaultNameSet
      );
      return await ensureUncategorizedFolder(recoveredFromBackup);
    }

    const recoveredLegacy = await recoverLegacyCustomFolders([], defaultNameSet);
    if (recoveredLegacy.length > 0) {
      return await ensureUncategorizedFolder(recoveredLegacy);
    }

    logger.info('[STARTUP] No saved custom folders found, creating Uncategorized fallback');

    // First launch: only create the essential Uncategorized folder.
    // Users build their own folder structure; full defaults are available via "Reset to Defaults".
    const uncategorized = createUncategorizedFolder(baseDir);

    try {
      await fs.mkdir(uncategorized.path, { recursive: true });
      logger.info('[STARTUP] Created Uncategorized directory');
    } catch (err) {
      logger.error('[STARTUP] Failed to create Uncategorized directory:', err);
    }

    try {
      await saveCustomFolders([uncategorized]);
      logger.info('[STARTUP] Saved Uncategorized folder to disk');
    } catch (err) {
      logger.error('[STARTUP] Failed to save Uncategorized folder:', err);
    }

    return [uncategorized];
  }
}

function saveCustomFolders(folders) {
  // Serialize saves through a queue to prevent concurrent write races
  const op = _saveQueue
    .then(() => _doSaveCustomFolders(folders))
    .catch((error) => {
      logger.error('[ERROR] Failed to save custom folders:', error);
      throw error;
    });
  _saveQueue = op.catch(() => {}); // Ensure queue continues even after errors
  return op;
}

async function _doSaveCustomFolders(folders) {
  const filePath = getCustomFoldersPath();
  const toSave = normalizeFolderPaths(folders);
  const data = JSON.stringify(toSave, null, 2);

  // Create backup before saving to prevent data loss
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

  // Use atomic write (temp file + rename) to prevent corruption on crash
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

    // Restore the backup using atomic write (temp + rename)
    const tempPath = `${filePath}.tmp.${Date.now()}`;
    try {
      await fs.writeFile(tempPath, backupData);
      await fs.rename(tempPath, filePath);
    } catch (restoreError) {
      try {
        await fs.unlink(tempPath);
      } catch {
        // Ignore temp cleanup errors
      }
      throw restoreError;
    }
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
