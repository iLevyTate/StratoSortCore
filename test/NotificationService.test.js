jest.mock('electron', () => ({
  Notification: jest.fn().mockImplementation(() => ({ show: jest.fn() })),
  BrowserWindow: {
    getAllWindows: jest.fn(() => [])
  }
}));

jest.mock('crypto', () => ({
  randomUUID: jest.fn(() => 'uuid-123')
}));

jest.mock('../src/shared/logger', () => ({
  createLogger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
  })
}));

jest.mock('../src/main/ipc/ipcWrappers', () => ({
  safeSend: jest.fn()
}));

jest.mock('../src/shared/notificationTypes', () => ({
  NotificationType: {
    SYSTEM: 'system',
    FILE_ORGANIZED: 'file_organized',
    FILE_ANALYZED: 'file_analyzed',
    LOW_CONFIDENCE: 'low_confidence',
    BATCH_COMPLETE: 'batch_complete',
    WATCHER_ERROR: 'watcher_error'
  },
  NotificationSeverity: {
    INFO: 'info',
    SUCCESS: 'success',
    WARNING: 'warning',
    ERROR: 'error'
  },
  NotificationStatus: {
    PENDING: 'pending'
  },
  getDefaultDuration: jest.fn(() => 3000)
}));

const { Notification, BrowserWindow } = require('electron');
const { safeSend } = require('../src/main/ipc/ipcWrappers');
const NotificationService = require('../src/main/services/NotificationService');

describe('NotificationService', () => {
  let settingsService;
  let service;

  beforeEach(() => {
    settingsService = {
      load: jest.fn().mockResolvedValue({
        notifications: true,
        notificationMode: 'both',
        notifyOnAutoAnalysis: true,
        notifyOnLowConfidence: true
      })
    };
    service = new NotificationService({ settingsService });
    BrowserWindow.getAllWindows.mockReturnValue([]);
    safeSend.mockReset();
  });

  test('getSettings caches results within TTL', async () => {
    const first = await service._getSettings();
    const second = await service._getSettings();
    expect(first).toEqual(second);
    expect(settingsService.load).toHaveBeenCalledTimes(1);
  });

  test('getSettings falls back to defaults on error', async () => {
    settingsService.load.mockRejectedValueOnce(new Error('fail'));
    const settings = await service._getSettings();
    expect(settings.notifications).toBe(true);
    expect(settings.notificationMode).toBe('both');
  });

  test('sendToUi sends standardized notification to windows', () => {
    const mockWindow = { isDestroyed: () => false, webContents: {} };
    BrowserWindow.getAllWindows.mockReturnValue([mockWindow]);

    const id = service._sendToUi({ title: 'Hello' });

    expect(id).toBe('uuid-123');
    expect(safeSend).toHaveBeenCalledWith(mockWindow.webContents, 'notification', {
      title: 'Hello',
      id: 'uuid-123'
    });
  });

  test('showTrayNotification does nothing when unsupported', () => {
    Notification.isSupported = jest.fn(() => false);
    service._showTrayNotification('Title', 'Body');
    expect(Notification).not.toHaveBeenCalled();
  });

  test('notifyFileOrganized uses tray and ui when enabled', async () => {
    const traySpy = jest.spyOn(service, '_showTrayNotification').mockImplementation(() => {});
    const uiSpy = jest.spyOn(service, '_sendToUi').mockImplementation(() => 'id');

    await service.notifyFileOrganized('file.txt', 'Dest', 92);

    expect(traySpy).toHaveBeenCalled();
    expect(uiSpy).toHaveBeenCalled();
  });

  test('notifyLowConfidence respects disabled setting', async () => {
    settingsService.load.mockResolvedValueOnce({
      notifications: true,
      notificationMode: 'both',
      notifyOnAutoAnalysis: true,
      notifyOnLowConfidence: false
    });

    const traySpy = jest.spyOn(service, '_showTrayNotification').mockImplementation(() => {});
    const uiSpy = jest.spyOn(service, '_sendToUi').mockImplementation(() => 'id');

    await service.notifyLowConfidence('file.txt', 30, 80, 'Target');

    expect(traySpy).not.toHaveBeenCalled();
    expect(uiSpy).not.toHaveBeenCalled();
  });
});
