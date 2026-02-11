/**
 * Llama IPC Handlers - In-process LLM operations
 *
 * IPC handlers for node-llama-cpp based LlamaService.
 * Provides model management, configuration, and health check endpoints.
 *
 * @module ipc/llama
 */

const { IpcServiceContext, createFromLegacyParams } = require('./IpcServiceContext');
const { createHandler, safeHandle, safeSend, z } = require('./ipcWrappers');
const { container: serviceContainer, ServiceIds } = require('../services/ServiceContainer');
const { TIMEOUTS } = require('../../shared/performanceConstants');
const { AI_DEFAULTS } = require('../../shared/constants');

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
      if (!serviceContainer.has(ServiceIds.LLAMA_SERVICE)) {
        const { registerWithContainer } = require('../services/LlamaService');
        registerWithContainer(serviceContainer, ServiceIds.LLAMA_SERVICE);
      }
      llamaService = serviceContainer.resolve(ServiceIds.LLAMA_SERVICE);
    }
    return llamaService;
  }

  function getModelDownloadManager() {
    if (!modelDownloadManager) {
      if (!serviceContainer.has(ServiceIds.MODEL_DOWNLOAD_MANAGER)) {
        const { getInstance } = require('../services/ModelDownloadManager');
        serviceContainer.registerSingleton(ServiceIds.MODEL_DOWNLOAD_MANAGER, () => getInstance());
      }
      modelDownloadManager = serviceContainer.resolve(ServiceIds.MODEL_DOWNLOAD_MANAGER);
    }
    return modelDownloadManager;
  }

  const context = 'Llama';
  const schemaVoid = z ? z.void() : null;
  const schemaModelName = z ? z.string().min(1) : null;
  // Restrict update-config to known config fields instead of allowing arbitrary passthrough
  const ALLOWED_CONFIG_FIELDS = new Set([
    'textModel',
    'visionModel',
    'embeddingModel',
    // Canonical internal field names
    'gpuLayers',
    'contextSize',
    'threads',
    // Backward-compatible field names used in settings payloads
    'llamaGpuLayers',
    'llamaContextSize',
    'vectorDbPersistPath'
  ]);
  const schemaUpdateConfig = z
    ? z
        .object({})
        .passthrough()
        .refine((obj) => Object.keys(obj).every((k) => ALLOWED_CONFIG_FIELDS.has(k)), {
          message: 'Unknown config fields provided'
        })
    : null;

  // Get available models
  safeHandle(
    ipcMain,
    IPC_CHANNELS.LLAMA?.GET_MODELS || 'llama:get-models',
    createHandler({
      logger,
      context,
      schema: schemaVoid,
      handler: async () => {
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
          const healthStatus = service.getHealthStatus?.();
          systemAnalytics.llamaHealth = {
            status: 'healthy',
            modelCount: models?.length || 0,
            gpuBackend: healthStatus?.gpuBackend || service._gpuBackend,
            gpuDetected: healthStatus?.gpuDetected || null,
            lastCheck: now
          };

          const config = await service.getConfig();
          const allModelNames = (models || []).map((m) => m.name || m.filename);

          // Auto-resolve stale model names. Ollama-era names with ':' tags
          // (e.g. 'llama3.2:latest') are replaced with GGUF defaults immediately.
          // Partial-match names (e.g. 'mxbai-embed-large') are fuzzy-matched
          // against installed GGUF filenames.
          const isOllamaName = (n) =>
            typeof n === 'string' && n.includes(':') && !n.endsWith('.gguf');

          const resolveModel = (configured, installedList, defaultModel) => {
            if (!configured) return defaultModel || configured;
            if (installedList.includes(configured)) return configured;
            // Ollama-style names can't be fuzzy-matched — use the default
            if (isOllamaName(configured)) return defaultModel || configured;
            const lc = configured.toLowerCase();
            return (
              installedList.find((m) => m.toLowerCase().includes(lc)) ||
              installedList.find((m) => lc.includes(m.toLowerCase())) ||
              configured
            );
          };

          const resolvedText = resolveModel(
            config.textModel,
            categories.text,
            AI_DEFAULTS.TEXT.MODEL
          );
          const resolvedVision = resolveModel(
            config.visionModel,
            categories.vision,
            AI_DEFAULTS.IMAGE.MODEL
          );
          const resolvedEmbedding = resolveModel(
            config.embeddingModel,
            categories.embedding,
            AI_DEFAULTS.EMBEDDING.MODEL
          );

          // Do not auto-persist corrections to avoid mid-operation model switches.
          // Instead return suggested corrections to the UI so the user can confirm.
          const corrections = {};
          if (resolvedText !== config.textModel) corrections.textModel = resolvedText;
          if (resolvedVision !== config.visionModel) corrections.visionModel = resolvedVision;
          if (resolvedEmbedding !== config.embeddingModel)
            corrections.embeddingModel = resolvedEmbedding;

          if (Object.keys(corrections).length > 0) {
            logger.info('[IPC:Llama] Detected stale model names (not auto-applied)', corrections);
          }

          return {
            models: allModelNames,
            categories,
            selected: {
              textModel: resolvedText,
              visionModel: resolvedVision,
              embeddingModel: resolvedEmbedding
            },
            corrections,
            requiresModelConfirmation: Object.keys(corrections).length > 0,
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
      }
    })
  );

  // Get configuration
  safeHandle(
    ipcMain,
    IPC_CHANNELS.LLAMA?.GET_CONFIG || 'llama:get-config',
    createHandler({
      logger,
      context,
      schema: schemaVoid,
      handler: async () => {
        try {
          const service = getLlamaService();
          await service.initialize();
          const config = await service.getConfig();
          return { success: true, config };
        } catch (error) {
          logger.error('[IPC:Llama] Error getting config:', error);
          return { success: false, error: error.message };
        }
      }
    })
  );

  // Update configuration
  safeHandle(
    ipcMain,
    IPC_CHANNELS.LLAMA?.UPDATE_CONFIG || 'llama:update-config',
    createHandler({
      logger,
      context,
      schema: schemaUpdateConfig,
      handler: async (_event, config) => {
        try {
          const service = getLlamaService();
          await service.initialize();
          const mappedConfig = {
            ...config,
            gpuLayers: config?.gpuLayers ?? config?.llamaGpuLayers,
            contextSize: config?.contextSize ?? config?.llamaContextSize
          };
          await service.updateConfig(mappedConfig);
          return { success: true };
        } catch (error) {
          logger.error('[IPC:Llama] Error updating config:', error);
          return { success: false, error: error.message };
        }
      }
    })
  );

  // Test connection / health check
  safeHandle(
    ipcMain,
    IPC_CHANNELS.LLAMA?.TEST_CONNECTION || 'llama:test-connection',
    createHandler({
      logger,
      context,
      schema: schemaVoid,
      handler: async () => {
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
            gpuDetected: health.gpuDetected || null,
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
      }
    })
  );

  // Download model
  safeHandle(
    ipcMain,
    IPC_CHANNELS.LLAMA?.DOWNLOAD_MODEL || 'llama:download-model',
    createHandler({
      logger,
      context,
      schema: schemaModelName,
      handler: async (_event, modelName) => {
        try {
          const normalizedName = typeof modelName === 'string' ? modelName.trim() : '';
          if (!normalizedName) {
            return { success: false, error: 'Model name is required' };
          }
          if (
            normalizedName.includes('..') ||
            normalizedName.includes('/') ||
            normalizedName.includes('\\')
          ) {
            return { success: false, error: 'Invalid model name' };
          }
          const manager = getModelDownloadManager();
          const win = typeof getMainWindow === 'function' ? getMainWindow() : null;

          // Set up progress callback
          const onProgress = (progress) => {
            if (win && !win.isDestroyed()) {
              safeSend(win.webContents, 'operation-progress', {
                type: 'model-download',
                model: normalizedName,
                progress
              });
            }
          };

          const result = await manager.downloadModel(normalizedName, { onProgress });
          return result;
        } catch (error) {
          logger.error('[IPC:Llama] Model download failed:', error);
          return { success: false, error: error.message };
        }
      }
    })
  );

  // Delete model
  safeHandle(
    ipcMain,
    IPC_CHANNELS.LLAMA?.DELETE_MODEL || 'llama:delete-model',
    createHandler({
      logger,
      context,
      schema: schemaModelName,
      handler: async (_event, modelName) => {
        try {
          const normalizedName = typeof modelName === 'string' ? modelName.trim() : '';
          if (!normalizedName) {
            return { success: false, error: 'Model name is required' };
          }
          if (
            normalizedName.includes('..') ||
            normalizedName.includes('/') ||
            normalizedName.includes('\\')
          ) {
            return { success: false, error: 'Invalid model name' };
          }
          const manager = getModelDownloadManager();
          const result = await manager.deleteModel(normalizedName);
          return result;
        } catch (error) {
          logger.error('[IPC:Llama] Model delete failed:', error);
          return { success: false, error: error.message };
        }
      }
    })
  );

  // Get download status
  safeHandle(
    ipcMain,
    IPC_CHANNELS.LLAMA?.GET_DOWNLOAD_STATUS || 'llama:get-download-status',
    createHandler({
      logger,
      context,
      schema: schemaVoid,
      handler: async () => {
        try {
          const manager = getModelDownloadManager();
          const status = manager.getStatus();
          return { success: true, status };
        } catch (error) {
          logger.error('[IPC:Llama] Get download status failed:', error);
          return { success: false, error: error.message };
        }
      }
    })
  );
}

module.exports = { registerLlamaIpc };
