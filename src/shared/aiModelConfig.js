/**
 * AI Model Configuration — Single Source of Truth
 *
 * Change default models here. All other modules import from this file.
 * Env overrides: STRATOSORT_TEXT_MODEL, STRATOSORT_VISION_MODEL, STRATOSORT_EMBEDDING_MODEL
 *
 * Default profile targets broad compatibility across hardware.
 * Requires entries in modelRegistry.js MODEL_CATALOG for download URLs.
 */

const env = typeof process !== 'undefined' && process.env ? process.env : {};

/** Installer profiles for first-run model selection */
const INSTALL_MODEL_PROFILES = {
  BASE_SMALL: {
    id: 'base-small',
    label: 'Base (Small & Fast)',
    description: 'Best for all computers, including CPU-only and low-memory systems.',
    models: {
      TEXT_ANALYSIS: 'Llama-3.2-3B-Instruct-Q4_K_M.gguf',
      IMAGE_ANALYSIS: 'llava-phi-3-mini-int4.gguf',
      EMBEDDING: 'all-MiniLM-L6-v2-Q4_K_M.gguf'
    }
  },
  BETTER_QUALITY: {
    id: 'better-quality',
    label: 'Better Quality (Larger)',
    description: 'Higher quality results on modern hardware, with larger downloads.',
    models: {
      TEXT_ANALYSIS: 'Qwen2.5-7B-Instruct-Q4_K_M.gguf',
      IMAGE_ANALYSIS: 'llava-v1.6-mistral-7b-Q4_K_M.gguf',
      EMBEDDING: 'nomic-embed-text-v1.5-Q8_0.gguf'
    }
  }
};

/** Default model filenames (must match MODEL_CATALOG keys in modelRegistry.js) */
const DEFAULT_AI_MODELS = {
  TEXT_ANALYSIS:
    env.STRATOSORT_TEXT_MODEL || INSTALL_MODEL_PROFILES.BASE_SMALL.models.TEXT_ANALYSIS,
  IMAGE_ANALYSIS:
    env.STRATOSORT_VISION_MODEL || INSTALL_MODEL_PROFILES.BASE_SMALL.models.IMAGE_ANALYSIS,
  EMBEDDING: env.STRATOSORT_EMBEDDING_MODEL || INSTALL_MODEL_PROFILES.BASE_SMALL.models.EMBEDDING,
  FALLBACK_MODELS: ['Llama-3.2-3B-Instruct-Q4_K_M.gguf', 'Phi-3-mini-4k-instruct-q4.gguf']
};

/** AI processing defaults (temperature, context, etc.) */
const AI_DEFAULTS = {
  TEXT: {
    MODEL: DEFAULT_AI_MODELS.TEXT_ANALYSIS,
    GPU_LAYERS: -1,
    TEMPERATURE: 0.7,
    MAX_TOKENS: 8192,
    CONTEXT_SIZE: 8192,
    MAX_CONTENT_LENGTH: 32000,
    DEEP_ANALYSIS: false,
    FALLBACK_MODELS: [
      'Qwen2.5-7B-Instruct-Q4_K_M.gguf',
      'Llama-3.2-3B-Instruct-Q4_K_M.gguf',
      'Phi-3-mini-4k-instruct-q4.gguf'
    ]
  },
  IMAGE: {
    MODEL: DEFAULT_AI_MODELS.IMAGE_ANALYSIS,
    GPU_LAYERS: -1,
    TEMPERATURE: 0.2,
    MAX_TOKENS: 512,
    FALLBACK_MODELS: ['llava-v1.6-mistral-7b-Q4_K_M.gguf', 'llava-phi-3-mini-int4.gguf']
  },
  EMBEDDING: {
    MODEL: DEFAULT_AI_MODELS.EMBEDDING,
    DIMENSIONS: 384,
    GPU_LAYERS: -1,
    FALLBACK_MODELS: [
      'nomic-embed-text-v1.5-Q8_0.gguf',
      'nomic-embed-text-v1.5-Q4_K_M.gguf',
      'all-MiniLM-L6-v2-Q8_0.gguf',
      'all-MiniLM-L6-v2-Q4_K_M.gguf'
    ],
    AUTO_CHUNK_ON_ANALYSIS: false
  }
};

module.exports = {
  INSTALL_MODEL_PROFILES,
  DEFAULT_AI_MODELS,
  AI_DEFAULTS
};
