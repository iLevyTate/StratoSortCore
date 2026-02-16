/**
 * NotificationService Tests
 *
 * Tests notification routing (tray vs UI), settings-based filtering,
 * notification history tracking, and error handling.
 *
 * Coverage target: main/services/NotificationService.js (was 48%)
 */

jest.mock('electron', () => ({
  Notification: Object.assign(
    jest.fn().mockImplementation(function (opts) {
      this.title = opts?.title;
      this.body = opts?.body;
      this.show = jest.fn();
      this.on = jest.fn();
    }),
    { isSupported: jest.fn(() => true) }
  ),
  BrowserWindow: {
    getAllWindows: jest.fn(() => [])
  }
}));

jest.mock('../src/shared/logger', () => {
  const logger = {
    setContext: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  };
  return { logger, createLogger: jest.fn(() => logger) };
});

jest.mock('../src/main/ipc/ipcWrappers', () => ({
  safeSend: jest.fn(() => true)
}));

const NotificationService = require('../src/main/services/NotificationService');
const { Notification, BrowserWindow } = require('electron');
const { safeSend } = require('../src/main/ipc/ipcWrappers');

describe('NotificationService', () => {
  let service;
  let mockSettingsService;

  beforeEach(() => {
    jest.clearAllMocks();
    mockSettingsService = {
      load: jest.fn().mockResolvedValue({
        notifications: true,
        notificationMode: 'both',
        notifyOnAutoAnalysis: true,
        notifyOnLowConfidence: true
      })
    };
    service = new NotificationService({ settingsService: mockSettingsService });
  });

  describe('constructor', () => {
    test('initializes with correct defaults', () => {
      expect(service.settingsService).toBe(mockSettingsService);
      expect(service._settings).toBeNull();
      expect(service._sentNotifications).toBeInstanceOf(Map);
    });
  });

  describe('_getSettings', () => {
    test('loads settings from settingsService', async () => {
      const settings = await service._getSettings();
      expect(mockSettingsService.load).toHaveBeenCalled();
      expect(settings.notifications).toBe(true);
    });

    test('caches settings within TTL', async () => {
      await service._getSettings();
      await service._getSettings();
      expect(mockSettingsService.load).toHaveBeenCalledTimes(1);
    });

    test('refreshes settings after TTL expires', async () => {
      await service._getSettings();
      service._settingsLoadedAt = Date.now() - 10000;
      await service._getSettings();
      expect(mockSettingsService.load).toHaveBeenCalledTimes(2);
    });

    test('uses defaults when settings load fails', async () => {
      mockSettingsService.load.mockRejectedValueOnce(new Error('disk error'));
      const settings = await service._getSettings();
      expect(settings.notifications).toBe(true);
      expect(settings.notificationMode).toBe('both');
    });
  });

  describe('_shouldShowTray / _shouldShowUi', () => {
    test('tray mode shows tray only', () => {
      expect(service._shouldShowTray('tray')).toBe(true);
      expect(service._shouldShowTray('ui')).toBe(false);
      expect(service._shouldShowTray('both')).toBe(true);
    });

    test('ui mode shows ui only', () => {
      expect(service._shouldShowUi('ui')).toBe(true);
      expect(service._shouldShowUi('tray')).toBe(false);
      expect(service._shouldShowUi('both')).toBe(true);
    });
  });

  describe('_sendToUi', () => {
    test('sends to all non-destroyed windows', () => {
      const mockWindow = {
        webContents: { id: 1, send: jest.fn() },
        isDestroyed: () => false
      };
      BrowserWindow.getAllWindows.mockReturnValue([mockWindow]);

      const id = service._sendToUi({
        title: 'Test',
        message: 'Test message',
        type: 'info'
      });

      expect(id).toBeTruthy();
      expect(safeSend).toHaveBeenCalled();
    });

    test('skips destroyed windows', () => {
      const destroyedWindow = {
        webContents: { send: jest.fn() },
        isDestroyed: () => true
      };
      BrowserWindow.getAllWindows.mockReturnValue([destroyedWindow]);

      service._sendToUi({ title: 'Test', message: 'Test' });

      expect(safeSend).not.toHaveBeenCalled();
    });

    test('tracks sent notifications', () => {
      BrowserWindow.getAllWindows.mockReturnValue([]);

      service._sendToUi({ title: 'Test 1', message: 'msg1' });
      service._sendToUi({ title: 'Test 2', message: 'msg2' });

      expect(service._sentNotifications.size).toBe(2);
    });

    test('evicts oldest notification when limit reached', () => {
      BrowserWindow.getAllWindows.mockReturnValue([]);
      service._maxSentNotifications = 3;

      service._sendToUi({ title: 'A', message: 'a' });
      service._sendToUi({ title: 'B', message: 'b' });
      service._sendToUi({ title: 'C', message: 'c' });
      service._sendToUi({ title: 'D', message: 'd' });

      expect(service._sentNotifications.size).toBe(3);
    });

    test('handles empty windows list', () => {
      BrowserWindow.getAllWindows.mockReturnValue([]);
      const id = service._sendToUi({ title: 'Test', message: 'No windows' });
      expect(id).toBeTruthy();
    });
  });

  describe('_showTrayNotification', () => {
    test('creates and shows Notification', () => {
      service._showTrayNotification('Title', 'Body');
      expect(Notification).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Title', body: 'Body' })
      );
    });

    test('does not show when not supported', () => {
      Notification.isSupported.mockReturnValueOnce(false);
      service._showTrayNotification('Title', 'Body');
      expect(Notification).not.toHaveBeenCalled();
    });

    test('handles Notification constructor error', () => {
      Notification.mockImplementationOnce(() => {
        throw new Error('no display');
      });
      expect(() => service._showTrayNotification('Title', 'Body')).not.toThrow();
    });
  });

  describe('notifyFileOrganized', () => {
    test('sends tray and UI notification', async () => {
      const mockWindow = {
        webContents: { id: 1 },
        isDestroyed: () => false
      };
      BrowserWindow.getAllWindows.mockReturnValue([mockWindow]);

      await service.notifyFileOrganized('report.pdf', 'Finance', 95);

      expect(Notification).toHaveBeenCalled();
      expect(safeSend).toHaveBeenCalled();
    });

    test('skips when notifications disabled', async () => {
      mockSettingsService.load.mockResolvedValue({ notifications: false });

      await service.notifyFileOrganized('report.pdf', 'Finance', 95);

      expect(Notification).not.toHaveBeenCalled();
      expect(safeSend).not.toHaveBeenCalled();
    });

    test('only sends tray in tray mode', async () => {
      mockSettingsService.load.mockResolvedValue({
        notifications: true,
        notificationMode: 'tray'
      });

      await service.notifyFileOrganized('report.pdf', 'Finance', 95);

      expect(Notification).toHaveBeenCalled();
      expect(safeSend).not.toHaveBeenCalled();
    });

    test('only sends UI in ui mode', async () => {
      BrowserWindow.getAllWindows.mockReturnValue([
        { webContents: { id: 1 }, isDestroyed: () => false }
      ]);
      mockSettingsService.load.mockResolvedValue({
        notifications: true,
        notificationMode: 'ui'
      });

      await service.notifyFileOrganized('report.pdf', 'Finance', 95);

      expect(Notification).not.toHaveBeenCalled();
      expect(safeSend).toHaveBeenCalled();
    });
  });

  describe('notifyFileAnalyzed', () => {
    test('sends notification for auto-analyzed file', async () => {
      await service.notifyFileAnalyzed('doc.pdf', 'smart_folder', { category: 'Finance' });
      expect(Notification).toHaveBeenCalled();
    });

    test('skips when notifyOnAutoAnalysis is false', async () => {
      mockSettingsService.load.mockResolvedValue({
        notifications: true,
        notificationMode: 'both',
        notifyOnAutoAnalysis: false
      });

      await service.notifyFileAnalyzed('doc.pdf', 'download', {});
      expect(Notification).not.toHaveBeenCalled();
    });

    test('handles missing analysis object', async () => {
      await expect(service.notifyFileAnalyzed('doc.pdf', 'download')).resolves.not.toThrow();
    });
  });

  describe('notifyLowConfidence', () => {
    test('sends notification with suggested folder', async () => {
      BrowserWindow.getAllWindows.mockReturnValue([
        { webContents: { id: 1 }, isDestroyed: () => false }
      ]);

      await service.notifyLowConfidence('ambiguous.pdf', 30, 70, 'Maybe-Finance');

      expect(safeSend).toHaveBeenCalledWith(
        expect.anything(),
        expect.any(String),
        expect.objectContaining({
          data: expect.objectContaining({
            fileName: 'ambiguous.pdf',
            confidence: 30,
            suggestedFolder: 'Maybe-Finance'
          })
        })
      );
    });

    test('skips when notifyOnLowConfidence is false', async () => {
      mockSettingsService.load.mockResolvedValue({
        notifications: true,
        notifyOnLowConfidence: false
      });

      await service.notifyLowConfidence('file.pdf', 20, 70);
      expect(Notification).not.toHaveBeenCalled();
    });

    test('handles no suggested folder', async () => {
      await expect(service.notifyLowConfidence('file.pdf', 20, 70)).resolves.not.toThrow();
    });
  });

  describe('notifyBatchComplete', () => {
    test('sends success notification for all organized', async () => {
      await service.notifyBatchComplete(10, 0, 0);
      expect(Notification).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Batch Organization Complete',
          body: '10 organized'
        })
      );
    });

    test('sends warning notification when review needed', async () => {
      BrowserWindow.getAllWindows.mockReturnValue([
        { webContents: { id: 1 }, isDestroyed: () => false }
      ]);

      await service.notifyBatchComplete(5, 3, 0);

      expect(safeSend).toHaveBeenCalledWith(
        expect.anything(),
        expect.any(String),
        expect.objectContaining({
          severity: 'warning'
        })
      );
    });

    test('handles zero counts', async () => {
      await service.notifyBatchComplete(0, 0, 0);
      expect(Notification).toHaveBeenCalledWith(
        expect.objectContaining({ body: 'No files processed' })
      );
    });

    test('skips when notifications disabled', async () => {
      mockSettingsService.load.mockResolvedValue({ notifications: false });
      await service.notifyBatchComplete(5, 0, 0);
      expect(Notification).not.toHaveBeenCalled();
    });
  });

  describe('notifyWatcherError', () => {
    test('sends error notification', async () => {
      await service.notifyWatcherError('Downloads Watcher', 'Permission denied');
      expect(Notification).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Downloads Watcher Error',
          body: 'Permission denied'
        })
      );
    });

    test('skips when notifications disabled', async () => {
      mockSettingsService.load.mockResolvedValue({ notifications: false });
      await service.notifyWatcherError('Watcher', 'Error');
      expect(Notification).not.toHaveBeenCalled();
    });
  });

  describe('invalidateCache', () => {
    test('clears cached settings', async () => {
      await service._getSettings();
      expect(service._settings).not.toBeNull();

      service.invalidateCache();
      expect(service._settings).toBeNull();
      expect(service._settingsLoadedAt).toBe(0);
    });
  });

  describe('singleton management', () => {
    test('getInstance creates instance with deps', () => {
      NotificationService.resetInstance();
      const instance = NotificationService.getInstance({ settingsService: mockSettingsService });
      expect(instance).toBeInstanceOf(NotificationService);
    });

    test('getInstance returns same instance on second call', () => {
      NotificationService.resetInstance();
      const first = NotificationService.getInstance({ settingsService: mockSettingsService });
      const second = NotificationService.getInstance();
      expect(first).toBe(second);
    });

    test('resetInstance clears the singleton', () => {
      NotificationService.resetInstance();
      const instance = NotificationService.getInstance();
      expect(instance).toBeNull();
    });
  });
});
