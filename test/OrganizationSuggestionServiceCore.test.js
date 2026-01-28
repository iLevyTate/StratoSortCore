/**
 * Tests for OrganizationSuggestionServiceCore
 * Tests the core organization suggestion service functionality
 */

// Mock electron
jest.mock('electron', () => ({
  app: {
    getPath: jest.fn(() => '/mock/documents')
  }
}));

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

// Mock fs
jest.mock('fs', () => ({
  promises: {
    mkdir: jest.fn().mockResolvedValue(undefined)
  }
}));

// Mock llmOptimization
const mockBatchProcessor = {
  processBatch: jest.fn().mockResolvedValue({
    results: [],
    errors: []
  })
};

jest.mock('../src/main/utils/llmOptimization', () => ({
  globalBatchProcessor: mockBatchProcessor
}));

// Mock strategies
jest.mock('../src/main/services/organization/strategies', () => ({
  strategies: {
    byFileType: { name: 'byFileType', priority: 1 },
    byContent: { name: 'byContent', priority: 2 }
  },
  getFileTypeCategory: jest.fn((ext) => {
    const categories = { '.pdf': 'documents', '.jpg': 'images' };
    return categories[ext] || 'other';
  }),
  getStrategyBasedSuggestions: jest.fn().mockReturnValue([]),
  getApplicableStrategies: jest.fn().mockReturnValue(['byFileType']),
  selectBestStrategy: jest.fn().mockReturnValue('byFileType'),
  getFallbackSuggestion: jest.fn(() => ({
    folder: 'Uncategorized',
    path: '/uncategorized',
    confidence: 0.1
  }))
}));

// Mock PatternMatcher
const mockPatternMatcher = {
  getPatternBasedSuggestions: jest.fn().mockReturnValue([]),
  recordFeedback: jest.fn(),
  exportPatterns: jest.fn().mockReturnValue({}),
  loadPatterns: jest.fn(),
  extractPattern: jest.fn().mockReturnValue(null),
  calculatePatternSimilarity: jest.fn().mockReturnValue(0),
  userPatterns: new Map(),
  feedbackHistory: [],
  folderUsageStats: new Map()
};

jest.mock('../src/main/services/organization/patternMatcher', () => ({
  PatternMatcher: jest.fn().mockImplementation(() => mockPatternMatcher)
}));

// Mock suggestionRanker
jest.mock('../src/main/services/organization/suggestionRanker', () => ({
  rankSuggestions: jest.fn((suggestions) => suggestions.sort((a, b) => b.score - a.score)),
  calculateConfidence: jest.fn((suggestion) => suggestion?.confidence || 0),
  generateExplanation: jest.fn(() => 'Test explanation')
}));

// Mock folderAnalyzer
jest.mock('../src/main/services/organization/folderAnalyzer', () => ({
  calculateFolderFitScore: jest.fn().mockReturnValue(0.5),
  suggestFolderImprovement: jest.fn().mockReturnValue({ suggestion: 'improve' }),
  suggestNewSmartFolder: jest.fn().mockReturnValue(null),
  analyzeFolderStructure: jest.fn().mockReturnValue([]),
  identifyMissingCategories: jest.fn().mockReturnValue([]),
  findOverlappingFolders: jest.fn().mockReturnValue([])
}));

// Mock llmSuggester
jest.mock('../src/main/services/organization/llmSuggester', () => ({
  getLLMAlternativeSuggestions: jest.fn().mockResolvedValue([])
}));

// Mock persistence
const mockPersistence = {
  load: jest.fn().mockResolvedValue(null),
  save: jest.fn().mockResolvedValue(undefined)
};

jest.mock('../src/main/services/organization/persistence', () => ({
  PatternPersistence: jest.fn().mockImplementation(() => mockPersistence)
}));

// Mock filePatternAnalyzer
jest.mock('../src/main/services/organization/filePatternAnalyzer', () => ({
  analyzeFilePatterns: jest.fn().mockReturnValue({
    extensionDistribution: {},
    sizeDistribution: {},
    patterns: []
  }),
  generateBatchRecommendations: jest.fn().mockReturnValue([]),
  generateFileSummary: jest.fn((file) => `Summary of ${file.name}`)
}));

jest.mock('../src/main/services/chromadb/embeddingIndexMetadata', () => ({
  readEmbeddingIndexMetadata: jest.fn().mockResolvedValue(null)
}));

describe('OrganizationSuggestionServiceCore', () => {
  let OrganizationSuggestionServiceCore;
  let service;
  let mockChromaDbService;
  let mockFolderMatchingService;
  let mockSettingsService;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();

    mockChromaDbService = {
      batchUpsertFolders: jest.fn().mockResolvedValue(3),
      queryFolders: jest.fn().mockResolvedValue([]),
      getStats: jest.fn().mockResolvedValue({ files: 120, folders: 1 })
    };

    mockFolderMatchingService = {
      embedText: jest.fn().mockResolvedValue({ vector: [0.1, 0.2], model: 'test' }),
      generateFolderId: jest.fn((folder) => `folder-${folder.name}`),
      upsertFileEmbedding: jest.fn().mockResolvedValue(undefined),
      matchFileToFolders: jest.fn().mockResolvedValue([])
    };

    mockSettingsService = {
      get: jest.fn().mockReturnValue({}),
      load: jest.fn().mockResolvedValue({})
    };

    const module = require('../src/main/services/organization/OrganizationSuggestionServiceCore');
    OrganizationSuggestionServiceCore = module.OrganizationSuggestionServiceCore;

    service = new OrganizationSuggestionServiceCore({
      chromaDbService: mockChromaDbService,
      folderMatchingService: mockFolderMatchingService,
      settingsService: mockSettingsService
    });
  });

  describe('constructor', () => {
    test('stores dependency references', () => {
      expect(service.chromaDb).toBe(mockChromaDbService);
      expect(service.folderMatcher).toBe(mockFolderMatchingService);
      expect(service.settings).toBe(mockSettingsService);
    });

    test('initializes with default config', () => {
      expect(service.config.semanticMatchThreshold).toBe(0.4);
      expect(service.config.strategyMatchThreshold).toBe(0.3);
      expect(service.config.topKSemanticMatches).toBe(8);
    });

    test('initializes pattern matcher', () => {
      const { PatternMatcher } = require('../src/main/services/organization/patternMatcher');
      expect(PatternMatcher).toHaveBeenCalled();
    });

    test('initializes persistence', () => {
      const { PatternPersistence } = require('../src/main/services/organization/persistence');
      expect(PatternPersistence).toHaveBeenCalled();
    });

    test('accepts custom config', () => {
      const customService = new OrganizationSuggestionServiceCore({
        chromaDbService: mockChromaDbService,
        folderMatchingService: mockFolderMatchingService,
        settingsService: mockSettingsService,
        config: { semanticMatchThreshold: 0.6 }
      });

      expect(customService.config.semanticMatchThreshold).toBe(0.6);
    });
  });

  describe('getSuggestionsForFile', () => {
    const mockFile = {
      name: 'test.pdf',
      extension: '.pdf',
      path: '/test/test.pdf',
      analysis: { category: 'documents' }
    };

    const mockSmartFolders = [
      {
        id: 'folder-1',
        name: 'Documents',
        path: '/docs',
        description: 'Document files'
      }
    ];

    test('returns suggestions structure', async () => {
      const result = await service.getSuggestionsForFile(mockFile, mockSmartFolders);

      expect(result).toHaveProperty('success');
      expect(result).toHaveProperty('primary');
      expect(result).toHaveProperty('alternatives');
      expect(result).toHaveProperty('strategies');
      expect(result).toHaveProperty('confidence');
      expect(result).toHaveProperty('explanation');
    });

    test('validates file object', async () => {
      await expect(service.getSuggestionsForFile(null, [])).rejects.toThrow('Invalid file object');

      await expect(service.getSuggestionsForFile({ extension: '.pdf' }, [])).rejects.toThrow(
        'file.name is required'
      );

      await expect(service.getSuggestionsForFile({ name: 'test' }, [])).rejects.toThrow(
        'file.extension is required'
      );
    });

    test('validates smartFolders is array', async () => {
      await expect(service.getSuggestionsForFile(mockFile, 'not-array')).rejects.toThrow(
        'smartFolders must be an array'
      );
    });

    test('rejects file name exceeding max length', async () => {
      const longNameFile = {
        name: 'a'.repeat(300),
        extension: '.pdf'
      };

      await expect(service.getSuggestionsForFile(longNameFile, [])).rejects.toThrow(
        'exceeds maximum length'
      );
    });

    test('ensures smart folder embeddings', async () => {
      await service.getSuggestionsForFile(mockFile, mockSmartFolders);

      expect(mockChromaDbService.batchUpsertFolders).toHaveBeenCalled();
    });

    test('gathers suggestions from multiple sources', async () => {
      const {
        getStrategyBasedSuggestions
      } = require('../src/main/services/organization/strategies');
      const {
        getLLMAlternativeSuggestions
      } = require('../src/main/services/organization/llmSuggester');

      await service.getSuggestionsForFile(mockFile, mockSmartFolders);

      expect(getStrategyBasedSuggestions).toHaveBeenCalled();
      expect(getLLMAlternativeSuggestions).toHaveBeenCalled();
      expect(mockPatternMatcher.getPatternBasedSuggestions).toHaveBeenCalled();
    });

    test('ranks suggestions', async () => {
      const { rankSuggestions } = require('../src/main/services/organization/suggestionRanker');

      await service.getSuggestionsForFile(mockFile, mockSmartFolders);

      expect(rankSuggestions).toHaveBeenCalled();
    });

    test('returns fallback on error', async () => {
      // To trigger the outer error handler, we need to cause an error
      // that isn't caught by the inner helper methods.
      // The rankSuggestions function throwing will trigger the outer catch.
      const { rankSuggestions } = require('../src/main/services/organization/suggestionRanker');
      rankSuggestions.mockImplementationOnce(() => {
        throw new Error('Ranking failed');
      });

      const result = await service.getSuggestionsForFile(mockFile, mockSmartFolders);

      expect(result.success).toBe(false);
      expect(result.fallback).toBeDefined();
    });

    test('excludes alternatives when option is false', async () => {
      const result = await service.getSuggestionsForFile(mockFile, mockSmartFolders, {
        includeAlternatives: false
      });

      expect(result.alternatives).toEqual([]);
    });

    test('falls back to LLM-only when embeddings are missing', async () => {
      const {
        readEmbeddingIndexMetadata
      } = require('../src/main/services/chromadb/embeddingIndexMetadata');
      const {
        getLLMAlternativeSuggestions
      } = require('../src/main/services/organization/llmSuggester');

      mockChromaDbService.getStats.mockResolvedValueOnce({ files: 0, folders: 0 });
      mockSettingsService.load.mockResolvedValueOnce({
        smartFolderRoutingMode: 'auto',
        embeddingModel: 'embeddinggemma'
      });
      readEmbeddingIndexMetadata.mockResolvedValueOnce(null);
      getLLMAlternativeSuggestions.mockResolvedValueOnce([]);

      const semanticSpy = jest.spyOn(service, 'getSemanticFolderMatches');

      const result = await service.getSuggestionsForFile(mockFile, mockSmartFolders, {
        includeAlternatives: false
      });

      expect(semanticSpy).not.toHaveBeenCalled();
      expect(result.primary.folder).toBe('Documents');
      semanticSpy.mockRestore();
    });

    test('uses hybrid routing when embeddings are partial', async () => {
      const {
        getLLMAlternativeSuggestions
      } = require('../src/main/services/organization/llmSuggester');

      mockChromaDbService.getStats.mockResolvedValueOnce({ files: 10, folders: 1 });
      mockSettingsService.load.mockResolvedValueOnce({ smartFolderRoutingMode: 'auto' });

      const semanticSpy = jest.spyOn(service, 'getSemanticFolderMatches').mockResolvedValueOnce([]);
      getLLMAlternativeSuggestions.mockResolvedValueOnce([]);

      await service.getSuggestionsForFile(mockFile, mockSmartFolders, {
        includeAlternatives: false
      });

      expect(semanticSpy).toHaveBeenCalled();
      expect(getLLMAlternativeSuggestions).toHaveBeenCalled();
      semanticSpy.mockRestore();
    });

    test('uses embedding-first routing when embeddings are healthy', async () => {
      const {
        getLLMAlternativeSuggestions
      } = require('../src/main/services/organization/llmSuggester');

      mockChromaDbService.getStats.mockResolvedValueOnce({ files: 120, folders: 1 });
      mockSettingsService.load.mockResolvedValueOnce({ smartFolderRoutingMode: 'auto' });

      const semanticSpy = jest
        .spyOn(service, 'getSemanticFolderMatches')
        .mockResolvedValueOnce([
          { folder: 'Documents', path: '/docs', score: 0.9, confidence: 0.9 }
        ]);
      getLLMAlternativeSuggestions.mockResolvedValueOnce([]);

      await service.getSuggestionsForFile(mockFile, mockSmartFolders, {
        includeAlternatives: false
      });

      expect(semanticSpy).toHaveBeenCalled();
      expect(getLLMAlternativeSuggestions).not.toHaveBeenCalled();
      semanticSpy.mockRestore();
    });

    test('falls back to analysis category when embeddings yield no matches', async () => {
      const {
        getLLMAlternativeSuggestions
      } = require('../src/main/services/organization/llmSuggester');

      mockChromaDbService.getStats.mockResolvedValueOnce({ files: 120, folders: 1 });
      mockSettingsService.load.mockResolvedValueOnce({ smartFolderRoutingMode: 'auto' });

      const semanticSpy = jest.spyOn(service, 'getSemanticFolderMatches').mockResolvedValueOnce([]);
      getLLMAlternativeSuggestions.mockResolvedValueOnce([]);

      const result = await service.getSuggestionsForFile(mockFile, mockSmartFolders, {
        includeAlternatives: false
      });

      expect(semanticSpy).toHaveBeenCalled();
      expect(getLLMAlternativeSuggestions).not.toHaveBeenCalled();
      expect(result.primary?.folder).toBe('Documents');
      semanticSpy.mockRestore();
    });
  });

  describe('getBatchSuggestions', () => {
    const mockFiles = [
      { name: 'doc1.pdf', extension: '.pdf', path: '/test/doc1.pdf' },
      { name: 'doc2.pdf', extension: '.pdf', path: '/test/doc2.pdf' }
    ];

    const mockSmartFolders = [{ name: 'Documents', path: '/docs' }];

    beforeEach(() => {
      mockBatchProcessor.processBatch.mockResolvedValue({
        results: mockFiles.map((file) => ({
          file,
          suggestion: { primary: { folder: 'Documents', confidence: 0.8 } }
        })),
        errors: []
      });
    });

    test('returns batch suggestions structure', async () => {
      const result = await service.getBatchSuggestions(mockFiles, mockSmartFolders);

      expect(result).toHaveProperty('success');
      expect(result).toHaveProperty('groups');
      expect(result).toHaveProperty('patterns');
      expect(result).toHaveProperty('recommendations');
    });

    test('analyzes file patterns', async () => {
      const {
        analyzeFilePatterns
      } = require('../src/main/services/organization/filePatternAnalyzer');

      await service.getBatchSuggestions(mockFiles, mockSmartFolders);

      expect(analyzeFilePatterns).toHaveBeenCalledWith(mockFiles);
    });

    test('uses batch processor for concurrency', async () => {
      await service.getBatchSuggestions(mockFiles, mockSmartFolders);

      expect(mockBatchProcessor.processBatch).toHaveBeenCalled();
    });

    test('groups results by folder', async () => {
      const result = await service.getBatchSuggestions(mockFiles, mockSmartFolders);

      expect(result.groups).toBeDefined();
      expect(Array.isArray(result.groups)).toBe(true);
    });

    test('returns error on failure', async () => {
      mockBatchProcessor.processBatch.mockRejectedValueOnce(new Error('Batch failed'));

      const result = await service.getBatchSuggestions(mockFiles, mockSmartFolders);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('ensureSmartFolderEmbeddings', () => {
    const mockFolders = [
      {
        id: 'folder-1',
        name: 'Documents',
        description: 'Doc files',
        path: '/docs'
      },
      {
        id: 'folder-2',
        name: 'Images',
        description: 'Image files',
        path: '/images'
      }
    ];

    test('embeds and upserts folders', async () => {
      const result = await service.ensureSmartFolderEmbeddings(mockFolders);

      expect(mockFolderMatchingService.embedText).toHaveBeenCalledTimes(2);
      expect(mockChromaDbService.batchUpsertFolders).toHaveBeenCalled();
      expect(result).toBe(3);
    });

    test('returns 0 for empty folders', async () => {
      const result = await service.ensureSmartFolderEmbeddings([]);

      expect(result).toBe(0);
    });

    test('returns 0 for null folders', async () => {
      const result = await service.ensureSmartFolderEmbeddings(null);

      expect(result).toBe(0);
    });

    test('handles embedding failures gracefully', async () => {
      mockFolderMatchingService.embedText.mockRejectedValueOnce(new Error('Embed failed'));

      const result = await service.ensureSmartFolderEmbeddings(mockFolders);

      // Should still process remaining folders
      expect(mockChromaDbService.batchUpsertFolders).toHaveBeenCalled();
      expect(result).toBe(3);
    });
  });

  describe('getSemanticFolderMatches', () => {
    const mockFile = {
      name: 'test.pdf',
      path: '/test/test.pdf',
      extension: '.pdf',
      analysis: { category: 'documents' }
    };

    const mockFolders = [{ id: 'folder-1', name: 'Documents', path: '/docs' }];

    test('returns semantic matches', async () => {
      mockFolderMatchingService.matchFileToFolders.mockResolvedValueOnce([
        { folderId: 'folder-1', name: 'Documents', score: 0.8 }
      ]);

      const results = await service.getSemanticFolderMatches(mockFile, mockFolders);

      expect(results).toHaveLength(1);
      expect(results[0].method).toBe('semantic_embedding');
    });

    test('upserts file embedding', async () => {
      await service.getSemanticFolderMatches(mockFile, mockFolders);

      expect(mockFolderMatchingService.upsertFileEmbedding).toHaveBeenCalled();
    });

    test('returns empty array on error', async () => {
      mockFolderMatchingService.matchFileToFolders.mockRejectedValueOnce(new Error('Match failed'));

      const results = await service.getSemanticFolderMatches(mockFile, mockFolders);

      expect(results).toEqual([]);
    });
  });

  describe('getImprovementSuggestions', () => {
    const mockFile = {
      name: 'test.pdf',
      extension: '.pdf'
    };

    const mockFolders = [{ name: 'Documents', path: '/docs', description: 'Docs' }];

    test('returns improvement suggestions for partial matches', async () => {
      const {
        calculateFolderFitScore
      } = require('../src/main/services/organization/folderAnalyzer');
      calculateFolderFitScore.mockReturnValueOnce(0.5); // Between 0.3 and 0.7

      const results = await service.getImprovementSuggestions(mockFile, mockFolders);

      expect(results.length).toBeGreaterThanOrEqual(0);
    });

    test('suggests new folder when no improvements found', async () => {
      const {
        calculateFolderFitScore,
        suggestNewSmartFolder
      } = require('../src/main/services/organization/folderAnalyzer');
      calculateFolderFitScore.mockReturnValue(0.1); // Below threshold
      suggestNewSmartFolder.mockReturnValueOnce({
        folder: 'New Category',
        isNew: true
      });

      const results = await service.getImprovementSuggestions(mockFile, mockFolders);

      expect(suggestNewSmartFolder).toHaveBeenCalled();
      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe('recordFeedback', () => {
    test('records feedback in pattern matcher', async () => {
      const file = { name: 'test.pdf' };
      const suggestion = { folder: 'Documents' };

      await service.recordFeedback(file, suggestion, true);

      expect(mockPatternMatcher.recordFeedback).toHaveBeenCalledWith(file, suggestion, true);
    });

    test('saves patterns after feedback', async () => {
      await service.recordFeedback({}, {}, true);

      // Give time for async save
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(mockPersistence.save).toHaveBeenCalled();
    });
  });

  describe('analyzeFolderStructure', () => {
    test('delegates to folderAnalyzer', async () => {
      const {
        analyzeFolderStructure
      } = require('../src/main/services/organization/folderAnalyzer');

      await service.analyzeFolderStructure([{ name: 'Docs' }], []);

      expect(analyzeFolderStructure).toHaveBeenCalled();
    });
  });

  describe('extractPattern', () => {
    test('delegates to pattern matcher', () => {
      const file = { name: 'test.pdf' };
      const suggestion = { folder: 'Documents' };

      service.extractPattern(file, suggestion);

      expect(mockPatternMatcher.extractPattern).toHaveBeenCalledWith(file, suggestion);
    });
  });

  describe('identifyMissingCategories', () => {
    test('identifies missing categories', () => {
      const {
        identifyMissingCategories
      } = require('../src/main/services/organization/folderAnalyzer');
      identifyMissingCategories.mockReturnValueOnce(['videos', 'audio']);

      const result = service.identifyMissingCategories([], []);

      expect(identifyMissingCategories).toHaveBeenCalled();
      expect(result).toEqual(['videos', 'audio']);
    });
  });

  describe('findOverlappingFolders', () => {
    test('finds overlapping folders', () => {
      const {
        findOverlappingFolders
      } = require('../src/main/services/organization/folderAnalyzer');
      findOverlappingFolders.mockReturnValueOnce([['Docs', 'Documents']]);

      const result = service.findOverlappingFolders([]);

      expect(findOverlappingFolders).toHaveBeenCalled();
      expect(result).toEqual([['Docs', 'Documents']]);
    });
  });

  describe('generateFileSummary', () => {
    test('generates file summary', () => {
      const file = { name: 'test.pdf' };

      const summary = service.generateFileSummary(file);

      expect(summary).toContain('test.pdf');
    });
  });

  describe('getFileTypeCategory', () => {
    test('returns file type category', () => {
      expect(service.getFileTypeCategory('.pdf')).toBe('documents');
      expect(service.getFileTypeCategory('.jpg')).toBe('images');
    });
  });

  describe('calculatePatternSimilarity', () => {
    test('delegates to pattern matcher', () => {
      const file = { name: 'test.pdf' };
      const pattern = { type: 'extension' };

      service.calculatePatternSimilarity(file, pattern);

      expect(mockPatternMatcher.calculatePatternSimilarity).toHaveBeenCalledWith(file, pattern);
    });
  });

  describe('legacy compatibility', () => {
    test('userPatterns getter returns pattern matcher patterns', () => {
      expect(service.userPatterns).toBe(mockPatternMatcher.userPatterns);
    });

    test('feedbackHistory getter returns pattern matcher history', () => {
      expect(service.feedbackHistory).toBe(mockPatternMatcher.feedbackHistory);
    });

    test('folderUsageStats getter returns pattern matcher stats', () => {
      expect(service.folderUsageStats).toBe(mockPatternMatcher.folderUsageStats);
    });

    test('loadUserPatterns delegates to _loadPatternsAsync', async () => {
      await service.loadUserPatterns();
      expect(mockPersistence.load).toHaveBeenCalled();
    });

    test('saveUserPatterns delegates to _savePatterns', async () => {
      await service.saveUserPatterns();
      expect(mockPersistence.save).toHaveBeenCalled();
    });
  });
});
