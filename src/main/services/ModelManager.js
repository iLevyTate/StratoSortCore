/**
 * Model Manager Service - Universal Ollama Model Support
 * Ensures the application works with ANY available Ollama model
 */

const { logger } = require('../../shared/logger');
const { TIMEOUTS } = require('../../shared/performanceConstants');
const { SERVICE_URLS } = require('../../shared/configDefaults');
const { getOllama, getOllamaHost } = require('../ollamaUtils');
const { createSingletonHelpers } = require('../../shared/singletonFactory');
const {
  MODEL_CATEGORY_PREFIXES,
  FALLBACK_MODEL_PREFERENCES
} = require('../../shared/modelCategorization');

// Lazy load SettingsService
let settingsService = null;
function getSettings() {
  if (!settingsService) {
    settingsService = require('./SettingsService').getInstance();
  }
  return settingsService;
}

logger.setContext('ModelManager');

class ModelManager {
  constructor(host = SERVICE_URLS.OLLAMA_HOST) {
    // Use shared Ollama instance via getter to ensure we always get the current one
    this._host = getOllamaHost() || host;
    this.availableModels = [];
    this.selectedModel = null;
    this.modelCapabilities = new Map();
    this.lastHealthCheck = null;

    // Initialization state (promise reuse pattern prevents race conditions)
    this.initialized = false;
    this._initPromise = null;

    // Use shared model categories from modelCategorization.js
    this.modelCategories = MODEL_CATEGORY_PREFIXES;

    // Use shared fallback preferences from modelCategorization.js
    this.fallbackPreferences = FALLBACK_MODEL_PREFERENCES;
  }

  get ollamaClient() {
    return getOllama();
  }

  get host() {
    return getOllamaHost() || this._host;
  }

  /**
   * Initialize the model manager with race condition protection
   * FIX: Simplified to use promise reuse pattern instead of complex polling
   */
  async initialize() {
    // If already initialized, return success
    if (this.initialized) {
      return true;
    }

    // If initialization is in progress, wait for it (prevents race conditions)
    // This single promise check eliminates the need for complex polling logic
    if (this._initPromise) {
      return this._initPromise;
    }

    // Create and store initialization promise immediately to prevent concurrent starts
    this._initPromise = this._doInitialize();
    return this._initPromise;
  }

  /**
   * Internal initialization logic
   * @private
   */
  async _doInitialize() {
    try {
      logger.info('[ModelManager] Initializing');

      // Load saved configuration
      await this.loadConfig();

      // Discover available models with timeout using withTimeout utility
      const { withTimeout } = require('../../shared/promiseUtils');
      try {
        await withTimeout(this.discoverModels(), TIMEOUTS.MODEL_DISCOVERY, 'Model discovery');
      } catch (error) {
        logger.warn('[ModelManager] Model discovery failed or timed out', {
          error: error.message
        });
      }

      // Ensure we have a working model
      try {
        await this.ensureWorkingModel();
      } catch (modelError) {
        // Don't fail hard if ensureWorkingModel fails, just log as warning
        // The user might configure models later or services might spin up
        logger.warn('[ModelManager] Could not ensure working model during startup (non-fatal):', {
          error: modelError.message
        });
      }

      // Mark as initialized even if models aren't fully ready yet
      this.initialized = true;

      logger.info(`[ModelManager] Initialized with model: ${this.selectedModel}`);
      return true;
    } catch (error) {
      logger.error('[ModelManager] Initialization failed', {
        error: error.message
      });

      // Clear initialization state on failure to allow retry
      this.initialized = false;
      this._initPromise = null;

      return false;
    }
  }

  /**
   * Discover all available models from Ollama
   */
  async discoverModels() {
    try {
      const response = await this.ollamaClient.list();
      this.availableModels = response.models || [];

      // Analyze model capabilities
      for (const model of this.availableModels) {
        this.analyzeModelCapabilities(model);
      }

      logger.info(`[ModelManager] Discovered ${this.availableModels.length} models`);
      return this.availableModels;
    } catch (error) {
      logger.error('[ModelManager] Failed to discover models', {
        error: error.message
      });
      this.availableModels = [];
      throw error;
    }
  }

  /**
   * Analyze what a model can do based on its name and metadata
   */
  analyzeModelCapabilities(model) {
    const modelName = model.name.toLowerCase();
    const capabilities = {
      text: false,
      vision: false,
      code: false,
      chat: false,
      size: model.size || 0,
      modified: model.modified_at || null
    };

    // Check capabilities based on model name patterns
    for (const [capability, patterns] of Object.entries(this.modelCategories)) {
      capabilities[capability] = patterns.some((pattern) =>
        modelName.includes(pattern.toLowerCase())
      );
    }

    // Special cases for vision models
    // Note: gemma3 (4B+) IS a multimodal vision model as of March 2025
    if (
      modelName.includes('llava') ||
      modelName.includes('vision') ||
      modelName.includes('smolvlm') ||
      modelName.includes('moondream') ||
      modelName.includes('gemma3')
    ) {
      capabilities.vision = true;
    }

    if (modelName.includes('code') || modelName.includes('coder')) {
      capabilities.code = true;
    }

    // Most models can do basic text and chat
    if (!capabilities.vision && !capabilities.code) {
      capabilities.text = true;
      capabilities.chat = true;
    }

    this.modelCapabilities.set(model.name, capabilities);
    return capabilities;
  }

  /**
   * Ensure we have a working model selected
   */
  async ensureWorkingModel() {
    // Ensure settings are loaded so selectedModel isn't null during early startup
    if (!this.selectedModel) {
      await this.loadConfig();
    }

    // If we have a selected model, verify it still works
    if (this.selectedModel) {
      const modelListed = this.availableModels.some((m) => m.name === this.selectedModel);
      // If we don't have a model list yet, still allow a direct test
      const modelExists = modelListed || this.availableModels.length === 0;
      if (modelExists && (await this.testModel(this.selectedModel))) {
        logger.info(`[ModelManager] Using existing model: ${this.selectedModel}`);
        return this.selectedModel;
      }
    }

    // If no models discovered yet, try to discover them now
    if (this.availableModels.length === 0) {
      try {
        const { withTimeout } = require('../../shared/promiseUtils');
        await withTimeout(this.discoverModels(), TIMEOUTS.MODEL_DISCOVERY, 'Model list');
      } catch (error) {
        logger.warn('[ModelManager] Model discovery unavailable during ensureWorkingModel', {
          error: error.message
        });
      }
    }

    // Find the best available model
    const bestModel = await this.findBestModel();
    if (bestModel) {
      await this.setSelectedModel(bestModel);
      return bestModel;
    }

    throw new Error('No working Ollama models found');
  }

  /**
   * Find the best available model based on preferences and capabilities
   */
  async findBestModel() {
    if (this.availableModels.length === 0) {
      return null;
    }

    // Try preferred models first
    for (const preferred of this.fallbackPreferences) {
      const model = this.availableModels.find((m) =>
        m.name.toLowerCase().includes(preferred.toLowerCase())
      );

      if (model && (await this.testModel(model.name))) {
        logger.info(`[ModelManager] Selected preferred model: ${model.name}`);
        return model.name;
      }
    }

    // If no preferred model works, try any text-capable model
    for (const model of this.availableModels) {
      const capabilities = this.modelCapabilities.get(model.name);
      if (capabilities && (capabilities.text || capabilities.chat)) {
        if (await this.testModel(model.name)) {
          logger.info(`[ModelManager] Selected fallback model: ${model.name}`);
          return model.name;
        }
      }
    }

    // Last resort: try the first available model
    const firstModel = this.availableModels[0];
    if (await this.testModel(firstModel.name)) {
      logger.info(`[ModelManager] Selected first available model: ${firstModel.name}`);
      return firstModel.name;
    }

    return null;
  }

  /**
   * Test if a model is working
   * HIGH PRIORITY FIX #5: Use AbortController for proper cancellation and cleanup
   */
  async testModel(modelName, timeout = 10000) {
    // Create AbortController for proper cleanup
    const abortController = new AbortController();
    let timeoutId = null;

    try {
      logger.debug(`[ModelManager] Testing model: ${modelName}`);

      const { buildOllamaOptions } = require('./PerformanceService');
      const perfOptions = await buildOllamaOptions('text');

      // Create the test promise with abort signal support
      const testPromise = this.ollamaClient.generate({
        model: modelName,
        prompt: 'Hello',
        options: {
          ...perfOptions,
          num_predict: 5,
          temperature: 0.1
        },
        // Pass abort signal if ollama client supports it
        signal: abortController.signal
      });

      // HIGH PRIORITY FIX #5: Implement timeout with proper cleanup
      const timeoutPromise = new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
          // Signal cancellation to all operations
          abortController.abort();
          reject(new Error('Model test timeout'));
        }, timeout);

        // Ensure timeout doesn't keep process alive
        if (timeoutId.unref) {
          timeoutId.unref();
        }
      });

      // Race between test and timeout
      await Promise.race([testPromise, timeoutPromise]);

      // Clear timeout on success
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }

      logger.debug(`[ModelManager] Model ${modelName} is working`);
      return true;
    } catch (error) {
      // Ensure cleanup happens on any error
      if (!abortController.signal.aborted) {
        abortController.abort();
      }

      logger.debug(`[ModelManager] Model ${modelName} failed test: ${error.message}`);
      return false;
    } finally {
      // HIGH PRIORITY FIX #5: Guarantee cleanup in finally block
      // Clear any remaining timeout
      if (timeoutId) {
        clearTimeout(timeoutId);
      }

      // Abort any ongoing operations
      if (!abortController.signal.aborted) {
        abortController.abort();
      }
    }
  }

  /**
   * Get the best model for a specific task
   */
  getBestModelForTask(task = 'text') {
    if (!this.selectedModel) {
      return null;
    }

    // Return selected model for all tasks (task-specific selection may be added later)
    switch (task) {
      case 'vision':
      case 'image':
        // Look for vision-capable models
        for (const model of this.availableModels) {
          const caps = this.modelCapabilities.get(model.name);
          if (caps && caps.vision) {
            return model.name;
          }
        }
        // Fallback to selected model if no vision model available
        return this.selectedModel;

      case 'code':
        // Look for code-capable models
        for (const model of this.availableModels) {
          const caps = this.modelCapabilities.get(model.name);
          if (caps && caps.code) {
            return model.name;
          }
        }
        // Fallback to selected model
        return this.selectedModel;

      default:
        return this.selectedModel;
    }
  }

  /**
   * Set the selected model
   */
  async setSelectedModel(modelName) {
    if (!this.availableModels.some((m) => m.name === modelName)) {
      throw new Error(`Model ${modelName} is not available`);
    }

    this.selectedModel = modelName;
    await this.saveConfig();
    logger.info(`[ModelManager] Selected model set to: ${modelName}`);
  }

  /**
   * Get model information
   */
  getModelInfo(modelName = null) {
    const targetModel = modelName || this.selectedModel;
    if (!targetModel) return null;

    const model = this.availableModels.find((m) => m.name === targetModel);
    const capabilities = this.modelCapabilities.get(targetModel);

    return {
      name: targetModel,
      size: model?.size || 0,
      modified: model?.modified_at || null,
      capabilities: capabilities || {},
      isSelected: targetModel === this.selectedModel
    };
  }

  /**
   * Generate text with automatic fallback
   */
  async generateWithFallback(prompt, options = {}) {
    const modelsToTry = [
      this.selectedModel,
      ...this.fallbackPreferences.filter((p) =>
        this.availableModels.some((m) => m.name.includes(p))
      )
    ].filter(Boolean);

    for (const modelName of modelsToTry) {
      try {
        logger.debug(`[ModelManager] Attempting generation with: ${modelName}`);

        const { buildOllamaOptions } = require('./PerformanceService');
        const perfOptions = await buildOllamaOptions('text');
        const response = await this.ollamaClient.generate({
          model: modelName,
          prompt,
          options: {
            ...perfOptions,
            temperature: 0.1,
            num_predict: 500,
            ...options
          }
        });

        if (response.response && response.response.trim()) {
          return {
            response: response.response,
            model: modelName,
            success: true
          };
        }
      } catch (error) {
        logger.debug(`[ModelManager] Model ${modelName} failed: ${error.message}`);
        continue;
      }
    }

    throw new Error('All models failed to generate response');
  }

  /**
   * Load configuration from SettingsService
   */
  async loadConfig() {
    try {
      const settings = await getSettings().load();
      this.selectedModel = settings.textModel || null;
      this._host = settings.ollamaHost || this._host;
      logger.debug(`[ModelManager] Loaded config: ${this.selectedModel}`);
    } catch (error) {
      logger.error('[ModelManager] Error loading config', {
        error: error.message
      });
    }
  }

  /**
   * Save configuration to SettingsService
   */
  async saveConfig() {
    try {
      await getSettings().save({ textModel: this.selectedModel });
    } catch (error) {
      logger.error('[ModelManager] Error saving config', {
        error: error.message
      });
    }
  }

  /**
   * Get health status
   */
  async getHealthStatus() {
    try {
      const models = await this.discoverModels();
      const selectedWorking = this.selectedModel ? await this.testModel(this.selectedModel) : false;

      return {
        connected: true,
        modelsAvailable: models.length,
        selectedModel: this.selectedModel,
        selectedModelWorking: selectedWorking,
        lastCheck: new Date().toISOString()
      };
    } catch (error) {
      return {
        connected: false,
        error: error.message,
        modelsAvailable: 0,
        selectedModel: null,
        selectedModelWorking: false,
        lastCheck: new Date().toISOString()
      };
    }
  }

  /**
   * Get all available models with their capabilities
   */
  getAllModelsWithCapabilities() {
    return this.availableModels.map((model) => ({
      name: model.name,
      size: model.size,
      modified: model.modified_at,
      capabilities: this.modelCapabilities.get(model.name) || {},
      isSelected: model.name === this.selectedModel
    }));
  }

  /**
   * Cleanup method to prevent memory leaks
   * Clears all resources and resets state
   */
  async cleanup() {
    logger.info('[ModelManager] Starting cleanup...');

    try {
      // Reset initialization state
      this.initialized = false;
      this._initPromise = null;

      // Clear model data
      this.availableModels = [];
      this.modelCapabilities.clear();
      this.selectedModel = null;
      this.lastHealthCheck = null;

      logger.info('[ModelManager] Cleanup completed successfully');
    } catch (error) {
      logger.error('[ModelManager] Error during cleanup:', error);
    }
  }
}

// Create singleton helpers using shared factory
const { getInstance, createInstance, registerWithContainer, resetInstance } =
  createSingletonHelpers({
    ServiceClass: ModelManager,
    serviceId: 'MODEL_MANAGER',
    serviceName: 'ModelManager',
    containerPath: './ServiceContainer',
    shutdownMethod: 'cleanup' // ModelManager uses cleanup() for shutdown
  });

module.exports = {
  ModelManager,
  getInstance,
  createInstance,
  registerWithContainer,
  resetInstance
};
