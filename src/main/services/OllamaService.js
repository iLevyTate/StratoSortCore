const { logger } = require('../../shared/logger');
logger.setContext('OllamaService');
const { Ollama } = require('ollama'); // MEDIUM PRIORITY FIX (MED-10): Import Ollama for temporary instances

/**
 * MED-5: Simple sliding window rate limiter for Ollama calls
 * Prevents overwhelming the Ollama server with too many concurrent requests
 */
class RateLimiter {
  /**
   * @param {number} maxCalls - Maximum calls allowed in the time window
   * @param {number} windowMs - Time window in milliseconds
   */
  constructor(maxCalls, windowMs) {
    this.maxCalls = maxCalls;
    this.windowMs = windowMs;
    this.calls = [];
  }

  /**
   * Check if a new call can be made
   * @returns {boolean} True if call is allowed
   */
  canCall() {
    this._cleanup();
    return this.calls.length < this.maxCalls;
  }

  /**
   * Record a call timestamp
   */
  recordCall() {
    this._cleanup();
    this.calls.push(Date.now());
  }

  /**
   * Remove expired timestamps from the sliding window
   * @private
   */
  _cleanup() {
    const cutoff = Date.now() - this.windowMs;
    this.calls = this.calls.filter(t => t > cutoff);
  }

  /**
   * Wait until a slot is available
   * @returns {Promise<void>}
   */
  async waitForSlot() {
    while (!this.canCall()) {
      await new Promise(r => setTimeout(r, 100));
    }
  }

  /**
   * Get current rate limiter stats
   * @returns {{currentCalls: number, maxCalls: number, windowMs: number}}
   */
  getStats() {
    this._cleanup();
    return {
      currentCalls: this.calls.length,
      maxCalls: this.maxCalls,
      windowMs: this.windowMs,
    };
  }
}

// Global rate limiter: 5 concurrent requests per second max
const ollamaRateLimiter = new RateLimiter(5, 1000);

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
const { withOllamaRetry } = require('../utils/ollamaApiRetry');
const { getInstance: getOllamaClient } = require('./OllamaClient');

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
        logger.warn('[OllamaService] OllamaClient initialization failed (non-fatal):', clientError.message);
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
      const clientHealth = this._ollamaClient.getHealthStatus();
      const clientStats = this._ollamaClient.getStats();

      return {
        ...basicHealth,
        resilientClient: {
          isHealthy: clientHealth.isHealthy,
          activeRequests: clientHealth.activeRequests,
          queuedRequests: clientHealth.queuedRequests,
          offlineQueueSize: clientHealth.offlineQueueSize,
          consecutiveFailures: clientHealth.consecutiveFailures,
          lastHealthCheck: clientHealth.lastHealthCheck,
        },
        stats: {
          totalRequests: clientStats.totalRequests,
          successfulRequests: clientStats.successfulRequests,
          failedRequests: clientStats.failedRequests,
          retriedRequests: clientStats.retriedRequests,
          avgLatencyMs: clientStats.avgLatencyMs,
        },
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
        ),
      ]);
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
    const GET_MODELS_TIMEOUT = 15000; // 15 second timeout
    try {
      const ollama = getOllama();
      // FIX: Add timeout protection to prevent hanging on unresponsive servers
      const response = await Promise.race([
        ollama.list(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Get models timeout')), GET_MODELS_TIMEOUT)
        ),
      ]);
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
    return withOllamaRetry(
      async () => {
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
      },
      {
        operation: 'generateEmbedding',
        maxRetries: 3,
      },
    ).catch((error) => {
      // Final error handling after retries exhausted
      logger.error('[OllamaService] Failed to generate embedding:', error);
      return {
        success: false,
        error: error.message,
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

        const response = await ollama.generate({
          model,
          prompt,
          format: options.format,
          system: options.system,
          options: options.ollamaOptions || {},
          stream: false,
        });

        return {
          success: true,
          response: response.response,
        };
      },
      {
        operation: 'analyzeText',
        maxRetries: 3,
      },
    ).catch((error) => {
      logger.error('[OllamaService] Failed to analyze text:', error);
      return {
        success: false,
        error: error.message,
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

        const response = await ollama.generate({
          model,
          prompt,
          images: [imageBase64],
          format: options.format,
          options: options.ollamaOptions || {},
          stream: false,
        });

        return {
          success: true,
          response: response.response,
        };
      },
      {
        operation: 'analyzeImage',
        maxRetries: 3,
      },
    ).catch((error) => {
      logger.error('[OllamaService] Failed to analyze image:', error);
      return {
        success: false,
        error: error.message,
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

    const model = options.model || getOllamaEmbeddingModel();
    const startTime = Date.now();

    // Use OllamaClient if available for resilient batch processing
    if (this._ollamaClient) {
      try {
        const result = await this._ollamaClient.batchEmbeddings(items, {
          model,
          onProgress: options.onProgress,
          batchSize: options.batchSize || 10,
        });

        return {
          success: result.errors.length === 0,
          results: result.results,
          errors: result.errors,
          stats: {
            total: items.length,
            successful: result.results.length,
            failed: result.errors.length,
            duration: Date.now() - startTime,
          },
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
            success: true,
          });
        } else {
          errors.push({
            id: item.id,
            error: response.error,
            success: false,
          });
        }
      } catch (error) {
        errors.push({
          id: item.id,
          error: error.message,
          success: false,
        });
      }

      if (options.onProgress) {
        options.onProgress({
          completed: i + 1,
          total: items.length,
          percent: Math.round(((i + 1) / items.length) * 100),
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
        duration: Date.now() - startTime,
      },
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
      message: 'OllamaClient not initialized',
    };
  }
}

// Singleton instance for backward compatibility
let instance = null;

/**
 * Get the singleton OllamaService instance
 *
 * This function provides the singleton instance for backward compatibility.
 * For new code, prefer using the ServiceContainer:
 *
 * @example
 * // Using ServiceContainer (recommended)
 * const { container, ServiceIds } = require('./ServiceContainer');
 * const ollama = container.resolve(ServiceIds.OLLAMA);
 *
 * // Using getInstance (backward compatible)
 * const ollamaService = require('./OllamaService');
 * // or
 * const { getInstance } = require('./OllamaService');
 * const ollama = getInstance();
 *
 * @returns {OllamaService} The singleton instance
 */
function getInstance() {
  if (!instance) {
    instance = new OllamaService();
  }
  return instance;
}

/**
 * Create a new OllamaService instance (for testing or custom configuration)
 *
 * Unlike getInstance(), this creates a fresh instance not tied to the singleton.
 * Useful for testing or when custom configuration is needed.
 *
 * @returns {OllamaService} A new OllamaService instance
 */
function createInstance() {
  return new OllamaService();
}

/**
 * Reset the singleton instance (primarily for testing)
 */
function resetInstance() {
  instance = null;
}

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
  // Factory functions for DI
  OllamaService,
  getInstance,
  createInstance,
  resetInstance,
};
