/**
 * System Monitoring IPC Handlers
 *
 * Handles system metrics, application statistics, updates, and configuration.
 */
const { createHandler, createErrorResponse, safeHandle } = require('./ipcWrappers');
const { dump: dumpConfig, validate: validateConfig } = require('../../shared/config/index');

function registerSystemIpc({
  ipcMain,
  IPC_CHANNELS,
  logger,
  systemAnalytics,
  getServiceIntegration
}) {
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
      handler: async (_event, path) => {
        try {
          const { get: getConfig } = require('../../shared/config/index');
          const value = getConfig(path);
          return { success: true, path, value };
        } catch (error) {
          logger.error('Failed to get config value:', error);
          return createErrorResponse(error);
        }
      }
    })
  );
}

module.exports = registerSystemIpc;
