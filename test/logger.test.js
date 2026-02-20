/**
 * Tests for Logger
 * Updated for Pino-based logger implementation.
 */

// Opt out of the global logger mock from test-setup.js since we're testing the real logger
jest.unmock('../src/shared/logger');

jest.mock('pino', () => {
  const pinoMock = jest.fn(() => ({
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
    trace: jest.fn(),
    child: jest.fn(function () {
      return this;
    })
  }));
  pinoMock.transport = jest.fn(() => ({}));
  pinoMock.stdTimeFunctions = { isoTime: () => '' };
  return pinoMock;
});

const {
  Logger,
  logger,
  LOG_LEVELS,
  createLogger,
  sanitizeLogData
} = require('../src/shared/logger');

const buildMockPino = () => ({
  error: jest.fn(),
  warn: jest.fn(),
  info: jest.fn(),
  debug: jest.fn(),
  trace: jest.fn(),
  child: jest.fn(function () {
    return this;
  })
});

describe('Logger', () => {
  describe('LOG_LEVELS', () => {
    test('has correct log level values', () => {
      expect(LOG_LEVELS.ERROR).toBe('error');
      expect(LOG_LEVELS.WARN).toBe('warn');
      expect(LOG_LEVELS.INFO).toBe('info');
      expect(LOG_LEVELS.DEBUG).toBe('debug');
      expect(LOG_LEVELS.TRACE).toBe('trace');
    });
  });

  describe('Logger class', () => {
    test('creates logger with default settings', () => {
      const log = new Logger();
      expect(log.level).toBe('info');
      expect(log.enableFile).toBe(false);
      expect(log.logFile).toBe(null);
      expect(log.context).toBe('');
    });

    test('setLevel with string', () => {
      const log = new Logger();
      log.setLevel('DEBUG');
      expect(log.level).toBe('debug');
    });

    test('setLevel with number', () => {
      const log = new Logger();
      log.setLevel(1);
      expect(log.level).toBe('warn');
    });

    test('setLevel with invalid string defaults to info', () => {
      const log = new Logger();
      log.setLevel('INVALID');
      expect(log.level).toBe('info');
    });

    test('setContext sets context and updates pino child', () => {
      const log = new Logger();
      log.pino = buildMockPino();
      log.setContext('TestContext');
      expect(log.context).toBe('TestContext');
      expect(log.pino.child).toHaveBeenCalledWith({ context: 'TestContext' });
    });

    test('enableFileLogging enables file logging', () => {
      const log = new Logger();
      const initSpy = jest.spyOn(log, '_initPino');
      log.enableFileLogging('/path/to/log.txt');
      expect(log.enableFile).toBe(true);
      expect(log.logFile).toBe('/path/to/log.txt');
      expect(initSpy).toHaveBeenCalled();
    });

    test('disableConsoleLogging disables console', () => {
      const log = new Logger();
      const initSpy = jest.spyOn(log, '_initPino');
      log.disableConsoleLogging();
      expect(log.enableConsole).toBe(false);
      expect(initSpy).toHaveBeenCalled();
    });
  });

  describe('sanitizeLogData', () => {
    test('preserves error details', () => {
      const error = new Error('Test error');
      const sanitized = sanitizeLogData({ error });
      expect(sanitized.error).toEqual(
        expect.objectContaining({
          name: 'Error',
          message: 'Test error'
        })
      );
    });

    test('redacts file paths to trailing segment', () => {
      const sanitized = sanitizeLogData({
        filePath: 'C:\\Users\\test\\file.txt',
        source: '/tmp/example.txt'
      });
      expect(sanitized.filePath).toBe('file.txt');
      expect(sanitized.source).toBe('example.txt');
    });
  });

  describe('logging methods', () => {
    test('error uses pino.error with sanitized data', () => {
      const log = new Logger();
      log.pino = buildMockPino();
      log.error('Error message', { filePath: '/path/to/file.txt' });
      expect(log.pino.error).toHaveBeenCalledWith(
        expect.objectContaining({ filePath: 'file.txt' }),
        'Error message'
      );
    });

    test('info logs without data', () => {
      const log = new Logger();
      log.pino = buildMockPino();
      log.info('Info message');
      expect(log.pino.info).toHaveBeenCalledWith('Info message');
    });
  });

  describe('convenience methods', () => {
    test('fileOperation logs through info', () => {
      const log = new Logger();
      log.pino = buildMockPino();
      const infoSpy = jest.spyOn(log, 'info');
      log.fileOperation('move', '/path/to/file.txt', 'success');
      expect(infoSpy).toHaveBeenCalled();
    });

    test('aiAnalysis logs through info', () => {
      const log = new Logger();
      log.pino = buildMockPino();
      const infoSpy = jest.spyOn(log, 'info');
      log.aiAnalysis('/path/to/file.txt', 'llama3', 1500, 85);
      expect(infoSpy).toHaveBeenCalled();
    });

    test('phaseTransition logs through info', () => {
      const log = new Logger();
      log.pino = buildMockPino();
      const infoSpy = jest.spyOn(log, 'info');
      log.phaseTransition('discover', 'organize', { fileCount: 10 });
      expect(infoSpy).toHaveBeenCalled();
    });

    test('performance logs through debug', () => {
      const log = new Logger();
      log.pino = buildMockPino();
      const debugSpy = jest.spyOn(log, 'debug');
      log.performance('file-scan', 250, { files: 100 });
      expect(debugSpy).toHaveBeenCalled();
    });
  });

  describe('createLogger factory', () => {
    test('creates logger with context set', () => {
      const log = createLogger('TestService');
      expect(log.context).toBe('TestService');
    });

    test('inherits level from singleton', () => {
      logger.setLevel('debug');
      const log = createLogger('Test');
      expect(log.level).toBe(logger.level);
    });

    test('creates independent logger instance', () => {
      const log1 = createLogger('A');
      const log2 = createLogger('B');
      expect(log1).not.toBe(log2);
    });
  });

  describe('singleton logger', () => {
    test('logger is a Logger instance', () => {
      expect(logger).toBeInstanceOf(Logger);
    });

    test('singleton persists across requires', () => {
      const module2 = require('../src/shared/logger');
      expect(module2.logger).toBe(logger);
    });
  });
});
