/**
 * Tests for healthCheckUtils
 */

jest.mock('../src/shared/logger', () => ({
  logger: {
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  }
}));

const { createHealthCheckInterval } = require('../src/shared/healthCheckUtils');

describe('healthCheckUtils', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('createHealthCheckInterval', () => {
    test('creates interval that performs periodic checks', async () => {
      const checkFn = jest.fn().mockResolvedValue(true);
      const onHealthy = jest.fn();

      const checker = createHealthCheckInterval({
        checkFn,
        intervalMs: 50,
        timeoutMs: 100,
        name: 'Test',
        onHealthy
      });

      // Wait for initial check + one interval
      await new Promise((r) => setTimeout(r, 80));

      expect(checkFn).toHaveBeenCalled();
      expect(onHealthy).toHaveBeenCalled();
      expect(checker.state.isHealthy).toBe(true);

      checker.stop();
    });

    test('calls onUnhealthy when check fails', async () => {
      const checkFn = jest.fn().mockRejectedValue(new Error('Service down'));
      const onUnhealthy = jest.fn();

      const checker = createHealthCheckInterval({
        checkFn,
        intervalMs: 100,
        timeoutMs: 50,
        name: 'Test',
        onUnhealthy
      });

      // Wait for initial check
      await new Promise((r) => setTimeout(r, 30));

      expect(onUnhealthy).toHaveBeenCalled();
      expect(checker.state.isHealthy).toBe(false);
      expect(checker.state.consecutiveFailures).toBe(1);

      checker.stop();
    });

    test('tracks consecutive failures', async () => {
      const checkFn = jest.fn().mockImplementation(() => {
        return Promise.reject(new Error('fail'));
      });

      const checker = createHealthCheckInterval({
        checkFn,
        intervalMs: 30,
        timeoutMs: 100,
        name: 'Test'
      });

      // Wait for multiple checks
      await new Promise((r) => setTimeout(r, 100));

      expect(checker.state.consecutiveFailures).toBeGreaterThan(1);

      checker.stop();
    });

    test('resets failures on successful check', async () => {
      let shouldFail = true;
      const checkFn = jest.fn().mockImplementation(() => {
        if (shouldFail) {
          return Promise.reject(new Error('fail'));
        }
        return Promise.resolve(true);
      });

      const checker = createHealthCheckInterval({
        checkFn,
        intervalMs: 30,
        timeoutMs: 100,
        name: 'Test'
      });

      // Wait for initial failure
      await new Promise((r) => setTimeout(r, 20));
      expect(checker.state.consecutiveFailures).toBe(1);

      // Make next check succeed
      shouldFail = false;
      await new Promise((r) => setTimeout(r, 50));

      expect(checker.state.consecutiveFailures).toBe(0);
      expect(checker.state.isHealthy).toBe(true);

      checker.stop();
    });

    test('stop() clears interval', async () => {
      const checkFn = jest.fn().mockResolvedValue(true);

      const checker = createHealthCheckInterval({
        checkFn,
        intervalMs: 20,
        timeoutMs: 100,
        name: 'Test'
      });

      // Wait for initial check
      await new Promise((r) => setTimeout(r, 30));
      const callCountAtStop = checkFn.mock.calls.length;

      checker.stop();

      // Wait and verify no more calls
      await new Promise((r) => setTimeout(r, 60));
      expect(checkFn.mock.calls.length).toBe(callCountAtStop);
    });

    test('handles timeout correctly', async () => {
      const checkFn = jest.fn().mockImplementation(() => {
        return new Promise((resolve) => setTimeout(resolve, 200));
      });
      const onUnhealthy = jest.fn();

      const checker = createHealthCheckInterval({
        checkFn,
        intervalMs: 500,
        timeoutMs: 50,
        name: 'Test',
        onUnhealthy
      });

      // Wait for timeout
      await new Promise((r) => setTimeout(r, 100));

      expect(onUnhealthy).toHaveBeenCalled();
      expect(checker.state.isHealthy).toBe(false);

      checker.stop();
    });

    test('forceCheck() triggers immediate check', async () => {
      const checkFn = jest.fn().mockResolvedValue(true);

      const checker = createHealthCheckInterval({
        checkFn,
        intervalMs: 10000, // Long interval
        timeoutMs: 100,
        name: 'Test'
      });

      // Wait for initial check
      await new Promise((r) => setTimeout(r, 20));
      const initialCalls = checkFn.mock.calls.length;

      // Force another check
      await checker.forceCheck();

      expect(checkFn.mock.calls.length).toBe(initialCalls + 1);

      checker.stop();
    });
  });

  // Note: executeWithTimeout and isServiceAvailable tests removed
  // as these functions were removed from healthCheckUtils.js
  // (they were unused externally - only createHealthCheckInterval is needed)
});
