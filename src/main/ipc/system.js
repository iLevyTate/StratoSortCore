/**
 * System Monitoring IPC Handlers
 *
 * Handles system metrics, application statistics, updates, and configuration.
 */
const { IpcServiceContext, createFromLegacyParams } = require('./IpcServiceContext');
const {
  createHandler,
  createErrorResponse,
  canceledResponse,
  safeHandle
} = require('./ipcWrappers');
const { dump: dumpConfig, validate: validateConfig } = require('../../shared/config/index');
const { schemas } = require('./validationSchemas');

const MAX_LOG_MESSAGE_CHARS = 8192;
const MAX_LOG_CONTEXT_CHARS = 120;
const MAX_LOG_SERIALIZED_DATA_BYTES = 16384;
const MAX_LOG_DATA_DEPTH = 4;
const MAX_LOG_DATA_KEYS = 100;
const MAX_LOG_ARRAY_ITEMS = 100;
const LOG_EXPORT_WORKER_TIMEOUT_MS = 120000;
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

  safeHandle(
    ipcMain,
    IPC_CHANNELS.SYSTEM.CHECK_FOR_UPDATES,
    createHandler({
      logger,
      context,
      handler: async () => {
        try {
          const { checkForUpdates } = require('../core/autoUpdater');
          const result = await checkForUpdates();
          return result?.success === false
            ? createErrorResponse(new Error(result.error || 'Failed to check for updates'))
            : { success: true };
        } catch (error) {
          logger.error('Failed to check for updates:', error);
          return createErrorResponse(error);
        }
      }
    })
  );

  // Configuration inspection handler for debugging and support
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
  safeHandle(
    ipcMain,
    IPC_CHANNELS.SYSTEM.GET_CONFIG_VALUE,
    createHandler({
      logger,
      context,
      schema: schemas.configPath,
      handler: async (_event, configPath) => {
        try {
          const pathError = validateConfigPathInput(configPath);
          if (pathError) {
            return createErrorResponse({ message: pathError });
          }
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
      schema: schemas.systemLog,
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

  // Export logs to a zip file
  safeHandle(
    ipcMain,
    IPC_CHANNELS.SYSTEM.EXPORT_LOGS,
    createHandler({
      logger,
      context,
      handler: async () => {
        try {
          const { app, dialog } = require('electron');
          const path = require('path');
          const fs = require('fs');
          const { Worker } = require('worker_threads');

          const logsDir = path.join(app.getPath('userData'), 'logs');
          if (!fs.existsSync(logsDir)) {
            return { success: false, error: 'No logs found' };
          }

          const crashDumpsDir = path.join(app.getPath('userData'), 'crash-dumps');

          const { filePath } = await dialog.showSaveDialog({
            title: 'Export Debug Logs',
            defaultPath: `stratosort-logs-${new Date().toISOString().replace(/[:.]/g, '-')}.zip`,
            filters: [{ name: 'Zip Files', extensions: ['zip'] }]
          });

          if (!filePath) {
            return canceledResponse();
          }

          await new Promise((resolve, reject) => {
            let settled = false;
            let timeoutId = null;
            const workerCode = `
              const { parentPort, workerData } = require('worker_threads');
              const AdmZip = require('adm-zip');
              const fs = require('fs');
              try {
                const zip = new AdmZip();
                zip.addLocalFolder(workerData.logsDir, 'logs');
                if (workerData.crashDumpsDir && fs.existsSync(workerData.crashDumpsDir)) {
                  zip.addLocalFolder(workerData.crashDumpsDir, 'crash-dumps');
                }
                zip.writeZip(workerData.outPath);
                parentPort.postMessage({ success: true });
              } catch (err) {
                parentPort.postMessage({ success: false, error: err.message });
              }
            `;
            const worker = new Worker(workerCode, {
              eval: true,
              workerData: { logsDir, crashDumpsDir, outPath: filePath }
            });

            const finish = (error = null) => {
              if (settled) return;
              settled = true;
              if (timeoutId) clearTimeout(timeoutId);
              if (error) reject(error);
              else resolve();
            };

            timeoutId = setTimeout(() => {
              worker.terminate().catch(() => {});
              finish(
                new Error(
                  `Log export timed out after ${Math.round(LOG_EXPORT_WORKER_TIMEOUT_MS / 1000)}s`
                )
              );
            }, LOG_EXPORT_WORKER_TIMEOUT_MS);

            worker.on('message', (msg) => {
              if (msg?.success) {
                finish();
              } else {
                finish(new Error(msg?.error || 'Log export failed'));
              }
            });
            worker.on('error', (error) => finish(error));
            worker.on('exit', (code) => {
              if (!settled && code !== 0) {
                finish(new Error(`Worker stopped with exit code ${code}`));
              }
            });
          });

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
