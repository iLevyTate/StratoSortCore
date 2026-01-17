/**
 * Analysis History IPC Handlers
 *
 * Handles retrieval and management of file analysis history.
 * Demonstrates the service check pattern with various fallback responses.
 */
const { IpcServiceContext, createFromLegacyParams } = require('./IpcServiceContext');
const { createHandler, createErrorResponse, safeHandle } = require('./ipcWrappers');
const { schemas } = require('./validationSchemas');
const { normalizeText } = require('../../shared/normalization');
const { getSemanticFileId } = require('../../shared/fileIdUtils');

// FIX: Safety cap for "get all" requests to prevent memory exhaustion
// This limits the maximum number of history entries that can be retrieved at once
const MAX_HISTORY_EXPORT_LIMIT = 50000;

function registerAnalysisHistoryIpc(servicesOrParams) {
  let container;
  if (servicesOrParams instanceof IpcServiceContext) {
    container = servicesOrParams;
  } else {
    container = createFromLegacyParams(servicesOrParams);
  }

  const { ipcMain, IPC_CHANNELS, logger } = container.core;
  const { getServiceIntegration } = container;

  const context = 'AnalysisHistory';

  // Helper to get analysis history service
  const getHistoryService = () => getServiceIntegration()?.analysisHistory;
  const getChromaDbService = () => getServiceIntegration()?.chromaDbService;

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

          // Handle "get all" request with safety cap to prevent memory exhaustion
          if (all || limit === 'all') {
            // FIX: Use safety cap instead of Number.MAX_SAFE_INTEGER
            const full = (await service.getRecentAnalysis(MAX_HISTORY_EXPORT_LIMIT)) || [];
            // FIX H1: Ensure result is always an array
            const result = Array.isArray(full) ? full : [];

            // Log warning if we hit the safety cap
            if (result.length >= MAX_HISTORY_EXPORT_LIMIT) {
              logger.warn('[ANALYSIS-HISTORY] History retrieval hit safety cap', {
                cap: MAX_HISTORY_EXPORT_LIMIT,
                returned: result.length
              });
            }

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
      normalize: (payload) => {
        if (Array.isArray(payload)) {
          const [query, options] = payload;
          return [normalizeText(query, { maxLength: 2000 }), options];
        }
        return normalizeText(payload, { maxLength: 2000 });
      },
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
          // Mark embeddings as orphaned before clearing history to keep search/embeddings in sync.
          const chromaDb = getChromaDbService();
          if (chromaDb && typeof chromaDb.markEmbeddingsOrphaned === 'function') {
            await service.initialize();
            const entries = Object.values(service.analysisHistory?.entries || {});
            const fileIds = Array.from(
              new Set(
                entries
                  .map((entry) => entry?.organization?.actual || entry?.originalPath)
                  .filter((p) => typeof p === 'string' && p.length > 0)
                  .map((p) => getSemanticFileId(p))
              )
            );
            if (fileIds.length > 0) {
              await chromaDb.markEmbeddingsOrphaned(fileIds);
            }
          }
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
          // FIX: Use safety cap for export to prevent memory exhaustion
          const history = (await service.getRecentAnalysis(MAX_HISTORY_EXPORT_LIMIT)) || [];

          if (format === 'json') {
            return {
              success: true,
              data: JSON.stringify(history, null, 2),
              mime: 'application/json',
              filename: 'analysis-history.json'
            };
          }

          if (format === 'csv') {
            // FIX NEW-10: Include keywords and subject in CSV export
            const headers = [
              'fileName',
              'originalPath',
              'category',
              'confidence',
              'keywords',
              'subject',
              'timestamp'
            ];
            const lines = [headers.join(',')];

            for (const entry of history) {
              // Extract keywords from analysis result (could be array or comma-separated string)
              const keywords = entry.analysis?.keywords || entry.analysis?.tags || [];
              const keywordStr = Array.isArray(keywords)
                ? keywords.join('; ')
                : String(keywords || '');

              const row = [
                JSON.stringify(entry.fileName || ''),
                JSON.stringify(entry.originalPath || ''),
                JSON.stringify(entry.analysis?.category || entry.category || ''),
                JSON.stringify(String(entry.analysis?.confidence ?? entry.confidence ?? '')),
                JSON.stringify(keywordStr),
                JSON.stringify(entry.analysis?.subject || ''),
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
