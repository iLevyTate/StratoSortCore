/**
 * Centralized Error Handler
 * Manages all application errors with proper logging and user notification
 */

const { app, dialog, BrowserWindow } = require('electron');
const fs = require('fs').promises;
const path = require('path');
const { ERROR_TYPES } = require('../../shared/constants');
const { logger } = require('../../shared/logger');
logger.setContext('ErrorHandler');

/**
 * Sanitize sensitive data from log messages
 * Redacts full file paths to just filenames in production
 * @param {string|object} data - Data to sanitize
 * @returns {string|object} Sanitized data
 */
function sanitizeLogData(data) {
  // Skip sanitization in development mode
  if (process.env.NODE_ENV === 'development') {
    return data;
  }

  if (typeof data === 'string') {
    // Replace Windows absolute paths with just the filename
    // Matches: C:\path\to\file.txt, D:\folder\subfolder\file.txt
    let sanitized = data.replace(
      /[A-Za-z]:\\(?:[^\\/:*?"<>|\r\n]+\\)*([^\\/:*?"<>|\r\n]+)/g,
      (match, filename) => `[REDACTED_PATH]\\${filename}`
    );

    // Replace Unix absolute paths with just the filename
    // Matches: /path/to/file.txt, /home/user/documents/file.txt
    sanitized = sanitized.replace(
      /\/(?:[^/\s]+\/)+([^/\s]+)/g,
      (match, filename) => `[REDACTED_PATH]/${filename}`
    );

    return sanitized;
  }

  if (typeof data === 'object' && data !== null) {
    // Recursively sanitize objects
    const sanitized = Array.isArray(data) ? [] : {};
    for (const [key, value] of Object.entries(data)) {
      // Special handling for known path fields
      if (
        (key === 'path' || key === 'filePath' || key === 'source' || key === 'destination') &&
        typeof value === 'string'
      ) {
        // For path fields, just keep the filename
        sanitized[key] = path.basename(value);
      } else if (key === 'stack' && typeof value === 'string') {
        // For stack traces, sanitize paths within them
        sanitized[key] = sanitizeLogData(value);
      } else if (typeof value === 'object' && value !== null) {
        sanitized[key] = sanitizeLogData(value);
      } else if (typeof value === 'string') {
        sanitized[key] = sanitizeLogData(value);
      } else {
        sanitized[key] = value;
      }
    }
    return sanitized;
  }

  return data;
}

class ErrorHandler {
  constructor() {
    this.logPath = path.join(app.getPath('userData'), 'logs');
    this.currentLogFile = null;
    this.errorQueue = [];
    this.isInitialized = false;
  }

  async initialize() {
    try {
      // Create logs directory
      await fs.mkdir(this.logPath, { recursive: true });

      // Set up log file
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      this.currentLogFile = path.join(this.logPath, `stratosort-${timestamp}.log`);

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
    // Handle uncaught exceptions
    process.on('uncaughtException', (error) => {
      this.handleCriticalError('Uncaught Exception', error);
    });

    // Handle unhandled promise rejections
    process.on('unhandledRejection', (reason) => {
      this.handleCriticalError('Unhandled Promise Rejection', reason);
    });

    // Handle Electron errors
    app.on('render-process-gone', (event, webContents, details) => {
      this.handleCriticalError('Renderer Process Crashed', details);
    });

    app.on('child-process-gone', (event, details) => {
      this.handleCriticalError('Child Process Crashed', details);
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
   * Parse error to extract useful information
   */
  parseError(error) {
    const errorInfo = {
      type: ERROR_TYPES.UNKNOWN,
      message: 'An unexpected error occurred',
      details: {},
      stack: error?.stack
    };

    if (error instanceof Error) {
      errorInfo.message = error.message;

      // Determine error type
      if (error.code === 'ENOENT') {
        errorInfo.type = ERROR_TYPES.FILE_NOT_FOUND;
        errorInfo.message = 'File or directory not found';
      } else if (error.code === 'EACCES' || error.code === 'EPERM') {
        errorInfo.type = ERROR_TYPES.PERMISSION_DENIED;
        errorInfo.message = 'Permission denied';
      } else if (error.message.includes('network') || error.code === 'ENOTFOUND') {
        errorInfo.type = ERROR_TYPES.NETWORK_ERROR;
        errorInfo.message = 'Network connection error';
      } else if (error.message.includes('AI') || error.message.includes('Ollama')) {
        errorInfo.type = ERROR_TYPES.AI_UNAVAILABLE;
        errorInfo.message = 'AI service is unavailable';
      }
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
    logger.error('[CRITICAL ERROR]', {
      message,
      error: error?.toString(),
      stack: error?.stack
    });

    // Log to file
    await this.log('critical', message, {
      error: error?.toString(),
      stack: error?.stack
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
      // Send to renderer process
      mainWindow.webContents.send('app:error', {
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

    if (!this.isInitialized) {
      logger.log(level, `[${level.toUpperCase()}] ${sanitizedMessage}`, sanitizedData);
      return;
    }

    const logEntry = {
      timestamp: new Date().toISOString(),
      level: level.toUpperCase(),
      message: sanitizedMessage,
      data: sanitizedData
    };

    try {
      const logLine = `${JSON.stringify(logEntry)}\n`;
      await fs.appendFile(this.currentLogFile, logLine);
    } catch (error) {
      logger.error('Failed to write to log file:', { error: error.message });
    }
  }

  /**
   * Get recent errors for debugging
   */
  async getRecentErrors(count = 50) {
    try {
      const logContent = await fs.readFile(this.currentLogFile, 'utf-8');
      const lines = logContent.trim().split('\n');
      const errors = lines
        .slice(-count)
        .map((line) => {
          try {
            return JSON.parse(line);
          } catch {
            return null;
          }
        })
        .filter((entry) => entry && ['ERROR', 'CRITICAL'].includes(entry.level));

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
      const files = await fs.readdir(this.logPath);
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

      for (const file of files) {
        if (file.startsWith('stratosort-') && file.endsWith('.log')) {
          const filePath = path.join(this.logPath, file);
          const stats = await fs.stat(filePath);

          if (stats.mtime < cutoffDate) {
            await fs.unlink(filePath);
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
