/**
 * Batch Processor
 *
 * Batch processing operations for auto-organize.
 *
 * @module autoOrganize/batchProcessor
 */

const path = require('path');
const crypto = require('crypto');
const { logger } = require('../../../shared/logger');
const { sanitizeFile } = require('./fileTypeUtils');
const { getFallbackDestination, buildDestinationPath } = require('./folderOperations');

logger.setContext('AutoOrganize-Batch');

// Helper to generate secure random IDs
const generateSecureId = (prefix) =>
  `${prefix}-${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;

/**
 * Process batch suggestion results
 * @param {Object} batchSuggestions - Batch suggestions from suggestion service
 * @param {Array} files - Files being processed
 * @param {Object} options - Processing options
 * @param {Object} results - Results object to populate
 * @param {Object} suggestionService - Suggestion service for feedback
 * @param {Object} thresholds - Confidence thresholds
 */
async function processBatchResults(
  batchSuggestions,
  files,
  options,
  results,
  suggestionService,
  thresholds
) {
  const { confidenceThreshold, defaultLocation, preserveNames } = options;

  // Create a map of files keyed by path (more stable than name)
  const fileMap = new Map(files.map((f) => [f.path || f.name, f]));

  // Validate groups array defensively
  const groups = Array.isArray(batchSuggestions?.groups) ? batchSuggestions.groups : [];

  for (const group of groups) {
    for (const fileWithSuggestion of group.files) {
      const lookupKey = fileWithSuggestion.path || fileWithSuggestion.name;
      const file = fileMap.get(lookupKey) || fileWithSuggestion;
      const suggestion = fileWithSuggestion.suggestion;
      const confidence = group.confidence || 0;

      if (!suggestion) {
        // Use fallback if no suggestion
        const fallbackDestination = getFallbackDestination(file, [], defaultLocation);

        results.organized.push({
          file,
          destination: fallbackDestination,
          confidence: 0.3,
          method: 'batch-fallback'
        });

        results.operations.push({
          type: 'move',
          source: file.path,
          destination: fallbackDestination
        });
        continue;
      }

      // Determine action based on confidence
      if (confidence >= confidenceThreshold) {
        // High confidence - organize automatically
        // Ensure suggestion folder/path are valid strings
        const safeSuggestion = {
          ...suggestion,
          folder:
            typeof suggestion.folder === 'string'
              ? suggestion.folder
              : suggestion.folder?.name || 'Uncategorized',
          path:
            typeof suggestion.path === 'string'
              ? suggestion.path
              : suggestion.path?.path || undefined
        };
        const destination = buildDestinationPath(
          file,
          safeSuggestion,
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
          source: file.path,
          destination
        });

        // Record feedback for learning (non-blocking with error handling)
        void suggestionService.recordFeedback(file, suggestion, true).catch((err) => {
          logger.warn('[AutoOrganize] Failed to record feedback (non-critical):', {
            file: file.path,
            error: err.message
          });
        });
      } else if (confidence >= thresholds.requireReview) {
        // Medium confidence - needs review
        results.needsReview.push({
          file: sanitizeFile(file),
          suggestion,
          alternatives: fileWithSuggestion.alternatives,
          confidence,
          explanation: `Batch suggestion with ${Math.round(confidence * 100)}% confidence`
        });
      } else {
        // Low confidence - use fallback
        const fallbackDestination = getFallbackDestination(file, [], defaultLocation);

        results.organized.push({
          file: sanitizeFile(file),
          destination: fallbackDestination,
          confidence,
          method: 'batch-low-confidence-fallback'
        });

        results.operations.push({
          type: 'move',
          source: file.path,
          destination: fallbackDestination
        });
      }
    }
  }
}

/**
 * Batch organize with automatic confidence-based filtering
 * @param {Array} files - Files to organize
 * @param {Array} smartFolders - Smart folders
 * @param {Object} options - Options
 * @param {Object} suggestionService - Suggestion service
 * @param {Object} thresholds - Confidence thresholds
 * @param {Function} [buildDestFn] - Optional custom buildDestinationPath function
 * @returns {Promise<Object>} Batch results
 */
async function batchOrganize(
  files,
  smartFolders,
  options,
  suggestionService,
  thresholds,
  buildDestFn = buildDestinationPath
) {
  const { autoApproveThreshold = thresholds.autoApprove } = options;

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
  for (const group of batchSuggestions.groups) {
    try {
      if (group.confidence >= autoApproveThreshold) {
        // Auto-approve high confidence groups
        const groupOperations = [];
        const groupFailures = [];

        for (const file of group.files) {
          try {
            // Ensure folder and path are valid strings
            const folderName =
              typeof group.folder === 'string'
                ? group.folder
                : group.folder?.name || 'Uncategorized';
            const folderPath =
              typeof group.path === 'string' ? group.path : group.path?.path || undefined;

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
          results.groups.push({
            folder: group.folder,
            files: group.files.filter((f) => !groupFailures.find((failure) => failure.file === f)),
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
