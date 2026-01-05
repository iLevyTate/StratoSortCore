/**
 * Tests for shared/validationConstants
 * Ensures the centralized validation rules behave as expected.
 */

const {
  THEME_VALUES,
  LOGGING_LEVELS,
  NUMERIC_LIMITS,
  URL_PATTERN,
  LENIENT_URL_PATTERN,
  MODEL_NAME_PATTERN,
  MAX_MODEL_NAME_LENGTH,
  isValidTheme,
  isValidLoggingLevel,
  isValidNumericSetting,
  isValidUrl,
  isValidModelName
} = require('../src/shared/validationConstants');

describe('validationConstants', () => {
  test('exports expected enums', () => {
    expect(THEME_VALUES).toEqual(expect.arrayContaining(['light', 'dark', 'system']));
    expect(LOGGING_LEVELS).toEqual(expect.arrayContaining(['error', 'warn', 'info', 'debug']));
  });

  test('exports numeric limits', () => {
    expect(NUMERIC_LIMITS.cacheSize).toEqual({ min: 0, max: 100000 });
    expect(NUMERIC_LIMITS.maxBatchSize).toEqual({ min: 1, max: 1000 });
  });

  test('exports patterns', () => {
    expect(URL_PATTERN).toBeInstanceOf(RegExp);
    expect(LENIENT_URL_PATTERN).toBeInstanceOf(RegExp);
    expect(MODEL_NAME_PATTERN).toBeInstanceOf(RegExp);
    expect(typeof MAX_MODEL_NAME_LENGTH).toBe('number');
  });

  describe('isValidTheme', () => {
    test('accepts valid themes', () => {
      for (const t of THEME_VALUES) {
        expect(isValidTheme(t)).toBe(true);
      }
    });

    test('rejects invalid themes', () => {
      expect(isValidTheme('rainbow')).toBe(false);
      expect(isValidTheme(null)).toBe(false);
    });
  });

  describe('isValidLoggingLevel', () => {
    test('accepts valid levels', () => {
      for (const level of LOGGING_LEVELS) {
        expect(isValidLoggingLevel(level)).toBe(true);
      }
    });

    test('rejects invalid levels', () => {
      expect(isValidLoggingLevel('verbose')).toBe(false);
      expect(isValidLoggingLevel(1)).toBe(false);
    });
  });

  describe('isValidNumericSetting', () => {
    test('validates cacheSize', () => {
      expect(isValidNumericSetting('cacheSize', 0)).toBe(true);
      expect(isValidNumericSetting('cacheSize', 100000)).toBe(true);
      expect(isValidNumericSetting('cacheSize', -1)).toBe(false);
      expect(isValidNumericSetting('cacheSize', 100001)).toBe(false);
      expect(isValidNumericSetting('cacheSize', 1.5)).toBe(false);
    });

    test('validates maxBatchSize', () => {
      expect(isValidNumericSetting('maxBatchSize', 1)).toBe(true);
      expect(isValidNumericSetting('maxBatchSize', 1000)).toBe(true);
      expect(isValidNumericSetting('maxBatchSize', 0)).toBe(false);
      expect(isValidNumericSetting('maxBatchSize', 1001)).toBe(false);
    });

    test('rejects unknown fields', () => {
      expect(isValidNumericSetting('unknown', 1)).toBe(false);
    });
  });

  describe('isValidUrl', () => {
    test('validates strict URLs (requires protocol)', () => {
      expect(isValidUrl('http://localhost:11434')).toBe(true);
      expect(isValidUrl('https://127.0.0.1:11434/api/tags')).toBe(true);
      expect(isValidUrl('localhost:11434')).toBe(false);
    });

    test('validates lenient URLs (protocol optional)', () => {
      expect(isValidUrl('localhost:11434', true)).toBe(true);
      expect(isValidUrl('http://localhost:11434', true)).toBe(true);
      expect(isValidUrl('', true)).toBe(false);
    });
  });

  describe('isValidModelName', () => {
    test('accepts valid model names', () => {
      expect(isValidModelName('llama3:latest')).toBe(true);
      expect(isValidModelName('model@latest')).toBe(true);
      expect(isValidModelName('a')).toBe(true);
    });

    test('rejects invalid model names', () => {
      expect(isValidModelName('model with spaces')).toBe(false);
      expect(isValidModelName('')).toBe(false);
      expect(isValidModelName('a'.repeat(MAX_MODEL_NAME_LENGTH + 1))).toBe(false);
    });
  });
});
