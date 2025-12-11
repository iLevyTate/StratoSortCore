const {
  ConfigValidationError,
  parseEnvValue,
  getEnvVar,
  validateValue
} = require('../src/shared/config/configValidation');

describe('configValidation', () => {
  afterEach(() => {
    delete process.env.TEST_ENV_A;
    delete process.env.TEST_ENV_B;
  });

  test('parseEnvValue handles boolean, number, enum, array and falls back on invalid', () => {
    expect(parseEnvValue('yes', { type: 'boolean' })).toBe(true);
    expect(parseEnvValue('123', { type: 'number' })).toBe(123);
    expect(parseEnvValue('bad', { type: 'enum', values: ['good'] })).toBeUndefined();

    expect(parseEnvValue('["a","b"]', { type: 'array' })).toEqual(['a', 'b']);
    expect(parseEnvValue('a,b,c', { type: 'array' })).toEqual(['a', 'b', 'c']);
  });

  test('getEnvVar returns first matching env var from list', () => {
    process.env.TEST_ENV_B = 'value-b';
    process.env.TEST_ENV_A = 'value-a';
    expect(getEnvVar(['MISSING', 'TEST_ENV_B', 'TEST_ENV_A'])).toBe('value-b');
  });

  test('validateValue enforces required, number bounds, pattern, and url', () => {
    expect(validateValue('key', undefined, { type: 'string', required: true }).valid).toBe(false);

    const numTooLow = validateValue('num', -1, { type: 'number', min: 0, max: 10 });
    expect(numTooLow.valid).toBe(false);

    const patternFail = validateValue('pat', 'abc$', { type: 'string', pattern: /^[a-z]+$/ });
    expect(patternFail.valid).toBe(false);

    const urlValid = validateValue('url', 'http://localhost:1234', { type: 'url' });
    expect(urlValid.valid).toBe(true);
  });

  test('ConfigValidationError formats message', () => {
    const err = new ConfigValidationError('TEST.KEY', 'bad', 'reason');
    expect(err.message).toMatch(/TEST.KEY/);
    expect(err.value).toBe('bad');
  });
});
