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

    const searchService = diContainer.resolve(ServiceIds.SEARCH_SERVICE);
    const chromaDbService = diContainer.resolve(ServiceIds.CHROMA_DB);
    const embeddingService = diContainer.resolve(ServiceIds.PARALLEL_EMBEDDING);
    const ollamaService = diContainer.resolve(ServiceIds.OLLAMA_SERVICE);
    const settingsService = diContainer.resolve(ServiceIds.SETTINGS);

    chatService = new ChatService({
      searchService,
      chromaDbService,
      embeddingService,
      ollamaService,
      settingsService
    });

    return chatService;
  };

  registerHandlers({
    ipcMain,
    logger,
    context: 'Chat',
    handlers: {
      [IPC_CHANNELS.CHAT.QUERY]: {
        schema: schemas.chatQuery,
        handler: async (event, payload) => {
          const service = getChatService();
          return service.query(payload);
        }
      },
      [IPC_CHANNELS.CHAT.RESET_SESSION]: {
        schema: schemas.chatReset,
        handler: async (event, { sessionId } = {}) => {
          const service = getChatService();
          await service.resetSession(sessionId);
          return { success: true };
        }
      }
    }
  });
}

module.exports = registerChatIpc;
