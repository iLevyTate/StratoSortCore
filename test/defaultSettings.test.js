/**
 * Tests for Default Settings
 * Tests the default settings configuration
 */

describe('defaultSettings', () => {
  let DEFAULT_SETTINGS;

  beforeEach(() => {
    jest.resetModules();
    const module = require('../src/shared/defaultSettings');
    DEFAULT_SETTINGS = module.DEFAULT_SETTINGS;
  });

  describe('DEFAULT_SETTINGS', () => {
    test('exports DEFAULT_SETTINGS object', () => {
      expect(DEFAULT_SETTINGS).toBeDefined();
      expect(typeof DEFAULT_SETTINGS).toBe('object');
    });
  });

  describe('UI settings', () => {
    test('has notifications setting', () => {
      expect(DEFAULT_SETTINGS.notifications).toBe(true);
    });
  });

  describe('Graph retrieval settings', () => {
    test('has graph expansion defaults', () => {
      expect(DEFAULT_SETTINGS.graphExpansionEnabled).toBe(true);
      expect(DEFAULT_SETTINGS.graphExpansionWeight).toBeGreaterThanOrEqual(0);
      expect(DEFAULT_SETTINGS.graphExpansionWeight).toBeLessThanOrEqual(1);
      expect(DEFAULT_SETTINGS.graphExpansionMaxNeighbors).toBeGreaterThan(0);
    });

    test('has chunk context defaults', () => {
      expect(DEFAULT_SETTINGS.chunkContextEnabled).toBe(true);
      expect(DEFAULT_SETTINGS.chunkContextMaxNeighbors).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Behavior settings', () => {
    test('has defaultSmartFolderLocation', () => {
      expect(DEFAULT_SETTINGS.defaultSmartFolderLocation).toBe('Documents');
    });

    test('has maxConcurrentAnalysis', () => {
      // Default is 1 for sequential processing - better UX and prevents VRAM exhaustion
      expect(DEFAULT_SETTINGS.maxConcurrentAnalysis).toBe(1);
    });

    test('has autoOrganize disabled by default', () => {
      expect(DEFAULT_SETTINGS.autoOrganize).toBe(false);
    });

    test('has backgroundMode disabled by default', () => {
      expect(DEFAULT_SETTINGS.backgroundMode).toBe(false);
    });
  });

  describe('Organization Confidence Threshold', () => {
    test('has confidenceThreshold', () => {
      expect(DEFAULT_SETTINGS.confidenceThreshold).toBe(0.75);
    });

    test('confidenceThreshold is between 0 and 1', () => {
      expect(DEFAULT_SETTINGS.confidenceThreshold).toBeGreaterThanOrEqual(0);
      expect(DEFAULT_SETTINGS.confidenceThreshold).toBeLessThanOrEqual(1);
    });
  });

  describe('AI settings', () => {
    test('has textModel', () => {
      expect(DEFAULT_SETTINGS.textModel).toBe('Mistral-7B-Instruct-v0.3-Q4_K_M.gguf');
    });

    test('has visionModel', () => {
      expect(DEFAULT_SETTINGS.visionModel).toBe('llava-v1.6-mistral-7b-Q4_K_M.gguf');
    });

    test('has embeddingModel', () => {
      expect(DEFAULT_SETTINGS.embeddingModel).toBe('nomic-embed-text-v1.5-Q8_0.gguf');
    });
  });

  describe('File Size Limits', () => {
    test('has maxFileSize (100MB)', () => {
      expect(DEFAULT_SETTINGS.maxFileSize).toBe(100 * 1024 * 1024);
    });

    test('has maxImageFileSize (100MB)', () => {
      expect(DEFAULT_SETTINGS.maxImageFileSize).toBe(100 * 1024 * 1024);
    });

    test('has maxDocumentFileSize (200MB)', () => {
      expect(DEFAULT_SETTINGS.maxDocumentFileSize).toBe(200 * 1024 * 1024);
    });

    test('has maxTextFileSize (50MB)', () => {
      expect(DEFAULT_SETTINGS.maxTextFileSize).toBe(50 * 1024 * 1024);
    });
  });

  describe('Processing Limits', () => {
    test('has analysisTimeout (60 seconds)', () => {
      expect(DEFAULT_SETTINGS.analysisTimeout).toBe(60000);
    });

    test('has fileOperationTimeout (10 seconds)', () => {
      expect(DEFAULT_SETTINGS.fileOperationTimeout).toBe(10000);
    });

    test('has maxBatchSize (100)', () => {
      expect(DEFAULT_SETTINGS.maxBatchSize).toBe(100);
    });

    test('has retryAttempts (3)', () => {
      expect(DEFAULT_SETTINGS.retryAttempts).toBe(3);
    });
  });

  describe('UI Limits', () => {
    test('has workflowRestoreMaxAge (1 hour)', () => {
      expect(DEFAULT_SETTINGS.workflowRestoreMaxAge).toBe(60 * 60 * 1000);
    });

    test('has saveDebounceMs (1 second)', () => {
      expect(DEFAULT_SETTINGS.saveDebounceMs).toBe(1000);
    });
  });

  describe('value validation', () => {
    test('all numeric values are positive', () => {
      const numericKeys = [
        'maxConcurrentAnalysis',
        'confidenceThreshold',
        'maxFileSize',
        'maxImageFileSize',
        'maxDocumentFileSize',
        'maxTextFileSize',
        'analysisTimeout',
        'fileOperationTimeout',
        'maxBatchSize',
        'retryAttempts',
        'workflowRestoreMaxAge',
        'saveDebounceMs',
        'graphExpansionWeight',
        'graphExpansionMaxNeighbors',
        'chunkContextMaxNeighbors'
      ];

      numericKeys.forEach((key) => {
        expect(DEFAULT_SETTINGS[key]).toBeGreaterThan(0);
      });
    });

    test('confidenceThreshold is between 0 and 1', () => {
      expect(DEFAULT_SETTINGS.confidenceThreshold).toBeGreaterThanOrEqual(0);
      expect(DEFAULT_SETTINGS.confidenceThreshold).toBeLessThanOrEqual(1);
    });
  });
});
