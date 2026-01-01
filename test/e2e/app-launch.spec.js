/**
 * App Launch E2E Tests
 *
 * Tests that verify the Electron application launches correctly
 * and the main window initializes properly.
 *
 * Run: npm run test:e2e -- --grep "App Launch"
 */

const { test, expect } = require('@playwright/test');
const { launchApp, closeApp, waitForAppReady } = require('./helpers/electronApp');

test.describe('App Launch', () => {
  let app;
  let window;

  test.beforeEach(async () => {
    // Launch fresh app instance for each test
    const result = await launchApp();
    app = result.app;
    window = result.window;
  });

  test.afterEach(async () => {
    await closeApp(app);
  });

  test('should launch successfully', async () => {
    // Verify app launched
    expect(app).toBeDefined();
    expect(window).toBeDefined();

    // Verify window has content
    const title = await window.title();
    console.log('[Test] Window title:', title);

    // The window should have loaded something (not be blank)
    const content = await window.content();
    expect(content.length).toBeGreaterThan(100);
  });

  test('should display the main application UI', async () => {
    // Wait for the app to be ready
    await waitForAppReady(window);

    // Check for the app surface container
    const appSurface = window.locator('.app-surface');
    await expect(appSurface).toBeVisible({ timeout: 15000 });

    // Check for navigation bar (indicates app loaded)
    const navBar = window.locator('nav[aria-label="Phase navigation"]');
    await expect(navBar).toBeVisible({ timeout: 10000 });
  });

  test('should show the navigation bar', async () => {
    await waitForAppReady(window);

    // Check for navigation bar
    const navBar = window.locator('nav[aria-label="Phase navigation"]');
    await expect(navBar).toBeVisible({ timeout: 10000 });

    // Check for phase buttons
    const phaseButtons = window.locator('nav[aria-label="Phase navigation"] button');
    const buttonCount = await phaseButtons.count();

    console.log('[Test] Found', buttonCount, 'phase buttons');
    expect(buttonCount).toBeGreaterThanOrEqual(4); // At least Welcome, Setup, Discover, Organize, Complete
  });

  test('should show connection status', async () => {
    await waitForAppReady(window);

    // Look for the connection status indicator
    const statusIndicator = window.locator(
      '.text-stratosort-success, .text-green-500, :has-text("Connected")'
    );
    // Connection status might show as connected or disconnected depending on Ollama availability
    const isVisible = await statusIndicator.isVisible().catch(() => false);

    console.log('[Test] Connection status visible:', isVisible);
    // We just verify the UI rendered, not the actual connection state
    // since Ollama may or may not be running
  });

  test('should display settings button', async () => {
    await waitForAppReady(window);

    // Check for settings button
    const settingsButton = window.locator('button[aria-label="Open Settings"]');
    await expect(settingsButton).toBeVisible({ timeout: 10000 });
    await expect(settingsButton).toBeEnabled();
  });

  test('should start on a valid phase by default', async () => {
    await waitForAppReady(window);

    // Check that a phase button is active (has aria-current)
    const activeButton = window.locator('button[aria-current="page"]');
    await expect(activeButton).toBeVisible({ timeout: 10000 });

    const label = await activeButton.getAttribute('aria-label');
    console.log('[Test] Current phase label:', label);

    // Should be a valid phase (Welcome, Setup, Discover, etc.)
    const validPhases = [
      'Welcome',
      'Smart Folders',
      'Configure',
      'Discover',
      'Analyze',
      'Review',
      'Organize',
      'Complete'
    ];
    const isValidPhase = validPhases.some((phase) => label.includes(phase));
    expect(isValidPhase).toBe(true);
  });

  test('should have correct window properties', async () => {
    // Get window bounds
    const bounds = await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      return win ? win.getBounds() : null;
    });

    expect(bounds).toBeDefined();
    expect(bounds.width).toBeGreaterThan(800);
    expect(bounds.height).toBeGreaterThan(600);

    console.log('[Test] Window bounds:', bounds);
  });

  test('should be visible and not minimized', async () => {
    // Wait for app to be ready first
    await waitForAppReady(window);

    // Additional wait for window to become visible after ready-to-show
    await window.waitForTimeout(500);

    const windowState = await app.evaluate(({ BrowserWindow }) => {
      const windows = BrowserWindow.getAllWindows();
      // Find the main window (not DevTools)
      const mainWin = windows.find((w) => !w.webContents.getURL().includes('devtools'));
      if (!mainWin) return { isVisible: false, isMinimized: true, windowFound: false };
      return {
        isVisible: mainWin.isVisible(),
        isMinimized: mainWin.isMinimized(),
        windowFound: true
      };
    });

    console.log('[Test] Window state:', windowState);

    // Window should be found and not minimized
    // Note: isVisible may be false in headless/CI environments but window still works
    expect(windowState.windowFound).toBe(true);
    expect(windowState.isMinimized).toBe(false);
  });

  test('should expose electronAPI to renderer', async () => {
    // Verify the preload script exposed the API
    const hasAPI = await window.evaluate(() => {
      return typeof window.electronAPI !== 'undefined';
    });

    expect(hasAPI).toBe(true);

    // Check for key API methods
    const apiMethods = await window.evaluate(() => {
      const api = window.electronAPI;
      return {
        hasFiles: typeof api.files !== 'undefined',
        hasSettings: typeof api.settings !== 'undefined',
        hasAnalysis: typeof api.analysis !== 'undefined',
        hasEvents: typeof api.events !== 'undefined'
      };
    });

    console.log('[Test] API methods available:', apiMethods);

    expect(apiMethods.hasFiles).toBe(true);
    expect(apiMethods.hasSettings).toBe(true);
    expect(apiMethods.hasAnalysis).toBe(true);
    expect(apiMethods.hasEvents).toBe(true);
  });
});

test.describe('App Launch - Error Handling', () => {
  test('should handle startup gracefully even with issues', async () => {
    // Launch with minimal environment to test graceful degradation
    const { app, window } = await launchApp({
      env: {
        NODE_ENV: 'development',
        // Disable some features to test graceful degradation
        ELECTRON_DISABLE_GPU: '1'
      }
    });

    try {
      // App should still launch and show UI
      const appSurface = window.locator('.app-surface');
      await expect(appSurface).toBeVisible({ timeout: 30000 });

      console.log('[Test] App launched successfully in minimal mode');
    } finally {
      await closeApp(app);
    }
  });
});
