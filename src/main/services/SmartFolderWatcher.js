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
 * - Debouncing to wait for file saves to complete
 * - Opt-in via settings
 *
 * @module services/SmartFolderWatcher
 */

const fs = require('fs').promises;
const path = require('path');
const chokidar = require('chokidar');
const { logger: baseLogger, createLogger } = require('../../shared/logger');
const { isNotFoundError } = require('../../shared/errorClassifier');
const { WatcherError } = require('../errors/FileSystemError');
const { generateSuggestedNameFromAnalysis } = require('./autoOrganize/namingUtils');
const { generateFileHash } = require('./analysisHistory/indexManager');
const { deriveWatcherConfidencePercent } = require('./confidence/watcherConfidence');
const { recordAnalysisResult } = require('../ipc/analysisUtils');
const { chunkText } = require('../utils/textChunking');
const { CHUNKING } = require('../../shared/performanceConstants');
const { AI_DEFAULTS } = require('../../shared/constants');
const { getInstance: getFileOperationTracker } = require('../../shared/fileOperationTracker');
const { normalizePathForIndex, getCanonicalFileId } = require('../../shared/pathSanitization');
const { isUNCPath } = require('../../shared/crossPlatformUtils');
const {
  getInstance: getLearningFeedbackService,
  FEEDBACK_SOURCES
} = require('./organization/learningFeedback');

const logger = typeof createLogger === 'function' ? createLogger('SmartFolderWatcher') : baseLogger;
if (typeof createLogger !== 'function' && logger?.setContext) {
  logger.setContext('SmartFolderWatcher');
}

// CRITICAL: Prevent unbounded memory growth under heavy file activity (e.g., large archive extraction).
// We bound the analysis queue and apply light deduplication by filePath.
const MAX_ANALYSIS_QUEUE_SIZE = 500;
const QUEUE_DROP_LOG_INTERVAL_MS = 10_000;

// Temporary/incomplete file patterns to ignore
const TEMP_FILE_PATTERNS = [
  /\.(tmp|temp)$/i,
  /\.crdownload$/i,
  /\.part$/i,
  /\.!qB$/i,
  /\.download$/i,
  /\.partial$/i,
  /~\$/,
  /^~/,
  /\.swp$/i,
  /\.lock$/i,
  /\.lck$/i,
  /\._/,
  /\.DS_Store$/i,
  /Thumbs\.db$/i,
  /desktop\.ini$/i
];

// Image file extensions
const IMAGE_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.bmp',
  '.webp',
  '.tiff',
  '.svg',
  '.heic'
]);

// Supported file extensions for analysis
const SUPPORTED_EXTENSIONS = new Set([
  // Documents
  '.pdf',
  '.doc',
  '.docx',
  '.txt',
  '.rtf',
  '.odt',
  '.xls',
  '.xlsx',
  '.ppt',
  '.pptx',
  '.csv',
  '.md',
  '.json',
  '.xml',
  '.html',
  '.htm',
  // Images
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.bmp',
  '.webp',
  '.tiff',
  '.svg',
  '.heic',
  // Code/text
  '.js',
  '.ts',
  '.jsx',
  '.tsx',
  '.py',
  '.java',
  '.cpp',
  '.c',
  '.h',
  '.css',
  '.scss',
  '.yaml',
  '.yml',
  '.ini',
  '.conf',
  '.log'
]);

/**
 * Check if file is an image
 * @param {string} filePath - Path to check
 * @returns {boolean} True if image
 */
function isImageFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return IMAGE_EXTENSIONS.has(ext);
}

/**
 * Check if a file path is a temporary or incomplete file
 * @param {string} filePath - Path to check
 * @returns {boolean} True if the file appears to be temporary
 */
function isTemporaryFile(filePath) {
  const basename = path.basename(filePath);
  for (const pattern of TEMP_FILE_PATTERNS) {
    if (pattern.test(basename)) {
      return true;
    }
  }
  return false;
}

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
   * @param {Object} deps.chromaDbService - ChromaDB service for embeddings
   * @param {Object} deps.folderMatcher - FolderMatchingService for generating embeddings
   * @param {Object} deps.notificationService - Notification service for user feedback
   */
  constructor({
    getSmartFolders,
    analysisHistoryService,
    analyzeDocumentFile,
    analyzeImageFile,
    settingsService,
    chromaDbService,
    folderMatcher,
    notificationService
  }) {
    this.getSmartFolders = getSmartFolders;
    this.analysisHistoryService = analysisHistoryService;
    this.analyzeDocumentFile = analyzeDocumentFile;
    this.analyzeImageFile = analyzeImageFile;
    this.settingsService = settingsService;
    this.chromaDbService = chromaDbService;
    this.folderMatcher = folderMatcher;
    this.notificationService = notificationService;

    this.watcher = null;
    this.isRunning = false;
    this.isStarting = false;
    this.watchedPaths = new Set();

    // FIX M3: Promise deduplication for concurrent start() calls
    this._startPromise = null;

    // FIX M-6: Flag to prevent timer callbacks during shutdown
    this._isStopping = false;

    // Processing state
    this.processingFiles = new Set();
    this.pendingAnalysis = new Map(); // filePath -> { mtime, timeout }
    this.analysisQueue = [];
    this.isProcessingQueue = false;

    // Configuration
    this.debounceDelay = 1000; // 1 second debounce
    // Maximum time to keep deferring analysis for a hot file (prevents indefinite postponement)
    this.maxDebounceWaitMs = 5000;
    this.stabilityThreshold = 3000; // 3 seconds - file must be stable for this long
    this.queueProcessInterval = 2000; // Process queue every 2 seconds
    this.maxConcurrentAnalysis = 2; // Max files to analyze at once

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
      lastActivity: null
    };
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

    // FIX M3: Return existing start promise if one is in progress
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

      // FIX Issue-3: Provide detailed, user-friendly error messages when start fails
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
      // FIX: Prevents ghost entries when files are deleted outside the app
      this.watcher.on('unlink', (filePath) => {
        this._handleFileDeletion(filePath);
      });

      // Handle errors
      this.watcher.on('error', (error) => {
        this._handleError(error);
      });

      // Handle ready
      this.watcher.on('ready', () => {
        logger.info(
          '[SMART-FOLDER-WATCHER] Watcher ready, monitoring',
          validPaths.length,
          'folders'
        );
        this.watchedPaths = new Set(validPaths);
        this.isRunning = true;
        // Note: isStarting is cleared in start() finally block
      });

      // Start queue processor
      this._startQueueProcessor();

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
   */
  stop() {
    logger.info('[SMART-FOLDER-WATCHER] Stopping...');
    this._isStopping = true;

    // Stop queue processor
    if (this.queueTimer) {
      clearInterval(this.queueTimer);
      this.queueTimer = null;
    }

    // Clear pending analysis timeouts
    for (const pending of this.pendingAnalysis.values()) {
      if (pending.timeout) {
        clearTimeout(pending.timeout);
      }
    }
    this.pendingAnalysis.clear();

    // Stop watcher
    if (this.watcher) {
      try {
        this.watcher.removeAllListeners();
        this.watcher.close();
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

    logger.info('[SMART-FOLDER-WATCHER] Stopped');
  }

  /**
   * Restart the watcher (e.g., when smart folders change)
   */
  async restart() {
    logger.info('[SMART-FOLDER-WATCHER] Restarting...');
    this.stop();
    await new Promise((resolve) => setTimeout(resolve, 500)); // Brief pause
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
    // FIX: Skip files recently operated on by any watcher (prevents infinite loops)
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
      this._queueFileForAnalysis(filePath, mtime, eventType);
    }, delay);

    this.pendingAnalysis.set(filePath, { mtime, timeout, eventType, firstEventAt });
  }

  /**
   * Queue a file for analysis
   * @private
   */
  async _queueFileForAnalysis(filePath, mtime, eventType) {
    // Fix: Cleanup any existing timeout to prevent memory leaks or race conditions
    const pending = this.pendingAnalysis.get(filePath);
    if (pending && pending.timeout) {
      clearTimeout(pending.timeout);
    }
    this.pendingAnalysis.delete(filePath);

    try {
      // Verify file still exists
      await fs.access(filePath);

      // Check if analysis is needed
      const needsAnalysis = await this._needsAnalysis(filePath, mtime);

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

        // FIX P1-2: Notify user about dropped items so they know analysis was skipped
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
            .catch(() => {});
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
   * Check if a file needs analysis
   * @private
   */
  async _needsAnalysis(filePath, mtime) {
    try {
      // Get existing analysis for this file
      const existingAnalysis = await this.analysisHistoryService.getAnalysisByPath(filePath);

      // If not found by path, try by file hash (helps when paths change case or file moved)
      let matchedAnalysis = existingAnalysis;
      if (!matchedAnalysis) {
        // We need file size/mtime to compute the hash
        const stats = await fs.stat(filePath);
        const hash = generateFileHash(
          filePath,
          stats.size,
          stats.mtime ? stats.mtime.toISOString() : new Date(mtime).toISOString()
        );
        matchedAnalysis = await this.analysisHistoryService.getAnalysisByHash(hash);
      }

      if (!matchedAnalysis) {
        // New file - needs analysis
        return true;
      }

      // Check if file was modified after last analysis
      const analysisTime = new Date(
        matchedAnalysis.lastModified || matchedAnalysis.timestamp
      ).getTime();
      return mtime > analysisTime;
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
    if (this.isProcessingQueue || this.analysisQueue.length === 0) {
      return;
    }

    this.isProcessingQueue = true;

    try {
      // Take up to maxConcurrentAnalysis files from queue
      const batchSize = Math.max(1, this.maxConcurrentAnalysis || 1);
      const batch = this.analysisQueue.splice(0, batchSize);

      for (const item of batch) {
        await this._analyzeFile(item);
      }
    } catch (error) {
      logger.error('[SMART-FOLDER-WATCHER] Queue processing error:', error.message);
      this.stats.errors++;
    } finally {
      this.isProcessingQueue = false;
    }
  }

  /**
   * Analyze a single file
   * @private
   */
  async _analyzeFile(item) {
    const { filePath, eventType, applyNaming } = item;
    const isReanalyze = eventType === 'reanalyze';

    if (this.processingFiles.has(filePath)) {
      return;
    }

    this.processingFiles.add(filePath);

    try {
      // Verify file still exists
      await fs.stat(filePath);

      logger.info('[SMART-FOLDER-WATCHER] Analyzing file:', filePath, {
        applyNaming: applyNaming !== false
      });

      // Get smart folders for categorization
      // FIX H-4: Guard against null/undefined from getSmartFolders()
      const smartFolders = this.getSmartFolders() || [];
      const folderCategories = smartFolders.map((f) => ({
        name: f.name,
        description: f.description || '',
        id: f.id
      }));

      // Choose analysis function based on file type
      let result;
      if (isImageFile(filePath)) {
        result = await this.analyzeImageFile(filePath, folderCategories, {
          bypassCache: isReanalyze
        });
      } else {
        result = await this.analyzeDocumentFile(filePath, folderCategories, {
          bypassCache: isReanalyze
        });
      }

      if (result) {
        // Apply user's naming convention to the suggested name (unless explicitly disabled)
        // Default behavior is to apply naming (backward compatibility)
        const shouldApplyNaming = applyNaming !== false;

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

            // Get file timestamps for date-based naming
            const stats = await fs.stat(filePath);
            const fileTimestamps = {
              created: stats.birthtime,
              modified: stats.mtime
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

        // FIX: Immediately embed the analyzed file into ChromaDB for semantic search
        // This ensures files watched by SmartFolderWatcher are searchable without manual rebuild
        await this._embedAnalyzedFile(filePath, result);

        // FIX: Record to analysis history so smart folder analysis appears in history
        {
          const analysis = result?.analysis || result || {};
          const keywords = Array.isArray(analysis.keywords)
            ? analysis.keywords
            : Array.isArray(analysis.tags)
              ? analysis.tags
              : [];

          const derivedConfidence = deriveWatcherConfidencePercent(analysis);
          const historyConfidence =
            typeof analysis.confidence === 'number' && (analysis.confidence !== 0 || analysis.error)
              ? analysis.confidence
              : derivedConfidence;

          const historyPayload = {
            // The history utility uses suggestedName as the subject fallback.
            // Prefer any naming-convention output; otherwise keep the original basename.
            suggestedName: analysis.suggestedName || path.basename(filePath),
            category: analysis.category || analysis.folder || 'uncategorized',
            keywords,
            confidence: historyConfidence,
            summary: analysis.summary || analysis.description || analysis.purpose || '',
            extractedText: analysis.extractedText || null,
            smartFolder: analysis.smartFolder || analysis.folder || null,
            model: analysis.model || result.model || (isImageFile(filePath) ? 'vision' : 'llm')
          };

          await recordAnalysisResult({
            filePath,
            result: historyPayload,
            processingTime: Number(result.processingTimeMs || result.processingTime || 0),
            modelType: isImageFile(filePath) ? 'vision' : 'llm',
            analysisHistory: this.analysisHistoryService,
            logger
          });

          // FIX P1-2: Invalidate BM25 index after analysis so new files are searchable immediately
          // This triggers a rebuild on the next search instead of waiting 15 minutes
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

        // Update stats
        if (eventType === 'add') {
          this.stats.filesAnalyzed++;
        } else {
          this.stats.filesReanalyzed++;
        }

        logger.info('[SMART-FOLDER-WATCHER] Analysis complete:', filePath);

        // FIX: Record operation to prevent infinite loops with other watchers
        getFileOperationTracker().recordOperation(filePath, 'analyze', 'smartFolderWatcher');

        // Record implicit learning feedback - file in smart folder = positive signal
        await this._recordLearningFeedback(filePath, result);

        // Send notification about the analyzed file
        const fileName = path.basename(filePath);
        const analysis = result.analysis || result;
        const confidence = deriveWatcherConfidencePercent(analysis);

        if (this.notificationService) {
          // Notify about file analysis
          await this.notificationService.notifyFileAnalyzed(fileName, 'smart_folder', {
            category: analysis.category || 'Unknown',
            confidence
          });

          // Check if confidence is below threshold for auto-organization
          try {
            const settings = await this.settingsService.load();
            const threshold = Math.round((settings.confidenceThreshold ?? 0.75) * 100);
            if (confidence < threshold) {
              await this.notificationService.notifyLowConfidence(
                fileName,
                confidence,
                threshold,
                analysis.category || null
              );
            }
          } catch (settingsErr) {
            logger.debug('[SMART-FOLDER-WATCHER] Could not check threshold:', settingsErr.message);
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
      }
    } finally {
      this.processingFiles.delete(filePath);
    }
  }

  /**
   * Embed an analyzed file into ChromaDB for semantic search
   * This is called immediately after successful analysis to keep embeddings in sync
   * @private
   * @param {string} filePath - Path to the analyzed file
   * @param {Object} analysisResult - Result from analyzeDocumentFile or analyzeImageFile
   */
  async _embedAnalyzedFile(filePath, analysisResult) {
    // Skip if dependencies not available
    if (!this.folderMatcher || !this.chromaDbService) {
      logger.debug('[SMART-FOLDER-WATCHER] Skipping embedding - services not available');
      return;
    }

    // FIX: Verify file still exists before embedding (prevents ghost embeddings)
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

    try {
      // Extract analysis data - handle different result structures
      const analysis = analysisResult.analysis || analysisResult;
      // FIX: Use purpose as fallback for summary if missing (common in fallback analysis)
      const summary = analysis.summary || analysis.description || analysis.purpose || '';
      const category = analysis.category || 'Uncategorized';
      const keywords = analysis.keywords || analysis.tags || [];
      const subject = analysis.subject || '';
      // FIX: Extract confidence score - normalize to 0-100 integer
      const rawConfidence = analysis.confidence ?? analysisResult.confidence ?? 0;
      const confidence =
        typeof rawConfidence === 'number'
          ? rawConfidence > 1
            ? Math.round(rawConfidence)
            : Math.round(rawConfidence * 100)
          : 0;

      // Skip if no meaningful content to embed
      if (!summary && !subject) {
        logger.debug('[SMART-FOLDER-WATCHER] Skipping embedding - no content:', filePath);
        return;
      }

      // Generate embedding vector using folderMatcher
      const textToEmbed = [summary, subject, keywords?.join(' ')].filter(Boolean).join(' ');
      const embedding = await this.folderMatcher.embedText(textToEmbed);

      if (!embedding || !embedding.vector || !Array.isArray(embedding.vector)) {
        logger.warn('[SMART-FOLDER-WATCHER] Failed to generate embedding for:', filePath);
        return;
      }

      // Prepare metadata for ChromaDB
      // IMPORTANT: IDs must match the rest of the semantic pipeline.
      const fileId = getCanonicalFileId(filePath, isImageFile(filePath));
      const fileName = path.basename(filePath);

      // Upsert to ChromaDB
      await this.chromaDbService.upsertFile({
        id: fileId,
        vector: embedding.vector,
        model: embedding.model || 'unknown',
        meta: {
          path: filePath,
          name: fileName,
          category,
          subject,
          summary: summary.substring(0, 1000), // Limit summary length
          tags: JSON.stringify(keywords.slice(0, 10)), // Limit tags
          type: isImageFile(filePath) ? 'image' : 'document',
          confidence // FIX: Include confidence score in metadata for search display
        },
        updatedAt: new Date().toISOString()
      });

      logger.debug('[SMART-FOLDER-WATCHER] Embedded file:', filePath);

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
            // FIX P2-2: Delete old chunks before creating new ones (for re-analysis)
            // This prevents orphaned chunks when file content changes
            if (typeof this.chromaDbService.deleteFileChunks === 'function') {
              await this.chromaDbService.deleteFileChunks(fileId);
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
                    charStart: c.charStart,
                    charEnd: c.charEnd,
                    snippet,
                    // FIX P0-3: Store embedding model version for mismatch detection
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
              typeof this.chromaDbService.batchUpsertFileChunks === 'function'
            ) {
              await this.chromaDbService.batchUpsertFileChunks(chunkEmbeddings);
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
      // Non-fatal - embedding failure shouldn't block analysis
      logger.warn('[SMART-FOLDER-WATCHER] Failed to embed file:', {
        filePath,
        error: error.message
      });

      // FIX: Notify user about search index failure
      if (
        this.notificationService &&
        typeof this.notificationService.notifyWatcherError === 'function'
      ) {
        // Use fire-and-forget to not block
        this.notificationService
          .notifyWatcherError(
            'Smart Folders',
            `Search indexing failed for ${path.basename(filePath)}: ${error.message}`
          )
          .catch(() => {});
      }
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
      // Remove from ChromaDB (both file: and image: prefixes)
      if (this.chromaDbService) {
        const normalizedPath = normalizePathForIndex(filePath);
        const filePrefix = `file:${normalizedPath}`;
        const imagePrefix = `image:${normalizedPath}`;
        const legacyFilePrefix = `file:${filePath}`;
        const legacyImagePrefix = `image:${filePath}`;
        const idsToDelete =
          normalizedPath === filePath
            ? [filePrefix, imagePrefix]
            : [filePrefix, imagePrefix, legacyFilePrefix, legacyImagePrefix];

        // Use batch delete for atomicity when available
        if (typeof this.chromaDbService.batchDeleteFileEmbeddings === 'function') {
          await this.chromaDbService.batchDeleteFileEmbeddings(idsToDelete);
        } else {
          // Fallback to individual deletes
          // FIX H-9: Wrap each delete in try-catch to continue on failure
          for (const id of idsToDelete) {
            try {
              await this.chromaDbService.deleteFileEmbedding(id);
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
        // FIX H-9: Wrap each chunk delete in try-catch to continue on failure
        if (typeof this.chromaDbService.deleteFileChunks === 'function') {
          for (const id of idsToDelete) {
            try {
              await this.chromaDbService.deleteFileChunks(id);
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
        await this.analysisHistoryService.removeEntriesByPath(filePath);
        logger.debug('[SMART-FOLDER-WATCHER] Removed history for deleted file:', filePath);
      }

      // Invalidate BM25 search index
      try {
        const { getSearchServiceInstance } = require('../ipc/semantic');
        const searchService = getSearchServiceInstance?.();
        if (searchService?.invalidateIndex) {
          searchService.invalidateIndex({ reason: 'external-deletion', oldPath: filePath });
        }
      } catch (indexErr) {
        logger.debug('[SMART-FOLDER-WATCHER] Could not invalidate search index:', indexErr.message);
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
      // FIX: Include last error for better debugging when start fails
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
          const needsAnalysis = await this._needsAnalysis(file, mtime);

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
   * Force reanalysis of ALL files in smart folders, regardless of existing analysis.
   * Use this when changing AI models to regenerate all analysis with the new model.
   * @returns {Promise<{scanned: number, queued: number}>}
   */
  async forceReanalyzeAll(options = {}) {
    logger.info('[SMART-FOLDER-WATCHER] Force reanalyzing ALL files...', {
      applyNaming: options.applyNaming
    });

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
  shutdown() {
    this.stop();
  }
}

module.exports = SmartFolderWatcher;
