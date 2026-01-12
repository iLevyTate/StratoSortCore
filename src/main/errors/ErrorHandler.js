/**
 * Centralized Error Handler
 * Manages all application errors with proper logging and user notification
 */

const { app, dialog, BrowserWindow } = require('electron');
const fs = require('fs').promises;
const path = require('path');
const { ERROR_TYPES } = require('../../shared/constants');
const { logger, sanitizeLogData } = require('../../shared/logger');
const { parseJsonLines } = require('../../shared/safeJsonOps');
const { safeSend } = require('../ipc/ipcWrappers');
const {
  isNotFoundError,
  isPermissionError,
  isNetworkError
} = require('../../shared/errorClassifier');

logger.setContext('ErrorHandler');

/**
 * Extract a compact, user-friendly summary of Electron "process gone" details.
 * @param {any} details
 * @returns {string}
 */
function summarizeProcessGoneDetails(details) {
  if (!details || typeof details !== 'object') return '';

  const parts = [];
  if (details.type) parts.push(`type=${String(details.type)}`);
  if (details.reason) parts.push(`reason=${String(details.reason)}`);
  if (typeof details.exitCode === 'number') parts.push(`exitCode=${details.exitCode}`);
  if (details.serviceName) parts.push(`serviceName=${String(details.serviceName)}`);
  if (details.name) parts.push(`name=${String(details.name)}`);

  return parts.join(', ');
}

/**
 * Normalize unknown error-like values into a consistent log payload.
 * @param {any} err
 * @returns {{ errorText?: string, stack?: string, details?: any }}
 */
function normalizeErrorForLogging(err) {
  if (!err) return {};
  if (err instanceof Error) {
    return { errorText: err.toString(), stack: err.stack };
  }

  // Electron often passes plain objects (e.g., { type, reason, exitCode }) for crash events.
  return { details: err };
}

// NOTE: sanitizeLogData is imported from logger.js to avoid code duplication

class ErrorHandler {
  constructor() {
    // FIX: Defer getting logPath until app is ready
    this.logPath = null;
    this.currentLogFile = null;
    this.errorQueue = [];
    this.isInitialized = false;
  }

  /**
   * Initialize error handler and configure log file location.
   * @param {{ logFilePath?: string }} [options]
   */
  async initialize(options = {}) {
    try {
      // FIX: Set logPath here when app is ready (not in constructor)
      this.logPath = path.join(app.getPath('userData'), 'logs');

      // Create logs directory
      await fs.mkdir(this.logPath, { recursive: true });

      // Set up log file
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      this.currentLogFile =
        options.logFilePath || path.join(this.logPath, `stratosort-${timestamp}.log`);

      // Ensure the shared logger writes to the same log file (single source of truth).
      // Use optional chaining so unit tests can mock logger without full surface area.
      logger?.enableFileLogging?.(this.currentLogFile, { format: 'jsonl' });

      // Set up global error handlers
      this.setupGlobalHandlers();

      this.isInitialized = true;
      await this.log('info', 'ErrorHandler initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize ErrorHandler:', {
        error: error.message,
        stack: error.stack
      });
    }
  }

  setupGlobalHandlers() {
    // NOTE: process.on('uncaughtException') and process.on('unhandledRejection')
    // are handled by lifecycle.js with proper cleanup. Do NOT register them here
    // to avoid duplicate handlers which cause:
    // 1. Double logging of errors
    // 2. Memory leaks from untracked listeners
    // 3. Conflicting error handling logic

    // Handle Electron-specific errors only (these are not in lifecycle.js)
    app.on('render-process-gone', (event, webContents, details) => {
      const summary = summarizeProcessGoneDetails(details);
      const message = summary
        ? `Renderer Process Crashed (${summary})`
        : 'Renderer Process Crashed';

      const urlSafe = (() => {
        try {
          return webContents?.getURL?.();
        } catch {
          return undefined;
        }
      })();

      this.handleCriticalError(message, {
        details,
        webContentsId: webContents?.id,
        url: urlSafe
      });
    });

    app.on('child-process-gone', (event, details) => {
      // Electron can often recover from GPU process restarts. We already log GPU exits in
      // ./core/gpuConfig, so avoid forcing a full app quit for that case.
      if (details?.type === 'GPU') {
        const summary = summarizeProcessGoneDetails(details);
        this.log('warning', summary ? `GPU Process Exited (${summary})` : 'GPU Process Exited', {
          details
        });
        return;
      }

      const summary = summarizeProcessGoneDetails(details);
      const message = summary ? `Child Process Crashed (${summary})` : 'Child Process Crashed';
      this.handleCriticalError(message, { details });
    });
  }

  /**
   * Handle different types of errors
   */
  async handleError(error, context = {}) {
    const errorInfo = this.parseError(error);
    const severity = this.determineSeverity(errorInfo.type);

    // Log the error
    await this.log(severity, errorInfo.message, {
      ...errorInfo,
      context,
      timestamp: new Date().toISOString()
    });

    // Handle based on severity
    switch (severity) {
      case 'critical':
        await this.handleCriticalError(errorInfo.message, error);
        break;
      case 'error':
        await this.notifyUser(errorInfo.message, 'error');
        break;
      case 'warning':
        await this.notifyUser(errorInfo.message, 'warning');
        break;
      default:
        // Info level errors are just logged
        break;
    }

    return errorInfo;
  }

  /**
   * Parse error to extract useful information with user-friendly messages
   */
  parseError(error) {
    const errorInfo = {
      type: ERROR_TYPES.UNKNOWN,
      message: 'Something went wrong. Please try again.',
      details: {},
      stack: error?.stack
    };

    if (error instanceof Error) {
      // Determine error type and provide actionable messages
      // Note: AI/Ollama check comes before network check because Ollama connection
      // errors should be classified as AI_UNAVAILABLE, not NETWORK_ERROR
      if (isNotFoundError(error)) {
        errorInfo.type = ERROR_TYPES.FILE_NOT_FOUND;
        errorInfo.message = 'Could not find the file or folder. It may have been moved or deleted.';
      } else if (isPermissionError(error)) {
        errorInfo.type = ERROR_TYPES.PERMISSION_DENIED;
        errorInfo.message =
          'Access denied. Check that you have permission to access this location.';
      } else if (error.message.includes('AI') || error.message.includes('Ollama')) {
        errorInfo.type = ERROR_TYPES.AI_UNAVAILABLE;
        // Provide specific guidance based on the error
        if (error.message.includes('ECONNREFUSED') || error.message.includes('connection')) {
          errorInfo.message =
            'Cannot connect to Ollama. Make sure Ollama is running (ollama serve).';
        } else if (error.message.includes('model')) {
          errorInfo.message =
            'AI model not available. Check Settings to ensure your model is installed.';
        } else {
          errorInfo.message =
            'AI service unavailable. Check that Ollama is running and configured in Settings.';
        }
      } else if (isNetworkError(error)) {
        errorInfo.type = ERROR_TYPES.NETWORK_ERROR;
        if (error.message.includes('timeout')) {
          errorInfo.message =
            'Request timed out. The AI model may be loading or your system is busy.';
        } else {
          errorInfo.message = 'Connection issue. Check your network and Ollama status.';
        }
      } else {
        // Keep original message if it's user-friendly, otherwise provide generic
        const msg = error.message || '';
        // Check if message is already user-friendly (contains actionable language)
        if (msg.length < 100 && !msg.includes('undefined') && !msg.includes('null')) {
          errorInfo.message = msg;
        }
      }
      errorInfo.details = { originalMessage: error.message };
    }

    return errorInfo;
  }

  /**
   * Determine error severity
   */
  determineSeverity(errorType) {
    switch (errorType) {
      case ERROR_TYPES.PERMISSION_DENIED:
      case ERROR_TYPES.UNKNOWN:
        return 'critical';
      case ERROR_TYPES.FILE_NOT_FOUND:
      case ERROR_TYPES.AI_UNAVAILABLE:
        return 'error';
      case ERROR_TYPES.INVALID_FORMAT:
      case ERROR_TYPES.FILE_TOO_LARGE:
        return 'warning';
      default:
        return 'info';
    }
  }

  /**
   * Handle critical errors that may crash the app
   */
  async handleCriticalError(message, error) {
    const normalized = normalizeErrorForLogging(error);
    logger.error('[CRITICAL ERROR]', {
      message,
      ...normalized
    });

    // Show error dialog
    const response = await dialog.showMessageBox({
      type: 'error',
      title: 'Critical Error',
      message: 'Stratosort encountered a critical error',
      detail: `${message}\n\nWould you like to restart the application?`,
      buttons: ['Restart', 'Quit'],
      defaultId: 0
    });

    if (response.response === 0) {
      app.relaunch();
    }
    app.quit();
  }

  /**
   * Notify user of errors
   */
  async notifyUser(message, type = 'error') {
    const mainWindow = BrowserWindow.getFocusedWindow();

    if (mainWindow && !mainWindow.isDestroyed()) {
      // Send to renderer process with validated payload
      safeSend(mainWindow.webContents, 'app:error', {
        message,
        type,
        timestamp: new Date().toISOString()
      });
    } else {
      // Fallback to dialog
      await dialog.showMessageBox({
        type,
        title: type.charAt(0).toUpperCase() + type.slice(1),
        message,
        buttons: ['OK']
      });
    }
  }

  /**
   * Log messages to file
   * Sanitizes sensitive data (file paths) in production mode
   */
  async log(level, message, data = {}) {
    // Sanitize data to remove sensitive information in production
    const sanitizedData = sanitizeLogData(data);
    const sanitizedMessage = sanitizeLogData(message);

    // Route everything through the shared logger (it handles console + JSONL file output).
    // We keep this method async for backwards compatibility with existing call sites.
    try {
      logger.log(level, sanitizedMessage, sanitizedData);
    } catch (e) {
      // Avoid recursive failures; best-effort only.
      void e;
    }
  }

  /**
   * Get recent errors for debugging
   */
  async getRecentErrors(count = 50) {
    try {
      const logContent = await fs.readFile(this.currentLogFile, 'utf-8');
      const entries = parseJsonLines(logContent);
      const errors = entries
        .slice(-count)
        .filter((entry) => ['ERROR', 'CRITICAL'].includes(entry.level));

      return errors;
    } catch (error) {
      logger.error('Failed to read error log:', { error: error.message });
      return [];
    }
  }

  /**
   * Clean up old log files
   */
  async cleanupLogs(daysToKeep = 7) {
    try {
      // FIX: Use sync operations to avoid async issues during startup
      const fsSync = require('fs');
      const files = fsSync.readdirSync(this.logPath);
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

      for (const file of files) {
        if (file.startsWith('stratosort-') && file.endsWith('.log')) {
          const filePath = path.join(this.logPath, file);
          const stats = fsSync.statSync(filePath);

          if (stats.mtime < cutoffDate) {
            fsSync.unlinkSync(filePath);
            await this.log('info', `Cleaned up old log file: ${file}`);
          }
        }
      }
    } catch (error) {
      logger.error('Failed to cleanup logs:', { error: error.message });
    }
  }
}

// Export singleton instance
module.exports = new ErrorHandler();
