/**
 * Edge/bug-catching tests for BatchAnalysisService
 * Focus: backpressure loop safety, embedding progress unsubscribe, and grouped analysis resilience.
 */

jest.mock('../src/shared/logger', () => ({
  createLogger: () => ({
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  })
}));

jest.mock('../src/shared/config/index', () => ({
  get: jest.fn((_, fallback) => fallback)
}));

const mockBatchProcessor = {
  concurrencyLimit: 3,
  processBatch: jest.fn()
};

jest.mock('../src/main/utils/llmOptimization', () => ({
  globalBatchProcessor: mockBatchProcessor
}));

jest.mock('../src/main/analysis/documentAnalysis', () => ({
  analyzeDocumentFile: jest.fn(),
  flushAllEmbeddings: jest.fn()
}));

jest.mock('../src/main/analysis/imageAnalysis', () => ({
  analyzeImageFile: jest.fn(),
  flushAllEmbeddings: jest.fn()
}));

jest.mock('../src/main/services/ParallelEmbeddingService', () => ({
  getInstance: jest.fn(() => ({
    concurrencyLimit: 3,
    getStats: jest.fn(() => ({ processed: 0, failed: 0, pending: 0 }))
  }))
}));

const mockAnalysisQueue = {
  getStats: jest.fn(),
  onProgress: jest.fn()
};

jest.mock('../src/main/analysis/embeddingQueue/stageQueues', () => ({
  analysisQueue: mockAnalysisQueue
}));

jest.mock('../src/main/services/autoOrganize/fileTypeUtils', () => ({
  getFileTypeCategory: jest.fn((ext) => (ext === '.jpg' ? 'Images' : 'Documents'))
}));

describe('BatchAnalysisService (edge)', () => {
  const flushMicrotasks = async () => {
    await Promise.resolve();
    await Promise.resolve();
  };

  const advance = async (ms) => {
    if (typeof jest.advanceTimersByTimeAsync === 'function') {
      await jest.advanceTimersByTimeAsync(ms);
      return;
    }
    jest.advanceTimersByTime(ms);
    await flushMicrotasks();
  };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();

    // default queue stats
    mockAnalysisQueue.getStats.mockReturnValue({
      queueLength: 0,
      failedItemsCount: 0,
      deadLetterCount: 0,
      capacityPercent: 0
    });
    mockAnalysisQueue.onProgress.mockReturnValue(() => {});

    const {
      analyzeDocumentFile,
      flushAllEmbeddings: flushDocs
    } = require('../src/main/analysis/documentAnalysis');
    const {
      analyzeImageFile,
      flushAllEmbeddings: flushImages
    } = require('../src/main/analysis/imageAnalysis');
    analyzeDocumentFile.mockResolvedValue({ ok: true });
    analyzeImageFile.mockResolvedValue({ ok: true });
    flushDocs.mockResolvedValue(undefined);
    flushImages.mockResolvedValue(undefined);

    mockBatchProcessor.processBatch.mockImplementation(async (items, processor, options) => {
      const results = [];
      const errors = [];
      let successful = 0;
      for (let i = 0; i < items.length; i++) {
        const r = await processor(items[i], i);
        results.push(r);
        if (r.success) successful++;
        if (options?.onProgress)
          options.onProgress({ completed: i + 1, total: items.length, percent: 100 });
        if (options?.stopOnError && !r.success) break;
      }
      return { results, errors, successful };
    });
  });

  test('analyzeFiles unsubscribes embedding progress even if execution throws', async () => {
    const unsubscribe = jest.fn();
    mockAnalysisQueue.onProgress.mockReturnValueOnce(unsubscribe);
    mockBatchProcessor.processBatch.mockRejectedValueOnce(new Error('boom'));

    const BatchAnalysisService = require('../src/main/services/BatchAnalysisService');
    const service = new BatchAnalysisService({ concurrency: 1 });

    await expect(
      service.analyzeFiles(['C:\\a.pdf'], [], { onEmbeddingProgress: jest.fn() })
    ).rejects.toThrow('boom');
    expect(unsubscribe).toHaveBeenCalled();
  });

  test('backpressure waits for queue to drain but does not loop forever (drain scenario)', async () => {
    jest.useFakeTimers();
    let calls = 0;
    mockAnalysisQueue.getStats.mockImplementation(() => {
      calls++;
      if (calls === 1)
        return { queueLength: 100, capacityPercent: 80, failedItemsCount: 0, deadLetterCount: 0 };
      if (calls <= 3)
        return { queueLength: 80, capacityPercent: 60, failedItemsCount: 0, deadLetterCount: 0 };
      return { queueLength: 10, capacityPercent: 40, failedItemsCount: 0, deadLetterCount: 0 };
    });

    const BatchAnalysisService = require('../src/main/services/BatchAnalysisService');
    const service = new BatchAnalysisService({ concurrency: 1 });

    const p = service.analyzeFiles(['C:\\a.pdf'], [], { concurrency: 1 });
    // backpressure loop sleeps at least 500ms then 750ms (1.5x) before draining
    await advance(500);
    await advance(800);

    await expect(p).resolves.toEqual(expect.objectContaining({ total: 1, successful: 1 }));

    jest.useRealTimers();
  });

  test('flushAllEmbeddings failures are tolerated (Promise.allSettled)', async () => {
    const { flushAllEmbeddings: flushDocs } = require('../src/main/analysis/documentAnalysis');
    const { flushAllEmbeddings: flushImages } = require('../src/main/analysis/imageAnalysis');
    flushDocs.mockRejectedValueOnce(new Error('docs flush failed'));
    flushImages.mockRejectedValueOnce(new Error('images flush failed'));

    const BatchAnalysisService = require('../src/main/services/BatchAnalysisService');
    const service = new BatchAnalysisService({ concurrency: 1 });

    const result = await service.analyzeFiles(['C:\\a.pdf'], [], {});
    expect(result.success).toBe(true);
    expect(result.successful).toBe(1);
  });

  test('analyzeFilesGrouped merges fulfilled groups and tolerates a rejected group', async () => {
    const BatchAnalysisService = require('../src/main/services/BatchAnalysisService');
    const service = new BatchAnalysisService({ concurrency: 1 });

    // Force analyzeFiles to reject for one group
    const orig = service.analyzeFiles.bind(service);
    jest.spyOn(service, 'analyzeFiles').mockImplementation(async (files, folders, options) => {
      if (files.some((f) => f.endsWith('.jpg'))) {
        throw new Error('group failed');
      }
      return orig(files, folders, options);
    });

    const res = await service.analyzeFilesGrouped(['C:\\a.pdf', 'C:\\b.jpg'], [], {});
    expect(res.total).toBe(2);
    expect(res.results.length).toBe(1); // only pdf fulfilled
  });
});
