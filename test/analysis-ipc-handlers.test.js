// Mock dependencies
const mockPerformance = {
  now: jest.fn().mockReturnValue(1000)
};
jest.mock('perf_hooks', () => ({
  performance: mockPerformance
}));

const mockRecognizeIfAvailable = jest.fn();
const mockBatchAnalyzeFiles = jest.fn();

// Mock IPC wrappers
const mockIpcWrappers = {
  createHandler: jest.fn(({ handler }) => handler),
  withErrorLogging: jest.fn((logger, handler) => handler),
  withValidation: jest.fn((logger, schema, handler) => handler), // Bypass validation logic for testing handler logic directly
  safeHandle: jest.fn(),
  z: null
};
jest.mock('../src/main/ipc/ipcWrappers', () => mockIpcWrappers);

// Mock utils
jest.mock('../src/main/utils/safeAccess', () => ({
  safeFilePath: jest.fn((path) => path)
}));
jest.mock('../src/shared/pathSanitization', () => ({
  validateFileOperationPath: jest.fn(async (path) => ({ valid: true, normalizedPath: path }))
}));

jest.mock('../src/shared/folderUtils', () => ({
  mapFoldersToCategories: jest.fn().mockReturnValue(['cat1']),
  getFolderNamesString: jest.fn().mockReturnValue('cat1')
}));

jest.mock('../src/shared/logger', () => {
  const logger = {
    debug: jest.fn(),
    info: jest.fn(),
    error: jest.fn()
  };
  return { logger, createLogger: jest.fn(() => logger) };
});

const mockAnalysisUtils = {
  withProcessingState: jest.fn(),
  buildErrorContext: jest.fn().mockReturnValue({}),
  createAnalysisFallback: jest.fn().mockReturnValue({ fallback: true }),
  recordAnalysisResult: jest.fn(),
  getFolderCategories: jest.fn().mockReturnValue(['cat1'])
};
jest.mock('../src/main/ipc/analysisUtils', () => mockAnalysisUtils);

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

// Mock System Analytics
const mockSystemAnalytics = {
  recordProcessingTime: jest.fn(),
  recordFailure: jest.fn()
};

const registerAnalysisIpc = require('../src/main/ipc/analysis');
const { validateFileOperationPath } = require('../src/shared/pathSanitization');

describe('Analysis IPC Handlers', () => {
  let mockIpcMain;
  let mockLogger;
  let mockAnalyzeDocumentFile;
  let mockAnalyzeImageFile;
  let mockGetServiceIntegration;
  let mockGetCustomFolders;
  let registeredHandlers = {};

  const IPC_CHANNELS = {
    ANALYSIS: {
      ANALYZE_DOCUMENT: 'analyze-document',
      ANALYZE_IMAGE: 'analyze-image',
      ANALYZE_BATCH: 'analyze-batch',
      CANCEL_BATCH: 'cancel-batch',
      EXTRACT_IMAGE_TEXT: 'extract-image-text'
    }
  };

  beforeEach(() => {
    jest.clearAllMocks();
    registeredHandlers = {};
    mockRecognizeIfAvailable.mockReset();
    mockBatchAnalyzeFiles.mockReset();
    mockBatchAnalyzeFiles.mockResolvedValue({
      success: true,
      results: [],
      errors: [],
      total: 0,
      successful: 0
    });

    mockIpcMain = {
      handle: jest.fn((channel, handler) => {
        registeredHandlers[channel] = handler;
      })
    };

    // safeHandle calls ipcMain.handle
    mockIpcWrappers.safeHandle.mockImplementation((ipc, channel, handler) => {
      registeredHandlers[channel] = handler;
    });

    mockLogger = {
      info: jest.fn(),
      error: jest.fn(),
      debug: jest.fn()
    };

    mockAnalyzeDocumentFile = jest.fn();
    mockAnalyzeImageFile = jest.fn();

    mockGetServiceIntegration = jest.fn().mockReturnValue({
      processingState: {},
      analysisHistory: {}
    });

    mockGetCustomFolders = jest.fn().mockReturnValue([]);

    // Register handlers
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

  describe('ANALYZE_DOCUMENT', () => {
    test('successfully analyzes document', async () => {
      const handler = registeredHandlers[IPC_CHANNELS.ANALYSIS.ANALYZE_DOCUMENT];
      expect(handler).toBeDefined();

      const mockResult = { analysis: 'success' };
      mockAnalyzeDocumentFile.mockResolvedValue(mockResult);

      // Mock withProcessingState to execute the passed function
      mockAnalysisUtils.withProcessingState.mockImplementation(async ({ fn }) => fn());

      const result = await handler({}, '/path/to/doc.pdf');

      expect(validateFileOperationPath).toHaveBeenCalledWith(
        '/path/to/doc.pdf',
        expect.objectContaining({
          requireExists: true,
          checkSymlinks: true
        })
      );
      expect(mockAnalysisUtils.withProcessingState).toHaveBeenCalled();
      expect(mockAnalysisUtils.getFolderCategories).toHaveBeenCalled();
      expect(mockAnalyzeDocumentFile).toHaveBeenCalledWith('/path/to/doc.pdf', ['cat1']);
      expect(mockSystemAnalytics.recordProcessingTime).toHaveBeenCalled();
      expect(mockAnalysisUtils.recordAnalysisResult).toHaveBeenCalled();
      expect(result).toEqual(mockResult);
    });

    test('handles analysis errors', async () => {
      const handler = registeredHandlers[IPC_CHANNELS.ANALYSIS.ANALYZE_DOCUMENT];
      const error = new Error('Analysis failed');

      mockAnalysisUtils.withProcessingState.mockRejectedValue(error);

      const result = await handler({}, '/path/to/doc.pdf');

      expect(mockLogger.error).toHaveBeenCalled();
      expect(mockAnalysisUtils.buildErrorContext).toHaveBeenCalled();
      expect(mockSystemAnalytics.recordFailure).toHaveBeenCalledWith(error);
      expect(mockAnalysisUtils.createAnalysisFallback).toHaveBeenCalled();
      expect(result).toEqual({ fallback: true });
    });

    test('handles invalid file path', async () => {
      const handler = registeredHandlers[IPC_CHANNELS.ANALYSIS.ANALYZE_DOCUMENT];
      validateFileOperationPath.mockResolvedValueOnce({
        valid: false,
        normalizedPath: '',
        error: 'Invalid path: access to system directories is not allowed'
      });

      // Should be caught by the catch block inside performDocumentAnalysis because it throws Error
      // But since we are calling handler directly which is performDocumentAnalysis wrapped, we need to see how it behaves
      // The performDocumentAnalysis function throws, and if not wrapped by withErrorLogging/ProcessingState properly in test, it rejects.
      // However, we mocked withProcessingState to not run logic yet for this test case or if it throws before.
      // The throw happens BEFORE withProcessingState.

      // We expect the handler to throw, and the IPC wrapper (mocked) to handle it or bubble up.
      // In production, withErrorLogging catches it. Here our mock just returns the handler.
      // So we expect rejection.

      await expect(handler({}, '/invalid/path')).rejects.toThrow(
        'Invalid path: access to system directories is not allowed'
      );
    });
  });

  describe('ANALYZE_IMAGE', () => {
    test('successfully analyzes image', async () => {
      const handler = registeredHandlers[IPC_CHANNELS.ANALYSIS.ANALYZE_IMAGE];
      expect(handler).toBeDefined();

      const mockResult = { analysis: 'image success' };
      mockAnalyzeImageFile.mockResolvedValue(mockResult);

      mockAnalysisUtils.withProcessingState.mockImplementation(async ({ fn }) => fn());

      const result = await handler({}, '/path/to/image.png');

      expect(mockAnalyzeImageFile).toHaveBeenCalledWith('/path/to/image.png', ['cat1']);
      expect(mockAnalysisUtils.recordAnalysisResult).toHaveBeenCalledWith(
        expect.objectContaining({ modelType: 'vision' })
      );
      expect(result).toEqual(mockResult);
    });

    test('handles image analysis errors', async () => {
      const handler = registeredHandlers[IPC_CHANNELS.ANALYSIS.ANALYZE_IMAGE];
      const error = new Error('Vision failed');

      mockAnalysisUtils.withProcessingState.mockRejectedValue(error);

      const result = await handler({}, '/path/to/image.png');

      expect(mockLogger.error).toHaveBeenCalled();
      expect(mockAnalysisUtils.createAnalysisFallback).toHaveBeenCalledWith(
        expect.any(String),
        'images',
        error.message
      );
      expect(result).toEqual({ fallback: true });
    });
  });

  describe('EXTRACT_IMAGE_TEXT', () => {
    test('successfully extracts text', async () => {
      const handler = registeredHandlers[IPC_CHANNELS.ANALYSIS.EXTRACT_IMAGE_TEXT];
      expect(handler).toBeDefined();

      mockRecognizeIfAvailable.mockResolvedValue({ success: true, text: 'extracted text' });

      const result = await handler({}, '/path/to/img.png');

      expect(mockRecognizeIfAvailable).toHaveBeenCalledWith(
        null,
        '/path/to/img.png',
        expect.objectContaining({
          lang: 'eng',
          oem: 1,
          psm: 3
        })
      );
      expect(mockSystemAnalytics.recordProcessingTime).toHaveBeenCalled();
      expect(result).toEqual({ success: true, text: 'extracted text' });
    });

    test('handles OCR errors', async () => {
      const handler = registeredHandlers[IPC_CHANNELS.ANALYSIS.EXTRACT_IMAGE_TEXT];
      const error = new Error('OCR failed');
      mockRecognizeIfAvailable.mockResolvedValue({
        success: false,
        error: 'OCR failed',
        cause: error
      });

      const result = await handler({}, '/path/to/img.png');

      expect(mockLogger.error).toHaveBeenCalledWith('OCR failed:', error);
      expect(mockSystemAnalytics.recordFailure).toHaveBeenCalledWith(error);
      expect(result).toEqual({ success: false, error: 'OCR failed' });
    });
  });

  describe('ANALYZE_BATCH', () => {
    test('uses batch analysis service', async () => {
      const handler = registeredHandlers[IPC_CHANNELS.ANALYSIS.ANALYZE_BATCH];
      expect(handler).toBeDefined();

      mockBatchAnalyzeFiles.mockResolvedValueOnce({
        success: true,
        results: [
          { filePath: '/path/to/doc.pdf', success: true, result: { suggestedName: 'doc' } }
        ],
        errors: [],
        total: 1,
        successful: 1
      });

      const result = await handler({}, { filePaths: ['/path/to/doc.pdf'] });
      expect(mockBatchAnalyzeFiles).toHaveBeenCalled();
      expect(result.success).toBe(true);
      expect(result.total).toBe(1);
    });
  });
});
