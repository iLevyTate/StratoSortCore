/**
 * Analysis Handler Utilities
 *
 * Shared utilities for analysis IPC handlers to reduce duplication.
 * Provides wrappers for processing state lifecycle, history recording,
 * error context building, and fallback responses.
 *
 * @module ipc/analysisUtils
 */

const path = require('path');
const fs = require('fs').promises;
const {
  normalizeError,
  normalizeText,
  normalizeOptionalText,
  normalizeKeywords
} = require('../../shared/normalization');

/**
 * Wrapper for processing state lifecycle management.
 * Handles markAnalysisStart, markAnalysisComplete/markAnalysisError, and cleanup.
 *
 * @param {Object} options - Options
 * @param {string} options.filePath - File being analyzed
 * @param {Object} options.processingState - Processing state service (optional)
 * @param {Object} options.logger - Logger instance
 * @param {string} options.logPrefix - Prefix for log messages (e.g., '[IPC-ANALYSIS]')
 * @param {Function} options.fn - The analysis function to execute
 * @returns {Promise<*>} Result from the analysis function
 */
async function withProcessingState({ filePath, processingState, logger, logPrefix, fn }) {
  let analysisStarted = false;
  // CRITICAL FIX: Track whether we've already handled state transition to prevent race condition
  let stateHandled = false;

  try {
    // Mark analysis start
    if (processingState) {
      try {
        await processingState.markAnalysisStart(filePath);
        analysisStarted = true;
      } catch (stateError) {
        logger.warn(`${logPrefix} Failed to mark analysis start:`, stateError.message);
      }
    }

    // Execute the analysis
    const result = await fn();

    // Mark analysis complete on success
    if (processingState) {
      try {
        await processingState.markAnalysisComplete?.(filePath);
        stateHandled = true; // Mark state as handled to prevent cleanup race
      } catch (completeError) {
        logger.debug(`${logPrefix} Failed to mark analysis complete:`, completeError.message);
      }
    }

    return result;
  } catch (error) {
    // Mark analysis error
    if (processingState) {
      try {
        await processingState.markAnalysisError(filePath, error.message);
        stateHandled = true; // Mark state as handled to prevent cleanup race
      } catch (stateError) {
        logger.warn(`${logPrefix} Failed to mark analysis error:`, {
          filePath,
          error: stateError.message
        });
      }
    }
    throw error;
  } finally {
    // CRITICAL FIX: Only cleanup if state was NOT already handled by success/error paths
    // This prevents the race condition where cleanup runs after markAnalysisComplete
    if (analysisStarted && processingState && !stateHandled) {
      try {
        const currentState = processingState.getState?.(filePath);
        if (currentState === 'in_progress') {
          await processingState.clearState?.(filePath);
          logger.debug(`${logPrefix} Cleaned up orphaned processing state for:`, filePath);
        }
      } catch (cleanupError) {
        logger.warn(`${logPrefix} Failed to cleanup processing state:`, cleanupError.message);
      }
    }
  }
}

/**
 * Build standardized error context for logging.
 *
 * @param {Object} options - Options
 * @param {string} options.operation - Operation name (e.g., 'document-analysis')
 * @param {string} options.filePath - File path
 * @param {Error} options.error - The error object
 * @returns {Object} Error context for logging
 */
function buildErrorContext({ operation, filePath, error }) {
  return {
    operation,
    filePath,
    fileName: path.basename(filePath),
    fileExtension: path.extname(filePath),
    timestamp: new Date().toISOString(),
    error: error.message,
    errorStack: error.stack,
    errorCode: error.code
  };
}

/**
 * Create a standardized fallback response for failed analysis.
 * FIX: Enhanced with error context for better debugging and retry logic
 *
 * @param {string} filePath - File path
 * @param {string} category - Default category ('documents' or 'images')
 * @param {string} errorMessage - Error message
 * @param {Object} errorContext - Additional error context (optional)
 * @param {string} errorContext.errorType - Type of error (e.g., 'NETWORK', 'TIMEOUT', 'MODEL_NOT_FOUND')
 * @param {boolean} errorContext.isRetryable - Whether the error is retryable
 * @param {string} errorContext.code - Error code if available
 * @returns {Object} Fallback analysis result with error context
 */
function createAnalysisFallback(filePath, category, errorMessage, errorContext = {}) {
  const normalized = normalizeError(
    { message: errorMessage, code: errorContext.code },
    {
      errorType: errorContext.errorType,
      isRetryable: errorContext.isRetryable
    }
  );

  return {
    error: normalized.message,
    errorType: normalized.errorType,
    isRetryable: normalized.isRetryable,
    errorCode: normalized.code,
    suggestedName: path.basename(filePath), // Keep extension to prevent unopenable files
    category,
    keywords: [],
    confidence: 0
  };
}

/**
 * Normalize analysis result and record to history.
 *
 * @param {Object} options - Options
 * @param {string} options.filePath - File path
 * @param {Object} options.result - Raw analysis result
 * @param {number} options.processingTime - Processing time in ms
 * @param {string} options.modelType - Model type ('llm' or 'vision')
 * @param {Object} options.analysisHistory - Analysis history service (optional)
 * @param {Object} options.logger - Logger instance
 * @returns {Promise<void>}
 */
async function recordAnalysisResult({
  filePath,
  result,
  processingTime,
  modelType,
  analysisHistory,
  logger
}) {
  if (!analysisHistory) return;

  try {
    const stats = await fs.stat(filePath);
    const fileInfo = {
      path: filePath,
      size: stats.size,
      lastModified: stats.mtimeMs,
      mimeType: null
    };

    // FIX: Capture comprehensive data for document/image conversations
    // Include all LLM-extracted fields for richer context in chat/queries
    const normalized = {
      subject: normalizeText(result.subject || result.suggestedName || path.basename(filePath), {
        maxLength: 255
      }),
      category: normalizeText(result.category || 'uncategorized', { maxLength: 100 }),
      tags: normalizeKeywords(Array.isArray(result.keywords) ? result.keywords : []),
      confidence: typeof result.confidence === 'number' ? result.confidence : 0,
      // Combine purpose and summary for comprehensive context
      summary: normalizeOptionalText(result.summary || result.purpose || result.description || '', {
        maxLength: 2000
      }),
      // Store full extracted text for conversation context (increased limit)
      extractedText: normalizeOptionalText(result.extractedText || '', { maxLength: 50000 }),
      model: normalizeText(result.model || modelType, { maxLength: 100 }),
      processingTime,
      smartFolder: normalizeOptionalText(result.smartFolder || null, { maxLength: 255 }),
      newName: normalizeOptionalText(result.suggestedName || null, { maxLength: 255 }),
      renamed: Boolean(result.suggestedName),
      // Additional fields for richer document/image context
      documentType: normalizeOptionalText(result.documentType || result.type || null, {
        maxLength: 100
      }),
      entity: normalizeOptionalText(result.entity || null, { maxLength: 255 }),
      project: normalizeOptionalText(result.project || null, { maxLength: 255 }),
      purpose: normalizeOptionalText(result.purpose || null, { maxLength: 1000 }),
      reasoning: normalizeOptionalText(result.reasoning || null, { maxLength: 500 }),
      documentDate: normalizeOptionalText(result.documentDate || result.date || null, {
        maxLength: 50
      }),
      // Key entities for conversation (people, organizations, dates mentioned)
      keyEntities: Array.isArray(result.keyEntities)
        ? result.keyEntities.slice(0, 20).map((e) => normalizeText(e, { maxLength: 100 }))
        : [],
      // Store extraction method for debugging
      extractionMethod: normalizeOptionalText(result.extractionMethod || null, { maxLength: 50 }),
      // Image-specific fields
      content_type: normalizeOptionalText(result.content_type || null, { maxLength: 100 }),
      has_text: typeof result.has_text === 'boolean' ? result.has_text : null,
      colors: Array.isArray(result.colors) ? result.colors.slice(0, 10) : null
    };

    await analysisHistory.recordAnalysis(fileInfo, normalized);
  } catch (historyError) {
    logger.warn('[ANALYSIS-HISTORY] Failed to record analysis:', historyError.message);
  }
}

/**
 * Get folder categories from custom folders function.
 *
 * @param {Function} getCustomFolders - Function to get custom folders
 * @param {Function} mapFoldersToCategories - Function to map folders to categories
 * @param {Object} logger - Logger instance
 * @returns {Array} Folder categories
 */
function getFolderCategories(getCustomFolders, mapFoldersToCategories, logger) {
  let folders = [];
  try {
    folders = typeof getCustomFolders === 'function' ? getCustomFolders() : [];
  } catch (folderError) {
    logger.warn('[ANALYSIS] Failed to get custom folders:', folderError.message);
  }
  return mapFoldersToCategories(folders);
}

module.exports = {
  withProcessingState,
  buildErrorContext,
  createAnalysisFallback,
  recordAnalysisResult,
  getFolderCategories
};
