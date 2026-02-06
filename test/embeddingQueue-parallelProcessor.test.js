/**
 * Tests for embeddingQueue/parallelProcessor
 * Focus: batch success/failure handling and individual fallback behavior.
 */

jest.mock('../src/shared/logger', () => ({
  logger: {
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    info: jest.fn()
  }
}));

jest.mock('../src/shared/promiseUtils', () => ({
  withTimeout: jest.fn((p) => p)
}));

jest.mock('../src/shared/performanceConstants', () => ({
  TIMEOUTS: {
    EMBEDDING_REQUEST: 1000,
    BATCH_EMBEDDING_MAX: 1000
  }
}));

const { processItemsInParallel } = require('../src/main/analysis/embeddingQueue/parallelProcessor');

describe('embeddingQueue parallelProcessor', () => {
  test('uses batchUpsertFiles when available and reports progress once', async () => {
    const vectorDbService = {
      batchUpsertFiles: jest.fn().mockResolvedValue({ success: true })
    };
    const onProgress = jest.fn();
    const onItemFailed = jest.fn();
    const failedItemIds = new Set();

    const items = [
      { id: 'file:a', vector: [1, 2, 3], meta: { path: 'a' } },
      { id: 'file:b', vector: [1, 2, 3], meta: { path: 'b' } }
    ];

    const processed = await processItemsInParallel({
      items,
      type: 'file',
      vectorDbService,
      failedItemIds,
      startProcessedCount: 0,
      totalBatchSize: 2,
      concurrency: 2,
      onProgress,
      onItemFailed
    });

    expect(vectorDbService.batchUpsertFiles).toHaveBeenCalledWith(items);
    expect(processed).toBe(2);
    expect(onProgress).toHaveBeenCalledWith(
      expect.objectContaining({
        phase: 'processing',
        completed: 2,
        total: 2,
        percent: 100,
        itemType: 'file'
      })
    );
    expect(onItemFailed).not.toHaveBeenCalled();
    expect(Array.from(failedItemIds)).toEqual([]);
  });

  test('treats batchUpsertFiles success:false as failure and falls back to individual upserts', async () => {
    const vectorDbService = {
      batchUpsertFiles: jest
        .fn()
        .mockResolvedValue({ success: false, error: 'dimension_mismatch' }),
      upsertFile: jest.fn().mockResolvedValue({ success: true })
    };
    const onProgress = jest.fn();
    const onItemFailed = jest.fn();
    const failedItemIds = new Set();

    const items = [
      { id: 'file:a', vector: [1, 2, 3], meta: { path: 'a' } },
      { id: 'file:b', vector: [1, 2, 3], meta: { path: 'b' } }
    ];

    const processed = await processItemsInParallel({
      items,
      type: 'file',
      vectorDbService,
      failedItemIds,
      startProcessedCount: 0,
      totalBatchSize: 2,
      concurrency: 2,
      onProgress,
      onItemFailed
    });

    expect(vectorDbService.batchUpsertFiles).toHaveBeenCalled();
    expect(vectorDbService.upsertFile).toHaveBeenCalledTimes(2);
    expect(processed).toBe(2);
    expect(onItemFailed).not.toHaveBeenCalled();
  });

  test('marks failed items when individual upsert returns success:false', async () => {
    const vectorDbService = {
      upsertFile: jest.fn().mockResolvedValueOnce({ success: false, error: 'bad_vector' })
    };
    const onProgress = jest.fn();
    const onItemFailed = jest.fn();
    const failedItemIds = new Set();

    const items = [{ id: 'file:a', vector: [1, 2, 3], meta: { path: 'a' } }];

    const processed = await processItemsInParallel({
      items,
      type: 'file',
      vectorDbService,
      failedItemIds,
      startProcessedCount: 0,
      totalBatchSize: 1,
      concurrency: 1,
      onProgress,
      onItemFailed
    });

    expect(processed).toBe(0);
    expect(failedItemIds.has('file:a')).toBe(true);
    expect(onItemFailed).toHaveBeenCalledWith(items[0], expect.stringContaining('bad_vector'));
  });

  test('formats folder payloads for batchUpsertFolders', async () => {
    const vectorDbService = {
      batchUpsertFolders: jest.fn().mockResolvedValue({ success: true })
    };
    const onProgress = jest.fn();
    const onItemFailed = jest.fn();
    const failedItemIds = new Set();

    const items = [
      {
        id: 'folder:one',
        vector: [1],
        meta: { name: 'One', path: 'C:\\One' },
        model: 'm',
        updatedAt: 't'
      }
    ];

    const processed = await processItemsInParallel({
      items,
      type: 'folder',
      vectorDbService,
      failedItemIds,
      startProcessedCount: 0,
      totalBatchSize: 1,
      concurrency: 1,
      onProgress,
      onItemFailed
    });

    expect(vectorDbService.batchUpsertFolders).toHaveBeenCalledWith([
      expect.objectContaining({
        id: 'folder:one',
        vector: [1],
        name: 'One',
        path: 'C:\\One',
        model: 'm',
        updatedAt: 't'
      })
    ]);
    expect(processed).toBe(1);
    expect(onItemFailed).not.toHaveBeenCalled();
  });
});
