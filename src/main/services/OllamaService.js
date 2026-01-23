const { logger } = require('../../shared/logger');
const { createOllamaRateLimiter } = require('../../shared/RateLimiter');
const { TIMEOUTS } = require('../../shared/performanceConstants');

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
const { capEmbeddingInput } = require('../utils/embeddingInput');

// FIX: Module-level constant for allowed embedding models (used by all updateConfig methods)
const ALLOWED_EMBED_MODELS = [
  'embeddinggemma', // Google's embedding model (768 dim)
  'mxbai-embed-large', // Mixed Bread AI (1024 dim)
  'nomic-embed-text', // Nomic AI (768 dim)
  'all-minilm', // Sentence Transformers (384 dim)
  'bge-large', // BAAI (1024 dim)
  'snowflake-arctic-embed', // Snowflake (1024 dim)
  'gte' // Alibaba GTE models (various dims)
];

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

    // FIX: Return failures info so callers can handle appropriately
    const failures = results.filter((r) => r.status === 'rejected');
    if (failures.length > 0) {
      logger.warn('[OllamaService] Some model change callbacks failed', {
        total: results.length,
        failed: failures.length,
        errors: failures.map((f) => f.reason?.message || 'Unknown error')
      });
    }
    return { total: results.length, failed: failures.length, failures };
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

    // FIX L2: Clear model change callbacks to prevent memory leaks
    this._modelChangeCallbacks.clear();

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
   * @param {object} config - Configuration object with model settings
   * @param {object} [options] - Options for the update
   * @param {boolean} [options.skipSave=false] - Skip saving to settings file (use when already in a save operation)
   */
  async updateConfig(config, options = {}) {
    const { skipSave = false } = options;
    await this.initialize();
    try {
      // Track previous models for change notification
      const previousTextModel = getOllamaModel();
      const previousVisionModel = getOllamaVisionModel();
      const previousEmbeddingModel = getOllamaEmbeddingModel();

      // FIX: Track model downgrade at method scope so it can be returned
      let modelWasDowngraded = false;
      // FIX #9: Track callback failures to return accurate count instead of hardcoded 0
      let totalCallbackFailures = 0;

      if (config.host) await setOllamaHost(config.host, !skipSave);

      if (config.textModel) {
        await setOllamaModel(config.textModel, !skipSave);
        // FIX: Await async notification to ensure callbacks complete
        const result = await this._notifyModelChange('text', previousTextModel, config.textModel);
        if (result?.failed) totalCallbackFailures += result.failed;
      }

      if (config.visionModel) {
        await setOllamaVisionModel(config.visionModel, !skipSave);
        // FIX: Await async notification to ensure callbacks complete
        const result = await this._notifyModelChange(
          'vision',
          previousVisionModel,
          config.visionModel
        );
        if (result?.failed) totalCallbackFailures += result.failed;
      }

      if (config.embeddingModel) {
        // Uses module-level ALLOWED_EMBED_MODELS constant
        const normalizedModel = config.embeddingModel.toLowerCase();
        // FIX Issue 2.2: Use exact base name matching instead of substring to prevent
        // malicious model names like "evil-nomic-embed-text" from passing validation
        const isAllowed =
          ALLOWED_EMBED_MODELS.includes(config.embeddingModel) ||
          ALLOWED_EMBED_MODELS.some((allowed) => {
            // Strip version tag (e.g., "nomic-embed-text:v1.5" -> "nomic-embed-text")
            const base = normalizedModel.split(':')[0];
            return base === allowed.toLowerCase();
          });

        const embedModel = isAllowed ? config.embeddingModel : 'embeddinggemma';

        // FIX: Track model downgrade for UI notification
        if (!isAllowed) {
          modelWasDowngraded = true;
          logger.warn('[OllamaService] Rejected invalid embedding model', {
            requested: config.embeddingModel,
            allowed: ALLOWED_EMBED_MODELS,
            usingDefault: embedModel
          });
        }

        await setOllamaEmbeddingModel(embedModel, !skipSave);
        // FIX: Await async notification to ensure callbacks complete (critical for embedding model
        // changes since ChromaDB collections need to be reset before continuing)
        const result = await this._notifyModelChange(
          'embedding',
          previousEmbeddingModel,
          embedModel
        );
        if (result?.failed) totalCallbackFailures += result.failed;
      }

      logger.info('[OllamaService] Configuration updated');
      // FIX #9: Return actual callback failures count instead of hardcoded 0
      return {
        success: true,
        callbackFailures: totalCallbackFailures,
        modelDowngraded: modelWasDowngraded
      };
    } catch (error) {
      logger.error('[OllamaService] Failed to update config:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Update config with explicit notification of model downgrade
   * FIX: Returns modelDowngraded flag so UI can notify user
   */
  async updateConfigWithDowngradeInfo(config) {
    await this.initialize();
    let modelDowngraded = false;
    let originalRequestedModel = null;
    let actualEmbeddingModel = null;

    try {
      const previousTextModel = getOllamaModel();
      const previousVisionModel = getOllamaVisionModel();
      const previousEmbeddingModel = getOllamaEmbeddingModel();

      if (config.host) await setOllamaHost(config.host);

      if (config.textModel) {
        await setOllamaModel(config.textModel);
        await this._notifyModelChange('text', previousTextModel, config.textModel);
      }

      if (config.visionModel) {
        await setOllamaVisionModel(config.visionModel);
        await this._notifyModelChange('vision', previousVisionModel, config.visionModel);
      }

      if (config.embeddingModel) {
        // FIX LOW #23: Use exact base name matching instead of substring to prevent
        // malicious model names like "evil-nomic-embed-text" from passing validation
        // This makes validation consistent with updateConfig() method
        const normalizedModel = config.embeddingModel.toLowerCase();
        const isAllowed =
          ALLOWED_EMBED_MODELS.includes(config.embeddingModel) ||
          ALLOWED_EMBED_MODELS.some((allowed) => {
            // Strip version tag (e.g., "nomic-embed-text:v1.5" -> "nomic-embed-text")
            const base = normalizedModel.split(':')[0];
            return base === allowed.toLowerCase();
          });

        actualEmbeddingModel = isAllowed ? config.embeddingModel : 'embeddinggemma';
        originalRequestedModel = config.embeddingModel;
        modelDowngraded = !isAllowed;

        if (modelDowngraded) {
          logger.warn('[OllamaService] Model downgraded - user should be notified', {
            requested: originalRequestedModel,
            actual: actualEmbeddingModel
          });
        }

        await setOllamaEmbeddingModel(actualEmbeddingModel);
        await this._notifyModelChange('embedding', previousEmbeddingModel, actualEmbeddingModel);
      }

      return {
        success: true,
        modelDowngraded,
        originalRequestedModel,
        actualEmbeddingModel,
        message: modelDowngraded
          ? `Unsupported embedding model "${originalRequestedModel}" was replaced with "${actualEmbeddingModel}"`
          : null
      };
    } catch (error) {
      logger.error('[OllamaService] Failed to update config:', error);
      return { success: false, error: error.message, modelDowngraded };
    }
  }

  /**
   * Update config and report callback failures
   * FIX: Propagates callback failures to caller for proper error handling
   */
  async updateConfigWithCallbackStatus(config) {
    await this.initialize();
    const callbackResults = { total: 0, failed: 0, failures: [] };

    try {
      const previousTextModel = getOllamaModel();
      const previousVisionModel = getOllamaVisionModel();
      const previousEmbeddingModel = getOllamaEmbeddingModel();

      if (config.host) await setOllamaHost(config.host);

      if (config.textModel) {
        await setOllamaModel(config.textModel);
        const result = await this._notifyModelChange('text', previousTextModel, config.textModel);
        if (result) {
          callbackResults.total += result.total;
          callbackResults.failed += result.failed;
          callbackResults.failures.push(...(result.failures || []));
        }
      }

      if (config.visionModel) {
        await setOllamaVisionModel(config.visionModel);
        const result = await this._notifyModelChange(
          'vision',
          previousVisionModel,
          config.visionModel
        );
        if (result) {
          callbackResults.total += result.total;
          callbackResults.failed += result.failed;
          callbackResults.failures.push(...(result.failures || []));
        }
      }

      if (config.embeddingModel) {
        // FIX Issue 2.2: Use exact base name matching instead of substring to prevent
        // malicious model names like "evil-nomic-embed-text" from passing validation
        // This makes validation consistent with updateConfig() and updateConfigWithDowngradeInfo()
        const normalizedModel = config.embeddingModel.toLowerCase();
        const isAllowed =
          ALLOWED_EMBED_MODELS.includes(config.embeddingModel) ||
          ALLOWED_EMBED_MODELS.some((allowed) => {
            // Strip version tag (e.g., "nomic-embed-text:v1.5" -> "nomic-embed-text")
            const base = normalizedModel.split(':')[0];
            return base === allowed.toLowerCase();
          });

        const embedModel = isAllowed ? config.embeddingModel : 'embeddinggemma';
        await setOllamaEmbeddingModel(embedModel);
        const result = await this._notifyModelChange(
          'embedding',
          previousEmbeddingModel,
          embedModel
        );
        if (result) {
          callbackResults.total += result.total;
          callbackResults.failed += result.failed;
          callbackResults.failures.push(...(result.failures || []));
        }
      }

      return {
        success: true,
        callbackResults,
        hasCallbackFailures: callbackResults.failed > 0
      };
    } catch (error) {
      logger.error('[OllamaService] Failed to update config:', error);
      return { success: false, error: error.message, callbackResults };
    }
  }

  /**
   * Test connection to Ollama server
   * MEDIUM PRIORITY FIX (MED-10): Create temporary instance to actually test specified host
   */
  async testConnection(hostUrl) {
    // FIX: Use shared constant instead of hardcoded value
    const CONNECTION_TEST_TIMEOUT = TIMEOUTS.API_REQUEST; // 10 second timeout
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
    // FIX: Use shared constant instead of hardcoded value
    const GET_MODELS_TIMEOUT = TIMEOUTS.MODEL_LIST; // 15 second timeout
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
   * @param {string[]} modelNames - List of model names to pull
   * @returns {Promise<{success: boolean, results: Array<{model: string, success: boolean, error?: string}>, error?: string}>}
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

    // FIX #8: Validate FALLBACK_MODELS is array before use to prevent runtime errors
    const fallbackModels = Array.isArray(AI_DEFAULTS.EMBEDDING?.FALLBACK_MODELS)
      ? AI_DEFAULTS.EMBEDDING.FALLBACK_MODELS
      : [primaryModel];
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
        const capped = capEmbeddingInput(text || '');
        const embeddingInput = capped.text;

        if (capped.wasTruncated) {
          logger.warn('[OllamaService] Embedding input truncated to token limit', {
            model,
            originalLength: String(text || '').length,
            truncatedLength: embeddingInput.length,
            estimatedTokens: capped.estimatedTokens,
            maxTokens: capped.maxTokens
          });
        }

        // Use the newer embed() API with 'input' parameter (embeddings() with 'prompt' is deprecated)
        const response = await ollama.embed({
          model,
          input: embeddingInput,
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
    // FIX: Fast-fail if circuit breaker is open to avoid wasting rate limiter slot
    if (this._ollamaClient?.circuitBreaker?.getState?.() === 'OPEN') {
      logger.warn('[OllamaService] analyzeText fast-fail: circuit breaker is open');
      return {
        success: false,
        error: 'Service temporarily unavailable (circuit breaker open)'
      };
    }

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
    // FIX: Fast-fail if circuit breaker is open to avoid wasting rate limiter slot
    if (this._ollamaClient?.circuitBreaker?.getState?.() === 'OPEN') {
      logger.warn('[OllamaService] analyzeImage fast-fail: circuit breaker is open');
      return {
        success: false,
        error: 'Service temporarily unavailable (circuit breaker open)'
      };
    }

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
   * @param {number} [options.maxBatchTimeout] - Max time for entire batch (defaults to TIMEOUTS.BATCH_EMBEDDING_MAX)
   * @param {AbortController} [options.abortController] - Optional AbortController for cancellation
   * @returns {Promise<{results: Array, errors: Array, stats: Object}>}
   */
  async batchGenerateEmbeddings(items, options = {}) {
    await this.initialize();

    // FIX: Add fallback to default embedding model when none configured
    const { AI_DEFAULTS } = require('../../shared/constants');
    const model = options.model || getOllamaEmbeddingModel() || AI_DEFAULTS.EMBEDDING.MODEL;
    const startTime = Date.now();

    // FIX: Add batch timeout support to prevent indefinite hangs
    const maxBatchTimeout =
      options.maxBatchTimeout || TIMEOUTS.BATCH_EMBEDDING_MAX || 5 * 60 * 1000;
    const absoluteDeadline = startTime + maxBatchTimeout;
    const abortController = options.abortController;

    // Helper to check if we should abort the batch
    const shouldAbort = () => {
      if (abortController?.signal?.aborted) {
        return { abort: true, reason: 'cancelled' };
      }
      if (Date.now() >= absoluteDeadline) {
        return { abort: true, reason: 'timeout' };
      }
      return { abort: false };
    };

    // Use OllamaClient if available for resilient batch processing
    if (this._ollamaClient) {
      try {
        // FIX: Wrap OllamaClient batch in timeout check
        let checkInterval;
        const timeoutPromise = new Promise((_, reject) => {
          checkInterval = setInterval(() => {
            const check = shouldAbort();
            if (check.abort) {
              clearInterval(checkInterval);
              reject(new Error(`Batch operation ${check.reason}`));
            }
          }, 1000);
          // Don't block process exit
          if (checkInterval.unref) checkInterval.unref();
        });

        try {
          const result = await Promise.race([
            this._ollamaClient.batchEmbeddings(items, {
              model,
              onProgress: options.onProgress,
              batchSize: options.batchSize || 10
            }),
            timeoutPromise
          ]);

          return {
            success: result.errors.length === 0,
            results: result.results,
            errors: result.errors,
            stats: {
              total: items.length,
              successful: result.results.length,
              failed: result.errors.length,
              duration: Date.now() - startTime,
              timedOut: false
            }
          };
        } finally {
          if (checkInterval) clearInterval(checkInterval);
        }
      } catch (error) {
        // Check if this was a timeout/cancellation
        if (error.message.includes('cancelled') || error.message.includes('timeout')) {
          logger.warn('[OllamaService] Batch embedding aborted:', error.message);
          return {
            success: false,
            results: [],
            errors: [{ error: error.message, aborted: true }],
            stats: {
              total: items.length,
              successful: 0,
              failed: items.length,
              duration: Date.now() - startTime,
              timedOut: error.message.includes('timeout')
            }
          };
        }
        logger.error('[OllamaService] Batch embedding via OllamaClient failed:', error.message);
        // Fall through to basic implementation
      }
    }

    // Fallback: Process sequentially with basic retry and timeout checks
    const results = [];
    const errors = [];
    let abortedAt = null;
    // FIX #7: Track abort reason to avoid index vs boolean confusion and
    // prevent incorrect timedOut detection based on post-loop time comparison
    let abortReason = null;

    for (let i = 0; i < items.length; i++) {
      // FIX: Check deadline/abort before each item
      const check = shouldAbort();
      if (check.abort) {
        abortedAt = i;
        abortReason = check.reason; // FIX #7: Store actual abort reason
        logger.warn('[OllamaService] Batch aborted', {
          reason: check.reason,
          processed: i,
          remaining: items.length - i
        });

        // Mark remaining items as skipped
        for (let j = i; j < items.length; j++) {
          errors.push({
            id: items[j].id,
            error: `Skipped: batch ${check.reason}`,
            success: false,
            skipped: true
          });
        }
        break;
      }

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
          percent: Math.round(((i + 1) / items.length) * 100),
          timedOut: false
        });
      }
    }

    // FIX #7: Use stored abort reason instead of post-loop time comparison
    // This prevents incorrectly reporting timedOut=true when aborted due to cancellation
    // just before the deadline (where post-loop Date.now() might exceed deadline)
    const timedOut = abortReason === 'timeout';

    return {
      success: errors.length === 0,
      results,
      errors,
      stats: {
        total: items.length,
        successful: results.length,
        failed: errors.length,
        duration: Date.now() - startTime,
        timedOut,
        abortedAt,
        abortReason // FIX #7: Include abort reason in stats for debugging
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
