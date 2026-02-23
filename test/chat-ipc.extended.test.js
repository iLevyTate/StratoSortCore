/**
 * Compatibility smoke tests for chat IPC registration.
 *
 * Detailed behavior is covered by service-level chat tests. These tests ensure
 * IPC registration remains robust as the registry/context implementation evolves.
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

  test('registers without throwing when integration is unavailable', () => {
    expect(() => {
      jest.isolateModules(() => {
        const { IpcServiceContext } = require('../src/main/ipc/IpcServiceContext');
        const registerChatIpc = require('../src/main/ipc/chat');
        const context = new IpcServiceContext()
          .setCore({ ipcMain, IPC_CHANNELS, logger: mockLogger })
          .setServiceIntegration(jest.fn().mockReturnValue(null));
        registerChatIpc(context);
      });
    }).not.toThrow();
  });

  test('registers without throwing when DI resolve throws', () => {
    expect(() => {
      jest.isolateModules(() => {
        const { IpcServiceContext } = require('../src/main/ipc/IpcServiceContext');
        const registerChatIpc = require('../src/main/ipc/chat');
        const context = new IpcServiceContext()
          .setCore({ ipcMain, IPC_CHANNELS, logger: mockLogger })
          .setServiceIntegration(
            jest.fn().mockReturnValue({
              container: {
                resolve: jest.fn(() => {
                  throw new Error('resolve failed');
                })
              }
            })
          );
        registerChatIpc(context);
      });
    }).not.toThrow();
  });
});
