/**
 * Characterization tests for Ollama JSON Repair
 *
 * Tests the unified attemptJsonRepairWithOllama function that was consolidated from:
 * - documentLlm.js:81-117
 * - ollamaImageAnalysis.js:100-136
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

// Mock PerformanceService
jest.mock('../src/main/services/PerformanceService', () => ({
  buildOllamaOptions: jest.fn().mockResolvedValue({ num_ctx: 4096 })
}));

// Mock ollamaApiRetry
jest.mock('../src/main/utils/ollamaApiRetry', () => ({
  generateWithRetry: jest.fn()
}));

const {
  attemptJsonRepairWithOllama,
  JSON_REPAIR_MAX_CHARS,
  JSON_REPAIR_MAX_TOKENS
} = require('../src/main/utils/ollamaJsonRepair');
const { generateWithRetry } = require('../src/main/utils/ollamaApiRetry');

describe('ollamaJsonRepair', () => {
  let mockClient;

  beforeEach(() => {
    jest.clearAllMocks();
    mockClient = {
      generate: jest.fn()
    };
  });

  describe('attemptJsonRepairWithOllama', () => {
    describe('input validation', () => {
      test('returns null when client is null', async () => {
        const result = await attemptJsonRepairWithOllama(null, 'test-model', '{"broken": "json"');
        expect(result).toBeNull();
      });

      test('returns null when rawResponse is null', async () => {
        const result = await attemptJsonRepairWithOllama(mockClient, 'test-model', null);
        expect(result).toBeNull();
      });

      test('returns null when rawResponse is empty string', async () => {
        const result = await attemptJsonRepairWithOllama(mockClient, 'test-model', '');
        expect(result).toBeNull();
      });

      test('returns null when rawResponse is undefined', async () => {
        const result = await attemptJsonRepairWithOllama(mockClient, 'test-model', undefined);
        expect(result).toBeNull();
      });
    });

    describe('successful repair', () => {
      test('repairs malformed JSON and returns the response', async () => {
        const repairedJson = '{"category": "document", "confidence": 85}';
        generateWithRetry.mockResolvedValue({ response: repairedJson });

        const result = await attemptJsonRepairWithOllama(
          mockClient,
          'test-model',
          '{"category": "document" "confidence": 85}',
          { operation: 'Test' }
        );

        expect(result).toBe(repairedJson);
        expect(generateWithRetry).toHaveBeenCalledTimes(1);
      });

      test('passes schema to repair prompt when provided', async () => {
        const schema = { category: 'string', confidence: 'number' };
        generateWithRetry.mockResolvedValue({ response: '{}' });

        await attemptJsonRepairWithOllama(mockClient, 'test-model', '{"broken"}', {
          schema,
          operation: 'Test'
        });

        // Verify schema was included in the prompt
        const call = generateWithRetry.mock.calls[0];
        expect(call[1].prompt).toContain('Schema');
        expect(call[1].prompt).toContain('"category"');
      });

      test('uses custom maxTokens when provided', async () => {
        generateWithRetry.mockResolvedValue({ response: '{}' });

        await attemptJsonRepairWithOllama(mockClient, 'test-model', '{"test"}', {
          maxTokens: 200
        });

        const call = generateWithRetry.mock.calls[0];
        expect(call[1].options.num_predict).toBeLessThanOrEqual(200);
      });
    });

    describe('truncation handling', () => {
      test('truncates input longer than JSON_REPAIR_MAX_CHARS', async () => {
        const longInput = 'x'.repeat(JSON_REPAIR_MAX_CHARS + 1000);
        generateWithRetry.mockResolvedValue({ response: '{}' });

        await attemptJsonRepairWithOllama(mockClient, 'test-model', longInput);

        const call = generateWithRetry.mock.calls[0];
        // The input should be truncated in the prompt
        expect(call[1].prompt.length).toBeLessThan(longInput.length + 500);
      });

      test('does not truncate input shorter than JSON_REPAIR_MAX_CHARS', async () => {
        const shortInput = '{"short": "json"}';
        generateWithRetry.mockResolvedValue({ response: shortInput });

        await attemptJsonRepairWithOllama(mockClient, 'test-model', shortInput);

        const call = generateWithRetry.mock.calls[0];
        expect(call[1].prompt).toContain(shortInput);
      });
    });

    describe('error handling', () => {
      test('returns null when generateWithRetry throws', async () => {
        generateWithRetry.mockRejectedValue(new Error('Network error'));

        const result = await attemptJsonRepairWithOllama(mockClient, 'test-model', '{"broken"}');

        expect(result).toBeNull();
      });

      test('returns null when response has no response property', async () => {
        generateWithRetry.mockResolvedValue({});

        const result = await attemptJsonRepairWithOllama(mockClient, 'test-model', '{"broken"}');

        expect(result).toBeNull();
      });

      test('returns null when response is null', async () => {
        generateWithRetry.mockResolvedValue(null);

        const result = await attemptJsonRepairWithOllama(mockClient, 'test-model', '{"broken"}');

        expect(result).toBeNull();
      });
    });

    describe('retry configuration', () => {
      test('uses single retry with short delays', async () => {
        generateWithRetry.mockResolvedValue({ response: '{}' });

        await attemptJsonRepairWithOllama(mockClient, 'test-model', '{"test"}');

        const retryOptions = generateWithRetry.mock.calls[0][2];
        expect(retryOptions.maxRetries).toBe(1);
        expect(retryOptions.initialDelay).toBe(500);
        expect(retryOptions.maxDelay).toBe(1000);
      });

      test('includes operation name in retry options', async () => {
        generateWithRetry.mockResolvedValue({ response: '{}' });

        await attemptJsonRepairWithOllama(mockClient, 'test-model', '{"test"}', {
          operation: 'Custom operation'
        });

        const retryOptions = generateWithRetry.mock.calls[0][2];
        expect(retryOptions.operation).toBe('Custom operation JSON repair');
      });
    });
  });

  describe('constants', () => {
    test('JSON_REPAIR_MAX_CHARS is 4000', () => {
      expect(JSON_REPAIR_MAX_CHARS).toBe(4000);
    });

    test('JSON_REPAIR_MAX_TOKENS is 400', () => {
      expect(JSON_REPAIR_MAX_TOKENS).toBe(400);
    });
  });
});
