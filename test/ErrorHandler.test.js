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
jest.mock('../src/shared/logger', () => ({
  logger: {
    setContext: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    log: jest.fn()
  }
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

    test('parses Ollama error as AI_UNAVAILABLE', () => {
      const error = new Error('Ollama connection failed');

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
    test('returns critical for PERMISSION_DENIED', () => {
      const severity = errorHandler.determineSeverity('PERMISSION_DENIED');

      expect(severity).toBe('critical');
    });

    test('returns critical for UNKNOWN', () => {
      const severity = errorHandler.determineSeverity('UNKNOWN');

      expect(severity).toBe('critical');
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

  describe('handleError', () => {
    beforeEach(async () => {
      await errorHandler.initialize();
    });

    test('logs error with context', async () => {
      const error = new Error('Test error');
      error.code = 'ENOENT';

      await errorHandler.handleError(error, { operation: 'read' });

      expect(mockFsSync.appendFileSync).toHaveBeenCalled();
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
      mockFsSync.appendFileSync.mockClear(); // Clear init log call

      await errorHandler.log('info', 'Test message', { data: 'value' });

      expect(mockFsSync.appendFileSync).toHaveBeenCalled();
      const logContent = mockFsSync.appendFileSync.mock.calls[0][1];
      expect(logContent).toContain('Test message');
    });

    test('uses logger when not initialized', async () => {
      const { logger } = require('../src/shared/logger');

      await errorHandler.log('error', 'Test message');

      expect(logger.log).toHaveBeenCalled();
    });

    test('handles write errors gracefully', async () => {
      await errorHandler.initialize();
      mockFsSync.appendFileSync.mockImplementationOnce(() => {
        throw new Error('Write failed');
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
    });

    test('deletes old log files', async () => {
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 10);

      mockFsSync.readdirSync.mockReturnValue(['stratosort-old.log', 'stratosort-new.log']);
      mockFsSync.statSync
        .mockReturnValueOnce({ mtime: oldDate })
        .mockReturnValueOnce({ mtime: new Date() });

      await errorHandler.cleanupLogs(7);

      expect(mockFsSync.unlinkSync).toHaveBeenCalledTimes(1);
    });

    test('keeps recent log files', async () => {
      mockFsSync.readdirSync.mockReturnValue(['stratosort-new.log']);
      mockFsSync.statSync.mockReturnValue({ mtime: new Date() });

      await errorHandler.cleanupLogs(7);

      expect(mockFsSync.unlinkSync).not.toHaveBeenCalled();
    });

    test('only processes stratosort log files', async () => {
      mockFsSync.readdirSync.mockReturnValue(['other-file.log', 'stratosort-test.log']);
      mockFsSync.statSync.mockReturnValue({ mtime: new Date(0) });

      await errorHandler.cleanupLogs(7);

      // Should only check the stratosort file
      expect(mockFsSync.statSync).toHaveBeenCalledTimes(1);
    });

    test('handles cleanup errors gracefully', async () => {
      mockFsSync.readdirSync.mockImplementation(() => {
        throw new Error('Read failed');
      });

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
