const { app } = require('electron');
const fs = require('fs').promises;
const path = require('path');
const { logger } = require('../../shared/logger');

logger.setContext('UserDataMigration');

const LEGACY_USERDATA_FOLDERS = [
  'StratoSort',
  'stratosort',
  'elstratosort',
  'Electron',
  'StratoSort-dev',
  'stratosort-dev'
];

const STATE_FILES = [
  { name: 'settings.json', label: 'settings' },
  { name: 'analysis-history.json', label: 'analysis history' },
  { name: 'analysis-index.json', label: 'analysis index' },
  { name: 'analysis-config.json', label: 'analysis config' },
  { name: 'processing-state.json', label: 'processing state' },
  { name: 'undo-actions.json', label: 'undo history' },
  { name: 'user-patterns.json', label: 'organization patterns' },
  { name: 'feedback-memory.json', label: 'feedback memory' },
  { name: 'knowledge-relationships.json', label: 'knowledge graph' },
  { name: 'window-state.json', label: 'window state' }
];

function getUserDataRoot() {
  const currentUserDataPath = app.getPath('userData');
  return path.dirname(currentUserDataPath);
}

function getLegacyUserDataPaths() {
  const baseDir = getUserDataRoot();
  const currentUserDataPath = path.resolve(app.getPath('userData'));
  const candidates = LEGACY_USERDATA_FOLDERS.map((folder) => path.join(baseDir, folder));
  const uniquePaths = new Set();
  for (const candidate of candidates) {
    const resolved = path.resolve(candidate);
    if (resolved === currentUserDataPath) continue;
    uniquePaths.add(resolved);
  }
  return Array.from(uniquePaths);
}

async function getFileStats(filePath) {
  try {
    return await fs.stat(filePath);
  } catch {
    return null;
  }
}

async function isUsableFile(filePath) {
  const stats = await getFileStats(filePath);
  return Boolean(stats && stats.isFile() && stats.size > 0);
}

async function findLatestLegacyFile(fileName, legacyPaths) {
  let best = null;
  for (const legacyPath of legacyPaths) {
    const candidatePath = path.join(legacyPath, fileName);
    const stats = await getFileStats(candidatePath);
    if (!stats || !stats.isFile() || stats.size === 0) continue;
    const mtime = stats.mtimeMs || stats.mtime?.getTime?.() || 0;
    if (!best || mtime > best.mtime) {
      best = { path: candidatePath, mtime };
    }
  }
  return best;
}

async function copyLegacyFileIfMissing(fileName, legacyPaths) {
  const currentPath = path.join(app.getPath('userData'), fileName);
  if (await isUsableFile(currentPath)) {
    return { status: 'kept', currentPath };
  }

  const bestLegacy = await findLatestLegacyFile(fileName, legacyPaths);
  if (!bestLegacy) {
    return { status: 'missing', currentPath };
  }

  await fs.copyFile(bestLegacy.path, currentPath);
  return { status: 'migrated', currentPath, legacyPath: bestLegacy.path };
}

async function migrateUserDataState(options = {}) {
  const legacyPaths = Array.isArray(options.legacyPaths)
    ? options.legacyPaths
    : getLegacyUserDataPaths();
  const files =
    Array.isArray(options.files) && options.files.length > 0 ? options.files : STATE_FILES;
  const results = {
    migrated: [],
    skipped: [],
    missing: []
  };

  for (const file of files) {
    const fileName = typeof file === 'string' ? file : file.name;
    if (!fileName) continue;
    const label = typeof file === 'string' ? file : file.label || fileName;
    const result = await copyLegacyFileIfMissing(fileName, legacyPaths);
    if (result.status === 'migrated') {
      results.migrated.push({ file: fileName, label, from: result.legacyPath });
    } else if (result.status === 'kept') {
      results.skipped.push({ file: fileName, label });
    } else {
      results.missing.push({ file: fileName, label });
    }
  }

  if (results.migrated.length > 0) {
    logger.warn('[USERDATA] Migrated legacy state files', {
      migrated: results.migrated.map((entry) => entry.file)
    });
  } else {
    logger.info('[USERDATA] No legacy state files needed migration');
  }

  return results;
}

module.exports = {
  migrateUserDataState,
  getLegacyUserDataPaths,
  LEGACY_USERDATA_FOLDERS,
  STATE_FILES
};
