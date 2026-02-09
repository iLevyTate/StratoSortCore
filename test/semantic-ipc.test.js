const { ipcMain } = require('./mocks/electron');

describe('Embeddings/Semantic IPC', () => {
  beforeEach(() => {
    ipcMain._handlers.clear();
    ipcMain.handle.mockClear();
    jest.resetModules();
  });

  function mockLlamaService() {
    jest.doMock('../src/main/services/LlamaService', () => ({
      getInstance: () => ({
        getConfig: jest.fn().mockResolvedValue({
          embeddingModel: 'embeddinggemma',
          textModel: 'llama3.2',
          visionModel: 'llava'
        }),
        listModels: jest.fn().mockResolvedValue([{ name: 'embeddinggemma:latest' }]),
        testConnection: jest.fn().mockResolvedValue({ success: true })
      })
    }));
  }

  function mockVectorDbService(overrides = {}) {
    const base = {
      initialize: jest.fn(async () => {}),
      getStats: jest.fn().mockResolvedValue({ files: 0, folders: 0 }),
      resetAll: jest.fn().mockResolvedValue(true),
      resetFolders: jest.fn().mockResolvedValue(true),
      batchUpsertFolders: jest.fn().mockResolvedValue(0)
    };
    jest.doMock('../src/main/services/OramaVectorService', () => ({
      getInstance: () => ({ ...base, ...overrides })
    }));
  }

  function mockFolderMatcher() {
    jest.doMock('../src/main/services/FolderMatchingService', () => ({
      getInstance: () => ({
        initialize: jest.fn(),
        embedText: jest.fn(async (_text) => ({
          vector: [0.1, 0.2, 0.3],
          model: 'mxbai-embed-large'
        })),
        generateFolderId: jest.fn((f) => f.id || `folder-${f.name}`)
      })
    }));
  }

  function registerIpc(
    logger = { error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() }
  ) {
    // Mock container.resolve to return the mocked services
    const { container, ServiceIds } = require('../src/main/services/ServiceContainer');
    const OramaVectorService = require('../src/main/services/OramaVectorService');
    const FolderMatchingService = require('../src/main/services/FolderMatchingService');

    container.resolve = jest.fn((id) => {
      switch (id) {
        case ServiceIds.ORAMA_VECTOR:
          return OramaVectorService.getInstance();
        case ServiceIds.FOLDER_MATCHING:
          return FolderMatchingService.getInstance();
        case ServiceIds.PARALLEL_EMBEDDING:
          return {};
        case ServiceIds.SEARCH_SERVICE:
          return {
            warmUp: jest.fn().mockResolvedValue(undefined),
            rebuildIndex: jest.fn().mockResolvedValue({ success: true })
          };
        case ServiceIds.LLAMA_SERVICE:
          return require('../src/main/services/LlamaService').getInstance();
        case ServiceIds.CLUSTERING:
          return {};
        default:
          return {};
      }
    });

    const { registerAllIpc } = require('../src/main/ipc');
    const { IPC_CHANNELS } = require('../src/shared/constants');
    registerAllIpc({
      ipcMain,
      IPC_CHANNELS,
      logger,
      systemAnalytics: { collectMetrics: jest.fn(async () => ({})) },
      getServiceIntegration: () => ({
        analysisHistory: { getRecentAnalysis: jest.fn(async () => []) }
      }),
      getCustomFolders: () => [{ id: '1', name: 'Finance', description: 'Invoices' }]
    });
    return IPC_CHANNELS;
  }

  test('GET_STATS returns stats when vector DB is available', async () => {
    mockLlamaService();
    mockVectorDbService();
    mockFolderMatcher();

    const IPC_CHANNELS = registerIpc();
    const handler = ipcMain._handlers.get(IPC_CHANNELS.EMBEDDINGS.GET_STATS);
    const result = await handler();

    expect(result.success).toBe(true);
    expect(result.files).toBeDefined();
    expect(result.folders).toBeDefined();
  });

  test('REBUILD_FOLDERS triggers batch upsert', async () => {
    mockLlamaService();
    const batchUpsertFolders = jest.fn().mockResolvedValue(1);
    mockVectorDbService({ batchUpsertFolders });
    mockFolderMatcher();

    const IPC_CHANNELS = registerIpc();
    const handler = ipcMain._handlers.get(IPC_CHANNELS.EMBEDDINGS.REBUILD_FOLDERS);
    const result = await handler();

    expect(result.success).toBe(true);
    expect(batchUpsertFolders).toHaveBeenCalled();
  });
});
