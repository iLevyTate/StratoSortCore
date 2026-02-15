/**
 * Tests for ErrorHandler
 * Tests error categorization, logging, and user notification
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
  appendFile: jest.fn().mockResolvedValue(undefined),
  readFile: jest.fn(),
  readdir: jest.fn().mockResolvedValue([]),
  stat: jest.fn(),
  unlink: jest.fn().mockResolvedValue(undefined)
};

const mockFsSync = {
  appendFileSync: jest.fn(),
  readdirSync: jest.fn().mockReturnValue([]),
  statSync: jest.fn(),
  unlinkSync: jest.fn(),
  existsSync: jest.fn().mockReturnValue(true)
};

jest.mock('fs', () => ({
  promises: mockFsPromises,
  ...mockFsSync
}));

// Mock logger
jest.mock('../src/shared/logger', () => {
  const logger = {
    setContext: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    log: jest.fn()
  };
  return {
    logger,
    createLogger: jest.fn(() => logger), // sanitizeLogData is used by ErrorHandler.js
    sanitizeLogData: jest.fn((data) => data)
  };
});

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
    VECTOR_DB: {
      STATUS_CHANGED: 'vectordb:status-changed'
    }
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

describe('ErrorHandler', () => {
  let errorHandler;
  let electron;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();

    electron = require('electron');
    errorHandler = require('../src/main/errors/ErrorHandler');
  });

  describe('initialize', () => {
    test('creates logs directory', async () => {
      await errorHandler.initialize();

      expect(mockFsPromises.mkdir).toHaveBeenCalledWith(expect.stringContaining('logs'), {
        recursive: true
      });
    });

    test('sets up log file with timestamp', async () => {
      await errorHandler.initialize();

      expect(errorHandler.currentLogFile).toContain('stratosort-');
      expect(errorHandler.currentLogFile).toContain('.log');
    });

    test('marks handler as initialized', async () => {
      await errorHandler.initialize();

      expect(errorHandler.isInitialized).toBe(true);
    });

    test('handles initialization errors gracefully', async () => {
      mockFsPromises.mkdir.mockRejectedValueOnce(new Error('Permission denied'));

      await errorHandler.initialize();

      // Should not throw, just log the error
      expect(errorHandler.isInitialized).toBe(false);
    });
  });

  describe('parseError', () => {
    test('parses ENOENT error as FILE_NOT_FOUND', () => {
      const error = new Error('File not found');
      error.code = 'ENOENT';

      const result = errorHandler.parseError(error);

      expect(result.type).toBe('FILE_NOT_FOUND');
    });

    test('parses EACCES error as PERMISSION_DENIED', () => {
      const error = new Error('Permission denied');
      error.code = 'EACCES';

      const result = errorHandler.parseError(error);

      expect(result.type).toBe('PERMISSION_DENIED');
    });

    test('parses EPERM error as PERMISSION_DENIED', () => {
      const error = new Error('Operation not permitted');
      error.code = 'EPERM';

      const result = errorHandler.parseError(error);

      expect(result.type).toBe('PERMISSION_DENIED');
    });

    test('parses network error from message', () => {
      const error = new Error('network connection failed');

      const result = errorHandler.parseError(error);

      expect(result.type).toBe('NETWORK_ERROR');
    });

    test('parses ENOTFOUND as NETWORK_ERROR', () => {
      const error = new Error('getaddrinfo ENOTFOUND');
      error.code = 'ENOTFOUND';

      const result = errorHandler.parseError(error);

      expect(result.type).toBe('NETWORK_ERROR');
    });

    test('parses AI engine error as AI_UNAVAILABLE', () => {
      const error = new Error('Llama connection failed');

      const result = errorHandler.parseError(error);

      expect(result.type).toBe('AI_UNAVAILABLE');
    });

    test('parses AI error as AI_UNAVAILABLE', () => {
      const error = new Error('AI model not responding');

      const result = errorHandler.parseError(error);

      expect(result.type).toBe('AI_UNAVAILABLE');
    });

    test('parses unknown error', () => {
      const error = new Error('Something went wrong');

      const result = errorHandler.parseError(error);

      expect(result.type).toBe('UNKNOWN');
    });

    test('includes stack trace', () => {
      const error = new Error('Test error');

      const result = errorHandler.parseError(error);

      expect(result.stack).toBeDefined();
    });

    test('handles non-Error objects', () => {
      const result = errorHandler.parseError('string error');

      expect(result.type).toBe('UNKNOWN');
    });
  });

  describe('determineSeverity', () => {
    test('returns error for PERMISSION_DENIED', () => {
      const severity = errorHandler.determineSeverity('PERMISSION_DENIED');

      expect(severity).toBe('error');
    });

    test('returns error for UNKNOWN', () => {
      const severity = errorHandler.determineSeverity('UNKNOWN');

      expect(severity).toBe('error');
    });

    test('returns error for FILE_NOT_FOUND', () => {
      const severity = errorHandler.determineSeverity('FILE_NOT_FOUND');

      expect(severity).toBe('error');
    });

    test('returns error for AI_UNAVAILABLE', () => {
      const severity = errorHandler.determineSeverity('AI_UNAVAILABLE');

      expect(severity).toBe('error');
    });

    test('returns warning for INVALID_FORMAT', () => {
      const severity = errorHandler.determineSeverity('INVALID_FORMAT');

      expect(severity).toBe('warning');
    });

    test('returns warning for FILE_TOO_LARGE', () => {
      const severity = errorHandler.determineSeverity('FILE_TOO_LARGE');

      expect(severity).toBe('warning');
    });

    test('returns info for other types', () => {
      const severity = errorHandler.determineSeverity('OTHER_TYPE');

      expect(severity).toBe('info');
    });
  });

  describe('process gone handlers', () => {
    beforeEach(async () => {
      await errorHandler.initialize();
    });

    test('render-process-gone includes summary and webContents metadata', async () => {
      const handleCriticalSpy = jest
        .spyOn(errorHandler, 'handleCriticalError')
        .mockResolvedValue(undefined);

      const renderHandler = electron.app.on.mock.calls.find(
        ([eventName]) => eventName === 'render-process-gone'
      )?.[1];

      const webContents = {
        id: 42,
        getURL: jest.fn(() => 'app://main')
      };

      await renderHandler?.({}, webContents, {
        type: 'renderer',
        reason: 'crashed',
        exitCode: 1,
        serviceName: 'renderer',
        name: 'render-process'
      });

      expect(handleCriticalSpy).toHaveBeenCalledWith(
        expect.stringContaining('Renderer Process Crashed'),
        expect.objectContaining({
          details: expect.objectContaining({
            type: 'renderer',
            reason: 'crashed',
            exitCode: 1
          }),
          webContentsId: 42,
          url: 'app://main'
        })
      );

      handleCriticalSpy.mockRestore();
    });

    test('child-process-gone GPU uses warning log and skips critical handling', async () => {
      const handleCriticalSpy = jest
        .spyOn(errorHandler, 'handleCriticalError')
        .mockResolvedValue(undefined);

      const childHandler = electron.app.on.mock.calls.find(
        ([eventName]) => eventName === 'child-process-gone'
      )?.[1];

      await childHandler?.({}, { type: 'GPU', reason: 'crashed' });

      const { logger } = require('../src/shared/logger');
      expect(logger.log).toHaveBeenCalledWith(
        'warning',
        expect.stringContaining('GPU Process Exited'),
        expect.any(Object)
      );
      expect(handleCriticalSpy).not.toHaveBeenCalled();

      handleCriticalSpy.mockRestore();
    });
  });

  describe('handleCriticalError', () => {
    beforeEach(async () => {
      await errorHandler.initialize();
    });

    test('relaunches app when user selects restart', async () => {
      electron.dialog.showMessageBox.mockResolvedValueOnce({ response: 0 });

      await errorHandler.handleCriticalError('Critical failure', new Error('boom'));

      expect(electron.app.relaunch).toHaveBeenCalled();
      expect(electron.app.quit).toHaveBeenCalled();
    });

    test('quits app when user selects quit', async () => {
      electron.dialog.showMessageBox.mockResolvedValueOnce({ response: 1 });

      await errorHandler.handleCriticalError('Critical failure', { type: 'renderer' });

      expect(electron.app.relaunch).not.toHaveBeenCalled();
      expect(electron.app.quit).toHaveBeenCalled();
    });
  });

  describe('handleError', () => {
    beforeEach(async () => {
      await errorHandler.initialize();
    });

    test('logs error with context', async () => {
      const error = new Error('Test error');
      error.code = 'ENOENT';

      await errorHandler.handleError(error, { operation: 'read' });

      const { logger } = require('../src/shared/logger');
      expect(logger.log).toHaveBeenCalled();
    });

    test('returns parsed error info', async () => {
      const error = new Error('Test error');
      error.code = 'ENOENT';

      const result = await errorHandler.handleError(error);

      expect(result.type).toBe('FILE_NOT_FOUND');
    });
  });

  describe('log', () => {
    test('writes to log file when initialized', async () => {
      await errorHandler.initialize();
      const { logger } = require('../src/shared/logger');
      logger.log.mockClear(); // Clear init log call

      await errorHandler.log('info', 'Test message', { data: 'value' });

      expect(logger.log).toHaveBeenCalled();
    });

    test('uses logger when not initialized', async () => {
      const { logger } = require('../src/shared/logger');

      await errorHandler.log('error', 'Test message');

      expect(logger.log).toHaveBeenCalled();
    });

    test('handles logger failures gracefully', async () => {
      await errorHandler.initialize();
      const { logger } = require('../src/shared/logger');
      logger.log.mockImplementationOnce(() => {
        throw new Error('Log failed');
      });

      await errorHandler.log('info', 'Test message');
      // Should not throw
    });
  });

  describe('getRecentErrors', () => {
    beforeEach(async () => {
      await errorHandler.initialize();
    });

    test('returns empty array when log file is empty', async () => {
      mockFsPromises.readFile.mockResolvedValue('');

      const errors = await errorHandler.getRecentErrors();

      expect(errors).toEqual([]);
    });

    test('filters to only ERROR and CRITICAL levels', async () => {
      const logContent = [
        '{"level":"INFO","message":"info message"}',
        '{"level":"ERROR","message":"error message"}',
        '{"level":"CRITICAL","message":"critical message"}',
        '{"level":"DEBUG","message":"debug message"}'
      ].join('\n');

      mockFsPromises.readFile.mockResolvedValue(logContent);

      const errors = await errorHandler.getRecentErrors();

      expect(errors).toHaveLength(2);
      expect(errors[0].level).toBe('ERROR');
      expect(errors[1].level).toBe('CRITICAL');
    });

    test('respects count parameter', async () => {
      const logContent = [
        '{"level":"ERROR","message":"error 1"}',
        '{"level":"ERROR","message":"error 2"}',
        '{"level":"ERROR","message":"error 3"}'
      ].join('\n');

      mockFsPromises.readFile.mockResolvedValue(logContent);

      const errors = await errorHandler.getRecentErrors(2);

      expect(errors.length).toBeLessThanOrEqual(2);
    });

    test('handles malformed log lines', async () => {
      const logContent = [
        '{"level":"ERROR","message":"valid"}',
        'invalid json',
        '{"level":"ERROR","message":"also valid"}'
      ].join('\n');

      mockFsPromises.readFile.mockResolvedValue(logContent);

      const errors = await errorHandler.getRecentErrors();

      expect(errors).toHaveLength(2);
    });

    test('handles read errors gracefully', async () => {
      mockFsPromises.readFile.mockRejectedValue(new Error('Read failed'));

      const errors = await errorHandler.getRecentErrors();

      expect(errors).toEqual([]);
    });
  });

  describe('cleanupLogs', () => {
    beforeEach(async () => {
      await errorHandler.initialize();
      // Reset the async mocks for each test
      mockFsPromises.readdir.mockReset();
      mockFsPromises.stat.mockReset();
      mockFsPromises.unlink.mockReset().mockResolvedValue(undefined);
    });

    test('deletes old log files', async () => {
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 10);

      // PERF: Updated to use async fs.promises API
      mockFsPromises.readdir.mockResolvedValue(['stratosort-old.log', 'stratosort-new.log']);
      mockFsPromises.stat
        .mockResolvedValueOnce({ mtime: oldDate })
        .mockResolvedValueOnce({ mtime: new Date() });

      await errorHandler.cleanupLogs(7);

      expect(mockFsPromises.unlink).toHaveBeenCalledTimes(1);
    });

    test('keeps recent log files', async () => {
      mockFsPromises.readdir.mockResolvedValue(['stratosort-new.log']);
      mockFsPromises.stat.mockResolvedValue({ mtime: new Date() });

      await errorHandler.cleanupLogs(7);

      expect(mockFsPromises.unlink).not.toHaveBeenCalled();
    });

    test('only processes stratosort log files', async () => {
      mockFsPromises.readdir.mockResolvedValue(['other-file.log', 'stratosort-test.log']);
      mockFsPromises.stat.mockResolvedValue({ mtime: new Date(0) });

      await errorHandler.cleanupLogs(7);

      // Should only stat the stratosort file (async version)
      expect(mockFsPromises.stat).toHaveBeenCalledTimes(1);
    });

    test('handles cleanup errors gracefully', async () => {
      mockFsPromises.readdir.mockRejectedValue(new Error('Read failed'));

      await errorHandler.cleanupLogs();

      // Should not throw
    });
  });

  describe('notifyUser', () => {
    test('sends to renderer when window available', async () => {
      const mockWebContents = { send: jest.fn() };
      const mockWindow = {
        isDestroyed: jest.fn().mockReturnValue(false),
        webContents: mockWebContents
      };
      electron.BrowserWindow.getFocusedWindow.mockReturnValue(mockWindow);

      await errorHandler.notifyUser('Test message', 'error');

      expect(mockWebContents.send).toHaveBeenCalledWith('app:error', {
        message: 'Test message',
        type: 'error',
        timestamp: expect.any(String)
      });
    });

    test('shows dialog when no window available', async () => {
      electron.BrowserWindow.getFocusedWindow.mockReturnValue(null);

      await errorHandler.notifyUser('Test message', 'warning');

      expect(electron.dialog.showMessageBox).toHaveBeenCalledWith({
        type: 'warning',
        title: 'Warning',
        message: 'Test message',
        buttons: ['OK']
      });
    });

    test('shows dialog when window is destroyed', async () => {
      const mockWindow = {
        isDestroyed: jest.fn().mockReturnValue(true)
      };
      electron.BrowserWindow.getFocusedWindow.mockReturnValue(mockWindow);

      await errorHandler.notifyUser('Test message', 'error');

      expect(electron.dialog.showMessageBox).toHaveBeenCalled();
    });
  });
});
