/**
 * Shared Mock Factories for Full Pipeline Testing
 *
 * Provides reusable mock factories for testing the complete
 * AI analysis and embedding pipeline.
 *
 * @module test/integration/pipeline/pipelineMocks
 */

// Default embedding dimension
const EMBEDDING_DIMENSION = 1024;

/**
 * Create a mock embedding vector
 * @param {number} dimension - Vector dimension (default 1024)
 * @param {number} seed - Seed value for vector elements
 * @returns {number[]} Mock embedding vector
 */
function createMockEmbeddingVector(dimension = EMBEDDING_DIMENSION, seed = 0.1) {
  return new Array(dimension).fill(seed);
}

/**
 * Create mock LlamaService for text analysis
 * @param {Object} fixture - Fixture definition from fileTypeFixtures
 * @returns {Object} Mock LlamaService
 */
function createMockLlamaService(fixture) {
  const mockResponse = {
    purpose: fixture.description || `Analysis of ${fixture.name}`,
    project: 'Test Project',
    category: fixture.expectedCategory || 'Documents',
    date: new Date().toISOString().split('T')[0],
    keywords: fixture.expectedKeywords || ['document', 'file'],
    confidence: 85,
    suggestedName: fixture.name.replace(fixture.extension, '').substring(0, 40)
  };

  const mockImageResponse = {
    purpose: fixture.description || `Image analysis of ${fixture.name}`,
    project: 'Test Project',
    category: 'Images',
    date: new Date().toISOString().split('T')[0],
    keywords: fixture.expectedKeywords || ['image', 'visual'],
    confidence: 80,
    content_type: 'image',
    has_text: false,
    colors: ['gray', 'white', 'black'],
    suggestedName: fixture.name.replace(fixture.extension, '').substring(0, 40)
  };

  return {
    initialize: jest.fn().mockResolvedValue(undefined),
    analyzeText: jest.fn().mockResolvedValue({
      success: true,
      response: JSON.stringify(mockResponse)
    }),
    analyzeImage: jest.fn().mockResolvedValue({
      success: true,
      response: JSON.stringify(mockImageResponse)
    }),
    generateEmbedding: jest.fn().mockResolvedValue({
      success: true,
      embedding: createMockEmbeddingVector()
    }),
    testConnection: jest.fn().mockResolvedValue({
      success: true,
      modelCount: 3
    }),
    getModels: jest.fn().mockResolvedValue({
      success: true,
      models: [
        { name: 'llama3.2:latest', category: 'text' },
        { name: 'llava:latest', category: 'vision' },
        { name: 'mxbai-embed-large', category: 'embedding' }
      ]
    }),
    getHealthStatus: jest.fn().mockResolvedValue({
      initialized: true
    })
  };
}

/**
 * Create mock ParallelEmbeddingService
 * @returns {Object} Mock ParallelEmbeddingService
 */
function createMockParallelEmbeddingService() {
  return {
    embedText: jest.fn().mockResolvedValue({
      vector: createMockEmbeddingVector(),
      model: 'mxbai-embed-large'
    }),
    batchEmbedTexts: jest.fn().mockImplementation((items, options) => {
      const results = items.map((item, index) => ({
        id: item.id || `item-${index}`,
        vector: createMockEmbeddingVector(),
        model: 'mxbai-embed-large',
        meta: item.meta || {},
        success: true
      }));

      if (options?.onProgress) {
        options.onProgress({
          completed: items.length,
          total: items.length,
          percent: 100
        });
      }

      return Promise.resolve({
        results,
        errors: [],
        stats: {
          total: items.length,
          successful: items.length,
          failed: 0
        }
      });
    }),
    batchEmbedFileSummaries: jest.fn().mockImplementation((summaries) => {
      const results = summaries.map((summary) => ({
        id: summary.id,
        vector: createMockEmbeddingVector(),
        model: 'mxbai-embed-large',
        success: true
      }));
      return Promise.resolve({ results, errors: [] });
    }),
    getStats: jest.fn().mockReturnValue({
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      averageLatency: 50
    }),
    setConcurrencyLimit: jest.fn()
  };
}

/**
 * Create mock FolderMatchingService
 * @param {Object} fixture - Fixture definition
 * @returns {Object} Mock FolderMatchingService
 */
function createMockFolderMatchingService(fixture) {
  const expectedCategory = fixture.expectedCategory || 'Documents';

  return {
    initialize: jest.fn().mockResolvedValue(undefined),
    embedText: jest.fn().mockResolvedValue({
      vector: createMockEmbeddingVector(),
      model: 'mxbai-embed-large'
    }),
    matchVectorToFolders: jest.fn().mockResolvedValue([
      {
        name: expectedCategory,
        path: `/test/folders/${expectedCategory}`,
        score: 0.85,
        id: `folder:${expectedCategory.toLowerCase()}`
      },
      {
        name: 'Documents',
        path: '/test/folders/Documents',
        score: 0.65,
        id: 'folder:documents'
      }
    ]),
    matchFileToFolders: jest.fn().mockResolvedValue([
      {
        name: expectedCategory,
        path: `/test/folders/${expectedCategory}`,
        score: 0.85
      }
    ]),
    batchMatchFilesToFolders: jest.fn().mockImplementation((fileIds, topK) => {
      return Promise.resolve(
        fileIds.map((id) => ({
          fileId: id,
          matches: [
            { name: expectedCategory, score: 0.85 },
            { name: 'Documents', score: 0.65 }
          ].slice(0, topK)
        }))
      );
    }),
    upsertFileEmbedding: jest.fn().mockResolvedValue(undefined),
    upsertFolderEmbedding: jest.fn().mockResolvedValue(undefined),
    batchUpsertFolders: jest.fn().mockResolvedValue({
      count: 5,
      skipped: []
    }),
    findSimilarFiles: jest.fn().mockResolvedValue([]),
    embeddingCache: {
      initialized: true,
      get: jest.fn().mockReturnValue(null),
      set: jest.fn(),
      clear: jest.fn()
    }
  };
}

/**
 * Create mock EmbeddingQueue
 * @returns {Object} Mock EmbeddingQueue
 */
function createMockEmbeddingQueue() {
  const queuedItems = [];

  return {
    initialize: jest.fn().mockResolvedValue(undefined),
    enqueue: jest.fn().mockImplementation((item) => {
      queuedItems.push(item);
      return Promise.resolve({ success: true });
    }),
    flush: jest.fn().mockImplementation(() => {
      const count = queuedItems.length;
      queuedItems.length = 0;
      return Promise.resolve({ processed: count, failed: 0 });
    }),
    getStats: jest.fn().mockReturnValue({
      queueLength: queuedItems.length,
      isFlushing: false,
      pendingCount: 0,
      failedCount: 0
    }),
    onProgress: jest.fn().mockReturnValue(() => {}),
    scheduleFlush: jest.fn(),
    // Expose internal queue for assertions
    _getQueuedItems: () => [...queuedItems]
  };
}

/**
 * Create mock vector DB service
 * @returns {Object} Mock vector DB service
 */
function createMockVectorDbService() {
  return {
    initialize: jest.fn().mockResolvedValue(undefined),
    isOnline: true,
    upsertFile: jest.fn().mockResolvedValue({ success: true }),
    upsertFolder: jest.fn().mockResolvedValue({ success: true }),
    batchUpsertFiles: jest.fn().mockResolvedValue({ success: true, count: 0 }),
    batchUpsertFolders: jest.fn().mockResolvedValue({ success: true, count: 0 }),
    queryFolders: jest.fn().mockResolvedValue([]),
    queryFoldersByEmbedding: jest.fn().mockResolvedValue([]),
    querySimilarFiles: jest.fn().mockResolvedValue([]),
    getStats: jest.fn().mockResolvedValue({
      folders: 10,
      files: 50,
      fileChunks: 0,
      feedback: 0,
      learningPatterns: 0
    }),
    peekFiles: jest.fn().mockResolvedValue({ ids: [], embeddings: [], metadatas: [] }),
    getFile: jest.fn().mockResolvedValue(null),
    getFolder: jest.fn().mockResolvedValue(null),
    getChunksForFile: jest.fn().mockResolvedValue([])
  };
}

/**
 * Create mock ModelVerifier
 * @param {boolean} connected - Whether the AI engine is connected
 * @returns {Object} Mock ModelVerifier
 */
function createMockModelVerifier(connected = true) {
  return {
    checkLlamaConnection: jest.fn().mockResolvedValue({
      connected,
      error: connected ? null : 'AI engine offline',
      suggestion: connected ? null : 'Ensure models are downloaded in Settings'
    }),
    getInstalledModels: jest
      .fn()
      .mockResolvedValue(['llama3.2:latest', 'llava:latest', 'mxbai-embed-large']),
    verifyEssentialModels: jest.fn().mockResolvedValue({
      success: true,
      availableModels: ['llama3.2:latest', 'llava:latest', 'mxbai-embed-large'],
      missingModels: []
    }),
    testModelFunctionality: jest.fn().mockResolvedValue({
      text: { success: true },
      vision: { success: true },
      embedding: { success: true }
    }),
    getSystemStatus: jest.fn().mockResolvedValue({
      connected,
      modelsReady: connected,
      embeddingReady: connected
    })
  };
}

/**
 * Create mock document extractors
 * @param {Object} fixture - Fixture definition
 * @returns {Object} Mock document extractors
 */
function createMockDocumentExtractors(fixture) {
  const mockContent = `Sample extracted content from ${fixture.name}. This is test content for analysis.`;

  return {
    extractTextFromPdf: jest.fn().mockResolvedValue(mockContent),
    extractTextFromDocx: jest.fn().mockResolvedValue(mockContent),
    extractTextFromXlsx: jest.fn().mockResolvedValue(mockContent),
    extractTextFromPptx: jest.fn().mockResolvedValue(mockContent),
    extractTextFromTxt: jest.fn().mockResolvedValue(mockContent),
    extractTextFromHtml: jest.fn().mockResolvedValue(mockContent),
    extractTextFromXml: jest.fn().mockResolvedValue(mockContent),
    extractTextFromCsv: jest.fn().mockResolvedValue(mockContent),
    extractTextFromJson: jest.fn().mockResolvedValue(mockContent),
    extractTextFromEml: jest.fn().mockResolvedValue(mockContent),
    extractTextFromRtf: jest.fn().mockResolvedValue(mockContent)
  };
}

/**
 * Create mock ServiceContainer
 * @param {Object} mocks - Object containing service mocks
 * @returns {Object} Mock ServiceContainer
 */
function createMockServiceContainer(mocks = {}) {
  const services = new Map();

  // Register default services
  if (mocks.vectorDb) services.set('vectorDb', mocks.vectorDb);
  if (mocks.llamaService) services.set('llama', mocks.llamaService);
  if (mocks.folderMatching) services.set('folderMatching', mocks.folderMatching);
  if (mocks.embeddingQueue) services.set('embeddingQueue', mocks.embeddingQueue);

  return {
    get: jest.fn((id) => services.get(id)),
    resolve: jest.fn((id) => services.get(id)),
    register: jest.fn((id, service) => services.set(id, service)),
    has: jest.fn((id) => services.has(id))
  };
}

/**
 * Create complete pipeline mocks for a fixture
 * @param {Object} fixture - Fixture definition from fileTypeFixtures
 * @returns {Object} All mocks needed for pipeline testing
 */
function createPipelineMocks(fixture) {
  const llamaService = createMockLlamaService(fixture);
  const parallelEmbedding = createMockParallelEmbeddingService();
  const folderMatching = createMockFolderMatchingService(fixture);
  const embeddingQueue = createMockEmbeddingQueue();
  const vectorDb = createMockVectorDbService();
  const modelVerifier = createMockModelVerifier(true);
  const documentExtractors = createMockDocumentExtractors(fixture);

  const container = createMockServiceContainer({
    vectorDb,
    llamaService,
    folderMatching,
    embeddingQueue
  });

  return {
    llamaService,
    parallelEmbedding,
    folderMatching,
    embeddingQueue,
    vectorDb,
    modelVerifier,
    documentExtractors,
    container,

    // Utility methods
    resetAllMocks() {
      jest.clearAllMocks();
    },

    // Configure offline scenarios
    setLlamaOffline() {
      llamaService.analyzeText.mockRejectedValue(new Error('AI engine offline'));
      llamaService.analyzeImage.mockRejectedValue(new Error('AI engine offline'));
      llamaService.generateEmbedding.mockRejectedValue(new Error('AI engine offline'));
      modelVerifier.checkLlamaConnection.mockResolvedValue({
        connected: false,
        error: 'AI engine offline'
      });
    },

    setVectorDbOffline() {
      vectorDb.isOnline = false;
      vectorDb.upsertFile.mockRejectedValue(new Error('Vector DB offline'));
      vectorDb.queryFoldersByEmbedding.mockRejectedValue(new Error('Vector DB offline'));
    },

    setEmbeddingFailure() {
      parallelEmbedding.embedText.mockRejectedValue(new Error('Embedding generation failed'));
      folderMatching.embedText.mockRejectedValue(new Error('Embedding generation failed'));
    }
  };
}

/**
 * Create mock smart folders for testing
 * @returns {Array} Array of mock smart folders
 */
function createMockSmartFolders() {
  return [
    {
      name: 'Financial',
      description: 'Financial documents, invoices, receipts, and statements',
      path: '/test/folders/Financial',
      keywords: ['invoice', 'receipt', 'financial', 'payment', 'bank'],
      category: 'finance'
    },
    {
      name: 'Documents',
      description: 'General documents and text files',
      path: '/test/folders/Documents',
      keywords: ['document', 'text', 'file', 'report'],
      category: 'documents'
    },
    {
      name: 'Images',
      description: 'Photos, graphics, and visual media',
      path: '/test/folders/Images',
      keywords: ['image', 'photo', 'picture', 'graphic', 'visual'],
      category: 'images'
    },
    {
      name: '3D Models',
      description: '3D modeling files for printing and design',
      path: '/test/folders/3D Models',
      keywords: ['3d', 'model', 'stl', 'obj', 'print', 'mesh'],
      category: '3d'
    },
    {
      name: 'Design',
      description: 'Design files and creative assets',
      path: '/test/folders/Design',
      keywords: ['design', 'creative', 'artwork', 'vector', 'psd'],
      category: 'design'
    },
    {
      name: 'Code',
      description: 'Source code and programming files',
      path: '/test/folders/Code',
      keywords: ['code', 'programming', 'script', 'source', 'development'],
      category: 'code'
    },
    {
      name: 'Data',
      description: 'Data files, spreadsheets, and databases',
      path: '/test/folders/Data',
      keywords: ['data', 'spreadsheet', 'database', 'csv', 'json'],
      category: 'data'
    }
  ];
}

module.exports = {
  EMBEDDING_DIMENSION,
  createMockEmbeddingVector,
  createMockLlamaService,
  createMockParallelEmbeddingService,
  createMockFolderMatchingService,
  createMockEmbeddingQueue,
  createMockVectorDbService,
  createMockModelVerifier,
  createMockDocumentExtractors,
  createMockServiceContainer,
  createPipelineMocks,
  createMockSmartFolders
};
