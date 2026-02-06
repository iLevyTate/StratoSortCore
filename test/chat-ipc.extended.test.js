/**
 * Extended Chat IPC tests for branch coverage.
 * Targets: null container, null llamaService, safeResolve failures,
 *          resetSession branches, getChatServiceSafe error path.
 */

jest.mock('../src/shared/logger', () => {
  const logger = {
    setContext: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  };
  return { logger, createLogger: jest.fn(() => logger) };
});

describe('registerChatIpc extended', () => {
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

  test('returns fallback when DI container is unavailable', async () => {
    jest.isolateModules(() => {
      jest.doMock('../src/main/services/ChatService', () => jest.fn());
      const registerChatIpc = require('../src/main/ipc/chat');
      registerChatIpc(
        buildContext({
          getServiceIntegration: jest.fn().mockReturnValue({
            container: null
          })
        })
      );
    });

    const handler = handlers[IPC_CHANNELS.CHAT.QUERY];
    const result = await handler({}, { query: 'test' });

    expect(result.success).toBe(false);
    expect(result.error).toBe('Chat service unavailable');
  });

  test('returns fallback when container.resolve is not a function', async () => {
    jest.isolateModules(() => {
      jest.doMock('../src/main/services/ChatService', () => jest.fn());
      const registerChatIpc = require('../src/main/ipc/chat');
      registerChatIpc(
        buildContext({
          getServiceIntegration: jest.fn().mockReturnValue({
            container: {
              /* no resolve method */
            }
          })
        })
      );
    });

    const handler = handlers[IPC_CHANNELS.CHAT.QUERY];
    const result = await handler({}, { query: 'test' });

    expect(result.success).toBe(false);
  });

  test('returns fallback when llamaService is null', async () => {
    jest.isolateModules(() => {
      jest.doMock('../src/main/services/ChatService', () => jest.fn());
      jest.doMock('../src/main/services/ServiceContainer', () => ({
        container: {
          resolve: jest.fn().mockReturnValue(null),
          has: jest.fn().mockReturnValue(false)
        },
        ServiceIds: {
          SEARCH_SERVICE: 'search',
          ORAMA_VECTOR: 'orama',
          PARALLEL_EMBEDDING: 'embed',
          LLAMA_SERVICE: 'llama',
          SETTINGS: 'settings'
        }
      }));
      const registerChatIpc = require('../src/main/ipc/chat');
      registerChatIpc(
        buildContext({
          getServiceIntegration: jest.fn().mockReturnValue(null)
        })
      );
    });

    const handler = handlers[IPC_CHANNELS.CHAT.QUERY];
    const result = await handler({}, { query: 'test' });

    expect(result.success).toBe(false);
    expect(mockLogger.warn).toHaveBeenCalledWith(
      '[Chat] Llama service not available',
      expect.any(Object)
    );
  });

  test('handles safeResolve throwing for individual service', async () => {
    let resolveCallCount = 0;
    jest.isolateModules(() => {
      jest.doMock('../src/main/services/ChatService', () =>
        jest.fn().mockImplementation(() => ({
          query: jest.fn().mockResolvedValue({ success: true }),
          resetSession: jest.fn()
        }))
      );
      jest.doMock('../src/main/services/ServiceContainer', () => ({
        container: {
          resolve: jest.fn().mockImplementation((id) => {
            resolveCallCount++;
            if (id === 'search') throw new Error('Search not found');
            if (id === 'llama') return { generate: jest.fn() };
            return {};
          }),
          has: jest.fn().mockReturnValue(true)
        },
        ServiceIds: {
          SEARCH_SERVICE: 'search',
          ORAMA_VECTOR: 'orama',
          PARALLEL_EMBEDDING: 'embed',
          LLAMA_SERVICE: 'llama',
          SETTINGS: 'settings'
        }
      }));
      const registerChatIpc = require('../src/main/ipc/chat');
      registerChatIpc(
        buildContext({
          getServiceIntegration: jest.fn().mockReturnValue(null)
        })
      );
    });

    const handler = handlers[IPC_CHANNELS.CHAT.QUERY];
    const result = await handler({}, { query: 'test' });

    // Even with searchService resolution failure, chat should still work
    // because safeResolve returns null instead of throwing
    expect(result.success).toBe(true);
    expect(mockLogger.warn).toHaveBeenCalledWith(
      '[Chat] Failed to resolve service',
      expect.objectContaining({ serviceId: 'search' })
    );
  });

  test('reset session returns success', async () => {
    const mockResetSession = jest.fn().mockResolvedValue(undefined);

    jest.isolateModules(() => {
      jest.doMock('../src/main/services/ChatService', () =>
        jest.fn().mockImplementation(() => ({
          query: jest.fn(),
          resetSession: mockResetSession
        }))
      );
      const registerChatIpc = require('../src/main/ipc/chat');
      registerChatIpc(
        buildContext({
          getServiceIntegration: jest.fn().mockReturnValue({
            container: {
              resolve: jest.fn().mockReturnValue({ generate: jest.fn() }),
              has: jest.fn().mockReturnValue(true)
            }
          })
        })
      );
    });

    const handler = handlers[IPC_CHANNELS.CHAT.RESET_SESSION];
    const result = await handler({}, { sessionId: 'session-123' });

    expect(result.success).toBe(true);
    expect(mockResetSession).toHaveBeenCalledWith('session-123');
  });

  test('reset session handles missing sessionId', async () => {
    const mockResetSession = jest.fn().mockResolvedValue(undefined);

    jest.isolateModules(() => {
      jest.doMock('../src/main/services/ChatService', () =>
        jest.fn().mockImplementation(() => ({
          query: jest.fn(),
          resetSession: mockResetSession
        }))
      );
      const registerChatIpc = require('../src/main/ipc/chat');
      registerChatIpc(
        buildContext({
          getServiceIntegration: jest.fn().mockReturnValue({
            container: {
              resolve: jest.fn().mockReturnValue({ generate: jest.fn() }),
              has: jest.fn().mockReturnValue(true)
            }
          })
        })
      );
    });

    const handler = handlers[IPC_CHANNELS.CHAT.RESET_SESSION];
    const result = await handler({}, {});

    expect(result.success).toBe(true);
    expect(mockResetSession).toHaveBeenCalledWith(undefined);
  });

  test('getChatServiceSafe handles exception from getChatService', async () => {
    jest.isolateModules(() => {
      jest.doMock('../src/main/services/ChatService', () => jest.fn());
      const registerChatIpc = require('../src/main/ipc/chat');
      registerChatIpc(
        buildContext({
          getServiceIntegration: jest.fn().mockImplementation(() => {
            throw new Error('Unexpected error');
          })
        })
      );
    });

    const handler = handlers[IPC_CHANNELS.CHAT.QUERY];
    const result = await handler({}, { query: 'test' });

    expect(result.success).toBe(false);
    expect(mockLogger.error).toHaveBeenCalledWith(
      '[Chat] Failed to access ChatService',
      expect.any(Object)
    );
  });

  test('caches ChatService on subsequent calls', async () => {
    const mockQueryFn = jest.fn().mockResolvedValue({ success: true, answer: 'hi' });
    let constructorCalls = 0;

    jest.isolateModules(() => {
      jest.doMock('../src/main/services/ChatService', () =>
        jest.fn().mockImplementation(() => {
          constructorCalls++;
          return { query: mockQueryFn, resetSession: jest.fn() };
        })
      );
      const registerChatIpc = require('../src/main/ipc/chat');
      registerChatIpc(
        buildContext({
          getServiceIntegration: jest.fn().mockReturnValue({
            container: {
              resolve: jest.fn().mockReturnValue({ generate: jest.fn() }),
              has: jest.fn().mockReturnValue(true)
            }
          })
        })
      );
    });

    const handler = handlers[IPC_CHANNELS.CHAT.QUERY];
    await handler({}, { query: 'first' });
    await handler({}, { query: 'second' });

    // Should only construct once due to caching
    expect(constructorCalls).toBe(1);
  });
});
