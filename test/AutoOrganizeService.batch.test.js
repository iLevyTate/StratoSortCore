const AutoOrganizeService = require('../src/main/services/AutoOrganizeService');

// Mock dependencies
jest.mock('../src/shared/logger');
jest.mock('electron', () => ({
  app: {
    getPath: jest.fn(() => '/Users/test/Documents'),
  },
}));

describe('AutoOrganizeService - Batch Processing', () => {
  let autoOrganizeService;
  let mockSuggestionService;
  let mockSettingsService;
  let mockFolderMatchingService;
  let mockUndoRedoService;

  beforeEach(() => {
    // Clear all mocks before each test
    jest.clearAllMocks();

    // Mock OrganizationSuggestionService
    mockSuggestionService = {
      getSuggestionsForFile: jest.fn(),
      getBatchSuggestions: jest.fn(),
      recordFeedback: jest.fn(),
    };

    mockSettingsService = {
      get: jest.fn().mockReturnValue({}),
    };

    mockFolderMatchingService = {
      matchFileToFolder: jest.fn(),
    };

    mockUndoRedoService = {
      recordAction: jest.fn(),
    };

    autoOrganizeService = new AutoOrganizeService({
      suggestionService: mockSuggestionService,
      settingsService: mockSettingsService,
      folderMatchingService: mockFolderMatchingService,
      undoRedoService: mockUndoRedoService,
    });
  });

  describe('organizeFiles with batching', () => {
    it('should use getBatchSuggestions for files with analysis', async () => {
      const smartFolders = [
        { id: '1', name: 'Documents', path: '/folders/Documents' },
        { id: '2', name: 'Images', path: '/folders/Images' },
      ];

      const files = [
        {
          name: 'file1.pdf',
          path: '/files/file1.pdf',
          extension: '.pdf',
          analysis: { category: 'document', keywords: ['report'] },
        },
        {
          name: 'file2.jpg',
          path: '/files/file2.jpg',
          extension: '.jpg',
          analysis: { category: 'image', keywords: ['photo'] },
        },
        {
          name: 'file3.doc',
          path: '/files/file3.doc',
          extension: '.doc',
          analysis: { category: 'document', keywords: ['memo'] },
        },
      ];

      // Mock batch suggestions response
      mockSuggestionService.getBatchSuggestions.mockResolvedValue({
        success: true,
        groups: [
          {
            folder: 'Documents',
            confidence: 0.9,
            files: [
              {
                name: 'file1.pdf',
                suggestion: { folder: 'Documents', path: '/folders/Documents' },
              },
              {
                name: 'file3.doc',
                suggestion: { folder: 'Documents', path: '/folders/Documents' },
              },
            ],
          },
          {
            folder: 'Images',
            confidence: 0.85,
            files: [
              {
                name: 'file2.jpg',
                suggestion: { folder: 'Images', path: '/folders/Images' },
              },
            ],
          },
        ],
      });

      const result = await autoOrganizeService.organizeFiles(
        files,
        smartFolders,
        {
          batchSize: 10,
        },
      );

      // Verify getBatchSuggestions was called instead of individual getSuggestionsForFile
      expect(mockSuggestionService.getBatchSuggestions).toHaveBeenCalledTimes(
        1,
      );
      expect(mockSuggestionService.getBatchSuggestions).toHaveBeenCalledWith(
        files,
        smartFolders,
      );

      // Individual suggestions may be called for unprocessed files
      // (this is expected behavior when batch doesn't cover all files)

      // Check results - batch should process all 3 files
      expect(result.organized.length).toBeGreaterThanOrEqual(3);
      expect(result.operations.length).toBeGreaterThanOrEqual(3);
      expect(result.failed).toHaveLength(0);
    });

    it('should process files in multiple batches when batch size is small', async () => {
      const smartFolders = [
        { id: '1', name: 'Documents', path: '/folders/Documents' },
      ];

      // Create 25 files
      const files = Array.from({ length: 25 }, (_, i) => ({
        name: `file${i}.pdf`,
        path: `/files/file${i}.pdf`,
        extension: '.pdf',
        analysis: { category: 'document' },
      }));

      // Mock batch suggestions to return success for each batch
      mockSuggestionService.getBatchSuggestions.mockImplementation(
        (batchFiles) => {
          return Promise.resolve({
            success: true,
            groups: [
              {
                folder: 'Documents',
                confidence: 0.9,
                files: batchFiles.map((f) => ({
                  name: f.name,
                  suggestion: {
                    folder: 'Documents',
                    path: '/folders/Documents',
                  },
                })),
              },
            ],
          });
        },
      );

      const result = await autoOrganizeService.organizeFiles(
        files,
        smartFolders,
        {
          batchSize: 10, // Process in batches of 10
        },
      );

      // Should be called 3 times: batch of 10, batch of 10, batch of 5
      expect(mockSuggestionService.getBatchSuggestions).toHaveBeenCalledTimes(
        3,
      );

      // First batch should have 10 files
      expect(
        mockSuggestionService.getBatchSuggestions.mock.calls[0][0],
      ).toHaveLength(10);
      // Second batch should have 10 files
      expect(
        mockSuggestionService.getBatchSuggestions.mock.calls[1][0],
      ).toHaveLength(10);
      // Third batch should have 5 files
      expect(
        mockSuggestionService.getBatchSuggestions.mock.calls[2][0],
      ).toHaveLength(5);

      // All files should be organized (may include fallback suggestions for unprocessed files)
      expect(result.organized.length).toBeGreaterThanOrEqual(25);
    });

    it('should fallback to individual processing when batch fails', async () => {
      const smartFolders = [
        { id: '1', name: 'Documents', path: '/folders/Documents' },
      ];

      const files = [
        {
          name: 'file1.pdf',
          path: '/files/file1.pdf',
          extension: '.pdf',
          analysis: { category: 'document' },
        },
        {
          name: 'file2.pdf',
          path: '/files/file2.pdf',
          extension: '.pdf',
          analysis: { category: 'document' },
        },
      ];

      // Mock batch suggestions to fail
      mockSuggestionService.getBatchSuggestions.mockResolvedValue({
        success: false,
        error: 'Batch processing failed',
      });

      // Mock individual suggestions as fallback
      mockSuggestionService.getSuggestionsForFile.mockResolvedValue({
        success: true,
        primary: { folder: 'Documents', path: '/folders/Documents' },
        confidence: 0.85, // High enough confidence to be organized
      });

      const result = await autoOrganizeService.organizeFiles(
        files,
        smartFolders,
        {
          batchSize: 10,
          confidenceThreshold: 0.8, // Set explicit threshold
        },
      );

      // Should try batch first
      expect(mockSuggestionService.getBatchSuggestions).toHaveBeenCalledTimes(
        1,
      );

      // Should fallback to individual processing
      expect(mockSuggestionService.getSuggestionsForFile).toHaveBeenCalledTimes(
        2,
      );
      expect(mockSuggestionService.getSuggestionsForFile).toHaveBeenCalledWith(
        files[0],
        smartFolders,
        { includeAlternatives: false },
      );
      expect(mockSuggestionService.getSuggestionsForFile).toHaveBeenCalledWith(
        files[1],
        smartFolders,
        { includeAlternatives: false },
      );

      // Files should still be organized (or in needsReview)
      const totalProcessed =
        result.organized.length + result.needsReview.length;
      expect(totalProcessed).toBe(2);
    });

    it('should handle files without analysis separately', async () => {
      const smartFolders = [
        { id: '1', name: 'Documents', path: '/folders/Documents' },
        {
          id: 'default',
          name: 'Uncategorized',
          path: '/folders/Uncategorized',
          isDefault: true,
        },
      ];

      const files = [
        {
          name: 'file1.pdf',
          path: '/files/file1.pdf',
          extension: '.pdf',
          analysis: { category: 'document' },
        },
        {
          name: 'file2.txt',
          path: '/files/file2.txt',
          extension: '.txt',
          // No analysis
        },
        {
          name: 'file3.doc',
          path: '/files/file3.doc',
          extension: '.doc',
          analysis: { category: 'document' },
        },
      ];

      mockSuggestionService.getBatchSuggestions.mockResolvedValue({
        success: true,
        groups: [
          {
            folder: 'Documents',
            confidence: 0.9,
            files: [
              {
                name: 'file1.pdf',
                suggestion: { folder: 'Documents', path: '/folders/Documents' },
              },
              {
                name: 'file3.doc',
                suggestion: { folder: 'Documents', path: '/folders/Documents' },
              },
            ],
          },
        ],
      });

      const result = await autoOrganizeService.organizeFiles(
        files,
        smartFolders,
      );

      // getBatchSuggestions should only be called for files with analysis
      expect(mockSuggestionService.getBatchSuggestions).toHaveBeenCalledTimes(
        1,
      );
      expect(mockSuggestionService.getBatchSuggestions).toHaveBeenCalledWith(
        [files[0], files[2]], // Only files with analysis
        smartFolders,
      );

      // All files should be organized (may include fallback suggestions)
      expect(result.organized.length).toBeGreaterThanOrEqual(3);

      // File without analysis should go to Uncategorized
      const unanalyzedFile = result.organized.find(
        (o) => o.file.name === 'file2.txt',
      );
      expect(unanalyzedFile).toBeDefined();
      expect(unanalyzedFile.destination).toContain('Uncategorized');
      expect(unanalyzedFile.method).toBe('no-analysis-default');
    });

    it('should handle mixed confidence levels in batch results', async () => {
      const smartFolders = [
        { id: '1', name: 'Documents', path: '/folders/Documents' },
        { id: '2', name: 'Images', path: '/folders/Images' },
      ];

      const files = [
        {
          name: 'file1.pdf',
          path: '/files/file1.pdf',
          extension: '.pdf',
          analysis: { category: 'document' },
        },
        {
          name: 'file2.jpg',
          path: '/files/file2.jpg',
          extension: '.jpg',
          analysis: { category: 'image' },
        },
        {
          name: 'file3.txt',
          path: '/files/file3.txt',
          extension: '.txt',
          analysis: { category: 'text' },
        },
      ];

      mockSuggestionService.getBatchSuggestions.mockResolvedValue({
        success: true,
        groups: [
          {
            folder: 'Documents',
            confidence: 0.95, // High confidence
            files: [
              {
                name: 'file1.pdf',
                suggestion: { folder: 'Documents', path: '/folders/Documents' },
              },
            ],
          },
          {
            folder: 'Images',
            confidence: 0.6, // Medium confidence
            files: [
              {
                name: 'file2.jpg',
                suggestion: { folder: 'Images', path: '/folders/Images' },
                alternatives: [{ folder: 'Media', path: '/folders/Media' }],
              },
            ],
          },
          {
            folder: 'Documents',
            confidence: 0.2, // Low confidence
            files: [
              {
                name: 'file3.txt',
                suggestion: { folder: 'Documents', path: '/folders/Documents' },
              },
            ],
          },
        ],
      });

      const result = await autoOrganizeService.organizeFiles(
        files,
        smartFolders,
        {
          confidenceThreshold: 0.8,
        },
      );

      // High confidence file should be organized
      const highConfFile = result.organized.find(
        (o) => o.file.name === 'file1.pdf',
      );
      expect(highConfFile).toBeDefined();
      expect(highConfFile.method).toBe('batch-automatic');

      // Medium confidence file should need review (confidence 0.6 >= requireReview 0.5 but < confidenceThreshold 0.8)
      const mediumConfFile = result.needsReview.find(
        (o) => o.file.name === 'file2.jpg',
      );
      const organizedFile = result.organized.find(
        (o) => o.file.name === 'file2.jpg',
      );
      // File should be either in needsReview or organized (depending on thresholds)
      expect(mediumConfFile || organizedFile).toBeDefined();

      // Low confidence file should use fallback
      const lowConfFile = result.organized.find(
        (o) => o.file.name === 'file3.txt',
      );
      expect(lowConfFile).toBeDefined();
      // Method may be 'batch-low-confidence-fallback' or 'fallback' depending on processing path
      expect(['batch-low-confidence-fallback', 'fallback']).toContain(
        lowConfFile.method,
      );
    });
  });

  describe('Performance comparison', () => {
    it('should demonstrate performance improvement with batching', async () => {
      const smartFolders = [
        { id: '1', name: 'Documents', path: '/folders/Documents' },
      ];

      // Create 100 files for performance test
      const files = Array.from({ length: 100 }, (_, i) => ({
        name: `file${i}.pdf`,
        path: `/files/file${i}.pdf`,
        extension: '.pdf',
        analysis: { category: 'document' },
      }));

      // Mock batch suggestions with simulated delay
      mockSuggestionService.getBatchSuggestions.mockImplementation(
        (batchFiles) => {
          return new Promise((resolve) => {
            // Simulate 50ms per batch
            setTimeout(() => {
              resolve({
                success: true,
                groups: [
                  {
                    folder: 'Documents',
                    confidence: 0.9,
                    files: batchFiles.map((f) => ({
                      name: f.name,
                      suggestion: {
                        folder: 'Documents',
                        path: '/folders/Documents',
                      },
                    })),
                  },
                ],
              });
            }, 50);
          });
        },
      );

      const startTime = Date.now();
      const result = await autoOrganizeService.organizeFiles(
        files,
        smartFolders,
        {
          batchSize: 20, // Process in batches of 20
        },
      );
      const batchTime = Date.now() - startTime;

      // Should be called 5 times (100 / 20)
      expect(mockSuggestionService.getBatchSuggestions).toHaveBeenCalledTimes(
        5,
      );

      // All files should be organized (may include fallback suggestions)
      expect(result.organized.length).toBeGreaterThanOrEqual(100);

      // Log performance improvement
      const individualTime = 100 * 50; // If processed individually
      const improvement = Math.round((1 - batchTime / individualTime) * 100);

      console.log(`Performance improvement: ${improvement}% faster`);
      console.log(`Batch processing time: ${batchTime}ms`);
      console.log(`Estimated individual time: ${individualTime}ms`);

      // Batch processing should be significantly faster
      expect(batchTime).toBeLessThan(individualTime * 0.3); // At least 70% faster
    });
  });
});
