const { logger } = require('../../shared/logger');
logger.setContext('OllamaService');
const { Ollama } = require('ollama'); // MEDIUM PRIORITY FIX (MED-10): Import Ollama for temporary instances
const {
  getOllama,
  getOllamaModel,
  getOllamaVisionModel,
  getOllamaEmbeddingModel,
  getOllamaHost,
  setOllamaModel,
  setOllamaVisionModel,
  setOllamaEmbeddingModel,
  setOllamaHost,
  loadOllamaConfig,
  saveOllamaConfig,
} = require('../ollamaUtils');

/**
 * Centralized service for Ollama operations
 * Reduces code duplication and provides consistent error handling
 */
class OllamaService {
  constructor() {
    this.initialized = false;
  }

  async initialize() {
    if (this.initialized) return;
    try {
      await loadOllamaConfig();
      this.initialized = true;
      logger.info('[OllamaService] Initialized successfully');
    } catch (error) {
      logger.error('[OllamaService] Failed to initialize:', error);
      throw error;
    }
  }

  /**
   * Get the current Ollama configuration
   */
  async getConfig() {
    await this.initialize();
    return {
      host: getOllamaHost(),
      textModel: getOllamaModel(),
      visionModel: getOllamaVisionModel(),
      embeddingModel: getOllamaEmbeddingModel(),
    };
  }

  /**
   * Update Ollama configuration
   */
  async updateConfig(config) {
    await this.initialize();
    try {
      if (config.host) await setOllamaHost(config.host);
      if (config.textModel) await setOllamaModel(config.textModel);
      if (config.visionModel) await setOllamaVisionModel(config.visionModel);
      if (config.embeddingModel)
        await setOllamaEmbeddingModel(config.embeddingModel);

      await saveOllamaConfig();
      logger.info('[OllamaService] Configuration updated');
      return { success: true };
    } catch (error) {
      logger.error('[OllamaService] Failed to update config:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Test connection to Ollama server
   * MEDIUM PRIORITY FIX (MED-10): Create temporary instance to actually test specified host
   */
  async testConnection(hostUrl) {
    try {
      const testHost = hostUrl || getOllamaHost();

      // Create a temporary Ollama instance with the test host
      // This ensures we're actually testing the specified host, not the current one
      const testOllama = new Ollama({ host: testHost });

      // Try to list models as a connection test
      const response = await testOllama.list();
      const modelCount = response?.models?.length || 0;

      logger.info(`[OllamaService] Connection test successful for ${testHost}`);
      return {
        success: true,
        ollamaHealth: {
          status: 'healthy',
          modelCount,
          host: testHost,
        },
        modelCount,
      };
    } catch (error) {
      logger.error('[OllamaService] Connection test failed:', error);
      return {
        success: false,
        error: error.message,
        ollamaHealth: {
          status: 'unhealthy',
          error: error.message,
          host: hostUrl || getOllamaHost(),
        },
      };
    }
  }

  /**
   * Get available models organized by category
   */
  async getModels() {
    try {
      const ollama = getOllama();
      const response = await ollama.list();
      const models = response?.models || [];

      // Categorize models
      const categories = {
        text: [],
        vision: [],
        embedding: [],
      };

      models.forEach((model) => {
        const name = model.name || model;
        const lowerName = name.toLowerCase();

        // Categorize based on model name patterns
        if (lowerName.includes('embed') || lowerName.includes('mxbai')) {
          categories.embedding.push(name);
        } else if (
          lowerName.includes('llava') ||
          lowerName.includes('vision')
        ) {
          categories.vision.push(name);
        } else {
          categories.text.push(name);
        }
      });

      return {
        success: true,
        models,
        categories,
        selected: {
          textModel: getOllamaModel(),
          visionModel: getOllamaVisionModel(),
          embeddingModel: getOllamaEmbeddingModel(),
        },
        host: getOllamaHost(),
        ollamaHealth: {
          status: 'healthy',
          modelCount: models.length,
        },
      };
    } catch (error) {
      logger.error('[OllamaService] Failed to get models:', error);
      return {
        success: false,
        error: error.message,
        models: [],
        categories: { text: [], vision: [], embedding: [] },
        ollamaHealth: {
          status: 'unhealthy',
          error: error.message,
        },
      };
    }
  }

  /**
   * Pull models from Ollama registry
   */
  async pullModels(modelNames) {
    if (!Array.isArray(modelNames) || modelNames.length === 0) {
      return { success: false, error: 'No models specified', results: [] };
    }

    // LOW PRIORITY FIX (LOW-10): Validate model names before pulling
    const invalidModels = modelNames.filter((name) => {
      if (typeof name !== 'string' || !name.trim()) return true;
      // Valid Ollama model names: alphanumeric, hyphens, underscores, dots, colons (for tags)
      // Reject path traversal and invalid characters
      return !/^[a-zA-Z0-9._-]+(?::[a-zA-Z0-9._-]+)?$/.test(name.trim());
    });

    if (invalidModels.length > 0) {
      logger.warn('[OllamaService] Invalid model names rejected', {
        invalidModels,
      });
      return {
        success: false,
        error: `Invalid model name(s): ${invalidModels.join(', ')}`,
        results: [],
      };
    }

    const results = [];
    const ollama = getOllama();

    for (const modelName of modelNames) {
      try {
        logger.info(`[OllamaService] Pulling model: ${modelName}`);
        await ollama.pull({ model: modelName });
        results.push({ model: modelName, success: true });
      } catch (error) {
        logger.error(`[OllamaService] Failed to pull ${modelName}:`, error);
        results.push({
          model: modelName,
          success: false,
          error: error.message,
        });
      }
    }

    return {
      success: results.some((r) => r.success),
      results,
    };
  }

  /**
   * Generate embeddings for text
   */
  async generateEmbedding(text, options = {}) {
    try {
      const ollama = getOllama();
      const model = options.model || getOllamaEmbeddingModel();

      const response = await ollama.embeddings({
        model,
        prompt: text,
        options: options.ollamaOptions || {},
      });

      return {
        success: true,
        embedding: response.embedding,
      };
    } catch (error) {
      logger.error('[OllamaService] Failed to generate embedding:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Analyze text with LLM
   */
  async analyzeText(prompt, options = {}) {
    try {
      const ollama = getOllama();
      const model = options.model || getOllamaModel();

      const response = await ollama.generate({
        model,
        prompt,
        options: options.ollamaOptions || {},
        stream: false,
      });

      return {
        success: true,
        response: response.response,
      };
    } catch (error) {
      logger.error('[OllamaService] Failed to analyze text:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Analyze image with vision model
   */
  async analyzeImage(prompt, imageBase64, options = {}) {
    try {
      const ollama = getOllama();
      const model = options.model || getOllamaVisionModel();

      const response = await ollama.generate({
        model,
        prompt,
        images: [imageBase64],
        options: options.ollamaOptions || {},
        stream: false,
      });

      return {
        success: true,
        response: response.response,
      };
    } catch (error) {
      logger.error('[OllamaService] Failed to analyze image:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  }
}

// Export singleton instance
module.exports = new OllamaService();
