/**
 * Tests for SmartFoldersLLMService
 * Tests LLM-powered folder enhancement and similarity calculation
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

// Mock fetch with retry
const mockFetchWithRetry = jest.fn();
jest.mock('../src/main/utils/ollamaApiRetry', () => ({
  fetchWithRetry: mockFetchWithRetry
}));

// Mock JSON repair
jest.mock('../src/main/utils/jsonRepair', () => ({
  extractAndParseJSON: jest.fn()
}));

// Mock ollama utils
jest.mock('../src/main/ollamaUtils', () => ({
  getOllamaHost: jest.fn().mockReturnValue('http://127.0.0.1:11434')
}));

// Mock constants
jest.mock('../src/shared/constants', () => ({
  DEFAULT_AI_MODELS: {
    TEXT_ANALYSIS: 'llama2'
  }
}));

describe('SmartFoldersLLMService', () => {
  let enhanceSmartFolderWithLLM;
  let calculateFolderSimilarities;
  let calculateBasicSimilarity;
  let extractAndParseJSON;

  const mockGetOllamaModel = jest.fn().mockReturnValue('llama2');

  beforeEach(() => {
    jest.clearAllMocks();

    extractAndParseJSON = require('../src/main/utils/jsonRepair').extractAndParseJSON;

    const service = require('../src/main/services/SmartFoldersLLMService');
    enhanceSmartFolderWithLLM = service.enhanceSmartFolderWithLLM;
    calculateFolderSimilarities = service.calculateFolderSimilarities;
    calculateBasicSimilarity = service.calculateBasicSimilarity;
  });

  describe('enhanceSmartFolderWithLLM', () => {
    const testFolder = {
      name: 'Documents',
      path: '/home/user/Documents',
      description: 'My documents folder'
    };

    const existingFolders = [
      { name: 'Work', description: 'Work files', keywords: ['office'], category: 'work' },
      { name: 'Personal', description: 'Personal items', keywords: [], category: 'personal' }
    ];

    test('enhances folder successfully', async () => {
      mockFetchWithRetry.mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({
          response: JSON.stringify({
            improvedDescription: 'Enhanced description',
            suggestedKeywords: ['docs', 'files'],
            organizationTips: 'Keep organized',
            confidence: 0.85
          })
        })
      });

      extractAndParseJSON.mockReturnValue({
        improvedDescription: 'Enhanced description',
        suggestedKeywords: ['docs', 'files'],
        organizationTips: 'Keep organized',
        confidence: 0.85
      });

      const result = await enhanceSmartFolderWithLLM(
        testFolder,
        existingFolders,
        mockGetOllamaModel
      );

      expect(result.improvedDescription).toBe('Enhanced description');
      expect(result.suggestedKeywords).toEqual(['docs', 'files']);
      expect(result.confidence).toBe(0.85);
    });

    test('returns error on fetch failure', async () => {
      mockFetchWithRetry.mockRejectedValue(new Error('Network error'));

      const result = await enhanceSmartFolderWithLLM(
        testFolder,
        existingFolders,
        mockGetOllamaModel
      );

      expect(result.error).toContain('Network error');
    });

    test('returns error on HTTP error', async () => {
      mockFetchWithRetry.mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error'
      });

      const result = await enhanceSmartFolderWithLLM(
        testFolder,
        existingFolders,
        mockGetOllamaModel
      );

      expect(result.error).toContain('HTTP error');
      expect(result.error).toContain('500');
    });

    test('returns error on invalid JSON response', async () => {
      mockFetchWithRetry.mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({ response: 'invalid json' })
      });
      extractAndParseJSON.mockReturnValue(null);

      const result = await enhanceSmartFolderWithLLM(
        testFolder,
        existingFolders,
        mockGetOllamaModel
      );

      expect(result.error).toBe('Invalid JSON response from LLM');
    });

    test('handles empty existing folders', async () => {
      mockFetchWithRetry.mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({
          response: JSON.stringify({ improvedDescription: 'Test' })
        })
      });
      extractAndParseJSON.mockReturnValue({ improvedDescription: 'Test' });

      const result = await enhanceSmartFolderWithLLM(testFolder, [], mockGetOllamaModel);

      expect(result.improvedDescription).toBe('Test');
    });

    test('handles folder without description', async () => {
      const folderNoDesc = { name: 'Test', path: '/test' };

      mockFetchWithRetry.mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({
          response: JSON.stringify({ improvedDescription: 'Generated' })
        })
      });
      extractAndParseJSON.mockReturnValue({ improvedDescription: 'Generated' });

      const result = await enhanceSmartFolderWithLLM(
        folderNoDesc,
        existingFolders,
        mockGetOllamaModel
      );

      expect(result.improvedDescription).toBe('Generated');
    });
  });

  describe('calculateFolderSimilarities', () => {
    const folderCategories = [
      { name: 'Documents', id: '1', description: 'Document storage' },
      { name: 'Images', id: '2', description: 'Photo and image files' }
    ];

    test('calculates similarities for all folders', async () => {
      mockFetchWithRetry
        .mockResolvedValueOnce({
          ok: true,
          json: jest.fn().mockResolvedValue({ response: '0.85' })
        })
        .mockResolvedValueOnce({
          ok: true,
          json: jest.fn().mockResolvedValue({ response: '0.3' })
        });

      const result = await calculateFolderSimilarities(
        'Reports',
        folderCategories,
        mockGetOllamaModel
      );

      expect(result).toHaveLength(2);
      expect(result[0].confidence).toBe(0.85); // Sorted by confidence
      expect(result[1].confidence).toBe(0.3);
    });

    test('uses fallback on LLM error', async () => {
      mockFetchWithRetry.mockRejectedValue(new Error('LLM unavailable'));

      const result = await calculateFolderSimilarities(
        'Documents',
        folderCategories,
        mockGetOllamaModel
      );

      expect(result).toHaveLength(2);
      expect(result[0].fallback).toBe(true);
    });

    test('uses fallback on HTTP error', async () => {
      mockFetchWithRetry.mockResolvedValue({
        ok: false,
        status: 500
      });

      const result = await calculateFolderSimilarities(
        'Test',
        folderCategories,
        mockGetOllamaModel
      );

      expect(result.every((r) => r.fallback)).toBe(true);
    });

    test('handles invalid similarity values', async () => {
      mockFetchWithRetry
        .mockResolvedValueOnce({
          ok: true,
          json: jest.fn().mockResolvedValue({ response: 'not a number' })
        })
        .mockResolvedValueOnce({
          ok: true,
          json: jest.fn().mockResolvedValue({ response: '0.7' })
        });

      const result = await calculateFolderSimilarities(
        'Test',
        folderCategories,
        mockGetOllamaModel
      );

      // First folder should fallback, second should succeed
      expect(result.length).toBeGreaterThan(0);
    });

    test('handles empty folder categories', async () => {
      const result = await calculateFolderSimilarities('Test', [], mockGetOllamaModel);

      expect(result).toEqual([]);
    });

    test('sorts results by confidence descending', async () => {
      mockFetchWithRetry
        .mockResolvedValueOnce({
          ok: true,
          json: jest.fn().mockResolvedValue({ response: '0.3' })
        })
        .mockResolvedValueOnce({
          ok: true,
          json: jest.fn().mockResolvedValue({ response: '0.9' })
        });

      const result = await calculateFolderSimilarities(
        'Test',
        folderCategories,
        mockGetOllamaModel
      );

      expect(result[0].confidence).toBeGreaterThan(result[1].confidence);
    });
  });

  describe('calculateBasicSimilarity', () => {
    test('returns 1.0 for identical strings', () => {
      expect(calculateBasicSimilarity('Documents', 'Documents')).toBe(1.0);
    });

    test('returns 1.0 for identical strings case insensitive', () => {
      expect(calculateBasicSimilarity('Documents', 'documents')).toBe(1.0);
    });

    test('returns 0.8 for substring match', () => {
      expect(calculateBasicSimilarity('Documents', 'Document')).toBe(0.8);
      expect(calculateBasicSimilarity('Doc', 'Documents')).toBe(0.8);
    });

    test('calculates word overlap similarity', () => {
      const result = calculateBasicSimilarity('work files', 'work documents');
      expect(result).toBeGreaterThan(0);
      expect(result).toBeLessThan(1);
    });

    test('returns 0 for completely different strings', () => {
      const result = calculateBasicSimilarity('abc', 'xyz');
      expect(result).toBe(0);
    });

    test('handles empty strings', () => {
      expect(calculateBasicSimilarity('', '')).toBe(1.0);
      expect(calculateBasicSimilarity('test', '')).toBe(0.8);
    });

    test('handles null/undefined', () => {
      expect(calculateBasicSimilarity(null, null)).toBe(1.0);
      expect(calculateBasicSimilarity(undefined, undefined)).toBe(1.0);
    });
  });
});
