/**
 * Tests for File Operation Handlers
 * Tests move, copy, delete operations with database sync
 */

// Mock logger
jest.mock('../src/shared/logger', () => ({
  logger: {
    setContext: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  }
}));

// Mock fs
const mockFs = {
  rename: jest.fn().mockResolvedValue(undefined),
  copyFile: jest.fn().mockResolvedValue(undefined),
  unlink: jest.fn().mockResolvedValue(undefined),
  access: jest.fn().mockResolvedValue(undefined),
  stat: jest.fn().mockResolvedValue({ size: 1024 }),
  mkdir: jest.fn().mockResolvedValue(undefined)
};
jest.mock('fs', () => ({
  promises: mockFs
}));

// Mock constants
jest.mock('../src/shared/constants', () => ({
  ACTION_TYPES: {
    FILE_MOVE: 'FILE_MOVE',
    BATCH_OPERATION: 'BATCH_OPERATION'
  }
}));

// Mock ipcWrappers
jest.mock('../src/main/ipc/ipcWrappers', () => ({
  withErrorLogging: jest.fn((logger, handler) => handler),
  withValidation: jest.fn((logger, schema, handler) => handler),
  safeHandle: (ipcMain, channel, handler) => {
    ipcMain.handle(channel, handler);
  }
}));

// Mock validationSchemas
jest.mock('../src/main/ipc/validationSchemas', () => ({
  z: null,
  schemas: {
    fileOperation: null
  }
}));

// Mock batchOrganizeHandler
jest.mock('../src/main/ipc/files/batchOrganizeHandler', () => ({
  handleBatchOrganize: jest.fn().mockResolvedValue({ success: true })
}));

// Mock promiseUtils (for embedding sync timeouts)
jest.mock('../src/shared/promiseUtils', () => ({
  withTimeout: jest.fn((promise) => promise)
}));

global.__mockSearchService = {
  invalidateAndRebuild: jest.fn().mockResolvedValue(undefined)
};
global.__mockClusteringService = {
  invalidateClusters: jest.fn()
};

// Mock embedding sync
jest.mock('../src/main/ipc/files/embeddingSync', () => ({
  syncEmbeddingForMove: jest.fn().mockResolvedValue({ action: 'enqueued' })
}));

// Mock semantic services
jest.mock('../src/main/ipc/semantic', () => ({
  getSearchServiceInstance: jest.fn(() => global.__mockSearchService),
  getClusteringServiceInstance: jest.fn(() => global.__mockClusteringService)
}));

// Mock chromadb (both index paths to match production import)
const chromaMockFactory = () => ({
  getInstance: jest.fn().mockReturnValue({
    updateFilePaths: jest.fn().mockResolvedValue(undefined),
    deleteFileEmbedding: jest.fn().mockResolvedValue(undefined)
  })
});
jest.mock('../src/main/services/chromadb', () => chromaMockFactory());
jest.mock('../src/main/services/chromadb/index.js', () => chromaMockFactory());

// Mock embeddingQueue
jest.mock('../src/main/analysis/embeddingQueue', () => ({
  removeByFilePath: jest.fn().mockReturnValue(0)
}));

// Mock pathSanitization - allow paths through validation
jest.mock('../src/shared/pathSanitization', () => ({
  validateFileOperationPath: jest.fn().mockImplementation(async (filePath) => ({
    valid: true,
    normalizedPath: filePath
  })),
  sanitizePath: jest.fn((p) => p),
  isPathDangerous: jest.fn(() => false),
  checkSymlinkSafety: jest.fn().mockResolvedValue({ isSymlink: false, isSafe: true })
}));

describe('File Operation Handlers', () => {
  let registerFileOperationHandlers;
  let mockIpcMain;
  let mockLogger;
  let handlers;
  let mockCoordinator;
  let mockAnalysisHistory;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();

    // Create fresh mock for this test execution
    mockCoordinator = {
      atomicPathUpdate: jest.fn().mockResolvedValue({ success: true, errors: [] }),
      handleFileDeletion: jest.fn().mockResolvedValue({ success: true, errors: [] }),
      handleFileCopy: jest.fn().mockResolvedValue({ success: true, errors: [] })
    };
    mockAnalysisHistory = {
      getAnalysisByPath: jest.fn().mockResolvedValue(null)
    };
    global.__mockSearchService.invalidateAndRebuild.mockClear();
    global.__mockClusteringService.invalidateClusters.mockClear();

    // Re-mock ServiceContainer with the fresh coordinator
    jest.doMock('../src/main/services/ServiceContainer', () => ({
      container: {
        has: jest
          .fn()
          .mockImplementation(
            (serviceId) => serviceId === 'FILE_PATH_COORDINATOR' || serviceId === 'analysisHistory'
          ),
        resolve: jest.fn().mockImplementation((serviceId) => {
          if (serviceId === 'analysisHistory') {
            return mockAnalysisHistory;
          }
          return mockCoordinator;
        })
      },
      ServiceIds: {
        FILE_PATH_COORDINATOR: 'FILE_PATH_COORDINATOR',
        ANALYSIS_HISTORY: 'analysisHistory'
      }
    }));

    mockIpcMain = {
      handle: jest.fn()
    };

    mockLogger = {
      info: jest.fn(),
      debug: jest.fn(),
      warn: jest.fn(),
      error: jest.fn()
    };

    handlers = {};

    // Capture registered handlers
    mockIpcMain.handle.mockImplementation((channel, handler) => {
      handlers[channel] = handler;
    });

    const module = require('../src/main/ipc/files/fileOperationHandlers');
    registerFileOperationHandlers = module.registerFileOperationHandlers;
  });

  describe('registerFileOperationHandlers', () => {
    test('registers all handlers', () => {
      registerFileOperationHandlers({
        ipcMain: mockIpcMain,
        IPC_CHANNELS: {
          FILES: {
            PERFORM_OPERATION: 'files:perform-operation',
            DELETE_FILE: 'files:delete-file',
            COPY_FILE: 'files:copy-file',
            CLEANUP_ANALYSIS: 'files:cleanup-analysis'
          }
        },
        logger: mockLogger,
        getServiceIntegration: () => null,
        getMainWindow: () => null
      });

      expect(mockIpcMain.handle).toHaveBeenCalledTimes(4);
    });
  });

  describe('performOperation handler', () => {
    beforeEach(() => {
      registerFileOperationHandlers({
        ipcMain: mockIpcMain,
        IPC_CHANNELS: {
          FILES: {
            PERFORM_OPERATION: 'files:perform-operation',
            DELETE_FILE: 'files:delete-file',
            COPY_FILE: 'files:copy-file',
            CLEANUP_ANALYSIS: 'files:cleanup-analysis'
          }
        },
        logger: mockLogger,
        getServiceIntegration: () => ({
          undoRedo: { recordAction: jest.fn() }
        }),
        getMainWindow: () => null
      });
    });

    test('rejects null operation', async () => {
      const handler = handlers['files:perform-operation'];
      const result = await handler({}, null);

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('INVALID_OPERATION');
    });

    test('rejects operation without type', async () => {
      const handler = handlers['files:perform-operation'];
      const result = await handler({}, { source: '/test' });

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('INVALID_OPERATION_TYPE');
    });

    test('handles move operation', async () => {
      const handler = handlers['files:perform-operation'];
      const result = await handler(
        {},
        {
          type: 'move',
          source: '/source/file.txt',
          destination: '/dest/file.txt'
        }
      );

      expect(result.success).toBe(true);
      expect(mockFs.rename).toHaveBeenCalledWith('/source/file.txt', '/dest/file.txt');
    });

    test('handles copy operation', async () => {
      const handler = handlers['files:perform-operation'];
      const result = await handler(
        {},
        {
          type: 'copy',
          source: '/source/file.txt',
          destination: '/dest/file.txt'
        }
      );

      expect(result.success).toBe(true);
      expect(mockFs.copyFile).toHaveBeenCalled();
      expect(global.__mockSearchService.invalidateAndRebuild).toHaveBeenCalledWith(
        expect.objectContaining({
          immediate: true,
          reason: 'file-copy',
          newPath: '/dest/file.txt'
        })
      );
      expect(global.__mockClusteringService.invalidateClusters).toHaveBeenCalled();
      expect(mockCoordinator.handleFileCopy).toHaveBeenCalledWith(
        '/source/file.txt',
        '/dest/file.txt'
      );
      const { syncEmbeddingForMove } = require('../src/main/ipc/files/embeddingSync');
      expect(syncEmbeddingForMove).toHaveBeenCalledWith(
        expect.objectContaining({
          sourcePath: '/source/file.txt',
          destPath: '/dest/file.txt'
        })
      );
    });

    test('handles delete operation', async () => {
      const handler = handlers['files:perform-operation'];
      const result = await handler(
        {},
        {
          type: 'delete',
          source: '/source/file.txt'
        }
      );

      expect(result.success).toBe(true);
      expect(mockFs.unlink).toHaveBeenCalledWith('/source/file.txt');
    });

    test('handles unknown operation type', async () => {
      const handler = handlers['files:perform-operation'];
      const result = await handler(
        {},
        {
          type: 'unknown',
          source: '/test'
        }
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('Unknown operation type');
    });

    test('updates database after move', async () => {
      const { getInstance } = require('../src/main/services/chromadb');
      const chromaDb = getInstance();

      const handler = handlers['files:perform-operation'];
      await handler(
        {},
        {
          type: 'move',
          source: '/source/file.txt',
          destination: '/dest/file.txt'
        }
      );

      expect(chromaDb.updateFilePaths).toHaveBeenCalled();
    });

    test('handles database update failure gracefully', async () => {
      mockCoordinator.atomicPathUpdate.mockResolvedValue({
        success: false,
        errors: [{ system: 'test', error: 'DB error' }]
      });

      const handler = handlers['files:perform-operation'];
      const result = await handler(
        {},
        {
          type: 'move',
          source: '/source/file.txt',
          destination: '/dest/file.txt'
        }
      );

      expect(mockCoordinator.atomicPathUpdate).toHaveBeenCalled();
      expect(result.success).toBe(true);
      expect(result.warning).toBeDefined();
    });
  });

  describe('deleteFile handler', () => {
    beforeEach(() => {
      registerFileOperationHandlers({
        ipcMain: mockIpcMain,
        IPC_CHANNELS: {
          FILES: {
            PERFORM_OPERATION: 'files:perform-operation',
            DELETE_FILE: 'files:delete-file',
            COPY_FILE: 'files:copy-file',
            CLEANUP_ANALYSIS: 'files:cleanup-analysis'
          }
        },
        logger: mockLogger,
        getServiceIntegration: () => null,
        getMainWindow: () => null
      });
    });

    test('deletes file successfully', async () => {
      const handler = handlers['files:delete-file'];
      const result = await handler({}, '/path/to/file.txt');

      expect(result.success).toBe(true);
      expect(result.deletedFile).toBeDefined();
    });

    test('rejects invalid file path', async () => {
      const handler = handlers['files:delete-file'];
      const result = await handler({}, null);

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('INVALID_PATH');
    });

    test('handles file not found', async () => {
      // Mock stat to fail with ENOENT (file not found)
      const enoentError = new Error('ENOENT: no such file or directory');
      enoentError.code = 'ENOENT';
      mockFs.stat.mockRejectedValueOnce(enoentError);

      const handler = handlers['files:delete-file'];
      const result = await handler({}, '/nonexistent/file.txt');

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('FILE_NOT_FOUND');
    });

    test('cleans up embedding queue', async () => {
      const handler = handlers['files:delete-file'];
      await handler({}, '/path/to/file.txt');

      expect(mockCoordinator.handleFileDeletion).toHaveBeenCalledWith('/path/to/file.txt');
    });
  });

  describe('cleanupAnalysis handler', () => {
    beforeEach(() => {
      registerFileOperationHandlers({
        ipcMain: mockIpcMain,
        IPC_CHANNELS: {
          FILES: {
            PERFORM_OPERATION: 'files:perform-operation',
            DELETE_FILE: 'files:delete-file',
            COPY_FILE: 'files:copy-file',
            CLEANUP_ANALYSIS: 'files:cleanup-analysis'
          }
        },
        logger: mockLogger,
        getServiceIntegration: () => null,
        getMainWindow: () => null
      });
    });

    test('cleans up analysis data without deleting file', async () => {
      const handler = handlers['files:cleanup-analysis'];
      const result = await handler({}, '/path/to/file.txt');

      expect(result.success).toBe(true);
      expect(mockCoordinator.handleFileDeletion).toHaveBeenCalledWith('/path/to/file.txt');
      expect(mockFs.unlink).not.toHaveBeenCalled();
    });

    test('aligns to organized path instead of deleting', async () => {
      mockAnalysisHistory.getAnalysisByPath.mockResolvedValue({
        organization: { actual: '/organized/file.txt' }
      });

      const handler = handlers['files:cleanup-analysis'];
      const result = await handler({}, '/path/to/file.txt');

      expect(result.success).toBe(true);
      expect(mockCoordinator.atomicPathUpdate).toHaveBeenCalledWith(
        '/path/to/file.txt',
        '/organized/file.txt',
        expect.objectContaining({ type: 'move', skipProcessingState: true })
      );
      expect(mockCoordinator.handleFileDeletion).not.toHaveBeenCalled();
    });

    test('rejects invalid file path', async () => {
      const handler = handlers['files:cleanup-analysis'];
      const result = await handler({}, null);

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('INVALID_PATH');
    });
  });

  describe('copyFile handler', () => {
    beforeEach(() => {
      registerFileOperationHandlers({
        ipcMain: mockIpcMain,
        IPC_CHANNELS: {
          FILES: {
            PERFORM_OPERATION: 'files:perform-operation',
            DELETE_FILE: 'files:delete-file',
            COPY_FILE: 'files:copy-file',
            CLEANUP_ANALYSIS: 'files:cleanup-analysis'
          }
        },
        logger: mockLogger,
        getServiceIntegration: () => null,
        getMainWindow: () => null
      });
    });

    test('copies file successfully', async () => {
      const handler = handlers['files:copy-file'];
      const result = await handler({}, '/source/file.txt', '/dest/file.txt');

      expect(result.success).toBe(true);
      expect(mockFs.copyFile).toHaveBeenCalled();
      expect(global.__mockSearchService.invalidateAndRebuild).toHaveBeenCalledWith(
        expect.objectContaining({
          immediate: true,
          reason: 'file-copy',
          newPath: '/dest/file.txt'
        })
      );
      expect(global.__mockClusteringService.invalidateClusters).toHaveBeenCalled();
      expect(mockCoordinator.handleFileCopy).toHaveBeenCalledWith(
        '/source/file.txt',
        '/dest/file.txt'
      );
      const { syncEmbeddingForMove } = require('../src/main/ipc/files/embeddingSync');
      expect(syncEmbeddingForMove).toHaveBeenCalledWith(
        expect.objectContaining({
          sourcePath: '/source/file.txt',
          destPath: '/dest/file.txt'
        })
      );
    });

    test('rejects missing paths', async () => {
      const handler = handlers['files:copy-file'];
      const result = await handler({}, null, '/dest/file.txt');

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('INVALID_PATHS');
    });

    test('creates destination directory', async () => {
      const handler = handlers['files:copy-file'];
      await handler({}, '/source/file.txt', '/new/dir/file.txt');

      expect(mockFs.mkdir).toHaveBeenCalled();
    });

    test('handles source not found', async () => {
      // Mock stat to fail with ENOENT (source file not found)
      const enoentError = new Error('ENOENT: no such file or directory');
      enoentError.code = 'ENOENT';
      mockFs.stat.mockRejectedValueOnce(enoentError);

      const handler = handlers['files:copy-file'];
      const result = await handler({}, '/nonexistent/file.txt', '/dest/file.txt');

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('SOURCE_NOT_FOUND');
    });
  });
});
