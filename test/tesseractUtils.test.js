/**
 * Tests for tesseract utils availability behavior.
 */

describe('tesseractUtils availability', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2020-01-01T00:00:00Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  it('retries availability after cache expiry when worker recovers', async () => {
    const mockExecFile = jest.fn((...args) => {
      const callback = args[args.length - 1];
      callback(new Error('native tesseract missing'));
    });

    const createWorker = jest
      .fn()
      .mockRejectedValueOnce(new Error('worker start failed'))
      .mockResolvedValueOnce({});

    jest.doMock('child_process', () => ({ execFile: mockExecFile }));
    jest.doMock('tesseract.js', () => ({ createWorker }));

    const { isTesseractAvailable } = require('../src/main/utils/tesseractUtils');

    const firstCheck = await isTesseractAvailable();
    expect(firstCheck).toBe(false);
    expect(createWorker).toHaveBeenCalledTimes(1);

    jest.setSystemTime(new Date('2020-01-01T00:01:00Z'));

    const secondCheck = await isTesseractAvailable();
    expect(secondCheck).toBe(true);
    expect(createWorker).toHaveBeenCalledTimes(2);
  });
});
