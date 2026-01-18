/**
 * @jest-environment node
 */

const {
  VALIDATION_RULES,
  validateSettings,
  validateSetting,
  sanitizeSettings,
  getDefaultValue,
  getConfigurableLimits
} = require('../src/shared/settingsValidation');

describe('settingsValidation security', () => {
  test('rejects prototype-pollution keys via warnings', () => {
    // Using JSON.parse to create an object with __proto__ as an actual own property
    // (object literal syntax triggers the __proto__ setter and doesn't create an own property)
    const input = JSON.parse('{"__proto__": "oops", "notifications": true}');
    const result = validateSettings(input);

    expect(result.valid).toBe(true);
    expect(result.warnings).toEqual(
      expect.arrayContaining([expect.stringContaining('unsafe key')])
    );
    expect(result.errors).toHaveLength(0);
  });

  test('does not false-positive on inherited __proto__', () => {
    // Object literal syntax doesn't create __proto__ as an own property
    const input = { notifications: true };
    const result = validateSettings(input);

    expect(result.valid).toBe(true);
    // Should NOT have any __proto__ warnings since it's not an own property
    expect(result.warnings.filter((w) => w.includes('__proto__'))).toHaveLength(0);
  });

  test('sanitizeSettings drops prototype-pollution keys', () => {
    const input = { constructor: 'bad', theme: 'light', notifications: true, maxBatchSize: 10 };
    const sanitized = sanitizeSettings(input);

    expect(sanitized.constructor).toBeUndefined();
    // Theme is a deprecated/removed setting and should be dropped.
    expect(sanitized.theme).toBeUndefined();
    expect(sanitized.notifications).toBe(true);
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
      expect(VALIDATION_RULES.ollamaHost).toBeDefined();
      expect(VALIDATION_RULES.maxFileSize).toBeDefined();
      expect(VALIDATION_RULES.maxConcurrentAnalysis).toBeDefined();
    });
  });

  describe('validateSetting', () => {
    describe('embedding model validation', () => {
      test('accepts only the vetted embedding model', () => {
        const errors = validateSetting(
          'embeddingModel',
          'mxbai-embed-large',
          VALIDATION_RULES.embeddingModel
        );
        expect(errors).toHaveLength(0);
      });

      test('rejects other models to protect Chroma setup', () => {
        const errors = validateSetting(
          'embeddingModel',
          'llama3:latest',
          VALIDATION_RULES.embeddingModel
        );
        expect(errors.length).toBeGreaterThan(0);
      });
    });

    describe('numeric validation', () => {
      test('accepts valid numbers within range', () => {
        expect(
          validateSetting('maxConcurrentAnalysis', 3, VALIDATION_RULES.maxConcurrentAnalysis)
        ).toEqual([]);
        expect(
          validateSetting('maxConcurrentAnalysis', 1, VALIDATION_RULES.maxConcurrentAnalysis)
        ).toEqual([]);
        expect(
          validateSetting('maxConcurrentAnalysis', 10, VALIDATION_RULES.maxConcurrentAnalysis)
        ).toEqual([]);
      });

      test('rejects numbers below minimum', () => {
        const errors = validateSetting(
          'maxConcurrentAnalysis',
          0,
          VALIDATION_RULES.maxConcurrentAnalysis
        );
        expect(errors.length).toBeGreaterThan(0);
      });

      test('rejects numbers above maximum', () => {
        const errors = validateSetting(
          'maxConcurrentAnalysis',
          100,
          VALIDATION_RULES.maxConcurrentAnalysis
        );
        expect(errors.length).toBeGreaterThan(0);
      });

      test('rejects non-numeric values', () => {
        const errors = validateSetting(
          'maxConcurrentAnalysis',
          'invalid',
          VALIDATION_RULES.maxConcurrentAnalysis
        );
        expect(errors.length).toBeGreaterThan(0);
      });
    });

    describe('URL validation', () => {
      test('accepts valid URLs', () => {
        expect(
          validateSetting('ollamaHost', 'http://localhost:11434', VALIDATION_RULES.ollamaHost)
        ).toEqual([]);
        expect(
          validateSetting('ollamaHost', 'http://127.0.0.1:8000', VALIDATION_RULES.ollamaHost)
        ).toEqual([]);
        expect(
          validateSetting('ollamaHost', 'https://api.example.com', VALIDATION_RULES.ollamaHost)
        ).toEqual([]);
        // Scheme should be treated case-insensitively (users commonly paste "HTTP://...")
        expect(
          validateSetting('ollamaHost', 'HTTP://localhost:11434', VALIDATION_RULES.ollamaHost)
        ).toEqual([]);
      });

      test('rejects invalid URLs', () => {
        const errors1 = validateSetting('ollamaHost', 'not a url', VALIDATION_RULES.ollamaHost);
        expect(errors1.length).toBeGreaterThan(0);

        const errors2 = validateSetting('ollamaHost', 'ftp://invalid', VALIDATION_RULES.ollamaHost);
        expect(errors2.length).toBeGreaterThan(0);
      });
    });

    describe('boolean validation', () => {
      test('accepts boolean values', () => {
        expect(validateSetting('autoOrganize', true, VALIDATION_RULES.autoOrganize)).toEqual([]);
        expect(validateSetting('autoOrganize', false, VALIDATION_RULES.autoOrganize)).toEqual([]);
      });

      test('rejects non-boolean values', () => {
        const errors = validateSetting('autoOrganize', 'yes', VALIDATION_RULES.autoOrganize);
        expect(errors.length).toBeGreaterThan(0);
      });
    });

    describe('string validation', () => {
      test('accepts valid string values', () => {
        expect(validateSetting('textModel', 'llama3.2:latest', VALIDATION_RULES.textModel)).toEqual(
          []
        );
        expect(validateSetting('textModel', 'gpt-4', VALIDATION_RULES.textModel)).toEqual([]);
      });

      test('rejects non-string values', () => {
        const errors = validateSetting('textModel', 123, VALIDATION_RULES.textModel);
        expect(errors.length).toBeGreaterThan(0);
      });
    });

    describe('naming convention validation', () => {
      test('accepts valid naming conventions', () => {
        const validConventions = [
          'subject-date',
          'date-subject',
          'project-subject-date',
          'category-subject',
          'keep-original'
        ];
        validConventions.forEach((convention) => {
          expect(
            validateSetting('namingConvention', convention, VALIDATION_RULES.namingConvention)
          ).toEqual([]);
        });
      });

      test('rejects invalid naming conventions', () => {
        const errors = validateSetting(
          'namingConvention',
          'invalid-convention',
          VALIDATION_RULES.namingConvention
        );
        expect(errors.length).toBeGreaterThan(0);
      });

      test('accepts valid case conventions', () => {
        const validCases = [
          'kebab-case',
          'snake_case',
          'camelCase',
          'PascalCase',
          'lowercase',
          'UPPERCASE'
        ];
        validCases.forEach((c) => {
          expect(validateSetting('caseConvention', c, VALIDATION_RULES.caseConvention)).toEqual([]);
        });
      });

      test('rejects unsafe separators', () => {
        const errors = validateSetting('separator', '/', VALIDATION_RULES.separator);
        expect(errors.length).toBeGreaterThan(0);
      });
    });

    describe('notification mode validation', () => {
      test('accepts valid notification modes', () => {
        const validModes = ['both', 'ui', 'tray', 'none'];
        validModes.forEach((mode) => {
          expect(
            validateSetting('notificationMode', mode, VALIDATION_RULES.notificationMode)
          ).toEqual([]);
        });
      });

      test('rejects invalid notification mode', () => {
        const errors = validateSetting(
          'notificationMode',
          'telepathy',
          VALIDATION_RULES.notificationMode
        );
        expect(errors.length).toBeGreaterThan(0);
      });
    });

    describe('file size validation', () => {
      test('accepts valid file sizes', () => {
        expect(validateSetting('maxFileSize', 1024 * 1024, VALIDATION_RULES.maxFileSize)).toEqual(
          []
        ); // 1MB minimum
        expect(
          validateSetting('maxFileSize', 100 * 1024 * 1024, VALIDATION_RULES.maxFileSize)
        ).toEqual([]);
      });

      test('rejects negative file sizes', () => {
        const errors = validateSetting('maxFileSize', -1, VALIDATION_RULES.maxFileSize);
        expect(errors.length).toBeGreaterThan(0);
      });

      test('rejects zero file size', () => {
        const errors = validateSetting('maxFileSize', 0, VALIDATION_RULES.maxFileSize);
        expect(errors.length).toBeGreaterThan(0);
      });

      test('rejects extremely large file sizes', () => {
        const errors = validateSetting(
          'maxFileSize',
          10 * 1024 * 1024 * 1024 * 1024,
          VALIDATION_RULES.maxFileSize
        );
        expect(errors.length).toBeGreaterThan(0);
      });
    });

    describe('confidence threshold validation', () => {
      test('accepts valid confidence values (0-1)', () => {
        expect(
          validateSetting('confidenceThreshold', 0.75, VALIDATION_RULES.confidenceThreshold)
        ).toEqual([]);
        expect(
          validateSetting('confidenceThreshold', 0, VALIDATION_RULES.confidenceThreshold)
        ).toEqual([]);
        expect(
          validateSetting('confidenceThreshold', 1, VALIDATION_RULES.confidenceThreshold)
        ).toEqual([]);
      });

      test('rejects confidence below 0', () => {
        const errors = validateSetting(
          'confidenceThreshold',
          -0.1,
          VALIDATION_RULES.confidenceThreshold
        );
        expect(errors.length).toBeGreaterThan(0);
      });

      test('rejects confidence above 1', () => {
        const errors = validateSetting(
          'confidenceThreshold',
          1.5,
          VALIDATION_RULES.confidenceThreshold
        );
        expect(errors.length).toBeGreaterThan(0);
      });
    });
  });

  describe('validateSettings', () => {
    describe('valid settings', () => {
      test('validates complete valid settings object', () => {
        const settings = {
          notifications: true,
          ollamaHost: 'http://localhost:11434',
          textModel: 'llama3.2:latest',
          visionModel: 'llava:latest',
          maxConcurrentAnalysis: 3,
          autoOrganize: false,
          maxFileSize: 100 * 1024 * 1024,
          confidenceThreshold: 0.75
        };

        const result = validateSettings(settings);
        expect(result.valid).toBe(true);
        expect(result.errors).toEqual([]);
      });

      test('validates partial settings object', () => {
        const settings = {
          maxConcurrentAnalysis: 5
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
      test('ignores legacy theme key even if invalid', () => {
        const settings = { theme: 'invalid-theme' };
        const result = validateSettings(settings);

        expect(result.valid).toBe(true);
        expect(result.errors).toEqual([]);
      });

      test('detects invalid URL', () => {
        const settings = { ollamaHost: 'not a url' };
        const result = validateSettings(settings);

        expect(result.valid).toBe(false);
        expect(result.errors.length).toBeGreaterThan(0);
      });

      test('detects multiple errors', () => {
        const settings = {
          maxConcurrentAnalysis: -1,
          autoOrganize: 'yes'
        };

        const result = validateSettings(settings);
        expect(result.valid).toBe(false);
        expect(result.errors.length).toBeGreaterThanOrEqual(2);
      });

      test('detects out-of-range numbers', () => {
        const settings = {
          maxConcurrentAnalysis: 999,
          maxFileSize: -1
        };

        const result = validateSettings(settings);
        expect(result.valid).toBe(false);
        expect(result.errors.length).toBeGreaterThan(0);
      });
    });

    describe('confidence threshold validation', () => {
      test('validates confidenceThreshold within range', () => {
        const validSettings = {
          confidenceThreshold: 0.75
        };

        const result = validateSettings(validSettings);
        expect(result.valid).toBe(true);
      });

      test('rejects confidenceThreshold below 0', () => {
        const invalidSettings = {
          confidenceThreshold: -0.1
        };

        const result = validateSettings(invalidSettings);
        expect(result.valid).toBe(false);
        expect(result.errors.some((e) => e.includes('confidenceThreshold'))).toBe(true);
      });

      test('rejects confidenceThreshold above 1', () => {
        const invalidSettings = {
          confidenceThreshold: 1.5
        };

        const result = validateSettings(invalidSettings);
        expect(result.valid).toBe(false);
      });

      test('handles null values in threshold validation', () => {
        const settings = {
          confidenceThreshold: null
        };

        const result = validateSettings(settings);
        // Null values are skipped (not required)
        expect(result.valid).toBe(true);
      });
    });

    describe('warnings', () => {
      test('generates warnings for unusual values', () => {
        const settings = {
          maxFileSize: 1000 * 1024 * 1024 // Very large
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
        theme: 'dark', // legacy key (should be dropped)
        invalidField: 'should be removed', // Unknown fields are kept for future compatibility
        maxConcurrentAnalysis: 3, // valid
        anotherInvalid: 123 // Unknown fields are kept for future compatibility
      };

      const result = sanitizeSettings(settings);

      expect(result.theme).toBeUndefined();
      expect(result.maxConcurrentAnalysis).toBe(3);
      // Unknown settings are kept for future compatibility
      expect(result.invalidField).toBe('should be removed');
      expect(result.anotherInvalid).toBe(123);
    });

    test('removes values that fail validation', () => {
      const settings = {
        maxConcurrentAnalysis: -1,
        ollamaHost: 'http://localhost:11434' // valid
      };

      const result = sanitizeSettings(settings);

      expect(result.maxConcurrentAnalysis).toBeUndefined();
      expect(result.ollamaHost).toBe('http://localhost:11434');
    });

    test('normalizes string confidence threshold', () => {
      const settings = {
        confidenceThreshold: '0.8'
      };
      const result = sanitizeSettings(settings);
      expect(result.confidenceThreshold).toBe(0.8);
    });

    test('preserves all valid settings', () => {
      const settings = {
        theme: 'dark',
        notifications: true,
        maxConcurrentAnalysis: 3,
        ollamaHost: 'http://localhost:11434'
      };

      const result = sanitizeSettings(settings);

      expect(result).toEqual({
        notifications: true,
        maxConcurrentAnalysis: 3,
        ollamaHost: 'http://localhost:11434'
      });
    });

    test('normalizes common Ollama host inputs (scheme case, backslashes, and paths)', () => {
      const settings = {
        ollamaHost: 'HTTP:\\\\127.0.0.1:11434\\api\\tags'
      };

      const result = sanitizeSettings(settings);
      expect(result.ollamaHost).toBe('http://127.0.0.1:11434');
    });

    test('strips trailing path/query from Ollama host', () => {
      const settings = {
        ollamaHost: 'http://localhost:11434/api/tags?x=1'
      };

      const result = sanitizeSettings(settings);
      expect(result.ollamaHost).toBe('http://localhost:11434');
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
      expect(getDefaultValue('theme')).toBeUndefined();
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

    test('returns correct default for confidence threshold', () => {
      expect(getDefaultValue('confidenceThreshold')).toBe(0.75);
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
        expect(limits.fileSizeLimits.maxDocumentFileSize).toBe(200 * 1024 * 1024);
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
          maxImageFileSize: 150 * 1024 * 1024
        };

        const limits = getConfigurableLimits(settings);

        expect(limits.fileSizeLimits.maxFileSize).toBe(200 * 1024 * 1024);
        expect(limits.fileSizeLimits.maxImageFileSize).toBe(150 * 1024 * 1024);
        // Others should be defaults
        expect(limits.fileSizeLimits.maxDocumentFileSize).toBe(200 * 1024 * 1024);
      });

      test('uses custom processing limits', () => {
        const settings = {
          maxConcurrentAnalysis: 5,
          analysisTimeout: 120000,
          maxBatchSize: 50
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
          saveDebounceMs: 500
        };

        const limits = getConfigurableLimits(settings);

        expect(limits.uiLimits.workflowRestoreMaxAge).toBe(30 * 60 * 1000);
        expect(limits.uiLimits.saveDebounceMs).toBe(500);
      });

      test('handles zero values correctly (uses custom, not default)', () => {
        const settings = {
          maxFileSize: 0 // Explicitly set to 0
        };

        const limits = getConfigurableLimits(settings);

        // Should use 0, not default (nullish coalescing)
        expect(limits.fileSizeLimits.maxFileSize).toBe(0);
      });

      test('handles false values correctly', () => {
        const settings = {
          saveDebounceMs: 0 // No debounce
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
          anotherUnknown: 'test'
        };

        const limits = getConfigurableLimits(settings);

        expect(limits.fileSizeLimits.maxFileSize).toBe(200 * 1024 * 1024);
        expect(limits).not.toHaveProperty('unknownSetting');
        expect(limits).not.toHaveProperty('anotherUnknown');
      });
    });
  });
});
