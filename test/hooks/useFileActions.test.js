/**
 * @jest-environment jsdom
 */
import { renderHook, act } from '@testing-library/react';
import { useFileActions } from '../../src/renderer/hooks/useFileActions';

// Mock logger
jest.mock('../../src/shared/logger', () => ({
  logger: {
    warn: jest.fn(),
    error: jest.fn()
  }
}));

describe('useFileActions', () => {
  let mockElectronAPI;
  let mockClipboard;

  beforeEach(() => {
    jest.clearAllMocks();

    // Setup electron API mock
    mockElectronAPI = {
      files: {
        open: jest.fn().mockResolvedValue({ success: true }),
        reveal: jest.fn().mockResolvedValue({ success: true })
      }
    };

    Object.defineProperty(window, 'electronAPI', {
      value: mockElectronAPI,
      writable: true
    });

    // Setup clipboard mock
    mockClipboard = {
      writeText: jest.fn().mockResolvedValue(undefined)
    };

    Object.defineProperty(navigator, 'clipboard', {
      value: mockClipboard,
      writable: true
    });
  });

  test('openFile calls API and handles success', async () => {
    const { result } = renderHook(() => useFileActions());

    await act(async () => {
      await result.current.openFile('/test/path.pdf');
    });

    expect(mockElectronAPI.files.open).toHaveBeenCalledWith('/test/path.pdf');
  });

  test('openFile handles failure', async () => {
    mockElectronAPI.files.open.mockResolvedValue({ success: false, error: 'Failed' });
    const onError = jest.fn();
    const { result } = renderHook(() => useFileActions(onError));

    await act(async () => {
      await result.current.openFile('/test/path.pdf');
    });

    expect(onError).toHaveBeenCalledWith('Failed');
  });

  test('openFile handles error', async () => {
    mockElectronAPI.files.open.mockRejectedValue(new Error('Crash'));
    const onError = jest.fn();
    const { result } = renderHook(() => useFileActions(onError));

    await act(async () => {
      await result.current.openFile('/test/path.pdf');
    });

    expect(onError).toHaveBeenCalledWith('Failed to open file');
  });

  test('revealFile calls API and handles success', async () => {
    const { result } = renderHook(() => useFileActions());

    await act(async () => {
      await result.current.revealFile('/test/path.pdf');
    });

    expect(mockElectronAPI.files.reveal).toHaveBeenCalledWith('/test/path.pdf');
  });

  test('revealFile handles FILE_NOT_FOUND', async () => {
    mockElectronAPI.files.reveal.mockResolvedValue({ success: false, errorCode: 'FILE_NOT_FOUND' });
    const onError = jest.fn();
    const { result } = renderHook(() => useFileActions(onError));

    await act(async () => {
      await result.current.revealFile('/test/path.pdf');
    });

    expect(onError).toHaveBeenCalledWith(expect.stringContaining('File not found'));
  });

  test('copyPath writes to clipboard', async () => {
    const { result } = renderHook(() => useFileActions());

    await act(async () => {
      await result.current.copyPath('/test/path.pdf');
    });

    expect(mockClipboard.writeText).toHaveBeenCalledWith('/test/path.pdf');
  });

  test('copyPath handles failure', async () => {
    mockClipboard.writeText.mockRejectedValue(new Error('Copy failed'));
    const onError = jest.fn();
    const { result } = renderHook(() => useFileActions(onError));

    await act(async () => {
      await result.current.copyPath('/test/path.pdf');
    });

    expect(onError).toHaveBeenCalledWith('Failed to copy path to clipboard');
  });
});
