/**
 * Tests for Suggestions IPC Handlers
 * Tests AI-powered organization suggestion handlers
 */

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

// Mock electron
jest.mock('electron', () => ({
  app: {
    getPath: jest.fn().mockReturnValue('/mock/userData')
  },
  ipcMain: {
    handle: jest.fn()
  }
}));

// Mock IPC wrappers
jest.mock('../src/main/ipc/ipcWrappers', () => ({
  createHandler: (options) => {
    return async (event, ...args) => {
      const { getService, handler, fallbackResponse } = options;
      const service = getService ? getService() : null;
      if (!service) {
        return fallbackResponse;
      }
      try {
        // Some handlers take (event, service) and some take (event, args, service)
        // Detect based on handler.length or just pass both formats
        if (args.length > 0 && args[0] !== undefined) {
          return await handler(event, args[0], service);
        } else {
          // For handlers like GET_STRATEGIES that only expect (event, service)
          return await handler(event, service);
        }
      } catch (error) {
        return { success: false, error: error.message };
      }
    };
  },
  createErrorResponse: (error, extras = {}) => ({
    success: false,
    error: error.message || error,
    ...extras
  }),
  safeHandle: (ipcMain, channel, handler) => {
    ipcMain.handle(channel, handler);
  }
}));

// Mock validation schemas
jest.mock('../src/main/ipc/validationSchemas', () => ({
  schemas: {
    fileSuggestion: null,
    batchSuggestion: null,
    feedback: null,
    strategyApplication: null
  }
}));

// Mock OrganizationSuggestionService
const mockSuggestionService = {
  getSuggestionsForFile: jest.fn(),
  getBatchSuggestions: jest.fn(),
  recordFeedback: jest.fn(),
  strategies: {
    'by-type': {
      name: 'By Type',
      description: 'Organize by file type'
    },
    'by-date': {
      name: 'By Date',
      description: 'Organize by date'
    }
  },
  mapFileToStrategy: jest.fn(),
  userPatterns: new Map(),
  feedbackHistory: [],
  analyzeFolderStructure: jest.fn(),
  suggestNewSmartFolder: jest.fn()
};

jest.mock('../src/main/services/organization', () => {
  return jest.fn().mockImplementation(() => mockSuggestionService);
});

const { ipcMain } = require('electron');
const { registerSuggestionsIpc } = require('../src/main/ipc/suggestions');

describe('Suggestions IPC Handlers', () => {
  let handlers;
  let mockChromaDbService;
  let mockFolderMatchingService;
  let mockSettingsService;
  let mockGetCustomFolders;

  const IPC_CHANNELS = {
    SUGGESTIONS: {
      GET_FILE_SUGGESTIONS: 'get-file-suggestions',
      GET_BATCH_SUGGESTIONS: 'get-batch-suggestions',
      RECORD_FEEDBACK: 'record-feedback',
      GET_STRATEGIES: 'get-strategies',
      APPLY_STRATEGY: 'apply-strategy',
      GET_USER_PATTERNS: 'get-user-patterns',
      CLEAR_PATTERNS: 'clear-patterns',
      ANALYZE_FOLDER_STRUCTURE: 'analyze-folder-structure',
      SUGGEST_NEW_FOLDER: 'suggest-new-folder'
    }
  };

  beforeEach(() => {
    jest.clearAllMocks();
    handlers = {};

    // Capture registered handlers
    ipcMain.handle.mockImplementation((channel, handler) => {
      handlers[channel] = handler;
    });

    mockChromaDbService = {};
    mockFolderMatchingService = {};
    mockSettingsService = {};
    mockGetCustomFolders = jest.fn().mockReturnValue([
      { name: 'Documents', path: '/docs' },
      { name: 'Photos', path: '/photos' }
    ]);

    // Reset mock implementations
    mockSuggestionService.getSuggestionsForFile.mockReset();
    mockSuggestionService.getBatchSuggestions.mockReset();
    mockSuggestionService.recordFeedback.mockReset();
    mockSuggestionService.mapFileToStrategy.mockReset();
    mockSuggestionService.analyzeFolderStructure.mockReset();
    mockSuggestionService.suggestNewSmartFolder.mockReset();
    mockSuggestionService.userPatterns.clear();
    mockSuggestionService.feedbackHistory = [];

    // Register handlers
    registerSuggestionsIpc({
      ipcMain,
      IPC_CHANNELS,
      chromaDbService: mockChromaDbService,
      folderMatchingService: mockFolderMatchingService,
      settingsService: mockSettingsService,
      getCustomFolders: mockGetCustomFolders
    });
  });

  describe('GET_FILE_SUGGESTIONS handler', () => {
    test('returns suggestions for a file', async () => {
      const file = { name: 'test.pdf', path: '/path/test.pdf' };
      const suggestions = {
        primary: { folder: 'Documents', confidence: 0.85 },
        alternatives: [{ folder: 'Archive', confidence: 0.6 }],
        confidence: 0.85
      };
      mockSuggestionService.getSuggestionsForFile.mockResolvedValue(suggestions);

      const handler = handlers[IPC_CHANNELS.SUGGESTIONS.GET_FILE_SUGGESTIONS];
      const result = await handler({}, { file, options: {} });

      expect(result.primary.folder).toBe('Documents');
      expect(result.confidence).toBe(0.85);
      expect(mockGetCustomFolders).toHaveBeenCalled();
    });

    test('handles error in getSuggestionsForFile', async () => {
      const file = { name: 'test.pdf' };
      mockSuggestionService.getSuggestionsForFile.mockRejectedValue(new Error('Analysis failed'));

      const handler = handlers[IPC_CHANNELS.SUGGESTIONS.GET_FILE_SUGGESTIONS];
      const result = await handler({}, { file });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Analysis failed');
    });
  });

  describe('GET_BATCH_SUGGESTIONS handler', () => {
    test('returns batch suggestions for multiple files', async () => {
      const files = [{ name: 'doc1.pdf' }, { name: 'doc2.pdf' }];
      const batchResult = {
        groups: [{ folder: 'Documents', files: files }],
        recommendations: ['Consider using Smart Folders']
      };
      mockSuggestionService.getBatchSuggestions.mockResolvedValue(batchResult);

      const handler = handlers[IPC_CHANNELS.SUGGESTIONS.GET_BATCH_SUGGESTIONS];
      const result = await handler({}, { files });

      expect(result.groups).toHaveLength(1);
      expect(result.groups[0].folder).toBe('Documents');
      expect(mockGetCustomFolders).toHaveBeenCalled();
    });

    test('handles error in getBatchSuggestions', async () => {
      const files = [{ name: 'test.pdf' }];
      mockSuggestionService.getBatchSuggestions.mockRejectedValue(
        new Error('Batch analysis failed')
      );

      const handler = handlers[IPC_CHANNELS.SUGGESTIONS.GET_BATCH_SUGGESTIONS];
      const result = await handler({}, { files });

      expect(result.success).toBe(false);
      expect(result.groups).toEqual([]);
    });
  });

  describe('RECORD_FEEDBACK handler', () => {
    test('records user feedback', async () => {
      const file = { name: 'test.pdf' };
      const suggestion = { folder: 'Documents' };
      const accepted = true;

      const handler = handlers[IPC_CHANNELS.SUGGESTIONS.RECORD_FEEDBACK];
      const result = await handler({}, { file, suggestion, accepted });

      expect(result.success).toBe(true);
      expect(mockSuggestionService.recordFeedback).toHaveBeenCalledWith(file, suggestion, accepted);
    });

    test('handles error in recordFeedback', async () => {
      mockSuggestionService.recordFeedback.mockImplementation(() => {
        throw new Error('Feedback failed');
      });

      const handler = handlers[IPC_CHANNELS.SUGGESTIONS.RECORD_FEEDBACK];
      const result = await handler(
        {},
        {
          file: { name: 'test.pdf' },
          suggestion: { folder: 'Docs' },
          accepted: false
        }
      );

      expect(result.success).toBe(false);
    });
  });

  describe('GET_STRATEGIES handler', () => {
    test('returns available organization strategies', async () => {
      const handler = handlers[IPC_CHANNELS.SUGGESTIONS.GET_STRATEGIES];
      const result = await handler({});

      expect(result.success).toBe(true);
      expect(result.strategies).toHaveLength(2);
      expect(result.strategies.some((s) => s.id === 'by-type')).toBe(true);
      expect(result.strategies.some((s) => s.id === 'by-date')).toBe(true);
    });
  });

  describe('APPLY_STRATEGY handler', () => {
    test('applies strategy to files', async () => {
      const files = [
        { name: 'image.jpg', extension: '.jpg' },
        { name: 'doc.pdf', extension: '.pdf' }
      ];
      mockSuggestionService.mapFileToStrategy
        .mockReturnValueOnce('Photos')
        .mockReturnValueOnce('Documents');

      const handler = handlers[IPC_CHANNELS.SUGGESTIONS.APPLY_STRATEGY];
      const result = await handler({}, { files, strategyId: 'by-type' });

      expect(result.success).toBe(true);
      expect(result.results).toHaveLength(2);
      expect(result.results[0].folder).toBe('Photos');
      expect(result.results[1].folder).toBe('Documents');
    });

    test('returns error for unknown strategy', async () => {
      const handler = handlers[IPC_CHANNELS.SUGGESTIONS.APPLY_STRATEGY];
      const result = await handler({}, { files: [], strategyId: 'unknown-strategy' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Unknown strategy');
    });
  });

  describe('GET_USER_PATTERNS handler', () => {
    test('returns user patterns', async () => {
      mockSuggestionService.userPatterns.set('*.pdf', {
        targetFolder: 'Documents',
        count: 10
      });
      mockSuggestionService.userPatterns.set('*.jpg', {
        targetFolder: 'Photos',
        count: 5
      });

      const handler = handlers[IPC_CHANNELS.SUGGESTIONS.GET_USER_PATTERNS];
      const result = await handler({});

      expect(result.success).toBe(true);
      expect(result.patterns).toHaveLength(2);
    });

    test('returns empty patterns array when none exist', async () => {
      mockSuggestionService.userPatterns.clear();

      const handler = handlers[IPC_CHANNELS.SUGGESTIONS.GET_USER_PATTERNS];
      const result = await handler({});

      expect(result.success).toBe(true);
      expect(result.patterns).toHaveLength(0);
    });
  });

  describe('CLEAR_PATTERNS handler', () => {
    test('clears user patterns and feedback history', async () => {
      mockSuggestionService.userPatterns.set('*.pdf', { count: 5 });
      mockSuggestionService.feedbackHistory = [{ file: 'test.pdf' }];

      const handler = handlers[IPC_CHANNELS.SUGGESTIONS.CLEAR_PATTERNS];
      const result = await handler({});

      expect(result.success).toBe(true);
      expect(mockSuggestionService.userPatterns.size).toBe(0);
      expect(mockSuggestionService.feedbackHistory).toHaveLength(0);
    });
  });

  describe('ANALYZE_FOLDER_STRUCTURE handler', () => {
    test('analyzes folder structure and returns improvements', async () => {
      const improvements = [
        { suggestion: 'Create a Photos folder', priority: 'high' },
        { suggestion: 'Merge similar folders', priority: 'medium' }
      ];
      mockSuggestionService.analyzeFolderStructure.mockResolvedValue(improvements);

      const handler = handlers[IPC_CHANNELS.SUGGESTIONS.ANALYZE_FOLDER_STRUCTURE];
      const result = await handler({}, { files: [] });

      expect(result.success).toBe(true);
      expect(result.improvements).toHaveLength(2);
      expect(result.smartFolders).toHaveLength(2);
    });

    test('handles error in analyzeFolderStructure', async () => {
      mockSuggestionService.analyzeFolderStructure.mockRejectedValue(new Error('Analysis error'));

      const handler = handlers[IPC_CHANNELS.SUGGESTIONS.ANALYZE_FOLDER_STRUCTURE];
      const result = await handler({}, { files: [] });

      expect(result.success).toBe(false);
      expect(result.improvements).toEqual([]);
    });
  });

  describe('SUGGEST_NEW_FOLDER handler', () => {
    test('suggests a new smart folder for a file', async () => {
      const file = { name: 'vacation-2024.jpg', category: 'Photos' };
      const suggestion = {
        name: 'Vacation Photos',
        patterns: ['vacation*.jpg', 'trip*.jpg'],
        description: 'Photos from trips and vacations'
      };
      mockSuggestionService.suggestNewSmartFolder.mockResolvedValue(suggestion);

      const handler = handlers[IPC_CHANNELS.SUGGESTIONS.SUGGEST_NEW_FOLDER];
      const result = await handler({}, { file });

      expect(result.success).toBe(true);
      expect(result.suggestion.name).toBe('Vacation Photos');
    });

    test('handles error in suggestNewSmartFolder', async () => {
      mockSuggestionService.suggestNewSmartFolder.mockRejectedValue(new Error('Suggestion failed'));

      const handler = handlers[IPC_CHANNELS.SUGGESTIONS.SUGGEST_NEW_FOLDER];
      const result = await handler({}, { file: { name: 'test.pdf' } });

      expect(result.success).toBe(false);
    });
  });

  describe('Service initialization', () => {
    test('handles service initialization failure gracefully', async () => {
      // Reset handlers and mock service to throw
      handlers = {};
      ipcMain.handle.mockImplementation((channel, handler) => {
        handlers[channel] = handler;
      });

      const OrganizationSuggestionService = require('../src/main/services/organization');
      OrganizationSuggestionService.mockImplementation(() => {
        throw new Error('ChromaDB not available');
      });

      // Re-register with failing service
      registerSuggestionsIpc({
        ipcMain,
        IPC_CHANNELS,
        chromaDbService: null,
        folderMatchingService: null,
        settingsService: null,
        getCustomFolders: mockGetCustomFolders
      });

      // Handlers should return fallback responses
      const handler = handlers[IPC_CHANNELS.SUGGESTIONS.GET_FILE_SUGGESTIONS];
      const result = await handler({}, { file: { name: 'test.pdf' } });

      expect(result.success).toBe(false);
      expect(result.error).toContain('unavailable');
    });
  });
});
