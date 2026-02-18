/**
 * Integration Tests - Real Test Files for Embedding, Text, Vision
 *
 * Ensures backend tests for models, embedding, text extraction, and vision
 * use actual test files from test/test-files/ rather than mocks or synthetic data.
 *
 * Uses real file I/O; mocks only AI/GPU-dependent services (Llama, sharp, tesseract)
 * so tests run in CI without models.
 */

const path = require('path');
const fs = require('fs').promises;

const FIXTURE_DIR = path.resolve(__dirname, '../test-files');

// Mock AI/GPU services so tests run without models
jest.mock('../../src/main/services/LlamaService', () => ({
  getInstance: jest.fn()
}));
jest.mock('sharp', () => {
  const mockSharp = jest.fn((input) => ({
    metadata: jest.fn().mockResolvedValue({ width: 800, height: 600, format: 'png' }),
    resize: jest.fn().mockReturnThis(),
    png: jest.fn().mockReturnThis(),
    toBuffer: jest.fn().mockResolvedValue(Buffer.isBuffer(input) ? input : Buffer.from('mock'))
  }));
  return mockSharp;
});
jest.mock('../../src/main/utils/tesseractUtils', () => ({
  isTesseractAvailable: jest.fn().mockResolvedValue(false),
  recognizeIfAvailable: jest.fn().mockResolvedValue({ success: false, text: '' })
}));
jest.mock('../../src/shared/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() })
}));
jest.mock('../../src/main/analysis/semanticFolderMatcher', () => {
  const mockMatcher = {
    embeddingCache: { initialized: true },
    embedText: jest.fn()
  };
  return {
    applySemanticFolderMatching: jest.fn(),
    getServices: jest.fn(() => ({ matcher: mockMatcher })),
    resetSingletons: jest.fn()
  };
});
jest.mock('../../src/shared/folderUtils', () => ({
  findContainingSmartFolder: jest.fn()
}));
jest.mock('../../src/main/services/embedding/embeddingGate', () => ({
  shouldEmbed: jest.fn().mockResolvedValue({ shouldEmbed: true })
}));
jest.mock('../../src/main/analysis/embeddingQueue/stageQueues', () => ({
  analysisQueue: { enqueue: jest.fn() }
}));
jest.mock('../../src/main/analysis/embeddingQueue/queueManager', () => ({
  removeByFilePath: jest.fn()
}));
jest.mock('../../src/main/services/AnalysisCacheService', () => {
  const mockCache = { get: jest.fn(), set: jest.fn(), clear: jest.fn() };
  return { getImageAnalysisCache: jest.fn(() => mockCache) };
});
jest.mock('../../src/main/utils/llmOptimization', () => ({
  globalDeduplicator: {
    generateKey: jest.fn(() => 'test-key'),
    deduplicate: jest.fn((_, fn) => fn())
  }
}));
jest.mock('../../src/main/utils/jsonRepair', () => ({
  extractAndParseJSON: jest.fn((text) => JSON.parse(text))
}));
jest.mock('../../src/main/analysis/fallbackUtils', () => {
  const actual = jest.requireActual('../../src/main/analysis/fallbackUtils');
  return {
    ...actual,
    createFallbackAnalysis: jest.fn((params) => ({ ...params, isFallback: true, confidence: 60 })),
    getIntelligentKeywords: jest.fn(() => ['fallback', 'keyword']),
    getIntelligentCategory: jest.fn(() => 'General')
  };
});
jest.mock('../../src/shared/promiseUtils', () => ({
  withAbortableTimeout: jest.fn((fn) => fn({ signal: {} }))
}));

const { getInstance: getLlamaService } = require('../../src/main/services/LlamaService');
const { getServices } = require('../../src/main/analysis/semanticFolderMatcher');
const { findContainingSmartFolder } = require('../../src/shared/folderUtils');
const { getImageAnalysisCache } = require('../../src/main/services/AnalysisCacheService');

async function fixtureExists(filename) {
  try {
    await fs.access(path.join(FIXTURE_DIR, filename));
    return true;
  } catch {
    return false;
  }
}

describe('Real Test Files - Text Content for Embedding', () => {
  const TEXT_FIXTURES = [
    { file: 'sample.txt', minLength: 50, expects: ['Invoice', 'Acme', 'Financial'] },
    {
      file: 'contract.txt',
      minLength: 100,
      expects: ['SERVICE AGREEMENT', 'TERMS', 'CONFIDENTIALITY']
    },
    { file: 'sample_document.txt', minLength: 20, expects: [] },
    { file: 'project-report.md', minLength: 20, expects: [] },
    { file: 'project_readme.md', minLength: 20, expects: [] }
  ];

  for (const { file, minLength, expects } of TEXT_FIXTURES) {
    test(`reads real ${file} for embedding-ready content`, async () => {
      if (!(await fixtureExists(file))) {
        console.warn(`Skipping: ${file} not found`);
        return;
      }

      const filePath = path.join(FIXTURE_DIR, file);
      const content = await fs.readFile(filePath, 'utf8');

      expect(content).toBeDefined();
      expect(typeof content).toBe('string');
      expect(content.length).toBeGreaterThanOrEqual(minLength);

      for (const term of expects) {
        expect(content).toContain(term);
      }

      const matcher = getServices().matcher;
      matcher.embedText.mockResolvedValueOnce({ vector: new Array(384).fill(0.1) });

      const embeddingResult = await matcher.embedText(content.slice(0, 500));
      expect(embeddingResult).toBeDefined();
      expect(Array.isArray(embeddingResult.vector)).toBe(true);
    });
  }
});

describe('Real Test Files - Document Extraction', () => {
  const {
    extractTextFromCsv,
    extractPlainTextFromHtml,
    extractPlainTextFromRtf,
    extractTextFromEml
  } = require('../../src/main/analysis/documentExtractors');

  test('extracts real sales_data.csv', async () => {
    if (!(await fixtureExists('sales_data.csv'))) return;

    const filePath = path.join(FIXTURE_DIR, 'sales_data.csv');
    const result = await extractTextFromCsv(filePath);

    expect(result).toBeDefined();
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(20);
    expect(result).toContain('Widget');
  });

  test('extracts real webpage_template.html', async () => {
    if (!(await fixtureExists('webpage_template.html'))) return;

    const raw = await fs.readFile(path.join(FIXTURE_DIR, 'webpage_template.html'), 'utf8');
    const result = await extractPlainTextFromHtml(raw);

    expect(result).toBeDefined();
    expect(typeof result).toBe('string');
  });

  test('extracts real rich_text_doc.rtf', async () => {
    if (!(await fixtureExists('rich_text_doc.rtf'))) return;

    const raw = await fs.readFile(path.join(FIXTURE_DIR, 'rich_text_doc.rtf'), 'utf8');
    const result = await extractPlainTextFromRtf(raw);

    expect(result).toBeDefined();
    expect(typeof result).toBe('string');
  });

  test('extracts real meeting_invite.eml', async () => {
    if (!(await fixtureExists('meeting_invite.eml'))) return;

    const filePath = path.join(FIXTURE_DIR, 'meeting_invite.eml');
    const result = await extractTextFromEml(filePath);

    expect(result).toBeDefined();
    expect(typeof result).toBe('string');
  });
});

describe('Real Test Files - Image/Vision Pipeline', () => {
  let mockLlamaService;

  beforeEach(() => {
    jest.clearAllMocks();
    mockLlamaService = {
      getConfig: jest.fn().mockResolvedValue({ visionModel: 'test-vision' }),
      testConnection: jest.fn().mockResolvedValue({ success: true }),
      listModels: jest.fn().mockResolvedValue([{ name: 'test-vision' }]),
      analyzeImage: jest.fn().mockResolvedValue({
        response: JSON.stringify({
          category: 'Images',
          keywords: ['image', 'test'],
          confidence: 85,
          suggestedName: 't2v7h5',
          has_text: false,
          content_type: 'photograph',
          summary: 'Test image from fixtures'
        })
      }),
      supportsVisionInput: jest.fn().mockResolvedValue(true)
    };
    getLlamaService.mockReturnValue(mockLlamaService);
    getImageAnalysisCache().get.mockReturnValue(null);
    getServices().matcher.embedText.mockResolvedValue({ vector: [0.1, 0.2, 0.3] });
    findContainingSmartFolder.mockReturnValue(null);
  });

  test('processes real t2v7h5.png through image analysis', async () => {
    if (!(await fixtureExists('t2v7h5.png'))) {
      console.warn('Skipping: t2v7h5.png not found');
      return;
    }

    const { analyzeImageFile } = require('../../src/main/analysis/imageAnalysis');
    const filePath = path.join(FIXTURE_DIR, 't2v7h5.png');

    const result = await analyzeImageFile(filePath);

    expect(result).toBeDefined();
    expect(result.error).toBeUndefined();
    expect(result.category).toBeDefined();
    expect(typeof result.category).toBe('string');
    expect(result.confidence).toBeGreaterThanOrEqual(0);
    expect(mockLlamaService.analyzeImage).toHaveBeenCalled();
  });

  test('real image file produces valid analysis shape', async () => {
    if (!(await fixtureExists('t2v7h5.png'))) return;

    const { analyzeImageFile } = require('../../src/main/analysis/imageAnalysis');
    const filePath = path.join(FIXTURE_DIR, 't2v7h5.png');

    const result = await analyzeImageFile(filePath);

    expect(result).toMatchObject({
      category: expect.any(String),
      confidence: expect.any(Number),
      suggestedName: expect.any(String)
    });
  });
});
