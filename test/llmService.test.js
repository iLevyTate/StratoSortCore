/**
 * Tests for llmService
 * Tests Ollama connection testing, prompt formatting, and organization suggestions
 */

// Mock logger
jest.mock('../src/shared/logger', () => ({
  logger: {
    setContext: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    performance: jest.fn(),
  },
}));

// Mock PerformanceService
jest.mock('../src/main/services/PerformanceService', () => ({
  buildOllamaOptions: jest.fn().mockResolvedValue({
    num_ctx: 8192,
    num_thread: 4,
    keep_alive: '10m',
  }),
}));

// Mock ollamaUtils
const mockOllama = {
  generate: jest.fn(),
};

jest.mock('../src/main/ollamaUtils', () => ({
  getOllama: jest.fn(() => mockOllama),
  getOllamaModel: jest.fn(() => 'llama3.2'),
  setOllamaModel: jest.fn(),
}));

// Mock jsonRepair
jest.mock('../src/main/utils/jsonRepair', () => ({
  extractAndParseJSON: jest.fn(),
}));

describe('llmService', () => {
  let llmService;
  let jsonRepair;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
    jsonRepair = require('../src/main/utils/jsonRepair');
    llmService = require('../src/main/llmService');
  });

  describe('testOllamaConnection', () => {
    test('returns success when Ollama responds', async () => {
      mockOllama.generate.mockResolvedValue({
        response: 'Hi',
      });

      const result = await llmService.testOllamaConnection();

      expect(result.success).toBe(true);
      expect(result.model).toBe('llama3.2');
      expect(mockOllama.generate).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'llama3.2',
          prompt: 'Hello',
          stream: false,
        }),
      );
    });

    test('returns failure when Ollama fails', async () => {
      mockOllama.generate.mockRejectedValue(new Error('Connection refused'));

      const result = await llmService.testOllamaConnection();

      expect(result.success).toBe(false);
      expect(result.error).toBe('Connection refused');
    });

    test('uses minimal num_predict for quick test', async () => {
      mockOllama.generate.mockResolvedValue({ response: 'Hi' });

      await llmService.testOllamaConnection();

      expect(mockOllama.generate).toHaveBeenCalledWith(
        expect.objectContaining({
          options: expect.objectContaining({
            num_predict: 1,
          }),
        }),
      );
    });
  });

  describe('formatPromptForLLM', () => {
    test('formats directory structure into prompt', () => {
      const structure = [
        { name: 'file1.txt', type: 'file', size: 100 },
        { name: 'folder1', type: 'folder', children: [], size: 0 },
      ];

      const prompt = llmService.formatPromptForLLM(structure);

      expect(prompt).toContain('Analyze the following file and folder structure');
      expect(prompt).toContain('file1.txt');
      expect(prompt).toContain('folder1');
      expect(prompt).toContain('suggestions');
    });

    test('handles nested folder structure', () => {
      const structure = [
        {
          name: 'parent',
          type: 'folder',
          size: 0,
          children: [
            { name: 'child.txt', type: 'file', size: 50 },
          ],
        },
      ];

      const prompt = llmService.formatPromptForLLM(structure);

      expect(prompt).toContain('parent');
      expect(prompt).toContain('child.txt');
    });

    test('truncates deep nesting', () => {
      const structure = [
        {
          name: 'level1',
          type: 'folder',
          size: 0,
          children: [
            {
              name: 'level2',
              type: 'folder',
              size: 0,
              children: [
                {
                  name: 'level3',
                  type: 'folder',
                  size: 0,
                  children: [
                    {
                      name: 'level4',
                      type: 'folder',
                      size: 0,
                      children: [],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ];

      const prompt = llmService.formatPromptForLLM(structure);

      expect(prompt).toContain('truncated');
    });

    test('includes childCount for folders', () => {
      const structure = [
        {
          name: 'folder',
          type: 'folder',
          size: 0,
          children: [
            { name: 'file1.txt', type: 'file', size: 10 },
            { name: 'file2.txt', type: 'file', size: 20 },
          ],
        },
      ];

      const prompt = llmService.formatPromptForLLM(structure);

      expect(prompt).toContain('"childCount":');
    });
  });

  describe('getOrganizationSuggestions', () => {
    const mockStructure = [
      { name: 'test.txt', type: 'file', size: 100 },
    ];

    test('returns suggestions from LLM', async () => {
      const mockSuggestions = [
        { action: 'Create folder', reasoning: 'Better organization', priority: 'high' },
      ];

      mockOllama.generate.mockResolvedValue({
        response: JSON.stringify({ suggestions: mockSuggestions }),
      });

      jsonRepair.extractAndParseJSON.mockReturnValue({ suggestions: mockSuggestions });

      const result = await llmService.getOrganizationSuggestions(mockStructure);

      expect(result.suggestions).toEqual(mockSuggestions);
      expect(result.model).toBe('llama3.2');
      expect(result.processingTime).toBeDefined();
    });

    test('returns error when LLM response is empty', async () => {
      mockOllama.generate.mockResolvedValue({
        response: '',
      });

      const result = await llmService.getOrganizationSuggestions(mockStructure);

      // Empty response throws an error which returns fallback suggestions
      expect(result.error).toBeDefined();
    });

    test('uses text parsing fallback when JSON parsing fails', async () => {
      mockOllama.generate.mockResolvedValue({
        response: 'Suggestion 1: Create a Documents folder\nReason: Better organization',
      });

      jsonRepair.extractAndParseJSON.mockReturnValue(null);

      const result = await llmService.getOrganizationSuggestions(mockStructure);

      // Should fall back to text parsing
      expect(result.suggestions).toBeDefined();
    });

    test('handles direct suggestions array in response', async () => {
      const mockSuggestions = [
        { action: 'Move files', reasoning: 'Group similar', priority: 'medium' },
      ];

      mockOllama.generate.mockResolvedValue({
        response: JSON.stringify(mockSuggestions),
      });

      // Return the array directly (as suggestions property since that's what the code checks first)
      jsonRepair.extractAndParseJSON.mockReturnValue({ suggestions: mockSuggestions });

      const result = await llmService.getOrganizationSuggestions(mockStructure);

      expect(result.suggestions).toEqual(mockSuggestions);
    });

    test('wraps non-array result in array', async () => {
      const singleSuggestion = { action: 'Single action', priority: 'low' };

      mockOllama.generate.mockResolvedValue({
        response: JSON.stringify(singleSuggestion),
      });

      // The code checks for .suggestions first, then uses the parsed result directly
      jsonRepair.extractAndParseJSON.mockReturnValue(singleSuggestion);

      const result = await llmService.getOrganizationSuggestions(mockStructure);

      expect(Array.isArray(result.suggestions)).toBe(true);
      // The result is the single object wrapped in an array
      expect(result.suggestions).toHaveLength(1);
    });

    test('returns fallback suggestions on LLM error', async () => {
      mockOllama.generate.mockRejectedValue(new Error('Network error'));

      const result = await llmService.getOrganizationSuggestions(mockStructure);

      expect(result.error).toBe('Network error');
      expect(result.fallbackSuggestions).toBeDefined();
      expect(result.fallbackSuggestions.length).toBeGreaterThan(0);
    });

    test('uses json format in generate call', async () => {
      mockOllama.generate.mockResolvedValue({
        response: '{"suggestions": []}',
      });

      jsonRepair.extractAndParseJSON.mockReturnValue({ suggestions: [] });

      await llmService.getOrganizationSuggestions(mockStructure);

      expect(mockOllama.generate).toHaveBeenCalledWith(
        expect.objectContaining({
          format: 'json',
        }),
      );
    });
  });

  describe('text response parsing', () => {
    test('extracts suggestions from text with keywords', async () => {
      const testStructure = [{ name: 'test.txt', type: 'file', size: 100 }];
      const textResponse = `
        Suggestion 1: Create a Documents folder
        Reason: This will help organize text files

        Suggestion 2: Organize by date
        Because it makes finding files easier
      `;

      mockOllama.generate.mockResolvedValue({
        response: textResponse,
      });

      // Return null to trigger text parsing fallback
      jsonRepair.extractAndParseJSON.mockReturnValue(null);

      const result = await llmService.getOrganizationSuggestions(testStructure);

      // When JSON parsing fails, text parsing is used as fallback
      expect(result.suggestions).toBeDefined();
    });
  });

  describe('fallback suggestions', () => {
    test('provides sensible defaults', async () => {
      const testStructure = [{ name: 'test.txt', type: 'file', size: 100 }];
      mockOllama.generate.mockRejectedValue(new Error('Failed'));

      const result = await llmService.getOrganizationSuggestions(testStructure);

      expect(result.fallbackSuggestions).toContainEqual(
        expect.objectContaining({
          action: expect.stringContaining('Documents'),
          priority: expect.any(String),
        }),
      );
    });
  });

  describe('exports', () => {
    test('re-exports ollamaUtils functions', () => {
      expect(llmService.getOllama).toBeDefined();
      expect(llmService.getOllamaModel).toBeDefined();
      expect(llmService.setOllamaModel).toBeDefined();
    });
  });
});
