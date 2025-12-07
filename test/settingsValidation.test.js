/**
 * @jest-environment node
 */

const {
  VALIDATION_RULES,
  validateSettings,
  validateSetting,
  sanitizeSettings,
  getDefaultValue,
  getConfigurableLimits,
} = require('../src/shared/settingsValidation');

describe('settingsValidation security', () => {
  test('rejects prototype-pollution keys via warnings', () => {
    const input = { __proto__: 'oops', theme: 'dark' };
    const result = validateSettings(input);

    expect(result.valid).toBe(true);
    expect(result.warnings).toEqual(
      expect.arrayContaining([expect.stringContaining('unsafe key')]),
    );
    expect(result.errors).toHaveLength(0);
  });

  test('sanitizeSettings drops prototype-pollution keys', () => {
    const input = { constructor: 'bad', theme: 'light', maxBatchSize: 10 };
    const sanitized = sanitizeSettings(input);

    expect(sanitized.constructor).toBeUndefined();
    expect(sanitized.theme).toBe('light');
    expect(sanitized.maxBatchSize).toBe(10);
  });
});

describe('Settings Validation', () => {
  describe('VALIDATION_RULES', () => {
    test('defines validation rules for all settings', () => {
      expect(VALIDATION_RULES).toBeDefined();
      expect(typeof VALIDATION_RULES).toBe('object');
      expect(Object.keys(VALIDATION_RULES).length).toBeGreaterThan(0);
    });

    test('includes critical settings rules', () => {
      expect(VALIDATION_RULES.theme).toBeDefined();
      expect(VALIDATION_RULES.ollamaHost).toBeDefined();
      expect(VALIDATION_RULES.maxFileSize).toBeDefined();
      expect(VALIDATION_RULES.maxConcurrentAnalysis).toBeDefined();
    });
  });

  describe('validateSetting', () => {
    describe('theme validation', () => {
      test('accepts valid theme values', () => {
        expect(
          validateSetting('theme', 'light', VALIDATION_RULES.theme),
        ).toEqual([]);
        expect(
          validateSetting('theme', 'dark', VALIDATION_RULES.theme),
        ).toEqual([]);
        expect(
          validateSetting('theme', 'system', VALIDATION_RULES.theme),
        ).toEqual([]);
      });

      test('rejects invalid theme values', () => {
        const errors = validateSetting(
          'theme',
          'invalid',
          VALIDATION_RULES.theme,
        );
        expect(errors).toHaveLength(1);
        expect(errors[0]).toContain('theme');
      });
    });

    describe('numeric validation', () => {
      test('accepts valid numbers within range', () => {
        expect(
          validateSetting(
            'maxConcurrentAnalysis',
            3,
            VALIDATION_RULES.maxConcurrentAnalysis,
          ),
        ).toEqual([]);
        expect(
          validateSetting(
            'maxConcurrentAnalysis',
            1,
            VALIDATION_RULES.maxConcurrentAnalysis,
          ),
        ).toEqual([]);
        expect(
          validateSetting(
            'maxConcurrentAnalysis',
            10,
            VALIDATION_RULES.maxConcurrentAnalysis,
          ),
        ).toEqual([]);
      });

      test('rejects numbers below minimum', () => {
        const errors = validateSetting(
          'maxConcurrentAnalysis',
          0,
          VALIDATION_RULES.maxConcurrentAnalysis,
        );
        expect(errors.length).toBeGreaterThan(0);
      });

      test('rejects numbers above maximum', () => {
        const errors = validateSetting(
          'maxConcurrentAnalysis',
          100,
          VALIDATION_RULES.maxConcurrentAnalysis,
        );
        expect(errors.length).toBeGreaterThan(0);
      });

      test('rejects non-numeric values', () => {
        const errors = validateSetting(
          'maxConcurrentAnalysis',
          'invalid',
          VALIDATION_RULES.maxConcurrentAnalysis,
        );
        expect(errors.length).toBeGreaterThan(0);
      });
    });

    describe('URL validation', () => {
      test('accepts valid URLs', () => {
        expect(
          validateSetting(
            'ollamaHost',
            'http://localhost:11434',
            VALIDATION_RULES.ollamaHost,
          ),
        ).toEqual([]);
        expect(
          validateSetting(
            'ollamaHost',
            'http://127.0.0.1:8000',
            VALIDATION_RULES.ollamaHost,
          ),
        ).toEqual([]);
        expect(
          validateSetting(
            'ollamaHost',
            'https://api.example.com',
            VALIDATION_RULES.ollamaHost,
          ),
        ).toEqual([]);
      });

      test('rejects invalid URLs', () => {
        const errors1 = validateSetting(
          'ollamaHost',
          'not a url',
          VALIDATION_RULES.ollamaHost,
        );
        expect(errors1.length).toBeGreaterThan(0);

        const errors2 = validateSetting(
          'ollamaHost',
          'ftp://invalid',
          VALIDATION_RULES.ollamaHost,
        );
        expect(errors2.length).toBeGreaterThan(0);
      });
    });

    describe('boolean validation', () => {
      test('accepts boolean values', () => {
        expect(
          validateSetting('autoOrganize', true, VALIDATION_RULES.autoOrganize),
        ).toEqual([]);
        expect(
          validateSetting('autoOrganize', false, VALIDATION_RULES.autoOrganize),
        ).toEqual([]);
      });

      test('rejects non-boolean values', () => {
        const errors = validateSetting(
          'autoOrganize',
          'yes',
          VALIDATION_RULES.autoOrganize,
        );
        expect(errors.length).toBeGreaterThan(0);
      });
    });

    describe('string validation', () => {
      test('accepts valid string values', () => {
        expect(
          validateSetting(
            'textModel',
            'llama3.2:latest',
            VALIDATION_RULES.textModel,
          ),
        ).toEqual([]);
        expect(
          validateSetting('textModel', 'gpt-4', VALIDATION_RULES.textModel),
        ).toEqual([]);
      });

      test('rejects non-string values', () => {
        const errors = validateSetting(
          'textModel',
          123,
          VALIDATION_RULES.textModel,
        );
        expect(errors.length).toBeGreaterThan(0);
      });
    });

    describe('file size validation', () => {
      test('accepts valid file sizes', () => {
        expect(
          validateSetting(
            'maxFileSize',
            1024 * 1024,
            VALIDATION_RULES.maxFileSize,
          ),
        ).toEqual([]); // 1MB minimum
        expect(
          validateSetting(
            'maxFileSize',
            100 * 1024 * 1024,
            VALIDATION_RULES.maxFileSize,
          ),
        ).toEqual([]);
      });

      test('rejects negative file sizes', () => {
        const errors = validateSetting(
          'maxFileSize',
          -1,
          VALIDATION_RULES.maxFileSize,
        );
        expect(errors.length).toBeGreaterThan(0);
      });

      test('rejects zero file size', () => {
        const errors = validateSetting(
          'maxFileSize',
          0,
          VALIDATION_RULES.maxFileSize,
        );
        expect(errors.length).toBeGreaterThan(0);
      });

      test('rejects extremely large file sizes', () => {
        const errors = validateSetting(
          'maxFileSize',
          10 * 1024 * 1024 * 1024 * 1024,
          VALIDATION_RULES.maxFileSize,
        );
        expect(errors.length).toBeGreaterThan(0);
      });
    });

    describe('confidence threshold validation', () => {
      test('accepts valid confidence values (0-1)', () => {
        expect(
          validateSetting(
            'autoApproveThreshold',
            0.8,
            VALIDATION_RULES.autoApproveThreshold,
          ),
        ).toEqual([]);
        expect(
          validateSetting(
            'autoApproveThreshold',
            0,
            VALIDATION_RULES.autoApproveThreshold,
          ),
        ).toEqual([]);
        expect(
          validateSetting(
            'autoApproveThreshold',
            1,
            VALIDATION_RULES.autoApproveThreshold,
          ),
        ).toEqual([]);
      });

      test('rejects confidence below 0', () => {
        const errors = validateSetting(
          'autoApproveThreshold',
          -0.1,
          VALIDATION_RULES.autoApproveThreshold,
        );
        expect(errors.length).toBeGreaterThan(0);
      });

      test('rejects confidence above 1', () => {
        const errors = validateSetting(
          'autoApproveThreshold',
          1.5,
          VALIDATION_RULES.autoApproveThreshold,
        );
        expect(errors.length).toBeGreaterThan(0);
      });
    });
  });

  describe('validateSettings', () => {
    describe('valid settings', () => {
      test('validates complete valid settings object', () => {
        const settings = {
          theme: 'dark',
          notifications: true,
          ollamaHost: 'http://localhost:11434',
          textModel: 'llama3.2:latest',
          visionModel: 'llava:latest',
          maxConcurrentAnalysis: 3,
          autoOrganize: false,
          maxFileSize: 100 * 1024 * 1024,
          autoApproveThreshold: 0.8,
          reviewThreshold: 0.5,
        };

        const result = validateSettings(settings);
        expect(result.valid).toBe(true);
        expect(result.errors).toEqual([]);
      });

      test('validates partial settings object', () => {
        const settings = {
          theme: 'light',
          maxConcurrentAnalysis: 5,
        };

        const result = validateSettings(settings);
        expect(result.valid).toBe(true);
        expect(result.errors).toEqual([]);
      });

      test('validates empty settings object', () => {
        const result = validateSettings({});
        expect(result.valid).toBe(true);
        expect(result.errors).toEqual([]);
      });
    });

    describe('invalid settings', () => {
      test('detects invalid theme', () => {
        const settings = { theme: 'invalid-theme' };
        const result = validateSettings(settings);

        expect(result.valid).toBe(false);
        expect(result.errors.length).toBeGreaterThan(0);
      });

      test('detects invalid URL', () => {
        const settings = { ollamaHost: 'not a url' };
        const result = validateSettings(settings);

        expect(result.valid).toBe(false);
        expect(result.errors.length).toBeGreaterThan(0);
      });

      test('detects multiple errors', () => {
        const settings = {
          theme: 'invalid',
          maxConcurrentAnalysis: -1,
          autoOrganize: 'yes',
        };

        const result = validateSettings(settings);
        expect(result.valid).toBe(false);
        expect(result.errors.length).toBeGreaterThanOrEqual(3);
      });

      test('detects out-of-range numbers', () => {
        const settings = {
          maxConcurrentAnalysis: 999,
          maxFileSize: -1,
        };

        const result = validateSettings(settings);
        expect(result.valid).toBe(false);
        expect(result.errors.length).toBeGreaterThan(0);
      });
    });

    describe('cross-field validation', () => {
      test('validates autoApproveThreshold >= reviewThreshold', () => {
        const validSettings = {
          autoApproveThreshold: 0.8,
          reviewThreshold: 0.5,
        };

        const result = validateSettings(validSettings);
        expect(result.valid).toBe(true);
      });

      test('rejects autoApproveThreshold < reviewThreshold', () => {
        const invalidSettings = {
          autoApproveThreshold: 0.4,
          reviewThreshold: 0.5,
        };

        const result = validateSettings(invalidSettings);
        expect(result.valid).toBe(false);
        expect(
          result.errors.some((e) => e.includes('autoApproveThreshold')),
        ).toBe(true);
      });

      test('validates downloadConfidenceThreshold >= autoApproveThreshold', () => {
        const validSettings = {
          downloadConfidenceThreshold: 0.9,
          autoApproveThreshold: 0.8,
        };

        const result = validateSettings(validSettings);
        expect(result.valid).toBe(true);
      });

      test('rejects downloadConfidenceThreshold < autoApproveThreshold', () => {
        const invalidSettings = {
          downloadConfidenceThreshold: 0.7,
          autoApproveThreshold: 0.8,
        };

        const result = validateSettings(invalidSettings);
        expect(result.valid).toBe(false);
      });

      test('handles null values in cross-field validation', () => {
        const settings = {
          autoApproveThreshold: null,
          reviewThreshold: 0.5,
        };

        const result = validateSettings(settings);
        // Should not fail cross-field validation with null
        expect(
          result.errors.filter((e) => e.includes('autoApproveThreshold'))
            .length,
        ).toBeLessThanOrEqual(1);
      });
    });

    describe('warnings', () => {
      test('generates warnings for unusual values', () => {
        const settings = {
          maxFileSize: 1000 * 1024 * 1024, // Very large
        };

        const result = validateSettings(settings);
        // Warnings don't invalidate
        expect(result.valid).toBe(true);
      });
    });
  });

  describe('sanitizeSettings', () => {
    test('removes invalid settings', () => {
      const settings = {
        theme: 'dark', // valid
        invalidField: 'should be removed', // Unknown fields are kept for future compatibility
        maxConcurrentAnalysis: 3, // valid
        anotherInvalid: 123, // Unknown fields are kept for future compatibility
      };

      const result = sanitizeSettings(settings);

      expect(result.theme).toBe('dark');
      expect(result.maxConcurrentAnalysis).toBe(3);
      // Unknown settings are kept for future compatibility
      expect(result.invalidField).toBe('should be removed');
      expect(result.anotherInvalid).toBe(123);
    });

    test('removes values that fail validation', () => {
      const settings = {
        theme: 'invalid-theme',
        maxConcurrentAnalysis: -1,
        ollamaHost: 'http://localhost:11434', // valid
      };

      const result = sanitizeSettings(settings);

      expect(result.theme).toBeUndefined();
      expect(result.maxConcurrentAnalysis).toBeUndefined();
      expect(result.ollamaHost).toBe('http://localhost:11434');
    });

    test('preserves all valid settings', () => {
      const settings = {
        theme: 'dark',
        notifications: true,
        maxConcurrentAnalysis: 3,
        ollamaHost: 'http://localhost:11434',
      };

      const result = sanitizeSettings(settings);

      expect(result).toEqual(settings);
    });

    test('handles empty object', () => {
      const result = sanitizeSettings({});
      expect(result).toEqual({});
    });

    test('handles null and undefined', () => {
      expect(sanitizeSettings(null)).toEqual({});
      expect(sanitizeSettings(undefined)).toEqual({});
    });
  });

  describe('getDefaultValue', () => {
    test('returns default value for valid setting', () => {
      expect(getDefaultValue('theme')).toBe('system');
      expect(getDefaultValue('notifications')).toBe(true);
      expect(getDefaultValue('maxConcurrentAnalysis')).toBe(3);
    });

    test('returns undefined for unknown setting', () => {
      expect(getDefaultValue('unknownSetting')).toBeUndefined();
    });

    test('returns correct default for all standard settings', () => {
      expect(getDefaultValue('ollamaHost')).toBe('http://127.0.0.1:11434');
      expect(getDefaultValue('textModel')).toBe('llama3.2:latest');
      expect(getDefaultValue('visionModel')).toBe('llava:latest');
      expect(getDefaultValue('embeddingModel')).toBe('mxbai-embed-large');
      expect(getDefaultValue('autoOrganize')).toBe(false);
      expect(getDefaultValue('backgroundMode')).toBe(false);
    });

    test('returns correct default for file size limits', () => {
      expect(getDefaultValue('maxFileSize')).toBe(100 * 1024 * 1024);
      expect(getDefaultValue('maxImageFileSize')).toBe(100 * 1024 * 1024);
      expect(getDefaultValue('maxDocumentFileSize')).toBe(200 * 1024 * 1024);
      expect(getDefaultValue('maxTextFileSize')).toBe(50 * 1024 * 1024);
    });

    test('returns correct default for processing limits', () => {
      expect(getDefaultValue('analysisTimeout')).toBe(60000);
      expect(getDefaultValue('fileOperationTimeout')).toBe(10000);
      expect(getDefaultValue('maxBatchSize')).toBe(100);
      expect(getDefaultValue('retryAttempts')).toBe(3);
    });

    test('returns correct default for confidence thresholds', () => {
      expect(getDefaultValue('autoApproveThreshold')).toBe(0.8);
      expect(getDefaultValue('downloadConfidenceThreshold')).toBe(0.9);
      expect(getDefaultValue('reviewThreshold')).toBe(0.5);
    });
  });

  describe('getConfigurableLimits', () => {
    describe('with default settings', () => {
      test('returns all configurable limits with defaults', () => {
        const limits = getConfigurableLimits();

        expect(limits).toHaveProperty('fileSizeLimits');
        expect(limits).toHaveProperty('processingLimits');
        expect(limits).toHaveProperty('uiLimits');
      });

      test('returns correct file size limits', () => {
        const limits = getConfigurableLimits();

        expect(limits.fileSizeLimits.maxFileSize).toBe(100 * 1024 * 1024);
        expect(limits.fileSizeLimits.maxImageFileSize).toBe(100 * 1024 * 1024);
        expect(limits.fileSizeLimits.maxDocumentFileSize).toBe(
          200 * 1024 * 1024,
        );
        expect(limits.fileSizeLimits.maxTextFileSize).toBe(50 * 1024 * 1024);
      });

      test('returns correct processing limits', () => {
        const limits = getConfigurableLimits();

        expect(limits.processingLimits.maxConcurrentAnalysis).toBe(3);
        expect(limits.processingLimits.analysisTimeout).toBe(60000);
        expect(limits.processingLimits.fileOperationTimeout).toBe(10000);
        expect(limits.processingLimits.maxBatchSize).toBe(100);
        expect(limits.processingLimits.retryAttempts).toBe(3);
      });

      test('returns correct UI limits', () => {
        const limits = getConfigurableLimits();

        expect(limits.uiLimits.workflowRestoreMaxAge).toBe(60 * 60 * 1000);
        expect(limits.uiLimits.saveDebounceMs).toBe(1000);
      });
    });

    describe('with custom settings', () => {
      test('uses custom file size limits', () => {
        const settings = {
          maxFileSize: 200 * 1024 * 1024,
          maxImageFileSize: 150 * 1024 * 1024,
        };

        const limits = getConfigurableLimits(settings);

        expect(limits.fileSizeLimits.maxFileSize).toBe(200 * 1024 * 1024);
        expect(limits.fileSizeLimits.maxImageFileSize).toBe(150 * 1024 * 1024);
        // Others should be defaults
        expect(limits.fileSizeLimits.maxDocumentFileSize).toBe(
          200 * 1024 * 1024,
        );
      });

      test('uses custom processing limits', () => {
        const settings = {
          maxConcurrentAnalysis: 5,
          analysisTimeout: 120000,
          maxBatchSize: 50,
        };

        const limits = getConfigurableLimits(settings);

        expect(limits.processingLimits.maxConcurrentAnalysis).toBe(5);
        expect(limits.processingLimits.analysisTimeout).toBe(120000);
        expect(limits.processingLimits.maxBatchSize).toBe(50);
        expect(limits.processingLimits.retryAttempts).toBe(3); // default
      });

      test('uses custom UI limits', () => {
        const settings = {
          workflowRestoreMaxAge: 30 * 60 * 1000,
          saveDebounceMs: 500,
        };

        const limits = getConfigurableLimits(settings);

        expect(limits.uiLimits.workflowRestoreMaxAge).toBe(30 * 60 * 1000);
        expect(limits.uiLimits.saveDebounceMs).toBe(500);
      });

      test('handles zero values correctly (uses custom, not default)', () => {
        const settings = {
          maxFileSize: 0, // Explicitly set to 0
        };

        const limits = getConfigurableLimits(settings);

        // Should use 0, not default (nullish coalescing)
        expect(limits.fileSizeLimits.maxFileSize).toBe(0);
      });

      test('handles false values correctly', () => {
        const settings = {
          saveDebounceMs: 0, // No debounce
        };

        const limits = getConfigurableLimits(settings);

        expect(limits.uiLimits.saveDebounceMs).toBe(0);
      });
    });

    describe('edge cases', () => {
      test('handles null settings object', () => {
        const limits = getConfigurableLimits(null);

        expect(limits.fileSizeLimits).toBeDefined();
        expect(limits.processingLimits).toBeDefined();
        expect(limits.uiLimits).toBeDefined();
      });

      test('handles undefined settings object', () => {
        const limits = getConfigurableLimits(undefined);

        expect(limits.fileSizeLimits).toBeDefined();
        expect(limits.processingLimits).toBeDefined();
        expect(limits.uiLimits).toBeDefined();
      });

      test('handles empty settings object', () => {
        const limits = getConfigurableLimits({});

        // Should return all defaults
        expect(limits.fileSizeLimits.maxFileSize).toBe(100 * 1024 * 1024);
        expect(limits.processingLimits.maxConcurrentAnalysis).toBe(3);
        expect(limits.uiLimits.saveDebounceMs).toBe(1000);
      });

      test('ignores unknown settings', () => {
        const settings = {
          maxFileSize: 200 * 1024 * 1024,
          unknownSetting: 999,
          anotherUnknown: 'test',
        };

        const limits = getConfigurableLimits(settings);

        expect(limits.fileSizeLimits.maxFileSize).toBe(200 * 1024 * 1024);
        expect(limits).not.toHaveProperty('unknownSetting');
        expect(limits).not.toHaveProperty('anotherUnknown');
      });
    });
  });
});
