/* global __non_webpack_require__ */
/**
 * Unified Logging System for StratoSort
 * Provides structured logging across main and renderer processes using Pino
 */

const pino = require('pino');
const { getCorrelationId } = require('./correlationId');

// Legacy level mapping for compatibility
const LOG_LEVELS = {
  ERROR: 'error',
  WARN: 'warn',
  INFO: 'info',
  DEBUG: 'debug',
  TRACE: 'trace'
};

const LOG_LEVEL_NAMES = ['ERROR', 'WARN', 'INFO', 'DEBUG', 'TRACE'];

// pino.transport() is only available in the Node.js build (main process).
// The preload (target: 'web') and renderer use pino/browser.js which lacks it.
const _hasPinoTransport = typeof pino.transport === 'function';

// Previously, every createLogger() call spawned a new pino transport worker,
// each registering its own process.on('exit') handler. With 100+ loggers in
// the main process, this caused MaxListenersExceededWarning at startup.
let _sharedDevTransport = null;
let _transportDead = false;
const _activeLoggers = new Set();
const _globalLogConfig = {
  enableFile: false,
  logFile: null,
  enableConsole: undefined,
  level: undefined
};

// Use webpack-safe require access (avoids bundling pino-pretty into renderer)
const _safeRequire =
  typeof __non_webpack_require__ === 'function'
    ? __non_webpack_require__
    : typeof module !== 'undefined' && typeof module.require === 'function'
      ? module.require.bind(module)
      : null;

function _getSharedDevTransport() {
  if (_transportDead) return null;
  if (!_sharedDevTransport && _hasPinoTransport) {
    try {
      _sharedDevTransport = pino.transport({
        target: 'pino-pretty',
        options: { colorize: true }
      });
      // Prevent thread-stream worker death from becoming an uncaught exception.
      // If the worker ends, mark the transport as dead so we fall back to console.
      if (typeof _sharedDevTransport.on === 'function') {
        _sharedDevTransport.on('error', (err) => {
          _transportDead = true;
          _sharedDevTransport = null;
          console.error(
            '[Logger] pino-pretty transport worker died, falling back to console:',
            err?.message
          );
        });
      }
    } catch {
      _transportDead = true;
      return null;
    }
  }
  return _sharedDevTransport;
}

/**
 * Best-effort redaction for production logs.
 * We keep this lightweight and dependency-free since it runs in both main/renderer.
 * @param {string|object} data
 * @returns {string|object}
 */
function sanitizeLogData(data) {
  // Strings: redact common absolute path patterns
  if (typeof data === 'string') {
    let sanitized = data.replace(
      /[A-Za-z]:\\(?:[^\\/:*?"<>|\r\n]+\\)*([^\\/:*?"<>|\r\n]+)/g,
      (_match, filename) => `[REDACTED_PATH]\\${filename}`
    );
    sanitized = sanitized.replace(
      /(?<!:)\/(?:[^/\s]+\/)+([^/\s]+)/g,
      (_match, filename) => `[REDACTED_PATH]/${filename}`
    );
    return sanitized;
  }

  if (typeof data === 'object' && data !== null) {
    // so message, stack, and code are preserved in log output
    if (data instanceof Error) {
      return sanitizeLogData({
        name: data.name,
        message: data.message,
        stack: data.stack,
        ...(data.code ? { code: data.code } : {})
      });
    }
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
  constructor(context = '', options = {}) {
    this.context = context;
    this.enableFile = false;
    this.logFile = null;
    this.enableConsole = true;
    this.level = process.env.NODE_ENV === 'development' ? 'debug' : 'info';

    // Initialize Pino instance
    // Clean up dead weak refs occasionally
    if (_activeLoggers.size % 10 === 0) {
      for (const ref of _activeLoggers) {
        if (!ref.deref()) _activeLoggers.delete(ref);
      }
    }
    _activeLoggers.add(new WeakRef(this));
    this._applyGlobalConfig();
    // Allow deferring _initPino when the caller (e.g. createLogger) will
    // override properties and call _initPino itself, avoiding a wasted init.
    if (!options.deferInit) {
      this._initPino(options);
    }
  }

  _applyGlobalConfig() {
    if (_globalLogConfig.enableFile) {
      this.enableFile = true;
      this.logFile = _globalLogConfig.logFile;
    }
    if (typeof _globalLogConfig.enableConsole === 'boolean') {
      this.enableConsole = _globalLogConfig.enableConsole;
    }
    if (typeof _globalLogConfig.level === 'string') {
      this.level = _globalLogConfig.level;
    }
  }

  _initPino(options = {}) {
    const isDev = process.env.NODE_ENV === 'development';
    // Detect non-main contexts: renderer (process.type === 'renderer'),
    // preload (no process.type but window exists), or browser pino build.
    const isRenderer =
      (typeof process !== 'undefined' && process.type === 'renderer') || !_hasPinoTransport;

    const pinoOptions = {
      level: this.level,
      base: {
        pid: typeof process !== 'undefined' ? process.pid : undefined,
        context: this.context
      },
      timestamp: pino.stdTimeFunctions.isoTime,
      formatters: {
        level: (label) => ({ level: label })
      },
      mixin: () => {
        const correlationId = getCorrelationId();
        return correlationId ? { correlationId } : {};
      },
      // Use built-in redaction for simple keys, but we rely on sanitizeLogData for complex logic
      redact: {
        paths: ['*.password', '*.token', '*.secret', '*.key'],
        remove: true
      },
      ...options
    };

    if (isRenderer) {
      // Browser/Renderer configuration
      this.pino = pino({
        ...pinoOptions,
        browser: {
          // Renderer logs are forwarded to main process via transmit below.
          // Avoid duplicate/noisy Chromium console output like "[object Object]".
          asObject: true,
          write: () => {},
          transmit: {
            level: this.level,
            send: (level, logEvent) => {
              if (typeof window !== 'undefined' && window.electronAPI?.system?.log) {
                // Ensure messages property is serialized correctly
                const messages = logEvent.messages || [];
                const message = messages[0] || '';
                const data = messages[1] || {};

                // Use non-blocking fire-and-forget for logs
                window.electronAPI.system.log(level, message, data).catch(() => {
                  // Silently fail if log transmission fails to avoid loops
                });
              }
            }
          }
        }
      });
    } else {
      // Main process configuration
      let transport;
      let streams = null;

      if (this.logFile && this.enableFile) {
        streams = [];
        try {
          const fileStream = pino.destination({ dest: this.logFile, sync: false });
          streams.push({ level: this.level, stream: fileStream });
        } catch (error) {
          console.error('[Logger] Failed to open log file stream:', error?.message);
        }

        if (this.enableConsole !== false) {
          if (!isRenderer && isDev) {
            try {
              const prettyFactory = _safeRequire ? _safeRequire('pino-pretty') : null;
              if (typeof prettyFactory === 'function') {
                const pretty = prettyFactory({ colorize: true });
                streams.push({ level: this.level, stream: pretty });
              } else {
                throw new Error('pino-pretty not available');
              }
            } catch (error) {
              console.warn('[Logger] pino-pretty unavailable, using stdout:', error?.message);
              streams.push({ level: this.level, stream: process.stdout });
            }
          } else {
            streams.push({ level: this.level, stream: process.stdout });
          }
        }
      } else if (isDev) {
        // Console only — reuse module-level shared transport in dev
        transport = _getSharedDevTransport();
      }

      if (streams && streams.length > 0 && typeof pino.multistream === 'function') {
        this.pino = pino(pinoOptions, pino.multistream(streams));
      } else {
        // to avoid spawning a separate pino worker per logger instance.
        // Only custom transports (e.g. file logging) get their own stream.
        this.pino = pino(pinoOptions, transport || undefined);
      }
    }
  }

  setLevel(level) {
    // Map legacy numeric/string levels to Pino strings
    const allowed = ['error', 'warn', 'info', 'debug', 'trace'];
    if (typeof level === 'number') {
      this.level = allowed[level] || 'info';
    } else if (typeof level === 'string') {
      const normalized = level.toLowerCase();
      this.level = allowed.includes(normalized) ? normalized : 'info';
    } else {
      this.level = 'info';
    }
    if (this.pino) {
      this.pino.level = this.level;
    }
  }

  setContext(context) {
    this.context = context;
    // Re-bind pino child with new context
    this.pino = this.pino.child({ context });
  }

  enableFileLogging(logFile, _options = {}) {
    configureFileLogging(logFile, _options);
  }

  disableConsoleLogging() {
    configureConsoleLogging(false);
  }

  // API Compatibility methods
  log(level, message, data) {
    // Legacy generic log method
    const lvl = typeof level === 'number' ? LOG_LEVEL_NAMES[level]?.toLowerCase() : level;
    if (this[lvl]) {
      this[lvl](message, data);
    } else {
      this.info(message, data);
    }
  }

  // Core logging methods — wrapped in _safeWrite to survive thread-stream death.
  // If the pino-pretty transport worker has ended, we degrade gracefully to
  // console output instead of crashing the Electron main process.
  _safeWrite(level, message, data) {
    const sanitized = data ? sanitizeLogData(data) : undefined;
    try {
      if (sanitized) this.pino[level](sanitized, message);
      else this.pino[level](message);
    } catch (err) {
      if (err?.message?.includes('worker is ending') || err?.message?.includes('stream')) {
        // Transport died mid-write. Fall back to console to keep the app alive.
        _transportDead = true;
        _sharedDevTransport = null;
        const fallback = level === 'error' || level === 'warn' ? level : 'log';
        console[fallback](`[${this.context || 'App'}] ${message}`, sanitized || '');
      } else {
        throw err; // Re-throw non-transport errors
      }
    }
  }

  error(message, data) {
    this._safeWrite('error', message, data);
  }

  warn(message, data) {
    this._safeWrite('warn', message, data);
  }

  info(message, data) {
    this._safeWrite('info', message, data);
  }

  debug(message, data) {
    this._safeWrite('debug', message, data);
  }

  trace(message, data) {
    this._safeWrite('trace', message, data);
  }

  // Convenience methods
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

  terminal(level, message, data = {}) {
    const lvl = (typeof level === 'string' ? level : 'info').toLowerCase();
    if (this.pino[lvl]) {
      this._safeWrite(lvl, message, data);
    }
  }

  terminalRaw(text) {
    this._safeWrite('info', text);
  }
}

// Create singleton instance
const logger = new Logger();

// Factory functions
function createLogger(context) {
  // Defer init in constructor — we override properties below and init once.
  const contextLogger = new Logger(context, { deferInit: true });
  // Inherit settings from singleton
  contextLogger.level = logger.level;
  contextLogger.enableFile = logger.enableFile;
  contextLogger.logFile = logger.logFile;
  contextLogger.enableConsole = logger.enableConsole;
  contextLogger._initPino(); // Single init with inherited settings
  return contextLogger;
}

function configureFileLogging(logFilePath, options = {}) {
  _globalLogConfig.enableFile = true;
  _globalLogConfig.logFile = logFilePath;
  if (typeof options.enableConsole === 'boolean') {
    _globalLogConfig.enableConsole = options.enableConsole;
  }
  if (typeof options.level === 'string') {
    _globalLogConfig.level = options.level;
  }

  for (const ref of _activeLoggers) {
    const instance = ref.deref();
    if (instance) {
      instance.enableFile = true;
      instance.logFile = logFilePath;
      if (typeof options.enableConsole === 'boolean') {
        instance.enableConsole = options.enableConsole;
      }
      if (typeof options.level === 'string') {
        instance.level = options.level;
      }
      instance._initPino();
    } else {
      _activeLoggers.delete(ref);
    }
  }
}

function configureConsoleLogging(enableConsole) {
  if (typeof enableConsole === 'boolean') {
    _globalLogConfig.enableConsole = enableConsole;
  }

  for (const ref of _activeLoggers) {
    const instance = ref.deref();
    if (instance) {
      if (typeof enableConsole === 'boolean') {
        instance.enableConsole = enableConsole;
      }
      instance._initPino();
    } else {
      _activeLoggers.delete(ref);
    }
  }
}

/**
 * Safe logger factory with console fallback for cross-process safety.
 * Use in shared modules that may be loaded before the logger is fully initialized.
 */
function createSafeLogger(name) {
  try {
    return createLogger(name);
  } catch {
    return {
      debug: () => {},
      info: () => {},
      warn: console.warn.bind(console, `[${name}]`),
      error: console.error.bind(console, `[${name}]`)
    };
  }
}

/**
 * Gracefully flush and end all pino streams/transports before process exit.
 *
 * Pino's `sonic-boom` registers a synchronous `process.on('exit')` hook via
 * `on-exit-leak-free` that calls `flushSync()`. If the sonic-boom instance
 * hasn't finished its async open yet, `flushSync` throws
 * "sonic boom is not ready yet" — which Electron surfaces as an uncaught
 * exception dialog on quit.
 *
 * Call this *before* `app.exit()` to let streams finish writing and
 * deregister their exit hooks cleanly.
 *
 * @returns {Promise<void>}
 */
async function shutdownLogging() {
  const FLUSH_TIMEOUT = 3000;

  const flushOne = (pinoInstance) =>
    new Promise((resolve) => {
      if (!pinoInstance) return resolve();
      try {
        pinoInstance.flush?.();
      } catch {
        // flush may throw if stream already ended
      }
      const dest = pinoInstance[Symbol.for('pino.serializers')] ? undefined : pinoInstance;
      const stream = dest?.stream ?? pinoInstance[Symbol.for('pino.stream')];
      if (stream && typeof stream.end === 'function') {
        stream.once('close', resolve);
        stream.once('error', resolve);
        stream.end();
      } else {
        resolve();
      }
    });

  const tasks = [];
  for (const ref of _activeLoggers) {
    const instance = ref.deref();
    if (instance?.pino) {
      tasks.push(flushOne(instance.pino));
    }
  }

  if (_sharedDevTransport && typeof _sharedDevTransport.end === 'function') {
    tasks.push(
      new Promise((resolve) => {
        _sharedDevTransport.once('close', resolve);
        _sharedDevTransport.once('error', resolve);
        _sharedDevTransport.end();
      })
    );
    _transportDead = true;
    _sharedDevTransport = null;
  }

  if (tasks.length > 0) {
    await Promise.race([
      Promise.allSettled(tasks),
      new Promise((resolve) => setTimeout(resolve, FLUSH_TIMEOUT))
    ]);
  }
}

module.exports = {
  Logger,
  logger,
  LOG_LEVELS,
  createLogger,
  createSafeLogger,
  sanitizeLogData,
  configureFileLogging,
  configureConsoleLogging,
  shutdownLogging
};
