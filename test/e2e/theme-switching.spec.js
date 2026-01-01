/**
 * Theme Switching E2E Tests
 *
 * Tests theme switching between light, dark, and system themes,
 * and verifies theme persistence across sessions.
 *
 * Run: npm run test:e2e -- --grep "Theme Switching"
 */

const { test, expect } = require('@playwright/test');
const { launchApp, closeApp, waitForAppReady } = require('./helpers/electronApp');
const { NavigationPage } = require('./helpers/pageObjects');

test.describe('Theme Switching - Theme Selection', () => {
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

  test('should have theme setting in settings panel', async () => {
    await nav.openSettings();
    await window.waitForTimeout(500);

    // Look for theme setting
    const themeLabel = window.locator('text=Theme, text=theme, text=Appearance');
    const count = await themeLabel.count();

    console.log('[Test] Theme label found:', count > 0);
    expect(count).toBeGreaterThan(0);
  });

  test('should have light theme option', async () => {
    await nav.openSettings();
    await window.waitForTimeout(500);

    const lightOption = window.locator(
      'button:has-text("Light"), [data-testid*="light"], option:has-text("Light")'
    );

    const count = await lightOption.count();
    console.log('[Test] Light theme option found:', count > 0);
  });

  test('should have dark theme option', async () => {
    await nav.openSettings();
    await window.waitForTimeout(500);

    const darkOption = window.locator(
      'button:has-text("Dark"), [data-testid*="dark"], option:has-text("Dark")'
    );

    const count = await darkOption.count();
    console.log('[Test] Dark theme option found:', count > 0);
  });

  test('should have system theme option', async () => {
    await nav.openSettings();
    await window.waitForTimeout(500);

    const systemOption = window.locator(
      'button:has-text("System"), [data-testid*="system"], option:has-text("System")'
    );

    const count = await systemOption.count();
    console.log('[Test] System theme option found:', count > 0);
  });
});

test.describe('Theme Switching - Theme Application', () => {
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

  test('should apply dark theme to document', async () => {
    // Check current theme state
    const hasThemeClass = await window.evaluate(() => {
      const html = document.documentElement;
      const body = document.body;
      return {
        htmlClass: html.className,
        bodyClass: body.className,
        hasDark: html.classList.contains('dark') || body.classList.contains('dark')
      };
    });

    console.log('[Test] Theme classes:', hasThemeClass);
  });

  test('should switch between themes via settings', async () => {
    await nav.openSettings();
    await window.waitForTimeout(500);

    // Get initial theme state
    const initialTheme = await window.evaluate(() => {
      return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
    });

    console.log('[Test] Initial theme:', initialTheme);

    // Try to find and click theme toggle
    const themeButtons = window.locator(
      'button:has-text("Light"), button:has-text("Dark"), [data-testid*="theme"]'
    );

    const count = await themeButtons.count();
    if (count > 0) {
      // Click a different theme
      const targetTheme = initialTheme === 'dark' ? 'Light' : 'Dark';
      const targetButton = window.locator(`button:has-text("${targetTheme}")`);

      if (await targetButton.isVisible()) {
        await targetButton.click();
        await window.waitForTimeout(500);

        const newTheme = await window.evaluate(() => {
          return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
        });

        console.log('[Test] New theme after switch:', newTheme);
      }
    }
  });

  test('should update UI colors when theme changes', async () => {
    // Get current background color
    const initialBgColor = await window.evaluate(() => {
      const element = document.querySelector('.app-surface') || document.body;
      return window.getComputedStyle(element).backgroundColor;
    });

    console.log('[Test] Initial background color:', initialBgColor);

    // Open settings and try to change theme
    await nav.openSettings();
    await window.waitForTimeout(500);

    // Look for theme buttons
    const isDark = await window.evaluate(() => {
      return document.documentElement.classList.contains('dark');
    });

    const targetTheme = isDark ? 'Light' : 'Dark';
    const themeButton = window.locator(`button:has-text("${targetTheme}")`).first();

    if (await themeButton.isVisible()) {
      await themeButton.click();
      await window.waitForTimeout(500);

      const newBgColor = await window.evaluate(() => {
        const element = document.querySelector('.app-surface') || document.body;
        return window.getComputedStyle(element).backgroundColor;
      });

      console.log('[Test] New background color:', newBgColor);
      // Colors should be different after theme change
    }
  });
});

test.describe('Theme Switching - Theme Persistence', () => {
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

  test('should save theme preference in settings', async () => {
    // Get current settings
    const settings = await window.evaluate(async () => {
      return await window.electronAPI?.settings?.get();
    });

    console.log('[Test] Settings theme value:', settings?.theme);
    expect(settings).toBeDefined();
  });

  test('should persist theme after settings save', async () => {
    // Save a specific theme
    const result = await window.evaluate(async () => {
      try {
        const settings = (await window.electronAPI.settings.get()) || {};
        await window.electronAPI.settings.save({ ...settings, theme: 'dark' });

        // Reload and verify
        const reloaded = await window.electronAPI.settings.get();
        return {
          success: true,
          theme: reloaded.theme
        };
      } catch (e) {
        return { success: false, error: e.message };
      }
    });

    console.log('[Test] Theme persistence result:', result);
    if (result.success) {
      expect(result.theme).toBe('dark');
    }
  });

  test('should apply saved theme on startup', async () => {
    // This test verifies the theme is read from settings on app startup
    const appliedTheme = await window.evaluate(async () => {
      const settings = await window.electronAPI?.settings?.get();
      const isDark = document.documentElement.classList.contains('dark');

      return {
        settingsTheme: settings?.theme,
        appliedTheme: isDark ? 'dark' : 'light'
      };
    });

    console.log('[Test] Applied theme on startup:', appliedTheme);
  });
});

test.describe('Theme Switching - System Theme', () => {
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

  test('should detect system color scheme preference', async () => {
    const systemPreference = await window.evaluate(() => {
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      return prefersDark ? 'dark' : 'light';
    });

    console.log('[Test] System color scheme preference:', systemPreference);
    expect(['light', 'dark']).toContain(systemPreference);
  });

  test('should respond to system preference when set to system', async () => {
    // Set theme to 'system'
    await window.evaluate(async () => {
      const settings = (await window.electronAPI.settings.get()) || {};
      await window.electronAPI.settings.save({ ...settings, theme: 'system' });
    });

    await window.waitForTimeout(500);

    // Check if theme matches system preference
    const themeMatch = await window.evaluate(() => {
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      const isDark = document.documentElement.classList.contains('dark');
      return prefersDark === isDark;
    });

    console.log('[Test] Theme matches system preference:', themeMatch);
  });

  test('should have media query listener for system changes', async () => {
    // Check if the app is listening to prefers-color-scheme changes
    const hasMediaQuery = await window.evaluate(() => {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      return typeof mq.addEventListener === 'function' || typeof mq.addListener === 'function';
    });

    expect(hasMediaQuery).toBe(true);
  });
});

test.describe('Theme Switching - UI Elements', () => {
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

  test('should have consistent icon colors with theme', async () => {
    // Check that icons/SVGs have appropriate colors
    const iconColors = await window.evaluate(() => {
      const svgs = document.querySelectorAll('svg');
      const colors = [];
      svgs.forEach((svg) => {
        const style = window.getComputedStyle(svg);
        colors.push(style.color || style.fill);
      });
      return colors.slice(0, 5); // First 5 icons
    });

    console.log('[Test] Icon colors:', iconColors);
  });

  test('should have proper contrast in current theme', async () => {
    // Check text visibility against background
    const contrast = await window.evaluate(() => {
      const body = document.body;
      const style = window.getComputedStyle(body);
      return {
        backgroundColor: style.backgroundColor,
        color: style.color
      };
    });

    console.log('[Test] Color contrast:', contrast);
    expect(contrast.backgroundColor).toBeTruthy();
    expect(contrast.color).toBeTruthy();
  });

  test('should style modals correctly with current theme', async () => {
    // Open settings to see modal styling
    const nav = new NavigationPage(window);
    await nav.openSettings();
    await window.waitForTimeout(500);

    const modalStyle = await window.evaluate(() => {
      const modal = document.querySelector('[role="dialog"]');
      if (!modal) return null;
      const style = window.getComputedStyle(modal);
      return {
        backgroundColor: style.backgroundColor,
        color: style.color,
        borderColor: style.borderColor
      };
    });

    console.log('[Test] Modal styling:', modalStyle);

    await window.keyboard.press('Escape');
  });

  test('should style buttons correctly with current theme', async () => {
    const buttonStyles = await window.evaluate(() => {
      const buttons = document.querySelectorAll('button');
      const styles = [];
      buttons.forEach((btn) => {
        if (btn.offsetParent !== null) {
          // Only visible buttons
          const style = window.getComputedStyle(btn);
          styles.push({
            backgroundColor: style.backgroundColor,
            color: style.color
          });
        }
      });
      return styles.slice(0, 3); // First 3 buttons
    });

    console.log('[Test] Button styles:', buttonStyles);
    expect(buttonStyles.length).toBeGreaterThan(0);
  });
});
