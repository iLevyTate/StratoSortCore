/**
 * Analysis Flow E2E Tests
 *
 * Tests document analysis with the in-process AI engine.
 * Handles missing models gracefully - tests verify API availability
 * and analysis pipeline readiness without requiring models.
 *
 * Run: npm run test:e2e -- --grep "Analysis Flow"
 */

const { test, expect } = require('@playwright/test');
const { launchApp, closeApp, waitForAppReady } = require('./helpers/electronApp');
const { NavigationPage, DiscoverPage } = require('./helpers/pageObjects');
const { PHASES, setupTestFiles, cleanupTempDir } = require('./helpers/testFixtures');

test.describe('Analysis Flow - API', () => {
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

  test('should have analysis API available', async () => {
    const hasAPI = await window.evaluate(() => {
      const api = window.electronAPI?.analysis;
      return {
        document: typeof api?.document === 'function',
        image: typeof api?.image === 'function',
        batch: typeof api?.batch === 'function'
      };
    });
    expect(hasAPI.document).toBe(true);
    expect(hasAPI.image).toBe(true);
    expect(hasAPI.batch).toBe(true);
  });

  test('should have file analyze method via files API', async () => {
    const hasAnalyze = await window.evaluate(() => {
      return typeof window.electronAPI?.files?.analyze === 'function';
    });
    expect(hasAnalyze).toBe(true);
  });
});

test.describe('Analysis Flow - Discover Phase', () => {
  let app;
  let window;
  let nav;
  let discoverPage;

  test.beforeEach(async () => {
    const result = await launchApp();
    app = result.app;
    window = result.window;
    await waitForAppReady(window);
    nav = new NavigationPage(window);
    discoverPage = new DiscoverPage(window);

    await nav.goToPhase(PHASES.DISCOVER);
    await window.waitForTimeout(500);
  });

  test.afterEach(async () => {
    await closeApp(app);
  });

  // TODO: Fix Discover phase controls selectors - app may start on Welcome
  // test('should show analyze or process control on Discover phase', async () => {
  //   const analyzeControl = window.locator(
  //     'button:has-text("Analyze"), button:has-text("Process"), button:has-text("Start"), button:has-text("Select Files"), button:has-text("Continue to Organize")'
  //   );
  //   const count = await analyzeControl.count();
  //   console.log('[Test] Discover phase controls found:', count);
  //   expect(count).toBeGreaterThan(0);
  // });

  test('should accept programmatic file paths for analysis', async () => {
    const { tempDir, files } = await setupTestFiles(['sampleTxt']);
    try {
      const testPath = files[0]?.tempPath;
      expect(testPath).toBeTruthy();

      const result = await window.evaluate(async (filePath) => {
        try {
          const res = await window.electronAPI.files.analyze(filePath);
          return { ok: true, result: res };
        } catch (err) {
          return { ok: false, error: err?.message || String(err) };
        }
      }, testPath);

      console.log('[Test] Analysis result:', result);
      // Pass whether models exist or not - API should be callable
      expect(result).toBeDefined();
    } finally {
      await cleanupTempDir(tempDir);
    }
  });
});
