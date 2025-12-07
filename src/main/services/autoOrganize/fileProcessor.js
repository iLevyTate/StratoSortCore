/**
 * File Processor
 *
 * Individual file processing and new file monitoring.
 *
 * @module autoOrganize/fileProcessor
 */

const path = require('path');
const crypto = require('crypto');
const { logger } = require('../../../shared/logger');
const { sanitizeFile } = require('./fileTypeUtils');
const {
  createDefaultFolder,
  getFallbackDestination,
  buildDestinationPath,
} = require('./folderOperations');

logger.setContext('AutoOrganize-FileProcessor');

// Helper to generate secure random IDs
const generateSecureId = (prefix) =>
  `${prefix}-${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;

/**
 * Process files without analysis (use default folder)
 * @param {Array} files - Files without analysis
 * @param {Array} smartFolders - Smart folders
 * @param {string} defaultLocation - Default location
 * @param {Object} results - Results object to populate
 */
async function processFilesWithoutAnalysis(
  files,
  smartFolders,
  defaultLocation,
  results,
) {
  logger.info('[AutoOrganize] Processing files without analysis', {
    count: files.length,
  });

  // Find or create default folder once for all files
  let defaultFolder = smartFolders.find(
    (f) => f.isDefault || f.name.toLowerCase() === 'uncategorized',
  );

  if (!defaultFolder) {
    defaultFolder = await createDefaultFolder(smartFolders);

    if (!defaultFolder) {
      // Could not create default folder, mark all files as failed
      for (const file of files) {
        results.failed.push({
          file: sanitizeFile(file),
          reason: 'No analysis available and failed to create default folder',
        });
      }
      return;
    }
  }

  // Process all files without analysis in batch
  for (const file of files) {
    const destination = path.join(
      defaultFolder.path || `${defaultLocation}/${defaultFolder.name}`,
      file.name,
    );

    results.organized.push({
      file: sanitizeFile(file),
      destination,
      confidence: 0.1,
      method: 'no-analysis-default',
    });

    results.operations.push({
      type: 'move',
      source: file.path,
      destination,
    });
  }
}

/**
 * Process files individually as fallback
 * @param {Array} files - Files to process
 * @param {Array} smartFolders - Smart folders
 * @param {Object} options - Processing options
 * @param {Object} results - Results object to populate
 * @param {Object} suggestionService - Suggestion service
 * @param {Object} thresholds - Confidence thresholds
 */
async function processFilesIndividually(
  files,
  smartFolders,
  options,
  results,
  suggestionService,
  thresholds,
) {
  const { confidenceThreshold, defaultLocation, preserveNames } = options;

  for (const file of files) {
    try {
      // Get suggestion for the file
      let suggestion;
      try {
        suggestion = await suggestionService.getSuggestionsForFile(
          file,
          smartFolders,
          { includeAlternatives: false },
        );
      } catch (suggestionError) {
        logger.error('[AutoOrganize] Failed to get suggestion for file:', {
          file: file.name,
          error: suggestionError.message,
        });

        // Use fallback logic on suggestion failure
        const fallbackDestination = getFallbackDestination(
          file,
          smartFolders,
          defaultLocation,
        );

        results.organized.push({
          file: sanitizeFile(file),
          destination: fallbackDestination,
          confidence: 0.2,
          method: 'suggestion-error-fallback',
        });

        results.operations.push({
          type: 'move',
          source: file.path,
          destination: fallbackDestination,
        });
        continue;
      }

      if (!suggestion || !suggestion.success || !suggestion.primary) {
        // Use fallback logic
        const fallbackDestination = getFallbackDestination(
          file,
          smartFolders,
          defaultLocation,
        );

        results.organized.push({
          file: sanitizeFile(file),
          destination: fallbackDestination,
          confidence: 0.3,
          method: 'fallback',
        });

        results.operations.push({
          type: 'move',
          source: file.path,
          destination: fallbackDestination,
        });
        continue;
      }

      const { primary } = suggestion;
      const confidence = suggestion.confidence || 0;

      // Determine action based on confidence
      if (confidence >= confidenceThreshold) {
        // High confidence - organize automatically
        // Ensure primary suggestion folder/path are valid strings
        const safePrimary = {
          ...primary,
          folder:
            typeof primary.folder === 'string'
              ? primary.folder
              : primary.folder?.name || 'Uncategorized',
          path:
            typeof primary.path === 'string'
              ? primary.path
              : primary.path?.path || undefined,
        };
        const destination = buildDestinationPath(
          file,
          safePrimary,
          defaultLocation,
          preserveNames,
        );

        results.organized.push({
          file: sanitizeFile(file),
          suggestion: primary,
          destination,
          confidence,
          method: 'automatic',
        });

        results.operations.push({
          type: 'move',
          source: file.path,
          destination,
        });

        // Record feedback with proper error handling
        try {
          await suggestionService.recordFeedback(file, primary, true);
        } catch (feedbackError) {
          logger.warn(
            '[AutoOrganize] Failed to record feedback (non-critical):',
            {
              file: file.path,
              error: feedbackError.message,
            },
          );
        }
      } else if (confidence >= thresholds.requireReview) {
        // Medium confidence - needs review
        results.needsReview.push({
          file: sanitizeFile(file),
          suggestion: primary,
          alternatives: suggestion.alternatives,
          confidence,
          explanation: suggestion.explanation,
        });
      } else {
        // Low confidence - use fallback
        const fallbackDestination = getFallbackDestination(
          file,
          smartFolders,
          defaultLocation,
        );

        results.organized.push({
          file: sanitizeFile(file),
          destination: fallbackDestination,
          confidence,
          method: 'low-confidence-fallback',
        });

        results.operations.push({
          type: 'move',
          source: file.path,
          destination: fallbackDestination,
        });
      }
    } catch (error) {
      const fileErrorDetails = {
        fileName: file.name,
        filePath: file.path,
        fileSize: file.size,
        batchId: generateSecureId('organize'),
        timestamp: new Date().toISOString(),
        error: error.message,
        errorStack: error.stack,
      };

      logger.error('[AutoOrganize] Failed to process file:', fileErrorDetails);

      results.failed.push({
        file: sanitizeFile(file),
        reason: error.message,
        filePath: file.path,
        timestamp: fileErrorDetails.timestamp,
        batchId: fileErrorDetails.batchId,
      });
    }
  }
}

/**
 * Process a new file for auto-organization
 * @param {string} filePath - File path
 * @param {Array} smartFolders - Smart folders
 * @param {Object} options - Options
 * @param {Object} suggestionService - Suggestion service
 * @param {Object} undoRedo - Undo/redo service
 * @returns {Promise<Object|null>} Organization result or null
 */
async function processNewFile(
  filePath,
  smartFolders,
  options,
  suggestionService,
  undoRedo,
) {
  const {
    autoOrganizeEnabled = false,
    confidenceThreshold = 0.9, // Higher threshold for automatic processing
  } = options;

  if (!autoOrganizeEnabled) {
    logger.info(
      '[AutoOrganize] Auto-organize disabled, skipping file:',
      filePath,
    );
    return null;
  }

  try {
    // Analyze the file first
    const {
      analyzeDocumentFile,
      analyzeImageFile,
    } = require('../../analysis/ollamaDocumentAnalysis');
    const extension = path.extname(filePath).toLowerCase();

    let analysis;
    if (['.jpg', '.jpeg', '.png', '.gif', '.bmp'].includes(extension)) {
      analysis = await analyzeImageFile(filePath, smartFolders);
    } else {
      analysis = await analyzeDocumentFile(filePath, smartFolders);
    }

    if (!analysis || analysis.error) {
      logger.warn('[AutoOrganize] Could not analyze file:', filePath);
      return null;
    }

    // Create file object
    const file = {
      name: path.basename(filePath),
      path: filePath,
      extension,
      analysis,
    };

    // Get suggestion
    const suggestion = await suggestionService.getSuggestionsForFile(
      file,
      smartFolders,
      { includeAlternatives: false },
    );

    // Only auto-organize if confidence is very high
    if (
      suggestion.success &&
      suggestion.primary &&
      suggestion.confidence >= confidenceThreshold
    ) {
      // Ensure primary suggestion folder/path are valid strings
      const primary = suggestion.primary;
      const safePrimary = {
        ...primary,
        folder:
          typeof primary.folder === 'string'
            ? primary.folder
            : primary.folder?.name || 'Uncategorized',
        path:
          typeof primary.path === 'string'
            ? primary.path
            : primary.path?.path || undefined,
      };
      const destination = buildDestinationPath(
        file,
        safePrimary,
        options.defaultLocation || 'Documents',
        false,
      );

      logger.info('[AutoOrganize] Auto-organizing new file', {
        file: filePath,
        destination,
        confidence: suggestion.confidence,
      });

      // Record the action for undo
      const action = {
        type: 'FILE_MOVE',
        data: {
          originalPath: filePath,
          newPath: destination,
        },
        timestamp: Date.now(),
        description: `Auto-organized ${file.name}`,
      };

      if (undoRedo) {
        await undoRedo.recordAction(action);
      }

      return {
        source: filePath,
        destination,
        confidence: suggestion.confidence,
        suggestion: suggestion.primary,
      };
    }

    logger.info(
      '[AutoOrganize] File confidence too low for auto-organization',
      {
        file: filePath,
        confidence: suggestion.confidence || 0,
        threshold: confidenceThreshold,
      },
    );

    return null;
  } catch (error) {
    logger.error('[AutoOrganize] Error processing new file:', {
      file: filePath,
      error: error.message,
    });
    return null;
  }
}

module.exports = {
  generateSecureId,
  processFilesWithoutAnalysis,
  processFilesIndividually,
  processNewFile,
};
