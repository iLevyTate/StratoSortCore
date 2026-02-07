/**
 * Llama IPC Handlers - In-process LLM operations
 *
 * IPC handlers for node-llama-cpp based LlamaService.
 * Provides model management, configuration, and health check endpoints.
 *
 * @module ipc/llama
 */

const { IpcServiceContext, createFromLegacyParams } = require('./IpcServiceContext');
const { withErrorLogging, safeHandle, safeSend } = require('./ipcWrappers');
const { TIMEOUTS } = require('../../shared/performanceConstants');

/**
 * Helper to add timeout to async operations
 */
async function withTimeout(promise, timeoutMs, operation) {
  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`${operation} timeout after ${timeoutMs}ms`));
    }, timeoutMs);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Register Llama IPC handlers
 */
function registerLlamaIpc(servicesOrParams) {
  let container;
  if (servicesOrParams instanceof IpcServiceContext) {
    container = servicesOrParams;
  } else {
    container = createFromLegacyParams(servicesOrParams);
  }

  const { ipcMain, IPC_CHANNELS, logger } = container.core;
  const { systemAnalytics } = container;
  const { getMainWindow } = container.electron;

  // Lazy load LlamaService to avoid circular dependencies
  let llamaService = null;
  let modelDownloadManager = null;

  function getLlamaService() {
    if (!llamaService) {
      const { getInstance } = require('../services/LlamaService');
      llamaService = getInstance();
    }
    return llamaService;
  }

  function getModelDownloadManager() {
    if (!modelDownloadManager) {
      const { getInstance } = require('../services/ModelDownloadManager');
      modelDownloadManager = getInstance();
    }
    return modelDownloadManager;
  }

  // Get available models
  safeHandle(
    ipcMain,
    IPC_CHANNELS.LLAMA?.GET_MODELS || 'llama:get-models',
    withErrorLogging(logger, async () => {
      try {
        const service = getLlamaService();
        await service.initialize();

        const models = await withTimeout(
          service.listModels(),
          TIMEOUTS.MODEL_DISCOVERY,
          'List models'
        );

        // Categorize models by type
        const categories = {
          text: [],
          vision: [],
          embedding: []
        };

        for (const model of models || []) {
          const type = model.type || 'text';
          if (categories[type]) {
            categories[type].push(model.name || model.filename);
          } else {
            categories.text.push(model.name || model.filename);
          }
        }

        // Update health status
        const now = Date.now();
        systemAnalytics.llamaHealth = {
          status: 'healthy',
          modelCount: models?.length || 0,
          gpuBackend: service.getHealthStatus?.()?.gpuBackend || service._gpuBackend,
          lastCheck: now
        };

        const config = await service.getConfig();
        const allModelNames = (models || []).map((m) => m.name || m.filename);

        // Auto-resolve stale model names (e.g., Ollama-era 'mxbai-embed-large'
        // → installed GGUF 'mxbai-embed-large-v1-f16.gguf')
        const resolveModel = (configured, installedList) => {
          if (!configured) return configured;
          if (installedList.includes(configured)) return configured;
          // Partial match: find an installed model whose name contains the old name
          const lc = configured.toLowerCase();
          return (
            installedList.find((m) => m.toLowerCase().includes(lc)) ||
            // Reverse: old name is a substring of the installed name
            installedList.find((m) => lc.includes(m.toLowerCase())) ||
            configured
          );
        };

        const resolvedText = resolveModel(config.textModel, categories.text);
        const resolvedVision = resolveModel(config.visionModel, categories.vision);
        const resolvedEmbedding = resolveModel(config.embeddingModel, categories.embedding);

        // Persist corrected names so the stale value is fixed permanently
        const corrections = {};
        if (resolvedText !== config.textModel) corrections.textModel = resolvedText;
        if (resolvedVision !== config.visionModel) corrections.visionModel = resolvedVision;
        if (resolvedEmbedding !== config.embeddingModel)
          corrections.embeddingModel = resolvedEmbedding;

        if (Object.keys(corrections).length > 0) {
          logger.info('[IPC:Llama] Auto-resolved stale model names', corrections);
          try {
            await service.updateConfig(corrections);
          } catch (e) {
            logger.warn('[IPC:Llama] Failed to persist model name corrections:', e?.message);
          }
        }

        return {
          models: allModelNames,
          categories,
          selected: {
            textModel: resolvedText,
            visionModel: resolvedVision,
            embeddingModel: resolvedEmbedding
          },
          llamaHealth: systemAnalytics.llamaHealth,
          inProcess: true
        };
      } catch (error) {
        logger.error('[IPC:Llama] Error getting models:', error);
        const now = Date.now();
        systemAnalytics.llamaHealth = {
          status: 'unhealthy',
          error: error.message,
          lastCheck: now
        };
        return {
          models: [],
          categories: { text: [], vision: [], embedding: [] },
          selected: {},
          error: error.message,
          llamaHealth: systemAnalytics.llamaHealth,
          inProcess: true
        };
      }
    })
  );

  // Get configuration
  safeHandle(
    ipcMain,
    IPC_CHANNELS.LLAMA?.GET_CONFIG || 'llama:get-config',
    withErrorLogging(logger, async () => {
      try {
        const service = getLlamaService();
        await service.initialize();
        const config = await service.getConfig();
        return { success: true, config };
      } catch (error) {
        logger.error('[IPC:Llama] Error getting config:', error);
        return { success: false, error: error.message };
      }
    })
  );

  // Update configuration
  safeHandle(
    ipcMain,
    IPC_CHANNELS.LLAMA?.UPDATE_CONFIG || 'llama:update-config',
    withErrorLogging(logger, async (_event, config) => {
      try {
        const service = getLlamaService();
        await service.initialize();
        await service.updateConfig(config);
        return { success: true };
      } catch (error) {
        logger.error('[IPC:Llama] Error updating config:', error);
        return { success: false, error: error.message };
      }
    })
  );

  // Test connection / health check
  safeHandle(
    ipcMain,
    IPC_CHANNELS.LLAMA?.TEST_CONNECTION || 'llama:test-connection',
    withErrorLogging(logger, async () => {
      try {
        const service = getLlamaService();
        await withTimeout(service.initialize(), TIMEOUTS.SERVICE_STARTUP, 'Llama initialization');
        const health = await withTimeout(
          service.getHealthStatus(),
          TIMEOUTS.HEALTH_CHECK,
          'Llama health check'
        );

        const now = Date.now();
        systemAnalytics.llamaHealth = {
          status: health.healthy ? 'healthy' : 'unhealthy',
          initialized: health.initialized,
          gpuBackend: health.gpuBackend,
          lastCheck: now
        };

        return {
          success: true,
          status: health.healthy ? 'healthy' : 'unhealthy',
          llamaHealth: systemAnalytics.llamaHealth,
          inProcess: true,
          gpuBackend: health.gpuBackend
        };
      } catch (error) {
        logger.error('[IPC:Llama] Test connection failed:', error);
        const now = Date.now();
        systemAnalytics.llamaHealth = {
          status: 'unhealthy',
          error: error.message,
          lastCheck: now
        };
        return {
          success: false,
          status: 'unhealthy',
          error: error.message,
          llamaHealth: systemAnalytics.llamaHealth,
          inProcess: true
        };
      }
    })
  );

  // Download model
  safeHandle(
    ipcMain,
    IPC_CHANNELS.LLAMA?.DOWNLOAD_MODEL || 'llama:download-model',
    withErrorLogging(logger, async (_event, modelName) => {
      try {
        const manager = getModelDownloadManager();
        const win = typeof getMainWindow === 'function' ? getMainWindow() : null;

        // Set up progress callback
        const onProgress = (progress) => {
          if (win && !win.isDestroyed()) {
            safeSend(win.webContents, 'operation-progress', {
              type: 'model-download',
              model: modelName,
              progress
            });
          }
        };

        const result = await manager.downloadModel(modelName, { onProgress });
        return result;
      } catch (error) {
        logger.error('[IPC:Llama] Model download failed:', error);
        return { success: false, error: error.message };
      }
    })
  );

  // Delete model
  safeHandle(
    ipcMain,
    IPC_CHANNELS.LLAMA?.DELETE_MODEL || 'llama:delete-model',
    withErrorLogging(logger, async (_event, modelName) => {
      try {
        if (!modelName || typeof modelName !== 'string') {
          return { success: false, error: 'Invalid model name' };
        }

        const manager = getModelDownloadManager();
        const result = await manager.deleteModel(modelName);
        return result;
      } catch (error) {
        logger.error('[IPC:Llama] Model delete failed:', error);
        return { success: false, error: error.message };
      }
    })
  );

  // Get download status
  safeHandle(
    ipcMain,
    IPC_CHANNELS.LLAMA?.GET_DOWNLOAD_STATUS || 'llama:get-download-status',
    withErrorLogging(logger, async () => {
      try {
        const manager = getModelDownloadManager();
        const status = manager.getStatus();
        return { success: true, status };
      } catch (error) {
        logger.error('[IPC:Llama] Get download status failed:', error);
        return { success: false, error: error.message };
      }
    })
  );
}

module.exports = { registerLlamaIpc };
