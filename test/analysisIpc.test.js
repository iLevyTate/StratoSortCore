/**
 * Tests for Analysis IPC handlers
 * Tests document and image analysis IPC registration
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
    })
  }
}));

// Mock perf_hooks
jest.mock('perf_hooks', () => ({
  performance: {
    now: jest.fn().mockReturnValue(0)
  }
}));

describe('registerAnalysisIpc', () => {
  let registerAnalysisIpc;
  let mockIpcMain;
  let mockAnalyzeDocumentFile;
  let mockAnalyzeImageFile;
  let mockTesseract;
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

    mockTesseract = {
      recognize: jest.fn().mockResolvedValue('Extracted text')
    };

    mockSystemAnalytics = {
      recordProcessingTime: jest.fn(),
      recordFailure: jest.fn()
    };

    const mockProcessingState = {
      markAnalysisStart: jest.fn().mockResolvedValue(undefined),
      markAnalysisComplete: jest.fn().mockResolvedValue(undefined),
      markAnalysisError: jest.fn().mockResolvedValue(undefined),
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
      tesseract: mockTesseract,
      systemAnalytics: mockSystemAnalytics,
      analyzeDocumentFile: mockAnalyzeDocumentFile,
      analyzeImageFile: mockAnalyzeImageFile,
      getServiceIntegration: mockGetServiceIntegration,
      getCustomFolders: mockGetCustomFolders
    });

    expect(mockIpcMain.handle).toHaveBeenCalledTimes(3);
    expect(handlers[ANALYSIS_CHANNELS.ANALYZE_DOCUMENT]).toBeDefined();
    expect(handlers[ANALYSIS_CHANNELS.ANALYZE_IMAGE]).toBeDefined();
    expect(handlers[ANALYSIS_CHANNELS.EXTRACT_IMAGE_TEXT]).toBeDefined();
  });

  describe('document analysis handler', () => {
    beforeEach(() => {
      registerAnalysisIpc({
        ipcMain: mockIpcMain,
        IPC_CHANNELS,
        logger: mockLogger,
        tesseract: mockTesseract,
        systemAnalytics: mockSystemAnalytics,
        analyzeDocumentFile: mockAnalyzeDocumentFile,
        analyzeImageFile: mockAnalyzeImageFile,
        getServiceIntegration: mockGetServiceIntegration,
        getCustomFolders: mockGetCustomFolders
      });
    });

    test('analyzes document successfully', async () => {
      const result = await handlers[ANALYSIS_CHANNELS.ANALYZE_DOCUMENT]({}, '/test/doc.pdf');

      expect(mockAnalyzeDocumentFile).toHaveBeenCalledWith('/test/doc.pdf', expect.any(Array));
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
        tesseract: mockTesseract,
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
        tesseract: mockTesseract,
        systemAnalytics: mockSystemAnalytics,
        analyzeDocumentFile: mockAnalyzeDocumentFile,
        analyzeImageFile: mockAnalyzeImageFile,
        getServiceIntegration: mockGetServiceIntegration,
        getCustomFolders: mockGetCustomFolders
      });
    });

    test('analyzes image successfully', async () => {
      const result = await handlers[ANALYSIS_CHANNELS.ANALYZE_IMAGE]({}, '/test/image.jpg');

      expect(mockAnalyzeImageFile).toHaveBeenCalledWith('/test/image.jpg', expect.any(Array));
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
        tesseract: mockTesseract,
        systemAnalytics: mockSystemAnalytics,
        analyzeDocumentFile: mockAnalyzeDocumentFile,
        analyzeImageFile: mockAnalyzeImageFile,
        getServiceIntegration: mockGetServiceIntegration,
        getCustomFolders: mockGetCustomFolders
      });
    });

    test('extracts text from image', async () => {
      const result = await handlers[ANALYSIS_CHANNELS.EXTRACT_IMAGE_TEXT]({}, '/test/scan.png');

      expect(mockTesseract.recognize).toHaveBeenCalledWith(
        '/test/scan.png',
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
      mockTesseract.recognize.mockRejectedValueOnce(new Error('OCR failed'));

      const result = await handlers[ANALYSIS_CHANNELS.EXTRACT_IMAGE_TEXT]({}, '/test/scan.png');

      expect(result.success).toBe(false);
      expect(result.error).toBe('OCR failed');
    });
  });
});
