/**
 * Tests for IPC embedding sync helpers used during file moves/copies/deletes.
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

jest.mock('../src/shared/fileIdUtils', () => ({
  getSemanticFileId: jest.fn((p) => `file:${p}`),
  isImagePath: jest.fn(() => false)
}));

jest.mock('../src/main/utils/fileIdUtils', () => ({
  getPathVariants: jest.fn((p) => [p])
}));

jest.mock('../src/main/analysis/embeddingSummary', () => ({
  buildEmbeddingSummary: jest.fn(() => ({
    text: 'summary',
    wasTruncated: false,
    estimatedTokens: 10
  }))
}));

jest.mock('../src/shared/folderUtils', () => ({
  findContainingSmartFolder: jest.fn()
}));

jest.mock('../src/main/analysis/embeddingQueue/stageQueues', () => ({
  organizeQueue: {
    enqueue: jest.fn().mockResolvedValue(undefined)
  }
}));

jest.mock('../src/main/analysis/embeddingQueue/queueManager', () => ({
  removeByFilePath: jest.fn(() => 0)
}));

jest.mock('../src/main/services/embedding/embeddingGate', () => ({
  shouldEmbed: jest.fn().mockResolvedValue({ shouldEmbed: true, timing: 'ok', policy: 'ok' })
}));

describe('embeddingSync', () => {
  function loadModuleWithServices(services) {
    jest.resetModules();

    const serviceIds = {
      ORAMA_VECTOR: 'ORAMA_VECTOR',
      ANALYSIS_HISTORY: 'ANALYSIS_HISTORY',
      FOLDER_MATCHING: 'FOLDER_MATCHING',
      LEARNING_FEEDBACK: 'LEARNING_FEEDBACK'
    };

    jest.doMock('../src/main/services/ServiceContainer', () => ({
      ServiceIds: serviceIds,
      container: {
        tryResolve: jest.fn((id) => services[id] || null)
      }
    }));

    return require('../src/main/ipc/files/embeddingSync');
  }

  test('removeEmbeddingsForPath returns queue-only removal when vector DB unavailable', async () => {
    const mod = loadModuleWithServices({
      ORAMA_VECTOR: null
    });

    const embeddingQueueManager = require('../src/main/analysis/embeddingQueue/queueManager');
    embeddingQueueManager.removeByFilePath.mockReturnValueOnce(2);

    const res = await mod.removeEmbeddingsForPath('C:\\a.pdf', { vectorDbService: null });
    expect(res).toEqual({ removed: 2, error: 'service_unavailable' });
  });

  test('removeEmbeddingsForPath uses batchDeleteFileEmbeddings and deletes chunks', async () => {
    const vectorDbService = {
      batchDeleteFileEmbeddings: jest.fn().mockResolvedValue({ success: true }),
      deleteFileChunks: jest.fn().mockResolvedValue(true)
    };

    const mod = loadModuleWithServices({
      ORAMA_VECTOR: vectorDbService
    });

    const { getPathVariants } = require('../src/main/utils/fileIdUtils');
    getPathVariants.mockReturnValueOnce(['C:\\a.pdf', 'c:\\a.pdf']);

    const res = await mod.removeEmbeddingsForPath('C:\\a.pdf', { vectorDbService });

    // 2 variants -> 4 ids, removed count equals ids length (batch success)
    expect(vectorDbService.batchDeleteFileEmbeddings).toHaveBeenCalledWith(
      expect.arrayContaining([
        'file:C:\\a.pdf',
        'image:C:\\a.pdf',
        'file:c:\\a.pdf',
        'image:c:\\a.pdf'
      ])
    );
    expect(vectorDbService.deleteFileChunks).toHaveBeenCalledTimes(4);
    expect(res.removed).toBe(4);
  });

  test('syncEmbeddingForMove removes embeddings when destination is not in a smart folder', async () => {
    const analysisHistoryService = {
      updateEmbeddingStateByPath: jest.fn().mockResolvedValue(undefined)
    };

    const vectorDbService = {
      batchDeleteFileEmbeddings: jest.fn().mockResolvedValue({ success: true }),
      deleteFileChunks: jest.fn().mockResolvedValue(true)
    };

    const mod = loadModuleWithServices({
      ORAMA_VECTOR: vectorDbService,
      ANALYSIS_HISTORY: analysisHistoryService,
      LEARNING_FEEDBACK: { getSmartFolders: jest.fn(() => []) }
    });

    const { findContainingSmartFolder } = require('../src/shared/folderUtils');
    findContainingSmartFolder.mockReturnValueOnce(null);

    const res = await mod.syncEmbeddingForMove({
      sourcePath: 'C:\\src\\a.pdf',
      destPath: 'C:\\dst\\a.pdf',
      operation: 'move'
    });

    expect(res).toEqual({ action: 'removed', reason: 'not-smart-folder' });
    // dest + source removed (move)
    expect(vectorDbService.batchDeleteFileEmbeddings).toHaveBeenCalledTimes(2);
    expect(analysisHistoryService.updateEmbeddingStateByPath).toHaveBeenCalledWith(
      'C:\\dst\\a.pdf',
      {
        status: 'skipped'
      }
    );
  });

  test('syncEmbeddingForMove updates metadata in-place via vectorDb.updateFilePaths when available', async () => {
    const analysisHistoryService = {
      getAnalysisByPath: jest.fn().mockResolvedValue({
        fileSize: 123,
        analysis: { extractedText: 'hello', category: 'Documents', confidence: 0.9 }
      }),
      updateEmbeddingStateByPath: jest.fn().mockResolvedValue(undefined)
    };

    const vectorDbService = {
      initialize: jest.fn().mockResolvedValue(undefined),
      isOnline: true,
      updateFilePaths: jest.fn().mockResolvedValue(1),
      batchDeleteFileEmbeddings: jest.fn().mockResolvedValue({ success: true }),
      deleteFileChunks: jest.fn().mockResolvedValue(true)
    };

    const mod = loadModuleWithServices({
      ORAMA_VECTOR: vectorDbService,
      ANALYSIS_HISTORY: analysisHistoryService,
      LEARNING_FEEDBACK: {
        getSmartFolders: jest.fn(() => [{ name: 'Financial', path: 'C:\\Sorted\\Financial' }])
      }
    });

    const { findContainingSmartFolder } = require('../src/shared/folderUtils');
    findContainingSmartFolder.mockReturnValueOnce({
      name: 'Financial',
      path: 'C:\\Sorted\\Financial'
    });

    const res = await mod.syncEmbeddingForMove({
      sourcePath: 'C:\\src\\a.pdf',
      destPath: 'C:\\Sorted\\Financial\\a.pdf',
      operation: 'move'
    });

    expect(res).toEqual({ action: 'updated_meta', smartFolder: 'Financial' });
    expect(vectorDbService.updateFilePaths).toHaveBeenCalledWith([
      expect.objectContaining({
        oldId: 'file:C:\\src\\a.pdf',
        newId: 'file:C:\\Sorted\\Financial\\a.pdf',
        newMeta: expect.objectContaining({
          path: 'C:\\Sorted\\Financial\\a.pdf',
          smartFolder: 'Financial',
          category: 'Financial'
        })
      })
    ]);
    expect(analysisHistoryService.updateEmbeddingStateByPath).toHaveBeenCalledWith(
      'C:\\Sorted\\Financial\\a.pdf',
      { status: 'done' }
    );
    // remove source embeddings after successful meta update (move only)
    expect(vectorDbService.batchDeleteFileEmbeddings).toHaveBeenCalled();
  });

  test('syncEmbeddingForMove enqueues embedding when metadata-only update is unavailable', async () => {
    const analysisHistoryService = {
      getAnalysisByPath: jest.fn().mockResolvedValue({
        fileSize: 123,
        analysis: { extractedText: 'hello', category: 'Documents', confidence: 0.9 }
      }),
      updateEmbeddingStateByPath: jest.fn().mockResolvedValue(undefined)
    };

    const folderMatchingService = {
      embedText: jest.fn().mockResolvedValue({ vector: [1, 2, 3], model: 'embed-model' })
    };

    const vectorDbService = {
      initialize: jest.fn().mockResolvedValue(undefined),
      isOnline: true,
      updateFilePaths: jest.fn().mockResolvedValue(0),
      batchDeleteFileEmbeddings: jest.fn().mockResolvedValue({ success: true }),
      deleteFileChunks: jest.fn().mockResolvedValue(true)
    };

    const mod = loadModuleWithServices({
      ORAMA_VECTOR: vectorDbService,
      ANALYSIS_HISTORY: analysisHistoryService,
      FOLDER_MATCHING: folderMatchingService,
      LEARNING_FEEDBACK: {
        getSmartFolders: jest.fn(() => [{ name: 'Financial', path: 'C:\\Sorted\\Financial' }])
      }
    });

    const { organizeQueue } = require('../src/main/analysis/embeddingQueue/stageQueues');
    const { findContainingSmartFolder } = require('../src/shared/folderUtils');
    findContainingSmartFolder.mockReturnValueOnce({
      name: 'Financial',
      path: 'C:\\Sorted\\Financial'
    });

    const res = await mod.syncEmbeddingForMove({
      sourcePath: 'C:\\src\\a.pdf',
      destPath: 'C:\\Sorted\\Financial\\a.pdf',
      operation: 'move'
    });

    expect(res).toEqual({ action: 'enqueued', smartFolder: 'Financial' });
    expect(folderMatchingService.embedText).toHaveBeenCalledWith('summary');
    expect(organizeQueue.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'file:C:\\Sorted\\Financial\\a.pdf',
        vector: [1, 2, 3],
        model: 'embed-model',
        meta: expect.objectContaining({
          smartFolder: 'Financial',
          category: 'Financial'
        })
      })
    );
    expect(analysisHistoryService.updateEmbeddingStateByPath).toHaveBeenCalledWith(
      'C:\\Sorted\\Financial\\a.pdf',
      { status: 'pending', model: 'embed-model' }
    );
  });
});
