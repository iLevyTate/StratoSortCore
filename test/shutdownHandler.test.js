jest.mock('os', () => ({
  platform: jest.fn(() => 'win32')
}));

jest.mock('child_process', () => ({
  spawnSync: jest.fn()
}));

jest.mock('../src/shared/logger', () => ({
  createLogger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
  })
}));

const { spawnSync } = require('child_process');
const { shutdownProcess, shutdown } = require('../src/main/services/startup/shutdownHandler');

describe('shutdownHandler', () => {
  test('shutdownProcess returns early for null process', async () => {
    await shutdownProcess('Test', null);
    expect(spawnSync).not.toHaveBeenCalled();
  });

  test('shutdownProcess force-kills on timeout', async () => {
    jest.useFakeTimers();
    const proc = {
      pid: 123,
      killed: false,
      exitCode: null,
      kill: jest.fn(),
      once: jest.fn(),
      removeAllListeners: jest.fn()
    };

    const promise = shutdownProcess('Test', proc);
    jest.advanceTimersByTime(5000);
    await promise;

    expect(proc.kill).toHaveBeenCalledWith('SIGTERM');
    expect(spawnSync).toHaveBeenCalled();
    jest.useRealTimers();
  });

  test('shutdown clears map and resets statuses', async () => {
    const serviceProcesses = new Map([
      ['svc', { pid: 1, killed: true, exitCode: 0, removeAllListeners: jest.fn() }]
    ]);
    const serviceStatus = {
      svc: { status: 'running', health: 'healthy' }
    };
    const healthCheckState = { inProgress: true };

    await shutdown({ serviceProcesses, serviceStatus, healthMonitor: null, healthCheckState });

    expect(serviceProcesses.size).toBe(0);
    expect(serviceStatus.svc.status).toBe('stopped');
    expect(serviceStatus.svc.health).toBe('unknown');
    expect(healthCheckState.inProgress).toBe(false);
  });
});
