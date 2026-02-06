/**
 * @jest-environment node
 */
const { IPC_CHANNELS } = require('../src/shared/constants');

// Mock dependencies
jest.mock('fs', () => ({
  promises: {
    stat: jest.fn().mockResolvedValue({ size: 100 }),
    access: jest.fn().mockResolvedValue(),
    rename: jest.fn().mockResolvedValue(),
    copyFile: jest.fn().mockResolvedValue(),
    unlink: jest.fn().mockResolvedValue(),
    mkdir: jest.fn().mockResolvedValue()
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
    has: jest.fn(),
    resolve: jest.fn()
  },
  ServiceIds: {
    FILE_PATH_COORDINATOR: 'filePathCoordinator',
    ANALYSIS_HISTORY: 'analysisHistory'
  }
}));

// Mock validation schemas to avoid Zod issues
jest.mock('../src/main/ipc/validationSchemas', () => ({
  z: {},
  schemas: {}
}));

describe('File Operation Handlers', () => {
  let mockIpcMain;
  let mockLogger;
  let mockServiceIntegration;
  let mockMainWindow;
  let mockSearchService;
  let mockClusteringService;
  let mockFilePathCoordinator;
  let safeHandle;
  let registerFileOperationHandlers;
  let fs;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();

    fs = require('fs').promises;
    safeHandle = require('../src/main/ipc/ipcWrappers').safeHandle;
    mockLogger = require('../src/shared/logger').logger;

    mockIpcMain = { handle: jest.fn() };
    mockMainWindow = {
      isDestroyed: jest.fn(() => false),
      webContents: { send: jest.fn() }
    };

    mockServiceIntegration = {
      undoRedo: { recordAction: jest.fn() }
    };

    // Mock Search & Clustering services
    mockSearchService = {
      invalidateAndRebuild: jest.fn().mockResolvedValue()
    };
    mockClusteringService = {
      invalidateClusters: jest.fn()
    };
    require('../src/main/ipc/semantic').getSearchServiceInstance.mockReturnValue(mockSearchService);
    require('../src/main/ipc/semantic').getClusteringServiceInstance.mockReturnValue(
      mockClusteringService
    );

    // Mock FilePathCoordinator via ServiceContainer
    mockFilePathCoordinator = {
      atomicPathUpdate: jest.fn().mockResolvedValue({ success: true }),
      handleFileCopy: jest.fn().mockResolvedValue({ success: true }),
      handleFileDeletion: jest.fn().mockResolvedValue({ success: true })
    };
    const { container } = require('../src/main/services/ServiceContainer');
    container.has.mockReturnValue(true);
    container.resolve.mockReturnValue(mockFilePathCoordinator);

    const { IpcServiceContext } = require('../src/main/ipc/IpcServiceContext');
    const context = new IpcServiceContext();
    context.setCore({ ipcMain: mockIpcMain, IPC_CHANNELS, logger: mockLogger });
    context.setElectron({ getMainWindow: () => mockMainWindow });
    context.setServiceIntegration(() => mockServiceIntegration);

    registerFileOperationHandlers =
      require('../src/main/ipc/files/fileOperationHandlers').registerFileOperationHandlers;
    registerFileOperationHandlers(context);
  });

  function getHandler(channel) {
    const call = safeHandle.mock.calls.find((c) => c[1] === channel);
    if (!call) throw new Error(`Handler for ${channel} not registered`);
    return call[2];
  }

  describe('PERFORM_OPERATION', () => {
    test('handles file move successfully', async () => {
      const handler = getHandler(IPC_CHANNELS.FILES.PERFORM_OPERATION);
      const operation = {
        type: 'move',
        source: '/src/doc.pdf',
        destination: '/dest/doc.pdf'
      };

      const result = await handler({}, operation);

      expect(result.success).toBe(true);
      expect(fs.rename).toHaveBeenCalledWith('/src/doc.pdf', '/dest/doc.pdf');

      // Verify side effects
      expect(mockFilePathCoordinator.atomicPathUpdate).toHaveBeenCalled();
      expect(mockSearchService.invalidateAndRebuild).toHaveBeenCalled();
      expect(mockClusteringService.invalidateClusters).toHaveBeenCalled();
      expect(mockServiceIntegration.undoRedo.recordAction).toHaveBeenCalled();
    });

    test('handles file copy successfully', async () => {
      const handler = getHandler(IPC_CHANNELS.FILES.PERFORM_OPERATION);
      const operation = {
        type: 'copy',
        source: '/src/doc.pdf',
        destination: '/dest/doc.pdf'
      };

      const result = await handler({}, operation);

      expect(result.success).toBe(true);
      expect(fs.copyFile).toHaveBeenCalledWith('/src/doc.pdf', '/dest/doc.pdf');
      expect(mockFilePathCoordinator.handleFileCopy).toHaveBeenCalled();
    });

    test('delegates batch_organize to handler', async () => {
      const handler = getHandler(IPC_CHANNELS.FILES.PERFORM_OPERATION);
      const operation = {
        type: 'batch_organize',
        operations: []
      };

      const { handleBatchOrganize } = require('../src/main/ipc/files/batchOrganizeHandler');
      await handler({}, operation);

      expect(handleBatchOrganize).toHaveBeenCalled();
    });

    test('validates paths before operation', async () => {
      const handler = getHandler(IPC_CHANNELS.FILES.PERFORM_OPERATION);
      const { validateFileOperationPath } = require('../src/shared/pathSanitization');

      validateFileOperationPath.mockReturnValueOnce({ valid: false, error: 'Bad path' });

      const result = await handler({}, { type: 'move', source: 'bad', destination: 'good' });

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('INVALID_PATH');
      expect(fs.rename).not.toHaveBeenCalled();
    });
  });

  describe('DELETE_FILE', () => {
    test('deletes file and cleans up', async () => {
      const handler = getHandler(IPC_CHANNELS.FILES.DELETE_FILE);
      const filePath = '/path/to/delete.pdf';

      const result = await handler({}, filePath);

      expect(result.success).toBe(true);
      expect(fs.unlink).toHaveBeenCalledWith(filePath);
      expect(mockFilePathCoordinator.handleFileDeletion).toHaveBeenCalledWith(filePath);
    });

    test('handles ENOENT gracefully', async () => {
      const handler = getHandler(IPC_CHANNELS.FILES.DELETE_FILE);
      fs.stat.mockRejectedValueOnce({ code: 'ENOENT', message: 'Not found' });

      const result = await handler({}, '/missing.pdf');

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('FILE_NOT_FOUND');
      expect(fs.unlink).not.toHaveBeenCalled();
    });
  });
});
