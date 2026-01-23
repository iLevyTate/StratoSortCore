/**
 * Tests for batch progress reporting helpers.
 */

jest.mock('../src/main/ipc/ipcWrappers', () => ({
  safeSend: jest.fn()
}));

const { safeSend } = require('../src/main/ipc/ipcWrappers');
const { sendChunkedResults } = require('../src/main/ipc/files/batchProgressReporter');

describe('batchProgressReporter', () => {
  const getMainWindow = () => ({
    isDestroyed: () => false,
    webContents: {}
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns sent=false for non-array results', async () => {
    const result = await sendChunkedResults(getMainWindow, 'batch-1', null, 10);
    expect(result).toEqual({ sent: false, totalChunks: 0 });
    expect(safeSend).not.toHaveBeenCalled();
  });

  it('returns sent=false for invalid chunk size', async () => {
    const result = await sendChunkedResults(getMainWindow, 'batch-1', ['a'], 0);
    expect(result).toEqual({ sent: false, totalChunks: 0 });
    expect(safeSend).not.toHaveBeenCalled();
  });

  it('returns sent=true with zero chunks for empty results', async () => {
    const result = await sendChunkedResults(getMainWindow, 'batch-1', [], 10);
    expect(result).toEqual({ sent: true, totalChunks: 0 });
    expect(safeSend).not.toHaveBeenCalled();
  });

  it('sends chunked results and marks last chunk', async () => {
    const results = ['a', 'b', 'c'];
    const response = await sendChunkedResults(getMainWindow, 'batch-1', results, 2);
    expect(response).toEqual({ sent: true, totalChunks: 2 });
    expect(safeSend).toHaveBeenCalledTimes(2);
    expect(safeSend.mock.calls[0][1]).toBe('batch-results-chunk');
    expect(safeSend.mock.calls[0][2].isLast).toBe(false);
    expect(safeSend.mock.calls[1][2].isLast).toBe(true);
  });
});
