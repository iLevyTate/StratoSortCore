/**
 * SmartFolderWatcher Service
 *
 * Watches smart folders for new and modified files, automatically
 * analyzing them and updating embeddings when changes are detected.
 *
 * Features:
 * - Watches all configured smart folders
 * - Auto-analyzes new files added to smart folders
 * - Re-analyzes files when modified (based on mtime)
 *   - Content updates (file edited & saved) only refresh details
 *     (summary, keywords, embeddings) — naming and folder/category
 *     assignment are preserved
 * - Debouncing to wait for file saves to complete
 * - Startup reconciliation: detects files deleted while the watcher
 *   was stopped and cleans up orphaned embeddings/history
 * - Opt-in via settings
 *
 * @module services/SmartFolderWatcher
 */

const fs = require('fs').promises;
const path = require('path');
const chokidar = require('chokidar');
const { logger: baseLogger, createLogger } = require('../../shared/logger');
const { ANALYSIS_SUPPORTED_EXTENSIONS } = require('../../shared/constants');
const { isNotFoundError } = require('../../shared/errorClassifier');
const { WatcherError } = require('../errors/FileSystemError');
const { generateSuggestedNameFromAnalysis } = require('./autoOrganize/namingUtils');
const { generateFileHash } = require('./analysisHistory/indexManager');
const { deriveWatcherConfidencePercent } = require('./confidence/watcherConfidence');
const { recordAnalysisResult } = require('../ipc/analysisUtils');
const { chunkText } = require('../utils/textChunking');
const { buildEmbeddingSummary } = require('../analysis/embeddingSummary');
const {
  CHUNKING,
  TIMEOUTS,
  TEMP_FILE_PATTERNS,
  isTemporaryFile,
  RETRY
} = require('../../shared/performanceConstants');
const { AI_DEFAULTS } = require('../../shared/constants');
const { getInstance: getFileOperationTracker } = require('../../shared/fileOperationTracker');
const { normalizePathForIndex, getCanonicalFileId } = require('../../shared/pathSanitization');
const { isImagePath } = require('../../shared/fileIdUtils');
const { isUNCPath } = require('../../shared/crossPlatformUtils');
const { normalizeKeywords } = require('../../shared/normalization');
const {
  getInstance: getLearningFeedbackService,
  FEEDBACK_SOURCES
} = require('./organization/learningFeedback');
const { withTimeout, delay } = require('../../shared/promiseUtils');
const { shouldEmbed } = require('./embedding/embeddingGate');
const { resetLlamaCircuit } = require('./LlamaResilience');
const { clearSmartFolderUpsertCache } = require('../analysis/semanticFolderMatcher');
const { CONCURRENCY } = require('../../shared/performanceConstants');

const logger = typeof createLogger === 'function' ? createLogger('SmartFolderWatcher') : baseLogger;
if (typeof createLogger !== 'function' && logger?.setContext) {
  logger.setContext('SmartFolderWatcher');
}

// Limit how many times a file is retried after transient failures (timeouts, embed errors)
const MAX_ANALYSIS_RETRIES = RETRY.MAX_ATTEMPTS_MEDIUM;

// CRITICAL: Prevent unbounded memory growth under heavy file activity (e.g., large archive extraction).
// We bound the analysis queue and apply light deduplication by filePath.
const MAX_ANALYSIS_QUEUE_SIZE = 500;
const QUEUE_DROP_LOG_INTERVAL_MS = 10_000;
const MOVE_DETECTION_WINDOW_MS = 3000;
const MOVE_MTIME_TOLERANCE_MS = 2000;

// Supported file extensions for analysis (centralized list)
const SUPPORTED_EXTENSIONS = new Set(ANALYSIS_SUPPORTED_EXTENSIONS || []);

/**
 * Check if file extension is supported for analysis
 * @param {string} filePath - Path to check
 * @returns {boolean} True if supported
 */
function isSupportedFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return SUPPORTED_EXTENSIONS.has(ext);
}

class SmartFolderWatcher {
  /**
   * @param {Object} deps - Dependencies
   * @param {Function} deps.getSmartFolders - Function to get current smart folders
   * @param {Object} deps.analysisHistoryService - Analysis history service
   * @param {Function} deps.analyzeDocumentFile - Function to analyze document files
   * @param {Function} deps.analyzeImageFile - Function to analyze image files
   * @param {Object} deps.settingsService - Settings service
   * @param {Object} deps.vectorDbService - Vector DB service for embeddings
   * @param {Object} deps.filePathCoordinator - FilePathCoordinator for atomic path updates
   * @param {Object} deps.folderMatcher - FolderMatchingService for generating embeddings
   * @param {Object} deps.notificationService - Notification service for user feedback
   */
  constructor({
    getSmartFolders,
    analysisHistoryService,
    analyzeDocumentFile,
    analyzeImageFile,
    settingsService,
    vectorDbService,
    filePathCoordinator,
    folderMatcher,
    notificationService
  }) {
    this.getSmartFolders = getSmartFolders;
    this.analysisHistoryService = analysisHistoryService;
    this.analyzeDocumentFile = analyzeDocumentFile;
    this.analyzeImageFile = analyzeImageFile;
    this.settingsService = settingsService;
    this.vectorDbService = vectorDbService;
    this.filePathCoordinator = filePathCoordinator || null;
    this.folderMatcher = folderMatcher;
    this.notificationService = notificationService;

    this.watcher = null;
    this.isRunning = false;
    this.isStarting = false;
    this.watchedPaths = new Set();

    this._startPromise = null;

    this._isStopping = false;

    // Processing state
    this.processingFiles = new Set();
    this.pendingAnalysis = new Map(); // filePath -> { mtime, timeout }
    this.analysisQueue = [];
    this.isProcessingQueue = false;
    this._pendingMoveCandidates = new Map(); // oldPath -> { size, mtimeMs, ext, createdAt, timeoutId }

    // Configuration
    this.debounceDelay = 1000; // 1 second debounce
    // Maximum time to keep deferring analysis for a hot file (prevents indefinite postponement)
    this.maxDebounceWaitMs = 5000;
    this.stabilityThreshold = 3000; // 3 seconds - file must be stable for this long
    this.queueProcessInterval = 2000; // Process queue every 2 seconds
    this.maxConcurrentAnalysis = 2; // Max files to analyze at once (synced from settings)
    this._moveDetectionWindowMs = MOVE_DETECTION_WINDOW_MS;
    this._moveMtimeToleranceMs = MOVE_MTIME_TOLERANCE_MS;

    // Sync concurrency from settings (non-blocking)
    this._syncConcurrencyFromSettingsService();

    // Timers
    this.queueTimer = null;

    // Queue backpressure state (for bounded queue + rate-limited logging)
    this._lastQueueDropLogAt = 0;
    this._queueDropsSinceLog = 0;

    // Stats
    this.stats = {
      filesAnalyzed: 0,
      filesReanalyzed: 0,
      errors: 0,
      queueDropped: 0,
      orphansReconciled: 0,
      lastActivity: null
    };
  }

  /**
   * Apply settings updates (called when renderer saves settings)
   * @param {Object} settings
   */
  applySettings(settings) {
    if (!settings || typeof settings !== 'object') return;
    const val = settings.maxConcurrentAnalysis;
    const num = Number(val);
    if (Number.isFinite(num)) {
      this.maxConcurrentAnalysis = Math.min(
        CONCURRENCY.MAX_WORKERS,
        Math.max(CONCURRENCY.MIN_WORKERS, Math.round(num))
      );
    }
  }

  /**
   * Sync maxConcurrentAnalysis from SettingsService (best effort, non-blocking)
   * @private
   */
  async _syncConcurrencyFromSettingsService() {
    try {
      if (!this.settingsService?.load) return;
      const loaded = await this.settingsService.load();
      const val = loaded?.maxConcurrentAnalysis;
      const num = Number(val);
      if (Number.isFinite(num)) {
        this.maxConcurrentAnalysis = Math.min(
          CONCURRENCY.MAX_WORKERS,
          Math.max(CONCURRENCY.MIN_WORKERS, Math.round(num))
        );
      }
    } catch (error) {
      logger.debug(
        '[SMART-FOLDER-WATCHER] Failed to sync concurrency from settings:',
        error?.message
      );
    }
  }

  /**
   * Start watching smart folders
   * Smart folder watching is always enabled - files added to smart folders are automatically analyzed
   * @returns {Promise<boolean>} True if started successfully
   */
  async start() {
    if (this.isRunning) {
      logger.debug('[SMART-FOLDER-WATCHER] Already running');
      return true;
    }
    this._isStopping = false;

    // This prevents race condition where concurrent callers get false
    if (this._startPromise) {
      logger.debug('[SMART-FOLDER-WATCHER] Returning existing start promise');
      return this._startPromise;
    }

    this.isStarting = true;
    this._startPromise = this._doStart();

    try {
      return await this._startPromise;
    } finally {
      this._startPromise = null;
      this.isStarting = false;
    }
  }

  /**
   * Internal start implementation
   * @private
   * @returns {Promise<boolean>} True if started successfully
   */
  async _doStart() {
    try {
      // Get smart folders to watch
      const folders = this.getSmartFolders();

      if (!folders || folders.length === 0) {
        const errorMsg =
          'No smart folders configured. Please add smart folders in the Setup phase first.';
        logger.warn('[SMART-FOLDER-WATCHER] Start failed:', errorMsg);
        this._lastStartError = errorMsg;
        return false;
      }

      const validPaths = await this._getValidFolderPaths(folders);

      if (validPaths.length === 0) {
        const errorMsg = `All ${folders.length} smart folder path(s) are inaccessible. Please check that the folders exist and you have read permissions.`;
        logger.warn('[SMART-FOLDER-WATCHER] Start failed:', errorMsg);
        this._lastStartError = errorMsg;
        return false;
      }

      // Clear any previous error
      this._lastStartError = null;

      logger.info('[SMART-FOLDER-WATCHER] Starting to watch folders:', validPaths);

      // Check for UNC paths to enable polling for network drives
      const usePolling = validPaths.some((p) => isUNCPath(p));
      if (usePolling) {
        logger.info('[SMART-FOLDER-WATCHER] UNC paths detected, enabling polling mode');
      }

      // Create watcher with stability detection
      this.watcher = chokidar.watch(validPaths, {
        ignoreInitial: true, // Don't process existing files on startup
        ignored: [
          /(^|[/\\])\../, // Dotfiles
          /node_modules/,
          /\.git/,
          ...TEMP_FILE_PATTERNS
        ],
        persistent: true,
        usePolling: usePolling,
        interval: usePolling ? 2000 : 100, // Slower polling for network drives
        binaryInterval: usePolling ? 2000 : 300,
        awaitWriteFinish: {
          stabilityThreshold: this.stabilityThreshold,
          pollInterval: 200
        },
        depth: 10, // Watch subdirectories up to 10 levels deep
        alwaysStat: true // Get file stats with events
      });

      // Handle new files
      this.watcher.on('add', (filePath, stats) => {
        this._handleFileEvent('add', filePath, stats);
      });

      // Handle modified files
      this.watcher.on('change', (filePath, stats) => {
        this._handleFileEvent('change', filePath, stats);
      });

      // Handle deleted files (external deletion via File Explorer)
      this.watcher.on('unlink', (filePath) => {
        this._handleFileDeletion(filePath);
      });

      // Handle errors
      this.watcher.on('error', (error) => {
        this._handleError(error);
      });

      // Wait for chokidar to finish its initial scan before returning.
      // This ensures isRunning is true and the watcher is fully operational
      // before callers act on the start() result.
      // from calling reject() on an already-resolved promise (listener leak)
      await new Promise((resolve, reject) => {
        const readyHandler = () => {
          this.watcher.removeListener('error', errorHandler);
          logger.info(
            '[SMART-FOLDER-WATCHER] Watcher ready, monitoring',
            validPaths.length,
            'folders'
          );
          this.watchedPaths = new Set(validPaths);
          this.isRunning = true;
          // Note: isStarting is cleared in start() finally block
          resolve();
        };
        const errorHandler = (err) => {
          this.watcher.removeListener('ready', readyHandler);
          reject(err);
        };
        this.watcher.once('ready', readyHandler);
        this.watcher.once('error', errorHandler);
      });

      // Start queue processor
      this._startQueueProcessor();

      // Run startup reconciliation in background — removes orphaned
      // embeddings/history for files deleted while the watcher was stopped.
      this._reconcileOrphanedEntries().catch((err) => {
        logger.debug('[SMART-FOLDER-WATCHER] Startup reconciliation failed:', err.message);
      });

      return true;
    } catch (error) {
      logger.error('[SMART-FOLDER-WATCHER] Failed to start:', error.message);
      // Note: isStarting is cleared in start() finally block
      this.stats.errors++;
      return false;
    }
  }

  /**
   * Stop watching
   * FIX MED-6: Clean up pending move detection timeouts to prevent callbacks after stop
   */
  async stop() {
    logger.info('[SMART-FOLDER-WATCHER] Stopping...');
    this._isStopping = true;

    // Stop queue processor
    if (this.queueTimer) {
      clearInterval(this.queueTimer);
      this.queueTimer = null;
    }

    // Wait for in-flight queue processing to finish (up to 30s)
    if (this.isProcessingQueue) {
      logger.debug('[SMART-FOLDER-WATCHER] Waiting for in-flight queue processing to finish...');
      const deadline = Date.now() + 30000;
      while (this.isProcessingQueue && Date.now() < deadline) {
        await delay(200);
      }
      if (this.isProcessingQueue) {
        logger.warn('[SMART-FOLDER-WATCHER] Timed out waiting for queue processing during stop');
      }
    }

    // Clear pending analysis timeouts
    for (const pending of this.pendingAnalysis.values()) {
      if (pending.timeout) {
        clearTimeout(pending.timeout);
      }
    }
    this.pendingAnalysis.clear();

    // callbacks firing after watcher is stopped
    for (const candidate of this._pendingMoveCandidates.values()) {
      if (candidate.timeoutId) {
        clearTimeout(candidate.timeoutId);
      }
    }
    this._pendingMoveCandidates.clear();

    // Stop watcher
    if (this.watcher) {
      try {
        this.watcher.removeAllListeners();
        const closeResult = this.watcher.close();
        if (closeResult && typeof closeResult.then === 'function') {
          await closeResult;
        }
      } catch (error) {
        logger.error('[SMART-FOLDER-WATCHER] Error closing watcher:', error.message);
      }
      this.watcher = null;
    }

    this.isRunning = false;
    this.isStarting = false;
    this.watchedPaths.clear();
    this.processingFiles.clear();
    this.analysisQueue = [];
    this._lastQueueDropLogAt = 0;
    this._queueDropsSinceLog = 0;
    this._lastDropNotification = null;

    logger.info('[SMART-FOLDER-WATCHER] Stopped');
  }

  /**
   * Restart the watcher (e.g., when smart folders change)
   */
  async restart() {
    logger.info('[SMART-FOLDER-WATCHER] Restarting...');
    await this.stop();
    return this.start();
  }

  /**
   * Update watched folders (called when smart folders are added/removed)
   * @param {Array} folders - New list of smart folders
   */
  async updateWatchedFolders(folders) {
    if (!this.isRunning || !this.watcher) {
      return;
    }

    const validPaths = await this._getValidFolderPaths(folders);
    const currentPaths = this.watchedPaths;

    // Find paths to add
    const toAdd = validPaths.filter((p) => !currentPaths.has(p));
    // Find paths to remove
    const toRemove = [...currentPaths].filter((p) => !validPaths.includes(p));

    // Add new paths
    for (const addPath of toAdd) {
      logger.info('[SMART-FOLDER-WATCHER] Adding watch path:', addPath);
      this.watcher.add(addPath);
      this.watchedPaths.add(addPath);
    }

    // Remove old paths
    for (const removePath of toRemove) {
      logger.info('[SMART-FOLDER-WATCHER] Removing watch path:', removePath);
      this.watcher.unwatch(removePath);
      this.watchedPaths.delete(removePath);
    }
  }

  /**
   * Get valid folder paths from smart folders
   * @private
   */
  async _getValidFolderPaths(folders) {
    const validPaths = [];

    for (const folder of folders) {
      if (!folder || !folder.path) continue;

      try {
        const stats = await fs.stat(folder.path);
        if (stats.isDirectory()) {
          validPaths.push(folder.path);
        }
      } catch (error) {
        if (!isNotFoundError(error)) {
          logger.warn('[SMART-FOLDER-WATCHER] Cannot access folder:', {
            folderPath: folder.path,
            error: error.message
          });
        }
      }
    }

    return validPaths;
  }

  /**
   * Handle file add/change events
   * @private
   */
  _handleFileEvent(eventType, filePath, stats) {
    const tracker = getFileOperationTracker();
    if (tracker.wasRecentlyOperated(filePath)) {
      logger.debug('[SMART-FOLDER-WATCHER] Skipping recently-operated file:', filePath);
      return;
    }

    // Skip unsupported files
    if (!isSupportedFile(filePath)) {
      logger.debug('[SMART-FOLDER-WATCHER] Skipping unsupported file:', filePath);
      return;
    }

    // Skip temp files
    if (isTemporaryFile(filePath)) {
      logger.debug('[SMART-FOLDER-WATCHER] Skipping temp file:', filePath);
      return;
    }

    // Skip files already being processed
    if (this.processingFiles.has(filePath)) {
      logger.debug('[SMART-FOLDER-WATCHER] File already processing:', filePath);
      return;
    }

    const mtime = stats?.mtime ? new Date(stats.mtime).getTime() : Date.now();

    logger.debug('[SMART-FOLDER-WATCHER] File event:', { eventType, filePath });

    const now = Date.now();

    // Debounce - clear existing timeout for this file
    let firstEventAt = now;
    if (this.pendingAnalysis.has(filePath)) {
      const existing = this.pendingAnalysis.get(filePath);
      firstEventAt = typeof existing.firstEventAt === 'number' ? existing.firstEventAt : now;
      if (existing.timeout) {
        clearTimeout(existing.timeout);
      }
    }

    // Set new debounce timeout
    const elapsed = now - firstEventAt;
    const delay = elapsed >= this.maxDebounceWaitMs ? 0 : this.debounceDelay;
    const timeout = setTimeout(() => {
      if (this._isStopping) {
        return;
      }
      this._queueFileForAnalysis(filePath, mtime, eventType, stats);
    }, delay);
    timeout.unref(); // Don't prevent process exit during shutdown

    this.pendingAnalysis.set(filePath, { mtime, timeout, eventType, firstEventAt });
  }

  /**
   * Queue a file for analysis
   * @private
   */
  async _queueFileForAnalysis(filePath, mtime, eventType, stats) {
    const pending = this.pendingAnalysis.get(filePath);
    if (pending && pending.timeout) {
      clearTimeout(pending.timeout);
    }
    this.pendingAnalysis.delete(filePath);

    try {
      // Verify file still exists
      await fs.access(filePath);

      // If this is a move/rename within smart folders, update paths instead of re-analysis
      if (eventType === 'add') {
        const moveHandled = await this._attemptMoveResolution(filePath, stats);
        if (moveHandled) {
          return;
        }
      }

      // Check if analysis is needed
      const needsAnalysis = await this._needsAnalysis(filePath, mtime, stats);

      if (!needsAnalysis) {
        logger.debug('[SMART-FOLDER-WATCHER] File already up-to-date:', filePath);
        return;
      }

      // Add to queue (bounded + deduplicated)
      this._enqueueAnalysisItem({
        filePath,
        mtime,
        eventType,
        queuedAt: Date.now()
      });

      logger.info('[SMART-FOLDER-WATCHER] Queued for analysis:', { filePath, eventType });
      this.stats.lastActivity = new Date().toISOString();
    } catch (error) {
      if (isNotFoundError(error)) {
        logger.debug('[SMART-FOLDER-WATCHER] File no longer exists:', filePath);
      } else {
        logger.error('[SMART-FOLDER-WATCHER] Error queueing file:', {
          filePath,
          error: error.message
        });
        this.stats.errors++;
      }
    }
  }

  /**
   * Add an item to the analysis queue with bounds + best-effort deduplication.
   * @private
   * @param {{filePath: string, mtime: number, eventType: string, queuedAt: number}} item
   */
  _enqueueAnalysisItem(item) {
    if (this._isStopping) {
      return;
    }

    const { filePath } = item;

    // If already queued, replace the existing entry with the latest metadata.
    const existingIndex = this.analysisQueue.findIndex((q) => q.filePath === filePath);
    if (existingIndex !== -1) {
      this.analysisQueue[existingIndex] = item;
      return;
    }

    // Enforce a maximum queue size by dropping the oldest item.
    if (this.analysisQueue.length >= MAX_ANALYSIS_QUEUE_SIZE) {
      const dropped = this.analysisQueue.shift();
      if (dropped) {
        this.stats.queueDropped++;
        this._queueDropsSinceLog++;

        if (dropped.retryCount > 0) {
          logger.warn(
            '[SMART-FOLDER-WATCHER] Dropped retried analysis item due to queue pressure',
            {
              filePath: dropped.filePath,
              retryCount: dropped.retryCount
            }
          );
        }

        // We rate limit this notification to avoid spamming
        const now = Date.now();
        if (
          this.notificationService &&
          (!this._lastDropNotification || now - this._lastDropNotification > 60000)
        ) {
          this.notificationService
            .notifyWatcherError(
              'High Load',
              `Analysis queue full. Some files (e.g. ${path.basename(dropped.filePath)}) were skipped to maintain performance.`
            )
            .catch((err) =>
              logger.debug('[SmartFolderWatcher] Failed to notify watcher error', {
                error: err.message
              })
            );
          this._lastDropNotification = now;
        }
      }

      const now = Date.now();
      if (now - this._lastQueueDropLogAt >= QUEUE_DROP_LOG_INTERVAL_MS) {
        logger.warn('[SMART-FOLDER-WATCHER] Analysis queue full; dropping oldest items', {
          maxQueueSize: MAX_ANALYSIS_QUEUE_SIZE,
          droppedSinceLastLog: this._queueDropsSinceLog,
          queueLength: this.analysisQueue.length
        });
        this._lastQueueDropLogAt = now;
        this._queueDropsSinceLog = 0;
      }
    }

    this.analysisQueue.push(item);
  }

  /**
   * Attempt to resolve a move by matching recent deletions.
   * If matched, update path-dependent systems and skip re-analysis.
   *
   * FIX: When multiple candidates match, attempt to disambiguate by base name
   * before falling back to full re-analysis.
   *
   * @private
   */
  async _attemptMoveResolution(filePath, stats) {
    if (this._pendingMoveCandidates.size === 0) {
      return false;
    }

    let fileStats = stats;
    try {
      if (!fileStats || !Number.isFinite(fileStats.size)) {
        fileStats = await fs.stat(filePath);
      }
    } catch (error) {
      if (isNotFoundError(error)) return false;
      logger.debug('[SMART-FOLDER-WATCHER] Move check stat failed:', error.message);
      return false;
    }

    const size = fileStats.size;
    const mtimeMs = Number.isFinite(fileStats.mtimeMs)
      ? fileStats.mtimeMs
      : fileStats.mtime
        ? new Date(fileStats.mtime).getTime()
        : null;
    if (!Number.isFinite(mtimeMs)) return false;

    const ext = path.extname(filePath).toLowerCase();

    // First pass: find candidates matching size, extension, and mtime tolerance
    const matches = [];
    let bestDiff = Infinity;
    for (const candidate of this._pendingMoveCandidates.values()) {
      if (candidate.size !== size || candidate.ext !== ext) continue;
      const diff = Math.abs(candidate.mtimeMs - mtimeMs);
      if (diff <= this._moveMtimeToleranceMs) {
        matches.push({ candidate, diff });
        if (diff < bestDiff) {
          bestDiff = diff;
        }
      }
    }

    if (matches.length === 0) {
      return false;
    }

    let match;
    if (matches.length > 1) {
      const newBaseName = path.basename(filePath).toLowerCase();
      const nameMatches = matches.filter(
        (m) => String(m.candidate.baseName || '').toLowerCase() === newBaseName
      );

      if (nameMatches.length === 1) {
        match = nameMatches[0].candidate;
        logger.debug('[SMART-FOLDER-WATCHER] Resolved ambiguous move via base-name match', {
          newPath: path.basename(filePath),
          matchedName: newBaseName
        });
      } else {
        logger.debug('[SMART-FOLDER-WATCHER] Ambiguous move match; skipping auto-update', {
          newPath: path.basename(filePath),
          candidates: matches.length,
          baseNameMatches: nameMatches.length,
          bestDiffMs: bestDiff
        });
        return false;
      }
    } else {
      match = matches[0].candidate;
    }
    if (match.oldPath === filePath) {
      return false;
    }

    const coordinator = this.filePathCoordinator;
    if (!coordinator || typeof coordinator.atomicPathUpdate !== 'function') {
      logger.warn('[SMART-FOLDER-WATCHER] FilePathCoordinator unavailable for move update', {
        oldPath: match.oldPath,
        newPath: filePath
      });
      return false;
    }

    try {
      await coordinator.atomicPathUpdate(match.oldPath, filePath, { type: 'move' });
      if (match.timeoutId) clearTimeout(match.timeoutId);
      this._pendingMoveCandidates.delete(match.oldPath);

      // Prevent re-processing loops for the moved file
      const tracker = getFileOperationTracker();
      tracker.recordOperation(match.oldPath, 'move', 'smartFolderWatcher');
      tracker.recordOperation(filePath, 'move', 'smartFolderWatcher');

      // Invalidate BM25 index so searches reflect the new path
      if (!this._isStopping) {
        try {
          const { getSearchServiceInstance } = require('../ipc/semantic');
          const searchService = getSearchServiceInstance?.();
          if (searchService?.invalidateIndex) {
            searchService.invalidateIndex({
              reason: 'smart-folder-move',
              oldPath: match.oldPath,
              newPath: filePath
            });
          }
        } catch (indexErr) {
          logger.debug(
            '[SMART-FOLDER-WATCHER] Could not invalidate search index after move:',
            indexErr.message
          );
        }
      }

      this.stats.lastActivity = new Date().toISOString();
      logger.info('[SMART-FOLDER-WATCHER] Resolved move within smart folders', {
        oldPath: path.basename(match.oldPath),
        newPath: path.basename(filePath)
      });

      return true;
    } catch (error) {
      logger.warn('[SMART-FOLDER-WATCHER] Move update failed, will re-analyze', {
        oldPath: match.oldPath,
        newPath: filePath,
        error: error.message
      });
      return false;
    }
  }

  /**
   * Check if a file needs analysis
   * @private
   */
  async _needsAnalysis(filePath, mtime, stats = null) {
    try {
      let fileStats = stats;
      if (!fileStats) {
        fileStats = await fs.stat(filePath);
      }

      const currentMtimeMs = Number.isFinite(fileStats.mtimeMs)
        ? fileStats.mtimeMs
        : fileStats.mtime
          ? new Date(fileStats.mtime).getTime()
          : null;
      const currentLastModified =
        fileStats.mtime && typeof fileStats.mtime.toISOString === 'function'
          ? fileStats.mtime.toISOString()
          : new Date(mtime).toISOString();
      const currentHash = generateFileHash(filePath, fileStats.size, currentLastModified);

      // Get existing analysis for this file
      const existingAnalysis = await this.analysisHistoryService.getAnalysisByPath(filePath);

      // If not found by path, try by file hash (helps when paths change case or file moved)
      let matchedAnalysis = existingAnalysis;
      if (!matchedAnalysis) {
        matchedAnalysis = await this.analysisHistoryService.getAnalysisByHash(currentHash);
      }

      if (!matchedAnalysis) {
        // New file - needs analysis
        return true;
      }

      if (
        Number.isFinite(matchedAnalysis.fileSize) &&
        matchedAnalysis.fileSize !== fileStats.size
      ) {
        return true;
      }

      if (matchedAnalysis.fileHash && matchedAnalysis.fileHash !== currentHash) {
        return true;
      }

      // Check if file was modified after last analysis
      const analysisTime = new Date(
        matchedAnalysis.lastModified || matchedAnalysis.timestamp
      ).getTime();
      if (!Number.isFinite(currentMtimeMs) || !Number.isFinite(analysisTime)) {
        return true;
      }

      return currentMtimeMs > analysisTime;
    } catch (error) {
      logger.warn('[SMART-FOLDER-WATCHER] Error checking analysis history:', error.message);
      // If we can't check, assume it needs analysis
      return true;
    }
  }

  /**
   * Start the queue processor
   * @private
   */
  _startQueueProcessor() {
    if (this.queueTimer) {
      clearInterval(this.queueTimer);
    }

    this.queueTimer = setInterval(() => {
      this._processQueue();
    }, this.queueProcessInterval);

    // Don't prevent process exit
    if (this.queueTimer.unref) {
      this.queueTimer.unref();
    }
  }

  /**
   * Process the analysis queue
   * @private
   */
  async _processQueue() {
    if (this._isStopping || this.isProcessingQueue || this.analysisQueue.length === 0) {
      return;
    }

    this.isProcessingQueue = true;

    try {
      // Peek at first item to determine type — process same-type batches together
      const firstIsImage = isImagePath(this.analysisQueue[0].filePath);

      if (firstIsImage) {
        // Image batch: take consecutive images (up to 20), process sequentially
        // Vision server is single-slot so parallel calls would just queue up
        let count = 0;
        const maxImageBatch = 20;
        while (
          count < this.analysisQueue.length &&
          count < maxImageBatch &&
          isImagePath(this.analysisQueue[count].filePath)
        ) {
          count++;
        }
        const batch = this.analysisQueue.splice(0, count);

        // Enter vision batch mode once for the whole batch
        let llamaService;
        try {
          const { getInstance: getLlamaService } = require('./LlamaService');
          llamaService = getLlamaService();
        } catch {
          llamaService = null;
        }

        if (llamaService) {
          try {
            await llamaService.enterVisionBatchMode();
          } catch (err) {
            logger.warn('[SMART-FOLDER-WATCHER] Failed to enter vision batch mode', {
              error: err.message
            });
          }
        }

        try {
          for (const item of batch) {
            try {
              await withTimeout(
                this._analyzeFile(item),
                TIMEOUTS.GLOBAL_ANALYSIS || 10 * 60 * 1000,
                `SmartFolderWatcher analyze ${item.filePath}`
              );
            } catch (error) {
              this._handleAnalysisError(item, error);
            }
          }
        } finally {
          if (llamaService) {
            try {
              await llamaService.exitVisionBatchMode();
            } catch (err) {
              logger.warn('[SMART-FOLDER-WATCHER] Failed to exit vision batch mode', {
                error: err.message
              });
            }
          }
        }
      } else {
        // Document batch: take up to maxConcurrentAnalysis, process concurrently
        const batchSize = Math.max(1, this.maxConcurrentAnalysis || 1);
        let count = 0;
        while (
          count < this.analysisQueue.length &&
          count < batchSize &&
          !isImagePath(this.analysisQueue[count].filePath)
        ) {
          count++;
        }
        const batch = this.analysisQueue.splice(0, count);

        const results = await Promise.allSettled(
          batch.map((item) =>
            withTimeout(
              this._analyzeFile(item),
              TIMEOUTS.GLOBAL_ANALYSIS || 10 * 60 * 1000,
              `SmartFolderWatcher analyze ${item.filePath}`
            ).catch((error) => {
              this._handleAnalysisError(item, error);
            })
          )
        );
        void results; // Errors handled per-item above
      }
    } catch (error) {
      logger.error('[SMART-FOLDER-WATCHER] Queue processing error:', error.message);
      this.stats.errors++;
    } finally {
      this.isProcessingQueue = false;
      // Immediately re-trigger if more items remain instead of waiting for next 2s interval
      if (this.analysisQueue.length > 0 && !this._isStopping && this.isRunning) {
        setImmediate(() => this._processQueue());
      }
    }
  }

  /**
   * Handle analysis error for a single item — retry or give up
   * @private
   */
  _handleAnalysisError(item, error) {
    logger.warn('[SMART-FOLDER-WATCHER] Analysis timed out or failed', {
      filePath: item.filePath,
      error: error.message
    });
    this.stats.errors++;

    const nextRetry = (item.retryCount || 0) + 1;
    if (nextRetry <= MAX_ANALYSIS_RETRIES) {
      this._enqueueAnalysisItem({
        ...item,
        retryCount: nextRetry,
        cachedAnalysis: item._lastAnalysis || item.cachedAnalysis || null
      });
      logger.debug('[SMART-FOLDER-WATCHER] Re-queued file after failure', {
        filePath: item.filePath,
        retryCount: nextRetry,
        hasCachedAnalysis: !!(item._lastAnalysis || item.cachedAnalysis)
      });
    } else {
      logger.error('[SMART-FOLDER-WATCHER] Max retries reached, giving up', {
        filePath: item.filePath,
        retries: nextRetry
      });

      if (this.notificationService) {
        this.notificationService
          .notifyWatcherError(
            'Analysis Failed',
            `File "${path.basename(item.filePath)}" failed after ${nextRetry} attempts: ${error?.message || 'Max retries exceeded'}`
          )
          .catch((err) =>
            logger.debug('[SmartFolderWatcher] Failed to notify analysis error', {
              error: err.message
            })
          );
      }
    }
  }

  /**
   * Analyze a single file
   * @private
   */
  async _analyzeFile(item) {
    if (this._isStopping) return;

    const { filePath, eventType, applyNaming } = item;
    const isReanalyze = eventType === 'reanalyze';
    // Content update: file was modified in-place (e.g. user edited & saved).
    // Only update details (summary, keywords, embeddings) — preserve the
    // existing name and smart-folder/category assignment.
    const isContentUpdate = eventType === 'change';

    if (this.processingFiles.has(filePath)) {
      return;
    }

    this.processingFiles.add(filePath);

    try {
      // Verify file still exists and capture stats for reuse below
      const fileStats = await fs.stat(filePath);

      logger.info('[SMART-FOLDER-WATCHER] Analyzing file:', filePath, {
        applyNaming: applyNaming !== false,
        isContentUpdate
      });

      // Get smart folders for categorization
      const smartFolders = this.getSmartFolders() || [];
      const folderCategories = smartFolders.map((f) => ({
        name: f.name,
        description: f.description || '',
        id: f.id,
        path: f.path
      }));

      // Reuse cached LLM analysis when retrying after an embedding failure.
      // This avoids repeating the expensive LLM call for a transient embedding issue.
      let result;
      const isEmbeddingRetry = Boolean(item.cachedAnalysis);
      if (isEmbeddingRetry) {
        result = item.cachedAnalysis;
        logger.debug(
          '[SMART-FOLDER-WATCHER] Reusing cached LLM analysis for embedding retry:',
          filePath
        );
      } else if (isImagePath(filePath)) {
        result = await this.analyzeImageFile(filePath, folderCategories, {
          bypassCache: isReanalyze
        });
      } else {
        result = await this.analyzeDocumentFile(filePath, folderCategories, {
          bypassCache: isReanalyze
        });
      }

      if (this._isStopping) return;

      if (result) {
        // Embedding-only retry: skip all post-analysis side effects (naming, history,
        // notification, learning feedback) since they already ran on the original pass.
        // Only re-attempt the embedding.
        if (isEmbeddingRetry) {
          try {
            // Embedding retry should only retry embedding and then stop.
            // Do not run analysis side effects or stats updates.
            await this._embedAnalyzedFile(filePath, result);
            logger.debug('[SMART-FOLDER-WATCHER] Embedding retry succeeded', { filePath });
          } catch (embedErr) {
            logger.warn('[SMART-FOLDER-WATCHER] Embedding retry failed again', {
              filePath,
              error: embedErr.message
            });
            const retryCount = (item.retryCount || 0) + 1;
            if (retryCount <= MAX_ANALYSIS_RETRIES) {
              this._enqueueAnalysisItem({
                ...item,
                retryCount,
                cachedAnalysis: result
              });
            } else {
              logger.error('[SMART-FOLDER-WATCHER] Embedding retries exhausted', {
                filePath,
                retryCount
              });
            }
          }
          return;
        }

        // Apply user's naming convention to the suggested name (unless explicitly disabled)
        // Default behavior is to apply naming (backward compatibility)
        const shouldApplyNaming = applyNaming !== false && !isEmbeddingRetry && !isContentUpdate;

        if (shouldApplyNaming) {
          try {
            // IMPORTANT: Load naming conventions from persisted Settings, NOT Redux state
            // The SmartFolderWatcher uses the Settings naming conventions to ensure consistent
            // naming behavior across all automatic operations (watchers & reanalysis).
            // The Discover phase has its own session-based naming controls in Redux.
            const settings = await this.settingsService.load();
            const namingSettings = {
              convention: settings.namingConvention || 'keep-original',
              separator: settings.separator || '-',
              dateFormat: settings.dateFormat || 'YYYY-MM-DD',
              caseConvention: settings.caseConvention
            };

            // Reuse fileStats from existence check above
            const fileTimestamps = {
              created: fileStats.birthtime,
              modified: fileStats.mtime
            };

            const analysis = result.analysis || result;
            const originalFileName = path.basename(filePath);

            // Generate suggested name using user's naming convention
            const suggestedName = generateSuggestedNameFromAnalysis({
              originalFileName,
              analysis,
              settings: namingSettings,
              fileTimestamps
            });

            if (suggestedName && analysis) {
              analysis.suggestedName = suggestedName;
              logger.debug('[SMART-FOLDER-WATCHER] Applied naming convention:', {
                original: originalFileName,
                suggested: suggestedName,
                convention: namingSettings.convention
              });
            }
          } catch (namingError) {
            logger.debug(
              '[SMART-FOLDER-WATCHER] Could not apply naming convention:',
              namingError.message
            );
          }
        } else {
          // Keep original name when applyNaming is false
          const analysis = result.analysis || result;
          const originalFileName = path.basename(filePath);
          if (analysis) {
            analysis.suggestedName = originalFileName;
            logger.debug('[SMART-FOLDER-WATCHER] Keeping original name:', {
              original: originalFileName
            });
          }
        }

        // Cache the LLM analysis result on the item so that if embedding fails
        // and the item is re-enqueued for retry, the expensive LLM call is not repeated.
        if (!isEmbeddingRetry) {
          item._lastAnalysis = result;
        }

        // Skip persisting fallback-only results to analysis history so that
        // _needsAnalysis() will pick the file up again on the next scan when
        // the model becomes available. Also skip embedding — fallback results
        // have no meaningful content to embed.
        // Also skip entirely for embedding retries (handled above).
        const analysis_check = result?.analysis || result || {};
        const fallbackMethods = new Set([
          'filename_fallback',
          'extension_fallback',
          'filename',
          'failed',
          'pdf_no_text'
        ]);
        const isFallbackOnly =
          !isEmbeddingRetry &&
          (fallbackMethods.has(analysis_check.extractionMethod) || analysis_check._isFallback);

        if (isEmbeddingRetry) {
          // Embedding retry handled above — skip all post-analysis side effects
        } else if (isFallbackOnly) {
          logger.info(
            '[SMART-FOLDER-WATCHER] Fallback-only result, skipping history record and embedding',
            { filePath }
          );
          // Still emit to UI for immediate display via notification below,
          // but don't persist to history so _needsAnalysis() re-queues it later
        } else {
          // Embed the analyzed file into the vector DB for semantic search (fire-and-forget).
          // Decoupled from the analysis pipeline so embedding latency doesn't block the next file.
          // On failure, re-enqueue with the cached LLM result so only embedding is retried.
          this._embedAnalyzedFile(filePath, result).catch((embedErr) => {
            logger.warn(
              '[SMART-FOLDER-WATCHER] Background embedding failed, re-queuing for retry',
              {
                filePath,
                error: embedErr.message
              }
            );
            const retryCount = (item.retryCount || 0) + 1;
            if (retryCount <= MAX_ANALYSIS_RETRIES) {
              this._enqueueAnalysisItem({
                ...item,
                retryCount,
                cachedAnalysis: result // Skip LLM, retry only embedding
              });
            } else {
              logger.error('[SMART-FOLDER-WATCHER] Embedding retries exhausted', {
                filePath,
                retryCount
              });
            }
          });
          // Record to analysis history so smart folder analysis appears in history
          {
            const analysis = result?.analysis || result || {};
            const keywords = Array.isArray(analysis.keywords)
              ? analysis.keywords
              : Array.isArray(analysis.tags)
                ? analysis.tags
                : [];

            const derivedConfidence = deriveWatcherConfidencePercent(analysis);
            const historyConfidence =
              typeof analysis.confidence === 'number' &&
              (analysis.confidence !== 0 || analysis.error)
                ? analysis.confidence
                : derivedConfidence;

            const isImage = isImagePath(filePath);
            // For content updates (file edited & saved in place), preserve the
            // existing smart-folder assignment instead of using the LLM's
            // re-categorization — the user intentionally placed the file here.
            let resolvedCategory = analysis.category || analysis.folder || 'uncategorized';
            let resolvedSmartFolderName = analysis.smartFolder || analysis.folder || null;

            if (isContentUpdate) {
              const learningService = getLearningFeedbackService();
              const containingFolder = learningService?.findContainingSmartFolder?.(filePath);
              if (containingFolder) {
                resolvedCategory = containingFolder.name;
                resolvedSmartFolderName = containingFolder.name;
              }
            }

            const historyPayload = {
              // The history utility uses suggestedName as the subject fallback.
              // Prefer any naming-convention output; otherwise keep the original basename.
              suggestedName: analysis.suggestedName || path.basename(filePath),
              category: resolvedCategory,
              keywords,
              confidence: historyConfidence,
              summary: analysis.summary || analysis.description || '',
              extractedText: analysis.extractedText || null,
              smartFolder: resolvedSmartFolderName,
              model: analysis.model || result.model || (isImage ? 'vision' : 'llm'),
              // Extended fields for document/image conversations
              // CRITICAL: Use field names that match AnalysisHistoryServiceCore expectations
              documentType: analysis.type || null,
              entity: analysis.entity || null,
              project: analysis.project || null,
              purpose: analysis.purpose || null,
              reasoning: analysis.reasoning || null,
              documentDate: analysis.date || null,
              keyEntities: analysis.keyEntities || [],
              extractionMethod: analysis.extractionMethod || null,
              // Image-specific fields
              content_type: isImage ? analysis.content_type || null : null,
              has_text: isImage ? Boolean(analysis.has_text) : null,
              colors: isImage && Array.isArray(analysis.colors) ? analysis.colors : null
            };

            await recordAnalysisResult({
              filePath,
              result: historyPayload,
              processingTime: Number(result.processingTimeMs || result.processingTime || 0),
              modelType: isImagePath(filePath) ? 'vision' : 'llm',
              analysisHistory: this.analysisHistoryService,
              logger
            });

            // This triggers a rebuild on the next search instead of waiting 15 minutes
            if (!this._isStopping) {
              try {
                const { getSearchServiceInstance } = require('../ipc/semantic');
                const searchService = getSearchServiceInstance?.();
                if (searchService?.invalidateIndex) {
                  searchService.invalidateIndex();
                  logger.debug('[SMART-FOLDER-WATCHER] Invalidated BM25 index for new analysis');
                }
              } catch (invalidateErr) {
                // Non-fatal - search will still work with stale index
                logger.debug(
                  '[SMART-FOLDER-WATCHER] Could not invalidate BM25 index:',
                  invalidateErr.message
                );
              }
            }
          }
        } // end else (non-fallback: persist to history)

        // Update stats
        if (eventType === 'add') {
          this.stats.filesAnalyzed++;
        } else {
          this.stats.filesReanalyzed++;
        }

        logger.info('[SMART-FOLDER-WATCHER] Analysis complete:', filePath);

        getFileOperationTracker().recordOperation(filePath, 'analyze', 'smartFolderWatcher');

        // Send notification about the analyzed file
        const fileName = path.basename(filePath);
        const analysis = result.analysis || result;
        const confidence = deriveWatcherConfidencePercent(analysis);
        let confidenceThreshold = 75;

        try {
          const settings = await this.settingsService.load();
          confidenceThreshold = Math.round((settings?.confidenceThreshold ?? 0.75) * 100);
        } catch (settingsErr) {
          logger.debug(
            '[SMART-FOLDER-WATCHER] Could not load confidence threshold; using default:',
            settingsErr.message
          );
        }

        // Skip learning feedback for fallback-only or low-confidence analyses.
        // This prevents noisy fallback classification from polluting placement learning.
        if (!isEmbeddingRetry) {
          if (isFallbackOnly || confidence < confidenceThreshold) {
            logger.debug(
              '[SMART-FOLDER-WATCHER] Skipping learning feedback for non-actionable analysis',
              {
                fileName,
                extractionMethod: analysis?.extractionMethod || null,
                confidence,
                threshold: confidenceThreshold,
                reason: isFallbackOnly ? 'fallback_only' : 'low_confidence'
              }
            );
          } else {
            // Record implicit learning feedback - file in smart folder = positive signal
            await this._recordLearningFeedback(filePath, result);
          }
        }

        if (this.notificationService && !isEmbeddingRetry) {
          // Notify about file analysis
          await this.notificationService.notifyFileAnalyzed(fileName, 'smart_folder', {
            category: analysis.category || 'Unknown',
            confidence
          });

          // Check if confidence is below threshold for auto-organization
          if (confidence < confidenceThreshold) {
            await this.notificationService.notifyLowConfidence(
              fileName,
              confidence,
              confidenceThreshold,
              analysis.category || null
            );
          }
        }
      } else {
        logger.warn('[SMART-FOLDER-WATCHER] Analysis returned no result for:', filePath);
        this.stats.errors++;
      }
    } catch (error) {
      if (isNotFoundError(error)) {
        logger.debug('[SMART-FOLDER-WATCHER] File no longer exists:', filePath);
      } else {
        logger.error('[SMART-FOLDER-WATCHER] Error analyzing file:', {
          filePath,
          error: error.message
        });
        this.stats.errors++;
        throw error;
      }
    } finally {
      this.processingFiles.delete(filePath);
    }
  }

  /**
   * Embed an analyzed file into the vector DB for semantic search
   * This is called immediately after successful analysis to keep embeddings in sync
   * @private
   * @param {string} filePath - Path to the analyzed file
   * @param {Object} analysisResult - Result from analyzeDocumentFile or analyzeImageFile
   */
  async _embedAnalyzedFile(filePath, analysisResult) {
    // Skip if watcher is stopping — prevents fire-and-forget embeddings after shutdown
    if (this._isStopping) {
      logger.debug('[SMART-FOLDER-WATCHER] Skipping embedding - watcher is stopping');
      return;
    }

    // Skip if dependencies not available
    if (!this.folderMatcher || !this.vectorDbService) {
      logger.debug('[SMART-FOLDER-WATCHER] Skipping embedding - services not available');
      return;
    }

    // Respect global embedding timing/policy. The watcher IS the analysis path,
    // so this is `stage: 'analysis'` (not 'final'). With the default timing of
    // 'during_analysis', only 'analysis' stage embeds are permitted.
    // If we have a persisted per-file override, apply it here.
    let policyOverride = null;
    try {
      const entry = await this.analysisHistoryService?.getAnalysisByPath?.(filePath);
      policyOverride = entry?.embedding?.policy || null;
    } catch {
      // Non-fatal
    }
    const gate = await shouldEmbed({ stage: 'analysis', policyOverride });
    if (!gate.shouldEmbed) {
      logger.debug('[SMART-FOLDER-WATCHER] Skipping embedding by policy/timing gate', {
        timing: gate.timing,
        policy: gate.policy,
        filePath
      });
      try {
        await this.analysisHistoryService?.updateEmbeddingStateByPath?.(filePath, {
          status: 'skipped'
        });
      } catch {
        // Non-fatal
      }
      return;
    }

    try {
      await fs.stat(filePath);
    } catch (statError) {
      if (isNotFoundError(statError)) {
        logger.debug('[SMART-FOLDER-WATCHER] File no longer exists, skipping embedding:', {
          filePath
        });
        return;
      }
      // For other stat errors, continue and let embedding logic handle it
    }

    // Documents: applyUnifiedFolderMatching already embeds and either enqueues or attaches vector.
    // Images: have a different embedding path (image analysis block), so we skip reuse for them.
    const precomputed =
      analysisResult._embeddingForPersistence || analysisResult.analysis?._embeddingForPersistence;
    if (precomputed && !isImagePath(filePath)) {
      const { vector, model, meta, wasEnqueued } = precomputed;
      if (vector && Array.isArray(vector) && vector.length > 0 && meta) {
        if (wasEnqueued) {
          // Document analysis enqueued to EmbeddingQueue; queue will persist. Skip embed and upsert.
          logger.debug('[SMART-FOLDER-WATCHER] Reusing precomputed embedding (queued)', {
            filePath
          });
          try {
            await this.analysisHistoryService?.updateEmbeddingStateByPath?.(filePath, {
              status: 'done',
              model: model || null
            });
          } catch {
            // Non-fatal
          }
          return;
        }
        // wasEnqueued: false — policy skipped enqueue but we have the vector; use it for direct upsert
        const fileId = getCanonicalFileId(filePath, false);
        try {
          await this.vectorDbService.upsertFile({
            id: fileId,
            vector,
            model: model || 'unknown',
            meta: { ...meta, path: filePath, name: path.basename(filePath) },
            updatedAt: new Date().toISOString()
          });
          logger.debug('[SMART-FOLDER-WATCHER] Reused precomputed embedding (direct upsert)', {
            filePath
          });
          try {
            await this.analysisHistoryService?.updateEmbeddingStateByPath?.(filePath, {
              status: 'done',
              model: model || null
            });
          } catch {
            // Non-fatal
          }
          return;
        } catch (upsertErr) {
          logger.warn(
            '[SMART-FOLDER-WATCHER] Precomputed embedding upsert failed, falling back to full flow',
            {
              filePath,
              error: upsertErr?.message
            }
          );
          // Fall through to normal embed+upsert
        }
      }
    }

    try {
      // Extract analysis data - handle different result structures
      const analysis = analysisResult.analysis || analysisResult;
      const fileExtension = path.extname(filePath).toLowerCase();
      const rawKeywords = (() => {
        if (Array.isArray(analysis.keywords)) return analysis.keywords;
        if (Array.isArray(analysis.tags)) return analysis.tags;
        if (typeof analysis.tags === 'string' && analysis.tags.trim().length > 0) {
          try {
            const parsed = JSON.parse(analysis.tags);
            if (Array.isArray(parsed)) return parsed;
          } catch {
            // Fall back to comma-separated list
          }
          return analysis.tags.split(',').map((entry) => entry.trim());
        }
        return [];
      })();
      const keywords = normalizeKeywords(rawKeywords);
      const summary = analysis.summary || analysis.description || analysis.purpose || '';
      const learningService = getLearningFeedbackService();
      const resolvedSmartFolder = learningService?.findContainingSmartFolder?.(filePath) || null;
      const category = resolvedSmartFolder?.name || analysis.category || 'Uncategorized';
      const subject =
        analysis.subject || analysis.suggestedName || analysis.project || analysis.entity || '';
      const rawConfidence = analysis.confidence ?? analysisResult.confidence ?? 0;
      const confidence =
        typeof rawConfidence === 'number'
          ? rawConfidence > 1
            ? Math.round(rawConfidence)
            : Math.round(rawConfidence * 100)
          : 0;

      const purpose = analysis.purpose || '';
      const entity = analysis.entity || '';
      const project = analysis.project || '';
      const rawType = typeof analysis.type === 'string' ? analysis.type.trim() : '';
      const isGenericType = ['image', 'document', 'file', 'unknown'].includes(
        rawType.toLowerCase()
      );
      const documentType = analysis.documentType || (!isGenericType && rawType ? rawType : '');
      const documentDate = analysis.documentDate || analysis.date || null;
      const extractedText =
        typeof analysis.extractedText === 'string' ? analysis.extractedText : '';
      const isImage = isImagePath(filePath);
      const analysisForEmbedding = {
        ...analysis,
        keywords,
        subject,
        documentType,
        documentDate
      };

      const embeddingSummary = buildEmbeddingSummary(
        analysisForEmbedding,
        extractedText,
        fileExtension,
        isImage ? 'image' : 'document'
      );
      const textToEmbed = embeddingSummary.text;

      // Skip if no meaningful content to embed
      if (!textToEmbed || !textToEmbed.trim()) {
        logger.debug('[SMART-FOLDER-WATCHER] Skipping embedding - no content:', filePath);
        return;
      }
      const embedding = await this.folderMatcher.embedText(textToEmbed);

      // This ensures the file is retried later instead of being marked as done
      if (!embedding || !embedding.vector || !Array.isArray(embedding.vector)) {
        throw new Error('Failed to generate embedding vector');
      }

      // Prepare metadata for vector DB
      // IMPORTANT: IDs must match the rest of the semantic pipeline.
      const fileId = getCanonicalFileId(filePath, isImagePath(filePath));
      const fileName = path.basename(filePath);

      // Build metadata object - shared for documents and images
      const baseMeta = {
        path: filePath,
        name: fileName,
        category,
        subject,
        summary: summary.substring(0, 2000), // Increased limit for richer context
        purpose: purpose.substring(0, 1000),
        tags: keywords.slice(0, 15),
        keywords: keywords.slice(0, 15),
        type: isImage ? 'image' : 'document',
        confidence,
        // Additional fields for document/image conversations
        entity: entity.substring(0, 255),
        project: project.substring(0, 255),
        documentType: documentType.substring(0, 100),
        reasoning: (analysis.reasoning || '').substring(0, 500),
        // Store truncated extracted text for conversation context
        extractedText: extractedText.substring(0, 5000),
        extractionMethod: analysis.extractionMethod || 'unknown',
        // Document date for time-based queries
        date: documentDate,
        smartFolder: resolvedSmartFolder?.name || null,
        smartFolderPath: resolvedSmartFolder?.path || null
      };

      // Add image-specific metadata for richer image conversations
      if (isImage) {
        baseMeta.content_type = analysis.content_type || 'unknown';
        baseMeta.has_text = Boolean(analysis.has_text);
        if (Array.isArray(analysis.colors) && analysis.colors.length > 0) {
          baseMeta.colors = JSON.stringify(analysis.colors.slice(0, 10));
        }
      }

      // Upsert to vector DB with comprehensive metadata for conversations
      await this.vectorDbService.upsertFile({
        id: fileId,
        vector: embedding.vector,
        model: embedding.model || 'unknown',
        meta: baseMeta,
        updatedAt: new Date().toISOString()
      });

      logger.debug('[SMART-FOLDER-WATCHER] Embedded file:', filePath);

      // Persist done state (direct upsert).
      try {
        await this.analysisHistoryService?.updateEmbeddingStateByPath?.(filePath, {
          status: 'done',
          model: embedding.model || null
        });
      } catch {
        // Non-fatal
      }

      // Conditionally generate chunk embeddings for deep semantic search (opt-in setting)
      // Check settings for user preference, fallback to constant default
      let autoChunkEnabled = AI_DEFAULTS.EMBEDDING.AUTO_CHUNK_ON_ANALYSIS;
      try {
        const settings = await this.settingsService.load();
        if (typeof settings.autoChunkOnAnalysis === 'boolean') {
          autoChunkEnabled = settings.autoChunkOnAnalysis;
        }
      } catch (settingsErr) {
        logger.debug(
          '[SMART-FOLDER-WATCHER] Could not load settings for chunk preference:',
          settingsErr.message
        );
      }

      if (autoChunkEnabled) {
        const extractedText = analysis.extractedText || '';
        if (extractedText.trim().length >= CHUNKING.MIN_TEXT_LENGTH) {
          try {
            // This prevents orphaned chunks when file content changes
            if (typeof this.vectorDbService.deleteFileChunks === 'function') {
              await this.vectorDbService.deleteFileChunks(fileId);
            }

            const chunks = chunkText(extractedText, {
              chunkSize: CHUNKING.CHUNK_SIZE,
              overlap: CHUNKING.OVERLAP,
              maxChunks: CHUNKING.MAX_CHUNKS
            });

            const chunkEmbeddings = [];
            for (const c of chunks) {
              try {
                const chunkEmbedding = await this.folderMatcher.embedText(c.text);
                if (!chunkEmbedding?.vector?.length) continue;

                const snippet = c.text.slice(0, 240);
                chunkEmbeddings.push({
                  id: `chunk:${fileId}:${c.index}`,
                  vector: chunkEmbedding.vector,
                  meta: {
                    fileId,
                    path: filePath,
                    name: fileName,
                    chunkIndex: c.index,
                    startOffset: c.charStart,
                    endOffset: c.charEnd,
                    text: c.text,
                    content: c.text,
                    charStart: c.charStart,
                    charEnd: c.charEnd,
                    snippet,
                    model: chunkEmbedding.model || 'unknown'
                  },
                  document: snippet
                });
              } catch (chunkErr) {
                logger.debug('[SMART-FOLDER-WATCHER] Failed to embed chunk:', {
                  file: fileName,
                  chunkIndex: c.index,
                  error: chunkErr?.message
                });
              }
            }

            // Batch upsert chunks if we have any
            if (
              chunkEmbeddings.length > 0 &&
              typeof this.vectorDbService.batchUpsertFileChunks === 'function'
            ) {
              await this.vectorDbService.batchUpsertFileChunks(chunkEmbeddings);
              logger.debug('[SMART-FOLDER-WATCHER] Embedded chunks:', {
                file: fileName,
                count: chunkEmbeddings.length
              });
            }
          } catch (chunkingError) {
            // Non-fatal - chunk embedding failure shouldn't block analysis
            logger.debug('[SMART-FOLDER-WATCHER] Chunk embedding failed:', chunkingError.message);
          }
        }
      }
    } catch (error) {
      logger.warn('[SMART-FOLDER-WATCHER] Failed to embed file:', {
        filePath,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Record learning feedback for a file in a smart folder
   * This teaches the system that files like this belong in this folder
   * @private
   * @param {string} filePath - Path to the analyzed file
   * @param {Object} analysisResult - Analysis result
   */
  async _recordLearningFeedback(filePath, analysisResult) {
    try {
      const learningService = getLearningFeedbackService();
      if (!learningService) {
        // Service not initialized yet - skip silently
        return;
      }

      // Find which smart folder this file is in
      const smartFolder = learningService.findContainingSmartFolder(filePath);
      if (!smartFolder) {
        // Not in a smart folder - shouldn't happen but guard anyway
        return;
      }

      // Extract analysis data
      const analysis = analysisResult?.analysis || analysisResult || {};
      const extractionMethod = String(analysis?.extractionMethod || '').toLowerCase();

      // Defensive guard: never learn from fallback/no-content analyses.
      if (
        analysis?._isFallback ||
        extractionMethod === 'pdf_no_text' ||
        extractionMethod === 'failed' ||
        extractionMethod === 'filename' ||
        extractionMethod.includes('fallback')
      ) {
        return;
      }

      // Record the implicit feedback
      await learningService.recordFilePlacement({
        filePath,
        smartFolder,
        analysis,
        source: FEEDBACK_SOURCES.WATCHER_DETECTION
      });

      logger.debug('[SMART-FOLDER-WATCHER] Recorded learning feedback:', {
        file: path.basename(filePath),
        folder: smartFolder.name
      });
    } catch (error) {
      // Non-fatal - learning failure shouldn't block analysis
      logger.debug('[SMART-FOLDER-WATCHER] Learning feedback failed:', error.message);
    }
  }

  /**
   * Handle file deletion events from the watcher
   * Removes embeddings and analysis history for externally deleted files
   * FIX: Prevents ghost entries when files are deleted via File Explorer
   * @private
   * @param {string} filePath - Path to the deleted file
   */
  async _handleFileDeletion(filePath) {
    // Skip unsupported files
    if (!isSupportedFile(filePath)) {
      logger.debug('[SMART-FOLDER-WATCHER] Skipping unsupported deleted file:', filePath);
      return;
    }

    // Skip temp files
    if (isTemporaryFile(filePath)) {
      logger.debug('[SMART-FOLDER-WATCHER] Skipping temp file deletion:', filePath);
      return;
    }

    logger.info('[SMART-FOLDER-WATCHER] Detected external file deletion:', filePath);

    try {
      const deferred = await this._deferDeletionForMove(filePath);
      if (deferred) {
        return;
      }
    } catch (deferError) {
      logger.debug(
        '[SMART-FOLDER-WATCHER] Move detection setup failed, deleting immediately:',
        deferError.message
      );
    }

    await this._finalizeDeletion(filePath);
  }

  /**
   * Defer deletion briefly to detect move/rename events.
   *
   * FIX: Store baseName for disambiguation when multiple candidates exist.
   *
   * @private
   * @returns {Promise<boolean>} True if deletion was deferred
   */
  async _deferDeletionForMove(filePath) {
    if (!this.analysisHistoryService?.getAnalysisByPath) {
      return false;
    }

    const entry = await this.analysisHistoryService.getAnalysisByPath(filePath);

    // Parse persisted metadata strictly to avoid false-positive move matches from malformed values.
    const parsedSize = Number(entry?.fileSize);
    const parseLastModified = (value) => {
      if (typeof value === 'number' && Number.isFinite(value)) return value;
      if (typeof value !== 'string') return null;
      const trimmed = value.trim();
      if (!trimmed) return null;

      const numeric = Number(trimmed);
      if (Number.isFinite(numeric)) return numeric;

      const parsedDate = Date.parse(trimmed);
      return Number.isFinite(parsedDate) ? parsedDate : null;
    };
    const parsedLastModified = parseLastModified(entry?.lastModified);

    if (!entry || !Number.isFinite(parsedSize) || !Number.isFinite(parsedLastModified)) {
      return false;
    }

    // Replace any existing candidate for the same path
    const existing = this._pendingMoveCandidates.get(filePath);
    if (existing?.timeoutId) {
      clearTimeout(existing.timeoutId);
    }

    const candidate = {
      oldPath: filePath,
      size: parsedSize,
      mtimeMs: parsedLastModified,
      ext: path.extname(filePath).toLowerCase(),
      baseName: path.basename(filePath),
      createdAt: Date.now(),
      timeoutId: null
    };

    candidate.timeoutId = setTimeout(() => {
      this._pendingMoveCandidates.delete(filePath);
      this._finalizeDeletion(filePath).catch((err) => {
        logger.warn('[SMART-FOLDER-WATCHER] Deferred deletion failed:', err.message);
      });
    }, this._moveDetectionWindowMs);

    if (candidate.timeoutId && typeof candidate.timeoutId.unref === 'function') {
      candidate.timeoutId.unref();
    }

    // Bound the move candidates map to prevent unbounded growth during mass deletions
    const MAX_PENDING_MOVES = 200;
    if (this._pendingMoveCandidates.size >= MAX_PENDING_MOVES) {
      // Evict the oldest candidate
      const oldestKey = this._pendingMoveCandidates.keys().next().value;
      const oldest = this._pendingMoveCandidates.get(oldestKey);
      if (oldest?.timeoutId) clearTimeout(oldest.timeoutId);
      this._pendingMoveCandidates.delete(oldestKey);
      logger.debug('[SMART-FOLDER-WATCHER] Evicted oldest pending move candidate due to limit', {
        evicted: path.basename(oldestKey)
      });
    }

    this._pendingMoveCandidates.set(filePath, candidate);

    logger.debug('[SMART-FOLDER-WATCHER] Deferring deletion to detect move', {
      file: path.basename(filePath),
      windowMs: this._moveDetectionWindowMs
    });

    return true;
  }

  /**
   * Finalize deletion cleanup for a removed file.
   * @private
   */
  async _finalizeDeletion(filePath) {
    try {
      // Remove from vector DB (both file: and image: prefixes)
      if (this.vectorDbService) {
        const filePrefix = getCanonicalFileId(filePath, false);
        const imagePrefix = getCanonicalFileId(filePath, true);
        const legacyFilePrefix = `file:${filePath}`;
        const legacyImagePrefix = `image:${filePath}`;
        const idsToDelete =
          filePrefix === `file:${filePath}`
            ? [filePrefix, imagePrefix]
            : [filePrefix, imagePrefix, legacyFilePrefix, legacyImagePrefix];

        // Use batch delete for atomicity when available
        if (typeof this.vectorDbService.batchDeleteFileEmbeddings === 'function') {
          await this.vectorDbService.batchDeleteFileEmbeddings(idsToDelete);
        } else {
          // Fallback to individual deletes
          for (const id of idsToDelete) {
            try {
              await this.vectorDbService.deleteFileEmbedding(id);
            } catch (delErr) {
              logger.debug(
                '[SMART-FOLDER-WATCHER] Failed to delete embedding:',
                id,
                delErr.message
              );
              // Continue with remaining IDs
            }
          }
        }

        // Delete associated chunks
        if (typeof this.vectorDbService.deleteFileChunks === 'function') {
          for (const id of idsToDelete) {
            try {
              await this.vectorDbService.deleteFileChunks(id);
            } catch (chunkErr) {
              logger.debug('[SMART-FOLDER-WATCHER] Failed to delete chunks:', id, chunkErr.message);
              // Continue with remaining IDs
            }
          }
        }

        logger.debug('[SMART-FOLDER-WATCHER] Removed embeddings for deleted file:', filePath);
      }

      // Remove from analysis history
      if (this.analysisHistoryService?.removeEntriesByPath) {
        try {
          await this.analysisHistoryService.removeEntriesByPath(filePath);
          logger.debug('[SMART-FOLDER-WATCHER] Removed history for deleted file:', filePath);
        } catch (historyErr) {
          logger.debug(
            '[SMART-FOLDER-WATCHER] Failed to remove history:',
            filePath,
            historyErr.message
          );
          // Continue with remaining cleanup
        }
      }

      // Invalidate BM25 search index
      if (!this._isStopping) {
        try {
          const { getSearchServiceInstance } = require('../ipc/semantic');
          const searchService = getSearchServiceInstance?.();
          if (searchService?.invalidateIndex) {
            searchService.invalidateIndex({ reason: 'external-deletion', oldPath: filePath });
          }
        } catch (indexErr) {
          logger.debug(
            '[SMART-FOLDER-WATCHER] Could not invalidate search index:',
            indexErr.message
          );
        }
      }

      this.stats.lastActivity = new Date().toISOString();
    } catch (error) {
      logger.warn(
        '[SMART-FOLDER-WATCHER] Error cleaning up deleted file:',
        filePath,
        error.message
      );
      this.stats.errors++;
    }
  }

  /**
   * Reconcile orphaned entries on startup.
   *
   * When the watcher is stopped (e.g. app closed), files may be deleted or
   * moved out of smart folders externally. On next startup, this sweep checks
   * analysis history for files within watched smart folders that no longer
   * exist on disk and cleans up their embeddings, chunks, and history.
   *
   * Runs in the background with yielding so it never blocks the main thread
   * or delays normal watcher operation.
   * @private
   */
  async _reconcileOrphanedEntries() {
    // Let the system settle after startup before sweeping
    await delay(5000);

    if (this._isStopping || !this.isRunning) return;

    const entries = this.analysisHistoryService?.analysisHistory?.entries;
    if (!entries || typeof entries !== 'object') {
      logger.debug('[SMART-FOLDER-WATCHER] Reconciliation skipped — no history entries available');
      return;
    }

    // Snapshot the entries to avoid mutation during iteration
    const allEntries = Object.values(entries);
    let checked = 0;
    let removed = 0;

    for (const entry of allEntries) {
      if (this._isStopping) break;

      // Resolve the file's current path (actual if moved, otherwise original)
      const filePath = entry?.organization?.actual || entry?.originalPath;
      if (!filePath) continue;

      // Only reconcile files within watched smart folders
      if (!this._isInWatchedPath(filePath)) continue;

      checked++;

      try {
        await fs.access(filePath);
      } catch {
        // File no longer exists — clean up embeddings, chunks, and history
        try {
          await this._finalizeDeletion(filePath);
          removed++;
          logger.debug('[SMART-FOLDER-WATCHER] Reconciled orphaned entry:', {
            file: path.basename(filePath)
          });
        } catch (cleanupErr) {
          logger.debug('[SMART-FOLDER-WATCHER] Reconciliation cleanup failed:', {
            file: path.basename(filePath),
            error: cleanupErr.message
          });
        }
      }

      // Yield every 50 files to avoid blocking the event loop
      if (checked % 50 === 0) {
        await delay(100);
      }
    }

    if (removed > 0) {
      this.stats.orphansReconciled += removed;
      this.stats.lastActivity = new Date().toISOString();
      logger.info('[SMART-FOLDER-WATCHER] Startup reconciliation complete', { checked, removed });
    } else {
      logger.debug('[SMART-FOLDER-WATCHER] Startup reconciliation — no orphans found', {
        checked
      });
    }
  }

  /**
   * Handle watcher errors
   * @private
   */
  _handleError(error) {
    const fsError = error.isFileSystemError ? error : new WatcherError('smart-folders', error);

    logger.error('[SMART-FOLDER-WATCHER] Watcher error:', {
      message: fsError.getUserFriendlyMessage?.() || error.message,
      code: fsError.code
    });

    this.stats.errors++;
  }

  /**
   * Get current status
   * @returns {Object} Status information
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      isStarting: this.isStarting,
      watchedFolders: [...this.watchedPaths],
      watchedCount: this.watchedPaths.size,
      queueLength: this.analysisQueue.length,
      processingCount: this.processingFiles.size,
      stats: { ...this.stats },
      lastStartError: this._lastStartError || null
    };
  }

  /**
   * Manually trigger a scan of all smart folders for unanalyzed files
   * @returns {Promise<{scanned: number, queued: number}>}
   */
  async scanForUnanalyzedFiles() {
    logger.info('[SMART-FOLDER-WATCHER] Scanning for unanalyzed files...');

    let scanned = 0;
    let queued = 0;

    for (const folderPath of this.watchedPaths) {
      try {
        const files = await this._scanDirectory(folderPath);
        scanned += files.length;

        for (const file of files) {
          const stats = await fs.stat(file);
          const mtime = new Date(stats.mtime).getTime();
          const needsAnalysis = await this._needsAnalysis(file, mtime, stats);

          if (needsAnalysis) {
            this._enqueueAnalysisItem({
              filePath: file,
              mtime,
              eventType: 'scan',
              queuedAt: Date.now()
            });
            queued++;
          }
        }
      } catch (error) {
        logger.warn('[SMART-FOLDER-WATCHER] Error scanning folder:', {
          folderPath,
          error: error.message
        });
      }
    }

    logger.info('[SMART-FOLDER-WATCHER] Scan complete:', { scanned, queued });
    return { scanned, queued };
  }

  /**
   * Preview reanalysis scope without enqueueing work.
   * @returns {Promise<{scanned: number, watchedFolders: number}>}
   */
  async previewReanalyzeAll() {
    let scanned = 0;
    for (const folderPath of this.watchedPaths) {
      try {
        const files = await this._scanDirectory(folderPath);
        scanned += files.length;
      } catch (error) {
        logger.warn('[SMART-FOLDER-WATCHER] Preview scan failed:', {
          folderPath,
          error: error.message
        });
      }
    }

    return { scanned, watchedFolders: this.watchedPaths.size };
  }

  _isInWatchedPath(filePath) {
    if (!filePath || this.watchedPaths.size === 0) return false;
    const normalizedPath = normalizePathForIndex(filePath);
    if (!normalizedPath) return false;

    for (const folderPath of this.watchedPaths) {
      const normalizedFolder = normalizePathForIndex(folderPath);
      if (!normalizedFolder) continue;
      const prefix = normalizedFolder.endsWith('/') ? normalizedFolder : `${normalizedFolder}/`;
      if (normalizedPath.startsWith(prefix)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Queue a single file for reanalysis.
   * @param {string} filePath
   * @param {Object} [options]
   * @param {boolean} [options.force] - Skip the watched-path check (for user-initiated reanalysis)
   * @param {boolean} [options.applyNaming] - Apply naming conventions to the result
   * @returns {Promise<{queued: boolean, error?: string, errorCode?: string}>}
   */
  async reanalyzeFile(filePath, options = {}) {
    if (!filePath) {
      return { queued: false, error: 'filePath is required', errorCode: 'MISSING_FILE_PATH' };
    }

    if (!options.force && !this._isInWatchedPath(filePath)) {
      return {
        queued: false,
        error: 'File is not inside a watched smart folder',
        errorCode: 'NOT_IN_SMART_FOLDER'
      };
    }

    const stats = await fs.stat(filePath);
    const mtime = stats?.mtime ? new Date(stats.mtime).getTime() : Date.now();

    this._enqueueAnalysisItem({
      filePath,
      mtime,
      eventType: 'reanalyze',
      applyNaming: options.applyNaming,
      queuedAt: Date.now()
    });

    logger.info('[SMART-FOLDER-WATCHER] Queued single file for reanalysis', {
      filePath
    });

    return { queued: true };
  }

  /**
   * Force reanalysis of ALL files in smart folders, regardless of existing analysis.
   * Use this when changing AI models to regenerate all analysis with the new model.
   * @returns {Promise<{scanned: number, queued: number}>}
   */
  async forceReanalyzeAll(options = {}) {
    if (this._isStopping) {
      logger.debug('[SMART-FOLDER-WATCHER] Skipping forceReanalyzeAll — watcher is stopping');
      return { scanned: 0, queued: 0 };
    }

    logger.info('[SMART-FOLDER-WATCHER] Force reanalyzing ALL files...', {
      applyNaming: options.applyNaming
    });

    // Reset circuit breakers so prior failures don't block bulk reanalysis
    for (const modelType of ['text', 'vision', 'embedding']) {
      resetLlamaCircuit(modelType);
    }

    // Reset folder matching caches so embeddings are re-persisted into
    // the now-empty vector DB (resetAll() was called before this)
    try {
      if (this.folderMatcher?.resetForReanalysis) {
        this.folderMatcher.resetForReanalysis();
      }
      clearSmartFolderUpsertCache(this.folderMatcher);
    } catch (cacheErr) {
      logger.debug('[SMART-FOLDER-WATCHER] Could not reset folder matcher:', cacheErr?.message);
    }

    let scanned = 0;
    let queued = 0;

    for (const folderPath of this.watchedPaths) {
      try {
        const files = await this._scanDirectory(folderPath);
        scanned += files.length;

        for (const file of files) {
          try {
            const stats = await fs.stat(file);
            const mtime = new Date(stats.mtime).getTime();

            // Queue ALL files for reanalysis, ignoring existing analysis
            this._enqueueAnalysisItem({
              filePath: file,
              mtime,
              eventType: 'reanalyze',
              queuedAt: Date.now(),
              applyNaming: options.applyNaming
            });
            queued++;
          } catch (fileErr) {
            logger.debug('[SMART-FOLDER-WATCHER] Cannot stat file:', {
              file,
              error: fileErr.message
            });
          }
        }
      } catch (error) {
        logger.warn('[SMART-FOLDER-WATCHER] Error scanning folder:', {
          folderPath,
          error: error.message
        });
      }
    }

    // Sort queue so non-images come first — eliminates text↔vision model thrashing
    this.analysisQueue.sort((a, b) => {
      const aImg = isImagePath(a.filePath) ? 1 : 0;
      const bImg = isImagePath(b.filePath) ? 1 : 0;
      return aImg - bImg;
    });

    logger.info('[SMART-FOLDER-WATCHER] Force reanalyze queued:', { scanned, queued });
    return { scanned, queued };
  }

  /**
   * Recursively scan a directory for supported files
   * @private
   */
  async _scanDirectory(dirPath, maxDepth = 10, currentDepth = 0) {
    if (currentDepth >= maxDepth) return [];

    const files = [];

    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);

        // Skip hidden files/folders
        if (entry.name.startsWith('.')) continue;

        if (entry.isDirectory()) {
          // Skip system directories
          if (entry.name === 'node_modules' || entry.name === '.git') continue;

          const subFiles = await this._scanDirectory(fullPath, maxDepth, currentDepth + 1);
          files.push(...subFiles);
        } else if (entry.isFile()) {
          if (isSupportedFile(fullPath) && !isTemporaryFile(fullPath)) {
            files.push(fullPath);
          }
        }
      }
    } catch (error) {
      logger.debug('[SMART-FOLDER-WATCHER] Cannot read directory:', {
        dirPath,
        error: error.message
      });
    }

    return files;
  }

  /**
   * Shutdown handler for DI container compatibility
   */
  async shutdown() {
    await this.stop();
  }
}

module.exports = SmartFolderWatcher;
