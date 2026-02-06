jest.mock('../src/shared/logger', () => ({
  createLogger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
  })
}));

jest.mock('../src/main/utils/jsonRepair', () => ({
  extractAndParseJSON: jest.fn()
}));

const ChatService = require('../src/main/services/ChatService');
const { extractAndParseJSON } = require('../src/main/utils/jsonRepair');

describe('ChatService', () => {
  beforeEach(() => {
    extractAndParseJSON.mockReset();
  });

  test('rejects short queries', async () => {
    const service = new ChatService({ llamaService: { analyzeText: jest.fn() } });
    const result = await service.query({ query: 'a' });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/at least 2/);
  });

  test('returns error when llamaService missing', async () => {
    const service = new ChatService({});
    const result = await service.query({ query: 'hello world' });
    expect(result.success).toBe(false);
    expect(result.error).toBe('Chat service unavailable');
  });

  test('handles conversational query with retrieval skipped', async () => {
    extractAndParseJSON.mockReturnValue({
      documentAnswer: [],
      modelAnswer: [{ text: 'Hello!' }],
      followUps: ['Find my docs?']
    });

    const llamaService = {
      analyzeText: jest.fn().mockResolvedValue({ success: true, response: '{"ok":true}' })
    };

    const service = new ChatService({ llamaService });
    const result = await service.query({ query: 'hello' });

    expect(result.success).toBe(true);
    expect(result.meta.retrievalSkipped).toBe(true);
    expect(result.response.modelAnswer[0].text).toBe('Hello!');
  });

  test('retrieval flow returns parsed response and sources', async () => {
    extractAndParseJSON.mockReturnValue({
      documentAnswer: [{ text: 'Doc answer', citations: ['doc-1'] }],
      modelAnswer: [{ text: 'Model answer' }],
      followUps: []
    });

    const searchService = {
      hybridSearch: jest.fn().mockResolvedValue({
        success: true,
        results: [
          {
            id: 'file-1',
            score: 0.9,
            metadata: { name: 'Doc', path: 'C:\\doc.txt', summary: 'Snippet' }
          }
        ],
        meta: { mode: 'hybrid' }
      }),
      chunkSearch: jest.fn().mockResolvedValue([])
    };

    const llamaService = {
      analyzeText: jest.fn().mockResolvedValue({ success: true, response: '{"ok":true}' })
    };

    const service = new ChatService({ searchService, llamaService, settingsService: {} });
    const result = await service.query({ query: 'find doc' });

    expect(result.success).toBe(true);
    expect(result.sources).toHaveLength(1);
    expect(result.response.documentAnswer[0].citations).toEqual(['doc-1']);
  });
});
