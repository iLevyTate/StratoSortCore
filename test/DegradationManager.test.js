jest.mock('../src/shared/logger', () => ({
  createLogger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
  })
}));

const mockGpuMonitor = {
  detectGPU: jest.fn()
};

const mockDownloadManager = {
  getDownloadedModels: jest.fn(),
  checkDiskSpace: jest.fn()
};

jest.mock('../src/main/services/GPUMonitor', () => ({
  GPUMonitor: jest.fn(() => mockGpuMonitor)
}));

jest.mock('../src/main/services/ModelDownloadManager', () => ({
  ModelDownloadManager: jest.fn(() => mockDownloadManager)
}));

const { DegradationManager } = require('../src/main/services/DegradationManager');

describe('DegradationManager', () => {
  beforeEach(() => {
    mockGpuMonitor.detectGPU.mockReset();
    mockDownloadManager.getDownloadedModels.mockReset();
    mockDownloadManager.checkDiskSpace.mockReset();
  });

  test('checkSystemReadiness flags missing models and no GPU', async () => {
    mockGpuMonitor.detectGPU.mockResolvedValue({ type: 'cpu' });
    mockDownloadManager.getDownloadedModels.mockResolvedValue([{ filename: 'text.gguf' }]);
    mockDownloadManager.checkDiskSpace.mockResolvedValue({ sufficient: true });

    const manager = new DegradationManager({
      _selectedModels: { embedding: 'embed.gguf', text: 'text.gguf' }
    });

    const result = await manager.checkSystemReadiness();

    expect(result.ready).toBe(false);
    expect(result.warnings.length).toBe(1);
    expect(result.issues[0].type).toBe('missing_models');
    expect(result.degradationState.gpuAvailable).toBe(false);
    expect(result.degradationState.missingModels).toEqual(['embedding']);
  });

  test('checkSystemReadiness warns on low disk space', async () => {
    mockGpuMonitor.detectGPU.mockResolvedValue({ type: 'gpu' });
    mockDownloadManager.getDownloadedModels.mockResolvedValue([]);
    mockDownloadManager.checkDiskSpace.mockResolvedValue({ sufficient: false });

    const manager = new DegradationManager({ _selectedModels: null });
    const result = await manager.checkSystemReadiness();

    expect(result.warnings[0].type).toBe('low_disk_space');
  });

  test('handleError maps gpu memory errors to cpu retry', async () => {
    const manager = new DegradationManager();
    const result = await manager.handleError(new Error('CUDA out of memory'));
    expect(result.action).toBe('retry_with_cpu');
    expect(result.shouldNotifyUser).toBe(true);
  });

  test('handleError maps model errors to redownload', async () => {
    const manager = new DegradationManager();
    const result = await manager.handleError(new Error('failed to load model'), {
      modelType: 'text'
    });
    expect(result.action).toBe('redownload_model');
    expect(result.modelType).toBe('text');
  });

  test('attemptRecovery blocks when missing models', async () => {
    const manager = new DegradationManager();
    manager._degradationState.missingModels = ['text'];

    const result = await manager.attemptRecovery();
    expect(result.canRecover).toBe(false);
    expect(result.action).toBe('download_models');
  });

  test('attemptRecovery restores gpu when available', async () => {
    mockGpuMonitor.detectGPU.mockResolvedValue({ type: 'gpu' });
    const manager = new DegradationManager();
    manager._degradationState.usingCPUFallback = true;

    const result = await manager.attemptRecovery();
    expect(result.action).toBe('gpu_restored');
    expect(manager._degradationState.usingCPUFallback).toBe(false);
  });
});
