/**
 * Persistence
 *
 * User pattern persistence for organization service.
 * Extracted from OrganizationSuggestionService for better maintainability.
 *
 * @module services/organization/persistence
 */

const path = require('path');
const fs = require('fs').promises;
const { app } = require('electron');
const { logger } = require('../../../shared/logger');

logger.setContext('Organization:Persistence');

/**
 * Persistence manager for user patterns
 */
class PatternPersistence {
  /**
   * @param {Object} options - Configuration
   * @param {string} options.filename - Patterns filename
   * @param {number} options.saveThrottleMs - Throttle interval for saves
   */
  constructor(options = {}) {
    this.userDataPath = app.getPath('userData');
    this.patternsFilePath = path.join(this.userDataPath, options.filename || 'user-patterns.json');
    this.lastSaveTime = Date.now();
    this.saveThrottleMs = options.saveThrottleMs || 5000;
    this.pendingSave = null;
  }

  /**
   * Load user patterns from storage
   * @returns {Promise<Object>} Stored data
   */
  async load() {
    try {
      const data = await fs.readFile(this.patternsFilePath, 'utf-8');
      const stored = JSON.parse(data);

      logger.info(`[Persistence] Loaded patterns from ${this.patternsFilePath}`);
      return stored;
    } catch (error) {
      if (error.code !== 'ENOENT') {
        logger.error('[Persistence] Error loading patterns:', {
          filePath: this.patternsFilePath,
          errorCode: error.code,
          errorMessage: error.message
        });
        throw error;
      }
      logger.debug('[Persistence] No patterns file found, starting fresh');
      return null;
    }
  }

  /**
   * Save user patterns to storage
   * @param {Object} data - Data to save
   * @returns {Promise<void>}
   */
  async save(data) {
    try {
      // Throttle saves
      const now = Date.now();
      if (now - this.lastSaveTime < this.saveThrottleMs) {
        if (!this.pendingSave) {
          this.pendingSave = setTimeout(
            () => {
              this.pendingSave = null;
              this.save(data);
            },
            this.saveThrottleMs - (now - this.lastSaveTime)
          );

          if (typeof this.pendingSave.unref === 'function') {
            this.pendingSave.unref();
          }
        }
        return;
      }

      this.lastSaveTime = now;

      const saveData = {
        ...data,
        lastUpdated: new Date().toISOString()
      };

      // Ensure directory exists
      await fs.mkdir(path.dirname(this.patternsFilePath), { recursive: true });

      // Write atomically with temp file
      const tempPath = `${this.patternsFilePath}.tmp`;
      await fs.writeFile(tempPath, JSON.stringify(saveData, null, 2));
      await fs.rename(tempPath, this.patternsFilePath);

      logger.debug(`[Persistence] Saved patterns to ${this.patternsFilePath}`);
    } catch (error) {
      logger.error('[Persistence] Failed to save patterns:', error);
    }
  }

  /**
   * Cancel any pending save
   */
  cancelPendingSave() {
    if (this.pendingSave) {
      clearTimeout(this.pendingSave);
      this.pendingSave = null;
    }
  }
}

module.exports = { PatternPersistence };
