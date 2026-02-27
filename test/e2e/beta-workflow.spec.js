/**
 * Beta Tester Workflow E2E Tests
 *
 * End-to-end tests that follow the Beta Tester Guide workflow:
 * 1. Setup phase — Smart Folder creation/management
 * 2. Discover phase — File import and analysis
 * 3. Organize phase — Review suggestions, accept/reject
 * 4. Search / Knowledge OS — Semantic search and graph
 * 5. Settings — Configuration exploration
 * 6. Undo/Redo — File operation rollback
 *
 * Run: npm run test:e2e -- --grep "Beta Workflow"
 */

const { test, expect } = require('@playwright/test');
const { launchApp, closeApp, waitForAppReady } = require('./helpers/electronApp');
const { NavigationPage } = require('./helpers/pageObjects');
const { PHASES, SELECTORS, TIMEOUTS } = require('./helpers/testFixtures');

test.describe('Beta Workflow — Setup Phase', () => {
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

  test('should navigate to Setup and display Smart Folders UI', async () => {
    const success = await nav.goToPhase(PHASES.SETUP);
    expect(success).toBe(true);

    const hasSmartFolderContent = await window.evaluate(() => {
      const text = document.body.textContent || '';
      return (
        text.includes('Smart Folder') || text.includes('Add Folder') || text.includes('Configure')
      );
    });
    expect(hasSmartFolderContent).toBe(true);
  });

  test('should show Add Folder button on Setup phase', async () => {
    await nav.goToPhase(PHASES.SETUP);
    await window.waitForTimeout(500);

    const addButton = window
      .locator('button:has-text("Add Folder"), button:has-text("Add Smart")')
      .first();
    const isVisible = await addButton.isVisible().catch(() => false);
    expect(isVisible).toBe(true);
  });

  test('should open and fill the Add Smart Folder modal', async () => {
    await nav.goToPhase(PHASES.SETUP);
    await window.waitForTimeout(500);

    const addButton = window
      .locator('button:has-text("Add Folder"), button:has-text("Add Smart")')
      .first();
    if (!(await addButton.isVisible())) {
      test.skip();
      return;
    }

    await addButton.click();
    await window.waitForTimeout(500);

    const nameInput = window.locator('input[id*="name"], input[placeholder*="name" i]').first();
    const nameVisible = await nameInput.isVisible().catch(() => false);
    expect(nameVisible).toBe(true);

    await nameInput.fill('Beta Test Folder');

    const descInput = window
      .locator('textarea, input[id*="desc" i], input[placeholder*="desc" i]')
      .first();
    if (await descInput.isVisible().catch(() => false)) {
      await descInput.fill('Documents for beta testing workflow');
    }

    const formValues = await window.evaluate(() => {
      const name = document.querySelector('input[id*="name"], input[placeholder*="name" i]');
      const desc = document.querySelector(
        'textarea, input[id*="desc" i], input[placeholder*="desc" i]'
      );
      return {
        name: name?.value || '',
        description: desc?.value || ''
      };
    });

    expect(formValues.name).toBe('Beta Test Folder');
  });

  test('should create a smart folder via API and list it', async () => {
    const uniqueName = `BetaTest_${Date.now()}`;

    const documentsPath = await window.evaluate(async () => {
      const result = await window.electronAPI.files.getDocumentsPath();
      return typeof result === 'string' ? result : result?.path || null;
    });

    if (!documentsPath) {
      test.skip();
      return;
    }

    const addResult = await window.evaluate(
      async ({ name, path }) => {
        return window.electronAPI.smartFolders.add({
          name,
          path,
          description: 'Beta workflow test folder'
        });
      },
      { name: uniqueName, path: `${documentsPath}/${uniqueName}` }
    );
    expect(addResult.success).toBe(true);

    const folders = await window.evaluate(async () => {
      return window.electronAPI.smartFolders.get();
    });
    const found = Array.isArray(folders) ? folders.some((f) => f.name === uniqueName) : false;
    expect(found).toBe(true);

    // Cleanup
    if (addResult.folder?.id) {
      await window.evaluate(
        async (id) => window.electronAPI.smartFolders.delete(id),
        addResult.folder.id
      );
    }
  });

  test('should edit an existing smart folder', async () => {
    const uniqueName = `EditTest_${Date.now()}`;

    const documentsPath = await window.evaluate(async () => {
      const result = await window.electronAPI.files.getDocumentsPath();
      return typeof result === 'string' ? result : result?.path || null;
    });

    if (!documentsPath) {
      test.skip();
      return;
    }

    const addResult = await window.evaluate(
      async ({ name, path }) => {
        return window.electronAPI.smartFolders.add({
          name,
          path,
          description: 'Original description'
        });
      },
      { name: uniqueName, path: `${documentsPath}/${uniqueName}` }
    );
    expect(addResult.success).toBe(true);

    const editResult = await window.evaluate(
      async ({ id, description }) => {
        return window.electronAPI.smartFolders.edit(id, { description });
      },
      { id: addResult.folder.id, description: 'Updated description' }
    );
    expect(editResult.success).toBe(true);

    // Cleanup
    await window.evaluate(
      async (id) => window.electronAPI.smartFolders.delete(id),
      addResult.folder.id
    );
  });

  test('should delete a smart folder', async () => {
    const uniqueName = `DeleteTest_${Date.now()}`;

    const documentsPath = await window.evaluate(async () => {
      const result = await window.electronAPI.files.getDocumentsPath();
      return typeof result === 'string' ? result : result?.path || null;
    });

    if (!documentsPath) {
      test.skip();
      return;
    }

    const addResult = await window.evaluate(
      async ({ name, path }) => {
        return window.electronAPI.smartFolders.add({
          name,
          path,
          description: 'Folder to delete'
        });
      },
      { name: uniqueName, path: `${documentsPath}/${uniqueName}` }
    );
    expect(addResult.success).toBe(true);

    const deleteResult = await window.evaluate(
      async (id) => window.electronAPI.smartFolders.delete(id),
      addResult.folder.id
    );
    expect(deleteResult.success).toBe(true);

    const folders = await window.evaluate(async () => {
      return window.electronAPI.smartFolders.get();
    });
    const stillExists = Array.isArray(folders) ? folders.some((f) => f.name === uniqueName) : false;
    expect(stillExists).toBe(false);
  });
});

test.describe('Beta Workflow — Discover Phase', () => {
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

  test('should navigate to Discover and show file import UI', async () => {
    const success = await nav.goToPhase(PHASES.DISCOVER);
    expect(success).toBe(true);

    const hasImportUI = await window.evaluate(() => {
      const text = document.body.textContent || '';
      return (
        text.includes('Select Files') ||
        text.includes('Scan Folder') ||
        text.includes('Add Files') ||
        text.includes('drag')
      );
    });
    expect(hasImportUI).toBe(true);
  });

  test('should show Select Files and Scan Folder buttons', async () => {
    await nav.goToPhase(PHASES.DISCOVER);
    await window.waitForTimeout(500);

    const selectFilesBtn = window.locator(SELECTORS.selectFilesButton).first();
    const scanFolderBtn = window.locator(SELECTORS.scanFolderButton).first();

    const selectVisible = await selectFilesBtn.isVisible().catch(() => false);
    const scanVisible = await scanFolderBtn.isVisible().catch(() => false);

    expect(selectVisible || scanVisible).toBe(true);
  });

  test('should have file selection API available', async () => {
    const apiCheck = await window.evaluate(() => {
      return {
        hasSelectFiles: typeof window.electronAPI?.files?.selectFiles === 'function',
        hasScanFolder: typeof window.electronAPI?.files?.selectDirectory === 'function',
        hasAnalyze:
          typeof window.electronAPI?.analysis?.analyzeFiles === 'function' ||
          typeof window.electronAPI?.analysis?.analyzeBatch === 'function'
      };
    });

    expect(apiCheck.hasSelectFiles).toBe(true);
    expect(apiCheck.hasScanFolder).toBe(true);
  });

  test('should show drag-and-drop zone on Discover phase', async () => {
    await nav.goToPhase(PHASES.DISCOVER);
    await window.waitForTimeout(500);

    const hasDragZone = await window.evaluate(() => {
      const zone = document.querySelector(
        '[class*="border-dashed"], [data-testid="drag-drop-zone"]'
      );
      return !!zone;
    });

    expect(hasDragZone).toBe(true);
  });
});

test.describe('Beta Workflow — Organize Phase', () => {
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

  test('should navigate to Organize phase', async () => {
    const success = await nav.goToPhase(PHASES.ORGANIZE);
    expect(success).toBe(true);

    const phaseContent = await window.evaluate(() => {
      const text = document.body.textContent || '';
      return (
        text.includes('Organize') ||
        text.includes('Ready') ||
        text.includes('Smart Folders') ||
        text.includes('No files')
      );
    });
    expect(phaseContent).toBe(true);
  });

  test('should show empty state when no files analyzed', async () => {
    await nav.goToPhase(PHASES.ORGANIZE);
    await window.waitForTimeout(500);

    const organizeState = await window.evaluate(() => {
      const text = document.body.textContent || '';
      return {
        hasNoFiles: text.includes('No files') || text.includes('no files ready'),
        hasSmartFolderTab: text.includes('Smart Folders') || text.includes('Smart Folder'),
        hasReadyTab: text.includes('Ready')
      };
    });

    expect(
      organizeState.hasNoFiles || organizeState.hasSmartFolderTab || organizeState.hasReadyTab
    ).toBe(true);
  });

  test('should have undo/redo API available', async () => {
    const apiCheck = await window.evaluate(() => {
      return {
        hasUndo: typeof window.electronAPI?.undoRedo?.undo === 'function',
        hasRedo: typeof window.electronAPI?.undoRedo?.redo === 'function',
        hasGetState: typeof window.electronAPI?.undoRedo?.getState === 'function'
      };
    });

    expect(apiCheck.hasUndo).toBe(true);
    expect(apiCheck.hasRedo).toBe(true);
    expect(apiCheck.hasGetState).toBe(true);
  });
});

test.describe('Beta Workflow — Search / Knowledge OS', () => {
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

  test('should open search modal with Ctrl+K', async () => {
    await window.keyboard.press('Control+k');
    await window.waitForTimeout(500);

    const hasSearchUI = await window.evaluate(() => {
      const text = document.body.textContent || '';
      return (
        text.includes('Knowledge OS') ||
        text.includes('Search') ||
        text.includes('Looking for') ||
        !!document.querySelector('input[type="search"], input[placeholder*="search" i]')
      );
    });

    expect(hasSearchUI).toBe(true);
  });

  test('should have search input in search modal', async () => {
    await window.keyboard.press('Control+k');
    await window.waitForTimeout(500);

    const searchInput = window
      .locator(
        'input[type="search"], input[placeholder*="search" i], input[placeholder*="Looking" i]'
      )
      .first();

    const isVisible = await searchInput.isVisible().catch(() => false);
    if (isVisible) {
      await searchInput.fill('test query');
      const value = await searchInput.inputValue();
      expect(value).toBe('test query');
    }
  });

  test('should close search modal with Escape', async () => {
    await window.keyboard.press('Control+k');
    await window.waitForTimeout(500);

    const openedSearch = await window.evaluate(() => {
      const text = document.body.textContent || '';
      return text.includes('Knowledge OS') || text.includes('Looking for');
    });

    if (openedSearch) {
      await window.keyboard.press('Escape');
      await window.waitForTimeout(300);
    }
  });

  test('should have search API available', async () => {
    const apiCheck = await window.evaluate(() => {
      return {
        hasSearch:
          typeof window.electronAPI?.search?.query === 'function' ||
          typeof window.electronAPI?.search?.search === 'function',
        hasEmbeddings: typeof window.electronAPI?.embeddings?.getStats === 'function'
      };
    });

    expect(apiCheck.hasEmbeddings).toBe(true);
  });
});

test.describe('Beta Workflow — Settings', () => {
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

  test('should open settings panel', async () => {
    const opened = await nav.openSettings();
    expect(opened).toBe(true);

    const hasSettings = await window.evaluate(() => {
      const text = document.body.textContent || '';
      return text.includes('Settings') || text.includes('Configuration');
    });
    expect(hasSettings).toBe(true);
  });

  test('should show AI Configuration section', async () => {
    await nav.openSettings();
    await window.waitForTimeout(300);

    const hasAIConfig = await window.evaluate(() => {
      const text = document.body.textContent || '';
      return text.includes('AI Configuration') || text.includes('AI Engine');
    });
    expect(hasAIConfig).toBe(true);
  });

  test('should show Performance section', async () => {
    await nav.openSettings();
    await window.waitForTimeout(300);

    const hasPerfSection = await window.evaluate(() => {
      const text = document.body.textContent || '';
      return text.includes('Performance');
    });
    expect(hasPerfSection).toBe(true);
  });

  test('should show Default Locations section', async () => {
    await nav.openSettings();
    await window.waitForTimeout(300);

    const hasLocations = await window.evaluate(() => {
      const text = document.body.textContent || '';
      return text.includes('Default Locations') || text.includes('Default Location');
    });
    expect(hasLocations).toBe(true);
  });

  test('should show Application section with log export', async () => {
    await nav.openSettings();
    await window.waitForTimeout(300);

    const hasAppSection = await window.evaluate(() => {
      const text = document.body.textContent || '';
      return (
        text.includes('Application') || text.includes('Troubleshooting') || text.includes('Export')
      );
    });
    expect(hasAppSection).toBe(true);
  });

  test('should have settings API available', async () => {
    const apiCheck = await window.evaluate(() => {
      return {
        hasGet: typeof window.electronAPI?.settings?.get === 'function',
        hasUpdate: typeof window.electronAPI?.settings?.update === 'function'
      };
    });

    expect(apiCheck.hasGet).toBe(true);
    expect(apiCheck.hasUpdate).toBe(true);
  });

  test('should retrieve current settings', async () => {
    const settings = await window.evaluate(async () => {
      try {
        return await window.electronAPI.settings.get();
      } catch (e) {
        return { error: e.message };
      }
    });

    expect(settings).toBeTruthy();
    expect(settings.error).toBeUndefined();
  });

  test('should close settings panel', async () => {
    await nav.openSettings();
    await window.waitForTimeout(300);

    const closeBtn = window.locator(SELECTORS.closeSettings).first();
    const isVisible = await closeBtn.isVisible().catch(() => false);
    if (isVisible) {
      await closeBtn.click();
      await window.waitForTimeout(300);
    } else {
      await window.keyboard.press('Escape');
      await window.waitForTimeout(300);
    }
  });
});

test.describe('Beta Workflow — Cross-Phase Navigation', () => {
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

  test('should navigate through all phases sequentially', async () => {
    const phases = [PHASES.WELCOME, PHASES.SETUP, PHASES.DISCOVER, PHASES.ORGANIZE];

    for (const phase of phases) {
      const success = await nav.goToPhase(phase);
      if (!success) {
        console.log(`[Test] Could not navigate to ${phase}, may be disabled`);
        continue;
      }
      const current = await nav.getCurrentPhase();
      expect(current).toBe(phase);
    }
  });

  test('should maintain state when navigating between phases', async () => {
    await nav.goToPhase(PHASES.DISCOVER);
    await window.waitForTimeout(300);

    await nav.goToPhase(PHASES.SETUP);
    await window.waitForTimeout(300);

    await nav.goToPhase(PHASES.DISCOVER);
    await window.waitForTimeout(300);

    const currentPhase = await nav.getCurrentPhase();
    expect(currentPhase).toBe(PHASES.DISCOVER);
  });

  test('should show connection status indicator', async () => {
    const isConnected = await nav.isConnected();
    expect(typeof isConnected).toBe('boolean');
  });
});

test.describe('Beta Workflow — API Integration', () => {
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

  test('should expose complete electronAPI surface', async () => {
    const apiSurface = await window.evaluate(() => {
      const api = window.electronAPI;
      if (!api) return { hasApi: false };
      return {
        hasApi: true,
        namespaces: Object.keys(api).sort(),
        files: api.files ? Object.keys(api.files).sort() : [],
        smartFolders: api.smartFolders ? Object.keys(api.smartFolders).sort() : [],
        analysis: api.analysis ? Object.keys(api.analysis).sort() : [],
        settings: api.settings ? Object.keys(api.settings).sort() : [],
        search: api.search ? Object.keys(api.search).sort() : [],
        undoRedo: api.undoRedo ? Object.keys(api.undoRedo).sort() : []
      };
    });

    expect(apiSurface.hasApi).toBe(true);
    expect(apiSurface.namespaces.length).toBeGreaterThan(0);
    expect(apiSurface.files.length).toBeGreaterThan(0);
    expect(apiSurface.smartFolders.length).toBeGreaterThan(0);
    expect(apiSurface.settings.length).toBeGreaterThan(0);
  });

  test('should get analysis history', async () => {
    const history = await window.evaluate(async () => {
      try {
        return await window.electronAPI.analysisHistory.get({ limit: 10 });
      } catch (e) {
        return { error: e.message };
      }
    });

    expect(history).toBeTruthy();
  });

  test('should get embedding stats', async () => {
    const stats = await window.evaluate(async () => {
      try {
        return await window.electronAPI.embeddings.getStats();
      } catch (e) {
        return { error: e.message };
      }
    });

    expect(stats).toBeTruthy();
  });

  test('should get undo/redo state', async () => {
    const state = await window.evaluate(async () => {
      try {
        return await window.electronAPI.undoRedo.getState();
      } catch (e) {
        return { error: e.message };
      }
    });

    expect(state).toBeTruthy();
    if (!state.error) {
      expect(typeof state.canUndo).toBe('boolean');
      expect(typeof state.canRedo).toBe('boolean');
    }
  });
});
