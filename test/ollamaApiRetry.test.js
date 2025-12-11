/**
 * Tests for Ollama API Retry Utility
 * Tests retry logic with exponential backoff and jitter
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
  withRetry: jest.fn((fn, options) => {
    return async (...args) => {
      let lastError;
      for (let attempt = 0; attempt <= options.maxRetries; attempt++) {
        try {
          return await fn(...args);
        } catch (error) {
          lastError = error;
          if (!options.shouldRetry(error) || attempt === options.maxRetries) {
            throw error;
          }
        }
      }
      throw lastError;
    };
  })
}));

describe('Ollama API Retry Utility', () => {
  let ollamaRetry;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
    jest.useFakeTimers();

    ollamaRetry = require('../src/main/utils/ollamaApiRetry');
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('isRetryableError', () => {
    test('returns false for null error', () => {
      expect(ollamaRetry.isRetryableError(null)).toBe(false);
    });

    test('returns true for network errors', () => {
      expect(ollamaRetry.isRetryableError({ code: 'ECONNREFUSED' })).toBe(true);
      expect(ollamaRetry.isRetryableError({ code: 'ECONNRESET' })).toBe(true);
      expect(ollamaRetry.isRetryableError({ code: 'ETIMEDOUT' })).toBe(true);
      expect(ollamaRetry.isRetryableError({ code: 'ENOTFOUND' })).toBe(true);
      expect(ollamaRetry.isRetryableError({ code: 'EHOSTUNREACH' })).toBe(true);
      expect(ollamaRetry.isRetryableError({ code: 'ENETUNREACH' })).toBe(true);
    });

    test('returns true for fetch errors', () => {
      expect(ollamaRetry.isRetryableError({ message: 'fetch failed' })).toBe(true);
      expect(ollamaRetry.isRetryableError({ message: 'network error' })).toBe(true);
      expect(ollamaRetry.isRetryableError({ message: 'request timeout' })).toBe(true);
      expect(ollamaRetry.isRetryableError({ message: 'request aborted' })).toBe(true);
      expect(ollamaRetry.isRetryableError({ message: 'connection refused' })).toBe(true);
    });

    test('returns true for retryable HTTP status codes', () => {
      expect(ollamaRetry.isRetryableError({ status: 408 })).toBe(true); // Request Timeout
      expect(ollamaRetry.isRetryableError({ status: 429 })).toBe(true); // Too Many Requests
      expect(ollamaRetry.isRetryableError({ status: 500 })).toBe(true); // Internal Server Error
      expect(ollamaRetry.isRetryableError({ status: 502 })).toBe(true); // Bad Gateway
      expect(ollamaRetry.isRetryableError({ status: 503 })).toBe(true); // Service Unavailable
      expect(ollamaRetry.isRetryableError({ status: 504 })).toBe(true); // Gateway Timeout
    });

    test('returns true for Ollama temporary errors', () => {
      expect(ollamaRetry.isRetryableError({ message: 'model is loading' })).toBe(true);
      expect(ollamaRetry.isRetryableError({ message: 'server busy' })).toBe(true);
      expect(ollamaRetry.isRetryableError({ message: 'temporarily unavailable' })).toBe(true);
    });

    test('returns false for non-retryable errors', () => {
      expect(ollamaRetry.isRetryableError({ message: 'invalid request' })).toBe(false);
      expect(ollamaRetry.isRetryableError({ message: 'validation error' })).toBe(false);
      expect(ollamaRetry.isRetryableError({ message: 'model not found' })).toBe(false);
      expect(ollamaRetry.isRetryableError({ message: 'unauthorized access' })).toBe(false);
      expect(ollamaRetry.isRetryableError({ message: 'forbidden resource' })).toBe(false);
      expect(ollamaRetry.isRetryableError({ message: 'bad request' })).toBe(false);
      expect(ollamaRetry.isRetryableError({ message: 'zero length image' })).toBe(false);
      expect(ollamaRetry.isRetryableError({ message: 'unsupported format' })).toBe(false);
    });

    test('returns false for unknown errors', () => {
      expect(ollamaRetry.isRetryableError({ message: 'something random' })).toBe(false);
    });
  });

  describe('categorizeError', () => {
    test('returns unknown for null error', () => {
      expect(ollamaRetry.categorizeError(null)).toBe('unknown');
    });

    test('categorizes network errors', () => {
      expect(ollamaRetry.categorizeError({ code: 'ECONNREFUSED' })).toBe('network');
      expect(ollamaRetry.categorizeError({ code: 'ECONNRESET' })).toBe('network');
      expect(ollamaRetry.categorizeError({ code: 'ETIMEDOUT' })).toBe('network');
    });

    test('categorizes timeout errors', () => {
      expect(ollamaRetry.categorizeError({ message: 'request timeout' })).toBe('timeout');
    });

    test('categorizes server busy errors', () => {
      expect(ollamaRetry.categorizeError({ status: 503 })).toBe('server_busy');
      expect(ollamaRetry.categorizeError({ message: 'server busy' })).toBe('server_busy');
    });

    test('categorizes rate limited errors', () => {
      expect(ollamaRetry.categorizeError({ status: 429 })).toBe('rate_limited');
    });

    test('categorizes model loading errors', () => {
      expect(ollamaRetry.categorizeError({ message: 'model is loading' })).toBe('model_loading');
    });

    test('categorizes not found errors', () => {
      expect(ollamaRetry.categorizeError({ message: 'model not found' })).toBe('not_found');
    });

    test('categorizes validation errors', () => {
      expect(ollamaRetry.categorizeError({ message: 'invalid input' })).toBe('validation');
      expect(ollamaRetry.categorizeError({ message: 'validation failed' })).toBe('validation');
    });

    test('returns other for uncategorized errors', () => {
      expect(ollamaRetry.categorizeError({ message: 'some random error' })).toBe('other');
    });
  });

  describe('calculateDelayWithJitter', () => {
    test('calculates exponential backoff', () => {
      // With jitter factor of 0, should get exact exponential values
      expect(ollamaRetry.calculateDelayWithJitter(0, 1000, 10000, 0)).toBe(1000);
      expect(ollamaRetry.calculateDelayWithJitter(1, 1000, 10000, 0)).toBe(2000);
      expect(ollamaRetry.calculateDelayWithJitter(2, 1000, 10000, 0)).toBe(4000);
      expect(ollamaRetry.calculateDelayWithJitter(3, 1000, 10000, 0)).toBe(8000);
    });

    test('respects max delay', () => {
      expect(ollamaRetry.calculateDelayWithJitter(10, 1000, 5000, 0)).toBe(5000);
    });

    test('adds jitter within expected range', () => {
      const attempts = 100;
      const initialDelay = 1000;
      const maxDelay = 10000;
      const jitterFactor = 0.3;

      for (let i = 0; i < attempts; i++) {
        const delay = ollamaRetry.calculateDelayWithJitter(0, initialDelay, maxDelay, jitterFactor);
        // With 30% jitter, delay should be between 700 and 1300
        expect(delay).toBeGreaterThanOrEqual(700);
        expect(delay).toBeLessThanOrEqual(1300);
      }
    });

    test('never returns negative delay', () => {
      for (let i = 0; i < 100; i++) {
        const delay = ollamaRetry.calculateDelayWithJitter(0, 100, 1000, 1.0);
        expect(delay).toBeGreaterThanOrEqual(0);
      }
    });
  });

  describe('DEFAULT_JITTER_FACTOR', () => {
    test('is 0.3', () => {
      expect(ollamaRetry.DEFAULT_JITTER_FACTOR).toBe(0.3);
    });
  });

  describe('withOllamaRetry', () => {
    beforeEach(() => {
      jest.useRealTimers();
    });

    test('returns result on success', async () => {
      const apiCall = jest.fn().mockResolvedValue({ data: 'success' });

      const result = await ollamaRetry.withOllamaRetry(apiCall, {
        operation: 'test',
        maxRetries: 3
      });

      expect(result).toEqual({ data: 'success' });
      expect(apiCall).toHaveBeenCalledTimes(1);
    });

    test('retries on retryable error', async () => {
      const apiCall = jest
        .fn()
        .mockRejectedValueOnce({ code: 'ECONNRESET', message: 'Connection reset' })
        .mockResolvedValueOnce({ data: 'success' });

      const result = await ollamaRetry.withOllamaRetry(apiCall, {
        operation: 'test',
        maxRetries: 3,
        initialDelay: 10,
        maxDelay: 100
      });

      expect(result).toEqual({ data: 'success' });
      expect(apiCall).toHaveBeenCalledTimes(2);
    });

    test('does not retry non-retryable errors', async () => {
      const error = { message: 'invalid request', code: 'INVALID' };
      const apiCall = jest.fn().mockRejectedValue(error);

      await expect(
        ollamaRetry.withOllamaRetry(apiCall, {
          operation: 'test',
          maxRetries: 3
        })
      ).rejects.toEqual(error);

      expect(apiCall).toHaveBeenCalledTimes(1);
    });

    test('calls onRetry callback', async () => {
      const onRetry = jest.fn();
      const apiCall = jest
        .fn()
        .mockRejectedValueOnce({ code: 'ETIMEDOUT', message: 'Timeout' })
        .mockResolvedValueOnce({ data: 'success' });

      await ollamaRetry.withOllamaRetry(apiCall, {
        operation: 'test',
        maxRetries: 3,
        initialDelay: 10,
        maxDelay: 100,
        onRetry
      });

      expect(onRetry).toHaveBeenCalled();
    });

    test('adds retry context to final error', async () => {
      const error = { code: 'ECONNREFUSED', message: 'Connection refused' };
      const apiCall = jest.fn().mockRejectedValue(error);

      try {
        await ollamaRetry.withOllamaRetry(apiCall, {
          operation: 'test-op',
          maxRetries: 2,
          initialDelay: 10,
          maxDelay: 100
        });
      } catch (e) {
        expect(e.retryContext).toBeDefined();
        expect(e.retryContext.operation).toBe('test-op');
        expect(e.retryContext.wasRetryable).toBe(true);
      }
    });
  });

  describe('fetchWithRetry', () => {
    beforeEach(() => {
      jest.useRealTimers();
      global.fetch = jest.fn();
    });

    afterEach(() => {
      delete global.fetch;
    });

    test('returns response on success', async () => {
      const mockResponse = { ok: true, json: () => ({ data: 'test' }) };
      global.fetch.mockResolvedValue(mockResponse);

      const result = await ollamaRetry.fetchWithRetry(
        'http://test.com',
        {},
        {
          operation: 'test',
          maxRetries: 0
        }
      );

      expect(result).toEqual(mockResponse);
    });

    test('throws on non-ok response', async () => {
      const mockResponse = {
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        text: () => Promise.resolve('{}')
      };
      global.fetch.mockResolvedValue(mockResponse);

      await expect(
        ollamaRetry.fetchWithRetry(
          'http://test.com',
          {},
          {
            operation: 'test',
            maxRetries: 0
          }
        )
      ).rejects.toThrow('HTTP 400');
    });
  });

  describe('generateWithRetry', () => {
    beforeEach(() => {
      jest.useRealTimers();
    });

    test('calls client.generate with options', async () => {
      const mockClient = {
        generate: jest.fn().mockResolvedValue({ response: 'test output' })
      };
      const generateOptions = { model: 'llama2', prompt: 'test' };

      const result = await ollamaRetry.generateWithRetry(mockClient, generateOptions, {
        operation: 'test',
        maxRetries: 0
      });

      expect(mockClient.generate).toHaveBeenCalledWith(generateOptions);
      expect(result).toEqual({ response: 'test output' });
    });
  });

  describe('axiosWithRetry', () => {
    beforeEach(() => {
      jest.useRealTimers();
    });

    test('returns axios response on success', async () => {
      const axiosCall = jest.fn().mockResolvedValue({ data: 'success' });

      const result = await ollamaRetry.axiosWithRetry(axiosCall, {
        operation: 'test',
        maxRetries: 0
      });

      expect(result).toEqual({ data: 'success' });
    });

    test('normalizes axios errors', async () => {
      const axiosError = {
        response: {
          status: 500,
          statusText: 'Internal Server Error'
        },
        code: 'ERR_BAD_RESPONSE'
      };
      const axiosCall = jest.fn().mockRejectedValue(axiosError);

      await expect(
        ollamaRetry.axiosWithRetry(axiosCall, {
          operation: 'test',
          maxRetries: 0
        })
      ).rejects.toThrow('HTTP 500');
    });
  });
});
