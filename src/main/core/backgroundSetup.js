/**
 * Background Setup Module
 *
 * Fully automated first-run dependency setup in the background:
 * - Install Ollama (Windows) if missing
 * - Install ChromaDB Python module if missing
 * - Start services (Ollama + ChromaDB) best-effort
 * - Pull configured default models in the background
 *
 * This runs asynchronously and does not block startup.
 *
 * @module core/backgroundSetup
 */

const { app, BrowserWindow } = require('electron');
const fs = require('fs').promises;
const path = require('path');
const { logger } = require('../../shared/logger');
const { getInstance: getDependencyManager } = require('../services/DependencyManagerService');
const { getStartupManager } = require('../services/startup');
const { getOllama } = require('../ollamaUtils');
const { getService: getSettingsService } = require('../services/SettingsService');

logger.setContext('BackgroundSetup');

// Track background setup status for visibility
const backgroundSetupStatus = {
  complete: false,
  error: null,
  startedAt: null,
  completedAt: null
};

/**
 * Get current background setup status
 * @returns {Object} Status object
 */
function getBackgroundSetupStatus() {
  return { ...backgroundSetupStatus };
}

/**
 * Notify renderer of progress
 * @param {string} type - Message type ('info', 'success', 'error')
 * @param {string} message - Message to display
 */
function emitDependencyProgress(payload) {
  try {
    const win = BrowserWindow.getAllWindows()[0];
    if (win && !win.isDestroyed()) {
      win.webContents.send('operation-progress', { type: 'dependency', ...(payload || {}) });
    }
  } catch (error) {
    logger.debug('[BACKGROUND] Could not emit dependency progress:', error.message);
  }
}

/**
 * Check if this is a first run
 * @returns {Promise<boolean>}
 */
async function checkFirstRun() {
  const setupMarker = path.join(app.getPath('userData'), 'dependency-setup-complete.marker');

  try {
    await fs.access(setupMarker);
    return false;
  } catch {
    return true;
  }
}

/**
 * Mark setup as complete by writing marker file
 */
async function markSetupComplete() {
  const setupMarker = path.join(app.getPath('userData'), 'dependency-setup-complete.marker');

  // Use atomic write (temp + rename) to prevent corruption
  try {
    const tempPath = `${setupMarker}.tmp.${Date.now()}`;
    await fs.writeFile(tempPath, new Date().toISOString());
    await fs.rename(tempPath, setupMarker);
  } catch (e) {
    logger.debug('[BACKGROUND] Could not create setup marker:', e.message);
  }
}

/**
 * Clean up installer marker if it exists
 */
async function cleanupInstallerMarker() {
  const installerMarker = path.join(app.getPath('exe'), '..', 'first-run.marker');

  try {
    await fs.access(installerMarker);
    try {
      await fs.unlink(installerMarker);
      logger.debug('[BACKGROUND] Removed installer marker');
    } catch (e) {
      logger.debug('[BACKGROUND] Could not remove installer marker:', e.message);
    }
  } catch {
    // Installer marker doesn't exist, no action needed
  }
}

/**
 * Run Ollama setup check and install models if needed
 */
function normalizeOllamaModelName(name) {
  if (!name || typeof name !== 'string') return null;
  const trimmed = name.trim();
  if (!trimmed) return null;
  return trimmed.includes(':') ? trimmed : `${trimmed}:latest`;
}

async function pullModelsInBackground(models) {
  const unique = Array.from(new Set((Array.isArray(models) ? models : []).filter(Boolean)));
  if (unique.length === 0) return;

  const ollama = getOllama();
  for (const model of unique) {
    emitDependencyProgress({
      message: `Downloading model: ${model}…`,
      dependency: 'ollama',
      stage: 'model-download',
      model
    });
    try {
      await ollama.pull({
        model,
        stream: (progress) => {
          try {
            const win = BrowserWindow.getAllWindows()[0];
            if (win && !win.isDestroyed()) {
              win.webContents.send('operation-progress', {
                type: 'ollama-pull',
                model,
                progress
              });
            }
          } catch {
            // ignore
          }
        }
      });
    } catch (e) {
      emitDependencyProgress({
        message: `Model download failed: ${model} (${e.message})`,
        dependency: 'ollama',
        stage: 'error',
        model
      });
    }
  }
}

async function runAutomatedDependencySetup() {
  const settingsService = getSettingsService();
  const settings = await settingsService.load();

  // Use singleton to share lock with IPC handlers (prevents race conditions)
  const manager = getDependencyManager({
    onProgress: (data) => emitDependencyProgress(data)
  });

  emitDependencyProgress({ message: 'Checking AI dependencies…', stage: 'check' });
  const status = await manager.getStatus();

  // 1) Install Ollama if missing (Windows only)
  if (!status.ollama.installed) {
    emitDependencyProgress({ message: 'Ollama missing. Installing…', dependency: 'ollama' });
    await manager.installOllama();
  } else {
    emitDependencyProgress({ message: 'Ollama is installed.', dependency: 'ollama' });
  }

  // 2) Install ChromaDB python module if missing
  if (!status.chromadb.pythonModuleInstalled && !process.env.CHROMA_SERVER_URL) {
    emitDependencyProgress({ message: 'ChromaDB missing. Installing…', dependency: 'chromadb' });
    await manager.installChromaDb({ upgrade: false, userInstall: true });
  } else if (process.env.CHROMA_SERVER_URL) {
    emitDependencyProgress({
      message: `Using external ChromaDB server: ${process.env.CHROMA_SERVER_URL}`,
      dependency: 'chromadb'
    });
  } else {
    emitDependencyProgress({ message: 'ChromaDB module is installed.', dependency: 'chromadb' });
  }

  // 3) Best-effort start services (StartupManager already has robust logic)
  const startupManager = getStartupManager();
  try {
    emitDependencyProgress({ message: 'Starting Ollama…', dependency: 'ollama', stage: 'start' });
    await startupManager.startOllama();
  } catch (e) {
    logger.warn('[BACKGROUND] Failed to start Ollama', { error: e?.message });
  }
  try {
    // CRITICAL FIX: Clear dependency missing flag before starting
    // This ensures freshly installed ChromaDB module is detected
    startupManager.setChromadbDependencyMissing(false);
    emitDependencyProgress({
      message: 'Starting ChromaDB…',
      dependency: 'chromadb',
      stage: 'start'
    });
    await startupManager.startChromaDB();
  } catch (e) {
    logger.warn('[BACKGROUND] Failed to start ChromaDB', { error: e?.message });
  }

  // 4) Pull configured default models (non-blocking for UI)
  const modelsToPull = [
    normalizeOllamaModelName(settings?.textModel),
    normalizeOllamaModelName(settings?.visionModel),
    normalizeOllamaModelName(settings?.embeddingModel)
  ].filter(Boolean);
  await pullModelsInBackground(modelsToPull);

  // 5) Optional: auto-update dependencies if consent is enabled (best-effort)
  // Note: we do not run this on every launch—only on first-run automation.
  if (settings?.autoUpdateOllama) {
    emitDependencyProgress({
      message: 'Auto-updating Ollama…',
      dependency: 'ollama',
      stage: 'update'
    });
    await manager
      .updateOllama()
      .catch((err) => logger.warn('[BACKGROUND] Ollama auto-update failed:', err.message));
  }
  if (settings?.autoUpdateChromaDb) {
    emitDependencyProgress({
      message: 'Auto-updating ChromaDB…',
      dependency: 'chromadb',
      stage: 'update'
    });
    await manager
      .updateChromaDb()
      .catch((err) => logger.warn('[BACKGROUND] ChromaDB auto-update failed:', err.message));
  }
}

/**
 * Run background setup (fully automated dependency setup on first run).
 * This runs asynchronously and does not block startup.
 * @returns {Promise<void>}
 */
async function runBackgroundSetup() {
  backgroundSetupStatus.startedAt = new Date().toISOString();

  try {
    const isFirstRun = await checkFirstRun();

    if (isFirstRun) {
      logger.info('[BACKGROUND] First run detected - will run automated dependency setup');

      await cleanupInstallerMarker();

      try {
        await runAutomatedDependencySetup();
      } catch (err) {
        logger.warn('[BACKGROUND] Setup script error:', err.message);
      }

      await markSetupComplete();
    } else {
      logger.debug('[BACKGROUND] Not first run, skipping automated dependency setup');
    }

    // Mark background setup as complete
    backgroundSetupStatus.complete = true;
    backgroundSetupStatus.completedAt = new Date().toISOString();
    logger.info('[BACKGROUND] Background setup completed successfully');
  } catch (error) {
    // Track error - status can be queried via getBackgroundSetupStatus()
    backgroundSetupStatus.error = error.message;
    backgroundSetupStatus.completedAt = new Date().toISOString();
    logger.error('[BACKGROUND] Background setup failed:', error);
  }
}

module.exports = {
  runBackgroundSetup,
  getBackgroundSetupStatus,
  checkFirstRun
};
