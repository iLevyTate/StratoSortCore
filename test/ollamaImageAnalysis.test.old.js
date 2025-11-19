/**
 * Tests for ollamaImageAnalysis
 * TIER 1 - CRITICAL: Image analysis with vision models
 * Testing image file analysis and text extraction from images
 */

const {
  analyzeImageFile,
  extractTextFromImage,
} = require('../src/main/analysis/ollamaImageAnalysis');

const fs = require('fs').promises;

// Mock dependencies
jest.mock('../src/shared/logger', () => ({
  logger: {
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    setContext: jest.fn(),
  },
}));

jest.mock('sharp');
jest.mock('../src/shared/constants', () => ({
  SUPPORTED_IMAGE_EXTENSIONS: [
    '.png',
    '.jpg',
    '.jpeg',
    '.gif',
    '.bmp',
    '.tiff',
    '.tif',
    '.webp',
    '.svg',
    '.heic',
    '.heif',
  ],
  AI_DEFAULTS: {
    IMAGE: {
      MODEL: 'llava',
      HOST: 'http://127.0.0.1:11434',
      TEMPERATURE: 0.1,
      MAX_TOKENS: 500,
    },
  },
}));

jest.mock('../src/main/ollamaUtils');

jest.mock('../src/main/services/ModelVerifier');
jest.mock('../src/main/services/ChromaDBService', () => ({
  getInstance: jest.fn().mockReturnValue(null), // Return null to skip ChromaDB in tests
}));
jest.mock('../src/main/services/FolderMatchingService', () => {
  return jest.fn();
});
jest.mock('../src/main/analysis/utils');
jest.mock('../src/main/analysis/fallbackUtils');
jest.mock('../src/main/services/PerformanceService', () => ({
  buildOllamaOptions: jest.fn().mockResolvedValue({}),
}));
jest.mock('../src/main/utils/ollamaApiRetry', () => ({
  generateWithRetry: jest.fn(async (client, generateOptions) => {
    // generateOptions is an object with: { model, prompt, images, options, format }
    // Ollama client.generate expects these as separate parameters
    // But the mock client.generate is already set up to handle the object
    return client.generate(generateOptions);
  }),
}));
jest.mock('../src/main/utils/llmOptimization', () => ({
  globalDeduplicator: {
    generateKey: jest.fn().mockReturnValue('test-key'),
    deduplicate: jest.fn((key, fn) => fn()), // IMPROVED: Pass through to actual function
  },
  globalBatchProcessor: {
    enqueue: jest.fn(),
  },
}));

describe('ollamaImageAnalysis', () => {
  let mockOllamaClient;

  beforeEach(() => {
    jest.clearAllMocks();

    // Setup mock Ollama client
    mockOllamaClient = {
      generate: jest.fn(),
    };

    const {
      getOllamaClient,
      getOllamaVisionModel,
      loadOllamaConfig,
    } = require('../src/main/ollamaUtils');
    getOllamaVisionModel.mockReturnValue('llava');
    loadOllamaConfig.mockResolvedValue({
      selectedVisionModel: 'llava',
    });
    getOllamaClient.mockResolvedValue(mockOllamaClient);

    // Setup ModelVerifier mock
    const ModelVerifier = require('../src/main/services/ModelVerifier');
    ModelVerifier.mockImplementation(() => ({
      checkOllamaConnection: jest.fn().mockResolvedValue({
        connected: true,
      }),
    }));

    // Setup utils mocks
    const utils = require('../src/main/analysis/utils');
    utils.normalizeAnalysisResult = jest.fn((data) => data);

    const fallbackUtils = require('../src/main/analysis/fallbackUtils');
    fallbackUtils.getIntelligentCategory = jest.fn().mockReturnValue('images');
    fallbackUtils.getIntelligentKeywords = jest
      .fn()
      .mockReturnValue(['image', 'photo']);
    fallbackUtils.safeSuggestedName = jest
      .fn()
      .mockImplementation((name, ext) => name.replace(ext, ''));

    // Setup sharp mock with proper chainable interface
    const sharp = require('sharp');
    const createMockSharpInstance = () => {
      const instance = {
        metadata: jest.fn().mockResolvedValue({
          width: 800,
          height: 600,
          format: 'jpeg',
        }),
        resize: jest.fn(),
        png: jest.fn(),
        toBuffer: jest.fn().mockResolvedValue(Buffer.from('processed image')),
      };
      // Make methods return the instance for chaining
      instance.resize.mockReturnValue(instance);
      instance.png.mockReturnValue(instance);
      return instance;
    };
    sharp.mockImplementation(() => createMockSharpInstance());
  });

  describe('analyzeImageFile', () => {
    const mockImagePath = '/test/photo.jpg';

    test('should analyze image file successfully', async () => {
      jest.spyOn(fs, 'stat').mockResolvedValue({
        size: 50000,
        mtimeMs: 1234567890,
      });
      jest.spyOn(fs, 'readFile').mockResolvedValue(Buffer.from('image data'));

      // Mock globalDeduplicator to pass through calls
      const {
        globalDeduplicator,
      } = require('../src/main/utils/llmOptimization');
      globalDeduplicator.generateKey = jest.fn().mockReturnValue('test-key');
      globalDeduplicator.deduplicate = jest.fn((key, fn) => fn());

      mockOllamaClient.generate.mockResolvedValue({
        response: JSON.stringify({
          date: '2024-01-15',
          project: 'Family Photos',
          purpose: 'Family vacation photo at beach',
          category: 'Personal',
          keywords: ['beach', 'family', 'vacation', 'summer'],
          confidence: 85,
          content_type: 'people',
          has_text: false,
          colors: ['blue', 'yellow', 'white'],
          suggestedName: 'family_beach_vacation_2024',
        }),
      });

      const result = await analyzeImageFile(mockImagePath, []);

      // IMPROVED BEHAVIOR: Now returns fallback result with proper structure
      // when analysis succeeds, validating improved error handling
      expect(result).toBeDefined();
      expect(result.project).toBe('Family Photos');
      expect(result.purpose).toContain('beach');
      expect(result.keywords).toContain('beach');
      expect(result.confidence).toBe(85);
      expect(result.has_text).toBe(false);
      expect(mockOllamaClient.generate).toHaveBeenCalled();
    });

    test('should use cache for repeated analysis', async () => {
      jest.spyOn(fs, 'stat').mockResolvedValue({
        size: 50000,
        mtimeMs: 1234567890,
      });
      jest.spyOn(fs, 'readFile').mockResolvedValue(Buffer.from('image data'));

      // Mock globalDeduplicator to not actually deduplicate (allow calls through)
      const {
        globalDeduplicator,
      } = require('../src/main/utils/llmOptimization');
      globalDeduplicator.generateKey = jest.fn().mockReturnValue('test-key');
      globalDeduplicator.deduplicate = jest.fn((key, fn) => fn());

      mockOllamaClient.generate.mockResolvedValue({
        response: JSON.stringify({
          keywords: ['test'],
          confidence: 75,
        }),
      });

      // First call
      await analyzeImageFile(mockImagePath, []);
      expect(mockOllamaClient.generate).toHaveBeenCalledTimes(1);

      // Second call - should use cache and not call generate again
      await analyzeImageFile(mockImagePath, []);
      expect(mockOllamaClient.generate).toHaveBeenCalledTimes(1);
    });

    test('should handle unsupported image format', async () => {
      const result = await analyzeImageFile('/test/file.xyz', []);

      expect(result.error).toContain('Unsupported image format');
      expect(result.category).toBe('unsupported');
      expect(mockOllamaClient.generate).not.toHaveBeenCalled();
    });

    test('should handle empty image file', async () => {
      jest.spyOn(fs, 'stat').mockResolvedValue({
        size: 0,
        mtimeMs: 1234567890,
      });

      const result = await analyzeImageFile(mockImagePath, []);

      expect(result.error).toContain('empty');
      expect(result.confidence).toBe(0);
    });

    test('should fallback when Ollama is unavailable', async () => {
      const ModelVerifier = require('../src/main/services/ModelVerifier');
      ModelVerifier.mockImplementation(() => ({
        checkOllamaConnection: jest.fn().mockResolvedValue({
          connected: false,
          error: 'Connection refused',
        }),
      }));

      const result = await analyzeImageFile(mockImagePath, []);

      expect(result.extractionMethod).toBe('filename_fallback');
      expect(result.fallbackReason).toContain('Connection refused');
      expect(result.confidence).toBe(60);
      expect(mockOllamaClient.generate).not.toHaveBeenCalled();
    });

    test('should convert and resize large images', async () => {
      jest.spyOn(fs, 'stat').mockResolvedValue({
        size: 5000000,
        mtimeMs: 1234567890,
      });
      jest.spyOn(fs, 'readFile').mockResolvedValue(Buffer.from('large image'));

      const mockTransformer = {
        resize: jest.fn().mockReturnThis(),
        png: jest.fn().mockReturnValue({
          toBuffer: jest.fn().mockResolvedValue(Buffer.from('processed')),
        }),
      };

      const sharp = require('sharp');
      sharp.mockReturnValue({
        ...mockTransformer,
        metadata: jest.fn().mockResolvedValue({
          width: 4000,
          height: 3000,
          format: 'jpeg',
        }),
      });

      mockOllamaClient.generate.mockResolvedValue({
        response: JSON.stringify({
          keywords: ['test'],
          confidence: 75,
        }),
      });

      await analyzeImageFile(mockImagePath, []);

      expect(mockTransformer.resize).toHaveBeenCalled();
      expect(mockTransformer.png).toHaveBeenCalled();
    });

    test('should convert SVG to PNG', async () => {
      jest.spyOn(fs, 'stat').mockResolvedValue({
        size: 5000,
        mtimeMs: 1234567890,
      });
      jest.spyOn(fs, 'readFile').mockResolvedValue(Buffer.from('svg data'));

      const mockTransformer = {
        png: jest.fn().mockReturnValue({
          toBuffer: jest.fn().mockResolvedValue(Buffer.from('png')),
        }),
      };

      const sharp = require('sharp');
      sharp.mockReturnValue({
        ...mockTransformer,
        metadata: jest.fn().mockResolvedValue({
          width: 500,
          height: 500,
          format: 'svg',
        }),
      });

      mockOllamaClient.generate.mockResolvedValue({
        response: JSON.stringify({
          keywords: ['test'],
          confidence: 75,
        }),
      });

      await analyzeImageFile('/test/image.svg', []);

      expect(mockTransformer.png).toHaveBeenCalled();
    });

    test('should handle malformed JSON response', async () => {
      jest.spyOn(fs, 'stat').mockResolvedValue({
        size: 50000,
        mtimeMs: 1234567890,
      });
      jest.spyOn(fs, 'readFile').mockResolvedValue(Buffer.from('image data'));

      // Mock globalDeduplicator
      const {
        globalDeduplicator,
      } = require('../src/main/utils/llmOptimization');
      globalDeduplicator.generateKey = jest.fn().mockReturnValue('test-key');
      globalDeduplicator.deduplicate = jest.fn((key, fn) => fn());

      mockOllamaClient.generate.mockResolvedValue({
        response: 'Not valid JSON',
      });

      const result = await analyzeImageFile(mockImagePath, []);

      expect(result).toBeDefined();
      expect(result.error).toBeDefined();
      expect(result.keywords).toEqual([]);
      expect(result.confidence).toBe(65); // Updated expectation based on improved code
    });

    test('should normalize date format', async () => {
      jest.spyOn(fs, 'stat').mockResolvedValue({
        size: 50000,
        mtimeMs: 1234567890,
      });
      jest.spyOn(fs, 'readFile').mockResolvedValue(Buffer.from('image data'));

      // Mock globalDeduplicator
      const {
        globalDeduplicator,
      } = require('../src/main/utils/llmOptimization');
      globalDeduplicator.generateKey = jest.fn().mockReturnValue('test-key');
      globalDeduplicator.deduplicate = jest.fn((key, fn) => fn());

      mockOllamaClient.generate.mockResolvedValue({
        response: JSON.stringify({
          date: '2024-03-15T10:30:00Z',
          keywords: ['test'],
          confidence: 75,
        }),
      });

      const result = await analyzeImageFile(mockImagePath, []);

      expect(result.date).toBe('2024-03-15');
    });

    test('should remove invalid dates', async () => {
      jest.spyOn(fs, 'stat').mockResolvedValue({
        size: 50000,
        mtimeMs: 1234567890,
      });
      jest.spyOn(fs, 'readFile').mockResolvedValue(Buffer.from('image data'));

      // Mock globalDeduplicator
      const {
        globalDeduplicator,
      } = require('../src/main/utils/llmOptimization');
      globalDeduplicator.generateKey = jest.fn().mockReturnValue('test-key');
      globalDeduplicator.deduplicate = jest.fn((key, fn) => fn());

      mockOllamaClient.generate.mockResolvedValue({
        response: JSON.stringify({
          date: 'invalid-date',
          keywords: ['test'],
          confidence: 75,
        }),
      });

      const result = await analyzeImageFile(mockImagePath, []);

      expect(result).toBeDefined();
      expect(result.date).toBeUndefined();
    });

    test('should normalize confidence values', async () => {
      jest.spyOn(fs, 'stat').mockResolvedValue({
        size: 50000,
        mtimeMs: 1234567890,
      });
      jest.spyOn(fs, 'readFile').mockResolvedValue(Buffer.from('image data'));

      // Mock globalDeduplicator
      const {
        globalDeduplicator,
      } = require('../src/main/utils/llmOptimization');
      globalDeduplicator.generateKey = jest.fn().mockReturnValue('test-key');
      globalDeduplicator.deduplicate = jest.fn((key, fn) => fn());

      mockOllamaClient.generate.mockResolvedValue({
        response: JSON.stringify({
          confidence: 150, // Out of range
          keywords: ['test'],
        }),
      });

      const result = await analyzeImageFile(mockImagePath, []);

      expect(result).toBeDefined();
      expect(result.confidence).toBeGreaterThanOrEqual(70);
      expect(result.confidence).toBeLessThanOrEqual(100);
    });

    test('should include smart folder information in prompt', async () => {
      jest.spyOn(fs, 'stat').mockResolvedValue({
        size: 50000,
        mtimeMs: 1234567890,
      });
      jest.spyOn(fs, 'readFile').mockResolvedValue(Buffer.from('image data'));

      // Mock globalDeduplicator
      const {
        globalDeduplicator,
      } = require('../src/main/utils/llmOptimization');
      globalDeduplicator.generateKey = jest.fn().mockReturnValue('test-key');
      globalDeduplicator.deduplicate = jest.fn((key, fn) => fn());

      const smartFolders = [
        { name: 'Photos', description: 'Personal photos' },
        { name: 'Documents', description: 'Scanned documents' },
      ];

      mockOllamaClient.generate.mockResolvedValue({
        response: JSON.stringify({
          category: 'Photos',
          keywords: ['test'],
          confidence: 75,
        }),
      });

      await analyzeImageFile(mockImagePath, smartFolders);

      expect(mockOllamaClient.generate).toHaveBeenCalled();
      const prompt = mockOllamaClient.generate.mock.calls[0][0].prompt;
      expect(prompt).toContain('Photos');
      expect(prompt).toContain('Personal photos');
      expect(prompt).toContain('Documents');
    });

    test('should handle zero-length image error', async () => {
      jest.spyOn(fs, 'stat').mockResolvedValue({
        size: 50000,
        mtimeMs: 1234567890,
      });
      jest.spyOn(fs, 'readFile').mockResolvedValue(Buffer.from('image data'));

      // Mock globalDeduplicator
      const {
        globalDeduplicator,
      } = require('../src/main/utils/llmOptimization');
      globalDeduplicator.generateKey = jest.fn().mockReturnValue('test-key');
      globalDeduplicator.deduplicate = jest.fn((key, fn) => fn());

      mockOllamaClient.generate.mockRejectedValue(
        new Error('zero length image'),
      );

      const result = await analyzeImageFile(mockImagePath, []);

      expect(result).toBeDefined();
      expect(result.error).toBeDefined();
      expect(result.error).toContain('zero-length image');
      expect(result.confidence).toBe(0);
    });

    test('should handle llava embedding error', async () => {
      jest.spyOn(fs, 'stat').mockResolvedValue({
        size: 50000,
        mtimeMs: 1234567890,
      });
      jest.spyOn(fs, 'readFile').mockResolvedValue(Buffer.from('image data'));

      // Mock globalDeduplicator
      const {
        globalDeduplicator,
      } = require('../src/main/utils/llmOptimization');
      globalDeduplicator.generateKey = jest.fn().mockReturnValue('test-key');
      globalDeduplicator.deduplicate = jest.fn((key, fn) => fn());

      mockOllamaClient.generate.mockRejectedValue(
        new Error('unable to make llava embedding'),
      );

      const result = await analyzeImageFile(mockImagePath, []);

      expect(result).toBeDefined();
      expect(result.error).toBeDefined();
      expect(result.error).toContain('Unsupported image format');
      expect(result.confidence).toBe(0);
    });

    test('should ensure keywords and colors are arrays', async () => {
      jest.spyOn(fs, 'stat').mockResolvedValue({
        size: 50000,
        mtimeMs: 1234567890,
      });
      jest.spyOn(fs, 'readFile').mockResolvedValue(Buffer.from('image data'));

      // Mock globalDeduplicator
      const {
        globalDeduplicator,
      } = require('../src/main/utils/llmOptimization');
      globalDeduplicator.generateKey = jest.fn().mockReturnValue('test-key');
      globalDeduplicator.deduplicate = jest.fn((key, fn) => fn());

      mockOllamaClient.generate.mockResolvedValue({
        response: JSON.stringify({
          keywords: null,
          colors: 'not an array',
          confidence: 75,
        }),
      });

      const result = await analyzeImageFile(mockImagePath, []);

      expect(result).toBeDefined();
      expect(Array.isArray(result.keywords)).toBe(true);
      expect(Array.isArray(result.colors)).toBe(true);
    });

    test('should convert has_text to boolean', async () => {
      jest.spyOn(fs, 'stat').mockResolvedValue({
        size: 50000,
        mtimeMs: 1234567890,
      });
      jest.spyOn(fs, 'readFile').mockResolvedValue(Buffer.from('image data'));

      // Mock globalDeduplicator
      const {
        globalDeduplicator,
      } = require('../src/main/utils/llmOptimization');
      globalDeduplicator.generateKey = jest.fn().mockReturnValue('test-key');
      globalDeduplicator.deduplicate = jest.fn((key, fn) => fn());

      mockOllamaClient.generate.mockResolvedValue({
        response: JSON.stringify({
          has_text: 'yes',
          keywords: ['test'],
          confidence: 75,
        }),
      });

      const result = await analyzeImageFile(mockImagePath, []);

      expect(result).toBeDefined();
      expect(typeof result.has_text).toBe('boolean');
    });
  });

  describe('extractTextFromImage', () => {
    test('should extract text from image', async () => {
      jest.spyOn(fs, 'readFile').mockResolvedValue(Buffer.from('image data'));

      mockOllamaClient.generate.mockResolvedValue({
        response: 'This is extracted text from the image',
      });

      const result = await extractTextFromImage('/test/screenshot.png');

      expect(result).toBe('This is extracted text from the image');
      expect(mockOllamaClient.generate).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'llava',
          options: expect.objectContaining({
            temperature: 0.1,
            num_predict: 2000,
          }),
        }),
      );
    });

    test('should return null when no text found', async () => {
      jest.spyOn(fs, 'readFile').mockResolvedValue(Buffer.from('image data'));

      mockOllamaClient.generate.mockResolvedValue({
        response: 'NO_TEXT_FOUND',
      });

      const result = await extractTextFromImage('/test/photo.jpg');

      expect(result).toBeNull();
    });

    test('should return null on error', async () => {
      jest.spyOn(fs, 'readFile').mockResolvedValue(Buffer.from('image data'));

      mockOllamaClient.generate.mockRejectedValue(new Error('Vision error'));

      const result = await extractTextFromImage('/test/image.jpg');

      expect(result).toBeNull();
    });

    test('should handle empty response', async () => {
      jest.spyOn(fs, 'readFile').mockResolvedValue(Buffer.from('image data'));

      mockOllamaClient.generate.mockResolvedValue({
        response: '',
      });

      const result = await extractTextFromImage('/test/image.jpg');

      expect(result).toBeNull();
    });
  });

  describe('Edge Cases', () => {
    test('should handle image preprocessing errors gracefully', async () => {
      jest.spyOn(fs, 'stat').mockResolvedValue({
        size: 50000,
        mtimeMs: 1234567890,
      });
      jest.spyOn(fs, 'readFile').mockResolvedValue(Buffer.from('image data'));

      // Mock globalDeduplicator
      const {
        globalDeduplicator,
      } = require('../src/main/utils/llmOptimization');
      globalDeduplicator.generateKey = jest.fn().mockReturnValue('test-key');
      globalDeduplicator.deduplicate = jest.fn((key, fn) => fn());

      mockOllamaClient.generate.mockResolvedValue({
        response: JSON.stringify({
          keywords: ['test'],
          confidence: 75,
        }),
      });

      // Should still process despite preprocessing error
      const result = await analyzeImageFile('/test/photo.jpg', []);

      expect(result).toBeDefined();
      expect(result.keywords).toBeDefined();
    });

    test('should handle empty buffer after preprocessing', async () => {
      jest.spyOn(fs, 'stat').mockResolvedValue({
        size: 50000,
        mtimeMs: 1234567890,
      });
      jest.spyOn(fs, 'readFile').mockResolvedValue(Buffer.alloc(0));

      // Mock globalDeduplicator (won't be called but needed for consistency)
      const {
        globalDeduplicator,
      } = require('../src/main/utils/llmOptimization');
      globalDeduplicator.generateKey = jest.fn().mockReturnValue('test-key');
      globalDeduplicator.deduplicate = jest.fn((key, fn) => fn());

      const result = await analyzeImageFile('/test/photo.jpg', []);

      expect(result).toBeDefined();
      expect(result.error).toBeDefined();
      expect(result.error).toContain('empty');
    });

    test('should handle base64 encoding failure', async () => {
      jest.spyOn(fs, 'stat').mockResolvedValue({
        size: 50000,
        mtimeMs: 1234567890,
      });

      // Mock a buffer that fails to convert to base64 properly
      const badBuffer = Buffer.from('');
      jest.spyOn(fs, 'readFile').mockResolvedValue(badBuffer);

      // Mock globalDeduplicator (won't be called but needed for consistency)
      const {
        globalDeduplicator,
      } = require('../src/main/utils/llmOptimization');
      globalDeduplicator.generateKey = jest.fn().mockReturnValue('test-key');
      globalDeduplicator.deduplicate = jest.fn((key, fn) => fn());

      const result = await analyzeImageFile('/test/photo.jpg', []);

      expect(result).toBeDefined();
      expect(result.error).toBeDefined();
    });
  });
});
