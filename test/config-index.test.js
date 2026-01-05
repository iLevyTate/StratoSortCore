// Mock ConfigurationManager
const mockGet = jest.fn();
const mockGetCategory = jest.fn();
const mockGetAll = jest.fn();
const mockIsDevelopment = jest.fn();
const mockIsProduction = jest.fn();
const mockIsTest = jest.fn();
const mockIsCI = jest.fn();
const mockValidate = jest.fn();
const mockDump = jest.fn();
const mockGetSchema = jest.fn();
const mockOverride = jest.fn();
const mockReset = jest.fn();
const mockLoad = jest.fn();
const mockGetDeprecationWarnings = jest.fn().mockReturnValue([]);
const mockGetValidationErrors = jest.fn().mockReturnValue([]);

jest.mock('../src/shared/config/ConfigurationManager', () => {
  return jest.fn().mockImplementation(() => ({
    get: mockGet,
    getCategory: mockGetCategory,
    getAll: mockGetAll,
    isDevelopment: mockIsDevelopment,
    isProduction: mockIsProduction,
    isTest: mockIsTest,
    isCI: mockIsCI,
    validate: mockValidate,
    dump: mockDump,
    getSchema: mockGetSchema,
    override: mockOverride,
    reset: mockReset,
    load: mockLoad,
    getDeprecationWarnings: mockGetDeprecationWarnings,
    getValidationErrors: mockGetValidationErrors
  }));
});

// Mock logger
jest.mock('../src/shared/logger', () => ({
  logger: {
    warn: jest.fn()
  }
}));

describe('Config Index (Convenience Methods)', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  test('initializes and loads config on import', () => {
    require('../src/shared/config/index');
    expect(mockLoad).toHaveBeenCalled();
  });

  test('exports convenience methods that delegate to manager', () => {
    const configIndex = require('../src/shared/config/index');

    configIndex.get('path', 'default');
    expect(mockGet).toHaveBeenCalledWith('path', 'default');

    configIndex.getCategory('cat');
    expect(mockGetCategory).toHaveBeenCalledWith('cat');

    configIndex.getAll();
    expect(mockGetAll).toHaveBeenCalled();

    configIndex.isDevelopment();
    expect(mockIsDevelopment).toHaveBeenCalled();

    configIndex.isProduction();
    expect(mockIsProduction).toHaveBeenCalled();

    configIndex.isTest();
    expect(mockIsTest).toHaveBeenCalled();

    configIndex.isCI();
    expect(mockIsCI).toHaveBeenCalled();

    configIndex.validate();
    expect(mockValidate).toHaveBeenCalled();

    configIndex.dump({ option: true });
    expect(mockDump).toHaveBeenCalledWith({ option: true });

    configIndex.getSchema();
    expect(mockGetSchema).toHaveBeenCalled();

    configIndex.override('path', 'value');
    expect(mockOverride).toHaveBeenCalledWith('path', 'value');

    configIndex.reset();
    expect(mockReset).toHaveBeenCalled();
  });

  test('exports schema and types', () => {
    const configIndex = require('../src/shared/config/index');
    expect(configIndex.CONFIG_SCHEMA).toBeDefined();
    expect(configIndex.ConfigValidationError).toBeDefined();
    expect(configIndex.SENSITIVE_KEYS).toBeDefined();
    expect(configIndex.DEPRECATED_MAPPINGS).toBeDefined();
  });

  test('logs warnings on load if present', () => {
    // Re-mock with warnings
    const mockWarnings = ['warning1'];
    const mockErrors = ['error1'];

    jest.doMock('../src/shared/config/ConfigurationManager', () => {
      return jest.fn().mockImplementation(() => ({
        load: jest.fn(),
        getDeprecationWarnings: jest.fn().mockReturnValue(mockWarnings),
        getValidationErrors: jest.fn().mockReturnValue(mockErrors),
        get: jest.fn()
      }));
    });

    // Need to re-mock logger to ensure we catch the calls on the fresh require
    const mockWarn = jest.fn();
    jest.doMock('../src/shared/logger', () => ({
      logger: { warn: mockWarn }
    }));

    require('../src/shared/config/index');

    expect(mockWarn).toHaveBeenCalledWith(
      expect.stringContaining('Deprecation warnings'),
      mockWarnings
    );
    expect(mockWarn).toHaveBeenCalledWith(expect.stringContaining('Validation errors'), mockErrors);
  });
});
