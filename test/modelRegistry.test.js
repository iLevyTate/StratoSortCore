const {
  ModelType,
  MODEL_CATALOG,
  getModel,
  getModelsByType,
  getRecommendedModels,
  getModelsForRam,
  getDefaultModel,
  calculateDownloadSize,
  formatSize
} = require('../src/shared/modelRegistry');

describe('modelRegistry', () => {
  test('getModel returns null for missing', () => {
    expect(getModel('missing.gguf')).toBeNull();
  });

  test('getModelsByType filters by type', () => {
    const models = getModelsByType(ModelType.EMBEDDING);
    expect(Object.values(models).every((m) => m.type === ModelType.EMBEDDING)).toBe(true);
  });

  test('getRecommendedModels returns recommended only', () => {
    const models = getRecommendedModels();
    expect(Object.values(models).every((m) => m.recommended)).toBe(true);
  });

  test('getModelsForRam filters by minRam', () => {
    const models = getModelsForRam(1024);
    expect(Object.values(models).every((m) => m.minRam <= 1024)).toBe(true);
  });

  test('getDefaultModel returns recommended when available', () => {
    const model = getDefaultModel(ModelType.TEXT);
    expect(MODEL_CATALOG[model].type).toBe(ModelType.TEXT);
  });

  test('calculateDownloadSize sums model and clip sizes', () => {
    const names = Object.keys(MODEL_CATALOG);
    const one = MODEL_CATALOG[names[0]];
    const total = calculateDownloadSize([names[0]]);
    const expected = one.size + (one.clipModel?.size || 0);
    expect(total).toBe(expected);
  });

  test('formatSize formats bytes', () => {
    expect(formatSize(500)).toBe('500 B');
    expect(formatSize(1024)).toMatch(/KB/);
  });
});
