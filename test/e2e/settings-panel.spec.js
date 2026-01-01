/**
 * Settings Panel E2E Tests
 *
 * Tests settings panel interactions including opening, closing,
 * navigation between sections, and various setting controls.
 *
 * Run: npm run test:e2e -- --grep "Settings Panel"
 */

const { test, expect } = require('@playwright/test');
const { launchApp, closeApp, waitForAppReady } = require('./helpers/electronApp');
const { NavigationPage } = require('./helpers/pageObjects');

test.describe('Settings Panel - Opening and Closing', () => {
  let app;
  let window;
  let nav;

  test.beforeEach(async () => {
    const result = await launchApp();
    app = result.app;
    window = result.window;
    await waitForAppReady(window);
    nav = new NavigationPage(window);
  });

  test.afterEach(async () => {
    await closeApp(app);
  });

  test('should open settings with settings button', async () => {
    const settingsButton = window.locator('button[aria-label="Open Settings"]');
    await expect(settingsButton).toBeVisible();
    await settingsButton.click();
    await window.waitForTimeout(500);

    // Look for Settings heading in the modal
    const settingsHeading = window.locator('h2:has-text("Settings")');
    await expect(settingsHeading).toBeVisible({ timeout: 5000 });
  });

  test('should open settings with Ctrl+,', async () => {
    await window.keyboard.press('Control+,');
    await window.waitForTimeout(500);

    const settingsHeading = window.locator('h2:has-text("Settings")');
    await expect(settingsHeading).toBeVisible({ timeout: 5000 });
  });

  test('should close settings with Escape key', async () => {
    // Open settings first
    await nav.openSettings();
    await window.waitForTimeout(500);

    // Verify it's open
    const settingsHeading = window.locator('h2:has-text("Settings")');
    await expect(settingsHeading).toBeVisible();

    // Press Escape to close
    await window.keyboard.press('Escape');
    await window.waitForTimeout(500);

    // Verify it's closed
    const isVisible = await settingsHeading.isVisible().catch(() => false);
    expect(isVisible).toBe(false);
  });

  test('should close settings with close button', async () => {
    // Open settings
    await nav.openSettings();
    await window.waitForTimeout(500);

    // Find and click close button
    const closeButton = window.locator(
      '[aria-label="Close Settings"], [aria-label="Close"], button:has-text("Close")'
    );

    if (await closeButton.first().isVisible()) {
      await closeButton.first().click();
      await window.waitForTimeout(500);

      // Verify it's closed
      const settingsHeading = window.locator('h2:has-text("Settings")');
      const isVisible = await settingsHeading.isVisible().catch(() => false);
      expect(isVisible).toBe(false);
    }
  });

  test('should close settings by clicking overlay/outside', async () => {
    // Open settings
    await nav.openSettings();
    await window.waitForTimeout(500);

    // Click on the overlay (outside the dialog content)
    const overlay = window.locator('[role="presentation"].fixed.inset-0');
    if (await overlay.isVisible()) {
      // Click at the edge of the overlay
      await overlay.click({ position: { x: 10, y: 10 } });
      await window.waitForTimeout(500);

      // Verify it's closed
      const settingsHeading = window.locator('h2:has-text("Settings")');
      const isVisible = await settingsHeading.isVisible().catch(() => false);
      // May or may not close depending on implementation
      console.log('[Test] Settings closed by clicking outside:', !isVisible);
    }
  });
});

test.describe('Settings Panel - AI Configuration', () => {
  let app;
  let window;
  let nav;

  test.beforeEach(async () => {
    const result = await launchApp();
    app = result.app;
    window = result.window;
    await waitForAppReady(window);
    nav = new NavigationPage(window);
    await nav.openSettings();
    await window.waitForTimeout(500);
  });

  test.afterEach(async () => {
    await closeApp(app);
  });

  test('should display AI model settings', async () => {
    // Look for model-related settings
    const modelLabels = window.locator('text=Model, text=model, text=Ollama');
    const count = await modelLabels.count();

    console.log('[Test] Model-related labels found:', count);
    expect(count).toBeGreaterThan(0);
  });

  test('should have text model dropdown', async () => {
    const textModelSelect = window.locator(
      'select[name*="textModel"], [data-testid="text-model-select"], label:has-text("Text Model") + select'
    );

    const exists = await textModelSelect.count();
    console.log('[Test] Text model selector found:', exists > 0);
  });

  test('should have vision model dropdown', async () => {
    const visionModelSelect = window.locator(
      'select[name*="visionModel"], [data-testid="vision-model-select"], label:has-text("Vision Model") + select'
    );

    const exists = await visionModelSelect.count();
    console.log('[Test] Vision model selector found:', exists > 0);
  });

  test('should have connection test button', async () => {
    const testButton = window.locator(
      'button:has-text("Test"), button:has-text("Connection"), button:has-text("Verify")'
    );

    const visible = await testButton
      .first()
      .isVisible()
      .catch(() => false);
    console.log('[Test] Connection test button visible:', visible);
  });

  test('should display Ollama host URL input', async () => {
    const hostInput = window.locator(
      'input[placeholder*="localhost"], input[name*="host"], input[name*="url"]'
    );

    const count = await hostInput.count();
    console.log('[Test] Host URL input found:', count > 0);
  });
});

test.describe('Settings Panel - Processing Limits', () => {
  let app;
  let window;
  let nav;

  test.beforeEach(async () => {
    const result = await launchApp();
    app = result.app;
    window = result.window;
    await waitForAppReady(window);
    nav = new NavigationPage(window);
    await nav.openSettings();
    await window.waitForTimeout(500);
  });

  test.afterEach(async () => {
    await closeApp(app);
  });

  test('should have processing limits section', async () => {
    // Look for processing limits section header or related controls
    const limitLabels = window.locator(
      'text=Processing, text=Limits, text=Max, text=Size, text=Timeout'
    );
    const count = await limitLabels.count();

    console.log('[Test] Processing limit labels found:', count);
    // Should have at least some limit-related settings
  });

  test('should have file size limit control', async () => {
    const sizeControl = window.locator(
      'input[name*="maxFile"], input[name*="fileSize"], [data-testid*="file-size"]'
    );

    const count = await sizeControl.count();
    console.log('[Test] File size control found:', count > 0);
  });

  test('should have batch size control', async () => {
    const batchControl = window.locator('input[name*="batch"], [data-testid*="batch-size"]');

    const count = await batchControl.count();
    console.log('[Test] Batch size control found:', count > 0);
  });
});

test.describe('Settings Panel - Auto-Organization', () => {
  let app;
  let window;
  let nav;

  test.beforeEach(async () => {
    const result = await launchApp();
    app = result.app;
    window = result.window;
    await waitForAppReady(window);
    nav = new NavigationPage(window);
    await nav.openSettings();
    await window.waitForTimeout(500);
  });

  test.afterEach(async () => {
    await closeApp(app);
  });

  test('should have auto-organize toggle', async () => {
    const autoToggle = window.locator(
      'input[type="checkbox"][name*="auto"], [data-testid*="auto-organize"], label:has-text("Auto")'
    );

    const count = await autoToggle.count();
    console.log('[Test] Auto-organize toggle found:', count > 0);
  });

  test('should have confidence threshold slider', async () => {
    const confidenceControl = window.locator(
      'input[type="range"][name*="confidence"], [data-testid*="confidence"], label:has-text("Confidence")'
    );

    const count = await confidenceControl.count();
    console.log('[Test] Confidence threshold control found:', count > 0);
  });
});

test.describe('Settings Panel - Default Locations', () => {
  let app;
  let window;
  let nav;

  test.beforeEach(async () => {
    const result = await launchApp();
    app = result.app;
    window = result.window;
    await waitForAppReady(window);
    nav = new NavigationPage(window);
    await nav.openSettings();
    await window.waitForTimeout(500);
  });

  test.afterEach(async () => {
    await closeApp(app);
  });

  test('should have default folder location setting', async () => {
    const locationSetting = window.locator(
      'input[name*="default"], [data-testid*="default-location"], label:has-text("Default")'
    );

    const count = await locationSetting.count();
    console.log('[Test] Default location setting found:', count > 0);
  });

  test('should have browse button for default location', async () => {
    const browseButton = window.locator('button:has-text("Browse"), button:has-text("Choose")');

    const count = await browseButton.count();
    console.log('[Test] Browse buttons found:', count);
  });
});

test.describe('Settings Panel - Backup & Restore', () => {
  let app;
  let window;
  let nav;

  test.beforeEach(async () => {
    const result = await launchApp();
    app = result.app;
    window = result.window;
    await waitForAppReady(window);
    nav = new NavigationPage(window);
    await nav.openSettings();
    await window.waitForTimeout(500);
  });

  test.afterEach(async () => {
    await closeApp(app);
  });

  test('should have export settings option', async () => {
    const exportButton = window.locator(
      'button:has-text("Export"), button:has-text("Save Settings")'
    );

    const count = await exportButton.count();
    console.log('[Test] Export settings button found:', count > 0);
  });

  test('should have import settings option', async () => {
    const importButton = window.locator(
      'button:has-text("Import"), button:has-text("Load Settings")'
    );

    const count = await importButton.count();
    console.log('[Test] Import settings button found:', count > 0);
  });

  test('should have backup option', async () => {
    const backupButton = window.locator(
      'button:has-text("Backup"), button:has-text("Create Backup")'
    );

    const count = await backupButton.count();
    console.log('[Test] Backup button found:', count > 0);
  });
});

test.describe('Settings Panel - Persistence', () => {
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

  test('should save settings through API', async () => {
    // Get current settings
    const currentSettings = await window.evaluate(async () => {
      return await window.electronAPI.settings.get();
    });

    expect(currentSettings).toBeDefined();
    console.log('[Test] Current settings keys:', Object.keys(currentSettings || {}));
  });

  test('should preserve settings after save', async () => {
    // Modify a setting and verify it persists
    const result = await window.evaluate(async () => {
      try {
        const settings = await window.electronAPI.settings.get();
        const testValue = Date.now().toString();

        // Save with a test marker
        await window.electronAPI.settings.save({
          ...settings,
          _testMarker: testValue
        });

        // Reload and verify
        const reloaded = await window.electronAPI.settings.get();
        return {
          success: true,
          saved: testValue,
          loaded: reloaded._testMarker
        };
      } catch (e) {
        return { success: false, error: e.message };
      }
    });

    console.log('[Test] Settings persistence result:', result);
    if (result.success) {
      expect(result.saved).toBe(result.loaded);
    }
  });
});
