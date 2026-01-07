/**
 * Platform Behavior Abstraction
 *
 * Centralizes all platform-specific logic to avoid scattered isWindows/isMacOS
 * checks throughout the codebase.
 *
 * @module core/platformBehavior
 */

const { isWindows, isMacOS } = require('../../shared/platformUtils');
const { logger } = require('../../shared/logger');
const { WINDOW, PROCESS, TIMEOUTS } = require('../../shared/performanceConstants');

logger.setContext('Platform');

// taskkill can be slow to terminate process trees on Windows; give it a generous fixed timeout.
const TASKKILL_TIMEOUT_MS = 5000;

/**
 * Bring a window to the foreground with platform-specific handling.
 *
 * On Windows, uses setAlwaysOnTop trick to force window to front.
 * On other platforms, just focuses the window.
 *
 * @param {BrowserWindow} win - The window to bring to foreground
 */
function bringWindowToForeground(win) {
  if (!win || win.isDestroyed()) {
    logger.warn('[PLATFORM] Cannot bring destroyed window to foreground');
    return;
  }

  if (isWindows) {
    // Windows requires setAlwaysOnTop trick to reliably bring window to front
    // Also use moveTop() and show() for additional reliability
    win.moveTop();
    win.show();
    win.setAlwaysOnTop(true);
    setTimeout(() => {
      if (win && !win.isDestroyed()) {
        win.setAlwaysOnTop(false);
        win.focus();
      }
    }, WINDOW.ALWAYS_ON_TOP_DURATION_MS);
  }

  win.focus();
}

/**
 * Kill a process by PID with platform-specific handling.
 *
 * On Windows, uses taskkill with /f /t flags for force tree kill.
 * On Unix-like systems, uses SIGTERM followed by SIGKILL.
 *
 * @param {number} pid - Process ID to kill
 * @param {Object} options - Kill options
 * @param {boolean} options.forceKill - If true, skip graceful shutdown
 * @returns {Promise<{success: boolean, error?: Error}>}
 */
async function killProcess(pid, options = {}) {
  if (!pid || typeof pid !== 'number') {
    return { success: false, error: new Error('Invalid PID') };
  }

  const { forceKill = false } = options;

  try {
    if (isWindows) {
      return await killProcessWindows(pid);
    }
    return await killProcessUnix(pid, forceKill);
  } catch (error) {
    logger.error(`[PLATFORM] Failed to kill process ${pid}:`, error);
    return { success: false, error };
  }
}

/**
 * Kill a process on Windows using taskkill
 * @private
 */
async function killProcessWindows(pid) {
  const { asyncSpawn } = require('../utils/asyncSpawnUtils');

  const result = await asyncSpawn('taskkill', ['/pid', String(pid), '/f', '/t'], {
    windowsHide: true,
    timeout: TASKKILL_TIMEOUT_MS,
    encoding: 'utf8'
  });

  if (result.status === 0) {
    logger.info(`[PLATFORM] Process ${pid} terminated (taskkill)`);
    return { success: true };
  }
  if (result.error) {
    return { success: false, error: result.error };
  }
  logger.warn(`[PLATFORM] Taskkill exited with code ${result.status}`);
  if (result.stderr) {
    logger.warn(`[PLATFORM] Taskkill stderr: ${result.stderr.trim()}`);
  }
  return {
    success: false,
    error: new Error(`taskkill exited with ${result.status}`)
  };
}

/**
 * Kill a process on Unix using signals
 * @private
 */
async function killProcessUnix(pid, forceKill) {
  // First try graceful SIGTERM (unless forceKill is requested)
  if (!forceKill) {
    try {
      process.kill(pid, 'SIGTERM');
      logger.info(`[PLATFORM] Sent SIGTERM to process ${pid}`);

      // Wait for graceful shutdown
      await new Promise((resolve) => setTimeout(resolve, PROCESS.GRACEFUL_SHUTDOWN_WAIT_MS));

      // Check if process is still alive
      try {
        process.kill(pid, 0); // Signal 0 checks if process exists
        // Process still alive, need to force kill
        logger.info(`[PLATFORM] Process ${pid} still alive, sending SIGKILL`);
      } catch (checkError) {
        if (checkError.code === 'ESRCH') {
          // Process is gone, graceful shutdown succeeded
          logger.info(`[PLATFORM] Process ${pid} terminated gracefully`);
          return { success: true };
        }
        throw checkError;
      }
    } catch (termError) {
      if (termError.code === 'ESRCH') {
        // Process already dead
        logger.info(`[PLATFORM] Process ${pid} already terminated`);
        return { success: true };
      }
      throw termError;
    }
  }

  // Force kill with SIGKILL
  try {
    process.kill(pid, 'SIGKILL');
    logger.info(`[PLATFORM] Sent SIGKILL to process ${pid}`);

    // Brief wait then verify
    await new Promise((resolve) => setTimeout(resolve, TIMEOUTS.SIGKILL_VERIFY));

    try {
      process.kill(pid, 0);
      // Still alive after SIGKILL - this shouldn't happen
      logger.error(`[PLATFORM] Process ${pid} still alive after SIGKILL`);
      return { success: false, error: new Error('Process survived SIGKILL') };
    } catch (e) {
      if (e.code === 'ESRCH') {
        return { success: true };
      }
      throw e;
    }
  } catch (killError) {
    if (killError.code === 'ESRCH') {
      return { success: true };
    }
    throw killError;
  }
}

/**
 * Check if a process is still running
 *
 * @param {number} pid - Process ID to check
 * @returns {boolean} True if process is running
 */
function isProcessRunning(pid) {
  if (!pid || typeof pid !== 'number') {
    return false;
  }

  try {
    process.kill(pid, 0); // Signal 0 just checks existence
    return true;
  } catch (e) {
    if (e.code === 'ESRCH') {
      return false; // Process not found
    }
    // EPERM means process exists but we don't have permission to signal it
    // This is still "running" from our perspective
    return e.code === 'EPERM';
  }
}

/**
 * Determine if app should quit when all windows are closed.
 * On macOS, apps typically stay running in the dock.
 *
 * @returns {boolean} True if app should quit
 */
function shouldQuitOnAllWindowsClosed() {
  return !isMacOS;
}

module.exports = {
  bringWindowToForeground,
  killProcess,
  isProcessRunning,
  shouldQuitOnAllWindowsClosed,
  // Export platform flags for cases where direct checks are needed
  isWindows,
  isMacOS
};
