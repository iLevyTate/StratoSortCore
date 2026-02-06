/**
 * @jest-environment node
 */
const { handleBatchOrganize } = require('../src/main/ipc/files/batchOrganizeHandler');
const { ERROR_CODES } = require('../src/shared/errorHandlingUtils');

// Mock all dependencies
jest.mock('fs', () => ({
  promises: {
    access: jest.fn().mockResolvedValue(),
    rename: jest.fn().mockResolvedValue(),
    mkdir: jest.fn().mockResolvedValue(),
    unlink: jest.fn().mockResolvedValue(),
    stat: jest.fn().mockResolvedValue({ size: 100 })
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
  return {
    createLogger: jest.fn(() => logger),
    logger: logger
  };
});

jest.mock('../src/main/ipc/files/batchLockManager', () => ({
  acquireBatchLock: jest.fn().mockResolvedValue(true),
  releaseBatchLock: jest.fn()
}));

jest.mock('../src/main/ipc/files/batchValidator', () => ({
  validateBatchOperation: jest.fn(() => null), // Returns null on success
  MAX_BATCH_SIZE: 1000
}));

jest.mock('../src/main/ipc/files/batchRollback', () => ({
  executeRollback: jest.fn().mockResolvedValue({ success: false, rolledBack: true })
}));

jest.mock('../src/main/ipc/files/batchProgressReporter', () => ({
  sendOperationProgress: jest.fn(),
  sendChunkedResults: jest.fn().mockResolvedValue({ sent: true })
}));

jest.mock('../src/shared/fileOperationTracker', () => ({
  getInstance: jest.fn(() => ({
    recordOperation: jest.fn()
  }))
}));

jest.mock('../src/main/ipc/files/embeddingSync', () => ({
  syncEmbeddingForMove: jest.fn(),
  removeEmbeddingsForPathBestEffort: jest.fn()
}));

jest.mock('../src/main/utils/fileDedup', () => ({
  computeFileChecksum: jest.fn().mockResolvedValue('checksum123'),
  handleDuplicateMove: jest.fn().mockResolvedValue(null) // Return null means no duplicate handled, proceed with move
}));

jest.mock('../src/shared/atomicFileOperations', () => ({
  crossDeviceMove: jest.fn()
}));

jest.mock('../src/shared/pathSanitization', () => ({
  validateFileOperationPath: jest.fn((p) => ({ valid: true, normalizedPath: p }))
}));

jest.mock('../src/shared/promiseUtils', () => ({
  withTimeout: jest.fn((promise) => promise),
  batchProcess: jest.fn().mockResolvedValue(),
  withAbortableTimeout: jest.fn((fn) => fn({ signal: {} }))
}));

jest.mock('../src/shared/correlationId', () => ({
  withCorrelationId: jest.fn((fn) => fn())
}));

// Mock semantic service (needed for rebuild check)
jest.mock('../src/main/ipc/semantic', () => ({
  getSearchServiceInstance: jest.fn(() => ({
    invalidateAndRebuild: jest.fn().mockResolvedValue()
  }))
}));

describe('Batch Organize Handler', () => {
  let params;
  let mockLogger;
  let fs;
  let batchLockManager;
  let fileDedup;

  beforeEach(() => {
    jest.clearAllMocks();

    fs = require('fs').promises;
    batchLockManager = require('../src/main/ipc/files/batchLockManager');
    fileDedup = require('../src/main/utils/fileDedup');
    mockLogger = require('../src/shared/logger').logger;

    // Fix fs.access mock to handle verifyMoveCompletion correctly
    // It verifies destination exists (resolve) and source is gone (reject ENOENT)
    fs.access.mockImplementation(async (p) => {
      if (p.includes('dest')) return;
      if (p.includes('src')) throw { code: 'ENOENT' };
      return;
    });

    params = {
      operation: {
        operations: [
          { source: '/src/doc1.pdf', destination: '/dest/doc1.pdf', type: 'move' },
          { source: '/src/doc2.pdf', destination: '/dest/doc2.pdf', type: 'move' }
        ]
      },
      logger: mockLogger,
      getServiceIntegration: jest.fn(() => ({
        processingState: {
          createOrLoadOrganizeBatch: jest.fn((id, ops) => ({ operations: ops })),
          markOrganizeOpStarted: jest.fn(),
          markOrganizeOpDone: jest.fn(),
          markOrganizeOpError: jest.fn(),
          completeOrganizeBatch: jest.fn()
        },
        undoRedo: {
          recordAction: jest.fn()
        }
      })),
      getMainWindow: jest.fn()
    };
  });

  test('successfully processes a batch of moves', async () => {
    const result = await handleBatchOrganize(params);

    expect(result.success).toBe(true);
    expect(result.successCount).toBe(2);
    expect(fs.rename).toHaveBeenCalledTimes(2);
    expect(batchLockManager.acquireBatchLock).toHaveBeenCalled();
    expect(batchLockManager.releaseBatchLock).toHaveBeenCalled();
  });

  test('handles duplicates by renaming (via performFileMove loop logic)', async () => {
    // Mock rename to fail with EEXIST once, then succeed
    fs.rename
      .mockRejectedValueOnce({ code: 'EEXIST' }) // First file rename fails
      .mockResolvedValueOnce() // First file retry succeeds (with suffix)
      .mockResolvedValueOnce(); // Second file succeeds immediately

    const result = await handleBatchOrganize(params);

    expect(result.success).toBe(true);
    // Find the result for the first file (doc1.pdf) which triggered the duplicate handling
    const doc1Result = result.results.find((r) => r.source === '/src/doc1.pdf');
    expect(doc1Result.destination).toMatch(/_\d+\.pdf$/); // Should have suffix
  });

  test('handles source file disappearing (ENOENT)', async () => {
    fs.rename.mockRejectedValueOnce({ code: 'ENOENT' }); // First file gone

    const result = await handleBatchOrganize(params);

    expect(result.success).toBe(true); // Partial success is still success: true with failure counts
    expect(result.failCount).toBe(1);
    expect(result.successCount).toBe(1);
    // Partial failure is indicated by failCount > 0, not necessarily a partialFailure flag in all return paths
  });

  test('triggers rollback on critical error', async () => {
    // We need one success and one critical failure to trigger rollback
    // Use a delay for the failure to ensure the first operation has time to complete/start
    // Since pLimit runs them concurrently, we want:
    // Op 1: Success (fast)
    // Op 2: Failure (delayed slightly so Op 1 might finish pushing to completedOperations,
    //       OR if Op 2 fails fast, we need to ensure Op 1 finishes.
    // Actually, if Op 2 fails immediately, it triggers abort.
    // Op 1 checks abort signal.
    // So we want Op 1 to finish BEFORE Op 2 fails.

    fs.rename
      .mockResolvedValueOnce() // First file succeeds immediately
      .mockImplementationOnce(
        () =>
          new Promise((_, reject) =>
            setTimeout(() => reject({ code: 'ENOSPC', message: 'Disk full' }), 50)
          )
      ); // Second file fails with critical non-retryable error

    const result = await handleBatchOrganize(params);

    // The handler calls executeRollback, which we mocked to return { success: false, rolledBack: true }
    // Actually handleBatchOrganize returns whatever executeRollback returns
    expect(result.rolledBack).toBe(true);
    // Actually handleBatchOrganize returns whatever executeRollback returns
    expect(result.rolledBack).toBe(true);

    const { executeRollback } = require('../src/main/ipc/files/batchRollback');
    expect(executeRollback).toHaveBeenCalled();
  });
});
