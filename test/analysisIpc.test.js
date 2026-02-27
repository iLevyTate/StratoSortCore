/**
 * Tests for Analysis IPC handlers
 * Tests document and image analysis IPC registration
 */

const mockRecognizeIfAvailable = jest.fn();
const mockBatchAnalyzeFiles = jest.fn();

// Mock logger
jest.mock('../src/shared/logger', () => {
  const logger = {
    setContext: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  };
  return { logger, createLogger: jest.fn(() => logger) };
});

// Mock zod as unavailable to test fallback path
jest.mock('zod', () => {
  throw new Error('Module not found');
});

// Mock fs
jest.mock('fs', () => ({
  promises: {
    stat: jest.fn().mockResolvedValue({
      size: 1024,
      mtimeMs: Date.now()
    }),
    lstat: jest.fn().mockResolvedValue({
      isSymbolicLink: jest.fn().mockReturnValue(false),
      size: 1024,
      mtimeMs: Date.now()
    }),
    access: jest.fn().mockResolvedValue(undefined)
  },
  existsSync: jest.fn().mockReturnValue(true)
}));

// Mock perf_hooks
jest.mock('perf_hooks', () => ({
  performance: {
    now: jest.fn().mockReturnValue(0)
  }
}));

jest.mock('../src/main/utils/tesseractUtils', () => ({
  recognizeIfAvailable: (...args) => mockRecognizeIfAvailable(...args)
}));

jest.mock('../src/main/services/BatchAnalysisService', () =>
  jest.fn().mockImplementation(() => ({
    analyzeFiles: (...args) => mockBatchAnalyzeFiles(...args)
  }))
);

jest.mock('../src/main/ipc/files/batchProgressReporter', () => ({
  sendOperationProgress: jest.fn()
}));

describe('registerAnalysisIpc', () => {
  let registerAnalysisIpc;
  let mockIpcMain;
  let mockAnalyzeDocumentFile;
  let mockAnalyzeImageFile;
  let mockSystemAnalytics;
  let mockGetServiceIntegration;
  let mockGetCustomFolders;
  let mockLogger;
  let handlers;

  const { IPC_CHANNELS } = require('../src/shared/constants');
  const ANALYSIS_CHANNELS = IPC_CHANNELS.ANALYSIS;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();

    handlers = {};

    mockIpcMain = {
      handle: jest.fn((channel, handler) => {
        handlers[channel] = handler;
      })
    };

    mockAnalyzeDocumentFile = jest.fn().mockResolvedValue({
      suggestedName: 'analyzed-document.pdf',
      category: 'documents',
      keywords: ['test', 'document'],
      confidence: 0.9,
      purpose: 'Test document'
    });

    mockAnalyzeImageFile = jest.fn().mockResolvedValue({
      suggestedName: 'analyzed-image.jpg',
      category: 'images',
      keywords: ['photo'],
      confidence: 0.85
    });

    mockRecognizeIfAvailable.mockReset();
    mockBatchAnalyzeFiles.mockReset();
    mockBatchAnalyzeFiles.mockResolvedValue({
      success: true,
      results: [],
      errors: [],
      total: 0,
      successful: 0
    });

    mockSystemAnalytics = {
      recordProcessingTime: jest.fn(),
      recordFailure: jest.fn()
    };

    const mockProcessingState = {
      initialize: jest.fn().mockResolvedValue(undefined),
      markAnalysisStart: jest.fn().mockResolvedValue(undefined),
      markAnalysisComplete: jest.fn().mockResolvedValue(undefined),
      markAnalysisError: jest.fn().mockResolvedValue(undefined),
      upsertReadyAnalysis: jest.fn().mockResolvedValue(undefined),
      getReadyAnalyses: jest.fn().mockReturnValue([]),
      getState: jest.fn().mockReturnValue('in_progress'),
      clearState: jest.fn().mockResolvedValue(undefined)
    };

    const mockAnalysisHistory = {
      recordAnalysis: jest.fn().mockResolvedValue(undefined)
    };

    mockGetServiceIntegration = jest.fn().mockReturnValue({
      processingState: mockProcessingState,
      analysisHistory: mockAnalysisHistory
    });

    mockGetCustomFolders = jest.fn().mockReturnValue([
      { id: '1', name: 'Documents', description: 'Doc folder' },
      { id: '2', name: 'Images', description: 'Image folder' }
    ]);

    mockLogger = {
      setContext: jest.fn(),
      info: jest.fn(),
      debug: jest.fn(),
      warn: jest.fn(),
      error: jest.fn()
    };

    registerAnalysisIpc = require('../src/main/ipc/analysis');
  });

  test('registers all analysis handlers', () => {
    registerAnalysisIpc({
      ipcMain: mockIpcMain,
      IPC_CHANNELS,
      logger: mockLogger,
      systemAnalytics: mockSystemAnalytics,
      analyzeDocumentFile: mockAnalyzeDocumentFile,
      analyzeImageFile: mockAnalyzeImageFile,
      getServiceIntegration: mockGetServiceIntegration,
      getCustomFolders: mockGetCustomFolders
    });

    expect(mockIpcMain.handle).toHaveBeenCalledTimes(6);
    expect(handlers[ANALYSIS_CHANNELS.ANALYZE_DOCUMENT]).toBeDefined();
    expect(handlers[ANALYSIS_CHANNELS.ANALYZE_IMAGE]).toBeDefined();
    expect(handlers[ANALYSIS_CHANNELS.ANALYZE_BATCH]).toBeDefined();
    expect(handlers[ANALYSIS_CHANNELS.CANCEL_BATCH]).toBeDefined();
    expect(handlers[ANALYSIS_CHANNELS.EXTRACT_IMAGE_TEXT]).toBeDefined();
    expect(handlers[ANALYSIS_CHANNELS.GET_READY_QUEUE]).toBeDefined();
  });

  describe('ready queue handler', () => {
    beforeEach(() => {
      registerAnalysisIpc({
        ipcMain: mockIpcMain,
        IPC_CHANNELS,
        logger: mockLogger,
        systemAnalytics: mockSystemAnalytics,
        analyzeDocumentFile: mockAnalyzeDocumentFile,
        analyzeImageFile: mockAnalyzeImageFile,
        getServiceIntegration: mockGetServiceIntegration,
        getCustomFolders: mockGetCustomFolders
      });
    });

    test('returns durable ready analysis queue', async () => {
      const serviceIntegration = mockGetServiceIntegration();
      serviceIntegration.processingState.getReadyAnalyses.mockReturnValueOnce([
        { path: 'C:\\docs\\a.pdf', analysis: { suggestedName: 'a.pdf' } }
      ]);

      const result = await handlers[ANALYSIS_CHANNELS.GET_READY_QUEUE]({});

      expect(serviceIntegration.processingState.initialize).toHaveBeenCalled();
      expect(result).toEqual({
        success: true,
        readyFiles: [{ path: 'C:\\docs\\a.pdf', analysis: { suggestedName: 'a.pdf' } }]
      });
    });
  });

  describe('batch analysis handler', () => {
    beforeEach(() => {
      registerAnalysisIpc({
        ipcMain: mockIpcMain,
        IPC_CHANNELS,
        logger: mockLogger,
        systemAnalytics: mockSystemAnalytics,
        analyzeDocumentFile: mockAnalyzeDocumentFile,
        analyzeImageFile: mockAnalyzeImageFile,
        getServiceIntegration: mockGetServiceIntegration,
        getCustomFolders: mockGetCustomFolders
      });
    });

    test('analyzes files via batch service', async () => {
      mockBatchAnalyzeFiles.mockResolvedValueOnce({
        success: true,
        results: [
          { filePath: '/test/doc.pdf', success: true, result: { suggestedName: 'doc.pdf' } }
        ],
        errors: [],
        total: 1,
        successful: 1
      });

      const result = await handlers[ANALYSIS_CHANNELS.ANALYZE_BATCH](
        {},
        { filePaths: ['/test/doc.pdf'] }
      );

      expect(mockBatchAnalyzeFiles).toHaveBeenCalledWith(
        [expect.stringContaining('doc.pdf')],
        expect.any(Array),
        expect.objectContaining({
          concurrency: undefined,
          sectionOrder: undefined
        })
      );
      expect(result.success).toBe(true);
      expect(result.total).toBe(1);
    });
  });

  describe('document analysis handler', () => {
    beforeEach(() => {
      registerAnalysisIpc({
        ipcMain: mockIpcMain,
        IPC_CHANNELS,
        logger: mockLogger,
        systemAnalytics: mockSystemAnalytics,
        analyzeDocumentFile: mockAnalyzeDocumentFile,
        analyzeImageFile: mockAnalyzeImageFile,
        getServiceIntegration: mockGetServiceIntegration,
        getCustomFolders: mockGetCustomFolders
      });
    });

    test('analyzes document successfully', async () => {
      const result = await handlers[ANALYSIS_CHANNELS.ANALYZE_DOCUMENT]({}, '/test/doc.pdf');

      expect(mockAnalyzeDocumentFile).toHaveBeenCalledWith(
        expect.stringContaining('doc.pdf'),
        expect.any(Array)
      );
      expect(result.suggestedName).toBe('analyzed-document.pdf');
      expect(result.category).toBe('documents');
    });

    test('passes custom folders to analysis', async () => {
      await handlers[ANALYSIS_CHANNELS.ANALYZE_DOCUMENT]({}, '/test/doc.pdf');

      expect(mockAnalyzeDocumentFile).toHaveBeenCalled();
      const [, folderCategories] = mockAnalyzeDocumentFile.mock.calls[0] || [];
      expect(folderCategories).toHaveLength(2);
      expect(folderCategories).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: '1', name: 'Documents', description: 'Doc folder' }),
          expect.objectContaining({ id: '2', name: 'Images', description: 'Image folder' })
        ])
      );
    });

    test('records processing time', async () => {
      await handlers[ANALYSIS_CHANNELS.ANALYZE_DOCUMENT]({}, '/test/doc.pdf');

      expect(mockSystemAnalytics.recordProcessingTime).toHaveBeenCalled();
    });

    test('handles analysis error gracefully', async () => {
      mockAnalyzeDocumentFile.mockRejectedValueOnce(new Error('Analysis failed'));

      const result = await handlers[ANALYSIS_CHANNELS.ANALYZE_DOCUMENT]({}, '/test/doc.pdf');

      expect(result.error).toBe('Analysis failed');
      expect(result.category).toBe('documents');
      expect(result.confidence).toBe(0);
      expect(mockSystemAnalytics.recordFailure).toHaveBeenCalled();
    });

    test('handles missing getCustomFolders', async () => {
      jest.resetModules();
      handlers = {};
      mockIpcMain.handle.mockImplementation((channel, handler) => {
        handlers[channel] = handler;
      });

      registerAnalysisIpc = require('../src/main/ipc/analysis');
      registerAnalysisIpc({
        ipcMain: mockIpcMain,
        IPC_CHANNELS,
        logger: mockLogger,
        systemAnalytics: mockSystemAnalytics,
        analyzeDocumentFile: mockAnalyzeDocumentFile,
        analyzeImageFile: mockAnalyzeImageFile,
        getServiceIntegration: mockGetServiceIntegration,
        getCustomFolders: null
      });

      const result = await handlers[ANALYSIS_CHANNELS.ANALYZE_DOCUMENT]({}, '/test/doc.pdf');

      expect(result.suggestedName).toBeDefined();
    });

    test('handles getCustomFolders error', async () => {
      mockGetCustomFolders.mockImplementationOnce(() => {
        throw new Error('Folder error');
      });

      const result = await handlers[ANALYSIS_CHANNELS.ANALYZE_DOCUMENT]({}, '/test/doc.pdf');

      // Should still complete analysis
      expect(result.suggestedName).toBeDefined();
    });
  });

  describe('image analysis handler', () => {
    beforeEach(() => {
      registerAnalysisIpc({
        ipcMain: mockIpcMain,
        IPC_CHANNELS,
        logger: mockLogger,
        systemAnalytics: mockSystemAnalytics,
        analyzeDocumentFile: mockAnalyzeDocumentFile,
        analyzeImageFile: mockAnalyzeImageFile,
        getServiceIntegration: mockGetServiceIntegration,
        getCustomFolders: mockGetCustomFolders
      });
    });

    test('analyzes image successfully', async () => {
      const result = await handlers[ANALYSIS_CHANNELS.ANALYZE_IMAGE]({}, '/test/image.jpg');

      expect(mockAnalyzeImageFile).toHaveBeenCalledWith(
        expect.stringContaining('image.jpg'),
        expect.any(Array)
      );
      expect(result.suggestedName).toBe('analyzed-image.jpg');
      expect(result.category).toBe('images');
    });

    test('handles image analysis error', async () => {
      mockAnalyzeImageFile.mockRejectedValueOnce(new Error('Vision failed'));

      const result = await handlers[ANALYSIS_CHANNELS.ANALYZE_IMAGE]({}, '/test/image.jpg');

      expect(result.error).toBe('Vision failed');
      expect(result.category).toBe('images');
    });
  });

  describe('OCR handler', () => {
    beforeEach(() => {
      registerAnalysisIpc({
        ipcMain: mockIpcMain,
        IPC_CHANNELS,
        logger: mockLogger,
        systemAnalytics: mockSystemAnalytics,
        analyzeDocumentFile: mockAnalyzeDocumentFile,
        analyzeImageFile: mockAnalyzeImageFile,
        getServiceIntegration: mockGetServiceIntegration,
        getCustomFolders: mockGetCustomFolders
      });
    });

    test('extracts text from image', async () => {
      mockRecognizeIfAvailable.mockResolvedValue({ success: true, text: 'Extracted text' });

      const result = await handlers[ANALYSIS_CHANNELS.EXTRACT_IMAGE_TEXT]({}, '/test/scan.png');

      expect(mockRecognizeIfAvailable).toHaveBeenCalledWith(
        null,
        expect.stringContaining('scan.png'),
        expect.objectContaining({
          lang: 'eng',
          oem: 1,
          psm: 3
        })
      );
      expect(result.success).toBe(true);
      expect(result.text).toBe('Extracted text');
    });

    test('handles OCR error', async () => {
      mockRecognizeIfAvailable.mockResolvedValue({
        success: false,
        error: 'OCR failed',
        cause: new Error('OCR failed')
      });

      const result = await handlers[ANALYSIS_CHANNELS.EXTRACT_IMAGE_TEXT]({}, '/test/scan.png');

      expect(result.success).toBe(false);
      expect(result.error).toBe('OCR failed');
    });
  });
});
