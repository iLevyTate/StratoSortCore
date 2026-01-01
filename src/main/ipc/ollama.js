const { Ollama } = require('ollama');
const { withErrorLogging, withValidation, safeHandle } = require('./ipcWrappers');
const { optionalUrl: optionalUrlSchema } = require('./validationSchemas');
const { SERVICE_URLS } = require('../../shared/configDefaults');
const { normalizeOllamaUrl } = require('../ollamaUtils');
const { LENIENT_URL_PATTERN } = require('../../shared/validationConstants');
const { categorizeModels } = require('../../shared/modelCategorization');
const { TIMEOUTS } = require('../../shared/performanceConstants');
let z;

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

try {
  z = require('zod');
} catch {
  z = null;
}

function registerOllamaIpc({
  ipcMain,
  IPC_CHANNELS,
  logger,
  systemAnalytics,
  getMainWindow,
  getOllama,
  getOllamaModel,
  getOllamaVisionModel,
  getOllamaEmbeddingModel,
  getOllamaHost
}) {
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
        systemAnalytics.ollamaHealth = {
          status: 'healthy',
          host: getOllamaHost ? getOllamaHost() : undefined,
          modelCount: models.length,
          lastCheck: Date.now()
        };
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
        if (error.cause && error.cause.code === 'ECONNREFUSED') {
          systemAnalytics.ollamaHealth = {
            status: 'unhealthy',
            error: 'Connection refused. Ensure Ollama is running.',
            lastCheck: Date.now()
          };
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
          host: typeof getOllamaHost === 'function' ? getOllamaHost() : undefined,
          ollamaHealth: systemAnalytics.ollamaHealth
        };
      }
    })
  );

  // Use relaxed URL validation that allows URLs with or without protocol
  // Normalize and validate user input (also extracts URL from pasted commands like `curl ...`).
  const hostSchema = z && optionalUrlSchema ? optionalUrlSchema : null;
  const testConnectionHandler =
    z && hostSchema
      ? withValidation(logger, hostSchema, async (event, hostUrl) => {
          try {
            // DUP-1: Use shared URL normalization utility (adds http:// if missing)
            const testUrl = normalizeOllamaUrl(hostUrl);

            const testOllama = new Ollama({ host: testUrl });
            // FIX: Add timeout to prevent main process hang during connection test
            const response = await withOllamaTimeout(
              testOllama.list(),
              TIMEOUTS.API_REQUEST,
              'Test connection'
            );
            systemAnalytics.ollamaHealth = {
              status: 'healthy',
              host: testUrl,
              modelCount: response.models.length,
              lastCheck: Date.now()
            };
            return {
              success: true,
              host: testUrl,
              modelCount: response.models.length,
              models: response.models.map((m) => m.name),
              ollamaHealth: systemAnalytics.ollamaHealth
            };
          } catch (error) {
            logger.error('[IPC] Ollama connection test failed:', error);
            // FIX: Use consistent fallback host value
            const fallbackHost = hostUrl || SERVICE_URLS.OLLAMA_HOST;
            systemAnalytics.ollamaHealth = {
              status: 'unhealthy',
              host: fallbackHost,
              error: error.message,
              lastCheck: Date.now()
            };
            return {
              success: false,
              host: fallbackHost,
              error: error.message,
              ollamaHealth: systemAnalytics.ollamaHealth
            };
          }
        })
      : withErrorLogging(logger, async (event, hostUrl) => {
          try {
            // DUP-1: Use shared URL normalization utility
            const testUrl = normalizeOllamaUrl(hostUrl);
            if (!isValidOllamaUrl(testUrl)) {
              throw new Error('Invalid Ollama URL format');
            }

            const testOllama = new Ollama({ host: testUrl });
            // FIX: Add timeout to prevent main process hang during connection test
            const response = await withOllamaTimeout(
              testOllama.list(),
              TIMEOUTS.API_REQUEST,
              'Test connection'
            );
            systemAnalytics.ollamaHealth = {
              status: 'healthy',
              host: testUrl,
              modelCount: response.models.length,
              lastCheck: Date.now()
            };
            return {
              success: true,
              host: testUrl,
              modelCount: response.models.length,
              models: response.models.map((m) => m.name),
              ollamaHealth: systemAnalytics.ollamaHealth
            };
          } catch (error) {
            logger.error('[IPC] Ollama connection test failed:', error);
            // FIX: Use consistent fallback host value
            const fallbackHost = hostUrl || SERVICE_URLS.OLLAMA_HOST;
            systemAnalytics.ollamaHealth = {
              status: 'unhealthy',
              host: fallbackHost,
              error: error.message,
              lastCheck: Date.now()
            };
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
  safeHandle(
    ipcMain,
    IPC_CHANNELS.OLLAMA.PULL_MODELS,
    withErrorLogging(logger, async (_event, models = []) => {
      try {
        const ollama = getOllama();
        const results = [];
        for (const model of Array.isArray(models) ? models : []) {
          try {
            // Send progress events if supported by client
            const win = typeof getMainWindow === 'function' ? getMainWindow() : null;
            await ollama.pull({
              model,
              stream: (progress) => {
                try {
                  if (win && !win.isDestroyed()) {
                    win.webContents.send('operation-progress', {
                      type: 'ollama-pull',
                      model,
                      progress
                    });
                  }
                } catch {
                  // Non-fatal if progress send fails
                }
              }
            });
            results.push({ model, success: true });
          } catch (e) {
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
        const ollama = getOllama();
        // FIX: Add timeout to prevent main process hang during model deletion
        await withOllamaTimeout(
          ollama.delete({ model }),
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
