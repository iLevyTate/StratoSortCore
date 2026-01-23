const { IpcServiceContext, createFromLegacyParams } = require('./IpcServiceContext');
const { performance } = require('perf_hooks');
const { withErrorLogging, withValidation, safeHandle } = require('./ipcWrappers');
const { safeFilePath } = require('../utils/safeAccess');
const { mapFoldersToCategories, getFolderNamesString } = require('../../shared/folderUtils');
const { logger: moduleLogger } = require('../../shared/logger');
const { recognizeIfAvailable } = require('../utils/tesseractUtils');
const {
  withProcessingState,
  buildErrorContext,
  createAnalysisFallback,
  recordAnalysisResult,
  getFolderCategories
} = require('./analysisUtils');

let z;
try {
  z = require('zod');
} catch (error) {
  // Zod is optional - validation will fall back to manual checks
  // Log at debug level for troubleshooting module loading issues
  moduleLogger.debug('[IPC-ANALYSIS] Zod not available:', error.message);
  z = null;
}

function registerAnalysisIpc(servicesOrParams) {
  let container;
  if (servicesOrParams instanceof IpcServiceContext) {
    container = servicesOrParams;
  } else {
    container = createFromLegacyParams(servicesOrParams);
  }

  const { ipcMain, IPC_CHANNELS, logger } = container.core;
  const { analyzeDocumentFile, analyzeImageFile, tesseract } = container.analysis;
  const { systemAnalytics, getServiceIntegration } = container;
  const { getCustomFolders } = container.folders;

  const stringSchema = z ? z.string().min(1) : null;
  const LOG_PREFIX = '[IPC-ANALYSIS]';

  /**
   * Core document analysis logic - shared between with-zod and without-zod handlers
   */
  async function performDocumentAnalysis(filePath) {
    const serviceIntegration = getServiceIntegration?.();
    const cleanPath = safeFilePath(filePath);
    if (!cleanPath) {
      throw new Error('Invalid file path provided');
    }

    const startTime = performance.now();
    logger.info(`${LOG_PREFIX} Starting document analysis for: ${cleanPath}`);

    try {
      return await withProcessingState({
        filePath,
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

          const result = await analyzeDocumentFile(filePath, folderCategories);
          const duration = performance.now() - startTime;
          systemAnalytics.recordProcessingTime(duration);

          await recordAnalysisResult({
            filePath,
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
        filePath,
        error
      });
      logger.error(`${LOG_PREFIX} Document analysis failed with context:`, errorContext);
      systemAnalytics.recordFailure(error);
      return createAnalysisFallback(filePath, 'documents', error.message);
    }
  }

  const analyzeDocumentHandler =
    z && stringSchema
      ? withValidation(logger, stringSchema, (event, filePath) => performDocumentAnalysis(filePath))
      : withErrorLogging(logger, (event, filePath) => performDocumentAnalysis(filePath));

  safeHandle(ipcMain, IPC_CHANNELS.ANALYSIS.ANALYZE_DOCUMENT, analyzeDocumentHandler);

  const IMAGE_LOG_PREFIX = '[IPC-IMAGE-ANALYSIS]';

  /**
   * Core image analysis logic - shared between with-zod and without-zod handlers
   */
  async function performImageAnalysis(filePath) {
    const serviceIntegration = getServiceIntegration?.();
    const cleanPath = safeFilePath(filePath);
    if (!cleanPath) {
      throw new Error('Invalid file path provided');
    }

    const startTime = performance.now();
    logger.info(`${IMAGE_LOG_PREFIX} Starting image analysis for: ${cleanPath}`);

    try {
      return await withProcessingState({
        filePath,
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

          const result = await analyzeImageFile(filePath, folderCategories);
          const duration = performance.now() - startTime;

          await recordAnalysisResult({
            filePath,
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
        filePath,
        error
      });
      logger.error(`${IMAGE_LOG_PREFIX} Image analysis failed with context:`, errorContext);
      return createAnalysisFallback(filePath, 'images', error.message);
    }
  }

  const analyzeImageHandler =
    z && stringSchema
      ? withValidation(logger, stringSchema, (event, filePath) => performImageAnalysis(filePath))
      : withErrorLogging(logger, (event, filePath) => performImageAnalysis(filePath));

  safeHandle(ipcMain, IPC_CHANNELS.ANALYSIS.ANALYZE_IMAGE, analyzeImageHandler);

  async function runOcr(filePath) {
    const start = performance.now();
    const ocrResult = await recognizeIfAvailable(tesseract, filePath, {
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

  const extractImageTextHandler =
    z && stringSchema
      ? withValidation(logger, stringSchema, async (event, filePath) => {
          try {
            return await runOcr(filePath);
          } catch (error) {
            logger.error('OCR failed:', error);
            systemAnalytics.recordFailure(error);
            return { success: false, error: error.message };
          }
        })
      : withErrorLogging(logger, async (event, filePath) => {
          try {
            return await runOcr(filePath);
          } catch (error) {
            logger.error('OCR failed:', error);
            systemAnalytics.recordFailure(error);
            return { success: false, error: error.message };
          }
        });
  safeHandle(ipcMain, IPC_CHANNELS.ANALYSIS.EXTRACT_IMAGE_TEXT, extractImageTextHandler);
}

module.exports = registerAnalysisIpc;
