/**
 * System Monitoring IPC Handlers
 *
 * Handles system metrics, application statistics, updates, and configuration.
 */
const { IpcServiceContext, createFromLegacyParams } = require('./IpcServiceContext');
const { createHandler, createErrorResponse, safeHandle } = require('./ipcWrappers');
const { dump: dumpConfig, validate: validateConfig } = require('../../shared/config/index');

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
          // FIX 86: Validate input and block access to sensitive config keys
          if (typeof configPath !== 'string' || configPath.length === 0) {
            return createErrorResponse({ message: 'Config path must be a non-empty string' });
          }
          const { SENSITIVE_KEYS } = require('../../shared/config/configSchema');
          const pathLower = configPath.toLowerCase();
          if (SENSITIVE_KEYS.some((key) => pathLower.includes(key.toLowerCase()))) {
            return createErrorResponse({ message: 'Cannot access sensitive configuration values' });
          }
          const { get: getConfig } = require('../../shared/config/index');
          const value = getConfig(configPath);
          return { success: true, path: configPath, value };
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

          // Route to main logger (which writes to the file)
          // We use a prefix to distinguish renderer logs
          const rendererContext = `Renderer${data?.context ? `:${data.context}` : ''}`;
          const loggerWithContext = logger.pino.child({ context: rendererContext });

          // Call the validated level
          const logMethod = loggerWithContext[safeLevel];
          if (typeof logMethod === 'function') {
            logMethod.call(loggerWithContext, data || {}, message);
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
          const AdmZip = require('adm-zip');

          const logsDir = path.join(app.getPath('userData'), 'logs');
          if (!fs.existsSync(logsDir)) {
            return { success: false, error: 'No logs found' };
          }

          const zip = new AdmZip();
          zip.addLocalFolder(logsDir, 'logs');

          // Also include crash dumps if they exist
          const crashDumpsDir = path.join(app.getPath('userData'), 'crash-dumps');
          if (fs.existsSync(crashDumpsDir)) {
            zip.addLocalFolder(crashDumpsDir, 'crash-dumps');
          }

          const { filePath } = await dialog.showSaveDialog({
            title: 'Export Debug Logs',
            defaultPath: `stratosort-logs-${new Date().toISOString().replace(/[:.]/g, '-')}.zip`,
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
