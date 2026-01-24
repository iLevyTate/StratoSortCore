const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const chokidar = require('chokidar');
const { logger: baseLogger, createLogger } = require('../../shared/logger');
const {
  isNotFoundError,
  isCrossDeviceError,
  isExistsError,
  getErrorCategory,
  ErrorCategory
} = require('../../shared/errorClassifier');
const { FileSystemError, WatcherError } = require('../errors/FileSystemError');
const { crossDeviceMove } = require('../../shared/atomicFileOperations');
const { generateSuggestedNameFromAnalysis } = require('./autoOrganize/namingUtils');
const { recordAnalysisResult } = require('../ipc/analysisUtils');
const { deriveWatcherConfidencePercent } = require('./confidence/watcherConfidence');
const { getSemanticFileId, isImagePath } = require('../../shared/fileIdUtils');
const { normalizePathForIndex } = require('../../shared/pathSanitization');
const { getInstance: getFileOperationTracker } = require('../../shared/fileOperationTracker');
const { isUNCPath } = require('../../shared/crossPlatformUtils');

const logger = typeof createLogger === 'function' ? createLogger('DownloadWatcher') : baseLogger;
if (typeof createLogger !== 'function' && logger?.setContext) {
  logger.setContext('DownloadWatcher');
}

// Temporary/incomplete file patterns to ignore
const TEMP_FILE_PATTERNS = [
  /\.(tmp|temp)$/i, // Generic temp files
  /\.crdownload$/i, // Chrome download temp
  /\.part$/i, // Firefox/partial downloads
  /\.!qB$/i, // qBittorrent temp
  /\.download$/i, // Safari temp
  /\.partial$/i, // Generic partial
  /~\$/, // Microsoft Office temp files
  /^~/, // Unix temp files starting with ~
  /\.swp$/i, // Vim swap files
  /\.lock$/i, // Lock files
  /\.lck$/i, // Alternative lock files
  /\._/, // macOS resource forks
  /\.DS_Store$/i, // macOS directory settings
  /Thumbs\.db$/i, // Windows thumbnails
  /desktop\.ini$/i // Windows desktop settings
];

/**
 * Check if a file path is a temporary or incomplete file
 * @param {string} filePath - Path to check
 * @returns {boolean} True if the file appears to be temporary
 */
function isTemporaryFile(filePath) {
  const basename = path.basename(filePath);

  // Check against temp file patterns
  for (const pattern of TEMP_FILE_PATTERNS) {
    if (pattern.test(basename)) {
      return true;
    }
  }

  return false;
}

class DownloadWatcher {
  constructor({
    analyzeDocumentFile,
    analyzeImageFile,
    getCustomFolders,
    autoOrganizeService,
    settingsService,
    notificationService,
    analysisHistoryService,
    chromaDbService,
    folderMatcher
  }) {
    this.analyzeDocumentFile = analyzeDocumentFile;
    this.analyzeImageFile = analyzeImageFile;
    this.getCustomFolders = getCustomFolders;
    this.autoOrganizeService = autoOrganizeService;
    this.settingsService = settingsService;
    this.notificationService = notificationService;
    this.analysisHistoryService = analysisHistoryService;
    // FIX: Add chromaDbService and folderMatcher for embedding support
    this.chromaDbService = chromaDbService;
    this.folderMatcher = folderMatcher;
    this.watcher = null;
    this.isStarting = false;
    this.restartAttempts = 0;
    this.maxRestartAttempts = 3;
    this.restartDelay = 5000; // 5 seconds between restart attempts
    this.lastError = null;
    this.processingFiles = new Set(); // Track files being processed to avoid duplicates
    this.debounceTimers = new Map(); // Debounce timers for each file
    this.debounceDelay = 500; // 500ms debounce for rapid events
    this.restartTimer = null; // Track restart timer for cleanup
    // FIX H-3: Track stopped state to prevent timer callbacks after stop()
    this._stopped = false;
  }

  async start() {
    if (this.watcher) {
      logger.debug('[DOWNLOAD-WATCHER] Watcher already running');
      return;
    }

    if (this.isStarting) {
      logger.debug('[DOWNLOAD-WATCHER] Watcher is already starting');
      return;
    }

    this.isStarting = true;
    // FIX H-3: Reset stopped flag on start
    this._stopped = false;

    try {
      const downloadsPath = path.join(os.homedir(), 'Downloads');

      // Verify downloads directory exists and is accessible
      const isValid = await this._verifyDirectory(downloadsPath);
      if (!isValid) {
        this.isStarting = false;
        return;
      }

      logger.info('[DOWNLOAD-WATCHER] Watching', downloadsPath);

      // Check for UNC path to enable polling for network drives
      const usePolling = isUNCPath(downloadsPath);
      if (usePolling) {
        logger.info('[DOWNLOAD-WATCHER] Downloads folder is on network drive, enabling polling');
      }

      // PERFORMANCE FIX: Optimize chokidar watcher configuration
      // - ignoreInitial: Don't process existing files on startup
      // - ignored: Comprehensive temp/system file filtering
      // - awaitWriteFinish: Wait for file writes to complete before processing
      // - usePolling: false by default for better performance, set to true for network drives
      this.watcher = chokidar.watch(downloadsPath, {
        ignoreInitial: true,
        ignored: [
          /(^|[\\/\\])\../, // Ignore dotfiles
          /\.tmp$/i, // Ignore temp files
          /\.temp$/i, // Ignore temp files
          /\.crdownload$/i, // Chrome download temp files
          /\.part$/i, // Firefox download temp files
          /\.!qB$/i, // qBittorrent temp files
          /\.download$/i, // Safari temp files
          /\.partial$/i, // Generic partial downloads
          /~\$/, // Microsoft Office temp files
          /^~/, // Unix temp files
          /\.swp$/i, // Vim swap files
          /\.lock$/i, // Lock files
          /\.lck$/i, // Alternative lock files
          /Thumbs\.db$/i, // Windows thumbnails
          /desktop\.ini$/i, // Windows desktop settings
          /\.DS_Store$/i, // macOS directory settings
          '**/node_modules/**', // Ignore node_modules
          '**/.git/**' // Ignore git directories
        ],
        awaitWriteFinish: {
          stabilityThreshold: 2000, // Wait 2s after last change
          pollInterval: 100 // Check every 100ms
        },
        // Error handling options
        persistent: true,
        usePolling: usePolling, // Use native watchers for better performance unless UNC
        interval: usePolling ? 2000 : 100,
        binaryInterval: usePolling ? 2000 : 300,
        alwaysStat: false, // Don't stat files we're ignoring
        depth: 0 // Only watch immediate directory, not subdirectories
      });

      // FIX #32: Validate watcher was created successfully before registering listeners
      if (!this.watcher) {
        logger.error('[DOWNLOAD-WATCHER] Failed to create file watcher');
        this.isStarting = false;
        return;
      }

      // Handle new files with debouncing
      this.watcher.on('add', (filePath) => {
        this._debouncedHandleFile(filePath);
      });

      // Handle deleted files (external deletion via File Explorer)
      // FIX: Prevents ghost entries when files are deleted outside the app
      this.watcher.on('unlink', (filePath) => {
        this._handleFileDeletion(filePath);
      });

      // Handle watcher errors with recovery
      this.watcher.on('error', (error) => {
        this._handleWatcherError(error);
      });

      // Handle ready event
      this.watcher.on('ready', () => {
        logger.info('[DOWNLOAD-WATCHER] Watcher ready and monitoring');
        this.restartAttempts = 0; // Reset restart counter on successful start
        this.lastError = null;
      });

      this.isStarting = false;
    } catch (error) {
      this.isStarting = false;
      this._handleWatcherError(error);
    }
  }

  /**
   * Verify that the downloads directory exists and is accessible
   * @param {string} dirPath - Path to verify
   * @returns {Promise<boolean>} True if directory is valid
   */
  async _verifyDirectory(dirPath) {
    try {
      const stats = await fs.stat(dirPath);
      if (!stats.isDirectory()) {
        logger.error('[DOWNLOAD-WATCHER] Path is not a directory:', dirPath);
        return false;
      }

      // Try to access the directory (read permissions check)
      await fs.access(dirPath, fs.constants?.R_OK || 4);
      return true;
    } catch (error) {
      const fsError = FileSystemError.fromNodeError(error, {
        path: dirPath,
        operation: 'verify'
      });

      logger.error('[DOWNLOAD-WATCHER] Cannot access downloads directory:', {
        path: dirPath,
        error: fsError.getUserFriendlyMessage(),
        code: fsError.code
      });

      this.lastError = fsError;
      return false;
    }
  }

  /**
   * Debounced file handling to avoid processing files multiple times
   * @param {string} filePath - Path to the file
   */
  _debouncedHandleFile(filePath) {
    // FIX: Skip files recently operated on by any watcher (prevents infinite loops)
    const tracker = getFileOperationTracker();
    if (tracker.wasRecentlyOperated(filePath)) {
      logger.debug('[DOWNLOAD-WATCHER] Skipping recently-operated file:', filePath);
      return;
    }

    // Clear any existing timer for this file
    if (this.debounceTimers.has(filePath)) {
      clearTimeout(this.debounceTimers.get(filePath));
    }

    // Set new timer
    const timer = setTimeout(async () => {
      // FIX H-3: Check if watcher was stopped during debounce
      if (this._stopped) {
        this.debounceTimers.delete(filePath);
        return;
      }

      this.debounceTimers.delete(filePath);

      // FIX: Verify file still exists after debounce (race condition prevention)
      try {
        await fs.stat(filePath);
      } catch (statError) {
        if (isNotFoundError(statError)) {
          logger.debug('[DOWNLOAD-WATCHER] File disappeared during debounce:', filePath);
          return;
        }
        // For other errors, continue and let handleFile deal with it
      }

      // Check if already processing this file
      if (this.processingFiles.has(filePath)) {
        logger.debug('[DOWNLOAD-WATCHER] File already being processed:', filePath);
        return;
      }

      // FIX: Double-check recently-operated after debounce (another watcher may have processed it)
      if (tracker.wasRecentlyOperated(filePath)) {
        logger.debug('[DOWNLOAD-WATCHER] File became recently-operated during debounce:', filePath);
        return;
      }

      try {
        this.processingFiles.add(filePath);
        await this.handleFile(filePath);
      } catch (e) {
        logger.error('[DOWNLOAD-WATCHER] Failed processing file', {
          filePath,
          ...this._formatErrorInfo(e),
          stack: e.stack
        });
      } finally {
        this.processingFiles.delete(filePath);
      }
    }, this.debounceDelay);

    timer.unref(); // Don't prevent process exit
    this.debounceTimers.set(filePath, timer);
  }

  /**
   * Handle watcher errors with automatic restart capability
   * @param {Error} error - The error that occurred
   */
  _handleWatcherError(error) {
    const fsError = error.isFileSystemError
      ? error
      : new WatcherError(path.join(os.homedir(), 'Downloads'), error);

    logger.error('[DOWNLOAD-WATCHER] Watcher error:', {
      message: fsError.getUserFriendlyMessage(),
      code: fsError.code,
      originalError: error.message
    });

    this.lastError = fsError;

    // Attempt automatic restart if error seems recoverable
    if (fsError.shouldRetry() && this.restartAttempts < this.maxRestartAttempts) {
      this.restartAttempts++;
      logger.info(
        `[DOWNLOAD-WATCHER] Attempting restart (${this.restartAttempts}/${this.maxRestartAttempts})...`
      );

      // Stop the current watcher
      this.stop();

      // Schedule restart (track timer for cleanup)
      this.restartTimer = setTimeout(() => {
        this.restartTimer = null;
        this.start();
      }, this.restartDelay * this.restartAttempts); // Exponential backoff
      this.restartTimer.unref();
    } else if (this.restartAttempts >= this.maxRestartAttempts) {
      logger.error('[DOWNLOAD-WATCHER] Max restart attempts reached. Watcher disabled.');
      this.stop();
    }
  }

  stop() {
    // FIX H-3: Set stopped flag to prevent timer callbacks
    this._stopped = true;

    // Clear pending restart timer
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }

    // Clear all debounce timers
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();
    this.processingFiles.clear();

    if (this.watcher) {
      try {
        // Remove all listeners before closing
        this.watcher.removeAllListeners();
        this.watcher.close();
        logger.info('[DOWNLOAD-WATCHER] Stopped watching downloads');
      } catch (error) {
        logger.error('[DOWNLOAD-WATCHER] Error stopping watcher:', error);
      } finally {
        this.watcher = null;
      }
    }

    this.isStarting = false;
  }

  /**
   * Check if a file exists and return true/false without throwing for ENOENT
   * @param {string} filePath - Path to check
   * @param {string} context - Context for logging
   * @returns {Promise<boolean>} True if file exists
   * @throws {Error} Re-throws non-ENOENT errors
   */
  async _ensureFileExists(filePath, context = 'processing') {
    try {
      await fs.access(filePath);
      return true;
    } catch (error) {
      if (isNotFoundError(error)) {
        logger.debug(`[DOWNLOAD-WATCHER] File no longer exists (${context}), skipping:`, filePath);
        return false;
      }
      throw error;
    }
  }

  /**
   * Format error information consistently for logging
   * @param {Error} error - The error to format
   * @returns {Object} Formatted error info object
   */
  _formatErrorInfo(error) {
    return error.isFileSystemError
      ? { code: error.code, message: error.getUserFriendlyMessage() }
      : { message: error.message };
  }

  /**
   * Ensure a directory exists, creating it if necessary
   * @param {string} dirPath - Path to the directory
   * @param {string} context - Context for logging
   * @param {boolean} throwOnError - Whether to throw on error (true) or return false (false)
   * @returns {Promise<boolean>} True if directory exists/created successfully
   * @throws {FileSystemError} If throwOnError is true and mkdir fails
   */
  async _ensureDirectory(dirPath, context = 'destination', throwOnError = true) {
    try {
      await fs.mkdir(dirPath, { recursive: true });
      return true;
    } catch (mkdirError) {
      const fsError = FileSystemError.forOperation('mkdir', mkdirError, dirPath);
      logger.error(`[DOWNLOAD-WATCHER] Failed to create ${context} directory:`, {
        path: dirPath,
        error: fsError.getUserFriendlyMessage(),
        code: fsError.code
      });
      if (throwOnError) {
        throw fsError;
      }
      return false;
    }
  }

  /**
   * Get the current status of the watcher
   * @returns {Object} Status information
   */
  getStatus() {
    return {
      isRunning: this.watcher !== null,
      isStarting: this.isStarting,
      restartAttempts: this.restartAttempts,
      maxRestartAttempts: this.maxRestartAttempts,
      lastError: this.lastError ? this.lastError.toJSON() : null,
      processingCount: this.processingFiles.size,
      pendingDebounce: this.debounceTimers.size
    };
  }

  /**
   * Reset the watcher state and restart
   */
  restart() {
    logger.info('[DOWNLOAD-WATCHER] Manual restart requested');
    this.restartAttempts = 0;
    this.lastError = null;
    this.stop();
    this.start();
  }

  /**
   * Main file handling pipeline - orchestrates validation, auto-organize, and fallback phases.
   * @param {string} filePath - Path to the file to process
   */
  async handleFile(filePath) {
    // Phase 1: Validation
    if (!(await this._validateFile(filePath))) {
      return;
    }

    // Phase 2: Auto-organize attempt
    const autoResult = await this._attemptAutoOrganize(filePath);
    if (autoResult.handled) {
      return;
    }

    // Phase 3: Fallback processing (only if auto-organize failed with error)
    if (autoResult.shouldFallback) {
      await this._fallbackOrganize(filePath);
    }
  }

  /**
   * Phase 3: Fallback processing
   * Analyzes file and optionally renames if auto-organize failed/skipped.
   * @param {string} filePath - Path to file
   */
  async _fallbackOrganize(filePath) {
    logger.info('[DOWNLOAD-WATCHER] Fallback processing for:', filePath);

    try {
      // FIX C-3: Use stat for atomic existence check (avoids TOCTOU race with access+stat)
      try {
        await fs.stat(filePath);
      } catch (error) {
        if (isNotFoundError(error)) {
          logger.debug(
            '[DOWNLOAD-WATCHER] File no longer exists for fallback, skipping:',
            filePath
          );
          return;
        }
        throw error;
      }

      // Analyze file to generate metadata/embeddings even if not moved
      let analysisResult = null;
      const isImage = isImagePath(filePath);
      const folders = this.getCustomFolders().filter((f) => f && f.path);
      const folderCategories = folders.map((f) => ({
        name: f.name,
        description: f.description || '',
        id: f.id
      }));

      try {
        if (isImage) {
          analysisResult = await this.analyzeImageFile(filePath, folderCategories);
        } else {
          analysisResult = await this.analyzeDocumentFile(filePath, folderCategories);
        }
      } catch (e) {
        if (isNotFoundError(e)) {
          logger.debug(
            '[DOWNLOAD-WATCHER] File disappeared during analysis (TOCTOU race):',
            filePath
          );
          return;
        }
        throw e; // Re-throw to be caught by outer catch
      }

      if (analysisResult) {
        // 1. Embed for search
        await this._embedAnalyzedFile(filePath, analysisResult);

        // 2. Apply naming convention if enabled (rename in place)
        const settings = await this.settingsService.load();
        if (settings && settings.namingConvention) {
          // Construct naming settings object to match old implementation expectations
          const namingSettings = {
            convention: settings.namingConvention,
            separator: settings.separator || '-',
            dateFormat: settings.dateFormat || 'YYYY-MM-DD',
            caseConvention: settings.caseConvention || 'kebab-case'
          };

          // Get file timestamps for naming
          const fileStats = await fs.stat(filePath);
          const fileTimestamps = {
            created: fileStats.birthtime,
            modified: fileStats.mtime
          };

          const suggestedName = generateSuggestedNameFromAnalysis({
            originalFileName: path.basename(filePath),
            analysis: analysisResult,
            settings: namingSettings,
            fileTimestamps
          });

          if (suggestedName && suggestedName !== path.basename(filePath, path.extname(filePath))) {
            const dir = path.dirname(filePath);
            const ext = path.extname(filePath);
            // Ensure suggestedName handles extension if needed, though usually it's name only
            // Old code: newName = suggestedExt ? result.suggestedName : `${result.suggestedName}${extname}`;
            // But generateSuggestedNameFromAnalysis usually returns name WITHOUT extension?
            // Test expects "NewName.pdf" in the call?
            // Test mocks generateSuggestedNameFromAnalysis to return 'NewName.pdf'.
            // So if it returns 'NewName.pdf', and we append 'ext' (.pdf), we get 'NewName.pdf.pdf'.

            // Let's handle extension logic correctly.
            const suggestedExt = path.extname(suggestedName);
            const finalName = suggestedExt ? suggestedName : suggestedName + ext;

            const newPath = path.join(dir, finalName);

            logger.info('[DOWNLOAD-WATCHER] Applying fallback naming convention:', {
              from: filePath,
              to: newPath
            });

            await this._moveFileWithConflictHandling(filePath, newPath, ext);
          }
        }
      }
    } catch (error) {
      if (isNotFoundError(error)) {
        // Already handled?
        return;
      }
      logger.warn('[DOWNLOAD-WATCHER] Fallback processing error:', error.message);
    }
  }

  /**
   * Phase 1: Validate that the file should be processed.
   * Checks extension, temp file patterns, system directories, and file existence.
   * @param {string} filePath - Path to validate
   * @returns {Promise<boolean>} True if file is valid for processing
   */
  async _validateFile(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    const basename = path.basename(filePath);

    // Enhanced temporary file detection using comprehensive patterns
    // FIX: Use precise path segment matching instead of substring matching
    // to avoid false positives like 'project.gitignore' being skipped
    const pathSegments = filePath.split(path.sep);
    const hasGitDir = pathSegments.includes('.git');
    const hasNodeModules = pathSegments.includes('node_modules');

    if (
      ext === '' ||
      isTemporaryFile(filePath) ||
      hasGitDir ||
      hasNodeModules ||
      basename.startsWith('.')
    ) {
      logger.debug('[DOWNLOAD-WATCHER] Skipping system/temporary file:', filePath);
      return false;
    }

    // FIX C-3: Use single stat() call instead of access() + stat() to avoid TOCTOU race
    // Files may be deleted quickly (e.g., git lock files)
    try {
      // Single atomic operation - stat provides both existence check and size
      const stats = await fs.stat(filePath);
      if (stats.size === 0) {
        logger.debug('[DOWNLOAD-WATCHER] Skipping empty file:', filePath);
        return false;
      }
    } catch (error) {
      if (isNotFoundError(error)) {
        logger.debug('[DOWNLOAD-WATCHER] File no longer exists, skipping:', filePath);
        return false;
      }

      // Convert to FileSystemError for consistent handling
      const fsError = FileSystemError.fromNodeError(error, {
        path: filePath,
        operation: 'access'
      });

      // Log with context but don't crash
      logger.warn('[DOWNLOAD-WATCHER] Cannot access file:', {
        filePath,
        error: fsError.getUserFriendlyMessage(),
        code: fsError.code
      });

      // Only throw if it's a critical error
      if (!fsError.isRecoverable()) {
        throw fsError;
      }
      return false;
    }

    return true;
  }

  /**
   * Phase 2: Attempt to auto-organize the file using AutoOrganizeService.
   * @param {string} filePath - Path to the file
   * @returns {Promise<{handled: boolean, shouldFallback: boolean}>} Result indicating if file was handled
   */
  async _attemptAutoOrganize(filePath) {
    const folders = this.getCustomFolders().filter((f) => f && f.path);

    // Check if auto-organize service is available
    if (!this.autoOrganizeService || !this.settingsService) {
      return { handled: false, shouldFallback: true };
    }

    try {
      // IMPORTANT: Load naming conventions from persisted Settings, NOT Redux state
      // The DownloadWatcher uses the Settings naming conventions to ensure consistent
      // naming behavior across all automatic operations (watchers & reanalysis).
      // The Discover phase has its own session-based naming controls in Redux.
      const settings = await this.settingsService.load();

      // Use the new auto-organize service with suggestions
      const result = await this.autoOrganizeService.processNewFile(filePath, folders, {
        autoOrganizeEnabled: settings.autoOrganize,
        confidenceThreshold: settings.confidenceThreshold ?? 0.75,
        defaultLocation: settings.defaultSmartFolderLocation || 'Documents',
        namingSettings: {
          // Default to subject-date so files are actually renamed when settings are missing
          convention: settings.namingConvention || 'subject-date',
          separator: settings.separator || '-',
          dateFormat: settings.dateFormat || 'YYYY-MM-DD',
          caseConvention: settings.caseConvention || 'kebab-case'
        }
      });
      logger.debug('[DOWNLOAD-WATCHER] Naming settings used for auto-organize', {
        namingConvention: settings.namingConvention,
        separator: settings.separator,
        dateFormat: settings.dateFormat,
        caseConvention: settings.caseConvention
      });

      if (result && result.destination) {
        // Create destination directory with error handling
        await this._ensureDirectory(path.dirname(result.destination), 'destination', true);

        // Move file with atomic error handling (TOCTOU fix: handle ENOENT from move directly)
        try {
          await this._moveFile(filePath, result.destination);
        } catch (moveError) {
          if (isNotFoundError(moveError)) {
            logger.debug('[DOWNLOAD-WATCHER] File disappeared before move:', filePath);
            return { handled: true, shouldFallback: false };
          }
          throw moveError;
        }

        const confidencePercent = deriveWatcherConfidencePercent(result);
        // FIX: Use renamed filename from destination, not original filename
        // This ensures notifications show the actual filename the user will see
        const fileName = path.basename(result.destination);
        const destFolder = path.basename(path.dirname(result.destination));

        logger.info(
          '[DOWNLOAD-WATCHER] Auto-organized with',
          `${confidencePercent}% confidence:`,
          filePath,
          '=>',
          result.destination
        );

        // Send notification via NotificationService
        if (this.notificationService) {
          await this.notificationService.notifyFileOrganized(
            fileName,
            destFolder,
            confidencePercent
          );
        }

        // Record to analysis history (post-move, use destination path)
        if (this.analysisHistoryService) {
          try {
            const analysisForHistory = {
              suggestedName: path.basename(result.destination),
              category: result.category || result.folder || destFolder || 'organized',
              // FIX NEW-10: Include keywords from analysis for history display
              keywords: result.keywords || result.analysis?.keywords || [],
              // UI expects percentage, not fraction
              confidence: confidencePercent,
              smartFolder: result.smartFolder || null,
              summary: result.summary || result.analysis?.summary || '',
              model: 'auto-organize',
              suggestedPath: result.destination,
              actualPath: result.destination,
              renamed: true,
              newName: path.basename(result.destination)
            };

            await recordAnalysisResult({
              filePath: result.destination,
              result: analysisForHistory,
              processingTime: result.processingTime || 0,
              modelType: 'auto-organize',
              analysisHistory: this.analysisHistoryService,
              logger
            });

            // FIX: Embed the file into ChromaDB for semantic search
            // This ensures DownloadWatcher-organized files are searchable
            await this._embedAnalyzedFile(result.destination, result);
          } catch (historyErr) {
            logger.debug('[DOWNLOAD-WATCHER] Failed to record history entry:', historyErr.message);
          }
        }
        return { handled: true, shouldFallback: false };
      }
      // File not auto-organized - notify user if it's due to low confidence
      const fileName = path.basename(filePath);
      logger.info('[DOWNLOAD-WATCHER] File not auto-organized (low confidence or disabled)');

      // Check if we have analysis result to show low-confidence notification
      if (this.notificationService && result) {
        const confidencePercent = deriveWatcherConfidencePercent(result);
        const thresholdPercent = Math.round((settings.confidenceThreshold || 0.75) * 100);
        if (confidencePercent < thresholdPercent) {
          await this.notificationService.notifyLowConfidence(
            fileName,
            confidencePercent,
            thresholdPercent,
            result.suggestedFolder || null
          );
        }
      }
      return { handled: true, shouldFallback: false };
    } catch (e) {
      // Log with appropriate detail based on error type
      logger.warn(
        '[DOWNLOAD-WATCHER] Auto-organize service failed, falling back:',
        this._formatErrorInfo(e)
      );
      // Fall through to fallback logic
      return { handled: false, shouldFallback: true };
    }
  }

  /**
   * Move a file to destination, handling cross-device moves and FILE_IN_USE retries.
   * @param {string} source - Source file path
   * @param {string} destination - Destination file path
   * @param {number} [retryCount=0] - Current retry attempt (internal use)
   * @throws {FileSystemError} On move failure after retries
   */
  async _moveFile(source, destination, retryCount = 0) {
    const MAX_RETRIES = 5;
    const RETRY_DELAY_MS = 2000; // 2 seconds between retries

    try {
      await fs.rename(source, destination);
      // FIX: Record operation to prevent other watchers from re-processing this file
      getFileOperationTracker().recordOperation(destination, 'move', 'downloadWatcher');
      getFileOperationTracker().recordOperation(source, 'move', 'downloadWatcher');
    } catch (renameError) {
      // Handle cross-device move (different drives)
      if (isCrossDeviceError(renameError)) {
        logger.debug(
          '[DOWNLOAD-WATCHER] Cross-device move detected, using crossDeviceMove utility'
        );
        try {
          await crossDeviceMove(source, destination, { verify: true });
          // FIX: Record operation to prevent other watchers from re-processing this file
          getFileOperationTracker().recordOperation(destination, 'move', 'downloadWatcher');
          getFileOperationTracker().recordOperation(source, 'move', 'downloadWatcher');
        } catch (copyError) {
          const fsError = copyError.isFileSystemError
            ? copyError
            : FileSystemError.forOperation('copy', copyError, source);
          logger.error('[DOWNLOAD-WATCHER] Cross-device move failed:', {
            source,
            destination,
            error: fsError.getUserFriendlyMessage()
          });
          throw fsError;
        }
      } else {
        // FIX: Retry FILE_IN_USE errors - file may be released after a short delay
        const errorCategory = getErrorCategory(renameError);
        const isFileInUse = errorCategory === ErrorCategory.FILE_IN_USE;

        if (isFileInUse && retryCount < MAX_RETRIES) {
          const nextRetry = retryCount + 1;
          logger.info('[DOWNLOAD-WATCHER] File in use, scheduling retry', {
            source,
            attempt: nextRetry,
            maxRetries: MAX_RETRIES,
            delayMs: RETRY_DELAY_MS
          });

          // Wait before retrying
          await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));

          // FIX C-3: Use stat for atomic existence check before retry
          try {
            await fs.stat(source);
          } catch (statError) {
            if (isNotFoundError(statError)) {
              logger.debug('[DOWNLOAD-WATCHER] File no longer exists, skipping retry:', source);
              return; // File was moved/deleted by user
            }
            throw statError;
          }

          // Recursive retry
          return this._moveFile(source, destination, nextRetry);
        }

        const fsError = FileSystemError.forOperation('move', renameError, source);

        // Enhanced logging for FILE_IN_USE to help debugging
        if (isFileInUse) {
          logger.error('[DOWNLOAD-WATCHER] Failed to move file after retries:', {
            source,
            destination,
            error: fsError.getUserFriendlyMessage(),
            code: fsError.code,
            retriesAttempted: retryCount
          });
        } else {
          logger.error('[DOWNLOAD-WATCHER] Failed to move file:', {
            source,
            destination,
            error: fsError.getUserFriendlyMessage(),
            code: fsError.code
          });
        }
        throw fsError;
      }
    }
  }

  /**
   * Move a file with conflict handling (generates unique name if file exists).
   * @param {string} source - Source file path
   * @param {string} destPath - Destination file path
   * @param {string} extname - File extension
   */
  async _moveFileWithConflictHandling(source, destPath, extname) {
    try {
      await fs.rename(source, destPath);
    } catch (renameError) {
      if (isCrossDeviceError(renameError)) {
        // Cross-device move using shared utility
        logger.debug(
          '[DOWNLOAD-WATCHER] Cross-device move in fallback, using crossDeviceMove utility'
        );
        await crossDeviceMove(source, destPath, { verify: true });
      } else if (isExistsError(renameError)) {
        // Handle file exists - generate unique name
        let counter = 1;
        let uniquePath = destPath;
        const nameWithoutExt = path.basename(destPath, extname);
        const destDir = path.dirname(destPath);

        while (counter < 1000) {
          uniquePath = path.join(destDir, `${nameWithoutExt}_${counter}${extname}`);
          try {
            await fs.access(uniquePath);
            counter++;
          } catch {
            // File doesn't exist, use this path
            break;
          }
        }

        await fs.rename(source, uniquePath);
        logger.info(
          '[DOWNLOAD-WATCHER] Moved (fallback, renamed due to conflict)',
          source,
          '=>',
          uniquePath
        );
      } else {
        throw renameError;
      }
    }
  }

  /**
   * Shutdown handler for DI container compatibility
   * Alias for stop() to support container.shutdown() pattern
   * @returns {void}
   */
  shutdown() {
    this.stop();
  }

  /**
   * Embed an analyzed file into ChromaDB for semantic search
   * This is called after successful auto-organization to keep embeddings in sync
   * FIX: Ensures DownloadWatcher-organized files are searchable via semantic search
   * @private
   * @param {string} filePath - Path to the file (destination after move)
   * @param {Object} analysisResult - Result from auto-organize analysis
   */
  async _embedAnalyzedFile(filePath, analysisResult) {
    // Skip if dependencies not available
    if (!this.folderMatcher || !this.chromaDbService) {
      logger.debug('[DOWNLOAD-WATCHER] Skipping embedding - services not available');
      return;
    }

    // FIX: Verify file still exists before embedding (prevents ghost embeddings)
    try {
      await fs.stat(filePath);
    } catch (statError) {
      if (isNotFoundError(statError)) {
        logger.debug('[DOWNLOAD-WATCHER] File no longer exists, skipping embedding:', filePath);
        return;
      }
      // For other stat errors, continue and let embedding logic handle it
    }

    try {
      // Extract analysis data - handle different result structures
      const analysis = analysisResult.analysis || analysisResult;
      const summary = analysis.summary || analysis.description || '';
      const category = analysis.category || analysis.folder || 'Uncategorized';
      const keywords = analysis.keywords || analysis.tags || [];
      const subject = analysis.subject || analysis.suggestedName || '';
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
        logger.debug('[DOWNLOAD-WATCHER] Skipping embedding - no content:', filePath);
        return;
      }

      // Generate embedding vector using folderMatcher
      const textToEmbed = [summary, subject, keywords?.join(' ')].filter(Boolean).join(' ');
      const embedding = await this.folderMatcher.embedText(textToEmbed);

      if (!embedding || !embedding.vector || !Array.isArray(embedding.vector)) {
        logger.warn('[DOWNLOAD-WATCHER] Failed to generate embedding for:', filePath);
        return;
      }

      // Prepare metadata for ChromaDB
      // IMPORTANT: IDs must match the rest of the semantic pipeline
      const fileId = getSemanticFileId(filePath);
      const isImage = isImagePath(filePath);
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
          type: isImage ? 'image' : 'document',
          confidence // FIX: Include confidence score in metadata for search display
        },
        updatedAt: new Date().toISOString()
      });

      logger.debug('[DOWNLOAD-WATCHER] Embedded file:', filePath);
    } catch (embedError) {
      // Non-critical - log but don't fail the operation
      logger.warn('[DOWNLOAD-WATCHER] Failed to embed file:', {
        filePath,
        error: embedError.message
      });
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
    // Skip temp files
    if (isTemporaryFile(filePath)) {
      return;
    }

    logger.info('[DOWNLOAD-WATCHER] Detected external file deletion:', filePath);

    try {
      // Remove from ChromaDB (both file: and image: prefixes)
      if (this.chromaDbService) {
        // Use batch delete for atomicity when available
        const normalizedPath = normalizePathForIndex(filePath);
        const idsToDelete =
          normalizedPath === filePath
            ? [`file:${normalizedPath}`, `image:${normalizedPath}`]
            : [
                `file:${normalizedPath}`,
                `image:${normalizedPath}`,
                `file:${filePath}`,
                `image:${filePath}`
              ];

        if (typeof this.chromaDbService.batchDeleteFileEmbeddings === 'function') {
          await this.chromaDbService.batchDeleteFileEmbeddings(idsToDelete);
        } else {
          // Fallback to individual deletes
          for (const id of idsToDelete) {
            await this.chromaDbService.deleteFileEmbedding(id);
          }
        }

        // Delete associated chunks
        if (typeof this.chromaDbService.deleteFileChunks === 'function') {
          for (const id of idsToDelete) {
            await this.chromaDbService.deleteFileChunks(id);
          }
        }

        logger.debug('[DOWNLOAD-WATCHER] Removed embeddings for deleted file:', filePath);
      }

      // Remove from analysis history
      if (this.analysisHistoryService?.removeEntriesByPath) {
        await this.analysisHistoryService.removeEntriesByPath(filePath);
        logger.debug('[DOWNLOAD-WATCHER] Removed history for deleted file:', filePath);
      }
    } catch (error) {
      // FIX: Use object format for structured logging
      logger.warn('[DOWNLOAD-WATCHER] Error cleaning up deleted file:', {
        filePath,
        error: error.message
      });
    }
  }

  resolveDestinationFolder(result, folders) {
    if (!result) return null;
    // Prefer explicit smartFolder id
    if (result.smartFolder && result.smartFolder.id) {
      return folders.find((f) => f.id === result.smartFolder.id);
    }
    // Try folder match candidates
    if (Array.isArray(result.folderMatchCandidates)) {
      for (const cand of result.folderMatchCandidates) {
        const found = folders.find((f) => f.id === cand.id || f.name === cand.name);
        if (found) return found;
      }
    }
    // Fallback to category name match
    if (result.category) {
      return folders.find((f) => f.name.toLowerCase() === result.category.toLowerCase());
    }
    return null;
  }
}

module.exports = DownloadWatcher;
