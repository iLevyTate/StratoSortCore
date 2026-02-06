jest.mock('../src/shared/logger', () => ({
  createLogger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
  })
}));

jest.mock('../src/main/services/SmartFolderWatcher', () => {
  return function MockSmartFolderWatcher() {};
});

const mockContainer = {
  resolve: jest.fn(),
  tryResolve: jest.fn(),
  has: jest.fn(),
  registerSingleton: jest.fn(),
  shutdown: jest.fn()
};

const mockServiceIds = {
  ANALYSIS_HISTORY: 'ANALYSIS_HISTORY',
  UNDO_REDO: 'UNDO_REDO',
  PROCESSING_STATE: 'PROCESSING_STATE',
  RELATIONSHIP_INDEX: 'RELATIONSHIP_INDEX',
  ORAMA_VECTOR: 'ORAMA_VECTOR',
  FOLDER_MATCHING: 'FOLDER_MATCHING',
  SETTINGS: 'SETTINGS',
  ORGANIZATION_SUGGESTION: 'ORGANIZATION_SUGGESTION',
  AUTO_ORGANIZE: 'AUTO_ORGANIZE',
  SMART_FOLDER_WATCHER: 'SMART_FOLDER_WATCHER',
  DOWNLOAD_WATCHER: 'DOWNLOAD_WATCHER',
  LEARNING_FEEDBACK: 'LEARNING_FEEDBACK'
};

const mockShutdownOrder = ['AUTO_ORGANIZE', 'ORAMA_VECTOR', 'ANALYSIS_HISTORY'];

jest.mock('../src/main/services/ServiceContainer', () => ({
  container: mockContainer,
  ServiceIds: mockServiceIds,
  SHUTDOWN_ORDER: mockShutdownOrder
}));

const ServiceIntegration = require('../src/main/services/ServiceIntegration');

describe('ServiceIntegration', () => {
  let service;
  let analysisHistory;
  let undoRedo;
  let processingState;
  let vectorService;
  let folderMatching;

  beforeEach(() => {
    mockContainer.resolve.mockReset();
    mockContainer.shutdown.mockReset();

    analysisHistory = {
      initialize: jest.fn().mockResolvedValue(),
      setOnEntriesRemovedCallback: jest.fn()
    };
    undoRedo = { initialize: jest.fn().mockResolvedValue() };
    processingState = { initialize: jest.fn().mockResolvedValue() };
    vectorService = { initialize: jest.fn().mockResolvedValue() };
    folderMatching = { initialize: jest.fn().mockResolvedValue() };

    mockContainer.resolve.mockImplementation((id) => {
      switch (id) {
        case mockServiceIds.ANALYSIS_HISTORY:
          return analysisHistory;
        case mockServiceIds.UNDO_REDO:
          return undoRedo;
        case mockServiceIds.PROCESSING_STATE:
          return processingState;
        case mockServiceIds.RELATIONSHIP_INDEX:
          return {};
        case mockServiceIds.ORAMA_VECTOR:
          return vectorService;
        case mockServiceIds.FOLDER_MATCHING:
          return folderMatching;
        case mockServiceIds.SETTINGS:
          return { getAll: jest.fn(() => ({})) };
        case mockServiceIds.ORGANIZATION_SUGGESTION:
          return {};
        case mockServiceIds.AUTO_ORGANIZE:
          return {};
        default:
          return null;
      }
    });

    service = new ServiceIntegration();
    service._registerCoreServices = jest.fn();
  });

  test('initialize reuses in-flight promise', async () => {
    service._doInitialize = jest.fn().mockResolvedValue({
      initialized: [],
      errors: [],
      skipped: [],
      success: true
    });

    const first = service.initialize();
    const second = service.initialize();

    const [firstResult, secondResult] = await Promise.all([first, second]);
    expect(firstResult).toEqual(secondResult);
    expect(service._doInitialize).toHaveBeenCalledTimes(1);
    expect(service._initPromise).toBeNull();
  });

  test('initialize returns success when tier0 services succeed', async () => {
    const result = await service.initialize();

    expect(result.success).toBe(true);
    expect(result.initialized).toEqual(
      expect.arrayContaining(['analysisHistory', 'undoRedo', 'processingState', 'vectorDb'])
    );
    expect(analysisHistory.setOnEntriesRemovedCallback).toHaveBeenCalled();
  });

  test('initialize reports vectorDb failure but stays successful', async () => {
    vectorService.initialize.mockRejectedValueOnce(new Error('db fail'));

    const result = await service.initialize();

    expect(result.success).toBe(true);
    expect(result.errors).toEqual(
      expect.arrayContaining([expect.objectContaining({ service: 'vectorDb' })])
    );
    expect(result.skipped).toEqual(expect.arrayContaining(['folderMatching']));
  });

  test('shutdown waits for init and clears references', async () => {
    service.initialized = true;
    service.analysisHistory = analysisHistory;
    service.undoRedo = undoRedo;
    service.processingState = processingState;
    service.vectorService = vectorService;
    service.folderMatchingService = folderMatching;
    service.smartFolderWatcher = {};
    service.relationshipIndex = {};

    mockContainer.shutdown.mockResolvedValueOnce();

    await service.shutdown();

    expect(mockContainer.shutdown).toHaveBeenCalledWith(mockShutdownOrder);
    expect(service.analysisHistory).toBeNull();
    expect(service.initialized).toBe(false);
  });

  test('configureSmartFolderWatcher wires dependencies and triggers auto-start', () => {
    const watcher = { start: jest.fn() };
    mockContainer.resolve.mockImplementationOnce(() => watcher);
    service._autoStartSmartFolderWatcher = jest.fn();

    const getSmartFolders = jest.fn();
    const analyzeDocumentFile = jest.fn();
    const analyzeImageFile = jest.fn();

    service.configureSmartFolderWatcher({ getSmartFolders, analyzeDocumentFile, analyzeImageFile });

    expect(watcher.getSmartFolders).toBe(getSmartFolders);
    expect(watcher.analyzeDocumentFile).toBe(analyzeDocumentFile);
    expect(watcher.analyzeImageFile).toBe(analyzeImageFile);
    expect(service._autoStartSmartFolderWatcher).toHaveBeenCalled();
  });

  test('runLearningStartupScan returns defaults when learning service missing', async () => {
    mockContainer.resolve.mockImplementation((id) => {
      if (id === mockServiceIds.LEARNING_FEEDBACK) return null;
      if (id === mockServiceIds.ANALYSIS_HISTORY) return analysisHistory;
      return null;
    });

    const result = await service.runLearningStartupScan();
    expect(result).toEqual({ scanned: 0, learned: 0 });
  });

  test('runLearningStartupScan delegates to learning service', async () => {
    const learningService = {
      learnFromExistingFiles: jest.fn().mockResolvedValue({ scanned: 10, learned: 7 })
    };
    mockContainer.resolve.mockImplementation((id) => {
      if (id === mockServiceIds.LEARNING_FEEDBACK) return learningService;
      if (id === mockServiceIds.ANALYSIS_HISTORY) return analysisHistory;
      return null;
    });

    const result = await service.runLearningStartupScan({ maxFilesPerFolder: 5 });
    expect(result).toEqual({ scanned: 10, learned: 7 });
    expect(learningService.learnFromExistingFiles).toHaveBeenCalledWith(analysisHistory, {
      maxFilesPerFolder: 5,
      onlyWithAnalysis: true
    });
  });

  describe('Migration: OramaVectorService + LlamaService wiring', () => {
    test('vectorDbService backward-compatible alias returns vectorService', async () => {
      await service.initialize();

      expect(service.vectorService).toBe(vectorService);
      expect(service.vectorDbService).toBe(service.vectorService);
    });

    test('vectorDb alias also returns vectorService', async () => {
      await service.initialize();

      expect(service.vectorDb).toBe(service.vectorService);
    });

    test('resolves OramaVectorService from container via ORAMA_VECTOR id', async () => {
      await service.initialize();

      expect(mockContainer.resolve).toHaveBeenCalledWith(mockServiceIds.ORAMA_VECTOR);
      expect(service.vectorService).toBe(vectorService);
    });

    test('resolves FolderMatchingService from container', async () => {
      await service.initialize();

      expect(mockContainer.resolve).toHaveBeenCalledWith(mockServiceIds.FOLDER_MATCHING);
      expect(service.folderMatchingService).toBe(folderMatching);
    });

    test('tiered initialization: vectorDb (tier 1) initializes before folderMatching (tier 2)', async () => {
      const callOrder = [];
      vectorService.initialize.mockImplementation(async () => {
        callOrder.push('vectorDb');
      });
      folderMatching.initialize.mockImplementation(async () => {
        callOrder.push('folderMatching');
      });

      await service.initialize();

      const vdbIdx = callOrder.indexOf('vectorDb');
      const fmIdx = callOrder.indexOf('folderMatching');
      expect(vdbIdx).toBeLessThan(fmIdx);
    });

    test('folderMatching is skipped when vectorDb initialization fails', async () => {
      vectorService.initialize.mockRejectedValueOnce(new Error('Orama init failed'));

      const result = await service.initialize();

      expect(result.errors).toEqual(
        expect.arrayContaining([expect.objectContaining({ service: 'vectorDb' })])
      );
      expect(result.skipped).toContain('folderMatching');
      expect(folderMatching.initialize).not.toHaveBeenCalled();
    });

    test('vectorDb null produces degraded mode (skipped)', async () => {
      mockContainer.resolve.mockImplementation((id) => {
        if (id === mockServiceIds.ORAMA_VECTOR) return null;
        if (id === mockServiceIds.ANALYSIS_HISTORY) return analysisHistory;
        if (id === mockServiceIds.UNDO_REDO) return undoRedo;
        if (id === mockServiceIds.PROCESSING_STATE) return processingState;
        if (id === mockServiceIds.RELATIONSHIP_INDEX) return {};
        if (id === mockServiceIds.FOLDER_MATCHING) return folderMatching;
        if (id === mockServiceIds.SETTINGS) return { getAll: jest.fn(() => ({})) };
        if (id === mockServiceIds.ORGANIZATION_SUGGESTION) return {};
        if (id === mockServiceIds.AUTO_ORGANIZE) return {};
        return null;
      });

      const result = await service.initialize();

      // vectorDb skipped, but core services succeed = overall success
      expect(result.success).toBe(true);
      expect(result.skipped).toContain('vectorDb');
    });

    test('analysisHistory entriesRemoved callback cascades orphan marking to vectorService', async () => {
      await service.initialize();

      // Get the callback that was registered
      const callback = analysisHistory.setOnEntriesRemovedCallback.mock.calls[0][0];
      expect(callback).toBeInstanceOf(Function);

      // Simulate calling it
      vectorService.markEmbeddingsOrphaned = jest.fn().mockResolvedValue({
        file: { marked: 2 },
        chunks: { marked: 5 }
      });

      await callback([{ actualPath: '/docs/report.pdf', originalPath: '/docs/report.pdf' }]);

      expect(vectorService.markEmbeddingsOrphaned).toHaveBeenCalledWith(
        expect.arrayContaining([expect.stringContaining('report.pdf')])
      );
    });

    test('container reference is exposed for DI', () => {
      expect(service.container).toBe(mockContainer);
    });

    test('initialization is successful even if folderMatching fails (non-fatal)', async () => {
      folderMatching.initialize.mockRejectedValueOnce(new Error('folder init fail'));

      const result = await service.initialize();

      expect(result.success).toBe(true);
      expect(result.errors).toEqual(
        expect.arrayContaining([expect.objectContaining({ service: 'folderMatching' })])
      );
    });
  });
});
