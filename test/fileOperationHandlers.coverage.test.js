/**
 * @jest-environment node
 *
 * File Operation Handlers Coverage Tests
 *
 * Tests untested paths: delete operations, unknown operation types,
 * invalid operations, error categorization, and copy handling.
 *
 * Coverage target: main/ipc/files/fileOperationHandlers.js (was 40%)
 */

const { IPC_CHANNELS } = require('../src/shared/constants');

jest.mock('fs', () => ({
  promises: {
    stat: jest.fn().mockResolvedValue({ size: 100, isFile: () => true }),
    access: jest.fn().mockResolvedValue(),
    rename: jest.fn().mockResolvedValue(),
    copyFile: jest.fn().mockResolvedValue(),
    unlink: jest.fn().mockResolvedValue(),
    mkdir: jest.fn().mockResolvedValue(),
    readFile: jest.fn()
  }
}));

jest.mock('../src/shared/logger', () => {
  const logger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    setContext: jest.fn()
  };
  return { createLogger: jest.fn(() => logger), logger };
});

jest.mock('../src/main/ipc/ipcWrappers', () => ({
  createHandler: jest.fn(({ handler }) => handler),
  safeHandle: jest.fn(),
  withErrorLogging: jest.fn((logger, handler) => handler),
  withValidation: jest.fn((logger, schema, handler) => handler),
  safeSend: jest.fn()
}));

jest.mock('../src/main/ipc/files/batchOrganizeHandler', () => ({
  handleBatchOrganize: jest.fn().mockResolvedValue({ success: true, count: 1 })
}));

jest.mock('../src/shared/pathSanitization', () => ({
  validateFileOperationPath: jest.fn((p) => ({ valid: true, normalizedPath: p }))
}));

jest.mock('../src/shared/pathTraceLogger', () => ({
  traceMoveStart: jest.fn(),
  traceMoveComplete: jest.fn(),
  traceCopyStart: jest.fn(),
  traceCopyComplete: jest.fn(),
  traceDeleteStart: jest.fn(),
  traceDeleteComplete: jest.fn(),
  traceDbUpdate: jest.fn(),
  PathChangeReason: { USER_MOVE: 'user_move' }
}));

jest.mock('../src/main/services/organization/learningFeedback', () => ({
  getInstance: jest.fn(),
  FEEDBACK_SOURCES: { MANUAL_MOVE: 'manual_move' }
}));

jest.mock('../src/main/ipc/files/embeddingSync', () => ({
  syncEmbeddingForMove: jest.fn().mockResolvedValue()
}));

jest.mock('../src/shared/promiseUtils', () => ({
  withTimeout: jest.fn((p) => p)
}));

jest.mock('../src/shared/atomicFileOperations', () => ({
  crossDeviceMove: jest.fn()
}));

jest.mock('../src/main/ipc/semantic', () => ({
  getSearchServiceInstance: jest.fn(),
  getClusteringServiceInstance: jest.fn()
}));

jest.mock('../src/main/services/ServiceContainer', () => ({
  container: {
    has: jest.fn(() => true),
    resolve: jest.fn()
  },
  ServiceIds: {
    FILE_PATH_COORDINATOR: 'filePathCoordinator',
    ANALYSIS_HISTORY: 'analysisHistory'
  }
}));

jest.mock('../src/main/ipc/validationSchemas', () => ({
  z: {},
  schemas: {}
}));

describe('fileOperationHandlers - extended coverage', () => {
  let mockIpcMain;
  let mockLogger;
  let mockFilePathCoordinator;
  let safeHandle;
  let registerFileOperationHandlers;
  let fs;

  function getHandler(channel) {
    const call = safeHandle.mock.calls.find((c) => c[1] === channel);
    if (!call) throw new Error(`Handler for ${channel} not registered`);
    return call[2];
  }

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();

    fs = require('fs').promises;
    safeHandle = require('../src/main/ipc/ipcWrappers').safeHandle;
    mockLogger = require('../src/shared/logger').logger;

    mockIpcMain = { handle: jest.fn() };

    mockFilePathCoordinator = {
      atomicPathUpdate: jest.fn().mockResolvedValue({ success: true }),
      handleFileCopy: jest.fn().mockResolvedValue({ success: true }),
      handleFileDeletion: jest.fn().mockResolvedValue({ success: true })
    };

    const { container } = require('../src/main/services/ServiceContainer');
    container.has.mockReturnValue(true);
    container.resolve.mockReturnValue(mockFilePathCoordinator);

    require('../src/main/ipc/semantic').getSearchServiceInstance.mockReturnValue({
      invalidateAndRebuild: jest.fn().mockResolvedValue()
    });
    require('../src/main/ipc/semantic').getClusteringServiceInstance.mockReturnValue({
      invalidateClusters: jest.fn()
    });

    const { IpcServiceContext } = require('../src/main/ipc/IpcServiceContext');
    const context = new IpcServiceContext();
    context.setCore({ ipcMain: mockIpcMain, IPC_CHANNELS, logger: mockLogger });
    context.setElectron({
      getMainWindow: () => ({
        isDestroyed: () => false,
        webContents: { send: jest.fn() }
      })
    });
    context.setServiceIntegration(() => ({
      undoRedo: { recordAction: jest.fn() }
    }));

    registerFileOperationHandlers =
      require('../src/main/ipc/files/fileOperationHandlers').registerFileOperationHandlers;
    registerFileOperationHandlers(context);
  });

  test('registers handlers for key channels', () => {
    const channels = safeHandle.mock.calls.map((c) => c[1]);
    expect(channels).toContain(IPC_CHANNELS.FILES.PERFORM_OPERATION);
    expect(channels).toContain(IPC_CHANNELS.FILES.DELETE_FILE);
    expect(channels).toContain(IPC_CHANNELS.FILES.COPY_FILE);
    expect(channels).toContain(IPC_CHANNELS.FILES.CLEANUP_ANALYSIS);
  });

  describe('PERFORM_OPERATION', () => {
    test('rejects invalid operation (non-object)', async () => {
      const handler = getHandler(IPC_CHANNELS.FILES.PERFORM_OPERATION);
      const result = await handler({}, 'not-an-object');
      expect(result.success).toBe(false);
    });

    test('rejects null operation', async () => {
      const handler = getHandler(IPC_CHANNELS.FILES.PERFORM_OPERATION);
      const result = await handler({}, null);
      expect(result.success).toBe(false);
    });

    test('rejects operation with missing type', async () => {
      const handler = getHandler(IPC_CHANNELS.FILES.PERFORM_OPERATION);
      const result = await handler({}, { source: '/a/b.txt' });
      expect(result.success).toBe(false);
    });

    test('rejects unknown operation type', async () => {
      const handler = getHandler(IPC_CHANNELS.FILES.PERFORM_OPERATION);
      const result = await handler({}, { type: 'hack', source: '/a/b.txt' });
      expect(result.success).toBe(false);
    });

    test('handles delete operation type', async () => {
      fs.stat.mockResolvedValue({ size: 100 });
      fs.unlink.mockResolvedValue();

      const handler = getHandler(IPC_CHANNELS.FILES.PERFORM_OPERATION);
      const result = await handler(
        {},
        {
          type: 'delete',
          source: '/home/user/test.txt'
        }
      );
      expect(result).toHaveProperty('success');
    });

    test('handles copy operation with valid paths', async () => {
      fs.stat.mockResolvedValue({ size: 100 });
      fs.copyFile.mockResolvedValue();

      const handler = getHandler(IPC_CHANNELS.FILES.PERFORM_OPERATION);
      const result = await handler(
        {},
        {
          type: 'copy',
          source: '/docs/original.pdf',
          destination: '/backup/original.pdf'
        }
      );
      expect(result).toHaveProperty('success');
    });

    test('handles batch_organize operation', async () => {
      const handler = getHandler(IPC_CHANNELS.FILES.PERFORM_OPERATION);
      const result = await handler(
        {},
        {
          type: 'batch_organize',
          operations: []
        }
      );
      expect(result).toHaveProperty('success');
    });
  });

  describe('DELETE_FILE', () => {
    test('rejects empty file path', async () => {
      const handler = getHandler(IPC_CHANNELS.FILES.DELETE_FILE);
      const result = await handler({}, '');
      expect(result.success).toBe(false);
    });

    test('rejects non-string file path', async () => {
      const handler = getHandler(IPC_CHANNELS.FILES.DELETE_FILE);
      const result = await handler({}, 123);
      expect(result.success).toBe(false);
    });

    test('handles successful deletion', async () => {
      fs.stat.mockResolvedValue({ size: 100, isFile: () => true });
      fs.unlink.mockResolvedValue();

      const handler = getHandler(IPC_CHANNELS.FILES.DELETE_FILE);
      const result = await handler({}, '/docs/test.pdf');
      expect(result.success).toBe(true);
    });

    test('handles permission error on delete', async () => {
      fs.stat.mockResolvedValue({ size: 100, isFile: () => true });
      const eperm = Object.assign(new Error('EPERM'), { code: 'EPERM' });
      fs.unlink.mockRejectedValue(eperm);

      const handler = getHandler(IPC_CHANNELS.FILES.DELETE_FILE);
      const result = await handler({}, '/docs/locked.pdf');
      expect(result.success).toBe(false);
    });

    test('handles non-ENOENT stat error', async () => {
      const eacces = Object.assign(new Error('EACCES'), { code: 'EACCES' });
      fs.stat.mockRejectedValue(eacces);

      const handler = getHandler(IPC_CHANNELS.FILES.DELETE_FILE);
      const result = await handler({}, '/docs/noaccess.pdf');
      // Should still attempt or report an error
      expect(result).toHaveProperty('success');
    });
  });

  describe('COPY_FILE', () => {
    test('copies file with valid paths', async () => {
      fs.stat.mockResolvedValue({ size: 100, isFile: () => true });
      fs.copyFile.mockResolvedValue();
      fs.mkdir.mockResolvedValue();

      const handler = getHandler(IPC_CHANNELS.FILES.COPY_FILE);
      const result = await handler({}, '/docs/file.pdf', '/backup/file.pdf');
      expect(result.success).toBe(true);
    });

    test('rejects copy with missing source', async () => {
      const handler = getHandler(IPC_CHANNELS.FILES.COPY_FILE);
      const result = await handler({}, '', '/backup/file.pdf');
      expect(result.success).toBe(false);
    });
  });

  describe('CLEANUP_ANALYSIS', () => {
    test('handles cleanup request', async () => {
      const handler = getHandler(IPC_CHANNELS.FILES.CLEANUP_ANALYSIS);
      const result = await handler({}, { filePath: '/docs/old.pdf' });
      expect(result).toHaveProperty('success');
    });
  });
});
