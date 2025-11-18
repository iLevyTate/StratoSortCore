/**
 * Application-wide logger module for consistent logging
 * Provides structured logging with different levels and context
 */

const { app } = require('electron');
const fs = require('fs');
const path = require('path');
const util = require('util');

// Log levels
const LogLevel = {
  ERROR: 'ERROR',
  WARN: 'WARN',
  INFO: 'INFO',
  DEBUG: 'DEBUG',
  TRACE: 'TRACE',
};

// Log level priorities
const LOG_PRIORITY = {
  ERROR: 0,
  WARN: 1,
  INFO: 2,
  DEBUG: 3,
  TRACE: 4,
};

class AppLogger {
  constructor() {
    this.logLevel = process.env.LOG_LEVEL || 'INFO';
    this.logToFile = process.env.LOG_TO_FILE === 'true';
    this.logFilePath = null;

    if (this.logToFile && app) {
      const logsDir = path.join(app.getPath('userData'), 'logs');
      if (!fs.existsSync(logsDir)) {
        fs.mkdirSync(logsDir, { recursive: true });
      }
      const timestamp = new Date()
        .toISOString()
        .replace(/:/g, '-')
        .split('.')[0];
      this.logFilePath = path.join(logsDir, `app-${timestamp}.log`);
    }
  }

  /**
   * Check if a log level should be logged based on current settings
   * @param {string} level - Log level to check
   * @returns {boolean} Whether to log this level
   */
  shouldLog(level) {
    return LOG_PRIORITY[level] <= LOG_PRIORITY[this.logLevel];
  }

  /**
   * Format log message with timestamp and context
   * @param {string} level - Log level
   * @param {string} context - Context/module name
   * @param {string} message - Log message
   * @param {any} data - Additional data to log
   * @returns {string} Formatted log message
   */
  formatMessage(level, context, message, data) {
    const timestamp = new Date().toISOString();
    let logMessage = `[${timestamp}] [${level}] [${context}] ${message}`;

    if (data !== undefined) {
      if (typeof data === 'object') {
        logMessage += ` ${util.inspect(data, { depth: 3, colors: false })}`;
      } else {
        logMessage += ` ${data}`;
      }
    }

    return logMessage;
  }

  /**
   * Write log message to console and optionally to file
   * @param {string} level - Log level
   * @param {string} context - Context/module name
   * @param {string} message - Log message
   * @param {any} data - Additional data
   */
  log(level, context, message, data) {
    if (!this.shouldLog(level)) return;

    const formattedMessage = this.formatMessage(level, context, message, data);

    // Console output with colors in development
    if (process.env.NODE_ENV !== 'production') {
      const coloredOutput = this.getColoredOutput(level, formattedMessage);
      if (level === LogLevel.ERROR) {
        console.error(coloredOutput);
      } else if (level === LogLevel.WARN) {
        console.warn(coloredOutput);
      } else {
        console.log(coloredOutput);
      }
    } else {
      // Plain output in production
      if (level === LogLevel.ERROR) {
        console.error(formattedMessage);
      } else if (level === LogLevel.WARN) {
        console.warn(formattedMessage);
      } else {
        console.log(formattedMessage);
      }
    }

    // File logging
    if (this.logToFile && this.logFilePath) {
      fs.appendFile(this.logFilePath, formattedMessage + '\n', (err) => {
        if (err) {
          console.error('Failed to write to log file:', err);
        }
      });
    }
  }

  /**
   * Get colored output for console in development
   * @param {string} level - Log level
   * @param {string} message - Log message
   * @returns {string} Colored message
   */
  getColoredOutput(level, message) {
    const colors = {
      ERROR: '\x1b[31m', // Red
      WARN: '\x1b[33m', // Yellow
      INFO: '\x1b[36m', // Cyan
      DEBUG: '\x1b[90m', // Gray
      TRACE: '\x1b[37m', // White
    };
    const reset = '\x1b[0m';
    return `${colors[level] || ''}${message}${reset}`;
  }

  /**
   * Log error message
   * @param {string} context - Context/module name
   * @param {string} message - Error message
   * @param {any} error - Error object or additional data
   */
  error(context, message, error) {
    this.log(LogLevel.ERROR, context, message, error);
  }

  /**
   * Log warning message
   * @param {string} context - Context/module name
   * @param {string} message - Warning message
   * @param {any} data - Additional data
   */
  warn(context, message, data) {
    this.log(LogLevel.WARN, context, message, data);
  }

  /**
   * Log info message
   * @param {string} context - Context/module name
   * @param {string} message - Info message
   * @param {any} data - Additional data
   */
  info(context, message, data) {
    this.log(LogLevel.INFO, context, message, data);
  }

  /**
   * Log debug message
   * @param {string} context - Context/module name
   * @param {string} message - Debug message
   * @param {any} data - Additional data
   */
  debug(context, message, data) {
    this.log(LogLevel.DEBUG, context, message, data);
  }

  /**
   * Log trace message
   * @param {string} context - Context/module name
   * @param {string} message - Trace message
   * @param {any} data - Additional data
   */
  trace(context, message, data) {
    this.log(LogLevel.TRACE, context, message, data);
  }

  /**
   * Create a logger instance for a specific context
   * @param {string} context - Context/module name
   * @returns {object} Logger instance with bound context
   */
  createLogger(context) {
    return {
      error: (message, error) => this.error(context, message, error),
      warn: (message, data) => this.warn(context, message, data),
      info: (message, data) => this.info(context, message, data),
      debug: (message, data) => this.debug(context, message, data),
      trace: (message, data) => this.trace(context, message, data),
    };
  }

  /**
   * Set the log level
   * @param {string} level - New log level
   */
  setLogLevel(level) {
    if (Object.prototype.hasOwnProperty.call(LOG_PRIORITY, level)) {
      this.logLevel = level;
    }
  }

  /**
   * Enable or disable file logging
   * @param {boolean} enable - Whether to enable file logging
   */
  setFileLogging(enable) {
    this.logToFile = enable;
  }
}

// Create singleton instance
const appLogger = new AppLogger();

module.exports = appLogger;
module.exports.LogLevel = LogLevel;
