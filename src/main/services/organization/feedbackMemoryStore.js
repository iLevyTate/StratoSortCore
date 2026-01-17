/**
 * Feedback Memory Store
 *
 * Persists natural-language feedback memories for recommendation tuning.
 *
 * @module services/organization/feedbackMemoryStore
 */

const path = require('path');
const fs = require('fs').promises;
const { app } = require('electron');
const { logger } = require('../../../shared/logger');

logger.setContext('Organization:FeedbackMemoryStore');

class FeedbackMemoryStore {
  constructor(options = {}) {
    this.userDataPath = app.getPath('userData');
    this.filePath = path.join(this.userDataPath, options.filename || 'feedback-memory.json');
    this.saveThrottleMs = options.saveThrottleMs || 5000;
    this.lastSaveTime = Date.now();
    this.pendingSave = null;
    this._loaded = false;
    this._entries = [];
  }

  async load() {
    if (this._loaded) {
      return this._entries;
    }
    try {
      const data = await fs.readFile(this.filePath, 'utf-8');
      const parsed = JSON.parse(data);
      this._entries = Array.isArray(parsed?.items) ? parsed.items : [];
      this._loaded = true;
      logger.info('[FeedbackMemoryStore] Loaded feedback memory');
      return this._entries;
    } catch (error) {
      if (error.code !== 'ENOENT') {
        logger.warn('[FeedbackMemoryStore] Failed to load memory file:', error.message);
      }
      this._entries = [];
      this._loaded = true;
      return this._entries;
    }
  }

  async list() {
    await this.load();
    return this._entries.slice();
  }

  async add(entry) {
    await this.load();
    this._entries.unshift(entry);
    await this._save();
    return entry;
  }

  async update(id, patch) {
    await this.load();
    const index = this._entries.findIndex((item) => item.id === id);
    if (index === -1) {
      return null;
    }
    this._entries[index] = { ...this._entries[index], ...patch };
    await this._save();
    return this._entries[index];
  }

  async remove(id) {
    await this.load();
    const originalLength = this._entries.length;
    this._entries = this._entries.filter((item) => item.id !== id);
    if (this._entries.length !== originalLength) {
      await this._save();
      return true;
    }
    return false;
  }

  async _save() {
    const now = Date.now();
    if (now - this.lastSaveTime < this.saveThrottleMs) {
      if (!this.pendingSave) {
        this.pendingSave = setTimeout(
          () => {
            this.pendingSave = null;
            this._save();
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
    try {
      await fs.mkdir(path.dirname(this.filePath), { recursive: true });
      const payload = {
        items: this._entries,
        lastUpdated: new Date().toISOString()
      };
      const tempPath = `${this.filePath}.tmp`;
      await fs.writeFile(tempPath, JSON.stringify(payload, null, 2));
      await fs.rename(tempPath, this.filePath);
      logger.debug('[FeedbackMemoryStore] Saved feedback memory');
    } catch (error) {
      logger.warn('[FeedbackMemoryStore] Failed to save memory file:', error.message);
    }
  }

  cancelPendingSave() {
    if (this.pendingSave) {
      clearTimeout(this.pendingSave);
      this.pendingSave = null;
    }
  }
}

module.exports = { FeedbackMemoryStore };
