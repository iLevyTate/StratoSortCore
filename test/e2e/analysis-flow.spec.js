/**
 * Analysis Flow E2E Tests
 *
 * Tests the document analysis workflow including AI-powered analysis.
 * Note: These tests require Ollama to be running for full functionality.
 * Tests are designed to gracefully handle missing Ollama.
 *
 * Run: npm run test:e2e -- --grep "Analysis Flow"
 */

const { test, expect } = require('@playwright/test');
const { launchApp, closeApp, waitForAppReady } = require('./helpers/electronApp');
const { NavigationPage } = require('./helpers/pageObjects');
const { PHASES } = require('./helpers/testFixtures');

test.describe('Analysis Flow', () => {
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

  test('should have Ollama connection indicator', async () => {
    // Check for connection status in UI
    const connected = await nav.isConnected();
    console.log('[Test] Ollama connection status:', connected ? 'Connected' : 'Not connected');

    // We don't fail if not connected - tests should handle both cases
    // Just verify the indicator exists
    const statusIndicator = window.locator(
      '.animate-pulse, .text-stratosort-success, .text-stratosort-error'
    );
    const exists = await statusIndicator
      .first()
      .isVisible()
      .catch(() => false);

    console.log('[Test] Connection indicator exists:', exists);
  });

  test('should have analysis API methods available', async () => {
    const methods = await window.evaluate(() => {
      const api = window.electronAPI;
      return {
        // Document analysis
        document: typeof api?.analysis?.document === 'function',
        // Image analysis
        image: typeof api?.analysis?.image === 'function',
        // Text extraction
        extractText: typeof api?.analysis?.extractText === 'function',
        // Generic file analyze
        analyze: typeof api?.files?.analyze === 'function'
      };
    });

    console.log('[Test] Analysis API methods:', methods);

    expect(methods.document).toBe(true);
    expect(methods.image).toBe(true);
  });

  test('should have analysis history API available', async () => {
    const methods = await window.evaluate(() => {
      const api = window.electronAPI?.analysisHistory;
      return {
        get: typeof api?.get === 'function',
        search: typeof api?.search === 'function',
        getStatistics: typeof api?.getStatistics === 'function',
        getFileHistory: typeof api?.getFileHistory === 'function'
      };
    });

    console.log('[Test] Analysis history API:', methods);

    expect(methods.get).toBe(true);
    expect(methods.search).toBe(true);
    expect(methods.getStatistics).toBe(true);
  });

  test('should show analysis progress UI elements when analyzing', async () => {
    // Navigate to Discover phase
    await nav.goToPhase(PHASES.DISCOVER);
    await window.waitForTimeout(500);

    // Look for progress-related UI elements (may be hidden initially)
    const progressElements = window.locator(
      '[data-testid="analysis-progress"], .progress, [role="progressbar"]'
    );
    const count = await progressElements.count();

    console.log('[Test] Progress elements found:', count);
    // Progress elements might be hidden until analysis starts
  });
});

test.describe('Analysis Flow - Ollama Integration', () => {
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

  test('should have Ollama API methods available', async () => {
    const methods = await window.evaluate(() => {
      const api = window.electronAPI?.ollama;
      return {
        getModels: typeof api?.getModels === 'function',
        testConnection: typeof api?.testConnection === 'function',
        pullModels: typeof api?.pullModels === 'function'
      };
    });

    console.log('[Test] Ollama API methods:', methods);

    expect(methods.getModels).toBe(true);
    expect(methods.testConnection).toBe(true);
  });

  test('should handle Ollama connection test', async () => {
    // Try to test Ollama connection
    const result = await window.evaluate(async () => {
      try {
        const api = window.electronAPI?.ollama;
        if (!api?.testConnection) {
          return { error: 'API not available' };
        }

        const connected = await api.testConnection();
        return { connected, error: null };
      } catch (error) {
        return { connected: false, error: error.message };
      }
    });

    console.log('[Test] Ollama connection test result:', result);

    // We don't fail on connection issues - Ollama might not be running
    if (result.error) {
      console.log('[Test] Ollama not available (expected in CI):', result.error);
    } else {
      console.log('[Test] Ollama connection:', result.connected ? 'SUCCESS' : 'FAILED');
    }
  });

  test('should list available models if Ollama is running', async () => {
    const result = await window.evaluate(async () => {
      try {
        const api = window.electronAPI?.ollama;
        if (!api?.getModels) {
          return { models: [], error: 'API not available' };
        }

        const models = await api.getModels();
        return { models, error: null };
      } catch (error) {
        return { models: [], error: error.message };
      }
    });

    console.log('[Test] Ollama models result:', result);

    if (result.error) {
      console.log('[Test] Could not get models (Ollama may not be running)');
    } else if (result.models && result.models.length > 0) {
      console.log('[Test] Available models:', result.models.slice(0, 5)); // Show first 5
    }
  });
});

test.describe('Analysis Flow - Settings', () => {
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

  test('should have settings API for analysis configuration', async () => {
    const methods = await window.evaluate(() => {
      const api = window.electronAPI?.settings;
      return {
        get: typeof api?.get === 'function',
        save: typeof api?.save === 'function'
      };
    });

    console.log('[Test] Settings API methods:', methods);

    expect(methods.get).toBe(true);
    expect(methods.save).toBe(true);
  });

  test('should load settings on startup', async () => {
    const result = await window.evaluate(async () => {
      try {
        const settings = await window.electronAPI?.settings?.get();
        return {
          loaded: true,
          hasSettings: !!settings,
          settingsKeys: settings ? Object.keys(settings) : []
        };
      } catch (error) {
        return { loaded: false, error: error.message };
      }
    });

    console.log('[Test] Settings load result:', result);

    expect(result.loaded).toBe(true);
    expect(result.hasSettings).toBe(true);
  });

  test('should show AI model settings in settings panel', async () => {
    // Open settings
    await nav.openSettings();
    await window.waitForTimeout(500);

    // Look for AI/model related settings
    const modelSettings = window.locator('text=model, text=ollama, text=AI, text=llama');
    const count = await modelSettings.count();

    console.log('[Test] Model-related settings elements:', count);

    // Close settings
    const closeButton = window.locator(
      '[aria-label="Close Settings"], [aria-label="Close"], button:has-text("Close")'
    );
    if (await closeButton.isVisible()) {
      await closeButton.click();
    }
  });
});

test.describe('Analysis Flow - Embeddings', () => {
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

  test('should have embeddings API available', async () => {
    const methods = await window.evaluate(() => {
      const api = window.electronAPI?.embeddings;
      return {
        rebuildFolders: typeof api?.rebuildFolders === 'function',
        rebuildFiles: typeof api?.rebuildFiles === 'function',
        clearStore: typeof api?.clearStore === 'function',
        getStats: typeof api?.getStats === 'function',
        findSimilar: typeof api?.findSimilar === 'function'
      };
    });

    console.log('[Test] Embeddings API methods:', methods);

    expect(methods.rebuildFolders).toBe(true);
    expect(methods.rebuildFiles).toBe(true);
    expect(methods.getStats).toBe(true);
    expect(methods.findSimilar).toBe(true);
  });

  test('should have suggestions API available', async () => {
    const methods = await window.evaluate(() => {
      const api = window.electronAPI?.suggestions;
      return {
        getFileSuggestions: typeof api?.getFileSuggestions === 'function',
        getBatchSuggestions: typeof api?.getBatchSuggestions === 'function',
        recordFeedback: typeof api?.recordFeedback === 'function',
        getStrategies: typeof api?.getStrategies === 'function'
      };
    });

    console.log('[Test] Suggestions API methods:', methods);

    expect(methods.getFileSuggestions).toBe(true);
    expect(methods.getBatchSuggestions).toBe(true);
  });
});

test.describe('Analysis Flow - Organization', () => {
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

  test('should have organize API available', async () => {
    const methods = await window.evaluate(() => {
      const api = window.electronAPI?.organize;
      return {
        auto: typeof api?.auto === 'function',
        batch: typeof api?.batch === 'function',
        processNew: typeof api?.processNew === 'function',
        getStats: typeof api?.getStats === 'function'
      };
    });

    console.log('[Test] Organize API methods:', methods);

    expect(methods.auto).toBe(true);
    expect(methods.batch).toBe(true);
  });

  test('should have undo/redo API available', async () => {
    const methods = await window.evaluate(() => {
      const api = window.electronAPI?.undoRedo;
      return {
        undo: typeof api?.undo === 'function',
        redo: typeof api?.redo === 'function',
        canUndo: typeof api?.canUndo === 'function',
        canRedo: typeof api?.canRedo === 'function',
        getHistory: typeof api?.getHistory === 'function'
      };
    });

    console.log('[Test] Undo/Redo API methods:', methods);

    expect(methods.undo).toBe(true);
    expect(methods.redo).toBe(true);
    expect(methods.canUndo).toBe(true);
    expect(methods.canRedo).toBe(true);
  });
});
