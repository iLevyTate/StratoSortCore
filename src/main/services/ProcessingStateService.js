const fs = require('fs').promises;
const path = require('path');
const { app } = require('electron');
// FIX: Add logger for error reporting
const { logger } = require('../../shared/logger');
const { isNotFoundError } = require('../../shared/errorClassifier');
const { RETRY } = require('../../shared/performanceConstants');

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

    // Track consecutive save failures for error monitoring
    this._consecutiveSaveFailures = 0;
    this._maxConsecutiveFailures = 3;
    // FIX: Track last save error so callers can check if save failed
    this._lastSaveError = null;
  }

  /**
   * Get last save error (null if last save succeeded)
   * FIX: Allows callers to check if saves are working without breaking the silent-failure pattern
   * @returns {Error|null}
   */
  getLastSaveError() {
    return this._lastSaveError;
  }

  /**
   * Check if saves are healthy (no recent failures)
   * @returns {boolean}
   */
  isSaveHealthy() {
    return this._consecutiveSaveFailures === 0;
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
      } catch {
        // FIX: Wrap fallback logic in try-catch to handle save failures
        try {
          this.state = this.createEmptyState();
          await this._saveStateInternal(); // Use internal method to avoid double-locking
          this.initialized = true;
          // FIX CRIT-32: Explicitly reset initialized flag on failure
        } catch (saveError) {
          // FIX: Clear _initPromise so next call can retry
          logger.error('[ProcessingStateService] Failed to save initial state:', saveError.message);
          this._initPromise = null;
          this.initialized = false;
          throw saveError;
        }
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
      if (isNotFoundError(error)) {
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
    await this._performAtomicWrite(this.state);
  }

  async _performAtomicWrite(stateSnapshot) {
    await this.ensureParentDirectory(this.statePath);
    const tempPath = `${this.statePath}.tmp.${Date.now()}.${Math.random().toString(36).slice(2)}`;
    try {
      await fs.writeFile(tempPath, JSON.stringify(stateSnapshot, null, 2));
      // Retry rename on Windows EPERM errors (file handle race condition)
      let lastError;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          await fs.rename(tempPath, this.statePath);
          return; // Success
        } catch (renameError) {
          lastError = renameError;
          if (renameError.code === 'EPERM' && attempt < 2) {
            await new Promise((resolve) =>
              setTimeout(resolve, RETRY.ATOMIC_BACKOFF_STEP_MS * (attempt + 1))
            );
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

  _handleSaveSuccess() {
    this._consecutiveSaveFailures = 0;
    this._lastSaveError = null;
    return { success: true };
  }

  _handleSaveFailure(err) {
    this._consecutiveSaveFailures++;
    this._lastSaveError = err;
    logger.error('[ProcessingStateService] Save failed:', {
      error: err?.message,
      consecutiveFailures: this._consecutiveSaveFailures
    });
    if (this._consecutiveSaveFailures >= this._maxConsecutiveFailures) {
      logger.error(
        '[ProcessingStateService] CRITICAL: Multiple consecutive save failures - state persistence may be compromised'
      );
    }
    return { success: false, error: err?.message };
  }

  /**
   * Save state with write lock to prevent concurrent writes
   * Race condition fix: Captures state snapshot before chaining to prevent
   * state mutations between queue and save
   */
  async saveState() {
    // Update the state timestamp immediately (for callers that check it)
    const now = new Date().toISOString();
    this.state.updatedAt = now;

    // Capture state snapshot NOW, before waiting for lock
    // This ensures we save the state as it was when saveState was called
    const stateSnapshot = JSON.parse(JSON.stringify(this.state));

    // Chain this save after any pending saves complete
    const saveOperation = async () => this._performAtomicWrite(stateSnapshot);

    let saveResult = { success: true };
    this._writeLock = this._writeLock
      .then(() => saveOperation())
      .then(() => {
        saveResult = this._handleSaveSuccess();
      })
      .catch((err) => {
        saveResult = this._handleSaveFailure(err);
        // NOTE: Error is intentionally NOT re-thrown to maintain backward compatibility.
        // Callers can use getLastSaveError() or isSaveHealthy() to check save status.
      });

    return this._writeLock.then(() => saveResult);
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
    const result = await this.saveState();
    // FIX HIGH-73: Log error if saveState fails (silent error fix)
    if (!result.success) {
      logger.error('[ProcessingStateService] Failed to save analysis error state:', result.error);
    }
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
    // FIX: Add bounds checking to prevent TypeError on invalid index
    if (!batch?.operations || index < 0 || index >= batch.operations.length) return;
    batch.operations[index].status = 'in_progress';
    batch.operations[index].error = null;
    this.state.organize.lastUpdated = new Date().toISOString();
    await this.saveState();
  }

  async markOrganizeOpDone(batchId, index, updatedOp = null) {
    await this.initialize();
    const batch = this.state.organize.batches[batchId];
    // FIX: Add bounds checking to prevent TypeError on invalid index
    if (!batch?.operations || index < 0 || index >= batch.operations.length) return;
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
    // FIX: Add bounds checking to prevent TypeError on invalid index
    if (!batch?.operations || index < 0 || index >= batch.operations.length) return;
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
