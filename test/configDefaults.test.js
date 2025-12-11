const { logger } = require('../src/shared/logger');
const {
  getEnvOrDefault,
  getEnvBool,
  getEnvInt,
  validateServiceUrl,
  getValidatedChromaServerUrl,
  getValidatedOllamaHost,
  validateEnvironment,
  SERVICE_URLS
} = require('../src/shared/configDefaults');

describe('configDefaults', () => {
  const originalEnv = { ...process.env };
  let warnSpy;

  beforeEach(() => {
    jest.resetModules();
    Object.assign(process.env, originalEnv);
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

  describe('validated URLs with defaults', () => {
    test('getValidatedChromaServerUrl falls back on invalid env and logs warning', () => {
      process.env.CHROMA_SERVER_URL = 'ftp://bad-host';
      const result = getValidatedChromaServerUrl();
      expect(result.valid).toBe(false);
      expect(result.isDefault).toBe(true);
      expect(result.url).toBe(SERVICE_URLS.CHROMA_SERVER_URL);
      expect(warnSpy).toHaveBeenCalled();
    });

    test('getValidatedOllamaHost accepts valid env and preserves port', () => {
      process.env.OLLAMA_HOST = 'http://localhost:3200';
      const result = getValidatedOllamaHost();
      expect(result.valid).toBe(true);
      expect(result.isDefault).toBe(false);
      expect(result.port).toBe(3200);
      expect(result.url).toContain('localhost:3200');
    });
  });

  describe('validateEnvironment', () => {
    test('produces warnings for unusual NODE_ENV and invalid URLs', () => {
      process.env.NODE_ENV = 'weird';
      process.env.CHROMA_SERVER_URL = 'http://example.com:99999';
      process.env.OLLAMA_HOST = 'notaurl';
      const report = validateEnvironment();
      expect(report.valid).toBe(true);
      expect(report.warnings.some((w) => w.includes('NODE_ENV'))).toBe(true);
      expect(report.warnings.some((w) => w.toLowerCase().includes('chroma'))).toBe(true);
      expect(report.warnings.some((w) => w.toLowerCase().includes('ollama'))).toBe(true);
      expect(report.config.chromaServerUrl).toBeDefined();
      expect(report.config.ollamaHost).toBeDefined();
    });

    test('returns defaults when env is unset', () => {
      delete process.env.CHROMA_SERVER_URL;
      delete process.env.OLLAMA_HOST;
      const report = validateEnvironment();
      expect(report.valid).toBe(true);
      expect(report.config.chromaServerUrl).toBe(SERVICE_URLS.CHROMA_SERVER_URL);
      expect(report.config.ollamaHost).toBe(SERVICE_URLS.OLLAMA_HOST);
    });
  });
});
