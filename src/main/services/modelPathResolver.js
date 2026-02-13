const path = require('path');
const fs = require('fs').promises;
const { app } = require('electron');
const { getLegacyUserDataPaths } = require('../core/userDataMigration');

async function hasGgufFiles(dirPath) {
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    return entries.some((entry) => {
      if (!entry) return false;
      if (typeof entry === 'string') {
        return entry.toLowerCase().endsWith('.gguf');
      }
      const name = String(entry.name || '').toLowerCase();
      if (!name.endsWith('.gguf')) return false;
      return typeof entry.isFile === 'function' ? entry.isFile() : true;
    });
  } catch {
    return false;
  }
}

async function resolveModelsPath() {
  const userDataPath = app.getPath('userData');
  const currentModelsPath = path.join(userDataPath, 'models');

  if (await hasGgufFiles(currentModelsPath)) {
    return {
      modelsPath: currentModelsPath,
      source: 'current'
    };
  }

  const legacyUserDataPaths = getLegacyUserDataPaths();
  for (const legacyPath of legacyUserDataPaths) {
    const legacyModelsPath = path.join(legacyPath, 'models');
    if (await hasGgufFiles(legacyModelsPath)) {
      return {
        modelsPath: legacyModelsPath,
        source: 'legacy',
        currentModelsPath,
        legacyModelsPath
      };
    }
  }

  return {
    modelsPath: currentModelsPath,
    source: 'current-empty'
  };
}

async function ensureResolvedModelsPath() {
  const resolved = await resolveModelsPath();
  try {
    await fs.mkdir(resolved.modelsPath, { recursive: true });
  } catch {
    // Non-fatal in restricted environments; callers handle downstream failures.
  }
  return resolved;
}

module.exports = {
  hasGgufFiles,
  resolveModelsPath,
  ensureResolvedModelsPath
};
