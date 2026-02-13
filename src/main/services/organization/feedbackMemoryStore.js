/**
 * Feedback Memory Store
 *
 * Persists natural-language feedback memories for recommendation tuning.
 * JSON-only storage with throttled saves.
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

const feedbackMetrics = {
  jsonWrites: 0,
  jsonReads: 0,
  lastSyncAt: null,
  lastError: null
};

function getMetrics() {
  return { ...feedbackMetrics };
}

function resetMetrics() {
  feedbackMetrics.jsonWrites = 0;
  feedbackMetrics.jsonReads = 0;
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
    this.saveThrottleMs = options.saveThrottleMs || 5000;
    // Start at 0 so the first save is never throttled.
    this.lastSaveTime = 0;
    this.pendingSave = null;
    this._needsSave = false;
    this._loaded = false;
    this._entries = [];
    this._saving = false;
    this._pendingSaveWaiters = [];
  }

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
        feedbackMetrics.lastError = error.message;
        logger.warn('[FeedbackMemoryStore] Failed to load JSON file:', error.message);
      }
      return [];
    }
  }

  async load() {
    if (this._loaded) return this._entries;
    this._entries = await this._loadFromJson();
    this._loaded = true;
    return this._entries;
  }

  async list() {
    await this.load();
    return this._entries.slice();
  }

  async add(entry, options = {}) {
    await this.load();
    this._entries.unshift(entry);
    await this._save(options);
    return entry;
  }

  async update(id, patch, options = {}) {
    await this.load();
    const index = this._entries.findIndex((item) => item.id === id);
    if (index === -1) return null;
    this._entries[index] = { ...this._entries[index], ...patch };
    await this._save(options);
    return this._entries[index];
  }

  async remove(id, options = {}) {
    await this.load();
    const originalLength = this._entries.length;
    this._entries = this._entries.filter((item) => item.id !== id);
    if (this._entries.length !== originalLength) {
      await this._save(options);
      return true;
    }
    return false;
  }

  _enqueueSaveWaiter() {
    return new Promise((resolve) => {
      this._pendingSaveWaiters.push(resolve);
    });
  }

  _resolveSaveWaiters(result) {
    if (this._pendingSaveWaiters.length === 0) return;
    const waiters = this._pendingSaveWaiters;
    this._pendingSaveWaiters = [];
    for (const resolve of waiters) {
      try {
        resolve(result);
      } catch {
        // Ignore waiter callback errors.
      }
    }
  }

  async _save(options = {}) {
    const waitForFlush = options.waitForFlush === true;

    if (this._saving) {
      this._needsSave = true;
      return waitForFlush ? this._enqueueSaveWaiter() : { success: true, queued: true };
    }

    const now = Date.now();
    if (now - this.lastSaveTime < this.saveThrottleMs) {
      this._needsSave = true;
      const flushWaiter = waitForFlush ? this._enqueueSaveWaiter() : null;
      if (!this.pendingSave) {
        this.pendingSave = setTimeout(
          () => {
            this.pendingSave = null;
            if (this._needsSave) {
              void this._save();
            } else {
              this._resolveSaveWaiters({ success: true, skipped: true });
            }
          },
          this.saveThrottleMs - (now - this.lastSaveTime)
        );
        if (typeof this.pendingSave.unref === 'function') {
          this.pendingSave.unref();
        }
      }
      return flushWaiter || { success: true, throttled: true };
    }

    this.lastSaveTime = now;
    this._needsSave = false;
    this._saving = true;
    let saveResult = { success: true };

    try {
      await fs.mkdir(path.dirname(this.filePath), { recursive: true });
      const payload = {
        items: this._entries,
        lastUpdated: new Date().toISOString()
      };
      const tempPath = `${this.filePath}.${Date.now()}.tmp`;
      await fs.writeFile(tempPath, JSON.stringify(payload, null, 2));
      await fs.rename(tempPath, this.filePath);
      feedbackMetrics.jsonWrites++;
      feedbackMetrics.lastSyncAt = new Date().toISOString();
      logger.debug('[FeedbackMemoryStore] Saved feedback memory');
    } catch (error) {
      feedbackMetrics.lastError = error.message;
      logger.warn('[FeedbackMemoryStore] Failed to save feedback memory:', error.message);
      saveResult = { success: false, error: error.message };
    } finally {
      this._saving = false;
      if (this._needsSave) {
        void this._save();
      } else {
        this._resolveSaveWaiters(saveResult);
      }
    }

    return saveResult;
  }

  async shutdown() {
    if (this.pendingSave) {
      clearTimeout(this.pendingSave);
      this.pendingSave = null;
    }
    if (this._needsSave) {
      this.lastSaveTime = 0;
      await this._save();
    } else {
      this._resolveSaveWaiters({ success: true, skipped: true });
    }
    logger.debug('[FeedbackMemoryStore] Shutdown complete');
  }
}

module.exports = {
  FeedbackMemoryStore,
  getMetrics,
  resetMetrics
};
