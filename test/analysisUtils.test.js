jest.mock('../src/shared/normalization', () => ({
  normalizeError: jest.fn(() => ({
    message: 'normalized',
    errorType: 'TYPE',
    isRetryable: false,
    code: 'CODE'
  })),
  normalizeText: jest.fn((v) => v),
  normalizeOptionalText: jest.fn((v) => v),
  normalizeKeywords: jest.fn((v) => v)
}));

const fs = require('fs').promises;
jest.spyOn(fs, 'stat').mockResolvedValue({ size: 10, mtimeMs: 123 });

const {
  withProcessingState,
  buildErrorContext,
  createAnalysisFallback,
  recordAnalysisResult,
  getFolderCategories
} = require('../src/main/ipc/analysisUtils');

describe('analysisUtils', () => {
  test('withProcessingState marks start and complete', async () => {
    const processingState = {
      markAnalysisStart: jest.fn(),
      markAnalysisComplete: jest.fn()
    };
    const logger = { warn: jest.fn(), debug: jest.fn() };

    const result = await withProcessingState({
      filePath: 'C:\\a.txt',
      processingState,
      logger,
      logPrefix: '[TEST]',
      fn: async () => 'ok'
    });

    expect(result).toBe('ok');
    expect(processingState.markAnalysisStart).toHaveBeenCalled();
    expect(processingState.markAnalysisComplete).toHaveBeenCalled();
  });

  test('withProcessingState marks error on failure', async () => {
    const processingState = {
      markAnalysisStart: jest.fn(),
      markAnalysisError: jest.fn()
    };
    const logger = { warn: jest.fn(), debug: jest.fn() };

    await expect(
      withProcessingState({
        filePath: 'C:\\a.txt',
        processingState,
        logger,
        logPrefix: '[TEST]',
        fn: async () => {
          throw new Error('fail');
        }
      })
    ).rejects.toThrow('fail');

    expect(processingState.markAnalysisError).toHaveBeenCalled();
  });

  test('buildErrorContext returns structured fields', () => {
    const error = new Error('boom');
    const ctx = buildErrorContext({ operation: 'op', filePath: 'C:\\a.txt', error });
    expect(ctx.fileName).toBe('a.txt');
    expect(ctx.operation).toBe('op');
  });

  test('createAnalysisFallback uses normalized error', () => {
    const fallback = createAnalysisFallback('C:\\a.txt', 'documents', 'bad');
    expect(fallback.error).toBe('normalized');
    expect(fallback.errorCode).toBe('CODE');
  });

  test('recordAnalysisResult writes to history', async () => {
    const analysisHistory = { recordAnalysis: jest.fn() };
    const logger = { warn: jest.fn() };
    await recordAnalysisResult({
      filePath: 'C:\\a.txt',
      result: { category: 'docs', confidence: 0.5 },
      processingTime: 10,
      modelType: 'llm',
      analysisHistory,
      logger
    });

    expect(analysisHistory.recordAnalysis).toHaveBeenCalled();
  });

  test('getFolderCategories handles errors', () => {
    const logger = { warn: jest.fn() };
    const result = getFolderCategories(
      () => {
        throw new Error('fail');
      },
      (folders) => folders,
      logger
    );
    expect(result).toEqual([]);
  });
});
