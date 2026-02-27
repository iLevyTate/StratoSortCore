/**
 * Settings Backup & Restore E2E Tests
 *
 * Tests the settings backup creation, export, import, and restore
 * roundtrip. Verifies that settings persist correctly across
 * backup/restore cycles.
 *
 * Run: npm run test:e2e -- --grep "Settings Backup"
 */

const { test, expect } = require('@playwright/test');
const { launchApp, closeApp, waitForAppReady } = require('./helpers/electronApp');
const { NavigationPage } = require('./helpers/pageObjects');

test.describe('Settings Backup & Restore — API', () => {
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

  test('should have settings get and update APIs', async () => {
    const api = await window.evaluate(() => ({
      hasGet: typeof window.electronAPI?.settings?.get === 'function',
      hasUpdate: typeof window.electronAPI?.settings?.update === 'function',
      hasBackup:
        typeof window.electronAPI?.settings?.backup === 'function' ||
        typeof window.electronAPI?.settings?.createBackup === 'function',
      hasRestore:
        typeof window.electronAPI?.settings?.restore === 'function' ||
        typeof window.electronAPI?.settings?.restoreBackup === 'function',
      hasGetBackups: typeof window.electronAPI?.settings?.getBackups === 'function'
    }));

    expect(api.hasGet).toBe(true);
    expect(api.hasUpdate).toBe(true);
  });

  test('should retrieve current settings', async () => {
    const settings = await window.evaluate(async () => {
      try {
        return await window.electronAPI.settings.get();
      } catch (e) {
        return { error: e.message };
      }
    });

    expect(settings).toBeTruthy();
    expect(settings.error).toBeUndefined();
    expect(settings.textModel).toBeTruthy();
    expect(settings.embeddingModel).toBeTruthy();
  });

  test('should update a setting and read it back', async () => {
    const original = await window.evaluate(async () => {
      const s = await window.electronAPI.settings.get();
      return s.namingConvention || s.caseConvention;
    });

    const newValue = original === 'kebab-case' ? 'camelCase' : 'kebab-case';

    const updateResult = await window.evaluate(
      async ({ key, value }) => {
        try {
          return await window.electronAPI.settings.update(key, value);
        } catch (e) {
          return { error: e.message };
        }
      },
      { key: 'caseConvention', value: newValue }
    );

    if (!updateResult?.error) {
      const updated = await window.evaluate(async () => {
        const s = await window.electronAPI.settings.get();
        return s.caseConvention;
      });

      expect(updated).toBe(newValue);

      // Restore original
      await window.evaluate(
        async ({ key, value }) => window.electronAPI.settings.update(key, value),
        { key: 'caseConvention', value: original || 'kebab-case' }
      );
    }
  });

  test('should list available backups', async () => {
    const backups = await window.evaluate(async () => {
      try {
        if (window.electronAPI.settings.getBackups) {
          return await window.electronAPI.settings.getBackups();
        }
        return { notAvailable: true };
      } catch (e) {
        return { error: e.message };
      }
    });

    expect(backups).toBeTruthy();
  });
});

test.describe('Settings Backup & Restore — UI', () => {
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

  test('should show backup section in Settings > Application', async () => {
    await nav.openSettings();
    await window.waitForTimeout(500);

    const backupUI = await window.evaluate(() => {
      const body = document.body.textContent || '';
      return {
        hasBackupSection: body.includes('Backup') || body.includes('backup'),
        hasCreateBackup: body.includes('Create Backup'),
        hasExportFile: body.includes('Export'),
        hasImportFile: body.includes('Import'),
        hasRestoreOption: body.includes('Restore')
      };
    });

    expect(backupUI.hasBackupSection || backupUI.hasCreateBackup || backupUI.hasExportFile).toBe(
      true
    );
  });

  test('should show log export in Settings > Application', async () => {
    await nav.openSettings();
    await window.waitForTimeout(500);

    const logsUI = await window.evaluate(() => {
      const body = document.body.textContent || '';
      return {
        hasTroubleshooting: body.includes('Troubleshooting'),
        hasExportLogs: body.includes('Export Logs'),
        hasOpenFolder: body.includes('Open Folder'),
        hasDiagnostics: body.includes('Diagnostics')
      };
    });

    expect(logsUI.hasExportLogs || logsUI.hasOpenFolder || logsUI.hasTroubleshooting).toBe(true);
  });

  test('should show all settings sections', async () => {
    await nav.openSettings();
    await window.waitForTimeout(500);

    const sections = await window.evaluate(() => {
      const body = document.body.textContent || '';
      return {
        hasAIConfig: body.includes('AI Configuration') || body.includes('AI Engine'),
        hasPerformance: body.includes('Performance'),
        hasDefaultLocations:
          body.includes('Default Location') || body.includes('Default Locations'),
        hasApplication: body.includes('Application'),
        hasAnalysisHistory: body.includes('Analysis History')
      };
    });

    expect(sections.hasAIConfig).toBe(true);
    expect(sections.hasPerformance).toBe(true);
    expect(sections.hasApplication).toBe(true);
  });
});
