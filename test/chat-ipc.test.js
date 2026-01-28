/**
 * Tests for Chat IPC handlers
 * Ensures chat handlers return safe fallback responses.
 */

jest.mock('../src/shared/logger', () => ({
  logger: {
    setContext: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  }
}));

describe('registerChatIpc', () => {
  let ipcMain;
  let handlers;
  let mockLogger;

  const IPC_CHANNELS = {
    CHAT: {
      QUERY: 'chat:query',
      RESET_SESSION: 'chat:resetSession'
    }
  };

  const buildContext = (overrides = {}) => ({
    ipcMain,
    IPC_CHANNELS,
    logger: mockLogger,
    getServiceIntegration: jest.fn().mockReturnValue({
      container: {
        resolve: jest.fn().mockReturnValue({})
      }
    }),
    ...overrides
  });

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
    handlers = {};
    mockLogger = {
      setContext: jest.fn(),
      info: jest.fn(),
      debug: jest.fn(),
      warn: jest.fn(),
      error: jest.fn()
    };
    ipcMain = {
      handle: jest.fn((channel, handler) => {
        handlers[channel] = handler;
      }),
      removeHandler: jest.fn()
    };
  });

  test('returns query response from chat service', async () => {
    const mockQuery = jest.fn().mockResolvedValue({
      success: true,
      response: { modelAnswer: [] },
      sources: []
    });
    const mockReset = jest.fn().mockResolvedValue();

    jest.isolateModules(() => {
      jest.doMock('../src/main/services/ChatService', () =>
        jest.fn().mockImplementation(() => ({
          query: mockQuery,
          resetSession: mockReset
        }))
      );
      const registerChatIpc = require('../src/main/ipc/chat');
      registerChatIpc(buildContext());
    });

    const handler = handlers[IPC_CHANNELS.CHAT.QUERY];
    const result = await handler({}, { query: 'hello' });

    expect(result.success).toBe(true);
    expect(mockQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        query: 'hello',
        topK: 6,
        mode: 'hybrid',
        responseMode: 'fast'
      })
    );
  });

  test('returns fallback when ChatService fails to initialize', async () => {
    jest.isolateModules(() => {
      jest.doMock('../src/main/services/ChatService', () =>
        jest.fn().mockImplementation(() => {
          throw new Error('init failed');
        })
      );
      const registerChatIpc = require('../src/main/ipc/chat');
      registerChatIpc(buildContext());
    });

    const handler = handlers[IPC_CHANNELS.CHAT.QUERY];
    const result = await handler({}, { query: 'hello' });

    expect(result.success).toBe(false);
    expect(result.error).toBe('Chat service unavailable');
  });
});
