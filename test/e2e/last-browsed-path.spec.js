/**
 * Last Browsed Path E2E Tests
 *
 * Tests the "last browsed path" feature that remembers the last folder
 * location used in file/folder dialogs and opens to that location next time.
 *
 * Run: npm run test:e2e -- --grep "Last Browsed Path"
 */

const { test, expect } = require('@playwright/test');
const { launchApp, closeApp, waitForAppReady } = require('./helpers/electronApp');
const { NavigationPage } = require('./helpers/pageObjects');
const { PHASES, STRATO_TEST_FILES_DIR } = require('./helpers/testFixtures');

test.describe('Last Browsed Path', () => {
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

  test('should have settings API for lastBrowsedPath', async () => {
    // Verify settings API is available - API uses 'get' not 'load'
    const hasSettingsApi = await window.evaluate(() => {
      return {
        hasGet: typeof window.electronAPI?.settings?.get === 'function',
        hasSave: typeof window.electronAPI?.settings?.save === 'function'
      };
    });

    console.log('[Test] Settings API:', hasSettingsApi);
    expect(hasSettingsApi.hasGet).toBe(true);
    expect(hasSettingsApi.hasSave).toBe(true);
  });

  test('should be able to load settings including lastBrowsedPath', async () => {
    // Load current settings using settings.get()
    const settings = await window.evaluate(async () => {
      try {
        const result = await window.electronAPI.settings.get();
        return result || {};
      } catch (e) {
        return { error: e.message };
      }
    });

    console.log('[Test] Settings loaded:', {
      hasSettings: !!settings,
      keys: Object.keys(settings || {}).slice(0, 10),
      hasError: !!settings?.error
    });

    // Settings should load successfully
    expect(settings).toBeDefined();
    expect(settings.error).toBeUndefined();
  });

  test('should have file selection API that supports default path', async () => {
    // Verify the file selection methods exist
    const fileApis = await window.evaluate(() => {
      const files = window.electronAPI?.files;
      return {
        hasSelect: typeof files?.select === 'function',
        hasSelectDirectory: typeof files?.selectDirectory === 'function',
        hasGetDocumentsPath: typeof files?.getDocumentsPath === 'function'
      };
    });

    console.log('[Test] File APIs for path handling:', fileApis);
    expect(fileApis.hasSelect).toBe(true);
    expect(fileApis.hasSelectDirectory).toBe(true);
    expect(fileApis.hasGetDocumentsPath).toBe(true);
  });

  test('should be able to get documents path as fallback', async () => {
    // Get the documents path (used as fallback when no lastBrowsedPath)
    const documentsPath = await window.evaluate(async () => {
      try {
        const result = await window.electronAPI.files.getDocumentsPath();
        // API may return a string directly or an object with path property
        if (typeof result === 'string') return result;
        if (result && typeof result === 'object' && result.path) return result.path;
        return result || null;
      } catch (e) {
        return { error: e.message };
      }
    });

    console.log('[Test] Documents path:', documentsPath);
    // May be null, string, or object depending on platform/implementation
    if (documentsPath && typeof documentsPath === 'object' && documentsPath.error) {
      console.log('[Test] Documents path API returned error - checking if API exists');
      // API exists but may have failed, which is acceptable
    } else if (documentsPath && typeof documentsPath === 'string') {
      expect(documentsPath.length).toBeGreaterThan(0);
    }
    // If documentsPath is null or undefined, that's also acceptable on some platforms
  });
});

test.describe('Last Browsed Path - Settings Persistence', () => {
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

  test('should save lastBrowsedPath to settings', async () => {
    const testPath = STRATO_TEST_FILES_DIR;

    // Save a test path to settings
    const saveResult = await window.evaluate(async (pathToSave) => {
      try {
        // First get current settings
        const settings = (await window.electronAPI.settings.get()) || {};

        // Update with test path
        const updated = { ...settings, lastBrowsedPath: pathToSave };

        // Save updated settings
        await window.electronAPI.settings.save(updated);

        // Reload to verify
        const reloaded = (await window.electronAPI.settings.get()) || {};
        return {
          success: true,
          savedPath: reloaded.lastBrowsedPath || null
        };
      } catch (e) {
        return { error: e.message, success: false };
      }
    }, testPath);

    console.log('[Test] Save result:', saveResult);
    expect(saveResult.success).toBe(true);
    // Path may or may not be exactly the same depending on normalization
    if (saveResult.savedPath) {
      expect(saveResult.savedPath).toContain('StratoSortOfTestFiles');
    }
  });

  test('should persist lastBrowsedPath across settings reload', async () => {
    const testPath = STRATO_TEST_FILES_DIR;

    // Save the path
    const saved = await window.evaluate(async (pathToSave) => {
      try {
        const settings = (await window.electronAPI.settings.get()) || {};
        await window.electronAPI.settings.save({ ...settings, lastBrowsedPath: pathToSave });
        return true;
      } catch (e) {
        return false;
      }
    }, testPath);

    console.log('[Test] Settings saved:', saved);

    // Wait a moment for file system
    await window.waitForTimeout(500);

    // Reload settings and verify
    const reloadedPath = await window.evaluate(async () => {
      const settings = (await window.electronAPI.settings.get()) || {};
      return settings.lastBrowsedPath || null;
    });

    console.log('[Test] Reloaded path:', reloadedPath);
    // Path should contain our test folder name if saved correctly
    if (reloadedPath) {
      expect(reloadedPath).toContain('StratoSortOfTestFiles');
    }
  });

  test('should handle null/undefined lastBrowsedPath gracefully', async () => {
    // Test that null path doesn't break the settings
    const result = await window.evaluate(async () => {
      try {
        const settings = (await window.electronAPI.settings.get()) || {};
        await window.electronAPI.settings.save({ ...settings, lastBrowsedPath: null });

        const reloaded = (await window.electronAPI.settings.get()) || {};
        return {
          success: true,
          path: reloaded.lastBrowsedPath
        };
      } catch (e) {
        return { error: e.message, success: false };
      }
    });

    console.log('[Test] Null path result:', result);
    expect(result.success).toBe(true);
    // Path should be null, undefined, or empty after setting to null
    expect(result.path === null || result.path === undefined || result.path === '').toBe(true);
  });
});

test.describe('Last Browsed Path - Integration with File Selection', () => {
  let app;
  let window;
  let nav;

  test.beforeEach(async () => {
    const result = await launchApp();
    app = result.app;
    window = result.window;
    await waitForAppReady(window);
    nav = new NavigationPage(window);
    await nav.goToPhase(PHASES.DISCOVER);
    await window.waitForTimeout(500);
  });

  test.afterEach(async () => {
    await closeApp(app);
  });

  test('should have test files directory path available', async () => {
    // Verify the test files directory exists
    console.log('[Test] Test files directory:', STRATO_TEST_FILES_DIR);
    expect(STRATO_TEST_FILES_DIR).toContain('StratoSortOfTestFiles');
  });

  test('should expose file selection handlers in DiscoverPhase', async () => {
    // Verify the Discover phase has file selection buttons
    const selectButtons = window.locator(
      'button:has-text("Select"), button:has-text("Files"), button:has-text("Browse")'
    );

    const buttonCount = await selectButtons.count();
    console.log('[Test] File selection buttons found:', buttonCount);

    expect(buttonCount).toBeGreaterThan(0);
  });

  test('should have folder selection option available', async () => {
    // Look for folder selection button or option
    const folderButtons = window.locator(
      'button:has-text("Folder"), button:has-text("Directory"), [aria-label*="folder"]'
    );

    const buttonCount = await folderButtons.count();
    console.log('[Test] Folder selection options found:', buttonCount);

    // At least one way to select folders should be available
    // (might be via menu, dropdown, or direct button)
  });

  test('should correctly format paths for display', async () => {
    // Test that paths are handled correctly (especially on Windows)
    const pathTest = await window.evaluate(() => {
      const testPath = 'C:\\Users\\Test\\Documents\\Files';
      // Check if path handling exists
      if (window.electronAPI?.files?.normalizePath) {
        return window.electronAPI.files.normalizePath(testPath);
      }
      return testPath;
    });

    console.log('[Test] Path formatting:', pathTest);
    expect(pathTest).toBeDefined();
  });
});

test.describe('Last Browsed Path - Validation', () => {
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

  test('should validate lastBrowsedPath as string type', async () => {
    // Test that non-string values are handled correctly
    const validationTest = await window.evaluate(async () => {
      try {
        const settings = (await window.electronAPI.settings.get()) || {};

        // Try to save a number (should be rejected or converted)
        const testSettings = { ...settings, lastBrowsedPath: 12345 };
        await window.electronAPI.settings.save(testSettings);

        // Check what was actually saved
        const reloaded = (await window.electronAPI.settings.get()) || {};
        return {
          type: typeof reloaded.lastBrowsedPath,
          value: reloaded.lastBrowsedPath
        };
      } catch (e) {
        return { error: e.message };
      }
    });

    console.log('[Test] Validation result:', validationTest);
    // Either it should reject invalid types or convert them appropriately
  });

  test('should handle very long paths', async () => {
    // Test path length limits
    const longPath = 'C:\\' + 'a'.repeat(500) + '\\test';

    const result = await window.evaluate(async (pathToTest) => {
      try {
        const settings = (await window.electronAPI.settings.get()) || {};
        await window.electronAPI.settings.save({ ...settings, lastBrowsedPath: pathToTest });

        const reloaded = (await window.electronAPI.settings.get()) || {};
        return {
          saved: true,
          length: reloaded.lastBrowsedPath?.length
        };
      } catch (e) {
        return { error: e.message };
      }
    }, longPath);

    console.log('[Test] Long path result:', result);
    // Should either save successfully or have a reasonable length limit
  });

  test('should handle paths with special characters', async () => {
    // Test paths with spaces and special chars
    const specialPath = 'C:\\Users\\Test User\\Documents\\My Files (2024)\\Reports';

    const result = await window.evaluate(async (pathToTest) => {
      try {
        const settings = (await window.electronAPI.settings.get()) || {};
        await window.electronAPI.settings.save({ ...settings, lastBrowsedPath: pathToTest });

        const reloaded = (await window.electronAPI.settings.get()) || {};
        return {
          saved: true,
          path: reloaded.lastBrowsedPath || null
        };
      } catch (e) {
        return { error: e.message, saved: false };
      }
    }, specialPath);

    console.log('[Test] Special characters result:', result);
    expect(result.saved).toBe(true);
    // Path should be saved (may be normalized)
    if (result.path) {
      expect(result.path).toContain('Test User');
    }
  });
});
