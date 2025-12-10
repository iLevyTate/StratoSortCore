/**
 * Tests for Logger
 * Tests logging levels, formatting, and factory functions
 */

describe('Logger', () => {
  let Logger;
  let logger;
  let LOG_LEVELS;
  let LOG_LEVEL_NAMES;
  let createLogger;
  let getLogger;

  beforeEach(() => {
    jest.resetModules();
    // Mock console methods
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'debug').mockImplementation(() => {});

    const module = require('../src/shared/logger');
    Logger = module.Logger;
    logger = module.logger;
    LOG_LEVELS = module.LOG_LEVELS;
    LOG_LEVEL_NAMES = module.LOG_LEVEL_NAMES;
    createLogger = module.createLogger;
    getLogger = module.getLogger;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('LOG_LEVELS', () => {
    test('has correct log level values', () => {
      expect(LOG_LEVELS.ERROR).toBe(0);
      expect(LOG_LEVELS.WARN).toBe(1);
      expect(LOG_LEVELS.INFO).toBe(2);
      expect(LOG_LEVELS.DEBUG).toBe(3);
      expect(LOG_LEVELS.TRACE).toBe(4);
    });

    test('LOG_LEVEL_NAMES matches LOG_LEVELS', () => {
      expect(LOG_LEVEL_NAMES[0]).toBe('ERROR');
      expect(LOG_LEVEL_NAMES[1]).toBe('WARN');
      expect(LOG_LEVEL_NAMES[2]).toBe('INFO');
      expect(LOG_LEVEL_NAMES[3]).toBe('DEBUG');
      expect(LOG_LEVEL_NAMES[4]).toBe('TRACE');
    });
  });

  describe('Logger class', () => {
    test('creates logger with default settings', () => {
      const log = new Logger();
      expect(log.level).toBe(LOG_LEVELS.INFO);
      expect(log.enableConsole).toBe(true);
      expect(log.enableFile).toBe(false);
      expect(log.context).toBe('');
    });

    test('setLevel with string', () => {
      const log = new Logger();
      log.setLevel('DEBUG');
      expect(log.level).toBe(LOG_LEVELS.DEBUG);
    });

    test('setLevel with number', () => {
      const log = new Logger();
      log.setLevel(LOG_LEVELS.WARN);
      expect(log.level).toBe(LOG_LEVELS.WARN);
    });

    test('setLevel with invalid string defaults to INFO', () => {
      const log = new Logger();
      log.setLevel('INVALID');
      expect(log.level).toBe(LOG_LEVELS.INFO);
    });

    test('setContext sets context', () => {
      const log = new Logger();
      log.setContext('TestContext');
      expect(log.context).toBe('TestContext');
    });

    test('enableFileLogging enables file logging', () => {
      const log = new Logger();
      log.enableFileLogging('/path/to/log.txt');
      expect(log.enableFile).toBe(true);
      expect(log.logFile).toBe('/path/to/log.txt');
    });

    test('disableConsoleLogging disables console', () => {
      const log = new Logger();
      log.disableConsoleLogging();
      expect(log.enableConsole).toBe(false);
    });
  });

  describe('formatMessage', () => {
    test('formats message with timestamp and level', () => {
      const log = new Logger();
      const message = log.formatMessage(LOG_LEVELS.INFO, 'Test message', {});

      expect(message).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
      expect(message).toContain('INFO');
      expect(message).toContain('Test message');
    });

    test('includes context when set', () => {
      const log = new Logger();
      log.setContext('MyContext');
      const message = log.formatMessage(LOG_LEVELS.INFO, 'Test', {});

      expect(message).toContain('[MyContext]');
    });

    test('includes data when provided', () => {
      const log = new Logger();
      const message = log.formatMessage(LOG_LEVELS.INFO, 'Test', { key: 'value' });

      expect(message).toContain('Data:');
      expect(message).toContain('key');
      expect(message).toContain('value');
    });

    test('handles empty data object', () => {
      const log = new Logger();
      const message = log.formatMessage(LOG_LEVELS.INFO, 'Test', {});

      expect(message).not.toContain('Data:');
    });
  });

  describe('safeStringify', () => {
    test('handles circular references', () => {
      const log = new Logger();
      const obj = { name: 'test' };
      obj.self = obj;

      const result = log.safeStringify(obj);
      expect(result).toContain('[Circular Reference]');
    });

    test('handles Error objects', () => {
      const log = new Logger();
      const error = new Error('Test error');
      const result = log.safeStringify({ error });

      expect(result).toContain('Test error');
      expect(result).toContain('name');
      expect(result).toContain('message');
    });

    test('handles functions', () => {
      const log = new Logger();
      const result = log.safeStringify({ fn: function myFunc() {} });

      expect(result).toContain('[Function: myFunc]');
    });

    test('handles anonymous functions', () => {
      const log = new Logger();
      const result = log.safeStringify({ fn: () => {} });

      expect(result).toContain('[Function:');
    });
  });

  describe('logging methods', () => {
    test('error logs at ERROR level', () => {
      const log = new Logger();
      log.setLevel(LOG_LEVELS.ERROR);
      log.error('Error message');

      expect(console.error).toHaveBeenCalled();
    });

    test('warn logs at WARN level', () => {
      const log = new Logger();
      log.setLevel(LOG_LEVELS.WARN);
      log.warn('Warning message');

      expect(console.warn).toHaveBeenCalled();
    });

    test('info logs at INFO level', () => {
      const log = new Logger();
      log.setLevel(LOG_LEVELS.INFO);
      log.info('Info message');

      expect(console.info).toHaveBeenCalled();
    });

    test('debug logs at DEBUG level', () => {
      const log = new Logger();
      log.setLevel(LOG_LEVELS.DEBUG);
      log.debug('Debug message');

      expect(console.debug).toHaveBeenCalled();
    });

    test('trace logs at TRACE level', () => {
      const log = new Logger();
      log.setLevel(LOG_LEVELS.TRACE);
      log.trace('Trace message');

      expect(console.debug).toHaveBeenCalled();
    });

    test('does not log when level is below threshold', () => {
      const log = new Logger();
      log.setLevel(LOG_LEVELS.ERROR);
      log.info('Info message');

      expect(console.info).not.toHaveBeenCalled();
    });
  });

  describe('convenience methods', () => {
    test('fileOperation logs file operation', () => {
      const log = new Logger();
      log.setLevel(LOG_LEVELS.INFO);
      log.fileOperation('move', '/path/to/file.txt', 'success');

      expect(console.info).toHaveBeenCalled();
    });

    test('aiAnalysis logs AI analysis', () => {
      const log = new Logger();
      log.setLevel(LOG_LEVELS.INFO);
      log.aiAnalysis('/path/to/file.txt', 'llama3', 1500, 85);

      expect(console.info).toHaveBeenCalled();
    });

    test('phaseTransition logs phase transition', () => {
      const log = new Logger();
      log.setLevel(LOG_LEVELS.INFO);
      log.phaseTransition('discover', 'organize', { fileCount: 10 });

      expect(console.info).toHaveBeenCalled();
    });

    test('performance logs performance metrics', () => {
      const log = new Logger();
      log.setLevel(LOG_LEVELS.DEBUG);
      log.performance('file-scan', 250, { files: 100 });

      expect(console.debug).toHaveBeenCalled();
    });
  });

  describe('createLogger factory', () => {
    test('creates logger with context set', () => {
      const log = createLogger('TestService');
      expect(log.context).toBe('TestService');
    });

    test('inherits level from singleton', () => {
      logger.setLevel(LOG_LEVELS.DEBUG);
      const log = createLogger('TestService');
      expect(log.level).toBe(LOG_LEVELS.DEBUG);
    });

    test('creates independent logger instance', () => {
      const log1 = createLogger('Service1');
      const log2 = createLogger('Service2');

      expect(log1).not.toBe(log2);
      expect(log1.context).toBe('Service1');
      expect(log2.context).toBe('Service2');
    });
  });

  describe('getLogger factory', () => {
    test('returns singleton with context set', () => {
      const log = getLogger('TestContext');
      expect(log).toBe(logger);
      expect(log.context).toBe('TestContext');
    });

    test('overwrites previous context', () => {
      getLogger('Context1');
      const log = getLogger('Context2');
      expect(log.context).toBe('Context2');
    });
  });

  describe('singleton logger', () => {
    test('logger is a Logger instance', () => {
      expect(logger).toBeInstanceOf(Logger);
    });

    test('singleton persists across requires', () => {
      const { logger: logger2 } = require('../src/shared/logger');
      expect(logger).toBe(logger2);
    });
  });
});
