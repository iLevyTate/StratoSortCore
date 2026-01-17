/**
 * Organization Suggestions IPC Handlers
 *
 * Handles AI-powered file organization suggestions, feedback recording,
 * and organization strategies.
 */
const { IpcServiceContext, createFromLegacyParams } = require('./IpcServiceContext');
const { createHandler, createErrorResponse, safeHandle } = require('./ipcWrappers');
const { schemas } = require('./validationSchemas');
const OrganizationSuggestionService = require('../services/organization');
const { logger } = require('../../shared/logger');

logger.setContext('IPC:Suggestions');

function registerSuggestionsIpc(servicesOrParams) {
  let container;
  if (servicesOrParams instanceof IpcServiceContext) {
    container = servicesOrParams;
  } else {
    container = createFromLegacyParams(servicesOrParams);
  }

  const { ipcMain, IPC_CHANNELS } = container.core;
  const { settingsService } = container.settings;
  const { getCustomFolders } = container.folders;
  const { getServiceIntegration } = container;

  // Retrieve services from integration if available
  let chromaDbService = null;
  let folderMatchingService = null;

  // Legacy support: if servicesOrParams has them directly
  if (!(servicesOrParams instanceof IpcServiceContext)) {
    chromaDbService = servicesOrParams.chromaDbService;
    folderMatchingService = servicesOrParams.folderMatchingService;
  }

  // If not found, try getting from serviceIntegration
  if ((!chromaDbService || !folderMatchingService) && getServiceIntegration) {
    const integration = getServiceIntegration();
    if (integration) {
      chromaDbService = chromaDbService || integration.chromaDbService;
      folderMatchingService = folderMatchingService || integration.folderMatchingService;
    }
  }

  const context = 'Suggestions';

  // Initialize the suggestion service (may have null services if ChromaDB unavailable)
  let suggestionService = null;
  try {
    suggestionService = new OrganizationSuggestionService({
      chromaDbService,
      folderMatchingService,
      settingsService
    });
    logger.info('[SUGGESTIONS] OrganizationSuggestionService initialized');
  } catch (error) {
    logger.warn('[SUGGESTIONS] Failed to initialize suggestion service:', error.message);
    // Continue anyway - handlers will check for null service
  }

  // Helper to get suggestion service
  const getSuggestionService = () => suggestionService;

  // Get suggestions for a single file
  safeHandle(
    ipcMain,
    IPC_CHANNELS.SUGGESTIONS.GET_FILE_SUGGESTIONS,
    createHandler({
      logger,
      context,
      schema: schemas?.fileSuggestion,
      serviceName: 'suggestionService',
      getService: getSuggestionService,
      fallbackResponse: {
        success: false,
        error: 'Suggestion service unavailable (ChromaDB may not be running)',
        primary: null,
        alternatives: [],
        confidence: 0
      },
      handler: async (event, { file, options = {} }, service) => {
        try {
          logger.info('[SUGGESTIONS] Getting suggestions for file:', file.name);

          const smartFolders = getCustomFolders();
          const suggestions = await service.getSuggestionsForFile(file, smartFolders, options);

          logger.info('[SUGGESTIONS] Generated suggestions:', {
            file: file.name,
            primary: suggestions.primary?.folder,
            alternatives: suggestions.alternatives?.length || 0,
            confidence: suggestions.confidence
          });

          return suggestions;
        } catch (error) {
          logger.error('[SUGGESTIONS] Failed to get file suggestions:', error);
          return createErrorResponse(error);
        }
      }
    })
  );

  // Get batch suggestions for multiple files
  safeHandle(
    ipcMain,
    IPC_CHANNELS.SUGGESTIONS.GET_BATCH_SUGGESTIONS,
    createHandler({
      logger,
      context,
      schema: schemas?.batchSuggestion,
      serviceName: 'suggestionService',
      getService: getSuggestionService,
      fallbackResponse: {
        success: false,
        error: 'Suggestion service unavailable (ChromaDB may not be running)',
        groups: [],
        recommendations: []
      },
      handler: async (event, { files }, service) => {
        try {
          logger.info('[SUGGESTIONS] Getting batch suggestions for', files.length, 'files');

          const smartFolders = getCustomFolders();
          const batchSuggestions = await service.getBatchSuggestions(files, smartFolders);

          logger.info('[SUGGESTIONS] Generated batch suggestions:', {
            fileCount: files.length,
            groups: batchSuggestions.groups?.length || 0,
            recommendations: batchSuggestions.recommendations?.length || 0
          });

          return batchSuggestions;
        } catch (error) {
          logger.error('[SUGGESTIONS] Failed to get batch suggestions:', error);
          return createErrorResponse(error, {
            groups: []
          });
        }
      }
    })
  );

  // Record user feedback on suggestions
  safeHandle(
    ipcMain,
    IPC_CHANNELS.SUGGESTIONS.RECORD_FEEDBACK,
    createHandler({
      logger,
      context,
      schema: schemas?.feedback,
      serviceName: 'suggestionService',
      getService: getSuggestionService,
      fallbackResponse: {
        success: false,
        error: 'Suggestion service unavailable'
      },
      handler: async (event, { file, suggestion, accepted, note }, service) => {
        try {
          logger.info('[SUGGESTIONS] Recording feedback:', {
            file: file.name,
            suggestion: suggestion?.folder,
            accepted
          });

          service.recordFeedback(file, suggestion, accepted);
          if (note) {
            await service.recordFeedbackNote(file, suggestion, accepted, note);
          }

          return { success: true };
        } catch (error) {
          logger.error('[SUGGESTIONS] Failed to record feedback:', error);
          return createErrorResponse(error);
        }
      }
    })
  );

  // Add feedback memory
  safeHandle(
    ipcMain,
    IPC_CHANNELS.SUGGESTIONS.ADD_FEEDBACK_MEMORY,
    createHandler({
      logger,
      context,
      schema: schemas?.feedbackMemoryAdd,
      serviceName: 'suggestionService',
      getService: getSuggestionService,
      fallbackResponse: {
        success: false,
        error: 'Suggestion service unavailable'
      },
      handler: async (event, { text, metadata }, service) => {
        try {
          const item = await service.addFeedbackMemory(text, metadata);
          return { success: true, item };
        } catch (error) {
          logger.error('[SUGGESTIONS] Failed to add feedback memory:', error);
          return createErrorResponse(error);
        }
      }
    })
  );

  // Get feedback memory list
  safeHandle(
    ipcMain,
    IPC_CHANNELS.SUGGESTIONS.GET_FEEDBACK_MEMORY,
    createHandler({
      logger,
      context,
      serviceName: 'suggestionService',
      getService: getSuggestionService,
      fallbackResponse: {
        success: false,
        error: 'Suggestion service unavailable',
        items: []
      },
      handler: async (event, service) => {
        try {
          const items = await service.listFeedbackMemory();
          return { success: true, items };
        } catch (error) {
          logger.error('[SUGGESTIONS] Failed to get feedback memory:', error);
          return createErrorResponse(error, { items: [] });
        }
      }
    })
  );

  // Delete feedback memory
  safeHandle(
    ipcMain,
    IPC_CHANNELS.SUGGESTIONS.DELETE_FEEDBACK_MEMORY,
    createHandler({
      logger,
      context,
      schema: schemas?.feedbackMemoryDelete,
      serviceName: 'suggestionService',
      getService: getSuggestionService,
      fallbackResponse: {
        success: false,
        error: 'Suggestion service unavailable'
      },
      handler: async (event, { id }, service) => {
        try {
          const removed = await service.deleteFeedbackMemory(id);
          return { success: true, removed };
        } catch (error) {
          logger.error('[SUGGESTIONS] Failed to delete feedback memory:', error);
          return createErrorResponse(error);
        }
      }
    })
  );

  // Update feedback memory
  safeHandle(
    ipcMain,
    IPC_CHANNELS.SUGGESTIONS.UPDATE_FEEDBACK_MEMORY,
    createHandler({
      logger,
      context,
      schema: schemas?.feedbackMemoryUpdate,
      serviceName: 'suggestionService',
      getService: getSuggestionService,
      fallbackResponse: {
        success: false,
        error: 'Suggestion service unavailable'
      },
      handler: async (event, { id, text, metadata }, service) => {
        try {
          const item = await service.updateFeedbackMemory(id, text, metadata);
          return { success: true, item };
        } catch (error) {
          logger.error('[SUGGESTIONS] Failed to update feedback memory:', error);
          return createErrorResponse(error);
        }
      }
    })
  );

  // Get organization strategies
  safeHandle(
    ipcMain,
    IPC_CHANNELS.SUGGESTIONS.GET_STRATEGIES,
    createHandler({
      logger,
      context,
      serviceName: 'suggestionService',
      getService: getSuggestionService,
      fallbackResponse: {
        success: false,
        error: 'Suggestion service is not available',
        strategies: []
      },
      handler: async (event, service) => {
        try {
          logger.info('[SUGGESTIONS] Getting organization strategies');

          return {
            success: true,
            strategies: Object.entries(service.strategies).map(([id, strategy]) => ({
              id,
              ...strategy
            }))
          };
        } catch (error) {
          logger.error('[SUGGESTIONS] Failed to get strategies:', error);
          return createErrorResponse(error, {
            strategies: []
          });
        }
      }
    })
  );

  // Apply a specific strategy to files
  safeHandle(
    ipcMain,
    IPC_CHANNELS.SUGGESTIONS.APPLY_STRATEGY,
    createHandler({
      logger,
      context,
      schema: schemas?.strategyApplication,
      serviceName: 'suggestionService',
      getService: getSuggestionService,
      fallbackResponse: {
        success: false,
        error: 'Suggestion service is not available',
        results: []
      },
      handler: async (event, { files, strategyId }, service) => {
        try {
          logger.info('[SUGGESTIONS] Applying strategy:', {
            strategy: strategyId,
            fileCount: files.length
          });

          const strategy = service.strategies[strategyId];
          if (!strategy) {
            throw new Error(`Unknown strategy: ${strategyId}`);
          }

          const smartFolders = getCustomFolders();
          const results = [];

          for (const file of files) {
            const folder = service.mapFileToStrategy(file, strategy, smartFolders);
            results.push({
              file,
              folder,
              strategy: strategyId
            });
          }

          return {
            success: true,
            results
          };
        } catch (error) {
          logger.error('[SUGGESTIONS] Failed to apply strategy:', error);
          return createErrorResponse(error);
        }
      }
    })
  );

  // Get user patterns (for debugging/UI display)
  safeHandle(
    ipcMain,
    IPC_CHANNELS.SUGGESTIONS.GET_USER_PATTERNS,
    createHandler({
      logger,
      context,
      serviceName: 'suggestionService',
      getService: getSuggestionService,
      fallbackResponse: {
        success: false,
        error: 'Suggestion service not available',
        patterns: []
      },
      handler: async (event, service) => {
        try {
          logger.info('[SUGGESTIONS] Getting user patterns');

          const patterns = Array.from(service.userPatterns.entries()).map(([pattern, data]) => ({
            pattern,
            ...data
          }));

          return {
            success: true,
            patterns
          };
        } catch (error) {
          logger.error('[SUGGESTIONS] Failed to get user patterns:', error);
          return createErrorResponse(error, {
            patterns: []
          });
        }
      }
    })
  );

  // Clear user patterns (for testing/reset)
  safeHandle(
    ipcMain,
    IPC_CHANNELS.SUGGESTIONS.CLEAR_PATTERNS,
    createHandler({
      logger,
      context,
      serviceName: 'suggestionService',
      getService: getSuggestionService,
      fallbackResponse: {
        success: false,
        error: 'Suggestion service not available'
      },
      handler: async (event, service) => {
        try {
          logger.info('[SUGGESTIONS] Clearing user patterns');

          service.userPatterns.clear();
          service.feedbackHistory = [];

          return { success: true };
        } catch (error) {
          logger.error('[SUGGESTIONS] Failed to clear patterns:', error);
          return createErrorResponse(error);
        }
      }
    })
  );

  // Analyze folder structure for improvements
  safeHandle(
    ipcMain,
    IPC_CHANNELS.SUGGESTIONS.ANALYZE_FOLDER_STRUCTURE,
    createHandler({
      logger,
      context,
      serviceName: 'suggestionService',
      getService: getSuggestionService,
      fallbackResponse: {
        success: false,
        error: 'Suggestion service not available',
        improvements: []
      },
      handler: async (event, { files = [] }, service) => {
        try {
          logger.info('[SUGGESTIONS] Analyzing folder structure');

          const smartFolders = getCustomFolders();
          const improvements = await service.analyzeFolderStructure(smartFolders, files);

          logger.info('[SUGGESTIONS] Folder analysis complete:', {
            improvementCount: improvements.length,
            smartFolderCount: smartFolders.length
          });

          return {
            success: true,
            improvements,
            smartFolders
          };
        } catch (error) {
          logger.error('[SUGGESTIONS] Failed to analyze folder structure:', error);
          return createErrorResponse(error, {
            improvements: []
          });
        }
      }
    })
  );

  // Suggest new smart folder
  safeHandle(
    ipcMain,
    IPC_CHANNELS.SUGGESTIONS.SUGGEST_NEW_FOLDER,
    createHandler({
      logger,
      context,
      serviceName: 'suggestionService',
      getService: getSuggestionService,
      fallbackResponse: {
        success: false,
        error: 'Suggestion service not available'
      },
      handler: async (event, { file }, service) => {
        try {
          logger.info('[SUGGESTIONS] Suggesting new folder for:', file.name);

          const smartFolders = getCustomFolders();
          const suggestion = await service.suggestNewSmartFolder(file, smartFolders);

          return {
            success: true,
            suggestion
          };
        } catch (error) {
          logger.error('[SUGGESTIONS] Failed to suggest new folder:', error);
          return createErrorResponse(error);
        }
      }
    })
  );

  logger.info('[IPC] Suggestions handlers registered');

  return suggestionService;
}

module.exports = { registerSuggestionsIpc };
