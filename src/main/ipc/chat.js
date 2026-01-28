const { registerHandlers } = require('./ipcWrappers');
const { IpcServiceContext, createFromLegacyParams } = require('./IpcServiceContext');
const { schemas } = require('./validationSchemas');
const ChatService = require('../services/ChatService');
const { container, ServiceIds } = require('../services/ServiceContainer');

function registerChatIpc(servicesOrParams) {
  let context;
  if (servicesOrParams instanceof IpcServiceContext) {
    context = servicesOrParams;
  } else {
    context = createFromLegacyParams(servicesOrParams);
  }

  const { ipcMain, IPC_CHANNELS, logger } = context.core;
  const { getServiceIntegration } = context;

  let chatService = null;
  const getChatService = () => {
    if (chatService) return chatService;

    const integration = getServiceIntegration && getServiceIntegration();
    const diContainer = integration?.container || container;

    if (!diContainer || typeof diContainer.resolve !== 'function') {
      logger.warn('[Chat] DI container unavailable');
      return null;
    }

    const safeResolve = (serviceId) => {
      try {
        return diContainer.resolve(serviceId);
      } catch (error) {
        logger.warn('[Chat] Failed to resolve service', {
          serviceId,
          error: error?.message || String(error)
        });
        return null;
      }
    };

    const searchService = safeResolve(ServiceIds.SEARCH_SERVICE);
    const chromaDbService = safeResolve(ServiceIds.CHROMA_DB);
    const embeddingService = safeResolve(ServiceIds.PARALLEL_EMBEDDING);
    const ollamaService = safeResolve(ServiceIds.OLLAMA_SERVICE);
    const settingsService = safeResolve(ServiceIds.SETTINGS);

    try {
      chatService = new ChatService({
        searchService,
        chromaDbService,
        embeddingService,
        ollamaService,
        settingsService
      });
    } catch (error) {
      logger.error('[Chat] Failed to initialize ChatService', {
        error: error?.message || String(error)
      });
      chatService = null;
    }

    return chatService;
  };
  const getChatServiceSafe = () => {
    try {
      return getChatService();
    } catch (error) {
      logger.error('[Chat] Failed to access ChatService', {
        error: error?.message || String(error)
      });
      return null;
    }
  };

  registerHandlers({
    ipcMain,
    logger,
    context: 'Chat',
    handlers: {
      [IPC_CHANNELS.CHAT.QUERY]: {
        schema: schemas.chatQuery,
        serviceName: 'chat',
        getService: getChatServiceSafe,
        fallbackResponse: { success: false, error: 'Chat service unavailable' },
        handler: async (event, payload, service) => service.query(payload)
      },
      [IPC_CHANNELS.CHAT.RESET_SESSION]: {
        schema: schemas.chatReset,
        serviceName: 'chat',
        getService: getChatServiceSafe,
        fallbackResponse: { success: false, error: 'Chat service unavailable' },
        handler: async (event, { sessionId } = {}, service) => {
          await service.resetSession(sessionId);
          return { success: true };
        }
      }
    }
  });
}

module.exports = registerChatIpc;
