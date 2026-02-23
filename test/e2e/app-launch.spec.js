/**
 * App Launch E2E Tests
 *
 * Verifies the application starts correctly: window opens, UI renders,
 * and core APIs are available.
 *
 * Run: npm run test:e2e -- --grep "App Launch"
 */

const { test, expect } = require('@playwright/test');
const { launchApp, closeApp, waitForAppReady, getAppInfo } = require('./helpers/electronApp');

test.describe('App Launch', () => {
  let app;
  let window;

  test.afterEach(async () => {
    await closeApp(app);
  });

  test('should launch and open main window', async () => {
    const result = await launchApp();
    app = result.app;
    window = result.window;

    expect(app).toBeTruthy();
    expect(window).toBeTruthy();

    const title = await window.title();
    expect(title).toBeTruthy();
    console.log('[Test] Window title:', title);
  });

  test('should render app UI', async () => {
    const result = await launchApp();
    app = result.app;
    window = result.window;

    await waitForAppReady(window);

    const appSurface = window.locator('.app-surface');
    const exists = (await appSurface.count()) > 0;
    expect(exists).toBe(true);
  });

  test('should have navigation bar visible', async () => {
    const result = await launchApp();
    app = result.app;
    window = result.window;
    await waitForAppReady(window);

    const nav = window.locator('nav[aria-label="Phase navigation"]');
    await expect(nav).toBeVisible({ timeout: 5000 });
  });

  test('should expose electronAPI to renderer', async () => {
    const result = await launchApp();
    app = result.app;
    window = result.window;
    await waitForAppReady(window);

    const hasAPI = await window.evaluate(() => {
      return typeof window.electronAPI === 'object' && window.electronAPI !== null;
    });
    expect(hasAPI).toBe(true);
  });

  test('should report app info from main process', async () => {
    const result = await launchApp();
    app = result.app;
    window = result.window;
    await waitForAppReady(window);

    const info = await getAppInfo(app);
    expect(info).toBeTruthy();
    expect(info.name).toBeTruthy();
    expect(info.version).toBeTruthy();
    console.log('[Test] App info:', info.name, info.version);
  });
});
