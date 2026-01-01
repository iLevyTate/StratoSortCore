/**
 * Electron App Helper for E2E Testing
 *
 * Provides utilities to launch, control, and interact with the StratoSort Electron app.
 * Uses Playwright's Electron support via the _electron fixture.
 *
 * Usage:
 *   const { launchApp, closeApp, getMainWindow } = require('./helpers/electronApp');
 *
 *   test('my test', async () => {
 *     const { app, window } = await launchApp();
 *     // ... test code
 *     await closeApp(app);
 *   });
 */

const { _electron: electron } = require('@playwright/test');
const path = require('path');

// Configuration
const APP_ROOT = path.resolve(__dirname, '../../..');
const MAIN_ENTRY = path.join(APP_ROOT, 'src/main/simple-main.js');
// Use relative path from APP_ROOT for proper app.getAppPath() resolution
const MAIN_ENTRY_RELATIVE = './src/main/simple-main.js';
const ELECTRON_PATH = require('electron');

// Default launch options
const DEFAULT_LAUNCH_OPTIONS = {
  // Use development environment for testing
  env: {
    ...process.env,
    NODE_ENV: 'development',
    // Disable hardware acceleration for more stable CI testing
    ELECTRON_DISABLE_GPU: '1',
    // Enable logging for debugging
    ELECTRON_ENABLE_LOGGING: '1'
  },
  // Timeout for app launch (30 seconds)
  timeout: 30000
};

/**
 * Launch the StratoSort Electron application
 *
 * @param {Object} options - Additional launch options
 * @param {Object} options.env - Additional environment variables
 * @param {number} options.timeout - Launch timeout in milliseconds
 * @param {boolean} options.headed - Run with visible window (default: false)
 * @returns {Promise<{app: ElectronApplication, window: Page}>}
 */
async function launchApp(options = {}) {
  const mergedOptions = {
    ...DEFAULT_LAUNCH_OPTIONS,
    ...options,
    env: {
      ...DEFAULT_LAUNCH_OPTIONS.env,
      ...(options.env || {})
    }
  };

  // Add args for headless mode if not headed
  // Use relative path from APP_ROOT so app.getAppPath() returns correct root
  const args = [MAIN_ENTRY_RELATIVE];
  if (!options.headed) {
    args.push('--disable-gpu');
  }

  console.log('[E2E] Launching Electron app...');
  console.log('[E2E] Main entry:', MAIN_ENTRY_RELATIVE);
  console.log('[E2E] Working directory:', APP_ROOT);

  const app = await electron.launch({
    executablePath: ELECTRON_PATH,
    args,
    cwd: APP_ROOT, // Set working directory so app.getAppPath() returns correct path
    env: mergedOptions.env,
    timeout: mergedOptions.timeout
  });

  // Wait for the first BrowserWindow to open
  console.log('[E2E] Waiting for main window...');
  const window = await app.firstWindow();

  // Wait for the window to be ready (DOM loaded)
  await window.waitForLoadState('domcontentloaded');
  console.log('[E2E] Main window ready');

  // Optional: Wait for the app to be fully initialized
  // This waits for the React app to mount
  try {
    await window.waitForSelector('.app-surface', { timeout: 15000 });
    console.log('[E2E] App UI rendered');
  } catch (error) {
    console.warn('[E2E] Warning: App UI may not be fully rendered:', error.message);
  }

  return { app, window };
}

/**
 * Close the Electron application gracefully
 *
 * @param {ElectronApplication} app - The Electron app instance
 */
async function closeApp(app) {
  if (!app) {
    console.warn('[E2E] No app to close');
    return;
  }

  console.log('[E2E] Closing Electron app...');
  try {
    await app.close();
    console.log('[E2E] App closed successfully');
  } catch (error) {
    console.error('[E2E] Error closing app:', error.message);
    // Force quit if graceful close fails
    try {
      const windows = await app.windows();
      for (const window of windows) {
        await window.close();
      }
    } catch (e) {
      // Ignore errors during forced close
    }
  }
}

/**
 * Get the main BrowserWindow
 *
 * @param {ElectronApplication} app - The Electron app instance
 * @returns {Promise<Page>}
 */
async function getMainWindow(app) {
  const windows = await app.windows();
  if (windows.length === 0) {
    throw new Error('No windows found');
  }
  return windows[0];
}

/**
 * Wait for the app to be ready for interaction
 *
 * @param {Page} window - The Playwright page object
 * @param {number} timeout - Maximum wait time in milliseconds
 */
async function waitForAppReady(window, timeout = 30000) {
  console.log('[E2E] Waiting for app to be ready...');

  // Wait for the navigation bar to be visible (indicates app is loaded)
  await window.waitForSelector('nav[aria-label="Phase navigation"]', {
    state: 'visible',
    timeout
  });

  // Wait for any loading spinners to disappear
  const spinners = window.locator('.animate-spin');
  const spinnerCount = await spinners.count();
  if (spinnerCount > 0) {
    await spinners
      .first()
      .waitFor({ state: 'hidden', timeout: 10000 })
      .catch(() => {
        // Ignore timeout - spinner may have already disappeared
      });
  }

  // Dismiss any modal dialogs that might be blocking (e.g., Dependency Wizard)
  await dismissModals(window);

  console.log('[E2E] App is ready');
}

/**
 * Dismiss any modal dialogs that might be blocking the UI
 * This handles the Dependency Wizard and other modals that appear on first launch
 *
 * @param {Page} window - The Playwright page object
 */
async function dismissModals(window) {
  // Check for modal overlay
  const modalOverlay = window.locator('[role="presentation"].fixed.inset-0, .z-modal');
  const hasModal = await modalOverlay
    .first()
    .isVisible()
    .catch(() => false);

  if (hasModal) {
    console.log('[E2E] Modal detected, attempting to dismiss...');

    // Try clicking "Skip" or "Later" or "Close" buttons
    const dismissButtons = [
      'button:has-text("Skip")',
      'button:has-text("Later")',
      'button:has-text("Close")',
      'button:has-text("Not Now")',
      'button:has-text("Dismiss")',
      'button[aria-label="Close"]',
      '[role="dialog"] button:has-text("×")',
      '[role="dialog"] button:has-text("X")'
    ];

    for (const selector of dismissButtons) {
      const button = window.locator(selector).first();
      const isVisible = await button.isVisible().catch(() => false);
      if (isVisible) {
        console.log(`[E2E] Clicking dismiss button: ${selector}`);
        await button.click().catch(() => {});
        await window.waitForTimeout(300);
        break;
      }
    }

    // If no dismiss button found, try pressing Escape
    const stillHasModal = await modalOverlay
      .first()
      .isVisible()
      .catch(() => false);
    if (stillHasModal) {
      console.log('[E2E] Pressing Escape to dismiss modal');
      await window.keyboard.press('Escape');
      await window.waitForTimeout(300);
    }

    // Wait for modal to close
    await modalOverlay
      .first()
      .waitFor({ state: 'hidden', timeout: 5000 })
      .catch(() => {
        console.log('[E2E] Modal may still be visible');
      });
  }
}

/**
 * Take a screenshot with a descriptive name
 *
 * @param {Page} window - The Playwright page object
 * @param {string} name - Screenshot name
 * @param {string} testName - Test name for organization
 * @returns {Promise<string>} Path to screenshot
 */
async function takeScreenshot(window, name, testName = 'unknown') {
  const screenshotDir = path.join(APP_ROOT, 'test-results', 'e2e', 'screenshots');
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `${testName}_${name}_${timestamp}.png`;
  const filepath = path.join(screenshotDir, filename);

  await window.screenshot({ path: filepath, fullPage: true });
  console.log(`[E2E] Screenshot saved: ${filepath}`);
  return filepath;
}

/**
 * Execute JavaScript in the Electron main process
 *
 * @param {ElectronApplication} app - The Electron app instance
 * @param {Function} fn - Function to execute in main process
 * @param {any} arg - Argument to pass to the function
 * @returns {Promise<any>}
 */
async function evaluateInMain(app, fn, arg) {
  return app.evaluate(fn, arg);
}

/**
 * Get app info from the main process
 *
 * @param {ElectronApplication} app - The Electron app instance
 * @returns {Promise<{name: string, version: string, paths: Object}>}
 */
async function getAppInfo(app) {
  return app.evaluate(async ({ app }) => {
    return {
      name: app.getName(),
      version: app.getVersion(),
      paths: {
        userData: app.getPath('userData'),
        documents: app.getPath('documents'),
        temp: app.getPath('temp')
      }
    };
  });
}

/**
 * Check if the app window is maximized
 *
 * @param {ElectronApplication} app - The Electron app instance
 * @returns {Promise<boolean>}
 */
async function isWindowMaximized(app) {
  return app.evaluate(async ({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    return win ? win.isMaximized() : false;
  });
}

/**
 * Check if the app window is visible
 *
 * @param {ElectronApplication} app - The Electron app instance
 * @returns {Promise<boolean>}
 */
async function isWindowVisible(app) {
  return app.evaluate(async ({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    return win ? win.isVisible() : false;
  });
}

module.exports = {
  launchApp,
  closeApp,
  getMainWindow,
  waitForAppReady,
  dismissModals,
  takeScreenshot,
  evaluateInMain,
  getAppInfo,
  isWindowMaximized,
  isWindowVisible,
  APP_ROOT,
  MAIN_ENTRY
};
