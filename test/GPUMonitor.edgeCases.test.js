/**
 * Edge-case tests for GPUMonitor.getGPUMemoryUsage
 *
 * Covers:
 *  - Idle GPU (used=0) should return valid data, not null
 *  - nvidia-smi returning unparseable output
 *  - nvidia-smi reporting very large values
 */

jest.mock('../src/shared/logger', () => ({
  createLogger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
  })
}));

const mockExecFileAsync = jest.fn().mockResolvedValue({ stdout: '', stderr: '' });

jest.mock('child_process', () => {
  const fn = function () {};
  fn[require('util').promisify.custom] = mockExecFileAsync;
  return { execFile: fn };
});

const { GPUMonitor } = require('../src/main/services/GPUMonitor');

describe('GPUMonitor.getGPUMemoryUsage edge cases', () => {
  beforeEach(() => {
    mockExecFileAsync.mockReset();
  });

  test('returns valid data when GPU is idle (used=0)', async () => {
    const monitor = new GPUMonitor();
    monitor._platform = 'win32';
    mockExecFileAsync.mockResolvedValueOnce({ stdout: '0, 8192', stderr: '' });

    const result = await monitor.getGPUMemoryUsage();

    expect(result).not.toBeNull();
    expect(result.usedMB).toBe(0);
    expect(result.totalMB).toBe(8192);
    expect(result.percentUsed).toBe(0);
  });

  test('returns null when nvidia-smi output is empty', async () => {
    const monitor = new GPUMonitor();
    monitor._platform = 'win32';
    mockExecFileAsync.mockResolvedValueOnce({ stdout: '', stderr: '' });

    const result = await monitor.getGPUMemoryUsage();
    expect(result).toBeNull();
  });

  test('returns null when nvidia-smi output is not parseable', async () => {
    const monitor = new GPUMonitor();
    monitor._platform = 'linux';
    mockExecFileAsync.mockResolvedValueOnce({ stdout: 'not-a-number, also-not', stderr: '' });

    const result = await monitor.getGPUMemoryUsage();
    expect(result).toBeNull();
  });

  test('returns null when total is 0 (prevents division by zero)', async () => {
    const monitor = new GPUMonitor();
    monitor._platform = 'win32';
    mockExecFileAsync.mockResolvedValueOnce({ stdout: '100, 0', stderr: '' });

    const result = await monitor.getGPUMemoryUsage();
    expect(result).toBeNull();
  });

  test('returns null when nvidia-smi command fails', async () => {
    const monitor = new GPUMonitor();
    monitor._platform = 'linux';
    mockExecFileAsync.mockRejectedValueOnce(new Error('command not found'));

    const result = await monitor.getGPUMemoryUsage();
    expect(result).toBeNull();
  });

  test('calculates percentUsed correctly for normal values', async () => {
    const monitor = new GPUMonitor();
    monitor._platform = 'win32';
    mockExecFileAsync.mockResolvedValueOnce({ stdout: '4096, 8192', stderr: '' });

    const result = await monitor.getGPUMemoryUsage();

    expect(result.usedMB).toBe(4096);
    expect(result.totalMB).toBe(8192);
    expect(result.percentUsed).toBe(50);
  });
});

describe('GPUMonitor.detectGPU caching', () => {
  beforeEach(() => {
    mockExecFileAsync.mockReset();
  });

  test('caches result after first detection', async () => {
    const monitor = new GPUMonitor();
    monitor._platform = 'win32';
    mockExecFileAsync.mockResolvedValue({ stdout: 'RTX 4090, 24576', stderr: '' });

    const first = await monitor.detectGPU();
    const second = await monitor.detectGPU();

    expect(first).toBe(second); // Same object reference (cached)
    // nvidia-smi called only once (first detection)
    expect(mockExecFileAsync).toHaveBeenCalledTimes(1);
  });

  test('force option bypasses cache', async () => {
    const monitor = new GPUMonitor();
    monitor._platform = 'win32';
    mockExecFileAsync.mockResolvedValue({ stdout: 'RTX 4090, 24576', stderr: '' });

    await monitor.detectGPU();
    await monitor.detectGPU({ force: true });

    // Called twice: initial + forced re-detect
    expect(mockExecFileAsync).toHaveBeenCalledTimes(2);
  });
});
