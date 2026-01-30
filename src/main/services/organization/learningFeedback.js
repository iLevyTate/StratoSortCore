/**
 * Learning Feedback Service
 *
 * Records implicit feedback when files are placed in smart folders,
 * allowing the system to learn from user organization decisions.
 *
 * This captures implicit signals:
 * - Files manually moved to smart folders (user preference)
 * - Files detected in smart folders by SmartFolderWatcher
 * - Existing file distribution in smart folders on startup
 *
 * @module services/organization/learningFeedback
 */

const path = require('path');
const { logger: baseLogger, createLogger } = require('../../../shared/logger');
const { findContainingSmartFolder: findSmartFolderInList } = require('../../../shared/folderUtils');
const { DEBOUNCE } = require('../../../shared/performanceConstants');

const logger =
  typeof createLogger === 'function' ? createLogger('Organization:LearningFeedback') : baseLogger;
if (typeof createLogger !== 'function' && logger?.setContext) {
  logger.setContext('Organization:LearningFeedback');
}

/**
 * Sources of implicit feedback - used for analytics and weight adjustment
 */
const FEEDBACK_SOURCES = Object.freeze({
  // User explicitly moved file via UI or file explorer
  MANUAL_MOVE: 'manual_move',
  // File detected by SmartFolderWatcher in a smart folder
  WATCHER_DETECTION: 'watcher_detection',
  // Existing file found during startup scan
  STARTUP_SCAN: 'startup_scan',
  // File organized by auto-organize with user confirmation
  AUTO_ORGANIZE_CONFIRMED: 'auto_organize_confirmed',
  // File drag-dropped to smart folder
  DRAG_DROP: 'drag_drop'
});

/**
 * Confidence multipliers for different feedback sources
 * Higher = more weight in pattern learning
 */
const SOURCE_CONFIDENCE_WEIGHTS = Object.freeze({
  [FEEDBACK_SOURCES.MANUAL_MOVE]: 1.0, // User explicitly chose this
  [FEEDBACK_SOURCES.DRAG_DROP]: 1.0, // Direct user action
  [FEEDBACK_SOURCES.AUTO_ORGANIZE_CONFIRMED]: 0.9, // User approved
  [FEEDBACK_SOURCES.WATCHER_DETECTION]: 0.6, // File appeared, might not be intentional
  [FEEDBACK_SOURCES.STARTUP_SCAN]: 0.4 // Historical, less certainty about intent
});

/**
 * Build a file metadata object for pattern learning
 * @param {string} filePath - Full path to the file
 * @param {Object} analysis - Analysis result if available
 * @returns {Object} File metadata for pattern matching
 */
function buildFileMetadata(filePath, analysis = null) {
  const fileName = path.basename(filePath);
  const extension = path.extname(filePath).toLowerCase().replace('.', '');
  // FIX LOW-9: Removed unused _dirName variable
  // If parent directory pattern matching is needed later, add it then

  return {
    name: fileName,
    path: filePath,
    extension: extension || 'unknown',
    // Include analysis data if available
    category: analysis?.category || analysis?.smartFolder || null,
    subject: analysis?.subject || null,
    keywords: analysis?.keywords || analysis?.tags || [],
    confidence: analysis?.confidence || null
  };
}

/**
 * Build a suggestion object representing the destination folder
 * FIX MED-7: Handle edge case where folder name is empty and path ends with separator
 * @param {Object} smartFolder - Smart folder object
 * @param {number} confidenceWeight - Confidence multiplier from source
 * @returns {Object} Suggestion object for pattern recording
 */
function buildFolderSuggestion(smartFolder, confidenceWeight = 1.0) {
  if (!smartFolder || !smartFolder.path) {
    return null;
  }

  // FIX MED-7: Handle edge cases where name is falsy and path.basename returns empty
  // This can happen if path ends with a separator (e.g., '/documents/')
  let folderName = smartFolder.name;
  if (!folderName) {
    folderName = path.basename(smartFolder.path);
  }
  if (!folderName) {
    // Last resort: use the full path or a default
    folderName = smartFolder.path || 'Unknown';
  }

  return {
    folder: folderName,
    path: smartFolder.path,
    folderId: smartFolder.id || null,
    // Base confidence adjusted by source weight
    confidence: 0.85 * confidenceWeight,
    method: 'implicit_feedback',
    isSmartFolder: true,
    description: smartFolder.description || ''
  };
}

/**
 * LearningFeedbackService - Records and processes implicit organization feedback
 */
class LearningFeedbackService {
  /**
   * @param {Object} deps - Dependencies
   * @param {Object} deps.suggestionService - OrganizationSuggestionService for recording feedback
   * @param {Function} deps.getSmartFolders - Function to get current smart folders
   */
  constructor({ suggestionService, getSmartFolders }) {
    this.suggestionService = suggestionService;
    this.getSmartFolders = getSmartFolders;

    // Debounce tracking to prevent duplicate learning for the same file
    this._recentlyLearned = new Map(); // filePath -> timestamp
    // FIX LOW-10: Use centralized constant
    this._dedupeWindowMs = DEBOUNCE.LEARNING_DEDUPE_WINDOW;

    // Stats for monitoring
    this.stats = {
      totalLearned: 0,
      bySource: {},
      lastLearnedAt: null
    };

    logger.info('[LearningFeedback] Service initialized');
  }

  /**
   * Find which smart folder a file path belongs to
   * @param {string} filePath - File path to check
   * @returns {Object|null} Smart folder if file is inside one
   */
  findContainingSmartFolder(filePath) {
    const smartFolders = this.getSmartFolders();
    return findSmartFolderInList(filePath, smartFolders);
  }

  /**
   * Check if a folder is still in the registered smart folders list.
   * FIX MEDIUM-7: Prevents recording feedback for folders that have been removed.
   *
   * @param {Object} folder - Folder object to validate
   * @returns {boolean} True if folder is registered
   * @private
   */
  _isValidSmartFolder(folder) {
    if (!folder || !folder.path) return false;

    const smartFolders = this.getSmartFolders();
    if (!smartFolders || smartFolders.length === 0) return false;

    // Check if the folder path matches any registered smart folder
    return smartFolders.some(
      (sf) => sf && sf.path && (sf.path === folder.path || (sf.id && sf.id === folder.id))
    );
  }

  /**
   * Record implicit feedback when a file is placed in a smart folder
   *
   * @param {Object} params - Learning parameters
   * @param {string} params.filePath - Path to the file
   * @param {Object} params.smartFolder - Destination smart folder
   * @param {Object} params.analysis - Analysis result if available
   * @param {string} params.source - Source of the feedback (see FEEDBACK_SOURCES)
   * @returns {Promise<boolean>} True if feedback was recorded
   */
  async recordFilePlacement({
    filePath,
    smartFolder,
    analysis = null,
    source = FEEDBACK_SOURCES.MANUAL_MOVE
  }) {
    // Validate inputs
    if (!filePath || !smartFolder || !smartFolder.path) {
      logger.debug('[LearningFeedback] Missing required parameters', { filePath, smartFolder });
      return false;
    }

    // FIX MEDIUM-7: Validate that smartFolder is still registered
    // This prevents accumulating stale patterns for removed/renamed folders
    if (!this._isValidSmartFolder(smartFolder)) {
      logger.debug('[LearningFeedback] Folder not in registered smart folders', {
        folder: smartFolder.path
      });
      return false;
    }

    // Check suggestion service availability
    if (!this.suggestionService) {
      logger.warn('[LearningFeedback] Suggestion service not available');
      return false;
    }

    // Dedupe check - avoid learning the same file multiple times in quick succession
    const now = Date.now();
    const lastLearned = this._recentlyLearned.get(filePath);
    if (lastLearned && now - lastLearned < this._dedupeWindowMs) {
      logger.debug('[LearningFeedback] Skipping duplicate learning', { filePath });
      return false;
    }

    try {
      // Build file metadata
      const fileMetadata = buildFileMetadata(filePath, analysis);

      // Get confidence weight for this source
      const confidenceWeight = SOURCE_CONFIDENCE_WEIGHTS[source] || 0.5;

      // Build suggestion object
      const suggestion = buildFolderSuggestion(smartFolder, confidenceWeight);
      if (!suggestion) {
        logger.debug('[LearningFeedback] Could not build suggestion', { smartFolder });
        return false;
      }

      // Record as positive feedback - user chose this folder for this file type
      await this.suggestionService.recordFeedback(fileMetadata, suggestion, true);

      // Update folder usage stats via pattern matcher
      if (this.suggestionService.patternMatcher) {
        this.suggestionService.patternMatcher.incrementFolderUsage(
          smartFolder.id || smartFolder.name
        );
      }

      // Update dedupe tracking
      this._recentlyLearned.set(filePath, now);

      // Cleanup old entries periodically
      if (this._recentlyLearned.size > 1000) {
        this._cleanupDedupeCache(now);
      }

      // Update stats
      this.stats.totalLearned++;
      this.stats.bySource[source] = (this.stats.bySource[source] || 0) + 1;
      this.stats.lastLearnedAt = new Date().toISOString();

      logger.debug('[LearningFeedback] Recorded implicit feedback', {
        file: path.basename(filePath),
        folder: smartFolder.name,
        source,
        extension: fileMetadata.extension
      });

      return true;
    } catch (error) {
      logger.warn('[LearningFeedback] Failed to record feedback', {
        filePath,
        error: error.message,
        hint: error.message?.includes('Pattern storage failed to load')
          ? 'User patterns not loaded; retry after storage recovers'
          : undefined
      });
      return false;
    }
  }

  /**
   * Record feedback for a file move to a smart folder
   * Convenience method that auto-detects the destination smart folder
   *
   * @param {string} sourcePath - Original file path
   * @param {string} destPath - Destination file path
   * @param {Object} analysis - Analysis result if available
   * @param {string} source - Source of the move
   * @returns {Promise<boolean>} True if feedback was recorded
   */
  async recordFileMove(
    sourcePath,
    destPath,
    analysis = null,
    source = FEEDBACK_SOURCES.MANUAL_MOVE
  ) {
    // Find which smart folder the file was moved to
    const smartFolder = this.findContainingSmartFolder(destPath);

    if (!smartFolder) {
      // File wasn't moved to a smart folder - no learning
      logger.debug('[LearningFeedback] Destination is not a smart folder', { destPath });
      return false;
    }

    return this.recordFilePlacement({
      filePath: destPath,
      smartFolder,
      analysis,
      source
    });
  }

  /**
   * Learn from existing files in smart folders (startup scan)
   * This builds initial patterns from how files are already organized
   *
   * @param {Object} analysisHistoryService - Service to lookup existing analysis
   * @param {Object} options - Scan options
   * @param {number} options.maxFilesPerFolder - Max files to learn from per folder
   * @param {boolean} options.onlyWithAnalysis - Only learn from files with existing analysis
   * @returns {Promise<{scanned: number, learned: number}>}
   */
  async learnFromExistingFiles(analysisHistoryService, options = {}) {
    const { maxFilesPerFolder = 100, onlyWithAnalysis = true } = options;

    const smartFolders = this.getSmartFolders();
    if (!smartFolders || smartFolders.length === 0) {
      logger.info('[LearningFeedback] No smart folders to learn from');
      return { scanned: 0, learned: 0 };
    }

    let scanned = 0;
    let learned = 0;

    logger.info('[LearningFeedback] Starting learning scan', {
      folderCount: smartFolders.length,
      maxFilesPerFolder
    });

    for (const folder of smartFolders) {
      if (!folder || !folder.path) continue;

      try {
        const files = await this._scanFolderFiles(folder.path, maxFilesPerFolder);

        for (const filePath of files) {
          scanned++;

          // Get existing analysis if available
          let analysis = null;
          if (analysisHistoryService) {
            try {
              analysis = await analysisHistoryService.getAnalysisByPath(filePath);
            } catch {
              // Continue without analysis
            }
          }

          // Skip if we require analysis but don't have it
          if (onlyWithAnalysis && !analysis) {
            continue;
          }

          // Record the implicit feedback
          const success = await this.recordFilePlacement({
            filePath,
            smartFolder: folder,
            analysis,
            source: FEEDBACK_SOURCES.STARTUP_SCAN
          });

          if (success) {
            learned++;
          }
        }
      } catch (error) {
        logger.warn('[LearningFeedback] Error scanning folder', {
          folder: folder.path,
          error: error.message
        });
      }
    }

    logger.info('[LearningFeedback] Learning scan complete', { scanned, learned });
    return { scanned, learned };
  }

  /**
   * Scan folder for files (non-recursive, limited)
   * @private
   */
  async _scanFolderFiles(folderPath, maxFiles) {
    const fs = require('fs').promises;
    const files = [];

    try {
      const entries = await fs.readdir(folderPath, { withFileTypes: true });

      for (const entry of entries) {
        if (files.length >= maxFiles) break;

        if (entry.isFile() && !entry.name.startsWith('.')) {
          files.push(path.join(folderPath, entry.name));
        }
      }
    } catch (error) {
      logger.debug('[LearningFeedback] Cannot read folder', {
        folderPath,
        error: error.message
      });
    }

    return files;
  }

  /**
   * Clean up old entries from dedupe cache
   * @private
   */
  _cleanupDedupeCache(now) {
    const cutoff = now - this._dedupeWindowMs * 2;
    for (const [filePath, timestamp] of this._recentlyLearned) {
      if (timestamp < cutoff) {
        this._recentlyLearned.delete(filePath);
      }
    }
  }

  /**
   * Get learning statistics
   * @returns {Object} Statistics
   */
  getStats() {
    return { ...this.stats };
  }

  /**
   * Reset statistics
   */
  resetStats() {
    this.stats = {
      totalLearned: 0,
      bySource: {},
      lastLearnedAt: null
    };
  }

  /**
   * Shutdown - cleanup resources
   */
  shutdown() {
    this._recentlyLearned.clear();
    logger.debug('[LearningFeedback] Shutdown complete');
  }
}

// Singleton helpers - prefer container when available
let instance = null;

/**
 * Get the LearningFeedbackService singleton
 * Prefers container resolution, falls back to manual singleton
 * @param {Object} deps - Dependencies (only used if container unavailable)
 * @returns {LearningFeedbackService|null}
 */
function getInstance(deps = null) {
  // Try to resolve from container first
  try {
    const { container, ServiceIds } = require('../ServiceContainer');
    if (container && container.has(ServiceIds.LEARNING_FEEDBACK)) {
      return container.resolve(ServiceIds.LEARNING_FEEDBACK);
    }
  } catch {
    // Container not available, use manual singleton
  }

  // Fallback to manual singleton
  if (!instance && deps) {
    instance = new LearningFeedbackService(deps);
  }
  return instance;
}

/**
 * Reset the singleton (for testing)
 */
function resetInstance() {
  if (instance) {
    instance.shutdown();
    instance = null;
  }
}

module.exports = {
  LearningFeedbackService,
  FEEDBACK_SOURCES,
  getInstance,
  resetInstance,
  buildFileMetadata,
  buildFolderSuggestion
};
