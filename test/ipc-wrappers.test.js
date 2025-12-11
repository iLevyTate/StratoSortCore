/**
 * Tests for IPC Wrappers
 * Tests error handling, validation, and service checking utilities
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
  let withErrorLogging;
  let withValidation;
  let withServiceCheck;
  let createHandler;
  let registerHandlers;
  let createErrorResponse;
  let createSuccessResponse;
  let mockLogger;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();

    mockLogger = {
      info: jest.fn(),
      debug: jest.fn(),
      warn: jest.fn(),
      error: jest.fn()
    };

    const module = require('../src/main/ipc/ipcWrappers');
    withErrorLogging = module.withErrorLogging;
    withValidation = module.withValidation;
    withServiceCheck = module.withServiceCheck;
    createHandler = module.createHandler;
    registerHandlers = module.registerHandlers;
    createErrorResponse = module.createErrorResponse;
    createSuccessResponse = module.createSuccessResponse;
  });

  describe('createErrorResponse', () => {
    test('creates error response from Error object', () => {
      const error = new Error('Test error');
      error.code = 'TEST_CODE';

      const response = createErrorResponse(error);

      expect(response.success).toBe(false);
      expect(response.error.message).toBe('Test error');
      expect(response.error.code).toBe('TEST_CODE');
    });

    test('creates error response from string', () => {
      const response = createErrorResponse('String error');

      expect(response.success).toBe(false);
      expect(response.error.message).toBe('String error');
    });

    test('includes context in error details', () => {
      const response = createErrorResponse(new Error('Test'), {
        context: 'additional info'
      });

      expect(response.error.details).toBeDefined();
      expect(response.error.details.context).toBe('additional info');
    });

    test('handles null/undefined error', () => {
      const response = createErrorResponse(null);

      expect(response.success).toBe(false);
      expect(response.error.message).toBe('Unknown error');
    });
  });

  describe('createSuccessResponse', () => {
    test('creates success response with object data', () => {
      const response = createSuccessResponse({ key: 'value' });

      expect(response.success).toBe(true);
      expect(response.key).toBe('value');
    });

    test('creates success response with empty object', () => {
      const response = createSuccessResponse();

      expect(response.success).toBe(true);
    });

    test('wraps non-object data using standard response', () => {
      const response = createSuccessResponse([1, 2, 3]);

      expect(response.success).toBe(true);
    });
  });

  describe('withErrorLogging', () => {
    test('passes through successful result', async () => {
      const handler = jest.fn().mockResolvedValue({ result: 'success' });
      const wrapped = withErrorLogging(mockLogger, handler);

      const result = await wrapped('arg1', 'arg2');

      expect(result).toEqual({ result: 'success' });
      expect(handler).toHaveBeenCalledWith('arg1', 'arg2');
    });

    test('logs errors and rethrows', async () => {
      const error = new Error('Handler error');
      const handler = jest.fn().mockRejectedValue(error);
      const wrapped = withErrorLogging(mockLogger, handler, {
        context: 'Test'
      });

      await expect(wrapped()).rejects.toThrow('Handler error');
      expect(mockLogger.error).toHaveBeenCalled();
    });

    test('handles logger failure gracefully', async () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      const brokenLogger = {
        error: jest.fn(() => {
          throw new Error('Logger broken');
        })
      };
      const handler = jest.fn().mockRejectedValue(new Error('Test'));
      const wrapped = withErrorLogging(brokenLogger, handler);

      await expect(wrapped()).rejects.toThrow('Test');
      expect(consoleSpy).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });
  });

  describe('withValidation', () => {
    let z;

    beforeEach(() => {
      z = require('../src/main/ipc/ipcWrappers').z;
    });

    test('validates input against schema', async () => {
      // Skip if zod not available
      if (!z) return;

      const schema = z.object({ name: z.string() });
      const handler = jest.fn().mockResolvedValue({ success: true });
      const wrapped = withValidation(mockLogger, schema, handler);

      await wrapped({}, { name: 'test' });

      expect(handler).toHaveBeenCalled();
    });

    test('returns error for invalid input', async () => {
      if (!z) return;

      const schema = z.object({ name: z.string().min(1) });
      const handler = jest.fn();
      const wrapped = withValidation(mockLogger, schema, handler);

      const result = await wrapped({}, { name: '' });

      expect(result.success).toBe(false);
      expect(handler).not.toHaveBeenCalled();
    });

    test('falls back to error logging when no schema', async () => {
      const handler = jest.fn().mockResolvedValue({ data: 'result' });
      const wrapped = withValidation(mockLogger, null, handler);

      const result = await wrapped({}, 'test');

      expect(result).toEqual({ data: 'result' });
    });
  });

  describe('withServiceCheck', () => {
    test('calls handler with service when available', async () => {
      const mockService = { doSomething: jest.fn() };
      const handler = jest.fn().mockResolvedValue({ result: 'ok' });

      const wrapped = withServiceCheck({
        logger: mockLogger,
        serviceName: 'testService',
        getService: () => mockService,
        handler
      });

      await wrapped({}, 'data');

      expect(handler).toHaveBeenCalledWith({}, 'data', mockService);
    });

    test('returns error when service unavailable', async () => {
      const handler = jest.fn();

      const wrapped = withServiceCheck({
        logger: mockLogger,
        serviceName: 'testService',
        getService: () => null,
        handler
      });

      const result = await wrapped({});

      expect(result.success).toBe(false);
      expect(result.error.message).toContain('testService');
      expect(handler).not.toHaveBeenCalled();
    });

    test('returns fallback response when configured', async () => {
      const fallbackResponse = { items: [], fallback: true };
      const handler = jest.fn();

      const wrapped = withServiceCheck({
        logger: mockLogger,
        serviceName: 'testService',
        getService: () => null,
        handler,
        fallbackResponse
      });

      const result = await wrapped({});

      expect(result).toEqual(fallbackResponse);
    });
  });

  describe('createHandler', () => {
    test('requires logger', () => {
      expect(() =>
        createHandler({
          handler: jest.fn()
        })
      ).toThrow('requires a logger');
    });

    test('requires handler function', () => {
      expect(() =>
        createHandler({
          logger: mockLogger,
          handler: 'not a function'
        })
      ).toThrow('requires a handler function');
    });

    test('creates basic handler with error logging', async () => {
      const handler = jest.fn().mockResolvedValue({ data: 'result' });

      const wrapped = createHandler({
        logger: mockLogger,
        handler
      });

      const result = await wrapped({}, 'input');

      expect(result).toEqual({ data: 'result' });
    });

    test('wraps response when configured', async () => {
      const handler = jest.fn().mockResolvedValue({ key: 'value' });

      const wrapped = createHandler({
        logger: mockLogger,
        handler,
        wrapResponse: true
      });

      const result = await wrapped({});

      expect(result.success).toBe(true);
      expect(result.key).toBe('value');
    });

    test('does not double-wrap success response', async () => {
      const handler = jest.fn().mockResolvedValue({ success: true, data: 'x' });

      const wrapped = createHandler({
        logger: mockLogger,
        handler,
        wrapResponse: true
      });

      const result = await wrapped({});

      expect(result).toEqual({ success: true, data: 'x' });
    });

    test('adds service check when configured', async () => {
      const mockService = { method: jest.fn() };
      const handler = jest.fn().mockImplementation(async (event, data, service) => {
        return { hasService: !!service };
      });

      const wrapped = createHandler({
        logger: mockLogger,
        serviceName: 'test',
        getService: () => mockService,
        handler
      });

      const result = await wrapped({}, 'data');

      expect(result.hasService).toBe(true);
    });

    test('adds validation when schema provided', async () => {
      const z = require('../src/main/ipc/ipcWrappers').z;
      if (!z) return;

      const handler = jest.fn().mockResolvedValue({ valid: true });

      const wrapped = createHandler({
        logger: mockLogger,
        schema: z.object({ value: z.number() }),
        handler
      });

      const validResult = await wrapped({}, { value: 42 });
      expect(validResult.valid).toBe(true);

      const invalidResult = await wrapped({}, { value: 'not a number' });
      expect(invalidResult.success).toBe(false);
    });
  });

  describe('registerHandlers', () => {
    test('registers multiple handlers', () => {
      const { registerHandler } = require('../src/main/core/ipcRegistry');
      const mockIpcMain = { handle: jest.fn() };

      registerHandlers({
        ipcMain: mockIpcMain,
        logger: mockLogger,
        context: 'Test',
        handlers: {
          'channel-1': {
            handler: jest.fn()
          },
          'channel-2': {
            handler: jest.fn()
          }
        }
      });

      expect(registerHandler).toHaveBeenCalledTimes(2);
      expect(registerHandler).toHaveBeenCalledWith(mockIpcMain, 'channel-1', expect.any(Function));
      expect(registerHandler).toHaveBeenCalledWith(mockIpcMain, 'channel-2', expect.any(Function));
    });
  });
});
