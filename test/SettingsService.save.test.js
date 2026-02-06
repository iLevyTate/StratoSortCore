/**
 * SettingsService save/mutex tests
 * Focus: backup + retry + cache rollback + mutex deadlock safety.
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
    readFile: jest.fn(),
    writeFile: jest.fn(),
    access: jest.fn(),
    mkdir: jest.fn(),
    readdir: jest.fn(),
    stat: jest.fn(),
    unlink: jest.fn(),
    rename: jest.fn()
  };
  return {
    promises,
    watch: jest.fn(),
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

jest.mock('../src/shared/settingsValidation', () => ({
  validateSettings: jest.fn(() => ({ valid: true, errors: [], warnings: [] })),
  sanitizeSettings: jest.fn((s) => s)
}));

jest.mock('../src/shared/atomicFileOperations', () => ({
  backupAndReplace: jest.fn()
}));

jest.mock('../src/main/services/SettingsBackupService', () => ({
  SettingsBackupService: jest.fn().mockImplementation(() => ({
    createBackup: jest
      .fn()
      .mockResolvedValue({ success: true, path: 'C:\\user-data\\settings-backups\\b1.json' }),
    deleteBackup: jest.fn().mockResolvedValue({ success: true }),
    listBackups: jest.fn().mockResolvedValue([]),
    restoreFromBackup: jest.fn()
  }))
}));

jest.mock('../src/main/ipc/ipcWrappers', () => ({
  safeSend: jest.fn()
}));

describe('SettingsService.save (mutex/backups/retries)', () => {
  function loadService() {
    jest.resetModules();
    const SettingsService = require('../src/main/services/SettingsService');
    jest.spyOn(SettingsService.prototype, '_startFileWatcher').mockImplementation(() => {});
    return SettingsService;
  }

  const flushMicrotasks = async () => {
    await Promise.resolve();
    await Promise.resolve();
  };

  const getBackupAndReplace = () => require('../src/shared/atomicFileOperations').backupAndReplace;

  const advance = async (ms) => {
    // Prefer async timer advancement when available (modern fake timers)
    if (typeof jest.advanceTimersByTimeAsync === 'function') {
      await jest.advanceTimersByTimeAsync(ms);
      return;
    }
    jest.advanceTimersByTime(ms);
    await flushMicrotasks();
  };

  test('save creates backup, writes settings, and updates cache', async () => {
    const SettingsService = loadService();
    const service = new SettingsService();
    const backupAndReplace = getBackupAndReplace();

    service._loadRaw = jest.fn().mockResolvedValue({ confidenceThreshold: 0.5, textModel: 'x' });
    service.createBackup = jest.fn().mockResolvedValue({ success: true, path: 'C:\\b.json' });
    backupAndReplace.mockResolvedValue({ success: true });

    const res = await service.save({ confidenceThreshold: 0.9, textModel: 'y' });

    expect(service.createBackup).toHaveBeenCalled();
    expect(backupAndReplace).toHaveBeenCalledWith(service.settingsPath, expect.any(String));
    expect(res.backupCreated).toBe(true);
    expect(res.settings).toEqual(
      expect.objectContaining({ confidenceThreshold: 0.9, textModel: 'y' })
    );
    expect(service._cache).toEqual(
      expect.objectContaining({ confidenceThreshold: 0.9, textModel: 'y' })
    );
  });

  test('save retries backup creation with exponential backoff on exception', async () => {
    const SettingsService = loadService();
    const service = new SettingsService();
    jest.useFakeTimers();
    const backupAndReplace = getBackupAndReplace();

    service._loadRaw = jest.fn().mockResolvedValue({ confidenceThreshold: 0.5 });
    const createBackup = jest
      .fn()
      .mockRejectedValueOnce(new Error('backup fail'))
      .mockResolvedValueOnce({ success: true, path: 'C:\\b.json' });
    service.createBackup = createBackup;
    backupAndReplace.mockResolvedValue({ success: true });

    const p = service.save({ confidenceThreshold: 0.6 });
    await flushMicrotasks();

    // first attempt failed -> should schedule 100ms backoff before retry
    await advance(100);

    await expect(p).resolves.toEqual(expect.objectContaining({ backupCreated: true }));
    expect(createBackup).toHaveBeenCalledTimes(2);

    jest.useRealTimers();
  });

  test('save retries backupAndReplace on Windows file lock errors', async () => {
    const SettingsService = loadService();
    const service = new SettingsService();
    jest.useFakeTimers();
    const backupAndReplace = getBackupAndReplace();

    service._loadRaw = jest.fn().mockResolvedValue({ confidenceThreshold: 0.5 });
    service.createBackup = jest.fn().mockResolvedValue({ success: true, path: 'C:\\b.json' });

    const lockErr = Object.assign(new Error('locked'), { code: 'EBUSY' });
    backupAndReplace
      .mockRejectedValueOnce(lockErr)
      .mockRejectedValueOnce(lockErr)
      .mockResolvedValueOnce({ success: true });

    const p = service.save({ confidenceThreshold: 0.6 });
    await flushMicrotasks();

    // Backoff delays: 200ms then 400ms
    await advance(200);
    await advance(400);

    await expect(p).resolves.toEqual(expect.objectContaining({ backupCreated: true }));
    expect(backupAndReplace).toHaveBeenCalledTimes(3);

    jest.useRealTimers();
  });

  test('save rolls back cache and deletes orphan backup on persistent lock failure', async () => {
    const SettingsService = loadService();
    const service = new SettingsService();
    jest.useFakeTimers();
    const backupAndReplace = getBackupAndReplace();

    service._cache = { confidenceThreshold: 0.1, textModel: 'old' };
    service._cacheTimestamp = 123;

    service._loadRaw = jest.fn().mockResolvedValue({ confidenceThreshold: 0.1, textModel: 'old' });
    service.createBackup = jest.fn().mockResolvedValue({ success: true, path: 'C:\\orphan.json' });

    const lockErr = Object.assign(new Error('locked'), { code: 'EPERM' });
    backupAndReplace.mockRejectedValue(lockErr);
    service._backupService.deleteBackup = jest.fn().mockResolvedValue({ success: true });

    const p = service.save({ textModel: 'new' });
    // Attach rejection handler immediately to avoid unhandled rejection failures
    const assertion = expect(p).rejects.toThrow(/Failed to save settings after 5 attempts/);
    await flushMicrotasks();

    // 5 attempts: delays 200, 400, 800, 1600 between attempts
    for (const delay of [200, 400, 800, 1600]) {
      await advance(delay);
    }

    await assertion;
    expect(service._cache).toEqual({ confidenceThreshold: 0.1, textModel: 'old' });
    expect(service._cacheTimestamp).toBe(123);
    expect(service._backupService.deleteBackup).toHaveBeenCalledWith('C:\\orphan.json');

    jest.useRealTimers();
  });

  test('_withMutex detects deadlock and releases chain so subsequent operations can proceed', async () => {
    const SettingsService = loadService();
    const service = new SettingsService();
    jest.useFakeTimers();

    service._mutexTimeoutMs = 50;
    service._saveMutex = new Promise(() => {}); // never resolves -> acquisition deadlock

    const p1 = service._withMutex(async () => 'x');
    jest.advanceTimersByTime(60);

    await expect(p1).rejects.toEqual(
      expect.objectContaining({
        name: 'MutexTimeoutError'
      })
    );

    // chain should still be usable
    service._saveMutex = Promise.resolve();
    await expect(service._withMutex(async () => 'ok')).resolves.toBe('ok');

    jest.useRealTimers();
  });

  test('internal-change flag resets after save unless shutting down', async () => {
    const SettingsService = loadService();
    const service = new SettingsService();
    jest.useFakeTimers();
    const backupAndReplace = getBackupAndReplace();

    service._loadRaw = jest.fn().mockResolvedValue({ confidenceThreshold: 0.5 });
    service.createBackup = jest.fn().mockResolvedValue({ success: true, path: 'C:\\b.json' });
    backupAndReplace.mockResolvedValue({ success: true });

    await service.save({ confidenceThreshold: 0.6 });
    expect(service._isInternalChange).toBe(true);

    await advance(120);
    expect(service._isInternalChange).toBe(false);

    // if shutting down before the timer fires, callback should not clear internal change
    await service.save({ confidenceThreshold: 0.7 });
    expect(service._isInternalChange).toBe(true);
    service._isShuttingDown = true;
    await advance(120);
    expect(service._isInternalChange).toBe(true);

    jest.useRealTimers();
  });
});
