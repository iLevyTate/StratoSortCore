const { Ollama } = require('ollama');
const { logger } = require('../shared/logger');
const { SERVICE_URLS } = require('../shared/configDefaults');
const { normalizeServiceUrl } = require('../shared/urlUtils');
// Lazy load SettingsService to avoid circular dependency if any (though typically fine)
let settingsService = null;
function getSettings() {
  if (!settingsService) {
    settingsService = require('./services/SettingsService').getInstance();
  }
  return settingsService;
}

// Optional: set context for clearer log origins
logger.setContext('ollama-utils');

let ollamaInstance = null;
let ollamaHost = SERVICE_URLS.OLLAMA_HOST;
let ollamaInstanceHost = null; // MEDIUM PRIORITY FIX (MED-13): Track host used to create instance
let currentHttpAgent = null; // FIX: Track HTTP agent for cleanup to prevent socket leaks
// Selected models - in-memory cache, synced with SettingsService
let selectedTextModel = null;
let selectedVisionModel = null;
let selectedEmbeddingModel = null;

/**
 * Normalize a URL for Ollama server connection
 * Delegates to shared normalizeServiceUrl utility
 *
 * @param {string} [hostUrl] - The URL to normalize
 * @param {string} [defaultUrl] - Default URL if none provided
 * @returns {string} Normalized URL with protocol
 */
function normalizeOllamaUrl(hostUrl, defaultUrl = SERVICE_URLS.OLLAMA_HOST) {
  return normalizeServiceUrl(hostUrl, { defaultUrl });
}

// Helper to destroy HTTP agent and prevent socket leaks
function destroyCurrentAgent() {
  if (currentHttpAgent) {
    try {
      currentHttpAgent.destroy();
      logger.debug('[OLLAMA] Previous HTTP agent destroyed');
    } catch (e) {
      logger.debug('[OLLAMA] Could not destroy previous HTTP agent:', e.message);
    }
    currentHttpAgent = null;
  }
}

// Function to initialize or get the Ollama instance
function getOllama() {
  // MEDIUM PRIORITY FIX (MED-13): Invalidate instance if host has changed
  if (ollamaInstance && ollamaInstanceHost !== ollamaHost) {
    logger.info(
      `[OLLAMA] Host changed from ${ollamaInstanceHost} to ${ollamaHost}, recreating instance`
    );
    destroyCurrentAgent(); // FIX: Destroy old agent to prevent socket leaks
    ollamaInstance = null;
    ollamaInstanceHost = null;
  }

  if (!ollamaInstance) {
    // Host is configurable via environment variables or saved config
    // Reuse a single client and enable keep-alive where supported
    // The Ollama client uses node-fetch internally; when an agent is supported,
    // pass it here to keep connections warm.
    try {
      const http = require('http');
      const https = require('https');
      const isHttps = ollamaHost.startsWith('https://');
      destroyCurrentAgent(); // FIX: Ensure any stale agent is cleaned up
      currentHttpAgent = isHttps
        ? new https.Agent({ keepAlive: true, maxSockets: 10 })
        : new http.Agent({ keepAlive: true, maxSockets: 10 });
      ollamaInstance = new Ollama({
        host: ollamaHost,
        fetch: (url, opts = {}) => {
          return (global.fetch || require('node-fetch'))(url, {
            agent: currentHttpAgent,
            ...opts
          });
        }
      });
    } catch (agentError) {
      // FIX: Log warning instead of silent fallback for visibility
      logger.warn('[OLLAMA] Failed to create HTTP agent, using default client', {
        error: agentError.message,
        host: ollamaHost
      });
      ollamaInstance = new Ollama({ host: ollamaHost });
    }
    // MEDIUM PRIORITY FIX (MED-13): Remember the host used for this instance
    ollamaInstanceHost = ollamaHost;
  }
  return ollamaInstance;
}

// Function to get the currently configured Ollama text model
function getOllamaModel() {
  return selectedTextModel;
}

// Function to get the currently configured Ollama vision model
function getOllamaVisionModel() {
  return selectedVisionModel;
}

function getOllamaEmbeddingModel() {
  return selectedEmbeddingModel;
}

// Function to set/update the Ollama model
async function setOllamaModel(modelName, shouldSave = true) {
  selectedTextModel = modelName;
  try {
    if (shouldSave) await getSettings().save({ textModel: modelName });
    logger.info(`[OLLAMA] Text model set to: ${modelName}${shouldSave ? ' and saved.' : ''}`);
  } catch (error) {
    logger.error('[OLLAMA] Error saving text model selection', { error });
  }
}

async function setOllamaVisionModel(modelName, shouldSave = true) {
  selectedVisionModel = modelName;
  try {
    if (shouldSave) await getSettings().save({ visionModel: modelName });
    logger.info(`[OLLAMA] Vision model set to: ${modelName}${shouldSave ? ' and saved.' : ''}`);
  } catch (error) {
    logger.error('[OLLAMA] Error saving vision model selection', { error });
  }
}

async function setOllamaEmbeddingModel(modelName, shouldSave = true) {
  selectedEmbeddingModel = modelName;
  try {
    if (shouldSave) await getSettings().save({ embeddingModel: modelName });
    logger.info(`[OLLAMA] Embedding model set to: ${modelName}${shouldSave ? ' and saved.' : ''}`);
  } catch (error) {
    logger.error('[OLLAMA] Error saving embedding model selection', { error });
  }
}

function getOllamaHost() {
  return ollamaHost;
}

/**
 * Set the Ollama host with optional connection validation
 * FIX: Validates connection BEFORE persisting settings to prevent invalid host from being saved
 *
 * @param {string} host - The new host URL
 * @param {boolean} [shouldSave=true] - Whether to persist to settings
 * @param {Object} [options={}] - Additional options
 * @param {boolean} [options.skipValidation=false] - Skip connection test (for backward compat)
 * @param {number} [options.validationTimeout=10000] - Timeout for connection test
 * @returns {Promise<{success: boolean, error?: string, host?: string}>}
 */
async function setOllamaHost(host, shouldSave = true, options = {}) {
  const { skipValidation = false, validationTimeout = 10000 } = options;
  const previousHost = ollamaHost;

  try {
    if (typeof host !== 'string' || !host.trim()) {
      return { success: false, error: 'Invalid host format' };
    }

    const normalizedHost = normalizeOllamaUrl(host);

    // FIX: Validate connection BEFORE committing change (unless skipValidation)
    if (!skipValidation) {
      try {
        // Create temporary client to test connection
        const testOllama = new Ollama({ host: normalizedHost });
        const testPromise = testOllama.list();
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Connection test timeout')), validationTimeout)
        );

        await Promise.race([testPromise, timeoutPromise]);
        logger.info('[OLLAMA] Connection validated for host:', normalizedHost);
      } catch (validationError) {
        logger.warn('[OLLAMA] Connection validation failed for host:', normalizedHost, {
          error: validationError.message
        });
        return {
          success: false,
          error: `Connection test failed: ${validationError.message}`,
          host: normalizedHost
        };
      }
    }

    // Connection validated (or skipped), now commit the change
    ollamaHost = normalizedHost;

    // Recreate client with new host
    try {
      const http = require('http');
      const https = require('https');
      const isHttps = ollamaHost.startsWith('https://');
      destroyCurrentAgent(); // FIX: Destroy old agent to prevent socket leaks
      currentHttpAgent = isHttps
        ? new https.Agent({ keepAlive: true, maxSockets: 10 })
        : new http.Agent({ keepAlive: true, maxSockets: 10 });
      ollamaInstance = new Ollama({
        host: ollamaHost,
        fetch: (url, opts = {}) => {
          return (global.fetch || require('node-fetch'))(url, {
            agent: currentHttpAgent,
            ...opts
          });
        }
      });
    } catch (agentError) {
      // FIX: Log warning instead of silent fallback
      logger.warn('[OLLAMA] Failed to create HTTP agent in setOllamaHost, using default client', {
        error: agentError.message,
        host: ollamaHost
      });
      ollamaInstance = new Ollama({ host: ollamaHost });
    }

    // Track the host used to create the instance to avoid redundant recreation
    ollamaInstanceHost = ollamaHost;

    // Only save AFTER successful validation and client creation
    if (shouldSave) await getSettings().save({ ollamaHost });
    logger.info(`[OLLAMA] Host set to: ${ollamaHost}`);

    return { success: true, host: ollamaHost };
  } catch (error) {
    // Rollback on unexpected error
    ollamaHost = previousHost;
    logger.error('[OLLAMA] Error setting host, rolled back to previous', {
      error: error.message,
      previousHost
    });
    return { success: false, error: error.message };
  }
}

// Load Ollama configuration from SettingsService
async function loadOllamaConfig(applySideEffects = true) {
  try {
    const settings = await getSettings().load();

    if (applySideEffects) {
      if (settings.textModel) {
        selectedTextModel = settings.textModel;
        logger.info(`[OLLAMA] Loaded selected text model: ${selectedTextModel}`);
      }
      if (settings.visionModel) {
        selectedVisionModel = settings.visionModel;
        logger.info(`[OLLAMA] Loaded selected vision model: ${selectedVisionModel}`);
      }
      if (settings.embeddingModel) {
        selectedEmbeddingModel = settings.embeddingModel;
        logger.info(`[OLLAMA] Loaded selected embedding model: ${selectedEmbeddingModel}`);
      }
      if (settings.ollamaHost) {
        ollamaHost = settings.ollamaHost;
        // Client recreation logic is handled in getOllama() via ollamaInstanceHost check
        // or we can preemptively recreate it here if desired, but getOllama() is safer/lazy.

        // However, if we want to ensure the global 'ollamaInstance' is updated:
        if (ollamaInstanceHost !== ollamaHost) {
          try {
            const http = require('http');
            const https = require('https');
            const isHttps = ollamaHost.startsWith('https://');
            // FIX: Destroy old agent to prevent socket leaks, and update currentHttpAgent
            destroyCurrentAgent();
            currentHttpAgent = isHttps
              ? new https.Agent({ keepAlive: true, maxSockets: 10 })
              : new http.Agent({ keepAlive: true, maxSockets: 10 });
            ollamaInstance = new Ollama({
              host: ollamaHost,
              fetch: (url, opts = {}) => {
                return (global.fetch || require('node-fetch'))(url, {
                  agent: currentHttpAgent,
                  ...opts
                });
              }
            });
          } catch (agentError) {
            // FIX: Log warning instead of silent fallback
            logger.warn(
              '[OLLAMA] Failed to create HTTP agent in loadOllamaConfig, using default client',
              {
                error: agentError.message,
                host: ollamaHost
              }
            );
            ollamaInstance = new Ollama({ host: ollamaHost });
          }
          ollamaInstanceHost = ollamaHost;
          logger.info(`[OLLAMA] Loaded host: ${ollamaHost}`);
        }
      }
    }

    return {
      selectedTextModel,
      selectedVisionModel,
      selectedEmbeddingModel,
      host: ollamaHost,
      // Legacy compat
      selectedModel: selectedTextModel
    };
  } catch (error) {
    logger.error('[OLLAMA] Error loading config from SettingsService', { error });
    return { selectedTextModel, selectedVisionModel, host: ollamaHost };
  }
}

/**
 * Cleanup HTTP agent on app shutdown to prevent socket leaks
 * FIX: Export this function for use during app lifecycle cleanup
 */
function cleanupOllamaAgent() {
  destroyCurrentAgent();
  ollamaInstance = null;
  ollamaInstanceHost = null;
  logger.info('[OLLAMA] HTTP agent and instance cleaned up');
}

module.exports = {
  getOllama,
  getOllamaModel,
  getOllamaVisionModel,
  getOllamaEmbeddingModel,
  setOllamaModel,
  setOllamaVisionModel,
  setOllamaEmbeddingModel,
  getOllamaHost,
  setOllamaHost,
  loadOllamaConfig,
  normalizeOllamaUrl,
  // FIX: Export cleanup function for app shutdown
  cleanupOllamaAgent
};
