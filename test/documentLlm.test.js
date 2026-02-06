/**
 * Tests for documentLlm
 */

const { analyzeTextWithLlama, AppConfig } = require('../src/main/analysis/documentLlm');

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
  getConfig: jest.fn().mockReturnValue({ textModel: 'test-model.gguf' }),
  generateText: jest.fn()
};

jest.mock('../src/main/services/LlamaService', () => ({
  getInstance: () => mockLlamaService
}));

describe('documentLlm', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('analyzeTextWithLlama returns structured result', async () => {
    mockLlamaService.generateText.mockResolvedValue({
      response: JSON.stringify({
        project: 'Invoices',
        purpose: 'Billing',
        category: 'financial',
        keywords: ['invoice'],
        confidence: 0.9,
        suggestedName: 'invoice_q1'
      })
    });

    const result = await analyzeTextWithLlama('Invoice Q1', 'invoice.txt', []);
    expect(result.category).toBe('financial');
    expect(result.suggestedName).toBe('invoice_q1.txt');
  });

  test('uses cache for identical inputs', async () => {
    mockLlamaService.generateText.mockResolvedValue({
      response: JSON.stringify({
        category: 'documents',
        confidence: 0.5,
        suggestedName: 'doc'
      })
    });

    const r1 = await analyzeTextWithLlama('Text', 'doc.txt', []);
    const r2 = await analyzeTextWithLlama('Text', 'doc.txt', []);

    expect(r1.suggestedName).toBe('doc.txt');
    expect(r2.suggestedName).toBe('doc.txt');
    expect(mockLlamaService.generateText).toHaveBeenCalledTimes(1);
  });
});
