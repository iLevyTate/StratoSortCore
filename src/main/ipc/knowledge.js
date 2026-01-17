const { registerHandlers } = require('./ipcWrappers');
const { IpcServiceContext, createFromLegacyParams } = require('./IpcServiceContext');
const { schemas } = require('./validationSchemas');
const RelationshipIndexService = require('../services/RelationshipIndexService');

function registerKnowledgeIpc(servicesOrParams) {
  let context;
  if (servicesOrParams instanceof IpcServiceContext) {
    context = servicesOrParams;
  } else {
    context = createFromLegacyParams(servicesOrParams);
  }

  const { ipcMain, IPC_CHANNELS, logger } = context.core;
  const { getServiceIntegration } = context;

  const getRelationshipService = () => {
    const integration = getServiceIntegration && getServiceIntegration();
    const analysisHistoryService = integration?.analysisHistory;
    return new RelationshipIndexService({ analysisHistoryService });
  };

  registerHandlers({
    ipcMain,
    logger,
    context: 'Knowledge',
    handlers: {
      [IPC_CHANNELS.KNOWLEDGE.GET_RELATIONSHIP_EDGES]: {
        schema: schemas.relationshipEdges,
        handler: async (event, { fileIds, minWeight, maxEdges } = {}) => {
          const service = getRelationshipService();
          return service.getEdges(fileIds, { minWeight, maxEdges });
        }
      }
    }
  });
}

module.exports = registerKnowledgeIpc;
