/**
 * SettingsService watcher/debounce tests
 * Focus: ignoring internal changes, ignoring rename events, and debouncing change events.
 */

jest.mock('electron', () => ({
  app: {
    getPath: jest.fn(() => 'C:\\user-data')
  },
  BrowserWindow: {
    getAllWindows: jest.fn(() => [])
  }
}));

jest.mock('fs', () => {
  const promises = {
    access: jest.fn(),
    mkdir: jest.fn(),
    writeFile: jest.fn()
  };
  const watch = jest.fn();
  return {
    promises,
    watch,
    existsSync: jest.fn(() => true)
  };
});

jest.mock('../src/shared/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    setContext: jest.fn()
  },
  createLogger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    setContext: jest.fn()
  })
}));

jest.mock('../src/main/services/SettingsBackupService', () => ({
  SettingsBackupService: jest.fn().mockImplementation(() => ({
    createBackup: jest.fn(),
    deleteBackup: jest.fn(),
    listBackups: jest.fn().mockResolvedValue([]),
    restoreFromBackup: jest.fn()
  }))
}));

jest.mock('../src/main/ipc/ipcWrappers', () => ({
  safeSend: jest.fn()
}));

describe('SettingsService watcher', () => {
  const flushMicrotasks = async () => {
    await Promise.resolve();
    await Promise.resolve();
  };

  const advance = async (ms) => {
    if (typeof jest.advanceTimersByTimeAsync === 'function') {
      await jest.advanceTimersByTimeAsync(ms);
      return;
    }
    jest.advanceTimersByTime(ms);
    await flushMicrotasks();
  };

  test('_startFileWatcher ignores internal changes and rename events; debounces change events', async () => {
    jest.useFakeTimers();

    jest.resetModules();
    const fs = require('fs');
    const fsPromises = fs.promises;

    // capture watch callback + error handler
    let watchCallback = null;
    let onError = null;

    fs.watch.mockImplementation((_path, cb) => {
      watchCallback = cb;
      return {
        on: (eventName, handler) => {
          if (eventName === 'error') onError = handler;
        },
        close: jest.fn()
      };
    });

    fsPromises.access.mockResolvedValue(undefined);
    fsPromises.mkdir.mockResolvedValue(undefined);
    fsPromises.writeFile.mockResolvedValue(undefined);

    const SettingsService = require('../src/main/services/SettingsService');
    const service = new SettingsService();

    // Spy handler and notify
    service._handleExternalFileChange = jest.fn().mockResolvedValue(undefined);
    service._notifySettingsChanged = jest.fn().mockResolvedValue(undefined);

    // ensure watcher initialized
    await service._startFileWatcher();
    expect(typeof watchCallback).toBe('function');

    // rename events ignored
    watchCallback('rename', 'settings.json');
    await advance(service._debounceDelay + 10);
    expect(service._handleExternalFileChange).not.toHaveBeenCalled();

    // internal changes ignored
    service._isInternalChange = true;
    watchCallback('change', 'settings.json');
    await advance(service._debounceDelay + 10);
    expect(service._handleExternalFileChange).not.toHaveBeenCalled();

    // external change event is debounced: multiple rapid changes -> one call
    service._isInternalChange = false;
    watchCallback('change', 'settings.json');
    watchCallback('change', 'settings.json');
    watchCallback('change', 'settings.json');
    await advance(service._debounceDelay + 10);
    expect(service._handleExternalFileChange).toHaveBeenCalledTimes(1);

    // watcher error clears timers and schedules restart (we only assert handler exists and callable)
    expect(typeof onError).toBe('function');
    onError(new Error('watcher broke'));

    jest.useRealTimers();
  });
});
