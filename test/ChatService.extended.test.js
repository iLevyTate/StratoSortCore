/**
 * Extended tests for ChatService.
 * Covers _retrieveSources, _buildPrompt, _parseResponse,
 * session memory, conversational detection, and error handling.
 */

jest.mock('../src/shared/logger', () => ({
  createLogger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
  })
}));

jest.mock('../src/shared/vectorMath', () => ({
  cosineSimilarity: jest.fn().mockReturnValue(0.85),
  padOrTruncateVector: jest.fn((v) => v)
}));

jest.mock('../src/main/utils/jsonRepair', () => ({
  extractAndParseJSON: jest.fn((text) => {
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  })
}));

jest.mock('../src/shared/chatPersonas', () => ({
  getChatPersonaOrDefault: jest.fn(() => ({
    name: 'Default',
    description: 'A helpful assistant'
  }))
}));

const ChatService = require('../src/main/services/ChatService');

function createTestService(overrides = {}) {
  const defaults = {
    searchService: {
      hybridSearch: jest.fn().mockResolvedValue({
        success: true,
        results: [
          {
            id: 'file-1',
            score: 0.9,
            metadata: {
              name: 'test.pdf',
              path: '/docs/test.pdf',
              summary: 'A test document',
              type: 'document'
            }
          }
        ],
        meta: { mode: 'hybrid' }
      }),
      chunkSearch: jest.fn().mockResolvedValue([])
    },
    vectorDbService: {
      getFile: jest.fn().mockResolvedValue(null)
    },
    embeddingService: {
      embedText: jest.fn().mockResolvedValue({ vector: [0.1, 0.2] })
    },
    llamaService: {
      analyzeText: jest.fn().mockResolvedValue({
        success: true,
        response: JSON.stringify({
          modelAnswer: [{ text: 'Here is the answer.' }],
          documentAnswer: [{ text: 'From doc-1: relevant info', citations: ['doc-1'] }],
          followUps: ['What else?']
        })
      })
    },
    settingsService: {
      load: jest.fn().mockResolvedValue({})
    }
  };

  return new ChatService({ ...defaults, ...overrides });
}

describe('ChatService – extended coverage', () => {
  describe('_isConversational', () => {
    test('detects greetings', () => {
      const service = createTestService();
      expect(service._isConversational('hello')).toBe(true);
      expect(service._isConversational('Hi!')).toBe(true);
      expect(service._isConversational('good morning')).toBe(true);
      expect(service._isConversational('thanks')).toBe(true);
    });

    test('rejects real queries', () => {
      const service = createTestService();
      expect(service._isConversational('find my tax returns')).toBe(false);
      expect(service._isConversational('what are the quarterly results')).toBe(false);
    });
  });

  describe('_retrieveSources', () => {
    test('returns sources from hybrid search', async () => {
      const service = createTestService();

      const result = await service._retrieveSources('find documents', {
        topK: 5,
        mode: 'hybrid',
        chunkTopK: 10,
        chunkWeight: 0.2,
        contextFileIds: []
      });

      expect(result.sources).toHaveLength(1);
      expect(result.sources[0].name).toBe('test.pdf');
      expect(result.meta.retrievalAvailable).toBe(true);
    });

    test('returns empty when search service unavailable', async () => {
      const service = createTestService({ searchService: null });

      const result = await service._retrieveSources('query', {
        topK: 5,
        mode: 'hybrid',
        chunkTopK: 10,
        chunkWeight: 0.2,
        contextFileIds: []
      });

      expect(result.sources).toEqual([]);
      expect(result.meta.retrievalAvailable).toBe(false);
    });

    test('handles search failure gracefully', async () => {
      const service = createTestService({
        searchService: {
          hybridSearch: jest.fn().mockRejectedValue(new Error('index missing')),
          chunkSearch: jest.fn()
        }
      });

      const result = await service._retrieveSources('query', {
        topK: 5,
        mode: 'hybrid',
        chunkTopK: 10,
        chunkWeight: 0.2,
        contextFileIds: []
      });

      expect(result.sources).toEqual([]);
      expect(result.meta.error).toContain('index missing');
    });

    test('handles unsuccessful search results', async () => {
      const service = createTestService({
        searchService: {
          hybridSearch: jest.fn().mockResolvedValue({
            success: false,
            error: 'dimension mismatch'
          }),
          chunkSearch: jest.fn()
        }
      });

      const result = await service._retrieveSources('query', {
        topK: 5,
        mode: 'hybrid',
        chunkTopK: 10,
        chunkWeight: 0.2,
        contextFileIds: []
      });

      expect(result.sources).toEqual([]);
      expect(result.meta.error).toBe('dimension mismatch');
    });

    test('handles chunk search failure gracefully', async () => {
      const service = createTestService();
      service.searchService.chunkSearch = jest.fn().mockRejectedValue(new Error('chunk error'));

      const result = await service._retrieveSources('query', {
        topK: 5,
        mode: 'hybrid',
        chunkTopK: 10,
        chunkWeight: 0.2,
        contextFileIds: []
      });

      // Should still succeed with base results
      expect(result.sources).toHaveLength(1);
    });
  });

  describe('_buildPrompt', () => {
    test('builds prompt with sources and history', () => {
      const service = createTestService();
      const prompt = service._buildPrompt({
        query: 'What is in my documents?',
        history: 'User: hello\nAssistant: Hi!',
        sources: [{ id: 'doc-1', name: 'test.pdf', snippet: 'Test content', score: 0.9 }],
        persona: { name: 'Default', description: 'A helper' }
      });

      expect(typeof prompt).toBe('string');
      expect(prompt).toContain('What is in my documents?');
      expect(prompt).toContain('test.pdf');
    });

    test('builds prompt without sources', () => {
      const service = createTestService();
      const prompt = service._buildPrompt({
        query: 'random question',
        history: '',
        sources: [],
        persona: { name: 'Default', description: 'A helper' }
      });

      expect(typeof prompt).toBe('string');
      expect(prompt).toContain('random question');
    });
  });

  describe('_parseResponse', () => {
    test('parses valid JSON response', () => {
      const service = createTestService();
      const json = JSON.stringify({
        modelAnswer: [{ text: 'Hello' }],
        documentAnswer: [{ text: 'From doc', citations: ['doc-1'] }],
        followUps: ['Next?']
      });

      const parsed = service._parseResponse(json, [{ id: 'doc-1' }]);

      expect(parsed.modelAnswer[0].text).toBe('Hello');
      expect(parsed.documentAnswer).toBeDefined();
      expect(parsed.followUps).toContain('Next?');
    });

    test('returns fallback on invalid JSON', () => {
      const service = createTestService();
      const parsed = service._parseResponse('not json at all', []);

      // Should return a structured fallback, not crash
      expect(parsed).toBeDefined();
      expect(parsed.modelAnswer).toBeDefined();
    });

    test('handles null response', () => {
      const service = createTestService();
      const parsed = service._parseResponse(null, []);

      expect(parsed).toBeDefined();
      expect(parsed.modelAnswer).toBeDefined();
    });
  });

  describe('session memory', () => {
    test('creates and caches sessions', async () => {
      const service = createTestService();

      const mem1 = await service._getSessionMemory('session-1');
      const mem2 = await service._getSessionMemory('session-1');

      expect(mem1).toBe(mem2); // Same reference
    });

    test('evicts oldest session at capacity', async () => {
      const service = createTestService();

      // Fill to capacity (MAX_SESSIONS = 50)
      for (let i = 0; i < 50; i++) {
        await service._getSessionMemory(`s-${i}`);
      }
      expect(service.sessions.size).toBe(50);

      // Adding one more should evict the oldest
      await service._getSessionMemory('s-new');
      expect(service.sessions.size).toBe(50);
      expect(service.sessions.has('s-0')).toBe(false);
      expect(service.sessions.has('s-new')).toBe(true);
    });

    test('resetSession removes session', async () => {
      const service = createTestService();
      await service._getSessionMemory('to-reset');

      expect(service.sessions.has('to-reset')).toBe(true);
      await service.resetSession('to-reset');
      expect(service.sessions.has('to-reset')).toBe(false);
    });

    test('memory tracks conversation turns', async () => {
      const service = createTestService();
      const memory = await service._createMemory();

      await memory.saveContext({ input: 'Hello' }, { output: 'Hi there!' });
      const vars = await memory.loadMemoryVariables({});

      expect(vars.history).toContain('User: Hello');
      expect(vars.history).toContain('Assistant: Hi there!');
    });

    test('memory enforces window limit', async () => {
      const service = createTestService();
      const memory = await service._createMemory();

      // Default window is 6 turns = 12 lines
      for (let i = 0; i < 10; i++) {
        await memory.saveContext({ input: `Q${i}` }, { output: `A${i}` });
      }

      const vars = await memory.loadMemoryVariables({});
      const lines = vars.history.split('\n').filter((l) => l.trim());

      // Should be capped at memoryWindow * 2 = 12 lines
      expect(lines.length).toBeLessThanOrEqual(12);
    });
  });

  describe('query – full flow', () => {
    test('rejects too-short queries', async () => {
      const service = createTestService();
      const result = await service.query({ query: 'a' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('at least 2 characters');
    });

    test('returns error when llamaService is null', async () => {
      const service = createTestService({ llamaService: null });
      const result = await service.query({ query: 'test query' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('unavailable');
    });

    test('returns LLM failure when analyzeText fails', async () => {
      const service = createTestService({
        llamaService: {
          analyzeText: jest.fn().mockResolvedValue({
            success: false,
            error: 'model unloaded'
          })
        }
      });

      const result = await service.query({ query: 'test query', sessionId: 'x' });

      expect(result.success).toBe(false);
      expect(result.error).toBe('model unloaded');
    });

    test('provides fallback response when model returns empty', async () => {
      const service = createTestService({
        llamaService: {
          analyzeText: jest.fn().mockResolvedValue({
            success: true,
            response: JSON.stringify({
              modelAnswer: [],
              documentAnswer: [],
              followUps: []
            })
          })
        }
      });

      const result = await service.query({ query: 'obscure query', sessionId: 'y' });

      expect(result.success).toBe(true);
      // Fallback response should be added
      expect(result.response.modelAnswer.length).toBeGreaterThan(0);
    });
  });
});
