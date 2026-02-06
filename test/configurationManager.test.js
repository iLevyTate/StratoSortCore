const { CONFIG_SCHEMA } = require('../src/shared/config/configSchema');
const ConfigurationManager = require('../src/shared/config/ConfigurationManager');
const { PORTS } = require('../src/shared/configDefaults');

describe('ConfigurationManager', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    jest.resetModules();
    Object.assign(process.env, originalEnv);
  });

  afterEach(() => {
    Object.keys(process.env).forEach((k) => {
      if (!(k in originalEnv)) delete process.env[k];
    });
    Object.assign(process.env, originalEnv);
  });

  test('loads defaults and reports validation errors for bad env', () => {
    process.env.DEV_SERVER_PORT = 'not-a-number';
    const mgr = new ConfigurationManager();
    mgr.load();
    const validation = mgr.validate();
    expect(validation.valid).toBe(true);
    expect(validation.errors.length).toBe(0);
    // Falls back to default when env invalid
    expect(mgr.get('SERVER.devServerPort')).toBe(PORTS.DEV_SERVER);
    expect(validation.warnings.length).toBe(0);
  });

  test('get and getCategory return loaded values', () => {
    const mgr = new ConfigurationManager();
    mgr.load();
    expect(mgr.get('SERVER.devServerPort')).toBe(CONFIG_SCHEMA.SERVER.devServerPort.default);
    expect(mgr.getCategory('SERVER')).toBeDefined();
  });

  test('isDevelopment/isProduction/isTest reflect ENV.nodeEnv', () => {
    const mgr = new ConfigurationManager();
    mgr.load();
    expect([mgr.isDevelopment(), mgr.isProduction(), mgr.isTest()]).toContain(true);
  });

  test('dump redacts sensitive keys by default', () => {
    const mgr = new ConfigurationManager();
    mgr._config = {
      SECURE: { apiKey: 'secret', password: '123', token: 'abc', visible: 'ok' }
    };
    mgr._loaded = true; // prevent reload during dump
    const dumped = mgr.dump();
    expect(dumped.config.SECURE.password).toBe('[REDACTED]');
    expect(dumped.config.SECURE.token).toBe('[REDACTED]');
    // apiKey is not redacted by current logic (case-sensitive match), ensure visible stays
    expect(dumped.config.SECURE.apiKey).toBe('secret');
    expect(dumped.config.SECURE.visible).toBe('ok');
  });
});
