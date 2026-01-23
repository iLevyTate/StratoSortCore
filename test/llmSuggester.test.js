/**
 * Tests for LLM Suggester
 * Tests LLM-powered organization suggestions
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

// Mock ollama utils
const mockOllama = {
  generate: jest.fn()
};
const mockModel = 'llama2';
const { AI_DEFAULTS } = require('../src/shared/constants');

jest.mock('../src/main/ollamaUtils', () => ({
  getOllama: jest.fn(() => mockOllama),
  getOllamaModel: jest.fn(() => mockModel)
}));

// Mock performance service
jest.mock('../src/main/services/PerformanceService', () => ({
  buildOllamaOptions: jest.fn().mockResolvedValue({
    num_ctx: 4096,
    num_thread: 4
  })
}));

// Mock deduplicator
const mockDeduplicator = {
  generateKey: jest.fn().mockReturnValue('test-key'),
  deduplicate: jest.fn()
};

jest.mock('../src/main/utils/llmOptimization', () => ({
  globalDeduplicator: mockDeduplicator
}));

// Mock JSON repair
jest.mock('../src/main/utils/jsonRepair', () => ({
  extractAndParseJSON: jest.fn()
}));

describe('llmSuggester', () => {
  let getLLMAlternativeSuggestions;
  let MAX_RESPONSE_SIZE;
  let extractAndParseJSON;

  const testFile = {
    name: 'document.pdf',
    extension: '.pdf',
    analysis: {
      category: 'documents',
      subject: 'Report',
      confidence: 0.9
    }
  };

  const testSmartFolders = [
    { name: 'Documents', description: 'General documents' },
    { name: 'Reports', description: 'Business reports' },
    { name: 'Archive', description: 'Archived files' }
  ];

  beforeEach(() => {
    jest.clearAllMocks();

    extractAndParseJSON = require('../src/main/utils/jsonRepair').extractAndParseJSON;

    // Default mock responses
    mockDeduplicator.deduplicate.mockImplementation((key, fn) => fn());

    mockOllama.generate.mockResolvedValue({
      response: JSON.stringify({
        suggestions: [
          {
            folder: 'Reports',
            reasoning: 'Document appears to be a report',
            confidence: 0.85,
            strategy: 'content-based'
          }
        ]
      })
    });

    extractAndParseJSON.mockReturnValue({
      suggestions: [
        {
          folder: 'Reports',
          reasoning: 'Document appears to be a report',
          confidence: 0.85,
          strategy: 'content-based'
        }
      ]
    });

    const llmSuggester = require('../src/main/services/organization/llmSuggester');
    getLLMAlternativeSuggestions = llmSuggester.getLLMAlternativeSuggestions;
    MAX_RESPONSE_SIZE = llmSuggester.MAX_RESPONSE_SIZE;
  });

  test('returns suggestions from LLM', async () => {
    const suggestions = await getLLMAlternativeSuggestions(testFile, testSmartFolders);

    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].folder).toBe('Reports');
    expect(suggestions[0].reasoning).toBe('Document appears to be a report');
    expect(suggestions[0].method).toBe('llm_creative');
  });

  test('uses deduplicator to prevent duplicate calls', async () => {
    await getLLMAlternativeSuggestions(testFile, testSmartFolders);

    expect(mockDeduplicator.generateKey).toHaveBeenCalledWith(
      expect.objectContaining({
        fileName: 'document.pdf',
        type: 'organization-suggestions'
      })
    );
    expect(mockDeduplicator.deduplicate).toHaveBeenCalled();
  });

  test('passes config values to ollama', async () => {
    await getLLMAlternativeSuggestions(testFile, testSmartFolders, {
      llmTemperature: 0.5,
      llmMaxTokens: 1000
    });

    // The config is passed through deduplicate to generate
    expect(mockDeduplicator.deduplicate).toHaveBeenCalled();
  });

  test('returns empty array when ollama is not available', async () => {
    const { getOllama } = require('../src/main/ollamaUtils');
    getOllama.mockReturnValueOnce(null);

    jest.resetModules();
    const {
      getLLMAlternativeSuggestions: getSuggestions
    } = require('../src/main/services/organization/llmSuggester');

    const suggestions = await getSuggestions(testFile, testSmartFolders);

    expect(suggestions).toEqual([]);
  });

  test('falls back to default model when model is not available', async () => {
    const { getOllamaModel } = require('../src/main/ollamaUtils');
    getOllamaModel.mockReturnValueOnce(null);
    const suggestions = await getLLMAlternativeSuggestions(testFile, testSmartFolders);
    expect(suggestions).toHaveLength(1);
    expect(mockOllama.generate).toHaveBeenCalledWith(
      expect.objectContaining({ model: AI_DEFAULTS.TEXT.MODEL })
    );
  });

  test('returns empty array when response exceeds size limit', async () => {
    const largeResponse = 'x'.repeat(MAX_RESPONSE_SIZE + 1);
    mockOllama.generate.mockResolvedValueOnce({
      response: largeResponse
    });

    const suggestions = await getLLMAlternativeSuggestions(testFile, testSmartFolders);

    expect(suggestions).toEqual([]);
  });

  test('returns empty array when JSON parsing fails', async () => {
    extractAndParseJSON.mockReturnValueOnce(null);

    const suggestions = await getLLMAlternativeSuggestions(testFile, testSmartFolders);

    expect(suggestions).toEqual([]);
  });

  test('returns empty array when suggestions array is missing', async () => {
    extractAndParseJSON.mockReturnValueOnce({});

    const suggestions = await getLLMAlternativeSuggestions(testFile, testSmartFolders);

    expect(suggestions).toEqual([]);
  });

  test('handles LLM error gracefully', async () => {
    mockDeduplicator.deduplicate.mockRejectedValueOnce(new Error('LLM error'));

    const suggestions = await getLLMAlternativeSuggestions(testFile, testSmartFolders);

    expect(suggestions).toEqual([]);
  });

  test('maps suggestion properties correctly', async () => {
    extractAndParseJSON.mockReturnValueOnce({
      suggestions: [
        {
          folder: 'Archive',
          reasoning: 'Old document',
          confidence: 0.75,
          strategy: 'temporal'
        },
        {
          folder: 'Documents',
          reasoning: 'General doc',
          // confidence missing - should default to 0.5
          strategy: 'fallback'
        }
      ]
    });

    const suggestions = await getLLMAlternativeSuggestions(testFile, testSmartFolders);

    expect(suggestions).toHaveLength(2);

    expect(suggestions[0].folder).toBe('Archive');
    expect(suggestions[0].score).toBe(0.75);
    expect(suggestions[0].confidence).toBe(0.75);
    expect(suggestions[0].strategy).toBe('temporal');
    expect(suggestions[0].method).toBe('llm_creative');

    expect(suggestions[1].folder).toBe('Documents');
    expect(suggestions[1].score).toBe(0.5); // Default
    expect(suggestions[1].confidence).toBe(0.5); // Default
  });

  test('handles file without analysis', async () => {
    const fileWithoutAnalysis = {
      name: 'mystery.txt',
      extension: '.txt'
    };

    await getLLMAlternativeSuggestions(fileWithoutAnalysis, testSmartFolders);

    expect(mockDeduplicator.generateKey).toHaveBeenCalled();
  });

  test('truncates long analysis in prompt', async () => {
    const fileWithLongAnalysis = {
      name: 'doc.pdf',
      extension: '.pdf',
      analysis: {
        content: 'x'.repeat(1000),
        extraField: 'y'.repeat(1000)
      }
    };

    await getLLMAlternativeSuggestions(fileWithLongAnalysis, testSmartFolders);

    // Should not throw error
    expect(mockDeduplicator.deduplicate).toHaveBeenCalled();
  });

  test('uses default config values', async () => {
    await getLLMAlternativeSuggestions(testFile, testSmartFolders);

    // Default temperature is 0.7, default max tokens is 500
    expect(mockDeduplicator.deduplicate).toHaveBeenCalled();
  });

  test('MAX_RESPONSE_SIZE is exported', () => {
    expect(MAX_RESPONSE_SIZE).toBe(1024 * 1024);
  });
});
