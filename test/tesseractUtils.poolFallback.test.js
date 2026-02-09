/**
 * Tests for tesseractUtils pool-to-local-worker fallback fix
 *
 * Verifies that when the OCR worker pool returns an error result,
 * the function falls through to the local JS worker instead of
 * returning an empty string.
 */

describe('tesseractUtils - pool error fallback to local worker', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2020-01-01T00:00:00Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  function setupMocks({ poolResult, poolThrows, localWorkerText }) {
    // Mock child_process (native tesseract unavailable)
    const mockExecFile = jest.fn((...args) => {
      const callback = args[args.length - 1];
      callback(new Error('native tesseract missing'));
    });
    jest.doMock('child_process', () => ({ execFile: mockExecFile }));

    // Mock tesseract.js with a working local worker
    const mockWorker = {
      recognize: jest.fn().mockResolvedValue({
        data: { text: localWorkerText || 'local-worker-text' }
      }),
      reinitialize: jest.fn(),
      loadLanguage: jest.fn(),
      initialize: jest.fn(),
      setParameters: jest.fn(),
      terminate: jest.fn()
    };
    jest.doMock('tesseract.js', () => ({
      createWorker: jest.fn().mockResolvedValue(mockWorker)
    }));

    // Mock tesseract.js-core
    jest.doMock('tesseract.js-core/tesseract-core.wasm.js', () => ({}), { virtual: true });
    jest.doMock('tesseract.js/src/worker-script/node/index.js', () => ({}), { virtual: true });

    // Mock tesseractJsPaths
    jest.doMock('../src/main/utils/tesseractJsPaths', () => ({
      resolveTesseractJsOptions: () => ({
        workerPath: '/fake/worker.js',
        corePath: '/fake/core/',
        workerBlobURL: false
      })
    }));

    // Mock runtimePaths
    jest.doMock('../src/main/utils/runtimePaths', () => ({
      resolveRuntimePath: jest.fn().mockReturnValue(null)
    }));

    // Mock workerPools
    const pool = poolThrows
      ? { run: jest.fn().mockRejectedValue(new Error(poolThrows)) }
      : { run: jest.fn().mockResolvedValue(poolResult) };

    jest.doMock('../src/main/utils/workerPools', () => ({
      getOcrPool: jest.fn().mockReturnValue(pool),
      destroyOcrPool: jest.fn().mockResolvedValue(),
      shouldUsePiscina: jest.fn().mockReturnValue(true)
    }));

    // Mock logger (path relative to the source file that requires it)
    jest.doMock('../src/shared/logger', () => ({
      logger: { warn: jest.fn(), debug: jest.fn(), info: jest.fn(), error: jest.fn() },
      createLogger: jest.fn(() => ({
        warn: jest.fn(),
        debug: jest.fn(),
        info: jest.fn(),
        error: jest.fn()
      }))
    }));

    return { mockWorker, pool };
  }

  test('falls through to local worker when pool returns error result', async () => {
    const { mockWorker } = setupMocks({
      poolResult: { error: 'Worker crashed' },
      localWorkerText: 'fallback-text'
    });

    const tesseractUtils = require('../src/main/utils/tesseractUtils');

    // First make it available (it'll use the pool check in isTesseractAvailable)
    // Then call recognize which should fall through pool error -> local worker
    const result = await tesseractUtils.recognizeIfAvailable(null, Buffer.from('image-data'));

    expect(result.success).toBe(true);
    expect(result.text).toBe('fallback-text');
    expect(mockWorker.recognize).toHaveBeenCalled();
  });

  test('falls through to local worker when pool.run() throws', async () => {
    const { mockWorker } = setupMocks({
      poolThrows: 'Pool execution error',
      localWorkerText: 'recovered-text'
    });

    const tesseractUtils = require('../src/main/utils/tesseractUtils');

    const result = await tesseractUtils.recognizeIfAvailable(null, Buffer.from('image-data'));

    expect(result.success).toBe(true);
    expect(result.text).toBe('recovered-text');
    expect(mockWorker.recognize).toHaveBeenCalled();
  });

  test('returns pool text on success (no error field)', async () => {
    setupMocks({
      poolResult: { text: 'pool-text' },
      localWorkerText: 'should-not-be-used'
    });

    const tesseractUtils = require('../src/main/utils/tesseractUtils');

    const result = await tesseractUtils.recognizeIfAvailable(null, Buffer.from('image-data'));

    expect(result.success).toBe(true);
    expect(result.text).toBe('pool-text');
  });
});
