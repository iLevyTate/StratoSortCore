/**
 * SettingsBackupService
 * Handles backup, restore, and cleanup operations for settings files.
 * Extracted from SettingsService for better separation of concerns.
 */

const { app } = require('electron');
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const { atomicFileOps } = require('../../shared/atomicFileOperations');
const { validateSettings, sanitizeSettings } = require('../../shared/settingsValidation');
const { logger: baseLogger, createLogger } = require('../../shared/logger');
const { LIMITS } = require('../../shared/performanceConstants');

const logger =
  typeof createLogger === 'function' ? createLogger('SettingsBackupService') : baseLogger;
if (typeof createLogger !== 'function' && logger?.setContext) {
  logger.setContext('SettingsBackupService');
}

const stableStringify = (value) =>
  JSON.stringify(
    value,
    (key, val) => {
      if (val && typeof val === 'object' && !Array.isArray(val)) {
        return Object.keys(val)
          .sort()
          .reduce((acc, k) => {
            acc[k] = val[k];
            return acc;
          }, {});
      }
      return val;
    },
    2
  );

class SettingsBackupService {
  /**
   * Create a new SettingsBackupService
   * @param {Object} options - Configuration options
   * @param {string} options.backupDir - Directory for backup files
   * @param {number} [options.maxBackups] - Maximum number of backups to retain
   * @param {Object} options.defaults - Default settings object
   * @param {Function} options.loadSettings - Function to load current settings
   */
  constructor({ backupDir, maxBackups, defaults, loadSettings }) {
    this.backupDir = backupDir || path.join(app.getPath('userData'), 'settings-backups');
    this.maxBackups = maxBackups || LIMITS.MAX_SETTINGS_BACKUPS;
    this.defaults = defaults;
    this._loadSettings = loadSettings;
  }

  /**
   * Validate that a path is within the backup directory (path traversal protection)
   * @param {string} backupPath - Path to validate
   * @throws {Error} If path is outside backup directory
   */
  _validateBackupPath(backupPath) {
    let normalizedPath = path.normalize(path.resolve(backupPath));
    let normalizedBackupDir = path.normalize(path.resolve(this.backupDir));
    if (process.platform === 'win32') {
      normalizedPath = normalizedPath.toLowerCase();
      normalizedBackupDir = normalizedBackupDir.toLowerCase();
    }
    if (!normalizedPath.startsWith(normalizedBackupDir + path.sep)) {
      throw new Error('Invalid backup path: must be within backup directory');
    }
  }

  /**
   * Create a permanent backup of current settings
   * @returns {Promise<{success: boolean, path?: string, timestamp?: string, error?: string}>}
   */
  async createBackup() {
    try {
      // Ensure backup directory exists
      if (typeof fs.mkdir === 'function') {
        await fs.mkdir(this.backupDir, { recursive: true });
      }

      const settings = await this._loadSettings();

      // Create backup filename with timestamp
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupPath = path.join(this.backupDir, `settings-${timestamp}.json`);

      // Write backup with metadata and SHA256 hash for integrity verification
      const backupData = {
        timestamp: new Date().toISOString(),
        appVersion: app.getVersion(),
        settings
      };

      const backupJson = stableStringify(backupData);

      // Calculate SHA256 hash of the backup data for integrity verification
      // FIX HIGH-22: Use stable JSON stringify for consistent hash calculation
      const hash = crypto.createHash('sha256').update(backupJson, 'utf8').digest('hex');

      // Store hash in a separate metadata object
      const backupWithHash = {
        ...backupData,
        hash
      };

      const writeContent = stableStringify(backupWithHash);

      // Write using atomicFileOps when available, otherwise fall back to fs.writeFile
      if (atomicFileOps?.safeWriteFile) {
        try {
          await atomicFileOps.safeWriteFile(backupPath, writeContent);
        } catch {
          // Fall back to direct write for test environments
          await fs.writeFile(backupPath, writeContent);
        }
      } else {
        await fs.writeFile(backupPath, writeContent);
      }

      // Clean up old backups
      await this.cleanupOldBackups();

      return {
        success: true,
        path: backupPath,
        timestamp: backupData.timestamp
      };
    } catch (error) {
      logger.error('[SettingsBackupService] Failed to create backup', {
        error: error.message
      });
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * List all available backups
   * @returns {Promise<Array<{filename: string, path: string, timestamp: string, appVersion: string, size: number}>>}
   */
  async listBackups(options = {}) {
    const { includeParsedTime = false } = options;
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
              _parsedTime: new Date(timestamp).getTime()
            });
          } catch (error) {
            // Skip invalid backup files
            logger.warn(`[SettingsBackupService] Invalid backup file: ${file}`, {
              error: error.message
            });
          }
        }
      }

      // Sort by timestamp (newest first)
      backups.sort((a, b) => b._parsedTime - a._parsedTime);

      if (!includeParsedTime) {
        // Remove internal _parsedTime property
        backups.forEach((backup) => {
          delete backup._parsedTime;
        });
      }

      return backups;
    } catch (error) {
      logger.error('[SettingsBackupService] Failed to list backups', {
        error: error.message
      });
      return [];
    }
  }

  /**
   * Restore settings from a backup file
   * @param {string} backupPath - Path to backup file
   * @param {Function} saveSettings - Function to save restored settings
   * @returns {Promise<{success: boolean, settings?: Object, error?: string, validationErrors?: string[], validationWarnings?: string[]}>}
   */
  async restoreFromBackup(backupPath, saveSettings) {
    try {
      // Validate backup path (path traversal protection)
      this._validateBackupPath(backupPath);

      // Read backup file
      const content = await fs.readFile(backupPath, 'utf8');
      const backupData = JSON.parse(content);

      // Verify JSON structure
      if (!backupData || typeof backupData !== 'object') {
        throw new Error('Invalid backup file: corrupted or invalid JSON structure');
      }

      if (!backupData.settings) {
        throw new Error('Invalid backup file: missing settings object');
      }

      // Verify SHA256 hash if present
      if (backupData.hash) {
        const { hash: storedHash, ...originalData } = backupData;
        // FIX HIGH-22: Use stable JSON stringify for consistent hash verification
        // This ensures key order doesn't affect the hash
        const originalJson = stableStringify(originalData);
        const calculatedHash = crypto
          .createHash('sha256')
          .update(originalJson, 'utf8')
          .digest('hex');

        if (calculatedHash !== storedHash) {
          throw new Error(
            'Backup integrity check failed: SHA256 hash mismatch. ' +
              'The backup file may have been tampered with or corrupted.'
          );
        }

        logger.info('[SettingsBackupService] Backup integrity verified (SHA256 hash match)');
      } else {
        logger.warn(
          '[SettingsBackupService] Restoring from backup without SHA256 verification (old format)'
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

      // Sanitize and merge with defaults
      const sanitized = sanitizeSettings(backupData.settings);
      const merged = { ...this.defaults, ...sanitized };

      // Save restored settings
      await saveSettings(merged);

      return {
        success: true,
        settings: merged,
        validationWarnings: validation.warnings,
        restoredFrom: backupData.timestamp
      };
    } catch (error) {
      logger.error('[SettingsBackupService] Failed to restore from backup', {
        error: error.message
      });
      return {
        success: false,
        error: error.message,
        validationErrors: error.validationErrors,
        validationWarnings: error.validationWarnings
      };
    }
  }

  /**
   * Clean up old backups, keeping only the most recent ones
   */
  async cleanupOldBackups() {
    try {
      const cleanupStart = Date.now();
      const backups = await this.listBackups({ includeParsedTime: true });

      // Filter out backups with unsafe timestamps
      const safeBackups = backups.filter((backup) => {
        if (!Number.isFinite(backup._parsedTime)) {
          logger.warn(
            `[SettingsBackupService] Backup ${backup.filename} has unsafe timestamp. Skipping.`
          );
          return false;
        }
        if (backup._parsedTime > cleanupStart) {
          // Skip backups created after cleanup started to avoid race deletion
          return false;
        }
        return true;
      });

      // Keep only the most recent backups
      if (safeBackups.length > this.maxBackups) {
        const backupsToDelete = safeBackups.slice(this.maxBackups);

        for (const backup of backupsToDelete) {
          try {
            await fs.unlink(backup.path);
            logger.debug(`[SettingsBackupService] Deleted old backup: ${backup.filename}`);
          } catch (error) {
            logger.warn(`[SettingsBackupService] Failed to delete old backup: ${backup.filename}`, {
              error: error.message
            });
          }
        }
      }
    } catch (error) {
      logger.error('[SettingsBackupService] Failed to cleanup old backups', {
        error: error.message
      });
    }
  }

  /**
   * Delete a specific backup
   * @param {string} backupPath - Path to backup file to delete
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  async deleteBackup(backupPath) {
    try {
      // Validate backup path (path traversal protection)
      this._validateBackupPath(backupPath);

      await fs.unlink(backupPath);
      return { success: true };
    } catch (error) {
      logger.error('[SettingsBackupService] Failed to delete backup', {
        error: error.message
      });
      return {
        success: false,
        error: error.message
      };
    }
  }
}

module.exports = { SettingsBackupService };
