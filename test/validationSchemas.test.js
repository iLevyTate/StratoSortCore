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

  test('filePathSchema parse throws on invalid', () => {
    const schema = schemasModule.filePath || schemasModule.filePathSchema;
    expect(() => schema.parse(123)).toThrow();
    expect(() => schema.parse('')).toThrow();
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

  test('settingsSchema rejects non-object', () => {
    const schema = schemasModule.settings || schemasModule.settingsSchema;
    const result = schema.safeParse('not-object');
    expect(result.success).toBe(false);
  });

  test('smartFolderSchema validates name', () => {
    const schema = schemasModule.smartFolder || schemasModule.smartFolderSchema;
    const ok = schema.safeParse({ name: 'Docs', path: '/docs' });
    expect(ok.success).toBe(true);
    const bad = schema.safeParse({ name: '' });
    expect(bad.success).toBe(false);
  });

  test('smartFolderSchema requires path in fallback', () => {
    const schema = schemasModule.smartFolder || schemasModule.smartFolderSchema;
    const result = schema.safeParse({ name: 'Docs', path: '' });
    if (schemasModule._usingFallback) {
      expect(result.success).toBe(false);
    }
  });

  test('searchQuery schema validates query object', () => {
    const schema = schemasModule.searchQuery || schemasModule.searchQuerySchema;
    if (!schema) return;
    expect(schema.safeParse({ query: 'test' }).success).toBe(true);
    expect(schema.safeParse({ query: 'x', limit: 10, offset: 0 }).success).toBe(true);
    expect(schema.safeParse({}).success).toBe(true);
    expect(schema.safeParse(null).success).toBe(false);
  });

  test('pagination schema validates limit and offset', () => {
    const schema = schemasModule.pagination || schemasModule.paginationSchema;
    if (!schema) return;
    expect(schema.safeParse({ limit: 10 }).success).toBe(true);
    expect(schema.safeParse({ limit: 1, offset: 0 }).success).toBe(true);
    expect(schema.safeParse({ limit: 0 }).success).toBe(false);
  });

  test('batchOrganize schema validates operations array', () => {
    const schema = schemasModule.batchOrganize || schemasModule.batchOperationSchema;
    if (!schema) return;
    const valid = schema.safeParse({
      operations: [{ source: '/a', destination: '/b' }]
    });
    expect(valid.success).toBe(true);
    const bad = schema.safeParse({ operations: [] });
    expect(bad.success).toBe(false);
  });
});
