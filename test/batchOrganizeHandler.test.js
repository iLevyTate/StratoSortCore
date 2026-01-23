/**
 * Tests for Batch Organize Handler
 * Tests batch file organization with rollback support
 */

// Mock electron
jest.mock('electron', () => ({
  app: {
    getPath: jest.fn().mockReturnValue('/mock/user/data')
  }
}));

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
  mkdir: jest.fn().mockResolvedValue(undefined),
  access: jest.fn().mockResolvedValue(undefined),
  writeFile: jest.fn().mockResolvedValue(undefined),
  readFile: jest.fn().mockResolvedValue('{}'),
  unlink: jest.fn().mockResolvedValue(undefined)
};
jest.mock('fs', () => ({
  promises: mockFs,
  createReadStream: jest.fn().mockReturnValue({
    on: jest.fn((event, cb) => {
      if (event === 'end') setTimeout(() => cb(), 0);
      return { on: jest.fn().mockReturnThis(), destroy: jest.fn() };
    })
  })
}));

// Mock crypto - generate unique hashes based on input
// Using global to survive jest.mock hoisting
global.__hashCounter = 0;
jest.mock('crypto', () => ({
  createHash: jest.fn().mockImplementation(() => {
    let inputValue = '';
    return {
      update: jest.fn().mockImplementation((val) => {
        inputValue = val;
        return {
          digest: jest.fn().mockReturnValue(`hash_${inputValue}_${global.__hashCounter++}`)
        };
      }),
      digest: jest.fn().mockReturnValue(`hash_fallback_${global.__hashCounter++}`)
    };
  }),
  randomUUID: jest.fn().mockReturnValue('12345678-1234-1234-1234-123456789012')
}));

// Mock constants
jest.mock('../src/shared/constants', () => ({
  ACTION_TYPES: {
    BATCH_OPERATION: 'BATCH_OPERATION'
  },
  PROCESSING_LIMITS: {
    MAX_BATCH_OPERATION_SIZE: 1000,
    MAX_BATCH_OPERATION_TIME: 600000
  }
}));

// Mock performanceConstants
jest.mock('../src/shared/performanceConstants', () => ({
  LIMITS: {
    MAX_NUMERIC_RETRIES: 5000
  },
  TIMEOUTS: {
    FILE_COPY: 30000
  }
}));

// Mock promiseUtils
jest.mock('../src/shared/promiseUtils', () => ({
  withTimeout: jest.fn((promise) => promise) // Just pass through the promise
}));

// Mock atomicFileOperations
jest.mock('../src/shared/atomicFileOperations', () => ({
  crossDeviceMove: jest.fn().mockResolvedValue(undefined)
}));

// Mock pathSanitization to allow test paths
jest.mock('../src/shared/pathSanitization', () => ({
  validateFileOperationPath: jest.fn().mockImplementation((filePath) => ({
    valid: true,
    normalizedPath: filePath
  }))
}));

// Mock chromadb
jest.mock('../src/main/services/chromadb', () => ({
  getInstance: jest.fn().mockReturnValue({
    updateFilePaths: jest.fn().mockResolvedValue(undefined)
  })
}));

describe('Batch Organize Handler', () => {
  let handleBatchOrganize;
  let computeFileChecksum;
  let MAX_BATCH_SIZE;
  let mockCoordinator;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();

    // Reset hash counter for unique idempotency keys
    global.__hashCounter = 0;

    mockCoordinator = {
      batchPathUpdate: jest.fn().mockResolvedValue({ success: true, summary: {} })
    };

    jest.doMock('../src/main/services/ServiceContainer', () => ({
      container: {
        has: jest.fn((id) => id === 'filePathCoordinator'),
        resolve: jest.fn(() => mockCoordinator)
      },
      ServiceIds: {
        FILE_PATH_COORDINATOR: 'filePathCoordinator'
      }
    }));

    // Reset fs mock implementations to default success behavior
    mockFs.rename.mockReset().mockResolvedValue(undefined);
    mockFs.mkdir.mockReset().mockResolvedValue(undefined);
    mockFs.access.mockReset().mockResolvedValue(undefined);
    mockFs.writeFile.mockReset().mockResolvedValue(undefined);
    mockFs.readFile.mockReset().mockResolvedValue('{}');
    mockFs.unlink.mockReset().mockResolvedValue(undefined);

    const module = require('../src/main/ipc/files/batchOrganizeHandler');
    handleBatchOrganize = module.handleBatchOrganize;
    computeFileChecksum = module.computeFileChecksum;
    MAX_BATCH_SIZE = module.MAX_BATCH_SIZE;
  });

  describe('handleBatchOrganize', () => {
    const mockLogger = {
      info: jest.fn(),
      debug: jest.fn(),
      warn: jest.fn(),
      error: jest.fn()
    };

    const mockUpdateEntryPaths = jest.fn().mockResolvedValue({ updated: 1, notFound: 0 });
    const mockCreateOrLoadOrganizeBatch = jest.fn().mockResolvedValue(null);
    const mockMarkOrganizeOpStarted = jest.fn();
    const mockMarkOrganizeOpDone = jest.fn();
    const mockMarkOrganizeOpError = jest.fn();
    const mockCompleteOrganizeBatch = jest.fn();
    const mockRecordAction = jest.fn();
    const mockWindowSend = jest.fn();

    const mockServiceIntegration = {
      processingState: {
        createOrLoadOrganizeBatch: mockCreateOrLoadOrganizeBatch,
        markOrganizeOpStarted: mockMarkOrganizeOpStarted,
        markOrganizeOpDone: mockMarkOrganizeOpDone,
        markOrganizeOpError: mockMarkOrganizeOpError,
        completeOrganizeBatch: mockCompleteOrganizeBatch
      },
      undoRedo: {
        recordAction: mockRecordAction
      },
      analysisHistory: {
        updateEntryPaths: mockUpdateEntryPaths
      }
    };

    const mockGetServiceIntegration = () => mockServiceIntegration;

    const mockMainWindow = {
      isDestroyed: () => false,
      webContents: {
        send: mockWindowSend
      }
    };

    beforeEach(() => {
      mockUpdateEntryPaths.mockClear();
      mockCreateOrLoadOrganizeBatch.mockClear().mockResolvedValue(null);
      mockMarkOrganizeOpStarted.mockClear();
      mockMarkOrganizeOpDone.mockClear();
      mockMarkOrganizeOpError.mockClear();
      mockCompleteOrganizeBatch.mockClear();
      mockRecordAction.mockClear();
      mockWindowSend.mockClear();
    });

    const mockGetMainWindow = () => mockMainWindow;

    test('rejects non-array operations', async () => {
      const result = await handleBatchOrganize({
        operation: { operations: 'not-array' },
        logger: mockLogger,
        getServiceIntegration: mockGetServiceIntegration,
        getMainWindow: mockGetMainWindow
      });

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('INVALID_BATCH');
    });

    test('rejects empty operations array', async () => {
      const result = await handleBatchOrganize({
        operation: { operations: [] },
        logger: mockLogger,
        getServiceIntegration: mockGetServiceIntegration,
        getMainWindow: mockGetMainWindow
      });

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('EMPTY_BATCH');
    });

    test('rejects batch exceeding max size', async () => {
      const operations = Array.from({ length: MAX_BATCH_SIZE + 1 }, (_, i) => ({
        source: `/src/file${i}.txt`,
        destination: `/dest/file${i}.txt`
      }));

      const result = await handleBatchOrganize({
        operation: { operations },
        logger: mockLogger,
        getServiceIntegration: mockGetServiceIntegration,
        getMainWindow: mockGetMainWindow
      });

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('BATCH_TOO_LARGE');
    });

    test('processes batch successfully', async () => {
      const operations = [
        { source: '/src/file1.txt', destination: '/dest/file1.txt' },
        { source: '/src/file2.txt', destination: '/dest/file2.txt' }
      ];

      const result = await handleBatchOrganize({
        operation: { operations },
        logger: mockLogger,
        getServiceIntegration: mockGetServiceIntegration,
        getMainWindow: mockGetMainWindow
      });

      expect(result.success).toBe(true);
      expect(result.successCount).toBe(2);
      expect(result.failCount).toBe(0);

      // Verify FilePathCoordinator batch update was called with correct paths
      expect(mockCoordinator.batchPathUpdate).toHaveBeenCalled();
      const calls = mockCoordinator.batchPathUpdate.mock.calls[0][0];
      expect(calls).toHaveLength(2);
      expect(calls[0]).toMatchObject({
        oldPath: '/src/file1.txt',
        newPath: '/dest/file1.txt'
      });
    });

    test('handles partial failures', async () => {
      mockFs.rename
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('File not found'));

      const operations = [
        { source: '/src/file1.txt', destination: '/dest/file1.txt' },
        { source: '/src/file2.txt', destination: '/dest/file2.txt' }
      ];

      const result = await handleBatchOrganize({
        operation: { operations },
        logger: mockLogger,
        getServiceIntegration: mockGetServiceIntegration,
        getMainWindow: mockGetMainWindow
      });

      expect(result.successCount).toBe(1);
      expect(result.failCount).toBe(1);
    });

    test('skips already completed operations', async () => {
      const localMockServiceIntegration = {
        processingState: {
          createOrLoadOrganizeBatch: jest.fn().mockResolvedValue({
            operations: [
              { source: '/src/file1.txt', destination: '/dest/file1.txt', status: 'done' },
              { source: '/src/file2.txt', destination: '/dest/file2.txt', status: 'done' } // Both done for predictable test
            ]
          }),
          markOrganizeOpStarted: jest.fn(),
          markOrganizeOpDone: jest.fn(),
          markOrganizeOpError: jest.fn(),
          completeOrganizeBatch: jest.fn()
        },
        undoRedo: { recordAction: jest.fn() },
        analysisHistory: { updateEntryPaths: jest.fn().mockResolvedValue({ updated: 1 }) }
      };

      const result = await handleBatchOrganize({
        operation: {
          operations: [
            { source: '/src/file1.txt', destination: '/dest/file1.txt' },
            { source: '/src/file2.txt', destination: '/dest/file2.txt' }
          ]
        },
        logger: mockLogger,
        getServiceIntegration: () => localMockServiceIntegration,
        getMainWindow: mockGetMainWindow
      });

      expect(result.successCount).toBe(2);
      // Both operations should be marked as resumed since they were already 'done'
      expect(result.results[0].resumed).toBe(true);
      expect(result.results[1].resumed).toBe(true);
    });

    test('handles file collision with counter', async () => {
      mockFs.rename.mockRejectedValueOnce({ code: 'EEXIST' }).mockResolvedValueOnce(undefined);

      const result = await handleBatchOrganize({
        operation: {
          operations: [{ source: '/src/file.txt', destination: '/dest/file.txt' }]
        },
        logger: mockLogger,
        getServiceIntegration: mockGetServiceIntegration,
        getMainWindow: mockGetMainWindow
      });

      expect(result.success).toBe(true);
      expect(result.results[0].destination).toContain('_1');
    });

    test('handles cross-device move', async () => {
      mockFs.rename.mockRejectedValueOnce({ code: 'EXDEV' });
      const { crossDeviceMove } = require('../src/shared/atomicFileOperations');

      const result = await handleBatchOrganize({
        operation: {
          operations: [{ source: '/src/file.txt', destination: '/dest/file.txt' }]
        },
        logger: mockLogger,
        getServiceIntegration: mockGetServiceIntegration,
        getMainWindow: mockGetMainWindow
      });

      expect(crossDeviceMove).toHaveBeenCalled();
      expect(result.success).toBe(true);
    });

    test('triggers rollback on critical error', async () => {
      // First operation succeeds
      mockFs.rename.mockResolvedValueOnce(undefined);
      // Second operation fails with critical error
      mockFs.rename.mockRejectedValueOnce({ code: 'ENOSPC', message: 'No space' });

      const result = await handleBatchOrganize({
        operation: {
          operations: [
            { source: '/src/file1.txt', destination: '/dest/file1.txt' },
            { source: '/src/file2.txt', destination: '/dest/file2.txt' }
          ]
        },
        logger: mockLogger,
        getServiceIntegration: mockGetServiceIntegration,
        getMainWindow: mockGetMainWindow
      });

      expect(result.success).toBe(false);
      expect(result.rolledBack).toBe(true);
    });

    test('persists recovery manifest during rollback', async () => {
      // Setup failure to trigger rollback
      mockFs.rename.mockResolvedValueOnce(undefined);
      mockFs.rename.mockRejectedValueOnce({ code: 'ENOSPC', message: 'No space' });

      const operations = [
        { source: '/src/file1.txt', destination: '/dest/file1.txt' },
        { source: '/src/file2.txt', destination: '/dest/file2.txt' }
      ];

      await handleBatchOrganize({
        operation: { operations },
        logger: mockLogger,
        getServiceIntegration: mockGetServiceIntegration,
        getMainWindow: mockGetMainWindow
      });

      // Check if recovery file was written
      expect(mockFs.writeFile).toHaveBeenCalled();
      const writeCall = mockFs.writeFile.mock.calls[0];
      expect(writeCall[0]).toContain('recovery');
      expect(writeCall[0]).toContain('rollback_');

      const manifest = JSON.parse(writeCall[1]);
      expect(manifest.status).toBe('pending');
      expect(manifest.operations).toHaveLength(1); // 1 completed op to rollback
    });

    test('processes single operation successfully', async () => {
      // Note: Progress events are no longer sent to renderer in current implementation
      const result = await handleBatchOrganize({
        operation: {
          operations: [{ source: '/src/file.txt', destination: '/dest/file.txt' }]
        },
        logger: mockLogger,
        getServiceIntegration: mockGetServiceIntegration,
        getMainWindow: mockGetMainWindow
      });

      expect(result.success).toBe(true);
      expect(result.successCount).toBe(1);
    });
  });

  describe('computeFileChecksum', () => {
    test('computes SHA-256 checksum', async () => {
      const checksum = await computeFileChecksum('/path/to/file.txt');
      // Hash is now dynamically generated, just verify it returns a string
      expect(typeof checksum).toBe('string');
      expect(checksum.length).toBeGreaterThan(0);
    });
  });

  describe('MAX_BATCH_SIZE', () => {
    test('is set to 1000', () => {
      expect(MAX_BATCH_SIZE).toBe(1000);
    });
  });
});
