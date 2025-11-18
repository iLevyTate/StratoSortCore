/**
 * Tests for AutoOrganizeService
 * TIER 1 - CRITICAL for automatic file organization
 */

const AutoOrganizeService = require('../src/main/services/AutoOrganizeService');
const path = require('path');

describe('AutoOrganizeService', () => {
  let service;
  let mockSuggestionService;
  let mockSettingsService;
  let mockFolderMatchingService;
  let mockUndoRedoService;
  let mockSmartFolders;

  beforeEach(() => {
    // Mock services
    mockSuggestionService = {
      getSuggestionsForFile: jest.fn(),
      getBatchSuggestions: jest.fn(),
      recordFeedback: jest.fn(),
      userPatterns: new Map(),
      feedbackHistory: [],
      folderUsageStats: new Map([
        ['Documents', 10],
        ['Images', 5],
      ]),
    };

    mockSettingsService = {
      get: jest.fn((key) => {
        const settings = {
          autoApproveThreshold: 0.8,
          reviewThreshold: 0.5,
        };
        return settings[key];
      }),
    };

    mockFolderMatchingService = {
      matchFile: jest.fn(),
    };

    mockUndoRedoService = {
      recordAction: jest.fn(),
    };

    // Mock smart folders
    mockSmartFolders = [
      {
        id: 'folder-1',
        name: 'Documents',
        path: '/base/Documents',
        description: 'Document files',
      },
      {
        id: 'folder-2',
        name: 'Images',
        path: '/base/Images',
        description: 'Image files',
      },
      {
        id: 'folder-3',
        name: 'Code',
        path: '/base/Code',
        description: 'Source code files',
      },
    ];

    service = new AutoOrganizeService({
      suggestionService: mockSuggestionService,
      settingsService: mockSettingsService,
      folderMatchingService: mockFolderMatchingService,
      undoRedoService: mockUndoRedoService,
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    test('initializes with default thresholds', () => {
      expect(service.thresholds).toBeDefined();
      expect(service.thresholds.autoApprove).toBe(0.8);
      expect(service.thresholds.requireReview).toBe(0.5);
      expect(service.thresholds.reject).toBe(0.3);
    });

    test('stores service dependencies', () => {
      expect(service.suggestionService).toBe(mockSuggestionService);
      expect(service.settings).toBe(mockSettingsService);
      expect(service.folderMatcher).toBe(mockFolderMatchingService);
      expect(service.undoRedo).toBe(mockUndoRedoService);
    });
  });

  describe('organizeFiles', () => {
    describe('high confidence automatic organization', () => {
      test('automatically organizes files with high confidence', async () => {
        const files = [
          {
            name: 'document.pdf',
            path: '/downloads/document.pdf',
            extension: '.pdf',
            analysis: { category: 'document' },
          },
        ];

        mockSuggestionService.getSuggestionsForFile.mockResolvedValue({
          success: true,
          primary: {
            folder: 'Documents',
            path: '/base/Documents',
          },
          confidence: 0.9,
        });

        const result = await service.organizeFiles(files, mockSmartFolders);

        expect(result.organized).toHaveLength(1);
        expect(result.organized[0].method).toBe('automatic');
        expect(result.organized[0].confidence).toBe(0.9);
        expect(result.needsReview).toHaveLength(0);
        expect(result.failed).toHaveLength(0);
      });

      test('creates correct move operations for high confidence files', async () => {
        const files = [
          {
            name: 'photo.jpg',
            path: '/downloads/photo.jpg',
            extension: '.jpg',
            analysis: { category: 'image' },
          },
        ];

        mockSuggestionService.getSuggestionsForFile.mockResolvedValue({
          success: true,
          primary: {
            folder: 'Images',
            path: '/base/Images',
          },
          confidence: 0.85,
        });

        const result = await service.organizeFiles(files, mockSmartFolders);

        expect(result.operations).toHaveLength(1);
        expect(result.operations[0]).toEqual({
          type: 'move',
          source: '/downloads/photo.jpg',
          destination: expect.stringContaining('Images'),
        });
      });

      test('records positive feedback for automatic organization', async () => {
        const file = {
          name: 'document.pdf',
          path: '/downloads/document.pdf',
          analysis: { category: 'document' },
        };

        const suggestion = {
          success: true,
          primary: { folder: 'Documents', path: '/base/Documents' },
          confidence: 0.9,
        };

        mockSuggestionService.getSuggestionsForFile.mockResolvedValue(
          suggestion,
        );

        await service.organizeFiles([file], mockSmartFolders);

        expect(mockSuggestionService.recordFeedback).toHaveBeenCalledWith(
          file,
          suggestion.primary,
          true,
        );
      });
    });

    describe('medium confidence requiring review', () => {
      test('flags files with medium confidence for review', async () => {
        const files = [
          {
            name: 'ambiguous.txt',
            path: '/downloads/ambiguous.txt',
            extension: '.txt',
            analysis: { category: 'document' },
          },
        ];

        mockSuggestionService.getSuggestionsForFile.mockResolvedValue({
          success: true,
          primary: { folder: 'Documents', path: '/base/Documents' },
          confidence: 0.6,
          alternatives: [{ folder: 'Code', confidence: 0.55 }],
          explanation: 'Could be a document or code file',
        });

        const result = await service.organizeFiles(files, mockSmartFolders);

        expect(result.needsReview).toHaveLength(1);
        expect(result.needsReview[0].confidence).toBe(0.6);
        expect(result.needsReview[0].alternatives).toBeDefined();
        expect(result.organized).toHaveLength(0);
      });

      test('includes explanation for files needing review', async () => {
        const files = [
          {
            name: 'file.txt',
            path: '/downloads/file.txt',
            analysis: { category: 'document' },
          },
        ];

        mockSuggestionService.getSuggestionsForFile.mockResolvedValue({
          success: true,
          primary: { folder: 'Documents' },
          confidence: 0.65,
          explanation: 'Multiple possible folders',
        });

        const result = await service.organizeFiles(files, mockSmartFolders);

        expect(result.needsReview[0].explanation).toBe(
          'Multiple possible folders',
        );
      });
    });

    describe('low confidence fallback', () => {
      test('uses fallback for low confidence files', async () => {
        const files = [
          {
            name: 'unknown.xyz',
            path: '/downloads/unknown.xyz',
            extension: '.xyz',
            analysis: { category: 'unknown' },
          },
        ];

        mockSuggestionService.getSuggestionsForFile.mockResolvedValue({
          success: true,
          primary: { folder: 'Documents' },
          confidence: 0.2,
        });

        const result = await service.organizeFiles(files, mockSmartFolders);

        expect(result.organized).toHaveLength(1);
        expect(result.organized[0].method).toBe('low-confidence-fallback');
        expect(result.organized[0].confidence).toBe(0.2);
      });

      test('uses fallback when no suggestion available', async () => {
        const files = [
          {
            name: 'file.pdf',
            path: '/downloads/file.pdf',
            extension: '.pdf',
            analysis: { category: 'document' },
          },
        ];

        mockSuggestionService.getSuggestionsForFile.mockResolvedValue({
          success: false,
        });

        const result = await service.organizeFiles(files, mockSmartFolders);

        expect(result.organized).toHaveLength(1);
        expect(result.organized[0].method).toBe('fallback');
        expect(result.organized[0].confidence).toBe(0.3);
      });
    });

    describe('error handling', () => {
      test('handles files without analysis', async () => {
        const files = [
          {
            name: 'noanalysis.pdf',
            path: '/downloads/noanalysis.pdf',
            // Missing analysis field
          },
        ];

        const result = await service.organizeFiles(files, mockSmartFolders);

        // Files without analysis should go to default folder, not fail
        expect(result.organized).toHaveLength(1);
        expect(result.failed).toHaveLength(0);
        // Should have low confidence and use no-analysis-default method
        expect(result.organized[0].confidence).toBe(0.1);
        expect(result.organized[0].method).toBe('no-analysis-default');
      });

      test('handles suggestion service errors', async () => {
        const files = [
          {
            name: 'error.pdf',
            path: '/downloads/error.pdf',
            extension: '.pdf', // FIXED: Added extension property for fallback logic
            analysis: { category: 'document' },
          },
        ];

        mockSuggestionService.getSuggestionsForFile.mockRejectedValue(
          new Error('Service unavailable'),
        );

        const result = await service.organizeFiles(files, mockSmartFolders);

        // IMPROVED BEHAVIOR: Now catches suggestion service errors and uses fallback
        // instead of failing completely. This ensures resilience when suggestion
        // service is unavailable.
        expect(result.organized).toHaveLength(1);
        expect(result.failed).toHaveLength(0);
        expect(result.organized[0].method).toBe('suggestion-error-fallback');
        expect(result.organized[0].confidence).toBe(0.2);
      });

      test('continues processing after individual file errors', async () => {
        const files = [
          {
            name: 'error.pdf',
            path: '/downloads/error.pdf',
            analysis: { category: 'document' },
          },
          {
            name: 'success.pdf',
            path: '/downloads/success.pdf',
            analysis: { category: 'document' },
          },
        ];

        mockSuggestionService.getSuggestionsForFile
          .mockRejectedValueOnce(new Error('Failed'))
          .mockResolvedValueOnce({
            success: true,
            primary: { folder: 'Documents', path: '/base/Documents' },
            confidence: 0.9,
          });

        const result = await service.organizeFiles(files, mockSmartFolders);

        expect(result.failed).toHaveLength(1);
        expect(result.organized).toHaveLength(1);
      });
    });

    describe('custom options', () => {
      test('respects custom confidence threshold', async () => {
        const files = [
          {
            name: 'file.pdf',
            path: '/downloads/file.pdf',
            analysis: { category: 'document' },
          },
        ];

        mockSuggestionService.getSuggestionsForFile.mockResolvedValue({
          success: true,
          primary: { folder: 'Documents', path: '/base/Documents' },
          confidence: 0.7,
        });

        // With threshold 0.6, should auto-organize
        const result1 = await service.organizeFiles(files, mockSmartFolders, {
          confidenceThreshold: 0.6,
        });
        expect(result1.organized).toHaveLength(1);

        // With threshold 0.8, should need review
        const result2 = await service.organizeFiles(files, mockSmartFolders, {
          confidenceThreshold: 0.8,
        });
        expect(result2.needsReview).toHaveLength(1);
      });

      test('uses custom default location', async () => {
        const files = [
          {
            name: 'file.xyz', // Use a file extension that doesn't match any smart folder
            path: '/downloads/file.xyz',
            extension: '.xyz',
            analysis: { category: 'CustomType' },
          },
        ];

        mockSuggestionService.getSuggestionsForFile.mockResolvedValue({
          success: false,
        });

        const result = await service.organizeFiles(files, mockSmartFolders, {
          defaultLocation: '/custom/location',
        });

        expect(result.organized.length).toBeGreaterThan(0);
        expect(result.organized[0].destination).toBeDefined();
        // Should use custom location for files that don't match any smart folder or type category
        const normalized = result.organized[0].destination.replace(/\\/g, '/');
        expect(normalized).toContain('/custom/location');
        expect(normalized).toContain('CustomType'); // Should create folder based on analysis category
      });

      test('preserves original names when requested', async () => {
        const files = [
          {
            name: 'original-name.pdf',
            path: '/downloads/original-name.pdf',
            analysis: {
              category: 'document',
              suggestedName: 'suggested-name.pdf',
            },
          },
        ];

        mockSuggestionService.getSuggestionsForFile.mockResolvedValue({
          success: true,
          primary: { folder: 'Documents', path: '/base/Documents' },
          confidence: 0.9,
        });

        const result = await service.organizeFiles(files, mockSmartFolders, {
          preserveNames: true,
        });

        expect(result.organized[0].destination).toContain('original-name.pdf');
      });
    });
  });

  describe('batchOrganize', () => {
    describe('successful batch operations', () => {
      test('auto-approves high confidence groups', async () => {
        const files = [
          { name: 'doc1.pdf', path: '/downloads/doc1.pdf', analysis: {} },
          { name: 'doc2.pdf', path: '/downloads/doc2.pdf', analysis: {} },
        ];

        mockSuggestionService.getBatchSuggestions.mockResolvedValue({
          success: true,
          groups: [
            {
              folder: 'Documents',
              path: '/base/Documents',
              files: files,
              confidence: 0.9,
            },
          ],
        });

        const result = await service.batchOrganize(files, mockSmartFolders);

        expect(result.groups).toHaveLength(1);
        expect(result.groups[0].autoApproved).toBe(true);
        expect(result.operations).toHaveLength(2);
      });

      test('skips low confidence groups', async () => {
        const files = [
          { name: 'doc1.pdf', path: '/downloads/doc1.pdf', analysis: {} },
        ];

        mockSuggestionService.getBatchSuggestions.mockResolvedValue({
          success: true,
          groups: [
            {
              folder: 'Documents',
              path: '/base/Documents',
              files: files,
              confidence: 0.6,
            },
          ],
        });

        const result = await service.batchOrganize(files, mockSmartFolders);

        expect(result.skipped).toHaveLength(1);
        expect(result.skipped[0].reason).toBe('Low confidence');
        expect(result.operations).toHaveLength(0);
      });

      test('records positive feedback for batch operations', async () => {
        const file = {
          name: 'doc1.pdf',
          path: '/downloads/doc1.pdf',
          analysis: {},
          suggestion: { folder: 'Documents' },
        };

        mockSuggestionService.getBatchSuggestions.mockResolvedValue({
          success: true,
          groups: [
            {
              folder: 'Documents',
              path: '/base/Documents',
              files: [file],
              confidence: 0.9,
            },
          ],
        });

        await service.batchOrganize([file], mockSmartFolders);

        expect(mockSuggestionService.recordFeedback).toHaveBeenCalledWith(
          file,
          file.suggestion,
          true,
        );
      });
    });

    describe('error handling and resilience', () => {
      test('handles batch suggestion service failure', async () => {
        mockSuggestionService.getBatchSuggestions.mockResolvedValue({
          success: false,
        });

        await expect(
          service.batchOrganize([], mockSmartFolders),
        ).rejects.toThrow('Failed to get batch suggestions');
      });

      test('continues batch after individual group error', async () => {
        const files1 = [{ name: 'error.pdf', path: '/downloads/error.pdf' }];
        const files2 = [
          { name: 'success.pdf', path: '/downloads/success.pdf' },
        ];

        mockSuggestionService.getBatchSuggestions.mockResolvedValue({
          success: true,
          groups: [
            {
              folder: 'Documents',
              path: '/base/Documents',
              files: files1,
              confidence: 0.9,
            },
            {
              folder: 'Images',
              path: '/base/Images',
              files: files2,
              confidence: 0.9,
            },
          ],
        });

        // Mock buildDestinationPath to throw for first file
        const originalBuild = service.buildDestinationPath;
        service.buildDestinationPath = jest.fn((file) => {
          if (file.name === 'error.pdf') {
            throw new Error('Build failed');
          }
          return originalBuild.call(
            service,
            file,
            { folder: 'Images', path: '/base/Images' },
            'Documents',
            false,
          );
        });

        const result = await service.batchOrganize(
          [...files1, ...files2],
          mockSmartFolders,
        );

        expect(result.failed.length).toBeGreaterThan(0);
        expect(result.operations.length).toBeGreaterThan(0);

        service.buildDestinationPath = originalBuild;
      });

      test('tracks partial success in groups', async () => {
        const files = [
          { name: 'doc1.pdf', path: '/downloads/doc1.pdf' },
          { name: 'doc2.pdf', path: '/downloads/doc2.pdf' },
        ];

        mockSuggestionService.getBatchSuggestions.mockResolvedValue({
          success: true,
          groups: [
            {
              folder: 'Documents',
              path: '/base/Documents',
              files: files,
              confidence: 0.9,
            },
          ],
        });

        const originalBuild = service.buildDestinationPath;
        let callCount = 0;
        service.buildDestinationPath = jest.fn((file) => {
          callCount++;
          if (callCount === 1) {
            throw new Error('First file failed');
          }
          return '/base/Documents/' + file.name;
        });

        const result = await service.batchOrganize(files, mockSmartFolders);

        expect(result.groups[0].partialSuccess).toBe(true);
        expect(result.failed.length).toBeGreaterThan(0);

        service.buildDestinationPath = originalBuild;
      });
    });

    describe('custom options', () => {
      test('respects custom auto-approve threshold', async () => {
        const files = [{ name: 'doc.pdf', path: '/downloads/doc.pdf' }];

        mockSuggestionService.getBatchSuggestions.mockResolvedValue({
          success: true,
          groups: [
            {
              folder: 'Documents',
              path: '/base/Documents',
              files: files,
              confidence: 0.7,
            },
          ],
        });

        // With threshold 0.6, should auto-approve
        const result1 = await service.batchOrganize(files, mockSmartFolders, {
          autoApproveThreshold: 0.6,
        });
        expect(result1.groups).toHaveLength(1);

        // With threshold 0.8, should skip
        const result2 = await service.batchOrganize(files, mockSmartFolders, {
          autoApproveThreshold: 0.8,
        });
        expect(result2.skipped).toHaveLength(1);
      });
    });
  });

  describe('getFallbackDestination', () => {
    test('matches file by type to existing smart folder', () => {
      const file = {
        name: 'photo.jpg',
        extension: '.jpg',
      };

      const destination = service.getFallbackDestination(
        file,
        mockSmartFolders,
        'Documents',
      );

      expect(destination).toContain('Images');
      expect(destination).toContain('photo.jpg');
    });

    test('uses analysis category when available', () => {
      const file = {
        name: 'file.xyz', // Use an extension that doesn't match any type category
        extension: '.xyz',
        analysis: {
          category: 'Code',
        },
      };

      const destination = service.getFallbackDestination(
        file,
        mockSmartFolders,
        'Documents',
      );

      // Should find the Code folder from smart folders based on analysis category
      expect(destination.replace(/\\/g, '/')).toContain('Code');
    });

    test('creates new folder for unmatched category', () => {
      const file = {
        name: 'file.xyz',
        extension: '.xyz',
        analysis: {
          category: 'CustomType',
        },
      };

      const destination = service.getFallbackDestination(
        file,
        mockSmartFolders,
        '/base',
      );

      expect(destination).toContain('CustomType');
      expect(destination).toContain('file.xyz');
    });

    test('falls back to file type category when no match', () => {
      const file = {
        name: 'unknown.xyz',
        extension: '.xyz',
      };

      const destination = service.getFallbackDestination(
        file,
        mockSmartFolders,
        '/base',
      );

      expect(destination).toContain('Files');
    });
  });

  describe('buildDestinationPath', () => {
    test('builds path from suggestion', () => {
      const file = {
        name: 'document.pdf',
        analysis: {},
      };

      const suggestion = {
        folder: 'Documents',
        path: '/base/Documents',
      };

      const destination = service.buildDestinationPath(
        file,
        suggestion,
        'Documents',
        false,
      );

      expect(destination).toBe(path.join('/base/Documents', 'document.pdf'));
    });

    test('uses suggested name from analysis', () => {
      const file = {
        name: 'document.pdf',
        analysis: {
          suggestedName: 'better-name.pdf',
        },
      };

      const suggestion = {
        path: '/base/Documents',
      };

      const destination = service.buildDestinationPath(
        file,
        suggestion,
        'Documents',
        false,
      );

      expect(destination).toContain('better-name.pdf');
    });

    test('preserves original name when requested', () => {
      const file = {
        name: 'original.pdf',
        analysis: {
          suggestedName: 'suggested.pdf',
        },
      };

      const suggestion = {
        path: '/base/Documents',
      };

      const destination = service.buildDestinationPath(
        file,
        suggestion,
        'Documents',
        true, // preserveNames
      );

      expect(destination).toContain('original.pdf');
      expect(destination).not.toContain('suggested.pdf');
    });

    test('uses default location when suggestion has no path', () => {
      const file = {
        name: 'file.pdf',
        analysis: {},
      };

      const suggestion = {
        folder: 'Documents',
      };

      const destination = service.buildDestinationPath(
        file,
        suggestion,
        '/custom/location',
        false,
      );

      // Normalize path separators for cross-platform testing
      const normalized = destination.replace(/\\/g, '/');
      expect(normalized).toContain('/custom/location');
      expect(normalized).toContain('Documents');
    });
  });

  describe('getFileTypeCategory', () => {
    test('categorizes documents correctly', () => {
      expect(service.getFileTypeCategory('.pdf')).toBe('Documents');
      expect(service.getFileTypeCategory('.doc')).toBe('Documents');
      expect(service.getFileTypeCategory('.docx')).toBe('Documents');
      expect(service.getFileTypeCategory('.txt')).toBe('Documents');
    });

    test('categorizes images correctly', () => {
      expect(service.getFileTypeCategory('.jpg')).toBe('Images');
      expect(service.getFileTypeCategory('.png')).toBe('Images');
      expect(service.getFileTypeCategory('.gif')).toBe('Images');
    });

    test('categorizes code files correctly', () => {
      expect(service.getFileTypeCategory('.js')).toBe('Code');
      expect(service.getFileTypeCategory('.py')).toBe('Code');
      expect(service.getFileTypeCategory('.java')).toBe('Code');
    });

    test('categorizes archives correctly', () => {
      expect(service.getFileTypeCategory('.zip')).toBe('Archives');
      expect(service.getFileTypeCategory('.rar')).toBe('Archives');
      expect(service.getFileTypeCategory('.7z')).toBe('Archives');
    });

    test('handles case insensitivity', () => {
      expect(service.getFileTypeCategory('.PDF')).toBe('Documents');
      expect(service.getFileTypeCategory('.JPG')).toBe('Images');
    });

    test('handles extensions with leading dot', () => {
      expect(service.getFileTypeCategory('.pdf')).toBe('Documents');
      expect(service.getFileTypeCategory('pdf')).toBe('Documents');
    });

    test('returns Files for unknown extensions', () => {
      expect(service.getFileTypeCategory('.xyz')).toBe('Files');
      expect(service.getFileTypeCategory('.unknown')).toBe('Files');
    });
  });

  describe('getStatistics', () => {
    test('returns organization statistics', async () => {
      mockSuggestionService.userPatterns.set('pattern1', {});
      mockSuggestionService.feedbackHistory.push({});

      const stats = await service.getStatistics();

      expect(stats.userPatterns).toBe(1);
      expect(stats.feedbackHistory).toBe(1);
      expect(stats.folderUsageStats).toEqual([
        ['Documents', 10],
        ['Images', 5],
      ]);
      expect(stats.thresholds).toEqual(service.thresholds);
    });
  });

  describe('updateThresholds', () => {
    test('updates confidence thresholds', () => {
      const newThresholds = {
        autoApprove: 0.9,
        requireReview: 0.6,
      };

      service.updateThresholds(newThresholds);

      expect(service.thresholds.autoApprove).toBe(0.9);
      expect(service.thresholds.requireReview).toBe(0.6);
      expect(service.thresholds.reject).toBe(0.3); // unchanged
    });

    test('partially updates thresholds', () => {
      service.updateThresholds({ autoApprove: 0.85 });

      expect(service.thresholds.autoApprove).toBe(0.85);
      expect(service.thresholds.requireReview).toBe(0.5); // unchanged
    });

    test('preserves existing thresholds not in update', () => {
      const original = { ...service.thresholds };

      service.updateThresholds({ autoApprove: 0.75 });

      expect(service.thresholds.requireReview).toBe(original.requireReview);
      expect(service.thresholds.reject).toBe(original.reject);
    });
  });
});
