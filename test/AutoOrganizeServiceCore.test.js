/**
 * Tests for AutoOrganizeServiceCore
 * Tests the core auto-organize service functionality
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

// Mock performanceConstants
jest.mock('../src/shared/performanceConstants', () => ({
  BATCH: {
    AUTO_ORGANIZE_BATCH_SIZE: 10
  },
  THRESHOLDS: {
    CONFIDENCE_HIGH: 0.8,
    MIN_SIMILARITY_SCORE: 0.5,
    CONFIDENCE_LOW: 0.3
  }
}));

// Mock fileTypeUtils
jest.mock('../src/main/services/autoOrganize/fileTypeUtils', () => ({
  getFileTypeCategory: jest.fn((ext) => {
    const categories = {
      '.pdf': 'documents',
      '.jpg': 'images',
      '.mp3': 'audio'
    };
    return categories[ext] || 'other';
  }),
  sanitizeFile: jest.fn((file) => ({
    name: file.name,
    path: file.path,
    extension: file.extension
  }))
}));

// Mock folderOperations
jest.mock('../src/main/services/autoOrganize/folderOperations', () => ({
  getFallbackDestination: jest.fn((file, folders, defaultLoc) => ({
    folder: defaultLoc,
    path: `/mock/${defaultLoc}`
  })),
  buildDestinationPath: jest.fn((file, suggestion, defaultLoc, preserveNames) => ({
    folder: suggestion?.folder || defaultLoc,
    path: suggestion?.path || `/mock/${defaultLoc}/${file.name}`,
    newName: preserveNames ? file.name : suggestion?.newName || file.name
  }))
}));

// Mock batchProcessor
jest.mock('../src/main/services/autoOrganize/batchProcessor', () => ({
  processBatchResults: jest.fn().mockResolvedValue(undefined),
  batchOrganize: jest.fn().mockResolvedValue({
    organized: [],
    needsReview: [],
    failed: []
  })
}));

// Mock fileProcessor
jest.mock('../src/main/services/autoOrganize/fileProcessor', () => ({
  processFilesWithoutAnalysis: jest.fn().mockResolvedValue(undefined),
  processFilesIndividually: jest.fn().mockResolvedValue(undefined),
  processNewFile: jest.fn().mockResolvedValue({
    success: true,
    destination: '/mock/destination'
  })
}));

describe('AutoOrganizeServiceCore', () => {
  let AutoOrganizeServiceCore;
  let service;
  let mockSuggestionService;
  let mockSettingsService;
  let mockFolderMatchingService;
  let mockUndoRedoService;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();

    // Create mock services
    mockSuggestionService = {
      getBatchSuggestions: jest.fn().mockResolvedValue({
        success: true,
        groups: [
          {
            folder: 'Documents',
            files: [{ name: 'test.pdf', suggestion: { folder: 'Documents' } }]
          }
        ]
      }),
      getSuggestionsForFile: jest.fn().mockResolvedValue({
        success: true,
        primary: { folder: 'Documents', confidence: 0.9 }
      }),
      userPatterns: new Map(),
      feedbackHistory: [],
      folderUsageStats: new Map()
    };

    mockSettingsService = {
      get: jest.fn().mockReturnValue({})
    };

    mockFolderMatchingService = {
      matchFileToFolders: jest.fn().mockResolvedValue([])
    };

    mockUndoRedoService = {
      recordOperation: jest.fn()
    };

    AutoOrganizeServiceCore = require('../src/main/services/autoOrganize/AutoOrganizeServiceCore');
    service = new AutoOrganizeServiceCore({
      suggestionService: mockSuggestionService,
      settingsService: mockSettingsService,
      folderMatchingService: mockFolderMatchingService,
      undoRedoService: mockUndoRedoService
    });
  });

  describe('constructor', () => {
    test('stores dependency references', () => {
      expect(service.suggestionService).toBe(mockSuggestionService);
      expect(service.settings).toBe(mockSettingsService);
      expect(service.folderMatcher).toBe(mockFolderMatchingService);
      expect(service.undoRedo).toBe(mockUndoRedoService);
    });

    test('initializes thresholds from constants', () => {
      expect(service.thresholds.autoApprove).toBe(0.8);
      expect(service.thresholds.requireReview).toBe(0.5);
      expect(service.thresholds.reject).toBe(0.3);
    });
  });

  describe('_sanitizeFile', () => {
    test('sanitizes file object', () => {
      const file = {
        name: 'test.pdf',
        path: '/path/to/test.pdf',
        extension: '.pdf',
        extraField: 'should be removed'
      };

      const result = service._sanitizeFile(file);

      expect(result.name).toBe('test.pdf');
      expect(result.path).toBe('/path/to/test.pdf');
      expect(result.extension).toBe('.pdf');
    });
  });

  describe('organizeFiles', () => {
    const mockFiles = [
      {
        name: 'doc1.pdf',
        path: '/test/doc1.pdf',
        extension: '.pdf',
        analysis: { category: 'documents' }
      },
      {
        name: 'doc2.pdf',
        path: '/test/doc2.pdf',
        extension: '.pdf',
        analysis: { category: 'documents' }
      }
    ];

    const mockSmartFolders = [
      { name: 'Documents', path: '/folders/Documents', keywords: ['document'] }
    ];

    test('returns results structure', async () => {
      const results = await service.organizeFiles(mockFiles, mockSmartFolders);

      expect(results).toHaveProperty('organized');
      expect(results).toHaveProperty('needsReview');
      expect(results).toHaveProperty('failed');
      expect(results).toHaveProperty('operations');
    });

    test('separates files with and without analysis', async () => {
      const filesWithMixed = [
        {
          name: 'with.pdf',
          path: '/test/with.pdf',
          extension: '.pdf',
          analysis: { category: 'docs' }
        },
        { name: 'without.pdf', path: '/test/without.pdf', extension: '.pdf' }
      ];

      const {
        processFilesWithoutAnalysis
      } = require('../src/main/services/autoOrganize/fileProcessor');

      await service.organizeFiles(filesWithMixed, mockSmartFolders);

      expect(processFilesWithoutAnalysis).toHaveBeenCalled();
    });

    test('processes files in batches', async () => {
      // Create more files than batch size
      const manyFiles = Array.from({ length: 25 }, (_, i) => ({
        name: `file${i}.pdf`,
        path: `/test/file${i}.pdf`,
        extension: '.pdf',
        analysis: { category: 'documents' }
      }));

      await service.organizeFiles(manyFiles, mockSmartFolders, { batchSize: 10 });

      // Should have called getBatchSuggestions multiple times for batches
      expect(mockSuggestionService.getBatchSuggestions).toHaveBeenCalled();
    });

    test('falls back to individual processing on batch failure', async () => {
      mockSuggestionService.getBatchSuggestions.mockResolvedValueOnce({
        success: false,
        groups: []
      });

      const {
        processFilesIndividually
      } = require('../src/main/services/autoOrganize/fileProcessor');

      await service.organizeFiles(mockFiles, mockSmartFolders);

      expect(processFilesIndividually).toHaveBeenCalled();
    });

    test('handles batch processing errors', async () => {
      mockSuggestionService.getBatchSuggestions.mockRejectedValueOnce(new Error('Batch failed'));

      const {
        processFilesIndividually
      } = require('../src/main/services/autoOrganize/fileProcessor');

      await service.organizeFiles(mockFiles, mockSmartFolders);

      expect(processFilesIndividually).toHaveBeenCalled();
    });

    test('respects custom options', async () => {
      await service.organizeFiles(mockFiles, mockSmartFolders, {
        confidenceThreshold: 0.9,
        defaultLocation: 'Inbox',
        preserveNames: true,
        batchSize: 5
      });

      expect(mockSuggestionService.getBatchSuggestions).toHaveBeenCalled();
    });
  });

  describe('batchOrganize', () => {
    test('delegates to batchOrganize helper', async () => {
      const { batchOrganize } = require('../src/main/services/autoOrganize/batchProcessor');
      batchOrganize.mockResolvedValueOnce({
        organized: [{ name: 'file.pdf' }],
        needsReview: [],
        failed: []
      });

      const files = [{ name: 'file.pdf', path: '/test/file.pdf' }];
      const folders = [{ name: 'Documents', path: '/docs' }];

      const result = await service.batchOrganize(files, folders);

      expect(batchOrganize).toHaveBeenCalled();
      expect(result.organized).toHaveLength(1);
    });
  });

  describe('getFallbackDestination', () => {
    test('returns fallback for unmatched files', () => {
      const file = { name: 'unknown.xyz', extension: '.xyz' };
      const folders = [{ name: 'Other', path: '/other' }];

      const result = service.getFallbackDestination(file, folders, 'Uncategorized');

      expect(result.folder).toBe('Uncategorized');
    });
  });

  describe('buildDestinationPath', () => {
    test('builds destination path from suggestion', () => {
      const file = { name: 'test.pdf' };
      const suggestion = { folder: 'Documents', path: '/docs' };

      const result = service.buildDestinationPath(file, suggestion, 'Default', false);

      expect(result.folder).toBe('Documents');
    });

    test('uses default location when no suggestion', () => {
      const file = { name: 'test.pdf' };

      const result = service.buildDestinationPath(file, null, 'Inbox', false);

      expect(result.folder).toBe('Inbox');
    });
  });

  describe('getFileTypeCategory', () => {
    test('returns category for known extensions', () => {
      expect(service.getFileTypeCategory('.pdf')).toBe('documents');
      expect(service.getFileTypeCategory('.jpg')).toBe('images');
      expect(service.getFileTypeCategory('.mp3')).toBe('audio');
    });

    test('returns other for unknown extensions', () => {
      expect(service.getFileTypeCategory('.xyz')).toBe('other');
    });
  });

  describe('processNewFile', () => {
    test('processes new file for auto-organization', async () => {
      const { processNewFile } = require('../src/main/services/autoOrganize/fileProcessor');
      processNewFile.mockResolvedValueOnce({
        success: true,
        destination: '/docs/file.pdf'
      });

      const result = await service.processNewFile('/downloads/file.pdf', [
        { name: 'Documents', path: '/docs' }
      ]);

      expect(processNewFile).toHaveBeenCalled();
      expect(result.success).toBe(true);
    });
  });

  describe('getStatistics', () => {
    test('returns organization statistics', async () => {
      mockSuggestionService.userPatterns = new Map([['pattern1', {}]]);
      mockSuggestionService.feedbackHistory = [{ accepted: true }];
      mockSuggestionService.folderUsageStats = new Map([['Documents', 10]]);

      const stats = await service.getStatistics();

      expect(stats.userPatterns).toBe(1);
      expect(stats.feedbackHistory).toBe(1);
      expect(stats.folderUsageStats).toHaveLength(1);
      expect(stats.thresholds).toEqual(service.thresholds);
    });
  });

  describe('updateThresholds', () => {
    test('updates thresholds', () => {
      service.updateThresholds({ autoApprove: 0.95 });

      expect(service.thresholds.autoApprove).toBe(0.95);
      // Other thresholds should remain unchanged
      expect(service.thresholds.requireReview).toBe(0.5);
    });

    test('merges with existing thresholds', () => {
      service.updateThresholds({
        autoApprove: 0.9,
        requireReview: 0.6
      });

      expect(service.thresholds.autoApprove).toBe(0.9);
      expect(service.thresholds.requireReview).toBe(0.6);
      expect(service.thresholds.reject).toBe(0.3);
    });
  });
});
