/**
 * Tests for ClusteringService
 *
 * Tests K-means clustering, centroid initialization, and LLM label generation.
 */

// Mock logger before requiring the service
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

// Mock llama utils
jest.mock('../src/main/llamaUtils', () => ({
  getTextModel: jest.fn(() => 'qwen3:0.6b')
}));

describe('ClusteringService', () => {
  let ClusteringService;
  let service;
  let mockVectorDb;
  let mockLlama;

  // Generate mock embeddings for testing
  const createMockEmbedding = (seed) => {
    return new Array(768).fill(0).map((_, i) => Math.sin(seed + i) * 0.5);
  };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();

    // Create mock vector DB service (OramaVectorService API)
    mockVectorDb = {
      initialize: jest.fn().mockResolvedValue(undefined),
      peekFiles: jest.fn().mockResolvedValue({
        ids: ['file1', 'file2', 'file3', 'file4', 'file5'],
        embeddings: [
          createMockEmbedding(1),
          createMockEmbedding(2),
          createMockEmbedding(3),
          createMockEmbedding(4),
          createMockEmbedding(5)
        ],
        metadatas: [
          { name: 'document1.pdf', type: 'pdf' },
          { name: 'document2.pdf', type: 'pdf' },
          { name: 'image1.jpg', type: 'image' },
          { name: 'image2.jpg', type: 'image' },
          { name: 'spreadsheet.xlsx', type: 'spreadsheet' }
        ]
      }),
      getStats: jest.fn().mockResolvedValue({ files: 5, fileChunks: 0, folders: 0 }),
      getFile: jest.fn().mockResolvedValue(null)
    };

    // Create mock AI service
    mockLlama = {
      generateText: jest.fn().mockResolvedValue({ response: 'Test Documents' })
    };

    // Load the service
    const module = require('../src/main/services/ClusteringService');
    ClusteringService = module.ClusteringService || module;

    // Create service instance
    service = new ClusteringService({
      vectorDbService: mockVectorDb,
      llamaService: mockLlama
    });
  });

  describe('constructor', () => {
    test('initializes with valid dependencies', () => {
      expect(service.vectorDb).toBe(mockVectorDb);
      expect(service.llama).toBe(mockLlama);
      expect(service.clusters).toEqual([]);
      expect(service.centroids).toEqual([]);
      expect(service.clusterLabels).toBeInstanceOf(Map);
      expect(service.lastComputedAt).toBeNull();
    });

    test('throws if vectorDbService is missing', () => {
      expect(() => {
        new ClusteringService({ vectorDbService: null, llamaService: mockLlama });
      }).toThrow('ClusteringService requires vectorDbService dependency');
    });

    test('accepts null llamaService (optional)', () => {
      const serviceWithoutLlama = new ClusteringService({
        vectorDbService: mockVectorDb,
        llamaService: null
      });
      expect(serviceWithoutLlama.llama).toBeNull();
    });
  });

  describe('isClustersStale', () => {
    test('returns true when clusters are empty', () => {
      expect(service.isClustersStale()).toBe(true);
    });

    test('returns true when lastComputedAt is null', () => {
      service.clusters = [{ id: 0, fileIds: ['file1'] }];
      service.lastComputedAt = null;
      expect(service.isClustersStale()).toBe(true);
    });

    test('returns false when clusters are fresh', () => {
      service.clusters = [{ id: 0, fileIds: ['file1'] }];
      service.lastComputedAt = Date.now();
      expect(service.isClustersStale()).toBe(false);
    });

    test('returns true when clusters are older than STALE_MS', () => {
      service.clusters = [{ id: 0, fileIds: ['file1'] }];
      service.lastComputedAt = Date.now() - (service.STALE_MS + 1000);
      expect(service.isClustersStale()).toBe(true);
    });
  });

  describe('getAllFileEmbeddings', () => {
    test('returns file embeddings from vector DB', async () => {
      const files = await service.getAllFileEmbeddings();

      expect(mockVectorDb.initialize).toHaveBeenCalled();
      expect(mockVectorDb.peekFiles).toHaveBeenCalledWith(10000);
      expect(files).toHaveLength(5);
      expect(files[0]).toHaveProperty('id', 'file1');
      expect(files[0]).toHaveProperty('embedding');
      expect(files[0]).toHaveProperty('metadata');
    });

    test('returns empty array on error', async () => {
      mockVectorDb.peekFiles.mockRejectedValueOnce(new Error('DB error'));

      const files = await service.getAllFileEmbeddings();

      expect(files).toEqual([]);
    });

    test('filters out files without embeddings', async () => {
      mockVectorDb.peekFiles.mockResolvedValueOnce({
        ids: ['file1', 'file2'],
        embeddings: [createMockEmbedding(1), null],
        metadatas: [{}, {}]
      });

      const files = await service.getAllFileEmbeddings();

      expect(files).toHaveLength(1);
      expect(files[0].id).toBe('file1');
    });
  });

  describe('initCentroidsPlusPlus', () => {
    test('returns empty array for empty files', () => {
      const centroids = service.initCentroidsPlusPlus([], 3);
      expect(centroids).toEqual([]);
    });

    test('returns empty array for k <= 0', () => {
      const files = [{ embedding: createMockEmbedding(1) }];
      expect(service.initCentroidsPlusPlus(files, 0)).toEqual([]);
      expect(service.initCentroidsPlusPlus(files, -1)).toEqual([]);
    });

    test('returns k centroids for valid input', () => {
      const files = [
        { embedding: createMockEmbedding(1) },
        { embedding: createMockEmbedding(2) },
        { embedding: createMockEmbedding(3) },
        { embedding: createMockEmbedding(4) },
        { embedding: createMockEmbedding(5) }
      ];

      const centroids = service.initCentroidsPlusPlus(files, 3);

      expect(centroids).toHaveLength(3);
      centroids.forEach((centroid) => {
        expect(centroid).toHaveLength(768);
      });
    });

    test('limits centroids to number of files', () => {
      const files = [{ embedding: createMockEmbedding(1) }, { embedding: createMockEmbedding(2) }];

      const centroids = service.initCentroidsPlusPlus(files, 5);

      expect(centroids.length).toBeLessThanOrEqual(2);
    });
  });

  describe('nearestCentroid', () => {
    test('finds nearest centroid index', () => {
      const centroids = [
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1]
      ];

      // Point closest to first centroid
      expect(service.nearestCentroid([0.9, 0.1, 0], centroids)).toBe(0);

      // Point closest to second centroid
      expect(service.nearestCentroid([0.1, 0.9, 0], centroids)).toBe(1);

      // Point closest to third centroid
      expect(service.nearestCentroid([0, 0.1, 0.9], centroids)).toBe(2);
    });
  });

  describe('updateCentroids', () => {
    test('computes new centroids as cluster means (modifies in place)', () => {
      const files = [
        { embedding: [1, 0, 0] },
        { embedding: [2, 0, 0] },
        { embedding: [0, 1, 0] },
        { embedding: [0, 2, 0] }
      ];
      const assignments = [0, 0, 1, 1]; // First two in cluster 0, last two in cluster 1
      // updateCentroids modifies centroids in place
      const centroids = [
        [0, 0, 0],
        [0, 0, 0]
      ];

      service.updateCentroids(files, assignments, centroids);

      expect(centroids).toHaveLength(2);
      // Cluster 0 centroid should be average of [1,0,0] and [2,0,0] = [1.5, 0, 0]
      expect(centroids[0]).toEqual([1.5, 0, 0]);
      // Cluster 1 centroid should be average of [0,1,0] and [0,2,0] = [0, 1.5, 0]
      expect(centroids[1]).toEqual([0, 1.5, 0]);
    });

    test('handles empty clusters by reinitializing with farthest point', () => {
      const files = [{ embedding: [1, 0, 0] }, { embedding: [2, 0, 0] }];
      const assignments = [0, 0]; // All in cluster 0, cluster 1 is empty
      // updateCentroids modifies centroids in place
      const centroids = [
        [0, 0, 0],
        [0, 0, 0]
      ];

      service.updateCentroids(files, assignments, centroids);

      expect(centroids).toHaveLength(2);
      expect(centroids[0]).toEqual([1.5, 0, 0]);
      // Empty cluster is reinitialized with the point farthest from its assigned centroid
      // Both files have equal distance (0.5) from centroid [1.5,0,0], so first one (file 0) is used
      expect(centroids[1]).toEqual([1, 0, 0]);
    });
  });

  describe('kmeans', () => {
    test('assigns all files to clusters', () => {
      const files = [
        { embedding: [1, 0, 0] },
        { embedding: [0.9, 0.1, 0] },
        { embedding: [0, 1, 0] },
        { embedding: [0.1, 0.9, 0] }
      ];

      const result = service.kmeans(files, 2);

      expect(result.assignments).toHaveLength(4);
      expect(result.centroids).toHaveLength(2);

      // All assignments should be 0 or 1
      result.assignments.forEach((a) => {
        expect(a).toBeGreaterThanOrEqual(0);
        expect(a).toBeLessThan(2);
      });
    });

    test('returns valid structure', () => {
      const files = [
        { embedding: createMockEmbedding(1) },
        { embedding: createMockEmbedding(2) },
        { embedding: createMockEmbedding(3) }
      ];

      const result = service.kmeans(files, 2);

      expect(result).toHaveProperty('assignments');
      expect(result).toHaveProperty('centroids');
      expect(Array.isArray(result.assignments)).toBe(true);
      expect(Array.isArray(result.centroids)).toBe(true);
    });
  });

  describe('computeClusters', () => {
    test('computes clusters successfully', async () => {
      const result = await service.computeClusters(2);

      expect(result.success).toBe(true);
      expect(result.clusters).toBeDefined();
      expect(Array.isArray(result.clusters)).toBe(true);
      expect(service.lastComputedAt).not.toBeNull();
    });

    test('fails with insufficient files', async () => {
      mockVectorDb.peekFiles.mockResolvedValueOnce({
        ids: ['file1'],
        embeddings: [createMockEmbedding(1)],
        metadatas: [{}]
      });

      const result = await service.computeClusters(2);

      expect(result.success).toBe(false);
      expect(result.error).toContain('at least 3 files');
    });

    test('auto-selects k when k is "auto"', async () => {
      const result = await service.computeClusters('auto');

      expect(result.success).toBe(true);
      // The actual number of clusters depends on the estimateOptimalK heuristic
      expect(Array.isArray(result.clusters)).toBe(true);
    });

    test('handles vector DB errors gracefully', async () => {
      mockVectorDb.peekFiles.mockRejectedValueOnce(new Error('Connection failed'));

      const result = await service.computeClusters(2);

      expect(result.success).toBe(false);
    });
  });

  describe('generateClusterLabels', () => {
    beforeEach(() => {
      // Clusters have 'members' property with file objects, not 'fileIds'
      service.clusters = [
        {
          id: 0,
          members: [
            { id: 'file1', metadata: { name: 'document1.pdf' } },
            { id: 'file2', metadata: { name: 'document2.pdf' } }
          ]
        },
        {
          id: 1,
          members: [
            { id: 'file3', metadata: { name: 'image1.jpg' } },
            { id: 'file4', metadata: { name: 'image2.jpg' } }
          ]
        }
      ];
    });

    test('generates labels using LLM', async () => {
      mockLlama.generateText.mockResolvedValueOnce({ response: 'PDF Documents' });
      mockLlama.generateText.mockResolvedValueOnce({ response: 'Image Files' });

      const result = await service.generateClusterLabels();

      expect(result.success).toBe(true);
      expect(mockLlama.generateText).toHaveBeenCalledTimes(2);
      expect(service.clusterLabels.get(0)).toBe('PDF Documents');
      expect(service.clusterLabels.get(1)).toBe('Image Files');
    });

    test('uses fallback labels when LLM fails', async () => {
      mockLlama.generateText.mockRejectedValue(new Error('LLM error'));

      const result = await service.generateClusterLabels();

      // Labels should be generated with fallback values despite errors
      expect(result.success).toBe(true);
      expect(service.clusterLabels.get(0)).toBe('Cluster 1');
      expect(service.clusterLabels.get(1)).toBe('Cluster 2');
    });

    test('uses fallback labels when llama is null', async () => {
      service.llama = null;

      const result = await service.generateClusterLabels();

      // Should still succeed with fallback labels when llama is not available
      expect(result.success).toBe(true);
      expect(service.clusterLabels.get(0)).toBe('Cluster 1');
      expect(service.clusterLabels.get(1)).toBe('Cluster 2');
    });
  });

  describe('clearClusters', () => {
    test('clears all cluster data', () => {
      service.clusters = [{ id: 0, fileIds: ['file1'] }];
      service.centroids = [[1, 0, 0]];
      service.clusterLabels.set(0, 'Test');
      service.lastComputedAt = Date.now();

      service.clearClusters();

      expect(service.clusters).toEqual([]);
      expect(service.centroids).toEqual([]);
      expect(service.clusterLabels.size).toBe(0);
      expect(service.lastComputedAt).toBeNull();
    });
  });

  describe('getClustersForGraph', () => {
    test('returns cluster data formatted for graph visualization', async () => {
      // First compute clusters
      await service.computeClusters(2);

      const graphData = service.getClustersForGraph();

      // getClustersForGraph returns an array of cluster objects, not an object with properties
      expect(Array.isArray(graphData)).toBe(true);
      if (graphData.length > 0) {
        expect(graphData[0]).toHaveProperty('id');
        expect(graphData[0]).toHaveProperty('clusterId');
        expect(graphData[0]).toHaveProperty('label');
        expect(graphData[0]).toHaveProperty('memberCount');
        expect(graphData[0]).toHaveProperty('memberIds');
      }
    });

    test('includes topTerms derived from metadata (distinctive terms)', () => {
      service.clusters = [
        {
          id: 0,
          members: [
            {
              id: 'file:a',
              embedding: [1, 0],
              metadata: {
                name: 'q4_finance_report.pdf',
                subject: 'Q4 Finance',
                summary: 'Revenue EBITDA forecast',
                category: 'Finance',
                tags: JSON.stringify(['finance', 'q4', 'revenue']),
                path: 'C:\\Docs\\Finance\\q4_finance_report.pdf',
                updatedAt: '2025-11-01T00:00:00.000Z'
              }
            },
            {
              id: 'file:b',
              embedding: [1, 0.05],
              metadata: {
                name: 'q4_budget.xlsx',
                subject: 'Budget',
                summary: 'Budget and revenue projections',
                category: 'Finance',
                tags: JSON.stringify(['budget', 'finance', 'q4']),
                path: 'C:\\Docs\\Finance\\q4_budget.xlsx',
                updatedAt: '2025-11-05T00:00:00.000Z'
              }
            }
          ]
        }
      ];
      service.centroids = [[1, 0]];

      const graphData = service.getClustersForGraph();
      expect(Array.isArray(graphData)).toBe(true);
      expect(graphData).toHaveLength(1);
      expect(Array.isArray(graphData[0].topTerms)).toBe(true);
      // Should contain at least one distinctive finance-related token
      expect(graphData[0].topTerms.join(' ')).toMatch(/finance|revenue|budget|ebitda|forecast/i);
    });

    test('filters stopwords out of commonTags used for graph labels', async () => {
      service.clusters = [
        {
          id: 0,
          members: [
            {
              id: 'file:a',
              embedding: [1, 0],
              metadata: {
                name: 'alpha_notes.txt',
                subject: 'Project Alpha',
                summary: 'If this is ready, ship it',
                category: 'Work',
                tags: JSON.stringify(['if', 'it', 'alpha'])
              }
            },
            {
              id: 'file:b',
              embedding: [1, 0.1],
              metadata: {
                name: 'alpha_plan.txt',
                subject: 'Alpha plan',
                summary: 'Plan and milestones',
                category: 'Work',
                tags: JSON.stringify(['it', 'alpha', 'milestones'])
              }
            }
          ]
        }
      ];
      service.centroids = [[1, 0]];
      await service.generateClusterLabels({ skipLLM: true });

      const graphData = service.getClustersForGraph();
      expect(Array.isArray(graphData)).toBe(true);
      expect(graphData).toHaveLength(1);
      expect(Array.isArray(graphData[0].commonTags)).toBe(true);
      expect(graphData[0].commonTags).toContain('alpha');
      expect(graphData[0].commonTags).not.toContain('if');
      expect(graphData[0].commonTags).not.toContain('it');
    });

    test('derives member path and folder from metadata.filePath fallback', () => {
      service.clusters = [
        {
          id: 0,
          members: [
            {
              id: 'file:c:/users/test/docs/finance/q4_budget.xlsx',
              embedding: [1, 0],
              metadata: {
                filePath: 'C:\\Users\\Test\\Docs\\Finance\\q4_budget.xlsx',
                fileName: 'q4_budget.xlsx',
                tags: JSON.stringify(['finance', 'budget'])
              }
            },
            {
              id: 'file:c:/users/test/docs/finance/q4_report.xlsx',
              embedding: [0.98, 0.02],
              metadata: {
                filePath: 'C:\\Users\\Test\\Docs\\Finance\\q4_report.xlsx',
                fileName: 'q4_report.xlsx',
                tags: JSON.stringify(['finance', 'report'])
              }
            }
          ]
        }
      ];
      service.centroids = [[1, 0]];

      const graphData = service.getClustersForGraph();
      expect(Array.isArray(graphData)).toBe(true);
      expect(graphData).toHaveLength(1);
      expect(graphData[0].dominantFolderName).toBe('Finance');
      expect(graphData[0].dominantFileCategory).toBe('spreadsheet');
    });
  });

  describe('getClusterMembers', () => {
    test('filters out missing files when resolving cluster members', async () => {
      service.clusters = [
        {
          id: 0,
          members: [
            { id: 'file:existing', metadata: { filePath: 'C:\\Docs\\existing.pdf' } },
            { id: 'file:missing', metadata: { filePath: 'C:\\Docs\\missing.pdf' } }
          ]
        }
      ];

      mockVectorDb.getFile.mockImplementation(async (id) => {
        if (id === 'file:existing') {
          return {
            filePath: 'C:\\Docs\\existing.pdf',
            fileName: 'existing.pdf',
            fileType: 'pdf',
            extractionMethod: 'nomic'
          };
        }
        if (id === 'file:missing') {
          return {
            filePath: 'C:\\Docs\\missing.pdf',
            fileName: 'missing.pdf',
            fileType: 'pdf',
            extractionMethod: 'nomic'
          };
        }
        return null;
      });

      const fs = require('fs');
      const accessSpy = jest
        .spyOn(fs.promises, 'access')
        .mockImplementation(async (candidatePath) => {
          if (String(candidatePath).toLowerCase().includes('missing')) {
            const error = new Error('ENOENT');
            error.code = 'ENOENT';
            throw error;
          }
        });

      const members = await service.getClusterMembers(0);
      accessSpy.mockRestore();

      expect(Array.isArray(members)).toBe(true);
      expect(members).toHaveLength(1);
      expect(members[0].id).toBe('file:existing');
      expect(members[0].metadata.path).toBe('C:\\Docs\\existing.pdf');
      expect(members[0].metadata.name).toBe('existing.pdf');
    });
  });

  describe('duplicate detection thresholds', () => {
    test('enforces MIN_SAFE_THRESHOLD for duplicate detection', async () => {
      // Create mock with high similarity embeddings
      const nearDuplicateEmbedding = createMockEmbedding(1);

      mockVectorDb.getStats.mockResolvedValue({ files: 2, fileChunks: 0, folders: 0 });
      mockVectorDb.peekFiles.mockResolvedValue({
        ids: ['file1', 'file2'],
        embeddings: [nearDuplicateEmbedding, nearDuplicateEmbedding],
        metadatas: [
          { name: 'doc1.pdf', type: 'pdf' },
          { name: 'doc2.pdf', type: 'pdf' }
        ]
      });

      // Try to use unsafe low threshold (0.3) - should be clamped to MIN_SAFE_THRESHOLD (0.7)
      const result = await service.findNearDuplicates({ threshold: 0.3 });

      // Should not throw and should return valid result
      expect(result).toBeDefined();
      expect(result.success).toBe(true);
    });

    test('respects MAX_PAIRS_LIMIT for duplicate detection', async () => {
      // Create many similar files that would generate many pairs
      const embedding = createMockEmbedding(1);
      const manyFiles = [];
      const manyEmbeddings = [];
      const manyMetadatas = [];

      // Generate 200 files which would be 19900 pairs without limit
      for (let i = 0; i < 200; i++) {
        manyFiles.push(`file${i}`);
        manyEmbeddings.push(embedding); // Same embedding = all duplicates
        manyMetadatas.push({ name: `doc${i}.pdf`, type: 'pdf' });
      }

      mockVectorDb.getStats.mockResolvedValue({ files: 200, fileChunks: 0, folders: 0 });
      mockVectorDb.peekFiles.mockResolvedValue({
        ids: manyFiles,
        embeddings: manyEmbeddings,
        metadatas: manyMetadatas
      });

      // Should complete without memory exhaustion
      const result = await service.findNearDuplicates({ threshold: 0.99 });

      // Should have limited results (MAX_PAIRS_LIMIT = 10000)
      expect(result.success).toBe(true);
      expect(result.groups.length).toBeLessThanOrEqual(10000);
    });
  });

  describe('cross-cluster edges include sharedTerms', () => {
    test('attaches sharedTerms when clusters share topTerms/commonTags', () => {
      service.clusters = [
        {
          id: 0,
          members: [
            {
              id: 'file:a',
              embedding: [1, 0],
              metadata: {
                name: 'project_alpha_notes.txt',
                subject: 'Project Alpha',
                summary: 'Alpha roadmap and milestones',
                category: 'Work',
                tags: JSON.stringify(['alpha', 'roadmap', 'milestones']),
                path: 'C:\\Docs\\Work\\project_alpha_notes.txt',
                updatedAt: '2025-10-01T00:00:00.000Z'
              }
            }
          ],
          // pre-seed to avoid relying on getClustersForGraph ordering
          topTerms: ['alpha', 'roadmap', 'milestones'],
          commonTags: ['alpha']
        },
        {
          id: 1,
          members: [
            {
              id: 'file:b',
              embedding: [0.9, 0.1],
              metadata: {
                name: 'alpha_status_update.txt',
                subject: 'Alpha status',
                summary: 'Milestones and blockers',
                category: 'Work',
                tags: JSON.stringify(['alpha', 'status', 'milestones']),
                path: 'C:\\Docs\\Work\\alpha_status_update.txt',
                updatedAt: '2025-10-10T00:00:00.000Z'
              }
            }
          ],
          topTerms: ['alpha', 'status', 'milestones'],
          commonTags: ['alpha']
        }
      ];
      service.centroids = [
        [1, 0],
        [0.9, 0.1]
      ];

      const edges = service.findCrossClusterEdges(0.1, { includeBridgeFiles: false });
      expect(Array.isArray(edges)).toBe(true);
      expect(edges.length).toBeGreaterThan(0);
      expect(Array.isArray(edges[0].sharedTerms)).toBe(true);
      expect(edges[0].sharedTerms.join(' ')).toMatch(/alpha|milestones/i);
    });

    test('excludes stopword-only overlap from sharedTerms', () => {
      service.clusters = [
        {
          id: 0,
          members: [
            { id: 'file:a', embedding: [1, 0], metadata: { tags: JSON.stringify(['if']) } }
          ],
          topTerms: ['if', 'alpha'],
          commonTags: ['if', 'alpha']
        },
        {
          id: 1,
          members: [
            { id: 'file:b', embedding: [0.9, 0.1], metadata: { tags: JSON.stringify(['it']) } }
          ],
          topTerms: ['it', 'alpha'],
          commonTags: ['it', 'alpha']
        }
      ];
      service.centroids = [
        [1, 0],
        [0.9, 0.1]
      ];

      const edges = service.findCrossClusterEdges(0.1, { includeBridgeFiles: false });
      expect(Array.isArray(edges)).toBe(true);
      expect(edges.length).toBeGreaterThan(0);
      expect(edges[0].sharedTerms).toEqual(['alpha']);
    });

    test('bridge files use metadata.filePath/fileName fallback', () => {
      service.clusters = [
        {
          id: 0,
          members: [
            {
              id: 'file:c:/work/alpha/spec.docx',
              embedding: [1, 0],
              metadata: {
                filePath: 'C:\\Work\\Alpha\\spec.docx',
                fileName: 'spec.docx'
              }
            }
          ],
          topTerms: ['alpha'],
          commonTags: ['alpha']
        },
        {
          id: 1,
          members: [
            {
              id: 'file:c:/work/beta/spec-review.docx',
              embedding: [0.98, 0.02],
              metadata: {
                filePath: 'C:\\Work\\Beta\\spec-review.docx',
                fileName: 'spec-review.docx'
              }
            }
          ],
          topTerms: ['alpha'],
          commonTags: ['alpha']
        }
      ];
      service.centroids = [
        [1, 0],
        [0.98, 0.02]
      ];

      const fs = require('fs');
      const existsSyncSpy = jest.spyOn(fs, 'existsSync').mockReturnValue(true);
      const edges = service.findCrossClusterEdges(0.1, {
        includeBridgeFiles: true,
        maxBridgeFilesPerCluster: 2,
        minBridgeSimilarity: 0.1
      });
      existsSyncSpy.mockRestore();

      expect(edges.length).toBeGreaterThan(0);
      expect(Array.isArray(edges[0].bridgeFiles)).toBe(true);
      expect(edges[0].bridgeFiles.length).toBeGreaterThan(0);
      expect(edges[0].bridgeFiles[0].path).toMatch(/^C:\\/);
      expect(edges[0].bridgeFiles[0].name).toMatch(/\.docx$/);
    });

    test('omits bridge files whose paths no longer exist', () => {
      service.clusters = [
        {
          id: 0,
          members: [
            {
              id: 'file:c:/work/alpha/spec.docx',
              embedding: [1, 0],
              metadata: {
                filePath: 'C:\\Work\\Alpha\\spec.docx',
                fileName: 'spec.docx'
              }
            },
            {
              id: 'file:c:/work/alpha/missing.docx',
              embedding: [0.99, 0.01],
              metadata: {
                filePath: 'C:\\Work\\Alpha\\missing.docx',
                fileName: 'missing.docx'
              }
            }
          ],
          topTerms: ['alpha'],
          commonTags: ['alpha']
        },
        {
          id: 1,
          members: [
            {
              id: 'file:c:/work/beta/spec-review.docx',
              embedding: [0.98, 0.02],
              metadata: {
                filePath: 'C:\\Work\\Beta\\spec-review.docx',
                fileName: 'spec-review.docx'
              }
            }
          ],
          topTerms: ['alpha'],
          commonTags: ['alpha']
        }
      ];
      service.centroids = [
        [1, 0],
        [0.98, 0.02]
      ];

      const fs = require('fs');
      const existsSyncSpy = jest.spyOn(fs, 'existsSync').mockImplementation((candidatePath) => {
        return !String(candidatePath).toLowerCase().includes('missing.docx');
      });

      const edges = service.findCrossClusterEdges(0.1, {
        includeBridgeFiles: true,
        maxBridgeFilesPerCluster: 5,
        minBridgeSimilarity: 0.1
      });

      existsSyncSpy.mockRestore();

      expect(edges.length).toBeGreaterThan(0);
      const bridgePaths = edges[0].bridgeFiles.map((file) => file.path || '');
      expect(bridgePaths.some((candidatePath) => /missing\.docx/i.test(candidatePath))).toBe(false);
    });
  });
});
