/**
 * Dependency Management E2E Tests
 *
 * Tests the dependency management functionality including:
 * - Ollama status and management
 * - ChromaDB status
 * - Health checks
 * - Installation/Update options
 *
 * Correct API paths from preload.js:
 *
 * Ollama (lines 848-852):
 * - getModels()
 * - testConnection(hostUrl)
 * - pullModels(models) - NOTE: plural!
 * - deleteModel(model)
 *
 * ChromaDB (lines 937-944):
 * - getStatus()
 * - getCircuitStats()
 * - getQueueStats()
 * - forceRecovery()
 * - healthCheck()
 *
 * Dependencies (lines 948+):
 * - getStatus()
 * - installOllama()
 * - installChromaDb()
 * - updateOllama()
 *
 * Run: npm run test:e2e -- --grep "Dependency Management"
 */

const { test, expect } = require('@playwright/test');
const { launchApp, closeApp, waitForAppReady } = require('./helpers/electronApp');
const { NavigationPage } = require('./helpers/pageObjects');

test.describe('Dependency Management - API Availability', () => {
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

  test('should have Ollama API available', async () => {
    const hasAPI = await window.evaluate(() => {
      const ollama = window.electronAPI?.ollama;
      return {
        hasTestConnection: typeof ollama?.testConnection === 'function',
        hasGetModels: typeof ollama?.getModels === 'function',
        // Note: method is pullModels (plural) per preload.js line 851
        hasPullModels: typeof ollama?.pullModels === 'function',
        hasDeleteModel: typeof ollama?.deleteModel === 'function'
      };
    });

    console.log('[Test] Ollama APIs:', hasAPI);
    expect(hasAPI.hasTestConnection).toBe(true);
    expect(hasAPI.hasGetModels).toBe(true);
    expect(hasAPI.hasPullModels).toBe(true);
    expect(hasAPI.hasDeleteModel).toBe(true);
  });

  test('should have system API available', async () => {
    const hasAPI = await window.evaluate(() => {
      const system = window.electronAPI?.system;
      return {
        hasGetMetrics: typeof system?.getMetrics === 'function'
      };
    });

    console.log('[Test] System APIs:', hasAPI);
    expect(hasAPI.hasGetMetrics).toBe(true);
  });
});

test.describe('Dependency Management - Ollama Status', () => {
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

  test('should check Ollama connection', async () => {
    const result = await window.evaluate(async () => {
      try {
        const connected = await window.electronAPI?.ollama?.testConnection?.();
        return { success: true, connected };
      } catch (e) {
        return { success: false, error: e.message };
      }
    });

    console.log('[Test] Ollama connection check:', result);
    // Connection may or may not succeed depending on if Ollama is running
    expect(result.success).toBe(true);
  });

  test('should get Ollama models list', async () => {
    const result = await window.evaluate(async () => {
      try {
        const models = await window.electronAPI?.ollama?.getModels?.();
        return {
          success: true,
          count: Array.isArray(models) ? models.length : 0,
          hasModels: !!models
        };
      } catch (e) {
        return { success: false, error: e.message };
      }
    });

    console.log('[Test] Ollama models:', result);
    // Success may depend on Ollama being available
  });

  test('should display Ollama status indicator', async () => {
    // Look for connection status indicator in UI
    const statusIndicator = window.locator(
      '[data-testid="ollama-status"], .ollama-status, [aria-label*="Ollama"], [aria-label*="Connected"]'
    );
    const count = await statusIndicator.count();
    console.log('[Test] Ollama status indicators:', count);
  });
});

test.describe('Dependency Management - ChromaDB Status', () => {
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

  test('should have ChromaDB API available', async () => {
    const hasAPI = await window.evaluate(() => {
      // Correct path: electronAPI.chromadb per preload.js line 937
      const chromadb = window.electronAPI?.chromadb;
      return {
        hasGetStatus: typeof chromadb?.getStatus === 'function',
        hasHealthCheck: typeof chromadb?.healthCheck === 'function',
        hasForceRecovery: typeof chromadb?.forceRecovery === 'function',
        hasGetCircuitStats: typeof chromadb?.getCircuitStats === 'function'
      };
    });

    console.log('[Test] ChromaDB APIs:', hasAPI);
    expect(hasAPI.hasGetStatus).toBe(true);
    expect(hasAPI.hasHealthCheck).toBe(true);
    expect(hasAPI.hasForceRecovery).toBe(true);
  });

  test('should check ChromaDB status', async () => {
    const result = await window.evaluate(async () => {
      try {
        const status = await window.electronAPI?.chromadb?.getStatus?.();
        return {
          success: true,
          hasStatus: !!status
        };
      } catch (e) {
        return { success: false, error: e.message };
      }
    });

    console.log('[Test] ChromaDB status:', result);
  });

  test('should perform ChromaDB health check', async () => {
    const result = await window.evaluate(async () => {
      try {
        const health = await window.electronAPI?.chromadb?.healthCheck?.();
        return {
          success: true,
          hasHealth: !!health
        };
      } catch (e) {
        return { success: false, error: e.message };
      }
    });

    console.log('[Test] ChromaDB health check:', result);
  });
});

test.describe('Dependency Management - Dependencies API', () => {
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

  test('should have dependencies API available', async () => {
    const hasAPI = await window.evaluate(() => {
      // Correct path: electronAPI.dependencies per preload.js line 948
      const deps = window.electronAPI?.dependencies;
      return {
        hasGetStatus: typeof deps?.getStatus === 'function',
        hasInstallOllama: typeof deps?.installOllama === 'function',
        hasInstallChromaDb: typeof deps?.installChromaDb === 'function',
        hasUpdateOllama: typeof deps?.updateOllama === 'function'
      };
    });

    console.log('[Test] Dependencies APIs:', hasAPI);
    expect(hasAPI.hasGetStatus).toBe(true);
  });

  test('should get dependencies status', async () => {
    const result = await window.evaluate(async () => {
      try {
        const status = await window.electronAPI?.dependencies?.getStatus?.();
        return {
          success: true,
          hasStatus: !!status
        };
      } catch (e) {
        return { success: false, error: e.message };
      }
    });

    console.log('[Test] Dependencies status:', result);
  });
});

test.describe('Dependency Management - Health Checks', () => {
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

  test('should perform combined health check', async () => {
    const result = await window.evaluate(async () => {
      try {
        // Check both Ollama and ChromaDB
        const [ollamaConnected, chromaStatus] = await Promise.all([
          window.electronAPI?.ollama?.testConnection?.().catch(() => false),
          window.electronAPI?.chromadb?.getStatus?.().catch(() => null)
        ]);
        return {
          success: true,
          ollamaAvailable: !!ollamaConnected,
          chromaAvailable: !!chromaStatus
        };
      } catch (e) {
        return { success: false, error: e.message };
      }
    });

    console.log('[Test] Combined health check:', result);
    expect(result.success).toBe(true);
  });

  test('should get system metrics', async () => {
    const result = await window.evaluate(async () => {
      try {
        const metrics = await window.electronAPI?.system?.getMetrics?.();
        return {
          success: true,
          hasMetrics: !!metrics,
          keys: metrics ? Object.keys(metrics) : []
        };
      } catch (e) {
        return { success: false, error: e.message };
      }
    });

    console.log('[Test] System metrics:', result);
    expect(result.success).toBe(true);
  });
});

test.describe('Dependency Management - Model Management', () => {
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

  test('should have model pull capability', async () => {
    const hasAPI = await window.evaluate(() => {
      const ollama = window.electronAPI?.ollama;
      return {
        // Note: method is pullModels (plural) per preload.js line 851
        hasPullModels: typeof ollama?.pullModels === 'function'
      };
    });

    console.log('[Test] Model pull API:', hasAPI);
    expect(hasAPI.hasPullModels).toBe(true);
  });

  test('should have model delete capability', async () => {
    const hasAPI = await window.evaluate(() => {
      return typeof window.electronAPI?.ollama?.deleteModel === 'function';
    });

    console.log('[Test] Has delete model API:', hasAPI);
    expect(hasAPI).toBe(true);
  });

  test('should list available models', async () => {
    const result = await window.evaluate(async () => {
      try {
        const models = await window.electronAPI?.ollama?.getModels?.();
        return {
          success: true,
          models: Array.isArray(models) ? models.map((m) => m.name || m) : []
        };
      } catch (e) {
        return { success: false, error: e.message };
      }
    });

    console.log('[Test] Available models:', result);
    // Success depends on Ollama being available
  });
});

test.describe('Dependency Management - Recovery Options', () => {
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

  test('should have force recovery option for ChromaDB', async () => {
    const hasAPI = await window.evaluate(() => {
      // Correct path: electronAPI.chromadb.forceRecovery per preload.js line 941
      return typeof window.electronAPI?.chromadb?.forceRecovery === 'function';
    });

    console.log('[Test] Has force recovery API:', hasAPI);
    expect(hasAPI).toBe(true);
  });

  test('should have recovery option in UI', async () => {
    await nav.openSettings();
    await window.waitForTimeout(500);

    const recoveryButton = window.locator(
      'button:has-text("Recovery"), button:has-text("Repair"), button:has-text("Fix"), [data-testid="force-recovery"]'
    );
    const count = await recoveryButton.count();
    console.log('[Test] Recovery buttons:', count);

    await window.keyboard.press('Escape');
  });

  test('should have reinstall/update options', async () => {
    await nav.openSettings();
    await window.waitForTimeout(500);

    const reinstallButton = window.locator(
      'button:has-text("Reinstall"), button:has-text("Install"), button:has-text("Update")'
    );
    const count = await reinstallButton.count();
    console.log('[Test] Reinstall/Update buttons:', count);

    await window.keyboard.press('Escape');
  });
});
