/**
 * Model Manager Service - Universal Ollama Model Support
 * Ensures the application works with ANY available Ollama model
 */

const { Ollama } = require('ollama');
const { app } = require('electron');
const fs = require('fs').promises;
const path = require('path');
const { logger } = require('../../shared/logger');
logger.setContext('ModelManager');

class ModelManager {
  constructor(host = 'http://127.0.0.1:11434') {
    this.ollamaClient = new Ollama({ host });
    this.host = host;
    this.availableModels = [];
    this.selectedModel = null;
    this.modelCapabilities = new Map();
    this.lastHealthCheck = null;
    this.configPath = path.join(app.getPath('userData'), 'model-config.json');

    // Add initialization guards to prevent race conditions
    this.initialized = false;
    this._initPromise = null;
    this._isInitializing = false;

    // Model categories and their capabilities
    this.modelCategories = {
      text: [
        'llama',
        'mistral',
        'phi',
        'gemma',
        'qwen',
        'codellama',
        'neural-chat',
        'orca',
        'vicuna',
        'alpaca',
      ],
      vision: ['llava', 'bakllava', 'moondream', 'gemma3'],
      code: ['codellama', 'codegemma', 'starcoder', 'deepseek-coder'],
      chat: [
        'llama',
        'mistral',
        'phi',
        'gemma',
        'neural-chat',
        'orca',
        'vicuna',
      ],
    };

    // Fallback model preferences (in order of preference)
    this.fallbackPreferences = [
      'gemma3:4b',
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
      'orca-mini',
    ];
  }

  /**
   * Initialize the model manager with race condition protection
   */
  async initialize() {
    // If already initialized, return success
    if (this.initialized) {
      return true;
    }

    // If initialization is in progress, wait for it
    if (this._initPromise) {
      return this._initPromise;
    }

    // Prevent concurrent initialization
    if (this._isInitializing) {
      // Wait for the ongoing initialization
      return new Promise((resolve) => {
        // HIGH PRIORITY FIX (HIGH-12): Comprehensive timer cleanup
        let checkInterval = null;
        let timeoutId = null;

        const cleanup = () => {
          if (checkInterval !== null) {
            clearInterval(checkInterval);
            checkInterval = null;
          }
          if (timeoutId !== null) {
            clearTimeout(timeoutId);
            timeoutId = null;
          }
        };

        try {
          checkInterval = setInterval(() => {
            if (!this._isInitializing) {
              cleanup();
              resolve(this.initialized);
            }
          }, 100);

          // Add timeout to prevent infinite waiting
          timeoutId = setTimeout(() => {
            cleanup();
            resolve(false);
          }, 10000); // 10 second timeout

          // Ensure timers don't keep process alive
          if (checkInterval && checkInterval.unref) {
            checkInterval.unref();
          }
          if (timeoutId && timeoutId.unref) {
            timeoutId.unref();
          }
        } catch (error) {
          // Cleanup on error
          cleanup();
          logger.error(
            '[ModelManager] Error setting up initialization wait:',
            error,
          );
          resolve(false);
        }
      });
    }

    // Set initialization flag
    this._isInitializing = true;

    // Create initialization promise
    this._initPromise = (async () => {
      try {
        logger.info('[ModelManager] Initializing');

        // Load saved configuration
        await this.loadConfig();

        // Discover available models with timeout
        const discoverPromise = this.discoverModels();
        let timeoutId;
        const timeoutPromise = new Promise((_, reject) => {
          timeoutId = setTimeout(
            () => reject(new Error('Model discovery timeout')),
            5000,
          );
          // Ensure timeout doesn't keep process alive
          if (timeoutId && timeoutId.unref) {
            timeoutId.unref();
          }
        });

        try {
          await Promise.race([discoverPromise, timeoutPromise]);
        } catch (error) {
          logger.warn('[ModelManager] Model discovery failed or timed out', {
            error: error.message,
          });
        } finally {
          // Clean up timeout
          if (timeoutId) {
            clearTimeout(timeoutId);
          }
        }

        // Ensure we have a working model
        await this.ensureWorkingModel();

        // Mark as initialized
        this.initialized = true;
        this._isInitializing = false;

        logger.info(
          `[ModelManager] Initialized with model: ${this.selectedModel}`,
        );
        return true;
      } catch (error) {
        logger.error('[ModelManager] Initialization failed', {
          error: error.message,
        });

        // Clear initialization state on failure
        this.initialized = false;
        this._isInitializing = false;
        this._initPromise = null;

        return false;
      }
    })();

    return this._initPromise;
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

      logger.info(
        `[ModelManager] Discovered ${this.availableModels.length} models`,
      );
      return this.availableModels;
    } catch (error) {
      logger.error('[ModelManager] Failed to discover models', {
        error: error.message,
      });
      this.availableModels = [];
      return [];
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
      modified: model.modified_at || null,
    };

    // Check capabilities based on model name patterns
    for (const [capability, patterns] of Object.entries(this.modelCategories)) {
      capabilities[capability] = patterns.some((pattern) =>
        modelName.includes(pattern.toLowerCase()),
      );
    }

    // Special cases
    if (
      modelName.includes('llava') ||
      modelName.includes('vision') ||
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
    // If we have a selected model, verify it still exists
    if (this.selectedModel) {
      const modelExists = this.availableModels.some(
        (m) => m.name === this.selectedModel,
      );
      if (modelExists && (await this.testModel(this.selectedModel))) {
        logger.info(
          `[ModelManager] Using existing model: ${this.selectedModel}`,
        );
        return this.selectedModel;
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
        m.name.toLowerCase().includes(preferred.toLowerCase()),
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
      logger.info(
        `[ModelManager] Selected first available model: ${firstModel.name}`,
      );
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
          temperature: 0.1,
        },
        // Pass abort signal if ollama client supports it
        signal: abortController.signal,
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

      logger.debug(
        `[ModelManager] Model ${modelName} failed test: ${error.message}`,
      );
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

    // For now, return the selected model for all tasks
    // In the future, we could have task-specific model selection
    // const capabilities = this.modelCapabilities.get(this.selectedModel);

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
      isSelected: targetModel === this.selectedModel,
    };
  }

  /**
   * Generate text with automatic fallback
   */
  async generateWithFallback(prompt, options = {}) {
    const modelsToTry = [
      this.selectedModel,
      ...this.fallbackPreferences.filter((p) =>
        this.availableModels.some((m) => m.name.includes(p)),
      ),
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
            ...options,
          },
        });

        if (response.response && response.response.trim()) {
          return {
            response: response.response,
            model: modelName,
            success: true,
          };
        }
      } catch (error) {
        logger.debug(
          `[ModelManager] Model ${modelName} failed: ${error.message}`,
        );
        continue;
      }
    }

    throw new Error('All models failed to generate response');
  }

  /**
   * Load configuration from disk
   */
  async loadConfig() {
    try {
      const data = await fs.readFile(this.configPath, 'utf-8');
      const config = JSON.parse(data);
      this.selectedModel = config.selectedModel || null;
      logger.debug(`[ModelManager] Loaded config: ${this.selectedModel}`);
    } catch (error) {
      if (error.code !== 'ENOENT') {
        logger.error('[ModelManager] Error loading config', {
          error: error.message,
        });
      }
    }
  }

  /**
   * Save configuration to disk
   */
  async saveConfig() {
    try {
      const config = {
        selectedModel: this.selectedModel,
        lastUpdated: new Date().toISOString(),
      };
      await fs.writeFile(this.configPath, JSON.stringify(config, null, 2));
    } catch (error) {
      logger.error('[ModelManager] Error saving config', {
        error: error.message,
      });
    }
  }

  /**
   * Get health status
   */
  async getHealthStatus() {
    try {
      const models = await this.discoverModels();
      const selectedWorking = this.selectedModel
        ? await this.testModel(this.selectedModel)
        : false;

      return {
        connected: true,
        modelsAvailable: models.length,
        selectedModel: this.selectedModel,
        selectedModelWorking: selectedWorking,
        lastCheck: new Date().toISOString(),
      };
    } catch (error) {
      return {
        connected: false,
        error: error.message,
        modelsAvailable: 0,
        selectedModel: null,
        selectedModelWorking: false,
        lastCheck: new Date().toISOString(),
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
      isSelected: model.name === this.selectedModel,
    }));
  }

  /**
   * HIGH PRIORITY FIX (HIGH-12): Cleanup method to prevent memory leaks
   * Clears all timers, resources, and pending operations
   */
  async cleanup() {
    logger.info('[ModelManager] Starting cleanup...');

    try {
      // Reset initialization state to prevent race conditions
      this._isInitializing = false;
      this.initialized = false;
      this._initPromise = null;

      // Clear model data
      this.availableModels = [];
      this.modelCapabilities.clear();
      this.selectedModel = null;
      this.lastHealthCheck = null;

      // Note: Individual timers in initialize() and testModel() are already
      // cleaned up in their respective finally blocks with proper unref() calls
      // This cleanup method ensures the instance state is reset

      logger.info('[ModelManager] Cleanup completed successfully');
    } catch (error) {
      logger.error('[ModelManager] Error during cleanup:', error);
    }
  }
}

module.exports = ModelManager;
