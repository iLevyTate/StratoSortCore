/**
 * Unit tests for main/utils/ollamaDetection
 */

jest.mock('../src/main/utils/asyncSpawnUtils', () => ({
  asyncSpawn: jest.fn()
}));

jest.mock('http', () => ({
  get: jest.fn()
}));

jest.mock('https', () => ({
  get: jest.fn()
}));

const { asyncSpawn } = require('../src/main/utils/asyncSpawnUtils');
const http = require('http');
const https = require('https');

const {
  isOllamaInstalled,
  getOllamaVersion,
  isOllamaRunning,
  getInstalledModels
} = require('../src/main/utils/ollamaDetection');

describe('ollamaDetection', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('isOllamaInstalled', () => {
    test('returns true when ollama --version exits 0', async () => {
      asyncSpawn.mockResolvedValueOnce({ status: 0, stdout: 'ollama version 1.0.0' });
      await expect(isOllamaInstalled()).resolves.toBe(true);
    });

    test('returns false when ollama --version exits non-zero', async () => {
      asyncSpawn.mockResolvedValueOnce({ status: 1, stdout: '', stderr: 'not found' });
      await expect(isOllamaInstalled()).resolves.toBe(false);
    });
  });

  describe('getOllamaVersion', () => {
    test('returns trimmed stdout on success', async () => {
      asyncSpawn.mockResolvedValueOnce({ status: 0, stdout: 'ollama version 1.2.3\n', stderr: '' });
      await expect(getOllamaVersion()).resolves.toBe('ollama version 1.2.3');
    });

    test('falls back to stderr on success when stdout missing', async () => {
      asyncSpawn.mockResolvedValueOnce({ status: 0, stdout: '', stderr: 'ollama version 9.9.9\n' });
      await expect(getOllamaVersion()).resolves.toBe('ollama version 9.9.9');
    });

    test('returns null on failure', async () => {
      asyncSpawn.mockResolvedValueOnce({ status: 127, stdout: '', stderr: 'not found' });
      await expect(getOllamaVersion()).resolves.toBeNull();
    });
  });

  describe('isOllamaRunning', () => {
    const makeRequest = () => {
      const handlers = {};
      return {
        on: (event, cb) => {
          handlers[event] = cb;
          return undefined;
        },
        setTimeout: (ms, cb) => {
          handlers.timeout = cb;
          return undefined;
        },
        destroy: jest.fn(),
        _handlers: handlers
      };
    };

    test('returns false for invalid host URL', async () => {
      await expect(isOllamaRunning('not a url')).resolves.toBe(false);
    });

    test('uses http.get for http urls and returns true on 200', async () => {
      const req = makeRequest();
      http.get.mockImplementationOnce((_url, cb) => {
        cb({ statusCode: 200 });
        return req;
      });

      await expect(isOllamaRunning('http://127.0.0.1:11434')).resolves.toBe(true);
      expect(http.get).toHaveBeenCalled();
      expect(https.get).not.toHaveBeenCalled();
    });

    test('returns false on non-200', async () => {
      const req = makeRequest();
      http.get.mockImplementationOnce((_url, cb) => {
        cb({ statusCode: 503 });
        return req;
      });

      await expect(isOllamaRunning('http://127.0.0.1:11434')).resolves.toBe(false);
    });

    test('returns false on request error', async () => {
      const req = makeRequest();
      // Simulate a request that errors before a response is received.
      http.get.mockImplementationOnce(() => req);

      const promise = isOllamaRunning('http://127.0.0.1:11434');
      // Trigger error event
      req._handlers.error?.(new Error('ECONNREFUSED'));

      await expect(promise).resolves.toBe(false);
    });

    test('returns false on timeout and destroys request', async () => {
      const req = makeRequest();
      http.get.mockImplementationOnce((_url, _cb) => req);

      const promise = isOllamaRunning('http://127.0.0.1:11434');
      req._handlers.timeout?.();

      await expect(promise).resolves.toBe(false);
      expect(req.destroy).toHaveBeenCalled();
    });

    test('uses https.get for https urls', async () => {
      const req = makeRequest();
      https.get.mockImplementationOnce((_url, cb) => {
        cb({ statusCode: 200 });
        return req;
      });

      await expect(isOllamaRunning('https://example.com')).resolves.toBe(true);
      expect(https.get).toHaveBeenCalled();
    });
  });

  describe('getInstalledModels', () => {
    test('returns empty array on spawn failure', async () => {
      asyncSpawn.mockRejectedValueOnce(new Error('spawn failed'));
      await expect(getInstalledModels()).resolves.toEqual([]);
    });

    test('returns empty array on non-zero status', async () => {
      asyncSpawn.mockResolvedValueOnce({ status: 1, stdout: '', stderr: '' });
      await expect(getInstalledModels()).resolves.toEqual([]);
    });

    test('parses model list and lowercases names', async () => {
      asyncSpawn.mockResolvedValueOnce({
        status: 0,
        stdout: `NAME            ID              SIZE    MODIFIED\nLlama3:Latest    abc             1GB     today\nqwen3:0.6b       def             500MB   today\n\n`
      });

      await expect(getInstalledModels()).resolves.toEqual(['llama3:latest', 'qwen3:0.6b']);
    });
  });
});
