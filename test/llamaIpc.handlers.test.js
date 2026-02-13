/**
 * Extended tests for llama IPC handlers.
 * Covers UPDATE_CONFIG, TEST_CONNECTION, DOWNLOAD_MODEL,
 * DELETE_MODEL, and GET_DOWNLOAD_STATUS handlers.
 */

const mockHandlers = new Map();

jest.mock('../src/main/ipc/ipcWrappers', () => ({
  createHandler: jest.fn(({ handler }) => handler),
  safeHandle: jest.fn((_ipcMain, channel, handler) => {
    mockHandlers.set(channel, handler);
  }),
  withErrorLogging: jest.fn((_logger, fn) => fn),
  safeSend: jest.fn(),
  z: null
}));

const mockLlamaService = {
  initialize: jest.fn().mockResolvedValue(),
  listModels: jest.fn().mockResolvedValue([]),
  getConfig: jest
    .fn()
    .mockResolvedValue({ textModel: 't.gguf', visionModel: 'v.gguf', embeddingModel: 'e.gguf' }),
  updateConfig: jest.fn().mockResolvedValue(),
  getHealthStatus: jest
    .fn()
    .mockReturnValue({ healthy: true, initialized: true, gpuBackend: 'cpu' }),
  _gpuBackend: 'cpu'
};

jest.mock('../src/main/services/LlamaService', () => ({
  getInstance: jest.fn(() => mockLlamaService),
  registerWithContainer: jest.fn((cont, id) => {
    if (typeof cont.has === 'function' && !cont.has(id)) {
      cont.registerSingleton(id, () => mockLlamaService);
    }
  })
}));

const mockDownloadManager = {
  downloadModel: jest.fn().mockResolvedValue({ success: true }),
  deleteModel: jest.fn().mockResolvedValue({ success: true }),
  getStatus: jest.fn().mockReturnValue({ active: 0 }),
  getDownloadedModels: jest.fn().mockResolvedValue([]),
  isDownloading: jest.fn().mockReturnValue(false)
};

jest.mock('../src/main/services/ModelDownloadManager', () => ({
  getInstance: jest.fn(() => mockDownloadManager)
}));

const { registerLlamaIpc } = require('../src/main/ipc/llama');
const { container } = require('../src/main/services/ServiceContainer');

describe('llama IPC – extended handlers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockHandlers.clear();
    container.reset();

    registerLlamaIpc({
      ipcMain: {},
      IPC_CHANNELS: { LLAMA: {} },
      logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
      systemAnalytics: {},
      getMainWindow: () => null
    });
  });

  function getHandler(name) {
    for (const [channel, handler] of mockHandlers.entries()) {
      if (channel.includes(name)) return handler;
    }
    throw new Error(`No handler found matching "${name}"`);
  }

  describe('UPDATE_CONFIG', () => {
    test('updates config successfully', async () => {
      const handler = getHandler('update-config');
      const result = await handler({}, { textModel: 'new-model.gguf' });

      expect(result.success).toBe(true);
      expect(mockLlamaService.updateConfig).toHaveBeenCalledWith({ textModel: 'new-model.gguf' });
    });

    test('returns error on failure', async () => {
      const handler = getHandler('update-config');
      mockLlamaService.updateConfig.mockRejectedValueOnce(new Error('config invalid'));

      const result = await handler({}, { gpuLayers: 999 });

      expect(result.success).toBe(false);
      expect(result.error).toBe('config invalid');
    });

    test('maps legacy llama* config keys to canonical service keys', async () => {
      const handler = getHandler('update-config');
      await handler({}, { llamaGpuLayers: 42, llamaContextSize: 16384 });

      expect(mockLlamaService.updateConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          llamaGpuLayers: 42,
          llamaContextSize: 16384,
          gpuLayers: 42,
          contextSize: 16384
        })
      );
    });
  });

  describe('TEST_CONNECTION', () => {
    test('returns healthy status', async () => {
      const handler = getHandler('test-connection');
      const result = await handler();

      expect(result.success).toBe(true);
      expect(result.status).toBe('healthy');
      expect(result.inProcess).toBe(true);
    });

    test('returns unhealthy on init failure', async () => {
      const handler = getHandler('test-connection');
      mockLlamaService.initialize.mockRejectedValueOnce(new Error('GPU init failed'));

      const result = await handler();

      expect(result.success).toBe(false);
      expect(result.status).toBe('unhealthy');
      expect(result.error).toBe('GPU init failed');
    });
  });

  describe('DOWNLOAD_MODEL', () => {
    test('rejects empty model name', async () => {
      const handler = getHandler('download-model');
      const result = await handler({}, '');

      expect(result.success).toBe(false);
      expect(result.error).toContain('required');
    });

    test('rejects path traversal in model name', async () => {
      const handler = getHandler('download-model');

      const dotResult = await handler({}, '../../../etc/passwd');
      expect(dotResult.success).toBe(false);
      expect(dotResult.error).toContain('Invalid');

      const slashResult = await handler({}, 'models/evil.gguf');
      expect(slashResult.success).toBe(false);
      expect(slashResult.error).toContain('Invalid');

      const backslashResult = await handler({}, 'models\\evil.gguf');
      expect(backslashResult.success).toBe(false);
      expect(backslashResult.error).toContain('Invalid');
    });

    test('downloads model successfully', async () => {
      const handler = getHandler('download-model');
      const result = await handler({}, 'llama-3.gguf');

      expect(result.success).toBe(true);
      expect(mockDownloadManager.downloadModel).toHaveBeenCalledWith(
        'llama-3.gguf',
        expect.objectContaining({ onProgress: expect.any(Function) })
      );
    });

    test('returns error on download failure', async () => {
      const handler = getHandler('download-model');
      mockDownloadManager.downloadModel.mockRejectedValueOnce(new Error('network error'));

      const result = await handler({}, 'model.gguf');

      expect(result.success).toBe(false);
      expect(result.error).toBe('network error');
    });
  });

  describe('DELETE_MODEL', () => {
    test('rejects empty model name', async () => {
      const handler = getHandler('delete-model');
      const result = await handler({}, '  ');

      expect(result.success).toBe(false);
      expect(result.error).toContain('required');
    });

    test('rejects path traversal', async () => {
      const handler = getHandler('delete-model');
      const result = await handler({}, '../../secrets.txt');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid');
    });

    test('deletes model successfully', async () => {
      const handler = getHandler('delete-model');
      const result = await handler({}, 'old-model.gguf');

      expect(result.success).toBe(true);
      expect(mockDownloadManager.deleteModel).toHaveBeenCalledWith('old-model.gguf');
    });
  });

  describe('GET_DOWNLOAD_STATUS', () => {
    test('returns download status', async () => {
      const handler = getHandler('download-status');
      const result = await handler();

      expect(result.success).toBe(true);
      expect(result.status).toBeDefined();
    });

    test('returns error on failure', async () => {
      const handler = getHandler('download-status');
      mockDownloadManager.getStatus.mockImplementationOnce(() => {
        throw new Error('manager disposed');
      });

      const result = await handler();

      expect(result.success).toBe(false);
      expect(result.error).toBe('manager disposed');
    });
  });
});
