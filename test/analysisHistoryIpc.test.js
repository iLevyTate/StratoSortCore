/**
 * Tests for Analysis History IPC handlers
 * Tests history retrieval, search, and export functionality
 */

// Mock logger
jest.mock('../src/shared/logger', () => ({
  logger: {
    setContext: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

describe('registerAnalysisHistoryIpc', () => {
  let registerAnalysisHistoryIpc;
  let mockIpcMain;
  let mockLogger;
  let mockGetServiceIntegration;
  let mockAnalysisHistory;
  let handlers;

  const IPC_CHANNELS = {
    ANALYSIS_HISTORY: {
      GET_STATISTICS: 'history:stats',
      GET: 'history:get',
      SEARCH: 'history:search',
      GET_FILE_HISTORY: 'history:file',
      CLEAR: 'history:clear',
      EXPORT: 'history:export',
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();

    handlers = {};

    mockIpcMain = {
      handle: jest.fn((channel, handler) => {
        handlers[channel] = handler;
      }),
    };

    mockAnalysisHistory = {
      getStatistics: jest.fn().mockResolvedValue({
        totalAnalyses: 100,
        successRate: 0.95,
        averageConfidence: 0.85,
      }),
      getRecentAnalysis: jest.fn().mockResolvedValue([
        { id: '1', fileName: 'doc1.pdf', category: 'documents' },
        { id: '2', fileName: 'img1.jpg', category: 'images' },
      ]),
      searchAnalysis: jest.fn().mockResolvedValue([
        { id: '1', fileName: 'doc1.pdf', category: 'documents' },
      ]),
      getAnalysisByPath: jest.fn().mockResolvedValue({
        id: '1',
        fileName: 'doc1.pdf',
        originalPath: '/test/doc1.pdf',
        analysis: { category: 'documents', confidence: 0.9 },
      }),
      createDefaultStructures: jest.fn().mockResolvedValue(undefined),
    };

    mockGetServiceIntegration = jest.fn().mockReturnValue({
      analysisHistory: mockAnalysisHistory,
    });

    mockLogger = {
      setContext: jest.fn(),
      info: jest.fn(),
      debug: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };

    registerAnalysisHistoryIpc = require('../src/main/ipc/analysisHistory');
  });

  test('registers all history handlers', () => {
    registerAnalysisHistoryIpc({
      ipcMain: mockIpcMain,
      IPC_CHANNELS,
      logger: mockLogger,
      getServiceIntegration: mockGetServiceIntegration,
    });

    expect(mockIpcMain.handle).toHaveBeenCalledTimes(6);
  });

  describe('getStatistics handler', () => {
    beforeEach(() => {
      registerAnalysisHistoryIpc({
        ipcMain: mockIpcMain,
        IPC_CHANNELS,
        logger: mockLogger,
        getServiceIntegration: mockGetServiceIntegration,
      });
    });

    test('returns statistics', async () => {
      const result = await handlers['history:stats']({});

      expect(result.totalAnalyses).toBe(100);
      expect(result.successRate).toBe(0.95);
    });

    test('returns empty object on error', async () => {
      mockAnalysisHistory.getStatistics.mockRejectedValueOnce(
        new Error('DB error'),
      );

      const result = await handlers['history:stats']({});

      expect(result).toEqual({});
    });

    test('returns fallback when service unavailable', async () => {
      mockGetServiceIntegration.mockReturnValueOnce(null);

      const result = await handlers['history:stats']({});

      expect(result).toEqual({});
    });
  });

  describe('get history handler', () => {
    beforeEach(() => {
      registerAnalysisHistoryIpc({
        ipcMain: mockIpcMain,
        IPC_CHANNELS,
        logger: mockLogger,
        getServiceIntegration: mockGetServiceIntegration,
      });
    });

    test('returns recent history with default options', async () => {
      const result = await handlers['history:get']({}, {});

      expect(mockAnalysisHistory.getRecentAnalysis).toHaveBeenCalledWith(50);
      expect(result).toHaveLength(2);
    });

    test('returns all history when requested', async () => {
      await handlers['history:get']({}, { all: true });

      expect(mockAnalysisHistory.getRecentAnalysis).toHaveBeenCalledWith(
        Number.MAX_SAFE_INTEGER,
      );
    });

    test('handles limit: "all"', async () => {
      await handlers['history:get']({}, { limit: 'all' });

      expect(mockAnalysisHistory.getRecentAnalysis).toHaveBeenCalledWith(
        Number.MAX_SAFE_INTEGER,
      );
    });

    test('applies pagination with offset', async () => {
      mockAnalysisHistory.getRecentAnalysis.mockResolvedValueOnce([
        { id: '1' },
        { id: '2' },
        { id: '3' },
        { id: '4' },
      ]);

      const result = await handlers['history:get']({}, { limit: 2, offset: 1 });

      expect(result).toHaveLength(2);
    });

    test('returns empty array on error', async () => {
      mockAnalysisHistory.getRecentAnalysis.mockRejectedValueOnce(
        new Error('Failed'),
      );

      const result = await handlers['history:get']({}, {});

      expect(result).toEqual([]);
    });

    test('handles null result from service', async () => {
      mockAnalysisHistory.getRecentAnalysis.mockResolvedValueOnce(null);

      const result = await handlers['history:get']({}, {});

      expect(result).toEqual([]);
    });
  });

  describe('search handler', () => {
    beforeEach(() => {
      registerAnalysisHistoryIpc({
        ipcMain: mockIpcMain,
        IPC_CHANNELS,
        logger: mockLogger,
        getServiceIntegration: mockGetServiceIntegration,
      });
    });

    test('searches history', async () => {
      const result = await handlers['history:search']({}, 'doc', {});

      expect(mockAnalysisHistory.searchAnalysis).toHaveBeenCalledWith('doc', {});
      expect(result).toHaveLength(1);
    });

    test('returns empty array on error', async () => {
      mockAnalysisHistory.searchAnalysis.mockRejectedValueOnce(
        new Error('Search failed'),
      );

      const result = await handlers['history:search']({}, 'query', {});

      expect(result).toEqual([]);
    });
  });

  describe('get file history handler', () => {
    beforeEach(() => {
      registerAnalysisHistoryIpc({
        ipcMain: mockIpcMain,
        IPC_CHANNELS,
        logger: mockLogger,
        getServiceIntegration: mockGetServiceIntegration,
      });
    });

    test('returns file history', async () => {
      const result = await handlers['history:file']({}, '/test/doc1.pdf');

      expect(mockAnalysisHistory.getAnalysisByPath).toHaveBeenCalledWith(
        '/test/doc1.pdf',
      );
      expect(result.fileName).toBe('doc1.pdf');
    });

    test('returns null on error', async () => {
      mockAnalysisHistory.getAnalysisByPath.mockRejectedValueOnce(
        new Error('Not found'),
      );

      const result = await handlers['history:file']({}, '/unknown.pdf');

      expect(result).toBeNull();
    });
  });

  describe('clear handler', () => {
    beforeEach(() => {
      registerAnalysisHistoryIpc({
        ipcMain: mockIpcMain,
        IPC_CHANNELS,
        logger: mockLogger,
        getServiceIntegration: mockGetServiceIntegration,
      });
    });

    test('clears history', async () => {
      const result = await handlers['history:clear']({});

      expect(mockAnalysisHistory.createDefaultStructures).toHaveBeenCalled();
      expect(result.success).toBe(true);
    });

    test('returns error response on failure', async () => {
      mockAnalysisHistory.createDefaultStructures.mockRejectedValueOnce(
        new Error('Clear failed'),
      );

      const result = await handlers['history:clear']({});

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('export handler', () => {
    beforeEach(() => {
      registerAnalysisHistoryIpc({
        ipcMain: mockIpcMain,
        IPC_CHANNELS,
        logger: mockLogger,
        getServiceIntegration: mockGetServiceIntegration,
      });

      mockAnalysisHistory.getRecentAnalysis.mockResolvedValue([
        {
          fileName: 'doc1.pdf',
          originalPath: '/test/doc1.pdf',
          analysis: { category: 'documents', confidence: 0.9 },
          timestamp: Date.now(),
        },
      ]);
    });

    test('exports as JSON', async () => {
      const result = await handlers['history:export']({}, 'json');

      expect(result.success).toBe(true);
      expect(result.mime).toBe('application/json');
      expect(result.filename).toBe('analysis-history.json');
      expect(typeof result.data).toBe('string');
    });

    test('exports as CSV', async () => {
      const result = await handlers['history:export']({}, 'csv');

      expect(result.success).toBe(true);
      expect(result.mime).toBe('text/csv');
      expect(result.filename).toBe('analysis-history.csv');
      expect(result.data).toContain('fileName');
    });

    test('returns raw data for unknown format', async () => {
      const result = await handlers['history:export']({}, 'unknown');

      expect(result.success).toBe(true);
      expect(Array.isArray(result.data)).toBe(true);
    });

    test('returns error on failure', async () => {
      mockAnalysisHistory.getRecentAnalysis.mockRejectedValueOnce(
        new Error('Export failed'),
      );

      const result = await handlers['history:export']({}, 'json');

      expect(result.success).toBe(false);
    });
  });
});
