/**
 * @jest-environment node
 */
// Unmock fs to use real filesystem for these tests
// The global test-setup mocks fs with memfs, but this causes issues when
// spying on real fs operations. These tests need the real filesystem.
jest.unmock('fs');
jest.unmock('fs/promises');
jest.unmock('os');

const fs = require('fs').promises;
const path = require('path');
const os = require('os');

// Mock electron before importing
jest.mock('electron', () => ({
  app: {
    getPath: jest.fn(),
    getVersion: jest.fn(() => '1.0.0'),
  },
}));

// Mock atomicFileOperations - backupAndReplace is used by save()
const mockBackupAndReplace = jest.fn();
jest.mock('../src/shared/atomicFileOperations', () => {
  const actual = jest.requireActual('../src/shared/atomicFileOperations');
  return {
    ...actual,
    backupAndReplace: mockBackupAndReplace,
  };
});

const { app } = require('electron');

const SettingsService = require('../src/main/services/SettingsService');

describe('SettingsService atomic save', () => {
  let tempDir;
  let service;
  let filePath;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'settings-test-'));
    app.getPath.mockReturnValue(tempDir);
    service = new SettingsService();
    filePath = path.join(tempDir, 'settings.json');

    // Reset mocks
    jest.clearAllMocks();
    mockBackupAndReplace.mockReset();
  });

  afterEach(async () => {
    // Stop file watcher to prevent handles
    service._stopFileWatcher?.();

    // Cleanup temp directory
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  test('interrupted write leaves original file intact', async () => {
    // Write original settings file
    const originalSettings = { theme: 'dark' };
    await fs.writeFile(filePath, JSON.stringify(originalSettings, null, 2));

    // Mock backupAndReplace to reject with an error (simulating write failure)
    mockBackupAndReplace.mockRejectedValueOnce(new Error('simulated failure'));

    // Attempt to save should fail
    await expect(service.save({ theme: 'light' })).rejects.toThrow(
      'simulated failure',
    );

    // Original file should still have the dark theme
    const content = JSON.parse(await fs.readFile(filePath, 'utf-8'));
    expect(content.theme).toBe('dark');
  });

  test('successful save updates the file', async () => {
    // Write original settings file
    const originalSettings = { theme: 'dark' };
    await fs.writeFile(filePath, JSON.stringify(originalSettings, null, 2));

    // Mock backupAndReplace to succeed and actually write the file
    mockBackupAndReplace.mockImplementation(async (targetPath, content) => {
      await fs.writeFile(targetPath, content);
      return { success: true };
    });

    // Save should succeed
    const result = await service.save({ theme: 'light' });
    expect(result.settings.theme).toBe('light');

    // File should have new theme
    const content = JSON.parse(await fs.readFile(filePath, 'utf-8'));
    expect(content.theme).toBe('light');
  });
});
