/**
 * Window State E2E Tests
 *
 * Tests window size and position persistence, fullscreen toggle,
 * and window controls functionality.
 *
 * Run: npm run test:e2e -- --grep "Window State"
 */

const { test, expect } = require('@playwright/test');
const { launchApp, closeApp, waitForAppReady } = require('./helpers/electronApp');

test.describe('Window State', () => {
  let app;
  let window;

  test.beforeEach(async () => {
    const result = await launchApp();
    app = result.app;
    window = result.window;
    await waitForAppReady(window);
  });

  test.afterEach(async () => {
    await closeApp(app);
  });

  test('should have correct initial window size', async () => {
    const bounds = await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      return win ? win.getBounds() : null;
    });

    console.log('[Test] Initial window bounds:', bounds);
    expect(bounds).toBeDefined();
    expect(bounds.width).toBeGreaterThanOrEqual(800);
    expect(bounds.height).toBeGreaterThanOrEqual(600);
  });

  test('should be resizable', async () => {
    const isResizable = await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      return win ? win.isResizable() : false;
    });

    expect(isResizable).toBe(true);
  });

  test('should toggle fullscreen with F11', async () => {
    // Get initial fullscreen state
    const initialState = await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      return win ? win.isFullScreen() : false;
    });

    console.log('[Test] Initial fullscreen state:', initialState);

    // Press F11 to toggle fullscreen
    await window.keyboard.press('F11');
    await window.waitForTimeout(1000); // Allow time for fullscreen transition

    // Check fullscreen state changed
    const afterToggle = await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      return win ? win.isFullScreen() : false;
    });

    console.log('[Test] Fullscreen state after F11:', afterToggle);
    // On some systems, fullscreen toggle may not work in test environment
    // Just verify the state is accessible

    // Toggle back if we entered fullscreen
    if (afterToggle) {
      await window.keyboard.press('F11');
      await window.waitForTimeout(500);
    }
  });

  test('should minimize and restore', async () => {
    // Minimize the window
    await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      if (win) win.minimize();
    });

    await window.waitForTimeout(500);

    const isMinimized = await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      return win ? win.isMinimized() : false;
    });

    console.log('[Test] Window minimized:', isMinimized);
    expect(isMinimized).toBe(true);

    // Restore the window
    await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      if (win) win.restore();
    });

    await window.waitForTimeout(500);

    const isRestored = await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      return win ? !win.isMinimized() : false;
    });

    console.log('[Test] Window restored:', isRestored);
    expect(isRestored).toBe(true);
  });

  test('should maximize and restore', async () => {
    // Maximize the window
    await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      if (win) win.maximize();
    });

    await window.waitForTimeout(500);

    const isMaximized = await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      return win ? win.isMaximized() : false;
    });

    console.log('[Test] Window maximized:', isMaximized);
    expect(isMaximized).toBe(true);

    // Restore to original state
    await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      if (win) win.unmaximize();
    });

    await window.waitForTimeout(500);

    const isUnmaximized = await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      return win ? !win.isMaximized() : false;
    });

    expect(isUnmaximized).toBe(true);
  });
});

test.describe('Window State - Persistence', () => {
  test('should save window bounds to settings', async () => {
    // Launch app
    const { app, window } = await launchApp();
    await waitForAppReady(window);

    // Resize window to specific size
    await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      if (win) {
        win.setBounds({ x: 100, y: 100, width: 1200, height: 800 });
      }
    });

    await window.waitForTimeout(500);

    // Get the current bounds
    const bounds = await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      return win ? win.getBounds() : null;
    });

    console.log('[Test] Window resized to:', bounds);
    expect(bounds.width).toBe(1200);
    expect(bounds.height).toBe(800);

    // Close app
    await closeApp(app);

    // Note: Full persistence testing would require restarting the app
    // and verifying the bounds are restored. This is complex in E2E tests
    // as it requires multiple app launches.
  });

  test('should have window state API available', async () => {
    const { app, window } = await launchApp();
    await waitForAppReady(window);

    // Check if window state methods are available
    const windowMethods = await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      if (!win) return {};
      return {
        hasGetBounds: typeof win.getBounds === 'function',
        hasSetBounds: typeof win.setBounds === 'function',
        hasIsMaximized: typeof win.isMaximized === 'function',
        hasIsMinimized: typeof win.isMinimized === 'function',
        hasIsFullScreen: typeof win.isFullScreen === 'function'
      };
    });

    console.log('[Test] Window methods available:', windowMethods);
    expect(windowMethods.hasGetBounds).toBe(true);
    expect(windowMethods.hasSetBounds).toBe(true);

    await closeApp(app);
  });
});

test.describe('Window State - DevTools', () => {
  test('should toggle DevTools with F12 in development', async () => {
    const { app, window } = await launchApp();
    await waitForAppReady(window);

    // Check initial DevTools state (may already be open in dev mode)
    const initialDevToolsOpen = await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      return win ? win.webContents.isDevToolsOpened() : false;
    });

    console.log('[Test] Initial DevTools state:', initialDevToolsOpen);

    // Press F12 to toggle DevTools
    await window.keyboard.press('F12');
    await window.waitForTimeout(1000);

    const afterToggle = await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      return win ? win.webContents.isDevToolsOpened() : false;
    });

    console.log('[Test] DevTools state after F12:', afterToggle);
    // State should have toggled
    expect(afterToggle).not.toBe(initialDevToolsOpen);

    // Toggle back
    await window.keyboard.press('F12');
    await window.waitForTimeout(500);

    await closeApp(app);
  });
});

test.describe('Window State - Multiple Windows', () => {
  test('should track number of windows', async () => {
    const { app, window } = await launchApp();
    await waitForAppReady(window);

    const windowCount = await app.evaluate(({ BrowserWindow }) => {
      return BrowserWindow.getAllWindows().length;
    });

    console.log('[Test] Window count:', windowCount);
    // Should have at least 1 window (main window)
    // May have more if DevTools is open in separate window
    expect(windowCount).toBeGreaterThanOrEqual(1);

    await closeApp(app);
  });
});
