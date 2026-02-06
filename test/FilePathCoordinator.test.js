/**
 * Tests for FilePathCoordinator
 * Focus: atomicPathUpdate orchestration and error tolerance across systems.
 */

jest.mock('../src/shared/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    setContext: jest.fn()
  },
  createLogger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    setContext: jest.fn()
  })
}));

jest.mock('../src/shared/pathSanitization', () => ({
  normalizePathForIndex: (p) => String(p).replace(/\\/g, '/')
}));

jest.mock('../src/main/utils/fileIdUtils', () => ({
  getPathVariants: jest.fn((p) => [p, String(p).toLowerCase()])
}));

jest.mock('../src/shared/pathTraceLogger', () => ({
  traceCoordinatorStart: jest.fn(),
  traceCoordinatorComplete: jest.fn(),
  traceDbUpdate: jest.fn()
}));

const { FilePathCoordinator } = require('../src/main/services/FilePathCoordinator');

describe('FilePathCoordinator', () => {
  test('atomicPathUpdate updates all systems and emits path-changed', async () => {
    const vectorDbService = {
      updateFilePaths: jest.fn().mockResolvedValue(2)
    };
    const analysisHistoryService = {
      updateEntryPaths: jest.fn().mockResolvedValue(undefined)
    };
    const embeddingQueue = {
      updateByFilePath: jest.fn()
    };
    const processingStateService = {
      moveJob: jest.fn().mockResolvedValue(undefined)
    };
    const cacheInvalidationBus = {
      invalidateForPathChange: jest.fn()
    };

    const coordinator = new FilePathCoordinator({
      vectorDbService,
      analysisHistoryService,
      embeddingQueue,
      processingStateService,
      cacheInvalidationBus
    });

    const onChanged = jest.fn();
    coordinator.on('path-changed', onChanged);

    const res = await coordinator.atomicPathUpdate('C:\\Old\\A.pdf', 'C:\\New\\A-renamed.pdf', {
      type: 'move'
    });

    expect(res.success).toBe(true);
    expect(res.errors).toHaveLength(0);
    expect(res.updated).toEqual(
      expect.objectContaining({
        vectorDb: true,
        analysisHistory: true,
        embeddingQueue: true,
        processingState: true,
        cacheInvalidated: true
      })
    );

    expect(vectorDbService.updateFilePaths).toHaveBeenCalled();
    // includes both file: and image: id updates for variants
    expect(vectorDbService.updateFilePaths.mock.calls[0][0]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          oldId: expect.stringMatching(/^file:/),
          newId: 'file:C:/New/A-renamed.pdf'
        }),
        expect.objectContaining({
          oldId: expect.stringMatching(/^image:/),
          newId: 'image:C:/New/A-renamed.pdf'
        })
      ])
    );

    expect(analysisHistoryService.updateEntryPaths).toHaveBeenCalledWith([
      { oldPath: 'C:\\Old\\A.pdf', newPath: 'C:\\New\\A-renamed.pdf', newName: 'A-renamed.pdf' }
    ]);
    expect(embeddingQueue.updateByFilePath).toHaveBeenCalledWith(
      'C:\\Old\\A.pdf',
      'C:\\New\\A-renamed.pdf'
    );
    expect(processingStateService.moveJob).toHaveBeenCalledWith(
      'C:\\Old\\A.pdf',
      'C:\\New\\A-renamed.pdf'
    );
    expect(cacheInvalidationBus.invalidateForPathChange).toHaveBeenCalledWith(
      'C:\\Old\\A.pdf',
      'C:\\New\\A-renamed.pdf',
      'move'
    );
    expect(onChanged).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'move',
        oldPath: 'C:\\Old\\A.pdf',
        newPath: 'C:\\New\\A-renamed.pdf',
        updated: expect.any(Object),
        errors: []
      })
    );

    expect(coordinator._pendingOperations.size).toBe(0);
  });

  test('handleFileDeletion removes state across all systems', async () => {
    const vectorDbService = {
      batchDeleteFileEmbeddings: jest.fn().mockResolvedValue(undefined),
      deleteFileChunks: jest.fn().mockResolvedValue(true)
    };
    const analysisHistoryService = {
      removeEntriesByPath: jest.fn().mockResolvedValue(undefined)
    };
    const embeddingQueue = {
      removeByFilePath: jest.fn()
    };
    const processingStateService = {
      clearState: jest.fn().mockResolvedValue(undefined)
    };
    const cacheInvalidationBus = {
      invalidateForDeletion: jest.fn()
    };

    const coordinator = new FilePathCoordinator({
      vectorDbService,
      analysisHistoryService,
      embeddingQueue,
      processingStateService,
      cacheInvalidationBus
    });

    const onDeleted = jest.fn();
    coordinator.on('file-deleted', onDeleted);

    const res = await coordinator.handleFileDeletion('C:\\Old\\A.pdf');
    expect(res.success).toBe(true);
    expect(res.errors).toHaveLength(0);
    expect(res.cleaned).toEqual(
      expect.objectContaining({
        vectorDb: true,
        analysisHistory: true,
        embeddingQueue: true,
        processingState: true,
        cacheInvalidated: true
      })
    );

    expect(vectorDbService.batchDeleteFileEmbeddings).toHaveBeenCalled();
    expect(vectorDbService.deleteFileChunks).toHaveBeenCalled();
    expect(analysisHistoryService.removeEntriesByPath).toHaveBeenCalledWith('C:\\Old\\A.pdf');
    expect(embeddingQueue.removeByFilePath).toHaveBeenCalledWith('C:\\Old\\A.pdf');
    expect(processingStateService.clearState).toHaveBeenCalledWith('C:\\Old\\A.pdf');
    expect(cacheInvalidationBus.invalidateForDeletion).toHaveBeenCalledWith('C:\\Old\\A.pdf');
    expect(onDeleted).toHaveBeenCalledWith(
      expect.objectContaining({
        path: 'C:\\Old\\A.pdf',
        cleaned: expect.any(Object),
        errors: []
      })
    );
  });

  test('handleFileCopy clones embeddings/history and invalidates caches', async () => {
    const vectorDbService = {
      cloneFileEmbedding: jest.fn().mockResolvedValue(undefined),
      cloneFileChunks: jest.fn().mockResolvedValue(undefined)
    };
    const analysisHistoryService = {
      cloneEntryForCopy: jest.fn().mockResolvedValue(undefined)
    };
    const cacheInvalidationBus = {
      invalidateForPathChange: jest.fn()
    };

    const coordinator = new FilePathCoordinator({
      vectorDbService,
      analysisHistoryService,
      cacheInvalidationBus
    });

    const onCopied = jest.fn();
    coordinator.on('file-copied', onCopied);

    const res = await coordinator.handleFileCopy('C:\\Old\\A.pdf', 'C:\\New\\A.pdf');
    expect(res.success).toBe(true);
    expect(res.errors).toHaveLength(0);
    expect(res.cloned).toEqual(
      expect.objectContaining({ vectorDb: true, analysisHistory: true, cacheInvalidated: true })
    );

    expect(vectorDbService.cloneFileEmbedding).toHaveBeenCalled();
    expect(vectorDbService.cloneFileChunks).toHaveBeenCalled();
    expect(analysisHistoryService.cloneEntryForCopy).toHaveBeenCalledWith(
      'C:\\Old\\A.pdf',
      'C:\\New\\A.pdf'
    );
    expect(cacheInvalidationBus.invalidateForPathChange).toHaveBeenCalledWith(
      'C:\\Old\\A.pdf',
      'C:\\New\\A.pdf',
      'copy'
    );
    expect(onCopied).toHaveBeenCalledWith(
      expect.objectContaining({
        sourcePath: 'C:\\Old\\A.pdf',
        destPath: 'C:\\New\\A.pdf',
        cloned: expect.any(Object),
        errors: []
      })
    );
  });

  test('atomicPathUpdate records errors when services are unavailable', async () => {
    const analysisHistoryService = {
      updateEntryPaths: jest.fn().mockResolvedValue(undefined)
    };

    const coordinator = new FilePathCoordinator({
      vectorDbService: null,
      analysisHistoryService,
      embeddingQueue: null,
      processingStateService: null,
      cacheInvalidationBus: null
    });

    const res = await coordinator.atomicPathUpdate('C:\\Old\\A.pdf', 'C:\\New\\A.pdf', {
      type: 'move'
    });

    expect(res.success).toBe(false);
    expect(res.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ system: 'vectorDb' }),
        expect.objectContaining({ system: 'embeddingQueue' }),
        expect.objectContaining({ system: 'processingState' }),
        expect.objectContaining({ system: 'cacheInvalidation' })
      ])
    );
    expect(res.updated.analysisHistory).toBe(true);
    expect(coordinator._pendingOperations.size).toBe(0);
  });

  test('atomicPathUpdate continues when one system throws', async () => {
    const vectorDbService = {
      updateFilePaths: jest.fn().mockRejectedValue(new Error('db down'))
    };
    const analysisHistoryService = {
      updateEntryPaths: jest.fn().mockResolvedValue(undefined)
    };
    const cacheInvalidationBus = {
      invalidateForPathChange: jest.fn()
    };

    const coordinator = new FilePathCoordinator({
      vectorDbService,
      analysisHistoryService,
      embeddingQueue: { updateByFilePath: jest.fn() },
      processingStateService: { moveJob: jest.fn().mockResolvedValue(undefined) },
      cacheInvalidationBus
    });

    const res = await coordinator.atomicPathUpdate('C:\\Old\\A.pdf', 'C:\\New\\A.pdf', {
      type: 'move'
    });

    expect(res.success).toBe(false);
    expect(res.errors).toEqual([expect.objectContaining({ system: 'vectorDb', error: 'db down' })]);
    expect(res.updated.analysisHistory).toBe(true);
    expect(cacheInvalidationBus.invalidateForPathChange).toHaveBeenCalled();
    expect(coordinator._pendingOperations.size).toBe(0);
  });
});
