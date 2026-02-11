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

  const stringSchema = z ? z.string().min(1) : null;
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
