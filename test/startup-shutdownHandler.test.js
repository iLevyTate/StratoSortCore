/**
 * Tests for Shutdown Handler
 * Tests graceful shutdown logic for services
 */

const EventEmitter = require('events');

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

// Mock os
jest.mock('os', () => ({
  platform: jest.fn().mockReturnValue('linux')
}));

// Mock child_process
jest.mock('child_process', () => ({
  spawn: jest.fn().mockReturnValue({ on: jest.fn() }),
  spawnSync: jest.fn().mockReturnValue({ status: 0 })
}));

describe('Shutdown Handler', () => {
  let shutdownProcess;
  let shutdown;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
    jest.useFakeTimers();

    const module = require('../src/main/services/startup/shutdownHandler');
    shutdownProcess = module.shutdownProcess;
    shutdown = module.shutdown;
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('shutdownProcess', () => {
    test('does nothing for null process', async () => {
      const { logger } = require('../src/shared/logger');

      await shutdownProcess('TestService', null);

      expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining('process is null'));
    });

    test('does nothing for non-object process', async () => {
      const { logger } = require('../src/shared/logger');

      await shutdownProcess('TestService', 'not-an-object');

      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('not an object'), 'string');
    });

    test('does nothing for process without PID', async () => {
      const { logger } = require('../src/shared/logger');

      await shutdownProcess('TestService', { kill: jest.fn() });

      expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining('has no PID'));
    });

    test('does nothing for already killed process', async () => {
      const { logger } = require('../src/shared/logger');

      await shutdownProcess('TestService', {
        pid: 123,
        killed: true,
        kill: jest.fn()
      });

      expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining('already killed'));
    });

    test('does nothing for process with exit code', async () => {
      const { logger } = require('../src/shared/logger');

      await shutdownProcess('TestService', {
        pid: 123,
        exitCode: 0,
        kill: jest.fn()
      });

      expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining('already exited'));
    });

    test('sends SIGTERM to running process', async () => {
      const mockProcess = new EventEmitter();
      mockProcess.pid = 123;
      mockProcess.killed = false;
      mockProcess.exitCode = null;
      mockProcess.kill = jest.fn();

      const promise = shutdownProcess('TestService', mockProcess);

      // Simulate graceful exit
      setImmediate(() => mockProcess.emit('exit'));
      jest.runAllTimers();

      await promise;

      expect(mockProcess.kill).toHaveBeenCalledWith('SIGTERM');
    });

    test('handles ESRCH error when process not found', async () => {
      const mockProcess = new EventEmitter();
      mockProcess.pid = 123;
      mockProcess.killed = false;
      mockProcess.exitCode = null;
      const esrchError = new Error('ESRCH');
      esrchError.code = 'ESRCH';
      mockProcess.kill = jest.fn().mockImplementation(() => {
        throw esrchError;
      });

      await shutdownProcess('TestService', mockProcess);

      expect(mockProcess.kill).toHaveBeenCalled();
    });

    test('force kills after timeout on Unix', async () => {
      const os = require('os');
      os.platform.mockReturnValue('linux');

      const mockProcess = new EventEmitter();
      mockProcess.pid = 123;
      mockProcess.killed = false;
      mockProcess.exitCode = null;
      mockProcess.kill = jest.fn();

      const promise = shutdownProcess('TestService', mockProcess);

      // Advance past the timeout
      jest.advanceTimersByTime(6000);

      await promise;

      // Should have been called with SIGTERM then SIGKILL
      expect(mockProcess.kill).toHaveBeenCalledWith('SIGTERM');
      expect(mockProcess.kill).toHaveBeenCalledWith('SIGKILL');
    });

    test('uses taskkill on Windows', async () => {
      jest.resetModules();

      const os = require('os');
      os.platform.mockReturnValue('win32');

      const module = require('../src/main/services/startup/shutdownHandler');

      const mockProcess = new EventEmitter();
      mockProcess.pid = 123;
      mockProcess.killed = false;
      mockProcess.exitCode = null;
      mockProcess.kill = jest.fn();

      const promise = module.shutdownProcess('TestService', mockProcess);

      // Advance past the timeout
      jest.advanceTimersByTime(6000);

      await promise;

      const { spawnSync } = require('child_process');
      expect(spawnSync).toHaveBeenCalledWith(
        'taskkill',
        ['/pid', '123', '/f', '/t'],
        expect.objectContaining({ windowsHide: true })
      );
    });

    test('handles process without removeAllListeners', async () => {
      const mockProcess = {
        pid: 123,
        killed: false,
        exitCode: null,
        kill: jest.fn(),
        once: jest.fn((event, cb) => {
          if (event === 'exit') setTimeout(cb, 0);
        })
      };

      const promise = shutdownProcess('TestService', mockProcess);
      jest.runAllTimers();

      await promise;

      expect(mockProcess.kill).toHaveBeenCalled();
    });
  });

  describe('shutdown', () => {
    test('stops health monitoring', async () => {
      const healthMonitor = setInterval(() => {}, 1000);
      const clearIntervalSpy = jest.spyOn(global, 'clearInterval');

      await shutdown({
        serviceProcesses: new Map(),
        serviceStatus: {},
        healthMonitor,
        healthCheckState: { inProgress: false }
      });

      expect(clearIntervalSpy).toHaveBeenCalledWith(healthMonitor);

      clearIntervalSpy.mockRestore();
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

    test('shuts down all service processes', async () => {
      const mockProcess1 = new EventEmitter();
      mockProcess1.pid = 1;
      mockProcess1.killed = false;
      mockProcess1.exitCode = null;
      mockProcess1.kill = jest.fn();

      const mockProcess2 = new EventEmitter();
      mockProcess2.pid = 2;
      mockProcess2.killed = false;
      mockProcess2.exitCode = null;
      mockProcess2.kill = jest.fn();

      const serviceProcesses = new Map([
        ['service1', mockProcess1],
        ['service2', mockProcess2]
      ]);

      const promise = shutdown({
        serviceProcesses,
        serviceStatus: {
          service1: { status: 'running', health: 'healthy' },
          service2: { status: 'running', health: 'healthy' }
        },
        healthMonitor: null,
        healthCheckState: { inProgress: false }
      });

      // Simulate graceful exits
      setImmediate(() => {
        mockProcess1.emit('exit');
        mockProcess2.emit('exit');
      });
      jest.runAllTimers();

      await promise;

      expect(mockProcess1.kill).toHaveBeenCalled();
      expect(mockProcess2.kill).toHaveBeenCalled();
    });

    test('clears service processes map', async () => {
      const serviceProcesses = new Map([['service1', null]]);

      await shutdown({
        serviceProcesses,
        serviceStatus: {},
        healthMonitor: null,
        healthCheckState: {}
      });

      expect(serviceProcesses.size).toBe(0);
    });

    test('resets service status', async () => {
      const serviceStatus = {
        chromadb: { status: 'running', health: 'healthy' },
        ollama: { status: 'running', health: 'healthy' }
      };

      await shutdown({
        serviceProcesses: new Map(),
        serviceStatus,
        healthMonitor: null,
        healthCheckState: {}
      });

      expect(serviceStatus.chromadb.status).toBe('stopped');
      expect(serviceStatus.chromadb.health).toBe('unknown');
      expect(serviceStatus.ollama.status).toBe('stopped');
      expect(serviceStatus.ollama.health).toBe('unknown');
    });
  });
});
