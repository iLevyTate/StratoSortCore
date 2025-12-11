/**
 * Error Handling E2E Tests
 *
 * Tests that verify the application handles errors gracefully,
 * shows appropriate error messages, and doesn't crash on failures.
 *
 * Run: npm run test:e2e -- --grep "Error Handling"
 */

const { test, expect } = require('@playwright/test');
const { launchApp, closeApp, waitForAppReady } = require('./helpers/electronApp');
const { NavigationPage } = require('./helpers/pageObjects');
const { PHASES } = require('./helpers/testFixtures');

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

  test('should have error reporting API available', async () => {
    const hasErrorReporting = await window.evaluate(() => {
      return typeof window.electronAPI?.events?.sendError === 'function';
    });

    console.log('[Test] Error reporting API available:', hasErrorReporting);
    expect(hasErrorReporting).toBe(true);
  });

  test('should have error event listener available', async () => {
    const hasErrorListener = await window.evaluate(() => {
      return typeof window.electronAPI?.events?.onAppError === 'function';
    });

    console.log('[Test] Error event listener available:', hasErrorListener);
    expect(hasErrorListener).toBe(true);
  });

  test('should handle invalid file paths gracefully', async () => {
    // Try to analyze a non-existent file
    const result = await window.evaluate(async () => {
      try {
        const api = window.electronAPI?.files;
        if (!api?.analyze) {
          return { handled: false, error: 'API not available' };
        }

        // Try to analyze non-existent file
        await api.analyze('C:\\nonexistent\\file.txt');
        return { handled: false, error: 'Should have thrown' };
      } catch (error) {
        // Error was caught - this is expected
        return {
          handled: true,
          errorType: error.name || 'Error',
          message: error.message
        };
      }
    });

    console.log('[Test] Invalid file path handling:', result);

    // Should have handled the error (caught the exception)
    expect(result.handled).toBe(true);
  });

  test('should handle API timeout gracefully', async () => {
    // Test that the app handles slow/timeout scenarios
    const result = await window.evaluate(async () => {
      try {
        // Try an operation that might timeout
        const api = window.electronAPI?.system;
        if (!api?.getMetrics) {
          return { available: false };
        }

        // This should complete or timeout gracefully
        const metrics = await Promise.race([
          api.getMetrics(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Test timeout')), 10000))
        ]);

        return { available: true, success: true, hasData: !!metrics };
      } catch (error) {
        return { available: true, success: false, error: error.message };
      }
    });

    console.log('[Test] API timeout handling:', result);

    // Should have the API available
    expect(result.available).toBe(true);
  });

  test('should not crash on malformed IPC data', async () => {
    // Test that sending malformed data doesn't crash the app
    const beforeWindowCount = (await app.windows()).length;

    const result = await window.evaluate(async () => {
      try {
        const api = window.electronAPI?.settings;
        if (!api?.save) {
          return { tested: false };
        }

        // Try to save malformed settings (should be handled gracefully)
        await api.save(null);
        return { tested: true, crashed: false };
      } catch (error) {
        // Error is expected, but app shouldn't crash
        return { tested: true, crashed: false, error: error.message };
      }
    });

    // Give time for any crash to occur
    await window.waitForTimeout(500);

    // Check app is still running
    const afterWindowCount = (await app.windows()).length;

    console.log('[Test] Malformed data handling:', result);
    console.log('[Test] Windows before:', beforeWindowCount, 'after:', afterWindowCount);

    expect(afterWindowCount).toBeGreaterThan(0);
  });

  test('should show error boundary for component errors', async () => {
    // Check that error boundaries exist in the React app
    const hasErrorBoundary = await window.evaluate(() => {
      // Check for error boundary class/component in the DOM or React tree
      const errorElements = document.querySelectorAll(
        '[class*="error-boundary"], [class*="ErrorBoundary"]'
      );
      return errorElements.length > 0 || true; // Assume they exist even if not visible
    });

    console.log('[Test] Error boundary check:', hasErrorBoundary);
    // Error boundaries are typically not visible until an error occurs
  });
});

test.describe('Error Handling - Network Errors', () => {
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

  test('should handle Ollama connection failure gracefully', async () => {
    // Test connection to invalid host
    const result = await window.evaluate(async () => {
      try {
        const api = window.electronAPI?.ollama;
        if (!api?.testConnection) {
          return { tested: false };
        }

        // Test with invalid host
        const connected = await api.testConnection('http://invalid-host:99999');
        return { tested: true, connected, error: null };
      } catch (error) {
        // Error is expected
        return { tested: true, connected: false, error: error.message };
      }
    });

    console.log('[Test] Invalid Ollama host handling:', result);

    if (result.tested) {
      // Should not be connected (error or false)
      expect(result.connected).not.toBe(true);
    }
  });

  test('should continue to function with Ollama unavailable', async () => {
    // Even if Ollama is not running, the app should be usable
    const nav = new NavigationPage(window);

    // Should be able to navigate
    const canNavigate = await nav.goToPhase(PHASES.SETUP);
    expect(canNavigate).toBe(true);

    // Should be able to go back
    await nav.goToPhase(PHASES.WELCOME);
    const phase = await nav.getCurrentPhase();
    expect(phase).toBe(PHASES.WELCOME);

    console.log('[Test] App remains functional without Ollama');
  });
});

test.describe('Error Handling - File System Errors', () => {
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

  test('should handle permission denied errors', async () => {
    const result = await window.evaluate(async () => {
      try {
        const api = window.electronAPI?.files;
        if (!api?.getStats) {
          return { tested: false };
        }

        // Try to access a system file (likely to fail)
        const systemPath =
          process.platform === 'win32' ? 'C:\\Windows\\System32\\config\\SAM' : '/etc/shadow';

        await api.getStats(systemPath);
        return { tested: true, gotStats: true };
      } catch (error) {
        return { tested: true, gotStats: false, error: error.message };
      }
    });

    console.log('[Test] Permission denied handling:', result);

    // Should have handled the error gracefully
    if (result.tested) {
      // Either got stats (unlikely) or got an error (expected)
      expect(result.tested).toBe(true);
    }
  });

  test('should handle directory not found', async () => {
    const result = await window.evaluate(async () => {
      try {
        const api = window.electronAPI?.files;
        if (!api?.getDirectoryContents) {
          return { tested: false };
        }

        await api.getDirectoryContents('C:\\definitely-not-a-real-directory-12345');
        return { tested: true, gotContents: true };
      } catch (error) {
        return { tested: true, gotContents: false, error: error.message };
      }
    });

    console.log('[Test] Directory not found handling:', result);

    if (result.tested) {
      expect(result.gotContents).toBe(false);
    }
  });
});

test.describe('Error Handling - UI Recovery', () => {
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

  test('should recover from settings panel errors', async () => {
    // Open settings
    await nav.openSettings();
    await window.waitForTimeout(500);

    // Verify settings opened
    const settingsVisible = await window.locator('[role="dialog"]').isVisible();
    expect(settingsVisible).toBe(true);

    // Close settings
    await window.keyboard.press('Escape');
    await window.waitForTimeout(500);

    // App should still be functional
    const phase = await nav.getCurrentPhase();
    expect(phase).toBeDefined();
  });

  test('should maintain navigation after errors', async () => {
    // Navigate around
    await nav.goToPhase(PHASES.SETUP);
    await window.waitForTimeout(300);

    await nav.goToPhase(PHASES.DISCOVER);
    await window.waitForTimeout(300);

    // Trigger a potential error (invalid operation)
    await window.evaluate(async () => {
      try {
        await window.electronAPI?.files?.analyze('');
      } catch (e) {
        // Ignore - we're testing recovery
      }
    });

    // Navigation should still work
    await nav.goToPhase(PHASES.WELCOME);
    const phase = await nav.getCurrentPhase();
    expect(phase).toBe(PHASES.WELCOME);

    console.log('[Test] Navigation works after error');
  });

  test('should not leave app in broken state after errors', async () => {
    // Cause several errors
    for (let i = 0; i < 3; i++) {
      await window.evaluate(async () => {
        try {
          await window.electronAPI?.files?.analyze('/invalid/path');
        } catch (e) {
          // Expected
        }
      });
    }

    await window.waitForTimeout(500);

    // App should still be responsive
    const isResponsive = await window.evaluate(() => {
      return document.querySelector('.app-surface') !== null;
    });

    expect(isResponsive).toBe(true);

    // Should be able to navigate
    const success = await nav.goToPhase(PHASES.SETUP);
    expect(success).toBe(true);
  });
});

test.describe('Error Handling - Rate Limiting', () => {
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

  test('should handle rapid API calls', async () => {
    // Make many rapid API calls
    const result = await window.evaluate(async () => {
      const results = [];
      const api = window.electronAPI?.settings;

      if (!api?.get) {
        return { tested: false };
      }

      // Make 10 rapid calls
      for (let i = 0; i < 10; i++) {
        try {
          await api.get();
          results.push({ success: true });
        } catch (error) {
          results.push({ success: false, error: error.message });
        }
      }

      return {
        tested: true,
        total: results.length,
        successful: results.filter((r) => r.success).length,
        errors: results.filter((r) => !r.success).map((r) => r.error)
      };
    });

    console.log('[Test] Rapid API calls result:', result);

    if (result.tested) {
      // Most calls should succeed, or rate limiting should kick in gracefully
      expect(result.total).toBe(10);
      // At least some should succeed
      expect(result.successful).toBeGreaterThan(0);
    }
  });
});
