const { ipcMain } = require('./mocks/electron');

describe('AnalysisHistory IPC', () => {
  beforeEach(() => {
    ipcMain._handlers.clear();
    ipcMain.handle.mockClear();
    jest.resetModules();
  });

  test('GET/SEARCH/GET_STATISTICS/EXPORT are wired', async () => {
    const registerAnalysisHistoryIpc = require('../src/main/ipc/analysisHistory');
    const { IPC_CHANNELS } = require('../src/shared/constants');
    const logger = { error: jest.fn(), info: jest.fn(), warn: jest.fn() };
    const service = {
      getStatistics: jest.fn(async () => ({ total: 0 })),
      searchAnalysis: jest.fn(async () => []),
      getAnalysisByPath: jest.fn(async () => []),
      getRecentAnalysis: jest.fn(async () => []),
      clear: jest.fn(async () => ({})),
      createDefaultStructures: jest.fn(async () => ({}))
    };

    registerAnalysisHistoryIpc({
      ipcMain,
      IPC_CHANNELS,
      logger,
      getServiceIntegration: () => ({ analysisHistory: service })
    });

    // IPC handlers expect (event, ...args) - pass null for event
    // All handlers need their expected arguments since service is appended by wrapper
    const mockEvent = null;

    const hGet = ipcMain._handlers.get(IPC_CHANNELS.ANALYSIS_HISTORY.GET);
    // GET expects (event, options) - options defaults to {} if not provided
    expect(Array.isArray(await hGet(mockEvent, {}))).toBe(true);

    const hSearch = ipcMain._handlers.get(IPC_CHANNELS.ANALYSIS_HISTORY.SEARCH);
    // SEARCH expects (event, query, options)
    const searchResult = await hSearch(mockEvent, 'term', {});
    expect(Array.isArray(searchResult)).toBe(true);

    const hStats = ipcMain._handlers.get(IPC_CHANNELS.ANALYSIS_HISTORY.GET_STATISTICS);
    // GET_STATISTICS expects just (event)
    expect((await hStats(mockEvent)).total).toBe(0);

    const hExport = ipcMain._handlers.get(IPC_CHANNELS.ANALYSIS_HISTORY.EXPORT);
    // EXPORT expects (event, format)
    const exportResult = await hExport(mockEvent, 'json');
    expect(exportResult.success).toBe(true);
    expect(exportResult.data).toBeDefined();
  });
});
