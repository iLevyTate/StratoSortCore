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
    expect(edges).toEqual({ success: true, edges: [] });
    expect(stats).toEqual(
      expect.objectContaining({
        success: true,
        edgeCount: 0,
        conceptCount: 0,
        docCount: 0,
        totalEdges: 0,
        totalNodes: 0
      })
    );
  });

  test('delegates to relationship service when available', async () => {
    const service = {
      getEdges: jest.fn().mockResolvedValue({ success: true, edges: [{ id: 'e1' }] }),
      getStats: jest.fn().mockResolvedValue({ success: true, edgeCount: 1, docCount: 2 })
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
    expect(edges).toEqual({ success: true, edges: [{ id: 'e1' }] });
    expect(stats.edgeCount).toBe(1);
  });

  test('normalizes legacy array response from relationship service', async () => {
    const service = {
      getEdges: jest.fn().mockResolvedValue([{ id: 'legacy-edge' }]),
      getStats: jest.fn().mockResolvedValue({ success: true, edgeCount: 0 })
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
    const edges = await handlers['knowledge:edges'].handler(null, { fileIds: ['a', 'b'] });
    expect(edges).toEqual({ success: true, edges: [{ id: 'legacy-edge' }] });
  });
});
