/**
 * Tests for DegradationManager singleton (getInstance) behavior.
 *
 * Covers:
 *  - getInstance() without llamaService still works (graceful degradation)
 *  - getInstance(llamaService) late-binds the service
 *  - Singleton returns same instance on subsequent calls
 *  - checkSystemReadiness skips model checks when llamaService is absent
 */

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
  getInstance: jest.fn(() => mockGpuMonitor),
  GPUMonitor: jest.fn(() => mockGpuMonitor)
}));

jest.mock('../src/main/services/ModelDownloadManager', () => ({
  getInstance: jest.fn(() => mockDownloadManager),
  ModelDownloadManager: jest.fn(() => mockDownloadManager)
}));

describe('DegradationManager singleton', () => {
  let DegradationManager;
  let getInstance;

  beforeEach(() => {
    jest.resetModules();
    jest.mock('../src/shared/logger', () => ({
      createLogger: () => ({
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn()
      })
    }));
    jest.mock('../src/main/services/GPUMonitor', () => ({
      getInstance: jest.fn(() => mockGpuMonitor),
      GPUMonitor: jest.fn(() => mockGpuMonitor)
    }));
    jest.mock('../src/main/services/ModelDownloadManager', () => ({
      getInstance: jest.fn(() => mockDownloadManager),
      ModelDownloadManager: jest.fn(() => mockDownloadManager)
    }));

    mockGpuMonitor.detectGPU.mockReset();
    mockDownloadManager.getDownloadedModels.mockReset();
    mockDownloadManager.checkDiskSpace.mockReset();

    const mod = require('../src/main/services/DegradationManager');
    DegradationManager = mod.DegradationManager;
    getInstance = mod.getInstance;
  });

  test('getInstance returns same instance on subsequent calls', () => {
    const a = getInstance();
    const b = getInstance();
    expect(a).toBe(b);
  });

  test('getInstance without llamaService does not throw', () => {
    const instance = getInstance();
    expect(instance).toBeInstanceOf(DegradationManager);
    expect(instance._llamaService).toBeUndefined();
  });

  test('getInstance with llamaService stores the reference', () => {
    const mockLlama = { _selectedModels: { text: 'model.gguf' } };
    const instance = getInstance(mockLlama);
    expect(instance._llamaService).toBe(mockLlama);
  });

  test('getInstance late-binds llamaService on subsequent call', () => {
    // First call without llamaService
    const instance = getInstance();
    expect(instance._llamaService).toBeUndefined();

    // Second call provides the service — should be patched onto existing instance
    const mockLlama = { _selectedModels: { embedding: 'embed.gguf' } };
    const same = getInstance(mockLlama);
    expect(same).toBe(instance); // Same singleton
    expect(same._llamaService).toBe(mockLlama);
  });

  test('checkSystemReadiness works without llamaService (skips model check)', async () => {
    mockGpuMonitor.detectGPU.mockResolvedValue({ type: 'cuda' });
    mockDownloadManager.getDownloadedModels.mockResolvedValue([]);
    mockDownloadManager.checkDiskSpace.mockResolvedValue({ sufficient: true });

    const instance = getInstance(); // No llamaService

    const result = await instance.checkSystemReadiness();

    // Should succeed — no models to check when llamaService is absent
    expect(result.ready).toBe(false);
  });

  test('checkSystemReadiness detects missing models after late-bind', async () => {
    mockGpuMonitor.detectGPU.mockResolvedValue({ type: 'cuda' });
    mockDownloadManager.getDownloadedModels.mockResolvedValue([{ filename: 'text.gguf' }]);
    mockDownloadManager.checkDiskSpace.mockResolvedValue({ sufficient: true });

    // Create singleton, then late-bind llamaService
    const instance = getInstance();
    const mockLlama = { _selectedModels: { embedding: 'embed.gguf', text: 'text.gguf' } };
    getInstance(mockLlama);

    const result = await instance.checkSystemReadiness();

    expect(result.ready).toBe(false);
    expect(result.issues[0].type).toBe('missing_models');
    expect(result.degradationState.missingModels).toEqual(['embedding']);
  });
});
