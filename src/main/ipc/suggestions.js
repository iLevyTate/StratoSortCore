const { withErrorLogging } = require('./withErrorLogging');
const OrganizationSuggestionService = require('../services/OrganizationSuggestionService');
const { logger } = require('../../shared/logger');
logger.setContext('IPC:Suggestions');

function registerSuggestionsIpc({
  ipcMain,
  IPC_CHANNELS,
  chromaDbService,
  folderMatchingService,
  settingsService,
  getCustomFolders,
}) {
  // Initialize the suggestion service (may have null services if ChromaDB unavailable)
  let suggestionService = null;
  try {
    suggestionService = new OrganizationSuggestionService({
      chromaDbService,
      folderMatchingService,
      settingsService,
    });
    logger.info('[SUGGESTIONS] OrganizationSuggestionService initialized');
  } catch (error) {
    logger.warn(
      '[SUGGESTIONS] Failed to initialize suggestion service:',
      error.message,
    );
    // Continue anyway - handlers will check for null service
  }

  // Get suggestions for a single file
  ipcMain.handle(
    IPC_CHANNELS.SUGGESTIONS.GET_FILE_SUGGESTIONS,
    withErrorLogging(logger, async (_event, { file }) => {
      try {
        // CRITICAL FIX: Check if suggestion service is available
        if (!suggestionService) {
          logger.warn('[SUGGESTIONS] Suggestion service not available');
          return {
            success: false,
            error:
              'Suggestion service unavailable (ChromaDB may not be running)',
            primary: null,
            alternatives: [],
            confidence: 0,
          };
        }

        logger.info('[SUGGESTIONS] Getting suggestions for file:', file.name);

        const smartFolders = getCustomFolders();
        const suggestions = await suggestionService.getSuggestionsForFile(
          file,
          smartFolders,
          {},
        );

        logger.info('[SUGGESTIONS] Generated suggestions:', {
          file: file.name,
          primary: suggestions.primary?.folder,
          alternatives: suggestions.alternatives?.length || 0,
          confidence: suggestions.confidence,
        });

        return suggestions;
      } catch (error) {
        logger.error('[SUGGESTIONS] Failed to get file suggestions:', error);
        return {
          success: false,
          error: error.message,
        };
      }
    }),
  );

  // Get batch suggestions for multiple files
  ipcMain.handle(
    IPC_CHANNELS.SUGGESTIONS.GET_BATCH_SUGGESTIONS,
    withErrorLogging(logger, async (event, { files }) => {
      void event;
      try {
        // CRITICAL FIX: Check if suggestion service is available
        if (!suggestionService) {
          logger.warn(
            '[SUGGESTIONS] Suggestion service not available for batch suggestions',
          );
          return {
            success: false,
            error:
              'Suggestion service unavailable (ChromaDB may not be running)',
            groups: [],
            recommendations: [],
          };
        }

        logger.info(
          '[SUGGESTIONS] Getting batch suggestions for',
          files.length,
          'files',
        );

        const smartFolders = getCustomFolders();
        const batchSuggestions = await suggestionService.getBatchSuggestions(
          files,
          smartFolders,
        );

        logger.info('[SUGGESTIONS] Generated batch suggestions:', {
          fileCount: files.length,
          groups: batchSuggestions.groups?.length || 0,
          recommendations: batchSuggestions.recommendations?.length || 0,
        });

        return batchSuggestions;
      } catch (error) {
        logger.error('[SUGGESTIONS] Failed to get batch suggestions:', error);
        return {
          success: false,
          error: error.message,
          groups: [],
        };
      }
    }),
  );

  // Record user feedback on suggestions
  ipcMain.handle(
    IPC_CHANNELS.SUGGESTIONS.RECORD_FEEDBACK,
    withErrorLogging(logger, async (event, { file, suggestion, accepted }) => {
      void event;
      try {
        // CRITICAL FIX: Check if suggestion service is available
        if (!suggestionService) {
          logger.warn(
            '[SUGGESTIONS] Cannot record feedback - service not available',
          );
          return {
            success: false,
            error: 'Suggestion service unavailable',
          };
        }

        logger.info('[SUGGESTIONS] Recording feedback:', {
          file: file.name,
          suggestion: suggestion?.folder,
          accepted,
        });

        suggestionService.recordFeedback(file, suggestion, accepted);

        return {
          success: true,
        };
      } catch (error) {
        logger.error('[SUGGESTIONS] Failed to record feedback:', error);
        return {
          success: false,
          error: error.message,
        };
      }
    }),
  );

  // Get organization strategies
  ipcMain.handle(
    IPC_CHANNELS.SUGGESTIONS.GET_STRATEGIES,
    withErrorLogging(logger, async (event) => {
      void event;
      try {
        logger.info('[SUGGESTIONS] Getting organization strategies');

        // HIGH PRIORITY FIX (HIGH-13): Check if suggestion service is available
        if (!suggestionService) {
          logger.warn(
            '[SUGGESTIONS] Cannot get strategies - service not available',
          );
          return {
            success: false,
            error: 'Suggestion service is not available',
            strategies: [],
          };
        }

        return {
          success: true,
          strategies: Object.entries(suggestionService.strategies).map(
            ([id, strategy]) => ({
              id,
              ...strategy,
            }),
          ),
        };
      } catch (error) {
        logger.error('[SUGGESTIONS] Failed to get strategies:', error);
        return {
          success: false,
          error: error.message,
          strategies: [],
        };
      }
    }),
  );

  // Apply a specific strategy to files
  ipcMain.handle(
    IPC_CHANNELS.SUGGESTIONS.APPLY_STRATEGY,
    withErrorLogging(logger, async (event, { files, strategyId }) => {
      void event;
      try {
        logger.info('[SUGGESTIONS] Applying strategy:', {
          strategy: strategyId,
          fileCount: files.length,
        });

        // HIGH PRIORITY FIX (HIGH-13): Check if suggestion service is available
        if (!suggestionService) {
          logger.warn(
            '[SUGGESTIONS] Cannot apply strategy - service not available',
          );
          return {
            success: false,
            error: 'Suggestion service is not available',
            results: [],
          };
        }

        const strategy = suggestionService.strategies[strategyId];
        if (!strategy) {
          throw new Error(`Unknown strategy: ${strategyId}`);
        }

        const smartFolders = getCustomFolders();
        const results = [];

        for (const file of files) {
          const folder = suggestionService.mapFileToStrategy(
            file,
            strategy,
            smartFolders,
          );
          results.push({
            file,
            folder,
            strategy: strategyId,
          });
        }

        return {
          success: true,
          results,
        };
      } catch (error) {
        logger.error('[SUGGESTIONS] Failed to apply strategy:', error);
        return {
          success: false,
          error: error.message,
        };
      }
    }),
  );

  // Get user patterns (for debugging/UI display)
  ipcMain.handle(
    IPC_CHANNELS.SUGGESTIONS.GET_USER_PATTERNS,
    withErrorLogging(logger, async (event) => {
      void event;
      try {
        logger.info('[SUGGESTIONS] Getting user patterns');

        const patterns = Array.from(
          suggestionService.userPatterns.entries(),
        ).map(([pattern, data]) => ({
          pattern,
          ...data,
        }));

        return {
          success: true,
          patterns,
        };
      } catch (error) {
        logger.error('[SUGGESTIONS] Failed to get user patterns:', error);
        return {
          success: false,
          error: error.message,
          patterns: [],
        };
      }
    }),
  );

  // Clear user patterns (for testing/reset)
  ipcMain.handle(
    IPC_CHANNELS.SUGGESTIONS.CLEAR_PATTERNS,
    withErrorLogging(logger, async (event) => {
      void event;
      try {
        logger.info('[SUGGESTIONS] Clearing user patterns');

        suggestionService.userPatterns.clear();
        suggestionService.feedbackHistory = [];

        return {
          success: true,
        };
      } catch (error) {
        logger.error('[SUGGESTIONS] Failed to clear patterns:', error);
        return {
          success: false,
          error: error.message,
        };
      }
    }),
  );

  // Analyze folder structure for improvements
  ipcMain.handle(
    IPC_CHANNELS.SUGGESTIONS.ANALYZE_FOLDER_STRUCTURE,
    withErrorLogging(logger, async (event, { files = [] }) => {
      void event;
      try {
        logger.info('[SUGGESTIONS] Analyzing folder structure');

        const smartFolders = getCustomFolders();
        const improvements = await suggestionService.analyzeFolderStructure(
          smartFolders,
          files,
        );

        logger.info('[SUGGESTIONS] Folder analysis complete:', {
          improvementCount: improvements.length,
          smartFolderCount: smartFolders.length,
        });

        return {
          success: true,
          improvements,
          smartFolders,
        };
      } catch (error) {
        logger.error(
          '[SUGGESTIONS] Failed to analyze folder structure:',
          error,
        );
        return {
          success: false,
          error: error.message,
          improvements: [],
        };
      }
    }),
  );

  // Suggest new smart folder
  ipcMain.handle(
    IPC_CHANNELS.SUGGESTIONS.SUGGEST_NEW_FOLDER,
    withErrorLogging(logger, async (event, { file }) => {
      void event;
      try {
        logger.info('[SUGGESTIONS] Suggesting new folder for:', file.name);

        const smartFolders = getCustomFolders();
        const suggestion = await suggestionService.suggestNewSmartFolder(
          file,
          smartFolders,
        );

        return {
          success: true,
          suggestion,
        };
      } catch (error) {
        logger.error('[SUGGESTIONS] Failed to suggest new folder:', error);
        return {
          success: false,
          error: error.message,
        };
      }
    }),
  );

  logger.info('[IPC] Suggestions handlers registered');

  return suggestionService;
}

module.exports = { registerSuggestionsIpc };
