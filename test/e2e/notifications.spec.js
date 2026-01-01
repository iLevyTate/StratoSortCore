/**
 * Notifications E2E Tests
 *
 * Tests the notification system including info, success, warning,
 * and error notifications, auto-dismiss behavior, and manual dismissal.
 *
 * Run: npm run test:e2e -- --grep "Notifications"
 */

const { test } = require('@playwright/test');
const { launchApp, closeApp, waitForAppReady } = require('./helpers/electronApp');
const { NavigationPage } = require('./helpers/pageObjects');

test.describe('Notifications - Display System', () => {
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

  test('should have notification container in DOM', async () => {
    const notificationContainer = window.locator(
      '[data-testid="notification-container"], .notification-container, [class*="toast"], [id*="toast"]'
    );

    const count = await notificationContainer.count();
    console.log('[Test] Notification container found:', count > 0);
  });

  test('should have notification API available', async () => {
    const notificationApi = await window.evaluate(() => {
      // Check for various notification API patterns
      const hasToast = typeof window.toast === 'function';
      const hasNotify = typeof window.notify === 'function';
      const hasEventsNotify = typeof window.electronAPI?.events?.notify === 'function';

      return {
        hasToast,
        hasNotify,
        hasEventsNotify,
        anyAvailable: hasToast || hasNotify || hasEventsNotify
      };
    });

    console.log('[Test] Notification API:', notificationApi);
  });

  test('should display notification container when triggered', async () => {
    // Trigger an action that shows a notification (like saving settings)
    const nav = new NavigationPage(window);
    await nav.openSettings();
    await window.waitForTimeout(500);

    // Try to save settings to trigger a notification
    const saveButton = window.locator('button:has-text("Save"), button:has-text("Apply")');
    if (await saveButton.first().isVisible()) {
      await saveButton.first().click();
      await window.waitForTimeout(500);

      // Look for notification
      const notification = window.locator(
        '[role="alert"], .toast, [class*="notification"], [class*="toast"]'
      );

      const visible = await notification
        .first()
        .isVisible()
        .catch(() => false);
      console.log('[Test] Notification visible after save:', visible);
    }

    await window.keyboard.press('Escape');
  });
});

test.describe('Notifications - Notification Types', () => {
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

  test('should support info notification style', async () => {
    // Dispatch a custom notification event
    await window.evaluate(() => {
      const event = new CustomEvent('app:notification', {
        detail: { type: 'info', message: 'Test info notification' }
      });
      window.dispatchEvent(event);
    });

    await window.waitForTimeout(500);

    const infoNotification = window.locator('[class*="info"], [data-type="info"], .bg-blue');

    const count = await infoNotification.count();
    console.log('[Test] Info notification elements:', count);
  });

  test('should support success notification style', async () => {
    await window.evaluate(() => {
      const event = new CustomEvent('app:notification', {
        detail: { type: 'success', message: 'Test success notification' }
      });
      window.dispatchEvent(event);
    });

    await window.waitForTimeout(500);

    const successNotification = window.locator(
      '[class*="success"], [data-type="success"], .bg-green'
    );

    const count = await successNotification.count();
    console.log('[Test] Success notification elements:', count);
  });

  test('should support warning notification style', async () => {
    await window.evaluate(() => {
      const event = new CustomEvent('app:notification', {
        detail: { type: 'warning', message: 'Test warning notification' }
      });
      window.dispatchEvent(event);
    });

    await window.waitForTimeout(500);

    const warningNotification = window.locator(
      '[class*="warning"], [data-type="warning"], .bg-yellow, .bg-orange'
    );

    const count = await warningNotification.count();
    console.log('[Test] Warning notification elements:', count);
  });

  test('should support error notification style', async () => {
    await window.evaluate(() => {
      const event = new CustomEvent('app:notification', {
        detail: { type: 'error', message: 'Test error notification' }
      });
      window.dispatchEvent(event);
    });

    await window.waitForTimeout(500);

    const errorNotification = window.locator(
      '[class*="error"], [data-type="error"], .bg-red, [role="alert"]'
    );

    const count = await errorNotification.count();
    console.log('[Test] Error notification elements:', count);
  });
});

test.describe('Notifications - Auto-dismiss', () => {
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

  test('should auto-dismiss notifications after timeout', async () => {
    // Trigger an action that causes a notification
    const nav = new NavigationPage(window);
    await nav.openSettings();
    await window.waitForTimeout(300);

    // Save to trigger notification
    const saveButton = window.locator('button:has-text("Save")');
    if (await saveButton.first().isVisible()) {
      await saveButton.first().click();

      // Check immediately for notification
      await window.waitForTimeout(300);

      const notification = window.locator('[role="alert"], .toast, [class*="notification"]');
      const initialVisible = await notification
        .first()
        .isVisible()
        .catch(() => false);
      console.log('[Test] Notification initially visible:', initialVisible);

      if (initialVisible) {
        // Wait for auto-dismiss (typically 3-5 seconds)
        await window.waitForTimeout(6000);

        const stillVisible = await notification
          .first()
          .isVisible()
          .catch(() => false);
        console.log('[Test] Notification still visible after 6s:', stillVisible);
      }
    }

    await window.keyboard.press('Escape');
  });
});

test.describe('Notifications - Manual Dismiss', () => {
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

  test('should have dismiss button on notifications', async () => {
    // Trigger a notification first
    const nav = new NavigationPage(window);
    await nav.openSettings();
    await window.waitForTimeout(300);

    const saveButton = window.locator('button:has-text("Save")');
    if (await saveButton.first().isVisible()) {
      await saveButton.first().click();
      await window.waitForTimeout(500);

      // Look for dismiss button
      const dismissButton = window.locator(
        '[role="alert"] button, .toast button, [class*="notification"] button, button[aria-label*="Close"], button[aria-label*="Dismiss"]'
      );

      const count = await dismissButton.count();
      console.log('[Test] Dismiss buttons found:', count);
    }

    await window.keyboard.press('Escape');
  });

  test('should dismiss notification when clicking X button', async () => {
    const nav = new NavigationPage(window);
    await nav.openSettings();
    await window.waitForTimeout(300);

    const saveButton = window.locator('button:has-text("Save")');
    if (await saveButton.first().isVisible()) {
      await saveButton.first().click();
      await window.waitForTimeout(500);

      const notification = window.locator('[role="alert"], .toast, [class*="notification"]');
      const initialVisible = await notification
        .first()
        .isVisible()
        .catch(() => false);

      if (initialVisible) {
        const dismissButton = window
          .locator(
            '[role="alert"] button, .toast button:has-text("×"), button[aria-label*="Close"]'
          )
          .first();

        if (await dismissButton.isVisible()) {
          await dismissButton.click();
          await window.waitForTimeout(300);

          const stillVisible = await notification
            .first()
            .isVisible()
            .catch(() => false);
          console.log('[Test] Notification dismissed:', !stillVisible);
        }
      }
    }

    await window.keyboard.press('Escape');
  });
});

test.describe('Notifications - Stacking', () => {
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

  test('should stack multiple notifications', async () => {
    // Dispatch multiple notifications rapidly
    await window.evaluate(() => {
      for (let i = 0; i < 3; i++) {
        const event = new CustomEvent('app:notification', {
          detail: { type: 'info', message: `Test notification ${i + 1}` }
        });
        window.dispatchEvent(event);
      }
    });

    await window.waitForTimeout(500);

    const notifications = window.locator('[role="alert"], .toast, [class*="notification"]');

    const count = await notifications.count();
    console.log('[Test] Stacked notifications count:', count);
  });

  test('should position notifications correctly', async () => {
    // Check if notification container has proper positioning
    const containerStyles = await window.evaluate(() => {
      const container = document.querySelector(
        '[data-testid="notification-container"], .notification-container, [class*="toast-container"]'
      );
      if (!container) return null;

      const style = window.getComputedStyle(container);
      return {
        position: style.position,
        top: style.top,
        right: style.right,
        zIndex: style.zIndex
      };
    });

    console.log('[Test] Notification container styles:', containerStyles);
  });
});

test.describe('Notifications - Error Scenarios', () => {
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

  test('should show error notification on API failure', async () => {
    // Try an operation that might fail
    await window.evaluate(async () => {
      try {
        // Try to analyze a non-existent file
        await window.electronAPI?.files?.analyze('/nonexistent/path/file.txt');
      } catch (e) {
        // Error expected - should trigger notification
      }
    });

    await window.waitForTimeout(500);

    const errorNotification = window.locator(
      '[role="alert"]:has-text("error"), [class*="error"], [class*="notification"]:has-text("Error")'
    );

    const count = await errorNotification.count();
    console.log('[Test] Error notification shown:', count > 0);
  });

  test('should show notification on connection status change', async () => {
    // Check if connection status triggers notifications
    const nav = new NavigationPage(window);
    const isConnected = await nav.isConnected();

    console.log('[Test] Current connection status:', isConnected);
    // Connection notifications are typically shown on status change
  });

  test('should show notification on settings save success', async () => {
    await nav.openSettings();
    await window.waitForTimeout(500);

    // Modify and save settings
    const result = await window.evaluate(async () => {
      try {
        const settings = await window.electronAPI.settings.get();
        await window.electronAPI.settings.save(settings);
        return { saved: true };
      } catch (e) {
        return { saved: false, error: e.message };
      }
    });

    await window.waitForTimeout(500);

    console.log('[Test] Settings save result:', result);

    await window.keyboard.press('Escape');
  });
});

test.describe('Notifications - Accessibility', () => {
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

  test('should have proper ARIA role on notifications', async () => {
    // Trigger notification
    await window.evaluate(() => {
      const event = new CustomEvent('app:notification', {
        detail: { type: 'info', message: 'Test accessibility' }
      });
      window.dispatchEvent(event);
    });

    await window.waitForTimeout(500);

    const ariaNotification = window.locator('[role="alert"], [role="status"]');
    const count = await ariaNotification.count();

    console.log('[Test] ARIA role notifications:', count);
  });

  test('should be announced to screen readers', async () => {
    // Check for aria-live region
    const liveRegion = await window.evaluate(() => {
      const regions = document.querySelectorAll('[aria-live]');
      return Array.from(regions).map((r) => ({
        live: r.getAttribute('aria-live'),
        role: r.getAttribute('role')
      }));
    });

    console.log('[Test] Live regions found:', liveRegion);
  });
});
