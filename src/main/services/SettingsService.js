const { app } = require('electron');
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const { backupAndReplace } = require('../../shared/atomicFileOperations');
const { validateSettings, sanitizeSettings } = require('../../shared/settingsValidation');
const { DEFAULT_SETTINGS } = require('../../shared/defaultSettings');
const { logger: baseLogger, createLogger } = require('../../shared/logger');
const { isNotFoundError } = require('../../shared/errorClassifier');
const { createSingletonHelpers } = require('../../shared/singletonFactory');
const { LIMITS, DEBOUNCE, TIMEOUTS } = require('../../shared/performanceConstants');
const { SettingsBackupService } = require('./SettingsBackupService');
// FIX: Import safeSend for validated IPC event sending
const { safeSend } = require('../ipc/ipcWrappers');

const logger = typeof createLogger === 'function' ? createLogger('SettingsService') : baseLogger;
if (typeof createLogger !== 'function' && logger?.setContext) {
  logger.setContext('SettingsService');
}

/**
 * Custom error class for mutex timeout/deadlock errors
 * Provides better error identification and context for debugging
 */
class MutexTimeoutError extends Error {
  constructor(message, context = {}) {
    super(message);
    this.name = 'MutexTimeoutError';
    this.context = context;
    this.timestamp = Date.now();
  }
}

class SettingsService {
  constructor() {
    this.settingsPath = path.join(app.getPath('userData'), 'settings.json');
    this.backupDir = path.join(app.getPath('userData'), 'settings-backups');
    // Use centralized constants from performanceConstants.js
    this.maxBackups = LIMITS.MAX_SETTINGS_BACKUPS;
    this.defaults = DEFAULT_SETTINGS;
    this._cache = null;
    this._cacheTimestamp = 0;
    this._cacheTtlMs = 2_000; // short TTL to avoid repeated disk reads
    this._fileWatcher = null;
    this._debounceTimer = null;
    // PERFORMANCE FIX: Use centralized debounce constant
    this._debounceDelay = DEBOUNCE.SETTINGS_SAVE;
    this._isInternalChange = false; // Flag to ignore changes we made ourselves
    this._internalChangeTimer = null; // FIX: Track internal change reset timer for cleanup
    this._isShuttingDown = false; // FIX CRIT-33: Track shutdown state

    // Fixed: Add mutex to prevent concurrent save operations
    this._saveMutex = Promise.resolve();
    this._saveQueue = [];
    this._mutexAcquiredAt = null; // Track when mutex was acquired for deadlock detection
    this._mutexTimeoutMs = TIMEOUTS.SERVICE_STARTUP; // Use centralized timeout

    // CRITICAL FIX: Use centralized constants for watcher restart limits
    this._watcherRestartCount = 0;
    this._maxWatcherRestarts = LIMITS.MAX_WATCHER_RESTARTS;
    this._watcherRestartWindow = LIMITS.WATCHER_RESTART_WINDOW;
    this._watcherRestartWindowStart = Date.now();
    this._restartTimer = null; // FIX: Track restart timer to prevent unbounded timers

    // Initialize backup service (extracted for better separation of concerns)
    this._backupService = new SettingsBackupService({
      backupDir: this.backupDir,
      maxBackups: this.maxBackups,
      defaults: this.defaults,
      loadSettings: () => this.load()
    });

    // Start file watching
    this._startFileWatcher();
    this._migrationChecked = false;
    // FIX 1.4: Track migration attempts to prevent infinite retries
    this._migrationAttempts = 0;
    this._maxMigrationAttempts = 3;
  }

  async load() {
    // FIX CRIT-33: Don't attempt load during shutdown
    if (this._isShuttingDown) {
      logger.debug('[SettingsService] Ignoring load() during shutdown');
      return this._cache || { ...this.defaults };
    }

    // Perform migration once per session before first load
    // FIX 1.4: Limit migration retries to prevent disk thrashing
    if (!this._migrationChecked && this._migrationAttempts < this._maxMigrationAttempts) {
      try {
        await this.migrateLegacyConfig();
        this._migrationChecked = true; // Only mark checked after successful completion
      } catch (err) {
        this._migrationAttempts++;
        logger.error(
          `[SettingsService] Migration attempt ${this._migrationAttempts}/${this._maxMigrationAttempts} failed:`,
          err.message
        );
        if (this._migrationAttempts >= this._maxMigrationAttempts) {
          this._migrationChecked = true; // Give up after max attempts
          logger.error(
            '[SettingsService] Migration permanently failed after max attempts - continuing with current settings'
          );
        }
      }
    }
    return this._loadRaw();
  }

  async _loadRaw() {
    try {
      const now = Date.now();
      if (this._cache && now - this._cacheTimestamp < this._cacheTtlMs) {
        return this._cache;
      }
      const raw = await fs.readFile(this.settingsPath, 'utf-8');

      // FIX 1.3: Separate JSON parse error handling for better diagnostics
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch (parseError) {
        // Specific handling for JSON syntax errors
        logger.error('[SettingsService] Settings file contains invalid JSON:', {
          error: parseError.message,
          position: parseError.message.match(/position (\d+)/)?.[1] || 'unknown'
        });
        // Mark error as JSON corruption for recovery logic
        const jsonError = new Error(
          `Settings file corrupted (invalid JSON): ${parseError.message}`
        );
        jsonError.code = 'JSON_PARSE_ERROR';
        jsonError.originalError = parseError;
        throw jsonError;
      }

      const merged = { ...this.defaults, ...parsed };
      const sanitized = sanitizeSettings(merged);
      this._cache = sanitized;
      this._cacheTimestamp = now;
      return sanitized;
    } catch (err) {
      // FIX: Attempt auto-recovery from backup if settings file is corrupted
      if (err && !isNotFoundError(err)) {
        // FIX 1.3: More descriptive logging based on error type
        const errorType = err.code === 'JSON_PARSE_ERROR' ? 'corrupted' : 'unreadable';
        logger.warn(
          `[SettingsService] Settings file ${errorType}: ${err.message}, attempting recovery from backup`
        );
        const recovered = await this._attemptAutoRecovery();
        if (recovered) {
          return recovered;
        }
      }

      const merged = { ...this.defaults };
      this._cache = merged;
      this._cacheTimestamp = Date.now();
      if (err && !isNotFoundError(err)) {
        logger.warn(`[SettingsService] Recovery failed, using defaults`);
      }
      return merged;
    }
  }

  /**
   * FIX: Attempt auto-recovery from the most recent valid backup
   * @private
   * @returns {Promise<Object|null>} Recovered settings or null if recovery failed
   */
  async _attemptAutoRecovery() {
    try {
      const backups = await this._backupService.listBackups();
      if (!backups || backups.length === 0) {
        logger.warn('[SettingsService] No backups available for auto-recovery');
        return null;
      }

      // FIX 1.1: Limit recovery attempts to prevent slow startup with many corrupted backups
      const MAX_RECOVERY_ATTEMPTS = 5;
      const backupsToTry = backups.slice(0, MAX_RECOVERY_ATTEMPTS);

      if (backups.length > MAX_RECOVERY_ATTEMPTS) {
        logger.info(
          `[SettingsService] Limiting recovery to ${MAX_RECOVERY_ATTEMPTS} most recent backups (${backups.length} available)`
        );
      }

      // Try backups in order (most recent first)
      for (const backup of backupsToTry) {
        try {
          logger.info(`[SettingsService] Attempting recovery from backup: ${backup.filename}`);
          // FIX HIGH-70: Correct method name is restoreFromBackup, not restoreBackup
          const result = await this._backupService.restoreFromBackup(
            backup.filename,
            async (merged) => {
              // Save restored settings using backupAndReplace (same as regular restore)
              const { backupAndReplace } = require('../../shared/atomicFileOperations');
              const saveResult = await backupAndReplace(
                this.settingsPath,
                JSON.stringify(merged, null, 2)
              );
              if (!saveResult.success) {
                throw new Error(saveResult.error || 'Failed to save restored settings');
              }
              return { success: true };
            }
          );

          if (result.success) {
            logger.info(
              `[SettingsService] Successfully recovered settings from backup: ${backup.filename}`
            );
            // Reload the restored settings
            const raw = await fs.readFile(this.settingsPath, 'utf-8');
            const parsed = JSON.parse(raw);
            const merged = { ...this.defaults, ...parsed };
            const sanitized = sanitizeSettings(merged);
            this._cache = sanitized;
            this._cacheTimestamp = Date.now();
            return sanitized;
          }
        } catch (backupErr) {
          logger.warn(
            `[SettingsService] Failed to restore backup ${backup.filename}: ${backupErr.message}`
          );
          // Continue to next backup
        }
      }

      logger.error('[SettingsService] All backup recovery attempts failed');
      return null;
    } catch (err) {
      logger.error(`[SettingsService] Auto-recovery failed: ${err.message}`);
      return null;
    }
  }

  /**
   * Migrate legacy configuration files (ollama-config.json, model-config.json)
   * to the main settings.json file.
   */
  async migrateLegacyConfig() {
    const userDataPath = app.getPath('userData');
    const ollamaConfigPath = path.join(userDataPath, 'ollama-config.json');
    const modelConfigPath = path.join(userDataPath, 'model-config.json');

    const updates = {};
    let hasUpdates = false;
    let legacyFilesFound = false;

    // Helper to check file existence
    const fileExists = async (p) => {
      try {
        await fs.access(p);
        return true;
      } catch {
        return false;
      }
    };

    // 1. Check ollama-config.json
    if (await fileExists(ollamaConfigPath)) {
      legacyFilesFound = true;
      try {
        const raw = await fs.readFile(ollamaConfigPath, 'utf-8');
        const config = JSON.parse(raw);
        if (config.host) {
          updates.ollamaHost = config.host;
          hasUpdates = true;
        }
        if (config.selectedTextModel || config.selectedModel) {
          updates.textModel = config.selectedTextModel || config.selectedModel;
          hasUpdates = true;
        }
        if (config.selectedVisionModel) {
          updates.visionModel = config.selectedVisionModel;
          hasUpdates = true;
        }
        if (config.selectedEmbeddingModel) {
          updates.embeddingModel = config.selectedEmbeddingModel;
          hasUpdates = true;
        }
      } catch (e) {
        logger.warn('[SettingsService] Failed to read legacy ollama-config.json:', e.message);
      }
    }

    // 2. Check model-config.json (ModelManager)
    if (await fileExists(modelConfigPath)) {
      legacyFilesFound = true;
      try {
        const raw = await fs.readFile(modelConfigPath, 'utf-8');
        const config = JSON.parse(raw);
        // Only set textModel if not already set from ollama-config
        if (config.selectedModel && !updates.textModel) {
          updates.textModel = config.selectedModel;
          hasUpdates = true;
        }
      } catch (e) {
        logger.warn('[SettingsService] Failed to read legacy model-config.json:', e.message);
      }
    }

    // 3. Apply updates if any
    if (hasUpdates) {
      logger.info('[SettingsService] Migrating legacy configuration...', updates);
      try {
        const current = await this._loadRaw();
        const merged = { ...current, ...updates };

        // Validate and sanitize before saving
        const validation = validateSettings(merged);
        if (validation.valid) {
          const sanitized = sanitizeSettings(merged);

          // Use atomic save directly
          await fs.mkdir(path.dirname(this.settingsPath), { recursive: true });
          await backupAndReplace(this.settingsPath, JSON.stringify(sanitized, null, 2));

          // Update cache
          this._cache = sanitized;
          this._cacheTimestamp = Date.now();
          logger.info('[SettingsService] Legacy configuration migrated successfully.');
        } else {
          logger.warn(
            '[SettingsService] Migration skipped due to validation errors:',
            validation.errors
          );
        }
      } catch (err) {
        logger.error('[SettingsService] Migration save failed:', err);
      }
    }

    // 4. Archive legacy files if migration ran or they just exist
    if (legacyFilesFound) {
      try {
        if (await fileExists(ollamaConfigPath)) {
          await fs.rename(ollamaConfigPath, `${ollamaConfigPath}.migrated.bak`);
        }
        if (await fileExists(modelConfigPath)) {
          await fs.rename(modelConfigPath, `${modelConfigPath}.migrated.bak`);
        }
      } catch (e) {
        logger.warn('[SettingsService] Failed to archive legacy config files:', e.message);
      }
    }
  }

  // Fixed: Proper cache invalidation, settings merging, and validation
  async save(settings) {
    // FIX CRIT-33: Don't attempt save during shutdown
    if (this._isShuttingDown) {
      logger.debug('[SettingsService] Ignoring save() during shutdown');
      return {
        settings: this._cache || { ...this.defaults },
        validationWarnings: [],
        backupCreated: false
      };
    }

    // Fixed: Use mutex to prevent race conditions from concurrent saves
    return this._withMutex(async () => {
      // Force confidenceThreshold to a sane number before validation/merge
      const coerceConfidence = (val, fallback) => {
        const num = Number(val);
        if (Number.isFinite(num)) {
          return Math.min(1, Math.max(0, num));
        }
        return fallback;
      };

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
          warnings: validation.warnings
        });
      }

      // FIX 1.2: Sanitize settings first, then apply single coercion after merge
      // Previously coerced twice (before and after merge) - now only after merge
      const sanitized = sanitizeSettings(settings);

      // FIX Issue 1.3: Force fresh read from disk - bypass cache during critical save
      // This prevents stale cache from causing data loss when external changes occurred
      this._cache = null;
      this._cacheTimestamp = 0;

      // Load current settings first to avoid data loss on partial updates
      // This is now safe because we're inside the mutex
      const current = await this._loadRaw();

      // FIX 1.2: Single coercion point after merge - ensures final value is valid
      const merged = {
        ...current,
        ...sanitized,
        confidenceThreshold: coerceConfidence(
          sanitized?.confidenceThreshold ?? current.confidenceThreshold,
          DEFAULT_SETTINGS.confidenceThreshold
        )
      };

      // CRITICAL: Create backup before saving - mandatory with retry logic
      // createBackup handles directory creation via atomicFileOps

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
            backupResult
          );
        } catch (error) {
          // CRITICAL FIX: Log each attempt failure with detailed error information
          logger.error(`[SettingsService] Backup attempt ${attempt + 1} failed with exception:`, {
            error: error.message,
            stack: error.stack,
            attempt: attempt + 1,
            maxRetries: maxBackupRetries
          });

          const isLastAttempt = attempt === maxBackupRetries - 1;
          if (isLastAttempt) {
            const errorMsg = `Failed to create backup after ${maxBackupRetries} attempts: ${error.message}`;
            logger.error(`[SettingsService] ${errorMsg}`);
            throw new Error(errorMsg);
          }
          // Wait before retry with exponential backoff
          const delay = initialBackupDelay * 2 ** attempt;
          logger.warn(
            `[SettingsService] Retrying backup in ${delay}ms (attempt ${attempt + 2}/${maxBackupRetries})`
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
      const backupPath = backupResult.path;

      // Now safe to save settings
      // Set flag to ignore our own file change
      this._isInternalChange = true;

      // FIX: Store previous cache state for atomic rollback on failure
      const previousCache = this._cache;
      const previousTimestamp = this._cacheTimestamp;

      try {
        await fs.mkdir(path.dirname(this.settingsPath), { recursive: true });

        // FIX: Update cache BEFORE disk write for atomic behavior
        // If disk write fails, we rollback to previous state
        this._cache = merged;
        this._cacheTimestamp = Date.now();

        // Bug #42: Retry logic for file lock handling with exponential backoff
        // FIX: Increased retry count and delay for Windows antivirus/indexing
        const maxSaveRetries = 5; // Was 3
        const baseSaveDelay = 200; // Was 100ms - Total window: 200+400+800+1600=3000ms

        for (let attempt = 0; attempt < maxSaveRetries; attempt++) {
          try {
            const result = await backupAndReplace(
              this.settingsPath,
              JSON.stringify(merged, null, 2)
            );
            if (!result || !result.success) {
              throw new Error((result && result.error) || 'Failed to save settings');
            }

            // Success - exit retry loop (cache already updated)
            break;
          } catch (saveError) {
            // Bug #42: Check for file lock errors (EBUSY, EPERM, EACCES)
            const isFileLockError =
              saveError.code === 'EBUSY' ||
              saveError.code === 'EPERM' ||
              saveError.code === 'EACCES';

            if (isFileLockError && attempt < maxSaveRetries - 1) {
              // Calculate exponential backoff delay
              const delay = baseSaveDelay * 2 ** attempt;
              logger.warn(
                `[SettingsService] File lock error on save attempt ${attempt + 1}/${maxSaveRetries}: ${saveError.code}. Retrying in ${delay}ms...`
              );
              await new Promise((resolve) => setTimeout(resolve, delay));
            } else if (attempt === maxSaveRetries - 1) {
              // FIX: Rollback cache on complete failure before throwing
              this._cache = previousCache;
              this._cacheTimestamp = previousTimestamp;
              logger.error('[SettingsService] Save failed, rolled back cache to previous state');
              throw new Error(
                `Failed to save settings after ${maxSaveRetries} attempts due to file lock: ${saveError.message}`
              );
            } else {
              // FIX: Rollback cache on non-lock error before throwing
              this._cache = previousCache;
              this._cacheTimestamp = previousTimestamp;
              logger.error('[SettingsService] Save failed with non-lock error, rolled back cache');
              throw saveError;
            }
          }
        }
      } catch (err) {
        // FIX: Rollback cache on any outer error (e.g., mkdir failure)
        this._cache = previousCache;
        this._cacheTimestamp = previousTimestamp;
        logger.error(
          '[SettingsService] Save operation failed, rolled back cache to previous state'
        );
        if (backupPath) {
          try {
            await this._backupService.deleteBackup(backupPath);
            logger.warn('[SettingsService] Deleted orphan backup after failed save', {
              backupPath
            });
          } catch (cleanupError) {
            logger.warn('[SettingsService] Failed to delete orphan backup after save failure', {
              backupPath,
              error: cleanupError.message
            });
          }
        }
        throw err;
      } finally {
        // Reset flag after a short delay to allow file system to settle
        // FIX: Track timer for cleanup during shutdown
        if (this._internalChangeTimer) {
          clearTimeout(this._internalChangeTimer);
        }
        this._internalChangeTimer = setTimeout(() => {
          // FIX CRIT-33: Check shutdown state before executing callback
          if (!this._isShuttingDown) {
            this._isInternalChange = false;
          }
          this._internalChangeTimer = null;
        }, 100);
      }

      return {
        settings: merged,
        validationWarnings: validation.warnings,
        backupCreated: true,
        backupPath: backupResult.path
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

      // FIX: Store timeout ID to clear it after mutex acquisition
      let timeoutId;
      const timeoutPromise = new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(
            new MutexTimeoutError(
              `Mutex deadlock detected: Previous operation did not complete within ${this._mutexTimeoutMs}ms. ` +
                `This may indicate a stuck operation or infinite loop.`,
              { phase: 'mutex_acquisition', timeoutMs: this._mutexTimeoutMs }
            )
          );
        }, this._mutexTimeoutMs);
      });

      // Race between waiting for previous mutex and timeout
      try {
        await Promise.race([waitForPrevious, timeoutPromise]);
      } finally {
        // FIX: Always clear timeout to prevent memory leak
        if (timeoutId) clearTimeout(timeoutId);
      }

      // CRITICAL FIX: Track when this operation acquires the mutex for deadlock detection
      this._mutexAcquiredAt = Date.now();

      // Execute the function and ensure mutex is always released
      let operationTimeoutId = null;
      try {
        // Add timeout to the actual operation as well
        const operationPromise = fn();
        const operationTimeout = new Promise((_, reject) => {
          operationTimeoutId = setTimeout(() => {
            reject(
              new MutexTimeoutError(
                `Operation timeout: Function did not complete within ${this._mutexTimeoutMs}ms. ` +
                  `This may indicate a blocking operation or infinite loop in the save/restore logic.`,
                {
                  phase: 'operation_execution',
                  timeoutMs: this._mutexTimeoutMs,
                  mutexAcquiredAt: this._mutexAcquiredAt
                }
              )
            );
          }, this._mutexTimeoutMs);
        });

        const result = await Promise.race([operationPromise, operationTimeout]);
        return result;
      } finally {
        // CRITICAL: Clear timeout to prevent memory leak
        if (operationTimeoutId) clearTimeout(operationTimeoutId);
        // CRITICAL: Always resolve mutex, even on error or timeout
        // This ensures the next operation can proceed even if this one fails
        this._mutexAcquiredAt = null;
        resolveMutex();
      }
    } catch (error) {
      // FIX: Preserve error context BEFORE clearing _mutexAcquiredAt
      const acquiredAt = this._mutexAcquiredAt;
      const timeElapsed = acquiredAt ? Date.now() - acquiredAt : null;

      // CRITICAL FIX: Always release mutex even on deadlock/timeout errors
      this._mutexAcquiredAt = null;
      if (!resolveMutex) {
        logger.error('[SettingsService] Mutex resolver not initialized - this should never happen');
      } else {
        // Ensure mutex is released even on catastrophic failure
        resolveMutex();
      }

      // Log deadlock/timeout errors with extra context
      if (
        error instanceof MutexTimeoutError ||
        error.message?.includes('deadlock') ||
        error.message?.includes('timeout')
      ) {
        logger.error('[SettingsService] Mutex deadlock or timeout detected', {
          error: error.message,
          errorType: error.name,
          errorContext: error instanceof MutexTimeoutError ? error.context : undefined,
          mutexAcquiredAt: acquiredAt,
          timeElapsed: timeElapsed ?? 'N/A'
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

  /**
   * Synchronously get a setting value from cache
   * Returns the cached value, or the default if cache is empty
   * @param {string} key - The setting key to retrieve
   * @returns {*} The setting value or default
   */
  get(key) {
    if (this._cache && key in this._cache) {
      return this._cache[key];
    }
    return this.defaults[key];
  }

  /**
   * Synchronously get all cached settings
   * Returns cached settings merged with defaults, or just defaults if cache is empty
   * @returns {Object} The current settings
   */
  getAll() {
    if (this._cache) {
      return { ...this._cache };
    }
    return { ...this.defaults };
  }

  // Force reload from disk, bypassing cache
  async reload() {
    this.invalidateCache();
    return await this.load();
  }

  // Backup operations delegated to SettingsBackupService for better separation of concerns

  /**
   * Create a permanent backup of current settings
   * @returns {Promise<{success: boolean, path?: string, timestamp?: string, error?: string}>}
   */
  async createBackup() {
    return this._backupService.createBackup();
  }

  /**
   * List all available backups
   * @returns {Promise<Array<{filename: string, path: string, timestamp: string, appVersion: string, size: number}>>}
   */
  async listBackups() {
    return this._backupService.listBackups();
  }

  /**
   * Restore settings from a backup
   * @param {string} backupPath - Path to backup file
   * @returns {Promise<{success: boolean, settings?: Object, error?: string}>}
   */
  async restoreFromBackup(backupPath) {
    // FIX: Validate input before calling path.resolve to avoid TypeError
    if (!backupPath || typeof backupPath !== 'string') {
      return { success: false, error: 'Invalid backup path provided' };
    }

    // SECURITY FIX: Validate backup path is within backup directory to prevent path traversal
    let normalizedPath = path.normalize(path.resolve(backupPath));
    let normalizedBackupDir = path.normalize(path.resolve(this.backupDir));
    if (process.platform === 'win32') {
      normalizedPath = normalizedPath.toLowerCase();
      normalizedBackupDir = normalizedBackupDir.toLowerCase();
    }
    if (
      !normalizedPath.startsWith(normalizedBackupDir + path.sep) &&
      normalizedPath !== normalizedBackupDir
    ) {
      throw new Error('Backup path is outside backup directory - potential path traversal attack');
    }

    // Use mutex to prevent race conditions during restore
    return this._withMutex(async () => {
      const result = await this._backupService.restoreFromBackup(backupPath, async (merged) => {
        // Save restored settings using backupAndReplace
        const saveResult = await backupAndReplace(
          this.settingsPath,
          JSON.stringify(merged, null, 2)
        );
        if (!saveResult.success) {
          throw new Error(saveResult.error || 'Failed to save restored settings');
        }
        // Update cache
        this._cache = merged;
        this._cacheTimestamp = Date.now();
      });
      return result;
    });
  }

  /**
   * Clean up old backups, keeping only the most recent ones
   */
  async cleanupOldBackups() {
    return this._backupService.cleanupOldBackups();
  }

  /**
   * Delete a specific backup
   * @param {string} backupPath - Path to backup file
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  async deleteBackup(backupPath) {
    return this._backupService.deleteBackup(backupPath);
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
      this._fileWatcher = fsSync.watch(this.settingsPath, (eventType, filename) => {
        // Ignore our own changes
        if (this._isInternalChange) {
          return;
        }

        // PERFORMANCE FIX: Only handle 'change' events, ignore 'rename' events
        // 'rename' events are often false positives on Windows (file metadata changes)
        // This reduces unnecessary file reloads
        if (eventType === 'change') {
          // Clear existing debounce timer
          if (this._debounceTimer) {
            clearTimeout(this._debounceTimer);
          }

          // Set new debounce timer
          this._debounceTimer = setTimeout(() => {
            void this._handleExternalFileChange(eventType, filename).catch((error) => {
              logger.error('[SettingsService] Debounced external change failed', {
                error: error.message
              });
            });
          }, this._debounceDelay);
          if (typeof this._debounceTimer.unref === 'function') {
            this._debounceTimer.unref();
          }
        }
        // Ignore 'rename' events - they're often false positives on Windows
      });

      // Handle watcher errors
      this._fileWatcher.on('error', (error) => {
        logger.error('[SettingsService] File watcher error', {
          error: error.message
        });

        // FIX Issue 1.6: Clear ALL pending timers before restart to prevent stale callbacks
        if (this._debounceTimer) {
          clearTimeout(this._debounceTimer);
          this._debounceTimer = null;
        }
        if (this._restartTimer) {
          clearTimeout(this._restartTimer);
        }

        // Attempt to restart watcher after a delay
        this._restartTimer = setTimeout(() => {
          this._restartTimer = null;
          this._restartFileWatcher();
        }, 5000);
      });

      logger.info(`[SettingsService] File watcher started for: ${this.settingsPath}`);
    } catch (error) {
      logger.warn(`[SettingsService] Failed to start file watcher: ${error.message}`);
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
        `[SettingsService] File watcher restart limit exceeded (${this._maxWatcherRestarts} restarts in ${this._watcherRestartWindow}ms). Disabling file watcher.`
      );
      this._stopFileWatcher();
      return;
    }

    // Increment counter and restart
    this._watcherRestartCount++;
    logger.info(
      `[SettingsService] Restarting file watcher (attempt ${this._watcherRestartCount}/${this._maxWatcherRestarts})`
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
          error: error.message
        });
      }
    }

    // Clear debounce timer
    if (this._debounceTimer) {
      clearTimeout(this._debounceTimer);
      this._debounceTimer = null;
    }

    // FIX: Clear restart timer to prevent orphaned timers
    if (this._restartTimer) {
      clearTimeout(this._restartTimer);
      this._restartTimer = null;
    }
  }

  /**
   * Handle external file changes
   * @private
   */
  async _handleExternalFileChange(eventType, filename) {
    try {
      logger.debug(`[SettingsService] External file change detected: ${eventType}, ${filename}`);

      // Check if file still exists (might have been deleted)
      try {
        await fs.access(this.settingsPath);
      } catch (error) {
        if (isNotFoundError(error)) {
          logger.info('[SettingsService] Settings file was deleted, using defaults');
          this.invalidateCache();
          this._notifySettingsChanged();
          return;
        }
        throw error;
      }

      // Invalidate cache to force reload
      this.invalidateCache();

      // Reload settings from disk
      const latestSettings = await this.load();
      logger.debug('[SettingsService] Settings reloaded from external change');

      // Notify renderer process of settings change
      await this._notifySettingsChanged(latestSettings);
    } catch (error) {
      logger.error('[SettingsService] Failed to handle external file change', {
        error: error.message
      });
      // Invalidate cache anyway to prevent stale data
      this.invalidateCache();
    }
  }

  /**
   * Notify renderer process of settings changes via IPC
   * @private
   */
  async _notifySettingsChanged(payload = null, options = {}) {
    try {
      const isEnvelope =
        payload &&
        typeof payload === 'object' &&
        Object.prototype.hasOwnProperty.call(payload, 'settings');
      let settings = isEnvelope ? payload.settings : payload;
      if (!settings || typeof settings !== 'object') {
        settings = await this.load();
      }
      const source =
        (isEnvelope && typeof payload.source === 'string' && payload.source) ||
        options.source ||
        'external';
      const timestamp =
        (isEnvelope && typeof payload.timestamp === 'number' && payload.timestamp) || Date.now();
      const eventPayload = {
        settings,
        source,
        timestamp
      };

      // Get all BrowserWindows and send event
      const { BrowserWindow } = require('electron');
      const windows = BrowserWindow.getAllWindows();
      windows.forEach((win) => {
        if (win && !win.isDestroyed() && win.webContents) {
          try {
            // FIX: Use safeSend for validated IPC event sending
            safeSend(win.webContents, 'settings-changed-external', eventPayload);
          } catch (error) {
            logger.warn(
              `[SettingsService] Failed to send settings-changed event: ${error.message}`
            );
          }
        }
      });
    } catch (error) {
      logger.warn(`[SettingsService] Failed to notify settings change: ${error.message}`);
    }
  }

  /**
   * Shutdown the service and cleanup resources
   * @returns {Promise<void>}
   */
  async shutdown() {
    this._isShuttingDown = true; // FIX CRIT-33: Set shutdown flag
    // FIX: Clear all timers to prevent memory leaks
    if (this._internalChangeTimer) {
      clearTimeout(this._internalChangeTimer);
      this._internalChangeTimer = null;
    }
    this._stopFileWatcher();
  }
}

// Use shared singleton factory for getInstance, registerWithContainer, resetInstance
const { getInstance, createInstance, registerWithContainer, resetInstance } =
  createSingletonHelpers({
    ServiceClass: SettingsService,
    serviceId: 'SETTINGS',
    serviceName: 'SettingsService',
    containerPath: './ServiceContainer',
    shutdownMethod: 'shutdown'
  });

// Backwards compatibility alias
const getService = getInstance;

module.exports = SettingsService;
module.exports.getInstance = getInstance;
module.exports.createInstance = createInstance;
module.exports.registerWithContainer = registerWithContainer;
module.exports.resetInstance = resetInstance;
module.exports.getService = getService; // Deprecated: use getInstance
