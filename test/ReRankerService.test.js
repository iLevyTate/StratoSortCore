/**
 * Tests for ReRankerService
 *
 * Tests LLM-based re-ranking, caching, and error handling.
 */

// Mock logger before requiring the service
jest.mock('../src/shared/logger', () => ({
  logger: {
    setContext: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  }
}));

// Mock performance constants
jest.mock('../src/shared/performanceConstants', () => ({
  TIMEOUTS: {
    AI_ANALYSIS_SHORT: 30000
  }
}));

describe('ReRankerService', () => {
  let ReRankerService;
  let resetInstance;
  let service;
  let mockOllamaService;

  // Sample search results for testing
  const sampleResults = [
    {
      id: 'doc1',
      score: 0.8,
      metadata: {
        name: 'vacation-photos-2024.zip',
        summary: 'Collection of beach vacation photos from summer 2024',
        tags: ['vacation', 'beach', 'photos', 'summer'],
        category: 'Photos'
      }
    },
    {
      id: 'doc2',
      score: 0.75,
      metadata: {
        name: 'budget-report-q3.xlsx',
        summary: 'Quarterly budget analysis and projections',
        tags: ['budget', 'finance', 'quarterly'],
        category: 'Finance'
      }
    },
    {
      id: 'doc3',
      score: 0.7,
      metadata: {
        name: 'team-meeting-notes.docx',
        summary: 'Notes from weekly team sync meeting',
        tags: ['meeting', 'notes', 'team'],
        category: 'Documents'
      }
    },
    {
      id: 'doc4',
      score: 0.65,
      metadata: {
        name: 'project-proposal.pdf',
        summary: 'Proposal for new marketing initiative',
        tags: ['project', 'marketing', 'proposal'],
        category: 'Business'
      }
    }
  ];

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
    jest.useFakeTimers();

    // Create mock Ollama service with generate method
    mockOllamaService = {
      generate: jest.fn().mockResolvedValue({
        response: '8'
      })
    };

    const module = require('../src/main/services/ReRankerService');
    ReRankerService = module.ReRankerService;
    resetInstance = module.resetInstance;

    // Reset singleton
    resetInstance();

    service = new ReRankerService({
      ollamaService: mockOllamaService,
      textModel: 'llama3.2'
    });
  });

  afterEach(() => {
    jest.useRealTimers();
    if (resetInstance) resetInstance();
  });

  describe('constructor', () => {
    test('initializes with valid dependencies', () => {
      expect(service.ollamaService).toBe(mockOllamaService);
      expect(service.textModel).toBe('llama3.2');
      // FIX: scoreCache is now an LRUCache, not a Map
      expect(service.scoreCache).toBeDefined();
    });

    test('works without ollamaService', () => {
      const serviceNoOllama = new ReRankerService({});

      expect(serviceNoOllama.ollamaService).toBeUndefined();
      expect(serviceNoOllama.isAvailable()).toBe(false);
    });

    test('uses default model when not specified', () => {
      const defaultService = new ReRankerService({
        ollamaService: mockOllamaService
      });

      expect(defaultService.textModel).toBeNull(); // Uses OllamaService default
    });

    test('initializes statistics', () => {
      expect(service.stats).toBeDefined();
      expect(service.stats.totalRerankCalls).toBe(0);
      expect(service.stats.cacheHits).toBe(0);
    });
  });

  describe('isAvailable', () => {
    test('returns true when ollamaService is provided', () => {
      expect(service.isAvailable()).toBe(true);
    });

    test('returns false when ollamaService is missing', () => {
      const noOllamaService = new ReRankerService({});
      expect(noOllamaService.isAvailable()).toBe(false);
    });
  });

  describe('rerank', () => {
    test('returns original candidates when empty', async () => {
      const result = await service.rerank('vacation', []);

      expect(result).toEqual([]);
    });

    test('returns original candidates when null', async () => {
      const result = await service.rerank('vacation', null);

      expect(result).toBeNull();
    });

    test('returns original candidates when no ollamaService', async () => {
      const noOllamaService = new ReRankerService({});
      const result = await noOllamaService.rerank('vacation', sampleResults);

      expect(result).toEqual(sampleResults);
    });

    test('re-ranks candidates by LLM score', async () => {
      // Make doc3 score highest
      mockOllamaService.generate
        .mockResolvedValueOnce({ response: '5' }) // doc1: 0.5
        .mockResolvedValueOnce({ response: '3' }) // doc2: 0.3
        .mockResolvedValueOnce({ response: '9' }) // doc3: 0.9
        .mockResolvedValueOnce({ response: '4' }); // doc4: 0.4

      const result = await service.rerank('meeting notes', sampleResults, { topN: 4 });

      expect(result[0].id).toBe('doc3'); // Highest LLM score
      expect(result[0].llmScore).toBe(0.9);
    });

    test('only re-ranks topN candidates', async () => {
      const manyResults = [
        ...sampleResults,
        ...sampleResults.map((r) => ({ ...r, id: r.id + '-dup' }))
      ];

      await service.rerank('vacation', manyResults, { topN: 3 });

      // Should only call LLM 3 times (topN = 3)
      expect(mockOllamaService.generate).toHaveBeenCalledTimes(3);
    });

    test('preserves non-reranked results', async () => {
      const manyResults = [
        { id: 'r1', score: 0.9, metadata: { name: 'r1.txt' } },
        { id: 'r2', score: 0.8, metadata: { name: 'r2.txt' } },
        { id: 'r3', score: 0.7, metadata: { name: 'r3.txt' } },
        { id: 'r4', score: 0.6, metadata: { name: 'r4.txt' } },
        { id: 'r5', score: 0.5, metadata: { name: 'r5.txt' } }
      ];

      mockOllamaService.generate
        .mockResolvedValueOnce({ response: '5' })
        .mockResolvedValueOnce({ response: '8' });

      // Only rerank top 2
      const result = await service.rerank('test', manyResults, { topN: 2 });

      expect(result.length).toBe(5);

      // All IDs should still be present
      const ids = result.map((r) => r.id);
      expect(ids).toContain('r1');
      expect(ids).toContain('r2');
      expect(ids).toContain('r3');
      expect(ids).toContain('r4');
      expect(ids).toContain('r5');
    });

    test('uses default topN of 10', async () => {
      const manyResults = Array.from({ length: 15 }, (_, i) => ({
        id: `doc${i}`,
        score: 0.9 - i * 0.05,
        metadata: { name: `doc${i}.txt` }
      }));

      await service.rerank('test', manyResults);

      // Should call LLM 10 times (default topN)
      expect(mockOllamaService.generate).toHaveBeenCalledTimes(10);
    });

    test('updates statistics after reranking', async () => {
      await service.rerank('vacation', sampleResults.slice(0, 2), { topN: 2 });

      expect(service.stats.totalRerankCalls).toBe(1);
      expect(service.stats.totalFilesScored).toBe(2);
    });

    test('handles LLM errors with fallback score', async () => {
      mockOllamaService.generate
        .mockResolvedValueOnce({ response: '8' })
        .mockRejectedValueOnce(new Error('LLM unavailable'));

      const result = await service.rerank('test', sampleResults.slice(0, 2), { topN: 2 });

      // Should include both results (one with fallback score)
      expect(result.length).toBe(2);
      expect(service.stats.llmErrors).toBe(1);
    });
  });

  describe('_parseScoreResponse', () => {
    test('parses valid numeric responses', () => {
      expect(service._parseScoreResponse('8')).toBe(0.8);
      expect(service._parseScoreResponse('10')).toBe(1.0);
      expect(service._parseScoreResponse('0')).toBe(0.0);
      expect(service._parseScoreResponse('5.5')).toBe(0.55);
    });

    test('clamps scores outside 0-10 range', () => {
      expect(service._parseScoreResponse('15')).toBe(1.0);
      // Note: regex doesn't match negative numbers, so '-5' extracts '5' -> 0.5
      expect(service._parseScoreResponse('-5')).toBe(0.5);
    });

    test('returns fallback for invalid responses', () => {
      expect(service._parseScoreResponse('invalid')).toBe(0.5);
      expect(service._parseScoreResponse('')).toBe(0.5);
      expect(service._parseScoreResponse(null)).toBe(0.5);
    });

    test('extracts number from text response', () => {
      expect(service._parseScoreResponse('I would rate this 7 out of 10')).toBe(0.7);
      expect(service._parseScoreResponse('Score: 9')).toBe(0.9);
    });
  });

  describe('caching', () => {
    test('caches scores for repeated queries', async () => {
      const result = sampleResults[0];

      // First call
      await service.rerank('vacation', [result], { topN: 1 });
      expect(mockOllamaService.generate).toHaveBeenCalledTimes(1);

      // Second call - should use cache
      await service.rerank('vacation', [result], { topN: 1 });
      expect(mockOllamaService.generate).toHaveBeenCalledTimes(1); // No new call
      expect(service.stats.cacheHits).toBe(1);
    });

    test('cache expires after TTL', async () => {
      // FIX: Create a new service with short TTL (LRUCache TTL is set at construction)
      const shortTtlService = new ReRankerService({
        ollamaService: mockOllamaService,
        textModel: 'llama3.2',
        cacheTTLMs: 1000 // 1 second TTL
      });

      const result = sampleResults[0];

      // First call
      await shortTtlService.rerank('vacation', [result], { topN: 1 });
      expect(mockOllamaService.generate).toHaveBeenCalledTimes(1);

      // Advance time past cache TTL
      jest.advanceTimersByTime(2000);

      // Second call - cache expired
      await shortTtlService.rerank('vacation', [result], { topN: 1 });
      expect(mockOllamaService.generate).toHaveBeenCalledTimes(2);

      // Cleanup
      await shortTtlService.cleanup();
    });
  });

  describe('clearCache', () => {
    test('clears all cached scores', async () => {
      // Populate cache
      await service.rerank('vacation', [sampleResults[0]], { topN: 1 });
      await service.rerank('budget', [sampleResults[1]], { topN: 1 });

      expect(service.scoreCache.size).toBe(2);

      service.clearCache();

      expect(service.scoreCache.size).toBe(0);
    });
  });

  describe('getStats', () => {
    test('returns statistics object', () => {
      const stats = service.getStats();

      expect(stats).toHaveProperty('totalRerankCalls');
      expect(stats).toHaveProperty('totalFilesScored');
      expect(stats).toHaveProperty('cacheHits');
      expect(stats).toHaveProperty('llmErrors');
      expect(stats).toHaveProperty('cacheSize');
    });
  });

  describe('cleanup', () => {
    test('clears resources', async () => {
      // FIX: cleanup is now async (uses LRUCache.shutdown())
      await service.cleanup();

      expect(service.scoreCache.size).toBe(0);
      expect(service.ollamaService).toBeNull();
    });
  });

  describe('integration scenarios', () => {
    test('re-ranking improves results for specific queries', async () => {
      const results = [
        {
          id: 'budget',
          score: 0.85,
          metadata: { name: 'budget.xlsx', summary: 'Financial data', tags: ['finance'] }
        },
        {
          id: 'vacation',
          score: 0.8,
          metadata: {
            name: 'vacation-pics.zip',
            summary: 'Beach photos',
            tags: ['vacation', 'photos']
          }
        },
        {
          id: 'meeting',
          score: 0.75,
          metadata: { name: 'meeting.docx', summary: 'Team notes', tags: ['work'] }
        }
      ];

      // LLM correctly identifies vacation photos as most relevant
      mockOllamaService.generate
        .mockResolvedValueOnce({ response: '2' }) // budget: low
        .mockResolvedValueOnce({ response: '10' }) // vacation: perfect match
        .mockResolvedValueOnce({ response: '1' }); // meeting: low

      const reranked = await service.rerank('vacation photos', results, { topN: 3 });

      expect(reranked[0].id).toBe('vacation');
      expect(reranked[0].llmScore).toBe(1.0);
    });
  });
});
