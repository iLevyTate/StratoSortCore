import { renderHook, act } from '@testing-library/react';

jest.mock('../src/shared/logger', () => ({
  logger: {
    error: jest.fn()
  }
}));

import { useAsyncData } from '../src/renderer/hooks/useAsyncData';
import { logger } from '../src/shared/logger';

const flushPromises = () => new Promise((resolve) => setImmediate(resolve));

describe('useAsyncData', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  test('executes fetcher when triggered and updates state', async () => {
    const fetcher = jest.fn().mockResolvedValue('result');
    const onSuccess = jest.fn();

    const { result } = renderHook(() => useAsyncData(fetcher, [], { skip: true, onSuccess }));

    expect(result.current.loading).toBe(false);

    await act(async () => {
      await result.current.execute();
      await flushPromises();
    });

    expect(fetcher).toHaveBeenCalled();
    expect(result.current.data).toBe('result');
    expect(result.current.loading).toBe(false);
    expect(onSuccess).toHaveBeenCalledWith('result');
  });

  test('uses the latest fetcher via ref', async () => {
    const fetcher1 = jest.fn().mockResolvedValue('first');
    const fetcher2 = jest.fn().mockResolvedValue('second');

    const { result, rerender } = renderHook(
      ({ fetcher }) => useAsyncData(fetcher, [], { skip: true }),
      { initialProps: { fetcher: fetcher1 } }
    );

    rerender({ fetcher: fetcher2 });

    await act(async () => {
      await result.current.execute();
      await flushPromises();
    });

    expect(fetcher1).not.toHaveBeenCalled();
    expect(fetcher2).toHaveBeenCalled();
  });

  test('stores error and logs when onError throws', async () => {
    const fetchError = new Error('fetch failed');
    const callbackError = new Error('callback failed');
    const fetcher = jest.fn().mockRejectedValue(fetchError);
    const onError = jest.fn(() => {
      throw callbackError;
    });

    const { result } = renderHook(() => useAsyncData(fetcher, [], { skip: true, onError }));

    await act(async () => {
      await result.current.execute();
      await flushPromises();
    });

    expect(result.current.error).toBe(fetchError);
    expect(onError).toHaveBeenCalledWith(fetchError);
    expect(logger.error).toHaveBeenCalledWith('[useAsyncData] onError callback threw:', {
      error: callbackError.message
    });
  });

  test('setData allows manual updates', () => {
    const fetcher = jest.fn().mockResolvedValue('unused');

    const { result } = renderHook(() =>
      useAsyncData(fetcher, [], { skip: true, initialData: 'initial' })
    );

    act(() => {
      result.current.setData('updated');
    });

    expect(result.current.data).toBe('updated');
  });
});
