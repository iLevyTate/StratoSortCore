/**
 * Background Setup Module
 *
 * Handles first-run Ollama setup in the background.
 * Extracted from simple-main.js for better maintainability.
 *
 * @module core/backgroundSetup
 */

const { app, BrowserWindow } = require('electron');
const fs = require('fs').promises;
const path = require('path');
const { logger } = require('../../shared/logger');

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
function notifyRenderer(type, message) {
  try {
    const win = BrowserWindow.getAllWindows()[0];
    if (win && !win.isDestroyed()) {
      win.webContents.send('operation-progress', { type, message });
    }
  } catch (error) {
    logger.debug('[BACKGROUND] Could not notify renderer:', error.message);
  }
}

/**
 * Check if this is a first run
 * @returns {Promise<boolean>}
 */
async function checkFirstRun() {
  const setupMarker = path.join(app.getPath('userData'), 'ollama-setup-complete.marker');

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
  const setupMarker = path.join(app.getPath('userData'), 'ollama-setup-complete.marker');

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
async function runOllamaSetup() {
  const setupScript = path.join(__dirname, '../../../scripts/setup-ollama.js');

  try {
    await fs.access(setupScript);
  } catch {
    logger.warn('[BACKGROUND] Setup script not found:', setupScript);
    return;
  }

  const { isOllamaInstalled, getInstalledModels, installEssentialModels } = require(setupScript);

  // Check if Ollama is installed and has models
  if (await isOllamaInstalled()) {
    const models = await getInstalledModels();
    if (models.length === 0) {
      logger.info('[BACKGROUND] No AI models found, installing essential models...');
      notifyRenderer('info', 'Installing AI models in background...');

      try {
        await installEssentialModels();
        logger.info('[BACKGROUND] AI models installed successfully');
        notifyRenderer('success', 'AI models installed successfully');
      } catch (e) {
        logger.warn('[BACKGROUND] Could not install AI models automatically:', e.message);
      }
    } else {
      logger.info('[BACKGROUND] AI models already installed:', models.length);
    }
  } else {
    logger.warn('[BACKGROUND] Ollama not installed - AI features will be limited');
  }
}

/**
 * Run background setup (first-run Ollama setup)
 * This runs asynchronously and does not block startup.
 * @returns {Promise<void>}
 */
async function runBackgroundSetup() {
  backgroundSetupStatus.startedAt = new Date().toISOString();

  try {
    const isFirstRun = await checkFirstRun();

    if (isFirstRun) {
      logger.info('[BACKGROUND] First run detected - will check Ollama setup');

      await cleanupInstallerMarker();

      try {
        await runOllamaSetup();
      } catch (err) {
        logger.warn('[BACKGROUND] Setup script error:', err.message);
      }

      await markSetupComplete();
    } else {
      logger.debug('[BACKGROUND] Not first run, skipping Ollama setup');
    }

    // Mark background setup as complete
    backgroundSetupStatus.complete = true;
    backgroundSetupStatus.completedAt = new Date().toISOString();
    logger.info('[BACKGROUND] Background setup completed successfully');
  } catch (error) {
    // Track error and notify renderer
    backgroundSetupStatus.error = error.message;
    backgroundSetupStatus.completedAt = new Date().toISOString();
    logger.error('[BACKGROUND] Background setup failed:', error);

    // Notify renderer of degraded state if window exists
    try {
      const win = BrowserWindow.getAllWindows()[0];
      if (win && !win.isDestroyed()) {
        win.webContents.send('startup-degraded', {
          reason: error.message,
          component: 'background-setup'
        });
      }
    } catch (notifyError) {
      logger.debug('[BACKGROUND] Could not notify renderer of error:', notifyError.message);
    }
  }
}

module.exports = {
  runBackgroundSetup,
  getBackgroundSetupStatus,
  checkFirstRun
};
