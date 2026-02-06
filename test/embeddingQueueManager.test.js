jest.mock('../src/main/analysis/embeddingQueue/stageQueues', () => {
  const analysisQueue = {
    updateByFilePath: jest.fn(() => 1),
    updateByFilePaths: jest.fn(() => 2),
    removeByFilePath: jest.fn(() => 1),
    removeByFilePaths: jest.fn(() => 2),
    getStats: jest.fn(() => ({ size: 1 })),
    forceFlush: jest.fn().mockResolvedValue('ok'),
    shutdown: jest.fn().mockResolvedValue('ok')
  };
  const organizeQueue = {
    updateByFilePath: jest.fn(() => 3),
    updateByFilePaths: jest.fn(() => 4),
    removeByFilePath: jest.fn(() => 3),
    removeByFilePaths: jest.fn(() => 4),
    getStats: jest.fn(() => ({ size: 2 })),
    forceFlush: jest.fn().mockResolvedValue('ok'),
    shutdown: jest.fn().mockResolvedValue('ok')
  };
  return { analysisQueue, organizeQueue };
});

const manager = require('../src/main/analysis/embeddingQueue/queueManager');

describe('embeddingQueueManager', () => {
  test('updateByFilePath sums queue results', () => {
    const total = manager.updateByFilePath('a', 'b');
    expect(total).toBe(4);
  });

  test('getStats returns both queues', () => {
    const stats = manager.getStats();
    expect(stats.analysis.size).toBe(1);
    expect(stats.organize.size).toBe(2);
  });

  test('forceFlush resolves when all succeed', async () => {
    const result = await manager.forceFlush();
    expect(result).toHaveLength(2);
  });
});
