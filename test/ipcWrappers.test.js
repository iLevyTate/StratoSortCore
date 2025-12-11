/**
 * Tests for IPC Wrappers
 * Tests error logging, validation, service checks, and handler creation
 */

// Mock logger
jest.mock('../src/shared/logger', () => ({
  logger: {
    setContext: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  }
}));

// Mock errorHandlingUtils
jest.mock('../src/shared/errorHandlingUtils', () => ({
  createSuccessResponse: jest.fn((data) => ({ success: true, data })),
  ERROR_CODES: {
    UNKNOWN_ERROR: 'UNKNOWN_ERROR',
    SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
    VALIDATION_ERROR: 'VALIDATION_ERROR'
  }
}));

// Mock ipcRegistry
jest.mock('../src/main/core/ipcRegistry', () => ({
  registerHandler: jest.fn()
}));

describe('IPC Wrappers', () => {
  let ipcWrappers;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();

    ipcWrappers = require('../src/main/ipc/ipcWrappers');
  });

  describe('createErrorResponse', () => {
    test('creates error response from Error object', () => {
      const error = new Error('Test error');
      const result = ipcWrappers.createErrorResponse(error);

      expect(result.success).toBe(false);
      expect(result.error.message).toBe('Test error');
      expect(result.error.code).toBe('UNKNOWN_ERROR');
    });

    test('includes error code if present', () => {
      const error = { message: 'Not found', code: 'NOT_FOUND' };
      const result = ipcWrappers.createErrorResponse(error);

      expect(result.error.code).toBe('NOT_FOUND');
    });

    test('includes errorCode as alternative to code', () => {
      const error = { message: 'Invalid', errorCode: 'INVALID_INPUT' };
      const result = ipcWrappers.createErrorResponse(error);

      expect(result.error.code).toBe('INVALID_INPUT');
    });

    test('includes context in details', () => {
      const error = new Error('Test');
      const result = ipcWrappers.createErrorResponse(error, { filePath: '/test' });

      expect(result.error.details).toBeDefined();
      expect(result.error.details.filePath).toBe('/test');
    });

    test('handles null error', () => {
      const result = ipcWrappers.createErrorResponse(null);

      expect(result.success).toBe(false);
      expect(result.error.message).toBe('Unknown error');
    });

    test('includes validation errors if present', () => {
      const error = {
        message: 'Validation failed',
        validationErrors: ['field1 required']
      };
      const result = ipcWrappers.createErrorResponse(error);

      expect(result.error.details.validationErrors).toEqual(['field1 required']);
    });
  });

  describe('createSuccessResponse', () => {
    test('spreads object data into response', () => {
      const result = ipcWrappers.createSuccessResponse({ count: 5, items: [] });

      expect(result.success).toBe(true);
      expect(result.count).toBe(5);
      expect(result.items).toEqual([]);
    });

    test('handles empty object', () => {
      const result = ipcWrappers.createSuccessResponse({});

      expect(result.success).toBe(true);
    });

    test('handles undefined data', () => {
      const result = ipcWrappers.createSuccessResponse();

      expect(result.success).toBe(true);
    });

    test('wraps array data', () => {
      const result = ipcWrappers.createSuccessResponse([1, 2, 3]);

      expect(result.success).toBe(true);
    });
  });

  describe('withErrorLogging', () => {
    test('returns handler result on success', async () => {
      const mockLogger = { error: jest.fn() };
      const handler = jest.fn().mockResolvedValue({ data: 'test' });

      const wrapped = ipcWrappers.withErrorLogging(mockLogger, handler);
      const result = await wrapped('arg1', 'arg2');

      expect(result).toEqual({ data: 'test' });
      expect(handler).toHaveBeenCalledWith('arg1', 'arg2');
      expect(mockLogger.error).not.toHaveBeenCalled();
    });

    test('logs and rethrows errors', async () => {
      const mockLogger = { error: jest.fn() };
      const error = new Error('Handler failed');
      const handler = jest.fn().mockRejectedValue(error);

      const wrapped = ipcWrappers.withErrorLogging(mockLogger, handler, {
        context: 'TestContext'
      });

      await expect(wrapped()).rejects.toThrow('Handler failed');
      expect(mockLogger.error).toHaveBeenCalledWith('[TestContext] Handler error:', error);
    });

    test('uses default context when not provided', async () => {
      const mockLogger = { error: jest.fn() };
      const handler = jest.fn().mockRejectedValue(new Error('Fail'));

      const wrapped = ipcWrappers.withErrorLogging(mockLogger, handler);

      await expect(wrapped()).rejects.toThrow();
      expect(mockLogger.error).toHaveBeenCalledWith('[IPC] Handler error:', expect.any(Error));
    });

    test('handles logger failure gracefully', async () => {
      const mockLogger = {
        error: jest.fn().mockImplementation(() => {
          throw new Error('Logger broken');
        })
      };
      const handler = jest.fn().mockRejectedValue(new Error('Handler fail'));

      const wrapped = ipcWrappers.withErrorLogging(mockLogger, handler);

      // Should still throw original error even if logger fails
      await expect(wrapped()).rejects.toThrow('Handler fail');
    });
  });

  describe('withServiceCheck', () => {
    test('calls handler with service when available', async () => {
      const mockLogger = { warn: jest.fn(), error: jest.fn() };
      const mockService = { doThing: jest.fn() };
      const handler = jest.fn().mockResolvedValue({ done: true });

      const wrapped = ipcWrappers.withServiceCheck({
        logger: mockLogger,
        serviceName: 'testService',
        getService: () => mockService,
        handler,
        context: 'Test'
      });

      const result = await wrapped('event', 'data');

      expect(result).toEqual({ done: true });
      expect(handler).toHaveBeenCalledWith('event', 'data', mockService);
    });

    test('returns error response when service unavailable', async () => {
      const mockLogger = { warn: jest.fn(), error: jest.fn() };
      const handler = jest.fn();

      const wrapped = ipcWrappers.withServiceCheck({
        logger: mockLogger,
        serviceName: 'testService',
        getService: () => null,
        handler,
        context: 'Test'
      });

      const result = await wrapped();

      expect(result.success).toBe(false);
      expect(result.error.message).toContain('testService');
      expect(handler).not.toHaveBeenCalled();
    });

    test('returns fallback response when service unavailable', async () => {
      const mockLogger = { warn: jest.fn(), error: jest.fn() };

      const wrapped = ipcWrappers.withServiceCheck({
        logger: mockLogger,
        serviceName: 'testService',
        getService: () => null,
        handler: jest.fn(),
        fallbackResponse: { items: [], count: 0 }
      });

      const result = await wrapped();

      expect(result).toEqual({ items: [], count: 0 });
    });
  });

  describe('createHandler', () => {
    test('throws if logger not provided', () => {
      expect(() => {
        ipcWrappers.createHandler({
          handler: () => {}
        });
      }).toThrow('createHandler requires a logger');
    });

    test('throws if handler not provided', () => {
      expect(() => {
        ipcWrappers.createHandler({
          logger: { error: jest.fn() }
        });
      }).toThrow('createHandler requires a handler function');
    });

    test('creates basic handler with error logging', async () => {
      const mockLogger = { error: jest.fn() };
      const handler = jest.fn().mockResolvedValue({ result: 'ok' });

      const wrapped = ipcWrappers.createHandler({
        logger: mockLogger,
        handler
      });

      const result = await wrapped('event', 'data');

      expect(result).toEqual({ result: 'ok' });
    });

    test('wraps response when wrapResponse is true', async () => {
      const mockLogger = { error: jest.fn() };
      const handler = jest.fn().mockResolvedValue({ count: 5 });

      const wrapped = ipcWrappers.createHandler({
        logger: mockLogger,
        handler,
        wrapResponse: true
      });

      const result = await wrapped();

      expect(result.success).toBe(true);
      expect(result.count).toBe(5);
    });

    test('does not double-wrap response', async () => {
      const mockLogger = { error: jest.fn() };
      const handler = jest.fn().mockResolvedValue({ success: true, data: 'x' });

      const wrapped = ipcWrappers.createHandler({
        logger: mockLogger,
        handler,
        wrapResponse: true
      });

      const result = await wrapped();

      expect(result).toEqual({ success: true, data: 'x' });
    });

    test('adds service check when configured', async () => {
      const mockLogger = { warn: jest.fn(), error: jest.fn() };
      const mockService = { get: jest.fn() };
      const handler = jest.fn().mockResolvedValue({ done: true });

      const wrapped = ipcWrappers.createHandler({
        logger: mockLogger,
        handler,
        serviceName: 'myService',
        getService: () => mockService
      });

      await wrapped('event');

      expect(handler).toHaveBeenCalledWith('event', mockService);
    });

    test('returns fallback when service unavailable', async () => {
      const mockLogger = { warn: jest.fn(), error: jest.fn() };

      const wrapped = ipcWrappers.createHandler({
        logger: mockLogger,
        handler: jest.fn(),
        serviceName: 'myService',
        getService: () => null,
        fallbackResponse: []
      });

      const result = await wrapped();

      expect(result).toEqual([]);
    });
  });

  describe('registerHandlers', () => {
    test('registers multiple handlers', () => {
      const { registerHandler } = require('../src/main/core/ipcRegistry');
      const mockIpcMain = { handle: jest.fn() };
      const mockLogger = { error: jest.fn() };

      ipcWrappers.registerHandlers({
        ipcMain: mockIpcMain,
        logger: mockLogger,
        context: 'Test',
        handlers: {
          'channel:one': { handler: () => 'one' },
          'channel:two': { handler: () => 'two' }
        }
      });

      expect(registerHandler).toHaveBeenCalledTimes(2);
      expect(registerHandler).toHaveBeenCalledWith(
        mockIpcMain,
        'channel:one',
        expect.any(Function)
      );
      expect(registerHandler).toHaveBeenCalledWith(
        mockIpcMain,
        'channel:two',
        expect.any(Function)
      );
    });
  });

  describe('ERROR_CODES', () => {
    test('exports error codes', () => {
      expect(ipcWrappers.ERROR_CODES).toBeDefined();
      expect(ipcWrappers.ERROR_CODES.UNKNOWN_ERROR).toBe('UNKNOWN_ERROR');
    });
  });
});
