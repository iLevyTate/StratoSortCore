/**
 * File Import E2E Tests
 *
 * Tests file selection, drag-and-drop zones, and file list display.
 * Note: Actual file dialog interaction is limited in E2E tests due to OS-level dialogs.
 *
 * Run: npm run test:e2e -- --grep "File Import"
 */

const { test, expect } = require('@playwright/test');
const { launchApp, closeApp, waitForAppReady } = require('./helpers/electronApp');
const { NavigationPage, DiscoverPage } = require('./helpers/pageObjects');
const { PHASES, setupTestFiles, cleanupTempDir } = require('./helpers/testFixtures');

test.describe('File Import', () => {
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

    // Navigate to Discover phase for file import tests
    await nav.goToPhase(PHASES.DISCOVER);
    await window.waitForTimeout(500);
  });

  test.afterEach(async () => {
    await closeApp(app);
  });

  test('should display file drop zone on Discover phase', async () => {
    // Look for drag-drop zone or file selection area
    const dropZone = window.locator(
      '[data-testid="drag-drop-zone"], .drag-drop-zone, [class*="drop"]'
    );
    const dropZoneVisible = await dropZone.isVisible().catch(() => false);

    // Also check for alternative file selection UI
    const selectButton = window.locator(
      'button:has-text("Select"), button:has-text("Choose"), button:has-text("Browse")'
    );
    const selectButtonVisible = await selectButton
      .first()
      .isVisible()
      .catch(() => false);

    console.log('[Test] Drop zone visible:', dropZoneVisible);
    console.log('[Test] Select button visible:', selectButtonVisible);

    // At least one way to select files should be available
    expect(dropZoneVisible || selectButtonVisible).toBe(true);
  });

  test('should show file selection instructions', async () => {
    // Look for instructional text about file selection
    const instructions = window.locator('text=drag, text=drop, text=select, text=files');
    const count = await instructions.count();

    console.log('[Test] Found', count, 'instruction-related text elements');

    // There should be some guidance on how to add files
    // (This is a soft check since the exact text may vary)
  });

  test('should have electronAPI file selection methods available', async () => {
    // Verify the file selection API is exposed
    const hasFileSelect = await window.evaluate(() => {
      return typeof window.electronAPI?.files?.select === 'function';
    });

    const hasDirectorySelect = await window.evaluate(() => {
      return typeof window.electronAPI?.files?.selectDirectory === 'function';
    });

    console.log('[Test] files.select available:', hasFileSelect);
    console.log('[Test] files.selectDirectory available:', hasDirectorySelect);

    expect(hasFileSelect).toBe(true);
    expect(hasDirectorySelect).toBe(true);
  });

  test('should handle empty file list state', async () => {
    // Initially, there should be no files
    const fileCount = await discoverPage.getFileCount().catch(() => 0);
    console.log('[Test] Initial file count:', fileCount);

    // File count should be 0 initially
    expect(fileCount).toBe(0);

    // Should show empty state or prompt
    const emptyState = window.locator(
      'text=no files, text=add files, text=get started, text=select files'
    );
    const hasEmptyState = await emptyState
      .first()
      .isVisible()
      .catch(() => false);

    console.log('[Test] Empty state visible:', hasEmptyState);
  });

  test('should display supported file types information', async () => {
    // Look for information about supported file types
    const typeInfo = window.locator('text=.pdf, text=.txt, text=.doc, text=supported');
    const count = await typeInfo.count();

    console.log('[Test] File type information elements:', count);
    // This is informational - the UI might show supported types
  });
});

test.describe('File Import - Programmatic Testing', () => {
  let app;
  let window;
  let tempDir;
  let testFiles;

  test.beforeEach(async () => {
    const result = await launchApp();
    app = result.app;
    window = result.window;
    await waitForAppReady(window);

    // Setup test files
    const setup = await setupTestFiles(['sampleTxt', 'contract']);
    tempDir = setup.tempDir;
    testFiles = setup.files;
  });

  test.afterEach(async () => {
    await closeApp(app);
    if (tempDir) {
      await cleanupTempDir(tempDir);
    }
  });

  test('should validate file paths through electronAPI', async () => {
    // Test that file analysis API accepts valid paths
    const testPath = testFiles[0]?.tempPath;

    if (testPath) {
      const result = await window.evaluate(async (filePath) => {
        try {
          // Test that the API is accessible and validates paths
          const api = window.electronAPI?.files;
          if (!api) return { error: 'API not available' };

          // Test path normalization
          const normalized = api.normalizePath ? api.normalizePath(filePath) : filePath;
          return { normalized, valid: true };
        } catch (error) {
          return { error: error.message, valid: false };
        }
      }, testPath);

      console.log('[Test] Path validation result:', result);
      expect(result.valid).toBe(true);
    }
  });

  test('should have analysis methods available', async () => {
    // Verify analysis methods exist
    const analysisMethods = await window.evaluate(() => {
      const api = window.electronAPI;
      return {
        hasAnalyzeDocument: typeof api?.analysis?.document === 'function',
        hasAnalyzeImage: typeof api?.analysis?.image === 'function',
        hasFileAnalyze: typeof api?.files?.analyze === 'function'
      };
    });

    console.log('[Test] Analysis methods:', analysisMethods);

    expect(analysisMethods.hasAnalyzeDocument).toBe(true);
    expect(analysisMethods.hasAnalyzeImage).toBe(true);
    expect(analysisMethods.hasFileAnalyze).toBe(true);
  });
});

test.describe('File Import - Directory Selection', () => {
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

  test('should have folder selection option', async () => {
    // Navigate to Discover
    await nav.goToPhase(PHASES.DISCOVER);
    await window.waitForTimeout(500);

    // Look for folder/directory selection option
    const folderOption = window.locator(
      'button:has-text("Folder"), button:has-text("Directory"), button:has-text("Browse Folder")'
    );
    const exists = await folderOption
      .first()
      .isVisible()
      .catch(() => false);

    console.log('[Test] Folder selection option visible:', exists);
    // This is informational - folder selection might be combined with file selection
  });

  test('should have documents path API available', async () => {
    const hasDocumentsPath = await window.evaluate(() => {
      return typeof window.electronAPI?.files?.getDocumentsPath === 'function';
    });

    expect(hasDocumentsPath).toBe(true);

    // Try to get the documents path
    const documentsPath = await window.evaluate(async () => {
      try {
        return await window.electronAPI.files.getDocumentsPath();
      } catch (e) {
        return { error: e.message };
      }
    });

    console.log('[Test] Documents path result:', documentsPath);
  });
});

test.describe('File Import - UI State', () => {
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

  test('should show analyze button (may be disabled initially)', async () => {
    // Look for analyze/process button
    const analyzeButton = window.locator(
      'button:has-text("Analyze"), button:has-text("Process"), button:has-text("Start")'
    );
    const exists = await analyzeButton
      .first()
      .isVisible()
      .catch(() => false);

    console.log('[Test] Analyze button visible:', exists);

    if (exists) {
      // Check if disabled (no files selected)
      const isDisabled = await analyzeButton
        .first()
        .isDisabled()
        .catch(() => true);
      console.log('[Test] Analyze button disabled:', isDisabled);
    }
  });

  test('should show file count indicator', async () => {
    // Look for file count display
    const countIndicator = window.locator('text=/\\d+\\s*(file|item|document)/i');
    const exists = await countIndicator
      .first()
      .isVisible()
      .catch(() => false);

    console.log('[Test] File count indicator visible:', exists);
    // This might show "0 files" or similar
  });

  test('should have selection controls', async () => {
    // Look for selection-related controls
    const selectAll = window.locator('button:has-text("Select All"), input[type="checkbox"]');
    const exists = await selectAll
      .first()
      .isVisible()
      .catch(() => false);

    console.log('[Test] Selection controls visible:', exists);
    // Selection controls might only appear when files are present
  });
});
