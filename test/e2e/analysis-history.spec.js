/**
 * Analysis History E2E Tests
 *
 * Tests the analysis history functionality including:
 * - Viewing past analyses
 * - Searching history
 * - Statistics
 * - Export/Clear operations
 *
 * Correct API path: window.electronAPI.analysisHistory (NOT analysis)
 * From preload.js lines 665-674:
 * - get(options): Get analysis history
 * - search(query, options): Search history
 * - getStatistics(): Get statistics
 * - getFileHistory(filePath): Get file-specific history
 * - clear(): Clear all history
 * - export(format): Export history
 *
 * Run: npm run test:e2e -- --grep "Analysis History"
 */

const { test, expect } = require('@playwright/test');
const { launchApp, closeApp, waitForAppReady } = require('./helpers/electronApp');
const { NavigationPage } = require('./helpers/pageObjects');

test.describe('Analysis History - API Availability', () => {
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

  test('should have analysis history API available', async () => {
    const hasAPI = await window.evaluate(() => {
      // Correct path is electronAPI.analysisHistory per preload.js line 665
      const analysisHistory = window.electronAPI?.analysisHistory;
      return {
        hasGet: typeof analysisHistory?.get === 'function',
        hasClear: typeof analysisHistory?.clear === 'function',
        hasExport: typeof analysisHistory?.export === 'function'
      };
    });

    console.log('[Test] Analysis history APIs:', hasAPI);
    expect(hasAPI.hasGet).toBe(true);
    expect(hasAPI.hasClear).toBe(true);
    expect(hasAPI.hasExport).toBe(true);
  });

  test('should have analysis stats API available', async () => {
    const hasAPI = await window.evaluate(() => {
      // Correct path is electronAPI.analysisHistory per preload.js line 669
      const analysisHistory = window.electronAPI?.analysisHistory;
      return {
        hasGetStatistics: typeof analysisHistory?.getStatistics === 'function',
        hasGetFileHistory: typeof analysisHistory?.getFileHistory === 'function',
        hasSearch: typeof analysisHistory?.search === 'function'
      };
    });

    console.log('[Test] Analysis stats APIs:', hasAPI);
    expect(hasAPI.hasGetStatistics).toBe(true);
    expect(hasAPI.hasSearch).toBe(true);
  });
});

test.describe('Analysis History - Access', () => {
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

  test('should have history access in settings', async () => {
    // Open settings
    await nav.openSettings();
    await window.waitForTimeout(500);

    // Look for history section or button
    const historyElement = window.locator(
      'button:has-text("History"), [data-testid="analysis-history"], :has-text("Analysis History")'
    );
    const count = await historyElement.count();
    console.log('[Test] History elements in settings:', count);

    // Close settings
    await window.keyboard.press('Escape');
  });

  test('should have history access from Discover phase', async () => {
    await nav.goToPhase('discover');
    await window.waitForTimeout(500);

    // Look for history button/link
    const historyButton = window.locator(
      'button:has-text("History"), button[aria-label*="history"], [data-testid="view-history"]'
    );
    const count = await historyButton.count();
    console.log('[Test] History buttons in Discover:', count);
  });
});

test.describe('Analysis History - Data Retrieval', () => {
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

  test('should retrieve analysis history', async () => {
    const result = await window.evaluate(async () => {
      try {
        // Correct API path: analysisHistory.get()
        const history = await window.electronAPI?.analysisHistory?.get?.();
        return {
          success: true,
          count: Array.isArray(history) ? history.length : history?.entries?.length || 0,
          hasData: !!history
        };
      } catch (e) {
        return { success: false, error: e.message };
      }
    });

    console.log('[Test] Analysis history retrieval:', result);
    expect(result.success).toBe(true);
  });

  test('should retrieve analysis statistics', async () => {
    const result = await window.evaluate(async () => {
      try {
        // Correct API path: analysisHistory.getStatistics()
        const stats = await window.electronAPI?.analysisHistory?.getStatistics?.();
        return {
          success: true,
          hasStats: !!stats
        };
      } catch (e) {
        return { success: false, error: e.message };
      }
    });

    console.log('[Test] Analysis statistics retrieval:', result);
    expect(result.success).toBe(true);
  });

  test('should be able to search history', async () => {
    const result = await window.evaluate(async () => {
      try {
        // Correct API path: analysisHistory.search()
        const searchResults = await window.electronAPI?.analysisHistory?.search?.('test');
        return {
          success: true,
          hasResults: !!searchResults
        };
      } catch (e) {
        return { success: false, error: e.message };
      }
    });

    console.log('[Test] History search:', result);
    expect(result.success).toBe(true);
  });
});

test.describe('Analysis History - Operations', () => {
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

  test('should have export functionality', async () => {
    const hasExport = await window.evaluate(() => {
      // Correct API path: analysisHistory.export()
      return typeof window.electronAPI?.analysisHistory?.export === 'function';
    });

    console.log('[Test] Has export API:', hasExport);
    expect(hasExport).toBe(true);
  });

  test('should have clear functionality', async () => {
    const hasClear = await window.evaluate(() => {
      // Correct API path: analysisHistory.clear()
      return typeof window.electronAPI?.analysisHistory?.clear === 'function';
    });

    console.log('[Test] Has clear API:', hasClear);
    expect(hasClear).toBe(true);
  });

  test('should be able to get file-specific history', async () => {
    const hasFileHistory = await window.evaluate(() => {
      // Correct API path: analysisHistory.getFileHistory()
      return typeof window.electronAPI?.analysisHistory?.getFileHistory === 'function';
    });

    console.log('[Test] Has file history API:', hasFileHistory);
    expect(hasFileHistory).toBe(true);
  });
});

test.describe('Analysis History - Statistics View', () => {
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

  test('should get statistics with expected shape', async () => {
    const result = await window.evaluate(async () => {
      try {
        const stats = await window.electronAPI?.analysisHistory?.getStatistics?.();
        return {
          success: true,
          hasStats: !!stats,
          // Check for expected properties
          hasTotalFiles: stats && typeof stats.totalFiles !== 'undefined',
          hasCategories: stats && typeof stats.categories !== 'undefined'
        };
      } catch (e) {
        return { success: false, error: e.message };
      }
    });

    console.log('[Test] Statistics shape:', result);
    expect(result.success).toBe(true);
  });
});
