/**
 * Tagging Handlers
 *
 * Handlers for file tagging operations.
 *
 * @module ipc/files/taggingHandlers
 */

const { IPC_CHANNELS } = require('../../../shared/constants');
const { createHandler, safeHandle } = require('../ipcWrappers');
const { logger } = require('../../../shared/logger');
const { ServiceIds } = require('../../services/ServiceContainer');
const { z } = require('../validationSchemas');

/**
 * Register tagging handlers
 * @param {Object} container - Service container
 */
function registerTaggingHandlers(container) {
  const { ipcMain } = container.core;
  const { getServiceIntegration } = container;

  // Helper to get services
  const getServices = () => {
    const integration = getServiceIntegration();
    const activeContainer = integration?.container;

    if (!activeContainer) return null;

    try {
      return {
        analysisHistory: integration.analysisHistory,
        orama: activeContainer.resolve(ServiceIds.ORAMA_VECTOR)
      };
    } catch (e) {
      logger.error('Failed to resolve services for tagging', e);
      return null;
    }
  };

  // Build schema: validates [fileIds, tags] tuple with proper type/length constraints
  const addTagsSchema = z
    ? z.tuple([
        z.array(z.string().min(1, 'File ID must be non-empty')).min(1).max(1000),
        z.array(z.string().min(1, 'Tag must be non-empty').max(200)).min(1).max(100)
      ])
    : null;

  safeHandle(
    ipcMain,
    IPC_CHANNELS.FILES.ADD_TAGS,
    createHandler({
      logger,
      context: 'Tagging',
      schema: addTagsSchema,
      handler: async (event, fileIds, tags) => {
        const services = getServices();
        if (!services) throw new Error('Services not available');

        const { analysisHistory, orama } = services;
        let successCount = 0;
        const errors = [];

        for (const id of fileIds) {
          try {
            // 1. Get document from Orama to find filePath
            const doc = await orama.getDocument(id);
            if (!doc) {
              errors.push({ id, error: 'Document not found' });
              continue;
            }

            const filePath = doc.filePath;
            const currentTags = doc.tags || [];

            // Merge tags (unique)
            const newTags = [...new Set([...currentTags, ...tags])];

            // 2. Update Orama
            await orama.updateDocumentTags(id, newTags);

            // 3. Update Analysis History (warn if filePath missing to flag data inconsistency)
            if (filePath) {
              await analysisHistory.updateTags(filePath, newTags);
            } else {
              logger.warn('[Tagging] Document missing filePath, analysis history not updated', {
                id
              });
            }

            successCount++;
          } catch (e) {
            errors.push({ id, error: e.message });
          }
        }

        return {
          success: successCount > 0,
          updated: successCount,
          errors: errors.length > 0 ? errors : undefined
        };
      }
    })
  );
}

module.exports = { registerTaggingHandlers };
