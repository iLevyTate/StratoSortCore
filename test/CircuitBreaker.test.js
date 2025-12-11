/**
 * Tests for CircuitBreaker
 * Tests state transitions, failure handling, recovery, and statistics
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

const {
  CircuitBreaker,
  CircuitState,
  DEFAULT_CONFIG
} = require('../src/main/utils/CircuitBreaker');

describe('CircuitBreaker', () => {
  let breaker;

  beforeEach(() => {
    breaker = new CircuitBreaker('test-service', {
      failureThreshold: 3,
      successThreshold: 2,
      timeout: 100, // Short timeout for tests
      resetTimeout: 200
    });
  });

  afterEach(() => {
    breaker.cleanup();
  });

  describe('initialization', () => {
    test('starts in CLOSED state', () => {
      expect(breaker.getState()).toBe(CircuitState.CLOSED);
    });

    test('initializes with default config', () => {
      const defaultBreaker = new CircuitBreaker('default');
      expect(defaultBreaker.config.failureThreshold).toBe(DEFAULT_CONFIG.failureThreshold);
      expect(defaultBreaker.config.successThreshold).toBe(DEFAULT_CONFIG.successThreshold);
      defaultBreaker.cleanup();
    });

    test('allows custom config', () => {
      expect(breaker.config.failureThreshold).toBe(3);
      expect(breaker.config.successThreshold).toBe(2);
    });

    test('is available in CLOSED state', () => {
      expect(breaker.isAvailable()).toBe(true);
      expect(breaker.isAllowed()).toBe(true);
    });
  });

  describe('CLOSED state', () => {
    test('allows requests in CLOSED state', () => {
      expect(breaker.isAllowed()).toBe(true);
    });

    test('records successful operations', () => {
      breaker.recordSuccess();

      const stats = breaker.getStats();
      expect(stats.successfulRequests).toBe(1);
      expect(stats.totalRequests).toBe(1);
    });

    test('records failed operations', () => {
      breaker.recordFailure(new Error('Test error'));

      const stats = breaker.getStats();
      expect(stats.failedRequests).toBe(1);
      expect(stats.totalRequests).toBe(1);
    });

    test('resets failure count on success', () => {
      breaker.recordFailure(new Error('Test error'));
      breaker.recordFailure(new Error('Test error'));
      expect(breaker.failureCount).toBe(2);

      breaker.recordSuccess();
      expect(breaker.failureCount).toBe(0);
    });

    test('opens circuit after failure threshold', () => {
      for (let i = 0; i < 3; i++) {
        breaker.recordFailure(new Error('Test error'));
      }

      expect(breaker.getState()).toBe(CircuitState.OPEN);
    });

    test('does not open before failure threshold', () => {
      breaker.recordFailure(new Error('Test error'));
      breaker.recordFailure(new Error('Test error'));

      expect(breaker.getState()).toBe(CircuitState.CLOSED);
    });
  });

  describe('OPEN state', () => {
    beforeEach(() => {
      // Force into OPEN state
      for (let i = 0; i < 3; i++) {
        breaker.recordFailure(new Error('Test error'));
      }
    });

    test('rejects requests in OPEN state', () => {
      expect(breaker.isAllowed()).toBe(false);
      expect(breaker.isAvailable()).toBe(false);
    });

    test('records rejections', () => {
      breaker.recordRejection();

      const stats = breaker.getStats();
      expect(stats.rejectedRequests).toBe(1);
    });

    test('transitions to HALF_OPEN after timeout', async () => {
      await new Promise((resolve) => setTimeout(resolve, 150));

      expect(breaker.getState()).toBe(CircuitState.HALF_OPEN);
    });

    test('resets success count when entering OPEN', () => {
      expect(breaker.successCount).toBe(0);
    });
  });

  describe('HALF_OPEN state', () => {
    beforeEach(async () => {
      // Force into OPEN then wait for HALF_OPEN
      for (let i = 0; i < 3; i++) {
        breaker.recordFailure(new Error('Test error'));
      }
      await new Promise((resolve) => setTimeout(resolve, 150));
    });

    test('allows limited requests in HALF_OPEN', () => {
      expect(breaker.getState()).toBe(CircuitState.HALF_OPEN);
      expect(breaker.isAllowed()).toBe(true);
    });

    test('closes circuit after success threshold', () => {
      breaker.recordSuccess();
      expect(breaker.getState()).toBe(CircuitState.HALF_OPEN);

      breaker.recordSuccess();
      expect(breaker.getState()).toBe(CircuitState.CLOSED);
    });

    test('reopens circuit on failure in HALF_OPEN', () => {
      breaker.recordFailure(new Error('Test error'));

      expect(breaker.getState()).toBe(CircuitState.OPEN);
    });

    test('limits concurrent requests in HALF_OPEN', () => {
      expect(breaker.isAllowed()).toBe(true);
      breaker.halfOpenInFlight = 1;
      expect(breaker.isAllowed()).toBe(false);
    });
  });

  describe('execute method', () => {
    test('executes operation successfully', async () => {
      const result = await breaker.execute(async () => 'success');

      expect(result).toBe('success');
      expect(breaker.getStats().successfulRequests).toBe(1);
    });

    test('records failure on operation error', async () => {
      await expect(
        breaker.execute(async () => {
          throw new Error('Operation failed');
        })
      ).rejects.toThrow('Operation failed');

      expect(breaker.getStats().failedRequests).toBe(1);
    });

    test('throws CIRCUIT_OPEN error when circuit is open', async () => {
      // Force circuit open
      breaker.forceState(CircuitState.OPEN);

      await expect(breaker.execute(async () => 'test')).rejects.toMatchObject({
        code: 'CIRCUIT_OPEN',
        serviceName: 'test-service',
        state: CircuitState.OPEN
      });
    });

    test('tracks in-flight requests in HALF_OPEN', async () => {
      breaker.forceState(CircuitState.HALF_OPEN);
      expect(breaker.halfOpenInFlight).toBe(0);

      const promise = breaker.execute(
        async () => new Promise((resolve) => setTimeout(() => resolve('done'), 50))
      );
      expect(breaker.halfOpenInFlight).toBe(1);

      await promise;
      expect(breaker.halfOpenInFlight).toBe(0);
    });
  });

  describe('forceState', () => {
    test('forces circuit to OPEN', () => {
      breaker.forceState(CircuitState.OPEN);
      expect(breaker.getState()).toBe(CircuitState.OPEN);
    });

    test('forces circuit to HALF_OPEN', () => {
      breaker.forceState(CircuitState.HALF_OPEN);
      expect(breaker.getState()).toBe(CircuitState.HALF_OPEN);
    });

    test('forces circuit to CLOSED', () => {
      breaker.forceState(CircuitState.OPEN);
      breaker.forceState(CircuitState.CLOSED);
      expect(breaker.getState()).toBe(CircuitState.CLOSED);
    });

    test('throws on invalid state', () => {
      expect(() => breaker.forceState('INVALID')).toThrow('Invalid circuit state');
    });
  });

  describe('reset', () => {
    test('resets circuit to initial state', () => {
      // Get into OPEN state
      for (let i = 0; i < 3; i++) {
        breaker.recordFailure(new Error('Test error'));
      }
      expect(breaker.getState()).toBe(CircuitState.OPEN);

      breaker.reset();

      expect(breaker.getState()).toBe(CircuitState.CLOSED);
      expect(breaker.failureCount).toBe(0);
      expect(breaker.successCount).toBe(0);
    });
  });

  describe('events', () => {
    test('emits stateChange on transition', () => {
      const handler = jest.fn();
      breaker.on('stateChange', handler);

      for (let i = 0; i < 3; i++) {
        breaker.recordFailure(new Error('Test error'));
      }

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          serviceName: 'test-service',
          previousState: CircuitState.CLOSED,
          currentState: CircuitState.OPEN
        })
      );
    });

    test('emits open event when circuit opens', () => {
      const handler = jest.fn();
      breaker.on('open', handler);

      for (let i = 0; i < 3; i++) {
        breaker.recordFailure(new Error('Test error'));
      }

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          serviceName: 'test-service',
          failureCount: 3
        })
      );
    });

    test('emits close event when circuit closes', () => {
      const handler = jest.fn();
      breaker.on('close', handler);

      breaker.forceState(CircuitState.HALF_OPEN);
      breaker.recordSuccess();
      breaker.recordSuccess();

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          serviceName: 'test-service'
        })
      );
    });

    test('emits halfOpen event when transitioning to HALF_OPEN', async () => {
      const handler = jest.fn();
      breaker.on('halfOpen', handler);

      for (let i = 0; i < 3; i++) {
        breaker.recordFailure(new Error('Test error'));
      }

      await new Promise((resolve) => setTimeout(resolve, 150));

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          serviceName: 'test-service'
        })
      );
    });
  });

  describe('statistics', () => {
    test('tracks timeout errors', () => {
      breaker.recordFailure(new Error('Request timeout'));
      breaker.recordFailure(new Error('ETIMEDOUT'));

      const stats = breaker.getStats();
      expect(stats.timeoutsCount).toBe(2);
    });

    test('tracks state changes history', () => {
      for (let i = 0; i < 3; i++) {
        breaker.recordFailure(new Error('Test error'));
      }

      const stats = breaker.getStats();
      expect(stats.stateChanges.length).toBeGreaterThan(0);
      expect(stats.stateChanges[0]).toEqual(
        expect.objectContaining({
          from: CircuitState.CLOSED,
          to: CircuitState.OPEN
        })
      );
    });

    test('limits state change history to 100 entries', () => {
      for (let i = 0; i < 150; i++) {
        breaker._transitionTo(CircuitState.OPEN, true);
        breaker._transitionTo(CircuitState.CLOSED, true);
      }

      const stats = breaker.getStats();
      expect(stats.stateChanges.length).toBeLessThanOrEqual(100);
    });

    test('getStats returns comprehensive statistics', () => {
      breaker.recordSuccess();
      breaker.recordFailure(new Error('Test error'));

      const stats = breaker.getStats();

      expect(stats).toEqual(
        expect.objectContaining({
          serviceName: 'test-service',
          state: CircuitState.CLOSED,
          failureCount: 1,
          successCount: 0,
          totalRequests: 2,
          successfulRequests: 1,
          failedRequests: 1,
          config: expect.any(Object)
        })
      );
    });
  });

  describe('cleanup', () => {
    test('clears all timers', () => {
      breaker.forceState(CircuitState.OPEN);
      expect(breaker.recoveryTimer).not.toBeNull();

      breaker.cleanup();

      expect(breaker.recoveryTimer).toBeNull();
      expect(breaker.resetTimer).toBeNull();
    });

    test('removes all listeners', () => {
      const handler = jest.fn();
      breaker.on('stateChange', handler);

      breaker.cleanup();

      expect(breaker.listenerCount('stateChange')).toBe(0);
    });
  });
});
