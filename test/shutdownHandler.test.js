/**
 * Shutdown Handler Tests
 *
 * Tests graceful and forced process shutdown, edge cases, and the
 * orchestrating shutdown() function.
 *
 * Coverage target: main/services/startup/shutdownHandler.js (was 56%)
 */

jest.mock('../src/shared/logger', () => {
  const logger = {
    setContext: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  };
  return { logger, createLogger: jest.fn(() => logger) };
});

const { shutdownProcess, shutdown } = require('../src/main/services/startup/shutdownHandler');

describe('shutdownProcess', () => {
  test('handles null process gracefully', async () => {
    await expect(shutdownProcess('test-service', null)).resolves.toBeUndefined();
  });

  test('handles non-object process', async () => {
    await expect(shutdownProcess('test-service', 'string')).resolves.toBeUndefined();
  });

  test('handles process with no PID', async () => {
    await expect(shutdownProcess('test-service', { pid: null })).resolves.toBeUndefined();
  });

  test('handles already killed process', async () => {
    const proc = { pid: 123, killed: true };
    await expect(shutdownProcess('test-service', proc)).resolves.toBeUndefined();
  });

  test('handles process that already exited', async () => {
    const proc = { pid: 123, killed: false, exitCode: 0 };
    await expect(shutdownProcess('test-service', proc)).resolves.toBeUndefined();
  });

  test('handles process without removeAllListeners', async () => {
    const proc = {
      pid: 123,
      killed: false,
      exitCode: null,
      kill: jest.fn(),
      once: jest.fn((event, cb) => {
        if (event === 'exit') cb();
      })
    };
    await expect(shutdownProcess('test-service', proc)).resolves.toBeUndefined();
    expect(proc.kill).toHaveBeenCalledWith('SIGTERM');
  });

  test('gracefully shuts down a live process', async () => {
    const proc = {
      pid: 999,
      killed: false,
      exitCode: null,
      removeAllListeners: jest.fn(),
      kill: jest.fn(),
      once: jest.fn((event, cb) => {
        if (event === 'exit') {
          setTimeout(cb, 10);
        }
      })
    };

    await shutdownProcess('test-service', proc);

    expect(proc.removeAllListeners).toHaveBeenCalled();
    expect(proc.kill).toHaveBeenCalledWith('SIGTERM');
  });

  test('handles ESRCH error from kill (process already gone)', async () => {
    const esrchError = new Error('No such process');
    esrchError.code = 'ESRCH';

    const proc = {
      pid: 999,
      killed: false,
      exitCode: null,
      removeAllListeners: jest.fn(),
      kill: jest.fn(() => {
        throw esrchError;
      }),
      once: jest.fn()
    };

    await expect(shutdownProcess('test-service', proc)).resolves.toBeUndefined();
  });

  test('handles kill error (non-ESRCH)', async () => {
    const killError = new Error('Permission denied');
    killError.code = 'EPERM';

    const proc = {
      pid: 999,
      killed: false,
      exitCode: null,
      removeAllListeners: jest.fn(),
      kill: jest.fn(() => {
        throw killError;
      }),
      once: jest.fn((event, cb) => {
        if (event === 'exit') setTimeout(cb, 10);
      })
    };

    await expect(shutdownProcess('test-service', proc)).resolves.toBeUndefined();
  });

  test('handles process without kill method', async () => {
    const proc = {
      pid: 999,
      killed: false,
      exitCode: null,
      removeAllListeners: jest.fn()
    };

    await expect(shutdownProcess('test-service', proc)).resolves.toBeUndefined();
  });

  test('handles removeAllListeners throwing', async () => {
    const proc = {
      pid: 999,
      killed: false,
      exitCode: null,
      removeAllListeners: jest.fn(() => {
        throw new Error('listener removal failed');
      }),
      kill: jest.fn(),
      once: jest.fn((event, cb) => {
        if (event === 'exit') setTimeout(cb, 10);
      })
    };

    await expect(shutdownProcess('test-service', proc)).resolves.toBeUndefined();
  });

  test('handles process that does not support event listeners', async () => {
    const proc = {
      pid: 999,
      killed: false,
      exitCode: null,
      removeAllListeners: jest.fn(),
      kill: jest.fn()
      // No 'once' method
    };

    await expect(shutdownProcess('test-service', proc)).resolves.toBeUndefined();
  });

  test('handles error event during shutdown', async () => {
    const proc = {
      pid: 999,
      killed: false,
      exitCode: null,
      removeAllListeners: jest.fn(),
      kill: jest.fn(),
      once: jest.fn((event, cb) => {
        if (event === 'error') {
          setTimeout(() => cb(new Error('process error')), 10);
        }
      })
    };

    await expect(shutdownProcess('test-service', proc)).resolves.toBeUndefined();
  });

  test('handles ESRCH error event during shutdown', async () => {
    const esrchError = new Error('No such process');
    esrchError.code = 'ESRCH';

    const proc = {
      pid: 999,
      killed: false,
      exitCode: null,
      removeAllListeners: jest.fn(),
      kill: jest.fn(),
      once: jest.fn((event, cb) => {
        if (event === 'error') {
          setTimeout(() => cb(esrchError), 10);
        }
      })
    };

    await expect(shutdownProcess('test-service', proc)).resolves.toBeUndefined();
  });
});

describe('shutdown', () => {
  test('shuts down all service processes', async () => {
    const serviceProcesses = new Map();
    const serviceStatus = {
      svc1: { status: 'running', health: 'ok' },
      svc2: { status: 'running', health: 'ok' }
    };

    await shutdown({
      serviceProcesses,
      serviceStatus,
      healthMonitor: null,
      healthCheckState: { inProgress: true }
    });

    expect(serviceStatus.svc1.status).toBe('stopped');
    expect(serviceStatus.svc2.status).toBe('stopped');
    expect(serviceStatus.svc1.health).toBe('unknown');
    expect(serviceProcesses.size).toBe(0);
  });

  test('clears health monitor interval', async () => {
    const healthMonitor = setInterval(() => {}, 60000);
    const clearSpy = jest.spyOn(global, 'clearInterval');

    await shutdown({
      serviceProcesses: new Map(),
      serviceStatus: {},
      healthMonitor,
      healthCheckState: null
    });

    expect(clearSpy).toHaveBeenCalledWith(healthMonitor);
    clearSpy.mockRestore();
  });

  test('resets health check state', async () => {
    const healthCheckState = { inProgress: true };

    await shutdown({
      serviceProcesses: new Map(),
      serviceStatus: {},
      healthMonitor: null,
      healthCheckState
    });

    expect(healthCheckState.inProgress).toBe(false);
  });

  test('handles shutdown with active processes', async () => {
    const serviceProcesses = new Map();
    serviceProcesses.set('service-a', {
      pid: 111,
      killed: false,
      exitCode: null,
      removeAllListeners: jest.fn(),
      kill: jest.fn(),
      once: jest.fn((event, cb) => {
        if (event === 'exit') setTimeout(cb, 5);
      })
    });

    const serviceStatus = {
      'service-a': { status: 'running', health: 'ok' }
    };

    await shutdown({
      serviceProcesses,
      serviceStatus,
      healthMonitor: null,
      healthCheckState: null
    });

    expect(serviceProcesses.size).toBe(0);
    expect(serviceStatus['service-a'].status).toBe('stopped');
  });

  test('tolerates null healthCheckState', async () => {
    await expect(
      shutdown({
        serviceProcesses: new Map(),
        serviceStatus: {},
        healthMonitor: null,
        healthCheckState: null
      })
    ).resolves.toBeUndefined();
  });
});
