/**
 * Naming Strategy E2E Tests
 *
 * Tests the file naming convention configuration in the Discover phase.
 * Users can configure how files are renamed based on different patterns.
 *
 * Real selectors from NamingSettings.jsx:
 * - #naming-convention: Convention select dropdown
 * - #date-format: Date format select dropdown
 * - #case-convention: Case convention select dropdown
 * - #separator: Separator text input
 *
 * Run: npm run test:e2e -- --grep "Naming Strategy"
 */

const { test, expect } = require('@playwright/test');
const { launchApp, closeApp, waitForAppReady } = require('./helpers/electronApp');
const { NavigationPage } = require('./helpers/pageObjects');
const { PHASES } = require('./helpers/testFixtures');

test.describe('Naming Strategy - Configuration Modal', () => {
  let app;
  let window;
  let nav;

  test.beforeEach(async () => {
    const result = await launchApp();
    app = result.app;
    window = result.window;
    await waitForAppReady(window);
    nav = new NavigationPage(window);
    // Navigate to Discover phase where naming strategy is configured
    await nav.goToPhase(PHASES.DISCOVER);
    await window.waitForTimeout(500);
  });

  test.afterEach(async () => {
    await closeApp(app);
  });

  test('should have Naming Strategy button in Discover phase', async () => {
    // The actual button text is "Naming Strategy" in DiscoverPhase.jsx line 414
    const namingButton = window.locator('button:has-text("Naming Strategy")');
    const isVisible = await namingButton.isVisible().catch(() => false);
    console.log('[Test] Naming Strategy button visible:', isVisible);
    expect(isVisible).toBe(true);
  });

  test('should open naming strategy modal when button clicked', async () => {
    // Click the Naming Strategy button
    const namingButton = window.locator('button:has-text("Naming Strategy")');
    await namingButton.click();
    await window.waitForTimeout(300);

    // Modal should be visible with title "Naming Strategy"
    const modalTitle = window.locator(
      'h2:has-text("Naming Strategy"), h3:has-text("Naming Strategy")'
    );
    const isModalVisible = await modalTitle.isVisible().catch(() => false);
    console.log('[Test] Naming Strategy modal visible:', isModalVisible);
    expect(isModalVisible).toBe(true);
  });
});

test.describe('Naming Strategy - Form Controls', () => {
  let app;
  let window;
  let nav;

  test.beforeEach(async () => {
    const result = await launchApp();
    app = result.app;
    window = result.window;
    await waitForAppReady(window);
    nav = new NavigationPage(window);
    await nav.goToPhase(PHASES.DISCOVER);
    await window.waitForTimeout(500);

    // Open the naming strategy modal
    const namingButton = window.locator('button:has-text("Naming Strategy")');
    if (await namingButton.isVisible().catch(() => false)) {
      await namingButton.click();
      await window.waitForTimeout(300);
    }
  });

  test.afterEach(async () => {
    await closeApp(app);
  });

  test('should have convention selector', async () => {
    // Real selector from NamingSettings.jsx: id="naming-convention"
    const conventionSelect = window.locator('#naming-convention, select[id="naming-convention"]');
    const isVisible = await conventionSelect.isVisible().catch(() => false);
    console.log('[Test] Convention selector visible:', isVisible);
    expect(isVisible).toBe(true);
  });

  test('should have date format selector', async () => {
    // Real selector from NamingSettings.jsx: id="date-format"
    const dateFormatSelect = window.locator('#date-format, select[id="date-format"]');
    const isVisible = await dateFormatSelect.isVisible().catch(() => false);
    console.log('[Test] Date format selector visible:', isVisible);
    expect(isVisible).toBe(true);
  });

  test('should have case convention selector', async () => {
    // Real selector from NamingSettings.jsx: id="case-convention"
    const caseSelect = window.locator('#case-convention, select[id="case-convention"]');
    const isVisible = await caseSelect.isVisible().catch(() => false);
    console.log('[Test] Case convention selector visible:', isVisible);
    expect(isVisible).toBe(true);
  });

  test('should have separator input', async () => {
    // Real selector from NamingSettings.jsx: id="separator"
    const separatorInput = window.locator('#separator, input[id="separator"]');
    const isVisible = await separatorInput.isVisible().catch(() => false);
    console.log('[Test] Separator input visible:', isVisible);
    expect(isVisible).toBe(true);
  });

  test('should have all convention options', async () => {
    const conventionSelect = window.locator('#naming-convention');
    if (await conventionSelect.isVisible().catch(() => false)) {
      // Check for expected options from NamingSettings.jsx
      const options = await conventionSelect.locator('option').allTextContents();
      console.log('[Test] Convention options:', options);
      expect(options).toContain('subject-date');
      expect(options).toContain('date-subject');
      expect(options).toContain('keep-original');
    }
  });

  test('should have all date format options', async () => {
    const dateFormatSelect = window.locator('#date-format');
    if (await dateFormatSelect.isVisible().catch(() => false)) {
      const options = await dateFormatSelect.locator('option').allTextContents();
      console.log('[Test] Date format options:', options);
      expect(options).toContain('YYYY-MM-DD');
      expect(options).toContain('MM-DD-YYYY');
      expect(options).toContain('DD-MM-YYYY');
    }
  });

  test('should have all case convention options', async () => {
    const caseSelect = window.locator('#case-convention');
    if (await caseSelect.isVisible().catch(() => false)) {
      const options = await caseSelect.locator('option').allTextContents();
      console.log('[Test] Case options:', options);
      expect(options).toContain('kebab-case');
      expect(options).toContain('snake_case');
      expect(options).toContain('camelCase');
    }
  });
});

test.describe('Naming Strategy - Preview', () => {
  let app;
  let window;
  let nav;

  test.beforeEach(async () => {
    const result = await launchApp();
    app = result.app;
    window = result.window;
    await waitForAppReady(window);
    nav = new NavigationPage(window);
    await nav.goToPhase(PHASES.DISCOVER);
    await window.waitForTimeout(500);

    // Open the naming strategy modal
    const namingButton = window.locator('button:has-text("Naming Strategy")');
    if (await namingButton.isVisible().catch(() => false)) {
      await namingButton.click();
      await window.waitForTimeout(300);
    }
  });

  test.afterEach(async () => {
    await closeApp(app);
  });

  test('should show preview section', async () => {
    // Preview section is in NamingSettingsModal.jsx with text "Preview:"
    const previewLabel = window.locator(':has-text("Preview:")');
    const isVisible = await previewLabel
      .first()
      .isVisible()
      .catch(() => false);
    console.log('[Test] Preview section visible:', isVisible);
    expect(isVisible).toBe(true);
  });

  test('should have Done button to close modal', async () => {
    const doneButton = window.locator('button:has-text("Done")');
    const isVisible = await doneButton.isVisible().catch(() => false);
    console.log('[Test] Done button visible:', isVisible);
    expect(isVisible).toBe(true);
  });

  test('should close modal when Done clicked', async () => {
    const doneButton = window.locator('button:has-text("Done")');
    if (await doneButton.isVisible().catch(() => false)) {
      await doneButton.click();
      await window.waitForTimeout(300);

      // Modal should be closed - convention select should not be visible
      const conventionSelect = window.locator('#naming-convention');
      const isVisible = await conventionSelect.isVisible().catch(() => false);
      console.log('[Test] Modal closed (convention select hidden):', !isVisible);
      expect(isVisible).toBe(false);
    }
  });
});

test.describe('Naming Strategy - Settings Persistence', () => {
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

  test('should have settings API available', async () => {
    const hasAPI = await window.evaluate(() => {
      const settings = window.electronAPI?.settings;
      return {
        hasGet: typeof settings?.get === 'function',
        hasSave: typeof settings?.save === 'function'
      };
    });

    console.log('[Test] Settings API:', hasAPI);
    expect(hasAPI.hasGet).toBe(true);
    expect(hasAPI.hasSave).toBe(true);
  });

  test('should be able to read current settings', async () => {
    const result = await window.evaluate(async () => {
      try {
        const settings = await window.electronAPI?.settings?.get();
        return {
          success: true,
          hasSettings: !!settings,
          hasNamingConvention: typeof settings?.namingConvention === 'string'
        };
      } catch (e) {
        return { success: false, error: e.message };
      }
    });

    console.log('[Test] Settings read result:', result);
    expect(result.success).toBe(true);
  });
});
