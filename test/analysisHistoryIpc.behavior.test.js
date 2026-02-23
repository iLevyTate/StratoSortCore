const { ipcMain } = require('./mocks/electron');
const { getSemanticFileId } = require('../src/shared/fileIdUtils');

describe('AnalysisHistory IPC (behavior)', () => {
  beforeEach(() => {
    ipcMain._handlers.clear();
    ipcMain.handle.mockClear();
    jest.resetModules();
  });

  function registerWith(serviceIntegration) {
    const registerAnalysisHistoryIpc = require('../src/main/ipc/analysisHistory');
    const { IPC_CHANNELS } = require('../src/shared/constants');
    const logger = { error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() };

    registerAnalysisHistoryIpc({
      ipcMain,
      IPC_CHANNELS,
      logger,
      getServiceIntegration: () => serviceIntegration
    });

    return { IPC_CHANNELS };
  }

  test('GET supports all=true with safety cap and offset slicing', async () => {
    const service = {
      getStatistics: jest.fn(async () => ({})),
      searchAnalysis: jest.fn(async () => []),
      getAnalysisByPath: jest.fn(async () => null),
      getRecentAnalysis: jest.fn(async () => [1, 2, 3, 4, 5]),
      clear: jest.fn(async () => ({})),
      createDefaultStructures: jest.fn(async () => ({}))
    };

    const { IPC_CHANNELS } = registerWith({
      analysisHistory: service,
      container: { resolve: jest.fn() }
    });
    const handler = ipcMain._handlers.get(IPC_CHANNELS.ANALYSIS_HISTORY.GET);

    const result = await handler(null, { all: true, offset: 2 });
    expect(result).toEqual([3, 4, 5]);
    expect(service.getRecentAnalysis).toHaveBeenCalledWith(50000);
  });

  test('SET_EMBEDDING_POLICY validates payload and calls service', async () => {
    const service = {
      setEmbeddingPolicyByPath: jest.fn(async () => ({ updated: 1 }))
    };

    const { IPC_CHANNELS } = registerWith({
      analysisHistory: service,
      container: { resolve: jest.fn() }
    });
    const handler = ipcMain._handlers.get(IPC_CHANNELS.ANALYSIS_HISTORY.SET_EMBEDDING_POLICY);

    // Validation returns structured error response with Zod details
    const emptyPathResult = await handler(null, { filePath: '', policy: 'embed' });
    expect(emptyPathResult.success).toBe(false);

    const invalidPolicyResult = await handler(null, { filePath: 'C:\\x\\a.pdf', policy: 'nope' });
    expect(invalidPolicyResult.success).toBe(false);

    await expect(handler(null, { filePath: 'C:\\x\\a.pdf', policy: 'skip' })).resolves.toEqual(
      expect.objectContaining({ success: true, updated: 1 })
    );
    expect(service.setEmbeddingPolicyByPath).toHaveBeenCalledWith('C:\\x\\a.pdf', 'skip');
  });

  test('CLEAR marks embeddings orphaned via OramaVectorService when available', async () => {
    const filePath = 'C:\\docs\\a.pdf';
    const oramaService = {
      markEmbeddingsOrphaned: jest.fn(async () => undefined)
    };

    const service = {
      initialize: jest.fn(async () => undefined),
      analysisHistory: {
        entries: {
          e1: { originalPath: filePath }
        }
      },
      createDefaultStructures: jest.fn(async () => ({}))
    };

    const { IPC_CHANNELS } = registerWith({
      analysisHistory: service,
      container: {
        resolve: jest.fn(() => oramaService)
      }
    });
    const handler = ipcMain._handlers.get(IPC_CHANNELS.ANALYSIS_HISTORY.CLEAR);

    const res = await handler(null);
    expect(res).toEqual(expect.objectContaining({ success: true }));
    expect(service.initialize).toHaveBeenCalled();
    expect(oramaService.markEmbeddingsOrphaned).toHaveBeenCalledWith([getSemanticFileId(filePath)]);
    expect(service.createDefaultStructures).toHaveBeenCalled();
  });
});
