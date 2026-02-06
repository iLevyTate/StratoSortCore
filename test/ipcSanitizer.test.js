const { createIpcSanitizer } = require('../src/preload/ipcSanitizer');

describe('ipcSanitizer', () => {
  test('sanitizes control characters but preserves newlines', () => {
    const log = { warn: jest.fn() };
    const { sanitizeArguments } = createIpcSanitizer({ log });
    const input = 'hello\u0007\nworld';
    const [sanitized] = sanitizeArguments([input]);
    expect(sanitized).toBe('hello\nworld');
  });

  test('sanitizes path traversal segments', () => {
    const log = { warn: jest.fn() };
    const { sanitizeArguments } = createIpcSanitizer({ log });
    const [sanitized] = sanitizeArguments(['C:\\safe\\..\\evil.txt']);
    expect(sanitized).toMatch(/safe\\evil\.txt/i);
    expect(log.warn).toHaveBeenCalled();
  });

  test('blocks dangerous object keys', () => {
    const log = { warn: jest.fn() };
    const { sanitizeArguments } = createIpcSanitizer({ log });
    const [sanitized] = sanitizeArguments([{ __proto__: { admin: true }, ok: 1 }]);
    expect(Object.prototype.hasOwnProperty.call(sanitized, '__proto__')).toBe(false);
    expect(sanitized.ok).toBe(1);
  });

  test('sanitizes html content but preserves comparisons', () => {
    const log = { warn: jest.fn() };
    const { sanitizeArguments } = createIpcSanitizer({ log });
    const [sanitized] = sanitizeArguments(['size < 10MB']);
    expect(sanitized).toBe('size < 10MB');
  });
});
