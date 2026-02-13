/**
 * Tests for SmartFoldersLLMService
 */

jest.mock('../src/shared/logger', () => {
  const logger = {
    setContext: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  };
  return { logger, createLogger: jest.fn(() => logger) };
});

const mockLlamaService = {
  initialize: jest.fn().mockResolvedValue(undefined),
  generateText: jest.fn()
};

jest.mock('../src/main/services/LlamaService', () => ({
  getInstance: () => mockLlamaService
}));

jest.mock('../src/main/utils/jsonRepair', () => ({
  extractAndParseJSON: jest.fn((value) => {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  })
}));

describe('SmartFoldersLLMService', () => {
  let enhanceSmartFolderWithLLM;
  let calculateFolderSimilarities;

  beforeEach(() => {
    jest.clearAllMocks();
    mockLlamaService.generateText.mockResolvedValue({
      response: JSON.stringify({
        improvedDescription: 'Enhanced description',
        suggestedKeywords: ['docs', 'files'],
        organizationTips: 'Keep organized',
        confidence: 0.85
      })
    });
    const service = require('../src/main/services/SmartFoldersLLMService');
    enhanceSmartFolderWithLLM = service.enhanceSmartFolderWithLLM;
    calculateFolderSimilarities = service.calculateFolderSimilarities;
  });

  test('enhances folder successfully', async () => {
    const result = await enhanceSmartFolderWithLLM(
      { name: 'Documents', path: '/home/user/Documents', description: 'My documents folder' },
      [{ name: 'Work', description: 'Work files', keywords: ['office'], category: 'work' }],
      () => 'llama3'
    );

    expect(result.improvedDescription).toBe('Enhanced description');
    expect(result.suggestedKeywords).toEqual(['docs', 'files']);
    expect(result.confidence).toBe(0.85);
    expect(result.enhancedDescription).toBe('Enhanced description');
  });

  test('normalizes hallucinated related folders and confidence scale', async () => {
    mockLlamaService.generateText.mockResolvedValueOnce({
      response: JSON.stringify({
        improvedDescription: 'Enhanced description',
        suggestedKeywords: ['docs', 'files'],
        organizationTips: 'Keep organized',
        confidence: 92,
        relatedFolders: ['Work', 'Imaginary']
      })
    });

    const result = await enhanceSmartFolderWithLLM(
      { name: 'Documents', path: '/home/user/Documents', description: 'My documents folder' },
      [{ name: 'Work', description: 'Work files', keywords: ['office'], category: 'work' }],
      () => 'llama3'
    );

    expect(result.relatedFolders).toEqual(['Work']);
    expect(result.confidence).toBeCloseTo(0.92, 2);
  });

  test('returns empty similarities when no categories', async () => {
    const result = await calculateFolderSimilarities('finance', [], () => 'llama3');
    expect(result).toEqual([]);
  });
});
