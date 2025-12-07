/**
 * Tests for Promise Utilities
 * Tests delay, timeout, retry, debounce, throttle, and batch processing
 */

// Mock logger
jest.mock('../src/shared/logger', () => ({
  logger: {
    setContext: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

const {
  delay,
  sleep,
  withTimeout,
  withRetry,
  retry,
  safeCall,
  safeAwait,
  debounce,
  throttle,
  batchProcess,
} = require('../src/shared/promiseUtils');

describe('promiseUtils', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('delay', () => {
    test('resolves after specified time', async () => {
      const promise = delay(1000);

      jest.advanceTimersByTime(1000);

      await expect(promise).resolves.toBeUndefined();
    });

    test('sleep is alias for delay', () => {
      expect(sleep).toBe(delay);
    });
  });

  describe('withTimeout', () => {
    beforeEach(() => {
      jest.useRealTimers();
    });

    test('resolves when promise completes before timeout', async () => {
      const promise = Promise.resolve('success');

      const result = await withTimeout(promise, 1000, 'Test');

      expect(result).toBe('success');
    });

    test('rejects when promise exceeds timeout', async () => {
      const slowPromise = new Promise((resolve) => setTimeout(resolve, 2000));

      await expect(withTimeout(slowPromise, 100, 'SlowOp')).rejects.toThrow(
        'SlowOp timed out after 100ms',
      );
    });

    test('wraps function with timeout', async () => {
      const fastFn = jest.fn().mockResolvedValue('fast result');
      const wrappedFn = withTimeout(fastFn, 1000, 'FastFn');

      const result = await wrappedFn('arg1');

      expect(result).toBe('fast result');
      expect(fastFn).toHaveBeenCalledWith('arg1');
    });

    test('wrapped function rejects on timeout', async () => {
      const slowFn = () => new Promise((resolve) => setTimeout(resolve, 2000));
      const wrappedFn = withTimeout(slowFn, 100, 'SlowFn');

      await expect(wrappedFn()).rejects.toThrow('SlowFn timed out after 100ms');
    });
  });

  describe('withRetry', () => {
    beforeEach(() => {
      jest.useRealTimers();
    });

    test('returns result on first success', async () => {
      const fn = jest.fn().mockResolvedValue('success');
      const retryFn = withRetry(fn, { maxRetries: 3, initialDelay: 10 });

      const result = await retryFn();

      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    test('retries on failure', async () => {
      const fn = jest
        .fn()
        .mockRejectedValueOnce(new Error('fail 1'))
        .mockRejectedValueOnce(new Error('fail 2'))
        .mockResolvedValue('success');

      const retryFn = withRetry(fn, { maxRetries: 3, initialDelay: 10 });

      const result = await retryFn();

      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(3);
    });

    test('throws after max retries', async () => {
      const fn = jest.fn().mockRejectedValue(new Error('always fails'));
      const retryFn = withRetry(fn, { maxRetries: 2, initialDelay: 10 });

      await expect(retryFn()).rejects.toThrow('always fails');
      expect(fn).toHaveBeenCalledTimes(3); // Initial + 2 retries
    });

    test('respects shouldRetry callback', async () => {
      const fn = jest.fn().mockRejectedValue(new Error('AUTH_FAILED'));
      const retryFn = withRetry(fn, {
        maxRetries: 3,
        initialDelay: 10,
        shouldRetry: (error) => !error.message.includes('AUTH'),
      });

      await expect(retryFn()).rejects.toThrow('AUTH_FAILED');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    test('calls onRetry callback', async () => {
      const fn = jest
        .fn()
        .mockRejectedValueOnce(new Error('fail'))
        .mockResolvedValue('success');
      const onRetry = jest.fn();

      const retryFn = withRetry(fn, {
        maxRetries: 3,
        initialDelay: 10,
        onRetry,
      });

      await retryFn();

      expect(onRetry).toHaveBeenCalledWith(expect.any(Error), 0);
    });

    test('supports alias parameter names', async () => {
      const fn = jest.fn().mockResolvedValue('success');
      const retryFn = withRetry(fn, {
        maxAttempts: 2,
        delay: 10,
        backoffFactor: 1.5,
      });

      await retryFn();

      expect(fn).toHaveBeenCalled();
    });

    test('passes arguments to wrapped function', async () => {
      const fn = jest.fn().mockResolvedValue('result');
      const retryFn = withRetry(fn, { maxRetries: 1, initialDelay: 10 });

      await retryFn('arg1', 'arg2', { key: 'value' });

      expect(fn).toHaveBeenCalledWith('arg1', 'arg2', { key: 'value' });
    });
  });

  describe('retry', () => {
    beforeEach(() => {
      jest.useRealTimers();
    });

    test('immediately invokes operation with retry logic', async () => {
      const operation = jest.fn().mockResolvedValue('result');

      const result = await retry(operation, {
        maxRetries: 3,
        initialDelay: 10,
      });

      expect(result).toBe('result');
      expect(operation).toHaveBeenCalledTimes(1);
    });
  });

  describe('safeCall', () => {
    beforeEach(() => {
      jest.useRealTimers();
    });

    test('returns function result on success', async () => {
      const fn = jest.fn().mockResolvedValue('success');
      const safeFn = safeCall(fn, 'fallback');

      const result = await safeFn();

      expect(result).toBe('success');
    });

    test('returns fallback on error', async () => {
      const fn = jest.fn().mockRejectedValue(new Error('error'));
      const safeFn = safeCall(fn, 'fallback');

      const result = await safeFn();

      expect(result).toBe('fallback');
    });

    test('returns fallback for non-function', async () => {
      const safeFn = safeCall('not a function', 'fallback');

      const result = await safeFn();

      expect(result).toBe('fallback');
    });

    test('returns fallback when result is undefined', async () => {
      const fn = jest.fn().mockResolvedValue(undefined);
      const safeFn = safeCall(fn, 'fallback');

      const result = await safeFn();

      expect(result).toBe('fallback');
    });

    test('passes arguments to function', async () => {
      const fn = jest.fn().mockResolvedValue('result');
      const safeFn = safeCall(fn, null);

      await safeFn('arg1', 'arg2');

      expect(fn).toHaveBeenCalledWith('arg1', 'arg2');
    });

    test('respects logError option', async () => {
      const fn = jest.fn().mockRejectedValue(new Error('error'));
      const safeFn = safeCall(fn, 'fallback', { logError: false });

      await safeFn();

      // Should not throw even with logError false
      expect(fn).toHaveBeenCalled();
    });
  });

  describe('safeAwait', () => {
    beforeEach(() => {
      jest.useRealTimers();
    });

    test('returns promise result on success', async () => {
      const result = await safeAwait(Promise.resolve('success'), 'default');

      expect(result).toBe('success');
    });

    test('returns default on rejection', async () => {
      const result = await safeAwait(
        Promise.reject(new Error('error')),
        'default',
      );

      expect(result).toBe('default');
    });

    test('uses null as default fallback', async () => {
      const result = await safeAwait(Promise.reject(new Error('error')));

      expect(result).toBeNull();
    });
  });

  describe('debounce', () => {
    test('delays function execution', () => {
      const fn = jest.fn();
      const debounced = debounce(fn, 100);

      debounced();
      debounced();
      debounced();

      expect(fn).not.toHaveBeenCalled();

      jest.advanceTimersByTime(100);

      expect(fn).toHaveBeenCalledTimes(1);
    });

    test('cancel prevents execution', () => {
      const fn = jest.fn();
      const debounced = debounce(fn, 100);

      debounced();
      debounced.cancel();

      jest.advanceTimersByTime(100);

      expect(fn).not.toHaveBeenCalled();
    });

    test('flush executes immediately', () => {
      const fn = jest.fn().mockReturnValue('result');
      const debounced = debounce(fn, 100);

      debounced();
      const result = debounced.flush();

      expect(fn).toHaveBeenCalledTimes(1);
      expect(result).toBe('result');
    });

    test('leading option executes immediately', () => {
      const fn = jest.fn();
      const debounced = debounce(fn, 100, { leading: true, trailing: false });

      debounced();

      expect(fn).toHaveBeenCalledTimes(1);

      debounced();
      debounced();

      expect(fn).toHaveBeenCalledTimes(1);
    });

    test('passes last arguments', () => {
      const fn = jest.fn();
      const debounced = debounce(fn, 100);

      debounced('first');
      debounced('second');
      debounced('third');

      jest.advanceTimersByTime(100);

      expect(fn).toHaveBeenCalledWith('third');
    });
  });

  describe('throttle', () => {
    test('limits function execution rate', () => {
      const fn = jest.fn();
      const throttled = throttle(fn, 100);

      throttled();
      expect(fn).toHaveBeenCalledTimes(1);

      throttled();
      throttled();
      expect(fn).toHaveBeenCalledTimes(1);

      jest.advanceTimersByTime(100);

      expect(fn).toHaveBeenCalledTimes(2);
    });

    test('cancel prevents trailing execution', () => {
      const fn = jest.fn();
      const throttled = throttle(fn, 100);

      throttled();
      throttled();
      throttled.cancel();

      jest.advanceTimersByTime(100);

      expect(fn).toHaveBeenCalledTimes(1);
    });
  });

  describe('batchProcess', () => {
    beforeEach(() => {
      jest.useRealTimers();
    });

    test('processes items in batches', async () => {
      const items = [1, 2, 3, 4, 5];
      const fn = jest.fn().mockResolvedValue('processed');

      const results = await batchProcess(items, fn, 2);

      expect(results).toHaveLength(5);
      expect(fn).toHaveBeenCalledTimes(5);
    });

    test('maintains order of results', async () => {
      const items = ['a', 'b', 'c'];
      const fn = jest
        .fn()
        .mockImplementation((item) => Promise.resolve(item.toUpperCase()));

      const results = await batchProcess(items, fn, 2);

      expect(results).toEqual(['A', 'B', 'C']);
    });

    test('handles errors gracefully', async () => {
      const items = [1, 2, 3];
      const fn = jest
        .fn()
        .mockResolvedValueOnce('success1')
        .mockRejectedValueOnce(new Error('fail'))
        .mockResolvedValueOnce('success3');

      const results = await batchProcess(items, fn, 3);

      expect(results[0]).toBe('success1');
      expect(results[1]).toBeNull();
      expect(results[2]).toBe('success3');
    });

    test('uses default batch size of 5', async () => {
      const items = Array(10).fill(0);
      const fn = jest.fn().mockResolvedValue('done');

      await batchProcess(items, fn);

      expect(fn).toHaveBeenCalledTimes(10);
    });

    test('passes index to callback', async () => {
      const items = ['a', 'b', 'c'];
      const fn = jest.fn().mockResolvedValue('result');

      await batchProcess(items, fn, 10);

      expect(fn).toHaveBeenCalledWith('a', 0);
      expect(fn).toHaveBeenCalledWith('b', 1);
      expect(fn).toHaveBeenCalledWith('c', 2);
    });
  });
});
