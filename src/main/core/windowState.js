/**
 * Window State
 *
 * Event-driven state machine for managing BrowserWindow lifecycle.
 * Replaces nested setTimeout logic with proper event-based transitions.
 *
 * @module core/windowState
 */

const { screen } = require('electron');
const { logger } = require('../../shared/logger');
const { bringWindowToForeground, isWindows } = require('./platformBehavior');
const { WINDOW } = require('./timingConstants');

logger.setContext('WindowState');

/**
 * Window states for the state machine
 */
const WindowState = {
  UNKNOWN: 'unknown',
  FULLSCREEN: 'fullscreen',
  MAXIMIZED: 'maximized',
  MINIMIZED: 'minimized',
  HIDDEN: 'hidden',
  NORMAL: 'normal'
};

/**
 * Get the current state of a window
 *
 * @param {BrowserWindow} win - The window to check
 * @returns {string} Current window state
 */
function getWindowState(win) {
  if (!win || win.isDestroyed()) {
    return WindowState.UNKNOWN;
  }

  // Check states in priority order
  if (win.isFullScreen()) return WindowState.FULLSCREEN;
  if (win.isMinimized()) return WindowState.MINIMIZED;
  if (win.isMaximized()) return WindowState.MAXIMIZED;
  if (!win.isVisible()) return WindowState.HIDDEN;
  return WindowState.NORMAL;
}

/**
 * Restore a window to a visible, focused state using event-driven transitions.
 *
 * This replaces the problematic nested setTimeout approach with proper
 * event handlers that respond when Chromium confirms state changes.
 *
 * @param {BrowserWindow} win - The window to restore
 * @returns {Promise<void>} Resolves when window is restored and focused
 */
async function restoreWindow(win) {
  if (!win || win.isDestroyed()) {
    logger.warn('[WINDOW] Cannot restore null or destroyed window');
    return;
  }

  const currentState = getWindowState(win);
  logger.debug(`[WINDOW] Restoring window from state: ${currentState}`);

  switch (currentState) {
    case WindowState.FULLSCREEN:
      // Fullscreen windows just need focus
      win.focus();
      logger.debug('[WINDOW] Fullscreen window focused');
      break;

    case WindowState.MINIMIZED:
      // Minimized windows need restore, then potentially show
      await restoreMinimizedWindow(win);
      break;

    case WindowState.MAXIMIZED:
      // Maximized but potentially hidden
      if (!win.isVisible()) {
        win.show();
      }
      win.focus();
      logger.debug('[WINDOW] Maximized window shown and focused');
      break;

    case WindowState.HIDDEN:
      // Hidden window needs show then focus
      win.show();
      win.focus();
      logger.debug('[WINDOW] Hidden window shown and focused');
      break;

    case WindowState.NORMAL:
      // Already visible, just focus
      win.focus();
      logger.debug('[WINDOW] Normal window focused');
      break;

    default:
      logger.warn(`[WINDOW] Unknown state: ${currentState}, attempting show+focus`);
      try {
        win.show();
        win.focus();
      } catch (e) {
        logger.error('[WINDOW] Failed to restore unknown state:', e);
      }
  }

  // On Windows, force to foreground
  if (isWindows && win.isVisible()) {
    bringWindowToForeground(win);
  }
}

/**
 * Restore a minimized window using event-driven approach
 *
 * @param {BrowserWindow} win - The minimized window
 * @returns {Promise<void>}
 */
function restoreMinimizedWindow(win) {
  return new Promise((resolve) => {
    // Set up one-time event handler for restore completion
    const onRestore = () => {
      // Guard against destroyed window
      if (!win || win.isDestroyed()) {
        resolve();
        return;
      }

      logger.debug('[WINDOW] Restore event received');

      // After restore, verify visibility and focus
      // Use a small delay to let Chromium settle
      setTimeout(() => {
        if (!win || win.isDestroyed()) {
          resolve();
          return;
        }

        // Verify window is actually visible now
        if (!win.isVisible()) {
          logger.debug('[WINDOW] Window not visible after restore, showing');
          win.show();
        }

        win.focus();
        logger.debug('[WINDOW] Minimized window restored and focused');
        resolve();
      }, WINDOW.RESTORE_SETTLE_MS);
    };

    // Listen for the restore event
    win.once('restore', onRestore);

    // Set a timeout in case restore event never fires
    const timeout = setTimeout(() => {
      win.removeListener('restore', onRestore);
      logger.warn('[WINDOW] Restore event timeout, forcing show+focus');

      if (!win || win.isDestroyed()) {
        resolve();
        return;
      }

      try {
        win.show();
        win.focus();
      } catch (e) {
        logger.error('[WINDOW] Failed to force restore:', e);
      }
      resolve();
    }, 1000); // 1 second timeout for restore event

    // Trigger the restore
    logger.debug('[WINDOW] Triggering restore');
    win.restore();

    // Clean up timeout if restore completes normally
    win.once('restore', () => clearTimeout(timeout));
  });
}

/**
 * Ensure window is positioned on a visible display
 *
 * Handles cases where window was positioned on a monitor that is no longer
 * connected (e.g., laptop undocked).
 *
 * @param {BrowserWindow} win - The window to check
 * @returns {boolean} True if window was repositioned
 */
function ensureWindowOnScreen(win) {
  if (!win || win.isDestroyed()) {
    return false;
  }

  // Only check visible, non-minimized windows
  if (!win.isVisible() || win.isMinimized()) {
    return false;
  }

  try {
    const bounds = win.getBounds();
    const displays = screen.getAllDisplays();

    // Calculate window center point
    const windowCenter = {
      x: bounds.x + bounds.width / 2,
      y: bounds.y + bounds.height / 2
    };

    // Check if center is visible on any display
    const isOnScreen = displays.some((display) => {
      const { x, y, width, height } = display.bounds;
      return (
        windowCenter.x >= x &&
        windowCenter.x <= x + width &&
        windowCenter.y >= y &&
        windowCenter.y <= y + height
      );
    });

    if (!isOnScreen) {
      logger.warn('[WINDOW] Window was off-screen, centering on primary display');
      win.center();
      return true;
    }

    return false;
  } catch (error) {
    logger.debug('[WINDOW] Could not check screen bounds:', error.message);
    return false;
  }
}

/**
 * Create and attach standard window event handlers for debugging
 *
 * @param {BrowserWindow} win - The window to attach handlers to
 * @param {Object} options - Options
 * @param {Function} options.onClose - Close handler (receives event)
 * @param {Function} options.onClosed - Closed handler
 * @returns {Function} Cleanup function to remove all handlers
 */
function attachWindowEventHandlers(win, options = {}) {
  const handlers = new Map();

  const debugHandler = (eventName) => () => {
    logger.debug(`[WINDOW] ${eventName}`);
  };

  // Debug event handlers
  const events = ['minimize', 'restore', 'show', 'hide', 'focus', 'blur'];
  for (const event of events) {
    const handler = debugHandler(event.charAt(0).toUpperCase() + event.slice(1));
    handlers.set(event, handler);
    win.on(event, handler);
  }

  // Close handler (can prevent close)
  if (options.onClose) {
    handlers.set('close', options.onClose);
    win.on('close', options.onClose);
  }

  // Closed handler (window is destroyed)
  if (options.onClosed) {
    handlers.set('closed', options.onClosed);
    win.on('closed', options.onClosed);
  }

  // Return cleanup function
  return () => {
    for (const [event, handler] of handlers) {
      try {
        if (win && !win.isDestroyed()) {
          win.removeListener(event, handler);
        }
      } catch (e) {
        logger.error(`[WINDOW] Failed to remove ${event} listener:`, e);
      }
    }
    handlers.clear();
  };
}

module.exports = {
  WindowState,
  getWindowState,
  restoreWindow,
  restoreMinimizedWindow,
  ensureWindowOnScreen,
  attachWindowEventHandlers
};
