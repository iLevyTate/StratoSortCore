/**
 * File Processor
 *
 * Individual file processing and new file monitoring.
 *
 * @module autoOrganize/fileProcessor
 */

const path = require('path');
const fs = require('fs').promises;
const { logger } = require('../../../shared/logger');
const { sanitizeFile } = require('./fileTypeUtils');
const { generateSuggestedNameFromAnalysis } = require('./namingUtils');
const {
  findDefaultFolder,
  createDefaultFolder,
  getFallbackDestination,
  buildDestinationPath
} = require('./folderOperations');
const { safeSuggestion } = require('./pathUtils');
// FIX C-5: Import from shared idUtils to break circular dependency with batchProcessor
const { generateSecureId } = require('./idUtils');

logger.setContext('AutoOrganize-FileProcessor');

/**
 * Process files without analysis (use default folder)
 * @param {Array} files - Files without analysis
 * @param {Array} smartFolders - Smart folders
 * @param {string} defaultLocation - Default location
 * @param {Object} results - Results object to populate
 */
async function processFilesWithoutAnalysis(files, smartFolders, defaultLocation, results) {
  logger.info('[AutoOrganize] Processing files without analysis', {
    count: files.length
  });

  // Find or create default folder once for all files
  let defaultFolder = findDefaultFolder(smartFolders);

  if (!defaultFolder) {
    defaultFolder = await createDefaultFolder(smartFolders);

    if (!defaultFolder) {
      // Could not create default folder, mark all files as failed
      for (const file of files) {
        results.failed.push({
          file: sanitizeFile(file),
          reason: 'No analysis available and failed to create default folder'
        });
      }
      return;
    }
  }

  // Process all files without analysis in batch
  for (const file of files) {
    const destination = path.join(
      defaultFolder.path || `${defaultLocation}/${defaultFolder.name}`,
      file.name
    );

    results.organized.push({
      file: sanitizeFile(file),
      destination,
      confidence: 0.1,
      method: 'no-analysis-default'
    });

    results.operations.push({
      type: 'move',
      source: file.path,
      destination
    });
  }
}

/**
 * Process files individually as fallback
 * @param {Array} files - Files to process
 * @param {Array} smartFolders - Smart folders
 * @param {Object} options - Processing options (includes confidenceThreshold)
 * @param {Object} results - Results object to populate
 * @param {Object} suggestionService - Suggestion service
 */
async function processFilesIndividually(files, smartFolders, options, results, suggestionService) {
  const { confidenceThreshold, defaultLocation, preserveNames } = options;

  for (const file of files) {
    try {
      // Get suggestion for the file
      let suggestion;
      try {
        suggestion = await suggestionService.getSuggestionsForFile(file, smartFolders, {
          includeAlternatives: false
        });
      } catch (suggestionError) {
        logger.error('[AutoOrganize] Failed to get suggestion for file:', {
          file: file.name,
          error: suggestionError.message
        });

        // Use fallback logic on suggestion failure
        const fallbackDestination = getFallbackDestination(file, smartFolders, defaultLocation);

        results.organized.push({
          file: sanitizeFile(file),
          destination: fallbackDestination,
          confidence: 0.2,
          method: 'suggestion-error-fallback'
        });

        results.operations.push({
          type: 'move',
          source: file.path,
          destination: fallbackDestination
        });
        continue;
      }

      if (!suggestion || !suggestion.success || !suggestion.primary) {
        // Use fallback logic
        const fallbackDestination = getFallbackDestination(file, smartFolders, defaultLocation);

        results.organized.push({
          file: sanitizeFile(file),
          destination: fallbackDestination,
          confidence: 0.3,
          method: 'fallback'
        });

        results.operations.push({
          type: 'move',
          source: file.path,
          destination: fallbackDestination
        });
        continue;
      }

      const { primary } = suggestion;
      const confidence = suggestion.confidence || 0;

      // Determine action based on confidence
      if (confidence >= confidenceThreshold) {
        // High confidence - organize automatically
        // Ensure primary suggestion folder/path are valid strings
        const safePrimary = safeSuggestion(primary);
        const destination = buildDestinationPath(file, safePrimary, defaultLocation, preserveNames);

        results.organized.push({
          file: sanitizeFile(file),
          suggestion: primary,
          destination,
          confidence,
          method: 'automatic'
        });

        results.operations.push({
          type: 'move',
          source: file.path,
          destination
        });

        // Record feedback with proper error handling
        try {
          await suggestionService.recordFeedback(file, primary, true);
        } catch (feedbackError) {
          logger.warn('[AutoOrganize] Failed to record feedback (non-critical):', {
            file: file.path,
            error: feedbackError.message
          });
        }
      } else {
        // Below threshold - needs user review
        results.needsReview.push({
          file: sanitizeFile(file),
          suggestion: primary,
          alternatives: suggestion.alternatives,
          confidence,
          explanation: suggestion.explanation
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
        errorStack: error.stack
      };

      logger.error('[AutoOrganize] Failed to process file:', fileErrorDetails);

      results.failed.push({
        file: sanitizeFile(file),
        reason: error.message,
        filePath: file.path,
        timestamp: fileErrorDetails.timestamp,
        batchId: fileErrorDetails.batchId
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
async function processNewFile(filePath, smartFolders, options, suggestionService, undoRedo) {
  const {
    autoOrganizeEnabled = false,
    // FIX: Use same default as settings (0.75) for consistency - actual value comes from options
    confidenceThreshold = 0.75
  } = options;

  if (!autoOrganizeEnabled) {
    logger.info('[AutoOrganize] Auto-organize disabled, skipping file:', filePath);
    return null;
  }

  try {
    // Analyze the file first
    const { analyzeDocumentFile } = require('../../analysis/ollamaDocumentAnalysis');
    const { analyzeImageFile } = require('../../analysis/ollamaImageAnalysis');
    const extension = path.extname(filePath).toLowerCase();

    let analysis;
    // Supported image extensions (includes modern formats)
    const imageExtensions = [
      '.jpg',
      '.jpeg',
      '.png',
      '.gif',
      '.bmp',
      '.webp',
      '.tiff',
      '.tif',
      '.svg',
      '.heic',
      '.heif',
      '.avif'
    ];
    if (imageExtensions.includes(extension)) {
      analysis = await analyzeImageFile(filePath, smartFolders);
    } else {
      analysis = await analyzeDocumentFile(filePath, smartFolders);
    }

    if (!analysis || analysis.error) {
      logger.warn('[AutoOrganize] Could not analyze file:', filePath);
      return null;
    }

    // FIX H-4: Re-verify file still exists after analysis (could be deleted during analysis)
    try {
      await fs.access(filePath);
    } catch (accessError) {
      if (accessError.code === 'ENOENT') {
        logger.warn('[AutoOrganize] File no longer exists after analysis:', filePath);
        return null;
      }
      throw accessError;
    }

    // Create file object
    const file = {
      name: path.basename(filePath),
      path: filePath,
      extension,
      analysis
    };

    // Apply naming convention if settings are provided
    if (options.namingSettings) {
      try {
        const stats = await fs.stat(filePath);
        const fileTimestamps = {
          created: stats.birthtime,
          modified: stats.mtime
        };

        const suggestedName = generateSuggestedNameFromAnalysis({
          originalFileName: file.name,
          analysis,
          settings: options.namingSettings,
          fileTimestamps
        });

        if (suggestedName) {
          analysis.suggestedName = suggestedName;
          logger.debug('[AutoOrganize] Applied naming convention:', suggestedName);
        }
      } catch (namingError) {
        logger.warn('[AutoOrganize] Failed to apply naming convention:', namingError.message);
      }
    }

    // Get suggestion
    const suggestion = await suggestionService.getSuggestionsForFile(file, smartFolders, {
      includeAlternatives: false
    });

    // Only auto-organize if confidence is very high
    if (suggestion.success && suggestion.primary && suggestion.confidence >= confidenceThreshold) {
      // Ensure primary suggestion folder/path are valid strings
      const { primary } = suggestion;

      // FIX: Check if we can resolve to an existing smart folder by name
      // This handles cases where strategies generate a path/name that matches a smart folder
      // but the strategy logic failed to link them (e.g. slight path mismatch)
      const safePrimary = safeSuggestion(primary);
      let resolvedPath = safePrimary.path;
      let resolvedFolder = safePrimary.folder;

      const matchingSmartFolder = smartFolders.find(
        (f) =>
          (f.name && f.name.toLowerCase() === resolvedFolder.toLowerCase()) ||
          (f.path && resolvedPath && f.path.toLowerCase() === resolvedPath.toLowerCase())
      );

      if (matchingSmartFolder) {
        logger.debug('[AutoOrganize] Resolved suggestion to existing smart folder:', {
          suggestion: resolvedFolder,
          smartFolder: matchingSmartFolder.name,
          path: matchingSmartFolder.path
        });
        resolvedPath = matchingSmartFolder.path;
        resolvedFolder = matchingSmartFolder.name;
      }

      // Re-apply resolved values to safePrimary
      safePrimary.folder = resolvedFolder;
      safePrimary.path = resolvedPath;

      const destination = buildDestinationPath(
        file,
        safePrimary,
        options.defaultLocation || 'Documents',
        false
      );

      logger.info('[AutoOrganize] Auto-organizing new file', {
        file: filePath,
        destination,
        confidence: suggestion.confidence
      });

      // Record the action for undo
      const action = {
        type: 'FILE_MOVE',
        data: {
          originalPath: filePath,
          newPath: destination
        },
        timestamp: Date.now(),
        description: `Auto-organized ${file.name}`
      };

      if (undoRedo) {
        await undoRedo.recordAction(action);
      }

      return {
        source: filePath,
        destination,
        confidence: suggestion.confidence,
        suggestion: suggestion.primary
      };
    }

    logger.info('[AutoOrganize] File confidence too low for auto-organization', {
      file: filePath,
      confidence: suggestion.confidence || 0,
      threshold: confidenceThreshold
    });

    return null;
  } catch (error) {
    logger.error('[AutoOrganize] Error processing new file:', {
      file: filePath,
      error: error.message
    });
    return null;
  }
}

module.exports = {
  generateSecureId,
  processFilesWithoutAnalysis,
  processFilesIndividually,
  processNewFile
};
