jest.mock('../src/main/ipc/ipcWrappers', () => {
  const handlers = new Map();
  return {
    safeHandle: jest.fn((_ipcMain, channel, handler) => handlers.set(channel, handler)),
    withErrorLogging: jest.fn((_logger, fn) => fn),
    __handlers: handlers
  };
});

jest.mock('../src/main/services/OramaVectorService', () => ({
  getInstance: jest.fn(() => ({
    getStats: jest.fn().mockResolvedValue({ collections: 1, documents: 2 })
  }))
}));

const { registerVectorDbIpc } = require('../src/main/ipc/vectordb');
const wrappers = require('../src/main/ipc/ipcWrappers');

describe('vectordb ipc', () => {
  const baseServices = {
    ipcMain: {},
    IPC_CHANNELS: { VECTOR_DB: {} },
    logger: { error: jest.fn(), warn: jest.fn() },
    systemAnalytics: {}
  };

  test('get-status returns stats and health', async () => {
    registerVectorDbIpc({
      ...baseServices,
      IPC_CHANNELS: { VECTOR_DB: { GET_STATUS: 'vectordb:get-status' } }
    });

    const handler = wrappers.__handlers.get('vectordb:get-status');
    const result = await handler();
    expect(result.success).toBe(true);
    expect(result.stats.documents).toBe(2);
    expect(result.inProcess).toBe(true);
  });

  test('get-stats returns stats', async () => {
    registerVectorDbIpc({
      ...baseServices,
      IPC_CHANNELS: { VECTOR_DB: { GET_STATS: 'vectordb:get-stats' } }
    });

    const handler = wrappers.__handlers.get('vectordb:get-stats');
    const result = await handler();
    expect(result.success).toBe(true);
    expect(result.stats.collections).toBe(1);
  });
});
