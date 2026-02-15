/**
 * Extended tests for ErrorHandler
 * Covers untested branches: AI-specific messages, handleError routing,
 * notifyUser edge cases, parseError branches
 */

// Mock electron
jest.mock('electron', () => ({
  app: {
    getPath: jest.fn().mockReturnValue('/tmp/test-app'),
    on: jest.fn(),
    relaunch: jest.fn(),
    quit: jest.fn()
  },
  dialog: {
    showMessageBox: jest.fn().mockResolvedValue({ response: 1 })
  },
  BrowserWindow: {
    getFocusedWindow: jest.fn()
  }
}));

// Mock fs
const mockFsPromises = {
  mkdir: jest.fn().mockResolvedValue(undefined),
  readFile: jest.fn(),
  readdir: jest.fn().mockResolvedValue([]),
  stat: jest.fn(),
  unlink: jest.fn().mockResolvedValue(undefined)
};

jest.mock('fs', () => ({
  promises: mockFsPromises
}));

// Mock logger
const mockLogger = {
  setContext: jest.fn(),
  info: jest.fn(),
  debug: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  log: jest.fn(),
  enableFileLogging: jest.fn()
};

jest.mock('../src/shared/logger', () => ({
  logger: mockLogger,
  createLogger: jest.fn(() => mockLogger),
  sanitizeLogData: jest.fn((data) => data)
}));

// Mock safeJsonOps
jest.mock('../src/shared/safeJsonOps', () => ({
  parseJsonLines: jest.fn((content) => {
    if (!content) return [];
    return content
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  })
}));

// Mock ipcWrappers
const mockSafeSend = jest.fn();
jest.mock('../src/main/ipc/ipcWrappers', () => ({
  safeSend: mockSafeSend
}));

// Mock errorClassifier
jest.mock('../src/shared/errorClassifier', () => ({
  isNotFoundError: jest.fn((err) => err?.code === 'ENOENT'),
  isPermissionError: jest.fn((err) => err?.code === 'EACCES' || err?.code === 'EPERM'),
  isNetworkError: jest.fn(
    (err) =>
      err?.code === 'ENOTFOUND' ||
      err?.code === 'ECONNREFUSED' ||
      err?.code === 'ETIMEDOUT' ||
      /network|ENOTFOUND|ECONNREFUSED|ETIMEDOUT/i.test(err?.message || '')
  )
}));

// Mock constants
jest.mock('../src/shared/constants', () => ({
  ERROR_TYPES: {
    FILE_NOT_FOUND: 'FILE_NOT_FOUND',
    PERMISSION_DENIED: 'PERMISSION_DENIED',
    NETWORK_ERROR: 'NETWORK_ERROR',
    AI_UNAVAILABLE: 'AI_UNAVAILABLE',
    INVALID_FORMAT: 'INVALID_FORMAT',
    FILE_TOO_LARGE: 'FILE_TOO_LARGE',
    UNKNOWN: 'UNKNOWN'
  },
  IPC_CHANNELS: {
    VECTOR_DB: { STATUS_CHANGED: 'vectordb:status-changed' }
  },
  IPC_EVENTS: {
    SYSTEM_METRICS: 'system-metrics',
    OPERATION_PROGRESS: 'operation-progress',
    APP_ERROR: 'app:error',
    APP_UPDATE: 'app:update',
    MENU_ACTION: 'menu-action',
    OPEN_SEMANTIC_SEARCH: 'open-semantic-search',
    SETTINGS_CHANGED_EXTERNAL: 'settings-changed-external',
    FILE_OPERATION_COMPLETE: 'file-operation-complete',
    NOTIFICATION: 'notification',
    UNDO_REDO_STATE_CHANGED: 'undo-redo:state-changed',
    BATCH_RESULTS_CHUNK: 'batch-results-chunk',
    OPERATION_FAILED: 'operation-failed'
  }
}));

describe('ErrorHandler - extended coverage', () => {
  let errorHandler;
  let electron;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
    electron = require('electron');
    errorHandler = require('../src/main/errors/ErrorHandler');
  });

  describe('parseError - AI-specific messages', () => {
    test('detects AI engine ECONNREFUSED and provides connection guidance', () => {
      const error = new Error('Llama ECONNREFUSED localhost');
      const result = errorHandler.parseError(error);

      expect(result.type).toBe('AI_UNAVAILABLE');
      expect(result.message).toContain('AI engine unavailable');
    });

    test('detects AI engine connection error and provides connection guidance', () => {
      const error = new Error('Llama connection refused');
      const result = errorHandler.parseError(error);

      expect(result.type).toBe('AI_UNAVAILABLE');
      expect(result.message).toContain('AI');
    });

    test('detects AI model error and provides model guidance', () => {
      const error = new Error('AI model not found: llama3');
      const result = errorHandler.parseError(error);

      expect(result.type).toBe('AI_UNAVAILABLE');
      expect(result.message).toContain('model');
      expect(result.message).toContain('Settings');
    });

    test('detects generic AI error and provides general guidance', () => {
      const error = new Error('AI service failed');
      const result = errorHandler.parseError(error);

      expect(result.type).toBe('AI_UNAVAILABLE');
      expect(result.message).toContain('AI engine unavailable');
    });

    test('detects network timeout and provides timeout message', () => {
      const error = new Error('timeout waiting for response');
      error.code = 'ETIMEDOUT';
      const result = errorHandler.parseError(error);

      expect(result.type).toBe('NETWORK_ERROR');
      expect(result.message).toContain('timed out');
    });

    test('detects generic network error', () => {
      const error = new Error('ECONNREFUSED 127.0.0.1:9999');
      error.code = 'ECONNREFUSED';
      const result = errorHandler.parseError(error);

      expect(result.type).toBe('NETWORK_ERROR');
      expect(result.message).toContain('network-related error');
    });

    test('preserves short user-friendly error messages', () => {
      const error = new Error('File is locked');
      const result = errorHandler.parseError(error);

      expect(result.type).toBe('UNKNOWN');
      expect(result.message).toBe('File is locked');
    });

    test('replaces long or technical messages with generic', () => {
      const error = new Error(
        'This is a very long technical error message that exceeds one hundred characters and contains implementation details that users should not see in the UI'
      );
      const result = errorHandler.parseError(error);

      expect(result.type).toBe('UNKNOWN');
      expect(result.message).toBe('Something went wrong. Please try again.');
    });

    test('replaces messages containing undefined with generic', () => {
      const error = new Error('Cannot read property of undefined');
      const result = errorHandler.parseError(error);

      expect(result.message).toBe('Something went wrong. Please try again.');
    });

    test('replaces messages containing null with generic', () => {
      const error = new Error('Expected value but got null');
      const result = errorHandler.parseError(error);

      expect(result.message).toBe('Something went wrong. Please try again.');
    });

    test('includes originalMessage in details', () => {
      const error = new Error('ENOENT: no such file');
      error.code = 'ENOENT';
      const result = errorHandler.parseError(error);

      expect(result.details.originalMessage).toBe('ENOENT: no such file');
    });

    test('handles null/undefined error gracefully', () => {
      const result = errorHandler.parseError(null);
      expect(result.type).toBe('UNKNOWN');

      const result2 = errorHandler.parseError(undefined);
      expect(result2.type).toBe('UNKNOWN');
    });
  });

  describe('handleError - routing by severity', () => {
    beforeEach(async () => {
      await errorHandler.initialize();
    });

    test('routes error-severity errors to notifyUser with error type', async () => {
      const notifySpy = jest.spyOn(errorHandler, 'notifyUser').mockResolvedValue();
      const error = new Error('File not found');
      error.code = 'ENOENT';

      await errorHandler.handleError(error, { file: 'test.pdf' });

      expect(notifySpy).toHaveBeenCalledWith(expect.any(String), 'error');
      notifySpy.mockRestore();
    });

    test('routes warning-severity errors to notifyUser with warning type', async () => {
      const notifySpy = jest.spyOn(errorHandler, 'notifyUser').mockResolvedValue();
      const error = new Error('Invalid format');

      // Force the error to be classified as INVALID_FORMAT
      jest.spyOn(errorHandler, 'parseError').mockReturnValue({
        type: 'INVALID_FORMAT',
        message: 'Invalid file format',
        details: {},
        stack: error.stack
      });

      await errorHandler.handleError(error);

      expect(notifySpy).toHaveBeenCalledWith('Invalid file format', 'warning');
      notifySpy.mockRestore();
    });

    test('routes critical errors to handleCriticalError', async () => {
      const criticalSpy = jest.spyOn(errorHandler, 'handleCriticalError').mockResolvedValue();
      jest.spyOn(errorHandler, 'parseError').mockReturnValue({
        type: 'CRITICAL_FAILURE',
        message: 'System crash',
        details: {},
        stack: ''
      });
      jest.spyOn(errorHandler, 'determineSeverity').mockReturnValue('critical');

      const error = new Error('System crash');
      await errorHandler.handleError(error);

      expect(criticalSpy).toHaveBeenCalledWith('System crash', error);
      criticalSpy.mockRestore();
    });

    test('info-level errors are only logged, not notified', async () => {
      const notifySpy = jest.spyOn(errorHandler, 'notifyUser').mockResolvedValue();
      const criticalSpy = jest.spyOn(errorHandler, 'handleCriticalError').mockResolvedValue();

      jest.spyOn(errorHandler, 'parseError').mockReturnValue({
        type: 'SOME_INFO_TYPE',
        message: 'Info message',
        details: {},
        stack: ''
      });
      jest.spyOn(errorHandler, 'determineSeverity').mockReturnValue('info');

      await errorHandler.handleError(new Error('info'));

      expect(notifySpy).not.toHaveBeenCalled();
      expect(criticalSpy).not.toHaveBeenCalled();
      notifySpy.mockRestore();
      criticalSpy.mockRestore();
    });

    test('returns parsed error info', async () => {
      jest.spyOn(errorHandler, 'notifyUser').mockResolvedValue();
      const error = new Error('Permission denied');
      error.code = 'EACCES';

      const result = await errorHandler.handleError(error);

      expect(result.type).toBe('PERMISSION_DENIED');
      expect(result.message).toContain('Access denied');
    });
  });

  describe('handleCriticalError - normalizeErrorForLogging', () => {
    test('handles Error instance', async () => {
      electron.dialog.showMessageBox.mockResolvedValueOnce({ response: 1 });

      await errorHandler.handleCriticalError('Crash', new Error('boom'));

      expect(mockLogger.error).toHaveBeenCalledWith(
        '[CRITICAL ERROR]',
        expect.objectContaining({
          message: 'Crash',
          errorText: expect.stringContaining('boom'),
          stack: expect.any(String)
        })
      );
    });

    test('handles plain object (Electron crash details)', async () => {
      electron.dialog.showMessageBox.mockResolvedValueOnce({ response: 1 });

      await errorHandler.handleCriticalError('GPU crash', {
        type: 'GPU',
        reason: 'killed'
      });

      expect(mockLogger.error).toHaveBeenCalledWith(
        '[CRITICAL ERROR]',
        expect.objectContaining({
          message: 'GPU crash',
          details: { type: 'GPU', reason: 'killed' }
        })
      );
    });

    test('handles null error', async () => {
      electron.dialog.showMessageBox.mockResolvedValueOnce({ response: 1 });

      await errorHandler.handleCriticalError('Unknown crash', null);

      expect(mockLogger.error).toHaveBeenCalledWith(
        '[CRITICAL ERROR]',
        expect.objectContaining({ message: 'Unknown crash' })
      );
    });
  });

  describe('notifyUser - title capitalization', () => {
    test('capitalizes error type for dialog title', async () => {
      electron.BrowserWindow.getFocusedWindow.mockReturnValue(null);

      await errorHandler.notifyUser('Test message', 'error');

      expect(electron.dialog.showMessageBox).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Error' })
      );
    });

    test('capitalizes warning type for dialog title', async () => {
      electron.BrowserWindow.getFocusedWindow.mockReturnValue(null);

      await errorHandler.notifyUser('Test message', 'warning');

      expect(electron.dialog.showMessageBox).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Warning' })
      );
    });

    test('uses safeSend when window is available', async () => {
      const mockWebContents = { send: jest.fn() };
      const mockWindow = {
        isDestroyed: jest.fn().mockReturnValue(false),
        webContents: mockWebContents
      };
      electron.BrowserWindow.getFocusedWindow.mockReturnValue(mockWindow);

      await errorHandler.notifyUser('Test', 'error');

      expect(mockSafeSend).toHaveBeenCalledWith(
        mockWebContents,
        'app:error',
        expect.objectContaining({ message: 'Test', type: 'error' })
      );
    });
  });

  describe('initialize - custom log path', () => {
    test('uses custom logFilePath when provided', async () => {
      await errorHandler.initialize({ logFilePath: '/custom/path.log' });

      expect(errorHandler.currentLogFile).toBe('/custom/path.log');
    });

    test('sets up global handlers on initialize', async () => {
      await errorHandler.initialize();

      expect(electron.app.on).toHaveBeenCalledWith('render-process-gone', expect.any(Function));
      expect(electron.app.on).toHaveBeenCalledWith('child-process-gone', expect.any(Function));
    });
  });

  describe('process gone handlers - edge cases', () => {
    beforeEach(async () => {
      await errorHandler.initialize();
    });

    test('render-process-gone handles null details', async () => {
      const handleCriticalSpy = jest.spyOn(errorHandler, 'handleCriticalError').mockResolvedValue();

      const renderHandler = electron.app.on.mock.calls.find(
        ([name]) => name === 'render-process-gone'
      )?.[1];

      await renderHandler?.({}, { id: 1, getURL: () => 'app://main' }, null);

      expect(handleCriticalSpy).toHaveBeenCalledWith(
        'Renderer Process Crashed',
        expect.any(Object)
      );
      handleCriticalSpy.mockRestore();
    });

    test('render-process-gone handles getURL throwing', async () => {
      const handleCriticalSpy = jest.spyOn(errorHandler, 'handleCriticalError').mockResolvedValue();

      const renderHandler = electron.app.on.mock.calls.find(
        ([name]) => name === 'render-process-gone'
      )?.[1];

      await renderHandler?.(
        {},
        {
          id: 1,
          getURL: () => {
            throw new Error('destroyed');
          }
        },
        { type: 'renderer', reason: 'killed' }
      );

      expect(handleCriticalSpy).toHaveBeenCalledWith(
        expect.stringContaining('Renderer Process Crashed'),
        expect.objectContaining({ url: undefined })
      );
      handleCriticalSpy.mockRestore();
    });

    test('child-process-gone non-GPU calls handleCriticalError', async () => {
      const handleCriticalSpy = jest.spyOn(errorHandler, 'handleCriticalError').mockResolvedValue();

      const childHandler = electron.app.on.mock.calls.find(
        ([name]) => name === 'child-process-gone'
      )?.[1];

      await childHandler?.({}, { type: 'Utility', reason: 'crashed', exitCode: 1 });

      expect(handleCriticalSpy).toHaveBeenCalledWith(
        expect.stringContaining('Child Process Crashed'),
        expect.objectContaining({
          details: expect.objectContaining({ type: 'Utility' })
        })
      );
      handleCriticalSpy.mockRestore();
    });
  });

  describe('cleanupLogs - individual file error handling', () => {
    beforeEach(async () => {
      await errorHandler.initialize();
      mockFsPromises.readdir.mockReset();
      mockFsPromises.stat.mockReset();
      mockFsPromises.unlink.mockReset().mockResolvedValue(undefined);
    });

    test('handles individual file stat error without failing cleanup', async () => {
      mockFsPromises.readdir.mockResolvedValue(['stratosort-old.log']);
      mockFsPromises.stat.mockRejectedValueOnce(new Error('Permission denied'));

      await errorHandler.cleanupLogs(7);

      // Should not throw, individual errors are caught
      expect(mockFsPromises.unlink).not.toHaveBeenCalled();
    });

    test('custom daysToKeep parameter', async () => {
      const recentDate = new Date();
      recentDate.setDate(recentDate.getDate() - 2);

      mockFsPromises.readdir.mockResolvedValue(['stratosort-recent.log']);
      mockFsPromises.stat.mockResolvedValue({ mtime: recentDate });

      // With daysToKeep=1, the 2-day-old file should be deleted
      await errorHandler.cleanupLogs(1);

      expect(mockFsPromises.unlink).toHaveBeenCalledTimes(1);
    });
  });
});
