/**
 * Background Setup Module
 *
 * Fully automated first-run dependency setup in the background:
 * - Install Tesseract (optional) if missing
 * - Record setup completion marker
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

const { createLogger } = require('../../shared/logger');
// FIX: Import safeSend for validated IPC event sending
const { safeSend } = require('../ipc/ipcWrappers');
// Legacy dependency manager removed (in-process AI stack)

const logger = createLogger('BackgroundSetup');
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
      // FIX (H-3): Check for interactive TTY before running sudo.
      // In an Electron app with stdio:'inherit', sudo hangs waiting for a
      // password prompt if no TTY is available (e.g., launched from desktop).
      const hasTTY = process.stdin && process.stdin.isTTY;
      if (hasTTY) {
        const updated = await runCommand('sudo', ['apt-get', 'update']);
        if (updated === 0) {
          status = await runCommand('sudo', ['apt-get', 'install', '-y', 'tesseract-ocr']);
        } else {
          status = updated;
        }
      } else {
        // No TTY — try without sudo (works if user has passwordless apt access or is root)
        const updated = await runCommand('apt-get', ['update']);
        if (updated === 0) {
          status = await runCommand('apt-get', ['install', '-y', 'tesseract-ocr']);
        } else {
          logger.warn(
            '[BACKGROUND] Cannot install tesseract: no interactive terminal for sudo. ' +
              'Install manually with: sudo apt-get install tesseract-ocr'
          );
          status = updated;
        }
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
      message: 'Tesseract install failed or skipped. Falling back to bundled tesseract.js.',
      dependency: 'tesseract',
      stage: 'fallback'
    });
    logger.warn('[BACKGROUND] Tesseract install failed or skipped');
    // Signal downstream to prefer JS fallback where supported
    process.env.USE_TESSERACT_JS = '1';
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

async function runAutomatedDependencySetup() {
  emitDependencyProgress({ message: 'Checking runtime dependencies…', stage: 'check' });

  // Install Tesseract OCR if missing (best-effort)
  await installTesseractIfMissing();
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

      // In-process AI stack is always available; no external recovery needed.
      logger.debug('[BACKGROUND] In-process AI stack - no external service recovery required');
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
