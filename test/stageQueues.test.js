jest.mock('electron', () => ({
  app: {
    getPath: jest.fn(() => 'C:\\fake-user-data')
  }
}));

jest.mock('../src/shared/config/index', () => ({
  get: jest.fn((key, fallback) => fallback)
}));

jest.mock('../src/main/analysis/embeddingQueue/index', () => ({
  getStats: jest.fn(() => ({ size: 1 }))
}));

const mockEmbeddingQueue = jest.fn().mockImplementation((opts) => ({
  opts
}));
jest.mock('../src/main/analysis/embeddingQueue/EmbeddingQueueCore', () => mockEmbeddingQueue);

describe('stageQueues', () => {
  test('organizeQueue is created with expected paths', () => {
    jest.resetModules();
    const { organizeQueue } = require('../src/main/analysis/embeddingQueue/stageQueues');
    expect(organizeQueue.opts.persistenceFileName).toBe('pending_embeddings_organize.json');
    expect(organizeQueue.opts.failedItemsPath).toContain('failed_embeddings_organize.json');
  });
});
