const {
  validateSettings,
  sanitizeSettings,
  getDefaultValue,
  getConfigurableLimits
} = require('../src/shared/settingsValidation');
const { DEFAULT_SETTINGS } = require('../src/shared/defaultSettings');

describe('settingsValidation', () => {
  test('validateSettings flags invalid path-like values and unknown keys', () => {
    const result = validateSettings({
      defaultSmartFolderLocation: '../unsafe',
      unknownFutureFlag: true
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining('defaultSmartFolderLocation must be an absolute path')
      ])
    );
    expect(result.warnings).toContain('Unknown setting: unknownFutureFlag');
  });

  test('validateSettings detects prototype pollution keys as warnings', () => {
    const polluted = Object.create(null);
    polluted.__proto__ = 'polluted';

    const result = validateSettings(polluted);
    expect(result.warnings).toContain('Rejected unsafe key: __proto__');
  });

  test('sanitizeSettings clamps threshold and drops unsafe/deprecated keys', () => {
    const settings = Object.create(null);
    settings.confidenceThreshold = 9;
    settings.defaultSmartFolderLocation = '../unsafe';
    settings.theme = 'dark';
    settings.dependencyWizardShown = true;
    settings.__proto__ = 'polluted';
    settings.customFutureSetting = 'keep-me';

    const sanitized = sanitizeSettings(settings);

    expect(sanitized.confidenceThreshold).toBe(1);
    expect(sanitized.defaultSmartFolderLocation).toBeUndefined();
    expect(sanitized.theme).toBeUndefined();
    expect(sanitized.dependencyWizardShown).toBeUndefined();
    expect(sanitized.customFutureSetting).toBeUndefined();
    expect(Object.getPrototypeOf(sanitized)).toBe(null);
  });

  test('getDefaultValue and getConfigurableLimits use shared defaults', () => {
    expect(getDefaultValue('maxBatchSize')).toBe(DEFAULT_SETTINGS.maxBatchSize);

    const limits = getConfigurableLimits({
      maxBatchSize: 20,
      saveDebounceMs: 1500
    });

    expect(limits.processingLimits.maxBatchSize).toBe(20);
    expect(limits.uiLimits.saveDebounceMs).toBe(1500);
    expect(limits.fileSizeLimits.maxTextFileSize).toBe(DEFAULT_SETTINGS.maxTextFileSize);
  });
});
