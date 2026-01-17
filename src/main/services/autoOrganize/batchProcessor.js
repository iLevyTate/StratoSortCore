/**
 * Batch Processor
 *
 * Batch processing operations for auto-organize.
 *
 * @module autoOrganize/batchProcessor
 */

const path = require('path');
const { logger } = require('../../../shared/logger');
const { sanitizeFile } = require('./fileTypeUtils');
const {
  getFallbackDestination,
  buildDestinationPath,
  findDefaultFolder
} = require('./folderOperations');
const { safeSuggestion } = require('./pathUtils');
// FIX C-5: Import from idUtils to break circular dependency with fileProcessor
const { generateSecureId } = require('./idUtils');

logger.setContext('AutoOrganize-Batch');

/**
 * Process batch suggestion results
 * @param {Object} batchSuggestions - Batch suggestions from suggestion service
 * @param {Array} files - Files being processed
 * @param {Object} options - Processing options (includes confidenceThreshold)
 * @param {Object} results - Results object to populate
 * @param {Object} suggestionService - Suggestion service for feedback
 * @param {Array} smartFolders - Smart folders
 */
async function processBatchResults(
  batchSuggestions,
  files,
  options,
  results,
  suggestionService,
  smartFolders
) {
  const { confidenceThreshold, defaultLocation, preserveNames } = options;
  const baseThreshold = 0.75;
  const effectiveThreshold = Math.max(
    Number.isFinite(confidenceThreshold) ? confidenceThreshold : 0,
    baseThreshold
  );

  // Create a map of files keyed by path (more stable than name)
  const fileMap = new Map(files.map((f) => [f.path || f.name, f]));

  // Validate groups array defensively
  const groups = Array.isArray(batchSuggestions?.groups) ? batchSuggestions.groups : [];

  for (const group of groups) {
    // Validate group.files is an array before iterating
    if (!Array.isArray(group?.files)) {
      logger.warn('[AutoOrganize] Skipping group with invalid files array', {
        folder: group?.folder || 'unknown'
      });
      continue;
    }

    for (const fileWithSuggestion of group.files) {
      const lookupKey = fileWithSuggestion.path || fileWithSuggestion.name;
      const file = fileMap.get(lookupKey) || fileWithSuggestion;
      let { suggestion } = fileWithSuggestion;
      const confidence = group.confidence || 0;

      // Ensure we have a valid source path
      const sourcePath = file.path || fileWithSuggestion.path;
      if (!sourcePath) {
        logger.warn('[AutoOrganize] Skipping file with no path', { file: file.name || 'unknown' });
        continue;
      }

      if (suggestion && smartFolders && smartFolders.length > 0) {
        const resolvedSmartFolder = smartFolders.find(
          (folder) =>
            (folder.name &&
              suggestion.folder &&
              folder.name.toLowerCase() === String(suggestion.folder).toLowerCase()) ||
            (folder.path &&
              suggestion.path &&
              folder.path.toLowerCase() === String(suggestion.path).toLowerCase())
        );
        if (resolvedSmartFolder) {
          suggestion = {
            ...suggestion,
            folder: resolvedSmartFolder.name,
            path: resolvedSmartFolder.path,
            isSmartFolder: true
          };
        }
      }

      if (!suggestion) {
        // Use fallback if no suggestion
        const fallbackDestination = getFallbackDestination(file, smartFolders, defaultLocation);

        if (fallbackDestination) {
          results.organized.push({
            file,
            destination: fallbackDestination,
            confidence: 0.3,
            method: 'batch-fallback'
          });

          results.operations.push({
            type: 'move',
            source: sourcePath,
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

      // Determine action based on confidence
      if (confidence >= effectiveThreshold && suggestion.isSmartFolder) {
        // High confidence - organize automatically
        // Ensure suggestion folder/path are valid strings
        const safeSuggestionObj = safeSuggestion(suggestion);
        const destination = buildDestinationPath(
          file,
          safeSuggestionObj,
          defaultLocation,
          preserveNames
        );

        results.organized.push({
          file: sanitizeFile(file),
          suggestion,
          destination,
          confidence,
          method: 'batch-automatic'
        });

        results.operations.push({
          type: 'move',
          source: sourcePath,
          destination
        });

        // Record feedback for learning (non-blocking with error handling)
        void suggestionService.recordFeedback(file, suggestion, true).catch((err) => {
          logger.warn('[AutoOrganize] Failed to record feedback (non-critical):', {
            file: sourcePath,
            error: err.message
          });
        });
      } else {
        const defaultFolder = findDefaultFolder(smartFolders);
        if (defaultFolder?.path && confidence < effectiveThreshold) {
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
            source: sourcePath,
            destination
          });
        } else {
          // Below threshold - needs user review
          results.needsReview.push({
            file: sanitizeFile(file),
            suggestion,
            alternatives: fileWithSuggestion.alternatives,
            confidence,
            explanation: `Batch suggestion with ${Math.round(confidence * 100)}% confidence`
          });
        }
      }
    }
  }
}

/**
 * Batch organize with automatic confidence-based filtering
 * @param {Array} files - Files to organize
 * @param {Array} smartFolders - Smart folders
 * @param {Object} options - Options (includes confidenceThreshold)
 * @param {Object} suggestionService - Suggestion service
 * @param {Object} thresholds - Confidence thresholds (for backwards compatibility)
 * @param {Function} [buildDestFn] - Optional custom buildDestinationPath function
 * @returns {Promise<Object>} Batch results
 */
async function batchOrganize(
  files,
  smartFolders,
  options,
  suggestionService,
  thresholds = {},
  buildDestFn = buildDestinationPath
) {
  // FIX: Use ?? instead of || to properly handle falsy values like 0
  const { confidenceThreshold = thresholds.confidence ?? 0.75 } = options;

  logger.info('[AutoOrganize] Starting batch organization', {
    fileCount: files.length
  });

  // Get batch suggestions
  const batchSuggestions = await suggestionService.getBatchSuggestions(files, smartFolders);

  if (!batchSuggestions.success) {
    throw new Error('Failed to get batch suggestions');
  }

  const results = {
    operations: [],
    groups: [],
    skipped: [],
    failed: []
  };

  // Process groups with error handling
  const groups = Array.isArray(batchSuggestions.groups) ? batchSuggestions.groups : [];
  for (const group of groups) {
    if (!Array.isArray(smartFolders) || smartFolders.length === 0) {
      results.skipped.push({
        folder: group.folder,
        files: group.files,
        confidence: group.confidence,
        reason: 'No smart folders configured'
      });
      continue;
    }

    // Validate group.files is an array before iterating
    if (!Array.isArray(group?.files)) {
      logger.warn('[AutoOrganize] Skipping group with invalid files array in batchOrganize', {
        folder: group?.folder || 'unknown'
      });
      continue;
    }

    try {
      if (group.confidence >= confidenceThreshold) {
        // Auto-approve high confidence groups
        const groupOperations = [];
        const groupFailures = [];

        for (const file of group.files) {
          try {
            // Ensure folder and path are valid strings
            const safeGroup = safeSuggestion(group);
            let folderName = safeGroup.folder;
            let folderPath = safeGroup.path;

            const resolvedSmartFolder = smartFolders.find(
              (folder) =>
                (folder.name &&
                  folderName &&
                  folder.name.toLowerCase() === String(folderName).toLowerCase()) ||
                (folder.path &&
                  folderPath &&
                  folder.path.toLowerCase() === String(folderPath).toLowerCase())
            );

            if (resolvedSmartFolder) {
              folderName = resolvedSmartFolder.name;
              folderPath = resolvedSmartFolder.path;
            }

            if (!folderPath) {
              throw new Error('Batch suggestion does not map to a smart folder path');
            }

            const destination = buildDestFn(
              file,
              { folder: folderName, path: folderPath },
              options.defaultLocation || 'Documents',
              options.preserveNames
            );

            groupOperations.push({
              type: 'move',
              source: file.path,
              destination
            });

            // Record feedback with proper error handling
            if (file.suggestion) {
              try {
                await suggestionService.recordFeedback(file, file.suggestion, true);
              } catch (feedbackError) {
                logger.warn('[AutoOrganize] Failed to record feedback for file:', {
                  file: file.path,
                  error: feedbackError.message
                });
              }
            }
          } catch (fileError) {
            const errorDetails = {
              filePath: file.path,
              fileName: file.name || path.basename(file.path),
              batchId: generateSecureId('batch'),
              timestamp: new Date().toISOString(),
              error: fileError.message,
              errorStack: fileError.stack
            };

            logger.error('[AutoOrganize] Failed to process file in batch:', errorDetails);

            groupFailures.push({
              file,
              error: fileError.message,
              filePath: file.path,
              timestamp: errorDetails.timestamp
            });
          }
        }

        // Add successful operations
        results.operations.push(...groupOperations);

        // Track failed files
        if (groupFailures.length > 0) {
          results.failed.push(...groupFailures);
        }

        // Only add group if at least some files succeeded
        if (groupOperations.length > 0) {
          // Use path-based comparison instead of object reference equality
          const failedPaths = new Set(groupFailures.map((failure) => failure.filePath));
          results.groups.push({
            folder: group.folder,
            files: group.files.filter((f) => !failedPaths.has(f.path)),
            confidence: group.confidence,
            autoApproved: true,
            partialSuccess: groupFailures.length > 0
          });
        }
      } else {
        // Skip low confidence groups for manual review
        results.skipped.push({
          folder: group.folder,
          files: group.files,
          confidence: group.confidence,
          reason: 'Low confidence'
        });
      }
    } catch (groupError) {
      const groupErrorDetails = {
        folder: group.folder,
        folderPath: group.path,
        fileCount: group.files ? group.files.length : 0,
        batchId: generateSecureId('batch'),
        timestamp: new Date().toISOString(),
        error: groupError.message,
        errorStack: groupError.stack
      };

      logger.error('[AutoOrganize] Failed to process group in batch:', groupErrorDetails);

      results.failed.push({
        group: group.folder,
        files: group.files,
        error: groupError.message,
        timestamp: groupErrorDetails.timestamp,
        batchId: groupErrorDetails.batchId
      });
    }
  }

  logger.info('[AutoOrganize] Batch organization complete', {
    operationCount: results.operations.length,
    groupCount: results.groups.length,
    skippedCount: results.skipped.length
  });

  return results;
}

module.exports = {
  generateSecureId,
  processBatchResults,
  batchOrganize
};
