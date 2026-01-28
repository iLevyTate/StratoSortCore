const ChatService = require('../src/main/services/ChatService');

describe('ChatService', () => {
  test('filters citations to known sources and normalizes output', () => {
    const service = new ChatService({
      searchService: {},
      chromaDbService: {},
      embeddingService: {},
      ollamaService: {}
    });

    const sources = [{ id: 'doc-1' }, { id: 'doc-2' }];
    const raw = JSON.stringify({
      documentAnswer: [
        {
          text: 'This is supported by docs.',
          citations: ['doc-1', 'doc-3']
        }
      ],
      modelAnswer: [
        {
          text: 'This is model knowledge.'
        }
      ],
      followUps: ['What else should I review?']
    });

    const parsed = service._parseResponse(raw, sources);

    expect(parsed.documentAnswer).toHaveLength(1);
    expect(parsed.documentAnswer[0].citations).toEqual(['doc-1']);
    expect(parsed.modelAnswer).toHaveLength(1);
    expect(parsed.modelAnswer[0].text).toBe('This is model knowledge.');
    expect(parsed.followUps).toEqual(['What else should I review?']);
  });

  test('allows model-only responses when retrieval fails', async () => {
    const searchService = {
      hybridSearch: jest.fn().mockResolvedValue({
        success: false,
        error: 'ChromaDB down'
      }),
      chunkSearch: jest.fn().mockResolvedValue([])
    };
    const ollamaService = {
      analyzeText: jest.fn().mockResolvedValue({
        success: true,
        response: JSON.stringify({
          documentAnswer: [
            {
              text: 'This should be cleared when there are no sources.',
              citations: ['doc-1']
            }
          ],
          modelAnswer: [{ text: 'General answer.' }],
          followUps: []
        })
      })
    };
    const service = new ChatService({
      searchService,
      chromaDbService: {},
      embeddingService: {},
      ollamaService
    });

    const result = await service.query({ query: 'What is in my docs?' });

    expect(result.success).toBe(true);
    expect(result.sources).toHaveLength(0);
    expect(result.meta.retrievalAvailable).toBe(false);
    expect(result.meta.warning).toContain('ChromaDB down');
    expect(result.response.documentAnswer).toEqual([]);
    expect(result.response.modelAnswer).toHaveLength(1);
  });

  test('adds warning metadata when search falls back', async () => {
    const searchService = {
      hybridSearch: jest.fn().mockResolvedValue({
        success: true,
        results: [
          {
            id: 'file-1',
            score: 0.82,
            metadata: {
              name: 'Invoice.pdf',
              path: '/docs/Invoice.pdf',
              type: 'document'
            }
          }
        ],
        mode: 'bm25-fallback',
        meta: {
          fallback: true,
          fallbackReason: 'vector search timeout'
        }
      }),
      chunkSearch: jest.fn().mockResolvedValue([])
    };
    const ollamaService = {
      analyzeText: jest.fn().mockResolvedValue({
        success: true,
        response: JSON.stringify({
          documentAnswer: [],
          modelAnswer: [{ text: 'Fallback response.' }],
          followUps: []
        })
      })
    };
    const service = new ChatService({
      searchService,
      chromaDbService: {},
      embeddingService: {},
      ollamaService
    });

    const result = await service.query({ query: 'Find invoices' });

    expect(result.success).toBe(true);
    expect(result.meta.fallback).toBe(true);
    expect(result.meta.fallbackReason).toBe('vector search timeout');
    expect(result.meta.warning).toMatch(/Limited document retrieval/i);
  });
});
