/**
 * Model Categorization Utilities
 *
 * Shared model categorization logic for Ollama models.
 * Consolidates patterns from multiple modules into a single source of truth.
 *
 * @module shared/modelCategorization
 */

/**
 * Vision models: Models that can process images
 */
const VISION_MODEL_PATTERNS = [
  /\bgemma3\b/i, // Gemma 3 (4B+ are multimodal vision models)
  /smolvlm/i, // SmolVLM family (default)
  /llava/i, // LLaVA family (llava, llava-llama3, llava-phi3, etc.)
  /bakllava/i, // BakLLaVA
  /moondream/i, // Moondream vision model
  /vision/i, // Any model with "vision" in name
  /llama.*vision/i, // Llama vision variants
  /gemma.*vision/i, // Gemma vision variants (legacy pattern)
  /-v\b/i, // Models ending with -v (like minicpm-v)
  /minicpm-v/i, // MiniCPM-V
  /cogvlm/i, // CogVLM
  /qwen.*vl/i, // Qwen-VL
  /internvl/i, // InternVL
  /yi-vl/i, // Yi-VL
  /deepseek-vl/i, // DeepSeek-VL
  /clip/i, // CLIP models
  /blip/i, // BLIP models
  /sam\b/i // SAM (Segment Anything)
];

/**
 * Embedding models: Models for generating text embeddings
 */
const EMBEDDING_MODEL_PATTERNS = [
  /embed/i, // Any model with "embed" in name
  /embedding/i, // Any model with "embedding" in name
  /mxbai-embed/i, // MxBai embedding models
  /nomic-embed/i, // Nomic embedding models
  /all-minilm/i, // All-MiniLM models
  /\bbge\b/i, // BGE embedding models
  /e5-/i, // E5 embedding models
  /gte-/i, // GTE embedding models
  /stella/i, // Stella embedding models
  /snowflake-arctic-embed/i, // Snowflake Arctic Embed
  /paraphrase/i // Paraphrase models (typically embeddings)
];

/**
 * Model prefixes for category matching (used by ModelManager for capability detection)
 */
const MODEL_CATEGORY_PREFIXES = {
  text: [
    'qwen3',
    'qwen',
    'llama',
    'mistral',
    'phi',
    'gemma',
    'codellama',
    'neural-chat',
    'orca',
    'vicuna',
    'alpaca',
    'dolphin',
    'nous-hermes',
    'openhermes',
    'zephyr',
    'starling',
    'yi',
    'deepseek'
  ],
  vision: [
    'gemma3', // Gemma 3 4B+ are multimodal vision models
    'smolvlm2',
    'smolvlm',
    'moondream',
    'llava',
    'bakllava',
    'minicpm-v',
    'cogvlm',
    'internvl',
    'yi-vl',
    'deepseek-vl',
    'qwen-vl',
    'qwen2-vl'
  ],
  embedding: [
    'embeddinggemma',
    'mxbai-embed',
    'nomic-embed',
    'all-minilm',
    'bge',
    'e5',
    'gte',
    'stella',
    'snowflake-arctic-embed'
  ],
  code: ['codellama', 'codegemma', 'starcoder', 'deepseek-coder', 'codestral', 'qwen2.5-coder'],
  chat: [
    'qwen3',
    'qwen',
    'llama',
    'mistral',
    'phi',
    'gemma',
    'neural-chat',
    'orca',
    'vicuna',
    'dolphin'
  ]
};

/**
 * Fallback model preferences (in order of preference)
 * Prioritizes lightweight models for accessibility
 */
const FALLBACK_MODEL_PREFERENCES = [
  'qwen3:0.6b',
  'qwen3',
  'gemma3:4b',
  'gemma2:2b',
  'llama3.2',
  'llama3.1',
  'llama3',
  'llama2',
  'mistral',
  'phi3',
  'phi',
  'gemma2',
  'gemma',
  'qwen2',
  'qwen',
  'neural-chat',
  'orca-mini'
];

/**
 * Categorize a model by its name using regex patterns
 * @param {string} modelName - The model name to categorize
 * @returns {'vision' | 'embedding' | 'text'} The category
 */
function categorizeModel(modelName) {
  const name = modelName || '';

  // Check vision patterns first (more specific)
  for (const pattern of VISION_MODEL_PATTERNS) {
    if (pattern.test(name)) {
      return 'vision';
    }
  }

  // Check embedding patterns
  for (const pattern of EMBEDDING_MODEL_PATTERNS) {
    if (pattern.test(name)) {
      return 'embedding';
    }
  }

  // Default to text model
  return 'text';
}

/**
 * Categorize multiple models and return them grouped by category
 * @param {Array<{name: string} | string>} models - Array of model objects or names
 * @returns {{text: string[], vision: string[], embedding: string[]}} Models grouped by category
 */
function categorizeModels(models) {
  const categories = { text: [], vision: [], embedding: [] };

  for (const model of models) {
    const name = typeof model === 'string' ? model : model.name || '';
    const category = categorizeModel(name);
    categories[category].push(name);
  }

  // Sort each category alphabetically for consistent display
  categories.text.sort((a, b) => a.localeCompare(b));
  categories.vision.sort((a, b) => a.localeCompare(b));
  categories.embedding.sort((a, b) => a.localeCompare(b));

  return categories;
}

/**
 * Check if a model matches a category by prefix
 * @param {string} modelName - The model name to check
 * @param {string} category - The category to check against
 * @returns {boolean} True if the model matches the category
 */
function matchesCategoryPrefix(modelName, category) {
  const prefixes = MODEL_CATEGORY_PREFIXES[category];
  if (!prefixes) return false;

  const lowerName = (modelName || '').toLowerCase();
  return prefixes.some((prefix) => lowerName.startsWith(prefix.toLowerCase()));
}

/**
 * Validate if a model name is a valid embedding model.
 * Uses pattern-based matching to support any embedding model that follows
 * common naming conventions (e.g., embeddinggemma, mxbai-embed-large, nomic-embed-text).
 *
 * @param {string} modelName - The model name to validate
 * @returns {boolean} True if the model is recognized as a valid embedding model
 */
function isValidEmbeddingModel(modelName) {
  if (!modelName || typeof modelName !== 'string') {
    return false;
  }
  const name = modelName.trim();
  if (name.length === 0) {
    return false;
  }
  // Check against embedding patterns
  return EMBEDDING_MODEL_PATTERNS.some((pattern) => pattern.test(name));
}

/**
 * Validate if a model name is a valid vision model.
 * Uses pattern-based matching to support any vision model that follows
 * common naming conventions (e.g., llava, moondream, smolvlm).
 *
 * @param {string} modelName - The model name to validate
 * @returns {boolean} True if the model is recognized as a valid vision model
 */
function isValidVisionModel(modelName) {
  if (!modelName || typeof modelName !== 'string') {
    return false;
  }
  const name = modelName.trim();
  if (name.length === 0) {
    return false;
  }
  // Check against vision patterns
  return VISION_MODEL_PATTERNS.some((pattern) => pattern.test(name));
}

module.exports = {
  VISION_MODEL_PATTERNS,
  EMBEDDING_MODEL_PATTERNS,
  MODEL_CATEGORY_PREFIXES,
  FALLBACK_MODEL_PREFERENCES,
  categorizeModel,
  categorizeModels,
  matchesCategoryPrefix,
  isValidEmbeddingModel,
  isValidVisionModel
};
