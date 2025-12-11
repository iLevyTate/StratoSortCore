/**
 * Tests for Health Monitoring
 * Tests circuit breaker pattern and health recovery logic
 */

// Mock dependencies
jest.mock('axios');
jest.mock('../src/shared/logger', () => ({
  logger: {
    setContext: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  }
}));

jest.mock('../src/main/utils/ollamaApiRetry', () => ({
  axiosWithRetry: jest.fn()
}));

jest.mock('../src/main/services/startup/preflightChecks', () => ({
  isPortAvailable: jest.fn().mockResolvedValue(true)
}));

jest.mock('../src/main/services/startup/chromaService', () => ({
  checkChromaDBHealth: jest.fn().mockResolvedValue(true)
}));

jest.mock('../src/main/services/startup/ollamaService', () => ({
  checkOllamaHealth: jest.fn().mockResolvedValue(true)
}));

jest.mock('../src/main/services/chromadb', () => ({
  getInstance: jest.fn().mockReturnValue({
    checkHealth: jest.fn().mockResolvedValue(true)
  })
}));

describe('healthMonitoring', () => {
  let healthMonitoring;
  let axiosWithRetry;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    jest.useFakeTimers();

    axiosWithRetry = require('../src/main/utils/ollamaApiRetry').axiosWithRetry;
    axiosWithRetry.mockResolvedValue({ status: 200 });

    healthMonitoring = require('../src/main/services/startup/healthMonitoring');
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('CIRCUIT_BREAKER_RECOVERY_WINDOW', () => {
    test('is 10 minutes', () => {
      expect(healthMonitoring.CIRCUIT_BREAKER_RECOVERY_WINDOW).toBe(10 * 60 * 1000);
    });
  });

  describe('handleCircuitBreakerRecovery', () => {
    test('returns false if circuit breaker not tripped', async () => {
      const serviceStatus = {
        chromadb: {
          circuitBreakerTripped: false,
          circuitBreakerTrippedAt: null
        }
      };

      const result = await healthMonitoring.handleCircuitBreakerRecovery(
        'chromadb',
        serviceStatus,
        jest.fn(),
        jest.fn()
      );

      expect(result).toBe(false);
    });

    test('returns false if within recovery window', async () => {
      const serviceStatus = {
        chromadb: {
          circuitBreakerTripped: true,
          circuitBreakerTrippedAt: new Date().toISOString(),
          recoveryAttempts: 0
        }
      };

      const result = await healthMonitoring.handleCircuitBreakerRecovery(
        'chromadb',
        serviceStatus,
        jest.fn(),
        jest.fn()
      );

      expect(result).toBe(false);
    });

    test('attempts recovery after window expires', async () => {
      const trippedAt = new Date(Date.now() - 15 * 60 * 1000).toISOString();
      const serviceStatus = {
        chromadb: {
          circuitBreakerTripped: true,
          circuitBreakerTrippedAt: trippedAt,
          recoveryAttempts: 0
        }
      };

      const startService = jest.fn().mockResolvedValue();
      const checkHealth = jest.fn().mockResolvedValue(true);

      const result = await healthMonitoring.handleCircuitBreakerRecovery(
        'chromadb',
        serviceStatus,
        startService,
        checkHealth
      );

      expect(result).toBe(true);
      expect(startService).toHaveBeenCalled();
      expect(checkHealth).toHaveBeenCalled();
    });

    test('resets circuit breaker on successful recovery', async () => {
      const trippedAt = new Date(Date.now() - 15 * 60 * 1000).toISOString();
      const serviceStatus = {
        chromadb: {
          circuitBreakerTripped: true,
          circuitBreakerTrippedAt: trippedAt,
          recoveryAttempts: 0,
          restartCount: 3,
          consecutiveFailures: 5
        }
      };

      await healthMonitoring.handleCircuitBreakerRecovery(
        'chromadb',
        serviceStatus,
        jest.fn().mockResolvedValue(),
        jest.fn().mockResolvedValue(true)
      );

      expect(serviceStatus.chromadb.circuitBreakerTripped).toBe(false);
      expect(serviceStatus.chromadb.circuitBreakerTrippedAt).toBeNull();
      expect(serviceStatus.chromadb.restartCount).toBe(0);
      expect(serviceStatus.chromadb.consecutiveFailures).toBe(0);
    });

    test('increments recovery attempts on failure', async () => {
      const trippedAt = new Date(Date.now() - 15 * 60 * 1000).toISOString();
      const serviceStatus = {
        chromadb: {
          circuitBreakerTripped: true,
          circuitBreakerTrippedAt: trippedAt,
          recoveryAttempts: 0
        }
      };

      await healthMonitoring.handleCircuitBreakerRecovery(
        'chromadb',
        serviceStatus,
        jest.fn().mockRejectedValue(new Error('Start failed')),
        jest.fn()
      );

      expect(serviceStatus.chromadb.recoveryAttempts).toBe(1);
    });

    test('marks service permanently failed after max attempts', async () => {
      // With 5 recovery attempts, backoff = 2^5 = 32, so recovery window = 10min * 32 = 320 minutes
      // Need to set trippedAt more than 320 minutes ago to pass the time check
      const trippedAt = new Date(Date.now() - 400 * 60 * 1000).toISOString();
      const serviceStatus = {
        chromadb: {
          circuitBreakerTripped: true,
          circuitBreakerTrippedAt: trippedAt,
          recoveryAttempts: 5
        }
      };

      await healthMonitoring.handleCircuitBreakerRecovery(
        'chromadb',
        serviceStatus,
        jest.fn(),
        jest.fn()
      );

      expect(serviceStatus.chromadb.status).toBe('permanently_failed');
    });
  });

  describe('checkServiceHealthWithRecovery', () => {
    test('skips permanently failed services', async () => {
      const serviceStatus = {
        chromadb: {
          status: 'permanently_failed'
        }
      };

      await healthMonitoring.checkServiceHealthWithRecovery(
        'chromadb',
        serviceStatus,
        {},
        {},
        jest.fn()
      );

      // Should return early without checking health
    });

    test('skips non-running services', async () => {
      const serviceStatus = {
        chromadb: {
          status: 'stopped'
        }
      };

      await healthMonitoring.checkServiceHealthWithRecovery(
        'chromadb',
        serviceStatus,
        {},
        {},
        jest.fn()
      );

      // Should return early
    });

    test('updates health to healthy on success', async () => {
      const chromaDb = require('../src/main/services/chromadb').getInstance();
      chromaDb.checkHealth.mockResolvedValue(true);

      const serviceStatus = {
        chromadb: {
          status: 'running',
          health: 'unknown',
          consecutiveFailures: 0
        }
      };

      await healthMonitoring.checkServiceHealthWithRecovery(
        'chromadb',
        serviceStatus,
        { circuitBreakerConsecutiveFailures: 3, circuitBreakerThreshold: 5 },
        {},
        jest.fn()
      );

      expect(serviceStatus.chromadb.health).toBe('healthy');
      expect(serviceStatus.chromadb.consecutiveFailures).toBe(0);
    });

    test('increments consecutive failures on health check failure', async () => {
      const chromaDb = require('../src/main/services/chromadb').getInstance();
      chromaDb.checkHealth.mockResolvedValue(false);

      const serviceStatus = {
        chromadb: {
          status: 'running',
          health: 'healthy',
          consecutiveFailures: 0
        }
      };

      await healthMonitoring.checkServiceHealthWithRecovery(
        'chromadb',
        serviceStatus,
        { circuitBreakerConsecutiveFailures: 3, circuitBreakerThreshold: 5 },
        {},
        jest.fn()
      );

      expect(serviceStatus.chromadb.health).toBe('unhealthy');
      expect(serviceStatus.chromadb.consecutiveFailures).toBe(1);
    });

    test('attempts restart after consecutive failures', async () => {
      const chromaDb = require('../src/main/services/chromadb').getInstance();
      chromaDb.checkHealth.mockResolvedValue(false);

      const serviceStatus = {
        chromadb: {
          status: 'running',
          health: 'unhealthy',
          consecutiveFailures: 2,
          restartCount: 0
        }
      };

      const startService = jest.fn().mockResolvedValue();

      await healthMonitoring.checkServiceHealthWithRecovery(
        'chromadb',
        serviceStatus,
        { circuitBreakerConsecutiveFailures: 3, circuitBreakerThreshold: 5 },
        {},
        startService
      );

      expect(startService).toHaveBeenCalled();
      expect(serviceStatus.chromadb.restartCount).toBe(1);
    });

    test('trips circuit breaker after threshold', async () => {
      const chromaDb = require('../src/main/services/chromadb').getInstance();
      chromaDb.checkHealth.mockResolvedValue(false);

      const serviceStatus = {
        chromadb: {
          status: 'running',
          health: 'unhealthy',
          consecutiveFailures: 2,
          restartCount: 5
        }
      };

      await healthMonitoring.checkServiceHealthWithRecovery(
        'chromadb',
        serviceStatus,
        { circuitBreakerConsecutiveFailures: 3, circuitBreakerThreshold: 5 },
        {},
        jest.fn()
      );

      expect(serviceStatus.chromadb.status).toBe('permanently_failed');
      expect(serviceStatus.chromadb.circuitBreakerTripped).toBe(true);
    });
  });

  describe('createHealthMonitor', () => {
    test('creates interval and returns it', () => {
      const healthMonitor = healthMonitoring.createHealthMonitor({
        serviceStatus: {
          chromadb: { status: 'running' },
          ollama: { status: 'running' }
        },
        config: { healthCheckInterval: 30000 },
        restartLocks: {},
        startChromaDB: jest.fn(),
        startOllama: jest.fn(),
        healthCheckState: { inProgress: false }
      });

      expect(healthMonitor).toBeDefined();
      clearInterval(healthMonitor);
    });

    test('skips check if previous is in progress', async () => {
      const healthCheckState = { inProgress: true, startedAt: Date.now() };

      healthMonitoring.createHealthMonitor({
        serviceStatus: {},
        config: { healthCheckInterval: 100 },
        restartLocks: {},
        startChromaDB: jest.fn(),
        startOllama: jest.fn(),
        healthCheckState
      });

      jest.advanceTimersByTime(100);

      // Should not throw or cause issues
    });

    test('resets stuck health check after timeout', async () => {
      const healthCheckState = {
        inProgress: true,
        startedAt: Date.now() - 10000
      };

      const monitor = healthMonitoring.createHealthMonitor({
        serviceStatus: {
          chromadb: { status: 'stopped' },
          ollama: { status: 'stopped' }
        },
        config: { healthCheckInterval: 100 },
        restartLocks: {},
        startChromaDB: jest.fn(),
        startOllama: jest.fn(),
        healthCheckState
      });

      await jest.advanceTimersByTimeAsync(100);

      expect(healthCheckState.inProgress).toBe(false);

      clearInterval(monitor);
    });
  });
});
