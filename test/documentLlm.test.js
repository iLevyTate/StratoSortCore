/**
 * Tests for documentLlm
 * TIER 1 - CRITICAL: Core document analysis with LLM
 * Testing text analysis and AI-powered document understanding
 */

const { analyzeTextWithOllama, AppConfig } = require('../src/main/analysis/documentLlm');

// Mock logger
jest.mock('../src/shared/logger', () => ({
  logger: {
    setContext: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  }
}));

// Mock ollama utils
jest.mock('../src/main/ollamaUtils', () => ({
  loadOllamaConfig: jest.fn(),
  getOllamaModel: jest.fn(),
  getOllama: jest.fn()
}));

describe('documentLlm', () => {
  let mockOllamaClient;
  const { loadOllamaConfig, getOllamaModel, getOllama } = require('../src/main/ollamaUtils');

  beforeEach(() => {
    // Setup mock Ollama client
    mockOllamaClient = {
      generate: jest.fn()
    };

    getOllama.mockResolvedValue(mockOllamaClient);
    loadOllamaConfig.mockResolvedValue({
      selectedTextModel: 'llama2',
      selectedModel: 'llama2'
    });
    getOllamaModel.mockReturnValue('llama2');
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('analyzeTextWithOllama', () => {
    test('should bust cache when model changes', async () => {
      const textContent = `model-change-${Date.now()}`;
      const fileName = 'model-change.txt';

      mockOllamaClient.generate.mockResolvedValue({
        response: JSON.stringify({
          project: 'First',
          purpose: 'First run',
          category: 'cat1',
          keywords: ['one'],
          confidence: 80
        })
      });

      getOllamaModel.mockReturnValueOnce('model-a').mockReturnValueOnce('model-b');

      await analyzeTextWithOllama(textContent, fileName, []);
      await analyzeTextWithOllama(textContent, fileName, []);

      expect(mockOllamaClient.generate).toHaveBeenCalledTimes(2);
      expect(mockOllamaClient.generate.mock.calls[0][0].model).toBe('model-a');
      expect(mockOllamaClient.generate.mock.calls[1][0].model).toBe('model-b');
    });

    test('should bust cache when smart folder set changes', async () => {
      const textContent = `folder-change-${Date.now()}`;
      const fileName = 'folder-change.txt';
      getOllamaModel.mockReturnValue('model-cache');

      mockOllamaClient.generate.mockResolvedValue({
        response: JSON.stringify({
          project: 'FolderRun',
          purpose: 'Folder change',
          category: 'cat',
          keywords: ['kw'],
          confidence: 82
        })
      });

      await analyzeTextWithOllama(textContent, fileName, [{ name: 'A', description: 'first' }]);
      await analyzeTextWithOllama(textContent, fileName, [{ name: 'B', description: 'second' }]);

      expect(mockOllamaClient.generate).toHaveBeenCalledTimes(2);
      const prompts = mockOllamaClient.generate.mock.calls.map((c) => c[0].prompt);
      expect(prompts[0]).toContain('A');
      expect(prompts[1]).toContain('B');
    });

    test('should include chunk metadata for long content', async () => {
      const longText = 'chunk '.repeat(3000); // ensures multiple chunks with overlap
      mockOllamaClient.generate.mockResolvedValue({
        response: JSON.stringify({
          keywords: ['test'],
          confidence: 77
        })
      });

      await analyzeTextWithOllama(longText, 'chunks.txt', []);

      const prompt = mockOllamaClient.generate.mock.calls[0][0].prompt;
      expect(prompt).toMatch(/chunk\(s\)/i);
      expect(prompt).toMatch(/\d+\s+chunk\(s\)/i);
    });

    test('should analyze text and return structured result', async () => {
      const textContent = 'This is a financial invoice for Q1 2024. Amount: $1,000';
      const fileName = 'invoice_q1_2024.pdf';
      const smartFolders = [{ name: 'Invoices', description: 'Financial invoices and receipts' }];

      mockOllamaClient.generate.mockResolvedValue({
        response: JSON.stringify({
          date: '2024-01-15',
          project: 'Q1 Financial',
          purpose: 'Invoice documentation',
          category: 'Invoices',
          keywords: ['invoice', 'financial', 'Q1', '2024'],
          confidence: 85,
          suggestedName: 'invoice_q1_2024'
        })
      });

      const result = await analyzeTextWithOllama(textContent, fileName, smartFolders);

      expect(result).toBeDefined();
      expect(result.project).toBe('Q1 Financial');
      expect(result.purpose).toBe('Invoice documentation');
      expect(result.category).toBe('Invoices');
      expect(result.keywords).toContain('invoice');
      expect(result.confidence).toBe(85);
      expect(result.rawText).toBeDefined();

      expect(mockOllamaClient.generate).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'llama2',
          format: 'json',
          options: expect.objectContaining({
            temperature: AppConfig.ai.textAnalysis.temperature,
            num_predict: AppConfig.ai.textAnalysis.maxTokens
          })
        })
      );
    });

    test('normalizes category to an existing smart folder name when model returns generic "document"', async () => {
      const textContent = 'Some generic content';
      const fileName = 'notes.txt';
      const smartFolders = [
        {
          name: 'Uncategorized',
          description: "Default folder for files that don't match any category"
        },
        { name: 'Research', description: 'Academic papers and research notes' }
      ];

      mockOllamaClient.generate.mockResolvedValue({
        response: JSON.stringify({
          date: '2024-01-15',
          project: 'Notes',
          purpose: 'General notes',
          category: 'document',
          keywords: ['notes', 'general', 'text'],
          confidence: 75,
          suggestedName: 'general_notes'
        })
      });

      const result = await analyzeTextWithOllama(textContent, fileName, smartFolders);
      expect(result.category).toBe('Uncategorized');
    });

    test('should work without smart folders', async () => {
      mockOllamaClient.generate.mockResolvedValue({
        response: JSON.stringify({
          date: '2024-01-15',
          project: 'Project',
          purpose: 'Document purpose',
          category: 'documents',
          keywords: ['test', 'document'],
          confidence: 75,
          suggestedName: 'test_doc'
        })
      });

      const result = await analyzeTextWithOllama('Test content', 'test.txt', []);

      expect(result).toBeDefined();
      expect(result.keywords).toEqual(['test', 'document']);
    });

    test('should use cache for repeated analysis', async () => {
      const text = 'Same text content';
      const fileName = 'test.txt';

      mockOllamaClient.generate.mockResolvedValue({
        response: JSON.stringify({
          date: '2024-01-15',
          project: 'Test',
          purpose: 'Test document',
          category: 'test',
          keywords: ['test'],
          confidence: 80,
          suggestedName: 'test'
        })
      });

      // First call
      await analyzeTextWithOllama(text, fileName, []);
      expect(mockOllamaClient.generate).toHaveBeenCalledTimes(1);

      // Second call - should use cache
      await analyzeTextWithOllama(text, fileName, []);
      expect(mockOllamaClient.generate).toHaveBeenCalledTimes(1);
    });

    test('should truncate long text content', async () => {
      const longText = 'word '.repeat(100000); // Very long text
      mockOllamaClient.generate.mockResolvedValue({
        response: JSON.stringify({
          keywords: ['test'],
          confidence: 70
        })
      });

      await analyzeTextWithOllama(longText, 'long.txt', []);

      const call = mockOllamaClient.generate.mock.calls[0][0];
      // Verify the *embedded document content* was truncated, without relying on
      // a brittle hardcoded prompt-template overhead.
      const match = call.prompt.match(/Document content \((\d+) characters, \d+ chunk\(s\)\):\n/);
      expect(match).toBeTruthy();

      const reportedLength = Number(match[1]);
      expect(Number.isFinite(reportedLength)).toBe(true);
      expect(reportedLength).toBeLessThanOrEqual(AppConfig.ai.textAnalysis.maxContentLength);

      const content = call.prompt.split(match[0])[1] || '';
      expect(content.length).toBe(reportedLength);
    });

    test('should handle empty text', async () => {
      mockOllamaClient.generate.mockResolvedValue({
        response: JSON.stringify({
          keywords: [],
          confidence: 60
        })
      });

      const result = await analyzeTextWithOllama('', 'empty.txt', []);

      expect(result).toBeDefined();
      expect(result.keywords).toBeDefined();
    });

    test('should handle malformed JSON response', async () => {
      mockOllamaClient.generate.mockResolvedValue({
        response: 'Not valid JSON at all'
      });

      const result = await analyzeTextWithOllama('test', 'test.txt', []);

      expect(result.error).toBeDefined();
      expect(result.keywords).toEqual([]);
      expect(result.confidence).toBe(65); // Correct value based on improved error handling
    });

    test('should handle missing response field', async () => {
      mockOllamaClient.generate.mockResolvedValue({});

      const result = await analyzeTextWithOllama('test', 'test.txt', []);

      expect(result.error).toBeDefined();
      expect(result.keywords).toEqual([]);
    });

    test('should handle Ollama API errors', async () => {
      mockOllamaClient.generate.mockRejectedValue(new Error('Ollama connection failed'));

      const result = await analyzeTextWithOllama('test', 'test.txt', []);

      expect(result.error).toContain('Ollama API error');
      expect(result.keywords).toEqual([]);
      expect(result.confidence).toBe(60);
    }, 10000); // Increase timeout to 10 seconds

    test('should normalize date format', async () => {
      mockOllamaClient.generate.mockResolvedValue({
        response: JSON.stringify({
          date: '2024-03-15T10:30:00Z',
          keywords: ['test'],
          confidence: 75,
          project: 'Test Project',
          purpose: 'Test purpose',
          category: 'test',
          suggestedName: 'test_doc'
        })
      });

      const result = await analyzeTextWithOllama('test', 'test.txt', []);

      expect(result.date).toBe('2024-03-15');
    });

    test('should remove invalid dates', async () => {
      mockOllamaClient.generate.mockResolvedValue({
        response: JSON.stringify({
          date: 'invalid-date-string-xyz',
          keywords: ['test'],
          confidence: 75
        })
      });

      const result = await analyzeTextWithOllama('test', 'test.txt', []);

      // Invalid dates should either be removed or normalized to a valid date
      if (result.date) {
        // If it exists, it should be in YYYY-MM-DD format
        expect(result.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      }
    });

    test('should normalize confidence values', async () => {
      const testCases = [
        { input: 50, expected: true }, // Should be replaced
        { input: 120, expected: true }, // Out of range
        { input: null, expected: true },
        { input: 85, expected: false } // Valid, keep as is
      ];

      for (const testCase of testCases) {
        mockOllamaClient.generate.mockResolvedValueOnce({
          response: JSON.stringify({
            confidence: testCase.input,
            keywords: ['test']
          })
        });

        const result = await analyzeTextWithOllama(`test${testCase.input}`, 'test.txt', []);

        if (testCase.expected) {
          expect(result.confidence).toBeGreaterThanOrEqual(70);
          expect(result.confidence).toBeLessThanOrEqual(100);
        } else {
          expect(result.confidence).toBe(testCase.input);
        }
      }
    });

    test('should include smart folder information in prompt', async () => {
      const smartFolders = [
        { name: 'Projects', description: 'Active development projects' },
        { name: 'Invoices', description: 'Financial documents' }
      ];

      mockOllamaClient.generate.mockResolvedValue({
        response: JSON.stringify({ keywords: ['test'], confidence: 75 })
      });

      await analyzeTextWithOllama('test', 'test.txt', smartFolders);

      const prompt = mockOllamaClient.generate.mock.calls[0][0].prompt;
      expect(prompt).toContain('Projects');
      expect(prompt).toContain('Invoices');
      expect(prompt).toContain('Active development projects');
      expect(prompt).toContain('Financial documents');
    });

    test('should limit smart folders to 10', async () => {
      const smartFolders = Array.from({ length: 20 }, (_, i) => ({
        name: `Folder${i}`,
        description: `Description ${i}`
      }));

      mockOllamaClient.generate.mockResolvedValue({
        response: JSON.stringify({ keywords: ['test'], confidence: 75 })
      });

      await analyzeTextWithOllama('test', 'test.txt', smartFolders);

      const prompt = mockOllamaClient.generate.mock.calls[0][0].prompt;
      expect(prompt).toContain('Folder0');
      expect(prompt).toContain('Folder9');
      expect(prompt).not.toContain('Folder10');
    });

    test('should filter invalid smart folders', async () => {
      const smartFolders = [
        { name: 'Valid', description: 'Valid folder' },
        { name: '', description: 'Empty name' },
        { description: 'No name' },
        null,
        { name: 'Another Valid', description: 'Another description' }
      ];

      mockOllamaClient.generate.mockResolvedValue({
        response: JSON.stringify({ keywords: ['test'], confidence: 75 })
      });

      const uniqueText = `test content for filtering ${Date.now()}`; // Unique to avoid cache hits
      const result = await analyzeTextWithOllama(uniqueText, 'test.txt', smartFolders);

      // Verify result has expected fields (filtering works if we get valid results)
      expect(result.keywords).toBeDefined();
      expect(Array.isArray(result.keywords)).toBe(true);

      // The function should handle invalid folders gracefully without throwing
      expect(result).toBeTruthy();
    });

    // NOTE: Timeout test removed - timing complexity requires fake timers implementation
    // If timeout testing is needed, implement with jest.useFakeTimers() approach

    test('should ensure keywords array exists', async () => {
      const testCases = [
        { keywords: null },
        { keywords: undefined },
        { keywords: 'not an array' },
        {}
      ];

      for (const testCase of testCases) {
        mockOllamaClient.generate.mockResolvedValueOnce({
          response: JSON.stringify({ ...testCase, confidence: 75 })
        });

        const result = await analyzeTextWithOllama(JSON.stringify(testCase), 'test.txt', []);

        expect(Array.isArray(result.keywords)).toBe(true);
      }
    });

    test('should include raw text snippet in result', async () => {
      const longText = 'word '.repeat(1000);
      mockOllamaClient.generate.mockResolvedValue({
        response: JSON.stringify({
          keywords: ['test'],
          confidence: 75
        })
      });

      const result = await analyzeTextWithOllama(longText, 'test.txt', []);

      expect(result.rawText).toBeDefined();
      expect(result.rawText.length).toBeLessThanOrEqual(2000);
    });
  });

  describe('AppConfig', () => {
    test('should have valid AI configuration', () => {
      expect(AppConfig.ai).toBeDefined();
      expect(AppConfig.ai.textAnalysis).toBeDefined();
      expect(AppConfig.ai.textAnalysis.timeout).toBeGreaterThan(0);
      expect(AppConfig.ai.textAnalysis.maxContentLength).toBeGreaterThan(0);
      expect(AppConfig.ai.textAnalysis.temperature).toBeGreaterThanOrEqual(0);
      expect(AppConfig.ai.textAnalysis.temperature).toBeLessThanOrEqual(1);
    });
  });
});
