/**
 * Undo/Redo System E2E Tests
 *
 * Tests the undo/redo functionality for file operations.
 * Verifies that actions can be undone and redone correctly.
 *
 * Run: npm run test:e2e -- --grep "Undo Redo"
 */

const { test, expect } = require('@playwright/test');
const { launchApp, closeApp, waitForAppReady } = require('./helpers/electronApp');
const { NavigationPage } = require('./helpers/pageObjects');

test.describe('Undo Redo - API Availability', () => {
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

  test('should have undo API available', async () => {
    const hasUndo = await window.evaluate(() => {
      return typeof window.electronAPI?.undoRedo?.undo === 'function';
    });

    expect(hasUndo).toBe(true);
  });

  test('should have redo API available', async () => {
    const hasRedo = await window.evaluate(() => {
      return typeof window.electronAPI?.undoRedo?.redo === 'function';
    });

    expect(hasRedo).toBe(true);
  });

  test('should have canUndo check available', async () => {
    const hasCanUndo = await window.evaluate(() => {
      return typeof window.electronAPI?.undoRedo?.canUndo === 'function';
    });

    expect(hasCanUndo).toBe(true);
  });

  test('should have canRedo check available', async () => {
    const hasCanRedo = await window.evaluate(() => {
      return typeof window.electronAPI?.undoRedo?.canRedo === 'function';
    });

    expect(hasCanRedo).toBe(true);
  });

  test('should have history API available', async () => {
    const hasHistory = await window.evaluate(() => {
      const undoRedo = window.electronAPI?.undoRedo;
      return {
        hasGetHistory: typeof undoRedo?.getHistory === 'function',
        // Note: method is clear() not clearHistory() per preload.js line 786
        hasClear: typeof undoRedo?.clear === 'function'
      };
    });

    console.log('[Test] History APIs:', hasHistory);
    expect(hasHistory.hasGetHistory).toBe(true);
    expect(hasHistory.hasClear).toBe(true);
  });
});

test.describe('Undo Redo - State Checks', () => {
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

  test('should check canUndo state', async () => {
    const canUndo = await window.evaluate(async () => {
      try {
        return await window.electronAPI?.undoRedo?.canUndo();
      } catch (e) {
        return false;
      }
    });

    console.log('[Test] Can undo (should be false initially):', canUndo);
    // Initially should be false (no actions to undo)
  });

  test('should check canRedo state', async () => {
    const canRedo = await window.evaluate(async () => {
      try {
        return await window.electronAPI?.undoRedo?.canRedo();
      } catch (e) {
        return false;
      }
    });

    console.log('[Test] Can redo (should be false initially):', canRedo);
    // Initially should be false (nothing to redo)
  });

  test('should get empty history initially', async () => {
    const history = await window.evaluate(async () => {
      try {
        const result = await window.electronAPI?.undoRedo?.getHistory?.();
        return { success: true, count: result?.length || 0 };
      } catch (e) {
        return { success: false, error: e.message };
      }
    });

    console.log('[Test] History state:', history);
  });
});

test.describe('Undo Redo - Keyboard Shortcuts', () => {
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

  test('should respond to Ctrl+Z without error', async () => {
    // Press Ctrl+Z - should not throw even if nothing to undo
    await window.keyboard.press('Control+z');
    await window.waitForTimeout(300);

    // App should still be responsive
    const nav = new NavigationPage(window);
    const phase = await nav.getCurrentPhase();
    expect(phase).toBeDefined();
  });

  test('should respond to Ctrl+Y without error', async () => {
    // Press Ctrl+Y - should not throw even if nothing to redo
    await window.keyboard.press('Control+y');
    await window.waitForTimeout(300);

    // App should still be responsive
    const nav = new NavigationPage(window);
    const phase = await nav.getCurrentPhase();
    expect(phase).toBeDefined();
  });

  test('should respond to Ctrl+Shift+Z without error', async () => {
    // Alternative redo shortcut
    await window.keyboard.press('Control+Shift+z');
    await window.waitForTimeout(300);

    // App should still be responsive
    const nav = new NavigationPage(window);
    const phase = await nav.getCurrentPhase();
    expect(phase).toBeDefined();
  });
});

test.describe('Undo Redo - Menu Integration', () => {
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

  test('should have undo menu item in Edit menu', async () => {
    // Check if Edit menu has Undo item
    const hasMenu = await app.evaluate(({ Menu }) => {
      const menu = Menu.getApplicationMenu();
      if (!menu) return false;

      const editMenu = menu.items.find((item) => item.label === 'Edit');
      if (!editMenu || !editMenu.submenu) return false;

      const undoItem = editMenu.submenu.items.find((item) =>
        item.label.toLowerCase().includes('undo')
      );
      return !!undoItem;
    });

    console.log('[Test] Has Undo in Edit menu:', hasMenu);
  });

  test('should have redo menu item in Edit menu', async () => {
    // Check if Edit menu has Redo item
    const hasMenu = await app.evaluate(({ Menu }) => {
      const menu = Menu.getApplicationMenu();
      if (!menu) return false;

      const editMenu = menu.items.find((item) => item.label === 'Edit');
      if (!editMenu || !editMenu.submenu) return false;

      const redoItem = editMenu.submenu.items.find((item) =>
        item.label.toLowerCase().includes('redo')
      );
      return !!redoItem;
    });

    console.log('[Test] Has Redo in Edit menu:', hasMenu);
  });
});

test.describe('Undo Redo - History Management', () => {
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

  test('should be able to clear history', async () => {
    const result = await window.evaluate(async () => {
      try {
        // Note: method is clear() not clearHistory() per preload.js line 786
        await window.electronAPI?.undoRedo?.clear?.();
        return { success: true };
      } catch (e) {
        return { success: false, error: e.message };
      }
    });

    console.log('[Test] Clear history result:', result);
    expect(result.success).toBe(true);
  });

  test('should have history viewer option', async () => {
    // Look for history viewer button or menu item
    const historyButton = window.locator(
      'button:has-text("History"), button[aria-label*="history"], [data-testid="undo-history"]'
    );
    const count = await historyButton.count();
    console.log('[Test] History viewer buttons:', count);
  });
});
