/**
 * Tests for Model Categorization Utilities
 *
 * Ensures model pattern detection works correctly for vision, embedding, and text models.
 * Critical for settings validation and model selection logic.
 */

const {
  VISION_MODEL_PATTERNS,
  EMBEDDING_MODEL_PATTERNS,
  MODEL_CATEGORY_PREFIXES,
  FALLBACK_MODEL_PREFERENCES,
  categorizeModel,
  categorizeModels,
  matchesCategoryPrefix,
  isValidEmbeddingModel,
  isValidVisionModel
} = require('../src/shared/modelCategorization');

describe('Model Categorization', () => {
  describe('VISION_MODEL_PATTERNS', () => {
    const visionModels = [
      'smolvlm',
      'smolvlm2:latest',
      'llava:7b',
      'llava-llama3:8b',
      'llava-phi3',
      'bakllava:7b',
      'moondream:latest',
      'moondream2:1.8b',
      'llama-vision',
      'gemma-vision',
      'minicpm-v:8b',
      'cogvlm:19b',
      'qwen-vl:7b',
      'qwen2-vl:2b',
      'internvl:26b',
      'yi-vl:34b',
      'deepseek-vl:7b'
    ];

    test.each(visionModels)('recognizes %s as vision model', (modelName) => {
      const isVision = VISION_MODEL_PATTERNS.some((p) => p.test(modelName));
      expect(isVision).toBe(true);
    });

    test('does not match non-vision models', () => {
      // Note: gemma3 IS a vision model (4B+), but gemma (without 3) is not
      const nonVisionModels = [
        'llama3:8b',
        'mistral:7b',
        'phi3:mini',
        'gemma:7b',
        'gemma2:2b',
        'qwen2:7b'
      ];
      for (const modelName of nonVisionModels) {
        const isVision = VISION_MODEL_PATTERNS.some((p) => p.test(modelName));
        expect(isVision).toBe(false);
      }
    });

    test('correctly identifies gemma3 as a vision model', () => {
      // Gemma 3 (4B+) is multimodal and supports vision
      const gemma3Models = ['gemma3:latest', 'gemma3:4b', 'gemma3:12b', 'gemma3:27b'];
      for (const modelName of gemma3Models) {
        const isVision = VISION_MODEL_PATTERNS.some((p) => p.test(modelName));
        expect(isVision).toBe(true);
      }
    });
  });

  describe('EMBEDDING_MODEL_PATTERNS', () => {
    const embeddingModels = [
      'embeddinggemma',
      'embeddinggemma:latest',
      'mxbai-embed-large',
      'mxbai-embed-large:335m',
      'nomic-embed-text',
      'nomic-embed-text:latest',
      'all-minilm',
      'all-minilm:latest',
      'bge-large',
      'bge-m3',
      'e5-large',
      'e5-mistral',
      'gte-large',
      'gte-base',
      'stella-base',
      'snowflake-arctic-embed',
      'paraphrase-multilingual'
    ];

    test.each(embeddingModels)('recognizes %s as embedding model', (modelName) => {
      const isEmbedding = EMBEDDING_MODEL_PATTERNS.some((p) => p.test(modelName));
      expect(isEmbedding).toBe(true);
    });

    test('does not match non-embedding models', () => {
      const nonEmbeddingModels = [
        'llama3:8b',
        'mistral:7b',
        'phi3:mini',
        'gemma:7b',
        'llava:7b',
        'moondream:latest'
      ];
      for (const modelName of nonEmbeddingModels) {
        const isEmbedding = EMBEDDING_MODEL_PATTERNS.some((p) => p.test(modelName));
        expect(isEmbedding).toBe(false);
      }
    });
  });

  describe('categorizeModel', () => {
    test('categorizes vision models correctly', () => {
      expect(categorizeModel('llava:7b')).toBe('vision');
      expect(categorizeModel('moondream')).toBe('vision');
      expect(categorizeModel('smolvlm2:latest')).toBe('vision');
      expect(categorizeModel('minicpm-v:8b')).toBe('vision');
    });

    test('categorizes embedding models correctly', () => {
      expect(categorizeModel('embeddinggemma')).toBe('embedding');
      expect(categorizeModel('mxbai-embed-large')).toBe('embedding');
      expect(categorizeModel('nomic-embed-text')).toBe('embedding');
      expect(categorizeModel('all-minilm')).toBe('embedding');
      expect(categorizeModel('bge-large')).toBe('embedding');
    });

    test('categorizes text models correctly (default)', () => {
      expect(categorizeModel('llama3:8b')).toBe('text');
      expect(categorizeModel('mistral:7b')).toBe('text');
      expect(categorizeModel('phi3:mini')).toBe('text');
      expect(categorizeModel('gemma:7b')).toBe('text');
      expect(categorizeModel('qwen2:7b')).toBe('text');
    });

    test('handles empty and null values', () => {
      expect(categorizeModel('')).toBe('text');
      expect(categorizeModel(null)).toBe('text');
      expect(categorizeModel(undefined)).toBe('text');
    });
  });

  describe('categorizeModels', () => {
    test('groups models by category', () => {
      const models = [
        'llama3:8b',
        'llava:7b',
        'embeddinggemma',
        'mistral:7b',
        'moondream',
        'nomic-embed-text'
      ];

      const categories = categorizeModels(models);

      expect(categories.text).toContain('llama3:8b');
      expect(categories.text).toContain('mistral:7b');
      expect(categories.vision).toContain('llava:7b');
      expect(categories.vision).toContain('moondream');
      expect(categories.embedding).toContain('embeddinggemma');
      expect(categories.embedding).toContain('nomic-embed-text');
    });

    test('handles model objects with name property', () => {
      const models = [{ name: 'llama3:8b' }, { name: 'llava:7b' }, { name: 'embeddinggemma' }];

      const categories = categorizeModels(models);

      expect(categories.text).toContain('llama3:8b');
      expect(categories.vision).toContain('llava:7b');
      expect(categories.embedding).toContain('embeddinggemma');
    });

    test('sorts each category alphabetically', () => {
      const models = ['zephyr', 'alpha', 'mistral'];
      const categories = categorizeModels(models);
      expect(categories.text).toEqual(['alpha', 'mistral', 'zephyr']);
    });
  });

  describe('matchesCategoryPrefix', () => {
    test('matches text model prefixes', () => {
      expect(matchesCategoryPrefix('llama3:8b', 'text')).toBe(true);
      expect(matchesCategoryPrefix('mistral:7b', 'text')).toBe(true);
      expect(matchesCategoryPrefix('phi3:mini', 'text')).toBe(true);
      expect(matchesCategoryPrefix('qwen3:0.6b', 'text')).toBe(true);
    });

    test('matches vision model prefixes', () => {
      expect(matchesCategoryPrefix('smolvlm', 'vision')).toBe(true);
      expect(matchesCategoryPrefix('moondream', 'vision')).toBe(true);
      expect(matchesCategoryPrefix('llava:7b', 'vision')).toBe(true);
    });

    test('matches embedding model prefixes', () => {
      expect(matchesCategoryPrefix('embeddinggemma', 'embedding')).toBe(true);
      expect(matchesCategoryPrefix('mxbai-embed-large', 'embedding')).toBe(true);
      expect(matchesCategoryPrefix('nomic-embed-text', 'embedding')).toBe(true);
    });

    test('returns false for unknown category', () => {
      expect(matchesCategoryPrefix('llama3', 'unknown')).toBe(false);
    });

    test('handles empty and null values', () => {
      expect(matchesCategoryPrefix('', 'text')).toBe(false);
      expect(matchesCategoryPrefix(null, 'text')).toBe(false);
      expect(matchesCategoryPrefix(undefined, 'text')).toBe(false);
    });
  });

  describe('isValidEmbeddingModel', () => {
    describe('valid embedding models', () => {
      const validModels = [
        'embeddinggemma',
        'embeddinggemma:latest',
        'mxbai-embed-large',
        'mxbai-embed-large:335m',
        'nomic-embed-text',
        'nomic-embed-text:latest',
        'all-minilm',
        'all-minilm:l6-v2',
        'bge-large',
        'bge-m3',
        'bge-base-en',
        'e5-large',
        'e5-small',
        'e5-mistral-7b',
        'gte-large',
        'gte-base',
        'stella-en-400m',
        'snowflake-arctic-embed:335m',
        'paraphrase-multilingual'
      ];

      test.each(validModels)('accepts %s as valid embedding model', (modelName) => {
        expect(isValidEmbeddingModel(modelName)).toBe(true);
      });
    });

    describe('invalid embedding models', () => {
      const invalidModels = [
        'llama3:8b',
        'mistral:7b',
        'phi3:mini',
        'gemma:7b',
        'llava:7b',
        'moondream',
        'codellama:7b',
        'qwen2:7b',
        'smolvlm',
        '' // empty string
      ];

      test.each(invalidModels)('rejects %s as invalid embedding model', (modelName) => {
        expect(isValidEmbeddingModel(modelName)).toBe(false);
      });
    });

    describe('edge cases', () => {
      test('rejects null', () => {
        expect(isValidEmbeddingModel(null)).toBe(false);
      });

      test('rejects undefined', () => {
        expect(isValidEmbeddingModel(undefined)).toBe(false);
      });

      test('rejects non-string values', () => {
        expect(isValidEmbeddingModel(123)).toBe(false);
        expect(isValidEmbeddingModel({})).toBe(false);
        expect(isValidEmbeddingModel([])).toBe(false);
      });

      test('rejects whitespace-only strings', () => {
        expect(isValidEmbeddingModel('   ')).toBe(false);
        expect(isValidEmbeddingModel('\t\n')).toBe(false);
      });

      test('accepts models with whitespace after trim', () => {
        expect(isValidEmbeddingModel('  embeddinggemma  ')).toBe(true);
        expect(isValidEmbeddingModel('\tmxbai-embed-large\n')).toBe(true);
      });
    });
  });

  describe('isValidVisionModel', () => {
    describe('valid vision models', () => {
      const validModels = [
        'llava:7b',
        'llava-llama3:8b',
        'llava-phi3',
        'bakllava:7b',
        'moondream',
        'moondream2:1.8b',
        'smolvlm',
        'smolvlm2:latest',
        'minicpm-v:8b',
        'cogvlm:19b',
        'qwen-vl:7b',
        'qwen2-vl',
        'internvl:26b',
        'yi-vl:34b',
        'deepseek-vl:7b'
      ];

      test.each(validModels)('accepts %s as valid vision model', (modelName) => {
        expect(isValidVisionModel(modelName)).toBe(true);
      });
    });

    describe('invalid vision models', () => {
      const invalidModels = [
        'llama3:8b',
        'mistral:7b',
        'phi3:mini',
        'gemma:7b',
        'embeddinggemma',
        'nomic-embed-text',
        'codellama:7b',
        'qwen2:7b',
        ''
      ];

      test.each(invalidModels)('rejects %s as invalid vision model', (modelName) => {
        expect(isValidVisionModel(modelName)).toBe(false);
      });
    });

    describe('edge cases', () => {
      test('rejects null and undefined', () => {
        expect(isValidVisionModel(null)).toBe(false);
        expect(isValidVisionModel(undefined)).toBe(false);
      });

      test('rejects non-string values', () => {
        expect(isValidVisionModel(123)).toBe(false);
        expect(isValidVisionModel({})).toBe(false);
      });
    });
  });

  describe('Pattern Collision Detection', () => {
    test('vision and embedding patterns do not overlap', () => {
      // Test models that could potentially match both patterns
      const testModels = [
        'embed-vision', // Could hypothetically match both
        'vision-embed',
        'llava-embed', // Vision model name with "embed"
        'embed-llava'
      ];

      for (const model of testModels) {
        const isVision = VISION_MODEL_PATTERNS.some((p) => p.test(model));
        const isEmbedding = EMBEDDING_MODEL_PATTERNS.some((p) => p.test(model));

        // If both match, categorizeModel should consistently pick one
        if (isVision && isEmbedding) {
          const category = categorizeModel(model);
          // Vision patterns are checked first, so vision should win
          expect(category).toBe('vision');
        }
      }
    });
  });

  describe('FALLBACK_MODEL_PREFERENCES', () => {
    test('contains valid model names', () => {
      expect(FALLBACK_MODEL_PREFERENCES.length).toBeGreaterThan(0);
      for (const model of FALLBACK_MODEL_PREFERENCES) {
        expect(typeof model).toBe('string');
        expect(model.length).toBeGreaterThan(0);
      }
    });

    test('prioritizes lightweight models first', () => {
      // qwen3:0.6b should be early in the list (lightweight)
      const qwenIndex = FALLBACK_MODEL_PREFERENCES.indexOf('qwen3:0.6b');
      const llamaIndex = FALLBACK_MODEL_PREFERENCES.indexOf('llama3');
      expect(qwenIndex).toBeLessThan(llamaIndex);
    });

    test('does not include embedding models', () => {
      for (const model of FALLBACK_MODEL_PREFERENCES) {
        expect(isValidEmbeddingModel(model)).toBe(false);
      }
    });

    test('does not include vision-only models', () => {
      // Note: Some multimodal models like gemma3 are in fallbacks for their text capabilities
      // but also support vision. We only exclude vision-ONLY models (llava, moondream, etc.)
      const visionOnlyModels = ['llava', 'moondream', 'smolvlm', 'bakllava', 'cogvlm', 'minicpm-v'];
      for (const model of FALLBACK_MODEL_PREFERENCES) {
        const isVisionOnly = visionOnlyModels.some((v) => model.toLowerCase().includes(v));
        expect(isVisionOnly).toBe(false);
      }
    });
  });

  describe('MODEL_CATEGORY_PREFIXES', () => {
    test('defines prefixes for all categories', () => {
      expect(MODEL_CATEGORY_PREFIXES.text).toBeDefined();
      expect(MODEL_CATEGORY_PREFIXES.vision).toBeDefined();
      expect(MODEL_CATEGORY_PREFIXES.embedding).toBeDefined();
      expect(MODEL_CATEGORY_PREFIXES.code).toBeDefined();
      expect(MODEL_CATEGORY_PREFIXES.chat).toBeDefined();
    });

    test('text prefixes are non-empty arrays', () => {
      expect(Array.isArray(MODEL_CATEGORY_PREFIXES.text)).toBe(true);
      expect(MODEL_CATEGORY_PREFIXES.text.length).toBeGreaterThan(0);
    });

    test('embedding prefixes match common embedding models', () => {
      const embeddingPrefixes = MODEL_CATEGORY_PREFIXES.embedding;
      expect(embeddingPrefixes).toContain('embeddinggemma');
      expect(embeddingPrefixes).toContain('mxbai-embed');
      expect(embeddingPrefixes).toContain('nomic-embed');
    });
  });
});
