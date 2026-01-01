const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const chokidar = require('chokidar');
const { Notification } = require('electron');
const { logger } = require('../../shared/logger');
const {
  isNotFoundError,
  isCrossDeviceError,
  isExistsError
} = require('../../shared/errorClassifier');
const { FileSystemError, WatcherError } = require('../errors/FileSystemError');
const { crossDeviceMove } = require('../../shared/atomicFileOperations');
logger.setContext('DownloadWatcher');

/**
 * Show a system notification for organized files
 * @param {string} fileName - Original file name
 * @param {string} destination - Destination folder name
 * @param {number} confidence - Confidence percentage
 * @param {boolean} notificationsEnabled - Whether notifications are enabled in settings
 */
function showOrganizedNotification(fileName, destination, confidence, notificationsEnabled = true) {
  try {
    if (!notificationsEnabled) {
      logger.debug('[DOWNLOAD-WATCHER] Notifications disabled in settings');
      return;
    }

    if (!Notification.isSupported()) {
      logger.debug('[DOWNLOAD-WATCHER] Notifications not supported on this platform');
      return;
    }

    const notification = new Notification({
      title: 'File Organized',
      body: `${fileName} moved to ${destination} (${confidence}% confidence)`,
      silent: true // Don't play sound for each file
    });

    notification.show();
  } catch (error) {
    // Don't let notification errors break the watcher
    logger.debug('[DOWNLOAD-WATCHER] Failed to show notification:', error.message);
  }
}

// Simple utility to determine if a path is an image based on extension
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
    settingsService
  }) {
    this.analyzeDocumentFile = analyzeDocumentFile;
    this.analyzeImageFile = analyzeImageFile;
    this.getCustomFolders = getCustomFolders;
    this.autoOrganizeService = autoOrganizeService;
    this.settingsService = settingsService;
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

    try {
      const downloadsPath = path.join(os.homedir(), 'Downloads');

      // Verify downloads directory exists and is accessible
      const isValid = await this._verifyDirectory(downloadsPath);
      if (!isValid) {
        this.isStarting = false;
        return;
      }

      logger.info('[DOWNLOAD-WATCHER] Watching', downloadsPath);

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
        usePolling: false, // Use native watchers for better performance
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
    // Clear any existing timer for this file
    if (this.debounceTimers.has(filePath)) {
      clearTimeout(this.debounceTimers.get(filePath));
    }

    // Set new timer
    const timer = setTimeout(async () => {
      this.debounceTimers.delete(filePath);

      // Check if already processing this file
      if (this.processingFiles.has(filePath)) {
        logger.debug('[DOWNLOAD-WATCHER] File already being processed:', filePath);
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

    // CRITICAL FIX: Verify file exists and is stable before processing
    // Files may be deleted quickly (e.g., git lock files)
    try {
      await fs.access(filePath);

      // Additional check: verify file has some content (not empty)
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
      const settings = await this.settingsService.load();

      // Use the new auto-organize service with suggestions
      const result = await this.autoOrganizeService.processNewFile(filePath, folders, {
        autoOrganizeEnabled: settings.autoOrganize,
        confidenceThreshold: settings.confidenceThreshold || 0.75,
        defaultLocation: settings.defaultSmartFolderLocation || 'Documents',
        namingSettings: {
          convention: settings.namingConvention,
          separator: settings.separator,
          dateFormat: settings.dateFormat,
          caseConvention: settings.caseConvention
        }
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

        const confidencePercent = Math.round(result.confidence * 100);
        const fileName = path.basename(filePath);
        const destFolder = path.basename(path.dirname(result.destination));

        logger.info(
          '[DOWNLOAD-WATCHER] Auto-organized with',
          `${confidencePercent}% confidence:`,
          filePath,
          '=>',
          result.destination
        );

        // Show system notification (respects user's notification preference)
        const notificationsEnabled = settings.notifications !== false;
        showOrganizedNotification(fileName, destFolder, confidencePercent, notificationsEnabled);
        return { handled: true, shouldFallback: false };
      } else {
        logger.info('[DOWNLOAD-WATCHER] File not auto-organized (low confidence or disabled)');
        return { handled: true, shouldFallback: false };
      }
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
   * Phase 3: Fallback organization using direct analysis.
   * Used when auto-organize service is unavailable or fails.
   * @param {string} filePath - Path to the file
   */
  async _fallbackOrganize(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    const folders = this.getCustomFolders().filter((f) => f && f.path);

    // CRITICAL FIX: Verify file still exists before fallback processing
    try {
      await fs.access(filePath);
    } catch (error) {
      if (isNotFoundError(error)) {
        logger.debug('[DOWNLOAD-WATCHER] File no longer exists for fallback, skipping:', filePath);
        return;
      }
      const fsError = FileSystemError.fromNodeError(error, {
        path: filePath,
        operation: 'access'
      });
      logger.warn('[DOWNLOAD-WATCHER] Cannot access file for fallback:', {
        filePath,
        error: fsError.getUserFriendlyMessage()
      });
      return;
    }

    const folderCategories = folders.map((f) => ({
      name: f.name,
      description: f.description || '',
      id: f.id
    }));

    let result;
    try {
      if (IMAGE_EXTENSIONS.has(ext)) {
        result = await this.analyzeImageFile(filePath, folderCategories);
      } else {
        result = await this.analyzeDocumentFile(filePath, folderCategories);
      }
    } catch (e) {
      // FIX: Handle TOCTOU race during analysis - file may have been deleted
      if (isNotFoundError(e)) {
        logger.debug(
          '[DOWNLOAD-WATCHER] File disappeared during analysis (TOCTOU race):',
          filePath
        );
        return;
      }
      logger.error('[DOWNLOAD-WATCHER] Analysis failed', {
        filePath,
        error: e.message
      });
      return;
    }

    const destFolder = this.resolveDestinationFolder(result, folders);
    if (!destFolder) {
      logger.debug('[DOWNLOAD-WATCHER] No matching destination folder found for:', filePath);
      return;
    }

    try {
      // CRITICAL FIX: Verify file still exists before renaming in fallback
      if (!(await this._ensureFileExists(filePath, 'before fallback rename'))) {
        return;
      }

      // Create destination directory
      if (!(await this._ensureDirectory(destFolder.path, 'destination folder', false))) {
        return;
      }

      const baseName = path.basename(filePath);
      const extname = path.extname(baseName);
      // Only add extension if suggestedName doesn't already have it
      let newName = baseName;
      if (result.suggestedName) {
        const suggestedExt = path.extname(result.suggestedName);
        newName = suggestedExt ? result.suggestedName : `${result.suggestedName}${extname}`;
      }
      const destPath = path.join(destFolder.path, newName);

      // Move file with cross-device and conflict handling
      await this._moveFileWithConflictHandling(filePath, destPath, extname);

      logger.info('[DOWNLOAD-WATCHER] Moved (fallback)', filePath, '=>', destPath);

      // Show system notification for fallback organization (respects user's notification preference)
      const confidencePercent = result.confidence ? Math.round(result.confidence * 100) : 70;
      let notificationsEnabled = true;
      try {
        const settings = await this.settingsService?.load?.();
        notificationsEnabled = settings?.notifications !== false;
      } catch {
        // Default to enabled if settings can't be loaded
      }
      showOrganizedNotification(baseName, destFolder.name, confidencePercent, notificationsEnabled);
    } catch (e) {
      // FIX: Handle TOCTOU race gracefully - file may have been deleted between check and move
      if (isNotFoundError(e)) {
        logger.debug('[DOWNLOAD-WATCHER] File disappeared before move (TOCTOU race):', filePath);
        return;
      }
      logger.error('[DOWNLOAD-WATCHER] Failed to move file', {
        source: filePath,
        destination: destFolder.path,
        ...this._formatErrorInfo(e)
      });
    }
  }

  /**
   * Move a file to destination, handling cross-device moves.
   * @param {string} source - Source file path
   * @param {string} destination - Destination file path
   * @throws {FileSystemError} On move failure
   */
  async _moveFile(source, destination) {
    try {
      await fs.rename(source, destination);
    } catch (renameError) {
      // Handle cross-device move (different drives)
      if (isCrossDeviceError(renameError)) {
        logger.debug(
          '[DOWNLOAD-WATCHER] Cross-device move detected, using crossDeviceMove utility'
        );
        try {
          await crossDeviceMove(source, destination, { verify: true });
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
        const fsError = FileSystemError.forOperation('move', renameError, source);
        logger.error('[DOWNLOAD-WATCHER] Failed to move file:', {
          source,
          destination,
          error: fsError.getUserFriendlyMessage(),
          code: fsError.code
        });
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
        return;
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
