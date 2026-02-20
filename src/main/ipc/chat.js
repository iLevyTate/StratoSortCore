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
    const vectorDbService = safeResolve(ServiceIds.ORAMA_VECTOR);
    const embeddingService = safeResolve(ServiceIds.PARALLEL_EMBEDDING);
    const llamaService = safeResolve(ServiceIds.LLAMA_SERVICE);
    const settingsService = safeResolve(ServiceIds.SETTINGS);
    const chatHistoryStore = safeResolve(ServiceIds.CHAT_HISTORY_STORE);

    // If cached with null llamaService, all chat queries fail for the entire session.
    if (!llamaService) {
      const isRegistered = diContainer?.has?.(ServiceIds.LLAMA_SERVICE);
      logger.warn('[Chat] Llama service not available', {
        registered: isRegistered,
        containerAvailable: !!diContainer
      });
      return null;
    }

    try {
      chatService = new ChatService({
        searchService,
        vectorDbService,
        embeddingService,
        llamaService,
        settingsService,
        chatHistoryStore
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
      [IPC_CHANNELS.CHAT.QUERY_STREAM]: {
        schema: schemas.chatQuery,
        serviceName: 'chat',
        getService: getChatServiceSafe,
        fallbackResponse: { success: false, error: 'Chat service unavailable' },
        handler: async (event, payload, service) => {
          const sender = event.sender;

          // Return immediately — streaming data flows through STREAM_CHUNK/STREAM_END
          // events, not through the invoke return value.  Awaiting the full streaming
          // operation here would block the invoke promise for 30-60s+, racing against
          // the preload's IPC timeout and causing spurious timeout errors.
          service
            .queryStreaming({
              ...payload,
              onEvent: (data) => {
                if (!sender.isDestroyed()) {
                  sender.send(IPC_CHANNELS.CHAT.STREAM_CHUNK, data);
                }
              }
            })
            .then(() => {
              if (!sender.isDestroyed()) {
                sender.send(IPC_CHANNELS.CHAT.STREAM_END);
              }
            })
            .catch((err) => {
              logger.error('[Chat] Streaming background error', {
                error: err?.message || String(err)
              });
              if (!sender.isDestroyed()) {
                sender.send(IPC_CHANNELS.CHAT.STREAM_CHUNK, {
                  type: 'error',
                  error: err?.message || 'Streaming failed'
                });
                sender.send(IPC_CHANNELS.CHAT.STREAM_END);
              }
            });

          return { success: true };
        }
      },
      [IPC_CHANNELS.CHAT.CANCEL_STREAM]: {
        schema: schemas.chatCancel,
        serviceName: 'chat',
        getService: getChatServiceSafe,
        fallbackResponse: { success: false, error: 'Chat service unavailable' },
        handler: async (event, payload = {}, service) => {
          const result = await service.cancelStreamingRequest(payload);
          return { success: true, ...result };
        }
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
      },
      [IPC_CHANNELS.CHAT.LIST_CONVERSATIONS]: {
        schema: schemas.chatListConversations,
        serviceName: 'chat',
        getService: getChatServiceSafe,
        fallbackResponse: { success: false, error: 'Chat service unavailable' },
        handler: async (event, { limit, offset } = {}, service) => {
          if (!service.chatHistoryStore) return { success: false, error: 'History not available' };
          return {
            success: true,
            conversations: service.chatHistoryStore.listConversations(limit, offset)
          };
        }
      },
      [IPC_CHANNELS.CHAT.GET_CONVERSATION]: {
        schema: schemas.chatConversationId,
        serviceName: 'chat',
        getService: getChatServiceSafe,
        fallbackResponse: { success: false, error: 'Chat service unavailable' },
        handler: async (event, { id } = {}, service) => {
          if (!service.chatHistoryStore) return { success: false, error: 'History not available' };
          const conv = service.chatHistoryStore.getConversation(id);
          return { success: true, conversation: conv };
        }
      },
      [IPC_CHANNELS.CHAT.DELETE_CONVERSATION]: {
        schema: schemas.chatConversationId,
        serviceName: 'chat',
        getService: getChatServiceSafe,
        fallbackResponse: { success: false, error: 'Chat service unavailable' },
        handler: async (event, { id } = {}, service) => {
          if (!service.chatHistoryStore) return { success: false, error: 'History not available' };
          service.chatHistoryStore.deleteConversation(id);
          return { success: true };
        }
      },
      [IPC_CHANNELS.CHAT.SEARCH_CONVERSATIONS]: {
        schema: schemas.chatSearchConversations,
        serviceName: 'chat',
        getService: getChatServiceSafe,
        fallbackResponse: { success: false, error: 'Chat service unavailable' },
        handler: async (event, { query } = {}, service) => {
          if (!service.chatHistoryStore) return { success: false, error: 'History not available' };
          return { success: true, results: service.chatHistoryStore.searchConversations(query) };
        }
      },
      [IPC_CHANNELS.CHAT.EXPORT_CONVERSATION]: {
        schema: schemas.chatConversationId,
        serviceName: 'chat',
        getService: getChatServiceSafe,
        fallbackResponse: { success: false, error: 'Chat service unavailable' },
        handler: async (event, { id } = {}, service) => {
          if (!service.chatHistoryStore) return { success: false, error: 'History not available' };
          if (!service.chatHistoryStore.exportAsMarkdown)
            return { success: false, error: 'Export not supported' };
          const markdown = service.chatHistoryStore.exportAsMarkdown(id);
          if (!markdown) return { success: false, error: 'Conversation not found' };
          return { success: true, markdown };
        }
      }
    }
  });
}

module.exports = registerChatIpc;
