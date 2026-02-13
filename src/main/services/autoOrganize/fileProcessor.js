/**
 * File Processor
 *
 * Individual file processing and new file monitoring.
 *
 * @module autoOrganize/fileProcessor
 */

const path = require('path');
const fs = require('fs').promises;
const { createLogger } = require('../../../shared/logger');
const { sanitizeFile } = require('./fileTypeUtils');
const { generateSuggestedNameFromAnalysis } = require('./namingUtils');
const {
  findDefaultFolder,
  getFallbackDestination,
  buildDestinationPath
} = require('./folderOperations');
const { safeSuggestion, resolveSuggestionToSmartFolder } = require('./pathUtils');
// FIX C-5: Import from shared idUtils to break circular dependency with batchProcessor
const { generateSecureId } = require('./idUtils');

const logger = createLogger('AutoOrganize-FileProcessor');
// FIX CRIT-24: Module-level lock to prevent concurrent processing of the same file
const processingLocks = new Set();

// Normalize file paths for lock comparison (case-insensitive on Windows)
const normalizeLockPath = (filePath) =>
  process.platform === 'win32' ? path.resolve(filePath).toLowerCase() : path.resolve(filePath);

/**
 * Process files without analysis (use default folder)
 * @param {Array} files - Files without analysis
 * @param {Array} smartFolders - Smart folders
 * @param {string} defaultLocation - Default location
 * @param {Object} results - Results object to populate
 */
async function processFilesWithoutAnalysis(files, smartFolders, _defaultLocation, results) {
  logger.info('[AutoOrganize] Processing files without analysis', {
    count: files.length
  });

  // Find default smart folder once for all files
  const defaultFolder = findDefaultFolder(smartFolders);

  if (!defaultFolder || !defaultFolder.path) {
    // No default smart folder configured, send to review
    for (const file of files) {
      results.needsReview.push({
        file: sanitizeFile(file),
        suggestion: null,
        alternatives: [],
        confidence: 0,
        explanation: 'No analysis available and no default smart folder configured'
      });
    }
    return;
  }

  // Process all files without analysis in batch
  for (const file of files) {
    const destination = path.join(defaultFolder.path, file.name);

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
  // FIX: Use user's configured threshold directly - don't override with minimum
  // This allows users to organize files with lower confidence (e.g., filename-only analysis)
  const effectiveThreshold = Number.isFinite(confidenceThreshold) ? confidenceThreshold : 0.75;

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

        if (fallbackDestination) {
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
        } else {
          results.needsReview.push({
            file: sanitizeFile(file),
            suggestion: null,
            alternatives: [],
            confidence: 0,
            explanation: 'No smart folder fallback available'
          });
        }
        continue;
      }

      if (!suggestion || !suggestion.success || !suggestion.primary) {
        // Use fallback logic
        const fallbackDestination = getFallbackDestination(file, smartFolders, defaultLocation);

        if (fallbackDestination) {
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
        } else {
          results.needsReview.push({
            file: sanitizeFile(file),
            suggestion: null,
            alternatives: [],
            confidence: 0,
            explanation: 'No smart folder fallback available'
          });
        }
        continue;
      }

      const { primary } = suggestion;
      const confidence = suggestion.confidence || 0;

      const canonicalPrimary = resolveSuggestionToSmartFolder(primary, smartFolders);

      // Determine action based on confidence
      if (confidence >= effectiveThreshold && canonicalPrimary) {
        // High confidence - organize automatically
        const safePrimary = safeSuggestion(canonicalPrimary);
        const destination = buildDestinationPath(file, safePrimary, defaultLocation, preserveNames);

        results.organized.push({
          file: sanitizeFile(file),
          suggestion: canonicalPrimary,
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
          await suggestionService.recordFeedback(file, canonicalPrimary, true);
        } catch (feedbackError) {
          logger.warn('[AutoOrganize] Failed to record feedback (non-critical):', {
            file: file.path,
            error: feedbackError.message
          });
        }
      } else if (confidence >= effectiveThreshold && !canonicalPrimary) {
        // High confidence but unresolved folder => review only (never auto-create unknown destinations)
        results.needsReview.push({
          file: sanitizeFile(file),
          suggestion: primary,
          alternatives: suggestion.alternatives,
          confidence,
          explanation:
            'Suggestion did not resolve to a configured smart folder. Review required before moving.'
        });
      } else {
        const defaultFolder = findDefaultFolder(smartFolders);
        if (
          defaultFolder &&
          typeof defaultFolder.path === 'string' &&
          confidence < effectiveThreshold
        ) {
          const destination = path.join(defaultFolder.path, file.name);
          const uncategorizedSuggestion = {
            ...defaultFolder,
            isSmartFolder: true
          };
          results.organized.push({
            file: sanitizeFile(file),
            suggestion: uncategorizedSuggestion,
            destination,
            confidence,
            method: 'low-confidence-default'
          });

          results.operations.push({
            type: 'move',
            source: file.path,
            destination
          });
        } else {
          // Below threshold or not a smart folder - needs user review
          results.needsReview.push({
            file: sanitizeFile(file),
            suggestion: primary,
            alternatives: suggestion.alternatives,
            confidence,
            explanation: suggestion.explanation
          });
        }
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
async function processNewFile(filePath, smartFolders, options, suggestionService, _undoRedo) {
  const {
    autoOrganizeEnabled = false,
    // Default confidence threshold - user can override via settings
    confidenceThreshold = 0.75
  } = options;
  // FIX: Use user's configured threshold directly - don't override with minimum
  // This allows users to organize files with lower confidence (e.g., filename-only analysis)
  const effectiveThreshold = Number.isFinite(confidenceThreshold) ? confidenceThreshold : 0.75;

  if (!autoOrganizeEnabled) {
    logger.info('[AutoOrganize] Auto-organize disabled, skipping file:', filePath);
    return null;
  }

  // FIX CRIT-24: Check and acquire lock for this file
  // FIX: Normalize path for case-insensitive comparison on Windows
  const lockKey = normalizeLockPath(filePath);
  if (processingLocks.has(lockKey)) {
    logger.debug('[AutoOrganize] File already being processed, skipping:', filePath);
    return null;
  }
  processingLocks.add(lockKey);

  try {
    // Analyze the file first
    const { analyzeDocumentFile } = require('../../analysis/documentAnalysis');
    const { analyzeImageFile } = require('../../analysis/imageAnalysis');
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

    const canonicalPrimary = resolveSuggestionToSmartFolder(suggestion?.primary, smartFolders);

    // Only auto-organize if confidence is very high and destination resolves to a configured smart folder
    if (suggestion.success && canonicalPrimary && suggestion.confidence >= effectiveThreshold) {
      const safePrimary = safeSuggestion(canonicalPrimary);
      const destination = buildDestinationPath(file, safePrimary, options.defaultLocation, false);

      logger.info('[AutoOrganize] Auto-organizing new file', {
        file: filePath,
        destination,
        confidence: suggestion.confidence
      });

      // Return the undo action data so the caller can record it AFTER the
      // actual file move succeeds. Recording before the move creates a
      // phantom undo entry if the move later fails.
      const undoAction = {
        type: 'FILE_MOVE',
        data: {
          originalPath: filePath,
          newPath: destination
        },
        timestamp: Date.now(),
        description: `Auto-organized ${file.name}`
      };

      return {
        source: filePath,
        destination,
        confidence: suggestion.confidence,
        suggestion: canonicalPrimary,
        undoAction
      };
    }

    // Confidence below threshold - do not move automatically.
    const confidence = suggestion.confidence || 0;
    logger.info('[AutoOrganize] File confidence below threshold; skipping auto-organize', {
      file: filePath,
      confidence,
      threshold: effectiveThreshold
    });
    return null;
  } catch (error) {
    logger.error('[AutoOrganize] Error processing new file:', {
      file: filePath,
      error: error.message
    });
    return null;
  } finally {
    // FIX CRIT-24: Release lock (use normalized key)
    processingLocks.delete(lockKey);
  }
}

module.exports = {
  generateSecureId,
  processFilesWithoutAnalysis,
  processFilesIndividually,
  processNewFile
};
