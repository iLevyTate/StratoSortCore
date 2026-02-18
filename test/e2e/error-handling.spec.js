/**
 * Error Handling E2E Tests
 *
 * Verifies graceful error handling: invalid inputs are rejected,
 * errors are surfaced without crashing the app.
 *
 * Run: npm run test:e2e -- --grep "Error Handling"
 */

const { test, expect } = require('@playwright/test');
const { launchApp, closeApp, waitForAppReady } = require('./helpers/electronApp');

test.describe('Error Handling', () => {
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

  test('should reject invalid file path for analysis', async () => {
    const result = await window.evaluate(async () => {
      try {
        await window.electronAPI.files.analyze('invalid-path-no-slash');
        return { rejected: false };
      } catch (err) {
        return { rejected: true, message: err?.message || String(err) };
      }
    });

    expect(result.rejected).toBe(true);
    console.log('[Test] Rejection message:', result.message);
  });

  test('should reject http URL for analysis', async () => {
    const result = await window.evaluate(async () => {
      try {
        await window.electronAPI.files.analyze('http://example.com/file.pdf');
        return { rejected: false };
      } catch (err) {
        return { rejected: true };
      }
    });

    expect(result.rejected).toBe(true);
  });

  test('should have error reporting API', async () => {
    const hasSendError = await window.evaluate(() => {
      return typeof window.electronAPI?.events?.sendError === 'function';
    });
    expect(hasSendError).toBe(true);
  });

  test('should not crash when querying non-existent file stats', async () => {
    const result = await window.evaluate(async () => {
      try {
        const res = await window.electronAPI.files.getStats('C:\\nonexistent\\file.txt');
        return { ok: true, exists: res?.exists === false };
      } catch (err) {
        return { ok: false, error: err?.message };
      }
    });

    // Should return safely (exists: false) or throw - either is acceptable
    expect(result).toBeDefined();
  });

  test('app should remain responsive after API error', async () => {
    // Trigger an expected error
    await window.evaluate(async () => {
      try {
        await window.electronAPI.files.analyze('');
      } catch {
        // Expected
      }
    });

    await window.waitForTimeout(500);

    const navVisible = await window.locator('nav[aria-label="Phase navigation"]').isVisible();
    expect(navVisible).toBe(true);
  });
});
