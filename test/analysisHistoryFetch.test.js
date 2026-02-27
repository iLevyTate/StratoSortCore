/**
 * @jest-environment jsdom
 */

import { fetchAnalysisHistoryPages } from '../src/renderer/utils/analysisHistoryFetch';

jest.mock('../src/shared/logger', () => ({
  createLogger: () => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  })
}));

describe('fetchAnalysisHistoryPages', () => {
  afterEach(() => {
    delete window.electronAPI;
    jest.clearAllMocks();
  });

  test('fetches history in pages until exhausted', async () => {
    const get = jest
      .fn()
      .mockResolvedValueOnce([{ id: 1 }, { id: 2 }])
      .mockResolvedValueOnce([{ id: 3 }]);

    window.electronAPI = {
      analysisHistory: { get }
    };

    const result = await fetchAnalysisHistoryPages({ pageSize: 2, maxEntries: 10 });

    expect(result).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
    expect(get).toHaveBeenNthCalledWith(1, { limit: 2, offset: 0 });
    expect(get).toHaveBeenNthCalledWith(2, { limit: 2, offset: 2 });
  });

  test('stops when backend returns invalid payload type', async () => {
    const get = jest
      .fn()
      .mockResolvedValueOnce([{ id: 1 }])
      .mockResolvedValueOnce({
        success: false
      });

    window.electronAPI = {
      analysisHistory: { get }
    };

    const result = await fetchAnalysisHistoryPages({ pageSize: 1, maxEntries: 10 });

    expect(result).toEqual([{ id: 1 }]);
    expect(get).toHaveBeenCalledTimes(2);
  });
});
