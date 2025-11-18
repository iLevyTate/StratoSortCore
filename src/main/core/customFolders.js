const { app } = require('electron');
const path = require('path');
const fs = require('fs').promises;
const { logger } = require('../../shared/logger');

function getCustomFoldersPath() {
  const userDataPath = app.getPath('userData');
  return path.join(userDataPath, 'custom-folders.json');
}

function normalizeFolderPaths(folders) {
  try {
    return (Array.isArray(folders) ? folders : []).map((f) => {
      const normalized = { ...f };
      if (
        normalized &&
        typeof normalized.path === 'string' &&
        normalized.path.trim()
      ) {
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
    (f) => f.isDefault && f.name.toLowerCase() === 'uncategorized',
  );

  if (!hasUncategorized) {
    logger.info('[STORAGE] Adding missing Uncategorized default folder');
    const documentsDir = app.getPath('documents');
    const uncategorizedPath = path.join(
      documentsDir,
      'StratoSort',
      'Uncategorized',
    );

    // Create physical directory
    try {
      await fs.mkdir(uncategorizedPath, { recursive: true });
      logger.info(
        '[STORAGE] Created physical Uncategorized directory at:',
        uncategorizedPath,
      );
    } catch (error) {
      logger.error(
        '[STORAGE] Failed to create Uncategorized directory:',
        error,
      );
    }

    const newFolder = {
      id: 'default-uncategorized-' + Date.now(),
      name: 'Uncategorized',
      path: uncategorizedPath,
      description: "Default folder for files that don't match any category",
      keywords: [],
      isDefault: true,
      createdAt: new Date().toISOString(),
    };

    folders.push(newFolder);

    // Save to persist the change
    try {
      await saveCustomFolders(folders);
      logger.info(
        '[STORAGE] Persisted Uncategorized folder to custom-folders.json',
      );
    } catch (error) {
      logger.error('[STORAGE] Failed to persist Uncategorized folder:', error);
    }
  }

  return folders;
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
    logger.info(
      '[STARTUP] No saved custom folders found, creating only Uncategorized default',
    );
    const documentsDir = app.getPath('documents');
    const uncategorizedPath = path.join(
      documentsDir,
      'StratoSort',
      'Uncategorized',
    );

    // Only create the essential Uncategorized folder
    // Users will configure their own smart folders through the UI
    const defaultFolders = [
      {
        id: 'default-uncategorized-' + Date.now(),
        name: 'Uncategorized',
        path: uncategorizedPath,
        description:
          "Default folder for files that don't match any smart folder",
        keywords: [],
        isDefault: true,
        createdAt: new Date().toISOString(),
      },
    ];

    // Create physical directory
    try {
      await fs.mkdir(uncategorizedPath, { recursive: true });
      logger.info(
        '[STARTUP] Created Uncategorized directory:',
        uncategorizedPath,
      );
    } catch (err) {
      logger.error('[STARTUP] Failed to create Uncategorized directory:', err);
    }

    // Save the default folder
    try {
      await saveCustomFolders(defaultFolders);
      logger.info('[STARTUP] Saved Uncategorized folder to disk');
    } catch (err) {
      logger.error('[STARTUP] Failed to save default folder:', err);
    }

    return defaultFolders;
  }
}

async function saveCustomFolders(folders) {
  try {
    const filePath = getCustomFoldersPath();
    const toSave = normalizeFolderPaths(folders);
    await fs.writeFile(filePath, JSON.stringify(toSave, null, 2));
    logger.info('[STORAGE] Saved custom folders to:', filePath);
  } catch (error) {
    logger.error('[ERROR] Failed to save custom folders:', error);
  }
}

module.exports = {
  getCustomFoldersPath,
  loadCustomFolders,
  saveCustomFolders,
};
