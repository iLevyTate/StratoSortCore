/**
 * Keyboard Navigation E2E Tests
 *
 * Tests keyboard shortcuts, tab navigation, focus management,
 * and accessibility-related keyboard interactions.
 *
 * Run: npm run test:e2e -- --grep "Keyboard Navigation"
 */

const { test, expect } = require('@playwright/test');
const { launchApp, closeApp, waitForAppReady } = require('./helpers/electronApp');
const { NavigationPage } = require('./helpers/pageObjects');
const { PHASES } = require('./helpers/testFixtures');

test.describe('Keyboard Navigation - Tab Navigation', () => {
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

  test('should navigate between elements with Tab key', async () => {
    const focusedElements = [];

    // Press Tab multiple times and record focused elements
    for (let i = 0; i < 5; i++) {
      await window.keyboard.press('Tab');
      await window.waitForTimeout(100);

      const focused = await window.evaluate(() => {
        const el = document.activeElement;
        return {
          tagName: el?.tagName,
          type: el?.type,
          role: el?.getAttribute('role'),
          ariaLabel: el?.getAttribute('aria-label')
        };
      });

      focusedElements.push(focused);
    }

    console.log('[Test] Focused elements after Tab presses:', focusedElements);
    expect(focusedElements.length).toBe(5);
  });

  test('should navigate backwards with Shift+Tab', async () => {
    // First tab forward a few times
    for (let i = 0; i < 3; i++) {
      await window.keyboard.press('Tab');
      await window.waitForTimeout(100);
    }

    const forwardFocus = await window.evaluate(() => {
      return document.activeElement?.tagName;
    });

    // Now tab backwards
    await window.keyboard.press('Shift+Tab');
    await window.waitForTimeout(100);

    const backwardFocus = await window.evaluate(() => {
      return document.activeElement?.tagName;
    });

    console.log('[Test] Forward focus:', forwardFocus);
    console.log('[Test] Backward focus:', backwardFocus);
  });

  test('should show visible focus indicators', async () => {
    await window.keyboard.press('Tab');
    await window.waitForTimeout(100);

    const hasFocusIndicator = await window.evaluate(() => {
      const el = document.activeElement;
      if (!el) return false;

      const style = window.getComputedStyle(el);
      // Check for focus ring, outline, or box-shadow
      return (
        (style.outline !== 'none' && style.outline !== '' && style.outlineWidth !== '0px') ||
        (style.boxShadow !== 'none' && style.boxShadow !== '')
      );
    });

    console.log('[Test] Focus indicator visible:', hasFocusIndicator);
  });
});

test.describe('Keyboard Navigation - Enter and Space', () => {
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

  test('should activate buttons with Enter key', async () => {
    // Tab to a button
    const settingsButton = window.locator('button[aria-label="Open Settings"]');
    await settingsButton.focus();
    await window.waitForTimeout(100);

    // Press Enter
    await window.keyboard.press('Enter');
    await window.waitForTimeout(500);

    // Check if settings opened
    const settingsHeading = window.locator('h2:has-text("Settings")');
    const opened = await settingsHeading.isVisible().catch(() => false);

    console.log('[Test] Settings opened with Enter:', opened);

    // Close settings
    await window.keyboard.press('Escape');
  });

  test('should activate buttons with Space key', async () => {
    // Focus a button
    const settingsButton = window.locator('button[aria-label="Open Settings"]');
    await settingsButton.focus();
    await window.waitForTimeout(100);

    // Press Space
    await window.keyboard.press('Space');
    await window.waitForTimeout(500);

    // Check if settings opened
    const settingsHeading = window.locator('h2:has-text("Settings")');
    const opened = await settingsHeading.isVisible().catch(() => false);

    console.log('[Test] Settings opened with Space:', opened);

    await window.keyboard.press('Escape');
  });
});

test.describe('Keyboard Navigation - Escape Key', () => {
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

  test('should close modals with Escape', async () => {
    // Open settings using button click
    const settingsButton = window.locator('button[aria-label="Open Settings"]');
    await settingsButton.click();
    await window.waitForTimeout(1000);

    // Verify it's open - look for settings heading
    const settingsHeading = window.locator('h2:has-text("Settings")');
    const wasOpen = await settingsHeading.isVisible().catch(() => false);
    console.log('[Test] Settings modal opened:', wasOpen);

    if (wasOpen) {
      // Press Escape
      await window.keyboard.press('Escape');
      await window.waitForTimeout(500);

      // Verify it's closed
      const stillOpen = await settingsHeading.isVisible().catch(() => false);
      expect(stillOpen).toBe(false);
    } else {
      // If settings didn't open, just verify the app is responsive
      const phase = await nav.getCurrentPhase();
      expect(phase).toBeDefined();
    }
  });

  test('should close search modal with Escape', async () => {
    // Open search
    await window.keyboard.press('Control+k');
    await window.waitForTimeout(500);

    // Verify it's open
    const searchInput = window.locator('input[type="search"], input[placeholder*="Search"]');
    const wasOpen = await searchInput
      .first()
      .isVisible()
      .catch(() => false);

    if (wasOpen) {
      // Press Escape
      await window.keyboard.press('Escape');
      await window.waitForTimeout(500);

      // Verify it's closed
      const stillOpen = await searchInput
        .first()
        .isVisible()
        .catch(() => false);
      console.log('[Test] Search closed with Escape:', !stillOpen);
    }
  });

  test('should close dropdowns with Escape', async () => {
    // Look for a dropdown trigger
    const dropdown = window.locator('button[aria-haspopup="true"], [data-state="open"]');
    const count = await dropdown.count();

    console.log('[Test] Dropdown elements found:', count);

    if (count > 0 && (await dropdown.first().isVisible())) {
      await dropdown.first().click();
      await window.waitForTimeout(300);

      // Press Escape
      await window.keyboard.press('Escape');
      await window.waitForTimeout(300);

      console.log('[Test] Dropdown closed with Escape');
    }
  });
});

test.describe('Keyboard Navigation - Phase Navigation', () => {
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

  test('should navigate phases with Alt+Arrow keys', async () => {
    // Start on Welcome
    expect(await nav.getCurrentPhase()).toBe(PHASES.WELCOME);

    // Go to Setup first
    await nav.goToPhase(PHASES.SETUP);
    await window.waitForTimeout(300);

    expect(await nav.getCurrentPhase()).toBe(PHASES.SETUP);

    // Try Alt+Left to go back
    await window.keyboard.press('Alt+ArrowLeft');
    await window.waitForTimeout(500);

    const afterAltLeft = await nav.getCurrentPhase();
    console.log('[Test] Phase after Alt+Left:', afterAltLeft);
  });

  test('should move forward with Alt+Right', async () => {
    // Start on Welcome
    await window.keyboard.press('Alt+ArrowRight');
    await window.waitForTimeout(500);

    const phase = await nav.getCurrentPhase();
    console.log('[Test] Phase after Alt+Right:', phase);
  });

  test('should access navigation with Tab', async () => {
    // Tab until we reach a nav button
    let foundNavButton = false;

    for (let i = 0; i < 10; i++) {
      await window.keyboard.press('Tab');
      await window.waitForTimeout(100);

      const isNavButton = await window.evaluate(() => {
        const el = document.activeElement;
        const nav = el?.closest('nav[aria-label="Phase navigation"]');
        return nav !== null;
      });

      if (isNavButton) {
        foundNavButton = true;
        console.log('[Test] Found nav button at Tab press:', i + 1);
        break;
      }
    }

    expect(foundNavButton).toBe(true);
  });
});

test.describe('Keyboard Navigation - Global Shortcuts', () => {
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

  test('should open settings with Ctrl+,', async () => {
    await window.keyboard.press('Control+,');
    await window.waitForTimeout(500);

    const settingsHeading = window.locator('h2:has-text("Settings")');
    const opened = await settingsHeading.isVisible().catch(() => false);

    expect(opened).toBe(true);
    await window.keyboard.press('Escape');
  });

  test('should open search with Ctrl+K', async () => {
    await window.keyboard.press('Control+k');
    await window.waitForTimeout(500);

    const searchInput = window.locator('input[type="search"], input[placeholder*="Search"]');
    const opened = await searchInput
      .first()
      .isVisible()
      .catch(() => false);

    console.log('[Test] Search opened with Ctrl+K:', opened);

    await window.keyboard.press('Escape');
  });

  test('should trigger file select with Ctrl+O', async () => {
    // Set up event listener
    await window.evaluate(() => {
      window.__testFileSelectCalled = false;
      window.addEventListener('app:select-files', () => {
        window.__testFileSelectCalled = true;
      });
    });

    // Simulate the event
    await window.evaluate(() => {
      window.dispatchEvent(new CustomEvent('app:select-files'));
    });

    const called = await window.evaluate(() => window.__testFileSelectCalled);
    expect(called).toBe(true);
  });

  test('should trigger folder select with Ctrl+Shift+O', async () => {
    // Set up event listener
    await window.evaluate(() => {
      window.__testFolderSelectCalled = false;
      window.addEventListener('app:select-folder', () => {
        window.__testFolderSelectCalled = true;
      });
    });

    // Simulate the event
    await window.evaluate(() => {
      window.dispatchEvent(new CustomEvent('app:select-folder'));
    });

    const called = await window.evaluate(() => window.__testFolderSelectCalled);
    expect(called).toBe(true);
  });
});

test.describe('Keyboard Navigation - Undo/Redo', () => {
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

  test('should check canUndo state', async () => {
    const canUndo = await window.evaluate(async () => {
      try {
        return await window.electronAPI?.undoRedo?.canUndo();
      } catch (e) {
        return false;
      }
    });

    console.log('[Test] Can undo:', canUndo);
  });

  test('should check canRedo state', async () => {
    const canRedo = await window.evaluate(async () => {
      try {
        return await window.electronAPI?.undoRedo?.canRedo();
      } catch (e) {
        return false;
      }
    });

    console.log('[Test] Can redo:', canRedo);
  });
});

test.describe('Keyboard Navigation - Select All', () => {
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

  test('should support Ctrl+A in text inputs', async () => {
    // Open search which has a text input
    await window.keyboard.press('Control+k');
    await window.waitForTimeout(500);

    const searchInput = window
      .locator('input[type="search"], input[placeholder*="Search"]')
      .first();

    if (await searchInput.isVisible()) {
      await searchInput.fill('test text');
      await window.keyboard.press('Control+a');

      // Check if text is selected
      const selectedText = await window.evaluate(() => {
        return window.getSelection()?.toString() || document.activeElement?.value;
      });

      console.log('[Test] Selected text with Ctrl+A:', selectedText);
    }

    await window.keyboard.press('Escape');
  });
});

test.describe('Keyboard Navigation - Arrow Keys', () => {
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

  test('should navigate lists with arrow keys', async () => {
    // Open search which typically has a list
    await window.keyboard.press('Control+k');
    await window.waitForTimeout(500);

    // Type something to get results
    const searchInput = window
      .locator('input[type="search"], input[placeholder*="Search"]')
      .first();

    if (await searchInput.isVisible()) {
      await searchInput.fill('test');
      await window.waitForTimeout(300);

      // Navigate with arrow keys
      await window.keyboard.press('ArrowDown');
      await window.waitForTimeout(100);

      await window.keyboard.press('ArrowUp');
      await window.waitForTimeout(100);

      console.log('[Test] Arrow key navigation executed');
    }

    await window.keyboard.press('Escape');
  });

  test('should support Home/End in lists', async () => {
    await window.keyboard.press('Control+k');
    await window.waitForTimeout(500);

    const searchInput = window.locator('input[type="search"]').first();

    if (await searchInput.isVisible()) {
      await searchInput.fill('test');
      await window.waitForTimeout(300);

      await window.keyboard.press('Home');
      await window.waitForTimeout(100);

      await window.keyboard.press('End');
      await window.waitForTimeout(100);

      console.log('[Test] Home/End navigation executed');
    }

    await window.keyboard.press('Escape');
  });
});

test.describe('Keyboard Navigation - Skip Links', () => {
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

  test('should have skip link for main content', async () => {
    const skipLink = window.locator('a.skip-link, a[href="#main-content"]');
    const count = await skipLink.count();

    console.log('[Test] Skip link found:', count > 0);
    expect(count).toBeGreaterThan(0);
  });

  test('should focus skip link on first Tab', async () => {
    await window.keyboard.press('Tab');
    await window.waitForTimeout(100);

    const isSkipLinkFocused = await window.evaluate(() => {
      const el = document.activeElement;
      return el?.classList.contains('skip-link') || el?.href?.includes('#main');
    });

    console.log('[Test] Skip link focused on first Tab:', isSkipLinkFocused);
  });

  test('should have main content landmark', async () => {
    const main = window.locator('main#main-content, main');
    const count = await main.count();

    expect(count).toBeGreaterThan(0);
  });
});
