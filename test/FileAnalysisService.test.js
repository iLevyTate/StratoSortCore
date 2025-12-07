/**
 * Tests for FileAnalysisService
 * Tests file analysis routing and caching
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

// Mock document analysis
jest.mock('../src/main/analysis/ollamaDocumentAnalysis', () => ({
  analyzeDocumentFile: jest.fn().mockResolvedValue({
    category: 'documents',
    subject: 'Test Document',
  }),
}));

// Mock image analysis
jest.mock('../src/main/analysis/ollamaImageAnalysis', () => ({
  analyzeImageFile: jest.fn().mockResolvedValue({
    category: 'images',
    subject: 'Test Image',
  }),
}));

describe('FileAnalysisService', () => {
  let FileAnalysisService;
  let service;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();

    const module = require('../src/main/services/FileAnalysisService');
    FileAnalysisService = module.FileAnalysisService;
    service = new FileAnalysisService();
  });

  describe('constructor', () => {
    test('initializes with empty cache', () => {
      expect(service.fileAnalysisCache).toBeDefined();
      expect(service.fileAnalysisCache.size).toBe(0);
    });

    test('initializes with null ollamaService by default', () => {
      expect(service.ollamaService).toBeNull();
    });

    test('accepts ollamaService dependency', () => {
      const mockOllama = { generate: jest.fn() };
      const serviceWithOllama = new FileAnalysisService(mockOllama);
      expect(serviceWithOllama.ollamaService).toBe(mockOllama);
    });

    test('sets MAX_FILE_CACHE constant', () => {
      expect(service.MAX_FILE_CACHE).toBe(500);
    });
  });

  describe('setFileCache', () => {
    test('adds entry to cache', () => {
      service.setFileCache('sig1', { data: 'test' });
      expect(service.fileAnalysisCache.get('sig1')).toEqual({ data: 'test' });
    });

    test('ignores null signature', () => {
      service.setFileCache(null, { data: 'test' });
      expect(service.fileAnalysisCache.size).toBe(0);
    });

    test('ignores undefined signature', () => {
      service.setFileCache(undefined, { data: 'test' });
      expect(service.fileAnalysisCache.size).toBe(0);
    });

    test('ignores empty string signature', () => {
      service.setFileCache('', { data: 'test' });
      expect(service.fileAnalysisCache.size).toBe(0);
    });

    test('evicts oldest entry when cache exceeds max size', () => {
      // Fill cache to max
      for (let i = 0; i < 500; i++) {
        service.setFileCache(`sig${i}`, { index: i });
      }
      expect(service.fileAnalysisCache.size).toBe(500);

      // Add one more
      service.setFileCache('newSig', { index: 500 });

      // Should still be 500 (oldest evicted)
      expect(service.fileAnalysisCache.size).toBe(500);
      expect(service.fileAnalysisCache.has('sig0')).toBe(false);
      expect(service.fileAnalysisCache.has('newSig')).toBe(true);
    });
  });

  describe('analyze', () => {
    test('routes image files to analyzeImage', async () => {
      const result = await service.analyze('/path/to/image.jpg');

      const {
        analyzeImageFile,
      } = require('../src/main/analysis/ollamaImageAnalysis');
      expect(analyzeImageFile).toHaveBeenCalledWith('/path/to/image.jpg', []);
      expect(result.category).toBe('images');
    });

    test('routes document files to analyzeDocument', async () => {
      const result = await service.analyze('/path/to/document.pdf');

      const {
        analyzeDocumentFile,
      } = require('../src/main/analysis/ollamaDocumentAnalysis');
      expect(analyzeDocumentFile).toHaveBeenCalledWith(
        '/path/to/document.pdf',
        [],
      );
      expect(result.category).toBe('documents');
    });

    test.each([
      ['.jpg'],
      ['.jpeg'],
      ['.png'],
      ['.gif'],
      ['.bmp'],
      ['.webp'],
      ['.svg'],
      ['.tiff'],
    ])('recognizes %s as image extension', async (ext) => {
      await service.analyze(`/path/to/file${ext}`);

      const {
        analyzeImageFile,
      } = require('../src/main/analysis/ollamaImageAnalysis');
      expect(analyzeImageFile).toHaveBeenCalled();
    });

    test.each([['.pdf'], ['.doc'], ['.docx'], ['.txt'], ['.md']])(
      'recognizes %s as document extension',
      async (ext) => {
        await service.analyze(`/path/to/file${ext}`);

        const {
          analyzeDocumentFile,
        } = require('../src/main/analysis/ollamaDocumentAnalysis');
        expect(analyzeDocumentFile).toHaveBeenCalled();
      },
    );

    test('handles uppercase extensions', async () => {
      await service.analyze('/path/to/IMAGE.JPG');

      const {
        analyzeImageFile,
      } = require('../src/main/analysis/ollamaImageAnalysis');
      expect(analyzeImageFile).toHaveBeenCalled();
    });
  });

  describe('analyzeDocument', () => {
    test('analyzes document file', async () => {
      const result = await service.analyzeDocument('/path/to/doc.pdf');

      expect(result.category).toBe('documents');
    });

    test('passes smart folders to analyzer', async () => {
      const folders = [{ name: 'Docs', path: '/docs' }];

      await service.analyzeDocument('/path/to/doc.pdf', folders);

      const {
        analyzeDocumentFile,
      } = require('../src/main/analysis/ollamaDocumentAnalysis');
      expect(analyzeDocumentFile).toHaveBeenCalledWith(
        '/path/to/doc.pdf',
        folders,
      );
    });
  });

  describe('analyzeImage', () => {
    test('analyzes image file', async () => {
      const result = await service.analyzeImage('/path/to/image.png');

      expect(result.category).toBe('images');
    });

    test('passes smart folders to analyzer', async () => {
      const folders = [{ name: 'Photos', path: '/photos' }];

      await service.analyzeImage('/path/to/image.png', folders);

      const {
        analyzeImageFile,
      } = require('../src/main/analysis/ollamaImageAnalysis');
      expect(analyzeImageFile).toHaveBeenCalledWith(
        '/path/to/image.png',
        folders,
      );
    });
  });
});
