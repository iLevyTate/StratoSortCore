/**
 * Tests for LlamaResilience
 */

jest.mock('../src/shared/logger', () => ({
  createLogger: () => ({
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
    error: jest.fn()
  })
}));

jest.mock('../src/shared/errorHandlingUtils', () => ({
  withRetry: jest.fn()
}));

const { withRetry } = require('../src/shared/errorHandlingUtils');
const {
  withLlamaResilience,
  withOramaResilience,
  isRetryableLlamaError,
  shouldFallbackToCPU
} = require('../src/main/services/LlamaResilience');

describe('LlamaResilience', () => {
  beforeEach(() => {
    withRetry.mockReset();
  });

  test('isRetryableLlamaError matches known patterns', () => {
    expect(isRetryableLlamaError(new Error('CUDA memory allocation failed'))).toBe(true);
    expect(isRetryableLlamaError(new Error('Other error'))).toBe(false);
  });

  test('shouldFallbackToCPU matches GPU errors', () => {
    expect(shouldFallbackToCPU(new Error('CUDA out of memory'))).toBe(true);
    expect(shouldFallbackToCPU(new Error('Not related'))).toBe(false);
  });

  test('withLlamaResilience returns successful result', async () => {
    withRetry.mockImplementationOnce((operation) => operation);
    const operation = jest.fn().mockResolvedValue('ok');
    await expect(withLlamaResilience(operation)).resolves.toBe('ok');
  });

  test('withLlamaResilience falls back to CPU on GPU errors', async () => {
    withRetry.mockImplementationOnce(() => async () => {
      throw new Error('CUDA out of memory');
    });
    withRetry.mockImplementationOnce((operation) => operation);

    const operation = jest.fn((options) => {
      if (options?.forceCPU) return 'cpu-ok';
      throw new Error('CUDA out of memory');
    });

    await expect(withLlamaResilience(operation)).resolves.toBe('cpu-ok');
    expect(operation).toHaveBeenCalledWith({ forceCPU: true });
  });

  test('withLlamaResilience throws enriched error when retries fail', async () => {
    withRetry.mockImplementationOnce(() => async () => {
      throw new Error('timeout');
    });

    await expect(
      withLlamaResilience(async () => 'ignored', { allowCPUFallback: false })
    ).rejects.toThrow(/Llama operation failed/);
  });

  test('withOramaResilience uses withRetry wrapper', async () => {
    const operation = jest.fn().mockResolvedValue('done');
    withRetry.mockImplementationOnce((op) => op);
    await expect(withOramaResilience(operation, { maxRetries: 2 })).resolves.toBe('done');
    expect(withRetry).toHaveBeenCalledWith(operation, expect.objectContaining({ maxRetries: 2 }));
  });
});
