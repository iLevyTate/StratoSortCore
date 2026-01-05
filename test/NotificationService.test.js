/**
 * Unit tests for NotificationService
 */

jest.mock('electron', () => {
  const notificationInstances = [];
  const Notification = jest.fn().mockImplementation((opts) => {
    const inst = { opts, show: jest.fn() };
    notificationInstances.push(inst);
    return inst;
  });
  Notification.isSupported = jest.fn(() => true);

  const windows = [];
  const BrowserWindow = {
    getAllWindows: jest.fn(() => windows)
  };

  return {
    Notification,
    BrowserWindow,
    __notificationInstances: notificationInstances,
    __windows: windows
  };
});

jest.mock('../src/shared/logger', () => ({
  logger: {
    setContext: jest.fn(),
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  }
}));

const electron = require('electron');
const { logger } = require('../src/shared/logger');
const NotificationService = require('../src/main/services/NotificationService');

describe('NotificationService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Clear mocked electron state
    electron.__notificationInstances.length = 0;
    electron.__windows.length = 0;
  });

  test('_getSettings caches settings for ttl', async () => {
    const settingsService = { load: jest.fn().mockResolvedValue({ notifications: true }) };
    const svc = new NotificationService({ settingsService });

    const a = await svc._getSettings();
    const b = await svc._getSettings();

    expect(a.notifications).toBe(true);
    expect(b.notifications).toBe(true);
    expect(settingsService.load).toHaveBeenCalledTimes(1);
  });

  test('_getSettings falls back to defaults when settings load fails', async () => {
    const settingsService = { load: jest.fn().mockRejectedValue(new Error('boom')) };
    const svc = new NotificationService({ settingsService });

    const s = await svc._getSettings();
    expect(s).toMatchObject({
      notifications: true,
      notificationMode: 'both',
      notifyOnAutoAnalysis: true,
      notifyOnLowConfidence: true
    });
    expect(logger.warn).toHaveBeenCalled();
  });

  test('_sendToUi sends to all non-destroyed windows', () => {
    const settingsService = { load: jest.fn().mockResolvedValue({ notifications: true }) };
    const svc = new NotificationService({ settingsService });

    const goodWin = {
      isDestroyed: () => false,
      webContents: { send: jest.fn() }
    };
    const deadWin = {
      isDestroyed: () => true,
      webContents: { send: jest.fn() }
    };
    electron.__windows.push(goodWin, deadWin);

    svc._sendToUi({ type: 'x' });

    expect(goodWin.webContents.send).toHaveBeenCalledWith('notification', { type: 'x' });
    expect(deadWin.webContents.send).not.toHaveBeenCalled();
  });

  test('_showTrayNotification does nothing when Notification not supported', () => {
    const settingsService = { load: jest.fn().mockResolvedValue({ notifications: true }) };
    const svc = new NotificationService({ settingsService });

    const { Notification } = require('electron');
    Notification.isSupported.mockReturnValueOnce(false);

    svc._showTrayNotification('t', 'b');

    expect(Notification).not.toHaveBeenCalled();
    expect(logger.debug).toHaveBeenCalled();
  });

  test('notifyFileOrganized sends tray + ui when mode is both', async () => {
    const settingsService = {
      load: jest.fn().mockResolvedValue({ notifications: true, notificationMode: 'both' })
    };
    const svc = new NotificationService({ settingsService });
    const traySpy = jest.spyOn(svc, '_showTrayNotification');
    const uiSpy = jest.spyOn(svc, '_sendToUi');

    await svc.notifyFileOrganized('a.pdf', 'Finance', 95);

    expect(traySpy).toHaveBeenCalled();
    expect(uiSpy).toHaveBeenCalledWith(
      expect.objectContaining({ type: NotificationService.NotificationType.FILE_ORGANIZED })
    );
  });

  test('notifyFileOrganized respects notificationMode ui/tray/none', async () => {
    const settingsService = {
      load: jest.fn().mockResolvedValue({ notifications: true, notificationMode: 'ui' })
    };
    const svc = new NotificationService({ settingsService });
    const traySpy = jest.spyOn(svc, '_showTrayNotification');
    const uiSpy = jest.spyOn(svc, '_sendToUi');

    await svc.notifyFileOrganized('a.pdf', 'Finance', 95);
    expect(traySpy).not.toHaveBeenCalled();
    expect(uiSpy).toHaveBeenCalled();

    // Switch mode via cache invalidation
    svc.invalidateCache();
    settingsService.load.mockResolvedValueOnce({ notifications: true, notificationMode: 'tray' });
    await svc.notifyFileOrganized('a.pdf', 'Finance', 95);
    expect(traySpy).toHaveBeenCalled();

    svc.invalidateCache();
    settingsService.load.mockResolvedValueOnce({ notifications: true, notificationMode: 'none' });
    traySpy.mockClear();
    uiSpy.mockClear();
    await svc.notifyFileOrganized('a.pdf', 'Finance', 95);
    expect(traySpy).not.toHaveBeenCalled();
    expect(uiSpy).not.toHaveBeenCalled();
  });

  test('notifyFileAnalyzed respects notifyOnAutoAnalysis', async () => {
    const settingsService = {
      load: jest.fn().mockResolvedValue({
        notifications: true,
        notifyOnAutoAnalysis: false,
        notificationMode: 'both'
      })
    };
    const svc = new NotificationService({ settingsService });
    const traySpy = jest.spyOn(svc, '_showTrayNotification');
    const uiSpy = jest.spyOn(svc, '_sendToUi');

    await svc.notifyFileAnalyzed('a.pdf', 'download', { category: 'Docs', confidence: 80 });
    expect(traySpy).not.toHaveBeenCalled();
    expect(uiSpy).not.toHaveBeenCalled();
  });

  test('notifyLowConfidence includes suggested folder when provided', async () => {
    const settingsService = {
      load: jest.fn().mockResolvedValue({
        notifications: true,
        notifyOnLowConfidence: true,
        notificationMode: 'ui'
      })
    };
    const svc = new NotificationService({ settingsService });
    const uiSpy = jest.spyOn(svc, '_sendToUi');

    await svc.notifyLowConfidence('a.pdf', 40, 70, 'Finance');
    expect(uiSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: NotificationService.NotificationType.LOW_CONFIDENCE,
        message: expect.stringContaining('suggested: Finance')
      })
    );
  });

  test('notifyBatchComplete sets warning variant when needsReview or failed > 0', async () => {
    const settingsService = {
      load: jest.fn().mockResolvedValue({ notifications: true, notificationMode: 'ui' })
    };
    const svc = new NotificationService({ settingsService });
    const uiSpy = jest.spyOn(svc, '_sendToUi');

    await svc.notifyBatchComplete(1, 0, 0);
    expect(uiSpy).toHaveBeenCalledWith(expect.objectContaining({ variant: 'success' }));

    uiSpy.mockClear();
    svc.invalidateCache();
    await svc.notifyBatchComplete(1, 1, 0);
    expect(uiSpy).toHaveBeenCalledWith(expect.objectContaining({ variant: 'warning' }));
  });

  test('notifyWatcherError sends error variant', async () => {
    const settingsService = {
      load: jest.fn().mockResolvedValue({ notifications: true, notificationMode: 'ui' })
    };
    const svc = new NotificationService({ settingsService });
    const uiSpy = jest.spyOn(svc, '_sendToUi');

    await svc.notifyWatcherError('DownloadWatcher', 'Something broke');
    expect(uiSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: NotificationService.NotificationType.WATCHER_ERROR,
        variant: 'error'
      })
    );
  });

  test('singleton getInstance/resetInstance', () => {
    NotificationService.resetInstance();
    const settingsService = { load: jest.fn().mockResolvedValue({ notifications: true }) };

    const a = NotificationService.getInstance({ settingsService });
    const b = NotificationService.getInstance({ settingsService });
    expect(a).toBe(b);

    NotificationService.resetInstance();
    const c = NotificationService.getInstance({ settingsService });
    expect(c).not.toBe(a);
  });
});
