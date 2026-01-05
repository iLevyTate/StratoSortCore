/**
 * Tests for Error Handling Utilities
 * Tests error codes, response creators, and retry logic
 */

describe('errorHandlingUtils', () => {
  let ERROR_CODES;
  let createSuccessResponse;
  let withRetry;
  let logFallback;
  let getErrorMessage;

  beforeEach(() => {
    // jest.resetModules(); // Removed - breaks module imports
    const module = require('../src/shared/errorHandlingUtils');
    ERROR_CODES = module.ERROR_CODES;
    createSuccessResponse = module.createSuccessResponse;
    withRetry = module.withRetry;
    logFallback = module.logFallback;
    getErrorMessage = module.getErrorMessage;
  });

  describe('ERROR_CODES', () => {
    test('has file system error codes', () => {
      expect(ERROR_CODES.FILE_NOT_FOUND).toBe('FILE_NOT_FOUND');
      expect(ERROR_CODES.FILE_ACCESS_DENIED).toBe('FILE_ACCESS_DENIED');
      expect(ERROR_CODES.FILE_READ_ERROR).toBe('FILE_READ_ERROR');
      expect(ERROR_CODES.FILE_WRITE_ERROR).toBe('FILE_WRITE_ERROR');
      expect(ERROR_CODES.DIRECTORY_NOT_FOUND).toBe('DIRECTORY_NOT_FOUND');
    });

    test('has analysis error codes', () => {
      expect(ERROR_CODES.ANALYSIS_FAILED).toBe('ANALYSIS_FAILED');
      expect(ERROR_CODES.MODEL_NOT_AVAILABLE).toBe('MODEL_NOT_AVAILABLE');
      expect(ERROR_CODES.INVALID_FILE_TYPE).toBe('INVALID_FILE_TYPE');
    });

    test('has network error codes', () => {
      expect(ERROR_CODES.NETWORK_ERROR).toBe('NETWORK_ERROR');
      expect(ERROR_CODES.TIMEOUT).toBe('TIMEOUT');
      expect(ERROR_CODES.SERVICE_UNAVAILABLE).toBe('SERVICE_UNAVAILABLE');
    });

    test('has validation error codes', () => {
      expect(ERROR_CODES.VALIDATION_ERROR).toBe('VALIDATION_ERROR');
      expect(ERROR_CODES.INVALID_INPUT).toBe('INVALID_INPUT');
    });

    test('has generic error codes', () => {
      expect(ERROR_CODES.UNKNOWN_ERROR).toBe('UNKNOWN_ERROR');
      expect(ERROR_CODES.OPERATION_CANCELLED).toBe('OPERATION_CANCELLED');
    });
  });

  describe('createSuccessResponse', () => {
    test('creates success response with data', () => {
      const data = { result: 'value' };
      const response = createSuccessResponse(data);

      expect(response.success).toBe(true);
      expect(response.data).toEqual(data);
    });

    test('creates success response with null data', () => {
      const response = createSuccessResponse(null);

      expect(response.success).toBe(true);
      expect(response.data).toBeNull();
    });

    test('creates success response with undefined data', () => {
      const response = createSuccessResponse(undefined);

      expect(response.success).toBe(true);
      expect(response.data).toBeUndefined();
    });

    test('creates success response with array data', () => {
      const data = [1, 2, 3];
      const response = createSuccessResponse(data);

      expect(response.success).toBe(true);
      expect(response.data).toEqual([1, 2, 3]);
    });

    test('creates success response with string data', () => {
      const response = createSuccessResponse('message');

      expect(response.success).toBe(true);
      expect(response.data).toBe('message');
    });

    test('creates success response with number data', () => {
      const response = createSuccessResponse(42);

      expect(response.success).toBe(true);
      expect(response.data).toBe(42);
    });

    test('creates success response with boolean data', () => {
      const response = createSuccessResponse(false);

      expect(response.success).toBe(true);
      expect(response.data).toBe(false);
    });
  });

  describe('withRetry', () => {
    test('returns successful result immediately', async () => {
      const fn = jest.fn().mockResolvedValue('success');
      const wrapped = withRetry(fn, { maxRetries: 3 });

      const result = await wrapped();

      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    test('retries on failure', async () => {
      const fn = jest.fn().mockRejectedValueOnce(new Error('fail')).mockResolvedValue('success');

      const wrapped = withRetry(fn, { maxRetries: 3, delay: 10 });

      const result = await wrapped();

      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(2);
    });

    test('throws after max retries', async () => {
      const fn = jest.fn().mockRejectedValue(new Error('always fails'));

      const wrapped = withRetry(fn, { maxRetries: 2, delay: 10 });

      await expect(wrapped()).rejects.toThrow('always fails');
      expect(fn).toHaveBeenCalledTimes(3); // initial + 2 retries
    });

    test('passes arguments to function', async () => {
      const fn = jest.fn().mockResolvedValue('result');
      const wrapped = withRetry(fn, { maxRetries: 1 });

      await wrapped('arg1', 'arg2');

      expect(fn).toHaveBeenCalledWith('arg1', 'arg2');
    });

    test('uses default options when not provided', async () => {
      const fn = jest.fn().mockResolvedValue('success');
      const wrapped = withRetry(fn);

      const result = await wrapped();

      expect(result).toBe('success');
    });

    test('retries correct number of times', async () => {
      const fn = jest.fn().mockRejectedValue(new Error('fail'));

      const wrapped = withRetry(fn, { maxRetries: 5, delay: 1 });

      await expect(wrapped()).rejects.toThrow();
      expect(fn).toHaveBeenCalledTimes(6); // initial + 5 retries
    });

    test('calls onRetry callback', async () => {
      const fn = jest.fn().mockRejectedValueOnce(new Error('fail')).mockResolvedValue('success');
      const onRetry = jest.fn();

      const wrapped = withRetry(fn, { maxRetries: 3, delay: 10, onRetry });

      await wrapped();

      expect(onRetry).toHaveBeenCalledTimes(1);
      // onRetry is called with 0-indexed retry count
      expect(onRetry).toHaveBeenCalledWith(expect.any(Error), 0);
    });
  });

  describe('logFallback', () => {
    test('returns fallback value', () => {
      const mockLogger = { debug: jest.fn() };
      const fallback = { ok: true };
      const result = logFallback(mockLogger, 'Test', 'op', new Error('boom'), fallback);
      expect(result).toBe(fallback);
    });

    test('logs at requested level when available', () => {
      const mockLogger = { warn: jest.fn(), debug: jest.fn() };
      const fallback = [];
      const err = new Error('nope');
      err.code = 'E_TEST';

      logFallback(mockLogger, 'Ctx', 'read', err, fallback, { level: 'warn' });

      expect(mockLogger.warn).toHaveBeenCalledWith(
        '[Ctx] read failed, using fallback',
        expect.objectContaining({
          error: 'nope',
          fallback: '[array(0)]',
          errorCode: 'E_TEST'
        })
      );
      expect(mockLogger.debug).not.toHaveBeenCalled();
    });

    test('falls back to debug when requested level is missing', () => {
      const mockLogger = { debug: jest.fn() };
      logFallback(mockLogger, 'Ctx', 'op', 'err', 'fallback', { level: 'warn' });
      expect(mockLogger.debug).toHaveBeenCalledWith(
        '[Ctx] op failed, using fallback',
        expect.objectContaining({ error: 'err', fallback: 'fallback' })
      );
    });
  });

  describe('getErrorMessage', () => {
    test('handles null/undefined', () => {
      expect(getErrorMessage(null)).toBe('Unknown error');
      expect(getErrorMessage(undefined, 'fallback')).toBe('fallback');
    });

    test('handles string errors', () => {
      expect(getErrorMessage('Connection refused')).toBe('Connection refused');
      expect(getErrorMessage('', 'fallback')).toBe('fallback');
    });

    test('handles Error objects', () => {
      expect(getErrorMessage(new Error('Boom'))).toBe('Boom');
      const e = new Error('');
      expect(getErrorMessage(e, 'fallback')).toBe('fallback');
    });

    test('handles objects with message/error/msg', () => {
      expect(getErrorMessage({ message: 'm' })).toBe('m');
      expect(getErrorMessage({ error: 'e' })).toBe('e');
      expect(getErrorMessage({ msg: 'x' })).toBe('x');
    });

    test('stringifies unknown objects when possible', () => {
      expect(getErrorMessage({ foo: 'bar' })).toBe(JSON.stringify({ foo: 'bar' }));
    });

    test('handles circular objects safely', () => {
      const obj = {};
      obj.self = obj;
      expect(getErrorMessage(obj, 'fallback')).toBe('fallback');
    });

    test('handles numbers/booleans', () => {
      expect(getErrorMessage(404)).toBe('404');
      expect(getErrorMessage(false)).toBe('false');
    });
  });
});
