const fs = require('fs').promises;
const path = require('path');
const { app } = require('electron');
const { createLogger } = require('../../shared/logger');
const { isNotFoundError } = require('../../shared/errorClassifier');
const { RETRY } = require('../../shared/performanceConstants');

const logger = createLogger('ProcessingStateService');

// Cleanup thresholds: how long completed/failed entries are retained before eviction
const COMPLETED_TTL_MS = 30 * 60 * 1000; // 30 minutes for done entries
const FAILED_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours for failed entries
const SWEEP_INTERVAL_MS = 5 * 60 * 1000; // Run sweep every 5 minutes

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

    // Debounce persistence: coalesce rapid state transitions into a single disk write
    this._saveDebounceTimer = null;
    this._saveDebounceMs = 500;
    this._saveDebounceResolvers = [];

    // Track consecutive save failures for error monitoring
    this._consecutiveSaveFailures = 0;
    this._maxConsecutiveFailures = 3;
    this._lastSaveError = null;

    // Periodic cleanup interval reference (set during initialize, cleared on destroy)
    this._sweepInterval = null;
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

    // to prevent the promise reference from being nulled before callers can observe it.
    this._initPromise = this._doInitialize();
    try {
      return await this._initPromise;
    } finally {
      this._initPromise = null;
    }
  }

  /** @private */
  async _doInitialize() {
    try {
      await this.loadState();
      this.initialized = true;
      this._startSweepInterval();
    } catch {
      try {
        this.state = this.createEmptyState();
        await this._saveStateInternal();
        this.initialized = true;
        this._startSweepInterval();
      } catch (saveError) {
        logger.error('[ProcessingStateService] Failed to save initial state:', saveError.message);
        this.initialized = false;
        throw saveError;
      }
    }
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
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        const shapeError = new Error('Processing state has invalid shape');
        shapeError.code = 'INVALID_PROCESSING_STATE_SHAPE';
        throw shapeError;
      }
      this.state = parsed;
      if (!this.state.schemaVersion) {
        this.state.schemaVersion = this.SCHEMA_VERSION;
      }
    } catch (error) {
      if (isNotFoundError(error)) {
        this.state = this.createEmptyState();
      } else if (error instanceof SyntaxError || error?.code === 'INVALID_PROCESSING_STATE_SHAPE') {
        logger.warn(
          '[ProcessingStateService] Corrupted processing state detected, resetting file',
          {
            error: error?.message
          }
        );
        this.state = this.createEmptyState();
        try {
          await this._saveStateInternal();
        } catch (persistError) {
          logger.warn('[ProcessingStateService] Failed to persist reset processing state', {
            error: persistError?.message
          });
        }
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
    this.state.updatedAt = new Date().toISOString();

    // Debounce: coalesce rapid save calls into one disk write
    return new Promise((resolve) => {
      this._saveDebounceResolvers.push(resolve);
      if (this._saveDebounceTimer) clearTimeout(this._saveDebounceTimer);
      this._saveDebounceTimer = setTimeout(() => {
        this._saveDebounceTimer = null;
        this._flushSaveState();
      }, this._saveDebounceMs);
      // Allow the Node process to exit even if a debounced save is pending
      if (this._saveDebounceTimer?.unref) {
        this._saveDebounceTimer.unref();
      }
    });
  }

  /**
   * Immediately flush debounced save (used during shutdown)
   */
  async flushSaveState() {
    if (this._saveDebounceTimer) {
      clearTimeout(this._saveDebounceTimer);
      this._saveDebounceTimer = null;
    }
    if (this._saveDebounceResolvers.length > 0) {
      await this._flushSaveState();
    }
  }

  /** @private */
  async _flushSaveState() {
    const resolvers = this._saveDebounceResolvers;
    this._saveDebounceResolvers = [];

    // Capture state snapshot NOW
    const now = new Date().toISOString();
    this.state.updatedAt = now;
    let stateSnapshot;
    try {
      stateSnapshot = JSON.parse(JSON.stringify(this.state));
    } catch {
      const deepCopySafe = (obj) => {
        try {
          return JSON.parse(JSON.stringify(obj));
        } catch {
          if (typeof structuredClone === 'function') {
            try {
              return structuredClone(obj);
            } catch {
              return { ...(obj || {}) };
            }
          }
          return { ...(obj || {}) };
        }
      };
      stateSnapshot = {
        ...this.state,
        updatedAt: now,
        analysis: deepCopySafe(this.state.analysis),
        organize: deepCopySafe(this.state.organize)
      };
    }

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
      });

    await this._writeLock;
    for (const r of resolvers) r(saveResult);
    return saveResult;
  }

  // ===== Stale entry cleanup =====

  /**
   * Start the periodic sweep interval. Safe to call multiple times; only one
   * interval will be active at a time.
   * @private
   */
  _startSweepInterval() {
    if (this._sweepInterval) return;
    this._sweepInterval = setInterval(() => {
      this._sweepStaleEntries().catch((err) => {
        logger.error('[ProcessingStateService] Sweep failed:', err?.message);
      });
    }, SWEEP_INTERVAL_MS);
    // Allow the Node process to exit even if the interval is still running
    if (this._sweepInterval.unref) {
      this._sweepInterval.unref();
    }
  }

  /**
   * Remove analysis jobs and organize batches that have reached a terminal
   * state (done / failed) and are older than their respective TTL thresholds.
   * Only persists to disk when at least one entry was evicted.
   * @private
   */
  async _sweepStaleEntries() {
    if (!this.state) return;

    const now = Date.now();
    let evicted = 0;

    // --- Analysis jobs ---
    const jobs = this.state.analysis.jobs;
    for (const filePath of Object.keys(jobs)) {
      const job = jobs[filePath];
      if (job.status === 'done' || job.status === 'failed') {
        const timestamp = job.completedAt || job.startedAt;
        if (!timestamp) {
          // No timestamp at all -- treat as stale
          delete jobs[filePath];
          evicted++;
          continue;
        }
        const age = now - new Date(timestamp).getTime();
        const ttl = job.status === 'done' ? COMPLETED_TTL_MS : FAILED_TTL_MS;
        if (age > ttl) {
          delete jobs[filePath];
          evicted++;
        }
      }
    }

    // --- Organize batches ---
    const batches = this.state.organize.batches;
    for (const batchId of Object.keys(batches)) {
      const batch = batches[batchId];
      if (!batch.completedAt) continue; // Still in-progress -- keep

      const age = now - new Date(batch.completedAt).getTime();
      // Completed batches may contain failed ops; use the longer TTL
      const hasFailed =
        Array.isArray(batch.operations) && batch.operations.some((op) => op.status === 'failed');
      const ttl = hasFailed ? FAILED_TTL_MS : COMPLETED_TTL_MS;
      if (age > ttl) {
        delete batches[batchId];
        evicted++;
      }
    }

    if (evicted > 0) {
      logger.info(`[ProcessingStateService] Swept ${evicted} stale entries`);
      this.state.analysis.lastUpdated = new Date().toISOString();
      this.state.organize.lastUpdated = this.state.analysis.lastUpdated;
      await this.saveState();
    }
  }

  /**
   * Shutdown hook for ServiceContainer compatibility.
   * ServiceContainer calls shutdown() during coordinated teardown.
   */
  async shutdown() {
    await this.destroy();
  }

  /**
   * Tear down the service: stop the periodic sweep and run a final cleanup.
   * Safe to call multiple times.
   */
  async destroy() {
    if (this._sweepInterval) {
      clearInterval(this._sweepInterval);
      this._sweepInterval = null;
    }
    // Flush any pending debounced saves before shutdown
    await this.flushSaveState();
    // Final sweep before shutdown so stale entries do not persist on disk
    try {
      await this._sweepStaleEntries();
    } catch {
      // Best-effort during shutdown
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
    const result = await this.saveState();
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

  /**
   * Move a job entry from one file path to another
   * FIX: Provides a safe API for path updates that go through saveState's
   * write lock, instead of external callers mutating state.analysis.jobs directly.
   * @param {string} oldPath - Original file path
   * @param {string} newPath - New file path
   */
  async moveJob(oldPath, newPath) {
    await this.initialize();
    const job = this.state.analysis.jobs[oldPath];
    if (job) {
      this.state.analysis.jobs[newPath] = { ...job, movedFrom: oldPath };
      delete this.state.analysis.jobs[oldPath];
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
    if (!batch?.operations || index < 0 || index >= batch.operations.length) return;
    batch.operations[index].status = 'in_progress';
    batch.operations[index].error = null;
    this.state.organize.lastUpdated = new Date().toISOString();
    await this.saveState();
  }

  async markOrganizeOpDone(batchId, index, updatedOp = null) {
    await this.initialize();
    const batch = this.state.organize.batches[batchId];
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
