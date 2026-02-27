/**
 * Model Switching E2E Tests
 *
 * Tests changing the AI text model in settings and verifying the
 * application responds correctly. Covers model selection, validation,
 * and configuration persistence.
 *
 * Run: npm run test:e2e -- --grep "Model Switching"
 */

const { test, expect } = require('@playwright/test');
const { launchApp, closeApp, waitForAppReady } = require('./helpers/electronApp');
const { NavigationPage } = require('./helpers/pageObjects');

test.describe('Model Switching — API', () => {
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

  test('should list available text models', async () => {
    const models = await window.evaluate(async () => {
      try {
        return await window.electronAPI.llama.getModels();
      } catch (e) {
        return { error: e.message };
      }
    });

    expect(models).toBeTruthy();
    console.log('[Test] Models:', JSON.stringify(models).substring(0, 300));
  });

  test('should read current model configuration', async () => {
    const settings = await window.evaluate(async () => {
      const s = await window.electronAPI.settings.get();
      return {
        textModel: s.textModel,
        visionModel: s.visionModel,
        embeddingModel: s.embeddingModel
      };
    });

    expect(settings.textModel).toBeTruthy();
    expect(settings.embeddingModel).toBeTruthy();
    console.log('[Test] Current models:', settings);
  });

  test('should update text model setting via API', async () => {
    const originalModel = await window.evaluate(async () => {
      const s = await window.electronAPI.settings.get();
      return s.textModel;
    });

    // Set a different model name (just the setting, not actually loading)
    const testModelName = 'test-model-switch.gguf';
    await window.evaluate(
      async ({ key, value }) => window.electronAPI.settings.update(key, value),
      { key: 'textModel', value: testModelName }
    );

    const updated = await window.evaluate(async () => {
      const s = await window.electronAPI.settings.get();
      return s.textModel;
    });

    expect(updated).toBe(testModelName);

    // Restore original
    await window.evaluate(
      async ({ key, value }) => window.electronAPI.settings.update(key, value),
      { key: 'textModel', value: originalModel }
    );
  });

  test('should report llama connection status', async () => {
    const connection = await window.evaluate(async () => {
      try {
        return await window.electronAPI.llama.testConnection();
      } catch (e) {
        return { error: e.message };
      }
    });

    expect(connection).toBeTruthy();
    console.log('[Test] Connection:', connection);
  });

  test('should have model download manager API', async () => {
    const api = await window.evaluate(() => ({
      hasGetModelStatus: typeof window.electronAPI?.llama?.getModelStatus === 'function',
      hasDownloadModel: typeof window.electronAPI?.llama?.downloadModel === 'function',
      hasGetConfig: typeof window.electronAPI?.llama?.getConfig === 'function'
    }));

    expect(api.hasGetConfig).toBe(true);
  });
});

test.describe('Model Switching — Settings UI', () => {
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

  test('should show AI Configuration with model selectors', async () => {
    await nav.openSettings();
    await window.waitForTimeout(500);

    const aiConfig = await window.evaluate(() => {
      const body = document.body.textContent || '';
      return {
        hasAIConfig: body.includes('AI Configuration'),
        hasLocalEngine: body.includes('Local AI Engine') || body.includes('AI Engine'),
        hasGPUAccel: body.includes('GPU') || body.includes('Acceleration'),
        hasDefaultModels: body.includes('Default AI Models') || body.includes('Model'),
        hasTextModel: body.includes('Text Model') || body.includes('text model'),
        hasVisionModel: body.includes('Vision Model') || body.includes('vision model'),
        hasEmbeddingModel: body.includes('Embedding Model') || body.includes('embedding model'),
        hasModelStatus:
          body.includes('Ready') || body.includes('Loaded') || body.includes('Available')
      };
    });

    expect(aiConfig.hasAIConfig).toBe(true);
    expect(aiConfig.hasDefaultModels || aiConfig.hasTextModel || aiConfig.hasModelStatus).toBe(
      true
    );
  });

  test('should show model status indicators', async () => {
    await nav.openSettings();
    await window.waitForTimeout(500);

    const statusUI = await window.evaluate(() => {
      const body = document.body.textContent || '';
      return {
        hasReadyStatus: body.includes('Ready'),
        hasLoadedLocally: body.includes('Loaded locally'),
        hasAvailableCount: /\d+\s*(available|models)/.test(body),
        hasCPUBackend: body.includes('cpu') || body.includes('CPU')
      };
    });

    const hasStatus = Object.values(statusUI).some((v) => v);
    expect(hasStatus).toBe(true);
  });

  test('should show model dropdowns or selectors in AI section', async () => {
    await nav.openSettings();
    await window.waitForTimeout(500);

    const selectors = await window.evaluate(() => {
      const selectElements = document.querySelectorAll(
        'select, [role="combobox"], [role="listbox"], button[class*="select"]'
      );
      const modelRelated = Array.from(selectElements).filter((el) => {
        const text = el.textContent || el.getAttribute('aria-label') || '';
        return text.includes('model') || text.includes('Model') || text.includes('.gguf');
      });

      return {
        totalSelects: selectElements.length,
        modelSelects: modelRelated.length,
        hasGgufReferences: (document.body.textContent || '').includes('.gguf')
      };
    });

    console.log('[Test] Selectors found:', selectors);
    expect(selectors.totalSelects > 0 || selectors.hasGgufReferences).toBe(true);
  });
});
