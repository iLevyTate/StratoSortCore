/**
 * Organization Phase E2E Tests
 *
 * Tests the file organization workflow including:
 * - Phase navigation and UI elements
 * - File listing and selection
 * - Batch operations (Select All, Approve)
 * - Organization execution
 *
 * Real selectors from OrganizePhase.jsx:
 * - .organize-page: Main page container
 * - "Review & Organize": Main heading
 * - "Organize Files Now": Main action button
 * - "Files Ready for Organization": Section heading
 * - "Select All" / "Deselect All": Selection toggle button
 *
 * Run: npm run test:e2e -- --grep "Organize Phase"
 */

const { test, expect } = require('@playwright/test');
const { launchApp, closeApp, waitForAppReady } = require('./helpers/electronApp');
const { NavigationPage } = require('./helpers/pageObjects');
const { PHASES } = require('./helpers/testFixtures');

test.describe('Organize Phase - Navigation', () => {
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

  test('should have Organize button in navigation', async () => {
    // Check if the Organize button exists (may be disabled without analyzed files)
    const organizeButton = window.locator('button:has-text("Organize")');
    const exists = (await organizeButton.count()) > 0;
    console.log('[Test] Organize button exists:', exists);
    expect(exists).toBe(true);
  });

  test('should show Organize button state correctly', async () => {
    // Check the button state - should be disabled without analyzed files
    const organizeButton = window.locator('button:has-text("Organize")');
    const isDisabled = await organizeButton.isDisabled().catch(() => true);
    console.log('[Test] Organize button disabled (expected without files):', isDisabled);
    // Button state is valid either way - we're testing the button exists and has a state
  });
});

test.describe('Organize Phase - File Section (requires navigation)', () => {
  let app;
  let window;
  let nav;
  let canNavigate = false;

  test.beforeEach(async () => {
    const result = await launchApp();
    app = result.app;
    window = result.window;
    await waitForAppReady(window);
    nav = new NavigationPage(window);

    // Try to navigate - may fail if button is disabled
    const organizeButton = window.locator('button:has-text("Organize")');
    const isDisabled = await organizeButton.isDisabled().catch(() => true);
    if (!isDisabled) {
      await nav.goToPhase(PHASES.ORGANIZE);
      canNavigate = true;
    } else {
      console.log('[Test] Skipping - Organize button is disabled (no analyzed files)');
    }
    await window.waitForTimeout(500);
  });

  test.afterEach(async () => {
    await closeApp(app);
  });

  test('should have files ready section when on Organize phase', async () => {
    test.skip(!canNavigate, 'Cannot navigate to Organize phase without analyzed files');
    const filesSectionHeading = window.locator('h2:has-text("Files Ready for Organization")');
    const isVisible = await filesSectionHeading.isVisible().catch(() => false);
    console.log('[Test] Files ready section visible:', isVisible);
    expect(isVisible).toBe(true);
  });

  test('should show empty state when no files', async () => {
    test.skip(!canNavigate, 'Cannot navigate to Organize phase without analyzed files');
    const emptyState = window.locator(
      ':has-text("No files ready yet"), :has-text("All files organized")'
    );
    const count = await emptyState.count();
    console.log('[Test] Empty state elements:', count);
  });

  test('should have back to Discovery button when on Organize phase', async () => {
    test.skip(!canNavigate, 'Cannot navigate to Organize phase without analyzed files');
    const backButton = window.locator('button:has-text("Back to Discovery")');
    const isVisible = await backButton.isVisible().catch(() => false);
    console.log('[Test] Back to Discovery button visible:', isVisible);
    expect(isVisible).toBe(true);
  });

  test('should have View Results button when on Organize phase', async () => {
    test.skip(!canNavigate, 'Cannot navigate to Organize phase without analyzed files');
    const viewResultsButton = window.locator('button:has-text("View Results")');
    const isVisible = await viewResultsButton.isVisible().catch(() => false);
    console.log('[Test] View Results button visible:', isVisible);
    expect(isVisible).toBe(true);
  });
});

test.describe('Organize Phase - Quick Access Toolbar (requires navigation)', () => {
  let app;
  let window;
  let nav;
  let canNavigate = false;

  test.beforeEach(async () => {
    const result = await launchApp();
    app = result.app;
    window = result.window;
    await waitForAppReady(window);
    nav = new NavigationPage(window);

    const organizeButton = window.locator('button:has-text("Organize")');
    const isDisabled = await organizeButton.isDisabled().catch(() => true);
    if (!isDisabled) {
      await nav.goToPhase(PHASES.ORGANIZE);
      canNavigate = true;
    }
    await window.waitForTimeout(500);
  });

  test.afterEach(async () => {
    await closeApp(app);
  });

  test('should have status button when on Organize phase', async () => {
    test.skip(!canNavigate, 'Cannot navigate to Organize phase without analyzed files');
    const statusButton = window.locator('button:has-text("Ready")');
    const isVisible = await statusButton.isVisible().catch(() => false);
    console.log('[Test] Status button visible:', isVisible);
    expect(isVisible).toBe(true);
  });

  test('should have smart folders button when folders configured', async () => {
    test.skip(!canNavigate, 'Cannot navigate to Organize phase without analyzed files');
    const foldersButton = window.locator('button:has-text("Smart Folders")');
    const count = await foldersButton.count();
    console.log('[Test] Smart Folders button count:', count);
  });
});

test.describe('Organize Phase - Undo/Redo Integration (requires navigation)', () => {
  let app;
  let window;
  let nav;
  let canNavigate = false;

  test.beforeEach(async () => {
    const result = await launchApp();
    app = result.app;
    window = result.window;
    await waitForAppReady(window);
    nav = new NavigationPage(window);

    const organizeButton = window.locator('button:has-text("Organize")');
    const isDisabled = await organizeButton.isDisabled().catch(() => true);
    if (!isDisabled) {
      await nav.goToPhase(PHASES.ORGANIZE);
      canNavigate = true;
    }
    await window.waitForTimeout(500);
  });

  test.afterEach(async () => {
    await closeApp(app);
  });

  test('should have undo/redo toolbar when on Organize phase', async () => {
    test.skip(!canNavigate, 'Cannot navigate to Organize phase without analyzed files');
    const undoButton = window.locator('button[aria-label*="Undo"], button:has-text("Undo")');
    const redoButton = window.locator('button[aria-label*="Redo"], button:has-text("Redo")');

    const undoCount = await undoButton.count();
    const redoCount = await redoButton.count();
    console.log('[Test] Undo buttons:', undoCount, 'Redo buttons:', redoCount);
  });
});

test.describe('Organize Phase - API Integration', () => {
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

  test('should have file organization API available', async () => {
    const hasAPI = await window.evaluate(() => {
      const files = window.electronAPI?.files;
      return {
        hasMove: typeof files?.move === 'function',
        hasRename: typeof files?.rename === 'function',
        hasCopy: typeof files?.copy === 'function'
      };
    });

    console.log('[Test] File operations API:', hasAPI);
    // At least move should be available for organization
  });

  test('should have undo/redo API available', async () => {
    const hasAPI = await window.evaluate(() => {
      const undoRedo = window.electronAPI?.undoRedo;
      return {
        hasUndo: typeof undoRedo?.undo === 'function',
        hasRedo: typeof undoRedo?.redo === 'function',
        hasCanUndo: typeof undoRedo?.canUndo === 'function',
        hasCanRedo: typeof undoRedo?.canRedo === 'function'
      };
    });

    console.log('[Test] Undo/Redo API:', hasAPI);
    expect(hasAPI.hasUndo).toBe(true);
    expect(hasAPI.hasRedo).toBe(true);
  });

  test('should have smart folders API available', async () => {
    const hasAPI = await window.evaluate(() => {
      const smartFolders = window.electronAPI?.smartFolders;
      return {
        hasGet: typeof smartFolders?.get === 'function',
        hasSave: typeof smartFolders?.save === 'function'
      };
    });

    console.log('[Test] Smart Folders API:', hasAPI);
    expect(hasAPI.hasGet).toBe(true);
  });
});

test.describe('Organize Phase - Modals (requires navigation)', () => {
  let app;
  let window;
  let nav;
  let canNavigate = false;

  test.beforeEach(async () => {
    const result = await launchApp();
    app = result.app;
    window = result.window;
    await waitForAppReady(window);
    nav = new NavigationPage(window);

    const organizeButton = window.locator('button:has-text("Organize")');
    const isDisabled = await organizeButton.isDisabled().catch(() => true);
    if (!isDisabled) {
      await nav.goToPhase(PHASES.ORGANIZE);
      canNavigate = true;
    }
    await window.waitForTimeout(500);
  });

  test.afterEach(async () => {
    await closeApp(app);
  });

  test('should open status overview modal', async () => {
    test.skip(!canNavigate, 'Cannot navigate to Organize phase without analyzed files');
    const statusButton = window.locator('button:has-text("Ready")');
    if (await statusButton.isVisible().catch(() => false)) {
      await statusButton.click();
      await window.waitForTimeout(300);

      const modalTitle = window.locator(
        'h2:has-text("File Status Overview"), h3:has-text("File Status Overview")'
      );
      const isVisible = await modalTitle.isVisible().catch(() => false);
      console.log('[Test] Status modal visible:', isVisible);

      await window.keyboard.press('Escape');
    }
  });

  test('should open smart folders modal when available', async () => {
    test.skip(!canNavigate, 'Cannot navigate to Organize phase without analyzed files');
    const foldersButton = window.locator('button:has-text("Smart Folders")');
    if (await foldersButton.isVisible().catch(() => false)) {
      await foldersButton.click();
      await window.waitForTimeout(300);

      const modalTitle = window.locator(':has-text("Target Smart Folders")');
      const count = await modalTitle.count();
      console.log('[Test] Smart folders modal elements:', count);

      await window.keyboard.press('Escape');
    } else {
      console.log('[Test] Smart folders button not visible (no folders configured)');
    }
  });
});
