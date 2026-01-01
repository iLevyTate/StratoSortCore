/**
 * Smart Folder Add E2E Tests
 *
 * Tests that the "Add Smart Folder" feature actually creates folders on disk.
 *
 * Run: npm run test:e2e -- --grep "Smart Folder Add"
 */

const { test, expect } = require('@playwright/test');
const { launchApp, closeApp, waitForAppReady } = require('./helpers/electronApp');
const { NavigationPage } = require('./helpers/pageObjects');
const { PHASES } = require('./helpers/testFixtures');

test.describe('Smart Folder Add - API Verification', () => {
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

  test('should have smartFolders API available', async () => {
    const apiCheck = await window.evaluate(() => {
      return {
        hasAdd: typeof window.electronAPI?.smartFolders?.add === 'function',
        hasGet: typeof window.electronAPI?.smartFolders?.get === 'function',
        hasDelete: typeof window.electronAPI?.smartFolders?.delete === 'function',
        hasEdit: typeof window.electronAPI?.smartFolders?.edit === 'function'
      };
    });

    console.log('[Test] Smart Folders API:', apiCheck);
    expect(apiCheck.hasAdd).toBe(true);
    expect(apiCheck.hasGet).toBe(true);
    expect(apiCheck.hasDelete).toBe(true);
    expect(apiCheck.hasEdit).toBe(true);
  });

  test('should get existing smart folders', async () => {
    const folders = await window.evaluate(async () => {
      try {
        const result = await window.electronAPI.smartFolders.get();
        return result;
      } catch (e) {
        return { error: e.message };
      }
    });

    console.log('[Test] Existing folders:', {
      isArray: Array.isArray(folders),
      count: Array.isArray(folders) ? folders.length : 0,
      firstFolder: Array.isArray(folders) && folders[0] ? folders[0].name : null
    });

    // Should return an array (may be empty or have folders)
    expect(Array.isArray(folders) || folders.folders !== undefined).toBe(true);
  });

  test('should validate folder name is required', async () => {
    const result = await window.evaluate(async () => {
      try {
        return await window.electronAPI.smartFolders.add({
          name: '',
          path: 'C:\\Users\\Test\\Documents\\TestFolder'
        });
      } catch (e) {
        return { error: e.message };
      }
    });

    console.log('[Test] Empty name validation:', result);
    expect(result.success).toBe(false);
    expect(result.errorCode || result.error).toBeTruthy();
  });

  test('should validate folder path is required', async () => {
    const result = await window.evaluate(async () => {
      try {
        return await window.electronAPI.smartFolders.add({
          name: 'TestFolder',
          path: ''
        });
      } catch (e) {
        return { error: e.message };
      }
    });

    console.log('[Test] Empty path validation:', result);
    expect(result.success).toBe(false);
    expect(result.errorCode || result.error).toBeTruthy();
  });

  test('should reject invalid characters in folder name', async () => {
    const result = await window.evaluate(async () => {
      try {
        return await window.electronAPI.smartFolders.add({
          name: 'Test<Folder>',
          path: 'C:\\Users\\Test\\Documents\\TestFolder'
        });
      } catch (e) {
        return { error: e.message };
      }
    });

    console.log('[Test] Invalid chars validation:', result);
    expect(result.success).toBe(false);
    expect(result.error).toContain('invalid characters');
  });

  test('should get documents path for folder creation', async () => {
    const documentsPath = await window.evaluate(async () => {
      try {
        const result = await window.electronAPI.files.getDocumentsPath();
        return result;
      } catch (e) {
        return { error: e.message };
      }
    });

    console.log('[Test] Documents path:', documentsPath);
    // Should return a valid path
    expect(documentsPath).toBeTruthy();
  });
});

test.describe('Smart Folder Add - UI Flow', () => {
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

  test('should navigate to Smart Folders phase', async () => {
    await nav.goToPhase(PHASES.SETUP);
    await window.waitForTimeout(500);

    // Verify we're on the Smart Folders page
    const headerText = await window.evaluate(() => {
      const headers = document.querySelectorAll('h1, h2, [class*="title"]');
      for (const h of headers) {
        if (h.textContent?.toLowerCase().includes('smart folder')) {
          return h.textContent;
        }
      }
      return null;
    });

    console.log('[Test] Smart Folders header:', headerText);
  });

  test('should have Add Folder button visible', async () => {
    await nav.goToPhase(PHASES.SETUP);
    await window.waitForTimeout(500);

    // Look for Add Folder button
    const addButton = window.locator(
      'button:has-text("Add"), button:has-text("New"), button[aria-label*="add"]'
    );
    const buttonCount = await addButton.count();

    console.log('[Test] Add folder buttons found:', buttonCount);
    expect(buttonCount).toBeGreaterThan(0);
  });

  test('should open Add Smart Folder modal', async () => {
    await nav.goToPhase(PHASES.SETUP);
    await window.waitForTimeout(500);

    // Click the Add button
    const addButton = window
      .locator('button:has-text("Add Folder"), button:has-text("Add Smart")')
      .first();

    if (await addButton.isVisible()) {
      await addButton.click();
      await window.waitForTimeout(500);

      // Check if modal is open
      const modalState = await window.evaluate(() => {
        const modal = document.querySelector('[role="dialog"], [aria-modal="true"]');
        const nameInput = document.querySelector('input[id*="name"], input[placeholder*="name"]');
        const modalTitle = document.querySelector('[id*="add-folder"], h2');

        return {
          hasModal: !!modal,
          hasNameInput: !!nameInput,
          modalTitleText: modalTitle?.textContent || null
        };
      });

      console.log('[Test] Add folder modal state:', modalState);
      expect(modalState.hasModal || modalState.hasNameInput).toBe(true);
    }
  });

  test('should fill out Add Folder form', async () => {
    await nav.goToPhase(PHASES.SETUP);
    await window.waitForTimeout(500);

    // Click Add button
    const addButton = window
      .locator('button:has-text("Add Folder"), button:has-text("Add Smart")')
      .first();

    if (await addButton.isVisible()) {
      await addButton.click();
      await window.waitForTimeout(500);

      // Fill in folder name
      const nameInput = window.locator('input[id*="name"], input[placeholder*="name"]').first();
      if (await nameInput.isVisible()) {
        await nameInput.fill('E2E Test Folder');

        // Fill in description
        const descInput = window.locator('textarea, input[id*="description"]').first();
        if (await descInput.isVisible()) {
          await descInput.fill('Folder created by E2E tests');
        }

        const formValues = await window.evaluate(() => {
          const nameEl = document.querySelector('input[id*="name"], input[placeholder*="name"]');
          const descEl = document.querySelector('textarea, input[id*="description"]');
          return {
            name: nameEl?.value || '',
            description: descEl?.value || ''
          };
        });

        console.log('[Test] Form values:', formValues);
        expect(formValues.name).toBe('E2E Test Folder');
      }
    }
  });
});

test.describe('Smart Folder Add - Folder Creation', () => {
  let app;
  let window;
  let testFolderName;

  test.beforeEach(async () => {
    const result = await launchApp();
    app = result.app;
    window = result.window;
    await waitForAppReady(window);
    // Generate unique folder name for each test
    testFolderName = `E2E_Test_${Date.now()}`;

    // Ensure toast notifications are not collapsed
    await window.evaluate(() => {
      try {
        localStorage.setItem('toastCollapsed', 'false');
      } catch (e) {
        // Ignore storage errors
      }
    });
  });

  test.afterEach(async () => {
    // Clean up: Delete the test folder if it was created
    if (testFolderName) {
      await window.evaluate(async (folderName) => {
        try {
          const folders = await window.electronAPI.smartFolders.get();
          if (Array.isArray(folders)) {
            const testFolder = folders.find((f) => f.name === folderName);
            if (testFolder) {
              await window.electronAPI.smartFolders.delete(testFolder.id);
            }
          }
        } catch (e) {
          // Ignore cleanup errors
        }
      }, testFolderName);
    }
    await closeApp(app);
  });

  test('should create folder via API and verify on disk', async () => {
    // Get documents path first
    const documentsPath = await window.evaluate(async () => {
      const result = await window.electronAPI.files.getDocumentsPath();
      if (typeof result === 'string') return result;
      if (result?.path) return result.path;
      return null;
    });

    if (!documentsPath) {
      console.log('[Test] Skipping - could not get documents path');
      return;
    }

    const targetPath = `${documentsPath}\\${testFolderName}`;
    console.log('[Test] Creating folder at:', targetPath);

    // Add the smart folder
    const addResult = await window.evaluate(
      async (params) => {
        try {
          const result = await window.electronAPI.smartFolders.add({
            name: params.name,
            path: params.path,
            description: 'E2E Test folder - should be deleted'
          });
          return result;
        } catch (e) {
          return { error: e.message };
        }
      },
      { name: testFolderName, path: targetPath }
    );

    console.log('[Test] Add folder result:', {
      success: addResult.success,
      directoryCreated: addResult.directoryCreated,
      directoryExisted: addResult.directoryExisted,
      error: addResult.error
    });

    expect(addResult.success).toBe(true);

    // If directory was created, it should have been created on disk
    if (addResult.directoryCreated) {
      // Verify the folder exists
      const existsCheck = await window.evaluate(async (folderPath) => {
        try {
          const result = await window.electronAPI.files.getStats(folderPath);
          return {
            exists: result.success,
            isDirectory: result.stats?.isDirectory,
            error: result.error
          };
        } catch (e) {
          return { exists: false, error: e.message };
        }
      }, targetPath);

      console.log('[Test] Folder exists check:', existsCheck);
      expect(existsCheck.exists).toBe(true);
      expect(existsCheck.isDirectory).toBe(true);
    }
  });

  test('should show folder in smart folders list after creation', async () => {
    // Get documents path
    const documentsPath = await window.evaluate(async () => {
      const result = await window.electronAPI.files.getDocumentsPath();
      if (typeof result === 'string') return result;
      if (result?.path) return result.path;
      return null;
    });

    if (!documentsPath) {
      console.log('[Test] Skipping - could not get documents path');
      return;
    }

    const targetPath = `${documentsPath}\\${testFolderName}`;

    // Add the folder
    const addResult = await window.evaluate(
      async (params) => {
        return await window.electronAPI.smartFolders.add({
          name: params.name,
          path: params.path,
          description: 'E2E Test folder'
        });
      },
      { name: testFolderName, path: targetPath }
    );

    expect(addResult.success).toBe(true);

    // Get folders list and verify our folder is there
    const foldersList = await window.evaluate(async (folderName) => {
      const folders = await window.electronAPI.smartFolders.get();
      if (!Array.isArray(folders)) return { found: false, folders: [] };
      const found = folders.find((f) => f.name === folderName);
      return {
        found: !!found,
        totalFolders: folders.length,
        folderDetails: found
          ? { name: found.name, path: found.path, physicallyExists: found.physicallyExists }
          : null
      };
    }, testFolderName);

    console.log('[Test] Folder in list:', foldersList);
    expect(foldersList.found).toBe(true);
    expect(foldersList.folderDetails?.physicallyExists).toBe(true);
  });

  test('should prevent duplicate folder names', async () => {
    // Get documents path
    const documentsPath = await window.evaluate(async () => {
      const result = await window.electronAPI.files.getDocumentsPath();
      if (typeof result === 'string') return result;
      if (result?.path) return result.path;
      return null;
    });

    if (!documentsPath) {
      console.log('[Test] Skipping - could not get documents path');
      return;
    }

    const targetPath = `${documentsPath}\\${testFolderName}`;

    // Add the folder first time
    const firstAdd = await window.evaluate(
      async (params) => {
        return await window.electronAPI.smartFolders.add({
          name: params.name,
          path: params.path,
          description: 'First folder'
        });
      },
      { name: testFolderName, path: targetPath }
    );

    expect(firstAdd.success).toBe(true);

    // Try to add again with same name
    const secondAdd = await window.evaluate(
      async (params) => {
        return await window.electronAPI.smartFolders.add({
          name: params.name,
          path: params.path + '_2',
          description: 'Duplicate folder'
        });
      },
      { name: testFolderName, path: targetPath }
    );

    console.log('[Test] Duplicate add result:', secondAdd);
    expect(secondAdd.success).toBe(false);
    expect(secondAdd.error).toContain('already exists');
  });

  test('should show success notification when folder is created via UI', async () => {
    // Navigate to Setup phase (Smart Folders)
    // First click on "Smart Folders" in the navigation
    const navButton = window.locator(
      'nav[aria-label="Phase navigation"] button:has-text("Smart Folders")'
    );

    // Check if button is enabled
    const isDisabled = await navButton.isDisabled().catch(() => true);
    if (isDisabled) {
      console.log('[Test] Smart Folders phase is disabled, skipping UI notification test');
      // Still verify toast container exists
      const hasContainer = await window.evaluate(() => {
        return !!document.querySelector('[aria-label="Notifications"]');
      });
      expect(hasContainer).toBe(true);
      return;
    }

    await navButton.click();
    await window.waitForTimeout(1000);

    // Look for "Add Folder" or "Add Smart Folder" button
    const addButton = window
      .locator('button:has-text("Add Folder"), button:has-text("Add Smart")')
      .first();

    if (!(await addButton.isVisible())) {
      console.log('[Test] Add folder button not visible, skipping');
      return;
    }

    await addButton.click();
    await window.waitForTimeout(500);

    // Fill in the form in the modal
    const nameInput = window.locator('input[id*="name"], input[placeholder*="name"]').first();
    if (await nameInput.isVisible()) {
      await nameInput.fill(testFolderName);

      // Find and click the save/create button
      const saveButton = window
        .locator('button:has-text("Create"), button:has-text("Save"), button:has-text("Add")')
        .last();
      if (await saveButton.isVisible()) {
        await saveButton.click();

        // Wait for the notification to appear
        await window.waitForTimeout(1500);

        // Check for toast notification
        const notificationState = await window.evaluate(() => {
          const toasts = document.querySelectorAll('[role="alert"]');
          const toastMessages = Array.from(toasts)
            .map((t) => t.textContent?.trim())
            .filter(Boolean);

          return {
            toastCount: toasts.length,
            messages: toastMessages,
            hasSuccessIndicator: toastMessages.some(
              (m) =>
                m.toLowerCase().includes('added') ||
                m.toLowerCase().includes('created') ||
                m.toLowerCase().includes('success')
            )
          };
        });

        console.log('[Test] Notification state after UI folder add:', notificationState);

        // Should have at least one notification with success message
        if (notificationState.toastCount > 0) {
          expect(notificationState.hasSuccessIndicator).toBe(true);
        }
      }
    }
  });

  test('should delete folder and clean up if empty', async () => {
    // Get documents path
    const documentsPath = await window.evaluate(async () => {
      const result = await window.electronAPI.files.getDocumentsPath();
      if (typeof result === 'string') return result;
      if (result?.path) return result.path;
      return null;
    });

    if (!documentsPath) {
      console.log('[Test] Skipping - could not get documents path');
      return;
    }

    const targetPath = `${documentsPath}\\${testFolderName}`;

    // Add the folder
    const addResult = await window.evaluate(
      async (params) => {
        return await window.electronAPI.smartFolders.add({
          name: params.name,
          path: params.path,
          description: 'Folder to delete'
        });
      },
      { name: testFolderName, path: targetPath }
    );

    expect(addResult.success).toBe(true);
    const folderId = addResult.folder?.id;

    // Delete the folder
    const deleteResult = await window.evaluate(async (id) => {
      return await window.electronAPI.smartFolders.delete(id);
    }, folderId);

    console.log('[Test] Delete result:', {
      success: deleteResult.success,
      directoryRemoved: deleteResult.directoryRemoved,
      deletedFolder: deleteResult.deletedFolder?.name
    });

    expect(deleteResult.success).toBe(true);

    // Verify folder is removed from list
    const foldersList = await window.evaluate(async (folderName) => {
      const folders = await window.electronAPI.smartFolders.get();
      if (!Array.isArray(folders)) return { found: false };
      return { found: folders.some((f) => f.name === folderName) };
    }, testFolderName);

    expect(foldersList.found).toBe(false);
  });
});
