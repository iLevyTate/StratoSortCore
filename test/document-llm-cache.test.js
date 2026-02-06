const path = require('path');

describe('documentLlm cache', () => {
  afterEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  test('returns cached result on repeated input', async () => {
    // Mock LlamaService to count generate calls
    const generateMock = jest.fn(async () => ({
      response: JSON.stringify({
        project: 'Test',
        purpose: 'Mock purpose',
        category: 'General',
        keywords: ['a', 'b', 'c'],
        confidence: 80,
        suggestedName: 'test_doc'
      })
    }));

    jest.doMock(path.join('..', 'src', 'main', 'services', 'LlamaService'), () => ({
      getInstance: () => ({
        initialize: jest.fn().mockResolvedValue(undefined),
        getConfig: jest.fn().mockReturnValue({ textModel: 'test-model.gguf' }),
        generateText: generateMock
      })
    }));

    const { analyzeTextWithLlama } = require('../src/main/analysis/documentLlm');

    const text = 'Hello world. This is a test document.';
    const folders = [{ name: 'General', description: 'General docs' }];

    const first = await analyzeTextWithLlama(text, 'file.txt', folders);
    const second = await analyzeTextWithLlama(text, 'file.txt', folders);

    expect(first).toBeDefined();
    expect(second).toBeDefined();
    expect(first.suggestedName).toBe(second.suggestedName);
    // Ensure underlying generate only called once due to cache
    expect(generateMock).toHaveBeenCalledTimes(1);
  });
});
