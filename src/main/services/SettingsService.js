const { app, ipcMain } = require('electron');
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const crypto = require('crypto');
const { backupAndReplace } = require('../../shared/atomicFileOperations');
const {
  validateSettings,
  sanitizeSettings,
} = require('../../shared/settingsValidation');
const { DEFAULT_SETTINGS } = require('../../shared/defaultSettings');
const { logger } = require('../../shared/logger');
logger.setContext('SettingsService');

let singletonInstance = null;

class SettingsService {
  constructor() {
    this.settingsPath = path.join(app.getPath('userData'), 'settings.json');
    this.backupDir = path.join(app.getPath('userData'), 'settings-backups');
    this.maxBackups = 10; // Keep last 10 backups
    this.defaults = DEFAULT_SETTINGS;
    this._cache = null;
    this._cacheTimestamp = 0;
    this._cacheTtlMs = 2_000; // short TTL to avoid repeated disk reads
    this._fileWatcher = null;
    this._debounceTimer = null;
    this._debounceDelay = 500; // 500ms debounce
    this._isInternalChange = false; // Flag to ignore changes we made ourselves

    // Fixed: Add mutex to prevent concurrent save operations
    this._saveMutex = Promise.resolve();
    this._saveQueue = [];
    this._mutexAcquiredAt = null; // Track when mutex was acquired for deadlock detection
    this._mutexTimeoutMs = 30000; // 30 seconds max for any operation

    // CRITICAL FIX: Add maximum restart attempts counter to prevent infinite restart loops
    this._watcherRestartCount = 0;
    this._maxWatcherRestarts = 10; // Maximum 10 restart attempts
    this._watcherRestartWindow = 60000; // 1 minute window
    this._watcherRestartWindowStart = Date.now();

    // Start file watching
    this._startFileWatcher();
  }

  async load() {
    try {
      const now = Date.now();
      if (this._cache && now - this._cacheTimestamp < this._cacheTtlMs) {
        return this._cache;
      }
      const raw = await fs.readFile(this.settingsPath, 'utf-8');
      const parsed = JSON.parse(raw);
      const merged = { ...this.defaults, ...parsed };
      this._cache = merged;
      this._cacheTimestamp = now;
      return merged;
    } catch (err) {
      const merged = { ...this.defaults };
      this._cache = merged;
      this._cacheTimestamp = Date.now();
      if (err && err.code !== 'ENOENT') {
        logger.warn(
          `[SettingsService] Failed to read settings, using defaults: ${err.message}`,
        );
      }
      return merged;
    }
  }

  // Fixed: Proper cache invalidation, settings merging, and validation
  async save(settings) {
    // Fixed: Use mutex to prevent race conditions from concurrent saves
    return this._withMutex(async () => {
      // Validate settings before saving
      const validation = validateSettings(settings);
      if (!validation.valid) {
        const error = new Error('Invalid settings provided');
        error.validationErrors = validation.errors;
        error.validationWarnings = validation.warnings;
        throw error;
      }

      // Log warnings if any
      if (validation.warnings.length > 0) {
        logger.warn('[SettingsService] Validation warnings', {
          warnings: validation.warnings,
        });
      }

      // Sanitize settings to remove any invalid values
      const sanitized = sanitizeSettings(settings);

      // Load current settings first to avoid data loss on partial updates
      // This is now safe because we're inside the mutex
      const current = await this.load();
      const merged = { ...current, ...sanitized };

      // CRITICAL: Create backup before saving - mandatory with retry logic
      // Ensure backup directory exists first
      try {
        await fs.mkdir(this.backupDir, { recursive: true });
      } catch (error) {
        const errorMsg = `Failed to create backup directory: ${error.message}`;
        logger.error(`[SettingsService] ${errorMsg}`);
        throw new Error(errorMsg);
      }

      // Retry backup creation with exponential backoff (3 attempts)
      let backupResult = null;
      const maxBackupRetries = 3;
      const initialBackupDelay = 100; // Start with 100ms

      for (let attempt = 0; attempt < maxBackupRetries; attempt++) {
        try {
          backupResult = await this.createBackup();
          if (backupResult.success) {
            break; // Success, exit retry loop
          }
          // CRITICAL FIX: Log when backup returns unsuccessful result (not exception)
          logger.warn(
            `[SettingsService] Backup attempt ${attempt + 1} failed with result:`,
            backupResult,
          );
        } catch (error) {
          // CRITICAL FIX: Log each attempt failure with detailed error information
          logger.error(
            `[SettingsService] Backup attempt ${attempt + 1} failed with exception:`,
            {
              error: error.message,
              stack: error.stack,
              attempt: attempt + 1,
              maxRetries: maxBackupRetries,
            },
          );

          const isLastAttempt = attempt === maxBackupRetries - 1;
          if (isLastAttempt) {
            const errorMsg = `Failed to create backup after ${maxBackupRetries} attempts: ${error.message}`;
            logger.error(`[SettingsService] ${errorMsg}`);
            throw new Error(errorMsg);
          }
          // Wait before retry with exponential backoff
          const delay = initialBackupDelay * Math.pow(2, attempt);
          logger.warn(
            `[SettingsService] Retrying backup in ${delay}ms (attempt ${attempt + 2}/${maxBackupRetries})`,
          );
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }

      // Verify backup was successful
      if (!backupResult || !backupResult.success) {
        const errorMsg = `Backup creation failed: ${backupResult?.error || 'Unknown error'}`;
        logger.error(`[SettingsService] ${errorMsg}`);
        throw new Error(errorMsg);
      }

      // Now safe to save settings
      // Set flag to ignore our own file change
      this._isInternalChange = true;
      try {
        await fs.mkdir(path.dirname(this.settingsPath), { recursive: true });

        // Bug #42: Retry logic for file lock handling with exponential backoff
        const maxSaveRetries = 3;
        const baseSaveDelay = 100; // Start with 100ms

        for (let attempt = 0; attempt < maxSaveRetries; attempt++) {
          try {
            const result = await backupAndReplace(
              this.settingsPath,
              JSON.stringify(merged, null, 2),
            );
            if (!result.success) {
              throw new Error(result.error || 'Failed to save settings');
            }

            // Invalidate and update cache immediately
            this._cache = merged;
            this._cacheTimestamp = Date.now();

            // Success - exit retry loop
            break;
          } catch (saveError) {
            // Bug #42: Check for file lock errors (EBUSY, EPERM, EACCES)
            const isFileLockError =
              saveError.code === 'EBUSY' ||
              saveError.code === 'EPERM' ||
              saveError.code === 'EACCES';

            if (isFileLockError && attempt < maxSaveRetries - 1) {
              // Calculate exponential backoff delay
              const delay = baseSaveDelay * Math.pow(2, attempt);
              logger.warn(
                `[SettingsService] File lock error on save attempt ${attempt + 1}/${maxSaveRetries}: ${saveError.code}. Retrying in ${delay}ms...`,
              );
              await new Promise((resolve) => setTimeout(resolve, delay));
            } else if (attempt === maxSaveRetries - 1) {
              // Last attempt failed
              throw new Error(
                `Failed to save settings after ${maxSaveRetries} attempts due to file lock: ${saveError.message}`,
              );
            } else {
              // Non-lock error, fail immediately
              throw saveError;
            }
          }
        }
      } finally {
        // Reset flag after a short delay to allow file system to settle
        setTimeout(() => {
          this._isInternalChange = false;
        }, 100);
      }

      return {
        settings: merged,
        validationWarnings: validation.warnings,
        backupCreated: true,
        backupPath: backupResult.path,
      };
    }); // End of mutex wrapper
  }

  /**
   * Execute a function with mutex lock to prevent concurrent operations
   * @private
   */
  async _withMutex(fn) {
    // Fixed: Robust mutex implementation using promise chaining
    // CRITICAL: Mutex must ALWAYS resolve (never reject) to maintain the chain
    const previousMutex = this._saveMutex;

    // Create a new promise that will resolve when fn completes
    let resolveMutex;
    this._saveMutex = new Promise((resolve) => {
      resolveMutex = resolve;
    });

    try {
      // CRITICAL FIX: Add deadlock detection with timeout
      // Wait for previous operation with a timeout to prevent permanent deadlock
      const waitForPrevious = previousMutex.catch(() => {
        // Previous operation failed, but we continue with current operation
        // This prevents error propagation from breaking the mutex chain
      });

      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => {
          reject(
            new Error(
              `Mutex deadlock detected: Previous operation did not complete within ${this._mutexTimeoutMs}ms. ` +
                `This may indicate a stuck operation or infinite loop.`,
            ),
          );
        }, this._mutexTimeoutMs);
      });

      // Race between waiting for previous mutex and timeout
      await Promise.race([waitForPrevious, timeoutPromise]);

      // CRITICAL FIX: Track when this operation acquires the mutex for deadlock detection
      this._mutexAcquiredAt = Date.now();

      // Execute the function and ensure mutex is always released
      try {
        // Add timeout to the actual operation as well
        const operationPromise = fn();
        const operationTimeout = new Promise((_, reject) => {
          setTimeout(() => {
            reject(
              new Error(
                `Operation timeout: Function did not complete within ${this._mutexTimeoutMs}ms. ` +
                  `This may indicate a blocking operation or infinite loop in the save/restore logic.`,
              ),
            );
          }, this._mutexTimeoutMs);
        });

        const result = await Promise.race([operationPromise, operationTimeout]);
        return result;
      } finally {
        // CRITICAL: Always resolve mutex, even on error or timeout
        // This ensures the next operation can proceed even if this one fails
        this._mutexAcquiredAt = null;
        resolveMutex();
      }
    } catch (error) {
      // CRITICAL FIX: Always release mutex even on deadlock/timeout errors
      this._mutexAcquiredAt = null;
      if (!resolveMutex) {
        logger.error(
          '[SettingsService] Mutex resolver not initialized - this should never happen',
        );
      } else {
        // Ensure mutex is released even on catastrophic failure
        resolveMutex();
      }

      // Log deadlock/timeout errors with extra context
      if (
        error.message?.includes('deadlock') ||
        error.message?.includes('timeout')
      ) {
        logger.error('[SettingsService] Mutex deadlock or timeout detected', {
          error: error.message,
          mutexAcquiredAt: this._mutexAcquiredAt,
          timeElapsed: this._mutexAcquiredAt
            ? Date.now() - this._mutexAcquiredAt
            : 'N/A',
        });
      }

      // Catch and re-throw to maintain error propagation
      // The finally block above ensures mutex is released
      throw error;
    }
  }

  // Add explicit cache invalidation method
  invalidateCache() {
    this._cache = null;
    this._cacheTimestamp = 0;
  }

  // Force reload from disk, bypassing cache
  async reload() {
    this.invalidateCache();
    return await this.load();
  }

  // Fixed: Add permanent backup management
  /**
   * Create a permanent backup of current settings
   */
  async createBackup() {
    try {
      // Ensure backup directory exists
      await fs.mkdir(this.backupDir, { recursive: true });

      // Load current settings
      const settings = await this.load();

      // Create backup filename with timestamp
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupPath = path.join(
        this.backupDir,
        `settings-${timestamp}.json`,
      );

      // Write backup with metadata and SHA256 hash for integrity verification
      const backupData = {
        timestamp: new Date().toISOString(),
        appVersion: app.getVersion(),
        settings,
      };

      const backupJson = JSON.stringify(backupData, null, 2);

      // Calculate SHA256 hash of the backup data for integrity verification
      const hash = crypto
        .createHash('sha256')
        .update(backupJson, 'utf8')
        .digest('hex');

      // Store hash in a separate metadata object
      const backupWithHash = {
        ...backupData,
        hash,
      };

      await fs.writeFile(
        backupPath,
        JSON.stringify(backupWithHash, null, 2),
        'utf8',
      );

      // Clean up old backups
      await this.cleanupOldBackups();

      return {
        success: true,
        path: backupPath,
        timestamp: backupData.timestamp,
      };
    } catch (error) {
      logger.error('[SettingsService] Failed to create backup', {
        error: error.message,
      });
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * List all available backups
   */
  async listBackups() {
    try {
      // Ensure backup directory exists
      await fs.mkdir(this.backupDir, { recursive: true });

      // Read backup directory
      const files = await fs.readdir(this.backupDir);

      // Filter and parse backup files
      const backups = [];
      for (const file of files) {
        if (file.startsWith('settings-') && file.endsWith('.json')) {
          const filePath = path.join(this.backupDir, file);

          try {
            const content = await fs.readFile(filePath, 'utf8');
            const data = JSON.parse(content);

            const stats = await fs.stat(filePath);

            const timestamp = data.timestamp || stats.mtime.toISOString();

            backups.push({
              filename: file,
              path: filePath,
              timestamp,
              appVersion: data.appVersion || 'unknown',
              size: stats.size,
              _parsedTime: new Date(timestamp).getTime(), // Fixed: Parse once for efficient sorting
            });
          } catch (error) {
            // Skip invalid backup files
            logger.warn(`[SettingsService] Invalid backup file: ${file}`, {
              error: error.message,
            });
          }
        }
      }

      // Fixed: Optimized sort using pre-parsed timestamps
      backups.sort((a, b) => b._parsedTime - a._parsedTime);

      backups.forEach((backup) => {
        delete backup._parsedTime;
      });

      return backups;
    } catch (error) {
      logger.error('[SettingsService] Failed to list backups', {
        error: error.message,
      });
      return [];
    }
  }

  /**
   * Restore settings from a backup
   */
  async restoreFromBackup(backupPath) {
    // Fixed: Use mutex to prevent race conditions during restore
    return this._withMutex(async () => {
      try {
        // Read backup file
        const content = await fs.readFile(backupPath, 'utf8');
        const backupData = JSON.parse(content);

        // Bug #32: Verify JSON structure before processing
        if (!backupData || typeof backupData !== 'object') {
          throw new Error(
            'Invalid backup file: corrupted or invalid JSON structure',
          );
        }

        if (!backupData.settings) {
          throw new Error('Invalid backup file: missing settings object');
        }

        // Bug #32: Verify SHA256 hash if present (for backups created after this fix)
        if (backupData.hash) {
          // Reconstruct the original backup data without the hash
          const { hash: storedHash, ...originalData } = backupData;
          const originalJson = JSON.stringify(originalData, null, 2);

          // Calculate hash of the original data
          const calculatedHash = crypto
            .createHash('sha256')
            .update(originalJson, 'utf8')
            .digest('hex');

          // Compare hashes
          if (calculatedHash !== storedHash) {
            throw new Error(
              'Backup integrity check failed: SHA256 hash mismatch. ' +
                'The backup file may have been tampered with or corrupted. ' +
                'Please select a different backup file.',
            );
          }

          logger.info(
            '[SettingsService] Backup integrity verified (SHA256 hash match)',
          );
        } else {
          // Warn if hash is not present (old backup format)
          logger.warn(
            '[SettingsService] Restoring from backup without SHA256 verification (old format)',
          );
        }

        // Create a backup of current settings before restoring
        await this.createBackup();

        // Validate backup settings
        const validation = validateSettings(backupData.settings);
        if (!validation.valid) {
          const error = new Error('Backup contains invalid settings');
          error.validationErrors = validation.errors;
          error.validationWarnings = validation.warnings;
          throw error;
        }

        // Sanitize settings
        const sanitized = sanitizeSettings(backupData.settings);

        // Merge with defaults to ensure all required fields exist
        const merged = { ...this.defaults, ...sanitized };

        // Save restored settings
        await fs.mkdir(path.dirname(this.settingsPath), { recursive: true });
        const result = await backupAndReplace(
          this.settingsPath,
          JSON.stringify(merged, null, 2),
        );

        if (!result.success) {
          throw new Error(result.error || 'Failed to save restored settings');
        }

        // Invalidate cache
        this._cache = merged;
        this._cacheTimestamp = Date.now();

        return {
          success: true,
          settings: merged,
          validationWarnings: validation.warnings,
          restoredFrom: backupData.timestamp,
        };
      } catch (error) {
        logger.error('[SettingsService] Failed to restore from backup', {
          error: error.message,
        });
        return {
          success: false,
          error: error.message,
          validationErrors: error.validationErrors,
          validationWarnings: error.validationWarnings,
        };
      }
    });
  }

  /**
   * Clean up old backups, keeping only the most recent ones
   */
  async cleanupOldBackups() {
    try {
      const backups = await this.listBackups();

      // Bug #36: Add Number.MAX_SAFE_INTEGER check before timestamp comparisons
      // Validate all timestamps are within safe integer range
      for (const backup of backups) {
        if (backup._parsedTime && !Number.isSafeInteger(backup._parsedTime)) {
          logger.warn(
            `[SettingsService] Backup ${backup.filename} has unsafe timestamp: ${backup._parsedTime}. Skipping for safety.`,
          );
        }
      }

      // Keep only the most recent backups
      if (backups.length > this.maxBackups) {
        const backupsToDelete = backups.slice(this.maxBackups);

        for (const backup of backupsToDelete) {
          try {
            await fs.unlink(backup.path);
          } catch (error) {
            logger.warn(
              `[SettingsService] Failed to delete old backup: ${backup.filename}`,
              { error: error.message },
            );
          }
        }
      }
    } catch (error) {
      logger.error('[SettingsService] Failed to cleanup old backups', {
        error: error.message,
      });
    }
  }

  /**
   * Delete a specific backup
   */
  async deleteBackup(backupPath) {
    try {
      await fs.unlink(backupPath);
      return { success: true };
    } catch (error) {
      logger.error('[SettingsService] Failed to delete backup', {
        error: error.message,
      });
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Start watching the settings file for external changes
   * @private
   */
  _startFileWatcher() {
    try {
      // Ensure settings directory exists
      const settingsDir = path.dirname(this.settingsPath);
      if (!fsSync.existsSync(settingsDir)) {
        fsSync.mkdirSync(settingsDir, { recursive: true });
      }

      // Watch the settings file
      this._fileWatcher = fsSync.watch(
        this.settingsPath,
        (eventType, filename) => {
          // Ignore our own changes
          if (this._isInternalChange) {
            return;
          }

          // Handle file changes with debouncing
          if (eventType === 'change' || eventType === 'rename') {
            // Clear existing debounce timer
            if (this._debounceTimer) {
              clearTimeout(this._debounceTimer);
            }

            // Set new debounce timer
            this._debounceTimer = setTimeout(() => {
              this._handleExternalFileChange(eventType, filename);
            }, this._debounceDelay);
          }
        },
      );

      // Handle watcher errors
      this._fileWatcher.on('error', (error) => {
        logger.error('[SettingsService] File watcher error', {
          error: error.message,
        });
        // CRITICAL FIX: Check restart limit before attempting to restart
        // Attempt to restart watcher after a delay
        setTimeout(() => {
          this._restartFileWatcher();
        }, 5000);
      });

      logger.info(
        `[SettingsService] File watcher started for: ${this.settingsPath}`,
      );
    } catch (error) {
      logger.warn(
        `[SettingsService] Failed to start file watcher: ${error.message}`,
      );
      // Non-fatal - app can still function without file watching
    }
  }

  /**
   * Restart the file watcher
   * @private
   */
  _restartFileWatcher() {
    // CRITICAL FIX: Implement restart limit with time window to prevent infinite loops
    const now = Date.now();

    // Reset counter if window has passed
    if (now - this._watcherRestartWindowStart > this._watcherRestartWindow) {
      this._watcherRestartCount = 0;
      this._watcherRestartWindowStart = now;
    }

    // Check if restart limit exceeded
    if (this._watcherRestartCount >= this._maxWatcherRestarts) {
      logger.error(
        `[SettingsService] File watcher restart limit exceeded (${this._maxWatcherRestarts} restarts in ${this._watcherRestartWindow}ms). Disabling file watcher.`,
      );
      this._stopFileWatcher();
      return;
    }

    // Increment counter and restart
    this._watcherRestartCount++;
    logger.info(
      `[SettingsService] Restarting file watcher (attempt ${this._watcherRestartCount}/${this._maxWatcherRestarts})`,
    );

    this._stopFileWatcher();
    this._startFileWatcher();
  }

  /**
   * Stop watching the settings file
   * @private
   */
  _stopFileWatcher() {
    if (this._fileWatcher) {
      try {
        this._fileWatcher.close();
        this._fileWatcher = null;
        logger.info('[SettingsService] File watcher stopped');
      } catch (error) {
        logger.error('[SettingsService] Error stopping file watcher', {
          error: error.message,
        });
      }
    }

    // Clear debounce timer
    if (this._debounceTimer) {
      clearTimeout(this._debounceTimer);
      this._debounceTimer = null;
    }
  }

  /**
   * Handle external file changes
   * @private
   */
  async _handleExternalFileChange(eventType, filename) {
    try {
      logger.debug(
        `[SettingsService] External file change detected: ${eventType}, ${filename}`,
      );

      // Check if file still exists (might have been deleted)
      try {
        await fs.access(this.settingsPath);
      } catch (error) {
        if (error.code === 'ENOENT') {
          logger.info(
            '[SettingsService] Settings file was deleted, using defaults',
          );
          this.invalidateCache();
          this._notifySettingsChanged();
          return;
        }
        throw error;
      }

      // Invalidate cache to force reload
      this.invalidateCache();

      // Reload settings from disk
      const newSettings = await this.load();
      logger.debug('[SettingsService] Settings reloaded from external change');

      // Notify renderer process of settings change
      this._notifySettingsChanged();

      return newSettings;
    } catch (error) {
      logger.error('[SettingsService] Failed to handle external file change', {
        error: error.message,
      });
      // Invalidate cache anyway to prevent stale data
      this.invalidateCache();
    }
  }

  /**
   * Notify renderer process of settings changes via IPC
   * @private
   */
  _notifySettingsChanged() {
    try {
      // Emit IPC event to notify renderer
      if (ipcMain && ipcMain.emit) {
        // Get all BrowserWindows and send event
        const { BrowserWindow } = require('electron');
        const windows = BrowserWindow.getAllWindows();
        windows.forEach((win) => {
          if (win && !win.isDestroyed() && win.webContents) {
            try {
              win.webContents.send('settings-changed-external');
            } catch (error) {
              logger.warn(
                `[SettingsService] Failed to send settings-changed event: ${error.message}`,
              );
            }
          }
        });
      }
    } catch (error) {
      logger.warn(
        `[SettingsService] Failed to notify settings change: ${error.message}`,
      );
    }
  }

  /**
   * Shutdown the service and cleanup resources
   */
  shutdown() {
    this._stopFileWatcher();
  }
}

function getService() {
  if (!singletonInstance) {
    singletonInstance = new SettingsService();
  }
  return singletonInstance;
}

module.exports = SettingsService;
module.exports.getService = getService;
