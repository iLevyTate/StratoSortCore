/**
 * System Monitoring IPC Handlers
 *
 * Handles system metrics, application statistics, updates, and configuration.
 */
const { IpcServiceContext, createFromLegacyParams } = require('./IpcServiceContext');
const { createHandler, createErrorResponse, safeHandle } = require('./ipcWrappers');
const { dump: dumpConfig, validate: validateConfig } = require('../../shared/config/index');

const MAX_LOG_MESSAGE_CHARS = 8192;
const MAX_LOG_CONTEXT_CHARS = 120;
const MAX_LOG_SERIALIZED_DATA_BYTES = 16384;
const MAX_LOG_DATA_DEPTH = 4;
const MAX_LOG_DATA_KEYS = 100;
const MAX_LOG_ARRAY_ITEMS = 100;
const BLOCKED_LOG_DATA_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const MAX_CONFIG_PATH_CHARS = 120;
const SAFE_CONFIG_PATH_PATTERN = /^[A-Za-z0-9_.-]+$/;
const BLOCKED_CONFIG_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype']);

function truncateString(value, maxChars) {
  const str = typeof value === 'string' ? value : String(value ?? '');
  if (str.length <= maxChars) return str;
  return `${str.slice(0, maxChars)}...[truncated]`;
}

function sanitizeLogData(value, depth = 0) {
  if (value == null) return value;
  if (depth >= MAX_LOG_DATA_DEPTH) return '[Truncated: max depth reached]';
  if (Array.isArray(value)) {
    return value.slice(0, MAX_LOG_ARRAY_ITEMS).map((entry) => sanitizeLogData(entry, depth + 1));
  }
  if (typeof value !== 'object') return value;

  const sanitized = Object.create(null);
  let count = 0;
  for (const [key, nested] of Object.entries(value)) {
    if (BLOCKED_LOG_DATA_KEYS.has(String(key).toLowerCase())) {
      sanitized.__blockedKeys = true;
      continue;
    }
    if (count >= MAX_LOG_DATA_KEYS) {
      sanitized.__truncatedKeys = true;
      break;
    }
    sanitized[key] = sanitizeLogData(nested, depth + 1);
    count += 1;
  }
  return sanitized;
}

function clampLogDataSize(value) {
  const sanitized = sanitizeLogData(value);
  try {
    const serialized = JSON.stringify(sanitized);
    const bytes = Buffer.byteLength(serialized, 'utf8');
    if (bytes <= MAX_LOG_SERIALIZED_DATA_BYTES) return sanitized;
    return {
      truncated: true,
      reason: 'payload_too_large',
      sizeBytes: bytes,
      maxBytes: MAX_LOG_SERIALIZED_DATA_BYTES
    };
  } catch {
    return {
      truncated: true,
      reason: 'payload_not_serializable'
    };
  }
}

function validateConfigPathInput(configPath) {
  if (typeof configPath !== 'string') {
    return 'Config path must be a non-empty string';
  }
  const normalized = configPath.trim();
  if (!normalized) {
    return 'Config path must be a non-empty string';
  }
  if (normalized.length > MAX_CONFIG_PATH_CHARS) {
    return `Config path exceeds ${MAX_CONFIG_PATH_CHARS} characters`;
  }
  if (!SAFE_CONFIG_PATH_PATTERN.test(normalized)) {
    return 'Config path contains invalid characters';
  }
  if (normalized.includes('..')) {
    return 'Config path contains invalid traversal segments';
  }
  const segments = normalized.split('.');
  if (segments.some((segment) => !segment)) {
    return 'Config path contains invalid empty segments';
  }
  if (segments.some((segment) => BLOCKED_CONFIG_SEGMENTS.has(segment.toLowerCase()))) {
    return 'Config path contains blocked segment';
  }
  return null;
}

function registerSystemIpc(servicesOrParams) {
  let container;
  if (servicesOrParams instanceof IpcServiceContext) {
    container = servicesOrParams;
  } else {
    container = createFromLegacyParams(servicesOrParams);
  }

  const { ipcMain, IPC_CHANNELS, logger } = container.core;
  const { systemAnalytics, getServiceIntegration } = container;

  const context = 'System';

  safeHandle(
    ipcMain,
    IPC_CHANNELS.SYSTEM.GET_APPLICATION_STATISTICS,
    createHandler({
      logger,
      context,
      handler: async () => {
        try {
          const serviceIntegration = getServiceIntegration();
          const [analysisStats, historyRecent] = await Promise.all([
            serviceIntegration?.analysisHistory?.getStatistics?.() || Promise.resolve({}),
            serviceIntegration?.analysisHistory?.getRecentAnalysis?.(20) || Promise.resolve([])
          ]);

          return {
            analysis: analysisStats,
            recentActions: serviceIntegration?.undoRedo?.getActionHistory?.(20) || [],
            recentAnalysis: historyRecent,
            timestamp: new Date().toISOString()
          };
        } catch (error) {
          logger.error('Failed to get system statistics:', error);
          return {};
        }
      }
    })
  );

  safeHandle(
    ipcMain,
    IPC_CHANNELS.SYSTEM.GET_METRICS,
    createHandler({
      logger,
      context,
      handler: async () => {
        try {
          return await systemAnalytics.collectMetrics();
        } catch (error) {
          logger.error('Failed to collect system metrics:', error);
          return {};
        }
      }
    })
  );

  safeHandle(
    ipcMain,
    IPC_CHANNELS.SYSTEM.APPLY_UPDATE,
    createHandler({
      logger,
      context,
      handler: async () => {
        try {
          const { autoUpdater } = require('electron-updater');
          autoUpdater.quitAndInstall();
          return { success: true };
        } catch (error) {
          logger.error('Failed to apply update:', error);
          return createErrorResponse(error);
        }
      }
    })
  );

  // Configuration inspection handler for debugging and support
  // FIX: Use IPC_CHANNELS constant instead of string literal
  safeHandle(
    ipcMain,
    IPC_CHANNELS.SYSTEM.GET_CONFIG,
    createHandler({
      logger,
      context,
      handler: async () => {
        try {
          const configDump = dumpConfig({ includeSensitive: false });
          const validation = validateConfig();

          return {
            success: true,
            config: configDump.config,
            metadata: configDump.metadata,
            validation: {
              valid: validation.valid,
              errorCount: validation.errors.length,
              warningCount: validation.warnings.length
            }
          };
        } catch (error) {
          logger.error('Failed to get app configuration:', error);
          return createErrorResponse(error);
        }
      }
    })
  );

  // Get configuration value by path
  // FIX: Use IPC_CHANNELS constant instead of string literal
  safeHandle(
    ipcMain,
    IPC_CHANNELS.SYSTEM.GET_CONFIG_VALUE,
    createHandler({
      logger,
      context,
      handler: async (_event, configPath) => {
        try {
          const pathError = validateConfigPathInput(configPath);
          if (pathError) {
            return createErrorResponse({ message: pathError });
          }
          // FIX 86: Validate input and block access to sensitive config keys
          const { SENSITIVE_KEYS } = require('../../shared/config/configSchema');
          const normalizedPath = configPath.trim();
          const pathLower = normalizedPath.toLowerCase();
          if (SENSITIVE_KEYS.some((key) => pathLower.includes(key.toLowerCase()))) {
            return createErrorResponse({ message: 'Cannot access sensitive configuration values' });
          }
          const { get: getConfig } = require('../../shared/config/index');
          const value = getConfig(normalizedPath);
          return { success: true, path: normalizedPath, value };
        } catch (error) {
          logger.error('Failed to get config value:', error);
          return createErrorResponse(error);
        }
      }
    })
  );

  // Get recommended concurrency based on system capabilities
  safeHandle(
    ipcMain,
    IPC_CHANNELS.SYSTEM.GET_RECOMMENDED_CONCURRENCY,
    createHandler({
      logger,
      context,
      handler: async () => {
        try {
          const { getRecommendedConcurrency } = require('../services/PerformanceService');
          const recommendation = await getRecommendedConcurrency();
          logger.info('[System] Recommended concurrency:', recommendation);
          return { success: true, ...recommendation };
        } catch (error) {
          logger.error('Failed to get recommended concurrency:', error);
          return { success: false, maxConcurrent: 1, reason: 'Error determining capabilities' };
        }
      }
    })
  );

  // Handle remote logs from Renderer process
  safeHandle(
    ipcMain,
    IPC_CHANNELS.SYSTEM.LOG,
    createHandler({
      logger,
      context,
      handler: async (_event, payload) => {
        try {
          if (!payload || typeof payload !== 'object') return { success: false };
          const { level, message, data } = payload;

          // Validate log level to prevent arbitrary method invocation
          const ALLOWED_LOG_LEVELS = new Set(['trace', 'debug', 'info', 'warn', 'error', 'fatal']);
          const safeLevel = ALLOWED_LOG_LEVELS.has(level) ? level : 'info';
          const safeMessage = truncateString(message, MAX_LOG_MESSAGE_CHARS);
          const safeData = clampLogDataSize(data || {});

          // Route to main logger (which writes to the file)
          // We use a prefix to distinguish renderer logs
          const safeContext =
            typeof safeData?.context === 'string'
              ? truncateString(safeData.context, MAX_LOG_CONTEXT_CHARS)
              : '';
          const rendererContext = `Renderer${safeContext ? `:${safeContext}` : ''}`;
          const loggerWithContext = logger.pino.child({ context: rendererContext });

          // Call the validated level
          const logMethod = loggerWithContext[safeLevel];
          if (typeof logMethod === 'function') {
            logMethod.call(loggerWithContext, safeData, safeMessage);
          }

          return { success: true };
        } catch {
          // Don't log this error to avoid infinite loops if logging itself fails
          return { success: false };
        }
      }
    })
  );

  // Export logs to a zip file (optionally redacted for safe troubleshooting uploads)
  safeHandle(
    ipcMain,
    IPC_CHANNELS.SYSTEM.EXPORT_LOGS,
    createHandler({
      logger,
      context,
      handler: async (_event, payload) => {
        try {
          const { app, dialog } = require('electron');
          const path = require('path');
          const fs = require('fs');
          const fsPromises = require('fs').promises;
          const AdmZip = require('adm-zip');
          const { redactLogContent } = require('../../shared/logRedaction');

          const redact = Boolean(payload?.redact);
          const logsDir = path.join(app.getPath('userData'), 'logs');
          if (!fs.existsSync(logsDir)) {
            return { success: false, error: 'No logs found' };
          }

          const zip = new AdmZip();

          if (redact) {
            const logFiles = await fsPromises.readdir(logsDir);
            for (const name of logFiles) {
              const fullPath = path.join(logsDir, name);
              const stat = await fsPromises.stat(fullPath);
              if (!stat.isFile() || !name.endsWith('.log')) continue;
              const content = await fsPromises.readFile(fullPath, 'utf8');
              const redacted = redactLogContent(content);
              zip.addFile(`logs/${name}`, Buffer.from(redacted, 'utf8'));
            }
          } else {
            zip.addLocalFolder(logsDir, 'logs');
            const crashDumpsDir = path.join(app.getPath('userData'), 'crash-dumps');
            if (fs.existsSync(crashDumpsDir)) {
              zip.addLocalFolder(crashDumpsDir, 'crash-dumps');
            }
          }

          const suffix = redact ? '-redacted' : '';
          const { filePath } = await dialog.showSaveDialog({
            title: redact ? 'Export Logs (Redacted)' : 'Export Debug Logs',
            defaultPath: `stratosort-logs${suffix}-${new Date().toISOString().replace(/[:.]/g, '-')}.zip`,
            filters: [{ name: 'Zip Files', extensions: ['zip'] }]
          });

          if (!filePath) {
            return { success: false, cancelled: true };
          }

          zip.writeZip(filePath);
          return { success: true, filePath };
        } catch (error) {
          logger.error('Failed to export logs:', error);
          return createErrorResponse(error);
        }
      }
    })
  );
}

module.exports = registerSystemIpc;
