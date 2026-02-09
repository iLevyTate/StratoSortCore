/**
 * Tests for modelRegistry - GGUF Model Catalog utilities
 */

const {
  ModelType,
  QuantizationLevel,
  MODEL_CATALOG,
  getAllModels,
  getModel,
  getModelsByType,
  getRecommendedModels,
  getModelsForRam,
  getDefaultModel,
  calculateDownloadSize,
  formatSize,
  HF_BASE_URL
} = require('../src/shared/modelRegistry');

describe('modelRegistry', () => {
  describe('constants', () => {
    test('ModelType enum has expected values', () => {
      expect(ModelType.TEXT).toBe('text');
      expect(ModelType.VISION).toBe('vision');
      expect(ModelType.EMBEDDING).toBe('embedding');
    });

    test('QuantizationLevel enum has expected values', () => {
      expect(QuantizationLevel.Q4_K_M).toBe('Q4_K_M');
      expect(QuantizationLevel.Q8_0).toBe('Q8_0');
      expect(QuantizationLevel.F16).toBe('F16');
    });

    test('HF_BASE_URL is a valid HTTPS URL', () => {
      expect(HF_BASE_URL).toMatch(/^https:\/\//);
    });
  });

  describe('MODEL_CATALOG integrity', () => {
    test('every model has required fields', () => {
      for (const [name, model] of Object.entries(MODEL_CATALOG)) {
        expect(model).toHaveProperty('type');
        expect(model).toHaveProperty('displayName');
        expect(model).toHaveProperty('description');
        expect(model).toHaveProperty('size');
        expect(model).toHaveProperty('url');
        expect(model).toHaveProperty('recommended');
        expect(model).toHaveProperty('requiresGpu');
        expect(model).toHaveProperty('minRam');
        expect(typeof model.size).toBe('number');
        expect(model.size).toBeGreaterThan(0);
        expect(typeof model.minRam).toBe('number');
        expect(model.minRam).toBeGreaterThan(0);
        expect(typeof model.url).toBe('string');
        expect(model.url).toMatch(/^https:\/\//);
        // Model name should end in .gguf
        expect(name).toMatch(/\.gguf$/);
      }
    });

    test('embedding models have positive dimensions', () => {
      const embeddings = getModelsByType(ModelType.EMBEDDING);
      for (const [name, model] of Object.entries(embeddings)) {
        expect(model.dimensions).toBeGreaterThan(0);
        expect(model.contextLength).toBeGreaterThan(0);
      }
    });

    test('text and vision models have null dimensions', () => {
      const textModels = getModelsByType(ModelType.TEXT);
      const visionModels = getModelsByType(ModelType.VISION);
      for (const model of [...Object.values(textModels), ...Object.values(visionModels)]) {
        expect(model.dimensions).toBeNull();
      }
    });

    test('vision models with clipModel have valid clip metadata', () => {
      const visionModels = getModelsByType(ModelType.VISION);
      for (const [name, model] of Object.entries(visionModels)) {
        if (model.clipModel) {
          expect(model.clipModel).toHaveProperty('name');
          expect(model.clipModel).toHaveProperty('url');
          expect(model.clipModel).toHaveProperty('size');
          expect(model.clipModel.size).toBeGreaterThan(0);
          expect(model.clipModel.url).toMatch(/^https:\/\//);
        }
      }
    });
  });

  describe('getAllModels', () => {
    test('returns the full catalog', () => {
      const all = getAllModels();
      expect(all).toBe(MODEL_CATALOG);
      expect(Object.keys(all).length).toBeGreaterThan(0);
    });
  });

  describe('getModel', () => {
    test('returns model info for existing model', () => {
      const model = getModel('nomic-embed-text-v1.5-Q8_0.gguf');
      expect(model).not.toBeNull();
      expect(model.type).toBe(ModelType.EMBEDDING);
    });

    test('returns null for nonexistent model', () => {
      expect(getModel('nonexistent-model.gguf')).toBeNull();
    });

    test('returns null for empty string', () => {
      expect(getModel('')).toBeNull();
    });

    test('returns null for undefined', () => {
      expect(getModel(undefined)).toBeNull();
    });
  });

  describe('getModelsByType', () => {
    test('returns only embedding models', () => {
      const embeddings = getModelsByType(ModelType.EMBEDDING);
      expect(Object.keys(embeddings).length).toBeGreaterThan(0);
      for (const model of Object.values(embeddings)) {
        expect(model.type).toBe(ModelType.EMBEDDING);
      }
    });

    test('returns only text models', () => {
      const texts = getModelsByType(ModelType.TEXT);
      expect(Object.keys(texts).length).toBeGreaterThan(0);
      for (const model of Object.values(texts)) {
        expect(model.type).toBe(ModelType.TEXT);
      }
    });

    test('returns only vision models', () => {
      const visions = getModelsByType(ModelType.VISION);
      expect(Object.keys(visions).length).toBeGreaterThan(0);
      for (const model of Object.values(visions)) {
        expect(model.type).toBe(ModelType.VISION);
      }
    });

    test('returns empty object for unknown type', () => {
      const result = getModelsByType('unknown');
      expect(Object.keys(result)).toHaveLength(0);
    });
  });

  describe('getRecommendedModels', () => {
    test('returns only recommended models', () => {
      const recommended = getRecommendedModels();
      expect(Object.keys(recommended).length).toBeGreaterThan(0);
      for (const model of Object.values(recommended)) {
        expect(model.recommended).toBe(true);
      }
    });

    test('includes at least one of each type', () => {
      const recommended = getRecommendedModels();
      const types = new Set(Object.values(recommended).map((m) => m.type));
      expect(types.has(ModelType.TEXT)).toBe(true);
      expect(types.has(ModelType.EMBEDDING)).toBe(true);
      expect(types.has(ModelType.VISION)).toBe(true);
    });
  });

  describe('getModelsForRam', () => {
    test('returns models that fit in given RAM', () => {
      const models = getModelsForRam(2048);
      for (const model of Object.values(models)) {
        expect(model.minRam).toBeLessThanOrEqual(2048);
      }
    });

    test('returns all models for very large RAM', () => {
      const all = Object.keys(MODEL_CATALOG).length;
      const models = getModelsForRam(999999);
      expect(Object.keys(models).length).toBe(all);
    });

    test('returns empty for zero RAM', () => {
      const models = getModelsForRam(0);
      expect(Object.keys(models)).toHaveLength(0);
    });

    test('returns empty for negative RAM', () => {
      const models = getModelsForRam(-100);
      expect(Object.keys(models)).toHaveLength(0);
    });
  });

  describe('getDefaultModel', () => {
    test('returns recommended model name for each type', () => {
      const textDefault = getDefaultModel(ModelType.TEXT);
      expect(textDefault).toBeTruthy();
      expect(MODEL_CATALOG[textDefault].type).toBe(ModelType.TEXT);

      const embeddingDefault = getDefaultModel(ModelType.EMBEDDING);
      expect(embeddingDefault).toBeTruthy();
      expect(MODEL_CATALOG[embeddingDefault].type).toBe(ModelType.EMBEDDING);

      const visionDefault = getDefaultModel(ModelType.VISION);
      expect(visionDefault).toBeTruthy();
      expect(MODEL_CATALOG[visionDefault].type).toBe(ModelType.VISION);
    });

    test('returns null for type with no models', () => {
      expect(getDefaultModel('nonexistent-type')).toBeNull();
    });
  });

  describe('calculateDownloadSize', () => {
    test('sums sizes of requested models', () => {
      const models = ['nomic-embed-text-v1.5-Q8_0.gguf'];
      const size = calculateDownloadSize(models);
      expect(size).toBe(MODEL_CATALOG['nomic-embed-text-v1.5-Q8_0.gguf'].size);
    });

    test('includes clip model size for vision models', () => {
      const models = ['llava-v1.6-mistral-7b-Q4_K_M.gguf'];
      const size = calculateDownloadSize(models);
      const entry = MODEL_CATALOG['llava-v1.6-mistral-7b-Q4_K_M.gguf'];
      expect(size).toBe(entry.size + entry.clipModel.size);
    });

    test('returns 0 for empty array', () => {
      expect(calculateDownloadSize([])).toBe(0);
    });

    test('ignores unknown model names', () => {
      expect(calculateDownloadSize(['unknown.gguf'])).toBe(0);
    });

    test('correctly sums multiple models', () => {
      const models = ['nomic-embed-text-v1.5-Q8_0.gguf', 'Mistral-7B-Instruct-v0.3-Q4_K_M.gguf'];
      const expectedSize =
        MODEL_CATALOG['nomic-embed-text-v1.5-Q8_0.gguf'].size +
        MODEL_CATALOG['Mistral-7B-Instruct-v0.3-Q4_K_M.gguf'].size;
      expect(calculateDownloadSize(models)).toBe(expectedSize);
    });
  });

  describe('formatSize', () => {
    test('formats bytes', () => {
      expect(formatSize(500)).toBe('500 B');
    });

    test('formats kilobytes', () => {
      expect(formatSize(1536)).toBe('1.5 KB');
    });

    test('formats megabytes', () => {
      expect(formatSize(157286400)).toBe('150.0 MB');
    });

    test('formats gigabytes', () => {
      const fourGB = 4 * 1024 * 1024 * 1024;
      expect(formatSize(fourGB)).toBe('4.00 GB');
    });

    test('handles zero', () => {
      expect(formatSize(0)).toBe('0 B');
    });

    test('handles exact boundary values', () => {
      expect(formatSize(1024)).toBe('1.0 KB');
      expect(formatSize(1024 * 1024)).toBe('1.0 MB');
      expect(formatSize(1024 * 1024 * 1024)).toBe('1.00 GB');
    });
  });
});
