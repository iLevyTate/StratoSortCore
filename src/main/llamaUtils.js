/**
 * LlamaUtils - Utilities for node-llama-cpp based LlamaService
 *
 * This module provides utility functions for working with the in-process
 * LlamaService.
 *
 * @module llamaUtils
 */

const { createLogger } = require('../shared/logger');
const { AI_DEFAULTS, DEFAULT_AI_MODELS } = require('../shared/constants');

const logger = createLogger('llama-utils');

// Selected models - in-memory cache
let selectedTextModel = AI_DEFAULTS.TEXT?.MODEL || null;
let selectedVisionModel = AI_DEFAULTS.IMAGE?.MODEL || null;
let selectedEmbeddingModel = AI_DEFAULTS.EMBEDDING?.MODEL || null;

/**
 * Lazy load LlamaService to avoid circular dependencies
 */
function getLlamaService() {
  try {
    const { getInstance } = require('./services/LlamaService');
    return getInstance();
  } catch (error) {
    logger.warn('[LlamaUtils] Failed to get LlamaService instance:', error.message);
    return null;
  }
}

/**
 * Get current text model name
 * @returns {string|null}
 */
function getTextModel() {
  const service = getLlamaService();
  if (service?._selectedModels?.text) {
    return service._selectedModels.text;
  }
  return selectedTextModel;
}

/**
 * Get current vision model name
 * @returns {string|null}
 */
function getVisionModel() {
  const service = getLlamaService();
  if (service?._selectedModels?.vision) {
    return service._selectedModels.vision;
  }
  return selectedVisionModel;
}

/**
 * Get current embedding model name
 * @returns {string|null}
 */
function getEmbeddingModel() {
  const service = getLlamaService();
  if (service?._selectedModels?.embedding) {
    return service._selectedModels.embedding;
  }
  return selectedEmbeddingModel;
}

/**
 * Set text model
 * @param {string} model - Model filename
 */
async function setTextModel(model) {
  selectedTextModel = model;
  const service = getLlamaService();
  if (service) {
    await service.updateConfig({ textModel: model });
  }
}

/**
 * Set vision model
 * @param {string} model - Model filename
 */
async function setVisionModel(model) {
  selectedVisionModel = model;
  const service = getLlamaService();
  if (service) {
    await service.updateConfig({ visionModel: model });
  }
}

/**
 * Set embedding model
 * @param {string} model - Model filename
 */
async function setEmbeddingModel(model) {
  selectedEmbeddingModel = model;
  const service = getLlamaService();
  if (service) {
    await service.updateConfig({ embeddingModel: model });
  }
}

// Helper to detect legacy Ollama model names
const isLegacyModelName = (name) => {
  if (!name || typeof name !== 'string') return false;
  return !name.endsWith('.gguf') && (name.includes(':') || !name.includes('.'));
};

/**
 * Load configuration from settings
 */
async function loadLlamaConfig() {
  try {
    const { getInstance: getSettings } = require('./services/SettingsService');
    const settings = getSettings();
    const allSettings = settings?.getAll?.() || {};

    // Helper to resolve model name
    const resolveModel = (configured, defaultName) => {
      if (!configured) return defaultName;
      if (isLegacyModelName(configured)) return defaultName;
      return configured;
    };

    // Load model names from settings or use defaults
    selectedTextModel = resolveModel(
      allSettings.textModel,
      AI_DEFAULTS.TEXT?.MODEL ?? DEFAULT_AI_MODELS.TEXT_ANALYSIS
    );
    selectedVisionModel = resolveModel(
      allSettings.visionModel,
      AI_DEFAULTS.IMAGE?.MODEL ?? DEFAULT_AI_MODELS.IMAGE_ANALYSIS
    );
    selectedEmbeddingModel = resolveModel(
      allSettings.embeddingModel,
      AI_DEFAULTS.EMBEDDING?.MODEL ?? DEFAULT_AI_MODELS.EMBEDDING
    );

    logger.info('[LlamaUtils] Config loaded', {
      textModel: selectedTextModel,
      visionModel: selectedVisionModel,
      embeddingModel: selectedEmbeddingModel
    });

    return {
      selectedTextModel,
      selectedVisionModel,
      selectedEmbeddingModel
    };
  } catch (error) {
    logger.warn('[LlamaUtils] Failed to load config:', error.message);
    return {
      selectedTextModel,
      selectedVisionModel,
      selectedEmbeddingModel
    };
  }
}

/**
 * Get embedding dimensions for current model
 * @returns {number}
 */
function getEmbeddingDimensions() {
  // nomic-embed-text v1.5 uses 768 dimensions
  return AI_DEFAULTS.EMBEDDING?.DIMENSIONS || 768;
}

/**
 * Clean up resources
 */
async function cleanup() {
  // FIX: LlamaService shutdown is managed by ServiceContainer/ServiceIntegration.
  // We do not manually shut it down here to avoid double-dispose issues.
  // This function is kept for backward compatibility with scripts.
  const service = getLlamaService();
  if (service && typeof service.shutdown === 'function') {
    // Only shut down if not managed by container (e.g. in standalone scripts)
    // But we can't easily tell. Safe to rely on container shutdown.
  }
}

// Backward compatibility aliases
const getLlamaModel = getTextModel;
const getLlamaVisionModel = getVisionModel;
const getLlamaEmbeddingModel = getEmbeddingModel;
const setLlamaModel = setTextModel;
const setLlamaVisionModel = setVisionModel;
const setLlamaEmbeddingModel = setEmbeddingModel;

module.exports = {
  // Primary exports
  getLlamaService,
  getTextModel,
  getVisionModel,
  getEmbeddingModel,
  setTextModel,
  setVisionModel,
  setEmbeddingModel,
  loadLlamaConfig,
  getEmbeddingDimensions,
  cleanup,

  // Aliases
  getLlamaModel,
  getLlamaVisionModel,
  getLlamaEmbeddingModel,
  setLlamaModel,
  setLlamaVisionModel,
  setLlamaEmbeddingModel
};
