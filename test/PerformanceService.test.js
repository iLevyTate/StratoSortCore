jest.mock('os', () => ({
  totalmem: jest.fn(() => 16 * 1024 * 1024 * 1024),
  hostname: jest.fn(() => 'test-host'),
  cpus: jest.fn(() => new Array(8).fill({}))
}));

jest.mock('../src/shared/logger', () => ({
  createLogger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
  })
}));

jest.mock('../src/shared/platformUtils', () => ({
  getNvidiaSmiCommand: jest.fn(() => 'nvidia-smi'),
  isMacOS: false
}));

const os = require('os');
const { EventEmitter } = require('events');

jest.mock('child_process', () => ({
  spawn: jest.fn()
}));

const createProc = (stdout, code = 0) => {
  const proc = new EventEmitter();
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.kill = jest.fn();
  proc.killed = false;
  process.nextTick(() => {
    if (stdout) proc.stdout.emit('data', Buffer.from(stdout));
    proc.emit('close', code);
  });
  return proc;
};

describe('PerformanceService', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  test('getRecommendedConcurrency returns 1 for CPU-only', async () => {
    const { spawn } = require('child_process');
    spawn.mockImplementation(() => createProc('', 1));
    const { getRecommendedConcurrency } = require('../src/main/services/PerformanceService');

    const result = await getRecommendedConcurrency();

    expect(result.maxConcurrent).toBe(1);
    expect(result.reason).toMatch(/CPU-only/);
  });

  test('getRecommendedConcurrency caps by CPU threads', async () => {
    const { spawn } = require('child_process');
    spawn.mockImplementation((command) => {
      if (command === 'nvidia-smi') {
        return createProc('RTX 4090, 24000', 0);
      }
      return createProc('', 1);
    });
    const { getRecommendedConcurrency } = require('../src/main/services/PerformanceService');

    const result = await getRecommendedConcurrency();

    expect(result.maxConcurrent).toBe(2);
    expect(result.reason).toMatch(/capped by CPU threads/);
  });

  test('getRecommendedConcurrency caps by system RAM', async () => {
    const osMock = require('os');
    osMock.totalmem.mockReturnValueOnce(8 * 1024 * 1024 * 1024);
    const { spawn } = require('child_process');
    spawn.mockImplementation((command) => {
      if (command === 'nvidia-smi') {
        return createProc('RTX 3080, 16000', 0);
      }
      return createProc('', 1);
    });
    const { getRecommendedConcurrency } = require('../src/main/services/PerformanceService');

    const result = await getRecommendedConcurrency();

    expect(result.maxConcurrent).toBe(1);
    expect(result.reason).toMatch(/system RAM/);
  });
});
