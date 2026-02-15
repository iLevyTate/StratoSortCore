/**
 * Background Setup Module
 *
 * Fully automated first-run dependency setup in the background:
 * - Download missing GGUF models
 * - Record setup completion marker
 *
 * OCR is handled by the bundled tesseract.js (no external install needed).
 * Vision runtime (llama-server) is bundled via assets/runtime/ in production
 * builds and downloaded on-demand in dev via VisionService._ensureBinary().
 *
 * This runs asynchronously and does not block startup.
 *
 * @module core/backgroundSetup
 */

const { app, BrowserWindow } = require('electron');
const fs = require('fs').promises;
const path = require('path');

const { createLogger } = require('../../shared/logger');
// FIX: Import safeSend for validated IPC event sending
const { safeSend } = require('../ipc/ipcWrappers');
const { getInstance: getModelDownloadManager } = require('../services/ModelDownloadManager');
const { getInstance: getLlamaService } = require('../services/LlamaService');
const { AI_DEFAULTS, IPC_EVENTS } = require('../../shared/constants');
const { getModel } = require('../../shared/modelRegistry');

const logger = createLogger('BackgroundSetup');

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
      safeSend(win.webContents, IPC_EVENTS.OPERATION_PROGRESS, {
        type: 'dependency',
        ...(payload || {})
      });
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
 * Download missing GGUF models in the background.
 * Non-blocking: failures are logged but do not prevent app startup.
 */
async function downloadMissingModels() {
  try {
    const llamaService = getLlamaService();
    const downloadManager = getModelDownloadManager();
    await downloadManager.initialize();

    const cfg = await llamaService.getConfig();
    const requiredModels = [
      cfg.embeddingModel || AI_DEFAULTS.EMBEDDING.MODEL,
      cfg.textModel || AI_DEFAULTS.TEXT.MODEL
    ].filter(Boolean);

    // Vision model is optional - include but don't fail if missing
    const visionModel = cfg.visionModel || AI_DEFAULTS.IMAGE.MODEL;
    if (visionModel) {
      requiredModels.push(visionModel);

      // Vision models need a companion projector (mmproj) for image understanding.
      // Check the registry for the clipModel companion and include it.
      const visionInfo = getModel(visionModel);
      if (visionInfo?.clipModel?.name) {
        requiredModels.push(visionInfo.clipModel.name);
      }
    }

    const availableModels = await llamaService.listModels();
    const availableNames = new Set(availableModels.map((m) => m.name || m.filename || ''));

    const missing = requiredModels.filter((name) => !availableNames.has(name));
    if (missing.length === 0) {
      logger.info('[BACKGROUND] All required models are available');
      emitDependencyProgress({
        message: 'All AI models available.',
        stage: 'models-ready'
      });
      return;
    }

    logger.info('[BACKGROUND] Missing models, starting background download', {
      missing,
      available: Array.from(availableNames)
    });

    for (const modelName of missing) {
      emitDependencyProgress({
        message: `Downloading model: ${modelName}…`,
        dependency: 'models',
        stage: 'model-download',
        model: modelName
      });

      try {
        await downloadManager.downloadModel(modelName, {
          onProgress: (progress) => {
            try {
              const win = BrowserWindow.getAllWindows()[0];
              if (win && !win.isDestroyed()) {
                safeSend(win.webContents, IPC_EVENTS.OPERATION_PROGRESS, {
                  type: 'model-download',
                  model: modelName,
                  percent: progress.percent,
                  speedBps: progress.speedBps,
                  etaSeconds: progress.etaSeconds
                });
              }
            } catch {
              // Window may be closing during download - non-fatal
            }
          }
        });

        logger.info(`[BACKGROUND] Model downloaded: ${modelName}`);
        emitDependencyProgress({
          message: `Model ready: ${modelName}`,
          dependency: 'models',
          stage: 'model-ready',
          model: modelName
        });
      } catch (downloadError) {
        logger.warn(`[BACKGROUND] Failed to download model: ${modelName}`, {
          error: downloadError.message
        });
        emitDependencyProgress({
          message: `Model download failed: ${modelName} (${downloadError.message})`,
          dependency: 'models',
          stage: 'error',
          model: modelName
        });
      }
    }
  } catch (error) {
    logger.warn('[BACKGROUND] Model provisioning failed (non-fatal)', {
      error: error.message
    });
  }
}

async function runAutomatedDependencySetup() {
  emitDependencyProgress({ message: 'Checking runtime dependencies…', stage: 'check' });

  // Download missing GGUF models (best-effort, non-blocking).
  // OCR uses bundled tesseract.js — no external install needed.
  // Vision runtime (llama-server) is bundled in production builds.
  await downloadMissingModels();
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

      // In-process AI stack - no external service recovery needed.
      // However, models may still be missing (deleted, failed download, etc.).
      // Check and download missing models on every launch.
      try {
        await downloadMissingModels();
      } catch (err) {
        logger.debug(
          '[BACKGROUND] Model check on subsequent run failed (non-fatal):',
          err?.message
        );
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
