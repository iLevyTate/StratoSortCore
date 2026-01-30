/**
 * Feedback Memory Store
 *
 * Persists natural-language feedback memories for recommendation tuning.
 * Supports dual-write to JSON and ChromaDB with ChromaDB-primary reads.
 *
 * @module services/organization/feedbackMemoryStore
 */

const path = require('path');
const fs = require('fs').promises;
const { app } = require('electron');
const { logger: baseLogger, createLogger } = require('../../../shared/logger');
const { z } = require('zod');

const logger =
  typeof createLogger === 'function'
    ? createLogger('Organization:FeedbackMemoryStore')
    : baseLogger;
if (typeof createLogger !== 'function' && logger?.setContext) {
  logger.setContext('Organization:FeedbackMemoryStore');
}

// Metrics tracking for monitoring dual-write health
const feedbackMetrics = {
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
  return { ...feedbackMetrics };
}

/**
 * Reset metrics (for testing)
 */
function resetMetrics() {
  feedbackMetrics.jsonWrites = 0;
  feedbackMetrics.jsonReads = 0;
  feedbackMetrics.chromaWrites = 0;
  feedbackMetrics.chromaReads = 0;
  feedbackMetrics.chromaWriteFailures = 0;
  feedbackMetrics.chromaReadFailures = 0;
  feedbackMetrics.migrationRuns = 0;
  feedbackMetrics.lastSyncAt = null;
  feedbackMetrics.lastError = null;
}

const feedbackEntrySchema = z
  .object({
    id: z.string(),
    text: z.string(),
    source: z.string().optional(),
    targetFolder: z.string().nullable().optional(),
    scope: z.object({}).passthrough().optional(),
    embeddingModel: z.string().optional(),
    createdAt: z.string().optional(),
    updatedAt: z.string().optional()
  })
  .passthrough();

class FeedbackMemoryStore {
  constructor(options = {}) {
    this.userDataPath = app.getPath('userData');
    this.filePath = path.join(this.userDataPath, options.filename || 'feedback-memory.json');
    this.backupFilePath = path.join(this.userDataPath, 'feedback-memory.backup.json');
    this.migrationMarkerPath = path.join(this.userDataPath, '.feedback-memory-migrated');
    this.saveThrottleMs = options.saveThrottleMs || 5000;
    this.lastSaveTime = Date.now();
    this.pendingSave = null;
    // FIX H-6: Flag to track if a save is needed after throttle expires
    this._needsSave = false;
    this._loaded = false;
    this._entries = [];
    this.chromaDb = options.chromaDbService || null;
    this.enableChromaSync = options.enableChromaSync === true;
    this.enableChromaDryRun = options.enableChromaDryRun === true;
    this.chromaPrimary = options.chromaPrimary === true;
    this._syncedToChroma = false;

    // Persistent migration state
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
        source: 'FeedbackMemoryStore'
      };
      await fs.writeFile(this.migrationMarkerPath, JSON.stringify(marker, null, 2));
      this._migrationComplete = true;
      logger.info('[FeedbackMemoryStore] Migration marked complete');
    } catch (error) {
      logger.warn('[FeedbackMemoryStore] Failed to write migration marker:', error.message);
    }
  }

  /**
   * Create a backup of the JSON file before migration
   * @returns {Promise<boolean>}
   */
  async _createBackup() {
    try {
      const data = await fs.readFile(this.filePath, 'utf-8');
      const backupPath = `${this.backupFilePath}.${Date.now()}`;
      await fs.writeFile(backupPath, data);
      logger.info('[FeedbackMemoryStore] Created backup before migration', { backupPath });
      return true;
    } catch (error) {
      if (error.code === 'ENOENT') {
        logger.debug('[FeedbackMemoryStore] No existing file to backup');
        return true;
      }
      logger.warn('[FeedbackMemoryStore] Failed to create backup:', error.message);
      return false;
    }
  }

  /**
   * Load from JSON file
   * @returns {Promise<Array>}
   */
  async _loadFromJson() {
    try {
      const data = await fs.readFile(this.filePath, 'utf-8');
      const parsed = JSON.parse(data);
      const items = Array.isArray(parsed?.items) ? parsed.items : [];
      const validated = [];
      let invalidCount = 0;
      for (const item of items) {
        const result = feedbackEntrySchema.safeParse(item);
        if (result.success) {
          validated.push(result.data);
        } else {
          invalidCount += 1;
        }
      }
      if (invalidCount > 0) {
        logger.warn('[FeedbackMemoryStore] Dropped invalid feedback entries', {
          invalidCount
        });
      }
      feedbackMetrics.jsonReads++;
      return validated;
    } catch (error) {
      if (error.code !== 'ENOENT') {
        logger.warn('[FeedbackMemoryStore] Failed to load JSON file:', error.message);
      }
      return [];
    }
  }

  /**
   * Load from ChromaDB (for ChromaDB-primary mode)
   *
   * ARCHITECTURE NOTE: ChromaDB is a vector database optimized for similarity queries,
   * not a key-value store. It does not support enumerating all items without a query embedding.
   *
   * For FeedbackMemoryStore, the architecture is:
   * - JSON file: Source of truth for the complete list of feedback entries
   * - ChromaDB: Optimized index for similarity-based feedback retrieval queries
   *
   * The chromaPrimary option is NOT supported for FeedbackMemoryStore because:
   * 1. ChromaDB cannot list all items without a query vector
   * 2. Feedback entries need full enumeration for display/management
   * 3. The dual-write pattern ensures ChromaDB stays in sync for query operations
   *
   * @returns {Promise<Array>} Always returns empty array - use JSON as source of truth
   */
  async _loadFromChroma() {
    if (!this.chromaDb) {
      return [];
    }

    // FIX CRITICAL-1: chromaPrimary is not architecturally supported for FeedbackMemoryStore
    // Always return empty to force JSON fallback. Log once per session to avoid spam.
    if (this.chromaPrimary && !this._chromaPrimaryWarningLogged) {
      this._chromaPrimaryWarningLogged = true;
      logger.warn(
        '[FeedbackMemoryStore] chromaPrimary mode is not fully supported. ' +
          'ChromaDB cannot enumerate all items without a query vector. ' +
          'JSON will be used as the source of truth; ChromaDB is used for similarity queries only.'
      );
    }

    feedbackMetrics.chromaReads++;
    // Always return empty - JSON is the source of truth for listing
    return [];
  }

  async load() {
    if (this._loaded) {
      return this._entries;
    }

    // If ChromaDB is primary, try it first (fallback to JSON if empty)
    if (this.chromaPrimary && this.enableChromaSync && this.chromaDb) {
      const chromaEntries = await this._loadFromChroma();
      if (Array.isArray(chromaEntries) && chromaEntries.length > 0) {
        this._entries = chromaEntries;
        this._loaded = true;
        logger.info('[FeedbackMemoryStore] Loaded feedback memory from ChromaDB (primary)', {
          count: chromaEntries.length
        });
        return this._entries;
      }
      logger.debug('[FeedbackMemoryStore] ChromaDB empty, falling back to JSON');
    }

    // Load from JSON (default/fallback)
    const jsonEntries = await this._loadFromJson();
    this._entries = jsonEntries;
    this._loaded = true;

    if (jsonEntries.length > 0) {
      logger.info('[FeedbackMemoryStore] Loaded feedback memory', { count: jsonEntries.length });
    }

    // Run migration to ChromaDB if enabled and not yet done
    if (this.enableChromaSync && this.chromaDb) {
      const isMigrated = await this._isMigrationComplete();
      if (!isMigrated) {
        feedbackMetrics.migrationRuns++;
        await this._createBackup();
        const syncResult = await this._syncAllToChroma();
        if (this.enableChromaDryRun) {
          logger.info('[FeedbackMemoryStore] Dry-run migration complete; marker not written');
        } else if (syncResult?.failCount > 0) {
          logger.warn('[FeedbackMemoryStore] Migration incomplete; marker not written', {
            successCount: syncResult.successCount,
            failCount: syncResult.failCount
          });
        } else {
          await this._markMigrationComplete();
        }
      } else {
        logger.debug('[FeedbackMemoryStore] Migration already complete, skipping sync');
      }
    }

    return this._entries;
  }

  async list() {
    await this.load();
    return this._entries.slice();
  }

  async add(entry, options = {}) {
    await this.load();
    this._entries.unshift(entry);
    if (this.enableChromaSync && !options.skipChromaSync) {
      this._upsertChroma(entry).catch((err) =>
        logger.warn('[FeedbackMemoryStore] Failed to sync feedback to Chroma', {
          error: err.message
        })
      );
    }
    await this._save();
    return entry;
  }

  async update(id, patch, options = {}) {
    await this.load();
    const index = this._entries.findIndex((item) => item.id === id);
    if (index === -1) {
      return null;
    }
    this._entries[index] = { ...this._entries[index], ...patch };
    if (this.enableChromaSync && !options.skipChromaSync) {
      this._upsertChroma(this._entries[index]).catch((err) =>
        logger.warn('[FeedbackMemoryStore] Failed to sync feedback update to Chroma', {
          error: err.message
        })
      );
    }
    await this._save();
    return this._entries[index];
  }

  async remove(id, options = {}) {
    await this.load();
    const originalLength = this._entries.length;
    this._entries = this._entries.filter((item) => item.id !== id);
    if (this._entries.length !== originalLength) {
      if (this.enableChromaSync && !options.skipChromaSync) {
        this._deleteChroma(id).catch((err) =>
          logger.warn('[FeedbackMemoryStore] Failed to delete feedback from Chroma', {
            error: err.message
          })
        );
      }
      await this._save();
      return true;
    }
    return false;
  }

  async _save() {
    const now = Date.now();
    if (now - this.lastSaveTime < this.saveThrottleMs) {
      // FIX H-6: Mark that a save is needed, so throttled callback uses current entries
      this._needsSave = true;
      if (!this.pendingSave) {
        this.pendingSave = setTimeout(
          () => {
            this.pendingSave = null;
            // FIX H-6: Only save if still needed (entries may have changed multiple times)
            if (this._needsSave) {
              this._save();
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
    // FIX H-6: Clear the needsSave flag since we're saving now
    this._needsSave = false;
    try {
      await fs.mkdir(path.dirname(this.filePath), { recursive: true });
      const payload = {
        items: this._entries,
        lastUpdated: new Date().toISOString()
      };
      const tempPath = `${this.filePath}.tmp`;
      await fs.writeFile(tempPath, JSON.stringify(payload, null, 2));
      await fs.rename(tempPath, this.filePath);
      feedbackMetrics.jsonWrites++;
      logger.debug('[FeedbackMemoryStore] Saved feedback memory');
    } catch (error) {
      logger.warn('[FeedbackMemoryStore] Failed to save memory file:', error.message);
      // FIX H-6: Clear pendingSave on error to allow future saves
      this.pendingSave = null;
    }
  }

  cancelPendingSave() {
    if (this.pendingSave) {
      clearTimeout(this.pendingSave);
      this.pendingSave = null;
    }
    this._needsSave = false;
  }

  /**
   * Upsert a feedback entry to ChromaDB
   *
   * FIX GAP-4: Uses dynamic placeholder vector dimension matching the collection
   * to avoid dimension mismatch errors when embedding models change.
   * Feedback entries are retrieved by ID or query embedding, so placeholder
   * vectors only need to match the collection's dimension.
   *
   * @private
   */
  async _upsertChroma(entry) {
    if (!this.chromaDb) return;
    if (this.enableChromaDryRun) {
      logger.info('[FeedbackMemoryStore] DRY-RUN upsert to Chroma', {
        id: entry.id,
        text: entry.text?.substring(0, 50),
        targetFolder: entry.targetFolder
      });
      return;
    }

    // FIX GAP-4: Determine placeholder dimension dynamically to match collection
    // This prevents dimension mismatch errors when embedding models change
    let placeholderDimension = 384; // Default fallback dimension

    try {
      // Try to get existing collection dimension from feedback collection
      if (typeof this.chromaDb.getCollectionDimension === 'function') {
        const existingDim = await this.chromaDb.getCollectionDimension('feedback', {
          skipCache: false
        });
        if (existingDim !== null && existingDim > 0) {
          placeholderDimension = existingDim;
        } else {
          // If feedback collection is empty, try to match files collection
          const filesDim = await this.chromaDb.getCollectionDimension('files');
          if (filesDim !== null && filesDim > 0) {
            placeholderDimension = filesDim;
          }
        }
      }
    } catch (dimError) {
      // Non-fatal - continue with default dimension
      logger.debug('[FeedbackMemoryStore] Could not determine collection dimension:', {
        error: dimError.message
      });
    }

    // Create placeholder vector with matching dimension
    const vector = new Array(placeholderDimension).fill(0);
    vector[0] = 1; // Ensure non-zero for validation

    const metadata = {
      source: entry.source || 'unknown',
      targetFolder: entry.targetFolder || null,
      createdAt: entry.createdAt || new Date().toISOString()
    };
    const document = entry.text || '';

    try {
      await this.chromaDb.upsertFeedbackMemory({
        id: entry.id,
        vector,
        metadata,
        document
      });
      feedbackMetrics.chromaWrites++;
      feedbackMetrics.lastSyncAt = new Date().toISOString();
      logger.debug('[FeedbackMemoryStore] Synced to ChromaDB', {
        id: entry.id,
        placeholderDimension
      });
    } catch (error) {
      feedbackMetrics.chromaWriteFailures++;
      feedbackMetrics.lastError = error.message;
      throw error;
    }
  }

  async _deleteChroma(id) {
    if (!this.chromaDb) return;
    if (this.enableChromaDryRun) {
      logger.info('[FeedbackMemoryStore] DRY-RUN delete from Chroma', { id });
      return;
    }
    await this.chromaDb.deleteFeedbackMemory(id);
  }

  async _syncAllToChroma() {
    if (!this.chromaDb) {
      return { successCount: 0, failCount: 0, attempted: 0, skipped: true };
    }

    // Use persistent marker instead of runtime flag
    const entries = this._entries;
    if (!entries || entries.length === 0) {
      logger.debug('[FeedbackMemoryStore] No entries to sync to ChromaDB');
      return { successCount: 0, failCount: 0, attempted: 0 };
    }

    logger.info('[FeedbackMemoryStore] Syncing all entries to ChromaDB', { count: entries.length });

    let successCount = 0;
    let failCount = 0;

    for (const entry of entries) {
      try {
        await this._upsertChroma(entry);
        successCount++;
      } catch (err) {
        failCount++;
        logger.warn('[FeedbackMemoryStore] Failed to sync entry to Chroma', {
          id: entry?.id,
          error: err.message
        });
      }
    }

    logger.info('[FeedbackMemoryStore] ChromaDB sync complete', { successCount, failCount });
    return { successCount, failCount, attempted: entries.length };
  }

  /**
   * Shutdown the store, flushing any pending saves before stopping
   * Should be called during application shutdown
   * FIX MED-1: Force save pending data on shutdown instead of discarding it
   * FIX MED-5: Ensure _save() actually completes before returning (bypass throttle)
   * @returns {Promise<void>}
   */
  async shutdown() {
    // Cancel the pending timeout to prevent double-save
    if (this.pendingSave) {
      clearTimeout(this.pendingSave);
      this.pendingSave = null;
    }

    // FIX MED-5: Capture the flag and clear it BEFORE saving to prevent race conditions
    const needsFlush = this._needsSave && this._loaded;
    this._needsSave = false;

    // FIX MED-1: If there's pending data to save, save it immediately before shutdown
    if (needsFlush) {
      logger.info('[FeedbackMemoryStore] Flushing pending save on shutdown');
      try {
        // Reset throttle time to allow immediate save (bypass throttle entirely)
        this.lastSaveTime = 0;
        // FIX MED-5: Call _save() which now won't defer since we reset lastSaveTime
        await this._save();
      } catch (error) {
        logger.error(
          '[FeedbackMemoryStore] Failed to flush pending save on shutdown:',
          error.message
        );
      }
    }

    logger.debug('[FeedbackMemoryStore] Shutdown complete');
  }
}

module.exports = {
  FeedbackMemoryStore,
  getMetrics,
  resetMetrics
};
