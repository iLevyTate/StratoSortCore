const fs = require('fs').promises;
const os = require('os');
const path = require('path');

jest.mock('fast-xml-parser', () => ({
  XMLParser: jest.fn(() => ({
    parse: jest.fn(() => ({}))
  }))
}));

describe('per-file analysis cache (document)', () => {
  beforeEach(() => {
    // Mock ollamaDetection to ensure analysis proceeds
    jest.mock('../src/main/utils/ollamaDetection', () => ({
      isOllamaRunning: jest.fn().mockResolvedValue(true),
      isOllamaInstalled: jest.fn().mockResolvedValue(true)
    }));
  });

  afterEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  test('second analyzeDocumentFile call hits cache and avoids LLM', async () => {
    expect.assertions(4);
    // Spy on analyzeTextWithOllama to ensure it is not called twice
    const analyzeSpy = jest.fn(async () => ({
      project: 'Spy',
      purpose: 'Spy purpose',
      category: 'document',
      keywords: ['k1', 'k2', 'k3'],
      confidence: 90,
      suggestedName: 'spy_doc'
    }));

    jest.doMock(
      '../src/main/analysis/documentLlm',
      () => ({
        analyzeTextWithOllama: analyzeSpy,
        AppConfig: {
          ai: {
            textAnalysis: {
              defaultModel: 'mock-model'
            }
          }
        }
      }),
      { virtual: false }
    );

    const { analyzeDocumentFile } = require('../src/main/analysis/ollamaDocumentAnalysis');

    const tmp = path.join(os.tmpdir(), `doc-cache-${Date.now()}.txt`);
    await fs.writeFile(tmp, 'Sample document contents');

    const r1 = await analyzeDocumentFile(tmp, []);
    const r2 = await analyzeDocumentFile(tmp, []);

    expect(r1).toBeDefined();
    expect(r2).toBeDefined();
    expect(r2.suggestedName).toBeDefined();
    expect(analyzeSpy).toHaveBeenCalledTimes(1);

    await fs.unlink(tmp);
  });
});
