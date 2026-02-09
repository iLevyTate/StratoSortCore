const originalEnv = { ...process.env };

describe('workerPools shutdown', () => {
  let pools;

  beforeEach(() => {
    jest.resetModules();
    pools = [];

    process.env = { ...originalEnv };
    process.env.NODE_ENV = 'development';
    delete process.env.JEST_WORKER_ID;
    process.env.STRATOSORT_DISABLE_PISCINA = 'false';
    process.env.STRATOSORT_ENABLE_EMBEDDING_WORKER = 'true';

    jest.doMock('fs', () => ({
      existsSync: jest.fn(() => true)
    }));

    jest.doMock('piscina', () =>
      jest.fn().mockImplementation(() => {
        const pool = {
          drain: jest.fn().mockResolvedValue(undefined),
          destroy: jest.fn().mockResolvedValue(undefined),
          on: jest.fn(),
          pending: 0,
          queueSize: 0
        };
        pools.push(pool);
        return pool;
      })
    );
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    jest.dontMock('fs');
    jest.dontMock('piscina');
    jest.resetModules();
    jest.clearAllMocks();
  });

  test('destroyPools drains before destroy', async () => {
    const workerPools = require('../src/main/utils/workerPools');

    const ocrPool = workerPools.getOcrPool();
    const embeddingPool = workerPools.getEmbeddingPool();

    await workerPools.destroyPools();

    expect(ocrPool.drain).toHaveBeenCalled();
    expect(ocrPool.destroy).toHaveBeenCalled();
    expect(ocrPool.drain.mock.invocationCallOrder[0]).toBeLessThan(
      ocrPool.destroy.mock.invocationCallOrder[0]
    );

    expect(embeddingPool.drain).toHaveBeenCalled();
    expect(embeddingPool.destroy).toHaveBeenCalled();
    expect(embeddingPool.drain.mock.invocationCallOrder[0]).toBeLessThan(
      embeddingPool.destroy.mock.invocationCallOrder[0]
    );
  });
});
