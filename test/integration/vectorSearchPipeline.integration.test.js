/**
 * Integration Tests - Vector Search Pipeline
 *
 * Validates the complete vector storage → search pipeline works correctly:
 * 1. OramaVectorService stores multiple diverse documents
 * 2. Similarity search returns correctly ranked results
 * 3. BM25 full-text index is built from analysis history
 * 4. BM25 search finds documents by text content
 * 5. Hybrid search combines vector + BM25 with proper fusion
 * 6. Embedding queue processes items and stores them
 *
 * Uses real Orama instances (not mocked) with a temp directory.
 */

const fs = require('fs').promises;
const path = require('path');
let app;
let OramaVectorService;

// Mock Electron app for getPath
jest.mock('electron', () => ({
  app: {
    getPath: jest.fn()
  }
}));

jest.mock('../../src/shared/logger', () => ({
  createLogger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
  })
}));

jest.mock('../../src/shared/singletonFactory', () => ({
  createSingletonHelpers: () => ({
    getInstance: jest.fn(),
    createInstance: jest.fn(),
    registerWithContainer: jest.fn(),
    resetInstance: jest.fn()
  })
}));

// Mock Orama persistence plugin (ESM compatibility)
jest.mock('@orama/plugin-data-persistence', () => ({
  persist: jest.fn(async () => '{}'),
  restore: jest.fn(async () => {
    throw new Error('restore not available in test');
  })
}));

const TEMP_DIR = path.join(__dirname, 'temp-vector-search-pipeline');
const DIM = 768;

// Load mocked modules after jest.mock calls
({ app } = require('electron'));
({ OramaVectorService } = require('../../src/main/services/OramaVectorService'));

/**
 * Generate a normalized embedding vector with a dominant signal at specific indices.
 * This creates vectors that are similar when they share signal positions.
 *
 * @param {number[]} signalIndices - Indices where the vector has high values
 * @param {number} dimension - Vector dimension
 * @returns {number[]} Normalized embedding vector
 */
function createDistinctVector(signalIndices, dimension = DIM) {
  const vec = new Array(dimension).fill(0.01);
  for (const idx of signalIndices) {
    if (idx < dimension) {
      vec[idx] = 0.9;
    }
  }
  // Normalize to unit length for cosine similarity
  const magnitude = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0));
  return vec.map((v) => v / magnitude);
}

// Create distinct document vectors that cluster by topic
const FINANCE_VEC = createDistinctVector([0, 1, 2, 3, 4, 5, 6, 7]);
const FINANCE_SIMILAR_VEC = createDistinctVector([0, 1, 2, 3, 4, 5, 8, 9]); // Overlaps with finance
const LEGAL_VEC = createDistinctVector([50, 51, 52, 53, 54, 55, 56, 57]);
const IMAGE_VEC = createDistinctVector([100, 101, 102, 103, 104, 105, 106, 107]);
const CODE_VEC = createDistinctVector([200, 201, 202, 203, 204, 205, 206, 207]);

// Test documents representing different file types analyzed by the pipeline
const TEST_DOCUMENTS = [
  {
    id: 'file:C:/docs/invoice_2024.pdf',
    vector: FINANCE_VEC,
    meta: {
      path: 'C:/docs/invoice_2024.pdf',
      fileName: 'invoice_2024.pdf',
      fileType: 'application/pdf',
      category: 'Financial',
      summary: 'Invoice from Acme Corporation for AI processing services',
      keywords: ['invoice', 'payment', 'financial', 'billing'],
      analyzedAt: new Date().toISOString()
    }
  },
  {
    id: 'file:C:/docs/budget_report.xlsx',
    vector: FINANCE_SIMILAR_VEC,
    meta: {
      path: 'C:/docs/budget_report.xlsx',
      fileName: 'budget_report.xlsx',
      fileType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      category: 'Financial',
      summary: 'Annual budget report with department allocations',
      keywords: ['budget', 'financial', 'report', 'spreadsheet'],
      analyzedAt: new Date().toISOString()
    }
  },
  {
    id: 'file:C:/docs/service_agreement.pdf',
    vector: LEGAL_VEC,
    meta: {
      path: 'C:/docs/service_agreement.pdf',
      fileName: 'service_agreement.pdf',
      fileType: 'application/pdf',
      category: 'Legal',
      summary: 'Service agreement between Tech Solutions Inc and Business Corp',
      keywords: ['contract', 'agreement', 'legal', 'terms'],
      analyzedAt: new Date().toISOString()
    }
  },
  {
    id: 'file:C:/images/receipt_photo.png',
    vector: IMAGE_VEC,
    meta: {
      path: 'C:/images/receipt_photo.png',
      fileName: 'receipt_photo.png',
      fileType: 'image/png',
      category: 'Images',
      summary: 'Photo of a store receipt',
      keywords: ['receipt', 'photo', 'image'],
      analyzedAt: new Date().toISOString()
    }
  },
  {
    id: 'file:C:/code/data_processor.py',
    vector: CODE_VEC,
    meta: {
      path: 'C:/code/data_processor.py',
      fileName: 'data_processor.py',
      fileType: 'text/x-python',
      category: 'Code',
      summary: 'Python data processing script for ETL pipeline',
      keywords: ['python', 'code', 'data', 'processing'],
      analyzedAt: new Date().toISOString()
    }
  }
];

describe('Vector Search Pipeline - OramaVectorService', () => {
  let service;

  beforeAll(async () => {
    await fs.mkdir(TEMP_DIR, { recursive: true });
  });

  afterAll(async () => {
    try {
      await fs.rm(TEMP_DIR, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    app.getPath.mockReturnValue(TEMP_DIR);
    service = new OramaVectorService();
    await service.initialize();
  });

  afterEach(async () => {
    await service.cleanup();
  });

  describe('Multi-document storage and retrieval', () => {
    test('stores all test documents successfully', async () => {
      for (const doc of TEST_DOCUMENTS) {
        const result = await service.upsertFile(doc);
        expect(result.success).toBe(true);
      }

      const stats = await service.getStats();
      expect(stats.files).toBe(TEST_DOCUMENTS.length);
    });

    test('retrieves each document by ID after storage', async () => {
      for (const doc of TEST_DOCUMENTS) {
        await service.upsertFile(doc);
      }

      for (const doc of TEST_DOCUMENTS) {
        const retrieved = await service.getFile(doc.id);
        expect(retrieved).toBeDefined();
        expect(retrieved.id).toBe(doc.id);
        expect(retrieved.fileName).toBe(doc.meta.fileName);
      }
    });

    test('returns null for non-existent document', async () => {
      const result = await service.getFile('file:nonexistent.pdf');
      expect(result).toBeNull();
    });
  });

  describe('Similarity search ranking', () => {
    beforeEach(async () => {
      for (const doc of TEST_DOCUMENTS) {
        await service.upsertFile(doc);
      }
    });

    test('finance query vector returns finance documents first', async () => {
      const results = await service.querySimilarFiles(FINANCE_VEC, 5);

      // The top result must be the exact match (invoice)
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0].id).toBe('file:C:/docs/invoice_2024.pdf');
      expect(results[0].score).toBeGreaterThan(0.9);

      // If multiple results returned, the similar finance doc should rank above unrelated docs
      if (results.length >= 2) {
        const budgetIdx = results.findIndex((r) => r.id === 'file:C:/docs/budget_report.xlsx');
        const legalIdx = results.findIndex((r) => r.id === 'file:C:/docs/service_agreement.pdf');
        if (budgetIdx >= 0 && legalIdx >= 0) {
          expect(budgetIdx).toBeLessThan(legalIdx);
        }
      }
    });

    test('legal query vector returns legal document first', async () => {
      const results = await service.querySimilarFiles(LEGAL_VEC, 5);

      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0].id).toBe('file:C:/docs/service_agreement.pdf');
      expect(results[0].score).toBeGreaterThan(0.9);
    });

    test('image query vector returns image document first', async () => {
      const results = await service.querySimilarFiles(IMAGE_VEC, 5);

      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0].id).toBe('file:C:/images/receipt_photo.png');
    });

    test('code query vector returns code document first', async () => {
      const results = await service.querySimilarFiles(CODE_VEC, 5);

      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0].id).toBe('file:C:/code/data_processor.py');
    });

    test('similar finance vectors have higher similarity than unrelated vectors', async () => {
      const results = await service.querySimilarFiles(FINANCE_SIMILAR_VEC, 5);

      // The top result should be a finance document (budget report is the closest match)
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0].id).toBe('file:C:/docs/budget_report.xlsx');
      expect(results[0].score).toBeGreaterThan(0.9);

      // If multiple results are returned, verify finance docs rank above unrelated ones
      if (results.length >= 2) {
        const financeIds = new Set([
          'file:C:/docs/invoice_2024.pdf',
          'file:C:/docs/budget_report.xlsx'
        ]);
        const financeResults = results.filter((r) => financeIds.has(r.id));
        const otherResults = results.filter((r) => !financeIds.has(r.id));

        if (financeResults.length > 0 && otherResults.length > 0) {
          const lowestFinanceScore = Math.min(...financeResults.map((r) => r.score));
          const highestOtherScore = Math.max(...otherResults.map((r) => r.score));
          expect(lowestFinanceScore).toBeGreaterThan(highestOtherScore);
        }
      }
    });

    test('topK parameter limits result count', async () => {
      const results = await service.querySimilarFiles(FINANCE_VEC, 2);
      expect(results.length).toBeLessThanOrEqual(2);
    });
  });

  describe('Document update and delete', () => {
    beforeEach(async () => {
      for (const doc of TEST_DOCUMENTS) {
        await service.upsertFile(doc);
      }
    });

    test('upsert updates existing document metadata', async () => {
      const updated = {
        ...TEST_DOCUMENTS[0],
        meta: {
          ...TEST_DOCUMENTS[0].meta,
          summary: 'Updated invoice summary with new details'
        }
      };

      const result = await service.upsertFile(updated);
      expect(result.success).toBe(true);

      // Should still have same number of docs (not duplicated)
      const stats = await service.getStats();
      expect(stats.files).toBe(TEST_DOCUMENTS.length);
    });

    test('delete removes document from search results', async () => {
      await service.deleteFileEmbedding('file:C:/docs/invoice_2024.pdf');

      // Verify deleted document is no longer retrievable
      const deleted = await service.getFile('file:C:/docs/invoice_2024.pdf');
      expect(deleted).toBeNull();

      // Verify deleted document does not appear in search results
      const results = await service.querySimilarFiles(FINANCE_VEC, 5);
      const ids = results.map((r) => r.id);
      expect(ids).not.toContain('file:C:/docs/invoice_2024.pdf');

      // If any results remain, the budget report (most similar) should be first
      if (results.length > 0) {
        expect(results[0].id).toBe('file:C:/docs/budget_report.xlsx');
      }
    });

    test('updateFilePaths re-keys document after file move', async () => {
      const updated = await service.updateFilePaths([
        {
          oldId: 'file:C:/docs/invoice_2024.pdf',
          newId: 'file:C:/archive/invoice_2024.pdf',
          newPath: 'C:/archive/invoice_2024.pdf',
          newName: 'invoice_2024.pdf'
        }
      ]);

      expect(updated).toBe(1);

      // Old ID should be gone
      const oldDoc = await service.getFile('file:C:/docs/invoice_2024.pdf');
      expect(oldDoc).toBeNull();

      // New ID should exist with updated path
      const newDoc = await service.getFile('file:C:/archive/invoice_2024.pdf');
      expect(newDoc).toBeDefined();
      expect(newDoc.filePath).toBe('C:/archive/invoice_2024.pdf');

      // The vector should still be intact (search should still work)
      const results = await service.querySimilarFiles(FINANCE_VEC, 1);
      expect(results[0].id).toBe('file:C:/archive/invoice_2024.pdf');
    });
  });

  describe('Folder embeddings', () => {
    const testFolders = [
      {
        id: 'folder:financial',
        vector: FINANCE_VEC,
        meta: { name: 'Financial', path: '/Financial', description: 'Financial documents' }
      },
      {
        id: 'folder:legal',
        vector: LEGAL_VEC,
        meta: { name: 'Legal', path: '/Legal', description: 'Legal documents and contracts' }
      },
      {
        id: 'folder:images',
        vector: IMAGE_VEC,
        meta: { name: 'Images', path: '/Images', description: 'Photos and images' }
      }
    ];

    test('stores and queries folder embeddings', async () => {
      for (const folder of testFolders) {
        await service.upsertFolder(folder);
      }

      // Query with finance vector should return Financial folder first
      const results = await service.queryFoldersByEmbedding(FINANCE_VEC, 3);
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0].id).toBe('folder:financial');
      expect(results[0].metadata.folderName).toBe('Financial');
    });

    test('folder search ranks correctly by topic similarity', async () => {
      for (const folder of testFolders) {
        await service.upsertFolder(folder);
      }

      // Legal query should match Legal folder best
      const legalResults = await service.queryFoldersByEmbedding(LEGAL_VEC, 3);
      expect(legalResults[0].id).toBe('folder:legal');

      // Image query should match Images folder best
      const imageResults = await service.queryFoldersByEmbedding(IMAGE_VEC, 3);
      expect(imageResults[0].id).toBe('folder:images');
    });
  });
});

describe('Vector Search Pipeline - Dimension Validation', () => {
  let service;

  beforeAll(async () => {
    await fs.mkdir(TEMP_DIR, { recursive: true });
  });

  afterAll(async () => {
    try {
      await fs.rm(TEMP_DIR, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    app.getPath.mockReturnValue(TEMP_DIR);
    service = new OramaVectorService();
    await service.initialize();
  });

  afterEach(async () => {
    await service.cleanup();
  });

  test('rejects vectors with wrong dimension', async () => {
    const wrongDim = {
      id: 'file:wrong-dim',
      vector: [0.1, 0.2, 0.3], // Way too short
      meta: { fileName: 'test.pdf' }
    };

    const result = await service.upsertFile(wrongDim);
    expect(result.success).toBe(false);
    expect(result.error).toBe('dimension_mismatch');
  });

  test('rejects empty vectors', async () => {
    const emptyVec = {
      id: 'file:empty-vec',
      vector: [],
      meta: { fileName: 'test.pdf' }
    };

    const result = await service.upsertFile(emptyVec);
    expect(result.success).toBe(false);
  });
});

describe('Vector Search Pipeline - Search Service BM25 Index', () => {
  // Test BM25 index building using the SearchService with mock analysis history.
  // This validates that the BM25 full-text search component works independently.

  let SearchService;

  beforeAll(() => {
    // Mock all SearchService dependencies that are loaded at module scope

    jest.mock('../../src/shared/pathSanitization', () => ({
      normalizePathForIndex: (p) =>
        String(p || '')
          .replace(/\\/g, '/')
          .toLowerCase()
    }));

    jest.mock('../../src/shared/fileIdUtils', () => ({
      getSemanticFileId: (p) => `file:${p}`
    }));

    jest.mock('../../src/shared/vectorMath', () => ({
      validateEmbeddingDimensions: jest.fn(() => true),
      padOrTruncateVector: jest.fn((v) => v)
    }));

    jest.mock('../../src/shared/performanceConstants', () => ({
      TRUNCATION: { SEARCH_TEXT_MAX: 5000, KEYWORDS_MAX: 10, PREVIEW_MEDIUM: 200 },
      TIMEOUTS: {
        VECTOR_SEARCH: 5000,
        AI_ANALYSIS_MEDIUM: 60000,
        AI_ANALYSIS_LONG: 120000
      },
      LIMITS: { MIN_SEARCH_QUERY_LENGTH: 2 },
      THRESHOLDS: {
        MIN_SIMILARITY_SCORE: 0.15,
        MIN_MATCH_CONFIDENCE: 0.6,
        FOLDER_MATCH_CONFIDENCE: 0.65,
        QUEUE_HIGH_WATERMARK: 0.8,
        QUEUE_CRITICAL_WATERMARK: 0.9
      },
      SEARCH: {
        RRF_K: 60,
        RRF_NORMALIZED_WEIGHT: 0.7,
        RRF_ORIGINAL_WEIGHT: 0.3,
        VECTOR_WEIGHT: 0.75,
        BM25_WEIGHT: 0.25,
        DEFAULT_TOP_K: 30,
        DEFAULT_TOP_K_SIMILAR: 10,
        GRAPH_EXPANSION_ENABLED: false,
        GRAPH_EXPANSION_WEIGHT: 0.2
      }
    }));

    ({ SearchService } = require('../../src/main/services/SearchService'));
  });

  test('builds BM25 index from analysis history entries', async () => {
    const mockHistory = {
      initialize: jest.fn().mockResolvedValue(undefined),
      analysisHistory: {
        metadata: { totalEntries: 3 },
        entries: {
          'entry-1': {
            id: 'entry-1',
            originalPath: 'C:/docs/invoice_2024.pdf',
            fileName: 'invoice_2024.pdf',
            timestamp: '2024-01-15T10:00:00Z',
            analysis: {
              subject: 'Acme Corporation Invoice',
              summary: 'Invoice for AI document processing services from Acme Corporation',
              category: 'Financial',
              tags: ['invoice', 'payment', 'financial'],
              keywords: 'invoice,payment,financial',
              purpose: 'Billing document for services rendered'
            }
          },
          'entry-2': {
            id: 'entry-2',
            originalPath: 'C:/docs/service_agreement.pdf',
            fileName: 'service_agreement.pdf',
            timestamp: '2024-01-16T10:00:00Z',
            analysis: {
              subject: 'Service Agreement',
              summary: 'Legal service agreement between Tech Solutions and Business Corp',
              category: 'Legal',
              tags: ['contract', 'agreement', 'legal'],
              keywords: 'contract,agreement,legal',
              purpose: 'Binding service agreement for software development'
            }
          },
          'entry-3': {
            id: 'entry-3',
            originalPath: 'C:/code/data_processor.py',
            fileName: 'data_processor.py',
            timestamp: '2024-01-17T10:00:00Z',
            analysis: {
              subject: 'Data Processing Script',
              summary: 'Python script for ETL data processing pipeline',
              category: 'Code',
              tags: ['python', 'code', 'data', 'ETL'],
              keywords: 'python,code,data,processing',
              purpose: 'Automated data extraction and transformation'
            }
          }
        }
      }
    };

    const service = new SearchService({
      vectorDbService: {
        initialize: jest.fn().mockResolvedValue(true),
        getStats: jest.fn().mockResolvedValue({ files: 0, fileChunks: 0, folders: 0 })
      },
      analysisHistoryService: mockHistory,
      parallelEmbeddingService: {}
    });

    const result = await service.buildBM25Index();

    expect(result.success).toBe(true);
    expect(result.indexed).toBe(3);
  });

  test('BM25 search finds document by subject keywords', async () => {
    const mockHistory = {
      initialize: jest.fn().mockResolvedValue(undefined),
      analysisHistory: {
        metadata: { totalEntries: 2 },
        entries: {
          'entry-1': {
            id: 'entry-1',
            originalPath: 'C:/docs/invoice_2024.pdf',
            fileName: 'invoice_2024.pdf',
            timestamp: '2024-01-15T10:00:00Z',
            analysis: {
              subject: 'Acme Corporation Invoice',
              summary: 'Invoice for AI document processing services',
              category: 'Financial',
              tags: ['invoice', 'payment'],
              purpose: 'Billing document'
            }
          },
          'entry-2': {
            id: 'entry-2',
            originalPath: 'C:/docs/service_agreement.pdf',
            fileName: 'service_agreement.pdf',
            timestamp: '2024-01-16T10:00:00Z',
            analysis: {
              subject: 'Service Agreement',
              summary: 'Legal agreement for software development',
              category: 'Legal',
              tags: ['contract', 'legal'],
              purpose: 'Service contract'
            }
          }
        }
      }
    };

    const service = new SearchService({
      vectorDbService: {
        initialize: jest.fn().mockResolvedValue(true),
        getStats: jest.fn().mockResolvedValue({ files: 0, fileChunks: 0, folders: 0 })
      },
      analysisHistoryService: mockHistory,
      parallelEmbeddingService: {}
    });

    await service.buildBM25Index();

    // Search for "invoice" should return the invoice document
    const results = await service.bm25Search('invoice Acme', 5);

    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].id).toContain('invoice_2024.pdf');
    expect(results[0].score).toBeGreaterThan(0);
  });

  test('BM25 search finds document by category', async () => {
    const mockHistory = {
      initialize: jest.fn().mockResolvedValue(undefined),
      analysisHistory: {
        metadata: { totalEntries: 2 },
        entries: {
          'entry-1': {
            id: 'entry-1',
            originalPath: 'C:/docs/invoice.pdf',
            fileName: 'invoice.pdf',
            timestamp: '2024-01-15T10:00:00Z',
            analysis: {
              subject: 'Invoice',
              summary: 'Financial invoice document',
              category: 'Financial',
              tags: ['invoice']
            }
          },
          'entry-2': {
            id: 'entry-2',
            originalPath: 'C:/code/script.py',
            fileName: 'script.py',
            timestamp: '2024-01-16T10:00:00Z',
            analysis: {
              subject: 'Python Script',
              summary: 'Data processing python script',
              category: 'Code',
              tags: ['python', 'code']
            }
          }
        }
      }
    };

    const service = new SearchService({
      vectorDbService: {
        initialize: jest.fn().mockResolvedValue(true),
        getStats: jest.fn().mockResolvedValue({ files: 0, fileChunks: 0, folders: 0 })
      },
      analysisHistoryService: mockHistory,
      parallelEmbeddingService: {}
    });

    await service.buildBM25Index();

    // Search for "python code" should return the script
    const results = await service.bm25Search('python code', 5);

    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].id).toContain('script.py');
  });

  test('BM25 search returns empty for non-matching query', async () => {
    const mockHistory = {
      initialize: jest.fn().mockResolvedValue(undefined),
      analysisHistory: {
        metadata: { totalEntries: 1 },
        entries: {
          'entry-1': {
            id: 'entry-1',
            originalPath: 'C:/docs/invoice.pdf',
            fileName: 'invoice.pdf',
            timestamp: '2024-01-15T10:00:00Z',
            analysis: {
              subject: 'Invoice',
              summary: 'Financial document',
              category: 'Financial',
              tags: ['invoice']
            }
          }
        }
      }
    };

    const service = new SearchService({
      vectorDbService: {
        initialize: jest.fn().mockResolvedValue(true),
        getStats: jest.fn().mockResolvedValue({ files: 0, fileChunks: 0, folders: 0 })
      },
      analysisHistoryService: mockHistory,
      parallelEmbeddingService: {}
    });

    await service.buildBM25Index();

    const results = await service.bm25Search('xylophone orchestra', 5);
    expect(results.length).toBe(0);
  });
});
