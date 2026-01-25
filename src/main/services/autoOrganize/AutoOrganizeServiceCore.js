/**
 * Auto Organize Service Core
 *
 * Slim coordinator class that composes all auto-organize modules.
 * Extracted from the original 1,214-line AutoOrganizeService.js.
 *
 * @module autoOrganize/AutoOrganizeServiceCore
 */

const { logger } = require('../../../shared/logger');
const { BATCH } = require('../../../shared/performanceConstants');
const { DEFAULT_SETTINGS } = require('../../../shared/defaultSettings');

// Import decomposed modules
const { getFileTypeCategory, sanitizeFile } = require('./fileTypeUtils');
const { getFallbackDestination, buildDestinationPath } = require('./folderOperations');
const { processBatchResults, batchOrganize: batchOrganizeHelper } = require('./batchProcessor');
const {
  processFilesWithoutAnalysis,
  processFilesIndividually,
  processNewFile: processNewFileHelper
} = require('./fileProcessor');

// Normalize a confidence value into [0, 1], falling back when invalid
const coerceConfidence = (val, fallback = DEFAULT_SETTINGS.confidenceThreshold) => {
  const num = Number(val);
  if (Number.isFinite(num)) {
    return Math.min(1, Math.max(0, num));
  }
  return fallback;
};

logger.setContext('AutoOrganizeService');

// Batch size from centralized configuration
const DEFAULT_BATCH_SIZE = BATCH.AUTO_ORGANIZE_BATCH_SIZE;

/**
 * AutoOrganizeService - Handles automatic file organization
 *
 * This service orchestrates automatic file organization using AI-powered suggestions.
 * It uses constructor-based dependency injection for all its dependencies.
 */
class AutoOrganizeServiceCore {
  /**
   * Create an AutoOrganizeService instance
   *
   * @param {Object} dependencies - Service dependencies
   * @param {Object} dependencies.suggestionService - Organization suggestion service
   * @param {Object} dependencies.settingsService - Settings service
   * @param {Object} dependencies.folderMatchingService - Folder matching service
   * @param {Object} dependencies.undoRedoService - Undo/redo service
   */
  constructor({ suggestionService, settingsService, folderMatchingService, undoRedoService }) {
    this.suggestionService = suggestionService;
    this.settings = settingsService;
    this.folderMatcher = folderMatchingService;
    this.undoRedo = undoRedoService;

    // Simplified single confidence threshold (from user settings or default)
    this.thresholds = {
      confidence: DEFAULT_SETTINGS.confidenceThreshold // 0.75 - files must meet this to be auto-organized
    };

    // Keep thresholds in sync with persisted settings without blocking construction
    this._syncThresholdFromSettingsService();
  }

  /**
   * Apply settings updates (called when renderer saves settings)
   * @param {Object} settings
   */
  applySettings(settings) {
    this.thresholds.confidence = coerceConfidence(settings?.confidenceThreshold);
  }

  /**
   * Load thresholds from SettingsService (best effort, non-blocking)
   * Ensures background services honor the persisted confidence threshold
   * even before an explicit onSettingsChanged notification arrives.
   * @private
   */
  async _syncThresholdFromSettingsService() {
    try {
      if (!this.settings || typeof this.settings.load !== 'function') return;
      const loaded = await this.settings.load();
      this.thresholds.confidence = coerceConfidence(
        loaded?.confidenceThreshold,
        DEFAULT_SETTINGS.confidenceThreshold
      );
    } catch (error) {
      logger.warn(
        '[AutoOrganize] Failed to sync confidence threshold from settings:',
        error.message
      );
      this.thresholds.confidence = DEFAULT_SETTINGS.confidenceThreshold;
    }
  }

  /**
   * Sanitize file object for IPC transmission
   */
  _sanitizeFile(file) {
    return sanitizeFile(file);
  }

  /**
   * Automatically organize files based on their analysis
   * Uses batched suggestions for improved performance
   */
  async organizeFiles(files, smartFolders, options = {}) {
    const {
      confidenceThreshold,
      defaultLocation = 'Documents',
      preserveNames = false,
      batchSize = DEFAULT_BATCH_SIZE
    } = options;

    // IMPORTANT: Options may raise the threshold, but must not lower it below the
    // service's configured threshold (which is synced from settings).
    // This prevents callers from accidentally bypassing user safety preferences.
    const baseThreshold = coerceConfidence(
      this.thresholds.confidence,
      DEFAULT_SETTINGS.confidenceThreshold
    );
    const requestedThreshold =
      confidenceThreshold == null ? null : coerceConfidence(confidenceThreshold, baseThreshold);
    const effectiveThreshold =
      requestedThreshold == null ? baseThreshold : Math.max(baseThreshold, requestedThreshold);

    logger.info('[AutoOrganize] Starting automatic organization', {
      fileCount: files.length,
      smartFolderCount: smartFolders.length,
      confidenceThreshold: effectiveThreshold,
      batchSize
    });

    const results = {
      organized: [],
      needsReview: [],
      failed: [],
      operations: []
    };

    // Separate files with and without analysis
    const filesWithAnalysis = [];
    const filesWithoutAnalysis = [];

    for (const file of files) {
      if (!file.analysis) {
        filesWithoutAnalysis.push(file);
      } else {
        filesWithAnalysis.push(file);
      }
    }

    // Process files without analysis first (they use the default folder)
    if (filesWithoutAnalysis.length > 0) {
      await processFilesWithoutAnalysis(
        filesWithoutAnalysis,
        smartFolders,
        defaultLocation,
        results
      );
    }

    // Process files with analysis in batches
    if (filesWithAnalysis.length > 0) {
      // Split into batches for efficient processing
      const batches = [];
      for (let i = 0; i < filesWithAnalysis.length; i += batchSize) {
        batches.push(filesWithAnalysis.slice(i, i + batchSize));
      }

      logger.info('[AutoOrganize] Processing files in batches', {
        totalFiles: filesWithAnalysis.length,
        batchCount: batches.length,
        batchSize
      });

      // Process each batch
      for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
        const batch = batches[batchIndex];

        logger.debug('[AutoOrganize] Processing batch', {
          batchIndex: batchIndex + 1,
          totalBatches: batches.length,
          filesInBatch: batch.length
        });

        try {
          // Get batch suggestions - this is the key optimization
          const batchSuggestions = await this.suggestionService.getBatchSuggestions(
            batch,
            smartFolders,
            {
              includeStructureAnalysis: false,
              includeAlternatives: false
            }
          );

          if (
            !batchSuggestions.success ||
            !batchSuggestions.groups ||
            batchSuggestions.groups.length === 0
          ) {
            // Fallback to individual processing if batch fails
            logger.warn(
              '[AutoOrganize] Batch suggestions failed or empty, falling back to individual processing'
            );
            await processFilesIndividually(
              batch,
              smartFolders,
              { confidenceThreshold: effectiveThreshold, defaultLocation, preserveNames },
              results,
              this.suggestionService
            );
            continue;
          }

          // Process batch results
          await processBatchResults(
            batchSuggestions,
            batch,
            { confidenceThreshold: effectiveThreshold, defaultLocation, preserveNames },
            results,
            this.suggestionService,
            smartFolders
          );

          // Check if any files from the batch weren't processed
          const processedFileNames = new Set();
          for (const group of batchSuggestions.groups) {
            for (const fileWithSuggestion of group.files) {
              processedFileNames.add(fileWithSuggestion.name);
            }
          }

          // Process any unprocessed files individually as fallback
          const unprocessedFiles = batch.filter((f) => !processedFileNames.has(f.name));
          if (unprocessedFiles.length > 0) {
            logger.debug(
              '[AutoOrganize] Some files not in batch results, processing individually',
              { count: unprocessedFiles.length }
            );
            await processFilesIndividually(
              unprocessedFiles,
              smartFolders,
              { confidenceThreshold: effectiveThreshold, defaultLocation, preserveNames },
              results,
              this.suggestionService
            );
          }
        } catch (error) {
          logger.error('[AutoOrganize] Batch processing failed', {
            batchIndex: batchIndex + 1,
            error: error.message
          });

          // Fallback to individual processing for this batch
          await processFilesIndividually(
            batch,
            smartFolders,
            { confidenceThreshold: effectiveThreshold, defaultLocation, preserveNames },
            results,
            this.suggestionService
          );
        }
      }
    }

    // Log summary
    logger.info('[AutoOrganize] Organization complete', {
      organized: results.organized.length,
      needsReview: results.needsReview.length,
      failed: results.failed.length
    });

    return results;
  }

  /**
   * Batch organize with automatic confidence-based filtering
   */
  async batchOrganize(files, smartFolders, options = {}) {
    return batchOrganizeHelper(
      files,
      smartFolders,
      options,
      this.suggestionService,
      this.thresholds,
      this.buildDestinationPath.bind(this)
    );
  }

  /**
   * Get fallback destination for files with no good match
   */
  getFallbackDestination(file, smartFolders, defaultLocation) {
    return getFallbackDestination(file, smartFolders, defaultLocation);
  }

  /**
   * Build destination path for a file
   */
  buildDestinationPath(file, suggestion, defaultLocation, preserveNames) {
    return buildDestinationPath(file, suggestion, defaultLocation, preserveNames);
  }

  /**
   * Get file type category
   */
  getFileTypeCategory(extension) {
    return getFileTypeCategory(extension);
  }

  /**
   * Monitor and auto-organize new files (for Downloads folder watching)
   */
  async processNewFile(filePath, smartFolders, options = {}) {
    const optionsWithThreshold = {
      ...options,
      confidenceThreshold: coerceConfidence(
        options?.confidenceThreshold,
        this.thresholds.confidence
      )
    };

    return processNewFileHelper(
      filePath,
      smartFolders,
      optionsWithThreshold,
      this.suggestionService,
      this.undoRedo
    );
  }

  /**
   * Get organization statistics
   */
  async getStatistics() {
    return {
      userPatterns: this.suggestionService?.userPatterns?.size ?? 0,
      feedbackHistory: this.suggestionService?.feedbackHistory?.length ?? 0,
      folderUsageStats: this.suggestionService?.folderUsageStats
        ? Array.from(this.suggestionService.folderUsageStats.entries())
        : [],
      thresholds: this.thresholds
    };
  }

  /**
   * Update confidence thresholds
   */
  updateThresholds(newThresholds) {
    this.thresholds = {
      ...this.thresholds,
      ...newThresholds
    };
    logger.info('[AutoOrganize] Updated thresholds:', this.thresholds);
  }
}

module.exports = AutoOrganizeServiceCore;
