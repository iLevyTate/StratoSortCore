/**
 * Tests for Batch Organize Handler
 * Tests batch file organization with rollback support
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
  mkdir: jest.fn().mockResolvedValue(undefined),
  access: jest.fn().mockResolvedValue(undefined)
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

// Mock crypto
jest.mock('crypto', () => ({
  createHash: jest.fn().mockReturnValue({
    update: jest.fn().mockReturnThis(),
    digest: jest.fn().mockReturnValue('abc123hash')
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
  }
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

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();

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

    const mockGetServiceIntegration = () => ({
      processingState: {
        createOrLoadOrganizeBatch: jest.fn().mockResolvedValue(null),
        markOrganizeOpStarted: jest.fn(),
        markOrganizeOpDone: jest.fn(),
        markOrganizeOpError: jest.fn(),
        completeOrganizeBatch: jest.fn()
      },
      undoRedo: {
        recordAction: jest.fn()
      }
    });

    const mockGetMainWindow = () => ({
      isDestroyed: () => false,
      webContents: {
        send: jest.fn()
      }
    });

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
      const mockServiceIntegration = {
        processingState: {
          createOrLoadOrganizeBatch: jest.fn().mockResolvedValue({
            operations: [
              { source: '/src/file1.txt', destination: '/dest/file1.txt', status: 'done' },
              { source: '/src/file2.txt', destination: '/dest/file2.txt', status: 'pending' }
            ]
          }),
          markOrganizeOpStarted: jest.fn(),
          markOrganizeOpDone: jest.fn(),
          markOrganizeOpError: jest.fn(),
          completeOrganizeBatch: jest.fn()
        },
        undoRedo: { recordAction: jest.fn() }
      };

      const result = await handleBatchOrganize({
        operation: {
          operations: [
            { source: '/src/file1.txt', destination: '/dest/file1.txt' },
            { source: '/src/file2.txt', destination: '/dest/file2.txt' }
          ]
        },
        logger: mockLogger,
        getServiceIntegration: () => mockServiceIntegration,
        getMainWindow: mockGetMainWindow
      });

      expect(result.successCount).toBe(2);
      // First operation should be marked as resumed
      expect(result.results[0].resumed).toBe(true);
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

    test('sends progress to renderer', async () => {
      const mockWindow = {
        isDestroyed: () => false,
        webContents: { send: jest.fn() }
      };

      await handleBatchOrganize({
        operation: {
          operations: [{ source: '/src/file.txt', destination: '/dest/file.txt' }]
        },
        logger: mockLogger,
        getServiceIntegration: mockGetServiceIntegration,
        getMainWindow: () => mockWindow
      });

      expect(mockWindow.webContents.send).toHaveBeenCalledWith(
        'operation-progress',
        expect.objectContaining({
          type: 'batch_organize',
          current: 1,
          total: 1
        })
      );
    });
  });

  describe('computeFileChecksum', () => {
    test('computes SHA-256 checksum', async () => {
      const checksum = await computeFileChecksum('/path/to/file.txt');
      expect(checksum).toBe('abc123hash');
    });
  });

  describe('MAX_BATCH_SIZE', () => {
    test('is set to 1000', () => {
      expect(MAX_BATCH_SIZE).toBe(1000);
    });
  });
});
