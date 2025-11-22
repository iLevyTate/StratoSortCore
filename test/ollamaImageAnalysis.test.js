/**
 * REWRITTEN TESTS for ollamaImageAnalysis
 * Aligned with refactored code architecture from commit aa732a7
 */

const fs = require('fs').promises;
const {
  analyzeImageFile,
  extractTextFromImage,
} = require('../src/main/analysis/ollamaImageAnalysis');

// Mock all dependencies BEFORE importing the module
jest.mock('../src/shared/logger', () => ({
  logger: {
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    setContext: jest.fn(),
  },
}));

jest.mock('sharp', () => {
  return jest.fn(() => ({
    metadata: jest.fn().mockResolvedValue({
      width: 800,
      height: 600,
      format: 'jpeg',
    }),
    resize: jest.fn().mockReturnThis(),
    png: jest.fn().mockReturnThis(),
    toBuffer: jest.fn().mockResolvedValue(Buffer.from('processed image data')),
  }));
});

jest.mock('../src/shared/constants', () => ({
  SUPPORTED_IMAGE_EXTENSIONS: ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.svg'],
  AI_DEFAULTS: {
    IMAGE: {
      MODEL: 'llava',
      HOST: 'http://127.0.0.1:11434',
      TEMPERATURE: 0.1,
      MAX_TOKENS: 500,
    },
  },
}));

// Mock Ollama utilities - define mockOllamaClient separately for use in tests
jest.mock('../src/main/ollamaUtils', () => {
  const mockClient = {
    generate: jest.fn(),
  };
  return {
    getOllamaClient: jest.fn().mockResolvedValue(mockClient),
    getOllamaVisionModel: jest.fn().mockReturnValue('llava'),
    loadOllamaConfig: jest.fn().mockResolvedValue({
      selectedVisionModel: 'llava',
    }),
    __mockClient: mockClient, // Export for test access
  };
});

// Mock ModelVerifier
jest.mock('../src/main/services/ModelVerifier', () => {
  return jest.fn().mockImplementation(() => ({
    checkOllamaConnection: jest.fn().mockResolvedValue({
      connected: true,
    }),
  }));
});

// Mock ChromaDB to return null (skip semantic matching)
jest.mock('../src/main/services/ChromaDBService', () => ({
  getInstance: jest.fn().mockReturnValue(null),
}));

// Mock FolderMatchingService
jest.mock('../src/main/services/FolderMatchingService', () => {
  return jest.fn();
});

// Mock PerformanceService
jest.mock('../src/main/services/PerformanceService', () => ({
  buildOllamaOptions: jest.fn().mockResolvedValue({}),
}));

// Mock generateWithRetry to pass through to client.generate
jest.mock('../src/main/utils/ollamaApiRetry', () => ({
  generateWithRetry: jest.fn(async (client, options) => {
    // Call the mocked client.generate directly
    return await client.generate(options);
  }),
}));

// Mock deduplicator to pass through
jest.mock('../src/main/utils/llmOptimization', () => ({
  globalDeduplicator: {
    generateKey: jest.fn((data) => JSON.stringify(data)),
    deduplicate: jest.fn(async (key, fn) => await fn()),
  },
}));

// Mock analysis utils
jest.mock('../src/main/analysis/utils', () => ({
  normalizeAnalysisResult: jest.fn((data, defaults) => ({
    ...defaults,
    ...data,
  })),
}));

// Mock fallback utils - use correct export names
jest.mock('../src/main/analysis/fallbackUtils', () => ({
  getIntelligentCategory: jest.fn(() => 'images'),
  getIntelligentKeywords: jest.fn(() => ['image', 'photo']),
  safeSuggestedName: jest.fn((name, ext) => name.replace(ext, '')),
}));

describe('ollamaImageAnalysis - Rewritten Tests', () => {
  let mockOllamaClient;

  beforeEach(() => {
    jest.clearAllMocks();
    // Get the mock client from the mocked module
    const ollamaUtils = require('../src/main/ollamaUtils');
    mockOllamaClient = ollamaUtils.__mockClient;
  });

  describe('analyzeImageFile', () => {
    const mockImagePath = '/test/photo.jpg';

    test('should successfully analyze an image file', async () => {
      // Mock file system operations
      jest.spyOn(fs, 'stat').mockResolvedValue({
        size: 50000,
        mtimeMs: 1234567890,
      });
      jest
        .spyOn(fs, 'readFile')
        .mockResolvedValue(Buffer.from('mock image data'));

      // Mock Ollama response
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

      expect(result).toBeDefined();
      expect(result.project).toBe('Family Photos');
      expect(result.keywords).toContain('beach');
      expect(result.confidence).toBe(85);
      expect(mockOllamaClient.generate).toHaveBeenCalledTimes(1);
    });

    test('should handle unsupported file format', async () => {
      const result = await analyzeImageFile('/test/file.xyz', []);

      expect(result).toBeDefined();
      expect(result.error).toContain('Unsupported');
      expect(result.confidence).toBe(0);
    });

    test('should handle empty file', async () => {
      jest.spyOn(fs, 'stat').mockResolvedValue({
        size: 0,
        mtimeMs: 1234567890,
      });

      const result = await analyzeImageFile(mockImagePath, []);

      expect(result).toBeDefined();
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

      jest.spyOn(fs, 'stat').mockResolvedValue({
        size: 50000,
        mtimeMs: 1234567890,
      });

      const result = await analyzeImageFile(mockImagePath, []);

      expect(result).toBeDefined();
      expect(result.purpose).toContain('fallback');
      expect(result.confidence).toBe(60);
    });

    test('should handle malformed JSON response', async () => {
      jest.spyOn(fs, 'stat').mockResolvedValue({
        size: 50000,
        mtimeMs: 1234567890,
      });
      jest
        .spyOn(fs, 'readFile')
        .mockResolvedValue(Buffer.from('mock image data'));

      mockOllamaClient.generate.mockResolvedValue({
        response: 'Not valid JSON',
      });

      const result = await analyzeImageFile(mockImagePath, []);

      // Debug: Check if result is undefined
      if (!result) {
        throw new Error(
          `Result is undefined. Mock was called: ${mockOllamaClient.generate.mock.calls.length} times`,
        );
      }

      // When JSON parsing fails, it should return an error result
      expect(result).toBeDefined();
      // The result should have error info and fallback data
      expect(result.keywords).toBeDefined();
      expect(Array.isArray(result.keywords)).toBe(true);
      expect(result.confidence).toBeGreaterThan(0);
    });
  });

  describe('extractTextFromImage', () => {
    test('should extract text from image', async () => {
      jest
        .spyOn(fs, 'readFile')
        .mockResolvedValue(Buffer.from('mock image data'));

      mockOllamaClient.generate.mockResolvedValue({
        response: 'Sample text from image',
      });

      const result = await extractTextFromImage('/test/image.jpg');

      expect(result).toBe('Sample text from image');
    });

    test('should return null when no text found', async () => {
      jest
        .spyOn(fs, 'readFile')
        .mockResolvedValue(Buffer.from('mock image data'));

      mockOllamaClient.generate.mockResolvedValue({
        response: 'NO_TEXT_FOUND',
      });

      const result = await extractTextFromImage('/test/image.jpg');

      expect(result).toBeNull();
    });

    test('should return null on error', async () => {
      mockOllamaClient.generate.mockRejectedValue(new Error('API Error'));

      const result = await extractTextFromImage('/test/image.jpg');

      expect(result).toBeNull();
    });
  });
});
