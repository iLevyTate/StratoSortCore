jest.mock('electron', () => jest.requireActual('./mocks/electron'));

// Mock logger to prevent pino/sonic-boom from calling real fs.write
jest.mock('../src/shared/logger', () => ({
  createLogger: jest.fn(() => ({
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  }))
}));

const mockFsStore = new Map();
jest.mock('fs', () => ({
  promises: {
    readFile: jest.fn(async (path) => {
      if (!mockFsStore.has(path)) {
        const error = new Error('ENOENT');
        error.code = 'ENOENT';
        throw error;
      }
      return mockFsStore.get(path);
    }),
    writeFile: jest.fn(async (path, contents) => {
      mockFsStore.set(path, contents);
    }),
    rename: jest.fn(async (oldPath, newPath) => {
      const contents = mockFsStore.get(oldPath);
      if (contents !== undefined) {
        mockFsStore.set(newPath, contents);
        mockFsStore.delete(oldPath);
      }
    }),
    unlink: jest.fn(async (path) => {
      mockFsStore.delete(path);
    })
  }
}));

describe('RelationshipIndexService', () => {
  beforeEach(() => {
    mockFsStore.clear();
    jest.resetModules();
  });

  test('buildIndex returns failure when analysis history is missing', async () => {
    const RelationshipIndexService = require('../src/main/services/RelationshipIndexService');
    const service = new RelationshipIndexService({ analysisHistoryService: null });

    const result = await service.buildIndex();

    expect(result.success).toBe(false);
    expect(result.error).toBe('AnalysisHistoryService unavailable');
  });

  test('buildIndex captures expanded concepts and provenance', async () => {
    const RelationshipIndexService = require('../src/main/services/RelationshipIndexService');
    const { getSemanticFileId } = require('../src/shared/fileIdUtils');

    const analysisHistoryService = {
      initialize: jest.fn(),
      analysisHistory: {
        updatedAt: '2026-01-01T00:00:00.000Z',
        entries: {
          doc1: {
            id: 'doc1',
            fileName: 'report.pdf',
            originalPath: '/files/report.pdf',
            analysis: {
              tags: ['finance', 'report', 'beta'],
              keyEntities: ['Acme Corp'],
              entity: 'Acme Corp',
              project: 'Apollo',
              keywords: ['beta']
            }
          },
          doc2: {
            id: 'doc2',
            fileName: 'summary.docx',
            originalPath: '/files/summary.docx',
            analysis: {
              tags: ['beta'],
              keyEntities: ['acme corp'],
              project: 'Apollo',
              keywords: ['insight']
            }
          }
        }
      }
    };

    const service = new RelationshipIndexService({ analysisHistoryService });
    const result = await service.buildIndex();

    expect(result.success).toBe(true);
    expect(result.edges.length).toBe(1);

    const edge = result.edges[0];
    expect(edge.weight).toBeGreaterThanOrEqual(2);
    expect(edge.concepts).toEqual(expect.arrayContaining(['beta', 'apollo']));

    const doc1Id = getSemanticFileId('/files/report.pdf');
    const doc2Id = getSemanticFileId('/files/summary.docx');
    const stats = await service.getStats();

    expect(stats.edgeCount).toBe(1);
    expect(stats.docCount).toBe(2);

    const neighborResp = await service.getNeighborEdges([doc1Id], { maxEdges: 10 });
    expect(neighborResp.success).toBe(true);
    expect(neighborResp.neighbors).toEqual(expect.arrayContaining([doc2Id]));
  });

  test('buildIndex normalizes string lists and trims concepts', async () => {
    const RelationshipIndexService = require('../src/main/services/RelationshipIndexService');

    const analysisHistoryService = {
      initialize: jest.fn(),
      analysisHistory: {
        updatedAt: '2026-01-02T00:00:00.000Z',
        entries: {
          doc1: {
            id: 'doc1',
            originalPath: '/files/alpha.txt',
            analysis: {
              tags: '["Alpha", "Beta"]',
              keywords: 'Gamma, beta',
              keyEntities: '["Acme Corp"]'
            }
          },
          doc2: {
            id: 'doc2',
            originalPath: '/files/beta.txt',
            analysis: {
              tags: ['beta', 'alpha'],
              keywords: 'Acme Corp, delta'
            }
          }
        }
      }
    };

    const service = new RelationshipIndexService({ analysisHistoryService });
    const result = await service.buildIndex();

    expect(result.success).toBe(true);
    expect(result.edges.length).toBe(1);
    expect(result.edges[0].concepts).toEqual(
      expect.arrayContaining(['alpha', 'beta', 'acme corp'])
    );
  });

  test('getEdges rebuilds index when source data changes', async () => {
    const RelationshipIndexService = require('../src/main/services/RelationshipIndexService');

    const analysisHistoryService = {
      initialize: jest.fn(),
      analysisHistory: {
        updatedAt: '2026-01-03T00:00:00.000Z',
        entries: {}
      }
    };

    const service = new RelationshipIndexService({ analysisHistoryService });
    service.index = {
      sourceUpdatedAt: '2026-01-01T00:00:00.000Z',
      edges: []
    };

    const buildSpy = jest.spyOn(service, 'buildIndex').mockResolvedValue({
      success: true,
      edges: []
    });

    await service.getEdges(['file:a', 'file:b']);

    expect(buildSpy).toHaveBeenCalled();
  });
});
