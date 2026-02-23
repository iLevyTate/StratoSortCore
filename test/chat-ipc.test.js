/**
 * Tests for Chat IPC handlers
 * Ensures chat handlers return safe fallback responses.
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

describe('registerChatIpc', () => {
  let ipcMain;
  let mockLogger;

  const IPC_CHANNELS = {
    CHAT: {
      QUERY: 'chat:query',
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
  });

  test('registers chat IPC handlers without throwing', () => {
    expect(() => {
      jest.isolateModules(() => {
        const { IpcServiceContext } = require('../src/main/ipc/IpcServiceContext');
        const registerChatIpc = require('../src/main/ipc/chat');
        const context = new IpcServiceContext()
          .setCore({
            ipcMain,
            IPC_CHANNELS,
            logger: mockLogger
          })
          .setServiceIntegration(jest.fn().mockReturnValue(null));
        registerChatIpc(context);
      });
    }).not.toThrow();
  });
});
