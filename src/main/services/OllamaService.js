const { logger } = require('../../shared/logger');
const { createOllamaRateLimiter } = require('../../shared/RateLimiter');
logger.setContext('OllamaService');
const { Ollama } = require('ollama'); // MEDIUM PRIORITY FIX (MED-10): Import Ollama for temporary instances

// Use shared rate limiter: 5 requests per second max
const ollamaRateLimiter = createOllamaRateLimiter({ maxCalls: 5, windowMs: 1000 });

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
  loadOllamaConfig
} = require('../ollamaUtils');
const { withOllamaRetry } = require('../utils/ollamaApiRetry');
const { getInstance: getOllamaClient } = require('./OllamaClient');
const { buildOllamaOptions } = require('./PerformanceService');
const { categorizeModels } = require('../../shared/modelCategorization');

/**
 * Centralized service for Ollama operations
 * Reduces code duplication and provides consistent error handling
 *
 * Enhanced with:
 * - Health monitoring via OllamaClient
 * - Batch embedding support
 * - Offline queue integration
 * - Comprehensive statistics
 */
class OllamaService {
  constructor() {
    this.initialized = false;
    this._ollamaClient = null;
    this._modelChangeCallbacks = new Set();
    this._previousEmbeddingModel = null;
  }

  /**
   * Subscribe to model change events
   * @param {Function} callback - Called with {type, previousModel, newModel} when model changes
   * @returns {Function} Unsubscribe function
   */
  onModelChange(callback) {
    if (typeof callback !== 'function') {
      throw new Error('onModelChange requires a function callback');
    }
    this._modelChangeCallbacks.add(callback);
    return () => this._modelChangeCallbacks.delete(callback);
  }

  /**
   * Notify all subscribers of a model change
   * FIX: Made async to properly await callback promises
   * @param {string} type - Model type ('embedding', 'text', 'vision')
   * @param {string} previousModel - Previous model name
   * @param {string} newModel - New model name
   */
  async _notifyModelChange(type, previousModel, newModel) {
    if (previousModel === newModel) return;

    logger.info('[OllamaService] Model changed', { type, from: previousModel, to: newModel });

    // FIX: Use Promise.allSettled to await all callbacks including async ones
    // Previously, async callbacks were not awaited, causing race conditions
    // where dependent operations (like ChromaDB reset) weren't complete before
    // the caller continued.
    const results = await Promise.allSettled(
      Array.from(this._modelChangeCallbacks).map(async (callback) => {
        try {
          await callback({ type, previousModel, newModel });
        } catch (error) {
          logger.error('[OllamaService] Error in model change callback:', error.message);
          throw error; // Re-throw so allSettled records it as rejected
        }
      })
    );

    // Log any failures for debugging
    const failures = results.filter((r) => r.status === 'rejected');
    if (failures.length > 0) {
      logger.warn('[OllamaService] Some model change callbacks failed', {
        total: results.length,
        failed: failures.length
      });
    }
  }

  async initialize() {
    if (this.initialized) return;
    try {
      await loadOllamaConfig();

      // Initialize the resilient OllamaClient
      try {
        this._ollamaClient = getOllamaClient();
        await this._ollamaClient.initialize();
      } catch (clientError) {
        logger.warn(
          '[OllamaService] OllamaClient initialization failed (non-fatal):',
          clientError.message
        );
        // Continue without resilient client - fallback to basic operations
      }

      this.initialized = true;
      logger.info('[OllamaService] Initialized successfully');
    } catch (error) {
      logger.error('[OllamaService] Failed to initialize:', error);
      throw error;
    }
  }

  /**
   * Get the resilient OllamaClient instance
   * @returns {OllamaClient|null}
   */
  getClient() {
    return this._ollamaClient;
  }

  /**
   * Get health status of the Ollama service
   * @returns {Object} Health status including availability, latency, queue stats
   */
  async getHealthStatus() {
    await this.initialize();

    const basicHealth = await this.testConnection();

    // Add detailed stats from OllamaClient if available
    if (this._ollamaClient) {
      // Use optional chaining to prevent null access errors
      const clientHealth = this._ollamaClient.getHealthStatus?.() || {};
      const clientStats = this._ollamaClient.getStats?.() || {};

      return {
        ...basicHealth,
        resilientClient: {
          isHealthy: clientHealth.isHealthy ?? false,
          activeRequests: clientHealth.activeRequests ?? 0,
          queuedRequests: clientHealth.queuedRequests ?? 0,
          offlineQueueSize: clientHealth.offlineQueueSize ?? 0,
          consecutiveFailures: clientHealth.consecutiveFailures ?? 0,
          lastHealthCheck: clientHealth.lastHealthCheck ?? null
        },
        stats: {
          totalRequests: clientStats.totalRequests ?? 0,
          successfulRequests: clientStats.successfulRequests ?? 0,
          failedRequests: clientStats.failedRequests ?? 0,
          retriedRequests: clientStats.retriedRequests ?? 0,
          avgLatencyMs: clientStats.avgLatencyMs ?? 0
        }
      };
    }

    return basicHealth;
  }

  /**
   * Graceful shutdown
   */
  async shutdown() {
    logger.info('[OllamaService] Shutting down...');

    if (this._ollamaClient) {
      await this._ollamaClient.shutdown();
    }

    logger.info('[OllamaService] Shutdown complete');
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
      embeddingModel: getOllamaEmbeddingModel()
    };
  }

  /**
   * Update Ollama configuration
   */
  async updateConfig(config) {
    await this.initialize();
    try {
      // Track previous models for change notification
      const previousTextModel = getOllamaModel();
      const previousVisionModel = getOllamaVisionModel();
      const previousEmbeddingModel = getOllamaEmbeddingModel();

      if (config.host) await setOllamaHost(config.host);

      if (config.textModel) {
        await setOllamaModel(config.textModel);
        // FIX: Await async notification to ensure callbacks complete
        await this._notifyModelChange('text', previousTextModel, config.textModel);
      }

      if (config.visionModel) {
        await setOllamaVisionModel(config.visionModel);
        // FIX: Await async notification to ensure callbacks complete
        await this._notifyModelChange('vision', previousVisionModel, config.visionModel);
      }

      // FIX: Expanded allowlist to include all known embedding models
      // This allows users to use any model they have installed from popular options
      const ALLOWED_EMBED_MODELS = [
        'embeddinggemma', // Google's embedding model (768 dim)
        'mxbai-embed-large', // Mixed Bread AI (1024 dim)
        'nomic-embed-text', // Nomic AI (768 dim)
        'all-minilm', // Sentence Transformers (384 dim)
        'bge-large', // BAAI (1024 dim)
        'snowflake-arctic-embed', // Snowflake (1024 dim)
        'gte' // Alibaba GTE models (various dims)
      ];

      if (config.embeddingModel) {
        // Check if model is in allowlist or matches a known prefix
        const normalizedModel = config.embeddingModel.toLowerCase();
        const isAllowed =
          ALLOWED_EMBED_MODELS.includes(config.embeddingModel) ||
          ALLOWED_EMBED_MODELS.some((allowed) => normalizedModel.includes(allowed.toLowerCase()));

        const embedModel = isAllowed ? config.embeddingModel : 'embeddinggemma';

        if (!isAllowed) {
          logger.warn('[OllamaService] Rejected invalid embedding model', {
            requested: config.embeddingModel,
            allowed: ALLOWED_EMBED_MODELS,
            usingDefault: embedModel
          });
        }

        await setOllamaEmbeddingModel(embedModel);
        // FIX: Await async notification to ensure callbacks complete (critical for embedding model
        // changes since ChromaDB collections need to be reset before continuing)
        await this._notifyModelChange('embedding', previousEmbeddingModel, embedModel);
      }

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
    const CONNECTION_TEST_TIMEOUT = 10000; // 10 second timeout
    try {
      const testHost = hostUrl || getOllamaHost();

      // Create a temporary Ollama instance with the test host
      // This ensures we're actually testing the specified host, not the current one
      const testOllama = new Ollama({ host: testHost });

      // FIX: Add timeout protection to prevent hanging on unresponsive servers
      const response = await Promise.race([
        testOllama.list(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Connection test timeout')), CONNECTION_TEST_TIMEOUT)
        )
      ]);
      const modelCount = response?.models?.length || 0;

      logger.info(`[OllamaService] Connection test successful for ${testHost}`);
      return {
        success: true,
        ollamaHealth: {
          status: 'healthy',
          modelCount,
          host: testHost
        },
        modelCount
      };
    } catch (error) {
      logger.error('[OllamaService] Connection test failed:', error);
      return {
        success: false,
        error: error.message,
        ollamaHealth: {
          status: 'unhealthy',
          error: error.message,
          host: hostUrl || getOllamaHost()
        }
      };
    }
  }

  /**
   * Get available models organized by category
   */
  async getModels() {
    const GET_MODELS_TIMEOUT = 15000; // 15 second timeout
    try {
      const ollama = getOllama();
      // FIX: Add timeout protection to prevent hanging on unresponsive servers
      const response = await Promise.race([
        ollama.list(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Get models timeout')), GET_MODELS_TIMEOUT)
        )
      ]);
      const models = response?.models || [];

      // Use shared categorization utility (handles sorting)
      const categories = categorizeModels(models);

      return {
        success: true,
        models,
        categories,
        selected: {
          textModel: getOllamaModel(),
          visionModel: getOllamaVisionModel(),
          embeddingModel: getOllamaEmbeddingModel()
        },
        host: getOllamaHost(),
        ollamaHealth: {
          status: 'healthy',
          modelCount: models.length
        }
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
          error: error.message
        }
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
        invalidModels
      });
      return {
        success: false,
        error: `Invalid model name(s): ${invalidModels.join(', ')}`,
        results: []
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
          error: error.message
        });
      }
    }

    return {
      success: results.some((r) => r.success),
      results
    };
  }

  /**
   * Generate embeddings for text with fallback model chain
   * FIX: Implements robust fallback logic when primary model is not available
   */
  async generateEmbedding(text, options = {}) {
    const { AI_DEFAULTS } = require('../../shared/constants');
    const primaryModel = options.model || getOllamaEmbeddingModel() || AI_DEFAULTS.EMBEDDING.MODEL;

    // If skipFallback is true or a specific model was requested, don't use fallback chain
    if (options.skipFallback || options.model) {
      return this._generateEmbeddingWithModel(text, primaryModel, options);
    }

    // FIX: Build fallback chain - start with configured model, then fallbacks
    const fallbackModels = AI_DEFAULTS.EMBEDDING.FALLBACK_MODELS || [primaryModel];
    const modelChain = [primaryModel];

    // Add fallback models that aren't already the primary
    for (const model of fallbackModels) {
      if (!modelChain.includes(model)) {
        modelChain.push(model);
      }
    }

    // Try each model in the chain
    const errors = [];
    for (const model of modelChain) {
      try {
        const result = await this._generateEmbeddingWithModel(text, model, options);
        if (result.success) {
          // Log if we used a fallback
          if (model !== primaryModel) {
            logger.info(
              `[OllamaService] Using fallback embedding model: ${model} (primary: ${primaryModel})`
            );
          }
          return result;
        }
        errors.push({ model, error: result.error });
      } catch (error) {
        // Check if error indicates model not found (should try fallback)
        const isModelNotFound = /not found|does not exist|unknown model/i.test(error.message);
        errors.push({ model, error: error.message });

        if (!isModelNotFound) {
          // For non-model-not-found errors, log and continue to next model
          logger.warn(
            `[OllamaService] Embedding with ${model} failed, trying next:`,
            error.message
          );
        }
      }
    }

    // All models failed - aggregate errors
    const errorSummary = errors.map((e) => `${e.model}: ${e.error}`).join('; ');
    logger.error('[OllamaService] All embedding models failed:', errorSummary);
    return {
      success: false,
      error: `All embedding models failed: ${errorSummary}`,
      attemptedModels: modelChain,
      errors
    };
  }

  /**
   * Generate embedding with a specific model (internal helper)
   * @private
   */
  async _generateEmbeddingWithModel(text, model, options = {}) {
    return withOllamaRetry(
      async () => {
        const ollama = getOllama();
        const perfOptions = await buildOllamaOptions('embeddings');
        const mergedOptions = { ...perfOptions, ...(options.ollamaOptions || {}) };

        // Use the newer embed() API with 'input' parameter (embeddings() with 'prompt' is deprecated)
        const response = await ollama.embed({
          model,
          input: text,
          options: mergedOptions
        });

        // embed() returns embeddings array; extract first vector
        const embedding =
          Array.isArray(response.embeddings) && response.embeddings.length > 0
            ? response.embeddings[0]
            : [];

        return {
          success: true,
          embedding,
          model // Include which model was used
        };
      },
      {
        operation: 'generateEmbedding',
        maxRetries: options.maxRetries ?? 3
      }
    ).catch((error) => {
      // Final error handling after retries exhausted
      logger.error(`[OllamaService] Failed to generate embedding with ${model}:`, error.message);
      return {
        success: false,
        error: error.message,
        model
      };
    });
  }

  /**
   * Analyze text with LLM
   * MED-5: Rate limited to prevent overwhelming Ollama server
   */
  async analyzeText(prompt, options = {}) {
    // MED-5: Wait for rate limiter slot before making request
    await ollamaRateLimiter.waitForSlot();
    ollamaRateLimiter.recordCall();

    return withOllamaRetry(
      async () => {
        const ollama = getOllama();
        const model = options.model || getOllamaModel();
        const perfOptions = await buildOllamaOptions('text');
        const mergedOptions = { ...perfOptions, ...(options.ollamaOptions || {}) };

        const response = await ollama.generate({
          model,
          prompt,
          format: options.format,
          system: options.system,
          options: mergedOptions,
          stream: false
        });

        return {
          success: true,
          response: response.response
        };
      },
      {
        operation: 'analyzeText',
        maxRetries: 3
      }
    ).catch((error) => {
      logger.error('[OllamaService] Failed to analyze text:', error);
      return {
        success: false,
        error: error.message
      };
    });
  }

  /**
   * Analyze image with vision model
   * MED-5: Rate limited to prevent overwhelming Ollama server
   */
  async analyzeImage(prompt, imageBase64, options = {}) {
    // MED-5: Wait for rate limiter slot before making request
    await ollamaRateLimiter.waitForSlot();
    ollamaRateLimiter.recordCall();

    return withOllamaRetry(
      async () => {
        const ollama = getOllama();
        const model = options.model || getOllamaVisionModel();
        const perfOptions = await buildOllamaOptions('vision');
        const mergedOptions = { ...perfOptions, ...(options.ollamaOptions || {}) };

        const response = await ollama.generate({
          model,
          prompt,
          images: [imageBase64],
          format: options.format,
          options: mergedOptions,
          stream: false
        });

        return {
          success: true,
          response: response.response
        };
      },
      {
        operation: 'analyzeImage',
        maxRetries: 3
      }
    ).catch((error) => {
      logger.error('[OllamaService] Failed to analyze image:', error);
      return {
        success: false,
        error: error.message
      };
    });
  }

  /**
   * Generate embeddings for multiple texts in a batch
   * Uses the resilient OllamaClient for controlled concurrency
   * @param {Array<{id: string, text: string}>} items - Items to embed
   * @param {Object} options - Options
   * @param {string} [options.model] - Model to use (defaults to configured embedding model)
   * @param {Function} [options.onProgress] - Progress callback
   * @param {number} [options.batchSize=10] - Batch size for processing
   * @returns {Promise<{results: Array, errors: Array, stats: Object}>}
   */
  async batchGenerateEmbeddings(items, options = {}) {
    await this.initialize();

    // FIX: Add fallback to default embedding model when none configured
    const { AI_DEFAULTS } = require('../../shared/constants');
    const model = options.model || getOllamaEmbeddingModel() || AI_DEFAULTS.EMBEDDING.MODEL;
    const startTime = Date.now();

    // Use OllamaClient if available for resilient batch processing
    if (this._ollamaClient) {
      try {
        const result = await this._ollamaClient.batchEmbeddings(items, {
          model,
          onProgress: options.onProgress,
          batchSize: options.batchSize || 10
        });

        return {
          success: result.errors.length === 0,
          results: result.results,
          errors: result.errors,
          stats: {
            total: items.length,
            successful: result.results.length,
            failed: result.errors.length,
            duration: Date.now() - startTime
          }
        };
      } catch (error) {
        logger.error('[OllamaService] Batch embedding via OllamaClient failed:', error.message);
        // Fall through to basic implementation
      }
    }

    // Fallback: Process sequentially with basic retry
    const results = [];
    const errors = [];

    for (let i = 0; i < items.length; i++) {
      const item = items[i];

      try {
        const response = await this.generateEmbedding(item.text, { model });

        if (response.success) {
          results.push({
            id: item.id,
            embedding: response.embedding,
            success: true
          });
        } else {
          errors.push({
            id: item.id,
            error: response.error,
            success: false
          });
        }
      } catch (error) {
        errors.push({
          id: item.id,
          error: error.message,
          success: false
        });
      }

      if (options.onProgress) {
        options.onProgress({
          completed: i + 1,
          total: items.length,
          percent: Math.round(((i + 1) / items.length) * 100)
        });
      }
    }

    return {
      success: errors.length === 0,
      results,
      errors,
      stats: {
        total: items.length,
        successful: results.length,
        failed: errors.length,
        duration: Date.now() - startTime
      }
    };
  }

  /**
   * Check if Ollama service is available and healthy
   * @returns {Promise<boolean>}
   */
  async isAvailable() {
    try {
      const health = await this.testConnection();
      return health.success;
    } catch {
      return false;
    }
  }

  /**
   * Get statistics about Ollama operations
   * @returns {Object}
   */
  getStats() {
    if (this._ollamaClient) {
      return this._ollamaClient.getStats();
    }
    return {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      avgLatencyMs: 0,
      message: 'OllamaClient not initialized'
    };
  }
}

// Use shared singleton factory for getInstance, registerWithContainer, resetInstance
const { createSingletonHelpers } = require('../../shared/singletonFactory');

const { getInstance, createInstance, registerWithContainer, resetInstance } =
  createSingletonHelpers({
    ServiceClass: OllamaService,
    serviceId: 'OLLAMA_SERVICE',
    serviceName: 'OllamaService',
    containerPath: './ServiceContainer',
    shutdownMethod: 'shutdown'
  });

// Create the default singleton instance for backward compatibility
// This maintains the original export pattern: require('./OllamaService').someMethod()
const defaultInstance = getInstance();

// Export both the instance methods and the factory functions
module.exports = {
  // Spread the instance for backward compatibility
  ...defaultInstance,
  // Bind methods to maintain 'this' context
  initialize: defaultInstance.initialize.bind(defaultInstance),
  getConfig: defaultInstance.getConfig.bind(defaultInstance),
  updateConfig: defaultInstance.updateConfig.bind(defaultInstance),
  testConnection: defaultInstance.testConnection.bind(defaultInstance),
  getModels: defaultInstance.getModels.bind(defaultInstance),
  pullModels: defaultInstance.pullModels.bind(defaultInstance),
  generateEmbedding: defaultInstance.generateEmbedding.bind(defaultInstance),
  analyzeText: defaultInstance.analyzeText.bind(defaultInstance),
  analyzeImage: defaultInstance.analyzeImage.bind(defaultInstance),
  // New resilience methods
  batchGenerateEmbeddings: defaultInstance.batchGenerateEmbeddings.bind(defaultInstance),
  getHealthStatus: defaultInstance.getHealthStatus.bind(defaultInstance),
  isAvailable: defaultInstance.isAvailable.bind(defaultInstance),
  getStats: defaultInstance.getStats.bind(defaultInstance),
  getClient: defaultInstance.getClient.bind(defaultInstance),
  shutdown: defaultInstance.shutdown.bind(defaultInstance),
  onModelChange: defaultInstance.onModelChange.bind(defaultInstance),
  // Factory functions for DI
  OllamaService,
  getInstance,
  createInstance,
  resetInstance,
  registerWithContainer
};
