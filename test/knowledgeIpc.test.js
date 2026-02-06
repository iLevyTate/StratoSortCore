jest.mock('../src/main/ipc/ipcWrappers', () => ({
  registerHandlers: jest.fn((options) => {
    global.__knowledgeHandlers = options.handlers;
  })
}));

jest.mock('../src/main/services/ServiceContainer', () => ({
  container: { has: jest.fn(() => false), resolve: jest.fn() },
  ServiceIds: { RELATIONSHIP_INDEX: 'RELATIONSHIP_INDEX' }
}));

const registerKnowledgeIpc = require('../src/main/ipc/knowledge');

describe('knowledge ipc', () => {
  test('returns empty when service missing', async () => {
    registerKnowledgeIpc({
      ipcMain: {},
      IPC_CHANNELS: {
        KNOWLEDGE: {
          GET_RELATIONSHIP_EDGES: 'knowledge:edges',
          GET_RELATIONSHIP_STATS: 'knowledge:stats'
        }
      },
      logger: { debug: jest.fn() },
      getServiceIntegration: jest.fn(() => ({}))
    });

    const handlers = global.__knowledgeHandlers;
    const edges = await handlers['knowledge:edges'].handler(null, { fileIds: [] });
    const stats = await handlers['knowledge:stats'].handler();
    expect(edges).toEqual([]);
    expect(stats).toEqual({ totalEdges: 0, totalNodes: 0 });
  });

  test('delegates to relationship service when available', async () => {
    const service = {
      getEdges: jest.fn().mockResolvedValue([{ id: 'e1' }]),
      getStats: jest.fn().mockResolvedValue({ totalEdges: 1, totalNodes: 2 })
    };
    registerKnowledgeIpc({
      ipcMain: {},
      IPC_CHANNELS: {
        KNOWLEDGE: {
          GET_RELATIONSHIP_EDGES: 'knowledge:edges',
          GET_RELATIONSHIP_STATS: 'knowledge:stats'
        }
      },
      logger: { debug: jest.fn() },
      getServiceIntegration: jest.fn(() => ({ relationshipIndex: service }))
    });

    const handlers = global.__knowledgeHandlers;
    const edges = await handlers['knowledge:edges'].handler(null, { fileIds: ['a'] });
    const stats = await handlers['knowledge:stats'].handler();
    expect(edges).toEqual([{ id: 'e1' }]);
    expect(stats.totalEdges).toBe(1);
  });
});
