const fs = require('fs').promises;
const os = require('os');
const path = require('path');

jest.mock('fast-xml-parser', () => ({
  XMLParser: jest.fn(() => ({
    parse: jest.fn(() => ({}))
  }))
}));

jest.mock('../src/shared/logger', () => ({
  createLogger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
  })
}));

jest.mock('../src/main/analysis/documentLlm', () => ({
  analyzeTextWithLlama: jest.fn(),
  normalizeCategoryToSmartFolders: jest.fn((cat) => cat),
  AppConfig: {
    ai: {
      textAnalysis: {
        defaultModel: 'mock-model'
      }
    }
  }
}));

jest.mock('../src/main/utils/llmOptimization', () => ({
  globalDeduplicator: {
    generateKey: jest.fn(() => 'mock-key'),
    deduplicate: jest.fn((key, fn) => fn())
  }
}));

jest.mock('../src/main/analysis/semanticFolderMatcher', () => ({
  applySemanticFolderMatching: jest.fn(async () => {}),
  getServices: jest.fn(() => ({}))
}));

describe('per-file analysis cache (document)', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  test('second analyzeDocumentFile call hits cache and avoids LLM', async () => {
    expect.assertions(4);
    // Spy on analyzeTextWithLlama to ensure it is not called twice
    const analyzeSpy = jest.fn(async () => ({
      project: 'Spy',
      purpose: 'Spy purpose',
      category: 'document',
      keywords: ['k1', 'k2', 'k3'],
      confidence: 90,
      suggestedName: 'spy_doc'
    }));

    const { analyzeDocumentFile } = require('../src/main/analysis/documentAnalysis');
    const documentLlm = require('../src/main/analysis/documentLlm');
    documentLlm.analyzeTextWithLlama.mockImplementation(analyzeSpy);

    const tmp = path.posix.join(os.tmpdir(), `doc-cache-${Date.now()}.txt`);
    await fs.writeFile(tmp, 'Sample document contents');

    const r1 = await analyzeDocumentFile(tmp, []);
    const r2 = await analyzeDocumentFile(tmp, []);

    expect(r1).toBeDefined();
    expect(r2).toBeDefined();
    expect(r2.suggestedName).toBeDefined();
    expect(documentLlm.analyzeTextWithLlama).toHaveBeenCalledTimes(1);

    await fs.unlink(tmp);
  });

  test('cache signature changes when smart folder descriptions change', async () => {
    expect.assertions(1);
    const analyzeSpy = jest.fn(async () => ({
      project: 'Spy',
      purpose: 'Spy purpose',
      category: 'document',
      keywords: ['k1', 'k2', 'k3'],
      confidence: 90,
      suggestedName: 'spy_doc'
    }));

    const { analyzeDocumentFile } = require('../src/main/analysis/documentAnalysis');
    const documentLlm = require('../src/main/analysis/documentLlm');
    documentLlm.analyzeTextWithLlama.mockImplementation(analyzeSpy);

    const tmp = path.posix.join(os.tmpdir(), `doc-cache-desc-${Date.now()}.txt`);
    await fs.writeFile(tmp, 'Sample document contents');

    const foldersA = [{ name: 'Finance', description: 'Invoices and receipts' }];
    const foldersB = [{ name: 'Finance', description: 'Budgets and forecasts' }];

    await analyzeDocumentFile(tmp, foldersA);
    await analyzeDocumentFile(tmp, foldersB);

    expect(documentLlm.analyzeTextWithLlama).toHaveBeenCalledTimes(2);

    await fs.unlink(tmp);
  });
});
