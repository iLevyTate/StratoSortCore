/**
 * Unified Notification Types and Schema
 *
 * This module provides a single source of truth for notification structures
 * used across main process, renderer process, and IPC communication.
 *
 * @module shared/notificationTypes
 */

/**
 * Notification types for categorization
 */
const NotificationType = {
  FILE_ORGANIZED: 'file_organized',
  FILE_ANALYZED: 'file_analyzed',
  LOW_CONFIDENCE: 'low_confidence',
  WATCHER_ERROR: 'watcher_error',
  BATCH_COMPLETE: 'batch_complete',
  OPERATION_COMPLETE: 'operation_complete',
  OPERATION_ERROR: 'operation_error',
  SYSTEM: 'system'
};

/**
 * Notification severity levels
 */
const NotificationSeverity = {
  INFO: 'info',
  SUCCESS: 'success',
  WARNING: 'warning',
  ERROR: 'error'
};

/**
 * Notification status for tracking lifecycle
 */
const NotificationStatus = {
  PENDING: 'pending',
  DISPLAYED: 'displayed',
  SEEN: 'seen',
  DISMISSED: 'dismissed'
};

/**
 * Standardized durations by severity (in milliseconds)
 */
const NOTIFICATION_DURATIONS = {
  [NotificationSeverity.INFO]: 2500,
  [NotificationSeverity.SUCCESS]: 3000,
  [NotificationSeverity.WARNING]: 4000,
  [NotificationSeverity.ERROR]: 5000,
  critical: 0 // Persist until dismissed
};

/**
 * Get standard duration for a severity level
 * @param {string} severity - Notification severity
 * @returns {number} Duration in milliseconds
 */
function getDefaultDuration(severity) {
  return NOTIFICATION_DURATIONS[severity] || NOTIFICATION_DURATIONS[NotificationSeverity.INFO];
}

/**
 * Normalize notification data to unified schema
 * Handles legacy format conversion (variant -> severity, title -> message)
 *
 * @param {Object} notification - Raw notification data
 * @param {Object} options - Additional options
 * @param {string} options.source - Source of notification ('main', 'renderer', 'watcher')
 * @returns {Object} Normalized notification object
 */
function normalizeNotification(notification, options = {}) {
  const { source = 'main' } = options;

  // Handle both legacy (variant) and new (severity) field names
  const severity = notification.severity || notification.variant || NotificationSeverity.INFO;

  // Handle both message and title fields
  const message = notification.message || notification.title || 'Notification';

  // Use provided duration or get default for severity
  const duration =
    typeof notification.duration === 'number'
      ? notification.duration
      : getDefaultDuration(severity);

  return {
    // Preserve ID if provided, otherwise will be set by recipient
    id: notification.id || null,
    type: notification.type || NotificationType.SYSTEM,
    title: notification.title || null,
    message,
    severity,
    duration,
    timestamp: notification.timestamp || new Date().toISOString(),
    source,
    data: notification.data || null,
    status: notification.status || NotificationStatus.PENDING,
    seenAt: notification.seenAt || null,
    dismissedAt: notification.dismissedAt || null
  };
}

/**
 * Create a notification object with required fields
 *
 * @param {Object} params - Notification parameters
 * @param {string} params.type - Notification type
 * @param {string} params.message - Notification message
 * @param {string} [params.severity='info'] - Notification severity
 * @param {number} [params.duration] - Auto-dismiss duration (ms)
 * @param {Object} [params.data] - Additional context data
 * @returns {Object} Notification object
 */
function createNotification({
  type = NotificationType.SYSTEM,
  message,
  title = null,
  severity = NotificationSeverity.INFO,
  duration = null,
  data = null,
  source = 'main'
}) {
  return {
    id: null, // Will be set by NotificationService
    type,
    title,
    message,
    severity,
    duration: duration !== null ? duration : getDefaultDuration(severity),
    timestamp: new Date().toISOString(),
    source,
    data,
    status: NotificationStatus.PENDING,
    seenAt: null,
    dismissedAt: null
  };
}

// Export both CommonJS and ES6 style
const exports_object = {
  NotificationType,
  NotificationSeverity,
  NotificationStatus,
  NOTIFICATION_DURATIONS,
  getDefaultDuration,
  normalizeNotification,
  createNotification
};

module.exports = exports_object;
