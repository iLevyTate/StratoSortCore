/**
 * Model Registry - GGUF Model Catalog
 *
 * Central registry of available GGUF models for node-llama-cpp.
 * Contains model metadata, download URLs, and recommended configurations.
 *
 * @module shared/modelRegistry
 */

/**
 * Model types
 * @readonly
 * @enum {string}
 */
const ModelType = {
  TEXT: 'text',
  VISION: 'vision',
  EMBEDDING: 'embedding'
};

/**
 * Model quantization levels
 * @readonly
 * @enum {string}
 */
const QuantizationLevel = {
  F16: 'F16', // Full precision (large, best quality)
  Q8_0: 'Q8_0', // 8-bit (good quality, reasonable size)
  Q6_K: 'Q6_K', // 6-bit K-quant
  Q5_K_M: 'Q5_K_M', // 5-bit K-quant medium
  Q4_K_M: 'Q4_K_M', // 4-bit K-quant medium (recommended balance)
  Q4_K_S: 'Q4_K_S', // 4-bit K-quant small
  Q3_K_M: 'Q3_K_M', // 3-bit K-quant (smaller, lower quality)
  Q2_K: 'Q2_K' // 2-bit K-quant (smallest, lowest quality)
};

/**
 * Hugging Face base URL for model downloads
 */
const HF_BASE_URL = 'https://huggingface.co';

/**
 * Model catalog with metadata and download URLs
 * Models are sourced from Hugging Face repositories
 */
const MODEL_CATALOG = {
  // ========== EMBEDDING MODELS ==========
  'nomic-embed-text-v1.5-Q8_0.gguf': {
    type: ModelType.EMBEDDING,
    displayName: 'Nomic Embed Text v1.5',
    description: 'High-quality text embeddings for semantic search',
    dimensions: 768,
    contextLength: 8192,
    size: 146 * 1024 * 1024, // ~146MB
    quantization: QuantizationLevel.Q8_0,
    url: `${HF_BASE_URL}/nomic-ai/nomic-embed-text-v1.5-GGUF/resolve/main/nomic-embed-text-v1.5.Q8_0.gguf`,
    checksum: '3e24342164b3d94991ba9692fdc0dd08e3fd7362e0aacc396a9a5c54a544c3b7',
    recommended: true,
    requiresGpu: false,
    minRam: 1024 // 1GB
  },

  'nomic-embed-text-v1.5-Q4_K_M.gguf': {
    type: ModelType.EMBEDDING,
    displayName: 'Nomic Embed Text v1.5 (Quantized)',
    description: 'Quantized embedding model for lower memory usage',
    dimensions: 768,
    contextLength: 8192,
    size: 84 * 1024 * 1024, // ~84MB
    quantization: QuantizationLevel.Q4_K_M,
    url: `${HF_BASE_URL}/nomic-ai/nomic-embed-text-v1.5-GGUF/resolve/main/nomic-embed-text-v1.5.Q4_K_M.gguf`,
    checksum: 'd4e388894e09cf3816e8b0896d81d265b55e7a9fff9ab03fe8bf4ef5e11295ac',
    recommended: false,
    requiresGpu: false,
    minRam: 512
  },

  'mxbai-embed-large-v1-f16.gguf': {
    type: ModelType.EMBEDDING,
    displayName: 'MixedBread Embed Large',
    description: 'Large embedding model with 1024 dimensions',
    dimensions: 1024,
    contextLength: 512,
    size: 670 * 1024 * 1024, // ~670MB
    quantization: QuantizationLevel.F16,
    url: `${HF_BASE_URL}/mixedbread-ai/mxbai-embed-large-v1/resolve/main/gguf/mxbai-embed-large-v1-f16.gguf`,
    checksum: '819c2adf5ce6df2b6bd2ae4ca90d2a69f060afeb438d0c171db57daa02e39c3d',
    recommended: false,
    requiresGpu: false,
    minRam: 2048
  },

  // ========== TEXT MODELS ==========
  'Mistral-7B-Instruct-v0.3-Q4_K_M.gguf': {
    type: ModelType.TEXT,
    displayName: 'Mistral 7B Instruct v0.3',
    description: 'High-quality instruction-following model',
    dimensions: null,
    contextLength: 32768,
    size: 4370 * 1024 * 1024, // ~4.37GB
    quantization: QuantizationLevel.Q4_K_M,
    url: `${HF_BASE_URL}/bartowski/Mistral-7B-Instruct-v0.3-GGUF/resolve/main/Mistral-7B-Instruct-v0.3-Q4_K_M.gguf`,
    checksum: '1270d22c0fbb3d092fb725d4d96c457b7b687a5f5a715abe1e818da303e562b6',
    recommended: true,
    requiresGpu: true,
    minRam: 8192
  },

  'Llama-3.2-3B-Instruct-Q4_K_M.gguf': {
    type: ModelType.TEXT,
    displayName: 'Llama 3.2 3B Instruct',
    description: 'Smaller, faster text model for lower-end hardware',
    dimensions: null,
    contextLength: 8192,
    size: 2000 * 1024 * 1024, // ~2GB
    quantization: QuantizationLevel.Q4_K_M,
    url: `${HF_BASE_URL}/bartowski/Llama-3.2-3B-Instruct-GGUF/resolve/main/Llama-3.2-3B-Instruct-Q4_K_M.gguf`,
    checksum: '6c1a2b41161032677be168d354123594c0e6e67d2b9227c84f296ad037c728ff',
    recommended: false,
    requiresGpu: false,
    minRam: 4096
  },

  'Phi-3-mini-4k-instruct-q4.gguf': {
    type: ModelType.TEXT,
    displayName: 'Phi-3 Mini 4K Instruct',
    description: 'Microsoft Phi-3 for CPU-only systems',
    dimensions: null,
    contextLength: 4096,
    size: 2300 * 1024 * 1024, // ~2.3GB
    quantization: QuantizationLevel.Q4_K_M,
    url: `${HF_BASE_URL}/microsoft/Phi-3-mini-4k-instruct-gguf/resolve/main/Phi-3-mini-4k-instruct-q4.gguf`,
    checksum: '8a83c7fb9049a9b2e92266fa7ad04933bb53aa1e85136b7b30f1b8000ff2edef',
    recommended: false,
    requiresGpu: false,
    minRam: 4096
  },

  // ========== VISION MODELS ==========
  'llava-v1.6-mistral-7b-Q4_K_M.gguf': {
    type: ModelType.VISION,
    displayName: 'LLaVA v1.6 Mistral 7B',
    description: 'Vision-language model for image understanding',
    dimensions: null,
    contextLength: 4096,
    size: 4370 * 1024 * 1024, // ~4.37GB
    quantization: QuantizationLevel.Q4_K_M,
    url: `${HF_BASE_URL}/cjpais/llava-1.6-mistral-7b-gguf/resolve/main/llava-v1.6-mistral-7b.Q4_K_M.gguf`,
    checksum: '4bd1bc95c4db74f8140ee520e76d1f83e063d3fde9c3723eaa4a4776785a7aa6',
    recommended: true,
    requiresGpu: true,
    minRam: 8192,
    // Vision models may require additional clip model
    clipModel: {
      name: 'mmproj-model-f16.gguf',
      url: `${HF_BASE_URL}/cjpais/llava-1.6-mistral-7b-gguf/resolve/main/mmproj-model-f16.gguf`,
      size: 624 * 1024 * 1024, // ~624MB
      checksum: '00205ee8a0d7a381900cd031e43105f86aa0d8c07bf329851e85c71a26632d16'
    }
  },

  'llava-phi-3-mini-Q4_K_M.gguf': {
    type: ModelType.VISION,
    displayName: 'LLaVA Phi-3 Mini',
    description: 'Smaller vision model for CPU systems',
    dimensions: null,
    contextLength: 4096,
    size: 2300 * 1024 * 1024, // ~2.3GB
    quantization: QuantizationLevel.Q4_K_M,
    url: `${HF_BASE_URL}/xtuner/llava-phi-3-mini-gguf/resolve/main/llava-phi-3-mini-Q4_K_M.gguf`,
    checksum: null,
    recommended: false,
    requiresGpu: false,
    minRam: 4096,
    clipModel: {
      name: 'llava-phi-3-mini-mmproj-f16.gguf',
      url: `${HF_BASE_URL}/xtuner/llava-phi-3-mini-gguf/resolve/main/llava-phi-3-mini-mmproj-f16.gguf`,
      size: 580 * 1024 * 1024, // ~580MB
      checksum: null
    }
  }
};

/**
 * Get all models in the registry
 * @returns {Object} Model catalog
 */
function getAllModels() {
  return MODEL_CATALOG;
}

/**
 * Get a model by name
 * @param {string} modelName - Model filename
 * @returns {Object|null} Model info or null
 */
function getModel(modelName) {
  return MODEL_CATALOG[modelName] || null;
}

/**
 * Get models by type
 * @param {ModelType} type - Model type
 * @returns {Object} Filtered models
 */
function getModelsByType(type) {
  const filtered = {};
  for (const [name, info] of Object.entries(MODEL_CATALOG)) {
    if (info.type === type) {
      filtered[name] = info;
    }
  }
  return filtered;
}

/**
 * Get recommended models
 * @returns {Object} Recommended models
 */
function getRecommendedModels() {
  const recommended = {};
  for (const [name, info] of Object.entries(MODEL_CATALOG)) {
    if (info.recommended) {
      recommended[name] = info;
    }
  }
  return recommended;
}

/**
 * Get models suitable for a given RAM amount
 * @param {number} availableRamMb - Available RAM in MB
 * @returns {Object} Suitable models
 */
function getModelsForRam(availableRamMb) {
  const suitable = {};
  for (const [name, info] of Object.entries(MODEL_CATALOG)) {
    if (info.minRam <= availableRamMb) {
      suitable[name] = info;
    }
  }
  return suitable;
}

/**
 * Get default model for a type
 * @param {ModelType} type - Model type
 * @returns {string|null} Default model name
 */
function getDefaultModel(type) {
  const models = getModelsByType(type);
  // Return first recommended, or first available
  for (const [name, info] of Object.entries(models)) {
    if (info.recommended) {
      return name;
    }
  }
  return Object.keys(models)[0] || null;
}

/**
 * Calculate total download size for a set of models
 * @param {string[]} modelNames - Array of model names
 * @returns {number} Total size in bytes
 */
function calculateDownloadSize(modelNames) {
  let total = 0;
  for (const name of modelNames) {
    const model = MODEL_CATALOG[name];
    if (model) {
      total += model.size;
      // Add clip model size if present
      if (model.clipModel) {
        total += model.clipModel.size;
      }
    }
  }
  return total;
}

/**
 * Format bytes to human-readable string
 * @param {number} bytes - Size in bytes
 * @returns {string} Formatted string
 */
function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

module.exports = {
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
};
