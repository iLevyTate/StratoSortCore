jest.mock('../src/main/ipc/ipcWrappers', () => {
  const handlers = new Map();
  return {
    createHandler: jest.fn(({ handler }) => handler),
    safeHandle: jest.fn((_ipcMain, channel, handler) => {
      handlers.set(channel, handler);
    }),
    withErrorLogging: jest.fn((_logger, fn) => fn),
    safeSend: jest.fn(),
    z: null,
    __handlers: handlers
  };
});

jest.mock('../src/main/services/LlamaService', () => {
  const defaultInstance = {
    initialize: jest.fn().mockResolvedValue(),
    listModels: jest.fn().mockResolvedValue([{ name: 'm1', type: 'text' }]),
    getConfig: jest.fn().mockResolvedValue({
      textModel: 't.gguf',
      visionModel: 'v.gguf',
      embeddingModel: 'e.gguf'
    }),
    updateConfig: jest.fn().mockResolvedValue(),
    getHealthStatus: jest
      .fn()
      .mockResolvedValue({ healthy: true, initialized: true, gpuBackend: 'cpu' }),
    _gpuBackend: 'cpu'
  };
  const mod = {
    getInstance: jest.fn(() => defaultInstance),
    registerWithContainer: jest.fn((cont, id) => {
      if (typeof cont.has === 'function' && !cont.has(id)) {
        cont.registerSingleton(id, () => mod.getInstance());
      }
    })
  };
  return mod;
});

jest.mock('../src/main/services/ModelDownloadManager', () => ({
  getInstance: jest.fn(() => ({
    getDownloadedModels: jest.fn().mockResolvedValue([])
  }))
}));

const { registerLlamaIpc } = require('../src/main/ipc/llama');
const wrappers = require('../src/main/ipc/ipcWrappers');
const { container } = require('../src/main/services/ServiceContainer');

describe('llama ipc', () => {
  beforeEach(() => {
    container.reset();
  });

  const baseServices = {
    ipcMain: {},
    IPC_CHANNELS: { LLAMA: {} },
    logger: { error: jest.fn() },
    systemAnalytics: {},
    getMainWindow: jest.fn()
  };

  test('registers get-config and returns config', async () => {
    registerLlamaIpc({
      ...baseServices,
      IPC_CHANNELS: { LLAMA: { GET_CONFIG: 'llama:get-config' } }
    });

    const handler = wrappers.__handlers.get('llama:get-config');
    const result = await handler();
    expect(result.success).toBe(true);
    expect(result.config.textModel).toBe('t.gguf');
  });

  test('registers get-models and returns categorized list', async () => {
    registerLlamaIpc({
      ...baseServices,
      IPC_CHANNELS: { LLAMA: { GET_MODELS: 'llama:get-models' } }
    });

    const handler = wrappers.__handlers.get('llama:get-models');
    const result = await handler();
    expect(result.models).toEqual(['m1']);
    expect(result.categories.text).toEqual(['m1']);
    expect(result.inProcess).toBe(true);
  });
});
