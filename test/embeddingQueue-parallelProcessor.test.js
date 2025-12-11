/**
 * Tests for Embedding Queue Parallel Processor
 * Tests semaphore-based parallel processing for embeddings
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

describe('Embedding Queue Parallel Processor', () => {
  let processItemsInParallel;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();

    const module = require('../src/main/analysis/embeddingQueue/parallelProcessor');
    processItemsInParallel = module.processItemsInParallel;
  });

  describe('processItemsInParallel', () => {
    test('uses batch upsert when available', async () => {
      const chromaDbService = {
        batchUpsertFiles: jest.fn().mockResolvedValue(undefined)
      };
      const items = [
        { id: 'item1', vector: [1, 2, 3] },
        { id: 'item2', vector: [4, 5, 6] }
      ];
      const onProgress = jest.fn();

      const count = await processItemsInParallel({
        items,
        type: 'file',
        chromaDbService,
        failedItemIds: new Set(),
        startProcessedCount: 0,
        totalBatchSize: 2,
        concurrency: 2,
        onProgress,
        onItemFailed: jest.fn()
      });

      expect(chromaDbService.batchUpsertFiles).toHaveBeenCalledWith(items);
      expect(count).toBe(2);
      expect(onProgress).toHaveBeenCalledWith(
        expect.objectContaining({
          phase: 'processing',
          completed: 2
        })
      );
    });

    test('uses batch upsert for folders with formatting', async () => {
      const chromaDbService = {
        batchUpsertFolders: jest.fn().mockResolvedValue(undefined)
      };
      const items = [
        {
          id: 'folder:1',
          vector: [1, 2, 3],
          meta: { name: 'Folder1', path: '/path/1' },
          model: 'model1',
          updatedAt: Date.now()
        }
      ];
      const onProgress = jest.fn();

      await processItemsInParallel({
        items,
        type: 'folder',
        chromaDbService,
        failedItemIds: new Set(),
        startProcessedCount: 0,
        totalBatchSize: 1,
        concurrency: 2,
        onProgress,
        onItemFailed: jest.fn()
      });

      expect(chromaDbService.batchUpsertFolders).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            id: 'folder:1',
            name: 'Folder1'
          })
        ])
      );
    });

    test('falls back to parallel individual on batch error', async () => {
      const chromaDbService = {
        batchUpsertFiles: jest.fn().mockRejectedValue(new Error('Batch failed')),
        upsertFile: jest.fn().mockResolvedValue(undefined)
      };
      const items = [
        { id: 'item1', vector: [1, 2, 3], meta: { name: 'file1' } },
        { id: 'item2', vector: [4, 5, 6], meta: { name: 'file2' } }
      ];
      const onProgress = jest.fn();

      const count = await processItemsInParallel({
        items,
        type: 'file',
        chromaDbService,
        failedItemIds: new Set(),
        startProcessedCount: 0,
        totalBatchSize: 2,
        concurrency: 2,
        onProgress,
        onItemFailed: jest.fn()
      });

      expect(chromaDbService.upsertFile).toHaveBeenCalledTimes(2);
      expect(count).toBe(2);
    });

    test('respects concurrency limit', async () => {
      let concurrent = 0;
      let maxConcurrent = 0;

      const chromaDbService = {
        upsertFile: jest.fn().mockImplementation(async () => {
          concurrent++;
          maxConcurrent = Math.max(maxConcurrent, concurrent);
          await new Promise((r) => setTimeout(r, 10));
          concurrent--;
        })
      };

      const items = Array.from({ length: 5 }, (_, i) => ({
        id: `item${i}`,
        vector: [i],
        meta: { name: `file${i}` }
      }));

      await processItemsInParallel({
        items,
        type: 'file',
        chromaDbService,
        failedItemIds: new Set(),
        startProcessedCount: 0,
        totalBatchSize: 5,
        concurrency: 2,
        onProgress: jest.fn(),
        onItemFailed: jest.fn()
      });

      expect(maxConcurrent).toBeLessThanOrEqual(2);
    });

    test('tracks failed items', async () => {
      const chromaDbService = {
        upsertFile: jest
          .fn()
          .mockResolvedValueOnce(undefined)
          .mockRejectedValueOnce(new Error('Failed'))
      };

      const items = [
        { id: 'item1', vector: [1], meta: {} },
        { id: 'item2', vector: [2], meta: {} }
      ];
      const failedItemIds = new Set();
      const onItemFailed = jest.fn();

      await processItemsInParallel({
        items,
        type: 'file',
        chromaDbService,
        failedItemIds,
        startProcessedCount: 0,
        totalBatchSize: 2,
        concurrency: 1,
        onProgress: jest.fn(),
        onItemFailed
      });

      expect(failedItemIds.has('item2')).toBe(true);
      expect(onItemFailed).toHaveBeenCalledWith(expect.objectContaining({ id: 'item2' }), 'Failed');
    });

    test('reports progress for each item', async () => {
      const chromaDbService = {
        upsertFile: jest.fn().mockResolvedValue(undefined)
      };

      const items = [
        { id: 'item1', vector: [1], meta: {} },
        { id: 'item2', vector: [2], meta: {} }
      ];
      const onProgress = jest.fn();

      await processItemsInParallel({
        items,
        type: 'file',
        chromaDbService,
        failedItemIds: new Set(),
        startProcessedCount: 0,
        totalBatchSize: 2,
        concurrency: 1,
        onProgress,
        onItemFailed: jest.fn()
      });

      expect(onProgress).toHaveBeenCalledTimes(2);
      expect(onProgress).toHaveBeenCalledWith(
        expect.objectContaining({
          completed: 1,
          currentItem: 'item1'
        })
      );
      expect(onProgress).toHaveBeenCalledWith(
        expect.objectContaining({
          completed: 2,
          currentItem: 'item2'
        })
      );
    });

    test('calculates correct percentage', async () => {
      const chromaDbService = {
        batchUpsertFiles: jest.fn().mockResolvedValue(undefined)
      };

      const items = [{ id: 'item1', vector: [1] }];
      const onProgress = jest.fn();

      await processItemsInParallel({
        items,
        type: 'file',
        chromaDbService,
        failedItemIds: new Set(),
        startProcessedCount: 1,
        totalBatchSize: 4,
        concurrency: 1,
        onProgress,
        onItemFailed: jest.fn()
      });

      expect(onProgress).toHaveBeenCalledWith(
        expect.objectContaining({
          percent: 50 // 2/4 = 50%
        })
      );
    });

    test('handles zero total batch size', async () => {
      const chromaDbService = {
        batchUpsertFiles: jest.fn().mockResolvedValue(undefined)
      };

      const items = [{ id: 'item1', vector: [1] }];
      const onProgress = jest.fn();

      await processItemsInParallel({
        items,
        type: 'file',
        chromaDbService,
        failedItemIds: new Set(),
        startProcessedCount: 0,
        totalBatchSize: 0,
        concurrency: 1,
        onProgress,
        onItemFailed: jest.fn()
      });

      expect(onProgress).toHaveBeenCalledWith(
        expect.objectContaining({
          percent: 0
        })
      );
    });

    test('formats folder payloads correctly', async () => {
      const chromaDbService = {
        upsertFolder: jest.fn().mockResolvedValue(undefined)
      };

      const items = [
        {
          id: 'folder:1',
          vector: [1, 2, 3],
          meta: { name: 'TestFolder', path: '/test/path' },
          model: 'test-model',
          updatedAt: 12345
        }
      ];

      await processItemsInParallel({
        items,
        type: 'folder',
        chromaDbService,
        failedItemIds: new Set(),
        startProcessedCount: 0,
        totalBatchSize: 1,
        concurrency: 1,
        onProgress: jest.fn(),
        onItemFailed: jest.fn()
      });

      expect(chromaDbService.upsertFolder).toHaveBeenCalledWith({
        id: 'folder:1',
        vector: [1, 2, 3],
        name: 'TestFolder',
        path: '/test/path',
        model: 'test-model',
        updatedAt: 12345
      });
    });

    test('uses id as name if meta.name is missing', async () => {
      const chromaDbService = {
        upsertFolder: jest.fn().mockResolvedValue(undefined)
      };

      const items = [
        {
          id: 'folder:1',
          vector: [1, 2, 3],
          meta: {},
          model: 'test-model'
        }
      ];

      await processItemsInParallel({
        items,
        type: 'folder',
        chromaDbService,
        failedItemIds: new Set(),
        startProcessedCount: 0,
        totalBatchSize: 1,
        concurrency: 1,
        onProgress: jest.fn(),
        onItemFailed: jest.fn()
      });

      expect(chromaDbService.upsertFolder).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'folder:1'
        })
      );
    });

    test('returns updated processed count', async () => {
      const chromaDbService = {
        batchUpsertFiles: jest.fn().mockResolvedValue(undefined)
      };

      const items = [
        { id: 'item1', vector: [1] },
        { id: 'item2', vector: [2] },
        { id: 'item3', vector: [3] }
      ];

      const count = await processItemsInParallel({
        items,
        type: 'file',
        chromaDbService,
        failedItemIds: new Set(),
        startProcessedCount: 5,
        totalBatchSize: 10,
        concurrency: 2,
        onProgress: jest.fn(),
        onItemFailed: jest.fn()
      });

      expect(count).toBe(8); // 5 + 3
    });
  });
});
