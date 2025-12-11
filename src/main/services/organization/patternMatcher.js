/**
 * Pattern Matcher
 *
 * User pattern matching and learning for organization suggestions.
 * Extracted from OrganizationSuggestionService for better maintainability.
 *
 * @module services/organization/patternMatcher
 */

const { logger } = require('../../../shared/logger');

logger.setContext('Organization:PatternMatcher');

/**
 * Pattern Matcher class for learning from user decisions
 */
class PatternMatcher {
  /**
   * @param {Object} config - Configuration
   * @param {number} config.maxUserPatterns - Max patterns to store
   * @param {number} config.maxMemoryMB - Max memory in MB
   * @param {number} config.patternSimilarityThreshold - Threshold for matching
   * @param {number} config.maxFeedbackHistory - Max feedback entries
   */
  constructor(config = {}) {
    this.userPatterns = new Map();
    this.feedbackHistory = [];
    this.folderUsageStats = new Map();

    this.maxUserPatterns = config.maxUserPatterns || 5000;
    this.maxMemoryMB = config.maxMemoryMB || 50;
    this.patternSimilarityThreshold = config.patternSimilarityThreshold || 0.5;
    this.maxFeedbackHistory = config.maxFeedbackHistory || 1000;
    this.memoryCheckInterval = 100;
    this.patternCount = 0;
  }

  /**
   * Load patterns from stored data
   * @param {Object} stored - Stored pattern data
   */
  loadPatterns(stored) {
    if (stored.patterns && Array.isArray(stored.patterns)) {
      this.userPatterns = new Map(stored.patterns);
      logger.info(`[PatternMatcher] Loaded ${this.userPatterns.size} user patterns`);
    }

    if (stored.feedbackHistory && Array.isArray(stored.feedbackHistory)) {
      this.feedbackHistory = stored.feedbackHistory;
    }

    if (stored.folderUsageStats && Array.isArray(stored.folderUsageStats)) {
      this.folderUsageStats = new Map(stored.folderUsageStats);
    }
  }

  /**
   * Export patterns for storage
   * @returns {Object} Serializable pattern data
   */
  exportPatterns() {
    return {
      patterns: Array.from(this.userPatterns.entries()),
      feedbackHistory: this.feedbackHistory.slice(-this.maxFeedbackHistory),
      folderUsageStats: Array.from(this.folderUsageStats.entries())
    };
  }

  /**
   * Get pattern-based suggestions from user history
   * @param {Object} file - File to match
   * @returns {Array} Pattern-based suggestions
   */
  getPatternBasedSuggestions(file) {
    const suggestions = [];

    for (const [pattern, data] of this.userPatterns) {
      const similarity = this.calculatePatternSimilarity(file, pattern);

      if (similarity > this.patternSimilarityThreshold) {
        suggestions.push({
          folder: data.folder,
          path: data.path,
          score: similarity * data.confidence,
          confidence: similarity * data.confidence,
          pattern: pattern,
          method: 'user_pattern',
          usageCount: data.count
        });
      }
    }

    return suggestions.sort((a, b) => b.score - a.score).slice(0, 3);
  }

  /**
   * Record user feedback for learning
   * @param {Object} file - File that was organized
   * @param {Object} suggestion - Suggestion that was used
   * @param {boolean} accepted - Whether suggestion was accepted
   */
  recordFeedback(file, suggestion, accepted) {
    const now = Date.now();

    // Prune old feedback entries (older than 90 days)
    const FEEDBACK_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
    if (this.feedbackHistory.length > 0) {
      const cutoffTime = now - FEEDBACK_RETENTION_MS;
      const originalLength = this.feedbackHistory.length;

      this.feedbackHistory = this.feedbackHistory.filter((entry) => entry.timestamp > cutoffTime);

      const pruned = originalLength - this.feedbackHistory.length;
      if (pruned > 0) {
        logger.debug(`[PatternMatcher] Pruned ${pruned} old feedback entries`);
      }
    }

    // Add new feedback
    this.feedbackHistory.push({
      timestamp: now,
      file: { name: file.name, type: file.extension },
      suggestion,
      accepted
    });

    // Update user patterns if accepted
    if (accepted && suggestion) {
      this._updatePattern(file, suggestion, now);
    }

    // Trim history if too large
    if (this.feedbackHistory.length > this.maxFeedbackHistory) {
      const excess = this.feedbackHistory.length - this.maxFeedbackHistory;
      this.feedbackHistory = this.feedbackHistory.slice(-this.maxFeedbackHistory);
      logger.debug(`[PatternMatcher] Trimmed ${excess} feedback entries`);
    }
  }

  /**
   * Update pattern from accepted suggestion
   * @private
   */
  _updatePattern(file, suggestion, now) {
    const pattern = this.extractPattern(file, suggestion);

    if (!this.userPatterns.has(pattern)) {
      // Check memory periodically
      this.patternCount++;
      if (this.patternCount % this.memoryCheckInterval === 0) {
        this.checkMemoryUsage();
      }

      // Prune if at capacity
      if (this.userPatterns.size >= this.maxUserPatterns) {
        this._prunePatterns(now);
      }

      // Add new pattern
      this.userPatterns.set(pattern, {
        folder: suggestion.folder,
        path: suggestion.path,
        count: 0,
        confidence: 0.5,
        lastUsed: now,
        createdAt: now
      });
    }

    // Update existing pattern
    const data = this.userPatterns.get(pattern);
    data.count++;
    data.confidence = Math.min(1.0, data.confidence + 0.1);
    data.lastUsed = now;
  }

  /**
   * Prune patterns when at capacity
   * @private
   */
  _prunePatterns(now) {
    const PATTERN_STALE_MS = 180 * 24 * 60 * 60 * 1000; // 6 months
    const staleThreshold = now - PATTERN_STALE_MS;

    // First remove stale patterns
    const patternsArray = Array.from(this.userPatterns.entries());
    const stalePatterns = patternsArray.filter(([, data]) => data.lastUsed < staleThreshold);

    if (stalePatterns.length > 0) {
      for (const [key] of stalePatterns) {
        this.userPatterns.delete(key);
      }
      logger.debug(`[PatternMatcher] Pruned ${stalePatterns.length} stale patterns`);
    }

    // If still at capacity, use LRU strategy
    if (this.userPatterns.size >= this.maxUserPatterns) {
      const remainingPatterns = Array.from(this.userPatterns.entries());

      // Sort by composite score with recency factor
      remainingPatterns.sort((a, b) => {
        const ageA = now - a[1].lastUsed;
        const ageB = now - b[1].lastUsed;
        const recencyFactorA = 1 / (1 + ageA / (30 * 24 * 60 * 60 * 1000));
        const recencyFactorB = 1 / (1 + ageB / (30 * 24 * 60 * 60 * 1000));

        const scoreA = a[1].count * a[1].confidence * recencyFactorA;
        const scoreB = b[1].count * b[1].confidence * recencyFactorB;
        return scoreA - scoreB;
      });

      // Remove bottom 10%
      const removeCount = Math.floor(this.maxUserPatterns * 0.1);
      for (let i = 0; i < removeCount; i++) {
        this.userPatterns.delete(remainingPatterns[i][0]);
      }
      logger.debug(`[PatternMatcher] Pruned ${removeCount} low-value patterns`);
    }
  }

  /**
   * Check memory usage and trigger eviction if needed
   */
  checkMemoryUsage() {
    try {
      const patternSize = JSON.stringify(Array.from(this.userPatterns.entries())).length;
      const estimatedMemoryMB = patternSize / (1024 * 1024);

      if (estimatedMemoryMB > this.maxMemoryMB) {
        logger.warn(
          `[PatternMatcher] Memory limit exceeded: ${estimatedMemoryMB.toFixed(2)}MB / ${this.maxMemoryMB}MB`
        );

        // Force aggressive eviction - remove 20% of patterns
        const patternsArray = Array.from(this.userPatterns.entries());
        const removeCount = Math.floor(this.userPatterns.size * 0.2);

        const now = Date.now();
        patternsArray.sort((a, b) => {
          const ageA = now - (a[1].lastUsed || 0);
          const ageB = now - (b[1].lastUsed || 0);
          const recencyFactorA = 1 / (1 + ageA / (30 * 24 * 60 * 60 * 1000));
          const recencyFactorB = 1 / (1 + ageB / (30 * 24 * 60 * 60 * 1000));

          const scoreA = (a[1].count || 0) * (a[1].confidence || 0.5) * recencyFactorA;
          const scoreB = (b[1].count || 0) * (b[1].confidence || 0.5) * recencyFactorB;
          return scoreA - scoreB;
        });

        for (let i = 0; i < removeCount; i++) {
          this.userPatterns.delete(patternsArray[i][0]);
        }

        logger.info(`[PatternMatcher] Evicted ${removeCount} patterns to free memory`);
      }
    } catch (error) {
      logger.error('[PatternMatcher] Error checking memory usage:', error);
    }
  }

  /**
   * Calculate similarity between file and stored pattern
   * @param {Object} file - File object
   * @param {string} pattern - Stored pattern string
   * @returns {number} Similarity score 0-1
   */
  calculatePatternSimilarity(file, pattern) {
    const filePattern = this.extractPattern(file);

    if (filePattern === pattern) return 1.0;

    const fileParts = filePattern.split(':');
    const patternParts = pattern.split(':');

    let matches = 0;
    for (let i = 0; i < Math.min(fileParts.length, patternParts.length); i++) {
      if (fileParts[i] === patternParts[i]) {
        matches++;
      }
    }

    return matches / Math.max(fileParts.length, patternParts.length);
  }

  /**
   * Extract pattern key from file
   * @param {Object} file - File object
   * @param {Object} suggestion - Optional suggestion
   * @returns {string} Pattern key
   */
  extractPattern(file, suggestion = null) {
    const parts = [
      file.extension,
      file.analysis?.category || 'unknown',
      suggestion?.folder || 'unknown'
    ];

    return parts.join(':').toLowerCase();
  }

  /**
   * Get folder usage count
   * @param {string} folderId - Folder ID or name
   * @returns {number} Usage count
   */
  getFolderUsage(folderId) {
    return this.folderUsageStats.get(folderId) || 0;
  }

  /**
   * Increment folder usage
   * @param {string} folderId - Folder ID or name
   */
  incrementFolderUsage(folderId) {
    const current = this.folderUsageStats.get(folderId) || 0;
    this.folderUsageStats.set(folderId, current + 1);
  }
}

module.exports = { PatternMatcher };
