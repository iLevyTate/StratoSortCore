/**
 * @jest-environment node
 */

const os = require('os');
const path = require('path');

describe('SettingsService cache', () => {
  afterEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  test('load uses cache within TTL and avoids extra disk reads', async () => {
    // Mock shared modules - using correct paths
    jest.doMock('../src/shared/atomicFileOperations', () => ({
      backupAndReplace: jest.fn().mockResolvedValue({ success: true })
    }));

    jest.doMock('../src/shared/settingsValidation', () => ({
      validateSettings: jest.fn().mockReturnValue({ valid: true, errors: [], warnings: [] }),
      sanitizeSettings: jest.fn((s) => s)
    }));

    jest.doMock('../src/shared/defaultSettings', () => ({
      DEFAULT_SETTINGS: {
        notifications: true,
        theme: 'dark',
        autoStart: false
      }
    }));

    jest.doMock('../src/shared/logger', () => ({
      logger: {
        setContext: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn()
      }
    }));

    jest.doMock('electron', () => ({
      app: {
        getPath: () => path.join(os.tmpdir(), 'stratosort-test-settings'),
        getVersion: () => '1.0.0'
      }
    }));

    const fs = require('fs');
    const readSpy = jest.spyOn(fs.promises, 'readFile');

    const SettingsService = require('../src/main/services/SettingsService');
    const svc = new SettingsService();

    // Mock createBackup method to avoid file system operations
    svc.createBackup = jest.fn().mockResolvedValue({
      success: true,
      path: '/mock/backup/path'
    });

    // First load: file may not exist -> defaults
    await svc.load();
    // Save to create file
    const saveResult = await svc.save({ notifications: false, theme: 'light' });
    expect(saveResult.settings.notifications).toBe(false);
    expect(saveResult.settings.theme).toBe('light');

    readSpy.mockClear();
    const s2 = await svc.load();
    const s3 = await svc.load();

    // Within TTL, subsequent loads should not trigger readFile
    expect(readSpy).toHaveBeenCalledTimes(0);
    expect(s2.theme).toBe('light');
    expect(s3.notifications).toBe(false);
  });
});
