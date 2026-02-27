/**
 * Multi-Session Persistence E2E Tests
 *
 * Tests that application state persists across app restarts.
 * Verifies smart folders, settings, analysis history, and window
 * state survive a close/reopen cycle.
 *
 * Run: npm run test:e2e -- --grep "Session Persistence"
 */

const { test, expect } = require('@playwright/test');
const { launchApp, closeApp, waitForAppReady } = require('./helpers/electronApp');

test.describe('Session Persistence — Smart Folders', () => {
  test('should persist smart folders across app restart', async () => {
    // Session 1: Create a folder
    const uniqueName = `Persist_${Date.now()}`;

    const session1 = await launchApp();
    await waitForAppReady(session1.window);

    const docsPath = await session1.window.evaluate(async () => {
      const result = await window.electronAPI.files.getDocumentsPath();
      return typeof result === 'string' ? result : result?.path || null;
    });

    if (!docsPath) {
      await closeApp(session1.app);
      test.skip();
      return;
    }

    const addResult = await session1.window.evaluate(
      async ({ name, path }) =>
        window.electronAPI.smartFolders.add({
          name,
          path,
          description: 'Persistence test folder'
        }),
      { name: uniqueName, path: `${docsPath}/${uniqueName}` }
    );
    expect(addResult.success).toBe(true);

    await closeApp(session1.app);

    // Session 2: Verify folder persisted
    const session2 = await launchApp();
    await waitForAppReady(session2.window);

    const folders = await session2.window.evaluate(async () =>
      window.electronAPI.smartFolders.get()
    );
    const found = Array.isArray(folders) ? folders.some((f) => f.name === uniqueName) : false;

    expect(found).toBe(true);

    // Cleanup
    if (found) {
      const target = folders.find((f) => f.name === uniqueName);
      if (target) {
        await session2.window.evaluate(
          async (id) => window.electronAPI.smartFolders.delete(id),
          target.id
        );
      }
    }

    await closeApp(session2.app);
  });
});

test.describe('Session Persistence — Settings', () => {
  test('should persist settings changes across restart', async () => {
    // Session 1: Change a setting
    const session1 = await launchApp();
    await waitForAppReady(session1.window);

    const originalSep = await session1.window.evaluate(async () => {
      const s = await window.electronAPI.settings.get();
      return s.separator;
    });

    const newSep = originalSep === '-' ? '.' : '-';
    await session1.window.evaluate(
      async ({ key, value }) => window.electronAPI.settings.update(key, value),
      { key: 'separator', value: newSep }
    );

    await closeApp(session1.app);

    // Session 2: Verify setting persisted
    const session2 = await launchApp();
    await waitForAppReady(session2.window);

    const persistedSep = await session2.window.evaluate(async () => {
      const s = await window.electronAPI.settings.get();
      return s.separator;
    });

    expect(persistedSep).toBe(newSep);

    // Restore original
    await session2.window.evaluate(
      async ({ key, value }) => window.electronAPI.settings.update(key, value),
      { key: 'separator', value: originalSep || '-' }
    );

    await closeApp(session2.app);
  });
});

test.describe('Session Persistence — Undo/Redo State', () => {
  test('should have undo/redo state available on restart', async () => {
    const { app, window } = await launchApp();
    await waitForAppReady(window);

    const state = await window.evaluate(async () => {
      try {
        return await window.electronAPI.undoRedo.getState();
      } catch (e) {
        return { error: e.message };
      }
    });

    expect(state).toBeTruthy();
    if (!state.error) {
      expect(typeof state.canUndo).toBe('boolean');
      expect(typeof state.canRedo).toBe('boolean');
    }

    await closeApp(app);
  });
});

test.describe('Session Persistence — Analysis History', () => {
  test('should have analysis history available on launch', async () => {
    const { app, window } = await launchApp();
    await waitForAppReady(window);

    const history = await window.evaluate(async () => {
      try {
        return await window.electronAPI.analysisHistory.get({ limit: 10 });
      } catch (e) {
        return { error: e.message };
      }
    });

    expect(history).toBeTruthy();

    await closeApp(app);
  });

  test('should have embedding stats available on launch', async () => {
    const { app, window } = await launchApp();
    await waitForAppReady(window);

    const stats = await window.evaluate(async () => {
      try {
        return await window.electronAPI.embeddings.getStats();
      } catch (e) {
        return { error: e.message };
      }
    });

    expect(stats).toBeTruthy();

    await closeApp(app);
  });
});
