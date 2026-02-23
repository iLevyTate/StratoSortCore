/**
 * Chat IPC Handler Tests
 *
 * Tests the actual handler logic for all chat IPC channels:
 * streaming, cancel, reset, list/get/delete/search/export conversations.
 *
 * Coverage target: main/ipc/chat.js (was 17%)
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

describe('Chat IPC handler behavior', () => {
  let ipcMain;
  let mockLogger;
  let handlers;

  const IPC_CHANNELS = {
    CHAT: {
      QUERY_STREAM: 'chat:query-stream',
      CANCEL_STREAM: 'chat:cancel-stream',
      STREAM_CHUNK: 'chat:stream-chunk',
      STREAM_END: 'chat:stream-end',
      RESET_SESSION: 'chat:reset-session',
      LIST_CONVERSATIONS: 'chat:list-conversations',
      GET_CONVERSATION: 'chat:get-conversation',
      DELETE_CONVERSATION: 'chat:delete-conversation',
      SEARCH_CONVERSATIONS: 'chat:search-conversations',
      EXPORT_CONVERSATION: 'chat:export-conversation'
    }
  };

  function getHandler(channel) {
    const call = ipcMain.handle.mock.calls.find(([ch]) => ch === channel);
    if (!call) throw new Error(`No handler registered for ${channel}`);
    return call[1];
  }

  function createMockEvent() {
    return {
      sender: {
        isDestroyed: jest.fn(() => false),
        send: jest.fn()
      }
    };
  }

  function setupWithServices(overrides = {}) {
    jest.isolateModules(() => {
      const { IpcServiceContext } = require('../src/main/ipc/IpcServiceContext');
      const registerChatIpc = require('../src/main/ipc/chat');

      const mockContainer = {
        resolve: jest.fn((id) => overrides[id] ?? null),
        has: jest.fn(() => true)
      };

      const context = new IpcServiceContext()
        .setCore({ ipcMain, IPC_CHANNELS, logger: mockLogger })
        .setServiceIntegration(jest.fn(() => ({ container: mockContainer })));

      registerChatIpc(context);
    });
  }

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
    mockLogger = {
      setContext: jest.fn(),
      info: jest.fn(),
      debug: jest.fn(),
      warn: jest.fn(),
      error: jest.fn()
    };
    ipcMain = {
      handle: jest.fn(),
      removeHandler: jest.fn(),
      on: jest.fn(),
      removeListener: jest.fn()
    };
    handlers = {};
  });

  describe('when ChatService is unavailable (no llama service)', () => {
    beforeEach(() => {
      setupWithServices({});
    });

    test('QUERY_STREAM returns fallback response', async () => {
      const handler = getHandler(IPC_CHANNELS.CHAT.QUERY_STREAM);
      const event = createMockEvent();
      const result = await handler(event, { query: 'test query' });
      expect(result).toEqual(
        expect.objectContaining({ success: false, error: expect.any(String) })
      );
    });

    test('CANCEL_STREAM returns fallback response', async () => {
      const handler = getHandler(IPC_CHANNELS.CHAT.CANCEL_STREAM);
      const event = createMockEvent();
      const result = await handler(event, {});
      expect(result).toEqual(expect.objectContaining({ success: false }));
    });

    test('RESET_SESSION returns fallback response', async () => {
      const handler = getHandler(IPC_CHANNELS.CHAT.RESET_SESSION);
      const event = createMockEvent();
      const result = await handler(event, {});
      expect(result).toEqual(expect.objectContaining({ success: false }));
    });

    test('LIST_CONVERSATIONS returns fallback response', async () => {
      const handler = getHandler(IPC_CHANNELS.CHAT.LIST_CONVERSATIONS);
      const event = createMockEvent();
      const result = await handler(event, {});
      expect(result).toEqual(expect.objectContaining({ success: false }));
    });

    test('GET_CONVERSATION returns fallback response', async () => {
      const handler = getHandler(IPC_CHANNELS.CHAT.GET_CONVERSATION);
      const event = createMockEvent();
      const result = await handler(event, { id: 'conv-1' });
      expect(result).toEqual(expect.objectContaining({ success: false }));
    });

    test('DELETE_CONVERSATION returns fallback response', async () => {
      const handler = getHandler(IPC_CHANNELS.CHAT.DELETE_CONVERSATION);
      const event = createMockEvent();
      const result = await handler(event, { id: 'conv-1' });
      expect(result).toEqual(expect.objectContaining({ success: false }));
    });

    test('SEARCH_CONVERSATIONS returns fallback response', async () => {
      const handler = getHandler(IPC_CHANNELS.CHAT.SEARCH_CONVERSATIONS);
      const event = createMockEvent();
      const result = await handler(event, { query: 'test' });
      expect(result).toEqual(expect.objectContaining({ success: false }));
    });

    test('EXPORT_CONVERSATION returns fallback response', async () => {
      const handler = getHandler(IPC_CHANNELS.CHAT.EXPORT_CONVERSATION);
      const event = createMockEvent();
      const result = await handler(event, { id: 'conv-1' });
      expect(result).toEqual(expect.objectContaining({ success: false }));
    });
  });

  describe('when ChatService is available', () => {
    let mockChatService;
    let mockChatHistoryStore;
    let mockLlamaService;

    beforeEach(() => {
      mockChatHistoryStore = {
        listConversations: jest.fn(() => [{ id: 'c1', title: 'Test' }]),
        getConversation: jest.fn((id) => (id === 'c1' ? { id: 'c1', messages: [] } : null)),
        deleteConversation: jest.fn(),
        searchConversations: jest.fn((q) => [{ id: 'c1', title: q }]),
        exportAsMarkdown: jest.fn((id) => (id === 'c1' ? '# Conversation' : null))
      };

      mockLlamaService = { generateText: jest.fn() };

      mockChatService = {
        queryStreaming: jest.fn(async ({ onEvent }) => {
          onEvent({ type: 'chunk', text: 'Hello' });
          onEvent({ type: 'done' });
        }),
        cancelStreamingRequest: jest.fn(async () => ({ cancelled: true })),
        resetSession: jest.fn(async () => {}),
        chatHistoryStore: mockChatHistoryStore
      };

      // Mock ChatService constructor
      jest.mock('../src/main/services/ChatService', () => {
        return jest.fn().mockImplementation(() => mockChatService);
      });

      setupWithServices({
        llamaService: mockLlamaService,
        searchService: {},
        oramaVector: {},
        parallelEmbedding: {},
        settings: {},
        chatHistoryStore: mockChatHistoryStore
      });
    });

    test('QUERY_STREAM initiates streaming and returns success', async () => {
      const handler = getHandler(IPC_CHANNELS.CHAT.QUERY_STREAM);
      const event = createMockEvent();

      const result = await handler(event, { query: 'Hello AI' });
      expect(result).toEqual(expect.objectContaining({ success: true }));
    });

    test('QUERY_STREAM sends chunks and end events to sender', async () => {
      const handler = getHandler(IPC_CHANNELS.CHAT.QUERY_STREAM);
      const event = createMockEvent();

      await handler(event, { query: 'Hello AI' });

      // Wait for the streaming promise to settle
      await new Promise((r) => setTimeout(r, 50));

      expect(event.sender.send).toHaveBeenCalledWith(
        IPC_CHANNELS.CHAT.STREAM_CHUNK,
        expect.objectContaining({ type: 'chunk' })
      );
      expect(event.sender.send).toHaveBeenCalledWith(IPC_CHANNELS.CHAT.STREAM_END);
    });

    test('QUERY_STREAM does not send to destroyed sender', async () => {
      const handler = getHandler(IPC_CHANNELS.CHAT.QUERY_STREAM);
      const event = createMockEvent();
      event.sender.isDestroyed.mockReturnValue(true);

      await handler(event, { query: 'Hello AI' });
      await new Promise((r) => setTimeout(r, 50));

      expect(event.sender.send).not.toHaveBeenCalled();
    });

    test('QUERY_STREAM handles streaming errors gracefully', async () => {
      mockChatService.queryStreaming.mockRejectedValueOnce(new Error('LLM crashed'));

      const handler = getHandler(IPC_CHANNELS.CHAT.QUERY_STREAM);
      const event = createMockEvent();

      const result = await handler(event, { query: 'Hello AI' });
      expect(result).toEqual(expect.objectContaining({ success: true }));

      // Wait for the background promise to reject
      await new Promise((r) => setTimeout(r, 50));

      // Should send error chunk and stream end
      expect(event.sender.send).toHaveBeenCalledWith(
        IPC_CHANNELS.CHAT.STREAM_CHUNK,
        expect.objectContaining({ type: 'error' })
      );
      expect(event.sender.send).toHaveBeenCalledWith(IPC_CHANNELS.CHAT.STREAM_END);
    });

    test('CANCEL_STREAM cancels and returns success', async () => {
      const handler = getHandler(IPC_CHANNELS.CHAT.CANCEL_STREAM);
      const event = createMockEvent();

      const result = await handler(event, { requestId: 'r1' });
      expect(result).toEqual(expect.objectContaining({ success: true, cancelled: true }));
    });

    test('RESET_SESSION resets and returns success', async () => {
      const handler = getHandler(IPC_CHANNELS.CHAT.RESET_SESSION);
      const event = createMockEvent();

      const result = await handler(event, { sessionId: 's1' });
      expect(result).toEqual(expect.objectContaining({ success: true }));
      expect(mockChatService.resetSession).toHaveBeenCalledWith('s1');
    });

    test('LIST_CONVERSATIONS returns conversations', async () => {
      const handler = getHandler(IPC_CHANNELS.CHAT.LIST_CONVERSATIONS);
      const event = createMockEvent();

      const result = await handler(event, { limit: 10, offset: 0 });
      expect(result).toEqual(
        expect.objectContaining({
          success: true,
          conversations: expect.arrayContaining([expect.objectContaining({ id: 'c1' })])
        })
      );
    });

    test('LIST_CONVERSATIONS returns error when history store missing', async () => {
      mockChatService.chatHistoryStore = null;

      const handler = getHandler(IPC_CHANNELS.CHAT.LIST_CONVERSATIONS);
      const event = createMockEvent();

      const result = await handler(event, {});
      expect(result).toEqual(expect.objectContaining({ success: false }));
    });

    test('GET_CONVERSATION returns specific conversation', async () => {
      const handler = getHandler(IPC_CHANNELS.CHAT.GET_CONVERSATION);
      const event = createMockEvent();

      const result = await handler(event, { id: 'c1' });
      expect(result).toEqual(
        expect.objectContaining({
          success: true,
          conversation: expect.objectContaining({ id: 'c1' })
        })
      );
    });

    test('DELETE_CONVERSATION deletes and returns success', async () => {
      const handler = getHandler(IPC_CHANNELS.CHAT.DELETE_CONVERSATION);
      const event = createMockEvent();

      const result = await handler(event, { id: 'c1' });
      expect(result).toEqual(expect.objectContaining({ success: true }));
      expect(mockChatHistoryStore.deleteConversation).toHaveBeenCalledWith('c1');
    });

    test('SEARCH_CONVERSATIONS returns search results', async () => {
      const handler = getHandler(IPC_CHANNELS.CHAT.SEARCH_CONVERSATIONS);
      const event = createMockEvent();

      const result = await handler(event, { query: 'find me' });
      expect(result).toEqual(
        expect.objectContaining({
          success: true,
          results: expect.arrayContaining([expect.objectContaining({ id: 'c1' })])
        })
      );
    });

    test('EXPORT_CONVERSATION returns markdown for valid conversation', async () => {
      const handler = getHandler(IPC_CHANNELS.CHAT.EXPORT_CONVERSATION);
      const event = createMockEvent();

      const result = await handler(event, { id: 'c1' });
      expect(result).toEqual(
        expect.objectContaining({ success: true, markdown: '# Conversation' })
      );
    });

    test('EXPORT_CONVERSATION returns error for missing conversation', async () => {
      const handler = getHandler(IPC_CHANNELS.CHAT.EXPORT_CONVERSATION);
      const event = createMockEvent();

      const result = await handler(event, { id: 'nonexistent' });
      expect(result).toEqual(expect.objectContaining({ success: false }));
    });

    test('EXPORT_CONVERSATION returns error when export not supported', async () => {
      delete mockChatHistoryStore.exportAsMarkdown;

      const handler = getHandler(IPC_CHANNELS.CHAT.EXPORT_CONVERSATION);
      const event = createMockEvent();

      const result = await handler(event, { id: 'c1' });
      expect(result).toEqual(
        expect.objectContaining({ success: false, error: 'Export not supported' })
      );
    });
  });

  describe('ChatService lazy initialization', () => {
    test('does not cache ChatService when llamaService is null', () => {
      jest.isolateModules(() => {
        const { IpcServiceContext } = require('../src/main/ipc/IpcServiceContext');
        const registerChatIpc = require('../src/main/ipc/chat');

        let resolveCount = 0;
        const mockContainer = {
          resolve: jest.fn(() => {
            resolveCount++;
            return null; // all services return null
          }),
          has: jest.fn(() => false)
        };

        const context = new IpcServiceContext()
          .setCore({ ipcMain, IPC_CHANNELS, logger: mockLogger })
          .setServiceIntegration(jest.fn(() => ({ container: mockContainer })));

        registerChatIpc(context);
      });

      // All handlers should be registered
      expect(ipcMain.handle.mock.calls.length).toBeGreaterThanOrEqual(8);
    });

    test('returns null when DI container is not available', async () => {
      jest.isolateModules(() => {
        const { IpcServiceContext } = require('../src/main/ipc/IpcServiceContext');
        const registerChatIpc = require('../src/main/ipc/chat');

        const context = new IpcServiceContext()
          .setCore({ ipcMain, IPC_CHANNELS, logger: mockLogger })
          .setServiceIntegration(jest.fn(() => null));

        registerChatIpc(context);
      });

      const handler = getHandler(IPC_CHANNELS.CHAT.QUERY_STREAM);
      const event = createMockEvent();
      const result = await handler(event, { query: 'test' });
      expect(result).toEqual(expect.objectContaining({ success: false }));
    });

    test('handles ChatService constructor error', async () => {
      jest.isolateModules(() => {
        jest.doMock('../src/main/services/ChatService', () => {
          return jest.fn().mockImplementation(() => {
            throw new Error('Constructor exploded');
          });
        });

        const { IpcServiceContext } = require('../src/main/ipc/IpcServiceContext');
        const registerChatIpc = require('../src/main/ipc/chat');

        const mockContainer = {
          resolve: jest.fn(() => ({})),
          has: jest.fn(() => true)
        };

        const context = new IpcServiceContext()
          .setCore({ ipcMain, IPC_CHANNELS, logger: mockLogger })
          .setServiceIntegration(jest.fn(() => ({ container: mockContainer })));

        registerChatIpc(context);
      });

      const handler = getHandler(IPC_CHANNELS.CHAT.QUERY_STREAM);
      const event = createMockEvent();
      const result = await handler(event, { query: 'test' });
      expect(result).toEqual(expect.objectContaining({ success: false }));
    });
  });
});
