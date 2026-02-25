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
const READY_ENTRY_TTL_MS = 14 * 24 * 60 * 60 * 1000; // 14 days for durable ready queue entries
const MAX_READY_ENTRIES = 2000; // Hard ceiling to prevent unbounded queue growth
const DEFAULT_READY_QUERY_LIMIT = 1000; // Cap IPC hydration payload size by default
const SWEEP_INTERVAL_MS = 5 * 60 * 1000; // Run sweep every 5 minutes
const getSafeTimestamp = (value) => {
  const timestamp = new Date(value || 0).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
};

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
        ready: {}, // key: filePath, value: { path, name, size, created, modified, analyzedAt, analysis }
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
      if (!this.state.analysis || typeof this.state.analysis !== 'object') {
        this.state.analysis = { jobs: {}, ready: {}, lastUpdated: new Date().toISOString() };
      }
      if (!this.state.analysis.jobs || typeof this.state.analysis.jobs !== 'object') {
        this.state.analysis.jobs = {};
      }
      if (!this.state.analysis.ready || typeof this.state.analysis.ready !== 'object') {
        this.state.analysis.ready = {};
      }
      if (!this.state.analysis.lastUpdated) {
        this.state.analysis.lastUpdated = new Date().toISOString();
      }
      if (!this.state.organize || typeof this.state.organize !== 'object') {
        this.state.organize = { batches: {}, lastUpdated: new Date().toISOString() };
      }
      if (!this.state.organize.batches || typeof this.state.organize.batches !== 'object') {
        this.state.organize.batches = {};
      }
      if (!this.state.organize.lastUpdated) {
        this.state.organize.lastUpdated = new Date().toISOString();
      }

      const readyEvicted = this._evictStaleReadyEntries(Date.now()) + this._enforceReadyQueueCap();
      if (readyEvicted > 0) {
        this.state.analysis.lastUpdated = new Date().toISOString();
        await this._saveStateInternal();
        logger.info('[ProcessingStateService] Pruned stale ready queue entries during load', {
          evicted: readyEvicted
        });
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
    const tempPath = `${this.statePath}.tmp.${require('crypto').randomUUID()}`;
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
   * Remove analysis jobs, durable ready entries, and organize batches that have reached a terminal
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

    // --- Durable ready queue ---
    evicted += this._evictStaleReadyEntries(now);
    evicted += this._enforceReadyQueueCap();

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
  _evictStaleReadyEntries(now = Date.now()) {
    const readyEntries =
      this.state?.analysis?.ready && typeof this.state.analysis.ready === 'object'
        ? this.state.analysis.ready
        : null;
    if (!readyEntries) return 0;

    let evicted = 0;
    for (const filePath of Object.keys(readyEntries)) {
      const entry = readyEntries[filePath];
      const timestamp = getSafeTimestamp(entry?.analyzedAt || entry?.modified || entry?.created);
      if (timestamp <= 0 || now - timestamp > READY_ENTRY_TTL_MS) {
        delete readyEntries[filePath];
        evicted++;
      }
    }
    return evicted;
  }

  _enforceReadyQueueCap() {
    const readyEntries =
      this.state?.analysis?.ready && typeof this.state.analysis.ready === 'object'
        ? this.state.analysis.ready
        : null;
    if (!readyEntries) return 0;

    const rankedEntries = Object.entries(readyEntries).sort(([, a], [, b]) => {
      const aTime = getSafeTimestamp(a?.analyzedAt || a?.modified || a?.created);
      const bTime = getSafeTimestamp(b?.analyzedAt || b?.modified || b?.created);
      return bTime - aTime;
    });
    if (rankedEntries.length <= MAX_READY_ENTRIES) return 0;

    let evicted = 0;
    for (let i = MAX_READY_ENTRIES; i < rankedEntries.length; i++) {
      const [filePath] = rankedEntries[i];
      delete readyEntries[filePath];
      evicted++;
    }
    return evicted;
  }

  _toSafeText(value, { maxLength = 500 } = {}) {
    if (value === null || value === undefined) return null;
    const text = String(value).trim();
    if (!text) return null;
    return text.length > maxLength ? text.slice(0, maxLength) : text;
  }

  _toSafeNumber(value, { min = 0, max = 1 } = {}) {
    const num = Number(value);
    if (!Number.isFinite(num)) return null;
    return Math.max(min, Math.min(max, num));
  }

  _toSafeStringList(values, { maxItems = 20, maxItemLength = 100 } = {}) {
    if (!Array.isArray(values) || values.length === 0) return [];
    const seen = new Set();
    const list = [];
    for (const value of values) {
      const normalized = this._toSafeText(value, { maxLength: maxItemLength });
      if (!normalized) continue;
      const dedupeKey = normalized.toLowerCase();
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      list.push(normalized);
      if (list.length >= maxItems) break;
    }
    return list;
  }

  _sanitizeReadyAnalysis(result) {
    if (!result || typeof result !== 'object') return null;
    const payload = {
      suggestedName: this._toSafeText(result.suggestedName || result.newName, { maxLength: 255 }),
      category: this._toSafeText(result.category, { maxLength: 100 }),
      keywords: this._toSafeStringList(result.keywords, { maxItems: 30, maxItemLength: 80 }),
      confidence: this._toSafeNumber(result.confidence, { min: 0, max: 100 }),
      summary: this._toSafeText(result.summary || result.purpose || result.description, {
        maxLength: 2000
      }),
      purpose: this._toSafeText(result.purpose, { maxLength: 2000 }),
      reasoning: this._toSafeText(result.reasoning, { maxLength: 1000 }),
      subject: this._toSafeText(result.subject, { maxLength: 255 }),
      documentType: this._toSafeText(result.documentType || result.type, { maxLength: 100 }),
      entity: this._toSafeText(result.entity, { maxLength: 255 }),
      project: this._toSafeText(result.project, { maxLength: 255 }),
      documentDate: this._toSafeText(result.documentDate || result.date, { maxLength: 60 }),
      keyEntities: this._toSafeStringList(result.keyEntities, { maxItems: 20, maxItemLength: 100 }),
      smartFolder: this._toSafeText(result.smartFolder, { maxLength: 255 }),
      embeddingPolicy: this._toSafeText(result.embeddingPolicy, { maxLength: 20 }),
      embeddingStatus: this._toSafeText(result.embeddingStatus, { maxLength: 20 }),
      warning: this._toSafeText(result.error, { maxLength: 1000 }),
      errorType: this._toSafeText(result.errorType, { maxLength: 100 }),
      isRetryable: typeof result.isRetryable === 'boolean' ? result.isRetryable : null
    };

    if (!payload.suggestedName && !payload.category && payload.keywords.length === 0) {
      return null;
    }

    const compact = {};
    for (const [key, value] of Object.entries(payload)) {
      if (value === null || value === undefined) continue;
      if (Array.isArray(value) && value.length === 0) continue;
      compact[key] = value;
    }
    return compact;
  }

  async _buildReadyEntry(filePath, analysisResult, analyzedAt) {
    const sanitizedAnalysis = this._sanitizeReadyAnalysis(analysisResult);
    if (!sanitizedAnalysis) return null;

    const nameFromPath = path.win32.basename(filePath || '');
    let stats;
    try {
      stats = await fs.stat(filePath);
    } catch {
      stats = null;
    }

    return {
      path: filePath,
      name: nameFromPath || sanitizedAnalysis.suggestedName || 'Unknown',
      size: stats?.size ?? null,
      created: stats?.birthtime ? stats.birthtime.toISOString() : null,
      modified: stats?.mtime ? stats.mtime.toISOString() : null,
      analyzedAt,
      analysis: sanitizedAnalysis
    };
  }

  async _upsertReadyEntryInMemory(filePath, analysisResult, analyzedAt) {
    const entry = await this._buildReadyEntry(filePath, analysisResult, analyzedAt);
    if (!entry) return false;
    this.state.analysis.ready[filePath] = entry;
    this._enforceReadyQueueCap();
    return true;
  }

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

  async markAnalysisComplete(filePath, analysisResult = null) {
    await this.initialize();
    const now = new Date().toISOString();
    this.state.analysis.jobs[filePath] = {
      ...(this.state.analysis.jobs[filePath] || {}),
      status: 'done',
      completedAt: now,
      error: null
    };
    if (analysisResult) {
      try {
        await this._upsertReadyEntryInMemory(filePath, analysisResult, now);
      } catch (error) {
        logger.debug('[ProcessingStateService] Failed to capture ready analysis entry', {
          filePath,
          error: error?.message
        });
      }
    }
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
    let changed = false;
    if (this.state.analysis.jobs[filePath]) {
      delete this.state.analysis.jobs[filePath];
      changed = true;
    }
    if (this.state.analysis.ready[filePath]) {
      delete this.state.analysis.ready[filePath];
      changed = true;
    }
    if (changed) {
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
    let changed = false;
    const job = this.state.analysis.jobs[oldPath];
    if (job) {
      this.state.analysis.jobs[newPath] = { ...job, movedFrom: oldPath };
      delete this.state.analysis.jobs[oldPath];
      changed = true;
    }
    const ready = this.state.analysis.ready[oldPath];
    if (ready) {
      this.state.analysis.ready[newPath] = {
        ...ready,
        path: newPath,
        name: path.win32.basename(newPath) || ready.name
      };
      delete this.state.analysis.ready[oldPath];
      changed = true;
    }
    if (changed) {
      this.state.analysis.lastUpdated = new Date().toISOString();
      await this.saveState();
    }
  }

  async upsertReadyAnalysis(filePath, analysisResult) {
    await this.initialize();
    const now = new Date().toISOString();
    const updated = await this._upsertReadyEntryInMemory(filePath, analysisResult, now);
    if (!updated) return false;
    this.state.analysis.lastUpdated = now;
    await this.saveState();
    return true;
  }

  async clearReadyAnalysis(filePath) {
    await this.initialize();
    if (!this.state.analysis.ready[filePath]) return false;
    delete this.state.analysis.ready[filePath];
    this.state.analysis.lastUpdated = new Date().toISOString();
    await this.saveState();
    return true;
  }

  getReadyAnalyses({ limit = DEFAULT_READY_QUERY_LIMIT } = {}) {
    if (!this.state?.analysis?.ready) return [];
    const entries = Object.values(this.state.analysis.ready)
      .filter((entry) => entry && typeof entry === 'object' && typeof entry.path === 'string')
      .sort((a, b) => {
        const aTime = getSafeTimestamp(a.analyzedAt || a.modified || a.created);
        const bTime = getSafeTimestamp(b.analyzedAt || b.modified || b.created);
        return bTime - aTime;
      });
    if (!Number.isFinite(limit) || limit === null || limit <= 0) {
      return entries;
    }
    return entries.slice(0, limit);
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
