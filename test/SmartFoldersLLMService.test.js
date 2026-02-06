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

jest.mock('../src/main/services/LlamaService', () => ({
  getInstance: () => ({
    initialize: jest.fn().mockResolvedValue(undefined),
    generateText: jest.fn().mockResolvedValue({
      response: JSON.stringify({
        improvedDescription: 'Enhanced description',
        suggestedKeywords: ['docs', 'files'],
        organizationTips: 'Keep organized',
        confidence: 0.85
      })
    })
  })
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
  });

  test('returns empty similarities when no categories', async () => {
    const result = await calculateFolderSimilarities('finance', [], () => 'llama3');
    expect(result).toEqual([]);
  });
});
