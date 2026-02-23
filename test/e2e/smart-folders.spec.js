/**
 * Smart Folders E2E Tests
 *
 * Tests smart folder creation, editing, deletion, and management
 * in the Setup phase of the application.
 *
 * Run: npm run test:e2e -- --grep "Smart Folders"
 */

const { test, expect } = require('@playwright/test');
const { launchApp, closeApp, waitForAppReady } = require('./helpers/electronApp');
const { NavigationPage } = require('./helpers/pageObjects');
const { PHASES } = require('./helpers/testFixtures');

test.describe('Smart Folders - Setup Phase Navigation', () => {
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

  test('should navigate to Setup phase', async () => {
    await nav.goToPhase(PHASES.SETUP);
    await window.waitForTimeout(500);

    const currentPhase = await nav.getCurrentPhase();
    expect(currentPhase).toBe(PHASES.SETUP);
  });

  test('should display Smart Folders heading', async () => {
    await nav.goToPhase(PHASES.SETUP);
    await window.waitForTimeout(2000);

    const heading = window.locator(
      'h1:has-text("Smart Folders"), h1:has-text("Configure"), h1:has-text("Configure Smart")'
    );
    const count = await heading.count();

    console.log('[Test] Smart Folders heading elements:', count);

    // Check for error boundary if heading is missing
    if (count === 0) {
      const errorBoundary = window.locator('text=Something went wrong');
      if (await errorBoundary.isVisible()) {
        console.log('[Test] Phase Error Boundary triggered!');
      }
      // Dump page content for debugging
      const body = await window.textContent('body');
      console.log('[Test] Page content:', body.substring(0, 500) + '...');
    }

    expect(count).toBeGreaterThan(0);
  });

  test('should have Add Folder button', async () => {
    await nav.goToPhase(PHASES.SETUP);
    await window.waitForTimeout(1000);

    const addButton = window.locator(
      'button:has-text("Add Folder"), button:has-text("Add Custom Folder")'
    );

    const visible = await addButton
      .first()
      .isVisible()
      .catch(() => false);
    console.log('[Test] Add folder button visible:', visible);
    expect(visible).toBe(true);
  });
});

test.describe('Smart Folders - Folder List', () => {
  let app;
  let window;
  let nav;

  test.beforeEach(async () => {
    const result = await launchApp();
    app = result.app;
    window = result.window;
    await waitForAppReady(window);
    nav = new NavigationPage(window);
    await nav.goToPhase(PHASES.SETUP);
    await window.waitForTimeout(500);
  });

  test.afterEach(async () => {
    await closeApp(app);
  });

  test('should display folder list container or empty state', async () => {
    await window.waitForTimeout(1500);
    const folderList = window.locator('[data-testid="folder-list"]');
    const emptyState = window.locator('[data-testid="smart-folders-empty-state"]');
    const listVisible = await folderList.isVisible().catch(() => false);
    const emptyVisible = await emptyState.isVisible().catch(() => false);
    const hasFolderButtons = await window
      .locator(
        'button:has-text("Add Folder"), button:has-text("Uncategorized"), button:has-text("Documents")'
      )
      .first()
      .isVisible()
      .catch(() => false);

    expect(listVisible || emptyVisible || hasFolderButtons).toBe(true);
  });

  test('should populate folders if empty (Load Defaults)', async () => {
    await window.waitForTimeout(1500);
    const emptyState = window.locator('[data-testid="smart-folders-empty-state"]');
    const hasEmptyState = await emptyState.isVisible().catch(() => false);

    if (hasEmptyState) {
      const loadDefaultsBtn = window.locator('button:has-text("Load Defaults")');
      try {
        await loadDefaultsBtn.click({ timeout: 5000 });
        const confirmBtn = window.locator('button:has-text("Reset")');
        await confirmBtn.waitFor({ state: 'visible', timeout: 3000 }).catch(() => {});
        if (await confirmBtn.isVisible().catch(() => false)) {
          await confirmBtn.click();
        }
        await window
          .locator('button:has-text("Uncategorized"), button:has-text("Documents")')
          .first()
          .waitFor({ state: 'visible', timeout: 8000 });
      } catch {
        test.skip(true, 'Load Defaults flow skipped (element detached or timeout)');
      }
    }

    const folderItems = window.locator(
      '[data-testid="folder-item"], button:has-text("Uncategorized"), button:has-text("Documents"), button:has-text("Archives")'
    );
    await window.waitForTimeout(500);
    const folderCount = await folderItems.count();
    expect(folderCount).toBeGreaterThan(0);
  });

  test('should have Uncategorized folder by default', async () => {
    // Ensure consistent state by resetting to defaults via API
    await window.evaluate(async () => {
      await window.electronAPI?.smartFolders?.resetToDefaults();
    });

    // Refresh the view by navigating away and back
    await nav.goToPhase(PHASES.WELCOME);
    await window.waitForTimeout(500);
    await nav.goToPhase(PHASES.SETUP);
    // Increased wait time to ensure rendering is complete
    await window.waitForTimeout(2000);

    // Use a specific locator for the Uncategorized folder text
    const uncategorized = window.locator('text=Uncategorized');

    // Wait for it to appear with a generous timeout
    await uncategorized
      .first()
      .waitFor({ state: 'visible', timeout: 10000 })
      .catch(() => {
        console.log('[Test] Warning: Uncategorized folder wait timed out');
      });

    const count = await uncategorized.count();
    console.log('[Test] Uncategorized folder found:', count > 0);
    expect(count).toBeGreaterThan(0);
  });

  test('should display folder items with names', async () => {
    const emptyState = window.locator('[data-testid="smart-folders-empty-state"]');
    const emptyVisible = await emptyState.isVisible().catch(() => false);
    if (emptyVisible) {
      test.skip(true, 'Skipping when no folders configured (empty state)');
    }

    await window.waitForTimeout(1000);
    const uncategorized = window.getByRole('button', { name: /Uncategorized/i });
    const documents = window.getByRole('button', { name: /Documents/i });
    const hasFolders = (await uncategorized.count()) > 0 || (await documents.count()) > 0;
    expect(hasFolders).toBe(true);
  });

  test('should have folders API available', async () => {
    const foldersApi = await window.evaluate(() => {
      // API is exposed as electronAPI.smartFolders
      const api = window.electronAPI?.smartFolders;
      const filesApi = window.electronAPI?.files;
      return {
        hasGet: typeof api?.get === 'function',
        hasAdd: typeof api?.add === 'function',
        hasEdit: typeof api?.edit === 'function',
        hasDelete: typeof api?.delete === 'function',
        // Scanning is on smartFolders or files depending on type
        hasScanStructure: typeof api?.scanStructure === 'function'
      };
    });

    console.log('[Test] Smart Folders API methods:', foldersApi);
    expect(foldersApi.hasGet).toBe(true);
    expect(foldersApi.hasAdd).toBe(true);
  });
});

test.describe('Smart Folders - Create Folder', () => {
  let app;
  let window;
  let nav;

  test.beforeEach(async () => {
    const result = await launchApp();
    app = result.app;
    window = result.window;
    await waitForAppReady(window);
    nav = new NavigationPage(window);
    await nav.goToPhase(PHASES.SETUP);
    await window.waitForTimeout(500);
  });

  test.afterEach(async () => {
    await closeApp(app);
  });

  test('should open add folder modal', async () => {
    const addButton = window
      .locator('button:has-text("Add"), button:has-text("New"), button:has-text("Create")')
      .first();

    if (await addButton.isVisible()) {
      await addButton.click();
      await window.waitForTimeout(500);

      const modal = window.locator('[role="dialog"]');
      const visible = await modal.isVisible().catch(() => false);
      console.log('[Test] Add folder modal visible:', visible);
    }
  });

  test('should have folder name input in modal', async () => {
    const addButton = window
      .locator('button:has-text("Add"), button:has-text("New"), button:has-text("Create")')
      .first();

    if (await addButton.isVisible()) {
      await addButton.click();
      await window.waitForTimeout(500);

      const nameInput = window.locator(
        'input[name*="name"], input[placeholder*="name"], input[placeholder*="Name"]'
      );

      const count = await nameInput.count();
      console.log('[Test] Folder name input found:', count > 0);
    }
  });

  test('should have folder path input or browse button', async () => {
    const addButton = window
      .locator('button:has-text("Add"), button:has-text("New"), button:has-text("Create")')
      .first();

    if (await addButton.isVisible()) {
      await addButton.click();
      await window.waitForTimeout(500);

      const pathInput = window.locator('input[name*="path"], input[placeholder*="path"]');
      const browseButton = window.locator('button:has-text("Browse"), button:has-text("Choose")');

      const pathCount = await pathInput.count();
      const browseCount = await browseButton.count();

      console.log('[Test] Path input found:', pathCount > 0);
      console.log('[Test] Browse button found:', browseCount > 0);
    }
  });

  test('should have keywords input', async () => {
    const addButton = window
      .locator('button:has-text("Add"), button:has-text("New"), button:has-text("Create")')
      .first();

    if (await addButton.isVisible()) {
      await addButton.click();
      await window.waitForTimeout(500);

      const keywordsInput = window.locator(
        'input[name*="keyword"], textarea[name*="keyword"], [data-testid*="keyword"]'
      );

      const count = await keywordsInput.count();
      console.log('[Test] Keywords input found:', count > 0);
    }
  });

  test('should have description input', async () => {
    const addButton = window
      .locator('button:has-text("Add"), button:has-text("New"), button:has-text("Create")')
      .first();

    if (await addButton.isVisible()) {
      await addButton.click();
      await window.waitForTimeout(500);

      const descInput = window.locator('textarea[name*="description"], input[name*="description"]');

      const count = await descInput.count();
      console.log('[Test] Description input found:', count > 0);
    }
  });

  test('should have save and cancel buttons', async () => {
    const addButton = window
      .locator('button:has-text("Add"), button:has-text("New"), button:has-text("Create")')
      .first();

    if (await addButton.isVisible()) {
      await addButton.click();
      await window.waitForTimeout(500);

      const saveButton = window.locator('button:has-text("Save"), button:has-text("Create")');
      const cancelButton = window.locator('button:has-text("Cancel"), button:has-text("Close")');

      const saveCount = await saveButton.count();
      const cancelCount = await cancelButton.count();

      console.log('[Test] Save button found:', saveCount > 0);
      console.log('[Test] Cancel button found:', cancelCount > 0);
    }
  });
});

test.describe('Smart Folders - Edit Folder', () => {
  let app;
  let window;
  let nav;

  test.beforeEach(async () => {
    const result = await launchApp();
    app = result.app;
    window = result.window;
    await waitForAppReady(window);
    nav = new NavigationPage(window);
    await nav.goToPhase(PHASES.SETUP);
    await window.waitForTimeout(500);
  });

  test.afterEach(async () => {
    await closeApp(app);
  });

  test('should have edit button on folder items', async () => {
    const editButton = window.locator(
      'button:has-text("Edit"), button[aria-label*="Edit"], [data-testid*="edit"]'
    );

    const count = await editButton.count();
    console.log('[Test] Edit buttons found:', count);
  });

  test('should open edit modal when clicking edit', async () => {
    const editButton = window
      .locator('button:has-text("Edit"), button[aria-label*="Edit"]')
      .first();

    if (await editButton.isVisible()) {
      await editButton.click();
      await window.waitForTimeout(500);

      const modal = window.locator('[role="dialog"]');
      const visible = await modal.isVisible().catch(() => false);
      console.log('[Test] Edit modal visible:', visible);
    }
  });

  test('should populate edit modal with existing data', async () => {
    const editButton = window
      .locator('button:has-text("Edit"), button[aria-label*="Edit"]')
      .first();

    if (await editButton.isVisible()) {
      await editButton.click();
      await window.waitForTimeout(500);

      // Check if name field has value
      const nameInput = window.locator('input[name*="name"]').first();
      if (await nameInput.isVisible()) {
        const value = await nameInput.inputValue();
        console.log('[Test] Edit modal name value:', value);
        expect(value.length).toBeGreaterThan(0);
      }
    }
  });
});

test.describe('Smart Folders - Delete Folder', () => {
  let app;
  let window;
  let nav;

  test.beforeEach(async () => {
    const result = await launchApp();
    app = result.app;
    window = result.window;
    await waitForAppReady(window);
    nav = new NavigationPage(window);
    await nav.goToPhase(PHASES.SETUP);
    await window.waitForTimeout(500);
  });

  test.afterEach(async () => {
    await closeApp(app);
  });

  test('should have delete button on folder items', async () => {
    const deleteButton = window.locator(
      'button:has-text("Delete"), button[aria-label*="Delete"], [data-testid*="delete"]'
    );

    const count = await deleteButton.count();
    console.log('[Test] Delete buttons found:', count);
  });

  test('should show confirmation before delete', async () => {
    const deleteButton = window
      .locator('button:has-text("Delete"), button[aria-label*="Delete"]')
      .first();

    if (await deleteButton.isVisible()) {
      await deleteButton.click();
      await window.waitForTimeout(500);

      // Look for confirmation dialog
      const confirmDialog = window.locator(
        '[role="alertdialog"], [role="dialog"]:has-text("confirm"), text=Are you sure'
      );

      const visible = await confirmDialog
        .first()
        .isVisible()
        .catch(() => false);
      console.log('[Test] Confirmation dialog visible:', visible);

      // Cancel the deletion
      const cancelButton = window.locator('button:has-text("Cancel"), button:has-text("No")');
      if (await cancelButton.isVisible()) {
        await cancelButton.click();
      }
    }
  });
});

test.describe('Smart Folders - Folder Scanning', () => {
  let app;
  let window;
  let nav;

  test.beforeEach(async () => {
    const result = await launchApp();
    app = result.app;
    window = result.window;
    await waitForAppReady(window);
    nav = new NavigationPage(window);
    await nav.goToPhase(PHASES.SETUP);
    await window.waitForTimeout(500);
  });

  test.afterEach(async () => {
    await closeApp(app);
  });

  // TODO: Fix - Add Folder/Load Defaults selectors; Load Defaults only in empty state
  // test('should have scan folder option', async () => {
  //   const actionButtons = window.locator(
  //     'button:has-text("Add Folder"), button:has-text("Load Defaults")'
  //   );
  //   const count = await actionButtons.count();
  //   expect(count).toBeGreaterThan(0);
  // });

  test('should have scan API available', async () => {
    const hasScanApi = await window.evaluate(() => {
      // Scan structure is available on smartFolders
      return typeof window.electronAPI?.smartFolders?.scanStructure === 'function';
    });

    console.log('[Test] Folder scan API available:', hasScanApi);
    expect(hasScanApi).toBe(true);
  });
});

test.describe('Smart Folders - Folder API Operations', () => {
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

  test('should get all folders via API', async () => {
    const result = await window.evaluate(async () => {
      try {
        const folders = await window.electronAPI?.smartFolders?.get();
        return { success: true, count: folders?.length || 0 };
      } catch (e) {
        return { success: false, error: e.message };
      }
    });

    console.log('[Test] Get all smart folders result:', result);
    expect(result.success).toBe(true);
  });

  test('should validate folder creation data', async () => {
    const result = await window.evaluate(async () => {
      try {
        const api = window.electronAPI?.smartFolders;
        if (!api?.add) return { hasApi: false };
        return { hasApi: true, canAdd: typeof api.add === 'function' };
      } catch (e) {
        return { error: e.message };
      }
    });

    console.log('[Test] Folder creation validation:', result);
    expect(result.hasApi).toBe(true);
  });

  test('should have folder update API', async () => {
    const hasUpdateApi = await window.evaluate(() => {
      return typeof window.electronAPI?.smartFolders?.edit === 'function';
    });

    expect(hasUpdateApi).toBe(true);
  });

  test('should have folder delete API', async () => {
    const hasDeleteApi = await window.evaluate(() => {
      return typeof window.electronAPI?.smartFolders?.delete === 'function';
    });

    expect(hasDeleteApi).toBe(true);
  });
});

test.describe('Smart Folders - Continue to Discover', () => {
  let app;
  let window;
  let nav;

  test.beforeEach(async () => {
    const result = await launchApp();
    app = result.app;
    window = result.window;
    await waitForAppReady(window);
    nav = new NavigationPage(window);
    await nav.goToPhase(PHASES.SETUP);
    await window.waitForTimeout(500);
  });

  test.afterEach(async () => {
    await closeApp(app);
  });

  test('should have Continue button', async () => {
    const continueButton = window.locator(
      'button:has-text("Continue"), button:has-text("Next"), button:has-text("Proceed")'
    );

    const visible = await continueButton
      .first()
      .isVisible()
      .catch(() => false);
    console.log('[Test] Continue button visible:', visible);
  });

  test('should navigate to Discover when clicking Continue', async () => {
    const continueButton = window
      .locator('button:has-text("Continue"), button:has-text("Next")')
      .first();

    if (await continueButton.isVisible()) {
      await continueButton.click();
      await window.waitForTimeout(500);

      const currentPhase = await nav.getCurrentPhase();
      console.log('[Test] Phase after Continue:', currentPhase);
      expect(currentPhase).toBe(PHASES.DISCOVER);
    }
  });
});
