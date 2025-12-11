const fs = require('fs').promises;
const path = require('path');
const { app } = require('electron');
// FIX: Add logger for error reporting
const { logger } = require('../../shared/logger');
logger.setContext('ProcessingStateService');

/**
 * ProcessingStateService
 * - Persists analysis jobs and organize batches to disk so work can resume after crashes/restarts
 */
class ProcessingStateService {
  constructor() {
    this.userDataPath = app.getPath('userData');
    this.statePath = path.join(this.userDataPath, 'processing-state.json');
    this.state = null;
    this.initialized = false;
    this.SCHEMA_VERSION = '1.0.0';

    // Fixed: Add mutexes to prevent race conditions
    this._initPromise = null;
    this._writeLock = Promise.resolve();
  }

  async ensureParentDirectory(filePath) {
    const parentDirectory = path.dirname(filePath);
    await fs.mkdir(parentDirectory, { recursive: true });
  }

  async initialize() {
    // Fixed: Use initialization promise to prevent race conditions
    if (this._initPromise) {
      return this._initPromise;
    }

    if (this.initialized) {
      return Promise.resolve();
    }

    this._initPromise = (async () => {
      try {
        await this.loadState();
        this.initialized = true;
      } catch (error) {
        this.state = this.createEmptyState();
        await this._saveStateInternal(); // Use internal method to avoid double-locking
        this.initialized = true;
      }
    })();

    return this._initPromise;
  }

  createEmptyState() {
    const now = new Date().toISOString();
    return {
      schemaVersion: this.SCHEMA_VERSION,
      createdAt: now,
      updatedAt: now,
      analysis: {
        jobs: {}, // key: filePath, value: { status: 'pending'|'in_progress'|'done'|'failed', startedAt, completedAt, error }
        lastUpdated: now
      },
      organize: {
        batches: {}, // key: batchId, value: { id, operations: [{ source, destination, status, error }], startedAt, completedAt }
        lastUpdated: now
      }
    };
  }

  async loadState() {
    try {
      const raw = await fs.readFile(this.statePath, 'utf8');
      this.state = JSON.parse(raw);
      if (!this.state.schemaVersion) {
        this.state.schemaVersion = this.SCHEMA_VERSION;
      }
    } catch (error) {
      if (error.code === 'ENOENT') {
        this.state = this.createEmptyState();
      } else {
        throw error;
      }
    }
  }

  /**
   * Internal save method without locking (for use within locked contexts)
   * @private
   */
  async _saveStateInternal() {
    this.state.updatedAt = new Date().toISOString();
    await this.ensureParentDirectory(this.statePath);
    // FIX: Use atomic write (temp + rename) to prevent corruption on crash
    const tempPath = `${this.statePath}.tmp.${Date.now()}`;
    try {
      await fs.writeFile(tempPath, JSON.stringify(this.state, null, 2));
      // Retry rename on Windows EPERM errors (file handle race condition)
      let lastError;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          await fs.rename(tempPath, this.statePath);
          return; // Success
        } catch (renameError) {
          lastError = renameError;
          if (renameError.code === 'EPERM' && attempt < 2) {
            await new Promise((resolve) => setTimeout(resolve, 50 * (attempt + 1)));
            continue;
          }
          throw renameError;
        }
      }
      throw lastError;
    } catch (error) {
      // Clean up temp file on failure
      try {
        await fs.unlink(tempPath);
      } catch {
        // Ignore cleanup errors
      }
      throw error;
    }
  }

  /**
   * Save state with write lock to prevent concurrent writes
   */
  async saveState() {
    const previousLock = this._writeLock;

    // Wait for previous lock to complete (ignore its errors)
    await previousLock.catch(() => {});

    // Create save operation and update the lock chain
    const savePromise = this._saveStateInternal();
    this._writeLock = savePromise.catch(() => {
      // Swallow error to keep chain alive for next operation
    });

    try {
      return await savePromise;
    } catch (error) {
      logger.error('[ProcessingStateService] Save failed', {
        error: error?.message
      });
      throw error;
    }
  }

  // ===== Analysis tracking =====
  async markAnalysisStart(filePath) {
    await this.initialize();
    const now = new Date().toISOString();
    this.state.analysis.jobs[filePath] = {
      ...(this.state.analysis.jobs[filePath] || {}),
      status: 'in_progress',
      startedAt: now,
      completedAt: null,
      error: null
    };
    this.state.analysis.lastUpdated = now;
    await this.saveState();
  }

  async markAnalysisComplete(filePath) {
    await this.initialize();
    const now = new Date().toISOString();
    this.state.analysis.jobs[filePath] = {
      ...(this.state.analysis.jobs[filePath] || {}),
      status: 'done',
      completedAt: now,
      error: null
    };
    this.state.analysis.lastUpdated = now;
    await this.saveState();
  }

  async markAnalysisError(filePath, errorMessage) {
    await this.initialize();
    const now = new Date().toISOString();
    this.state.analysis.jobs[filePath] = {
      ...(this.state.analysis.jobs[filePath] || {}),
      status: 'failed',
      completedAt: now,
      error: errorMessage || 'Unknown analysis error'
    };
    this.state.analysis.lastUpdated = now;
    await this.saveState();
  }

  getIncompleteAnalysisJobs() {
    if (!this.state) return [];
    return Object.entries(this.state.analysis.jobs)
      .filter(([, j]) => j.status === 'in_progress' || j.status === 'pending')
      .map(([filePath, j]) => ({ filePath, ...j }));
  }

  /**
   * Get the current state of an analysis job
   * @param {string} filePath - Path to the file
   * @returns {string|null} The status ('pending', 'in_progress', 'done', 'failed') or null if not found
   */
  getState(filePath) {
    if (!this.state || !this.state.analysis.jobs[filePath]) {
      return null;
    }
    return this.state.analysis.jobs[filePath].status;
  }

  /**
   * Clear/remove an analysis job from tracking
   * @param {string} filePath - Path to the file
   */
  async clearState(filePath) {
    await this.initialize();
    if (this.state.analysis.jobs[filePath]) {
      delete this.state.analysis.jobs[filePath];
      this.state.analysis.lastUpdated = new Date().toISOString();
      await this.saveState();
    }
  }

  // ===== Organize batch tracking =====
  async createOrLoadOrganizeBatch(batchId, operations) {
    await this.initialize();
    const now = new Date().toISOString();
    if (!this.state.organize.batches[batchId]) {
      this.state.organize.batches[batchId] = {
        id: batchId,
        operations: operations.map((op) => ({
          ...op,
          status: 'pending',
          error: null
        })),
        startedAt: now,
        completedAt: null
      };
      this.state.organize.lastUpdated = now;
      await this.saveState();
    }
    return this.state.organize.batches[batchId];
  }

  async markOrganizeOpStarted(batchId, index) {
    await this.initialize();
    const batch = this.state.organize.batches[batchId];
    if (!batch) return;
    batch.operations[index].status = 'in_progress';
    batch.operations[index].error = null;
    this.state.organize.lastUpdated = new Date().toISOString();
    await this.saveState();
  }

  async markOrganizeOpDone(batchId, index, updatedOp = null) {
    await this.initialize();
    const batch = this.state.organize.batches[batchId];
    if (!batch) return;
    if (updatedOp) {
      batch.operations[index] = { ...batch.operations[index], ...updatedOp };
    }
    batch.operations[index].status = 'done';
    batch.operations[index].error = null;
    this.state.organize.lastUpdated = new Date().toISOString();
    await this.saveState();
  }

  async markOrganizeOpError(batchId, index, errorMessage) {
    await this.initialize();
    const batch = this.state.organize.batches[batchId];
    if (!batch) return;
    batch.operations[index].status = 'failed';
    batch.operations[index].error = errorMessage || 'Unknown organize error';
    this.state.organize.lastUpdated = new Date().toISOString();
    await this.saveState();
  }

  async completeOrganizeBatch(batchId) {
    await this.initialize();
    const batch = this.state.organize.batches[batchId];
    if (!batch) return;
    batch.completedAt = new Date().toISOString();
    this.state.organize.lastUpdated = batch.completedAt;
    await this.saveState();
  }

  getIncompleteOrganizeBatches() {
    if (!this.state) return [];
    return Object.values(this.state.organize.batches).filter((batch) => !batch.completedAt);
  }
}

module.exports = ProcessingStateService;
