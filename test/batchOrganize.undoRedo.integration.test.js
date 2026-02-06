/**
 * @jest-environment node
 */
/**
 * Integration test: batch organize -> UndoRedoService records -> undo restores originals.
 *
 * Uses the real batch handler, real UndoRedoService, and the in-memory fs from test-setup.
 */
const fs = require('fs').promises;

jest.mock('../src/shared/pathSanitization', () => ({
  ...jest.requireActual('../src/shared/pathSanitization'),
  validateFileOperationPath: jest.fn(async (p) => ({
    valid: true,
    normalizedPath: p,
    error: null
  }))
}));

jest.mock('../src/shared/fileOperationTracker', () => ({
  getInstance: () => ({
    recordOperation: jest.fn()
  })
}));

jest.mock('../src/main/ipc/files/embeddingSync', () => ({
  syncEmbeddingForMove: jest.fn().mockResolvedValue(undefined),
  removeEmbeddingsForPathBestEffort: jest.fn().mockResolvedValue(undefined)
}));

jest.mock('../src/main/ipc/files/batchProgressReporter', () => ({
  sendOperationProgress: jest.fn(),
  sendChunkedResults: jest.fn()
}));

jest.mock('../src/main/ipc/semantic', () => {
  const searchService = {
    invalidateAndRebuild: jest.fn().mockResolvedValue(undefined)
  };
  return {
    getSearchServiceInstance: jest.fn(() => searchService),
    __searchService: searchService
  };
});

describe('batch organize -> undo/redo (integration)', () => {
  test('records BATCH_OPERATION and undo restores files', async () => {
    const { handleBatchOrganize } = require('../src/main/ipc/files/batchOrganizeHandler');
    const UndoRedoService = require('../src/main/services/UndoRedoService');

    // Setup file system state
    await fs.mkdir('/tmp/batch/src', { recursive: true });
    await fs.writeFile('/tmp/batch/src/a.txt', 'A');
    await fs.writeFile('/tmp/batch/src/b.txt', 'B');

    const undoRedo = new UndoRedoService({ maxActions: 20, maxBatchSize: 100 });
    const recordSpy = jest.spyOn(undoRedo, 'recordAction');

    const processingState = {
      createOrLoadOrganizeBatch: jest.fn(async (_batchId, operations) => ({
        operations: operations.map((op) => ({ ...op, status: 'pending' }))
      })),
      markOrganizeOpStarted: jest.fn(async () => {}),
      markOrganizeOpDone: jest.fn(async () => {}),
      markOrganizeOpError: jest.fn(async () => {})
    };

    const getServiceIntegration = jest.fn(() => ({
      undoRedo,
      processingState
    }));

    const operation = {
      type: 'batch_organize',
      operations: [
        { source: '/tmp/batch/src/a.txt', destination: '/tmp/batch/dst/a.txt' },
        { source: '/tmp/batch/src/b.txt', destination: '/tmp/batch/dst/b.txt' }
      ]
    };

    const handlerLogger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    const result = await handleBatchOrganize({
      operation,
      logger: handlerLogger,
      getServiceIntegration,
      getMainWindow: () => null
    });

    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
    expect(result.successCount).toBe(2);
    expect(Array.isArray(result.results)).toBe(true);
    expect(result.results).toHaveLength(2);
    expect(result.results.every((r) => r && r.success === true && !r.skipped)).toBe(true);
    expect(result.results[0]).toEqual(
      expect.objectContaining({
        source: expect.any(String),
        destination: expect.any(String)
      })
    );
    expect(getServiceIntegration).toHaveBeenCalled();

    // Batch handler should have moved the files
    await expect(fs.readFile('/tmp/batch/dst/a.txt', 'utf8')).resolves.toBe('A');
    await expect(fs.readFile('/tmp/batch/dst/b.txt', 'utf8')).resolves.toBe('B');
    await expect(fs.readFile('/tmp/batch/src/a.txt', 'utf8')).rejects.toBeTruthy();

    // Undo history should contain a recorded batch action
    expect(handlerLogger.warn).not.toHaveBeenCalledWith(
      expect.stringContaining('Failed to record batch undo action'),
      expect.anything()
    );
    expect(recordSpy).toHaveBeenCalled();
    expect(undoRedo.actions.length).toBeGreaterThan(0);
    expect(undoRedo.canUndo()).toBe(true);

    // Search index should be rebuilt for immediate consistency
    const semantic = require('../src/main/ipc/semantic');
    expect(semantic.__searchService.invalidateAndRebuild).toHaveBeenCalledWith(
      expect.objectContaining({
        immediate: true,
        reason: 'batch-organize'
      })
    );

    // Undo should move them back
    const undoResult = await undoRedo.undo();
    expect(undoResult.success).toBe(true);

    await expect(fs.readFile('/tmp/batch/src/a.txt', 'utf8')).resolves.toBe('A');
    await expect(fs.readFile('/tmp/batch/src/b.txt', 'utf8')).resolves.toBe('B');
    await expect(fs.readFile('/tmp/batch/dst/a.txt', 'utf8')).rejects.toBeTruthy();
  });
});
