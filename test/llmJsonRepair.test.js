/**
 * @jest-environment node
 */

jest.mock('../src/shared/logger', () => {
  const logger = {
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    error: jest.fn()
  };
  return {
    createLogger: jest.fn(() => logger)
  };
});

jest.mock('../src/shared/promiseUtils', () => ({
  withTimeout: jest.fn((promise) => promise),
  withAbortableTimeout: jest.fn((fn) => fn({ signal: {} }))
}));

jest.mock('../src/main/services/LlamaService', () => ({
  getInstance: jest.fn()
}));

const { withTimeout, withAbortableTimeout } = require('../src/shared/promiseUtils');
const { createLogger } = require('../src/shared/logger');
const {
  attemptJsonRepairWithLlama,
  attemptProseExtractionWithLlama,
  JSON_REPAIR_MAX_TOKENS,
  PROSE_EXTRACTION_MAX_TOKENS
} = require('../src/main/utils/llmJsonRepair');

describe('llmJsonRepair', () => {
  let logger;

  beforeEach(() => {
    jest.clearAllMocks();
    logger = createLogger();
  });

  test('caps JSON repair maxTokens to configured limit', async () => {
    const client = {
      generateText: jest.fn().mockResolvedValue({ response: '{"ok":true}' })
    };

    const repaired = await attemptJsonRepairWithLlama(client, '{"a":1,}', {
      maxTokens: 9999,
      operation: 'repair-test'
    });

    expect(repaired).toBe('{"ok":true}');
    expect(client.generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        maxTokens: JSON_REPAIR_MAX_TOKENS,
        temperature: 0
      })
    );
  });

  test('caps prose extraction maxTokens to configured limit', async () => {
    const client = {
      generateText: jest.fn().mockResolvedValue({ response: '{"category":"Work"}' })
    };

    const extracted = await attemptProseExtractionWithLlama(
      client,
      'This image shows a team chart.',
      {
        maxTokens: 9999,
        operation: 'prose-test'
      }
    );

    expect(extracted).toBe('{"category":"Work"}');
    expect(client.generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        maxTokens: PROSE_EXTRACTION_MAX_TOKENS,
        temperature: 0
      })
    );
  });

  test('classifies JSON repair timeout errors distinctly', async () => {
    const client = {
      generateText: jest.fn().mockResolvedValue({ response: '{}' })
    };
    withAbortableTimeout.mockRejectedValueOnce(new Error('JSON repair timed out after 15000ms'));

    const result = await attemptJsonRepairWithLlama(client, '{"bad":');

    expect(result).toBeNull();
    expect(logger.warn).toHaveBeenCalledWith(
      '[JSON-REPAIR] Repair attempt failed',
      expect.objectContaining({
        errorType: 'timeout'
      })
    );
  });

  test('classifies prose extraction parse/runtime errors', async () => {
    const client = {
      generateText: jest.fn().mockResolvedValue({ response: '{}' })
    };
    withAbortableTimeout.mockRejectedValueOnce(new Error('JSON parser failed in runtime'));

    const result = await attemptProseExtractionWithLlama(
      client,
      'The image appears to show a project milestone timeline with names and dates.'
    );

    expect(result).toBeNull();
    expect(logger.warn).toHaveBeenCalledWith(
      '[PROSE-EXTRACTION] Extraction attempt failed',
      expect.objectContaining({
        errorType: 'parse'
      })
    );
  });
});
