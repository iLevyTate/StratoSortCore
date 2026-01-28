const { app } = require('electron');
const path = require('path');
const fs = require('fs').promises;
const { logger } = require('../../shared/logger');
const { getLegacyUserDataPaths } = require('./userDataMigration');

logger.setContext('CustomFolders');

const CUSTOM_FOLDERS_FILENAME = 'custom-folders.json';

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

async function ensureDefaultSmartFolders(folders) {
  const safeFolders = Array.isArray(folders) ? folders : [];
  const documentsDir = app.getPath('documents');
  const baseDir = path.join(documentsDir, 'StratoSort');
  const defaultFolders = getDefaultSmartFolders(baseDir);
  const defaultNameSet = new Set(defaultFolders.map((folder) => normalizeName(folder.name)));
  const existingNameSet = new Set(safeFolders.map((folder) => normalizeName(folder?.name)));
  const isDefaultName = (nameKey) =>
    nameKey && nameKey !== 'uncategorized' && defaultNameSet.has(nameKey);
  const hasDefaultFlag = safeFolders.some(
    (folder) => folder?.isDefault && isDefaultName(normalizeName(folder?.name))
  );
  const hasDefaultName = safeFolders.some((folder) => isDefaultName(normalizeName(folder?.name)));
  const hasCustom = safeFolders.some((folder) => {
    const nameKey = normalizeName(folder?.name);
    return nameKey && !defaultNameSet.has(nameKey);
  });
  const shouldEnsureDefaults =
    !hasCustom && (hasDefaultFlag || hasDefaultName || !safeFolders.length);

  const missingDefaults = defaultFolders.filter((folder) => {
    const nameKey = normalizeName(folder.name);
    if (existingNameSet.has(nameKey)) return false;
    if (!shouldEnsureDefaults && nameKey !== 'uncategorized') return false;
    return true;
  });

  if (missingDefaults.length === 0) return safeFolders;

  logger.info('[STORAGE] Adding missing default smart folders:', {
    count: missingDefaults.length,
    names: missingDefaults.map((folder) => folder.name)
  });

  for (const folder of missingDefaults) {
    try {
      await fs.mkdir(folder.path, { recursive: true });
      logger.info(`[STORAGE] Created physical ${folder.name} directory at:`, folder.path);
    } catch (error) {
      logger.error(`[STORAGE] Failed to create ${folder.name} directory:`, error);
    }
  }

  const updatedFolders = [...safeFolders, ...missingDefaults];

  try {
    await saveCustomFolders(updatedFolders);
    logger.info('[STORAGE] Persisted default smart folder updates to custom-folders.json');
  } catch (error) {
    logger.error('[STORAGE] Failed to persist default folders:', error);
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
    const documentsDir = app.getPath('documents');
    const baseDir = path.join(documentsDir, 'StratoSort');
    const defaultNameSet = new Set(
      getDefaultSmartFolders(baseDir).map((folder) => normalizeName(folder.name))
    );

    const recovered = await recoverLegacyCustomFolders(normalized, defaultNameSet);

    // Ensure missing defaults (including Uncategorized) are added as needed
    return await ensureDefaultSmartFolders(recovered);
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
      return await ensureDefaultSmartFolders(recoveredFromBackup);
    }

    const recoveredLegacy = await recoverLegacyCustomFolders([], defaultNameSet);
    if (recoveredLegacy.length > 0) {
      return await ensureDefaultSmartFolders(recoveredLegacy);
    }

    logger.info('[STARTUP] No saved custom folders found, creating default smart folders');

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
