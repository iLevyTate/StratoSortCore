/**
 * Persistence
 *
 * User pattern persistence for organization service.
 * JSON-only storage with atomic writes and throttled saves.
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

// Metrics tracking for monitoring persistence health
const metrics = {
  jsonWrites: 0,
  jsonReads: 0,
  lastSyncAt: null,
  lastError: null
};

function getMetrics() {
  return { ...metrics };
}

function resetMetrics() {
  metrics.jsonWrites = 0;
  metrics.jsonReads = 0;
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

class PatternPersistence {
  constructor(options = {}) {
    this.userDataPath = app.getPath('userData');
    this.patternsFilePath = path.join(this.userDataPath, options.filename || 'user-patterns.json');
    this.backupFilePath = path.join(this.userDataPath, 'user-patterns.backup.json');
    this.lastSaveTime = Date.now();
    this.saveThrottleMs = options.saveThrottleMs || 5000;
    this.pendingSave = null;
    this._pendingSaveData = null;
  }

  async _loadFromJson() {
    try {
      const raw = await fs.readFile(this.patternsFilePath, 'utf-8');
      const parsed = JSON.parse(raw);
      const validated = patternsSchema.safeParse(parsed);
      if (!validated.success) {
        metrics.lastError = validated.error?.message;
        logger.warn('[Persistence] Invalid patterns schema; using empty defaults');
        return { patterns: [], feedbackHistory: [], folderUsageStats: [] };
      }
      metrics.jsonReads++;
      return {
        patterns: validated.data.patterns || [],
        feedbackHistory: validated.data.feedbackHistory || [],
        folderUsageStats: validated.data.folderUsageStats || [],
        lastUpdated: validated.data.lastUpdated
      };
    } catch (error) {
      if (error.code !== 'ENOENT') {
        metrics.lastError = error.message;
        logger.warn('[Persistence] Failed to load patterns:', error.message);
      }
      return null;
    }
  }

  async load() {
    const jsonData = await this._loadFromJson();
    if (jsonData) {
      logger.info(`[Persistence] Loaded patterns from ${this.patternsFilePath}`);
      return jsonData;
    }
    return null;
  }

  async save(data) {
    let tempPath;
    try {
      const now = Date.now();
      if (now - this.lastSaveTime < this.saveThrottleMs) {
        this._pendingSaveData = data;
        if (!this.pendingSave) {
          this.pendingSave = setTimeout(
            () => {
              this.pendingSave = null;
              const dataToSave = this._pendingSaveData;
              this._pendingSaveData = null;
              if (dataToSave) {
                this.save(dataToSave).catch((err) => {
                  logger.error('[Persistence] Deferred save failed:', err.message);
                });
              }
            },
            this.saveThrottleMs - (now - this.lastSaveTime)
          );
          if (typeof this.pendingSave.unref === 'function') {
            this.pendingSave.unref();
          }
        }
        return { success: true, throttled: true };
      }

      this.lastSaveTime = now;
      this._pendingSaveData = null;

      const saveData = {
        ...data,
        lastUpdated: new Date().toISOString()
      };

      await fs.mkdir(path.dirname(this.patternsFilePath), { recursive: true });
      const randomId = require('crypto').randomUUID();
      tempPath = `${this.patternsFilePath}.${randomId}.tmp`;
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
      metrics.lastSyncAt = new Date().toISOString();
      logger.debug(`[Persistence] Saved patterns to ${this.patternsFilePath}`);
      return { success: true };
    } catch (error) {
      metrics.lastError = error.message;
      logger.error('[Persistence] Failed to save patterns:', error);
      this.pendingSave = null;
      if (tempPath) {
        fs.unlink(tempPath).catch(() => {});
      }
      return { success: false, error: error.message };
    }
  }

  cancelPendingSave() {
    if (this.pendingSave) {
      clearTimeout(this.pendingSave);
      this.pendingSave = null;
    }
    this._pendingSaveData = null;
  }

  async shutdown() {
    if (this.pendingSave) {
      clearTimeout(this.pendingSave);
      this.pendingSave = null;
    }

    const dataToFlush = this._pendingSaveData;
    this._pendingSaveData = null;
    if (dataToFlush) {
      logger.info('[Persistence] Flushing pending save on shutdown');
      try {
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
  resetMetrics
};
