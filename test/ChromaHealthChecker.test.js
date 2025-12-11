/**
 * Tests for ChromaHealthChecker
 * Tests health checking utilities for ChromaDB connections
 */

// Mock axios
const mockAxios = {
  get: jest.fn()
};
jest.mock('axios', () => mockAxios);

// Mock chromadb
const mockChromaClient = {
  heartbeat: jest.fn()
};
jest.mock('chromadb', () => ({
  ChromaClient: jest.fn(() => mockChromaClient)
}));

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

// Mock config
jest.mock('../src/shared/config/index', () => ({
  get: jest.fn((key, defaultVal) => defaultVal)
}));

describe('ChromaHealthChecker', () => {
  let checkHealthViaHttp;
  let checkHealthViaClient;
  let isServerAvailable;
  let createHealthCheckInterval;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
    jest.useFakeTimers();

    mockAxios.get.mockReset();
    mockChromaClient.heartbeat.mockReset();

    const module = require('../src/main/services/chromadb/ChromaHealthChecker');
    checkHealthViaHttp = module.checkHealthViaHttp;
    checkHealthViaClient = module.checkHealthViaClient;
    isServerAvailable = module.isServerAvailable;
    createHealthCheckInterval = module.createHealthCheckInterval;
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('checkHealthViaHttp', () => {
    test('returns healthy when v2 heartbeat succeeds', async () => {
      mockAxios.get.mockResolvedValueOnce({
        status: 200,
        data: { nanosecond_heartbeat: 123456789 }
      });

      const result = await checkHealthViaHttp('http://localhost:8000');

      expect(result.healthy).toBe(true);
      expect(result.endpoint).toBe('/api/v2/heartbeat');
    });

    test('returns healthy when v1 heartbeat succeeds', async () => {
      mockAxios.get
        .mockRejectedValueOnce(new Error('Not found')) // v2 fails
        .mockResolvedValueOnce({
          status: 200,
          data: { 'nanosecond heartbeat': 123456789 }
        });

      const result = await checkHealthViaHttp('http://localhost:8000');

      expect(result.healthy).toBe(true);
    });

    test('returns healthy with status ok response', async () => {
      mockAxios.get.mockResolvedValueOnce({
        status: 200,
        data: { status: 'ok' }
      });

      const result = await checkHealthViaHttp('http://localhost:8000');

      expect(result.healthy).toBe(true);
    });

    test('returns healthy with version response', async () => {
      mockAxios.get.mockResolvedValueOnce({
        status: 200,
        data: { version: '1.0.0' }
      });

      const result = await checkHealthViaHttp('http://localhost:8000');

      expect(result.healthy).toBe(true);
    });

    test('returns healthy with generic 200 response', async () => {
      mockAxios.get.mockResolvedValueOnce({
        status: 200,
        data: {}
      });

      const result = await checkHealthViaHttp('http://localhost:8000');

      expect(result.healthy).toBe(true);
    });

    test('returns unhealthy when response contains error', async () => {
      mockAxios.get.mockResolvedValue({
        status: 200,
        data: { error: 'Server error' }
      });

      const result = await checkHealthViaHttp('http://localhost:8000');

      expect(result.healthy).toBe(false);
    });

    test('returns unhealthy when all endpoints fail', async () => {
      mockAxios.get.mockRejectedValue(new Error('Connection refused'));

      const result = await checkHealthViaHttp('http://localhost:8000');

      expect(result.healthy).toBe(false);
      expect(result.endpoint).toBeUndefined();
    });

    test('returns unhealthy for non-200 status', async () => {
      mockAxios.get.mockResolvedValue({
        status: 500,
        data: {}
      });

      const result = await checkHealthViaHttp('http://localhost:8000');

      expect(result.healthy).toBe(false);
    });
  });

  describe('checkHealthViaClient', () => {
    test('returns true when client heartbeat succeeds', async () => {
      mockChromaClient.heartbeat.mockResolvedValueOnce({
        nanosecond_heartbeat: 123456789
      });

      const result = await checkHealthViaClient(mockChromaClient);

      expect(result).toBe(true);
    });

    test('returns true with legacy heartbeat format', async () => {
      mockChromaClient.heartbeat.mockResolvedValueOnce({
        'nanosecond heartbeat': 123456789
      });

      const result = await checkHealthViaClient(mockChromaClient);

      expect(result).toBe(true);
    });

    test('returns false when client is null', async () => {
      const result = await checkHealthViaClient(null);

      expect(result).toBe(false);
    });

    test('returns false when heartbeat fails', async () => {
      mockChromaClient.heartbeat.mockRejectedValueOnce(new Error('Connection failed'));

      const result = await checkHealthViaClient(mockChromaClient);

      expect(result).toBe(false);
    });

    test('returns false when heartbeat returns invalid response', async () => {
      mockChromaClient.heartbeat.mockResolvedValueOnce({});

      const result = await checkHealthViaClient(mockChromaClient);

      expect(result).toBe(false);
    });

    test('returns false when heartbeat returns null', async () => {
      mockChromaClient.heartbeat.mockResolvedValueOnce(null);

      const result = await checkHealthViaClient(mockChromaClient);

      expect(result).toBeFalsy();
    });
  });

  describe('isServerAvailable', () => {
    test('returns true when server responds', async () => {
      jest.useRealTimers();

      mockChromaClient.heartbeat.mockResolvedValueOnce({
        nanosecond_heartbeat: 123456789
      });

      const result = await isServerAvailable({
        serverUrl: 'http://localhost:8000',
        client: mockChromaClient,
        timeoutMs: 1000,
        maxRetries: 1
      });

      expect(result).toBe(true);
    });

    test('retries on timeout error', async () => {
      jest.useRealTimers();

      mockChromaClient.heartbeat
        .mockRejectedValueOnce(new Error('timeout'))
        .mockResolvedValueOnce({ nanosecond_heartbeat: 123 });

      const result = await isServerAvailable({
        serverUrl: 'http://localhost:8000',
        client: mockChromaClient,
        timeoutMs: 100,
        maxRetries: 2
      });

      expect(result).toBe(true);
      expect(mockChromaClient.heartbeat).toHaveBeenCalledTimes(2);
    });

    test('retries on ECONNREFUSED error', async () => {
      jest.useRealTimers();

      const error = new Error('Connection refused');
      error.code = 'ECONNREFUSED';

      mockChromaClient.heartbeat
        .mockRejectedValueOnce(error)
        .mockResolvedValueOnce({ nanosecond_heartbeat: 123 });

      const result = await isServerAvailable({
        serverUrl: 'http://localhost:8000',
        client: mockChromaClient,
        timeoutMs: 100,
        maxRetries: 2
      });

      expect(result).toBe(true);
    });

    test('returns false after all retries exhausted', async () => {
      jest.useRealTimers();

      const error = new Error('Connection refused');
      error.code = 'ECONNREFUSED';

      mockChromaClient.heartbeat.mockRejectedValue(error);

      const result = await isServerAvailable({
        serverUrl: 'http://localhost:8000',
        client: mockChromaClient,
        timeoutMs: 100,
        maxRetries: 2
      });

      expect(result).toBe(false);
    });

    test('returns false after exhausting all retries on non-retryable error', async () => {
      jest.useRealTimers();

      // Non-retryable errors still exhaust retries in the current implementation
      mockChromaClient.heartbeat.mockRejectedValue(new Error('Invalid request'));

      const result = await isServerAvailable({
        serverUrl: 'http://localhost:8000',
        client: mockChromaClient,
        timeoutMs: 100,
        maxRetries: 1
      });

      expect(result).toBe(false);
    });

    test('creates new client when none provided', async () => {
      jest.useRealTimers();
      const { ChromaClient } = require('chromadb');

      mockChromaClient.heartbeat.mockResolvedValueOnce({
        nanosecond_heartbeat: 123
      });

      await isServerAvailable({
        serverUrl: 'http://localhost:8000',
        timeoutMs: 100,
        maxRetries: 1
      });

      expect(ChromaClient).toHaveBeenCalled();
    });
  });

  describe('createHealthCheckInterval', () => {
    test('calls check function immediately', () => {
      const checkFn = jest.fn().mockResolvedValue(true);

      createHealthCheckInterval({
        checkFn,
        intervalMs: 30000
      });

      expect(checkFn).toHaveBeenCalledTimes(1);
    });

    test('calls check function on interval', () => {
      const checkFn = jest.fn().mockResolvedValue(true);

      createHealthCheckInterval({
        checkFn,
        intervalMs: 1000
      });

      // Initial call
      expect(checkFn).toHaveBeenCalledTimes(1);

      // Advance timer
      jest.advanceTimersByTime(1000);
      expect(checkFn).toHaveBeenCalledTimes(2);

      jest.advanceTimersByTime(1000);
      expect(checkFn).toHaveBeenCalledTimes(3);
    });

    test('returns stop function that clears interval', () => {
      const checkFn = jest.fn().mockResolvedValue(true);

      const { stop } = createHealthCheckInterval({
        checkFn,
        intervalMs: 1000
      });

      expect(checkFn).toHaveBeenCalledTimes(1);

      stop();

      jest.advanceTimersByTime(5000);
      expect(checkFn).toHaveBeenCalledTimes(1); // No more calls after stop
    });

    test('handles check function errors gracefully', async () => {
      const checkFn = jest.fn().mockRejectedValue(new Error('Check failed'));

      // Should not throw
      expect(() =>
        createHealthCheckInterval({
          checkFn,
          intervalMs: 1000
        })
      ).not.toThrow();

      // Allow promise rejection to be handled
      await Promise.resolve();
    });

    test('returns intervalId', () => {
      const checkFn = jest.fn().mockResolvedValue(true);

      const { intervalId } = createHealthCheckInterval({
        checkFn,
        intervalMs: 1000
      });

      expect(intervalId).toBeDefined();
    });
  });
});
