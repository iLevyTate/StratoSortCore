const { test, expect } = require('@playwright/test');
const { launchApp, closeApp, waitForAppReady } = require('./helpers/electronApp');
const { NavigationPage } = require('./helpers/pageObjects');

function toBool(value, fallback = false) {
  return typeof value === 'boolean' ? value : fallback;
}

test.describe('Settings Subcategories Smoke', () => {
  let app;
  let window;
  let nav;
  let originalSettings = null;

  async function getCurrentSettings(page) {
    return page.evaluate(async () => {
      const settings = await window.electronAPI?.settings?.get();
      return settings && typeof settings === 'object' ? settings : {};
    });
  }

  async function setSwitchByLabel(page, labelText, desired) {
    const heading = page.locator('h3', { hasText: labelText }).first();
    const row = heading.locator('xpath=ancestor::div[.//button[@role="switch"]][1]');
    const toggle = row.locator('button[role="switch"]').first();
    await expect(toggle).toBeVisible({ timeout: 10000 });
    const checked = (await toggle.getAttribute('aria-checked')) === 'true';
    if (checked !== desired) {
      await toggle.click();
    }
  }

  async function selectFromTrigger(page, trigger, optionText) {
    await trigger.click();
    await page.locator('[role="option"]', { hasText: optionText }).first().click();
  }

  test.beforeEach(async () => {
    const result = await launchApp();
    app = result.app;
    window = result.window;
    await waitForAppReady(window);
    nav = new NavigationPage(window);
    originalSettings = await getCurrentSettings(window);
  });

  test.afterEach(async () => {
    if (window && originalSettings && typeof originalSettings === 'object') {
      await window
        .evaluate(async (settingsToRestore) => {
          await window.electronAPI?.settings?.save(settingsToRestore);
        }, originalSettings)
        .catch(() => {});
    }
    await closeApp(app);
  });

  test('applies and persists representative settings across subcategories', async () => {
    const expected = {
      autoOrganize: !toBool(originalSettings.autoOrganize, false),
      backgroundMode: !toBool(originalSettings.backgroundMode, false),
      notifications: !toBool(originalSettings.notifications, true),
      autoChunkOnAnalysis: !toBool(originalSettings.autoChunkOnAnalysis, true),
      graphExpansionEnabled: !toBool(originalSettings.graphExpansionEnabled, true),
      maxConcurrentAnalysis: Math.min(
        10,
        Math.max(1, Number(originalSettings.maxConcurrentAnalysis || 2) + 1)
      ),
      namingConvention:
        originalSettings.namingConvention === 'subject-date' ? 'date-subject' : 'subject-date',
      chatPersona:
        originalSettings.chatPersona === 'informal-helper'
          ? 'professional-researcher'
          : 'informal-helper',
      defaultSmartFolderLocation: 'Documents'
    };

    const opened = await nav.openSettings();
    expect(opened).toBe(true);

    const settingsModal = window.locator('h2:has-text("Settings")').first();
    await expect(settingsModal).toBeVisible({ timeout: 10000 });
    const expandAllButton = window
      .locator('button[aria-label="Expand all settings sections"]')
      .first();
    if (await expandAllButton.isVisible().catch(() => false)) {
      await expandAllButton.click();
    } else {
      const sectionExpandButtons = window.getByRole('button', { name: 'Expand section' });
      const expandCount = await sectionExpandButtons.count();
      for (let i = 0; i < expandCount; i += 1) {
        await sectionExpandButtons.nth(i).click();
      }
    }

    // Performance
    await setSwitchByLabel(window, 'Auto-organize Downloads', expected.autoOrganize);
    await setSwitchByLabel(window, 'Background Mode', expected.backgroundMode);
    await setSwitchByLabel(window, 'Enable Graph Expansion', expected.graphExpansionEnabled);
    await window.locator('input[aria-label="Max concurrent analysis"]').first().fill('');
    await window
      .locator('input[aria-label="Max concurrent analysis"]')
      .first()
      .fill(String(expected.maxConcurrentAnalysis));

    // Defaults
    await window
      .locator('input[placeholder="Documents"]')
      .first()
      .fill(expected.defaultSmartFolderLocation);
    await selectFromTrigger(
      window,
      window.locator('#settings-naming-convention').first(),
      expected.namingConvention
    );

    // AI
    await setSwitchByLabel(window, 'Auto-generate Chunk Embeddings', expected.autoChunkOnAnalysis);
    const personaHeading = window.locator('h3', { hasText: 'Persona Preset' }).first();
    const personaTrigger = personaHeading
      .locator('xpath=ancestor::div[.//button[@aria-haspopup="listbox"]][1]')
      .locator('button[aria-haspopup="listbox"]')
      .first();
    await selectFromTrigger(
      window,
      personaTrigger,
      expected.chatPersona === 'informal-helper' ? 'Informal Helper' : 'Professional Researcher'
    );

    // Application
    await setSwitchByLabel(window, 'Enable Notifications', expected.notifications);

    await window.locator('button:has-text("Save Settings")').first().click();
    await expect(window.locator('h2:has-text("Settings")').first()).toBeHidden({ timeout: 15000 });

    const persisted = await getCurrentSettings(window);

    expect(persisted.autoOrganize).toBe(expected.autoOrganize);
    expect(persisted.backgroundMode).toBe(expected.backgroundMode);
    expect(persisted.notifications).toBe(expected.notifications);
    expect(persisted.autoChunkOnAnalysis).toBe(expected.autoChunkOnAnalysis);
    expect(persisted.graphExpansionEnabled).toBe(expected.graphExpansionEnabled);
    expect(persisted.maxConcurrentAnalysis).toBe(expected.maxConcurrentAnalysis);
    expect(persisted.namingConvention).toBe(expected.namingConvention);
    expect(persisted.chatPersona).toBe(expected.chatPersona);

    // Re-open to verify UI reflects persisted values.
    const reopened = await nav.openSettings();
    expect(reopened).toBe(true);
    await expect(window.locator('h2:has-text("Settings")').first()).toBeVisible();
    const reopenExpandAllButton = window
      .locator('button[aria-label="Expand all settings sections"]')
      .first();
    if (await reopenExpandAllButton.isVisible().catch(() => false)) {
      await reopenExpandAllButton.click();
    }

    await expect(window.locator('input[aria-label="Max concurrent analysis"]').first()).toHaveValue(
      String(expected.maxConcurrentAnalysis)
    );
    await expect(window.locator('#settings-naming-convention').first()).toContainText(
      expected.namingConvention
    );
    await window.keyboard.press('Escape');
  });
});
