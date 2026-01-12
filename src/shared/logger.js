/**
 * Unified Logging System for StratoSort
 * Provides structured logging across main and renderer processes
 */

const LOG_LEVELS = {
  ERROR: 0,
  WARN: 1,
  INFO: 2,
  DEBUG: 3,
  TRACE: 4
};

const LOG_LEVEL_NAMES = ['ERROR', 'WARN', 'INFO', 'DEBUG', 'TRACE'];
const { getCorrelationId } = require('./correlationId');

/**
 * Best-effort redaction for production logs.
 * We keep this lightweight and dependency-free since it runs in both main/renderer.
 * @param {string|object} data
 * @returns {string|object}
 */
function sanitizeLogData(data) {
  // Skip sanitization in development mode
  if (typeof process !== 'undefined' && process.env?.NODE_ENV === 'development') {
    return data;
  }

  // Strings: redact common absolute path patterns
  if (typeof data === 'string') {
    let sanitized = data.replace(
      /[A-Za-z]:\\(?:[^\\/:*?"<>|\r\n]+\\)*([^\\/:*?"<>|\r\n]+)/g,
      (_match, filename) => `[REDACTED_PATH]\\${filename}`
    );
    sanitized = sanitized.replace(
      /\/(?:[^/\s]+\/)+([^/\s]+)/g,
      (_match, filename) => `[REDACTED_PATH]/${filename}`
    );
    return sanitized;
  }

  if (typeof data === 'object' && data !== null) {
    const sanitized = Array.isArray(data) ? [] : {};
    for (const [key, value] of Object.entries(data)) {
      // Special handling for common path-ish keys
      if (
        (key === 'path' || key === 'filePath' || key === 'source' || key === 'destination') &&
        typeof value === 'string'
      ) {
        // Keep only trailing segment (works for both Win/Unix)
        const parts = value.split(/[/\\]/);
        sanitized[key] = parts[parts.length - 1] || value;
      } else if (key === 'stack' && typeof value === 'string') {
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

class Logger {
  constructor() {
    this.level = LOG_LEVELS.INFO; // Default log level
    this.enableConsole = true;
    this.enableFile = false;
    this.logFile = null;
    this.context = '';
    this.fileFormat = 'jsonl'; // 'jsonl' | 'text'
    this._fileWriteFailed = false;
    this.MAX_LOG_FILE_SIZE = 50 * 1024 * 1024; // 50MB
    this.MAX_ROTATED_FILES = 3;
    this._isRotating = false;
  }

  /**
   * Check if log rotation is needed and perform it
   * @private
   */
  async rotateLogIfNeeded() {
    if (!this.logFile || this._isRotating || this._fileWriteFailed) return;

    try {
      const fs = require('fs');
      // Use sync stat to avoid race conditions during rapid logging
      const stats = fs.statSync(this.logFile);

      if (stats.size > this.MAX_LOG_FILE_SIZE) {
        this._isRotating = true;
        await this.rotateLog();
      }
    } catch (error) {
      if (error.code !== 'ENOENT') {
        // If file doesn't exist, no need to rotate. Other errors are warnings.
        if (this.enableConsole) {
          // Use console directly to avoid recursion
          console.warn(`[Logger] Failed to check log size: ${error.message}`);
        }
      }
    } finally {
      this._isRotating = false;
    }
  }

  /**
   * Rotate log files (log.log -> log.1.log -> log.2.log ...)
   * @private
   */
  async rotateLog() {
    try {
      const fs = require('fs').promises;

      // Delete the oldest rotated file if it exists
      const oldestFile = `${this.logFile}.${this.MAX_ROTATED_FILES}`;
      try {
        await fs.unlink(oldestFile);
      } catch (e) {
        // Ignore if doesn't exist
      }

      // Rename existing rotated files (3->4, 2->3, 1->2)
      for (let i = this.MAX_ROTATED_FILES - 1; i >= 1; i--) {
        const current = `${this.logFile}.${i}`;
        const next = `${this.logFile}.${i + 1}`;
        try {
          await fs.rename(current, next);
        } catch (e) {
          // Ignore if doesn't exist
        }
      }

      // Rename current log file to .1
      try {
        await fs.rename(this.logFile, `${this.logFile}.1`);
      } catch (e) {
        // If rename fails, we might just continue appending to big file
        // or it might be locked.
        if (this.enableConsole) {
          console.warn(`[Logger] Failed to rotate current log file: ${e.message}`);
        }
      }
    } catch (error) {
      if (this.enableConsole) {
        console.error(`[Logger] Log rotation failed: ${error.message}`);
      }
    }
  }

  setLevel(level) {
    if (typeof level === 'string') {
      this.level = LOG_LEVELS[level.toUpperCase()] ?? LOG_LEVELS.INFO;
    } else {
      this.level = level;
    }
  }

  setContext(context) {
    this.context = context;
  }

  enableFileLogging(logFile, options = {}) {
    this.enableFile = true;
    this.logFile = logFile;
    this.fileFormat = options.format === 'text' ? 'text' : 'jsonl';
    this._fileWriteFailed = false;
  }

  disableConsoleLogging() {
    this.enableConsole = false;
  }

  /**
   * Normalize a level to the numeric LOG_LEVELS form.
   * Accepts numbers or common strings ("error", "warn", "critical", etc).
   * @private
   */
  normalizeLevel(level) {
    if (typeof level === 'number') return level;
    if (typeof level !== 'string') return LOG_LEVELS.INFO;

    const key = level.toUpperCase();
    if (key === 'CRITICAL') return LOG_LEVELS.ERROR;
    if (key === 'WARNING') return LOG_LEVELS.WARN;
    return LOG_LEVELS[key] ?? LOG_LEVELS.INFO;
  }

  /**
   * Safe JSON stringifier that handles circular references
   * @private
   */
  safeStringify(obj) {
    const seen = new WeakSet();
    return JSON.stringify(
      obj,
      (key, value) => {
        // Fixed: Handle circular references
        if (typeof value === 'object' && value !== null) {
          if (seen.has(value)) {
            return '[Circular Reference]';
          }
          seen.add(value);
        }

        // Fixed: Handle Error objects
        if (value instanceof Error) {
          return {
            name: value.name,
            message: value.message,
            stack: value.stack
          };
        }

        // Fixed: Handle functions (convert to string)
        if (typeof value === 'function') {
          return `[Function: ${value.name || 'anonymous'}]`;
        }

        return value;
      },
      2
    );
  }

  formatMessage(level, message, data) {
    const timestamp = new Date().toISOString();
    const levelName = LOG_LEVEL_NAMES[level] || 'UNKNOWN';
    const contextStr = this.context ? ` [${this.context}]` : '';
    const correlationId = getCorrelationId();
    const correlationStr = correlationId ? ` [${correlationId}]` : '';

    let formattedMessage = `${timestamp} ${levelName}${contextStr}${correlationStr}: ${message}`;

    if (data && Object.keys(data).length > 0) {
      try {
        // Fixed: Use safe stringify to handle circular references
        formattedMessage += `\n  Data: ${this.safeStringify(data)}`;
      } catch (error) {
        formattedMessage += `\n  Data: [Error stringifying data: ${error.message}]`;
      }
    }

    return formattedMessage;
  }

  buildLogEntry(level, message, data) {
    const timestamp = new Date().toISOString();
    const levelName = LOG_LEVEL_NAMES[level] || 'UNKNOWN';

    const safeData = sanitizeLogData(data);
    const safeMessage = sanitizeLogData(message);
    const correlationId = getCorrelationId();

    return {
      timestamp,
      level: levelName,
      context: this.context || undefined,
      correlationId: correlationId || undefined,
      message: safeMessage,
      data: safeData && Object.keys(safeData).length > 0 ? safeData : undefined,
      pid: typeof process !== 'undefined' ? process.pid : undefined,
      processType: typeof process !== 'undefined' ? process.type || 'node' : undefined
    };
  }

  shouldWriteSync(level) {
    // Sync write on higher-severity logs to maximize chance it lands on disk before exit/crash.
    return level <= LOG_LEVELS.WARN;
  }

  writeToFile(level, entryOrText) {
    if (!this.enableFile || !this.logFile) return;
    if (this._fileWriteFailed) return;

    try {
      // Check for rotation before writing
      if (this.enableFile && this.logFile && !this._fileWriteFailed) {
        // We use a promise check but don't await it to avoid blocking the main thread
        // for every log write. If rotation is needed, it will happen eventually.
        // For critical size enforcement, we would await, but logging performance is priority.
        this.rotateLogIfNeeded().catch(() => {});
      }

      const fsSync = require('fs');
      const line =
        this.fileFormat === 'text'
          ? `${String(entryOrText)}\n`
          : `${JSON.stringify(entryOrText)}\n`;

      if (this.shouldWriteSync(level)) {
        fsSync.appendFileSync(this.logFile, line);
      } else {
        // Best-effort async for low-severity logs to reduce impact
        fsSync.promises.appendFile(this.logFile, line).catch(() => {
          this._fileWriteFailed = true;
        });
      }
    } catch (error) {
      // Avoid recursive logging loops; disable file logging after first failure.
      this._fileWriteFailed = true;
      // In dev, surface a concise hint without using console.* to respect CSP.
      if (typeof process !== 'undefined' && process.env?.NODE_ENV === 'development') {
        try {
          const message = `LOGGER FILE WRITE FAILED: ${error?.message || error}\n`;
          // Write directly to stderr to avoid recursive logger usage or console calls.
          if (typeof process.stderr?.write === 'function') {
            process.stderr.write(message);
          }
        } catch {
          // ignore
        }
      }
    }
  }

  log(level, message, data = {}) {
    const normalizedLevel = this.normalizeLevel(level);
    if (normalizedLevel > this.level) return;

    const sanitizedData = sanitizeLogData(data);
    const sanitizedMessage = sanitizeLogData(message);

    const formattedMessage = this.formatMessage(normalizedLevel, sanitizedMessage, sanitizedData);

    // In test environments, always go through console.* so Jest spies can observe calls
    const useConsoleDirect = typeof process !== 'undefined' && process.env?.NODE_ENV === 'test';

    if (this.enableConsole) {
      try {
        if (useConsoleDirect) {
          const consoleMethod = this.getConsoleMethod(normalizedLevel);
          consoleMethod(formattedMessage);
        } else if (typeof process !== 'undefined' && process.stdout && process.stderr) {
          // Write directly to stdout/stderr for terminal visibility
          // This ensures output appears in terminal, not just DevTools console
          const output = formattedMessage + '\n';
          if (normalizedLevel <= LOG_LEVELS.WARN) {
            process.stderr.write(output);
          } else {
            process.stdout.write(output);
          }
        } else {
          // Fallback to console for renderer process or environments without process
          const consoleMethod = this.getConsoleMethod(normalizedLevel);
          consoleMethod(formattedMessage);
        }
      } catch (error) {
        // Handle EPIPE errors gracefully (broken console pipe)
        // This can happen when stdout/stderr pipe is closed
        if (error.code !== 'EPIPE') {
          // Re-throw non-EPIPE errors, but disable console to prevent loops
          this.enableConsole = false;
          throw error;
        }
        // Silently ignore EPIPE - console is gone, continue with file logging
        this.enableConsole = false;
      }
    }

    if (this.enableFile) {
      const entry =
        this.fileFormat === 'text'
          ? formattedMessage
          : this.buildLogEntry(normalizedLevel, sanitizedMessage, sanitizedData);
      this.writeToFile(normalizedLevel, entry);
    }
  }

  getConsoleMethod(level) {
    switch (level) {
      case LOG_LEVELS.ERROR:
        return console.error;
      case LOG_LEVELS.WARN:
        return console.warn;
      case LOG_LEVELS.INFO:
        return console.info;
      case LOG_LEVELS.DEBUG:
      case LOG_LEVELS.TRACE:
        return console.debug;
      default:
        return console.log;
    }
  }

  error(message, data) {
    this.log(LOG_LEVELS.ERROR, message, data);
  }

  warn(message, data) {
    this.log(LOG_LEVELS.WARN, message, data);
  }

  info(message, data) {
    this.log(LOG_LEVELS.INFO, message, data);
  }

  debug(message, data) {
    this.log(LOG_LEVELS.DEBUG, message, data);
  }

  trace(message, data) {
    this.log(LOG_LEVELS.TRACE, message, data);
  }

  // Convenience methods for common logging patterns
  fileOperation(operation, filePath, result = 'success') {
    this.info(`File ${operation}`, { filePath, result });
  }

  aiAnalysis(filePath, model, duration, confidence) {
    this.info('AI Analysis completed', {
      filePath,
      model,
      duration: `${duration}ms`,
      confidence: `${confidence}%`
    });
  }

  phaseTransition(fromPhase, toPhase, data = {}) {
    this.info(`Phase transition: ${fromPhase} → ${toPhase}`, data);
  }

  performance(operation, duration, metadata = {}) {
    this.debug(`Performance: ${operation}`, {
      duration: `${duration}ms`,
      ...metadata
    });
  }

  /**
   * Write directly to terminal (stdout/stderr) AND log to file
   * Use this for important diagnostic output that MUST be visible in terminal
   * @param {string} level - 'error', 'warn', 'info'
   * @param {string} message - The message to write
   * @param {Object} [data] - Optional structured data
   */
  terminal(level, message, data = {}) {
    const normalizedLevel = this.normalizeLevel(level);
    const timestamp = new Date().toISOString();
    const levelName = LOG_LEVEL_NAMES[normalizedLevel] || 'INFO';
    const contextStr = this.context ? ` [${this.context}]` : '';

    // Format message for terminal
    let output = `${timestamp} ${levelName}${contextStr}: ${message}`;
    if (data && Object.keys(data).length > 0) {
      try {
        output += `\n  ${this.safeStringify(data)}`;
      } catch (e) {
        output += `\n  [Data stringify error]`;
      }
    }
    output += '\n';

    // Write directly to stdout/stderr (bypasses console which may not show in terminal)
    try {
      if (typeof process !== 'undefined') {
        if (normalizedLevel <= LOG_LEVELS.ERROR) {
          process.stderr.write(output);
        } else {
          process.stdout.write(output);
        }
      }
    } catch (e) {
      // Fallback to console if process not available
      if (this.enableConsole) {
        const consoleMethod = this.getConsoleMethod(normalizedLevel);
        consoleMethod(output);
      }
    }

    // Also write to log file
    if (this.enableFile) {
      const entry =
        this.fileFormat === 'text'
          ? output.trim()
          : this.buildLogEntry(normalizedLevel, message, data);
      this.writeToFile(normalizedLevel, entry);
    }
  }

  /**
   * Write raw text directly to terminal stdout (no formatting)
   * Use for diagnostic reports, tables, etc.
   * @param {string} text - Raw text to write
   */
  terminalRaw(text) {
    try {
      if (typeof process !== 'undefined' && process.stdout) {
        process.stdout.write(text);
      }
    } catch (e) {
      // Fallback
      if (this.enableConsole) {
        console.log(text);
      }
    }

    // Also write to log file if enabled
    if (this.enableFile && this.logFile) {
      try {
        const fs = require('fs');
        fs.appendFileSync(this.logFile, text);
      } catch (e) {
        // Ignore file write errors for raw output
      }
    }
  }
}

// Create singleton instance
const logger = new Logger();

// Set log level based on environment
if (typeof process !== 'undefined' && process.env.NODE_ENV === 'development') {
  logger.setLevel(LOG_LEVELS.DEBUG);
} else {
  logger.setLevel(LOG_LEVELS.INFO);
}

/**
 * DUP-5: Logger factory function to reduce boilerplate
 * Creates a logger instance with context already set
 *
 * Instead of:
 *   const { logger } = require('../../shared/logger');
 *   logger.setContext('ServiceName');
 *
 * Use:
 *   const { createLogger } = require('../../shared/logger');
 *   const logger = createLogger('ServiceName');
 *
 * @param {string} context - The context name for this logger
 * @returns {Logger} Logger instance with context set
 */
function createLogger(context) {
  // Create a new logger instance for this context
  // This allows different modules to have independent log levels if needed
  const contextLogger = new Logger();
  // Inherit configuration from singleton so context loggers behave consistently
  contextLogger.setLevel(logger.level);
  contextLogger.enableConsole = logger.enableConsole;
  contextLogger.enableFile = logger.enableFile;
  contextLogger.logFile = logger.logFile;
  contextLogger.fileFormat = logger.fileFormat;
  contextLogger.setContext(context);
  return contextLogger;
}

/**
 * Get the singleton logger with context already set
 * Use this when you want all modules to share the same logger instance
 *
 * @param {string} context - The context name for this logger
 * @returns {Logger} The singleton logger with context set
 */
function getLogger(context) {
  logger.setContext(context);
  return logger;
}

// Export both the class and singleton
module.exports = {
  Logger,
  logger,
  LOG_LEVELS,
  LOG_LEVEL_NAMES,
  // DUP-5: Factory functions
  createLogger,
  getLogger,
  // Shared utility for sanitizing log data (used by ErrorHandler.js)
  sanitizeLogData
};
