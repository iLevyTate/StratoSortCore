jest.mock('../src/shared/logger', () => ({
  createLogger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
  })
}));

// GPUMonitor now uses promisify(execFile) instead of execSync.
// We provide a [promisify.custom] function so promisify() returns our mock.
const mockExecFileAsync = jest.fn().mockResolvedValue({ stdout: '', stderr: '' });

jest.mock('child_process', () => {
  const fn = function () {};
  fn[require('util').promisify.custom] = mockExecFileAsync;
  return { execFile: fn };
});

const { GPUMonitor } = require('../src/main/services/GPUMonitor');

describe('GPUMonitor', () => {
  beforeEach(() => {
    mockExecFileAsync.mockReset();
    mockExecFileAsync.mockResolvedValue({ stdout: '', stderr: '' });
  });

  test('detectGPU uses platform-specific detection', async () => {
    const monitor = new GPUMonitor();
    monitor._platform = 'win32';
    mockExecFileAsync.mockResolvedValueOnce({ stdout: 'RTX 4090, 24576', stderr: '' });

    const result = await monitor.detectGPU();
    expect(result.type).toBe('cuda');
    expect(result.vramMB).toBe(24576);
  });

  test('windows detection falls back to wmic', async () => {
    const monitor = new GPUMonitor();
    monitor._platform = 'win32';
    mockExecFileAsync
      .mockRejectedValueOnce(new Error('no nvidia'))
      // PowerShell fails
      .mockResolvedValueOnce({ stdout: '', stderr: 'powershell error' })
      // WMIC succeeds with CSV format
      .mockResolvedValueOnce({
        stdout: 'Node,AdapterRAM,Name\nMYPC,2147483648,Intel UHD',
        stderr: ''
      });

    const result = await monitor.detectGPU();
    expect(result.type).toBe('vulkan');
    expect(result.vramMB).toBeGreaterThan(0);
  });

  test('linux detection uses lspci when nvidia-smi missing', async () => {
    const monitor = new GPUMonitor();
    monitor._platform = 'linux';
    mockExecFileAsync.mockRejectedValueOnce(new Error('no nvidia')).mockResolvedValueOnce({
      stdout: '00:02.0 VGA compatible controller: Intel HD',
      stderr: ''
    });

    const result = await monitor.detectGPU();
    expect(result.type).toBe('vulkan');
    expect(result.name).toContain('Intel');
  });

  test('getGPUMemoryUsage returns null on mac', async () => {
    const monitor = new GPUMonitor();
    monitor._platform = 'darwin';
    const result = await monitor.getGPUMemoryUsage();
    expect(result).toBeNull();
  });

  test('getGPUMemoryUsage parses nvidia-smi output', async () => {
    const monitor = new GPUMonitor();
    monitor._platform = 'win32';
    mockExecFileAsync.mockResolvedValueOnce({ stdout: '200, 1000', stderr: '' });

    const result = await monitor.getGPUMemoryUsage();
    expect(result.usedMB).toBe(200);
    expect(result.totalMB).toBe(1000);
    expect(result.percentUsed).toBe(20);
  });
});
