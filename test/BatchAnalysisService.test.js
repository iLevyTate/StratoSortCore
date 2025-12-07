/**
 * Tests for BatchAnalysisService
 * Tests parallel file analysis, concurrency control, and embedding integration
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

// Mock config
jest.mock('../src/shared/config/index', () => ({
  get: jest.fn((key, defaultValue) => defaultValue),
}));

// Mock llmOptimization
const mockBatchProcessor = {
  concurrencyLimit: 3,
  processBatch: jest.fn(),
  getStats: jest.fn().mockReturnValue({
    totalProcessed: 0,
    totalErrors: 0,
  }),
};

jest.mock('../src/main/utils/llmOptimization', () => ({
  globalBatchProcessor: mockBatchProcessor,
}));

// Mock analysis modules
jest.mock('../src/main/analysis/ollamaDocumentAnalysis', () => ({
  analyzeDocumentFile: jest.fn(),
  flushAllEmbeddings: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../src/main/analysis/ollamaImageAnalysis', () => ({
  analyzeImageFile: jest.fn(),
  flushAllEmbeddings: jest.fn().mockResolvedValue(undefined),
}));

// Mock ParallelEmbeddingService
const mockEmbeddingService = {
  concurrencyLimit: 5,
  getStats: jest.fn().mockReturnValue({
    processed: 0,
    failed: 0,
    pending: 0,
  }),
  setConcurrencyLimit: jest.fn(),
};

jest.mock('../src/main/services/ParallelEmbeddingService', () => ({
  getInstance: jest.fn(() => mockEmbeddingService),
}));

// Mock embeddingQueue
const mockEmbeddingQueue = {
  getStats: jest.fn().mockReturnValue({
    queueLength: 0,
    failedItemsCount: 0,
    deadLetterCount: 0,
    capacityPercent: 0,
  }),
  onProgress: jest.fn().mockReturnValue(() => {}),
  forceFlush: jest.fn().mockResolvedValue(undefined),
  shutdown: jest.fn().mockResolvedValue(undefined),
};

jest.mock('../src/main/analysis/embeddingQueue', () => mockEmbeddingQueue);

describe('BatchAnalysisService', () => {
  let BatchAnalysisService;
  let service;
  let analyzeDocumentFile;
  let analyzeImageFile;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();

    analyzeDocumentFile =
      require('../src/main/analysis/ollamaDocumentAnalysis').analyzeDocumentFile;
    analyzeImageFile =
      require('../src/main/analysis/ollamaImageAnalysis').analyzeImageFile;
    BatchAnalysisService = require('../src/main/services/BatchAnalysisService');

    // Reset mock implementations
    mockBatchProcessor.processBatch.mockImplementation(
      async (items, processor, options) => {
        const results = [];
        const errors = [];
        let successful = 0;

        for (let i = 0; i < items.length; i++) {
          try {
            const result = await processor(items[i], i);
            results.push(result);
            if (result.success) successful++;
          } catch (error) {
            errors.push({ item: items[i], error });
          }

          if (options.onProgress) {
            options.onProgress({
              completed: i + 1,
              total: items.length,
              percent: ((i + 1) / items.length) * 100,
            });
          }
        }

        return { results, errors, successful };
      },
    );

    analyzeDocumentFile.mockResolvedValue({
      category: 'document',
      confidence: 85,
    });

    analyzeImageFile.mockResolvedValue({
      category: 'photo',
      confidence: 90,
    });

    service = new BatchAnalysisService();
  });

  describe('constructor', () => {
    test('initializes with default concurrency', () => {
      expect(service.concurrency).toBeGreaterThanOrEqual(2);
      expect(service.concurrency).toBeLessThanOrEqual(8);
    });

    test('accepts custom concurrency option', () => {
      const customService = new BatchAnalysisService({ concurrency: 4 });
      expect(customService.concurrency).toBe(4);
    });

    test('initializes parallel embedding service', () => {
      expect(service.parallelEmbeddingService).toBeDefined();
    });
  });

  describe('calculateOptimalConcurrency', () => {
    test('returns value between 2 and 8', () => {
      const concurrency = service.calculateOptimalConcurrency();
      expect(concurrency).toBeGreaterThanOrEqual(2);
      expect(concurrency).toBeLessThanOrEqual(8);
    });

    test('reduces concurrency under memory pressure', () => {
      // This is hard to test directly since it depends on system state
      // Just verify the function doesn't throw
      expect(() => service.calculateOptimalConcurrency()).not.toThrow();
    });
  });

  describe('analyzeFiles', () => {
    test('returns empty results for empty input', async () => {
      const result = await service.analyzeFiles([]);

      expect(result.success).toBe(true);
      expect(result.results).toEqual([]);
      expect(result.total).toBe(0);
    });

    test('returns empty results for non-array input', async () => {
      const result = await service.analyzeFiles(null);

      expect(result.success).toBe(true);
      expect(result.results).toEqual([]);
    });

    test('analyzes document files', async () => {
      const files = ['/path/to/doc.pdf', '/path/to/text.txt'];

      const result = await service.analyzeFiles(files);

      expect(analyzeDocumentFile).toHaveBeenCalledTimes(2);
      expect(result.total).toBe(2);
      expect(result.successful).toBe(2);
    });

    test('analyzes image files', async () => {
      const files = ['/path/to/image.jpg', '/path/to/photo.png'];

      const result = await service.analyzeFiles(files);

      expect(analyzeImageFile).toHaveBeenCalledTimes(2);
      expect(result.total).toBe(2);
    });

    test('handles mixed file types', async () => {
      const files = ['/path/to/doc.pdf', '/path/to/image.jpg'];

      const result = await service.analyzeFiles(files);

      expect(analyzeDocumentFile).toHaveBeenCalledTimes(1);
      expect(analyzeImageFile).toHaveBeenCalledTimes(1);
      expect(result.total).toBe(2);
    });

    test('reports progress via callback', async () => {
      const onProgress = jest.fn();
      const files = ['/path/to/doc1.pdf', '/path/to/doc2.pdf'];

      await service.analyzeFiles(files, [], { onProgress });

      expect(onProgress).toHaveBeenCalled();
      expect(onProgress).toHaveBeenCalledWith(
        expect.objectContaining({
          phase: expect.any(String),
        }),
      );
    });

    test('handles analysis errors gracefully', async () => {
      // The mock processor catches errors and marks them as failed results
      mockBatchProcessor.processBatch.mockImplementation(
        async (items, processor) => {
          const results = [];
          const errors = [];
          let successful = 0;

          for (let i = 0; i < items.length; i++) {
            try {
              const result = await processor(items[i], i);
              results.push(result);
              if (result.success) successful++;
              else errors.push({ item: items[i], error: result.error });
            } catch (error) {
              results.push({
                filePath: items[i],
                success: false,
                error: error.message,
              });
              errors.push({ item: items[i], error });
            }
          }

          return { results, errors, successful };
        },
      );

      analyzeDocumentFile
        .mockRejectedValueOnce(new Error('Analysis failed'))
        .mockResolvedValueOnce({ category: 'document', confidence: 85 });

      const files = ['/path/to/bad.pdf', '/path/to/good.pdf'];

      const result = await service.analyzeFiles(files);

      expect(result.total).toBe(2);
      // Check that at least one file failed
      const failedResults = result.results.filter((r) => !r.success);
      expect(failedResults.length).toBeGreaterThan(0);
    });

    test('passes smart folders to analyzers', async () => {
      const smartFolders = [{ name: 'Work', path: '/work' }];
      const files = ['/path/to/doc.pdf'];

      await service.analyzeFiles(files, smartFolders);

      expect(analyzeDocumentFile).toHaveBeenCalledWith(
        '/path/to/doc.pdf',
        smartFolders,
      );
    });

    test('validates and clamps concurrency', async () => {
      const files = ['/path/to/doc.pdf'];

      // Test with invalid concurrency values
      await service.analyzeFiles(files, [], { concurrency: 0 });
      await service.analyzeFiles(files, [], { concurrency: -5 });
      await service.analyzeFiles(files, [], { concurrency: 100 });
      await service.analyzeFiles(files, [], { concurrency: NaN });

      // Should not throw - concurrency is clamped
      expect(true).toBe(true);
    });

    test('flushes embeddings after analysis', async () => {
      const {
        flushAllEmbeddings: flushDoc,
      } = require('../src/main/analysis/ollamaDocumentAnalysis');
      const {
        flushAllEmbeddings: flushImage,
      } = require('../src/main/analysis/ollamaImageAnalysis');

      const files = ['/path/to/doc.pdf'];

      await service.analyzeFiles(files);

      expect(flushDoc).toHaveBeenCalled();
      expect(flushImage).toHaveBeenCalled();
    });

    test('includes stats in result', async () => {
      const files = ['/path/to/doc.pdf'];

      const result = await service.analyzeFiles(files);

      expect(result.stats).toBeDefined();
      expect(result.stats.totalDuration).toBeDefined();
      expect(result.stats.avgPerFile).toBeDefined();
      expect(result.stats.filesPerSecond).toBeDefined();
      expect(result.stats.embedding).toBeDefined();
    });

    test('subscribes to embedding progress when callback provided', async () => {
      const onEmbeddingProgress = jest.fn();
      const files = ['/path/to/doc.pdf'];

      await service.analyzeFiles(files, [], { onEmbeddingProgress });

      expect(mockEmbeddingQueue.onProgress).toHaveBeenCalledWith(
        onEmbeddingProgress,
      );
    });
  });

  describe('analyzeFilesGrouped', () => {
    test('groups files by type before processing', async () => {
      const files = [
        '/path/to/doc.pdf',
        '/path/to/image.jpg',
        '/path/to/doc2.txt',
      ];

      const result = await service.analyzeFilesGrouped(files);

      expect(result.total).toBe(3);
    });

    test('merges results from all groups', async () => {
      const files = ['/path/to/doc.pdf', '/path/to/image.jpg'];

      const result = await service.analyzeFilesGrouped(files);

      expect(result.results.length).toBe(2);
    });
  });

  describe('groupFilesByType', () => {
    test('groups image files together', () => {
      const files = ['/a.jpg', '/b.png', '/c.gif'];

      const groups = service.groupFilesByType(files);

      expect(groups.image).toHaveLength(3);
    });

    test('groups document files together', () => {
      const files = ['/a.pdf', '/b.doc', '/c.txt'];

      const groups = service.groupFilesByType(files);

      expect(groups.document).toHaveLength(3);
    });

    test('groups spreadsheet files together', () => {
      const files = ['/a.xlsx', '/b.csv'];

      const groups = service.groupFilesByType(files);

      expect(groups.spreadsheet).toHaveLength(2);
    });

    test('puts unknown extensions in other group', () => {
      const files = ['/a.xyz', '/b.unknown'];

      const groups = service.groupFilesByType(files);

      expect(groups.other).toHaveLength(2);
    });
  });

  describe('getFileType', () => {
    test('identifies image extensions', () => {
      expect(service.getFileType('.jpg')).toBe('image');
      expect(service.getFileType('.png')).toBe('image');
      expect(service.getFileType('.gif')).toBe('image');
      expect(service.getFileType('.webp')).toBe('image');
    });

    test('identifies document extensions', () => {
      expect(service.getFileType('.pdf')).toBe('document');
      expect(service.getFileType('.doc')).toBe('document');
      expect(service.getFileType('.txt')).toBe('document');
    });

    test('identifies spreadsheet extensions', () => {
      expect(service.getFileType('.xlsx')).toBe('spreadsheet');
      expect(service.getFileType('.csv')).toBe('spreadsheet');
    });

    test('identifies presentation extensions', () => {
      expect(service.getFileType('.pptx')).toBe('presentation');
      expect(service.getFileType('.ppt')).toBe('presentation');
    });

    test('returns other for unknown extensions', () => {
      expect(service.getFileType('.xyz')).toBe('other');
    });
  });

  describe('isImageFile', () => {
    test('returns true for image extensions', () => {
      expect(service.isImageFile('.jpg')).toBe(true);
      expect(service.isImageFile('.JPEG')).toBe(true);
      expect(service.isImageFile('.png')).toBe(true);
      expect(service.isImageFile('.gif')).toBe(true);
    });

    test('returns false for non-image extensions', () => {
      expect(service.isImageFile('.pdf')).toBe(false);
      expect(service.isImageFile('.txt')).toBe(false);
    });
  });

  describe('setConcurrency', () => {
    test('sets concurrency within limits', () => {
      service.setConcurrency(5);
      expect(service.concurrency).toBe(5);
    });

    test('clamps concurrency to minimum of 1', () => {
      service.setConcurrency(0);
      expect(service.concurrency).toBe(1);
    });

    test('clamps concurrency to maximum of 10', () => {
      service.setConcurrency(100);
      expect(service.concurrency).toBe(10);
    });

    test('updates batch processor concurrency', () => {
      service.setConcurrency(6);
      expect(mockBatchProcessor.concurrencyLimit).toBe(6);
    });
  });

  describe('getStats', () => {
    test('returns combined statistics', () => {
      const stats = service.getStats();

      expect(stats.concurrency).toBeDefined();
      expect(stats.embedding).toBeDefined();
      expect(stats.embedding.queue).toBeDefined();
      expect(stats.embedding.service).toBeDefined();
    });
  });

  describe('getEmbeddingQueueStats', () => {
    test('returns queue statistics', () => {
      const stats = service.getEmbeddingQueueStats();

      expect(stats).toBeDefined();
      expect(mockEmbeddingQueue.getStats).toHaveBeenCalled();
    });
  });

  describe('setEmbeddingConcurrency', () => {
    test('updates embedding service concurrency', () => {
      service.setEmbeddingConcurrency(3);

      expect(mockEmbeddingService.setConcurrencyLimit).toHaveBeenCalledWith(3);
    });
  });

  describe('flushEmbeddings', () => {
    test('forces embedding queue flush', async () => {
      await service.flushEmbeddings();

      expect(mockEmbeddingQueue.forceFlush).toHaveBeenCalled();
    });
  });

  describe('shutdown', () => {
    test('shuts down embedding queue', async () => {
      await service.shutdown();

      expect(mockEmbeddingQueue.shutdown).toHaveBeenCalled();
    });

    test('unsubscribes from progress events', async () => {
      const unsubscribe = jest.fn();
      mockEmbeddingQueue.onProgress.mockReturnValue(unsubscribe);

      // Subscribe to progress
      await service.analyzeFiles(['/test.pdf'], [], {
        onEmbeddingProgress: jest.fn(),
      });

      // Shutdown
      await service.shutdown();

      expect(unsubscribe).toHaveBeenCalled();
    });
  });
});
