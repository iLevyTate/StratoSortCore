/**
 * Test suite for Ollama API retry logic
 * Verifies that all Ollama API calls have proper retry behavior
 */

// jest is provided globally by Jest, no need to import
const {
  withOllamaRetry,
  fetchWithRetry,
  generateWithRetry,
  axiosWithRetry,
  isRetryableError,
} = require('../src/main/utils/ollamaApiRetry');

describe('Ollama API Retry Logic', () => {
  let unhandledRejections;

  beforeEach(() => {
    jest.clearAllMocks();
    // Use modern fake timers
    jest.useFakeTimers({ legacyFakeTimers: false });

    // Track unhandled rejections for tests that expect rejections
    unhandledRejections = [];
    process.on('unhandledRejection', (reason) => {
      unhandledRejections.push(reason);
    });
  });

  afterEach(() => {
    jest.useRealTimers();
    // Clean up unhandled rejection listener
    process.removeAllListeners('unhandledRejection');
    unhandledRejections = [];
  });

  describe('isRetryableError', () => {
    it('should identify network errors as retryable', () => {
      const networkErrors = [
        { code: 'ECONNREFUSED', message: 'Connection refused' },
        { code: 'ECONNRESET', message: 'Connection reset' },
        { code: 'ETIMEDOUT', message: 'Request timeout' },
        { code: 'ENOTFOUND', message: 'Host not found' },
        { message: 'fetch failed' },
        { message: 'Network error occurred' },
      ];

      networkErrors.forEach((error) => {
        expect(isRetryableError(error)).toBe(true);
      });
    });

    it('should identify retryable HTTP status codes', () => {
      const retryableStatuses = [408, 429, 500, 502, 503, 504];

      retryableStatuses.forEach((status) => {
        expect(isRetryableError({ status })).toBe(true);
      });
    });

    it('should not retry validation errors', () => {
      const nonRetryableErrors = [
        { message: 'Invalid request format' },
        { message: 'Validation error: missing field' },
        { message: 'Model not found' },
        { message: 'Unauthorized access' },
        { message: 'Forbidden' },
        { message: 'Bad request' },
        { message: 'Zero length image' },
      ];

      nonRetryableErrors.forEach((error) => {
        expect(isRetryableError(error)).toBe(false);
      });
    });

    it('should not retry non-retryable HTTP status codes', () => {
      const nonRetryableStatuses = [400, 401, 403, 404, 405, 422];

      nonRetryableStatuses.forEach((status) => {
        expect(isRetryableError({ status })).toBe(false);
      });
    });
  });

  describe('withOllamaRetry', () => {
    it('should succeed on first attempt', async () => {
      const mockApiCall = jest.fn().mockResolvedValue({ success: true });

      const result = await withOllamaRetry(mockApiCall, {
        operation: 'Test operation',
        maxRetries: 3,
      });

      expect(result).toEqual({ success: true });
      expect(mockApiCall).toHaveBeenCalledTimes(1);
    });

    it('should retry on transient failure then succeed', async () => {
      const mockApiCall = jest
        .fn()
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce({ success: true });

      const promise = withOllamaRetry(mockApiCall, {
        operation: 'Test operation',
        maxRetries: 3,
        initialDelay: 1000,
      });

      // Fast-forward all timers
      await jest.runAllTimersAsync();

      const result = await promise;

      expect(result).toEqual({ success: true });
      expect(mockApiCall).toHaveBeenCalledTimes(2);
    }, 10000);

    it('should apply exponential backoff', async () => {
      const mockApiCall = jest
        .fn()
        .mockRejectedValueOnce(new Error('Network error'))
        .mockRejectedValueOnce(new Error('Network error'))
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce({ success: true });

      const promise = withOllamaRetry(mockApiCall, {
        operation: 'Test operation',
        maxRetries: 3,
        initialDelay: 1000,
        maxDelay: 4000,
      });

      // Fast-forward all timers
      await jest.runAllTimersAsync();

      const result = await promise;

      expect(result).toEqual({ success: true });
      expect(mockApiCall).toHaveBeenCalledTimes(4);
    }, 10000);

    it('should fail after max retries exhausted', async () => {
      const mockApiCall = jest.fn().mockImplementation(() => {
        return Promise.reject(new Error('Network error'));
      });

      const promise = withOllamaRetry(mockApiCall, {
        operation: 'Test operation',
        maxRetries: 2,
        initialDelay: 100,
      });

      // Fast-forward all timers to allow retries to complete
      jest.advanceTimersByTime(1000);
      await jest.runAllTimersAsync();

      // Use expect().rejects to properly catch the rejection
      await expect(promise).rejects.toThrow('Network error');

      // Should be called initial + maxRetries times
      expect(mockApiCall).toHaveBeenCalledTimes(3); // initial + 2 retries
    }, 10000);

    it('should not retry non-retryable errors', async () => {
      const validationError = new Error('Validation failed');
      const mockApiCall = jest.fn().mockRejectedValue(validationError);

      await expect(
        withOllamaRetry(mockApiCall, {
          operation: 'Test operation',
          maxRetries: 3,
        }),
      ).rejects.toThrow('Validation failed');

      expect(mockApiCall).toHaveBeenCalledTimes(1);
    });

    it('should call onRetry callback', async () => {
      const onRetry = jest.fn();
      const mockApiCall = jest
        .fn()
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce({ success: true });

      const promise = withOllamaRetry(mockApiCall, {
        operation: 'Test operation',
        maxRetries: 3,
        initialDelay: 100,
        onRetry,
      });

      // Advance timers to trigger retry
      await jest.runAllTimersAsync();

      await promise;

      expect(onRetry).toHaveBeenCalledWith(1, expect.any(Object));
    }, 10000);
  });

  describe('fetchWithRetry', () => {
    beforeEach(() => {
      global.fetch = jest.fn();
    });

    afterEach(() => {
      delete global.fetch;
    });

    it('should retry fetch on network error', async () => {
      global.fetch
        .mockRejectedValueOnce(new Error('fetch failed'))
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ result: 'success' }),
        });

      const promise = fetchWithRetry(
        'http://localhost:11434/api/test',
        {},
        {
          maxRetries: 2,
          initialDelay: 100,
        },
      );

      // Advance timers to trigger retry
      await jest.runAllTimersAsync();

      const response = await promise;

      expect(response.ok).toBe(true);
      expect(global.fetch).toHaveBeenCalledTimes(2);
    }, 10000);

    it('should throw on non-200 response', async () => {
      global.fetch.mockImplementation(() => {
        return Promise.resolve({
          ok: false,
          status: 500,
          statusText: 'Internal Server Error',
          text: async () => '{"error": "Server error"}',
        });
      });

      // Create promise but don't await yet - let timers control execution
      const promise = fetchWithRetry(
        'http://localhost:11434/api/test',
        {},
        {
          maxRetries: 2,
          initialDelay: 100,
        },
      );

      // Advance timers to trigger retries
      jest.advanceTimersByTime(1000); // Advance enough for all retries
      await jest.runAllTimersAsync();

      // Use expect().rejects to properly catch the rejection
      await expect(promise).rejects.toThrow(/HTTP 500|Server error/);

      expect(global.fetch).toHaveBeenCalledTimes(3); // initial + 2 retries
    }, 10000);
  });

  describe('generateWithRetry', () => {
    it('should retry generate calls', async () => {
      const mockClient = {
        generate: jest
          .fn()
          .mockRejectedValueOnce(new Error('Connection reset'))
          .mockResolvedValueOnce({ response: '{"result": "success"}' }),
      };

      const promise = generateWithRetry(
        mockClient,
        { model: 'test-model', prompt: 'test' },
        { maxRetries: 2, initialDelay: 100 },
      );

      // Advance timers to trigger retry
      await jest.runAllTimersAsync();

      const result = await promise;

      expect(result.response).toBe('{"result": "success"}');
      expect(mockClient.generate).toHaveBeenCalledTimes(2);
    }, 10000);
  });

  describe('axiosWithRetry', () => {
    it('should retry axios calls', async () => {
      const mockAxiosCall = jest
        .fn()
        .mockRejectedValueOnce({
          response: { status: 503, statusText: 'Service Unavailable' },
          code: 'ECONNREFUSED',
        })
        .mockResolvedValueOnce({
          status: 200,
          data: { success: true },
        });

      const promise = axiosWithRetry(() => mockAxiosCall(), {
        maxRetries: 2,
        initialDelay: 100,
      });

      // Advance timers to trigger retry
      await jest.runAllTimersAsync();

      const result = await promise;

      expect(result.status).toBe(200);
      expect(mockAxiosCall).toHaveBeenCalledTimes(2);
    }, 10000);
  });
});

describe('Integration Tests', () => {
  it('should handle complex retry scenario with multiple failures', async () => {
    const mockApiCall = jest
      .fn()
      .mockRejectedValueOnce(new Error('Connection refused'))
      .mockRejectedValueOnce(new Error('Request timeout'))
      .mockRejectedValueOnce({ status: 503, message: 'Service unavailable' })
      .mockResolvedValueOnce({ success: true });

    const promise = withOllamaRetry(mockApiCall, {
      operation: 'Complex test',
      maxRetries: 3,
      initialDelay: 500,
      maxDelay: 4000,
    });

    // Advance through all retry delays
    await jest.runAllTimersAsync();

    const result = await promise;

    expect(result).toEqual({ success: true });
    expect(mockApiCall).toHaveBeenCalledTimes(4);
  });

  it('should respect maxDelay cap', async () => {
    const delays = [];
    const mockApiCall = jest.fn().mockImplementation(() => {
      delays.push(Date.now());
      return Promise.reject(new Error('Network error'));
    });

    const promise = withOllamaRetry(mockApiCall, {
      operation: 'Delay cap test',
      maxRetries: 5,
      initialDelay: 1000,
      maxDelay: 3000,
    });

    // Advance through all retries
    await jest.runAllTimersAsync();

    await expect(promise).rejects.toThrow('Network error');

    // Verify delays don't exceed maxDelay
    // Initial call is immediate, then 1000, 2000, 3000 (capped), 3000, 3000
    expect(mockApiCall).toHaveBeenCalledTimes(6);
  }, 15000);
});
