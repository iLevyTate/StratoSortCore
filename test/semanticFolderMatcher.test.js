jest.mock('../src/shared/logger', () => ({
  createLogger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
  })
}));

jest.mock('../src/shared/performanceConstants', () => ({
  THRESHOLDS: {
    FOLDER_MATCH_CONFIDENCE: 0.75
  },
  TIMEOUTS: {
    EMBEDDING_REQUEST: 5000,
    SEMANTIC_QUERY: 5000
  }
}));

jest.mock('../src/main/services/ServiceContainer', () => ({
  ServiceIds: {
    ORAMA_VECTOR: 'ORAMA_VECTOR',
    FOLDER_MATCHING: 'FOLDER_MATCHING'
  },
  container: {
    tryResolve: jest.fn()
  }
}));

jest.mock('../src/main/analysis/embeddingQueue/stageQueues', () => ({
  analysisQueue: {
    enqueue: jest.fn().mockResolvedValue(undefined)
  }
}));

jest.mock('../src/shared/folderUtils', () => ({
  findContainingSmartFolder: jest.fn()
}));

jest.mock('../src/main/services/embedding/embeddingGate', () => ({
  shouldEmbed: jest.fn().mockResolvedValue({ shouldEmbed: true, timing: 'ok', policy: 'ok' })
}));

jest.mock('../src/main/analysis/embeddingSummary', () => ({
  buildEmbeddingSummary: jest.fn(() => ({
    text: 'summary',
    wasTruncated: false,
    estimatedTokens: 10
  }))
}));

jest.mock('../src/shared/pathSanitization', () => ({
  normalizePathForIndex: (p) => p,
  getCanonicalFileId: (p) => `image:${p}`
}));

jest.mock('../src/shared/promiseUtils', () => ({
  withTimeout: jest.fn((p) => p)
}));

const { container } = require('../src/main/services/ServiceContainer');
const { analysisQueue } = require('../src/main/analysis/embeddingQueue/stageQueues');
const { findContainingSmartFolder } = require('../src/shared/folderUtils');
const { shouldEmbed } = require('../src/main/services/embedding/embeddingGate');

const {
  applySemanticFolderMatching,
  validateMatcher
} = require('../src/main/analysis/semanticFolderMatcher');

describe('semanticFolderMatcher', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('validateMatcher requires expected methods', () => {
    expect(validateMatcher(null)).toBeFalsy();
    expect(
      validateMatcher({
        initialize() {},
        batchUpsertFolders() {},
        embedText() {},
        matchVectorToFolders() {}
      })
    ).toBe(true);
  });

  test('skips when vector DB is unavailable', async () => {
    container.tryResolve.mockReturnValueOnce(null);
    const analysis = { category: 'Financial', confidence: 0.9 };

    const result = await applySemanticFolderMatching({
      analysis,
      filePath: 'C:\\a.pdf',
      fileName: 'a.pdf',
      fileExtension: '.pdf',
      smartFolders: []
    });

    expect(result).toBe(analysis);
    expect(analysisQueue.enqueue).not.toHaveBeenCalled();
  });

  test('skips when matcher is invalid', async () => {
    container.tryResolve
      .mockReturnValueOnce({ initialize: jest.fn() }) // vectorDb
      .mockReturnValueOnce({}); // matcher missing methods

    const analysis = { category: 'Financial', confidence: 0.9 };
    const result = await applySemanticFolderMatching({
      analysis,
      filePath: 'C:\\a.pdf',
      fileName: 'a.pdf',
      fileExtension: '.pdf',
      smartFolders: []
    });
    expect(result).toBe(analysis);
  });

  test('initializes matcher, upserts folders, enqueues embedding when file is in smart folder', async () => {
    const vectorDb = { initialize: jest.fn().mockResolvedValue(undefined) };
    const matcher = {
      embeddingCache: { initialized: false },
      initialize: jest.fn().mockResolvedValue(undefined),
      batchUpsertFolders: jest.fn().mockResolvedValue({ count: 1 }),
      embedText: jest.fn().mockResolvedValue({ vector: [1, 2, 3], model: 'm' }),
      matchVectorToFolders: jest.fn().mockResolvedValue([])
    };

    container.tryResolve.mockReturnValueOnce(vectorDb).mockReturnValueOnce(matcher);

    findContainingSmartFolder.mockReturnValue({ name: 'Financial', path: 'C:\\Sorted\\Financial' });
    shouldEmbed.mockResolvedValue({ shouldEmbed: true, timing: 'ok', policy: 'ok' });

    const analysis = { category: 'Documents', confidence: 0.9, keywords: ['a'] };

    const result = await applySemanticFolderMatching({
      analysis,
      filePath: 'C:\\Sorted\\Financial\\a.pdf',
      fileName: 'a.pdf',
      fileExtension: '.pdf',
      fileSize: 123,
      extractedText: 'text',
      smartFolders: [{ name: 'Financial', path: 'C:\\Sorted\\Financial' }]
    });

    expect(result).toBe(analysis);
    expect(matcher.initialize).toHaveBeenCalled();
    expect(matcher.batchUpsertFolders).toHaveBeenCalledWith([
      { name: 'Financial', path: 'C:\\Sorted\\Financial' }
    ]);
    expect(analysisQueue.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        id: expect.stringContaining('file:C:\\Sorted\\Financial\\a.pdf'),
        vector: [1, 2, 3],
        model: 'm',
        meta: expect.objectContaining({
          path: 'C:\\Sorted\\Financial\\a.pdf',
          name: 'a.pdf',
          smartFolder: 'Financial'
        })
      })
    );
  });

  test('overrides category when embedding match exceeds threshold and effective LLM confidence', async () => {
    const vectorDb = { initialize: jest.fn().mockResolvedValue(undefined) };
    const matcher = {
      embeddingCache: { initialized: true },
      initialize: jest.fn(),
      batchUpsertFolders: jest.fn().mockResolvedValue({ count: 1 }),
      embedText: jest.fn().mockResolvedValue({ vector: [1, 2, 3], model: 'm' }),
      matchVectorToFolders: jest
        .fn()
        .mockResolvedValue([{ name: 'Financial', path: 'C:\\Sorted\\Financial', score: 0.9 }])
    };
    container.tryResolve.mockReturnValueOnce(vectorDb).mockReturnValueOnce(matcher);

    findContainingSmartFolder.mockReturnValue(null);

    const analysis = { category: 'Documents', confidence: 0.95 };
    await applySemanticFolderMatching({
      analysis,
      filePath: 'C:\\a.pdf',
      fileName: 'a.pdf',
      fileExtension: '.pdf',
      smartFolders: [{ name: 'Financial' }]
    });

    expect(analysis.category).toBe('Financial');
    expect(analysis.categorySource).toBe('embedding_override');
    expect(analysis.suggestedFolder).toBe('Financial');
    expect(analysis.destinationFolder).toBe('C:\\Sorted\\Financial');
    expect(analysis.folderMatchCandidates).toHaveLength(1);
  });

  test('preserves LLM category when confidence is higher than embedding', async () => {
    const vectorDb = { initialize: jest.fn().mockResolvedValue(undefined) };
    const matcher = {
      embeddingCache: { initialized: true },
      initialize: jest.fn(),
      batchUpsertFolders: jest.fn().mockResolvedValue({ count: 1 }),
      embedText: jest.fn().mockResolvedValue({ vector: [1, 2, 3], model: 'm' }),
      matchVectorToFolders: jest
        .fn()
        .mockResolvedValue([{ name: 'Financial', path: 'C:\\Sorted\\Financial', score: 0.8 }])
    };
    container.tryResolve.mockReturnValueOnce(vectorDb).mockReturnValueOnce(matcher);

    const analysis = { category: 'Financial', confidence: 0.95 };
    await applySemanticFolderMatching({
      analysis,
      filePath: 'C:\\a.pdf',
      fileName: 'a.pdf',
      fileExtension: '.pdf',
      smartFolders: [{ name: 'Financial' }]
    });

    expect(analysis.category).toBe('Financial');
    expect(analysis.categorySource).toBe('llm_preserved');
  });
});
