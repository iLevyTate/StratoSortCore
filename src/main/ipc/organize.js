/**
 * Auto-Organize IPC Handlers
 *
 * Handles file organization operations including auto-organize,
 * batch organize, and organization statistics.
 */
const { createHandler, createErrorResponse, safeHandle } = require('./ipcWrappers');
const { schemas } = require('./validationSchemas');
const { logger } = require('../../shared/logger');
const { isNotFoundError } = require('../../shared/errorClassifier');
const fs = require('fs').promises;

logger.setContext('IPC:Organize');

/**
 * Validate that a source file exists and is a file before moving
 * @param {string} sourcePath - Path to validate
 * @returns {Promise<boolean>} True if valid
 * @throws {Error} If source doesn't exist or isn't a file
 */
async function validateSourceFile(sourcePath) {
  try {
    const stats = await fs.stat(sourcePath);
    if (!stats.isFile()) {
      throw new Error(`Source path is not a file: ${sourcePath}`);
    }
    return true;
  } catch (error) {
    if (isNotFoundError(error)) {
      throw new Error(`Source file does not exist: ${sourcePath}`);
    }
    throw error;
  }
}

/**
 * Validate all files in an array before processing
 * Uses parallel validation for performance (avoids N+1 sequential fs.stat calls)
 * @param {Array<{path: string}>} files - Files to validate
 * @returns {Promise<{valid: Array, invalid: Array}>} Validated results
 */
async function validateSourceFiles(files) {
  const results = await Promise.all(
    files.map(async (file) => {
      const sourcePath = file.path || file.source;
      if (!sourcePath) {
        return { file, valid: false, error: 'Missing file path' };
      }

      try {
        await validateSourceFile(sourcePath);
        return { file, valid: true };
      } catch (error) {
        logger.warn('[ORGANIZE] File validation failed', {
          path: sourcePath,
          error: error.message
        });
        return { file, valid: false, error: error.message };
      }
    })
  );

  return {
    valid: results.filter((r) => r.valid).map((r) => r.file),
    invalid: results.filter((r) => !r.valid).map((r) => ({ file: r.file, error: r.error }))
  };
}

function registerOrganizeIpc({ ipcMain, IPC_CHANNELS, getServiceIntegration, getCustomFolders }) {
  const context = 'Organize';

  // Helper to get auto-organize service
  const getOrganizeService = () => getServiceIntegration()?.autoOrganizeService;

  // Auto-organize files with AI suggestions
  safeHandle(
    ipcMain,
    IPC_CHANNELS.ORGANIZE.AUTO,
    createHandler({
      logger,
      context,
      schema: schemas?.autoOrganize,
      serviceName: 'autoOrganizeService',
      getService: getOrganizeService,
      fallbackResponse: {
        success: false,
        error: 'Auto-organize service not available',
        organized: [],
        needsReview: [],
        failed: []
      },
      handler: async (event, { files, smartFolders, options = {} }, service) => {
        const path = require('path');

        // HIGH-11: Validate all source files exist before processing
        const { valid: validFiles, invalid: invalidFiles } = await validateSourceFiles(files);

        if (invalidFiles.length > 0) {
          logger.warn('[ORGANIZE] Some files were skipped (not found or invalid)', {
            skippedCount: invalidFiles.length,
            skippedFiles: invalidFiles.slice(0, 5).map((f) => f.error)
          });
        }

        if (validFiles.length === 0) {
          return {
            success: false,
            error: 'No valid files to organize - all source files are missing or invalid',
            organized: [],
            needsReview: [],
            failed: invalidFiles.map((f) => ({
              file: f.file,
              error: f.error
            }))
          };
        }

        // FIX: Ensure extension property exists on all files (compute from path if missing)
        const filesWithExtension = validFiles.map((file) => {
          if (!file.extension && file.path) {
            const ext = path.extname(file.path).toLowerCase();
            return { ...file, extension: ext };
          }
          return file;
        });
        try {
          logger.info('[ORGANIZE] Starting auto-organize', {
            fileCount: filesWithExtension.length,
            skippedCount: invalidFiles.length
          });

          const folders = smartFolders || getCustomFolders();
          const result = await service.organizeFiles(filesWithExtension, folders, options);

          logger.info('[ORGANIZE] Auto-organize complete', {
            organized: result.organized.length,
            needsReview: result.needsReview.length,
            failed: result.failed.length
          });

          return result;
        } catch (error) {
          logger.error('[ORGANIZE] Auto-organize failed:', error);
          return createErrorResponse(error, {
            organized: [],
            needsReview: [],
            failed: []
          });
        }
      }
    })
  );

  // Batch organize with auto-approval
  safeHandle(
    ipcMain,
    IPC_CHANNELS.ORGANIZE.BATCH,
    createHandler({
      logger,
      context,
      schema: schemas?.autoOrganize,
      serviceName: 'autoOrganizeService',
      getService: getOrganizeService,
      fallbackResponse: {
        success: false,
        error: 'Auto-organize service not available',
        operations: [],
        groups: []
      },
      handler: async (event, { files, smartFolders, options = {} }, service) => {
        const path = require('path');

        // Validate all source files exist before processing (same as AUTO handler)
        const { valid: validFiles, invalid: invalidFiles } = await validateSourceFiles(files);

        if (invalidFiles.length > 0) {
          logger.warn('[ORGANIZE] Batch: Some files were skipped (not found or invalid)', {
            skippedCount: invalidFiles.length,
            skippedFiles: invalidFiles.slice(0, 5).map((f) => f.error)
          });
        }

        if (validFiles.length === 0) {
          return {
            success: false,
            error: 'No valid files to organize - all source files are missing or invalid',
            operations: [],
            groups: [],
            failed: invalidFiles.map((f) => ({
              file: f.file,
              error: f.error
            }))
          };
        }

        // Ensure extension property exists on all files
        const filesWithExtension = validFiles.map((file) => {
          if (!file.extension && file.path) {
            const ext = path.extname(file.path).toLowerCase();
            return { ...file, extension: ext };
          }
          return file;
        });

        try {
          logger.info('[ORGANIZE] Starting batch organize', {
            fileCount: filesWithExtension.length,
            skippedCount: invalidFiles.length
          });

          const folders = smartFolders || getCustomFolders();
          const result = await service.batchOrganize(filesWithExtension, folders, options);

          logger.info('[ORGANIZE] Batch organize complete', {
            operationCount: result.operations.length,
            groupCount: result.groups.length
          });

          return result;
        } catch (error) {
          logger.error('[ORGANIZE] Batch organize failed:', error);
          return createErrorResponse(error, {
            operations: [],
            groups: []
          });
        }
      }
    })
  );

  // Process new file (for auto-organize on download)
  safeHandle(
    ipcMain,
    IPC_CHANNELS.ORGANIZE.PROCESS_NEW,
    createHandler({
      logger,
      context,
      serviceName: 'autoOrganizeService',
      getService: getOrganizeService,
      fallbackResponse: {
        success: false,
        error: 'Auto-organize service not available'
      },
      handler: async (event, { filePath, options = {} }, service) => {
        try {
          logger.info('[ORGANIZE] Processing new file', { filePath });

          const smartFolders = getCustomFolders();
          const result = await service.processNewFile(filePath, smartFolders, options);

          if (result) {
            logger.info('[ORGANIZE] New file organized', result);
          } else {
            logger.info('[ORGANIZE] New file not organized (low confidence or disabled)');
          }

          return result;
        } catch (error) {
          logger.error('[ORGANIZE] Failed to process new file:', error);
          return createErrorResponse(error);
        }
      }
    })
  );

  // Get organization statistics
  safeHandle(
    ipcMain,
    IPC_CHANNELS.ORGANIZE.GET_STATS,
    createHandler({
      logger,
      context,
      serviceName: 'autoOrganizeService',
      getService: getOrganizeService,
      fallbackResponse: {
        userPatterns: 0,
        feedbackHistory: 0,
        folderUsageStats: [],
        thresholds: {}
      },
      handler: async (event, service) => {
        try {
          const stats = await service.getStatistics();
          return stats;
        } catch (error) {
          logger.error('[ORGANIZE] Failed to get statistics:', error);
          return {
            userPatterns: 0,
            feedbackHistory: 0,
            folderUsageStats: [],
            thresholds: {}
          };
        }
      }
    })
  );

  // Update confidence thresholds
  safeHandle(
    ipcMain,
    IPC_CHANNELS.ORGANIZE.UPDATE_THRESHOLDS,
    createHandler({
      logger,
      context,
      schema: schemas?.thresholds,
      serviceName: 'autoOrganizeService',
      getService: getOrganizeService,
      fallbackResponse: {
        success: false,
        error: 'Auto-organize service not available'
      },
      handler: async (event, { thresholds }, service) => {
        try {
          service.updateThresholds(thresholds);

          return {
            success: true,
            thresholds
          };
        } catch (error) {
          logger.error('[ORGANIZE] Failed to update thresholds:', error);
          return createErrorResponse(error);
        }
      }
    })
  );

  // ============================================================================
  // Cluster-Based Organization Handlers
  // ============================================================================

  // Cluster batch organize - organize files grouped by semantic clusters
  safeHandle(
    ipcMain,
    IPC_CHANNELS.ORGANIZE.CLUSTER_BATCH,
    createHandler({
      logger,
      context,
      serviceName: 'autoOrganizeService',
      getService: getOrganizeService,
      fallbackResponse: {
        success: false,
        error: 'Auto-organize service not available',
        groups: [],
        outliers: []
      },
      handler: async (event, { files, smartFolders }, service) => {
        const path = require('path');

        try {
          // Validate source files
          const { valid: validFiles, invalid: invalidFiles } = await validateSourceFiles(files);

          if (validFiles.length === 0) {
            return {
              success: false,
              error: 'No valid files to organize',
              groups: [],
              outliers: [],
              failed: invalidFiles
            };
          }

          // Ensure extension exists
          const filesWithExtension = validFiles.map((file) => {
            if (!file.extension && file.path) {
              const ext = path.extname(file.path).toLowerCase();
              return { ...file, extension: ext };
            }
            return file;
          });

          logger.info('[ORGANIZE] Starting cluster batch organize', {
            fileCount: filesWithExtension.length
          });

          const folders = smartFolders || getCustomFolders();

          // Get cluster-based batch suggestions from the suggestion service
          const suggestionService = service.suggestionService;
          if (!suggestionService) {
            return {
              success: false,
              error: 'Suggestion service not available',
              groups: [],
              outliers: []
            };
          }

          const result = await suggestionService.getClusterBatchSuggestions(
            filesWithExtension,
            folders
          );

          logger.info('[ORGANIZE] Cluster batch organize complete', {
            groups: result.groups?.length || 0,
            outliers: result.outliers?.length || 0
          });

          return result;
        } catch (error) {
          logger.error('[ORGANIZE] Cluster batch organize failed:', error);
          return createErrorResponse(error, {
            groups: [],
            outliers: []
          });
        }
      }
    })
  );

  // Identify outliers - find files that don't fit well into any cluster
  safeHandle(
    ipcMain,
    IPC_CHANNELS.ORGANIZE.IDENTIFY_OUTLIERS,
    createHandler({
      logger,
      context,
      serviceName: 'autoOrganizeService',
      getService: getOrganizeService,
      fallbackResponse: {
        success: false,
        error: 'Auto-organize service not available',
        outliers: [],
        wellClustered: []
      },
      handler: async (event, { files }, service) => {
        const path = require('path');

        try {
          // Validate source files
          const { valid: validFiles } = await validateSourceFiles(files);

          if (validFiles.length === 0) {
            return {
              success: false,
              error: 'No valid files to analyze',
              outliers: [],
              wellClustered: []
            };
          }

          // Ensure extension exists
          const filesWithExtension = validFiles.map((file) => {
            if (!file.extension && file.path) {
              const ext = path.extname(file.path).toLowerCase();
              return { ...file, extension: ext };
            }
            return file;
          });

          logger.info('[ORGANIZE] Identifying outliers', {
            fileCount: filesWithExtension.length
          });

          const suggestionService = service.suggestionService;
          if (!suggestionService) {
            return {
              success: false,
              error: 'Suggestion service not available',
              outliers: [],
              wellClustered: []
            };
          }

          const result = await suggestionService.identifyOutliers(filesWithExtension);

          logger.info('[ORGANIZE] Outlier detection complete', {
            outliers: result.outlierCount || 0,
            wellClustered: result.clusteredCount || 0
          });

          return result;
        } catch (error) {
          logger.error('[ORGANIZE] Outlier detection failed:', error);
          return createErrorResponse(error, {
            outliers: [],
            wellClustered: []
          });
        }
      }
    })
  );

  // Get cluster-based suggestions for a single file
  safeHandle(
    ipcMain,
    IPC_CHANNELS.ORGANIZE.GET_CLUSTER_SUGGESTIONS,
    createHandler({
      logger,
      context,
      serviceName: 'autoOrganizeService',
      getService: getOrganizeService,
      fallbackResponse: {
        success: false,
        error: 'Auto-organize service not available',
        suggestions: []
      },
      handler: async (event, { file, smartFolders }, service) => {
        const path = require('path');

        try {
          // Validate source file
          if (!file?.path) {
            return {
              success: false,
              error: 'No file provided',
              suggestions: []
            };
          }

          await validateSourceFile(file.path);

          // Ensure extension exists
          const fileWithExtension = { ...file };
          if (!fileWithExtension.extension && fileWithExtension.path) {
            fileWithExtension.extension = path.extname(fileWithExtension.path).toLowerCase();
          }

          const folders = smartFolders || getCustomFolders();

          const suggestionService = service.suggestionService;
          if (!suggestionService) {
            return {
              success: false,
              error: 'Suggestion service not available',
              suggestions: []
            };
          }

          const suggestions = await suggestionService.getClusterBasedSuggestions(
            fileWithExtension,
            folders
          );

          return {
            success: true,
            suggestions,
            clusterInfo: suggestions[0]
              ? {
                  clusterLabel: suggestions[0].clusterLabel,
                  clusterSize: suggestions[0].clusterSize
                }
              : null
          };
        } catch (error) {
          logger.error('[ORGANIZE] Get cluster suggestions failed:', error);
          return createErrorResponse(error, {
            suggestions: []
          });
        }
      }
    })
  );

  logger.info('[IPC] Auto-organize handlers registered');
}

module.exports = { registerOrganizeIpc };
