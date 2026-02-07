/**
 * VectorDB IPC Handlers - In-process vector database operations
 *
 * IPC handlers for Orama-based OramaVectorService.
 * Provides status, stats, and health check endpoints.
 *
 * @module ipc/vectordb
 */

const { IpcServiceContext, createFromLegacyParams } = require('./IpcServiceContext');
const { createHandler, safeHandle, z } = require('./ipcWrappers');
const { container: serviceContainer, ServiceIds } = require('../services/ServiceContainer');
const { withTimeout } = require('../../shared/promiseUtils');
const { TIMEOUTS } = require('../../shared/performanceConstants');

/**
 * Register VectorDB IPC handlers
 */
function registerVectorDbIpc(servicesOrParams) {
  let container;
  if (servicesOrParams instanceof IpcServiceContext) {
    container = servicesOrParams;
  } else {
    container = createFromLegacyParams(servicesOrParams);
  }

  const { ipcMain, IPC_CHANNELS, logger } = container.core;
  const { systemAnalytics } = container;

  // Lazy load OramaVectorService to avoid circular dependencies
  let vectorService = null;

  function getVectorService() {
    if (!vectorService) {
      try {
        if (!serviceContainer.has(ServiceIds.ORAMA_VECTOR)) {
          const { registerWithContainer } = require('../services/OramaVectorService');
          registerWithContainer(serviceContainer, ServiceIds.ORAMA_VECTOR);
        }
        vectorService = serviceContainer.resolve(ServiceIds.ORAMA_VECTOR);
      } catch (error) {
        logger.warn('[IPC:VectorDB] OramaVectorService not available:', error.message);
        return null;
      }
    }
    return vectorService;
  }

  const context = 'VectorDB';
  const schemaVoid = z ? z.void() : null;

  // Get status
  safeHandle(
    ipcMain,
    IPC_CHANNELS.VECTOR_DB?.GET_STATUS || 'vectordb:get-status',
    createHandler({
      logger,
      context,
      schema: schemaVoid,
      handler: async () => {
        try {
          const service = getVectorService();
          if (!service) {
            return {
              success: false,
              status: 'unavailable',
              error: 'VectorDB service not initialized',
              inProcess: true
            };
          }

          const stats = await withTimeout(
            service.getStats(),
            TIMEOUTS.HEALTH_CHECK,
            'Vector DB status'
          );
          const now = Date.now();

          // Update health status
          systemAnalytics.vectorDbHealth = {
            status: 'online',
            collections: stats.collections || 0,
            documents: stats.documents || 0,
            lastCheck: now
          };
          return {
            success: true,
            status: 'online',
            stats,
            vectorDbHealth: systemAnalytics.vectorDbHealth,
            inProcess: true
          };
        } catch (error) {
          logger.error('[IPC:VectorDB] Error getting status:', error);
          const now = Date.now();
          systemAnalytics.vectorDbHealth = {
            status: 'error',
            error: error.message,
            lastCheck: now
          };
          return {
            success: false,
            status: 'error',
            error: error.message,
            vectorDbHealth: systemAnalytics.vectorDbHealth,
            inProcess: true
          };
        }
      }
    })
  );

  // Get stats
  safeHandle(
    ipcMain,
    IPC_CHANNELS.VECTOR_DB?.GET_STATS || 'vectordb:get-stats',
    createHandler({
      logger,
      context,
      schema: schemaVoid,
      handler: async () => {
        try {
          const service = getVectorService();
          if (!service) {
            return {
              success: false,
              error: 'VectorDB service not initialized'
            };
          }

          const stats = await withTimeout(
            service.getStats(),
            TIMEOUTS.HEALTH_CHECK,
            'Vector DB stats'
          );
          return {
            success: true,
            stats,
            inProcess: true
          };
        } catch (error) {
          logger.error('[IPC:VectorDB] Error getting stats:', error);
          return {
            success: false,
            error: error.message
          };
        }
      }
    })
  );

  // Health check
  safeHandle(
    ipcMain,
    IPC_CHANNELS.VECTOR_DB?.HEALTH_CHECK || 'vectordb:health-check',
    createHandler({
      logger,
      context,
      schema: schemaVoid,
      handler: async () => {
        try {
          const service = getVectorService();
          if (!service) {
            return {
              success: false,
              healthy: false,
              error: 'VectorDB service not initialized',
              inProcess: true
            };
          }

          // OramaVectorService is in-process, always healthy if initialized
          const stats = await withTimeout(
            service.getStats(),
            TIMEOUTS.HEALTH_CHECK,
            'Vector DB health check'
          );
          const now = Date.now();

          systemAnalytics.vectorDbHealth = {
            status: 'online',
            healthy: true,
            lastCheck: now
          };
          return {
            success: true,
            healthy: true,
            collections: stats.collections || 0,
            vectorDbHealth: systemAnalytics.vectorDbHealth,
            inProcess: true
          };
        } catch (error) {
          logger.error('[IPC:VectorDB] Health check failed:', error);
          const now = Date.now();
          systemAnalytics.vectorDbHealth = {
            status: 'error',
            healthy: false,
            error: error.message,
            lastCheck: now
          };
          return {
            success: false,
            healthy: false,
            error: error.message,
            vectorDbHealth: systemAnalytics.vectorDbHealth,
            inProcess: true
          };
        }
      }
    })
  );
}

module.exports = { registerVectorDbIpc };
