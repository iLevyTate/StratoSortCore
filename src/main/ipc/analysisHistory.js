/**
 * Analysis History IPC Handlers
 *
 * Handles retrieval and management of file analysis history.
 * Demonstrates the service check pattern with various fallback responses.
 */
const { createHandler, createErrorResponse, safeHandle } = require('./ipcWrappers');
const { schemas } = require('./validationSchemas');

function registerAnalysisHistoryIpc({ ipcMain, IPC_CHANNELS, logger, getServiceIntegration }) {
  const context = 'AnalysisHistory';

  // Helper to get analysis history service
  const getHistoryService = () => getServiceIntegration()?.analysisHistory;

  // Get analysis statistics
  safeHandle(
    ipcMain,
    IPC_CHANNELS.ANALYSIS_HISTORY.GET_STATISTICS,
    createHandler({
      logger,
      context,
      serviceName: 'analysisHistory',
      getService: getHistoryService,
      fallbackResponse: {},
      handler: async (event, service) => {
        try {
          return (await service.getStatistics()) || {};
        } catch (error) {
          logger.error('Failed to get analysis statistics:', error);
          return {};
        }
      }
    })
  );

  // Get analysis history with pagination
  safeHandle(
    ipcMain,
    IPC_CHANNELS.ANALYSIS_HISTORY.GET,
    createHandler({
      logger,
      context,
      schema: schemas?.historyOptions,
      serviceName: 'analysisHistory',
      getService: getHistoryService,
      fallbackResponse: [],
      handler: async (event, options = {}, service) => {
        try {
          const { all = false, limit, offset = 0 } = options || {};

          // Handle "get all" request
          if (all || limit === 'all') {
            const full = (await service.getRecentAnalysis(Number.MAX_SAFE_INTEGER)) || [];
            // FIX H1: Ensure result is always an array
            const result = Array.isArray(full) ? full : [];
            return offset > 0 ? result.slice(offset) : result;
          }

          // Handle paginated request
          const effLimit = typeof limit === 'number' && limit > 0 ? limit : 50;

          if (offset > 0) {
            const interim = (await service.getRecentAnalysis(effLimit + offset)) || [];
            // FIX H1: Ensure result is always an array
            const result = Array.isArray(interim) ? interim : [];
            return result.slice(offset, offset + effLimit);
          }

          const result = (await service.getRecentAnalysis(effLimit)) || [];
          // FIX H1: Ensure result is always an array
          return Array.isArray(result) ? result : [];
        } catch (error) {
          logger.error('Failed to get analysis history:', error);
          return [];
        }
      }
    })
  );

  // Search analysis history
  safeHandle(
    ipcMain,
    IPC_CHANNELS.ANALYSIS_HISTORY.SEARCH,
    createHandler({
      logger,
      context,
      serviceName: 'analysisHistory',
      getService: getHistoryService,
      fallbackResponse: [],
      handler: async (event, query = '', options = {}, service) => {
        try {
          return (await service.searchAnalysis(query, options)) || [];
        } catch (error) {
          logger.error('Failed to search analysis history:', error);
          return [];
        }
      }
    })
  );

  // Get analysis history for specific file
  safeHandle(
    ipcMain,
    IPC_CHANNELS.ANALYSIS_HISTORY.GET_FILE_HISTORY,
    createHandler({
      logger,
      context,
      schema: schemas?.filePath,
      serviceName: 'analysisHistory',
      getService: getHistoryService,
      fallbackResponse: null,
      handler: async (event, filePath, service) => {
        try {
          return (await service.getAnalysisByPath(filePath)) || null;
        } catch (error) {
          logger.error('Failed to get file analysis history:', error);
          return null;
        }
      }
    })
  );

  // Clear analysis history
  safeHandle(
    ipcMain,
    IPC_CHANNELS.ANALYSIS_HISTORY.CLEAR,
    createHandler({
      logger,
      context,
      serviceName: 'analysisHistory',
      getService: getHistoryService,
      fallbackResponse: { success: false, error: 'Service unavailable' },
      handler: async (event, service) => {
        try {
          await service.createDefaultStructures();
          return { success: true };
        } catch (error) {
          logger.error('Failed to clear analysis history:', error);
          return createErrorResponse(error);
        }
      }
    })
  );

  // Export analysis history
  safeHandle(
    ipcMain,
    IPC_CHANNELS.ANALYSIS_HISTORY.EXPORT,
    createHandler({
      logger,
      context,
      serviceName: 'analysisHistory',
      getService: getHistoryService,
      fallbackResponse: { success: false, error: 'Service unavailable' },
      handler: async (event, format = 'json', service) => {
        try {
          const history = (await service.getRecentAnalysis(10000)) || [];

          if (format === 'json') {
            return {
              success: true,
              data: JSON.stringify(history, null, 2),
              mime: 'application/json',
              filename: 'analysis-history.json'
            };
          }

          if (format === 'csv') {
            const headers = ['fileName', 'originalPath', 'category', 'confidence', 'timestamp'];
            const lines = [headers.join(',')];

            for (const entry of history) {
              const row = [
                JSON.stringify(entry.fileName || ''),
                JSON.stringify(entry.originalPath || ''),
                JSON.stringify(entry.analysis?.category || entry.category || ''),
                JSON.stringify(String(entry.analysis?.confidence ?? entry.confidence ?? '')),
                JSON.stringify(entry.timestamp ? new Date(entry.timestamp).toISOString() : '')
              ];
              lines.push(row.join(','));
            }

            return {
              success: true,
              data: lines.join('\n'),
              mime: 'text/csv',
              filename: 'analysis-history.csv'
            };
          }

          // Default: return raw data
          return { success: true, data: history };
        } catch (error) {
          logger.error('Failed to export analysis history:', error);
          return createErrorResponse(error);
        }
      }
    })
  );
}

module.exports = registerAnalysisHistoryIpc;
