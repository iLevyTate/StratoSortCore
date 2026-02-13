const {
  enhanceSmartFolderWithLLM,
  calculateFolderSimilarities,
  calculateBasicSimilarity
} = require('../src/main/services/SmartFoldersLLMService');

const mockLlamaService = {
  initialize: jest.fn().mockResolvedValue(undefined),
  generateText: jest.fn()
};

jest.mock('../src/main/services/LlamaService', () => ({
  getInstance: () => mockLlamaService
}));

describe('SmartFoldersLLMService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('enhanceSmartFolderWithLLM returns parsed enhancement', async () => {
    const enhancement = {
      improvedDescription: 'better',
      suggestedKeywords: ['a'],
      organizationTips: 'tips',
      confidence: 0.8,
      suggestedCategory: 'work',
      relatedFolders: ['Receipts']
    };
    mockLlamaService.generateText.mockResolvedValue({
      response: JSON.stringify(enhancement)
    });
    const result = await enhanceSmartFolderWithLLM(
      { name: 'Invoices', path: '/tmp', description: 'old' },
      [{ name: 'Receipts', description: 'past' }],
      () => 'model'
    );
    expect(mockLlamaService.generateText).toHaveBeenCalled();
    expect(result).toMatchObject({
      improvedDescription: 'better',
      enhancedDescription: 'better',
      suggestedKeywords: ['a'],
      organizationTips: 'tips',
      confidence: 0.8
    });
  });

  test('enhanceSmartFolderWithLLM drops hallucinated related folders', async () => {
    mockLlamaService.generateText.mockResolvedValue({
      response: JSON.stringify({
        improvedDescription: 'focused documents',
        suggestedKeywords: ['docs'],
        organizationTips: 'keep names consistent',
        confidence: 83,
        relatedFolders: ['Receipts', 'NotARealFolder']
      })
    });

    const result = await enhanceSmartFolderWithLLM(
      { name: 'Invoices', path: '/tmp', description: 'old' },
      [{ name: 'Receipts', description: 'past' }],
      () => 'model'
    );

    expect(result.relatedFolders).toEqual(['Receipts']);
    expect(result.confidence).toBeCloseTo(0.83, 2);
  });

  test('calculateFolderSimilarities sorts and falls back on error', async () => {
    const basic = calculateBasicSimilarity('Invoices', 'Misc');
    mockLlamaService.generateText
      .mockResolvedValueOnce({ response: '0.9' })
      .mockRejectedValueOnce(new Error('network'));
    const result = await calculateFolderSimilarities(
      'Invoices',
      [
        { name: 'Billing', description: 'payments', id: 1 },
        { name: 'Misc', description: 'other', id: 2 }
      ],
      () => 'model'
    );
    expect(result[0]).toMatchObject({ name: 'Billing', confidence: 0.9 });
    expect(result[1]).toMatchObject({
      name: 'Misc',
      confidence: basic,
      fallback: true
    });
  });

  test('calculateBasicSimilarity compares words', () => {
    expect(calculateBasicSimilarity('project alpha', 'alpha project')).toBeCloseTo(1.0);
    expect(calculateBasicSimilarity('invoice april', 'invoice')).toBeGreaterThan(0.5);
  });
});
