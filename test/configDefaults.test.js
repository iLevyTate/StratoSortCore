const {
  getEnvOrDefault,
  getEnvBool,
  getEnvInt,
  validateServiceUrl,
  validateEnvironment,
  SERVICE_URLS
} = require('../src/shared/configDefaults');

describe('configDefaults', () => {
  const originalEnv = { ...process.env };
  let warnSpy;

  beforeEach(() => {
    jest.resetModules();
    Object.assign(process.env, originalEnv);
    const { logger } = require('../src/shared/logger');
    warnSpy = jest.spyOn(logger, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    Object.keys(process.env).forEach((k) => {
      if (!(k in originalEnv)) delete process.env[k];
    });
    Object.assign(process.env, originalEnv);
    warnSpy?.mockRestore();
  });

  describe('env helpers', () => {
    test('getEnvOrDefault returns default for missing/empty and value when set', () => {
      delete process.env.TEST_KEY;
      expect(getEnvOrDefault('TEST_KEY', 'fallback')).toBe('fallback');
      process.env.TEST_KEY = '';
      expect(getEnvOrDefault('TEST_KEY', 'fallback')).toBe('fallback');
      process.env.TEST_KEY = 'value';
      expect(getEnvOrDefault('TEST_KEY', 'fallback')).toBe('value');
    });

    test('getEnvBool parses truthy strings', () => {
      process.env.BOOL_KEY = 'yes';
      expect(getEnvBool('BOOL_KEY', false)).toBe(true);
      process.env.BOOL_KEY = '1';
      expect(getEnvBool('BOOL_KEY', false)).toBe(true);
      process.env.BOOL_KEY = 'false';
      expect(getEnvBool('BOOL_KEY', true)).toBe(false);
      delete process.env.BOOL_KEY;
      expect(getEnvBool('BOOL_KEY', true)).toBe(true);
    });

    test('getEnvInt parses numbers and falls back on invalid', () => {
      process.env.INT_KEY = '42';
      expect(getEnvInt('INT_KEY', 5)).toBe(42);
      process.env.INT_KEY = 'abc';
      expect(getEnvInt('INT_KEY', 5)).toBe(5);
      delete process.env.INT_KEY;
      expect(getEnvInt('INT_KEY', 7)).toBe(7);
    });
  });

  describe('validateServiceUrl', () => {
    test('rejects invalid protocol', () => {
      const result = validateServiceUrl('ftp://example.com');
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/Invalid protocol/i);
    });

    test('enforces https when required', () => {
      const result = validateServiceUrl('http://example.com', { requireHttps: true });
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/HTTPS protocol is required/i);
    });

    test('rejects disallowed port', () => {
      const result = validateServiceUrl('http://example.com:1234', { allowedPorts: [80] });
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/not in the list of allowed ports/i);
    });

    test('accepts valid url and normalizes', () => {
      const result = validateServiceUrl('https://example.com:443');
      expect(result.valid).toBe(true);
      expect(result.protocol).toBe('https');
      expect(result.port).toBe(443);
    });
  });

  describe('validateEnvironment', () => {
    test('produces warnings for unusual NODE_ENV', () => {
      process.env.NODE_ENV = 'weird';
      const report = validateEnvironment();
      expect(report.valid).toBe(true);
      expect(report.warnings.some((w) => w.includes('NODE_ENV'))).toBe(true);
      expect(report.config.nodeEnv).toBeDefined();
    });

    test('returns defaults when env is unset', () => {
      const report = validateEnvironment();
      expect(report.valid).toBe(true);
      expect(report.config.nodeEnv).toBeDefined();
      expect(SERVICE_URLS.MODEL_DOWNLOAD_BASE).toBeDefined();
    });
  });
});
