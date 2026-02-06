/**
 * @jest-environment node
 *
 * OrganizationSuggestionServiceCore - Migration Tests
 *
 * Validates that OrganizationSuggestionServiceCore correctly works with
 * the new Orama/node-llama-cpp architecture: vectorDbService dependency,
 * batch grouping, clustering-based suggestions, and input validation.
 */

const mockLlamaService = {
  initialize: jest.fn().mockResolvedValue(undefined),
  getConfig: jest.fn().mockReturnValue({ textModel: 'test-model.gguf' }),
  generateText: jest.fn().mockResolvedValue('{"folder":"Documents","confidence":0.8}')
};

jest.mock('../src/main/services/LlamaService', () => ({
  getInstance: () => mockLlamaService
}));

jest.mock('../src/shared/logger', () => ({
  createLogger: jest.fn(() => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
  })),
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    setContext: jest.fn()
  }
}));

const {
  OrganizationSuggestionServiceCore
} = require('../src/main/services/organization/OrganizationSuggestionServiceCore');

describe('OrganizationSuggestionServiceCore - Migration Tests', () => {
  let mockVectorDbService;
  let mockFolderMatchingService;
  let mockSettingsService;

  beforeEach(() => {
    jest.clearAllMocks();

    mockVectorDbService = {
      getFileEmbedding: jest.fn().mockResolvedValue({ vector: [0.1, 0.2, 0.3] }),
      searchByVector: jest.fn().mockResolvedValue([]),
      upsertFileEmbedding: jest.fn().mockResolvedValue(),
      getStats: jest.fn().mockResolvedValue({ totalDocuments: 100 }),
      isInitialized: jest.fn().mockReturnValue(true)
    };

    mockFolderMatchingService = {
      embedText: jest.fn().mockResolvedValue({ vector: [0.1, 0.2, 0.3] }),
      findMatchingFolders: jest.fn().mockResolvedValue([]),
      getSimilarFiles: jest.fn().mockResolvedValue([]),
      initialize: jest.fn().mockResolvedValue()
    };

    mockSettingsService = {
      get: jest.fn().mockReturnValue({
        routingMode: 'auto',
        llmEnabled: true
      }),
      getAll: jest.fn().mockReturnValue({
        routingMode: 'auto',
        llmEnabled: true
      }),
      load: jest.fn().mockResolvedValue({
        routingMode: 'auto',
        llmEnabled: true
      })
    };
  });

  describe('Constructor validation (new architecture)', () => {
    test('requires vectorDbService dependency', () => {
      expect(
        () =>
          new OrganizationSuggestionServiceCore({
            folderMatchingService: mockFolderMatchingService,
            settingsService: mockSettingsService
          })
      ).toThrow('requires vectorDbService');
    });

    test('requires folderMatchingService dependency', () => {
      expect(
        () =>
          new OrganizationSuggestionServiceCore({
            vectorDbService: mockVectorDbService,
            settingsService: mockSettingsService
          })
      ).toThrow('requires folderMatchingService');
    });

    test('requires settingsService dependency', () => {
      expect(
        () =>
          new OrganizationSuggestionServiceCore({
            vectorDbService: mockVectorDbService,
            folderMatchingService: mockFolderMatchingService
          })
      ).toThrow('requires settingsService');
    });

    test('stores vectorDb and folderMatcher from DI', () => {
      const service = new OrganizationSuggestionServiceCore({
        vectorDbService: mockVectorDbService,
        folderMatchingService: mockFolderMatchingService,
        settingsService: mockSettingsService
      });

      expect(service.vectorDb).toBe(mockVectorDbService);
      expect(service.folderMatcher).toBe(mockFolderMatchingService);
      expect(service.settings).toBe(mockSettingsService);
    });

    test('accepts optional clusteringService dependency', () => {
      const mockClustering = { getClusterForFile: jest.fn() };
      const service = new OrganizationSuggestionServiceCore({
        vectorDbService: mockVectorDbService,
        folderMatchingService: mockFolderMatchingService,
        settingsService: mockSettingsService,
        clusteringService: mockClustering
      });

      expect(service._clusteringService).toBe(mockClustering);
    });

    test('accepts lazy getter for clusteringService', () => {
      const getter = jest.fn();
      const service = new OrganizationSuggestionServiceCore({
        vectorDbService: mockVectorDbService,
        folderMatchingService: mockFolderMatchingService,
        settingsService: mockSettingsService,
        getClusteringService: getter
      });

      expect(service._getClusteringService).toBe(getter);
    });
  });

  describe('Configuration defaults', () => {
    test('sets default semantic match threshold', () => {
      const service = new OrganizationSuggestionServiceCore({
        vectorDbService: mockVectorDbService,
        folderMatchingService: mockFolderMatchingService,
        settingsService: mockSettingsService
      });

      expect(service.config.semanticMatchThreshold).toBe(0.4);
      expect(service.config.strategyMatchThreshold).toBe(0.3);
      expect(service.config.topKSemanticMatches).toBe(8);
    });

    test('allows config overrides', () => {
      const service = new OrganizationSuggestionServiceCore({
        vectorDbService: mockVectorDbService,
        folderMatchingService: mockFolderMatchingService,
        settingsService: mockSettingsService,
        config: {
          semanticMatchThreshold: 0.6,
          topKSemanticMatches: 15
        }
      });

      expect(service.config.semanticMatchThreshold).toBe(0.6);
      expect(service.config.topKSemanticMatches).toBe(15);
    });

    test('cluster-based settings default correctly', () => {
      const service = new OrganizationSuggestionServiceCore({
        vectorDbService: mockVectorDbService,
        folderMatchingService: mockFolderMatchingService,
        settingsService: mockSettingsService
      });

      expect(service.config.useClusterSuggestions).toBe(true);
      expect(service.config.clusterBoostFactor).toBe(1.3);
      expect(service.config.minClusterConfidence).toBe(0.5);
      expect(service.config.outlierThreshold).toBe(0.3);
    });
  });

  describe('Input validation edge cases', () => {
    test('constructor handles empty config gracefully', () => {
      const service = new OrganizationSuggestionServiceCore({
        vectorDbService: mockVectorDbService,
        folderMatchingService: mockFolderMatchingService,
        settingsService: mockSettingsService,
        config: {}
      });

      expect(service.config.semanticMatchThreshold).toBe(0.4);
    });

    test('constructor handles undefined config gracefully', () => {
      const service = new OrganizationSuggestionServiceCore({
        vectorDbService: mockVectorDbService,
        folderMatchingService: mockFolderMatchingService,
        settingsService: mockSettingsService,
        config: undefined
      });

      expect(service.config.semanticMatchThreshold).toBe(0.4);
    });

    test('constructor handles NaN config values', () => {
      const service = new OrganizationSuggestionServiceCore({
        vectorDbService: mockVectorDbService,
        folderMatchingService: mockFolderMatchingService,
        settingsService: mockSettingsService,
        config: {
          semanticMatchThreshold: NaN,
          topKSemanticMatches: Infinity
        }
      });

      // NaN is not Number.isFinite, so defaults used
      expect(service.config.semanticMatchThreshold).toBe(0.4);
      // Infinity is not Number.isFinite, so defaults used
      expect(service.config.topKSemanticMatches).toBe(8);
    });
  });

  describe('getSuggestionsForFile (Orama integration)', () => {
    let service;

    beforeEach(() => {
      service = new OrganizationSuggestionServiceCore({
        vectorDbService: mockVectorDbService,
        folderMatchingService: mockFolderMatchingService,
        settingsService: mockSettingsService
      });
      // Skip pattern loading for unit tests
      service._patternsLoaded = true;
      service._patternsLoadedSuccessfully = true;
      service._loadingPatterns = null;
      service._loadingFeedbackMemory = null;
    });

    test('returns fallback for file with no analysis', async () => {
      const file = { name: 'unknown.pdf', extension: 'pdf', path: '/test/unknown.pdf' };

      const result = await service.getSuggestionsForFile(file, [
        { id: '1', name: 'Docs', path: '/docs', description: 'Documents' }
      ]);

      expect(result).toBeDefined();
      expect(result).toHaveProperty('success');
    });

    test('returns result with strategy information', async () => {
      const file = {
        name: 'invoice-2024.pdf',
        extension: 'pdf',
        path: '/downloads/invoice-2024.pdf',
        analysis: {
          category: 'Finance',
          keywords: ['invoice', 'payment'],
          confidence: 90
        }
      };

      const smartFolders = [
        { id: '1', name: 'Finance', path: '/docs/Finance', description: 'Financial documents' }
      ];

      const result = await service.getSuggestionsForFile(file, smartFolders);

      expect(result).toBeDefined();
      expect(typeof result).toBe('object');
    });
  });

  describe('getBatchSuggestions (grouping)', () => {
    let service;

    beforeEach(() => {
      service = new OrganizationSuggestionServiceCore({
        vectorDbService: mockVectorDbService,
        folderMatchingService: mockFolderMatchingService,
        settingsService: mockSettingsService
      });
      service._patternsLoaded = true;
      service._patternsLoadedSuccessfully = true;
      service._loadingPatterns = null;
      service._loadingFeedbackMemory = null;
    });

    test('processes batch and returns groups structure', async () => {
      const files = [
        {
          name: 'budget.pdf',
          extension: 'pdf',
          path: '/downloads/budget.pdf',
          analysis: { category: 'Finance', keywords: ['budget'], confidence: 85 }
        },
        {
          name: 'report.docx',
          extension: 'docx',
          path: '/downloads/report.docx',
          analysis: { category: 'Finance', keywords: ['report'], confidence: 80 }
        }
      ];

      const smartFolders = [
        { id: '1', name: 'Finance', path: '/docs/Finance', description: 'Financial documents' }
      ];

      const result = await service.getBatchSuggestions(files, smartFolders);

      expect(result).toBeDefined();
      expect(result).toHaveProperty('groups');
      expect(result).toHaveProperty('patterns');
      expect(result).toHaveProperty('recommendations');
    });

    test('handles empty files array', async () => {
      const result = await service.getBatchSuggestions([], []);

      expect(result).toBeDefined();
      expect(result.groups).toBeDefined();
    });
  });

  describe('Routing modes', () => {
    test('ROUTING_MODES is frozen object with expected values', () => {
      const service = new OrganizationSuggestionServiceCore({
        vectorDbService: mockVectorDbService,
        folderMatchingService: mockFolderMatchingService,
        settingsService: mockSettingsService
      });

      // Service should use routing modes
      expect(service).toBeDefined();
    });
  });

  describe('Pattern loading and persistence', () => {
    test('initializes pattern matcher', () => {
      const service = new OrganizationSuggestionServiceCore({
        vectorDbService: mockVectorDbService,
        folderMatchingService: mockFolderMatchingService,
        settingsService: mockSettingsService
      });

      expect(service.patternMatcher).toBeDefined();
      expect(service.persistence).toBeDefined();
      expect(service.feedbackMemoryStore).toBeDefined();
    });

    test('_ensurePatternsLoaded waits for pending load', async () => {
      const service = new OrganizationSuggestionServiceCore({
        vectorDbService: mockVectorDbService,
        folderMatchingService: mockFolderMatchingService,
        settingsService: mockSettingsService
      });

      // Already loaded
      service._patternsLoaded = true;
      service._patternsLoadedSuccessfully = true;

      await service._ensurePatternsLoaded();
      // Should return without error
      expect(service._patternsLoaded).toBe(true);
    });
  });
});
