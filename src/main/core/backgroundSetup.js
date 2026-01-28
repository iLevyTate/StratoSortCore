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
const { spawn, execFile } = require('child_process');
const { promisify } = require('util');

const { logger } = require('../../shared/logger');
// FIX: Import safeSend for validated IPC event sending
const { safeSend } = require('../ipc/ipcWrappers');
const { getInstance: getDependencyManager } = require('../services/DependencyManagerService');
const { getStartupManager } = require('../services/startup');
const { getOllama } = require('../ollamaUtils');
const { getService: getSettingsService } = require('../services/SettingsService');

logger.setContext('BackgroundSetup');

const execFileAsync = promisify(execFile);
const COMMAND_TIMEOUT_MS = 5000;

function parseBool(value) {
  return String(value).toLowerCase() === 'true';
}

async function commandExists(command) {
  const isWindows = process.platform === 'win32';
  const lookupCmd = isWindows ? 'where' : 'which';
  try {
    await execFileAsync(lookupCmd, [command], {
      timeout: COMMAND_TIMEOUT_MS,
      windowsHide: true
    });
    return true;
  } catch {
    return false;
  }
}

async function isTesseractInstalled() {
  const tesseractPath = process.env.TESSERACT_PATH || 'tesseract';
  try {
    await execFileAsync(tesseractPath, ['--version'], {
      timeout: COMMAND_TIMEOUT_MS,
      windowsHide: true
    });
    return true;
  } catch {
    return false;
  }
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      stdio: 'inherit',
      ...options
    });
    child.on('close', (code) => resolve(code ?? 1));
    child.on('error', () => resolve(1));
  });
}

async function installTesseractIfMissing() {
  const isCI = parseBool(process.env.CI);
  const skipSetup =
    parseBool(process.env.SKIP_TESSERACT_SETUP) || parseBool(process.env.SKIP_APP_DEPS);

  if (isCI || skipSetup) {
    logger.debug('[BACKGROUND] Skipping tesseract setup (CI or SKIP_TESSERACT_SETUP)');
    return;
  }

  if (process.env.TESSERACT_PATH && process.env.TESSERACT_PATH.trim()) {
    logger.debug('[BACKGROUND] TESSERACT_PATH set, skipping auto-install');
    return;
  }

  if (await isTesseractInstalled()) {
    emitDependencyProgress({ message: 'Tesseract is installed.', dependency: 'tesseract' });
    return;
  }

  emitDependencyProgress({
    message: 'Tesseract missing. Installing…',
    dependency: 'tesseract',
    stage: 'install'
  });

  let status = 1;
  if (process.platform === 'win32') {
    if (await commandExists('winget')) {
      status = await runCommand(
        'winget',
        [
          'install',
          '--id',
          'Tesseract-OCR.Tesseract',
          '-e',
          '--accept-source-agreements',
          '--accept-package-agreements'
        ],
        { shell: true }
      );
    } else if (await commandExists('choco')) {
      status = await runCommand('choco', ['install', 'tesseract', '-y'], { shell: true });
    }
  } else if (process.platform === 'darwin') {
    if (await commandExists('brew')) {
      status = await runCommand('brew', ['install', 'tesseract']);
    }
  } else {
    if (await commandExists('apt-get')) {
      const updated = await runCommand('sudo', ['apt-get', 'update']);
      if (updated === 0) {
        status = await runCommand('sudo', ['apt-get', 'install', '-y', 'tesseract-ocr']);
      } else {
        status = updated;
      }
    }
  }

  if (status === 0) {
    emitDependencyProgress({
      message: 'Tesseract installed.',
      dependency: 'tesseract',
      stage: 'installed'
    });
    logger.info('[BACKGROUND] Tesseract installation complete');
  } else {
    emitDependencyProgress({
      message: 'Tesseract install failed or skipped. OCR will use tesseract.js.',
      dependency: 'tesseract',
      stage: 'error'
    });
    logger.warn('[BACKGROUND] Tesseract install failed or skipped');
  }
}

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
      // FIX: Use safeSend for validated IPC event sending
      safeSend(win.webContents, 'operation-progress', { type: 'dependency', ...(payload || {}) });
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
              // FIX: Use safeSend for validated IPC event sending
              safeSend(win.webContents, 'operation-progress', {
                type: 'ollama-pull',
                model,
                progress
              });
            }
          } catch {
            // Intentionally ignored: window may be closing during model pull
            // This is non-fatal for the download process
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

  // 2.5) Install Tesseract OCR if missing (best-effort)
  await installTesseractIfMissing();

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

      try {
        await runAutomatedDependencySetup();
      } catch (err) {
        logger.warn('[BACKGROUND] Setup script error:', err.message);
      }

      await markSetupComplete();
    } else {
      logger.debug('[BACKGROUND] Not first run, skipping automated dependency setup');

      // Reliability improvement:
      // Even after first-run, users can end up with services stopped (crash, killed process, reboot).
      // On normal launches we should still attempt a best-effort restart so features recover.
      const startupManager = getStartupManager();

      // Attempt to recover Ollama if not running
      try {
        const { isOllamaRunning } = require('../utils/ollamaDetection');
        const ollamaRunning = await isOllamaRunning();
        if (!ollamaRunning) {
          logger.info('[BACKGROUND] Ollama is offline. Attempting restart…');
          emitDependencyProgress({
            message: 'Ollama is offline. Attempting restart…',
            dependency: 'ollama',
            stage: 'recover'
          });
          await startupManager.startOllama();
        } else {
          logger.debug('[BACKGROUND] Ollama already running');
        }
      } catch (e) {
        logger.debug('[BACKGROUND] Non-fatal Ollama restart attempt failed:', e?.message);
      }

      // Attempt to recover ChromaDB if not running
      try {
        const { isChromaDBRunning } = require('../services/startup/chromaService');
        const running = await isChromaDBRunning();
        if (!running) {
          emitDependencyProgress({
            message: 'ChromaDB is offline. Attempting restart…',
            dependency: 'chromadb',
            stage: 'recover'
          });
          await startupManager.startChromaDB();
        }
      } catch (e) {
        logger.debug('[BACKGROUND] Non-fatal ChromaDB restart attempt failed:', e?.message);
      }
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
