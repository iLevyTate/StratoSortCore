const {
  OrganizationSuggestionServiceCore
} = require('../src/main/services/organization/OrganizationSuggestionServiceCore');

// Mock dependencies
const mockChromaDbService = {
  batchUpsertFolders: jest.fn().mockResolvedValue(0),
  queryFolders: jest.fn().mockResolvedValue([])
};

const mockFolderMatchingService = {
  embedText: jest.fn().mockResolvedValue({ vector: [1, 0], model: 'test' }),
  upsertFileEmbedding: jest.fn().mockResolvedValue(),
  matchFileToFolders: jest.fn().mockResolvedValue([])
};

const mockSettingsService = {
  get: jest.fn().mockReturnValue({})
};

const mockClusteringService = {
  isClustersStale: jest.fn().mockReturnValue(false),
  computeClusters: jest.fn().mockResolvedValue({ success: true }),
  generateClusterLabels: jest.fn().mockResolvedValue(),
  clusters: [],
  centroids: {},
  clusterLabels: new Map()
};

jest.mock('../src/shared/logger', () => ({
  logger: {
    setContext: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  }
}));

jest.mock('fs', () => ({
  promises: {
    mkdir: jest.fn().mockResolvedValue()
  }
}));

// Mock extracted modules to simplify testing
jest.mock('../src/main/services/organization/strategies', () => ({
  strategies: {},
  getStrategyBasedSuggestions: jest.fn().mockReturnValue([])
}));

jest.mock('../src/main/services/organization/patternMatcher', () => ({
  PatternMatcher: jest.fn().mockImplementation(() => ({
    getPatternBasedSuggestions: jest.fn().mockReturnValue([]),
    loadPatterns: jest.fn(),
    exportPatterns: jest.fn().mockReturnValue({})
  }))
}));

jest.mock('../src/main/services/organization/persistence', () => ({
  PatternPersistence: jest.fn().mockImplementation(() => ({
    load: jest.fn().mockResolvedValue({}),
    save: jest.fn().mockResolvedValue()
  }))
}));

jest.mock('../src/main/services/organization/llmSuggester', () => ({
  getLLMAlternativeSuggestions: jest.fn().mockResolvedValue([])
}));

jest.mock('../src/main/services/organization/suggestionRanker', () => ({
  rankSuggestions: jest.fn((s) => s),
  calculateConfidence: jest.fn(() => 0.5),
  generateExplanation: jest.fn(() => 'Test explanation')
}));

jest.mock('../src/main/services/organization/folderAnalyzer', () => ({
  calculateFolderFitScore: jest.fn().mockReturnValue(0.5),
  suggestFolderImprovement: jest.fn(),
  suggestNewSmartFolder: jest.fn(),
  analyzeFolderStructure: jest.fn().mockReturnValue([])
}));

jest.mock('../src/main/services/organization/filePatternAnalyzer', () => ({
  analyzeFilePatterns: jest.fn().mockReturnValue([]),
  generateBatchRecommendations: jest.fn().mockReturnValue([]),
  generateFileSummary: jest.fn().mockReturnValue('summary')
}));

jest.mock('../src/main/utils/llmOptimization', () => ({
  globalBatchProcessor: {
    processBatch: jest.fn()
  }
}));

describe('OrganizationSuggestionServiceCore Clustering', () => {
  let service;

  beforeEach(() => {
    jest.clearAllMocks();
    mockClusteringService.clusters = [];
    mockClusteringService.centroids = {};
    mockClusteringService.clusterLabels = new Map();
    mockClusteringService.isClustersStale.mockReturnValue(false);

    service = new OrganizationSuggestionServiceCore({
      chromaDbService: mockChromaDbService,
      folderMatchingService: mockFolderMatchingService,
      settingsService: mockSettingsService,
      clusteringService: mockClusteringService
    });
  });

  describe('getClusterBasedSuggestions', () => {
    const file = { path: '/test/doc.pdf', name: 'doc.pdf', extension: '.pdf' };
    const smartFolders = [{ name: 'Docs', path: '/docs', description: 'Documents' }];

    test('returns empty if clustering disabled or unavailable', async () => {
      service._clusteringService = null;
      const result = await service.getClusterBasedSuggestions(file, smartFolders);
      expect(result).toEqual([]);
    });

    test('returns empty if file does not belong to a cluster', async () => {
      mockClusteringService.clusters = [{ id: 0, members: [{ id: 'file:/other.pdf' }] }];
      const result = await service.getClusterBasedSuggestions(file, smartFolders);
      expect(result).toEqual([]);
    });

    test('suggests folder based on peer voting', async () => {
      mockClusteringService.clusters = [
        {
          id: 0,
          label: 'Invoices',
          members: [
            { id: 'file:/test/doc.pdf', score: 0.9, embedding: [1, 0] },
            { id: 'file:/docs/invoice1.pdf', score: 0.9, metadata: { path: '/docs/invoice1.pdf' } },
            { id: 'file:/docs/invoice2.pdf', score: 0.9, metadata: { path: '/docs/invoice2.pdf' } }
          ]
        }
      ];
      mockClusteringService.centroids = { 0: [1, 0] };

      const result = await service.getClusterBasedSuggestions(file, smartFolders);

      expect(result).toHaveLength(1);
      expect(result[0].folder).toBe('Docs');
      expect(result[0].method).toBe('cluster_membership');
      expect(result[0].clusterPeersInFolder).toBe(2);
    });

    test('suggests folder based on cluster label match if no peers organized', async () => {
      mockClusteringService.clusters = [
        {
          id: 0,
          label: 'Documents', // Matches folder name
          members: [
            { id: 'file:/test/doc.pdf', score: 0.9, embedding: [1, 0] },
            { id: 'file:/downloads/doc2.pdf', score: 0.9 }
          ]
        }
      ];
      mockClusteringService.centroids = { 0: [1, 0] };

      const result = await service.getClusterBasedSuggestions(file, smartFolders);

      expect(result).toHaveLength(1);
      expect(result[0].folder).toBe('Docs'); // Matches 'Documents' label ~ 'Docs' folder name?
      // Actually label 'Documents' matches folder description 'Documents' or name 'Docs' if partial match logic works
      // The logic checks: folderName.includes(label) || label.includes(folderName) || folderDesc.includes(label)
      // label 'Documents', folder 'Docs'. 'Documents'.includes('Docs') is true? No, 'Docs' is shorter.
      // 'Documents'.includes('docs') (lowercase) is true? No.
      // Wait, folder name is 'Docs'. 'Documents' does not include 'Docs' (case insensitive 'documents' vs 'docs').
      // 'docs' includes 'documents'? No.
      // folder description is 'Documents'. 'documents' includes 'documents' -> Yes.

      expect(result[0].method).toBe('cluster_label_match');
    });
  });

  describe('getClusterBatchSuggestions', () => {
    const files = [
      { path: '/test/doc1.pdf', name: 'doc1.pdf' },
      { path: '/test/doc2.pdf', name: 'doc2.pdf' },
      { path: '/test/outlier.txt', name: 'outlier.txt' }
    ];
    const smartFolders = [{ name: 'Docs', path: '/docs' }];

    test('groups files by cluster', async () => {
      mockClusteringService.clusters = [
        {
          id: 0,
          label: 'PDFs',
          members: [{ id: 'file:/test/doc1.pdf' }, { id: 'file:/test/doc2.pdf' }]
        }
      ];

      const result = await service.getClusterBatchSuggestions(files, smartFolders);

      expect(result.success).toBe(true);
      expect(result.groups).toHaveLength(1);
      expect(result.groups[0].files).toHaveLength(2);
      expect(result.outliers).toHaveLength(1);
      expect(result.outliers[0].name).toBe('outlier.txt');
    });

    test('suggests folder for cluster group', async () => {
      mockClusteringService.clusters = [
        {
          id: 0,
          label: 'Docs',
          members: [{ id: 'file:/test/doc1.pdf' }]
        }
      ];

      const result = await service.getClusterBatchSuggestions(files, smartFolders);

      expect(result.groups[0].suggestedFolder).toBeDefined();
      expect(result.groups[0].suggestedFolder.folder).toBe('Docs');
    });

    test('handles missing clustering service', async () => {
      service._clusteringService = null;
      service._getClusteringService = null;
      const result = await service.getClusterBatchSuggestions(files, smartFolders);
      expect(result.success).toBe(false);
      expect(result.error).toContain('not available');
    });
  });

  describe('identifyOutliers', () => {
    test('identifies files not belonging to any cluster', async () => {
      const files = [{ path: '/test/file1.txt' }];
      mockClusteringService.clusters = []; // No clusters

      const result = await service.identifyOutliers(files);

      expect(result.success).toBe(true);
      expect(result.outliers).toHaveLength(1);
      expect(result.outliers[0].reason).toBe('not_in_cluster');
    });

    test('identifies files with weak cluster fit', async () => {
      const files = [{ path: '/test/file1.txt' }];
      mockClusteringService.clusters = [
        {
          id: 0,
          members: [{ id: 'file:/test/file1.txt', embedding: [1, 0] }]
        }
      ];
      // Use vectors that have some similarity but < 0.3
      // Cosine similarity of [1, 0] and [0.1, 0.9] is approx 0.11 (valid vector math required)
      // Actually simply mocking cosineSimilarity might be safer if we mocked the utility,
      // but here we are using real vectorMath potentially or did we mock it?
      // We did NOT mock vectorMath.
      // Let's use simple vectors: [1, 0] and [0.2, 0.98] -> dot product 0.2.
      // Norm of [1, 0] is 1. Norm of [0.2, 0.98] is sqrt(0.04 + 0.9604) ~= 1.
      // So score is 0.2. 0.2 < 0.3.

      mockClusteringService.centroids = { 0: [0.2, 0.98] };

      const result = await service.identifyOutliers(files);

      expect(result.success).toBe(true);
      expect(result.outliers).toHaveLength(1);
      expect(result.outliers[0].reason).toBe('weak_cluster_fit'); // 0.2 < threshold (0.3 default)
    });
  });

  describe('boostClusterConsistentSuggestions', () => {
    test('boosts score of suggestions matching cluster recommendations', async () => {
      const file = { path: '/test/doc.pdf' };
      const suggestions = [
        { folder: 'Docs', path: '/docs', score: 0.5 },
        { folder: 'Images', path: '/images', score: 0.4 }
      ];

      // Mock getClusterBasedSuggestions to return 'Docs'
      // We can mock the method on the service instance directly since we are testing boost logic
      jest
        .spyOn(service, 'getClusterBasedSuggestions')
        .mockResolvedValue([{ folder: 'Docs', path: '/docs' }]);

      const result = await service.boostClusterConsistentSuggestions(file, suggestions);

      expect(result[0].folder).toBe('Docs');
      expect(result[0].score).toBeGreaterThan(0.5); // Boosted
      expect(result[0].clusterBoosted).toBe(true);

      expect(result[1].score).toBe(0.4); // Not boosted
    });
  });
});
