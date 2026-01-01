/**
 * Tests for Security Configuration
 * Tests path security, settings validation, and IPC security
 */

describe('securityConfig', () => {
  let securityConfig;

  beforeEach(() => {
    jest.resetModules();
    securityConfig = require('../src/shared/securityConfig');
  });

  describe('MAX_PATH_LENGTHS', () => {
    test('defines path lengths for each platform', () => {
      expect(securityConfig.MAX_PATH_LENGTHS.win32).toBe(260);
      expect(securityConfig.MAX_PATH_LENGTHS.linux).toBe(4096);
      expect(securityConfig.MAX_PATH_LENGTHS.darwin).toBe(1024);
    });
  });

  describe('MAX_PATH_DEPTH', () => {
    test('defines maximum path depth', () => {
      expect(securityConfig.MAX_PATH_DEPTH).toBe(100);
    });
  });

  describe('RESERVED_WINDOWS_NAMES', () => {
    test('is a Set', () => {
      expect(securityConfig.RESERVED_WINDOWS_NAMES).toBeInstanceOf(Set);
    });

    test('includes CON', () => {
      expect(securityConfig.RESERVED_WINDOWS_NAMES.has('CON')).toBe(true);
    });

    test('includes PRN', () => {
      expect(securityConfig.RESERVED_WINDOWS_NAMES.has('PRN')).toBe(true);
    });

    test('includes NUL', () => {
      expect(securityConfig.RESERVED_WINDOWS_NAMES.has('NUL')).toBe(true);
    });

    test('includes COM ports', () => {
      for (let i = 1; i <= 9; i++) {
        expect(securityConfig.RESERVED_WINDOWS_NAMES.has(`COM${i}`)).toBe(true);
      }
    });

    test('includes LPT ports', () => {
      for (let i = 1; i <= 9; i++) {
        expect(securityConfig.RESERVED_WINDOWS_NAMES.has(`LPT${i}`)).toBe(true);
      }
    });
  });

  describe('DANGEROUS_PATHS', () => {
    test('defines unix dangerous paths', () => {
      expect(securityConfig.DANGEROUS_PATHS.unix).toContain('/etc');
      expect(securityConfig.DANGEROUS_PATHS.unix).toContain('/sys');
      expect(securityConfig.DANGEROUS_PATHS.unix).toContain('/proc');
    });

    test('defines windows dangerous paths', () => {
      expect(securityConfig.DANGEROUS_PATHS.windows).toContain('C:\\Windows');
      expect(securityConfig.DANGEROUS_PATHS.windows).toContain('C:\\Program Files');
    });

    test('defines darwin dangerous paths', () => {
      expect(securityConfig.DANGEROUS_PATHS.darwin).toContain('/System');
      expect(securityConfig.DANGEROUS_PATHS.darwin).toContain('/Library/System');
    });
  });

  describe('getDangerousPaths', () => {
    test('returns unix paths for linux', () => {
      const paths = securityConfig.getDangerousPaths('linux');
      expect(paths).toContain('/etc');
      expect(paths).not.toContain('C:\\Windows');
    });

    test('returns unix and darwin paths for darwin', () => {
      const paths = securityConfig.getDangerousPaths('darwin');
      expect(paths).toContain('/etc');
      expect(paths).toContain('/System');
    });

    test('returns windows paths for win32', () => {
      const paths = securityConfig.getDangerousPaths('win32');
      expect(paths).toContain('C:\\Windows');
      expect(paths).not.toContain('/etc');
    });

    test('uses current platform by default', () => {
      const paths = securityConfig.getDangerousPaths();
      expect(Array.isArray(paths)).toBe(true);
    });
  });

  describe('PROTOTYPE_POLLUTION_KEYS', () => {
    test('includes __proto__', () => {
      expect(securityConfig.PROTOTYPE_POLLUTION_KEYS).toContain('__proto__');
    });

    test('includes constructor', () => {
      expect(securityConfig.PROTOTYPE_POLLUTION_KEYS).toContain('constructor');
    });

    test('includes prototype', () => {
      expect(securityConfig.PROTOTYPE_POLLUTION_KEYS).toContain('prototype');
    });
  });

  describe('ALLOWED_APP_PATHS', () => {
    test('includes userData', () => {
      expect(securityConfig.ALLOWED_APP_PATHS).toContain('userData');
    });

    test('includes documents', () => {
      expect(securityConfig.ALLOWED_APP_PATHS).toContain('documents');
    });

    test('includes downloads', () => {
      expect(securityConfig.ALLOWED_APP_PATHS).toContain('downloads');
    });

    test('includes home', () => {
      expect(securityConfig.ALLOWED_APP_PATHS).toContain('home');
    });
  });

  describe('SETTINGS_VALIDATION', () => {
    test('has allowedKeys as a Set', () => {
      expect(securityConfig.SETTINGS_VALIDATION.allowedKeys).toBeInstanceOf(Set);
    });

    test('allowedKeys includes common settings', () => {
      expect(securityConfig.SETTINGS_VALIDATION.allowedKeys.has('ollamaHost')).toBe(true);
      expect(securityConfig.SETTINGS_VALIDATION.allowedKeys.has('textModel')).toBe(true);
      expect(securityConfig.SETTINGS_VALIDATION.allowedKeys.has('theme')).toBe(true);
    });

    test('enums has valid theme values', () => {
      expect(securityConfig.SETTINGS_VALIDATION.enums.theme).toContain('light');
      expect(securityConfig.SETTINGS_VALIDATION.enums.theme).toContain('dark');
      expect(securityConfig.SETTINGS_VALIDATION.enums.theme).toContain('system');
      expect(securityConfig.SETTINGS_VALIDATION.enums.theme).toContain('auto');
    });

    test('enums has valid loggingLevel values', () => {
      expect(securityConfig.SETTINGS_VALIDATION.enums.loggingLevel).toContain('error');
      expect(securityConfig.SETTINGS_VALIDATION.enums.loggingLevel).toContain('warn');
      expect(securityConfig.SETTINGS_VALIDATION.enums.loggingLevel).toContain('info');
      expect(securityConfig.SETTINGS_VALIDATION.enums.loggingLevel).toContain('debug');
    });

    test('numericLimits has valid constraints', () => {
      expect(securityConfig.SETTINGS_VALIDATION.numericLimits.cacheSize.min).toBe(0);
      expect(securityConfig.SETTINGS_VALIDATION.numericLimits.cacheSize.max).toBe(100000);
    });

    test('patterns has url regex', () => {
      expect(securityConfig.SETTINGS_VALIDATION.patterns.url).toBeInstanceOf(RegExp);
      expect('http://localhost:11434').toMatch(securityConfig.SETTINGS_VALIDATION.patterns.url);
    });

    test('patterns has modelName regex', () => {
      expect(securityConfig.SETTINGS_VALIDATION.patterns.modelName).toBeInstanceOf(RegExp);
      expect('llama3.2:latest').toMatch(securityConfig.SETTINGS_VALIDATION.patterns.modelName);
    });
  });

  describe('ALLOWED_METADATA_FIELDS', () => {
    test('includes common metadata fields', () => {
      expect(securityConfig.ALLOWED_METADATA_FIELDS).toContain('path');
      expect(securityConfig.ALLOWED_METADATA_FIELDS).toContain('name');
      expect(securityConfig.ALLOWED_METADATA_FIELDS).toContain('model');
      expect(securityConfig.ALLOWED_METADATA_FIELDS).toContain('description');
    });
  });

  describe('RATE_LIMITS', () => {
    test('defines rate limit constants', () => {
      expect(securityConfig.RATE_LIMITS.maxRequestsPerSecond).toBe(200);
      expect(securityConfig.RATE_LIMITS.maxRetries).toBe(5);
      expect(securityConfig.RATE_LIMITS.staleEntryThreshold).toBe(100);
      expect(securityConfig.RATE_LIMITS.staleEntryAge).toBe(60000);
    });
  });

  describe('ALLOWED_RECEIVE_CHANNELS', () => {
    test('is an array', () => {
      expect(Array.isArray(securityConfig.ALLOWED_RECEIVE_CHANNELS)).toBe(true);
    });

    test('includes common receive channels', () => {
      expect(securityConfig.ALLOWED_RECEIVE_CHANNELS).toContain('system-metrics');
      expect(securityConfig.ALLOWED_RECEIVE_CHANNELS).toContain('operation-progress');
      expect(securityConfig.ALLOWED_RECEIVE_CHANNELS).toContain('chromadb-status-changed');
    });
  });

  describe('ALLOWED_SEND_CHANNELS', () => {
    test('is an array', () => {
      expect(Array.isArray(securityConfig.ALLOWED_SEND_CHANNELS)).toBe(true);
    });

    test('includes common send channels', () => {
      expect(securityConfig.ALLOWED_SEND_CHANNELS).toContain('renderer-error-report');
      expect(securityConfig.ALLOWED_SEND_CHANNELS).toContain('startup-continue');
    });
  });
});
