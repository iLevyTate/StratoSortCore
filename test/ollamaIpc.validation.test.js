/**
 * @jest-environment node
 */

jest.mock('../src/main/ipc/withErrorLogging', () => ({
  withErrorLogging: (_logger, fn) => fn,
  withValidation: (_logger, _schema, fn) => fn,
}));

// Mock Ollama client
jest.mock('ollama', () => ({
  Ollama: jest.fn().mockImplementation(({ host }) => ({
    host,
    list: jest.fn().mockResolvedValue({ models: [] }),
  })),
}));

describe('ollama IPC validation fallback', () => {
  afterEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  test('rejects invalid URL when zod is unavailable', async () => {
    // Force zod import to fail
    jest.doMock('zod', () => {
      throw new Error('Module not found');
    });

    const registerOllamaIpc = require('../src/main/ipc/ollama');
    const ipcHandlers = {};
    const ipcMain = {
      handle: (channel, handler) => {
        ipcHandlers[channel] = handler;
      },
    };

    const IPC_CHANNELS = {
      OLLAMA: {
        TEST_CONNECTION: 'ollama-test-connection',
      },
    };

    const logger = { error: jest.fn(), warn: jest.fn(), info: jest.fn() };
    const systemAnalytics = {};

    registerOllamaIpc({
      ipcMain,
      IPC_CHANNELS,
      logger,
      systemAnalytics,
      getOllama: () => ({}),
      getOllamaModel: () => 'm',
      getOllamaVisionModel: () => 'v',
      getOllamaEmbeddingModel: () => 'e',
      getOllamaHost: () => 'http://localhost:11434',
    });

    const handler = ipcHandlers[IPC_CHANNELS.OLLAMA.TEST_CONNECTION];
    const result = await handler({}, 'not-a-url with spaces');

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Invalid Ollama URL/i);
  });
});
