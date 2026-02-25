const { IpcServiceContext, createFromLegacyParams } = require('./IpcServiceContext');
const { performance } = require('perf_hooks');
const { createHandler, safeHandle, z } = require('./ipcWrappers');
const { safeFilePath } = require('../utils/safeAccess');
const { validateFileOperationPath } = require('../../shared/pathSanitization');
const { mapFoldersToCategories, getFolderNamesString } = require('../../shared/folderUtils');
const { recognizeIfAvailable } = require('../utils/tesseractUtils');
const {
  withProcessingState,
  buildErrorContext,
  createAnalysisFallback,
  recordAnalysisResult,
  getFolderCategories
} = require('./analysisUtils');
const BatchAnalysisService = require('../services/BatchAnalysisService');
const { sendOperationProgress } = require('./files/batchProgressReporter');

let batchAnalysisService = null;
const activeBatchRuns = new Map();

function getBatchAnalysisService() {
  if (!batchAnalysisService) {
    batchAnalysisService = new BatchAnalysisService();
  }
  return batchAnalysisService;
}

function registerAnalysisIpc(servicesOrParams) {
  let container;
  if (servicesOrParams instanceof IpcServiceContext) {
    container = servicesOrParams;
  } else {
    container = createFromLegacyParams(servicesOrParams);
  }

  const { ipcMain, IPC_CHANNELS, logger } = container.core;
  const { analyzeDocumentFile, analyzeImageFile } = container.analysis;
  const { systemAnalytics, getServiceIntegration } = container;
  const { getCustomFolders } = container.folders;
  const getMainWindow = container.electron?.getMainWindow;

  const stringSchema = z ? z.string().min(1) : null;
  const analyzeBatchSchema = z
    ? z.object({
        batchId: z.string().min(1).max(160).optional(),
        filePaths: z.array(z.string().min(1)).min(1),
        smartFolders: z.array(z.any()).optional(),
        options: z
          .object({
            concurrency: z.number().int().min(1).max(8).optional(),
            stopOnError: z.boolean().optional(),
            sectionOrder: z.enum(['documents-first', 'images-first']).optional(),
            enableVisionBatchMode: z.boolean().optional()
          })
          .optional()
      })
    : null;
  const cancelBatchSchema = z
    ? z.object({
        batchId: z.string().min(1).max(160),
        reason: z.string().min(1).max(200).optional()
      })
    : null;
  const LOG_PREFIX = '[IPC-ANALYSIS]';

  async function validateAnalysisPath(filePath) {
    const cleanPath = safeFilePath(filePath);
    if (!cleanPath) {
      throw new Error('Invalid file path provided');
    }

    const validation = await validateFileOperationPath(cleanPath, {
      requireExists: true,
      checkSymlinks: true,
      requireAbsolute: true,
      disallowUNC: true,
      disallowUrlSchemes: true,
      allowFileUrl: false
    });

    if (!validation.valid) {
      throw new Error(validation.error || 'Invalid file path provided');
    }

    return validation.normalizedPath;
  }

  /**
   * Core document analysis logic - shared between with-zod and without-zod handlers
   */
  async function performDocumentAnalysis(filePath) {
    const serviceIntegration = getServiceIntegration?.();
    const cleanPath = await validateAnalysisPath(filePath);

    const startTime = performance.now();
    logger.info(`${LOG_PREFIX} Starting document analysis for: ${cleanPath}`);

    try {
      return await withProcessingState({
        filePath: cleanPath,
        processingState: serviceIntegration?.processingState,
        logger,
        logPrefix: LOG_PREFIX,
        fn: async () => {
          const folderCategories = getFolderCategories(
            getCustomFolders,
            mapFoldersToCategories,
            logger
          );
          logger.info(
            `${LOG_PREFIX} Using ${folderCategories.length} smart folders for context:`,
            getFolderNamesString(folderCategories)
          );

          const result = await analyzeDocumentFile(cleanPath, folderCategories);
          const duration = performance.now() - startTime;
          systemAnalytics.recordProcessingTime(duration);

          await recordAnalysisResult({
            filePath: cleanPath,
            result,
            processingTime: duration,
            modelType: 'llm',
            analysisHistory: serviceIntegration?.analysisHistory,
            logger
          });

          return result;
        }
      });
    } catch (error) {
      const errorContext = buildErrorContext({
        operation: 'document-analysis',
        filePath: cleanPath,
        error
      });
      logger.error(`${LOG_PREFIX} Document analysis failed with context:`, errorContext);
      systemAnalytics.recordFailure(error);
      return createAnalysisFallback(cleanPath, 'documents', error.message);
    }
  }

  const analyzeDocumentHandler = createHandler({
    logger,
    context: 'Analysis',
    schema: stringSchema,
    handler: (event, filePath) => performDocumentAnalysis(filePath)
  });

  safeHandle(ipcMain, IPC_CHANNELS.ANALYSIS.ANALYZE_DOCUMENT, analyzeDocumentHandler);

  const IMAGE_LOG_PREFIX = '[IPC-IMAGE-ANALYSIS]';

  /**
   * Core image analysis logic - shared between with-zod and without-zod handlers
   */
  async function performImageAnalysis(filePath) {
    const serviceIntegration = getServiceIntegration?.();
    const cleanPath = await validateAnalysisPath(filePath);

    const startTime = performance.now();
    logger.info(`${IMAGE_LOG_PREFIX} Starting image analysis for: ${cleanPath}`);

    try {
      return await withProcessingState({
        filePath: cleanPath,
        processingState: serviceIntegration?.processingState,
        logger,
        logPrefix: IMAGE_LOG_PREFIX,
        fn: async () => {
          const folderCategories = getFolderCategories(
            getCustomFolders,
            mapFoldersToCategories,
            logger
          );
          logger.info(
            `${IMAGE_LOG_PREFIX} Using ${folderCategories.length} smart folders for context:`,
            getFolderNamesString(folderCategories)
          );

          const result = await analyzeImageFile(cleanPath, folderCategories);
          const duration = performance.now() - startTime;
          systemAnalytics.recordProcessingTime(duration);

          await recordAnalysisResult({
            filePath: cleanPath,
            result,
            processingTime: duration,
            modelType: 'vision',
            analysisHistory: serviceIntegration?.analysisHistory,
            logger
          });

          return result;
        }
      });
    } catch (error) {
      const errorContext = buildErrorContext({
        operation: 'image-analysis',
        filePath: cleanPath,
        error
      });
      logger.error(`${IMAGE_LOG_PREFIX} Image analysis failed with context:`, errorContext);
      systemAnalytics.recordFailure(error);
      return createAnalysisFallback(cleanPath, 'images', error.message);
    }
  }

  const analyzeImageHandler = createHandler({
    logger,
    context: 'Analysis',
    schema: stringSchema,
    handler: (event, filePath) => performImageAnalysis(filePath)
  });

  safeHandle(ipcMain, IPC_CHANNELS.ANALYSIS.ANALYZE_IMAGE, analyzeImageHandler);

  const analyzeBatchHandler = createHandler({
    logger,
    context: 'Analysis',
    schema: analyzeBatchSchema,
    handler: async (event, payload) => {
      const serviceIntegration = getServiceIntegration?.();
      const startedAt = performance.now();

      const normalizedPayload = Array.isArray(payload) ? { filePaths: payload } : payload || {};
      const rawPaths = Array.isArray(normalizedPayload.filePaths)
        ? normalizedPayload.filePaths
        : [];
      const options = normalizedPayload.options || {};
      const requestedBatchId =
        typeof normalizedPayload.batchId === 'string' ? normalizedPayload.batchId.trim() : '';
      const batchId = requestedBatchId || `analysis_${require('crypto').randomUUID()}`;

      if (rawPaths.length === 0) {
        return {
          success: true,
          results: [],
          errors: [],
          total: 0,
          batchId
        };
      }

      if (activeBatchRuns.has(batchId)) {
        logger.warn(`${LOG_PREFIX} Duplicate active batch id rejected`, { batchId });
        return {
          success: false,
          error: `Batch already active: ${batchId}`,
          batchId
        };
      }

      const validatedPaths = await Promise.all(
        rawPaths.map((filePath) => validateAnalysisPath(filePath))
      );
      let folderCategories = [];
      if (
        Array.isArray(normalizedPayload.smartFolders) &&
        normalizedPayload.smartFolders.length > 0
      ) {
        try {
          folderCategories = mapFoldersToCategories(normalizedPayload.smartFolders);
        } catch (folderError) {
          logger.warn(`${LOG_PREFIX} Failed to normalize provided smart folders`, {
            error: folderError?.message
          });
        }
      }
      if (!Array.isArray(folderCategories) || folderCategories.length === 0) {
        folderCategories = getFolderCategories(getCustomFolders, mapFoldersToCategories, logger);
      }

      logger.info(`${LOG_PREFIX} Starting batch analysis`, {
        batchId,
        totalFiles: validatedPaths.length,
        folders: folderCategories.length,
        sectionOrder: options.sectionOrder || 'documents-first'
      });

      const runState = {
        batchId,
        cancelled: false,
        reason: null,
        requestedAt: null
      };
      activeBatchRuns.set(batchId, runState);

      try {
        const batchResult = await getBatchAnalysisService().analyzeFiles(
          validatedPaths,
          folderCategories,
          {
            batchId,
            isCancelled: () => runState.cancelled,
            concurrency: options.concurrency,
            stopOnError: options.stopOnError,
            sectionOrder: options.sectionOrder,
            enableVisionBatchMode: options.enableVisionBatchMode,
            onProgress: (progress) => {
              if (typeof getMainWindow === 'function') {
                sendOperationProgress(getMainWindow, {
                  type: 'batch_analyze',
                  batchId,
                  ...progress
                });
              }
            },
            documentAnalyzer: async (filePath, smartFolders) => {
              return withProcessingState({
                filePath,
                processingState: serviceIntegration?.processingState,
                logger,
                logPrefix: LOG_PREFIX,
                fn: async () => {
                  const started = performance.now();
                  const result = await analyzeDocumentFile(filePath, smartFolders);
                  const processingTime = performance.now() - started;
                  await recordAnalysisResult({
                    filePath,
                    result,
                    processingTime,
                    modelType: 'llm',
                    analysisHistory: serviceIntegration?.analysisHistory,
                    logger
                  });
                  return result;
                }
              });
            },
            imageAnalyzer: async (filePath, smartFolders) => {
              return withProcessingState({
                filePath,
                processingState: serviceIntegration?.processingState,
                logger,
                logPrefix: '[IPC-IMAGE-ANALYSIS]',
                fn: async () => {
                  const started = performance.now();
                  const result = await analyzeImageFile(filePath, smartFolders);
                  const processingTime = performance.now() - started;
                  await recordAnalysisResult({
                    filePath,
                    result,
                    processingTime,
                    modelType: 'vision',
                    analysisHistory: serviceIntegration?.analysisHistory,
                    logger
                  });
                  return result;
                }
              });
            }
          }
        );

        const duration = performance.now() - startedAt;
        systemAnalytics.recordProcessingTime(duration);

        logger.info(`${LOG_PREFIX} Batch analysis complete`, {
          batchId,
          cancelled: Boolean(batchResult?.cancelled),
          totalFiles: batchResult.total,
          successful: batchResult.successful,
          failed: batchResult.errors?.length || 0,
          durationMs: Math.round(duration)
        });

        return {
          ...batchResult,
          batchId
        };
      } finally {
        activeBatchRuns.delete(batchId);
      }
    }
  });

  safeHandle(ipcMain, IPC_CHANNELS.ANALYSIS.ANALYZE_BATCH, analyzeBatchHandler);

  const cancelBatchHandler = createHandler({
    logger,
    context: 'Analysis',
    schema: cancelBatchSchema,
    handler: async (event, payload) => {
      const batchId = String(payload?.batchId || '').trim();
      const reason =
        typeof payload?.reason === 'string' && payload.reason.trim().length > 0
          ? payload.reason.trim()
          : 'Cancelled by renderer';
      const runState = activeBatchRuns.get(batchId);
      if (!runState) {
        logger.warn(`${LOG_PREFIX} Cancel request received for unknown batch`, { batchId });
        return { success: true, batchId, cancelled: false, notFound: true };
      }
      const wasCancelled = runState.cancelled;
      runState.cancelled = true;
      runState.reason = reason;
      runState.requestedAt = Date.now();
      logger.info(`${LOG_PREFIX} Cancel request acknowledged`, { batchId, reason, wasCancelled });
      return {
        success: true,
        batchId,
        cancelled: true,
        alreadyCancelled: wasCancelled
      };
    }
  });

  safeHandle(ipcMain, IPC_CHANNELS.ANALYSIS.CANCEL_BATCH, cancelBatchHandler);

  async function runOcr(filePath) {
    const cleanPath = await validateAnalysisPath(filePath);
    const start = performance.now();
    const ocrResult = await recognizeIfAvailable(null, cleanPath, {
      lang: 'eng',
      oem: 1,
      psm: 3
    });
    if (!ocrResult.success) {
      const error = ocrResult.cause || new Error(ocrResult.error || 'OCR failed');
      logger.error('OCR failed:', error);
      systemAnalytics.recordFailure(error);
      return { success: false, error: ocrResult.error || error.message };
    }
    const duration = performance.now() - start;
    systemAnalytics.recordProcessingTime(duration);
    return { success: true, text: ocrResult.text };
  }

  const extractImageTextHandler = createHandler({
    logger,
    context: 'Analysis',
    schema: stringSchema,
    handler: async (event, filePath) => {
      try {
        return await runOcr(filePath);
      } catch (error) {
        logger.error('OCR failed:', error);
        systemAnalytics.recordFailure(error);
        return { success: false, error: error.message };
      }
    }
  });
  safeHandle(ipcMain, IPC_CHANNELS.ANALYSIS.EXTRACT_IMAGE_TEXT, extractImageTextHandler);
}

module.exports = registerAnalysisIpc;
