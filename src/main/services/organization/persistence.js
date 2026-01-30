/**
 * Persistence
 *
 * User pattern persistence for organization service.
 * Supports dual-write to JSON and ChromaDB with migration tracking.
 *
 * @module services/organization/persistence
 */

const path = require('path');
const fs = require('fs').promises;
const { app } = require('electron');
const { logger: baseLogger, createLogger } = require('../../../shared/logger');
const { z } = require('zod');

const logger =
  typeof createLogger === 'function' ? createLogger('Organization:Persistence') : baseLogger;
if (typeof createLogger !== 'function' && logger?.setContext) {
  logger.setContext('Organization:Persistence');
}

// Metrics tracking for monitoring dual-write health
const metrics = {
  jsonWrites: 0,
  jsonReads: 0,
  chromaWrites: 0,
  chromaReads: 0,
  chromaWriteFailures: 0,
  chromaReadFailures: 0,
  migrationRuns: 0,
  lastSyncAt: null,
  lastError: null
};

/**
 * Get current metrics snapshot
 * @returns {Object} Metrics snapshot
 */
function getMetrics() {
  return { ...metrics };
}

/**
 * Reset metrics (for testing)
 */
function resetMetrics() {
  metrics.jsonWrites = 0;
  metrics.jsonReads = 0;
  metrics.chromaWrites = 0;
  metrics.chromaReads = 0;
  metrics.chromaWriteFailures = 0;
  metrics.chromaReadFailures = 0;
  metrics.migrationRuns = 0;
  metrics.lastSyncAt = null;
  metrics.lastError = null;
}

const patternEntrySchema = z.object({
  folder: z.string().optional(),
  path: z.string().optional(),
  count: z.number().optional(),
  confidence: z.number().optional(),
  lastUsed: z.number().optional(),
  createdAt: z.number().optional()
});

const feedbackEntrySchema = z.object({
  timestamp: z.number().optional(),
  accepted: z.boolean().optional(),
  file: z
    .object({
      name: z.string().optional(),
      type: z.string().optional()
    })
    .optional(),
  suggestion: z.object({}).passthrough().optional()
});

const patternsSchema = z.object({
  patterns: z.array(z.tuple([z.string(), patternEntrySchema])).optional(),
  feedbackHistory: z.array(feedbackEntrySchema).optional(),
  folderUsageStats: z
    .array(
      z.tuple([
        z.string(),
        z
          .object({
            count: z.number().optional(),
            lastUsed: z.number().optional()
          })
          .passthrough()
      ])
    )
    .optional(),
  lastUpdated: z.string().optional()
});

// ChromaDB pattern ID for learning patterns
const LEARNING_PATTERNS_ID = 'learning_patterns_v1';

/**
 * Persistence manager for user patterns
 * Supports dual-write to JSON (fallback) and ChromaDB (primary when enabled)
 */
class PatternPersistence {
  /**
   * @param {Object} options - Configuration
   * @param {string} options.filename - Patterns filename
   * @param {number} options.saveThrottleMs - Throttle interval for saves
   * @param {Object} options.chromaDbService - ChromaDB service for dual-write
   * @param {boolean} options.enableChromaSync - Enable ChromaDB dual-write
   * @param {boolean} options.enableChromaDryRun - Log Chroma operations without executing
   * @param {boolean} options.chromaPrimary - Use ChromaDB as primary read source
   */
  constructor(options = {}) {
    this.userDataPath = app.getPath('userData');
    this.patternsFilePath = path.join(this.userDataPath, options.filename || 'user-patterns.json');
    this.backupFilePath = path.join(this.userDataPath, 'user-patterns.backup.json');
    this.migrationMarkerPath = path.join(this.userDataPath, '.patterns-migrated');
    this.lastSaveTime = Date.now();
    this.saveThrottleMs = options.saveThrottleMs || 5000;
    this.pendingSave = null;
    // FIX: Store pending data to prevent stale data in throttled saves
    this._pendingSaveData = null;

    // ChromaDB dual-write configuration
    this.chromaDb = options.chromaDbService || null;
    this.enableChromaSync = options.enableChromaSync === true;
    this.enableChromaDryRun = options.enableChromaDryRun === true;
    this.chromaPrimary = options.chromaPrimary === true;

    // Migration state
    this._migrationChecked = false;
    this._migrationComplete = false;
  }

  /**
   * Check if migration has been completed (persistent marker)
   * @returns {Promise<boolean>}
   */
  async _isMigrationComplete() {
    if (this._migrationChecked) {
      return this._migrationComplete;
    }

    try {
      await fs.access(this.migrationMarkerPath);
      this._migrationComplete = true;
    } catch {
      this._migrationComplete = false;
    }

    this._migrationChecked = true;
    return this._migrationComplete;
  }

  /**
   * Mark migration as complete (persistent)
   * @returns {Promise<void>}
   */
  async _markMigrationComplete() {
    try {
      const marker = {
        migratedAt: new Date().toISOString(),
        version: 1,
        source: 'PatternPersistence'
      };
      await fs.writeFile(this.migrationMarkerPath, JSON.stringify(marker, null, 2));
      this._migrationComplete = true;
      logger.info('[Persistence] Migration marked complete');
    } catch (error) {
      logger.warn('[Persistence] Failed to write migration marker:', error.message);
    }
  }

  /**
   * Create a backup of the JSON file before migration
   * @returns {Promise<boolean>}
   */
  async _createBackup() {
    try {
      const data = await fs.readFile(this.patternsFilePath, 'utf-8');
      const backupPath = `${this.backupFilePath}.${Date.now()}`;
      await fs.writeFile(backupPath, data);
      logger.info('[Persistence] Created backup before migration', { backupPath });
      return true;
    } catch (error) {
      if (error.code === 'ENOENT') {
        logger.debug('[Persistence] No existing file to backup');
        return true; // No file to backup is OK
      }
      logger.warn('[Persistence] Failed to create backup:', error.message);
      return false;
    }
  }

  /**
   * Run one-time migration from JSON to ChromaDB
   * @param {Object} data - Pattern data to migrate
   * @returns {Promise<boolean>}
   */
  async _runMigration(data) {
    if (!this.chromaDb || !this.enableChromaSync) {
      return false;
    }

    const isMigrated = await this._isMigrationComplete();
    if (isMigrated) {
      logger.debug('[Persistence] Migration already complete, skipping');
      return true;
    }

    metrics.migrationRuns++;

    try {
      // Create backup before migration
      await this._createBackup();

      if (this.enableChromaDryRun) {
        logger.info('[Persistence] DRY-RUN migration to ChromaDB', {
          patternCount: data?.patterns?.length || 0,
          feedbackCount: data?.feedbackHistory?.length || 0,
          folderStatsCount: data?.folderUsageStats?.length || 0
        });
        return true;
      }

      // Upsert to ChromaDB
      await this.chromaDb.upsertLearningPatterns({
        id: LEARNING_PATTERNS_ID,
        patterns: data?.patterns || [],
        feedbackHistory: data?.feedbackHistory || [],
        folderUsageStats: data?.folderUsageStats || [],
        lastUpdated: data?.lastUpdated || new Date().toISOString()
      });

      // Mark migration complete
      await this._markMigrationComplete();

      metrics.chromaWrites++;
      metrics.lastSyncAt = new Date().toISOString();

      logger.info('[Persistence] Migration to ChromaDB complete', {
        patternCount: data?.patterns?.length || 0
      });

      return true;
    } catch (error) {
      metrics.chromaWriteFailures++;
      metrics.lastError = error.message;
      logger.warn('[Persistence] Migration to ChromaDB failed:', error.message);
      return false;
    }
  }

  /**
   * Load from ChromaDB (primary source when enabled)
   * @returns {Promise<Object|null>}
   */
  async _loadFromChroma() {
    if (!this.chromaDb || !this.enableChromaSync) {
      return null;
    }

    try {
      const chromaData = await this.chromaDb.getLearningPatterns(LEARNING_PATTERNS_ID);
      if (!chromaData) {
        return null;
      }

      metrics.chromaReads++;

      // Convert to expected format
      return {
        patterns: chromaData.patterns || [],
        feedbackHistory: chromaData.feedbackHistory || [],
        folderUsageStats: chromaData.folderUsageStats || [],
        lastUpdated: chromaData.lastUpdated
      };
    } catch (error) {
      metrics.chromaReadFailures++;
      metrics.lastError = error.message;
      logger.warn('[Persistence] Failed to load from ChromaDB:', error.message);
      return null;
    }
  }

  /**
   * Load from JSON file (fallback)
   * @returns {Promise<Object|null>}
   */
  async _loadFromJson() {
    try {
      const data = await fs.readFile(this.patternsFilePath, 'utf-8');
      const stored = JSON.parse(data);
      const parsed = patternsSchema.safeParse(stored);
      if (!parsed.success) {
        logger.warn('[Persistence] Invalid pattern data in JSON, starting fresh', {
          issues: parsed.error.issues?.length || 0
        });
        return null;
      }

      metrics.jsonReads++;
      return parsed.data;
    } catch (error) {
      if (error.code !== 'ENOENT') {
        logger.error('[Persistence] Error loading patterns from JSON:', {
          filePath: this.patternsFilePath,
          errorCode: error.code,
          errorMessage: error.message
        });
        throw error;
      }
      logger.debug('[Persistence] No patterns file found');
      return null;
    }
  }

  /**
   * Load user patterns from storage
   * Uses ChromaDB as primary when enabled, JSON as fallback
   * @returns {Promise<Object>} Stored data
   */
  async load() {
    // If ChromaDB is primary and enabled, try ChromaDB first
    if (this.chromaPrimary && this.enableChromaSync && this.chromaDb) {
      const chromaData = await this._loadFromChroma();
      if (chromaData) {
        logger.info('[Persistence] Loaded patterns from ChromaDB (primary)');
        return chromaData;
      }
      logger.debug('[Persistence] ChromaDB empty, falling back to JSON');
    }

    // Load from JSON (fallback or default)
    const jsonData = await this._loadFromJson();

    if (jsonData) {
      logger.info(`[Persistence] Loaded patterns from ${this.patternsFilePath}`);

      // Run migration if enabled and not yet done
      if (this.enableChromaSync && this.chromaDb) {
        await this._runMigration(jsonData);
      }

      return jsonData;
    }

    return null;
  }

  /**
   * Save to ChromaDB (dual-write)
   * @param {Object} data - Data to save
   * @returns {Promise<boolean>}
   */
  async _saveToChroma(data) {
    if (!this.chromaDb || !this.enableChromaSync) {
      return false;
    }

    try {
      if (this.enableChromaDryRun) {
        logger.info('[Persistence] DRY-RUN save to ChromaDB', {
          patternCount: data?.patterns?.length || 0,
          feedbackCount: data?.feedbackHistory?.length || 0,
          folderStatsCount: data?.folderUsageStats?.length || 0
        });
        return true;
      }

      await this.chromaDb.upsertLearningPatterns({
        id: LEARNING_PATTERNS_ID,
        patterns: data?.patterns || [],
        feedbackHistory: data?.feedbackHistory || [],
        folderUsageStats: data?.folderUsageStats || [],
        lastUpdated: data?.lastUpdated || new Date().toISOString()
      });

      metrics.chromaWrites++;
      metrics.lastSyncAt = new Date().toISOString();

      logger.debug('[Persistence] Saved patterns to ChromaDB');
      return true;
    } catch (error) {
      metrics.chromaWriteFailures++;
      metrics.lastError = error.message;
      logger.warn('[Persistence] Failed to save to ChromaDB:', error.message);
      return false;
    }
  }

  /**
   * Save user patterns to storage
   * Dual-writes to JSON and ChromaDB when enabled
   * @param {Object} data - Data to save
   * @returns {Promise<void>}
   */
  async save(data) {
    try {
      // Throttle saves
      const now = Date.now();
      if (now - this.lastSaveTime < this.saveThrottleMs) {
        // FIX: Always store the latest data, so throttled saves use the most recent version
        this._pendingSaveData = data;
        if (!this.pendingSave) {
          this.pendingSave = setTimeout(
            () => {
              this.pendingSave = null;
              // FIX: Use stored pending data instead of stale closure variable
              const dataToSave = this._pendingSaveData;
              this._pendingSaveData = null;
              if (dataToSave) {
                this.save(dataToSave);
              }
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
      // Clear pending data since we're saving now
      this._pendingSaveData = null;

      const saveData = {
        ...data,
        lastUpdated: new Date().toISOString()
      };

      // Ensure directory exists
      await fs.mkdir(path.dirname(this.patternsFilePath), { recursive: true });

      // Write atomically with temp file
      // FIX MED-24: Use random UUID for temp file to prevent collisions
      const randomId = require('crypto').randomUUID();
      const tempPath = `${this.patternsFilePath}.${randomId}.tmp`;
      const serialized = JSON.stringify(saveData, null, 2);
      await fs.writeFile(tempPath, serialized);
      const expectedSize = Buffer.byteLength(serialized);
      const tempStats = await fs.stat(tempPath);
      if (tempStats.size !== expectedSize) {
        throw new Error(
          `[Persistence] Atomic write size mismatch: expected ${expectedSize}, got ${tempStats.size}`
        );
      }
      await fs.rename(tempPath, this.patternsFilePath);

      metrics.jsonWrites++;
      logger.debug(`[Persistence] Saved patterns to ${this.patternsFilePath}`);

      // Dual-write to ChromaDB (non-blocking, failures logged but don't break JSON save)
      if (this.enableChromaSync && this.chromaDb) {
        this._saveToChroma(saveData).catch((err) =>
          logger.warn('[Persistence] ChromaDB dual-write failed:', err.message)
        );
      }

      return { success: true };
    } catch (error) {
      logger.error('[Persistence] Failed to save patterns:', error);
      // FIX: Clear pendingSave on error to prevent throttle logic from breaking
      this.pendingSave = null;
      return { success: false, error: error.message };
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
    this._pendingSaveData = null;
  }

  /**
   * Shutdown the persistence layer, flushing any pending saves before stopping
   * Should be called during application shutdown
   * FIX MED-1: Force save pending data on shutdown instead of discarding it
   * FIX CRIT-1: Prevent race condition by clearing _pendingSaveData before recursive save
   * @returns {Promise<void>}
   */
  async shutdown() {
    // Cancel the pending timeout to prevent double-save
    if (this.pendingSave) {
      clearTimeout(this.pendingSave);
      this.pendingSave = null;
    }

    // FIX CRIT-1: Capture and clear pending data BEFORE calling save to prevent
    // the recursive save() call from re-triggering throttle logic or resetting _pendingSaveData
    const dataToFlush = this._pendingSaveData;
    this._pendingSaveData = null;

    // FIX MED-1: If there's pending data, save it immediately before shutdown
    if (dataToFlush) {
      logger.info('[Persistence] Flushing pending save on shutdown');
      try {
        // Reset throttle time to allow immediate save
        this.lastSaveTime = 0;
        await this.save(dataToFlush);
      } catch (error) {
        logger.error('[Persistence] Failed to flush pending save on shutdown:', error.message);
      }
    }

    logger.debug('[Persistence] Shutdown complete');
  }
}

module.exports = {
  PatternPersistence,
  getMetrics,
  resetMetrics,
  LEARNING_PATTERNS_ID
};
