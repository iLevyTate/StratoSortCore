const { IpcServiceContext, createFromLegacyParams } = require('./IpcServiceContext');
const { Ollama } = require('ollama');
// FIX: Added safeSend import for validated IPC event sending
const { withErrorLogging, safeHandle, safeSend } = require('./ipcWrappers');
const { SERVICE_URLS } = require('../../shared/configDefaults');
const { normalizeOllamaUrl } = require('../ollamaUtils');
const { LENIENT_URL_PATTERN } = require('../../shared/validationConstants');
const { categorizeModels } = require('../../shared/modelCategorization');
const { TIMEOUTS } = require('../../shared/performanceConstants');

/**
 * FIX: CRITICAL - Helper to add timeout to Ollama API calls in IPC handlers
 * Previously, IPC handlers called Ollama directly without timeout, potentially hanging the main process
 * @param {Promise} promise - The promise to wrap with timeout
 * @param {number} timeoutMs - Timeout in milliseconds
 * @param {string} operation - Operation name for error message
 * @returns {Promise} - Promise that rejects if timeout is exceeded
 */
async function withOllamaTimeout(promise, timeoutMs, operation) {
  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`${operation} timeout after ${timeoutMs}ms`));
    }, timeoutMs);
  });
  try {
    const result = await Promise.race([promise, timeoutPromise]);
    return result;
  } finally {
    // FIX: Clear timeout on success or error to prevent timer leak
    clearTimeout(timeoutId);
  }
}

function isValidOllamaUrl(url) {
  if (!url || typeof url !== 'string') return false;
  // Use lenient URL pattern that allows URLs with or without protocol
  return LENIENT_URL_PATTERN.test(url.trim());
}

// Note: normalizeOllamaUrl is imported from shared ollamaUtils module

// FIX: Consolidate validation to work identically with/without Zod
function validateOllamaHost(hostUrl) {
  // DUP-1: Use shared URL normalization utility (adds http:// if missing)
  const url = normalizeOllamaUrl(hostUrl);
  if (!isValidOllamaUrl(url)) {
    throw new Error('Invalid Ollama URL format');
  }
  return url;
}

function registerOllamaIpc(servicesOrParams) {
  let container;
  if (servicesOrParams instanceof IpcServiceContext) {
    container = servicesOrParams;
  } else {
    container = createFromLegacyParams(servicesOrParams);
  }

  const { ipcMain, IPC_CHANNELS, logger } = container.core;
  const { systemAnalytics } = container;
  const { getMainWindow } = container.electron;
  const {
    getOllama,
    getOllamaModel,
    getOllamaVisionModel,
    getOllamaEmbeddingModel,
    getOllamaHost
  } = container.ollama;

  // Model categorization is now handled by shared/modelCategorization.js

  safeHandle(
    ipcMain,
    IPC_CHANNELS.OLLAMA.GET_MODELS,
    withErrorLogging(logger, async () => {
      try {
        const ollama = getOllama();
        // FIX: Add timeout to prevent main process hang if Ollama is unresponsive
        const response = await withOllamaTimeout(
          ollama.list(),
          TIMEOUTS.MODEL_DISCOVERY,
          'Get models'
        );
        const models = response.models || [];

        // Use shared categorization utility (handles sorting)
        const categories = categorizeModels(models);

        // Ensure we update health on every models fetch
        // FIX: Race condition - check if update is newer than last check
        const now = Date.now();
        if (
          !systemAnalytics.ollamaHealth?.lastCheck ||
          now > systemAnalytics.ollamaHealth.lastCheck
        ) {
          systemAnalytics.ollamaHealth = {
            status: 'healthy',
            host: getOllamaHost ? getOllamaHost() : undefined,
            modelCount: models.length,
            lastCheck: now
          };
        }
        return {
          models: models.map((m) => m.name),
          categories,
          selected: {
            textModel: getOllamaModel(),
            visionModel: getOllamaVisionModel(),
            embeddingModel:
              typeof getOllamaEmbeddingModel === 'function' ? getOllamaEmbeddingModel() : null
          },
          ollamaHealth: systemAnalytics.ollamaHealth,
          host: typeof getOllamaHost === 'function' ? getOllamaHost() : undefined
        };
      } catch (error) {
        logger.error('[IPC] Error fetching Ollama models:', error);
        // FIX: Check all connection error codes
        if (
          error.cause &&
          ['ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', 'EHOSTUNREACH'].includes(error.cause.code)
        ) {
          // FIX: Race condition - check if update is newer than last check
          const now = Date.now();
          if (
            !systemAnalytics.ollamaHealth?.lastCheck ||
            now > systemAnalytics.ollamaHealth.lastCheck
          ) {
            systemAnalytics.ollamaHealth = {
              status: 'unhealthy',
              error: 'Connection refused. Ensure Ollama is running.',
              lastCheck: now
            };
          }
        }
        return {
          models: [],
          categories: { text: [], vision: [], embedding: [] },
          selected: {
            textModel: getOllamaModel(),
            visionModel: getOllamaVisionModel(),
            embeddingModel:
              typeof getOllamaEmbeddingModel === 'function' ? getOllamaEmbeddingModel() : null
          },
          error: error.message,
          host: (typeof getOllamaHost === 'function' ? getOllamaHost() : undefined) || 'unknown',
          ollamaHealth: systemAnalytics.ollamaHealth
        };
      }
    })
  );

  const testConnectionHandler = withErrorLogging(logger, async (event, hostUrl) => {
    try {
      // FIX: Use consolidated validation
      const testUrl = validateOllamaHost(hostUrl);

      const testOllama = new Ollama({ host: testUrl });
      // FIX: Add timeout to prevent main process hang during connection test
      const response = await withOllamaTimeout(
        testOllama.list(),
        TIMEOUTS.API_REQUEST,
        'Test connection'
      );
      const models = response.models || [];
      // FIX: Race condition - check if update is newer than last check
      const now = Date.now();
      if (
        !systemAnalytics.ollamaHealth?.lastCheck ||
        now > systemAnalytics.ollamaHealth.lastCheck
      ) {
        systemAnalytics.ollamaHealth = {
          status: 'healthy',
          host: testUrl,
          modelCount: models.length,
          lastCheck: now
        };
      }
      return {
        success: true,
        host: testUrl,
        modelCount: models.length,
        models: models.map((m) => m.name),
        ollamaHealth: systemAnalytics.ollamaHealth
      };
    } catch (error) {
      logger.error('[IPC] Ollama connection test failed:', error);
      // FIX: Use consistent fallback host value
      const fallbackHost = hostUrl || SERVICE_URLS.OLLAMA_HOST;
      // FIX: Race condition - check if update is newer than last check
      const now = Date.now();
      if (
        !systemAnalytics.ollamaHealth?.lastCheck ||
        now > systemAnalytics.ollamaHealth.lastCheck
      ) {
        systemAnalytics.ollamaHealth = {
          status: 'unhealthy',
          host: fallbackHost,
          error: error.message,
          lastCheck: now
        };
      }
      return {
        success: false,
        host: fallbackHost,
        error: error.message,
        ollamaHealth: systemAnalytics.ollamaHealth
      };
    }
  });
  safeHandle(ipcMain, IPC_CHANNELS.OLLAMA.TEST_CONNECTION, testConnectionHandler);

  // Pull models (best-effort, returns status per model)
  // FIX: Added per-model timeout to prevent indefinite blocking
  const MODEL_PULL_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes max per model
  safeHandle(
    ipcMain,
    IPC_CHANNELS.OLLAMA.PULL_MODELS,
    withErrorLogging(logger, async (_event, models = []) => {
      try {
        const ollama = getOllama();
        const results = [];
        for (const model of Array.isArray(models) ? models : []) {
          // FIX HIGH #5: Use AbortController to properly cancel stalled/timed out pulls
          // This ensures orphaned HTTP requests are terminated, not just ignored
          const abortController = new AbortController();
          let checkProgress;
          let pullTimeout;
          let pullAborted = false;

          try {
            // Send progress events if supported by client
            const win = typeof getMainWindow === 'function' ? getMainWindow() : null;
            let lastProgressTime = Date.now();

            // FIX: Wrap pull with AbortController for proper cancellation
            const pullPromise = ollama.pull({
              model,
              signal: abortController.signal,
              stream: (progress) => {
                lastProgressTime = Date.now(); // Update activity timestamp
                try {
                  if (win && !win.isDestroyed()) {
                    // FIX: Use safeSend for validated IPC event sending
                    safeSend(win.webContents, 'operation-progress', {
                      type: 'ollama-pull',
                      model,
                      progress
                    });
                  }
                } catch (err) {
                  // MED-08: Log progress callback errors
                  logger.debug('[IPC] Progress send failed:', err.message);
                }
              }
            });

            // Race against timeout
            const STALL_TIMEOUT_MS = 5 * 60 * 1000;
            const timeoutPromise = new Promise((_, reject) => {
              checkProgress = setInterval(() => {
                const timeSinceProgress = Date.now() - lastProgressTime;
                // If no progress for 5 minutes, consider it stalled
                if (timeSinceProgress > STALL_TIMEOUT_MS) {
                  clearInterval(checkProgress);
                  clearTimeout(pullTimeout);
                  // FIX HIGH #5: Abort the underlying request to stop orphaned process
                  pullAborted = true;
                  abortController.abort();
                  reject(
                    new Error(
                      `Model pull stalled (no progress for ${STALL_TIMEOUT_MS / 60000} minutes)`
                    )
                  );
                }
              }, 30000); // Check every 30 seconds

              pullTimeout = setTimeout(() => {
                clearInterval(checkProgress);
                // FIX HIGH #5: Abort the underlying request on timeout
                pullAborted = true;
                abortController.abort();
                reject(
                  new Error(`Model pull timeout after ${MODEL_PULL_TIMEOUT_MS / 60000} minutes`)
                );
              }, MODEL_PULL_TIMEOUT_MS);
            });

            try {
              await Promise.race([pullPromise, timeoutPromise]);
              results.push({ model, success: true });
            } finally {
              // FIX: Always clear both timers to prevent resource leaks
              clearInterval(checkProgress);
              clearTimeout(pullTimeout);
            }
          } catch (e) {
            // FIX HIGH #5: Log if we aborted to help with debugging
            if (pullAborted) {
              logger.warn(`[IPC] Model pull for ${model} was aborted due to timeout/stall`);
            }
            results.push({ model, success: false, error: e.message });
          }
        }
        return { success: true, results };
      } catch (error) {
        logger.error('[IPC] Pull models failed]:', error);
        return { success: false, error: error.message };
      }
    })
  );

  // Delete a model
  safeHandle(
    ipcMain,
    IPC_CHANNELS.OLLAMA.DELETE_MODEL,
    withErrorLogging(logger, async (_event, model) => {
      try {
        // FIX: Validate model name
        if (!model || typeof model !== 'string' || model.trim().length === 0) {
          return { success: false, error: 'Invalid model name' };
        }
        // Basic validation for model name (alphanumeric, colons, dots, dashes)
        if (!/^[a-zA-Z0-9.:_-]+$/.test(model.trim())) {
          return { success: false, error: 'Invalid model name format' };
        }

        const ollama = getOllama();
        // FIX: Add timeout to prevent main process hang during model deletion
        await withOllamaTimeout(
          ollama.delete({ model: model.trim() }),
          TIMEOUTS.API_REQUEST_SLOW,
          'Delete model'
        );
        return { success: true };
      } catch (error) {
        logger.error('[IPC] Delete model failed]:', error);
        return { success: false, error: error.message };
      }
    })
  );
}

module.exports = registerOllamaIpc;
