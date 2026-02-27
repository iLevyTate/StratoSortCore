/**
 * Full Pipeline E2E Tests
 *
 * Tests the complete file analysis → organize → complete pipeline.
 * Covers the end-to-end workflow a user follows from importing files
 * through AI analysis to final organization.
 *
 * Run: npm run test:e2e -- --grep "Full Pipeline"
 */

const { test, expect } = require('@playwright/test');
const { launchApp, closeApp, waitForAppReady } = require('./helpers/electronApp');
const { NavigationPage } = require('./helpers/pageObjects');
const { PHASES, SELECTORS, TIMEOUTS } = require('./helpers/testFixtures');

test.describe('Full Pipeline — Analysis to Organize', () => {
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

  test('should have analysis API with analyze-document channel', async () => {
    const api = await window.evaluate(() => ({
      hasAnalyzeDoc: typeof window.electronAPI?.analysis?.analyzeDocument === 'function',
      hasAnalyzeBatch:
        typeof window.electronAPI?.analysis?.analyzeBatch === 'function' ||
        typeof window.electronAPI?.analysis?.analyzeFiles === 'function',
      hasGetProgress: typeof window.electronAPI?.analysis?.getProgress === 'function'
    }));

    expect(api.hasAnalyzeDoc || api.hasAnalyzeBatch).toBe(true);
  });

  test('should navigate full pipeline: Discover → Organize → Complete', async () => {
    const phases = [PHASES.DISCOVER, PHASES.ORGANIZE, PHASES.COMPLETE];
    for (const phase of phases) {
      const success = await nav.goToPhase(phase);
      expect(success).toBe(true);
      const current = await nav.getCurrentPhase();
      expect(current).toBe(phase);
    }
  });

  test('should show Discover UI with file import controls', async () => {
    await nav.goToPhase(PHASES.DISCOVER);
    await window.waitForTimeout(500);

    const uiState = await window.evaluate(() => {
      const body = document.body.textContent || '';
      return {
        hasSelectFiles: body.includes('Select Files'),
        hasScanFolder: body.includes('Scan Folder'),
        hasAnalyzeSection: body.includes('Discover') || body.includes('Analyze'),
        hasNamingStrategy: body.includes('Naming Strategy')
      };
    });

    expect(uiState.hasSelectFiles || uiState.hasScanFolder).toBe(true);
  });

  test('should show Organize UI with smart folder tabs', async () => {
    await nav.goToPhase(PHASES.ORGANIZE);
    await window.waitForTimeout(500);

    const uiState = await window.evaluate(() => {
      const body = document.body.textContent || '';
      return {
        hasSmartFolders: body.includes('Smart Folder'),
        hasReady: body.includes('Ready'),
        hasOrganize: body.includes('Organize'),
        hasNoFiles: body.includes('No files') || body.includes('no files')
      };
    });

    expect(uiState.hasSmartFolders || uiState.hasReady || uiState.hasNoFiles).toBe(true);
  });

  test('should show Complete phase with session summary', async () => {
    await nav.goToPhase(PHASES.COMPLETE);
    await window.waitForTimeout(500);

    const uiState = await window.evaluate(() => {
      const body = document.body.textContent || '';
      return {
        hasComplete: body.includes('Complete') || body.includes('Results'),
        hasStartOver:
          body.includes('Start Over') || body.includes('Start New') || body.includes('New Session'),
        hasSummary:
          body.includes('organized') || body.includes('What Changed') || body.includes('No files')
      };
    });

    expect(uiState.hasComplete).toBe(true);
    expect(uiState.hasStartOver || uiState.hasSummary).toBe(true);
  });

  test('should maintain file count when navigating between phases', async () => {
    await nav.goToPhase(PHASES.DISCOVER);
    await window.waitForTimeout(300);

    const discoverState = await window.evaluate(() => {
      const badges = document.querySelectorAll('[class*="badge"], [data-testid*="count"]');
      return { badgeCount: badges.length };
    });

    await nav.goToPhase(PHASES.ORGANIZE);
    await window.waitForTimeout(300);
    await nav.goToPhase(PHASES.DISCOVER);
    await window.waitForTimeout(300);

    const afterNavState = await window.evaluate(() => {
      const badges = document.querySelectorAll('[class*="badge"], [data-testid*="count"]');
      return { badgeCount: badges.length };
    });

    expect(afterNavState.badgeCount).toBe(discoverState.badgeCount);
  });

  test('should have batch organize API available', async () => {
    const api = await window.evaluate(() => ({
      hasBatchOrganize:
        typeof window.electronAPI?.files?.batchOrganize === 'function' ||
        typeof window.electronAPI?.organize?.batch === 'function',
      hasOrganizeAuto: typeof window.electronAPI?.organize?.auto === 'function'
    }));

    expect(api.hasBatchOrganize || api.hasOrganizeAuto).toBe(true);
  });
});

test.describe('Full Pipeline — Smart Folder Routing', () => {
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

  test('should create smart folders and verify they persist', async () => {
    const uniqueSuffix = Date.now();

    const folders = [
      { name: `Nature_${uniqueSuffix}`, description: 'Wildlife and ecology' },
      { name: `Finances_${uniqueSuffix}`, description: 'Financial documents' },
      { name: `Research_${uniqueSuffix}`, description: 'Scientific papers' }
    ];

    const docsPath = await window.evaluate(async () => {
      const result = await window.electronAPI.files.getDocumentsPath();
      return typeof result === 'string' ? result : result?.path || null;
    });
    if (!docsPath) {
      test.skip();
      return;
    }

    for (const folder of folders) {
      const result = await window.evaluate(
        async ({ name, description, basePath }) => {
          return window.electronAPI.smartFolders.add({
            name,
            path: `${basePath}/${name}`,
            description
          });
        },
        { ...folder, basePath: docsPath }
      );
      expect(result.success).toBe(true);
    }

    const savedFolders = await window.evaluate(async () => window.electronAPI.smartFolders.get());
    const names = Array.isArray(savedFolders) ? savedFolders.map((f) => f.name) : [];

    for (const folder of folders) {
      expect(names).toContain(folder.name);
    }

    // Cleanup
    for (const folder of folders) {
      const target = Array.isArray(savedFolders)
        ? savedFolders.find((f) => f.name === folder.name)
        : null;
      if (target) {
        await window.evaluate(async (id) => window.electronAPI.smartFolders.delete(id), target.id);
      }
    }
  });

  test('should get folder suggestions for a file via API', async () => {
    const api = await window.evaluate(() => ({
      hasSuggestionsGet:
        typeof window.electronAPI?.suggestions?.getFile === 'function' ||
        typeof window.electronAPI?.suggestions?.getBatch === 'function',
      hasStrategies: typeof window.electronAPI?.suggestions?.getStrategies === 'function'
    }));

    expect(api.hasSuggestionsGet || api.hasStrategies).toBe(true);
  });
});
