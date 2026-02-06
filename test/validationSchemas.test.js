const schemasModule = require('../src/main/ipc/validationSchemas');

describe('validationSchemas', () => {
  test('filePathSchema validates non-empty string', () => {
    const { filePath, _usingFallback } = schemasModule;
    if (_usingFallback) {
      expect(filePath.safeParse('C:\\file').success).toBe(true);
      expect(filePath.safeParse('').success).toBe(false);
    } else {
      expect(() => filePath.parse('C:\\file')).not.toThrow();
      expect(() => filePath.parse('')).toThrow();
    }
  });

  test('settingsSchema sanitizes dangerous keys in fallback', () => {
    const { settings, _usingFallback } = schemasModule;
    if (_usingFallback) {
      const result = settings.safeParse({ __proto__: { x: 1 }, ok: 1 });
      expect(result.success).toBe(true);
      expect(Object.prototype.hasOwnProperty.call(result.data, '__proto__')).toBe(false);
      expect(result.data.ok).toBe(1);
    } else {
      const result = settings.safeParse({ ok: 1 });
      expect(result.success).toBe(true);
    }
  });
});
