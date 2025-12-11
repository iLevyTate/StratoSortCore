const path = require('path');
const { performance } = require('perf_hooks');
const { withErrorLogging, withValidation } = require('./ipcWrappers');
const { safeFilePath } = require('../utils/safeAccess');
const { mapFoldersToCategories, getFolderNamesString } = require('../../shared/folderUtils');
const { logger: moduleLogger } = require('../../shared/logger');
let z;
try {
  z = require('zod');
} catch (error) {
  // Zod is optional - validation will fall back to manual checks
  // Log at debug level for troubleshooting module loading issues
  moduleLogger.debug('[IPC-ANALYSIS] Zod not available:', error.message);
  z = null;
}

function registerAnalysisIpc({
  ipcMain,
  IPC_CHANNELS,
  logger,
  tesseract,
  systemAnalytics,
  analyzeDocumentFile,
  analyzeImageFile,
  getServiceIntegration,
  getCustomFolders
}) {
  const stringSchema = z ? z.string().min(1) : null;
  const analyzeDocumentHandler =
    z && stringSchema
      ? withValidation(logger, stringSchema, async (event, filePath) => {
          const serviceIntegration = getServiceIntegration && getServiceIntegration();
          let analysisStarted = false;
          let cleanPath = null;

          try {
            // Validate file path
            cleanPath = safeFilePath(filePath);
            if (!cleanPath) {
              throw new Error('Invalid file path provided');
            }

            const startTime = performance.now();
            logger.info(`[IPC-ANALYSIS] Starting document analysis for: ${cleanPath}`);

            // RESOURCE FIX #8: Mark analysis start and track with flag for cleanup
            try {
              await serviceIntegration?.processingState?.markAnalysisStart(filePath);
              analysisStarted = true;
            } catch (stateError) {
              // Non-fatal if processing state fails to update, but log it
              logger.warn('[IPC-ANALYSIS] Failed to mark analysis start:', stateError.message);
            }
            // HIGH FIX: Wrap getCustomFolders in try-catch to handle potential errors
            let folders = [];
            try {
              folders = typeof getCustomFolders === 'function' ? getCustomFolders() : [];
            } catch (folderError) {
              logger.warn('[IPC-ANALYSIS] Failed to get custom folders:', folderError.message);
            }
            const folderCategories = mapFoldersToCategories(folders);
            logger.info(
              `[IPC-ANALYSIS] Using ${folderCategories.length} smart folders for context:`,
              getFolderNamesString(folderCategories)
            );
            const result = await analyzeDocumentFile(filePath, folderCategories);
            const duration = performance.now() - startTime;
            systemAnalytics.recordProcessingTime(duration);
            try {
              const stats = await require('fs').promises.stat(filePath);
              const fileInfo = {
                path: filePath,
                size: stats.size,
                lastModified: stats.mtimeMs,
                mimeType: null
              };
              const normalized = {
                subject: result.suggestedName || path.basename(filePath),
                category: result.category || 'uncategorized',
                tags: Array.isArray(result.keywords) ? result.keywords : [],
                confidence: typeof result.confidence === 'number' ? result.confidence : 0,
                summary: result.purpose || result.summary || '',
                extractedText: result.extractedText || null,
                model: result.model || 'llm',
                processingTime: duration,
                smartFolder: result.smartFolder || null,
                newName: result.suggestedName || null,
                renamed: Boolean(result.suggestedName)
              };
              await serviceIntegration?.analysisHistory?.recordAnalysis(fileInfo, normalized);
            } catch (historyError) {
              logger.warn(
                '[ANALYSIS-HISTORY] Failed to record document analysis:',
                historyError.message
              );
            }

            // FIX: Mark analysis complete on success (not just cleanup analyzing state)
            try {
              await serviceIntegration?.processingState?.markAnalysisComplete?.(filePath);
            } catch (completeError) {
              logger.debug(
                '[IPC-ANALYSIS] Failed to mark analysis complete:',
                completeError.message
              );
            }

            return result;
          } catch (error) {
            // ERROR CONTEXT FIX #11: Enhanced error logging with full context
            const errorContext = {
              operation: 'document-analysis',
              filePath: filePath,
              fileName: path.basename(filePath),
              fileExtension: path.extname(filePath),
              timestamp: new Date().toISOString(),
              error: error.message,
              errorStack: error.stack,
              errorCode: error.code
            };

            logger.error('[IPC-ANALYSIS] Document analysis failed with context:', errorContext);
            systemAnalytics.recordFailure(error);

            // RESOURCE FIX #8: Mark error in processing state
            const serviceIntegration = getServiceIntegration && getServiceIntegration();
            try {
              await serviceIntegration?.processingState?.markAnalysisError(filePath, error.message);
            } catch (stateError) {
              // Non-fatal if processing state fails to update
              logger.warn('[IPC-ANALYSIS] Failed to mark analysis error:', {
                filePath,
                error: stateError.message
              });
            }
            return {
              error: error.message,
              suggestedName: path.basename(filePath), // Keep extension to prevent unopenable files
              category: 'documents',
              keywords: [],
              confidence: 0
            };
          } finally {
            // RESOURCE FIX #8: Guaranteed cleanup in finally block
            // Ensure processing state is cleaned up even if error handling fails
            if (analysisStarted && cleanPath) {
              try {
                const serviceIntegration = getServiceIntegration && getServiceIntegration();
                // Only clean up if the state exists and wasn't already marked as error/complete
                const currentState = serviceIntegration?.processingState?.getState?.(filePath);
                if (currentState === 'in_progress') {
                  // State is still analyzing, clean it up
                  await serviceIntegration?.processingState?.clearState?.(filePath);
                  logger.debug('[IPC-ANALYSIS] Cleaned up processing state for:', filePath);
                }
              } catch (cleanupError) {
                // Log but don't throw - cleanup is best-effort
                logger.warn(
                  '[IPC-ANALYSIS] Failed to cleanup processing state:',
                  cleanupError.message
                );
              }
            }
          }
        })
      : withErrorLogging(logger, async (event, filePath) => {
          try {
            const startTime = performance.now();
            logger.info(`[IPC-ANALYSIS] Starting document analysis for: ${filePath}`);
            const serviceIntegration = getServiceIntegration && getServiceIntegration();
            try {
              await serviceIntegration?.processingState?.markAnalysisStart(filePath);
            } catch {
              // Non-fatal if processing state fails to update
            }
            // Add null check for getCustomFolders
            const folders = typeof getCustomFolders === 'function' ? getCustomFolders() : [];
            const folderCategories = mapFoldersToCategories(folders);
            logger.info(
              `[IPC-ANALYSIS] Using ${folderCategories.length} smart folders for context:`,
              getFolderNamesString(folderCategories)
            );
            const result = await analyzeDocumentFile(filePath, folderCategories);
            const duration = performance.now() - startTime;
            systemAnalytics.recordProcessingTime(duration);
            try {
              const stats = await require('fs').promises.stat(filePath);
              const fileInfo = {
                path: filePath,
                size: stats.size,
                lastModified: stats.mtimeMs,
                mimeType: null
              };
              const normalized = {
                subject: result.suggestedName || path.basename(filePath),
                category: result.category || 'uncategorized',
                tags: Array.isArray(result.keywords) ? result.keywords : [],
                confidence: typeof result.confidence === 'number' ? result.confidence : 0,
                summary: result.purpose || result.summary || '',
                extractedText: result.extractedText || null,
                model: result.model || 'llm',
                processingTime: duration,
                smartFolder: result.smartFolder || null,
                newName: result.suggestedName || null,
                renamed: Boolean(result.suggestedName)
              };
              await serviceIntegration?.analysisHistory?.recordAnalysis(fileInfo, normalized);
            } catch (historyError) {
              logger.warn(
                '[ANALYSIS-HISTORY] Failed to record document analysis:',
                historyError.message
              );
            }

            return result;
          } catch (error) {
            logger.error(`[IPC] Document analysis failed for ${filePath}:`, error);
            systemAnalytics.recordFailure(error);
            const serviceIntegration = getServiceIntegration && getServiceIntegration();
            try {
              await serviceIntegration?.processingState?.markAnalysisError(filePath, error.message);
            } catch {
              // Non-fatal if processing state fails to update
            }
            return {
              error: error.message,
              suggestedName: path.basename(filePath), // Keep extension to prevent unopenable files
              category: 'documents',
              keywords: [],
              confidence: 0
            };
          }
        });
  ipcMain.handle(IPC_CHANNELS.ANALYSIS.ANALYZE_DOCUMENT, analyzeDocumentHandler);

  const analyzeImageHandler =
    z && stringSchema
      ? withValidation(logger, stringSchema, async (event, filePath) => {
          let analysisStarted = false;
          let cleanPath = null;

          try {
            cleanPath = safeFilePath(filePath);
            logger.info(`[IPC] Starting image analysis for: ${cleanPath}`);

            // RESOURCE FIX #8: Mark analysis start and track with flag for cleanup
            const serviceIntegration = getServiceIntegration && getServiceIntegration();
            try {
              await serviceIntegration?.processingState?.markAnalysisStart(filePath);
              analysisStarted = true;
            } catch (stateError) {
              // Non-fatal if processing state fails to update, but log it
              logger.warn(
                '[IPC-IMAGE-ANALYSIS] Failed to mark analysis start:',
                stateError.message
              );
            }
            // Add null check for getCustomFolders
            const folders = typeof getCustomFolders === 'function' ? getCustomFolders() : [];
            const folderCategories = mapFoldersToCategories(folders);
            logger.info(
              `[IPC-IMAGE-ANALYSIS] Using ${folderCategories.length} smart folders for context:`,
              getFolderNamesString(folderCategories)
            );
            const result = await analyzeImageFile(filePath, folderCategories);
            try {
              const stats = await require('fs').promises.stat(filePath);
              const fileInfo = {
                path: filePath,
                size: stats.size,
                lastModified: stats.mtimeMs,
                mimeType: null
              };
              const normalized = {
                subject: result.suggestedName || path.basename(filePath),
                category: result.category || 'uncategorized',
                tags: Array.isArray(result.keywords) ? result.keywords : [],
                confidence: typeof result.confidence === 'number' ? result.confidence : 0,
                summary: result.purpose || result.summary || '',
                extractedText: result.extractedText || null,
                model: result.model || 'vision',
                processingTime: 0,
                smartFolder: result.smartFolder || null,
                newName: result.suggestedName || null,
                renamed: Boolean(result.suggestedName)
              };
              await serviceIntegration?.analysisHistory?.recordAnalysis(fileInfo, normalized);
            } catch (historyError) {
              logger.warn(
                '[ANALYSIS-HISTORY] Failed to record image analysis:',
                historyError.message
              );
            }

            // FIX: Mark analysis complete on success
            try {
              await serviceIntegration?.processingState?.markAnalysisComplete?.(filePath);
            } catch (completeError) {
              logger.debug(
                '[IPC-IMAGE-ANALYSIS] Failed to mark analysis complete:',
                completeError.message
              );
            }

            return result;
          } catch (error) {
            // ERROR CONTEXT FIX #11: Enhanced error logging with full context
            const errorContext = {
              operation: 'image-analysis',
              filePath: filePath,
              fileName: path.basename(filePath),
              fileExtension: path.extname(filePath),
              timestamp: new Date().toISOString(),
              error: error.message,
              errorStack: error.stack,
              errorCode: error.code
            };

            logger.error('[IPC-IMAGE-ANALYSIS] Image analysis failed with context:', errorContext);

            // RESOURCE FIX #8: Mark error in processing state
            const serviceIntegration = getServiceIntegration && getServiceIntegration();
            try {
              await serviceIntegration?.processingState?.markAnalysisError(filePath, error.message);
            } catch (stateError) {
              // Non-fatal if processing state fails to update
              logger.warn('[IPC-IMAGE-ANALYSIS] Failed to mark analysis error:', {
                filePath,
                error: stateError.message
              });
            }
            return {
              error: error.message,
              suggestedName: path.basename(filePath), // Keep extension to prevent unopenable files
              category: 'images',
              keywords: [],
              confidence: 0
            };
          } finally {
            // RESOURCE FIX #8: Guaranteed cleanup in finally block
            // Ensure processing state is cleaned up even if error handling fails
            if (analysisStarted && cleanPath) {
              try {
                const serviceIntegration = getServiceIntegration && getServiceIntegration();
                // Only clean up if the state exists and wasn't already marked as error/complete
                const currentState = serviceIntegration?.processingState?.getState?.(filePath);
                if (currentState === 'in_progress') {
                  // State is still analyzing, clean it up
                  await serviceIntegration?.processingState?.clearState?.(filePath);
                  logger.debug('[IPC-IMAGE-ANALYSIS] Cleaned up processing state for:', filePath);
                }
              } catch (cleanupError) {
                // Log but don't throw - cleanup is best-effort
                logger.warn(
                  '[IPC-IMAGE-ANALYSIS] Failed to cleanup processing state:',
                  cleanupError.message
                );
              }
            }
          }
        })
      : withErrorLogging(logger, async (event, filePath) => {
          let analysisStarted = false;

          try {
            logger.info(`[IPC] Starting image analysis for: ${filePath}`);

            // RESOURCE FIX #8: Mark analysis start and track with flag for cleanup
            const serviceIntegration = getServiceIntegration && getServiceIntegration();
            try {
              await serviceIntegration?.processingState?.markAnalysisStart(filePath);
              analysisStarted = true;
            } catch (stateError) {
              // Non-fatal if processing state fails to update, but log it
              logger.warn(
                '[IPC-IMAGE-ANALYSIS] Failed to mark analysis start:',
                stateError.message
              );
            }
            // Add null check for getCustomFolders
            const folders = typeof getCustomFolders === 'function' ? getCustomFolders() : [];
            const folderCategories = mapFoldersToCategories(folders);
            logger.info(
              `[IPC-IMAGE-ANALYSIS] Using ${folderCategories.length} smart folders for context:`,
              getFolderNamesString(folderCategories)
            );
            const result = await analyzeImageFile(filePath, folderCategories);
            try {
              const stats = await require('fs').promises.stat(filePath);
              const fileInfo = {
                path: filePath,
                size: stats.size,
                lastModified: stats.mtimeMs,
                mimeType: null
              };
              const normalized = {
                subject: result.suggestedName || path.basename(filePath),
                category: result.category || 'uncategorized',
                tags: Array.isArray(result.keywords) ? result.keywords : [],
                confidence: typeof result.confidence === 'number' ? result.confidence : 0,
                summary: result.purpose || result.summary || '',
                extractedText: result.extractedText || null,
                model: result.model || 'vision',
                processingTime: 0,
                smartFolder: result.smartFolder || null,
                newName: result.suggestedName || null,
                renamed: Boolean(result.suggestedName)
              };
              await serviceIntegration?.analysisHistory?.recordAnalysis(fileInfo, normalized);
            } catch (historyError) {
              logger.warn(
                '[ANALYSIS-HISTORY] Failed to record image analysis:',
                historyError.message
              );
            }

            return result;
          } catch (error) {
            // ERROR CONTEXT FIX #11: Enhanced error logging with full context
            const errorContext = {
              operation: 'image-analysis',
              filePath: filePath,
              fileName: path.basename(filePath),
              fileExtension: path.extname(filePath),
              timestamp: new Date().toISOString(),
              error: error.message,
              errorStack: error.stack,
              errorCode: error.code
            };

            logger.error('[IPC-IMAGE-ANALYSIS] Image analysis failed with context:', errorContext);

            // RESOURCE FIX #8: Mark error in processing state
            const serviceIntegration = getServiceIntegration && getServiceIntegration();
            try {
              await serviceIntegration?.processingState?.markAnalysisError(filePath, error.message);
            } catch (stateError) {
              // Non-fatal if processing state fails to update
              logger.warn('[IPC-IMAGE-ANALYSIS] Failed to mark analysis error:', {
                filePath,
                error: stateError.message
              });
            }
            return {
              error: error.message,
              suggestedName: path.basename(filePath), // Keep extension to prevent unopenable files
              category: 'images',
              keywords: [],
              confidence: 0
            };
          } finally {
            // RESOURCE FIX #8: Guaranteed cleanup in finally block
            // Ensure processing state is cleaned up even if error handling fails
            if (analysisStarted) {
              try {
                const serviceIntegration = getServiceIntegration && getServiceIntegration();
                // Only clean up if the state exists and wasn't already marked as error/complete
                const currentState = serviceIntegration?.processingState?.getState?.(filePath);
                if (currentState === 'in_progress') {
                  // State is still analyzing, clean it up
                  await serviceIntegration?.processingState?.clearState?.(filePath);
                  logger.debug('[IPC-IMAGE-ANALYSIS] Cleaned up processing state for:', filePath);
                }
              } catch (cleanupError) {
                // Log but don't throw - cleanup is best-effort
                logger.warn(
                  '[IPC-IMAGE-ANALYSIS] Failed to cleanup processing state:',
                  cleanupError.message
                );
              }
            }
          }
        });
  ipcMain.handle(IPC_CHANNELS.ANALYSIS.ANALYZE_IMAGE, analyzeImageHandler);

  const extractImageTextHandler =
    z && stringSchema
      ? withValidation(logger, stringSchema, async (event, filePath) => {
          try {
            const start = performance.now();
            const text = await tesseract.recognize(filePath, {
              lang: 'eng',
              oem: 1,
              psm: 3
            });
            const duration = performance.now() - start;
            systemAnalytics.recordProcessingTime(duration);
            return { success: true, text };
          } catch (error) {
            logger.error('OCR failed:', error);
            systemAnalytics.recordFailure(error);
            return { success: false, error: error.message };
          }
        })
      : withErrorLogging(logger, async (event, filePath) => {
          try {
            const start = performance.now();
            const text = await tesseract.recognize(filePath, {
              lang: 'eng',
              oem: 1,
              psm: 3
            });
            const duration = performance.now() - start;
            systemAnalytics.recordProcessingTime(duration);
            return { success: true, text };
          } catch (error) {
            logger.error('OCR failed:', error);
            systemAnalytics.recordFailure(error);
            return { success: false, error: error.message };
          }
        });
  ipcMain.handle(IPC_CHANNELS.ANALYSIS.EXTRACT_IMAGE_TEXT, extractImageTextHandler);
}

module.exports = registerAnalysisIpc;
