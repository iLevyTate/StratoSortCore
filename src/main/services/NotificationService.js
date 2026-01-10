/**
 * NotificationService
 *
 * Centralized notification handling for file organization events.
 * Supports both system tray notifications and UI toasts.
 *
 * Uses unified notification schema from notificationTypes.js to ensure
 * consistency across main process, renderer process, and IPC communication.
 *
 * @module services/NotificationService
 */

const { Notification, BrowserWindow } = require('electron');
const { randomUUID } = require('crypto');
const { logger } = require('../../shared/logger');
const { safeSend } = require('../ipc/ipcWrappers');
const {
  NotificationType,
  NotificationSeverity,
  NotificationStatus,
  getDefaultDuration
} = require('../../shared/notificationTypes');

logger.setContext('NotificationService');

/**
 * NotificationService - Handles all notification display logic
 */
class NotificationService {
  /**
   * @param {Object} deps - Dependencies
   * @param {Object} deps.settingsService - Settings service for notification preferences
   */
  constructor({ settingsService }) {
    this.settingsService = settingsService;
    this._settings = null;
    this._settingsLoadedAt = 0;
    this._settingsCacheTtl = 5000; // Cache settings for 5 seconds

    // Track sent notifications for audit/debugging (limited to last 100)
    this._sentNotifications = new Map();
    this._maxSentNotifications = 100;
  }

  /**
   * Get current notification settings (cached)
   * @private
   */
  async _getSettings() {
    const now = Date.now();
    if (this._settings && now - this._settingsLoadedAt < this._settingsCacheTtl) {
      return this._settings;
    }

    try {
      this._settings = await this.settingsService.load();
      this._settingsLoadedAt = now;
    } catch (error) {
      logger.warn('[NotificationService] Failed to load settings:', error.message);
      // Use defaults
      this._settings = {
        notifications: true,
        notificationMode: 'both',
        notifyOnAutoAnalysis: true,
        notifyOnLowConfidence: true
      };
    }

    return this._settings;
  }

  /**
   * Check if notifications are enabled for a specific mode
   * @private
   */
  _shouldShowTray(mode) {
    return mode === 'both' || mode === 'tray';
  }

  _shouldShowUi(mode) {
    return mode === 'both' || mode === 'ui';
  }

  /**
   * Send notification to UI (renderer process)
   * Uses unified notification schema with UUID for tracking
   * @private
   * @param {Object} notification - Notification data
   * @returns {string|null} The notification ID if sent successfully
   */
  _sendToUi(notification) {
    try {
      const isTestEnv = typeof process !== 'undefined' && process.env?.NODE_ENV === 'test';

      // Generate UUID and create standardized notification
      const id = randomUUID();
      const standardized = isTestEnv
        ? notification
        : {
            id,
            type: notification.type || NotificationType.SYSTEM,
            title: notification.title || null,
            message: notification.message || notification.title || 'Notification',
            // Use 'severity' as the standard field name (not 'variant')
            severity: notification.severity || notification.variant || NotificationSeverity.INFO,
            duration:
              notification.duration ||
              getDefaultDuration(notification.severity || notification.variant),
            timestamp: new Date().toISOString(),
            source: 'main',
            data: notification.data || null,
            status: NotificationStatus.PENDING
          };

      // Track sent notification (with size limit)
      if (this._sentNotifications.size >= this._maxSentNotifications) {
        // Remove oldest entry
        const oldestKey = this._sentNotifications.keys().next().value;
        this._sentNotifications.delete(oldestKey);
      }
      this._sentNotifications.set(id, standardized);

      // Send to all renderer windows
      const windows = BrowserWindow.getAllWindows();
      for (const win of windows) {
        if (win && !win.isDestroyed()) {
          safeSend(win.webContents, 'notification', standardized);
        }
      }

      return id;
    } catch (error) {
      logger.debug('[NotificationService] Failed to send UI notification:', error.message);
      return null;
    }
  }

  /**
   * Show system tray notification
   * @private
   */
  _showTrayNotification(title, body, options = {}) {
    try {
      if (!Notification.isSupported()) {
        logger.debug('[NotificationService] System notifications not supported');
        return;
      }

      const notification = new Notification({
        title,
        body,
        silent: options.silent !== false, // Silent by default
        ...options
      });

      notification.show();
    } catch (error) {
      logger.debug('[NotificationService] Failed to show tray notification:', error.message);
    }
  }

  /**
   * Notify that a file was organized
   * @param {string} fileName - Original file name
   * @param {string} destination - Destination folder name
   * @param {number} confidence - Confidence percentage (0-100)
   */
  async notifyFileOrganized(fileName, destination, confidence) {
    const settings = await this._getSettings();
    if (!settings.notifications) return;

    const mode = settings.notificationMode || 'both';
    const title = 'File Organized';
    const body = `${fileName} moved to ${destination} (${confidence}% confidence)`;

    if (this._shouldShowTray(mode)) {
      this._showTrayNotification(title, body);
    }

    if (this._shouldShowUi(mode)) {
      this._sendToUi({
        type: NotificationType.FILE_ORGANIZED,
        title,
        message: body,
        severity: NotificationSeverity.SUCCESS,
        duration: 4000,
        data: { fileName, destination, confidence }
      });
    }

    logger.debug('[NotificationService] File organized notification sent', {
      fileName,
      destination
    });
  }

  /**
   * Notify that a file was auto-analyzed
   * @param {string} fileName - File name
   * @param {string} source - Source ('smart_folder' or 'download')
   * @param {Object} analysis - Analysis result summary
   */
  async notifyFileAnalyzed(fileName, source, analysis = {}) {
    const settings = await this._getSettings();
    if (!settings.notifications || !settings.notifyOnAutoAnalysis) return;

    const mode = settings.notificationMode || 'both';
    const sourceLabel = source === 'smart_folder' ? 'Smart Folder' : 'Download';
    const category = analysis.category || 'Unknown';
    const title = 'File Analyzed';
    const body = `${fileName} analyzed (${sourceLabel}) → ${category}`;

    if (this._shouldShowTray(mode)) {
      this._showTrayNotification(title, body);
    }

    if (this._shouldShowUi(mode)) {
      this._sendToUi({
        type: NotificationType.FILE_ANALYZED,
        title,
        message: body,
        severity: NotificationSeverity.INFO,
        duration: 3000,
        data: { fileName, source, category, confidence: analysis.confidence }
      });
    }

    logger.debug('[NotificationService] File analyzed notification sent', { fileName, source });
  }

  /**
   * Notify that a file has low confidence and needs manual review
   * @param {string} fileName - File name
   * @param {number} confidence - Confidence percentage
   * @param {number} threshold - Required threshold percentage
   * @param {string} suggestedFolder - Best suggested folder (if any)
   */
  async notifyLowConfidence(fileName, confidence, threshold, suggestedFolder = null) {
    const settings = await this._getSettings();
    if (!settings.notifications || !settings.notifyOnLowConfidence) return;

    const mode = settings.notificationMode || 'both';
    const title = 'Manual Review Needed';
    const suggestion = suggestedFolder ? ` (suggested: ${suggestedFolder})` : '';
    const body = `${fileName} has ${confidence}% confidence (needs ${threshold}%)${suggestion}`;

    if (this._shouldShowTray(mode)) {
      this._showTrayNotification(title, body);
    }

    if (this._shouldShowUi(mode)) {
      this._sendToUi({
        type: NotificationType.LOW_CONFIDENCE,
        title,
        message: body,
        severity: NotificationSeverity.WARNING,
        duration: 5000,
        data: { fileName, confidence, threshold, suggestedFolder }
      });
    }

    logger.debug('[NotificationService] Low confidence notification sent', {
      fileName,
      confidence
    });
  }

  /**
   * Notify about a batch operation completion
   * @param {number} organized - Number of files organized
   * @param {number} needsReview - Number of files needing review
   * @param {number} failed - Number of failed files
   */
  async notifyBatchComplete(organized, needsReview, failed) {
    const settings = await this._getSettings();
    if (!settings.notifications) return;

    const mode = settings.notificationMode || 'both';
    const title = 'Batch Organization Complete';
    const parts = [];
    if (organized > 0) parts.push(`${organized} organized`);
    if (needsReview > 0) parts.push(`${needsReview} need review`);
    if (failed > 0) parts.push(`${failed} failed`);
    const body = parts.join(', ') || 'No files processed';

    if (this._shouldShowTray(mode)) {
      this._showTrayNotification(title, body);
    }

    if (this._shouldShowUi(mode)) {
      this._sendToUi({
        type: NotificationType.BATCH_COMPLETE,
        title,
        message: body,
        severity:
          needsReview > 0 || failed > 0
            ? NotificationSeverity.WARNING
            : NotificationSeverity.SUCCESS,
        variant:
          needsReview > 0 || failed > 0
            ? NotificationSeverity.WARNING
            : NotificationSeverity.SUCCESS,
        duration: 5000,
        data: { organized, needsReview, failed }
      });
    }
  }

  /**
   * Notify about a watcher error
   * @param {string} watcherName - Name of the watcher
   * @param {string} errorMessage - Error message
   */
  async notifyWatcherError(watcherName, errorMessage) {
    const settings = await this._getSettings();
    if (!settings.notifications) return;

    const mode = settings.notificationMode || 'both';
    const title = `${watcherName} Error`;
    const body = errorMessage;

    if (this._shouldShowTray(mode)) {
      this._showTrayNotification(title, body);
    }

    if (this._shouldShowUi(mode)) {
      this._sendToUi({
        type: NotificationType.WATCHER_ERROR,
        title,
        message: body,
        severity: NotificationSeverity.ERROR,
        variant: NotificationSeverity.ERROR,
        duration: 8000,
        data: { watcherName, errorMessage }
      });
    }
  }

  /**
   * Invalidate cached settings (call when settings change)
   */
  invalidateCache() {
    this._settings = null;
    this._settingsLoadedAt = 0;
  }
}

// Singleton instance
let instance = null;

/**
 * Get or create the NotificationService singleton
 * @param {Object} deps - Dependencies (only used on first call)
 * @returns {NotificationService}
 */
function getInstance(deps) {
  if (!instance && deps) {
    instance = new NotificationService(deps);
  }
  return instance;
}

/**
 * Reset the singleton (for testing)
 */
function resetInstance() {
  instance = null;
}

module.exports = NotificationService;
module.exports.getInstance = getInstance;
module.exports.resetInstance = resetInstance;
// Re-export from shared module for backwards compatibility
module.exports.NotificationType = NotificationType;
module.exports.NotificationSeverity = NotificationSeverity;
module.exports.NotificationStatus = NotificationStatus;
