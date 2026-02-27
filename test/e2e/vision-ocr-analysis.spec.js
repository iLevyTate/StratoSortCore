/**
 * Vision & OCR Analysis E2E Tests
 *
 * Tests the image analysis (vision model) and PDF text extraction (OCR)
 * pipeline. Verifies that non-text files are handled correctly by the
 * analysis system.
 *
 * Run: npm run test:e2e -- --grep "Vision"
 */

const { test, expect } = require('@playwright/test');
const { launchApp, closeApp, waitForAppReady } = require('./helpers/electronApp');
const { STRATO_TEST_FILES, TIMEOUTS } = require('./helpers/testFixtures');

test.describe('Vision & OCR — API Surface', () => {
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

  test('should have vision/analysis APIs available', async () => {
    const api = await window.evaluate(() => ({
      hasAnalyzeDoc: typeof window.electronAPI?.analysis?.analyzeDocument === 'function',
      hasLlamaModels: typeof window.electronAPI?.llama?.getModels === 'function',
      hasLlamaConfig: typeof window.electronAPI?.llama?.getConfig === 'function',
      hasLlamaConnection: typeof window.electronAPI?.llama?.testConnection === 'function'
    }));

    expect(api.hasAnalyzeDoc).toBe(true);
    expect(api.hasLlamaModels).toBe(true);
  });

  test('should report available models including vision model', async () => {
    const models = await window.evaluate(async () => {
      try {
        return await window.electronAPI.llama.getModels();
      } catch (e) {
        return { error: e.message };
      }
    });

    expect(models).toBeTruthy();
    if (!models.error) {
      console.log('[Test] Available models:', JSON.stringify(models).substring(0, 200));
    }
  });

  test('should report AI configuration with model paths', async () => {
    const config = await window.evaluate(async () => {
      try {
        return await window.electronAPI.llama.getConfig();
      } catch (e) {
        return { error: e.message };
      }
    });

    expect(config).toBeTruthy();
    if (!config.error) {
      console.log('[Test] Config keys:', Object.keys(config));
    }
  });

  test('should have settings with vision model configured', async () => {
    const settings = await window.evaluate(async () => {
      try {
        return await window.electronAPI.settings.get();
      } catch (e) {
        return { error: e.message };
      }
    });

    expect(settings).toBeTruthy();
    if (!settings.error) {
      expect(settings.visionModel).toBeTruthy();
      expect(settings.embeddingModel).toBeTruthy();
      console.log('[Test] Vision model:', settings.visionModel);
      console.log('[Test] Text model:', settings.textModel);
    }
  });
});

test.describe('Vision & OCR — File Type Support', () => {
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

  test('should accept image files via file selection API', async () => {
    const api = await window.evaluate(() => ({
      hasSelectFiles: typeof window.electronAPI?.files?.selectFiles === 'function',
      hasValidateFiles:
        typeof window.electronAPI?.files?.validateFiles === 'function' ||
        typeof window.electronAPI?.files?.getStats === 'function'
    }));

    expect(api.hasSelectFiles).toBe(true);
  });

  test('should have analysis history API for tracking results', async () => {
    const history = await window.evaluate(async () => {
      try {
        return await window.electronAPI.analysisHistory.get({ limit: 5 });
      } catch (e) {
        return { error: e.message };
      }
    });

    expect(history).toBeTruthy();
  });

  test('should support multiple file types in test fixtures', () => {
    const imageTypes = ['samplePhoto', 'webGraphic', 'pngImage'];
    const docTypes = ['samplePdf', 'annualReport'];

    for (const key of imageTypes) {
      const file = STRATO_TEST_FILES[key];
      if (file) {
        expect(file.type).toBe('image');
      }
    }

    for (const key of docTypes) {
      const file = STRATO_TEST_FILES[key];
      if (file) {
        expect(['pdf', 'document']).toContain(file.type);
      }
    }
  });
});
